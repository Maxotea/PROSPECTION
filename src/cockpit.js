'use strict';
// 🧭 Le Cockpit : tout ce qui se passe, en un seul écran.
//
// Un seul appel (`etat()`) rassemble ce que le Quartier général, Ma journée,
// le Pipeline et l'Autopilote savent chacun de leur côté, dans l'ordre qui
// compte pour la trésorerie : d'abord l'argent le plus proche (devis acceptés
// pas facturés), puis les devis qui attendent une réponse, puis les devis
// promis mais pas faits, enfin la prospection. C'est l'écran qui reste
// affiché sur l'iMac toute la journée, et qu'on ouvre sur le téléphone pour
// savoir où on en est sans naviguer.
//
// Tout est calculé à la demande, en lecture seule, à partir de la base :
// rien n'est stocké, rien n'est inventé. Un chiffre absent vaut 0, pas une
// estimation.

const { get, all, getSetting, localDay, addDays } = require('./db');
const game = require('./gamification');
const journee = require('./journee');
const autopilot = require('./autopilot');
const campaigns = require('./campaigns');
const playbooks = require('./playbooks');

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const STAGES_CHAUDS = ['en_discussion', 'rdv', 'devis_envoye', 'negociation'];

function joursEntre(a, b) {
  if (!a || !b) return 0;
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
function nomContact(c) {
  return `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || c.company || 'Contact';
}
function moisDe(iso) { return String(iso || '').slice(0, 7); }
function libelleMois(mois) {
  const [a, m] = mois.split('-').map(Number);
  return { court: MOIS_COURTS[m - 1] || mois, annee: a };
}
function nombre(v, defaut) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : defaut;
}

// ---------------------------------------------------------------- 💰 l'argent le plus proche
function argent(today) {
  const delaiDevis = Math.max(1, Number(getSetting('journee_delai_devis')) || 5);

  // Devis acceptés, pas encore facturés : la facture est à faire.
  const acceptes = all(`SELECT d.id, d.title, d.amount, d.updated_at, c.id AS contact_id, c.first_name, c.last_name, c.company
    FROM deals d JOIN contacts c ON c.id = d.contact_id WHERE d.status = 'accepte' AND c.archived = 0 ORDER BY d.amount DESC`);
  const aFacturer = {
    n: acceptes.length,
    total: acceptes.reduce((s, d) => s + (Number(d.amount) || 0), 0),
    plus_vieux_j: acceptes.reduce((m, d) => Math.max(m, joursEntre(d.updated_at.slice(0, 10), today)), 0),
    lignes: acceptes.slice(0, 5).map((d) => ({ id: d.id, contact_id: d.contact_id, titre: d.title || 'Devis', nom: nomContact(d), societe: d.company || '', montant: Number(d.amount) || 0, jours: joursEntre(d.updated_at.slice(0, 10), today) })),
  };

  // Devis envoyés : combien attendent, combien sont à relancer (plus de N jours sans échange).
  const envoyes = all(`SELECT d.id, d.title, d.amount, d.updated_at, c.id AS contact_id, c.first_name, c.last_name, c.company
    FROM deals d JOIN contacts c ON c.id = d.contact_id WHERE d.status = 'devis_envoye' AND c.archived = 0 ORDER BY d.amount DESC`);
  let aRelancer = 0;
  const lignesDevis = envoyes.map((d) => {
    const dernier = get(`SELECT MAX(day) AS j FROM activities WHERE contact_id = ? AND type IN ('relance', 'appel', 'message_envoye', 'devis_envoye', 'reponse_recue')`, d.contact_id);
    const jours = joursEntre((dernier && dernier.j) || d.updated_at.slice(0, 10), today);
    const relancer = jours >= delaiDevis;
    if (relancer) aRelancer++;
    return { id: d.id, contact_id: d.contact_id, titre: d.title || 'Devis', nom: nomContact(d), societe: d.company || '', montant: Number(d.amount) || 0, jours, a_relancer: relancer };
  });
  const devisEnCours = {
    n: envoyes.length,
    total: envoyes.reduce((s, d) => s + (Number(d.amount) || 0), 0),
    a_relancer: aRelancer,
    lignes: lignesDevis.slice(0, 5),
  };

  // RDV pris, aucun devis : le devis est promis, pas fait.
  const aFaire = [];
  for (const c of all(`SELECT * FROM contacts WHERE archived = 0 AND stage = 'rdv' ORDER BY updated_at`)) {
    if (get('SELECT id FROM deals WHERE contact_id = ? LIMIT 1', c.id)) continue;
    const rdv = get(`SELECT MAX(day) AS j FROM activities WHERE contact_id = ? AND type = 'rdv_pris'`, c.id);
    aFaire.push({ contact_id: c.id, nom: nomContact(c), societe: c.company || '', jours: joursEntre((rdv && rdv.j) || c.updated_at.slice(0, 10), today) });
  }
  aFaire.sort((a, b) => b.jours - a.jours);
  const devisAFaire = { n: aFaire.length, plus_vieux_j: aFaire.length ? aFaire[0].jours : 0, lignes: aFaire.slice(0, 5) };

  // Facturé ce mois-ci (date de facturation, sinon date de mise à jour).
  const mois = today.slice(0, 7);
  const factureMois = get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM deals
    WHERE status = 'facture' AND substr(CASE WHEN invoiced_at != '' THEN invoiced_at ELSE updated_at END, 1, 7) = ?`, mois);

  return {
    a_facturer: aFacturer,
    devis_en_cours: devisEnCours,
    devis_a_faire: devisAFaire,
    facture_mois: { n: Number(factureMois.n), total: Number(factureMois.total) },
  };
}

// ---------------------------------------------------------------- 🎯 le plan : facturé entre deux dates, face à trois paliers
// Les paliers Moyen / Bien / Wow et les dates viennent des Réglages. Sans
// réglage, le plan court sur le trimestre en cours.
function plan(today) {
  let debut = String(getSetting('cockpit_plan_debut') || '').slice(0, 10);
  let fin = String(getSetting('cockpit_plan_fin') || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}-\d{2}$/.test(fin) || fin < debut) {
    const [a, m] = today.split('-').map(Number);
    const trimestre = Math.floor((m - 1) / 3);
    debut = `${a}-${String(trimestre * 3 + 1).padStart(2, '0')}-01`;
    const finMois = trimestre * 3 + 3;
    const dernierJour = new Date(a, finMois, 0).getDate();
    fin = `${a}-${String(finMois).padStart(2, '0')}-${String(dernierJour).padStart(2, '0')}`;
  }
  const moyen = nombre(getSetting('cockpit_palier_moyen'), 20000);
  const bien = Math.max(moyen, nombre(getSetting('cockpit_palier_bien'), 25000));
  const wow = Math.max(bien, nombre(getSetting('cockpit_palier_wow'), 35000));
  const row = get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM deals
    WHERE status = 'facture' AND substr(CASE WHEN invoiced_at != '' THEN invoiced_at ELSE updated_at END, 1, 10) BETWEEN ? AND ?`, debut, fin);
  const total = Number(row.total);
  const atteint = total >= wow ? 'wow' : total >= bien ? 'bien' : total >= moyen ? 'moyen' : '';
  const prochain = total < moyen ? { nom: 'moyen', manque: moyen - total } : total < bien ? { nom: 'bien', manque: bien - total } : total < wow ? { nom: 'wow', manque: wow - total } : null;
  const joursTotal = Math.max(1, joursEntre(debut, fin));
  const joursPasses = Math.min(joursTotal, Math.max(0, joursEntre(debut, today)));
  return {
    debut, fin,
    jours_restants: Math.max(0, joursEntre(today, fin)),
    avancement: joursPasses / joursTotal,
    n: Number(row.n), total,
    paliers: { moyen, bien, wow },
    atteint, prochain,
    pct: Math.min(1, total / wow),
  };
}

// ---------------------------------------------------------------- 📈 le facturé des six derniers mois
function caParMois(today, n = 6) {
  const out = [];
  const [a, m] = today.split('-').map(Number);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(a, m - 1 - i, 1);
    const mois = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const row = get(`SELECT COUNT(*) AS k, COALESCE(SUM(amount), 0) AS total FROM deals
      WHERE status = 'facture' AND substr(CASE WHEN invoiced_at != '' THEN invoiced_at ELSE updated_at END, 1, 7) = ?`, mois);
    const lib = libelleMois(mois);
    out.push({ mois, libelle: lib.court, annee: lib.annee, n: Number(row.k), total: Number(row.total), courant: mois === today.slice(0, 7) });
  }
  return out;
}

// ---------------------------------------------------------------- 📊 pipeline : combien de contacts par étape, et combien d'euros
function pipeline() {
  const comptes = game.pipelineCounts();
  const montants = {};
  for (const r of all(`SELECT c.stage, COALESCE(SUM(d.amount), 0) AS total FROM deals d JOIN contacts c ON c.id = d.contact_id
    WHERE c.archived = 0 AND d.status IN ('brouillon', 'devis_envoye', 'accepte') GROUP BY c.stage`)) montants[r.stage] = Number(r.total);
  return comptes.map((s) => ({ ...s, montant: montants[s.code] || 0 }));
}

// Devis signés face aux devis envoyés sur les 90 derniers jours. Un devis
// « signé » est accepté ou facturé ; un devis encore en attente compte dans
// les envoyés, pas dans les signés : le taux dit donc où on en est, pas où on
// finira.
function conversion(today) {
  const depuis = addDays(today, -90);
  const row = get(`SELECT
      SUM(CASE WHEN status IN ('devis_envoye', 'accepte', 'facture') THEN 1 ELSE 0 END) AS envoyes,
      SUM(CASE WHEN status IN ('accepte', 'facture') THEN 1 ELSE 0 END) AS signes
    FROM deals WHERE substr(created_at, 1, 10) >= ?`, depuis);
  const envoyes = Number(row.envoyes) || 0;
  const signes = Number(row.signes) || 0;
  return { jours: 90, envoyes, signes, taux: envoyes ? signes / envoyes : null };
}

// ---------------------------------------------------------------- 🔔 relances et réponses
function relances(today) {
  const dues = all(`SELECT stage, next_action_at, is_former_client FROM contacts WHERE archived = 0 AND stage NOT IN ('gagne', 'perdu') AND next_action_at != '' AND next_action_at <= ?`, today);
  return {
    dues: dues.length,
    chaudes: dues.filter((c) => c.is_former_client || STAGES_CHAUDS.includes(c.stage)).length,
    plus_vieille_j: dues.reduce((m, c) => Math.max(m, joursEntre(c.next_action_at, today)), 0),
  };
}
function reponses(today) {
  return {
    a_traiter: Number(get(`SELECT COUNT(*) AS n FROM inbox WHERE status = 'nouveau'`).n),
    recues_7j: Number(get(`SELECT COUNT(*) AS n FROM activities WHERE type = 'reponse_recue' AND day >= ?`, addDays(today, -6)).n),
  };
}

// ---------------------------------------------------------------- ⚡ l'activité des 14 derniers jours
function activite(today, n = 14) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const row = get(`SELECT COUNT(*) AS k, COALESCE(SUM(xp), 0) AS xp FROM activities WHERE day = ? AND type != 'note'`, d);
    out.push({ day: d, n: Number(row.k), xp: Number(row.xp) });
  }
  return out;
}

// ---------------------------------------------------------------- 📜 le fil : les dernières actions, pour la bande qui défile
function fil(limite = 12) {
  const rows = all(`SELECT a.id, a.type, a.note, a.xp, a.created_at, a.meta, c.first_name, c.last_name, c.company, c.id AS contact_id
    FROM activities a LEFT JOIN contacts c ON c.id = a.contact_id
    WHERE a.type != 'note' ORDER BY a.created_at DESC, a.id DESC LIMIT ?`, limite);
  return rows.map((r) => {
    const def = game.ACTIONS[r.type] || {};
    return {
      id: Number(r.id), type: r.type, emoji: def.emoji || '•', label: def.label || r.type.replace(/_/g, ' '),
      nom: r.contact_id ? nomContact(r) : '', societe: r.company || '', xp: Number(r.xp) || 0,
      quand: r.created_at, note: String(r.note || '').slice(0, 80),
    };
  });
}

// ---------------------------------------------------------------- 📡 le radar : chaque contact est un point, plus il est proche du centre, plus il est près de signer
const STAGES_RADAR_CHAUDS = ['en_discussion', 'rdv', 'devis_envoye', 'negociation', 'gagne'];
function radar(limiteFroids = 70) {
  const chauds = all(`SELECT c.id, c.first_name, c.last_name, c.email, c.company, c.stage, c.is_former_client,
      (SELECT COALESCE(SUM(d.amount), 0) FROM deals d WHERE d.contact_id = c.id AND d.status IN ('brouillon', 'devis_envoye', 'accepte')) AS montant
    FROM contacts c WHERE c.archived = 0 AND c.stage IN ('en_discussion', 'rdv', 'devis_envoye', 'negociation', 'gagne')
    ORDER BY c.updated_at DESC LIMIT 80`);
  // Les froids : les anciens clients d'abord (ce sont les plus faciles à réveiller), puis les plus récents.
  const froids = all(`SELECT id, first_name, last_name, email, company, stage, is_former_client FROM contacts
    WHERE archived = 0 AND stage IN ('a_contacter', 'contacte') ORDER BY is_former_client DESC, updated_at DESC LIMIT ?`, limiteFroids);
  const point = (c, chaud) => ({ id: c.id, nom: nomContact(c), societe: c.company || '', stage: c.stage, chaud, ancien: !!c.is_former_client, montant: Number(c.montant) || 0 });
  const total = Number(get(`SELECT COUNT(*) AS n FROM contacts WHERE archived = 0 AND stage != 'perdu'`).n);
  return { points: [...chauds.map((c) => point(c, true)), ...froids.map((c) => point(c, false))], total, chauds: chauds.length };
}

// ---------------------------------------------------------------- 🏁 la cadence : les actions du jour face au record des 30 derniers jours
function cadence(today) {
  const row = get(`SELECT day, COUNT(*) AS n FROM activities WHERE type NOT IN ('note', 'quest_bonus', 'badge_bonus') AND day >= ? AND day < ? GROUP BY day ORDER BY n DESC, day DESC LIMIT 1`, addDays(today, -30), today);
  const aujourdhui = Number(get(`SELECT COUNT(*) AS n FROM activities WHERE type NOT IN ('note', 'quest_bonus', 'badge_bonus') AND day = ?`, today).n);
  return { aujourdhui, record: row ? Number(row.n) : 0, record_jour: row ? row.day : '' };
}

// ---------------------------------------------------------------- 🎮 le jeu : niveau, streak, quêtes du jour, badges
function jeu(today) {
  const xp = game.totalXp();
  const derniers = all('SELECT code, awarded_at FROM badges ORDER BY awarded_at DESC LIMIT 3')
    .map((r) => ({ ...(game.BADGES.find((b) => b.code === r.code) || { code: r.code, name: r.code, emoji: '🏅' }), awarded_at: r.awarded_at }));
  const gagnes = new Set(all('SELECT code FROM badges').map((r) => r.code));
  return {
    streak: game.computeStreak(),
    level: game.levelForXp(xp),
    xp_total: xp,
    xp_jour: Number(get(`SELECT COALESCE(SUM(xp), 0) AS n FROM activities WHERE day = ?`, today).n),
    boss: game.bossState(),
    quetes: game.todayQuests().map((q) => ({ code: q.code, label: q.label, emoji: q.emoji, target: q.target, bonus: q.bonus, progress: q.progress, done: q.done })),
    badges: { total: game.BADGES.length, gagnes: gagnes.size, derniers, tous: game.BADGES.map((b) => ({ code: b.code, name: b.name, emoji: b.emoji, desc: b.desc, won: gagnes.has(b.code) })) },
  };
}

// ---------------------------------------------------------------- ☀️ la journée : les trois choses qui comptent
function scoreItem(it) { return it.importance * 100 + (it.urgence || 0) * 20 + Math.min(50, Math.round((it.argent || 0) / 200)); }
function journeeResume(p) {
  const tout = [...p.blocs.matin, ...p.blocs.pierre, ...p.blocs.apres_midi].sort((a, b) => scoreItem(b) - scoreItem(a));
  const premiere = (it) => (it.actions && it.actions[0]) || null;
  return {
    total: p.total, vitaux: p.vitaux, faits: p.faits_aujourdhui, argent: p.argent,
    minutes_matin: p.minutes.matin || 0,
    essentiels: tout.slice(0, 3).map((it) => ({
      cle: it.cle, titre: it.titre, emoji: it.emoji, importance: it.importance, argent: it.argent || 0, pourquoi: it.pourquoi || '', source: it.source,
      action: premiere(it) ? { type: premiere(it).type, id: premiere(it).id || null, href: premiere(it).href || '' } : null,
    })),
    reste: Math.max(0, tout.length - 3),
  };
}

// Les événements du jour qui ne sont pas encore passés, pour la colonne de droite.
function agendaResume(p, now) {
  const ag = p.agenda || {};
  if (!ag.branche) return { branche: false, prochains: [], total: 0 };
  const evenements = Array.isArray(ag.evenements) ? ag.evenements : [];
  const prochains = evenements
    .filter((ev) => ev.journee || !ev.fin || Date.parse(ev.fin) >= now.getTime())
    .slice(0, 4)
    .map((ev) => ({ titre: ev.titre || ev.summary || '', heure: ev.heure || '', heure_fin: ev.heure_fin || '', journee: !!ev.journee, niveau: ev.niveau || 'info' }));
  return { branche: true, prochains, total: evenements.length };
}

// ---------------------------------------------------------------- l'état complet
function etat({ now = new Date() } = {}) {
  const today = localDay(now);
  const p = journee.plan({ now });
  const camp = campaigns.currentCampaign();
  const auto = autopilot.state();
  return {
    genere_le: now.toISOString(),
    jour: today,
    jour_long: p.jour_long,
    argent: argent(today),
    plan: plan(today),
    ca_mois: caParMois(today),
    pipeline: pipeline(),
    conversion: conversion(today),
    relances: relances(today),
    reponses: reponses(today),
    autopilote: {
      configured: auto.configured, enabled: auto.enabled, mode: auto.mode,
      awaiting: auto.awaiting, sent_today: auto.sent_today, daily_cap: auto.daily_cap,
      active: auto.active_enrollments, replies_today: auto.replies_today,
    },
    journee: journeeResume(p),
    agenda: agendaResume(p, now),
    activite: activite(today),
    fil: fil(),
    radar: radar(),
    cadence: cadence(today),
    jeu: jeu(today),
    campagne: camp ? { id: camp.id, name: camp.name, status: camp.status, stats: camp.stats, posted: !!camp.posted } : null,
    rafraichissement_s: Math.max(15, Number(getSetting('cockpit_rafraichissement')) || 60),
    stages: playbooks.STAGES,
  };
}

module.exports = { etat, argent, plan, caParMois, pipeline, conversion, relances, reponses, activite, fil, radar, cadence, jeu, journeeResume };
