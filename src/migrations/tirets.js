'use strict';
// ✍️ MIGRATION : retirer les tirets cadratins des textes déjà enregistrés.
//
// Le caractère « tiret cadratin » est banni du projet (voir CLAUDE.md) : c'est la
// signature d'écriture la plus reconnaissable d'un texte produit par une IA, et
// ces textes partent chez de vrais prospects au nom d'OTEA Production.
//
// Nettoyer les fichiers du code ne suffit pas : la base de Maxime contient déjà
// sa signature d'email, ses templates et ses kits de campagne, enregistrés avant
// la règle. Cette migration les reprend une fois, puis se désactive.
//
// Deux traitements, selon ce qu'on sait du texte :
//  · un template fourni avec l'app est RÉÉCRIT depuis la nouvelle version (du
//    français relu à la main) ;
//  · tout le reste (kits de campagne, textes personnels) reçoit un remplacement
//    prudent, sans jamais toucher au sens.
//
// RÈGLE DE SÛRETÉ : c'est une retouche cosmétique. Elle ne doit JAMAIS empêcher
// l'app de démarrer. Une base plus ancienne peut ne pas avoir toutes les colonnes
// d'aujourd'hui : on lit donc les colonnes réellement présentes, et le moindre
// incident est avalé et signalé plutôt que remonté en plantage.

const DRAPEAU = 'migration_tirets_v1';
const TIRET = '—';

// Remplacement prudent : le tiret sépare presque toujours un libellé de son
// explication. On ne supprime jamais le tiret sans mettre autre chose à la place.
function nettoyer(texte) {
  if (!texte || !String(texte).includes(TIRET)) return texte;
  return String(texte)
    .split(' ' + TIRET + ' ').join(' : ')      // « libellé — explication »
    .split(TIRET + ' ').join('')               // tiret en début de ligne
    .split(' ' + TIRET).join('')               // tiret en fin de segment
    .split(TIRET).join('-');                   // dernier recours : trait d'union
}

const contient = (v) => typeof v === 'string' && v.includes(TIRET);

// Colonnes réellement présentes dans cette base : une version antérieure de
// l'app a pu créer la table avec moins de colonnes qu'aujourd'hui.
function colonnesPresentes(dbApi, table) {
  try {
    return new Set(dbApi.all(`PRAGMA table_info(${table})`).map((c) => String(c.name)));
  } catch { return new Set(); }
}

// Réécrit les champs texte d'une table, en ignorant ceux qui n'existent pas ici.
function nettoyerTable(dbApi, table, champsVoulus) {
  const presentes = colonnesPresentes(dbApi, table);
  if (!presentes.has('id')) return 0; // table absente ou d'une forme inattendue
  const champs = champsVoulus.filter((c) => presentes.has(c));
  if (!champs.length) return 0;

  const lignes = dbApi.all(`SELECT id, ${champs.join(', ')} FROM ${table}`);
  let touchees = 0;
  for (const ligne of lignes) {
    const sales = champs.filter((c) => contient(ligne[c]));
    if (!sales.length) continue;
    dbApi.run(
      `UPDATE ${table} SET ${sales.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      ...sales.map((c) => nettoyer(ligne[c])), ligne.id
    );
    touchees++;
  }
  return touchees;
}

function migrer(dbApi, playbooks) {
  const { all, run, getSetting, setSetting } = dbApi;
  if (getSetting(DRAPEAU) === '1') return { deja_fait: true };

  const bilan = { templates_reecrits: 0, templates_nettoyes: 0, campagnes: 0, sequences: 0, reglages: 0, references: 0 };
  const incidents = [];
  const essayer = (quoi, fn) => {
    try { fn(); } catch (e) { incidents.push(`${quoi} : ${e.message}`); }
  };

  // 1. Templates fournis avec l'app : on remet le texte relu à la main.
  essayer('templates', () => {
    const presentes = colonnesPresentes(dbApi, 'templates');
    if (!presentes.has('code')) return;
    const parCode = new Map((playbooks.TEMPLATE_SEED || []).map((t) => [t.code, t]));
    for (const t of all('SELECT id, code, name, subject, body FROM templates')) {
      if (![t.name, t.subject, t.body].some(contient)) continue;
      const seed = parCode.get(t.code);
      if (seed) {
        run('UPDATE templates SET name = ?, subject = ?, body = ? WHERE id = ?', seed.name, seed.subject, seed.body, t.id);
        bilan.templates_reecrits++;
      } else {
        run('UPDATE templates SET name = ?, subject = ?, body = ? WHERE id = ?',
          nettoyer(t.name), nettoyer(t.subject), nettoyer(t.body), t.id);
        bilan.templates_nettoyes++;
      }
    }
  });

  // 2. Campagnes : nom, angle, post LinkedIn, script DM, recette Sales Navigator.
  essayer('campagnes', () => {
    bilan.campagnes = nettoyerTable(dbApi, 'campaigns', ['name', 'angle', 'post_draft', 'dm_draft', 'sn_recipe', 'notes']);
  });

  // 3. Séquences.
  essayer('séquences', () => {
    bilan.sequences = nettoyerTable(dbApi, 'sequences', ['name', 'description']);
  });

  // 4. Réglages : la signature d'email est le cas critique, elle part sur chaque envoi.
  essayer('réglages', () => {
    for (const r of all('SELECT key, value FROM settings')) {
      if (!contient(r.value)) continue;
      // Dans une signature, le tiret séparait le nom de la boîte : une virgule
      // sonne juste là où deux-points annoncerait une explication.
      const propre = r.key === 'user_signature'
        ? r.value.split(' ' + TIRET + ' ').join(', ')
        : nettoyer(r.value);
      setSetting(r.key, propre);
      bilan.reglages++;
    }
  });

  // 5. Références clients affichées dans les campagnes.
  essayer('références', () => {
    bilan.references = nettoyerTable(dbApi, 'refs', ['name', 'detail']);
  });

  // Un incident laisse le drapeau baissé : on retentera au prochain démarrage,
  // quand la base aura été complétée. L'app, elle, démarre normalement.
  if (incidents.length) return { ...bilan, incidents };
  setSetting(DRAPEAU, '1');
  return bilan;
}

// Enveloppe appelée au démarrage : quoi qu'il arrive, l'app doit s'ouvrir.
function migrerSansRisque(dbApi, playbooks) {
  try {
    return migrer(dbApi, playbooks);
  } catch (e) {
    return { echec: e.message };
  }
}

module.exports = { migrer, migrerSansRisque, nettoyer, nettoyerTable, DRAPEAU, TIRET };
