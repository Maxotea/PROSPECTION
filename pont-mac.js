'use strict';
// 🌉 LE PONT : le petit agent qui tourne sur le Mac de Maxime.
//
// Pourquoi il existe : La Chasse hébergée en ligne n'a aucun moyen de voir les
// appels et les conversations WhatsApp, qui vivent dans des fichiers du Mac.
// Cet agent les lit sur place, en lecture seule, et n'envoie que le résultat :
// des compteurs, les mots de travail repérés, et un court extrait pour
// l'accroche. Aucun message n'est recopié, aucune conversation ne part en ligne.
//
// Il ne rentre rien dans le CRM : ce qu'il dépose attend la validation de
// Maxime dans la vue Imports, comme un scan fait à la main.

const fs = require('node:fs');
const path = require('node:path');

const appels = require('./src/importers/appels');
const whatsapp = require('./src/importers/whatsapp');
const { fusionner } = require('./src/importers/fusion');

const FICHIER_CONFIG = path.join(__dirname, 'pont.config.json');

function config() {
  const depuisFichier = fs.existsSync(FICHIER_CONFIG)
    ? JSON.parse(fs.readFileSync(FICHIER_CONFIG, 'utf8'))
    : {};
  const url = String(process.env.CHASSE_URL || depuisFichier.url || '').replace(/\/+$/, '');
  const code = String(process.env.CODE_ACCES || depuisFichier.code || '');
  const jours = Number(process.env.CHASSE_JOURS || depuisFichier.jours || 1095);
  if (!url || !code) {
    throw new Error(
      "Le pont n'est pas configuré. Lance pont-mac.command pour indiquer l'adresse de ta Chasse en ligne et ton mot de passe."
    );
  }
  return { url, code, jours };
}

function lireLeMac(jours) {
  const listes = [];
  const soucis = [];
  try {
    listes.push(appels.lireBase({ days: jours }));
  } catch (e) { soucis.push('appels : ' + e.message); }
  try {
    listes.push(whatsapp.lireBase({ days: jours }).entries);
  } catch (e) { soucis.push('WhatsApp : ' + e.message); }
  return { entrees: fusionner(listes), soucis };
}

async function envoyer({ url, code }, entrees) {
  const reponse = await fetch(`${url}/api/repertoire/pont`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-chasse-acces': code },
    body: JSON.stringify({ entries: entrees }),
  });
  if (reponse.status === 401) throw new Error('Mot de passe refusé : relance pont-mac.command pour le corriger.');
  if (reponse.status === 429) throw new Error('Trop de tentatives : attends quinze minutes.');
  if (!reponse.ok) throw new Error(`La Chasse a répondu ${reponse.status}. Est-elle bien en ligne à cette adresse ?`);
  return reponse.json();
}

async function principal() {
  const cfg = config();
  const { entrees, soucis } = lireLeMac(cfg.jours);
  const horodatage = new Date().toLocaleString('fr-FR');

  for (const s of soucis) console.log(`[${horodatage}] source indisponible, ${s}`);

  if (!entrees.length) {
    console.log(`[${horodatage}] rien de nouveau à envoyer.`);
    return;
  }
  const r = await envoyer(cfg, entrees);
  console.log(`[${horodatage}] ${r.recus} relation(s) envoyées à ${cfg.url}. Elles attendent ta validation dans Imports.`);
}

if (require.main === module) {
  principal().catch((e) => {
    console.error(`[${new Date().toLocaleString('fr-FR')}] ${e.message}`);
    process.exit(1);
  });
}

module.exports = { config, lireLeMac, envoyer, FICHIER_CONFIG };
