'use strict';
// « Annuler » qui remet vraiment tout en place.
//
// Avant une action qui efface ou fait changer d'étape, on photographie les
// lignes qu'elle peut toucher. Juste après, on note ce qu'elle a ajouté (une
// activité, l'XP qui va avec, un badge, une quête). Annuler remet les lignes
// photographiées telles quelles et retire ces ajouts, en une seule
// transaction : soit tout revient, soit rien ne bouge.
//
// Une cible se décrit ainsi : { table, ou: 'contact_id = ?', params: [12] }.
// Les noms de tables et les clauses viennent toujours du code, jamais d'une
// saisie : seules les valeurs passent en paramètres.

const { db, get, all, run, nowIso } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS annulations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  libelle TEXT DEFAULT '',
  photo TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

const DUREE_MS = 15 * 60 * 1000; // passé ce délai, on ne revient plus en arrière
const GARDER = 50;               // les plus anciens points de retour sont oubliés

// Tables où le jeu ne fait qu'ajouter des lignes, au passage d'une action.
const AJOUTS_DU_JEU = ['activities', 'badges', 'quest_awards'];

const NOM = /^[a-z_]+$/;
function verifierNom(n) {
  if (!NOM.test(String(n))) throw new Error(`Nom de table ou de colonne refusé : ${n}`);
  return n;
}

function erreur(status, message) { const e = new Error(message); e.httpStatus = status; return e; }

function cible(table, ou, ...params) { return { table, ou, params, cle: 'id' }; }

// Tout ce qu'un contact entraîne avec lui quand on l'efface (suppression en cascade).
function ciblesContact(id) {
  return [
    cible('contacts', 'id = ?', id),
    cible('deals', 'contact_id = ?', id),
    cible('activities', 'contact_id = ?', id),
    cible('enrollments', 'contact_id = ?', id),
    cible('outbox', 'contact_id = ?', id),
  ];
}

function lire(c) {
  verifierNom(c.table); verifierNom(c.cle || 'id');
  return all(`SELECT * FROM ${c.table} WHERE ${c.ou}`, ...(c.params || []));
}

function ouvrir(cibles = []) {
  const avant = cibles.map((c) => ({ table: c.table, ou: c.ou, params: c.params || [], cle: c.cle || 'id', lignes: lire(c) }));
  const max = {};
  for (const t of AJOUTS_DU_JEU) max[t] = Number(get(`SELECT COALESCE(MAX(rowid), 0) AS m FROM ${t}`).m);
  return { avant, max };
}

function fermer(ouvert, libelle = '') {
  const ajouts = {};
  for (const t of AJOUTS_DU_JEU) {
    const ids = all(`SELECT rowid AS r FROM ${t} WHERE rowid > ?`, ouvert.max[t]).map((x) => Number(x.r));
    if (ids.length) ajouts[t] = ids;
  }
  const cibles = ouvert.avant.map((c) => {
    const connues = new Set(c.lignes.map((l) => String(l[c.cle])));
    const nouvelles = lire(c).map((l) => l[c.cle]).filter((k) => !connues.has(String(k)));
    return { ...c, nouvelles };
  });
  const { lastId } = run('INSERT INTO annulations (libelle, photo, created_at) VALUES (?, ?, ?)',
    String(libelle).slice(0, 200), JSON.stringify({ cibles, ajouts }), nowIso());
  run('DELETE FROM annulations WHERE id <= ?', lastId - GARDER);
  return lastId;
}

// Fait l'action entre la photo d'avant et le relevé d'après. L'action doit
// être synchrone : rien d'autre ne doit écrire dans la base pendant ce temps.
function avecRetour(libelle, cibles, faire) {
  const ouvert = ouvrir(cibles);
  const resultat = faire();
  if (resultat && typeof resultat.then === 'function') throw new Error('avecRetour attend une action synchrone');
  const annulation = fermer(ouvert, libelle);
  return { ...(resultat || {}), annulation };
}

function colonnes(table) { return all(`PRAGMA table_info(${verifierNom(table)})`).map((c) => c.name); }

function annuler(id) {
  const r = get('SELECT * FROM annulations WHERE id = ?', Number(id));
  if (!r) throw erreur(410, "Ce retour en arrière n'est plus possible : il a déjà été fait, ou il date d'avant le dernier redémarrage. Corrige à la main depuis la fiche concernée.");
  if (Date.now() - Date.parse(r.created_at) > DUREE_MS) {
    run('DELETE FROM annulations WHERE id = ?', r.id);
    throw erreur(410, "Trop tard pour annuler : le retour en arrière ne reste ouvert que 15 minutes. Corrige à la main depuis la fiche concernée.");
  }
  const { cibles, ajouts } = JSON.parse(r.photo);
  db.exec('BEGIN');
  try {
    // 1. Ce que l'action a ajouté s'en va (les enfants avant les parents).
    for (const [t, ids] of Object.entries(ajouts)) {
      verifierNom(t);
      for (const x of ids) run(`DELETE FROM ${t} WHERE rowid = ?`, x);
    }
    for (const c of [...cibles].reverse()) {
      for (const k of c.nouvelles) run(`DELETE FROM ${verifierNom(c.table)} WHERE ${verifierNom(c.cle)} = ?`, k);
    }
    // 2. Les lignes d'avant reviennent telles quelles (les parents avant les enfants).
    //    Une ligne encore là est réécrite sur place : la remplacer effacerait en
    //    cascade tout ce qui en dépend.
    for (const c of cibles) {
      const cols = colonnes(c.table);
      for (const l of c.lignes) {
        const champs = cols.filter((k) => Object.prototype.hasOwnProperty.call(l, k));
        const valeurs = champs.map((k) => l[k]);
        if (get(`SELECT 1 AS x FROM ${c.table} WHERE ${c.cle} = ?`, l[c.cle])) {
          run(`UPDATE ${c.table} SET ${champs.map((k) => `${k} = ?`).join(', ')} WHERE ${c.cle} = ?`, ...valeurs, l[c.cle]);
        } else {
          run(`INSERT INTO ${c.table} (${champs.join(', ')}) VALUES (${champs.map(() => '?').join(', ')})`, ...valeurs);
        }
      }
    }
    run('DELETE FROM annulations WHERE id = ?', r.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw erreur(500, `Le retour en arrière n'a pas pu se faire, rien n'a bougé (${e.message}). Recharge la page et corrige à la main.`);
  }
  return { ok: true, libelle: r.libelle };
}

module.exports = { avecRetour, annuler, ouvrir, fermer, cible, ciblesContact, DUREE_MS };
