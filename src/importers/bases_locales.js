'use strict';
// 💾 BASES LOCALES : lecture des historiques stockés sur le Mac de Maxime.
// Rien ne sort de la machine : on ouvre les fichiers en LECTURE SEULE, on agrège,
// on jette le reste. Aucun message n'est recopié dans la base de la Chasse
// (seul un court extrait sert d'accroche, et seulement si tu importes le contact).
//
// Deux difficultés traitées ici :
//  1. macOS protège ces dossiers (« Accès complet au disque ») → erreur traduite en clair.
//  2. Les fichiers sont ouverts par iPhone/WhatsApp (mode WAL) → on travaille sur une copie.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Core Data compte les secondes depuis le 1er janvier 2001, pas depuis 1970.
const EPOCH_2001 = 978307200;
function dateCoreData(v) {
  const n = Number(v);
  if (!n || !Number.isFinite(n)) return null;
  const sec = n > 1e11 ? n / 1e9 : n; // certaines colonnes sont en nanosecondes
  const ms = (sec + EPOCH_2001) * 1000;
  if (ms < 0 || ms > Date.now() + 86400000) return null;
  return new Date(ms).toISOString();
}

const HOME = os.homedir();

const CHEMINS_APPELS = [
  path.join(HOME, 'Library/Application Support/CallHistoryDB/CallHistory.storedata'),
];
const CHEMINS_WHATSAPP = [
  path.join(HOME, 'Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite'),
  path.join(HOME, 'Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/ChatStorage.sqlite'),
  path.join(HOME, 'Library/Containers/net.whatsapp.WhatsApp/Data/Library/Application Support/ChatStorage.sqlite'),
];

function trouverFichier(chemins) {
  for (const c of chemins) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* absent ou interdit */ }
  }
  return null;
}

// macOS refuse l'accès tant que le Terminal n'a pas l'« Accès complet au disque ».
// On veut que Maxime lise une phrase, pas un code d'erreur Unix.
function estRefusMacos(err) {
  return !!err && (err.code === 'EPERM' || err.code === 'EACCES' || /operation not permitted/i.test(err.message || ''));
}

const ERREUR_ACCES = 'macOS bloque la lecture de ce fichier. Ouvre Réglages Système → Confidentialité et sécurité → Accès complet au disque, active « Terminal » (ou l’app qui lance la Chasse), puis relance la Chasse.';

// Copie du fichier + de son journal WAL : indispensable, la base d'origine est
// ouverte en écriture par le système et une lecture directe renvoie des données tronquées.
function copieTravail(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-'));
  const dest = path.join(dir, path.basename(src));
  fs.copyFileSync(src, dest);
  for (const suffixe of ['-wal', '-shm']) {
    try { fs.copyFileSync(src + suffixe, dest + suffixe); } catch { /* pas de WAL, tant mieux */ }
  }
  return { dest, dir };
}

function ouvrirLecture(src) {
  let travail = null;
  try {
    travail = copieTravail(src);
    const db = new DatabaseSync(travail.dest, { readOnly: true });
    return {
      db,
      close() {
        try { db.close(); } catch { /* déjà fermée */ }
        try { fs.rmSync(travail.dir, { recursive: true, force: true }); } catch { /* rien à nettoyer */ }
      },
    };
  } catch (err) {
    if (travail) { try { fs.rmSync(travail.dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    if (estRefusMacos(err)) throw new Error(ERREUR_ACCES);
    throw new Error(`Fichier illisible (${path.basename(src)}) : ${err.message}`);
  }
}

// Les noms de colonnes changent d'une version de macOS / de WhatsApp à l'autre.
// On lit le schéma réel et on prend la première colonne qui existe vraiment.
function colonnes(db, table) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => String(c.name)); } catch { return []; }
}
function choisirColonne(dispo, candidates) {
  return candidates.find((c) => dispo.includes(c)) || null;
}
function tableExiste(db, table) {
  return !!db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

// Les numéros de téléphone sont parfois stockés en BLOB (suite d'octets ASCII).
function texte(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) return Buffer.from(v).toString('utf8').replace(/\0/g, '').trim();
  return String(v);
}

module.exports = {
  EPOCH_2001, dateCoreData, HOME,
  CHEMINS_APPELS, CHEMINS_WHATSAPP, ERREUR_ACCES,
  trouverFichier, estRefusMacos, ouvrirLecture, copieTravail,
  colonnes, choisirColonne, tableExiste, texte,
};
