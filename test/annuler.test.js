'use strict';
// Le bouton « Annuler » des confirmations doit remettre l'état EXACT d'avant,
// côté serveur : la tâche avec sa date, le contact avec son étape, l'XP gagnée
// au passage retirée, les devis et l'historique d'un contact effacé revenus
// avec les mêmes numéros. Ces tests passent par les vraies routes HTTP.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const PORT = 1351;
const BASE = `http://127.0.0.1:${PORT}`;
let serveur = null;
let dossier = '';

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
  const r = await fetch(BASE + '/api' + chemin, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) { const e = new Error(data.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return data;
}
const annuler = (jeton) => api(`/annuler/${jeton}`, { method: 'POST' });
const xp = async () => (await api('/state')).xp_total;
const hier = () => { const d = new Date(Date.now() - 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function nouveauContact(champs = {}) {
  const r = await api('/contacts', { method: 'POST', body: { first_name: 'Test', last_name: `N${Math.random().toString(36).slice(2, 7)}`, company: 'Maison Test', ...champs } });
  return r.contact || r;
}

test.before(async () => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-annuler-'));
  serveur = await demarrer({ DATA_DIR: dossier, PORT: String(PORT), HOST: '127.0.0.1' });
});
test.after(() => {
  if (serveur) serveur.kill();
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('Fait sur une tâche, puis Annuler : la tâche revient à faire', async () => {
  const { tache } = await api('/journee/taches', { method: 'POST', body: { texte: 'Monter la vidéo du Loft' } });
  const r = await api('/journee/decision', { method: 'POST', body: { cle: `tache:${tache.id}`, statut: 'fait', titre: tache.texte } });
  assert.ok(r.annulation, 'la réponse porte un jeton de retour');
  let plan = await api('/journee');
  assert.ok(!JSON.stringify(plan.blocs).includes(`tache:${tache.id}`), 'la tâche a quitté la journée');

  await annuler(r.annulation);
  plan = await api('/journee');
  assert.ok(JSON.stringify(plan.blocs).includes(`tache:${tache.id}`), 'la tâche est revenue dans la journée');
});

test('Demain sur une tâche, puis Annuler : la date d’origine revient', async () => {
  const { tache } = await api('/journee/taches', { method: 'POST', body: { texte: 'Appeler le traiteur', echeance: '' } });
  const r = await api('/journee/decision', { method: 'POST', body: { cle: `tache:${tache.id}`, statut: 'plus_tard', jours: 1 } });
  assert.ok(r.jusqu_au, 'reportée à une date');
  await annuler(r.annulation);
  const plan = await api('/journee');
  const tout = Object.values(plan.blocs).flat();
  const revenue = tout.find((it) => it.cle === `tache:${tache.id}`);
  assert.ok(revenue, 'la tâche est revenue');
  assert.strictEqual(revenue.echeance, '', 'sans échéance, comme avant le report');
});

test('Ignorer une tâche l’efface, Annuler la rend avec le même numéro', async () => {
  const { tache } = await api('/journee/taches', { method: 'POST', body: { texte: 'Relire le devis Neolia !!' } });
  const r = await api('/journee/decision', { method: 'POST', body: { cle: `tache:${tache.id}`, statut: 'ignore' } });
  await annuler(r.annulation);
  const plan = await api('/journee');
  const revenue = Object.values(plan.blocs).flat().find((it) => it.cle === `tache:${tache.id}`);
  assert.ok(revenue, 'même numéro de tâche');
  assert.strictEqual(revenue.importance >= 3, true, 'importance d’origine conservée');
});

test('Fait sur une relance compte de l’XP, Annuler la retire et rend la relance', async () => {
  const c = await nouveauContact({ stage: 'contacte' });
  await api(`/contacts/${c.id}`, { method: 'PATCH', body: { next_action: 'Relancer', next_action_at: hier() } });
  const plan = await api('/journee');
  const item = Object.values(plan.blocs).flat().find((it) => it.cle.startsWith(`crm:relance:${c.id}:`));
  assert.ok(item, 'la relance en retard est dans la journée');

  const xpAvant = await xp();
  const r = await api('/journee/decision', { method: 'POST', body: { cle: item.cle, statut: 'fait', titre: item.titre } });
  assert.ok(r.celebration && r.celebration.xp_gained > 0, 'la relance rapporte de l’XP');
  assert.ok((await xp()) > xpAvant);

  await annuler(r.annulation);
  assert.strictEqual(await xp(), xpAvant, 'XP revenue exactement au niveau d’avant');
  const fiche = await api(`/contacts/${c.id}`);
  assert.strictEqual(fiche.contact.next_action_at, hier(), 'la relance est de nouveau due');
  assert.ok(!fiche.activities.some((a) => a.type === 'relance'), 'l’action loggée a disparu de l’historique');
});

test('Changer d’étape puis Annuler : étape et XP d’avant', async () => {
  const c = await nouveauContact();
  const xpAvant = await xp();
  const r = await api(`/contacts/${c.id}`, { method: 'PATCH', body: { stage: 'en_discussion' } });
  assert.strictEqual(r.contact.stage, 'en_discussion');
  await annuler(r.annulation);
  const fiche = await api(`/contacts/${c.id}`);
  assert.strictEqual(fiche.contact.stage, 'a_contacter');
  assert.strictEqual(await xp(), xpAvant);
  assert.strictEqual(fiche.activities.length, 0, 'aucune trace du changement');
});

test('Supprimer un contact puis Annuler : fiche, devis et historique reviennent', async () => {
  const c = await nouveauContact({ email: 'claire@exemple.fr' });
  const { deal } = await api('/deals', { method: 'POST', body: { contact_id: c.id, title: 'Aftermovie', amount: 2400, status: 'devis_envoye' } });
  const avant = await api(`/contacts/${c.id}`);
  assert.ok(avant.activities.length > 0);

  const r = await api(`/contacts/${c.id}`, { method: 'DELETE' });
  await assert.rejects(() => api(`/contacts/${c.id}`), /introuvable/i);

  await annuler(r.annulation);
  const apres = await api(`/contacts/${c.id}`);
  assert.strictEqual(apres.contact.email, 'claire@exemple.fr');
  assert.deepStrictEqual(apres.deals.map((d) => d.id), [deal.id], 'le devis revient avec son numéro');
  assert.deepStrictEqual(apres.activities.map((a) => a.id), avant.activities.map((a) => a.id), 'historique complet');
});

test('Suppression groupée puis Annuler : tous les contacts reviennent', async () => {
  const a = await nouveauContact();
  const b = await nouveauContact();
  const r = await api('/contacts/bulk', { method: 'POST', body: { ids: [a.id, b.id], action: 'delete' } });
  assert.strictEqual(r.count, 2);
  await annuler(r.annulation);
  for (const c of [a, b]) assert.strictEqual((await api(`/contacts/${c.id}`)).contact.last_name, c.last_name);
});

test('Devis passé en facturé puis Annuler : statut, boss et XP d’avant', async () => {
  const c = await nouveauContact();
  const { deal } = await api('/deals', { method: 'POST', body: { contact_id: c.id, title: 'Film', amount: 5000, status: 'brouillon' } });
  const etat = await api('/state');
  const r = await api(`/deals/${deal.id}`, { method: 'PATCH', body: { status: 'facture' } });
  assert.strictEqual(r.deal.status, 'facture');
  await annuler(r.annulation);
  const apres = await api('/state');
  assert.strictEqual(apres.boss.count, etat.boss.count, 'le boss n’a pas pris de coup');
  assert.strictEqual(apres.xp_total, etat.xp_total);
  const fiche = await api(`/contacts/${c.id}`);
  assert.strictEqual(fiche.deals[0].status, 'brouillon');
  assert.strictEqual(fiche.contact.stage, 'a_contacter');
});

test('Disqualifier en Chasse puis Annuler : le prospect revient dans la course', async () => {
  const c = await nouveauContact();
  const r = await api('/actions', { method: 'POST', body: { contact_id: c.id, type: 'disqualifie' } });
  assert.strictEqual(r.contact.stage, 'perdu');
  await annuler(r.annulation);
  assert.strictEqual((await api(`/contacts/${c.id}`)).contact.stage, 'a_contacter');
});

test('Supprimer une campagne puis Annuler : campagne, séquence et templates reviennent', async () => {
  const { presets } = await api('/campaign_presets');
  const secteur = presets[0].code;
  const { campaign } = await api('/campaigns', { method: 'POST', body: { sector: secteur, week_start: '2030-01-07' } });
  const avant = (await api('/campaigns')).campaigns.find((x) => x.id === campaign.id);
  const r = await api(`/campaigns/${campaign.id}`, { method: 'DELETE' });
  assert.ok(!(await api('/campaigns')).campaigns.some((x) => x.id === campaign.id));
  await annuler(r.annulation);
  const apres = (await api('/campaigns')).campaigns.find((x) => x.id === campaign.id);
  assert.ok(apres, 'la campagne est revenue');
  assert.strictEqual(apres.sequence_id, avant.sequence_id, 'avec sa séquence');
  const seqs = (await api('/sequences')).sequences;
  const seq = seqs.find((s) => s.id === avant.sequence_id);
  assert.ok(seq && seq.steps.length > 0, 'la séquence a retrouvé ses étapes');
});

test('Un retour en arrière ne sert qu’une fois, et le dit clairement', async () => {
  const { tache } = await api('/journee/taches', { method: 'POST', body: { texte: 'Envoyer la facture' } });
  const r = await api(`/journee/taches/${tache.id}`, { method: 'DELETE' });
  await annuler(r.annulation);
  await assert.rejects(() => annuler(r.annulation), (e) => e.status === 410 && /plus possible/.test(e.message) && /Corrige/.test(e.message));
});
