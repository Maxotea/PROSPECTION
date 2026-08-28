'use strict';
// 💬 WHATSAPP : les conversations pro noyées dans les conversations perso.
//
// Deux façons de lire :
//  1. L'app WhatsApp installée sur le Mac range ses discussions dans un fichier
//     SQLite local : on le lit en entier, d'un coup, en lecture seule.
//  2. Sinon, WhatsApp sait exporter UNE conversation en .txt
//     (ouvrir la discussion → nom du contact → « Exporter la discussion » →
//     « Sans les médias ») : on colle le fichier ici.
//
// Dans les deux cas on ne garde que des COMPTEURS, les mots-clés de travail
// repérés, et un extrait de la dernière réponse (pour l'accroche). Le reste
// des messages n'est jamais recopié.

const path = require('node:path');
const bl = require('./bases_locales');
const sig = require('./signaux');

const TABLE_SESSIONS = 'ZWACHATSESSION';
const TABLE_MESSAGES = 'ZWAMESSAGE';

const LONGUEUR_EXTRAIT = 160;
const MAX_TEXTE_ANALYSE = 20000; // on ne scanne pas 10 ans de blagues pour trouver « devis »

function chemin() {
  return bl.trouverFichier(bl.CHEMINS_WHATSAPP);
}
function disponible() {
  return !!chemin();
}

function etatSource() {
  return bl.chercher(bl.CHEMINS_WHATSAPP).etat;
}

// '33611223344@s.whatsapp.net' → '+33611223344' ; les groupes finissent par '@g.us'.
function jidVersTelephone(jid) {
  const s = String(jid || '');
  if (!s || s.includes('@g.us')) return '';
  const num = s.split('@')[0].replace(/\D/g, '');
  if (!num) return '';
  return sig.normPhone(num.startsWith('0') ? num : '+' + num);
}
const estGroupe = (jid) => String(jid || '').includes('@g.us');

function extrait(texte) {
  const t = String(texte || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > LONGUEUR_EXTRAIT ? t.slice(0, LONGUEUR_EXTRAIT - 1).trim() + '…' : t;
}

// ---------------------------------------------------------------- base locale du Mac
function lireBase({ days = 1095 } = {}) {
  const { chemin: src, etat } = bl.chercher(bl.CHEMINS_WHATSAPP);
  if (!src) {
    throw new Error(bl.expliquerAbsence(etat, 'tes discussions WhatsApp',
      "WhatsApp pour Mac est introuvable sur cet ordinateur, ou ses discussions ne sont pas encore descendues du téléphone. Ouvre WhatsApp sur le Mac, laisse-le se synchroniser une minute, puis relance le scan. Sinon, exporte une conversation en .txt et dépose-la ici."
    ));
  }
  const conn = bl.ouvrirLecture(src);
  try {
    if (!bl.tableExiste(conn.db, TABLE_SESSIONS)) {
      throw new Error(`Le fichier ${path.basename(src)} n'a pas le format attendu (table ${TABLE_SESSIONS} absente).`);
    }
    const dispoS = bl.colonnes(conn.db, TABLE_SESSIONS);
    const colS = {
      pk: bl.choisirColonne(dispoS, ['Z_PK']),
      jid: bl.choisirColonne(dispoS, ['ZCONTACTJID', 'ZJID']),
      nom: bl.choisirColonne(dispoS, ['ZPARTNERNAME', 'ZCONTACTNAME']),
      last: bl.choisirColonne(dispoS, ['ZLASTMESSAGEDATE']),
      compteur: bl.choisirColonne(dispoS, ['ZMESSAGECOUNTER']),
    };
    if (!colS.pk || !colS.jid) throw new Error("Format WhatsApp non reconnu : utilise l'export .txt d'une conversation.");

    const champ = (nom, alias) => (nom && /^[A-Z_0-9]+$/i.test(nom) ? `${nom} AS ${alias}` : `NULL AS ${alias}`);
    const sessions = conn.db.prepare(
      `SELECT ${champ(colS.pk, 'pk')}, ${champ(colS.jid, 'jid')}, ${champ(colS.nom, 'nom')}, ` +
      `${champ(colS.last, 'last_raw')}, ${champ(colS.compteur, 'compteur')} FROM ${TABLE_SESSIONS}`
    ).all();

    // Les messages sont optionnels : sans eux on garde compteurs et dates de session.
    const avecMessages = bl.tableExiste(conn.db, TABLE_MESSAGES);
    let stmtMsg = null, colM = {};
    if (avecMessages) {
      const dispoM = bl.colonnes(conn.db, TABLE_MESSAGES);
      colM = {
        session: bl.choisirColonne(dispoM, ['ZCHATSESSION']),
        fromMe: bl.choisirColonne(dispoM, ['ZISFROMME']),
        date: bl.choisirColonne(dispoM, ['ZMESSAGEDATE']),
        texte: bl.choisirColonne(dispoM, ['ZTEXT']),
      };
      if (colM.session && colM.date) {
        stmtMsg = conn.db.prepare(
          `SELECT ${champ(colM.fromMe, 'from_me')}, ${champ(colM.date, 'date_raw')}, ${champ(colM.texte, 'texte')} ` +
          `FROM ${TABLE_MESSAGES} WHERE ${colM.session} = ? ORDER BY ${colM.date} DESC LIMIT 500`
        );
      }
    }

    const limite = Date.now() - days * 86400000;
    const sorties = [];
    let groupes = 0;

    for (const s of sessions) {
      const jid = bl.texte(s.jid);
      if (estGroupe(jid)) { groupes++; continue; } // un groupe n'est pas un contact : rien à appeler
      const phone = jidVersTelephone(jid);
      if (!phone || sig.estNumeroDeService(phone)) continue;

      let last = bl.dateCoreData(s.last_raw);
      let messages = Math.max(0, Number(s.compteur) || 0);
      let incoming = 0, outgoing = 0, texteAnalyse = '', dernierEntrant = '';

      if (stmtMsg) {
        const msgs = stmtMsg.all(s.pk);
        messages = messages || msgs.length;
        for (const m of msgs) {
          const d = bl.dateCoreData(m.date_raw);
          if (d && (!last || d > last)) last = d;
          const t = bl.texte(m.texte);
          if (Number(m.from_me) === 1) outgoing++; else {
            incoming++;
            if (!dernierEntrant && t) dernierEntrant = t; // messages triés du + récent au + ancien
          }
          if (t && texteAnalyse.length < MAX_TEXTE_ANALYSE) texteAnalyse += ' ' + t;
        }
      }

      if (!last || new Date(last).getTime() < limite) continue;

      const nom = bl.texte(s.nom).trim();
      if (sig.ressembleAuBruit({ nom, texte: texteAnalyse.slice(0, 2000), phone })) continue;

      sorties.push({
        source: 'whatsapp', key: 'wa:' + (sig.phoneKey(phone) || jid),
        name: nom, phone,
        calls: 0, messages, incoming, outgoing, duration_sec: 0,
        last_at: last, first_at: null,
        signaux: sig.motsBusinessTrouves(texteAnalyse),
        excerpt: extrait(dernierEntrant),
      });
    }
    return { entries: sorties, groupes };
  } finally {
    conn.close();
  }
}

// ---------------------------------------------------------------- secours : export .txt
// WhatsApp exporte selon la langue et le système :
//   [03/12/2024 14:32:11] Claire Arnaud : Salut
//   03/12/2024 à 14:32 - Claire Arnaud : Salut
//   [3/12/24, 2:32:11 PM] Claire Arnaud: Hi
// Le fichier est truffé de marques de direction invisibles : on nettoie avant de lire.
const LIGNE = new RegExp(
  '^\\[?\\s*(\\d{1,2})[\\/.](\\d{1,2})[\\/.](\\d{2,4})' +   // date
  '(?:,|\\s)+(?:à\\s+)?(\\d{1,2}):(\\d{2})(?::(\\d{2}))?' + // heure
  '\\s*([APap]\\.?[Mm]\\.?)?\\s*\\]?' +                     // AM/PM éventuel
  '\\s*[-–—]?\\s*' +
  '([^:]{1,80}?)\\s*:\\s?' +                                // expéditeur
  '([\\s\\S]*)$'                                            // message
);

function nettoyer(texte) {
  return String(texte || '')
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, '') // marques de direction invisibles
    .replace(/[\u00a0\u202f]/g, ' ')                     // espaces insécables (français)
    .replace(/\r\n?/g, '\n');
}

function parseExport(texteBrut, { moi = '', days = 3650 } = {}) {
  const lignes = nettoyer(texteBrut).split('\n');
  const messages = [];
  let jourMax = 0, moisMax = 0;

  for (const ligne of lignes) {
    const m = LIGNE.exec(ligne);
    if (!m) { // suite d'un message sur plusieurs lignes
      if (messages.length && ligne.trim()) messages[messages.length - 1].texte += ' ' + ligne.trim();
      continue;
    }
    const [, a, b, an, h, min, sec, ampm, auteur, corps] = m;
    jourMax = Math.max(jourMax, Number(a));
    moisMax = Math.max(moisMax, Number(b));
    messages.push({ a: Number(a), b: Number(b), an, h: Number(h), min: Number(min), sec: Number(sec || 0), ampm, auteur: auteur.trim(), texte: corps.trim() });
  }
  if (!messages.length) {
    throw new Error("Aucun message reconnu. Vérifie que c'est bien le fichier .txt exporté par WhatsApp (« Exporter la discussion » → « Sans les médias »).");
  }

  // Jour/mois ou mois/jour ? Un nombre > 12 tranche ; sinon on suppose le format français.
  const moisEnDeuxieme = moisMax > 12 ? false : true;

  const iso = (msg) => {
    const jour = moisEnDeuxieme ? msg.a : msg.b;
    const mois = moisEnDeuxieme ? msg.b : msg.a;
    let an = Number(msg.an);
    if (an < 100) an += 2000;
    let h = msg.h;
    if (msg.ampm) {
      const pm = /p/i.test(msg.ampm);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    const d = new Date(an, mois - 1, jour, h, msg.min, msg.sec);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  // Qui est Maxime dans ce fichier ? Celui dont le nom correspond aux réglages,
  // sinon celui qui a écrit le dernier message reste indéterminé et on demande.
  const auteurs = [...new Set(messages.map((m) => m.auteur))].filter(Boolean);
  const normMoi = sig.norm(moi);
  let monNom = auteurs.find((a) => normMoi && sig.norm(a).includes(normMoi));
  if (!monNom && auteurs.length === 2 && normMoi) {
    const autre = auteurs.find((a) => !sig.norm(a).includes(normMoi));
    monNom = auteurs.find((a) => a !== autre) || '';
  }

  const parAuteur = new Map();
  for (const msg of messages) {
    if (!parAuteur.has(msg.auteur)) parAuteur.set(msg.auteur, []);
    parAuteur.get(msg.auteur).push(msg);
  }

  const limite = Date.now() - days * 86400000;
  const entries = [];
  for (const [auteur, liste] of parAuteur) {
    if (monNom && auteur === monNom) continue;         // c'est toi
    if (!monNom && auteurs.length === 2 && auteur === auteurs[0] && sig.norm(auteurs[0]) === normMoi) continue;

    const dates = liste.map(iso).filter(Boolean).sort();
    const last = dates[dates.length - 1] || null;
    if (!last || new Date(last).getTime() < limite) continue;

    // Dans un tête-à-tête, on analyse LES DEUX CÔTÉS : si c'est toi qui as écrit
    // « je te prépare un devis », le signal commercial compte quand même.
    // Dans un groupe, surtout pas : tes messages seraient attribués à chacun et
    // tout le monde hériterait du vocabulaire d'une discussion qui ne le concerne pas.
    const teteATete = auteurs.length <= 2;
    const mesLignes = teteATete && monNom ? (parAuteur.get(monNom) || []) : [];
    const texteAnalyse = [...liste, ...mesLignes].map((m) => m.texte).join(' ').slice(0, MAX_TEXTE_ANALYSE);
    const mesMessages = mesLignes.length;
    const telephone = /^\+?[\d\s.-]{9,}$/.test(auteur) ? sig.normPhone(auteur) : '';

    entries.push({
      source: 'whatsapp', key: 'wa:' + (sig.phoneKey(telephone) || sig.norm(auteur).replace(/\s+/g, '-')),
      name: telephone ? '' : auteur,
      phone: telephone,
      calls: 0,
      messages: liste.length + mesMessages,
      incoming: liste.length,
      outgoing: mesMessages,
      duration_sec: 0,
      last_at: last, first_at: dates[0] || null,
      signaux: sig.motsBusinessTrouves(texteAnalyse),
      excerpt: extrait(liste[liste.length - 1] && liste[liste.length - 1].texte),
    });
  }
  return { entries, auteurs, monNom: monNom || '' };
}

module.exports = {
  chemin, disponible, etatSource, lireBase, parseExport, nettoyer,
  jidVersTelephone, estGroupe, extrait,
  TABLE_SESSIONS, TABLE_MESSAGES,
};
