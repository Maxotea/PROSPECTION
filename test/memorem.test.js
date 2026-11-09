'use strict';
// 🤝 Les dossiers partagés avec Memorem : la propal ne se relance jamais toute seule.
// La règle J+3 vaut pour les clients où OTEA est seul sur le dossier.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'moteur-memorem-test-'));
process.env.NODE_ENV = 'test';
const dbApi = require('../src/db');
const playbooks = require('../src/playbooks');
const game = require('../src/gamification');
const journee = require('../src/journee');
const cockpit = require('../src/cockpit');
const autopilot = require('../src/autopilot');
playbooks.seedTemplates(dbApi);
playbooks.seedSequences(dbApi);

test.after(() => { try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

const today = dbApi.localDay();
const il_y_a = (j) => new Date(Date.now() - j * 86400000).toISOString();
function vider() { for (const t of ['activities', 'deals', 'enrollments', 'contacts']) dbApi.run(`DELETE FROM ${t}`); }

test('qui est un dossier partagé : le drapeau de la fiche, ou un tag memorem', () => {
  assert.strictEqual(playbooks.dossierPartage({ partage_memorem: 1 }), true);
  assert.strictEqual(playbooks.dossierPartage({ partage_memorem: 0, tags: '["bni"]' }), false);
  assert.strictEqual(playbooks.dossierPartage({ partage_memorem: 0, tags: '["golf", "Memorem"]' }), true);
  assert.strictEqual(playbooks.dossierPartage({ tags: ['co-traitance'] }), true);
  assert.strictEqual(playbooks.dossierPartage({ tags: 'pas du json' }), false);
  assert.strictEqual(playbooks.dossierPartage(null), false);
});

test('devis envoyé : J+3 quand OTEA est seul, aucune relance programmée quand Memorem est dans la boucle', () => {
  const seul = playbooks.nextStepAfter({ stage: 'devis_envoye', partage_memorem: 0 }, 'devis_envoye', 1, dbApi);
  assert.strictEqual(seul.next_action, 'Relancer le devis');
  assert.strictEqual(seul.next_action_at, dbApi.addDays(today, 3), 'la propal se relance à J+3');
  const partage = playbooks.nextStepAfter({ stage: 'devis_envoye', partage_memorem: 1 }, 'devis_envoye', 1, dbApi);
  assert.match(partage.next_action, /Memorem/);
  assert.strictEqual(partage.next_action_at, '', 'pas de date : rien ne part tout seul');
});

test('la fiche garde le drapeau, à la création, à la modification et au rapprochement', () => {
  vider();
  const c = dbApi.insertContact({ first_name: 'Lou', last_name: 'Golf', company: 'Off Golf', email: 'lou@offgolf.fr', partage_memorem: true });
  assert.strictEqual(dbApi.get('SELECT partage_memorem AS p FROM contacts WHERE id = ?', c.id).p, 1);
  dbApi.updateContact(c.id, { partage_memorem: 0 });
  assert.strictEqual(dbApi.get('SELECT partage_memorem AS p FROM contacts WHERE id = ?', c.id).p, 0);
  // un import qui retrouve la même personne pose le drapeau, et ne le retire jamais
  dbApi.upsertContact({ first_name: 'Lou', last_name: 'Golf', email: 'lou@offgolf.fr', partage_memorem: 1 });
  assert.strictEqual(dbApi.get('SELECT partage_memorem AS p FROM contacts WHERE id = ?', c.id).p, 1);
  dbApi.upsertContact({ first_name: 'Lou', last_name: 'Golf', email: 'lou@offgolf.fr', partage_memorem: 0 });
  assert.strictEqual(dbApi.get('SELECT partage_memorem AS p FROM contacts WHERE id = ?', c.id).p, 1);
});

test('logger un devis envoyé programme la relance pour OTEA seul, pas pour un dossier partagé', () => {
  vider();
  const seul = dbApi.insertContact({ first_name: 'Anne', last_name: 'Seule', company: 'Seule SA', email: 'a@seule.fr', stage: 'rdv' });
  const partage = dbApi.insertContact({ first_name: 'Guillaume', last_name: 'Partage', company: 'Bellefontaine', email: 'g@belle.fr', stage: 'rdv', partage_memorem: 1 });
  game.logAction({ contact_id: seul.id, type: 'devis_envoye', note: 'Film' });
  game.logAction({ contact_id: partage.id, type: 'devis_envoye', note: 'Film' });
  const a = dbApi.get('SELECT * FROM contacts WHERE id = ?', seul.id);
  const b = dbApi.get('SELECT * FROM contacts WHERE id = ?', partage.id);
  assert.strictEqual(a.stage, 'devis_envoye'); assert.strictEqual(a.next_action_at, dbApi.addDays(today, 3));
  assert.strictEqual(b.stage, 'devis_envoye'); assert.strictEqual(b.next_action_at, '');
  assert.match(b.next_action, /Memorem/);
});

test('la journée et le Cockpit ne demandent pas de relancer un devis partagé', () => {
  vider();
  const seul = dbApi.insertContact({ first_name: 'Anne', last_name: 'Seule', company: 'Seule SA', email: 'a@seule.fr', stage: 'devis_envoye' });
  const partage = dbApi.insertContact({ first_name: 'Guillaume', last_name: 'Partage', company: 'Bellefontaine', email: 'g@belle.fr', stage: 'devis_envoye', partage_memorem: 1 });
  const vieux = il_y_a(12);
  dbApi.run(`INSERT INTO deals (contact_id, title, amount, status, created_at, updated_at) VALUES (?, 'Film', 4800, 'devis_envoye', ?, ?)`, seul.id, vieux, vieux);
  dbApi.run(`INSERT INTO deals (contact_id, title, amount, status, created_at, updated_at) VALUES (?, 'Golf', 9000, 'devis_envoye', ?, ?)`, partage.id, vieux, vieux);

  const items = journee.signauxCrm(today).filter((i) => i.cle.startsWith('crm:devis:'));
  assert.strictEqual(items.length, 1, 'un seul devis à relancer');
  assert.strictEqual(items[0].actions[0].id, seul.id, 'celui où OTEA est seul');

  const A = cockpit.argent(today);
  assert.strictEqual(A.devis_en_cours.n, 2, 'les deux devis attendent bien une réponse');
  assert.strictEqual(A.devis_en_cours.a_relancer, 1, 'un seul est à relancer : celui où OTEA est seul');
  const ligne = A.devis_en_cours.lignes.find((l) => l.contact_id === partage.id);
  assert.strictEqual(ligne.partage, true); assert.strictEqual(ligne.a_relancer, false);
});

test('les files de prospection et l’Autopilote laissent le devis partagé tranquille', () => {
  vider();
  const seul = dbApi.insertContact({ first_name: 'Anne', last_name: 'Seule', company: 'Seule SA', email: 'a@seule.fr', phone: '0600000001', stage: 'devis_envoye', next_action: 'Relancer le devis', next_action_at: today });
  const partage = dbApi.insertContact({ first_name: 'Guillaume', last_name: 'Partage', company: 'Bellefontaine', email: 'g@belle.fr', phone: '0600000002', stage: 'devis_envoye', next_action: 'Relancer le devis', next_action_at: today, partage_memorem: 1 });
  const manuel = dbApi.insertContact({ first_name: 'Lou', last_name: 'Manuelle', company: 'Off Golf', email: 'l@offgolf.fr', phone: '0600000003', stage: 'devis_envoye', next_action: 'Appeler Lou pour caler la relance', next_action_at: today, partage_memorem: 1 });
  const chasse = game.huntQueue(20).map((c) => c.id);
  const appels = game.callQueue(20).map((c) => c.id);
  assert.ok(chasse.includes(seul.id) && appels.includes(seul.id), 'le devis OTEA seul est à relancer');
  assert.ok(!chasse.includes(partage.id) && !appels.includes(partage.id), 'la relance automatique du devis partagé ne revient pas');
  assert.ok(chasse.includes(manuel.id) && appels.includes(manuel.id), 'une action posée à la main reste servie');

  const seq = dbApi.get('SELECT id FROM sequences ORDER BY id LIMIT 1');
  const r = autopilot.enroll(seq.id, [seul.id, partage.id]);
  assert.strictEqual(r.enrolled, 1);
  assert.strictEqual(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /Memorem/);
});
