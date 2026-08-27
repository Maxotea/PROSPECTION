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

function migrer(dbApi, playbooks) {
  const { get, all, run, getSetting, setSetting } = dbApi;
  if (getSetting(DRAPEAU) === '1') return { deja_fait: true };

  const bilan = { templates_reecrits: 0, templates_nettoyes: 0, campagnes: 0, sequences: 0, reglages: 0, references: 0 };

  // 1. Templates fournis avec l'app : on remet le texte relu.
  const parCode = new Map((playbooks.TEMPLATE_SEED || []).map((t) => [t.code, t]));
  for (const t of all('SELECT id, code, name, subject, body FROM templates')) {
    const touche = contient(t.name) || contient(t.subject) || contient(t.body);
    if (!touche) continue;
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

  // 2. Campagnes : nom, angle, post LinkedIn, script DM, recette Sales Navigator.
  for (const c of all('SELECT id, name, angle, post_draft, dm_draft, sn_recipe, notes FROM campaigns')) {
    if (![c.name, c.angle, c.post_draft, c.dm_draft, c.sn_recipe, c.notes].some(contient)) continue;
    run('UPDATE campaigns SET name = ?, angle = ?, post_draft = ?, dm_draft = ?, sn_recipe = ?, notes = ? WHERE id = ?',
      nettoyer(c.name), nettoyer(c.angle), nettoyer(c.post_draft), nettoyer(c.dm_draft),
      nettoyer(c.sn_recipe), nettoyer(c.notes), c.id);
    bilan.campagnes++;
  }

  // 3. Séquences et leurs étapes.
  for (const s of all('SELECT id, name, description FROM sequences')) {
    if (![s.name, s.description].some(contient)) continue;
    run('UPDATE sequences SET name = ?, description = ? WHERE id = ?', nettoyer(s.name), nettoyer(s.description), s.id);
    bilan.sequences++;
  }

  // 4. Réglages : la signature d'email est le cas critique, elle part sur chaque envoi.
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

  // 5. Références clients affichées dans les campagnes.
  if (get("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'refs'")) {
    for (const r of all('SELECT id, name, detail FROM refs')) {
      if (![r.name, r.detail].some(contient)) continue;
      run('UPDATE refs SET name = ?, detail = ? WHERE id = ?', nettoyer(r.name), nettoyer(r.detail), r.id);
      bilan.references++;
    }
  }

  setSetting(DRAPEAU, '1');
  return bilan;
}

module.exports = { migrer, nettoyer, DRAPEAU, TIRET };
