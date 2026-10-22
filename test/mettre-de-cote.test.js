'use strict';
// « Mettre de côté » : des contacts sortent de la chasse et du brief sans être
// supprimés, se retrouvent avec le filtre « mis de côté », et reviennent d'un clic.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const PORT = 1353;
const BASE = `http://127.0.0.1:${PORT}`;
let serveur, dossier;

function demarrer(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
      cwd: RACINE, env: { ...process.env, NODE_ENV: 'test', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sortie = '';
    const minuteur = setTimeout(() => reject(new Error('démarrage trop long : ' + sortie)), 15000);
    p.stdout.on('data', (c) => { sortie += c; if (sortie.includes('Bonne chasse')) { clearTimeout(minuteur); resolve(p); } });
    p.stderr.on('data', (c) => { sortie += c; });
    p.on('exit', (code) => { clearTimeout(minuteur); reject(new Error(`arrêt immédiat (code ${code}) : ${sortie}`)); });
  });
}
async function api(chemin, { method = 'GET', body } = {}) {
  const r = await fetch(BASE + '/api' + chemin, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (!r.ok) { const e = new Error(data.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return data;
}

test.before(async () => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-cote-'));
  serveur = await demarrer({ DATA_DIR: dossier, PORT: String(PORT), HOST: '127.0.0.1' });
});
test.after(() => {
  if (serveur) serveur.kill();
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('Mettre de côté un lot de contacts : hors chasse, retrouvables, et le retour fonctionne', async () => {
  const ids = [];
  for (const [prenom, societe] of [['Anne', 'Crédit Mutuel Puteaux'], ['Luc', 'Crédit Mutuel Nanterre'], ['Zoé', 'Boulangerie du coin']]) {
    const r = await api('/contacts', { method: 'POST', body: { first_name: prenom, last_name: 'Test', company: societe, next_action_at: '2020-01-01', segment: 'pme' } });
    ids.push((r.contact || r).id);
  }
  const avant = (await api('/queue?limit=50')).queue.map((c) => c.id);
  assert.ok(ids.every((id) => avant.includes(id)), 'les trois sont dans la chasse au départ');

  // Les deux Crédit Mutuel partent de côté, en un seul geste.
  const r = await api('/contacts/bulk', { method: 'POST', body: { ids: ids.slice(0, 2), patch: { archived: 1 } } });
  assert.strictEqual(r.count, 2);
  assert.ok(r.annulation, 'le geste est annulable');

  const apres = (await api('/queue?limit=50')).queue.map((c) => c.id);
  assert.ok(!apres.includes(ids[0]) && !apres.includes(ids[1]), 'plus dans la chasse');
  assert.ok(apres.includes(ids[2]), 'la boulangerie y est toujours');

  const visibles = (await api('/contacts?limit=50')).contacts.map((c) => c.id);
  assert.ok(!visibles.includes(ids[0]), 'plus dans la liste courante');
  const deCote = (await api('/contacts?archived=1&limit=50')).contacts.map((c) => c.id);
  assert.deepStrictEqual(deCote.sort(), ids.slice(0, 2).sort(), 'le filtre « mis de côté » les retrouve');
  const recherche = (await api('/contacts?archived=1&search=Mutuel&limit=50')).contacts;
  assert.strictEqual(recherche.length, 2, 'la recherche marche aussi sur les mis de côté');

  // Retour dans la chasse pour l'un d'eux.
  await api('/contacts/bulk', { method: 'POST', body: { ids: [ids[0]], patch: { archived: 0 } } });
  const retour = (await api('/queue?limit=50')).queue.map((c) => c.id);
  assert.ok(retour.includes(ids[0]), 'revenu dans la chasse');
  assert.ok(!retour.includes(ids[1]), "l'autre reste de côté");

  // Annuler le premier geste remet aussi le second dans la chasse.
  await api(`/annuler/${r.annulation}`, { method: 'POST' });
  const annule = (await api('/queue?limit=50')).queue.map((c) => c.id);
  assert.ok(annule.includes(ids[1]), 'Annuler a tout remis en place');
});

test('Pas maintenant repousse d’un mois et demi, puis trois mois, puis six', async () => {
  const r = await api('/contacts', { method: 'POST', body: { first_name: 'Paul', last_name: 'Report', company: 'Report SA', next_action_at: '2020-01-01' } });
  const id = (r.contact || r).id;
  const jours = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const vus = [];
  for (let i = 0; i < 4; i++) {
    const a = await api('/actions', { method: 'POST', body: { contact_id: id, type: 'reporte' } });
    vus.push(jours(aujourdhui, a.contact.next_action_at));
  }
  assert.deepStrictEqual(vus, [45, 90, 180, 180]);
  const file = (await api('/queue?limit=50')).queue.map((c) => c.id);
  assert.ok(!file.includes(id), 'un contact reporté ne revient pas à la session suivante');
});
