'use strict';
// 📞 APPELS : qui as-tu eu au téléphone, et jamais relancé ?
//
// Source principale : l'historique d'appels que ton Mac synchronise avec ton iPhone
// (Réglages iPhone → Téléphone → Appels sur d'autres appareils). Il vit dans un
// fichier SQLite du dossier Bibliothèque, qu'on ouvre en lecture seule.
// Source de secours : un CSV exporté depuis un téléphone Android.

const path = require('node:path');
const bl = require('./bases_locales');
const sig = require('./signaux');

const TABLE_APPELS = 'ZCALLRECORD';

// Un appel de moins de 8 secondes, c'est une erreur de manip ou un répondeur :
// ça ne prouve aucune relation, on ne le compte pas comme un échange.
const DUREE_MINIMALE = 8;

function chemin() {
  return bl.trouverFichier(bl.CHEMINS_APPELS);
}

function etatSource() {
  return bl.chercher(bl.CHEMINS_APPELS).etat;
}

function disponible() {
  return !!chemin();
}

// Transforme les lignes brutes (une par appel) en une fiche par correspondant.
function agreger(lignes, { days = 1095 } = {}) {
  const limite = Date.now() - days * 86400000;
  const parNumero = new Map();

  for (const l of lignes) {
    const brut = bl.texte(l.address);
    const cle = sig.phoneKey(brut);
    if (!cle) continue;
    if (!l.date || new Date(l.date).getTime() < limite) continue;
    if (sig.estNumeroDeService(brut)) continue;

    let e = parNumero.get(cle);
    if (!e) {
      e = {
        source: 'appels', key: 'tel:' + cle,
        name: '', phone: sig.normPhone(brut),
        calls: 0, messages: 0, incoming: 0, outgoing: 0,
        duration_sec: 0, last_at: null, first_at: null, signaux: [], excerpt: '',
      };
      parNumero.set(cle, e);
    }

    const duree = Math.max(0, Number(l.duration) || 0);
    const repondu = duree >= DUREE_MINIMALE;
    if (repondu) {
      e.calls++;
      if (Number(l.originated) === 1) e.outgoing++; else e.incoming++;
      e.duration_sec += duree;
    }
    // Le carnet d'adresses du Mac donne parfois le nom : c'est cadeau.
    const nom = bl.texte(l.name).trim();
    if (nom && !e.name) e.name = nom;
    if (!e.last_at || l.date > e.last_at) e.last_at = l.date;
    if (!e.first_at || l.date < e.first_at) e.first_at = l.date;
  }

  // Un seul appel jamais décroché ne suffit pas à parler de relation.
  return [...parNumero.values()].filter((e) => e.calls > 0);
}

// Lecture de la base macOS. Le schéma varie selon la version du système :
// on lit les colonnes réellement présentes avant d'écrire la requête.
function lireBase({ days = 1095 } = {}) {
  const { chemin: src, etat } = bl.chercher(bl.CHEMINS_APPELS);
  if (!src) {
    throw new Error(bl.expliquerAbsence(etat, 'ton historique d’appels',
      "Historique d'appels introuvable sur ce Mac. Sur l'iPhone : Réglages → Téléphone → « Appels sur d'autres appareils » → active ton Mac, passe un appel, puis relance le scan. Sinon, importe un CSV d'appels."
    ));
  }
  const conn = bl.ouvrirLecture(src);
  try {
    if (!bl.tableExiste(conn.db, TABLE_APPELS)) {
      throw new Error(`Le fichier ${path.basename(src)} n'a pas le format attendu (table ${TABLE_APPELS} absente).`);
    }
    const dispo = bl.colonnes(conn.db, TABLE_APPELS);
    const col = {
      address: bl.choisirColonne(dispo, ['ZADDRESS', 'ZNORMALIZED_ADDRESS']),
      date: bl.choisirColonne(dispo, ['ZDATE']),
      duration: bl.choisirColonne(dispo, ['ZDURATION']),
      originated: bl.choisirColonne(dispo, ['ZORIGINATED']),
      name: bl.choisirColonne(dispo, ['ZNAME']),
    };
    if (!col.address || !col.date) {
      throw new Error("Colonnes d'appels introuvables : version de macOS non reconnue. Utilise l'import CSV.");
    }
    const champ = (nom, alias) => (nom && /^[A-Z_0-9]+$/i.test(nom) ? `${nom} AS ${alias}` : `NULL AS ${alias}`);
    const sql =
      `SELECT ${champ(col.address, 'address')}, ${champ(col.date, 'date_raw')}, ` +
      `${champ(col.duration, 'duration')}, ${champ(col.originated, 'originated')}, ` +
      `${champ(col.name, 'name')} FROM ${TABLE_APPELS}`;

    const lignes = conn.db.prepare(sql).all().map((r) => ({
      address: r.address,
      date: bl.dateCoreData(r.date_raw),
      duration: r.duration,
      originated: r.originated,
      name: r.name,
    }));
    return agreger(lignes, { days });
  } finally {
    conn.close();
  }
}

// ---------------------------------------------------------------- secours : CSV d'appels
// Format attendu, souple : une ligne par appel, avec au minimum un numéro et une date.
// (Les exports Android nomment les colonnes « number/date/duration/type ».)
function lireCsv(rows, { days = 1095 } = {}) {
  const trouve = (row, noms) => {
    for (const [k, v] of Object.entries(row)) {
      const kn = sig.norm(k).replace(/[^a-z]/g, '');
      if (noms.some((n) => kn === n || kn.includes(n))) return v;
    }
    return '';
  };
  const lignes = rows.map((row) => {
    const brut = trouve(row, ['number', 'numero', 'telephone', 'phone', 'contact']);
    const dateBrute = String(trouve(row, ['date', 'heure', 'time', 'horodat']) || '');
    let iso = null;
    const ts = Number(dateBrute);
    if (Number.isFinite(ts) && ts > 1e11) iso = new Date(ts).toISOString();          // millisecondes
    else if (Number.isFinite(ts) && ts > 1e9) iso = new Date(ts * 1000).toISOString(); // secondes
    else if (dateBrute) { const d = new Date(dateBrute); if (!Number.isNaN(d.getTime())) iso = d.toISOString(); }
    const type = sig.norm(trouve(row, ['type', 'sens', 'direction']));
    return {
      address: brut,
      date: iso,
      duration: Number(String(trouve(row, ['duration', 'duree'])).replace(/[^\d]/g, '')) || 0,
      originated: /sortant|outgoing|émis|emis|2/.test(type) ? 1 : 0,
      name: trouve(row, ['name', 'nom', 'contactname']),
    };
  });
  return agreger(lignes, { days });
}

module.exports = { chemin, disponible, etatSource, lireBase, lireCsv, agreger, TABLE_APPELS, DUREE_MINIMALE };
