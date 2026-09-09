'use strict';
// 🗓️ GOOGLE AGENDA : lire ce que Maxime a devant lui, poser ses tâches sur ses
// créneaux libres, et porter l'urgence directement dans les couleurs de l'agenda.
//
// Pas de projet Google Cloud ni d'OAuth : un petit script Apps Script (agenda.gs)
// déployé sur SON compte fait office de pont. On lui parle en POST avec un
// secret ; il répond en JSON. Google renvoie d'abord une redirection (302) vers
// la vraie réponse : fetch la suit tout seul.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dbApi = require('../db');
const { get, all, run, getSetting, setSetting, nowIso, localDay, addDays } = dbApi;

// ---------------------------------------------------------------- couleurs et urgences
// Les 11 couleurs d'événement de Google Agenda, avec leur nom tel qu'il apparaît.
const PALETTE = {
  1: { nom: 'Lavande', hex: '#7986cb' },
  2: { nom: 'Sauge', hex: '#33b679' },
  3: { nom: 'Raisin', hex: '#8e24aa' },
  4: { nom: 'Flamant rose', hex: '#e67c73' },
  5: { nom: 'Banane', hex: '#f6c026' },
  6: { nom: 'Mandarine', hex: '#f5511d' },
  7: { nom: 'Paon', hex: '#039be5' },
  8: { nom: 'Graphite', hex: '#616161' },
  9: { nom: 'Myrtille', hex: '#3f51b5' },
  10: { nom: 'Basilic', hex: '#0b8043' },
  11: { nom: 'Tomate', hex: '#d60000' },
};

// L'échelle d'urgence de Maxime. « couleur » : celle que l'app pose quand elle
// crée ou reclasse un événement (sauf si ses réglages en désignent une autre).
const NIVEAUX = {
  3: { code: 3, label: 'très urgent', emoji: '🔴', couleur: '11' },
  2: { code: 2, label: 'urgent', emoji: '🟠', couleur: '6' },
  1: { code: 1, label: 'moyen', emoji: '🟡', couleur: '5' },
  0: { code: 0, label: 'pas urgent', emoji: '🟢', couleur: '10' },
};

// Ce que chaque couleur veut dire, par défaut. null = juste une info (RDV, perso…).
const COULEURS_DEFAUT = { 11: 3, 6: 2, 4: 2, 5: 1, 10: 0, 2: 0, 1: null, 3: null, 7: null, 8: null, 9: null };

// Mots qui trahissent une prod : même sans couleur, ça se prépare.
const MOTS_PROD = ['tournage', 'shooting', 'captation', 'livraison', 'livrable', 'rendu', 'deadline', 'montage', 'derush', 'dérush', 'diffusion', 'publication', 'mise en ligne'];

function couleurs() {
  let m = {};
  try { m = JSON.parse(getSetting('agenda_couleurs') || '{}'); } catch { m = {}; }
  const out = {};
  for (const id of Object.keys(PALETTE)) {
    let v = id in m ? m[id] : COULEURS_DEFAUT[id];
    v = v === '' || v === undefined || v === null ? null : Number(v);
    out[id] = v !== null && v in NIVEAUX ? v : null;
  }
  return out;
}

// Niveau d'urgence d'un événement : sa couleur d'abord, sinon les mots de prod.
function niveauDe(ev, mapping = couleurs()) {
  const c = String(ev.couleur || '');
  if (c && mapping[c] !== null && mapping[c] !== undefined) return { niveau: mapping[c], source: 'couleur' };
  const sansAccent = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hay = sansAccent(ev.titre);
  const mot = MOTS_PROD.find((m) => hay.includes(sansAccent(m)));
  if (mot) return { niveau: 1, source: 'mot', mot };
  return { niveau: null, source: '' };
}

// La couleur à poser pour un niveau : celle que Maxime a associée, sinon la nôtre.
function couleurPour(niveau, mapping = couleurs()) {
  const n = Number(niveau);
  const perso = Object.keys(mapping).find((id) => mapping[id] === n && String(NIVEAUX[n] && NIVEAUX[n].couleur) === id)
    || Object.keys(mapping).find((id) => mapping[id] === n);
  return perso || (NIVEAUX[n] ? NIVEAUX[n].couleur : '');
}

// ---------------------------------------------------------------- appel du pont
function estBranche() { return !!(getSetting('agenda_url') && getSetting('agenda_secret')); }

function secret() {
  let s = getSetting('agenda_secret');
  if (!s) { s = crypto.randomBytes(18).toString('base64url'); setSetting('agenda_secret', s); }
  return s;
}

function codeDuScript() {
  const brut = fs.readFileSync(path.join(__dirname, 'agenda.gs'), 'utf8');
  return brut.replace('__SECRET__', secret());
}

async function appel(action, charge = {}, { timeoutMs = 45000 } = {}) {
  const url = String(getSetting('agenda_url') || '').trim();
  if (!url) throw new Error("Google Agenda n'est pas branché : colle l'adresse du script dans Réglages → Google Agenda.");
  const locale = process.env.NODE_ENV === 'test' && /^http:\/\/127\.0\.0\.1(:\d+)?\//.test(url); // faux Google des tests
  if (!locale && !/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) throw new Error("L'adresse du script doit ressembler à https://script.google.com/macros/s/…/exec (celle du déploiement, pas celle de l'éditeur).");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // pas de pré-vol, Google accepte tel quel
      body: JSON.stringify({ secret: secret(), action, ...charge }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`Google ne répond pas : ${e.message}`);
  }
  clearTimeout(timer);
  const texte = await res.text();
  let json = null;
  try { json = JSON.parse(texte); } catch { json = null; }
  if (!json) {
    if (/accounts\.google\.com|Se connecter|Sign in/i.test(texte)) {
      throw new Error("Google demande une connexion : le déploiement n'est pas ouvert à « Tout le monde ». Dans Apps Script : Déployer → Gérer les déploiements → ✏️ → Qui a accès : Tout le monde → Déployer, puis recolle l'URL si elle a changé.");
    }
    throw new Error(`Le script a répondu autre chose que du JSON (HTTP ${res.status}). As-tu bien collé tout le code, puis déployé une NOUVELLE version ?`);
  }
  if (json.error) {
    if (/Mauvais secret/i.test(json.error)) throw new Error('Le script ne reconnaît pas le secret : recopie le code depuis Réglages (le secret est dedans) et déploie une nouvelle version.');
    throw new Error(`Google Agenda : ${json.error}`);
  }
  return json;
}

async function test() {
  const r = await appel('ping');
  setSetting('agenda_calendriers_connus', JSON.stringify(r.calendriers || []));
  if (r.principal && !getSetting('agenda_calendrier_ecriture')) setSetting('agenda_calendrier_ecriture', r.principal);
  return { ok: true, message: `Google Agenda OK${r.email ? ` (${r.email})` : ''} : ${(r.calendriers || []).length} agenda(s) visibles`, calendriers: r.calendriers || [], principal: r.principal || '' };
}

function calendriersConnus() {
  try { return JSON.parse(getSetting('agenda_calendriers_connus') || '[]'); } catch { return []; }
}
function calendriersLus() {
  try { const l = JSON.parse(getSetting('agenda_calendriers') || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
}

// ---------------------------------------------------------------- lecture
async function lireEvenements({ de, a } = {}) {
  const today = localDay();
  const horizon = Math.max(1, Number(getSetting('agenda_horizon_jours')) || 7);
  const debut = de || new Date(`${today}T00:00:00`).toISOString();
  const fin = a || new Date(`${addDays(today, horizon + 1)}T00:00:00`).toISOString();
  const r = await appel('evenements', { de: debut, a: fin, calendriers: calendriersLus() });
  const evenements = (r.evenements || []).map((e) => ({ ...e, id: String(e.id || ''), couleur: String(e.couleur || '') }))
    .sort((x, y) => String(x.debut).localeCompare(String(y.debut)));
  return { evenements, de: debut, a: fin };
}

// ---------------------------------------------------------------- créneaux libres
function minutesDe(hhmm, defaut) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : defaut;
}
function heuresTravail() {
  return { debut: minutesDe(getSetting('agenda_heures_debut'), 9 * 60), fin: minutesDe(getSetting('agenda_heures_fin'), 18 * 60 + 30) };
}
function dateA(day, minutes) {
  const d = new Date(`${day}T00:00:00`);
  d.setMinutes(minutes);
  return d;
}

// Les trous entre les événements d'un jour, dans les heures de travail, à partir de maintenant.
function creneauxLibres(evenements, { day = localDay(), now = new Date(), minMinutes = 20, heures = heuresTravail() } = {}) {
  const jourDebut = dateA(day, heures.debut).getTime();
  const jourFin = dateA(day, heures.fin).getTime();
  let curseur = jourDebut;
  if (day === localDay(now)) curseur = Math.max(curseur, Math.ceil(now.getTime() / 300000) * 300000); // au prochain multiple de 5 min
  const occupes = evenements
    .filter((e) => !e.journee && e.debut && e.fin)
    .map((e) => ({ debut: Date.parse(e.debut), fin: Date.parse(e.fin) }))
    .filter((e) => e.fin > jourDebut && e.debut < jourFin)
    .sort((x, y) => x.debut - y.debut);
  const libres = [];
  for (const o of occupes) {
    if (o.debut > curseur) libres.push({ debut: curseur, fin: o.debut });
    curseur = Math.max(curseur, o.fin);
  }
  if (jourFin > curseur) libres.push({ debut: curseur, fin: jourFin });
  return libres
    .map((c) => ({ debut: new Date(c.debut).toISOString(), fin: new Date(c.fin).toISOString(), minutes: Math.round((c.fin - c.debut) / 60000) }))
    .filter((c) => c.minutes >= minMinutes);
}

// ---------------------------------------------------------------- écriture
function heureCourte(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function evenementDe(cle) {
  return get('SELECT * FROM journee_agenda WHERE cle = ?', cle);
}

// Pose (ou déplace) une chose à faire sur l'agenda, à l'heure choisie, avec la couleur de son urgence.
async function caler(it, { debut, fin, minutes } = {}) {
  if (!debut) throw new Error('Choisis un créneau.');
  const d = new Date(debut);
  if (Number.isNaN(d.getTime())) throw new Error('Créneau illisible.');
  const f = fin ? new Date(fin) : new Date(d.getTime() + Math.max(15, Number(minutes) || it.minutes || 30) * 60000);
  const niveau = Math.min(3, Math.max(1, Number(it.importance) || 1));
  const couleur = couleurPour(niveau);
  const existant = evenementDe(it.cle);
  const calendrierEcriture = getSetting('agenda_calendrier_ecriture') || '';

  if (existant) {
    await appel('deplacer', { calendrier: existant.calendar_id, id: existant.event_id, debut: d.toISOString(), fin: f.toISOString() });
    run('UPDATE journee_agenda SET debut = ?, fin = ? WHERE cle = ?', d.toISOString(), f.toISOString(), it.cle);
    return { ok: true, deplace: true, event_id: existant.event_id, debut: d.toISOString(), fin: f.toISOString(), heure: heureCourte(d) };
  }
  const titre = `${it.emoji || '☀️'} ${it.titre}`.trim();
  const description = [it.pourquoi || '', '', 'Calé par OTEA Moteur (☀️ Ma journée).'].join('\n').trim();
  const r = await appel('creer', { calendrier: calendrierEcriture, titre, debut: d.toISOString(), fin: f.toISOString(), description, couleur });
  run('INSERT INTO journee_agenda (cle, event_id, calendar_id, titre, debut, fin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cle) DO UPDATE SET event_id = excluded.event_id, calendar_id = excluded.calendar_id, titre = excluded.titre, debut = excluded.debut, fin = excluded.fin',
    it.cle, String(r.id || ''), String(r.calendrier || calendrierEcriture), titre, d.toISOString(), f.toISOString(), nowIso());
  return { ok: true, cree: true, event_id: String(r.id || ''), debut: d.toISOString(), fin: f.toISOString(), heure: heureCourte(d), couleur };
}

async function decaler(cle) {
  const ex = evenementDe(cle);
  if (!ex) return { ok: true, rien: true };
  try { await appel('supprimer', { calendrier: ex.calendar_id, id: ex.event_id }); } catch (e) { /* déjà supprimé à la main : on oublie juste le lien */ }
  run('DELETE FROM journee_agenda WHERE cle = ?', cle);
  return { ok: true };
}

// Change l'urgence d'un événement existant : c'est sa couleur qui change, dans Google Agenda.
async function changerUrgence({ calendrier, id, niveau }) {
  const n = niveau === null || niveau === '' || niveau === undefined ? null : Number(niveau);
  if (n !== null && !(n in NIVEAUX)) throw new Error('Niveau inconnu : 3 très urgent, 2 urgent, 1 moyen, 0 pas urgent, ou rien.');
  const couleur = n === null ? '' : couleurPour(n);
  await appel('couleur', { calendrier, id, couleur });
  return { ok: true, couleur, niveau: n };
}

// Remplit la journée d'un coup : les courtes au plus tôt, la grosse pierre dans le
// plus grand trou, les moyennes ensuite. Ce qui ne rentre pas est dit, pas forcé.
async function calerJournee(plan, { now = new Date(), evenements = [] } = {}) {
  const day = plan.jour;
  let libres = creneauxLibres(evenements, { day, now, minMinutes: 15 }).map((c) => ({ debut: Date.parse(c.debut), fin: Date.parse(c.fin) }));
  const dejaCales = new Set(all('SELECT cle FROM journee_agenda').map((r) => r.cle));
  const cales = [];
  const sansPlace = [];

  const prendre = (it, { plusGrand = false } = {}) => {
    const besoin = Math.min(240, Math.max(15, Number(it.minutes) || 30)) * 60000;
    let idx = -1;
    if (plusGrand) {
      let taille = 0;
      libres.forEach((c, i) => { if (c.fin - c.debut >= Math.min(besoin, 60 * 60000) && c.fin - c.debut > taille) { taille = c.fin - c.debut; idx = i; } });
    } else {
      idx = libres.findIndex((c) => c.fin - c.debut >= besoin);
    }
    if (idx === -1) return null;
    const c = libres[idx];
    const duree = Math.min(besoin, c.fin - c.debut);
    const debut = c.debut;
    const fin = debut + duree;
    const reste = { debut: fin + 5 * 60000, fin: c.fin };
    libres.splice(idx, 1, ...(reste.fin - reste.debut >= 15 * 60000 ? [reste] : []));
    return { debut: new Date(debut).toISOString(), fin: new Date(fin).toISOString() };
  };

  const file = [
    ...plan.blocs.matin.map((it) => [it, {}]),
    ...plan.blocs.pierre.map((it) => [it, { plusGrand: true }]),
    ...plan.blocs.apres_midi.map((it) => [it, {}]),
  ];
  for (const [it, opts] of file) {
    if (dejaCales.has(it.cle)) continue;
    const creneau = prendre(it, opts);
    if (!creneau) { sansPlace.push(it.titre); continue; }
    try {
      const r = await caler(it, creneau);
      cales.push({ cle: it.cle, titre: it.titre, heure: r.heure });
    } catch (e) {
      sansPlace.push(`${it.titre} (${e.message})`);
    }
  }
  return { cales, sans_place: sansPlace, deja: [...dejaCales].length };
}

function liensCales() {
  const out = {};
  for (const r of all('SELECT cle, event_id, calendar_id, debut, fin FROM journee_agenda')) out[r.cle] = r;
  return out;
}

// Ménage : les liens vers des événements passés depuis plus d'une semaine.
function nettoyerLiens(now = new Date()) {
  const limite = new Date(now.getTime() - 7 * 86400000).toISOString();
  return run('DELETE FROM journee_agenda WHERE fin < ?', limite).changes;
}

module.exports = {
  PALETTE, NIVEAUX, COULEURS_DEFAUT, MOTS_PROD,
  couleurs, niveauDe, couleurPour,
  estBranche, secret, codeDuScript, appel, test, calendriersConnus, calendriersLus,
  lireEvenements, creneauxLibres, heuresTravail, heureCourte,
  caler, decaler, changerUrgence, calerJournee, liensCales, evenementDe, nettoyerLiens,
};
