'use strict';
// Tests du moteur de campagnes hebdo thématiques.

process.env.DATA_DIR = require('node:path').join(require('node:os').tmpdir(), `chasse-camp-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const dbApi = require('../src/db');
const { get, all, run, localDay } = dbApi;
const playbooks = require('../src/playbooks');
const game = require('../src/gamification');
const campaigns = require('../src/campaigns');

playbooks.seedTemplates(dbApi);
playbooks.seedSequences(dbApi);
campaigns.seedReferences();

let camp;

test('Références : seedées avec drapeaux « à vérifier »', () => {
  const refs = all('SELECT * FROM refs');
  assert.ok(refs.length >= 10);
  const galec = get(`SELECT * FROM refs WHERE code = 'galec'`);
  assert.match(galec.name, /Galec/);
  assert.strictEqual(galec.verified, 1);
  const raiff = get(`SELECT * FROM refs WHERE code = 'raiff'`);
  assert.strictEqual(raiff.verified, 0); // orthographe incertaine → à corriger dans l'UI
});

test('Création de campagne : séquence + templates avec références bakées + kit', () => {
  camp = campaigns.createCampaign({ sector: 'grande_distribution', week_start: localDay() });
  assert.match(camp.name, /Grande distribution/);
  assert.strictEqual(camp.week_start, campaigns.mondayOf(localDay()));
  assert.ok(camp.sequence_id > 0);
  assert.match(camp.sn_recipe, /Sales Navigator/);

  const steps = all('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_index', camp.sequence_id);
  assert.strictEqual(steps.length, 3);
  assert.deepStrictEqual(steps.map((s) => s.delay_days), [0, 4, 6]); // J0, J+4, J+10

  const t1 = get('SELECT * FROM templates WHERE code = ?', `camp_${camp.id}_1`);
  assert.match(t1.body, /Galec/); // référence phare citée dans l'email
  assert.match(t1.body, /\{prenom\}/); // variables contact préservées
  assert.strictEqual(t1.campaign_id, camp.id);
  assert.match(camp.post_draft, /Galec|E\.Leclerc/);
  assert.match(camp.dm_draft, /\{prenom\}/);

  // Les templates de campagne ne polluent pas la bibliothèque générale.
  const generic = all('SELECT * FROM templates WHERE campaign_id = 0');
  assert.ok(generic.every((t) => !t.code.startsWith('camp_')));
});

test('Une seule campagne par secteur et par semaine', () => {
  assert.throws(() => campaigns.createCampaign({ sector: 'grande_distribution', week_start: localDay() }), /existe déjà/);
});

test('Import de contacts rattachés + enrôlement de toute la campagne', () => {
  const c1 = dbApi.upsertContact({ first_name: 'Anne', last_name: 'Test', company: 'HyperTest', email: 'anne@hypertest.fr', campaign_id: camp.id, origin: 'linkedin' });
  const c2 = dbApi.upsertContact({ first_name: 'Luc', last_name: 'SansMail', company: 'RetailCo', campaign_id: camp.id, origin: 'linkedin' });
  assert.strictEqual(c1.contact.campaign_id, camp.id);

  const res = campaigns.enrollAll(camp.id);
  assert.strictEqual(res.enrolled, 1); // Luc écarté : pas d'email
  assert.strictEqual(res.skipped.length, 1);

  const cur = campaigns.currentCampaign();
  assert.strictEqual(cur.id, camp.id);
  assert.strictEqual(cur.status, 'en_cours');
  assert.strictEqual(cur.stats.contacts, 2);
  assert.strictEqual(cur.stats.avec_email, 1);
  assert.strictEqual(cur.stats.enrolled, 1);
});

test('Une réponse d’un contact campagne remonte dans les stats', () => {
  const anne = get(`SELECT * FROM contacts WHERE email = 'anne@hypertest.fr'`);
  game.logAction({ contact_id: anne.id, type: 'reponse_recue', note: 'test' });
  const cur = campaigns.currentCampaign();
  assert.strictEqual(cur.stats.replies, 1);
});
