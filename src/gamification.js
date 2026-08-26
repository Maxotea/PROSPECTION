'use strict';
// Moteur de gamification : XP, niveaux, quêtes du jour, streak, badges, boss final.
// Toute l'XP est serveur-autoritaire : chaque action loggée = une ligne activities avec son XP.

const dbApi = require('./db');
const { get, all, run, nowIso, localDay, addDays, getSetting } = dbApi;
const playbooks = require('./playbooks');

// ---------------------------------------------------------------- actions & XP
const ACTIONS = {
  note: { xp: 2, label: 'Note ajoutée', effort: false, emoji: '📝' },
  import: { xp: 0, label: 'Import de contacts', effort: false, emoji: '📦' },
  enrich: { xp: 0, label: 'Enrichissement', effort: false, emoji: '🧪' },
  stage_change: { xp: 5, label: 'Étape mise à jour', effort: false, emoji: '🔀' },
  connexion_linkedin: { xp: 5, label: 'Connexion LinkedIn envoyée', effort: true, emoji: '🔗' },
  message_envoye: { xp: 10, label: 'Message envoyé', effort: true, emoji: '📤' },
  relance: { xp: 12, label: 'Relance envoyée', effort: true, emoji: '🔁' },
  appel: { xp: 15, label: 'Appel passé', effort: true, emoji: '📞' },
  reponse_envoyee: { xp: 15, label: 'Réponse à une demande', effort: true, emoji: '📥' },
  reponse_recue: { xp: 25, label: 'Réponse reçue', effort: true, emoji: '💬' },
  rdv_pris: { xp: 50, label: 'RDV pris', effort: true, emoji: '📅' },
  devis_envoye: { xp: 75, label: 'Devis envoyé', effort: true, emoji: '📄' },
  devis_accepte: { xp: 100, label: 'Devis accepté', effort: true, emoji: '🤝' },
  facture: { xp: 250, label: 'FACTURE ÉMISE 💰', effort: true, emoji: '💰' },
  disqualifie: { xp: 3, label: 'Prospect disqualifié', effort: false, emoji: '🪦' },
  quest_bonus: { xp: 0, label: 'Quête accomplie', effort: false, emoji: '✅' },
  badge_bonus: { xp: 0, label: 'Badge débloqué', effort: false, emoji: '🏅' },
};

// Certaines actions font avancer automatiquement le pipeline.
const STAGE_ON_ACTION = {
  connexion_linkedin: { from: ['a_contacter'], to: 'contacte' },
  message_envoye: { from: ['a_contacter'], to: 'contacte' },
  reponse_recue: { from: ['a_contacter', 'contacte'], to: 'en_discussion' },
  rdv_pris: { from: ['a_contacter', 'contacte', 'en_discussion'], to: 'rdv' },
  devis_envoye: { from: ['a_contacter', 'contacte', 'en_discussion', 'rdv'], to: 'devis_envoye' },
  devis_accepte: { from: ['a_contacter', 'contacte', 'en_discussion', 'rdv', 'devis_envoye', 'negociation'], to: 'gagne' },
  facture: { from: ['a_contacter', 'contacte', 'en_discussion', 'rdv', 'devis_envoye', 'negociation'], to: 'gagne' },
  disqualifie: { from: null, to: 'perdu' },
};

const EFFORT_TYPES = Object.keys(ACTIONS).filter((k) => ACTIONS[k].effort);
const TOUCH_TYPES = ['connexion_linkedin', 'message_envoye', 'relance', 'appel', 'reponse_envoyee'];

// ---------------------------------------------------------------- niveaux
const LEVELS = [
  { xp: 0, title: 'Stagiaire du câble' },
  { xp: 100, title: 'Assistant de prod' },
  { xp: 250, title: 'Cadreur de leads' },
  { xp: 500, title: 'Preneur de son (et de RDV)' },
  { xp: 900, title: 'Monteur de pipeline' },
  { xp: 1500, title: 'Chef opérateur' },
  { xp: 2400, title: 'Réalisateur de deals' },
  { xp: 3600, title: 'Directeur de production' },
  { xp: 5200, title: 'Showrunner' },
  { xp: 7500, title: 'Producteur exécutif' },
  { xp: 10500, title: 'Mogul du game' },
  { xp: 14500, title: "Légende d'OTEA" },
];

function levelForXp(xp) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) idx = i;
  const current = LEVELS[idx];
  const next = LEVELS[idx + 1] || null;
  return {
    level: idx + 1,
    title: current.title,
    xp,
    floor: current.xp,
    next_at: next ? next.xp : null,
    progress: next ? (xp - current.xp) / (next.xp - current.xp) : 1,
  };
}

function totalXp() {
  const row = get('SELECT COALESCE(SUM(xp), 0) AS s FROM activities');
  return row ? Number(row.s) : 0;
}

// ---------------------------------------------------------------- streak
// Jours consécutifs avec au moins une action "effort". Week-end clément :
// un samedi/dimanche sans action ne casse pas la série.
function computeStreak() {
  const days = new Set(
    all(`SELECT DISTINCT day FROM activities WHERE type IN (${EFFORT_TYPES.map(() => '?').join(',')})`, ...EFFORT_TYPES).map((r) => r.day)
  );
  const today = localDay();
  let streak = 0;
  let d = today;
  const aliveToday = days.has(today);
  if (!aliveToday) d = addDays(today, -1); // la série d'hier reste "vivante" jusqu'à ce soir
  for (let i = 0; i < 730; i++) {
    if (days.has(d)) { streak++; d = addDays(d, -1); continue; }
    const [y, m, j] = d.split('-').map(Number);
    const dow = new Date(y, m - 1, j).getDay();
    if (dow === 0 || dow === 6) { d = addDays(d, -1); continue; } // week-end toléré
    break;
  }
  return { current: streak, alive_today: aliveToday };
}

// ---------------------------------------------------------------- quêtes du jour
const QUEST_POOL = [
  { code: 'q_contact_5', label: 'Contacter 5 prospects', emoji: '🎯', target: 5, bonus: 30, types: ['message_envoye', 'connexion_linkedin'] },
  { code: 'q_relance_5', label: 'Envoyer 5 relances', emoji: '🔁', target: 5, bonus: 30, types: ['relance'] },
  { code: 'q_appel_2', label: 'Passer 2 appels', emoji: '📞', target: 2, bonus: 35, types: ['appel'] },
  { code: 'q_reponse_1', label: 'Obtenir 1 réponse', emoji: '💬', target: 1, bonus: 40, types: ['reponse_recue'] },
  { code: 'q_ancien_3', label: 'Recontacter 3 anciens clients', emoji: '🔮', target: 3, bonus: 40, types: TOUCH_TYPES, filter: 'former' },
  { code: 'q_grand_1', label: 'Toucher 1 grand compte', emoji: '🐘', target: 1, bonus: 30, types: TOUCH_TYPES, filter: 'grand_compte' },
  { code: 'q_devis_1', label: 'Envoyer 1 devis', emoji: '📄', target: 1, bonus: 50, types: ['devis_envoye'] },
  { code: 'q_pipeline_3', label: "Faire avancer 3 prospects d'étape", emoji: '🔀', target: 3, bonus: 25, types: ['stage_change', 'reponse_recue', 'rdv_pris', 'devis_envoye'] },
];

// Sélection déterministe : la quête "contact" tous les jours + 2 qui tournent selon la date.
function questsForDay(day) {
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rest = QUEST_POOL.filter((q) => q.code !== 'q_contact_5');
  const a = h % rest.length;
  const b = (a + 1 + (Math.floor(h / 7) % (rest.length - 1))) % rest.length;
  return [QUEST_POOL[0], rest[a], rest[b === a ? (a + 1) % rest.length : b]];
}

function questProgress(quest, day) {
  const placeholders = quest.types.map(() => '?').join(',');
  let sql = `SELECT COUNT(*) AS n FROM activities a WHERE a.day = ? AND a.type IN (${placeholders})`;
  if (quest.filter === 'former') {
    sql = `SELECT COUNT(*) AS n FROM activities a JOIN contacts c ON c.id = a.contact_id
           WHERE a.day = ? AND a.type IN (${placeholders}) AND c.is_former_client = 1`;
  } else if (quest.filter === 'grand_compte') {
    sql = `SELECT COUNT(*) AS n FROM activities a JOIN contacts c ON c.id = a.contact_id
           WHERE a.day = ? AND a.type IN (${placeholders}) AND c.segment = 'grand_compte'`;
  }
  const row = get(sql, day, ...quest.types);
  return Math.min(Number(row.n), quest.target);
}

function todayQuests() {
  const day = localDay();
  return questsForDay(day).map((base) => {
    let q = { ...base };
    if (q.code === 'q_appel_2') {
      // La quête d'appels suit l'objectif quotidien réglable.
      const goal = Math.max(1, Number(getSetting('objectif_appels_jour') || 5));
      q = { ...q, target: goal, label: `Passer ${goal} appel${goal > 1 ? 's' : ''}`, bonus: 15 + goal * 5 };
    }
    const progress = questProgress(q, day);
    const awarded = !!get('SELECT 1 AS x FROM quest_awards WHERE day = ? AND code = ?', day, q.code);
    return { ...q, progress, done: progress >= q.target, awarded };
  });
}

// Attribue les bonus des quêtes qui viennent d'être terminées. Retourne les nouvelles complétées.
function awardQuests() {
  const day = localDay();
  const completed = [];
  for (const q of todayQuests()) {
    if (q.done && !q.awarded) {
      run('INSERT OR IGNORE INTO quest_awards (day, code) VALUES (?, ?)', day, q.code);
      insertActivity({ type: 'quest_bonus', xp: q.bonus, note: `${q.emoji} ${q.label}`, meta: { quest: q.code } });
      completed.push(q);
    }
  }
  return completed;
}

// ---------------------------------------------------------------- badges
const BADGES = [
  { code: 'premier_sang', name: 'Premier contact', emoji: '🗡️', xp: 30, desc: 'Envoyer ton premier message de prospection' },
  { code: 'pillard', name: 'Pillard de données', emoji: '📦', xp: 30, desc: 'Importer 20 contacts ou plus' },
  { code: 'alchimiste', name: 'Alchimiste', emoji: '🧪', xp: 40, desc: 'Premier enrichissement FullEnrich réussi' },
  { code: 'necromancien', name: 'Nécromancien', emoji: '🔮', xp: 60, desc: "Faire répondre un ancien client (réactivation)" },
  { code: 'premier_devis', name: 'Premier devis', emoji: '📄', xp: 50, desc: 'Envoyer ton premier devis' },
  { code: 'premiere_facture', name: 'Première facture', emoji: '💰', xp: 100, desc: 'Émettre ta première facture' },
  { code: 'gros_gibier', name: 'Chasseur de gros gibier', emoji: '🐘', xp: 80, desc: 'Décrocher un RDV avec un grand compte' },
  { code: 'cardio', name: 'Cardio', emoji: '🏃', xp: 40, desc: 'Contacter 10 prospects B2C / événementiel' },
  { code: 'machine', name: 'Machine de guerre', emoji: '⚙️', xp: 80, desc: 'Envoyer 50 messages au total' },
  { code: 'semaine_parfaite', name: 'Semaine parfaite', emoji: '🔥', xp: 100, desc: '7 jours de streak' },
  { code: 'boss_final', name: 'BOSS VAINCU', emoji: '🏆', xp: 500, desc: "L'objectif : 5 factures déclenchées" },
];

function hasBadge(code) { return !!get('SELECT 1 AS x FROM badges WHERE code = ?', code); }

function checkBadges() {
  const won = [];
  const award = (code) => {
    if (hasBadge(code)) return;
    const b = BADGES.find((x) => x.code === code);
    run('INSERT OR IGNORE INTO badges (code, awarded_at) VALUES (?, ?)', code, nowIso());
    insertActivity({ type: 'badge_bonus', xp: b.xp, note: `${b.emoji} Badge : ${b.name}`, meta: { badge: code } });
    won.push(b);
  };
  const count = (sql, ...p) => Number(get(sql, ...p).n);

  if (count(`SELECT COUNT(*) AS n FROM activities WHERE type IN ('message_envoye','connexion_linkedin')`) >= 1) award('premier_sang');
  if (count(`SELECT COALESCE(SUM(json_extract(meta,'$.count')),0) AS n FROM activities WHERE type = 'import'`) >= 20) award('pillard');
  if (count(`SELECT COUNT(*) AS n FROM activities WHERE type = 'enrich'`) >= 1) award('alchimiste');
  if (count(`SELECT COUNT(*) AS n FROM activities a JOIN contacts c ON c.id = a.contact_id WHERE a.type = 'reponse_recue' AND c.is_former_client = 1`) >= 1) award('necromancien');
  if (count(`SELECT COUNT(*) AS n FROM activities WHERE type = 'devis_envoye'`) >= 1) award('premier_devis');
  if (count(`SELECT COUNT(*) AS n FROM deals WHERE status = 'facture'`) >= 1) award('premiere_facture');
  if (count(`SELECT COUNT(*) AS n FROM activities a JOIN contacts c ON c.id = a.contact_id WHERE a.type = 'rdv_pris' AND c.segment = 'grand_compte'`) >= 1) award('gros_gibier');
  if (count(`SELECT COUNT(DISTINCT a.contact_id) AS n FROM activities a JOIN contacts c ON c.id = a.contact_id WHERE a.type IN (${TOUCH_TYPES.map(() => '?').join(',')}) AND c.segment = 'b2c_event'`, ...TOUCH_TYPES) >= 10) award('cardio');
  if (count(`SELECT COUNT(*) AS n FROM activities WHERE type IN ('message_envoye','relance')`) >= 50) award('machine');
  if (computeStreak().current >= 7) award('semaine_parfaite');
  if (count(`SELECT COUNT(*) AS n FROM deals WHERE status = 'facture'`) >= Number(getSetting('objectif_factures') || 5)) award('boss_final');

  return won;
}

// ---------------------------------------------------------------- log d'activité
function insertActivity({ contact_id = null, deal_id = null, type, note = '', xp = null, meta = {} }) {
  const def = ACTIONS[type] || { xp: 0 };
  const finalXp = xp === null || xp === undefined ? def.xp : xp;
  const { lastId } = run(
    'INSERT INTO activities (contact_id, deal_id, type, note, xp, meta, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    contact_id, deal_id, type, note, finalXp, JSON.stringify(meta || {}), localDay(), nowIso()
  );
  return { id: lastId, xp: finalXp };
}

// Point d'entrée principal : logge une action utilisateur, met à jour le contact
// (étape, prochaine relance), attribue quêtes/badges, et renvoie tout ce que
// le front doit célébrer.
function logAction({ contact_id = null, deal_id = null, type, note = '', meta = {} }) {
  if (!ACTIONS[type]) throw new Error(`Type d'action inconnu : ${type}`);
  const xpBefore = totalXp();
  const levelBefore = levelForXp(xpBefore).level;

  let contact = contact_id ? get('SELECT * FROM contacts WHERE id = ?', contact_id) : null;

  const act = insertActivity({ contact_id, deal_id, type, note, meta });

  if (contact) {
    const patch = {};
    const trans = STAGE_ON_ACTION[type];
    if (trans && (trans.from === null || trans.from.includes(contact.stage))) {
      if (contact.stage !== trans.to) {
        patch.stage = trans.to;
        insertActivity({ contact_id, type: 'stage_change', xp: 0, note: `→ ${trans.to}`, meta: { auto: true, from: contact.stage, to: trans.to } });
      }
    }
    if (ACTIONS[type].effort) patch.last_touch_at = nowIso();

    const touches = Number(get(`SELECT COUNT(*) AS n FROM activities WHERE contact_id = ? AND type IN (${TOUCH_TYPES.map(() => '?').join(',')})`, contact_id, ...TOUCH_TYPES).n);
    const merged = { ...contact, ...patch };
    const next = playbooks.nextStepAfter(merged, type, touches, dbApi);
    if (next) { patch.next_action = next.next_action; patch.next_action_at = next.next_action_at; }
    if (Object.keys(patch).length) contact = dbApi.updateContact(contact_id, patch);
  }

  const quests_completed = awardQuests();
  const badges_won = checkBadges();

  const xpAfter = totalXp();
  const levelAfter = levelForXp(xpAfter);
  return {
    activity_id: act.id,
    xp_gained: xpAfter - xpBefore,
    xp_total: xpAfter,
    level: levelAfter,
    level_up: levelAfter.level > levelBefore ? levelAfter : null,
    quests_completed,
    badges_won,
    contact,
    boss: bossState(),
  };
}

// ---------------------------------------------------------------- boss & état global
function bossState() {
  const goal = Number(getSetting('objectif_factures') || 5);
  const row = get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM deals WHERE status = 'facture'`);
  return { goal, count: Number(row.n), revenue: Number(row.total), done: Number(row.n) >= goal };
}

function weeklyXp() {
  const days = [];
  const today = localDay();
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const row = get('SELECT COALESCE(SUM(xp), 0) AS s FROM activities WHERE day = ?', d);
    days.push({ day: d, xp: Number(row.s) });
  }
  return days;
}

function kpis() {
  const today = localDay();
  const n = (sql, ...p) => Number(get(sql, ...p).n);
  return {
    a_contacter: n(`SELECT COUNT(*) AS n FROM contacts WHERE archived = 0 AND stage = 'a_contacter'`),
    relances_dues: n(`SELECT COUNT(*) AS n FROM contacts WHERE archived = 0 AND stage NOT IN ('gagne','perdu') AND next_action_at != '' AND next_action_at <= ?`, today),
    en_discussion: n(`SELECT COUNT(*) AS n FROM contacts WHERE archived = 0 AND stage IN ('en_discussion','rdv')`),
    devis_en_cours: n(`SELECT COUNT(*) AS n FROM deals WHERE status IN ('devis_envoye','accepte')`),
    reponses_semaine: n(`SELECT COUNT(*) AS n FROM activities WHERE type = 'reponse_recue' AND day >= ?`, addDays(today, -6)),
    contacts_total: n(`SELECT COUNT(*) AS n FROM contacts WHERE archived = 0`),
    ca_facture: Number(get(`SELECT COALESCE(SUM(amount), 0) AS n FROM deals WHERE status = 'facture'`).n),
    ca_pipeline: Number(get(`SELECT COALESCE(SUM(amount), 0) AS n FROM deals WHERE status IN ('devis_envoye','accepte')`).n),
  };
}

function pipelineCounts() {
  const rows = all(`SELECT stage, COUNT(*) AS n FROM contacts WHERE archived = 0 GROUP BY stage`);
  const map = {};
  for (const r of rows) map[r.stage] = Number(r.n);
  return playbooks.STAGES.map((s) => ({ ...s, count: map[s.code] || 0 }));
}

function fullState() {
  const xp = totalXp();
  return {
    xp_total: xp,
    level: levelForXp(xp),
    streak: computeStreak(),
    quests: todayQuests(),
    boss: bossState(),
    kpis: kpis(),
    weekly_xp: weeklyXp(),
    pipeline: pipelineCounts(),
    badges: BADGES.map((b) => {
      const row = get('SELECT awarded_at FROM badges WHERE code = ?', b.code);
      return { ...b, won: !!row, awarded_at: row ? row.awarded_at : null };
    }),
    calls: callsState(),
    segments: playbooks.SEGMENTS,
    stages: playbooks.STAGES,
    actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, { label: v.label, xp: v.xp, emoji: v.emoji }])),
  };
}

// Score de priorité d'un prospect pour la file du Mode Chasse.
function contactScore(c) {
  let s = 0;
  if (c.is_former_client) s += 30;
  if (c.email) s += 15;
  if (c.email_status === 'valid') s += 5;
  if (c.phone) s += 10;
  if (c.segment === 'grand_compte') s += 15;
  else if (c.segment === 'pme') s += 8;
  else if (c.segment === 'b2c_event') s += 6;
  if (c.stage === 'en_discussion') s += 25;
  if (c.stage === 'rdv') s += 30;
  if (c.stage === 'devis_envoye' || c.stage === 'negociation') s += 35;
  if (c.revenue_history > 0) s += Math.min(20, Math.round(c.revenue_history / 500));
  return s;
}

// File du Mode Chasse : les actions dues aujourd'hui, puis les jamais-contactés, triés par score.
function huntQueue(limit = 15) {
  const today = localDay();
  // Les contacts en séquence Autopilote active sont exclus : la machine s'en occupe.
  const due = all(
    `SELECT * FROM contacts WHERE archived = 0 AND stage NOT IN ('gagne','perdu')
     AND ((next_action_at != '' AND next_action_at <= ?) OR (next_action_at = '' AND stage = 'a_contacter'))
     AND id NOT IN (SELECT contact_id FROM enrollments WHERE status = 'active')`,
    today
  );
  const scored = due.map((c) => ({ ...c, score: contactScore(c) }));
  scored.sort((a, b) => b.score - a.score || String(a.last_touch_at).localeCompare(String(b.last_touch_at)));
  const touchesStmt = `SELECT COUNT(*) AS n FROM activities WHERE contact_id = ? AND type IN (${TOUCH_TYPES.map(() => '?').join(',')})`;
  return scored.slice(0, limit).map((c) => {
    const touches = Number(get(touchesStmt, c.id, ...TOUCH_TYPES).n);
    return { ...c, touches, suggested_template: playbooks.suggestedTemplateCode(c, touches) };
  });
}

// File d'appels du jour : contacts joignables par téléphone, priorisés
// (discussions chaudes et devis d'abord), pas encore appelés aujourd'hui.
function callQueue(limit = 10) {
  const today = localDay();
  const called = new Set(all(`SELECT DISTINCT contact_id FROM activities WHERE type = 'appel' AND day = ?`, today).map((r) => r.contact_id));
  const rows = all(`SELECT * FROM contacts WHERE archived = 0 AND phone != '' AND stage NOT IN ('gagne','perdu')`);
  const scored = rows
    .filter((c) => !called.has(c.id))
    .map((c) => ({ ...c, score: contactScore(c) + (['en_discussion', 'rdv', 'devis_envoye', 'negociation'].includes(c.stage) ? 15 : 0) }));
  scored.sort((a, b) => b.score - a.score || String(a.last_touch_at).localeCompare(String(b.last_touch_at)));
  const touchesStmt = `SELECT COUNT(*) AS n FROM activities WHERE contact_id = ? AND type IN (${TOUCH_TYPES.map(() => '?').join(',')})`;
  return scored.slice(0, limit).map((c) => {
    const touches = Number(get(touchesStmt, c.id, ...TOUCH_TYPES).n);
    return { ...c, touches, suggested_template: playbooks.suggestedTemplateCode(c, touches) };
  });
}

function callsState() {
  const goal = Math.max(1, Number(getSetting('objectif_appels_jour') || 5));
  const done = Number(get(`SELECT COUNT(*) AS n FROM activities WHERE type = 'appel' AND day = ?`, localDay()).n);
  return {
    goal, done,
    list: callQueue(goal).map((c) => ({
      id: c.id, first_name: c.first_name, last_name: c.last_name, company: c.company,
      phone: c.phone, stage: c.stage, is_former_client: c.is_former_client, segment: c.segment,
    })),
  };
}

module.exports = {
  ACTIONS, BADGES, LEVELS, TOUCH_TYPES, EFFORT_TYPES,
  logAction, insertActivity, checkBadges, awardQuests,
  totalXp, levelForXp, computeStreak, todayQuests, bossState, weeklyXp, kpis, fullState, huntQueue, contactScore,
  callQueue, callsState,
};
