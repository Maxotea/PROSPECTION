'use strict';
// 🗂️ RÉPERTOIRE CHAUD : « qui as-tu déjà eu au téléphone ou sur WhatsApp,
// et jamais transformé en client ? »
//
// C'est le gisement le plus rentable de la prospection : ces gens te connaissent
// déjà. Le moteur croise l'historique d'appels et WhatsApp, met une note de
// relation sur chacun, écarte le bruit (banques, colis, codes de vérification)
// et te présente une liste à valider. RIEN n'entre dans le CRM sans ton clic :
// ton dentiste et ta mère ne sont pas des prospects.

const dbApi = require('./../db');
const { get, all } = dbApi;
const game = require('./../gamification');
const sig = require('./signaux');
const appels = require('./appels');
const whatsapp = require('./whatsapp');
const { fusionner } = require('./fusion');

// ---------------------------------------------------------------- croisement avec le CRM
function indexContacts() {
  const index = new Map();
  for (const c of all(`SELECT id, first_name, last_name, company, phone, stage, segment FROM contacts WHERE archived = 0 AND phone != ''`)) {
    const cle = sig.phoneKey(c.phone);
    if (cle && !index.has(cle)) index.set(cle, c);
  }
  return index;
}

function scan({ days = 1095, sources = ['appels', 'whatsapp'] } = {}) {
  const avertissements = [];
  const listes = [];
  let groupesIgnores = 0;

  if (sources.includes('appels')) {
    try {
      listes.push(appels.lireBase({ days }));
    } catch (e) { avertissements.push({ source: 'appels', message: e.message }); }
  }
  if (sources.includes('whatsapp')) {
    try {
      const r = whatsapp.lireBase({ days });
      listes.push(r.entries);
      groupesIgnores = r.groupes || 0;
    } catch (e) { avertissements.push({ source: 'whatsapp', message: e.message }); }
  }

  // Ce que l'agent du Mac a déposé compte comme une source de plus.
  const attente = enAttente();
  if (attente.length) listes.push(attente);
  // Si tout vient de l'agent, les erreurs de lecture locale n'ont pas de sens ici.
  const utiles = attente.length && !listes.some((l, i) => i < listes.length - 1 && l.length) ? [] : avertissements;

  return { ...preparer(fusionner(listes)), avertissements: utiles, groupes_ignores: groupesIgnores, depuis_le_mac: attente.length };
}

// Note de relation, température, et « est-il déjà dans le CRM ? ».
function preparer(entrees) {
  const index = indexContacts();
  const prets = entrees.map((e) => {
    const score = sig.scoreRelation(e);
    const cle = sig.phoneKey(e.phone);
    const existant = cle ? index.get(cle) : null;
    return {
      ...e,
      score,
      temperature: sig.temperature(score),
      phone_affiche: sig.joliTelephone(e.phone),
      existing_id: existant ? existant.id : null,
      existing_name: existant ? `${existant.first_name} ${existant.last_name}`.trim() || existant.company : '',
      existing_stage: existant ? existant.stage : '',
    };
  });
  prets.sort((a, b) => b.score - a.score || (b.last_at || '').localeCompare(a.last_at || ''));

  const nouveaux = prets.filter((e) => !e.existing_id);
  return {
    entries: prets,
    stats: {
      total: prets.length,
      nouveaux: nouveaux.length,
      chauds: nouveaux.filter((e) => e.temperature === 'chaud').length,
      tiedes: nouveaux.filter((e) => e.temperature === 'tiede').length,
      avec_signaux: nouveaux.filter((e) => (e.signaux || []).length > 0).length,
    },
  };
}

// Lecture d'un export .txt de conversation WhatsApp (le plan B, sans app Mac).
function scanExportWhatsapp(texte, { days = 3650 } = {}) {
  const moi = dbApi.getSetting('user_name') || '';
  const r = whatsapp.parseExport(texte, { moi, days });
  return { ...preparer(fusionner([r.entries])), auteurs: r.auteurs, mon_nom: r.monNom, avertissements: [] };
}

// Lecture d'un CSV d'appels (export Android).
function scanCsvAppels(rows, { days = 1095 } = {}) {
  return { ...preparer(fusionner([appels.lireCsv(rows, { days })])), avertissements: [] };
}

// ---------------------------------------------------------------- le pont avec le Mac
// Quand l'app est hébergée, elle n'a plus accès aux appels ni à WhatsApp : ils
// vivent sur le Mac. Un petit agent y tourne et dépose ici ce qu'il a trouvé.
// Ces relations attendent la validation, exactement comme un scan fait à la main.
function deposer(entrees) {
  let recus = 0;
  for (const e of entrees) {
    if (!e || (!e.phone && !e.name)) continue;
    const cle = sig.phoneKey(e.phone) || e.key || String(e.name);
    dbApi.run(
      'INSERT INTO repertoire_attente (cle, charge, recu_le) VALUES (?, ?, ?) ' +
      'ON CONFLICT(cle) DO UPDATE SET charge = excluded.charge, recu_le = excluded.recu_le',
      String(cle), JSON.stringify(e), dbApi.nowIso()
    );
    recus++;
  }
  return { recus };
}

function enAttente() {
  return all('SELECT charge FROM repertoire_attente')
    .map((l) => { try { return JSON.parse(l.charge); } catch { return null; } })
    .filter(Boolean);
}

function viderAttente(cles) {
  for (const cle of cles) dbApi.run('DELETE FROM repertoire_attente WHERE cle = ?', String(cle));
}

// ---------------------------------------------------------------- notes lisibles
const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

function resumeRelation(e) {
  const bouts = [];
  if (e.calls) {
    const minutes = Math.round((e.duration_sec || 0) / 60);
    bouts.push(`📞 ${e.calls} appel(s)${minutes ? ` (${minutes} min au total)` : ''}`);
  }
  if (e.messages) bouts.push(`💬 ${e.messages} message(s) WhatsApp`);
  if (e.last_at) bouts.push(`dernier échange le ${dateFr(e.last_at)}`);
  if ((e.signaux || []).length) bouts.push(`mots repérés : ${e.signaux.slice(0, 8).join(', ')}`);
  const ligne = bouts.join(' · ');
  const extrait = e.excerpt ? `\nDernier message reçu : « ${e.excerpt} »` : '';
  return ligne + extrait;
}

// Découpe « Claire Arnaud » en prénom / nom sans casser « Jean-Pierre De La Tour ».
function decouperNom(nom) {
  const parts = String(nom || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: '', last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

function importer(entrees) {
  let created = 0, merged = 0;
  // La déduplication générale du CRM ne connaît pas les téléphones (deux personnes
  // peuvent partager le standard d'une boîte). Ici la source EST une conversation
  // personnelle : le numéro identifie bien quelqu'un, on s'en sert pour retrouver
  // la fiche existante et l'enrichir au lieu de créer un doublon.
  const index = indexContacts();

  for (const e of entrees) {
    if (!e || (!e.phone && !e.name)) continue;
    const { first_name, last_name } = decouperNom(e.name);
    const origine = (e.sources || []).includes('whatsapp') && (e.sources || []).includes('appels')
      ? 'appels+whatsapp'
      : (e.sources || [])[0] || 'repertoire';
    const resume = resumeRelation(e);
    const cle = sig.phoneKey(e.phone);
    const existant = cle ? index.get(cle) : null;

    if (existant) {
      const fiche = get('SELECT * FROM contacts WHERE id = ?', existant.id);
      if (fiche) {
        const patch = {};
        if (!fiche.phone && e.phone) patch.phone = e.phone;
        if (!fiche.first_name && first_name) patch.first_name = first_name;
        if (!fiche.last_name && last_name) patch.last_name = last_name;
        // On ajoute la note de relation sans écraser ce qui est déjà écrit.
        if (resume && !String(fiche.notes || '').includes(resume)) {
          patch.notes = fiche.notes ? `${fiche.notes}\n${resume}` : resume;
        }
        if (Object.keys(patch).length) dbApi.updateContact(fiche.id, patch);
      }
      merged++;
      continue;
    }

    const { contact, created: estNouveau } = dbApi.upsertContact({
      first_name, last_name,
      phone: e.phone || '',
      origin: origine,
      notes: resume,
    });
    if (estNouveau) created++; else merged++;
    // Le nouvel arrivant rejoint l'index : deux entrées du même numéro dans un
    // même import ne doivent pas produire deux fiches.
    if (cle && contact) index.set(cle, contact);
  }
  viderAttente(entrees.map((e) => sig.phoneKey(e && e.phone) || (e && e.key) || ''));
  if (created + merged > 0) {
    game.insertActivity({
      type: 'import',
      xp: Math.min(created, 50),
      note: `Répertoire chaud : ${created} nouveaux, ${merged} fusionnés`,
      meta: { count: created, source: 'repertoire' },
    });
    game.checkBadges();
  }
  return { created, merged };
}

// État affiché dans la vue Imports avant tout scan.
function etat() {
  return {
    appels_disponible: appels.disponible(),
    whatsapp_disponible: whatsapp.disponible(),
    mac: process.platform === 'darwin',
  };
}

module.exports = {
  scan, scanExportWhatsapp, scanCsvAppels, importer, etat,
  deposer, enAttente, viderAttente,
  fusionner, preparer, resumeRelation, decouperNom, indexContacts,
};
