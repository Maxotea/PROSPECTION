'use strict';
// L'app passe d'un Mac fermé à clé à une adresse publique sur internet.
// Ces tests vérifient ce qui protège vraiment : le mot de passe, le blocage des
// essais répétés, le cookie, et la sauvegarde des données.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const RACINE = path.join(__dirname, '..');
const MOT_DE_PASSE = 'ChasseAuxClients2026';
const PORT = 1339;
const BASE = `http://127.0.0.1:${PORT}`;

let serveur = null;
let dossier = '';

function demarrer(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
      cwd: RACINE,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sortie = '';
    const minuteur = setTimeout(() => reject(new Error('démarrage trop long : ' + sortie)), 15000);
    p.stdout.on('data', (c) => {
      sortie += c;
      if (sortie.includes('Bonne chasse')) { clearTimeout(minuteur); resolve(p); }
    });
    p.stderr.on('data', (c) => { sortie += c; });
    p.on('exit', (code) => { clearTimeout(minuteur); reject(new Error(`arrêt immédiat (code ${code}) : ${sortie}`)); });
  });
}

test.before(async () => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-heberge-'));
  serveur = await demarrer({ DATA_DIR: dossier, PORT: String(PORT), HOST: '127.0.0.1', CODE_ACCES: MOT_DE_PASSE });
});

test.after(() => {
  if (serveur) serveur.kill();
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('sans mot de passe, rien n’est accessible', async () => {
  const page = await fetch(BASE + '/');
  assert.strictEqual(page.status, 401);
  const html = await page.text();
  assert.match(html, /Entre ton mot de passe/, 'la page parle de mot de passe, pas du code de la fenêtre noire');

  const api = await fetch(BASE + '/api/contacts');
  assert.strictEqual(api.status, 401);
  const corps = await api.json();
  assert.match(corps.error, /mot de passe/i);
});

test('le contrôle de santé répond sans mot de passe', async () => {
  // Sinon l'hébergeur croit l'app en panne et la redémarre en boucle.
  const r = await fetch(BASE + '/sante');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await r.text(), 'ok');
});

test('le bon mot de passe ouvre, et le cookie ne le contient pas', async () => {
  const r = await fetch(BASE + '/acces', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-proto': 'https' },
    body: 'code=' + encodeURIComponent(MOT_DE_PASSE),
    redirect: 'manual',
  });
  assert.strictEqual(r.status, 302);
  const cookie = r.headers.get('set-cookie') || '';
  assert.match(cookie, /chasse_acces=/);
  assert.ok(!cookie.includes(MOT_DE_PASSE), 'le mot de passe ne doit jamais voyager dans le cookie');
  assert.match(cookie, /HttpOnly/, 'illisible par un script de page');
  assert.match(cookie, /Secure/, 'transmis uniquement en connexion chiffrée');

  // Et ce cookie donne bien accès.
  const jeton = cookie.split(';')[0];
  const api = await fetch(BASE + '/api/contacts', { headers: { cookie: jeton } });
  assert.strictEqual(api.status, 200);
});

test('cinq essais ratés et l’adresse est mise en pause', async () => {
  const essai = (mdp) => fetch(BASE + '/acces', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.7' },
    body: 'code=' + encodeURIComponent(mdp),
    redirect: 'manual',
  });

  for (let i = 0; i < 5; i++) {
    const r = await essai('mauvais' + i);
    assert.strictEqual(r.status, 401, `essai ${i + 1} refusé`);
  }
  const bloquee = await essai('encore-faux');
  assert.strictEqual(bloquee.status, 429, 'au-delà de cinq essais, on met en pause');
  assert.match(await bloquee.text(), /Trop d’essais/);

  // Même le bon mot de passe attend : c'est le principe.
  const bonMaisBloque = await essai(MOT_DE_PASSE);
  assert.strictEqual(bonMaisBloque.status, 429);
});

test('la sauvegarde rend une vraie base de données lisible', async () => {
  const ouvre = await fetch(BASE + '/acces', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'code=' + encodeURIComponent(MOT_DE_PASSE),
    redirect: 'manual',
  });
  const jeton = (ouvre.headers.get('set-cookie') || '').split(';')[0];

  const r = await fetch(BASE + '/api/sauvegarde', { headers: { cookie: jeton } });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /attachment; filename="la-chasse-\d{4}-\d{2}-\d{2}\.db"/);

  const fichier = path.join(dossier, 'telecharge.db');
  fs.writeFileSync(fichier, Buffer.from(await r.arrayBuffer()));

  // Le vrai test : la copie s'ouvre et contient bien les tables de l'app.
  const copie = new DatabaseSync(fichier, { readOnly: true });
  const tables = copie.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  copie.close();
  for (const attendue of ['contacts', 'templates', 'settings', 'activities']) {
    assert.ok(tables.includes(attendue), `la sauvegarde contient la table ${attendue}`);
  }
});

test('en ligne sans mot de passe, l’app refuse de démarrer', async () => {
  // Mieux vaut ne pas démarrer que s'ouvrir grand aux quatre vents.
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-nu-'));
  await assert.rejects(
    () => demarrer({ DATA_DIR: bac, PORT: String(PORT + 1), HOST: '127.0.0.1', EN_LIGNE: '1', CODE_ACCES: 'court' }),
    /MOT DE PASSE MANQUANT OU TROP COURT|arrêt immédiat/,
  );
  fs.rmSync(bac, { recursive: true, force: true });
});

test('le déménagement : une sauvegarde se restaure sur une autre Chasse', async () => {
  // Le parcours réel de Maxime : sa Chasse tourne sur son Mac, il télécharge sa
  // sauvegarde, et la remet dans la version en ligne qui démarre vide.
  const jetonDe = async (base, mdp) => {
    const r = await fetch(base + '/acces', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=' + encodeURIComponent(mdp),
      redirect: 'manual',
    });
    return (r.headers.get('set-cookie') || '').split(';')[0];
  };

  // La Chasse « du Mac », avec un contact dedans.
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-source-'));
  const portSource = PORT + 5;
  const baseSource = `http://127.0.0.1:${portSource}`;
  const srv = await demarrer({ DATA_DIR: source, PORT: String(portSource), HOST: '127.0.0.1', CODE_ACCES: MOT_DE_PASSE });
  const jSource = await jetonDe(baseSource, MOT_DE_PASSE);
  await fetch(baseSource + '/api/contacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: jSource },
    body: JSON.stringify({ first_name: 'Karim', last_name: 'Slimani', company: 'K-Fit Coaching' }),
  });
  const sauvegarde = Buffer.from(await (await fetch(baseSource + '/api/sauvegarde', { headers: { cookie: jSource } })).arrayBuffer());
  srv.kill();
  fs.rmSync(source, { recursive: true, force: true });

  // La Chasse « en ligne » démarre vide, puis reçoit la sauvegarde.
  const jeton = await jetonDe(BASE, MOT_DE_PASSE);
  const avant = await (await fetch(BASE + '/api/contacts', { headers: { cookie: jeton } })).json();

  const r = await fetch(BASE + '/api/restauration', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', cookie: jeton },
    body: sauvegarde,
  });
  assert.strictEqual(r.status, 200);
  assert.match((await r.json()).message, /redémarre/);

  // Elle se coupe pour repartir sur la nouvelle base : c'est le comportement voulu.
  await new Promise((res) => setTimeout(res, 1500));
  assert.notStrictEqual(serveur.exitCode, null, 'l’app se relance pour charger la sauvegarde');

  // L'ancienne base a bien été mise de côté avant d'être remplacée.
  assert.ok(fs.existsSync(path.join(dossier, 'prospection.db.avant-restauration')), 'filet de sécurité en place');

  // Et la base en place est maintenant celle de la sauvegarde.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dossier, 'prospection.db'), { readOnly: true });
  const noms = db.prepare('SELECT last_name FROM contacts').all().map((c) => c.last_name);
  db.close();
  assert.ok(noms.includes('Slimani'), `contact déménagé (avant : ${avant.total} contact(s), après : ${noms.join(', ')})`);
});

test('un fichier qui n’est pas une sauvegarde est refusé', async () => {
  // Le serveur précédent s'est arrêté volontairement : on en relance un propre.
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-refus-'));
  const port = PORT + 6;
  const srv = await demarrer({ DATA_DIR: bac, PORT: String(port), HOST: '127.0.0.1', CODE_ACCES: MOT_DE_PASSE });
  const r0 = await fetch(`http://127.0.0.1:${port}/acces`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'code=' + encodeURIComponent(MOT_DE_PASSE),
    redirect: 'manual',
  });
  const jeton = (r0.headers.get('set-cookie') || '').split(';')[0];

  const r = await fetch(`http://127.0.0.1:${port}/api/restauration`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', cookie: jeton },
    body: Buffer.alloc(4096, 0x41), // 4 Ko de « A », tout sauf une base
  });
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /n'est pas une sauvegarde/);

  srv.kill();
  fs.rmSync(bac, { recursive: true, force: true });
});
