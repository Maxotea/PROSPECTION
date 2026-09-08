'use strict';
// ☀️ MA JOURNÉE : la to-do du matin, faite par la machine au lieu de la tête.
//
// Avant, Maxime se faisait chaque matin une liste mentale de ce qu'il devait
// faire, classée par importance et par durée : les courtes le matin, les
// longues et importantes dans la journée. Et il en oubliait, parce qu'une tête
// n'est pas une base de données.
//
// Ce module fait la même chose, mais en lisant vraiment ce qui se passe :
//   · Gmail        : les mails reçus auxquels il n'a pas répondu ;
//   · WhatsApp     : les conversations où le dernier message n'est pas de lui ;
//   · les appels   : les appels manqués jamais rappelés ;
//   · le CRM       : relances dues, devis à relancer ou à faire, factures à émettre,
//                    demandes entrantes, emails de l'Autopilote à valider, post de campagne ;
//   · son cerveau  : ce qu'il ajoute lui-même, en une ligne (« monter la vidéo du Loft 3h »).
//
// Chaque chose reçoit une IMPORTANCE (🔴 vital, 🟠 important, 🟢 normal) et une
// DURÉE (⚡ court ≤ 15 min, 🧱 moyen, 🏔️ long), puis une place dans la journée :
//   · ⚡ ce matin : toutes les courtes, les plus importantes d'abord ;
//   · 🏔️ la grosse pierre : une ou deux longues et importantes ;
//   · 🧱 cet après-midi : les moyennes ;
//   · 💤 peut attendre : le reste.
//
// Rien n'est jamais fait à sa place : l'outil dit quoi, il décide. Et ce qu'il
// marque « fait », « plus tard » ou « ignoré » ne revient pas le lendemain.

const dbApi = require('./db');
const { get, all, run, nowIso, localDay, addDays, getSetting, setSetting } = dbApi;
const sig = require('./importers/signaux');
const whatsapp = require('./importers/whatsapp');
const appels = require('./importers/appels');
const repertoire = require('./importers/repertoire');
const imap = require('./mail/imap');
const smtp = require('./mail/smtp');
const autopilot = require('./autopilot');
const game = require('./gamification');
const campaigns = require('./campaigns');
const claude = require('./integrations/claude');

// ---------------------------------------------------------------- vocabulaire
const DUREES = {
  court: { code: 'court', label: 'court', emoji: '⚡', minutes: 10, aide: '15 min ou moins' },
  moyen: { code: 'moyen', label: 'moyen', emoji: '🧱', minutes: 45, aide: 'entre 15 min et 1h30' },
  long: { code: 'long', label: 'long', emoji: '🏔️', minutes: 180, aide: "plus d'1h30" },
};
const IMPORTANCES = {
  3: { code: 3, label: 'vital', emoji: '🔴' },
  2: { code: 2, label: 'important', emoji: '🟠' },
  1: { code: 1, label: 'normal', emoji: '🟢' },
};
const BLOCS = {
  matin: { code: 'matin', emoji: '⚡', titre: 'Ce matin : les courtes', aide: 'À expédier avant midi, les plus importantes d’abord.' },
  pierre: { code: 'pierre', emoji: '🏔️', titre: 'La grosse pierre du jour', aide: 'Une ou deux choses longues et importantes. Bloque le créneau.' },
  apres_midi: { code: 'apres_midi', emoji: '🧱', titre: 'Cet après-midi : les moyennes', aide: 'Entre 15 min et 1h30 chacune.' },
  plus_tard: { code: 'plus_tard', emoji: '💤', titre: 'Peut attendre', aide: 'Ni urgent ni vital. Reviens dessus quand le reste est fait.' },
};

// Mots qui donnent la durée d'une tâche tapée à la main.
const MOTS_LONG = [
  'montage', 'monter', 'tournage', 'tourner', 'filmer', 'derush', 'dérush', 'étalonnage', 'etalonnage',
  'mixage', 'livrable', 'rendu', 'export', 'motion', 'aftermovie', 'documentaire', 'film', 'clip',
  'shooting', 'retouche', 'site web', 'site internet', 'calendrier éditorial', 'calendrier editorial', 'batch',
];
const MOTS_MOYEN = [
  'devis', 'proposition', 'réunion', 'reunion', 'visio', 'rdv', 'rendez-vous', 'préparer', 'preparer',
  'rédiger', 'rediger', 'écrire', 'ecrire', 'script', 'stories', 'story', 'reels', 'reel', 'carrousel',
  'brief', 'planifier', 'programmer', 'metricool', 'reporting', 'bilan', 'comptabilité', 'compta',
  'déclaration', 'declaration', 'tva', 'urssaf', 'facturer', 'facture',
];
const MOTS_COURT = [
  'mail', 'email', 'e-mail', 'répondre', 'repondre', 'réponse', 'reponse', 'relancer', 'relance',
  'appeler', 'rappeler', 'appel', 'envoyer', 'transférer', 'transferer', 'payer', 'virement',
  'réserver', 'reserver', 'confirmer', 'valider', 'signer', 'commander', 'message', 'sms', 'whatsapp', 'dm',
];
// Mots qui rendent une chose vitale, quelle que soit sa durée.
const MOTS_VITAL = ['urgent', 'asap', "aujourd'hui", 'aujourd’hui', 'ce matin', 'avant midi', 'impayé', 'impaye', 'mise en demeure', 'retard de paiement', 'deadline'];

// Expéditeurs qui ne sont pas des humains qui attendent une réponse.
const BRUIT_MAIL = /no-?reply|ne-?pas-?repondre|notification|mailer-daemon|newsletter|donotreply|do-not-reply|@(facebook|instagram|linkedin|google|apple|amazon|paypal|stripe|qonto|pennylane|notion|slack|canva|adobe|metricool|zapier|github|calendly|doctolib)\./i;

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// ---------------------------------------------------------------- petits outils
function jourDe(d) {
  const [y, m, j] = String(d).split('-').map(Number);
  return new Date(y, m - 1, j);
}
function dateLongue(day) {
  const d = jourDe(day);
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
}
function depuis(iso, now = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!t) return '';
  const h = Math.max(0, Math.round((now - t) / 3600000));
  if (h < 1) return "à l'instant";
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  return j === 1 ? 'hier' : `il y a ${j} j`;
}
function heuresDepuis(iso, now = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  return t ? (now - t) / 3600000 : 0;
}
function joursDeRetard(day, today) {
  if (!day || !today) return 0;
  return Math.max(0, Math.round((jourDe(today) - jourDe(day)) / 86400000));
}
function dureeTexte(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
}
function eur(n) { return `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} €`; }
function nomContact(c) {
  if (!c) return '';
  const nom = `${c.first_name || ''} ${c.last_name || ''}`.trim();
  return nom || c.company || c.email || c.phone || '';
}
function avecSociete(c) {
  const nom = nomContact(c);
  return c && c.company && nom !== c.company ? `${nom} (${c.company})` : nom;
}
function contientUn(texte, mots) {
  const hay = sig.norm(texte);
  return mots.find((m) => hay.includes(sig.norm(m))) || '';
}
function motsDeal(texte) {
  const hay = sig.norm(texte);
  return sig.MOTS_DEAL.filter((m) => hay.includes(sig.norm(m)));
}

// ---------------------------------------------------------------- 🧠 analyser une ligne tapée à la main
// « Monter la vidéo du Loft 3h !! avant le 12/09 »
//   → long, 180 min, vital, échéance 2026-09-12, texte nettoyé.
function analyserTexte(brut, { today = localDay() } = {}) {
  let texte = String(brut || '').replace(/\s+/g, ' ').trim();
  const out = { texte, duree: '', minutes: 0, importance: 1, echeance: '' };
  if (!texte) return out;

  // Importance : « !! » vital, « ! » important.
  const bangs = (texte.match(/!/g) || []).length;
  if (bangs >= 2) out.importance = 3;
  else if (bangs === 1) out.importance = 2;
  texte = texte.replace(/\s*!+/g, '').trim();
  if (contientUn(texte, MOTS_VITAL)) out.importance = 3;
  else if (out.importance < 2 && motsDeal(texte).length) out.importance = 2;

  // Durée explicite : « 3h », « 1h30 », « 45 min », « (20min) ».
  const h = texte.match(/(?:^|\s)\(?\s*(\d{1,2})\s*h(?:\s*(\d{1,2}))?\s*\)?(?=\s|$)/i);
  const mn = texte.match(/(?:^|\s)\(?\s*(\d{1,3})\s*min(?:utes?)?\s*\)?(?=\s|$)/i);
  if (h) out.minutes = Number(h[1]) * 60 + Number(h[2] || 0);
  else if (mn) out.minutes = Number(mn[1]);
  if (h || mn) texte = texte.replace((h || mn)[0], ' ').replace(/\s+/g, ' ').trim();

  // Échéance : « avant le 12/09 », « pour le 3/10 », « demain », « vendredi ».
  const date = texte.match(/(?:avant le|pour le|le|d'ici le|d’ici le)\s+(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/i);
  if (date) {
    const t = jourDe(today);
    let an = date[3] ? Number(date[3]) : t.getFullYear();
    if (an < 100) an += 2000;
    let d = new Date(an, Number(date[2]) - 1, Number(date[1]));
    if (!date[3] && d < t) d = new Date(an + 1, Number(date[2]) - 1, Number(date[1]));
    if (!Number.isNaN(d.getTime())) out.echeance = localDay(d);
    texte = texte.replace(date[0], '').replace(/\s+/g, ' ').trim();
  } else if (/\bdemain\b/i.test(texte)) {
    out.echeance = addDays(today, 1);
  } else if (/aujourd[’']hui|\bce matin\b|\bce soir\b/i.test(texte)) {
    out.echeance = today;
  } else {
    const jour = JOURS.findIndex((j) => new RegExp(`\\b${j}\\b`, 'i').test(texte));
    if (jour >= 0) {
      const t = jourDe(today);
      let delta = (jour - t.getDay() + 7) % 7;
      if (delta === 0 && !/\bce\s/i.test(texte)) delta = 7;
      out.echeance = addDays(today, delta);
    }
  }

  // Durée : explicite d'abord, puis le vocabulaire, puis « moyen » par défaut.
  if (out.minutes) out.duree = out.minutes <= 15 ? 'court' : out.minutes <= 90 ? 'moyen' : 'long';
  else if (contientUn(texte, MOTS_LONG)) out.duree = 'long';
  else if (contientUn(texte, MOTS_MOYEN)) out.duree = 'moyen';
  else if (contientUn(texte, MOTS_COURT)) out.duree = 'court';
  else out.duree = 'moyen';

  out.texte = texte.replace(/[,;:]\s*$/, '').trim() || out.texte;
  return out;
}

// ---------------------------------------------------------------- 🧠 tâches manuelles
function ajouterTache(brut, champs = {}) {
  const a = analyserTexte(brut);
  const now = nowIso();
  const duree = DUREES[champs.duree] ? champs.duree : a.duree;
  const importance = [1, 2, 3].includes(Number(champs.importance)) ? Number(champs.importance) : a.importance;
  const { lastId } = run(
    'INSERT INTO journee_taches (texte, duree, minutes, importance, echeance, contact_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    a.texte, duree, Number(champs.minutes) || a.minutes || 0, importance,
    champs.echeance !== undefined ? String(champs.echeance || '') : a.echeance,
    champs.contact_id || null, now, now
  );
  return get('SELECT * FROM journee_taches WHERE id = ?', lastId);
}

function modifierTache(id, champs) {
  const t = get('SELECT * FROM journee_taches WHERE id = ?', id);
  if (!t) throw new Error('Tâche introuvable');
  const patch = {};
  if (champs.texte !== undefined) patch.texte = String(champs.texte).trim();
  if (DUREES[champs.duree]) patch.duree = champs.duree;
  if ([1, 2, 3].includes(Number(champs.importance))) patch.importance = Number(champs.importance);
  if (champs.minutes !== undefined) patch.minutes = Math.max(0, Number(champs.minutes) || 0);
  if (champs.echeance !== undefined) patch.echeance = String(champs.echeance || '');
  if (champs.contact_id !== undefined) patch.contact_id = champs.contact_id || null;
  if (champs.statut === 'fait' || champs.statut === 'a_faire') {
    patch.statut = champs.statut;
    patch.fait_le = champs.statut === 'fait' ? nowIso() : '';
  }
  const cols = Object.keys(patch);
  if (cols.length) run(`UPDATE journee_taches SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...cols.map((c) => patch[c]), nowIso(), id);
  return get('SELECT * FROM journee_taches WHERE id = ?', id);
}

function supprimerTache(id) { run('DELETE FROM journee_taches WHERE id = ?', id); return { ok: true }; }

// ---------------------------------------------------------------- 🗂️ index du CRM (pour reconnaître les gens)
function indexCrm() {
  const parEmail = new Map();
  const parTel = new Map();
  for (const c of all(`SELECT id, first_name, last_name, company, email, phone, stage, segment, is_former_client FROM contacts WHERE archived = 0`)) {
    if (c.email && !parEmail.has(c.email)) parEmail.set(c.email, c);
    const k = sig.phoneKey(c.phone);
    if (k && !parTel.has(k)) parTel.set(k, c);
  }
  return { parEmail, parTel };
}
const STAGES_CHAUDS = ['en_discussion', 'rdv', 'devis_envoye', 'negociation', 'gagne'];
function chaleurContact(c) {
  if (!c) return 0;
  return (c.is_former_client || STAGES_CHAUDS.includes(c.stage)) ? 1 : 0;
}
function fiche(c) {
  return c ? { id: c.id, nom: nomContact(c), company: c.company || '', stage: c.stage || '' } : null;
}

// ---------------------------------------------------------------- 📡 radar : lire les sources
function lireRadar() {
  const out = {};
  for (const r of all('SELECT * FROM journee_radar')) {
    let charge = null;
    try { charge = JSON.parse(r.charge); } catch { charge = null; }
    out[r.source] = { charge, lu_le: r.lu_le, erreur: r.erreur };
  }
  return out;
}
function ecrireRadar(source, charge, erreur = '') {
  run('INSERT INTO journee_radar (source, charge, lu_le, erreur) VALUES (?, ?, ?, ?) ON CONFLICT(source) DO UPDATE SET charge = excluded.charge, lu_le = excluded.lu_le, erreur = excluded.erreur',
    source, JSON.stringify(charge === undefined ? null : charge), charge === undefined ? (get('SELECT lu_le FROM journee_radar WHERE source = ?', source) || {}).lu_le || '' : nowIso(), erreur);
}

// Ne garde que ce qui sert : les conversations qui attendent une réponse.
function filtrerWhatsapp(entrees, jours) {
  const limite = Date.now() - jours * 86400000;
  return entrees
    .filter((e) => e.dernier_de_moi === false && e.dernier_entrant_le && Date.parse(e.dernier_entrant_le) >= limite)
    .map((e) => ({ key: e.key, name: e.name || '', phone: e.phone || '', excerpt: e.excerpt || '', signaux: e.signaux || [], dernier_entrant_le: e.dernier_entrant_le, messages: e.messages || 0 }));
}
function filtrerAppels(entrees, jours) {
  const limite = Date.now() - jours * 86400000;
  return entrees
    .filter((e) => e.manques > 0 && e.dernier_manque_le && Date.parse(e.dernier_manque_le) >= limite && e.dernier_appel_de_moi === false && e.dernier_manque_le >= (e.last_at || ''))
    .map((e) => ({ key: e.key, name: e.name || '', phone: e.phone || '', manques: e.manques, dernier_manque_le: e.dernier_manque_le, calls: e.calls || 0 }));
}

async function rafraichir({ sources = ['gmail', 'whatsapp', 'appels'] } = {}) {
  const bilan = {};
  const joursMail = Math.max(1, Number(getSetting('journee_jours_mail')) || 10);
  const joursWa = Math.max(1, Number(getSetting('journee_jours_whatsapp')) || 14);

  if (sources.includes('gmail')) {
    if (!autopilot.isConfigured()) {
      ecrireRadar('gmail', null, 'Gmail pas encore branché : renseigne ton adresse et un mot de passe d’application dans Réglages.');
      bilan.gmail = { branche: false };
    } else {
      try {
        const cfg = autopilot.mailCfg();
        const r = await imap.lireBoiteRecente(cfg.imap, { days: joursMail });
        ecrireRadar('gmail', { ...r, moi: String(cfg.imap.user || '').toLowerCase(), jours: joursMail });
        bilan.gmail = { branche: true, recus: r.recus.length, gmail: r.gmail };
      } catch (e) {
        ecrireRadar('gmail', undefined, `Gmail n'a pas répondu : ${e.message}`);
        bilan.gmail = { branche: true, erreur: e.message };
      }
    }
  }

  if (sources.includes('whatsapp')) {
    try {
      let entrees = null;
      let via = '';
      if (whatsapp.disponible()) {
        entrees = whatsapp.lireBase({ days: joursWa }).entries;
        via = 'mac';
      } else {
        // L'app est hébergée : le pont du Mac a peut-être déposé ses lectures.
        const attente = repertoire.enAttente().filter((e) => (e.sources || [e.source]).includes('whatsapp'));
        if (attente.length) { entrees = attente; via = 'pont'; }
      }
      if (entrees) {
        const gardees = filtrerWhatsapp(entrees, joursWa);
        ecrireRadar('whatsapp', { conversations: gardees, via, jours: joursWa });
        bilan.whatsapp = { branche: true, en_attente: gardees.length, via };
      } else {
        ecrireRadar('whatsapp', null, 'WhatsApp pour Mac introuvable sur cet ordinateur. Sur le Mac, ouvre WhatsApp et laisse-le se synchroniser ; en ligne, lance pont-mac.command.');
        bilan.whatsapp = { branche: false };
      }
    } catch (e) {
      ecrireRadar('whatsapp', undefined, e.message);
      bilan.whatsapp = { branche: true, erreur: e.message };
    }
  }

  if (sources.includes('appels')) {
    try {
      let entrees = null;
      let via = '';
      if (appels.disponible()) { entrees = appels.lireBase({ days: joursWa }); via = 'mac'; }
      else {
        const attente = repertoire.enAttente().filter((e) => (e.sources || [e.source]).includes('appels'));
        if (attente.length) { entrees = attente; via = 'pont'; }
      }
      if (entrees) {
        const gardes = filtrerAppels(entrees, joursWa);
        ecrireRadar('appels', { manques: gardes, via, jours: joursWa });
        bilan.appels = { branche: true, manques: gardes.length, via };
      } else {
        ecrireRadar('appels', null, "Historique d'appels introuvable sur cet ordinateur (iPhone → Réglages → Téléphone → « Appels sur d'autres appareils »).");
        bilan.appels = { branche: false };
      }
    } catch (e) {
      ecrireRadar('appels', undefined, e.message);
      bilan.appels = { branche: true, erreur: e.message };
    }
  }
  return bilan;
}

// ---------------------------------------------------------------- 🔎 les signaux, source par source
function item(base) {
  const duree = DUREES[base.duree] ? base.duree : 'court';
  return {
    cle: base.cle,
    source: base.source,
    emoji: base.emoji || '•',
    titre: base.titre,
    pourquoi: base.pourquoi || '',
    duree,
    minutes: base.minutes || DUREES[duree].minutes,
    importance: Math.min(3, Math.max(1, Number(base.importance) || 1)),
    urgence: Math.min(5, Math.max(0, Number(base.urgence) || 0)),
    argent: Number(base.argent) || 0,
    date: base.date || '',
    echeance: base.echeance || '',
    contact: base.contact || null,
    actions: base.actions || [],
    tache_id: base.tache_id || 0,
    futur: !!base.futur,   // échéance plus tard dans la semaine : pas pour aujourd'hui
  };
}

function signauxGmail(radar, index, now) {
  const data = radar.gmail && radar.gmail.charge;
  if (!data || !Array.isArray(data.recus)) return [];
  const moi = String(data.moi || '').toLowerCase();
  const repondus = new Set(data.repondus || []);
  const ecritsA = data.ecritsA || {};
  const reponsesProspection = new Map(all('SELECT imap_uid, contact_id FROM replies').map((r) => [Number(r.imap_uid), r.contact_id]));

  const parExpediteur = new Map();
  for (const m of data.recus) {
    const from = m.from && m.from.email;
    if (!from || from === moi) continue;
    if (BRUIT_MAIL.test(from) || sig.ressembleAuBruit({ nom: m.from.name, texte: m.subject })) continue;
    if (m.repondu || (m.message_id && repondus.has(m.message_id))) continue;
    const recu = Date.parse(m.date) || 0;
    if ((ecritsA[from] || 0) > recu) continue; // on lui a écrit depuis : la balle est chez lui
    const cur = parExpediteur.get(from);
    if (!cur || recu > cur.recu) parExpediteur.set(from, { ...m, recu });
  }

  const items = [];
  for (const m of parExpediteur.values()) {
    const contact = index.parEmail.get(m.from.email) || null;
    const heures = heuresDepuis(m.recu, now);
    const deal = motsDeal(m.subject);
    const prospection = reponsesProspection.has(m.uid);
    let importance = 1 + chaleurContact(contact) + (deal.length ? 1 : 0) + (heures >= 48 ? 1 : 0) + (prospection ? 1 : 0);
    const qui = contact ? avecSociete(contact) : (m.from.name || m.from.email);
    const pourquoi = [
      `Mail « ${m.subject || '(sans objet)'} » reçu ${depuis(m.recu, now)}, sans réponse`,
      prospection ? 'il répond à ta prospection' : '',
      deal.length ? `mots : ${deal.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    const id = String(m.message_id || '').replace(/^<|>$/g, '');
    items.push(item({
      cle: `mail:${m.message_id || m.uid}`, source: 'gmail', emoji: '📧',
      titre: `Répondre à ${qui}`, pourquoi,
      duree: deal.some((d) => /devis|proposition|offre/.test(d)) ? 'moyen' : 'court',
      importance, urgence: Math.floor(heures / 24), date: new Date(m.recu).toISOString(),
      contact: fiche(contact),
      actions: [
        { type: 'lien', label: '📬 Ouvrir dans Gmail', href: id ? `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(id)}` : 'https://mail.google.com/' },
        { type: 'repondre_mail', label: '✨ Rédiger la réponse', uid: m.uid },
      ],
    }));
  }
  return items;
}

function signauxWhatsapp(radar, index, now) {
  const data = radar.whatsapp && radar.whatsapp.charge;
  if (!data || !Array.isArray(data.conversations)) return [];
  return data.conversations.map((c) => {
    const contact = index.parTel.get(sig.phoneKey(c.phone)) || null;
    const heures = heuresDepuis(c.dernier_entrant_le, now);
    const deal = (c.signaux || []).filter((s) => sig.MOTS_DEAL.includes(s));
    const importance = 1 + chaleurContact(contact) + (deal.length ? 1 : 0) + (heures >= 48 ? 1 : 0);
    const qui = contact ? avecSociete(contact) : (c.name || sig.joliTelephone(c.phone));
    const num = String(c.phone || '').replace(/\D/g, '');
    return item({
      cle: `wa:${sig.phoneKey(c.phone) || c.key}:${c.dernier_entrant_le}`, source: 'whatsapp', emoji: '💬',
      titre: `Répondre à ${qui} sur WhatsApp`,
      pourquoi: [c.excerpt ? `« ${c.excerpt} »` : 'Dernier message pas de toi', `reçu ${depuis(c.dernier_entrant_le, now)}`, deal.length ? `mots : ${deal.join(', ')}` : ''].filter(Boolean).join(' · '),
      duree: 'court', importance, urgence: Math.floor(heures / 24), date: c.dernier_entrant_le,
      contact: fiche(contact),
      actions: num ? [{ type: 'lien', label: '💬 Ouvrir WhatsApp', href: `https://wa.me/${num}` }] : [],
    });
  });
}

function signauxAppels(radar, index, now) {
  const data = radar.appels && radar.appels.charge;
  if (!data || !Array.isArray(data.manques)) return [];
  return data.manques.map((a) => {
    const contact = index.parTel.get(sig.phoneKey(a.phone)) || null;
    const heures = heuresDepuis(a.dernier_manque_le, now);
    const importance = 1 + chaleurContact(contact) + (heures >= 24 ? 1 : 0);
    const qui = contact ? avecSociete(contact) : (a.name || sig.joliTelephone(a.phone));
    return item({
      cle: `tel:${sig.phoneKey(a.phone) || a.key}:${a.dernier_manque_le}`, source: 'appel', emoji: '📞',
      titre: `Rappeler ${qui}`,
      pourquoi: `Appel manqué ${depuis(a.dernier_manque_le, now)}${a.manques > 1 ? ` · ${a.manques} appels manqués` : ''}, jamais rappelé`,
      duree: 'court', importance, urgence: Math.floor(heures / 24), date: a.dernier_manque_le,
      contact: fiche(contact),
      actions: a.phone ? [{ type: 'lien', label: '☎️ Appeler', href: `tel:${a.phone}` }] : [],
    });
  });
}

function signauxCrm(today) {
  const items = [];
  const delaiDevis = Math.max(1, Number(getSetting('journee_delai_devis')) || 5);

  // Devis envoyés sans nouvelle depuis trop longtemps : l'argent qui dort.
  const contactsAvecDevis = new Set();
  for (const d of all(`SELECT d.*, c.first_name, c.last_name, c.company, c.stage FROM deals d JOIN contacts c ON c.id = d.contact_id WHERE d.status = 'devis_envoye' AND c.archived = 0`)) {
    contactsAvecDevis.add(d.contact_id);
    const dernier = get(`SELECT MAX(day) AS j FROM activities WHERE contact_id = ? AND type IN ('relance', 'appel', 'message_envoye', 'devis_envoye', 'reponse_recue')`, d.contact_id);
    const depuisJ = joursDeRetard((dernier && dernier.j) || d.updated_at.slice(0, 10), today);
    if (depuisJ < delaiDevis) continue;
    items.push(item({
      cle: `crm:devis:${d.id}`, source: 'crm', emoji: '📄',
      titre: `Relancer le devis de ${avecSociete(d)}${d.amount ? ` (${eur(d.amount)})` : ''}`,
      pourquoi: `Devis « ${d.title || 'sans titre'} » envoyé, aucune nouvelle depuis ${depuisJ} j`,
      duree: 'court', importance: 3, urgence: Math.min(5, Math.floor(depuisJ / delaiDevis)), argent: d.amount,
      contact: fiche(d), actions: [{ type: 'contact', id: d.contact_id, label: '👤 Ouvrir la fiche' }],
    }));
  }

  // Devis acceptés jamais facturés : la facture, c'est le boss.
  for (const d of all(`SELECT d.*, c.first_name, c.last_name, c.company, c.stage FROM deals d JOIN contacts c ON c.id = d.contact_id WHERE d.status = 'accepte' AND c.archived = 0`)) {
    contactsAvecDevis.add(d.contact_id);
    const depuisJ = joursDeRetard(d.updated_at.slice(0, 10), today);
    items.push(item({
      cle: `crm:facturer:${d.id}`, source: 'crm', emoji: '💰',
      titre: `Facturer ${avecSociete(d)}${d.amount ? ` (${eur(d.amount)})` : ''}`,
      pourquoi: `Devis « ${d.title || 'sans titre'} » accepté il y a ${depuisJ} j, pas encore facturé`,
      duree: 'moyen', importance: 3, urgence: Math.min(5, depuisJ), argent: d.amount,
      contact: fiche(d), actions: [{ type: 'lien', label: '📊 Pipeline', href: '#/pipeline' }, { type: 'contact', id: d.contact_id, label: '👤 Ouvrir la fiche' }],
    }));
  }

  // RDV fait, pas de devis : le devis est à faire.
  for (const c of all(`SELECT * FROM contacts WHERE archived = 0 AND stage = 'rdv'`)) {
    if (contactsAvecDevis.has(c.id)) continue;
    if (get(`SELECT id FROM deals WHERE contact_id = ? LIMIT 1`, c.id)) continue;
    const rdv = get(`SELECT MAX(day) AS j FROM activities WHERE contact_id = ? AND type = 'rdv_pris'`, c.id);
    const depuisJ = joursDeRetard((rdv && rdv.j) || c.updated_at.slice(0, 10), today);
    items.push(item({
      cle: `crm:devis_a_faire:${c.id}`, source: 'crm', emoji: '📝',
      titre: `Faire le devis de ${avecSociete(c)}`,
      pourquoi: `RDV pris il y a ${depuisJ} j, aucun devis dans le pipeline`,
      duree: 'moyen', importance: 3, urgence: Math.min(5, Math.floor(depuisJ / 2)),
      contact: fiche(c), actions: [{ type: 'contact', id: c.id, label: '👤 Ouvrir la fiche' }],
    }));
  }

  // Relances programmées par le CRM et arrivées à échéance.
  for (const c of all(`SELECT * FROM contacts WHERE archived = 0 AND stage NOT IN ('gagne', 'perdu') AND next_action_at != '' AND next_action_at <= ? ORDER BY next_action_at`, today)) {
    if (contactsAvecDevis.has(c.id)) continue; // déjà couvert par la relance de devis
    const retard = joursDeRetard(c.next_action_at, today);
    items.push(item({
      cle: `crm:relance:${c.id}:${c.next_action_at}`, source: 'crm', emoji: '🔁',
      titre: `${c.next_action || 'Relancer'} : ${avecSociete(c)}`,
      pourquoi: retard ? `Prévu le ${c.next_action_at.slice(8, 10)}/${c.next_action_at.slice(5, 7)}, en retard de ${retard} j` : "Prévu aujourd'hui",
      duree: 'court', importance: 1 + chaleurContact(c) + (retard >= 3 ? 1 : 0), urgence: Math.min(5, retard),
      contact: fiche(c), actions: [{ type: 'contact', id: c.id, label: '👤 Ouvrir la fiche' }],
    }));
  }

  // Demandes entrantes collées dans « Réponses » et pas encore traitées.
  for (const r of all(`SELECT i.*, c.first_name, c.last_name, c.company, c.stage FROM inbox i LEFT JOIN contacts c ON c.id = i.contact_id WHERE i.status = 'nouveau' ORDER BY i.id`)) {
    const heures = heuresDepuis(r.created_at);
    items.push(item({
      cle: `crm:demande:${r.id}`, source: 'crm', emoji: '📥',
      titre: `Répondre à la demande ${r.contact_id ? `de ${avecSociete(r)}` : `(${r.source})`}`,
      pourquoi: `Reçue ${depuis(r.created_at)} : « ${String(r.content || '').slice(0, 90)}${String(r.content || '').length > 90 ? '…' : ''} »`,
      duree: 'court', importance: 2 + (heures >= 48 ? 1 : 0), urgence: Math.floor(heures / 24), date: r.created_at,
      contact: r.contact_id ? fiche(r) : null, actions: [{ type: 'lien', label: '📥 Ouvrir Réponses', href: '#/inbox' }],
    }));
  }

  // Emails de l'Autopilote qui attendent le feu vert.
  const attente = Number(get(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'awaiting_review'`).n);
  if (attente) {
    items.push(item({
      cle: `crm:outbox:${today}`, source: 'crm', emoji: '🤖',
      titre: `Valider ${attente} email${attente > 1 ? 's' : ''} de l'Autopilote`,
      pourquoi: 'Ils ne partiront pas sans ton feu vert',
      duree: 'court', importance: 2, actions: [{ type: 'lien', label: '🤖 Ouvrir l’Autopilote', href: '#/autopilot' }],
    }));
  }

  // Le post LinkedIn de la campagne de la semaine.
  const camp = campaigns.currentCampaign();
  if (camp && camp.status === 'en_cours' && !camp.posted && camp.post_draft) {
    items.push(item({
      cle: `crm:post:${camp.id}`, source: 'crm', emoji: '📣',
      titre: `Publier le post LinkedIn « ${camp.name} »`,
      pourquoi: 'Campagne de la semaine en cours, post pas encore publié',
      duree: 'moyen', importance: 2, actions: [{ type: 'lien', label: '📅 Ouvrir la campagne', href: '#/campagnes' }],
    }));
  }

  // La session d'appels du jour.
  const calls = game.callsState();
  if (calls.list.length && calls.done < calls.goal) {
    const reste = calls.goal - calls.done;
    items.push(item({
      cle: `crm:appels:${today}`, source: 'crm', emoji: '☎️',
      titre: `Session d'appels : ${reste} appel${reste > 1 ? 's' : ''} à passer`,
      pourquoi: `${calls.list.slice(0, 3).map((p) => `${p.first_name} ${p.last_name}`.trim()).filter(Boolean).join(', ')}${calls.list.length > 3 ? '…' : ''}`,
      duree: reste >= 4 ? 'moyen' : 'court', minutes: reste * 8, importance: 1, actions: [{ type: 'lien', label: '📞 Lancer la session', href: '#/chasse' }],
    }));
  }

  return items;
}

function signauxTaches(today) {
  return all(`SELECT t.*, c.first_name, c.last_name, c.company, c.stage FROM journee_taches t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.statut = 'a_faire' ORDER BY t.id`).map((t) => {
    const retard = t.echeance ? joursDeRetard(t.echeance, today) : 0;
    const aujourdhui = t.echeance === today;
    const futur = t.echeance && t.echeance > today;
    return item({
      cle: `tache:${t.id}`, source: 'tache', emoji: '🧠',
      titre: t.texte,
      pourquoi: t.echeance ? (retard ? `Prévu le ${t.echeance.slice(8, 10)}/${t.echeance.slice(5, 7)}, en retard de ${retard} j` : aujourdhui ? "Pour aujourd'hui" : `Pour le ${t.echeance.slice(8, 10)}/${t.echeance.slice(5, 7)}`) : `Ajouté ${depuis(t.created_at)}`,
      duree: t.duree, minutes: t.minutes || 0,
      importance: Math.min(3, t.importance + (retard >= 1 ? 1 : 0)),
      urgence: retard ? Math.min(5, retard + 2) : aujourdhui ? 2 : 0,
      echeance: t.echeance, date: t.created_at, futur,
      contact: t.contact_id ? fiche(t) : null,
      actions: t.contact_id ? [{ type: 'contact', id: t.contact_id, label: '👤 Ouvrir la fiche' }] : [],
      tache_id: t.id,
    });
  });
}

// ---------------------------------------------------------------- ✅ décisions
function decisions() {
  return new Map(all('SELECT * FROM journee_decisions').map((d) => [d.cle, d]));
}
function estMasque(it, decs, today) {
  const d = decs.get(it.cle);
  if (!d) return false;
  if (d.statut === 'fait' || d.statut === 'ignore') return true;
  if (d.statut === 'plus_tard') return !d.jusqu_au || d.jusqu_au > today;
  return false;
}

// Enregistre ce que Maxime a décidé pour un signal, et, quand ça a du sens,
// le compte comme une action de jeu (XP, prochaine relance programmée).
function decider(cle, statut, { jours = 1, titre = '' } = {}) {
  if (!['fait', 'plus_tard', 'ignore', 'annuler'].includes(statut)) throw new Error('Décision inconnue : fait, plus_tard, ignore ou annuler.');
  const today = localDay();
  if (statut === 'annuler') {
    run('DELETE FROM journee_decisions WHERE cle = ?', cle);
    const t = cle.match(/^tache:(\d+)$/);
    if (t) modifierTache(Number(t[1]), { statut: 'a_faire' });
    return { ok: true, cle, statut };
  }
  const jusqu = statut === 'plus_tard' ? addDays(today, Math.max(1, Number(jours) || 1)) : '';
  run('INSERT INTO journee_decisions (cle, statut, jusqu_au, titre, decide_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cle) DO UPDATE SET statut = excluded.statut, jusqu_au = excluded.jusqu_au, titre = excluded.titre, decide_le = excluded.decide_le',
    cle, statut, jusqu, String(titre || '').slice(0, 200), nowIso());

  let celebration = null;
  const t = cle.match(/^tache:(\d+)$/);
  if (t) {
    if (statut === 'fait') modifierTache(Number(t[1]), { statut: 'fait' });
    else if (statut === 'plus_tard') modifierTache(Number(t[1]), { echeance: jusqu });
    else if (statut === 'ignore') supprimerTache(Number(t[1]));
    run('DELETE FROM journee_decisions WHERE cle = ?', cle); // la tâche porte elle-même son état
  } else if (statut === 'fait') {
    // Un « fait » sur une relance ou un rappel vaut une action de jeu.
    const relance = cle.match(/^crm:relance:(\d+):/);
    const devis = cle.match(/^crm:devis:(\d+)$/);
    if (relance) celebration = game.logAction({ contact_id: Number(relance[1]), type: 'relance', note: '☀️ Fait depuis Ma journée' });
    else if (devis) {
      const d = get('SELECT contact_id FROM deals WHERE id = ?', Number(devis[1]));
      if (d) celebration = game.logAction({ contact_id: d.contact_id, deal_id: Number(devis[1]), type: 'relance', note: '☀️ Relance de devis faite depuis Ma journée' });
    }
  }
  return { ok: true, cle, statut, jusqu_au: jusqu, celebration };
}

// ---------------------------------------------------------------- 🗓️ le plan : classer et placer
function score(it) {
  return it.importance * 100 + it.urgence * 20 + Math.min(50, Math.round((it.argent || 0) / 200));
}

function placer(items) {
  const tries = [...items].sort((a, b) => score(b) - score(a));
  const blocs = { matin: [], pierre: [], apres_midi: [], plus_tard: [] };
  const MAX_MATIN = 12;
  const MAX_PIERRE = 2;
  const MAX_APRES_MIDI = 4; // au-delà, les moyennes qui ne pressent pas attendent

  for (const it of tries) {
    const calme = it.importance === 1 && it.urgence === 0;
    if (it.futur && !it.urgence && it.importance < 3) { blocs.plus_tard.push(it); continue; }
    if (it.duree === 'court') {
      if (blocs.matin.length < MAX_MATIN || !calme) blocs.matin.push(it);
      else blocs.plus_tard.push(it);
    } else if (it.duree === 'long') {
      if (it.importance >= 2 && blocs.pierre.length < MAX_PIERRE) blocs.pierre.push(it);
      else if (it.importance >= 2 || it.urgence) blocs.apres_midi.push(it);
      else blocs.plus_tard.push(it);
    } else if (calme && blocs.apres_midi.length >= MAX_APRES_MIDI) blocs.plus_tard.push(it);
    else blocs.apres_midi.push(it);
  }
  // Trop de courtes pour un matin ? Les moins importantes glissent.
  if (blocs.matin.length > MAX_MATIN) {
    const garde = blocs.matin.slice(0, MAX_MATIN);
    blocs.plus_tard.unshift(...blocs.matin.slice(MAX_MATIN));
    blocs.matin = garde;
  }
  return blocs;
}

function plan({ now = new Date() } = {}) {
  const today = localDay(now);
  const nowMs = now.getTime();
  const radar = lireRadar();
  const index = indexCrm();
  const decs = decisions();

  const bruts = [
    ...signauxGmail(radar, index, nowMs),
    ...signauxWhatsapp(radar, index, nowMs),
    ...signauxAppels(radar, index, nowMs),
    ...signauxCrm(today),
    ...signauxTaches(today),
  ];
  const visibles = bruts.filter((it) => !estMasque(it, decs, today));
  const blocs = placer(visibles);

  const minutes = {};
  for (const [k, liste] of Object.entries(blocs)) minutes[k] = liste.reduce((s, it) => s + (it.minutes || 0), 0);
  const argent = visibles.reduce((s, it) => s + (it.argent || 0), 0);
  const parSource = {};
  for (const it of visibles) parSource[it.source] = (parSource[it.source] || 0) + 1;

  const sources = {};
  for (const src of ['gmail', 'whatsapp', 'appels']) {
    const r = radar[src];
    sources[src] = { lu_le: r ? r.lu_le : '', erreur: r ? r.erreur : '', branche: !!(r && r.charge), via: r && r.charge ? r.charge.via || '' : '' };
  }

  const faits = all(`SELECT cle, titre, statut, decide_le FROM journee_decisions WHERE statut = 'fait' AND decide_le >= ? ORDER BY decide_le DESC`, `${today}T00:00:00`).length
    + Number(get(`SELECT COUNT(*) AS n FROM journee_taches WHERE statut = 'fait' AND fait_le >= ?`, `${today}T00:00:00`).n);

  return {
    jour: today,
    jour_long: dateLongue(today),
    blocs, minutes, argent, total: visibles.length, par_source: parSource,
    vitaux: visibles.filter((it) => it.importance === 3).length,
    faits_aujourdhui: faits,
    sources,
    vocabulaire: { durees: DUREES, importances: IMPORTANCES, blocs: BLOCS },
  };
}

// ---------------------------------------------------------------- ☀️ le brief du matin
function listeCourte(liste, max = 3) {
  const noms = liste.slice(0, max).map((it) => it.titre.replace(/^Répondre à /, 'répondre à ').replace(/^Rappeler /, 'rappeler ').replace(/^Relancer /, 'relancer ').replace(/^Faire /, 'faire ').replace(/^Facturer /, 'facturer ').replace(/^Publier /, 'publier ').replace(/^Valider /, 'valider '));
  const reste = liste.length - noms.length;
  return noms.join(', ') + (reste > 0 ? ` et ${reste} autre${reste > 1 ? 's' : ''}` : '');
}

function texteBrief(p) {
  const b = p.blocs;
  const lignes = [];
  const total = p.total;
  if (!total) {
    lignes.push(`☀️ ${p.jour_long}. Rien qui attend : boîte vide, WhatsApp à jour, CRM calme.`);
    lignes.push("C'est le moment d'aller provoquer des réponses : Mode Chasse.");
    return lignes.join('\n');
  }
  const argent = p.argent ? `, ${eur(p.argent)} en jeu` : '';
  lignes.push(`☀️ ${p.jour_long}. ${total} chose${total > 1 ? 's' : ''} à faire${p.vitaux ? `, dont ${p.vitaux} vitale${p.vitaux > 1 ? 's' : ''}` : ''}${argent}.`);
  if (b.matin.length) lignes.push(`⚡ Ce matin (≈ ${dureeTexte(p.minutes.matin)}) : ${listeCourte(b.matin, 4)}.`);
  if (b.pierre.length) lignes.push(`🏔️ La grosse pierre : ${listeCourte(b.pierre, 2)} (≈ ${dureeTexte(p.minutes.pierre)}).`);
  if (b.apres_midi.length) lignes.push(`🧱 Cet après-midi : ${listeCourte(b.apres_midi, 3)} (≈ ${dureeTexte(p.minutes.apres_midi)}).`);
  if (b.plus_tard.length) lignes.push(`💤 Peut attendre : ${b.plus_tard.length} chose${b.plus_tard.length > 1 ? 's' : ''}.`);
  const muettes = ['gmail', 'whatsapp', 'appels'].filter((s) => !p.sources[s].branche);
  if (muettes.length) lignes.push(`(Sources pas lues : ${muettes.join(', ')}. Vérifie les Réglages ou lance le pont sur le Mac.)`);
  return lignes.join('\n');
}

function mailBrief(p) {
  const lignes = [texteBrief(p), ''];
  for (const code of ['matin', 'pierre', 'apres_midi', 'plus_tard']) {
    const liste = p.blocs[code];
    if (!liste.length) continue;
    lignes.push(`${BLOCS[code].emoji} ${BLOCS[code].titre.toUpperCase()}`);
    for (const it of liste) {
      lignes.push(`  ${IMPORTANCES[it.importance].emoji} ${it.emoji} ${it.titre} · ${dureeTexte(it.minutes)}`);
      if (it.pourquoi) lignes.push(`     ${it.pourquoi}`);
    }
    lignes.push('');
  }
  lignes.push('Coche, remets à plus tard ou ignore chaque ligne dans OTEA Moteur → ☀️ Ma journée.');
  return {
    subject: `☀️ Ta journée du ${p.jour_long} : ${p.total} chose${p.total > 1 ? 's' : ''}${p.vitaux ? `, ${p.vitaux} vitale${p.vitaux > 1 ? 's' : ''}` : ''}`,
    body: lignes.join('\n'),
  };
}

// Calcule le brief du jour, le mémorise, et l'envoie par mail si demandé.
async function briefDuMatin({ envoyer = getSetting('journee_brief_mail') === '1', force = false, now = new Date() } = {}) {
  const today = localDay(now);
  const existant = get('SELECT * FROM journee_briefs WHERE jour = ?', today);
  if (existant && !force) return { deja_fait: true, jour: today, envoye: !!existant.envoye_le };

  const p = plan({ now });
  const texte = texteBrief(p);
  const charge = { texte, plan: { total: p.total, vitaux: p.vitaux, argent: p.argent, minutes: p.minutes, titres: Object.fromEntries(Object.entries(p.blocs).map(([k, l]) => [k, l.map((it) => it.titre)])) } };
  run('INSERT INTO journee_briefs (jour, charge, envoye_le, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(jour) DO UPDATE SET charge = excluded.charge, created_at = excluded.created_at',
    today, JSON.stringify(charge), '', nowIso());

  let envoye = false;
  let erreur = '';
  if (envoyer && autopilot.isConfigured()) {
    try {
      const cfg = autopilot.mailCfg();
      const m = mailBrief(p);
      await smtp.sendMail({ ...cfg.smtp, from: cfg.from, fromName: 'OTEA Moteur', to: cfg.from, subject: m.subject, body: m.body });
      run('UPDATE journee_briefs SET envoye_le = ? WHERE jour = ?', nowIso(), today);
      envoye = true;
    } catch (e) { erreur = e.message; }
  }
  setSetting('journee_dernier_brief', today);
  return { jour: today, texte, total: p.total, envoye, erreur };
}

function briefDuJour(now = new Date()) {
  const row = get('SELECT * FROM journee_briefs WHERE jour = ?', localDay(now));
  if (!row) return null;
  try { return { ...JSON.parse(row.charge), jour: row.jour, envoye_le: row.envoye_le }; } catch { return null; }
}

// ---------------------------------------------------------------- ✨ répondre à un mail depuis la journée
async function preparerReponseMail(uid, { instructions = '' } = {}) {
  const cfg = autopilot.mailCfg();
  const msg = await imap.lireMessageTexte(cfg.imap, uid);
  const contact = msg.from && msg.from.email ? get(`SELECT * FROM contacts WHERE email = ? AND archived = 0`, msg.from.email) : null;
  const recu = `De : ${msg.from.name ? `${msg.from.name} <${msg.from.email}>` : msg.from.email}\nObjet : ${msg.subject}\n\n${msg.texte}`;
  const brouillon = await claude.draft({ contact, purpose: 'reponse_demande', incoming_text: recu, instructions });
  return {
    uid: Number(uid), from: msg.from, subject: msg.subject, message_id: msg.message_id, texte_recu: msg.texte,
    contact: fiche(contact),
    // L'objet reste celui du fil : c'est lui qui garde la réponse dans la même conversation Gmail.
    brouillon: { subject: msg.subject && !/^re\s*:/i.test(msg.subject) ? `Re: ${msg.subject}` : (msg.subject || brouillon.subject || ''), body: brouillon.body, source: brouillon.source },
  };
}

async function envoyerReponseMail({ uid, to, subject, body, message_id, cle }) {
  if (!to) throw new Error('Destinataire manquant.');
  if (!String(body || '').trim()) throw new Error('Le message est vide.');
  const cfg = autopilot.mailCfg();
  const { messageId } = await smtp.sendMail({
    ...cfg.smtp, from: cfg.from, fromName: getSetting('user_name') || cfg.fromName,
    to, subject: subject || '(sans objet)', body,
    inReplyTo: message_id || undefined, references: message_id ? [message_id] : undefined,
  });
  const contact = get(`SELECT * FROM contacts WHERE email = ? AND archived = 0`, String(to).toLowerCase());
  let celebration = null;
  if (contact) {
    run(`INSERT INTO outbox (contact_id, step_index, to_email, subject, body, status, sent_at, message_id, day, created_at) VALUES (?, 0, ?, ?, ?, 'sent', ?, ?, ?, ?)`,
      contact.id, to, subject || '', body, nowIso(), messageId, localDay(), nowIso());
    celebration = game.logAction({ contact_id: contact.id, type: 'reponse_envoyee', note: `☀️ Réponse envoyée depuis Ma journée : « ${String(subject || '').slice(0, 60)} »` });
  }
  if (cle) decider(cle, 'fait', { titre: subject });
  return { ok: true, message_id: messageId, celebration };
}

// ---------------------------------------------------------------- 🔁 la boucle de fond
// Appelée régulièrement par le serveur : relit les sources quand elles datent,
// et fabrique le brief une fois par jour, à l'heure choisie.
let enCours = false;
async function boucle({ now = new Date(), fraicheurMin = 15 } = {}) {
  if (enCours) return { occupe: true };
  enCours = true;
  try {
    const out = {};
    const radar = lireRadar();
    const plusVieux = Math.min(...['gmail', 'whatsapp', 'appels'].map((s) => (radar[s] && radar[s].lu_le ? Date.parse(radar[s].lu_le) : 0)));
    if (!plusVieux || now.getTime() - plusVieux > fraicheurMin * 60000) out.radar = await rafraichir();

    const today = localDay(now);
    const [hh, mm] = String(getSetting('journee_brief_heure') || '08:00').split(':').map(Number);
    const heureAtteinte = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= (mm || 0));
    if (heureAtteinte && getSetting('journee_dernier_brief') !== today) out.brief = await briefDuMatin({ now });
    return out;
  } finally {
    enCours = false;
  }
}

module.exports = {
  DUREES, IMPORTANCES, BLOCS, MOTS_LONG, MOTS_MOYEN, MOTS_COURT, MOTS_VITAL, BRUIT_MAIL,
  analyserTexte, ajouterTache, modifierTache, supprimerTache,
  rafraichir, lireRadar, ecrireRadar, filtrerWhatsapp, filtrerAppels,
  signauxGmail, signauxWhatsapp, signauxAppels, signauxCrm, signauxTaches,
  decider, decisions, placer, plan, score,
  texteBrief, mailBrief, briefDuMatin, briefDuJour,
  preparerReponseMail, envoyerReponseMail,
  boucle, depuis, dateLongue, dureeTexte,
};
