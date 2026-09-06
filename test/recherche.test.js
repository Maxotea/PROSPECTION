'use strict';
// La barre de recherche des Contacts passe par LIKE en SQL, où « % » et « _ »
// sont des jokers. Tapés par Maxime (« 100% vidéo », « jean_pierre »), ils
// doivent chercher ces caractères, pas renvoyer tout le fichier.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const PORT = 1347;
const BASE = `http://127.0.0.1:${PORT}`;

let serveur = null;
let dossier = '';

function demarrer(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
      cwd: RACINE,
      env: { ...process.env, ...env, NODE_ENV: 'test' },
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

const creer = (contact) => fetch(BASE + '/api/contacts', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(contact),
});
const chercher = async (texte) => (await (await fetch(`${BASE}/api/contacts?search=${encodeURIComponent(texte)}`)).json()).contacts;

test.before(async () => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-recherche-'));
  serveur = await demarrer({ DATA_DIR: dossier, PORT: String(PORT), HOST: '127.0.0.1' });
  await creer({ first_name: 'Claire', last_name: 'Arnaud', company: 'Maison Arnaud' });
  await creer({ first_name: 'Jean_Pierre', last_name: 'Roux', company: 'Studio 100% Vidéo' });
  await creer({ first_name: 'Jeanne', last_name: 'Pierre', company: 'Agence Vidéo' });
});

test.after(() => {
  if (serveur) serveur.kill();
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('« % » tapé dans la recherche cherche un pourcentage, pas tout le monde', async () => {
  const trouves = await chercher('100%');
  assert.deepStrictEqual(trouves.map((c) => c.company), ['Studio 100% Vidéo']);

  const seul = await chercher('%');
  assert.strictEqual(seul.length, 1, 'un « % » seul ne doit pas renvoyer tout le fichier');
});

test('« _ » cherche un tiret bas, et non « n’importe quel caractère »', async () => {
  const trouves = await chercher('jean_pierre');
  assert.deepStrictEqual(trouves.map((c) => c.first_name), ['Jean_Pierre'], 'Jeanne Pierre ne doit pas remonter');
});

test('la recherche ordinaire reste large : prénom, nom, boîte, sans tenir compte de la casse', async () => {
  assert.strictEqual((await chercher('arnaud')).length, 1);
  assert.strictEqual((await chercher('vidéo')).length, 2);
});

test('aucune étape ne porte deux fois son emoji', () => {
  // L'interface affiche toujours « emoji + libellé » : un emoji dans le libellé
  // se retrouve en double (« 🏆 Gagné 🏆 »).
  const { STAGES } = require('../src/playbooks');
  for (const s of STAGES) assert.ok(!s.label.includes(s.emoji), `étape ${s.code} : le libellé « ${s.label} » répète l'emoji`);
});
