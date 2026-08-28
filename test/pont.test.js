'use strict';
// Le pont relie le Mac (qui seul voit les appels et WhatsApp) à La Chasse
// hébergée. Ce qu'on vérifie : le dépôt exige le mot de passe, les relations
// attendent la validation au lieu d'entrer toutes seules, et elles quittent la
// file d'attente une fois importées.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const MOT_DE_PASSE = 'PontVersLeMac2026';
const PORT = 1341;
const BASE = `http://127.0.0.1:${PORT}`;

let serveur = null;
let dossier = '';

const RELATION = {
  source: 'whatsapp', sources: ['appels', 'whatsapp'], key: 'wa:611223344',
  name: 'Claire Arnaud', phone: '+33611223344',
  calls: 3, messages: 42, incoming: 20, outgoing: 22, duration_sec: 900,
  last_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  signaux: ['devis', 'tournage'], excerpt: 'On relance le projet ?',
};

test.before(() => new Promise((resolve, reject) => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-pont-'));
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: RACINE,
    env: { ...process.env, DATA_DIR: dossier, PORT: String(PORT), HOST: '127.0.0.1', CODE_ACCES: MOT_DE_PASSE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let sortie = '';
  const minuteur = setTimeout(() => reject(new Error('démarrage trop long : ' + sortie)), 15000);
  p.stdout.on('data', (c) => {
    sortie += c;
    if (sortie.includes('Bonne chasse')) { clearTimeout(minuteur); serveur = p; resolve(); }
  });
  p.stderr.on('data', (c) => { sortie += c; });
}));

test.after(() => {
  if (serveur) serveur.kill();
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch { /* ignore */ }
});

const deposer = (code, entries) => fetch(BASE + '/api/repertoire/pont', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-chasse-acces': code, 'x-forwarded-for': '198.51.100.4' },
  body: JSON.stringify({ entries }),
});

test('sans le bon mot de passe, le pont est refusé', async () => {
  const r = await deposer('pas-le-bon', [RELATION]);
  assert.strictEqual(r.status, 401);
});

test('le pont dépose les relations, elles attendent la validation', async () => {
  const r = await deposer(MOT_DE_PASSE, [RELATION]);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { recus: 1 });

  // Rien n'est entré dans le CRM tout seul : c'est la règle.
  const ouvre = await fetch(BASE + '/acces', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'code=' + encodeURIComponent(MOT_DE_PASSE),
    redirect: 'manual',
  });
  const jeton = (ouvre.headers.get('set-cookie') || '').split(';')[0];
  const contacts = await (await fetch(BASE + '/api/contacts', { headers: { cookie: jeton } })).json();
  assert.strictEqual(contacts.total, 0, 'aucun contact créé sans validation');

  // Mais le scan les propose.
  const scan = await (await fetch(BASE + '/api/repertoire/scan', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: jeton }, body: '{}',
  })).json();
  assert.strictEqual(scan.depuis_le_mac, 1);
  assert.strictEqual(scan.entries.length, 1);
  assert.strictEqual(scan.entries[0].name, 'Claire Arnaud');
  assert.ok(scan.entries[0].score > 0, 'la note de relation est calculée');
});

test('un deuxième envoi met la relation à jour au lieu de la dupliquer', async () => {
  await deposer(MOT_DE_PASSE, [{ ...RELATION, messages: 99 }]);
  const ouvre = await fetch(BASE + '/acces', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'code=' + encodeURIComponent(MOT_DE_PASSE),
    redirect: 'manual',
  });
  const jeton = (ouvre.headers.get('set-cookie') || '').split(';')[0];
  const scan = await (await fetch(BASE + '/api/repertoire/scan', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: jeton }, body: '{}',
  })).json();
  assert.strictEqual(scan.entries.length, 1, 'toujours une seule fiche');
  assert.strictEqual(scan.entries[0].messages, 99, 'avec les chiffres les plus récents');
});

test('une fois validée, la relation quitte la file d’attente', async () => {
  const ouvre = await fetch(BASE + '/acces', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'code=' + encodeURIComponent(MOT_DE_PASSE),
    redirect: 'manual',
  });
  const jeton = (ouvre.headers.get('set-cookie') || '').split(';')[0];

  const imp = await (await fetch(BASE + '/api/repertoire/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: jeton },
    body: JSON.stringify({ entries: [{ ...RELATION, messages: 99 }] }),
  })).json();
  assert.strictEqual(imp.created, 1);

  const scan = await (await fetch(BASE + '/api/repertoire/scan', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: jeton }, body: '{}',
  })).json();
  assert.strictEqual(scan.depuis_le_mac, 0, 'la file est vidée de ce qui a été validé');

  const contacts = await (await fetch(BASE + '/api/contacts', { headers: { cookie: jeton } })).json();
  assert.strictEqual(contacts.total, 1);
  assert.strictEqual(contacts.contacts[0].last_name, 'Arnaud');
});

test('l’agent du Mac refuse de partir sans configuration', () => {
  const pont = require('../pont-mac');
  const memoire = { ...process.env };
  delete process.env.CHASSE_URL;
  delete process.env.CODE_ACCES;
  const existait = fs.existsSync(pont.FICHIER_CONFIG);
  try {
    if (!existait) assert.throws(() => pont.config(), /pas configuré/);
  } finally {
    Object.assign(process.env, memoire);
  }
});
