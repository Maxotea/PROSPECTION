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

// ---------------------------------------------------------------- projets longs
const { addDays } = dbApi;

test('Statut : une semaine dure sept jours, un projet dure jusqu’à sa date de fin', () => {
  const today = localDay();
  assert.strictEqual(campaigns.campaignStatus({ week_start: addDays(today, -21), ends_on: '' }), 'terminee');
  assert.strictEqual(campaigns.campaignStatus({ week_start: addDays(today, -21), ends_on: addDays(today, 60) }), 'en_cours');
  assert.strictEqual(campaigns.campaignStatus({ week_start: addDays(today, -21), ends_on: today }), 'en_cours'); // dernier jour inclus
  assert.strictEqual(campaigns.campaignStatus({ week_start: addDays(today, -21), ends_on: addDays(today, -1) }), 'terminee');
  assert.strictEqual(campaigns.campaignStatus({ week_start: addDays(today, 7), ends_on: addDays(today, 60) }), 'a_venir');
});

let projet;

test('Projet sponsoring HYROX : kit écrit pour chercher des partenaires, cadence J0 → J+5 → J+12', () => {
  projet = campaigns.createCampaign({ sector: 'sponsoring_hyrox', week_start: localDay(), ends_on: addDays(localDay(), 200) });
  assert.strictEqual(projet.name, '🏋️ Sponsoring HYROX · Pierre & Antoine'); // pas de « semaine du »
  assert.strictEqual(projet.ends_on, addDays(localDay(), 200));
  assert.match(projet.sn_recipe, /sponsoring/);

  const steps = all('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_index', projet.sequence_id);
  assert.deepStrictEqual(steps.map((s) => s.delay_days), [0, 5, 7]);

  const t1 = get('SELECT * FROM templates WHERE code = ?', `camp_${projet.id}_1`);
  assert.match(t1.body, /Pierre Huiban et Antoine Bouhana/);
  assert.match(t1.body, /doubles pro hommes 35-39/);
  assert.match(t1.body, /Hong Kong/);
  assert.match(t1.body, /\{prenom\}/);
  assert.match(t1.body, /\{accroche\}/);
  assert.ok(!/ce qu'on a fait pour/.test(t1.subject), 'le kit sponsoring ne reprend pas le pitch vidéo');
  const t2 = get('SELECT * FROM templates WHERE code = ?', `camp_${projet.id}_2`);
  assert.match(t2.body, /Partenaire principal/);
  assert.match(t2.body, /La Poste|Puteaux/); // les références servent de preuve de production
  assert.match(projet.post_draft, /Pierre et Antoine/);
  assert.match(projet.dm_draft, /\{entreprise\}/);

  const liste = campaigns.listCampaigns();
  const moi = liste.find((c) => c.id === projet.id);
  assert.strictEqual(moi.kind, 'projet');
  assert.strictEqual(moi.status, 'en_cours');
  assert.strictEqual(moi.cadence, 'J0 → J+5 → J+12');
  assert.strictEqual(liste.find((c) => c.id === camp.id).kind, 'semaine');
  assert.strictEqual(liste.find((c) => c.id === camp.id).cadence, 'J0 → J+4 → J+10');
});

test('Un projet ne s’ouvre qu’une fois tant qu’il court, et sa date de fin est vérifiée', () => {
  assert.throws(() => campaigns.createCampaign({ sector: 'sponsoring_hyrox', week_start: localDay() }), /déjà ouvert/);
  assert.throws(() => campaigns.createCampaign({ sector: 'sponsoring_hyrox', week_start: localDay(), ends_on: 'demain' }), /AAAA-MM-JJ/);
  assert.throws(() => campaigns.createCampaign({ sector: 'sponsoring_hyrox', week_start: localDay(), ends_on: addDays(localDay(), -30) }), /avant de commencer/);
  assert.strictEqual(Number(get('SELECT COUNT(*) AS n FROM campaigns').n), 2); // la semaine + le projet, rien de plus
});

test('La campagne mise en avant : la semaine en cours, sinon le projet encore ouvert', () => {
  assert.strictEqual(campaigns.currentCampaign().id, camp.id); // la semaine thématique de cette semaine passe devant
  run('UPDATE campaigns SET week_start = ? WHERE id = ?', addDays(campaigns.mondayOf(localDay()), -21), camp.id); // elle a trois semaines : terminée
  const cur = campaigns.currentCampaign();
  assert.strictEqual(cur.id, projet.id);
  assert.strictEqual(cur.status, 'en_cours');
  assert.strictEqual(cur.kind, 'projet');
});

test('Le kit d’un projet n’a ni tiret cadratin ni jargon de vente vidéo', () => {
  const preset = campaigns.PRESETS.sponsoring_hyrox;
  const kit = campaigns.buildKit(preset, preset.persona, [], { company_name: 'OTEA Production', booking_url: 'https://cal.example/otea' });
  const textes = [...kit.emails.flatMap((e) => [e.subject, e.body]), kit.post, kit.dm];
  for (const t of textes) {
    assert.ok(!t.includes(String.fromCharCode(0x2014)), `tiret cadratin : ${t.slice(0, 80)}`);
    assert.ok(!/film « immersion »|8-12 réels/.test(t), 'le gabarit vente vidéo a fuité dans le kit sponsoring');
  }
  assert.match(kit.emails[0].body, /cal\.example\/otea/); // le lien agenda est repris
  assert.match(kit.emails[1].body, /des marques et collectivités françaises/); // sans référence : formule générique
});
