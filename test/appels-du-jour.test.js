'use strict';
// La liste d'appels du jour ne doit proposer que des gens qu'il est temps
// d'appeler. Le bug signalé par Maxime : après avoir appelé quelqu'un, il le
// retrouvait dans la liste le lendemain.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-appels-test-'));

const dbApi = require('../src/db');
const game = require('../src/gamification');

test.after(() => { try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

function creer(nom, extra = {}) {
  return dbApi.insertContact({
    first_name: nom, last_name: 'Test', phone: '06 11 22 33 4' + nom.length,
    segment: 'pme', stage: 'a_contacter', ...extra,
  });
}

test('un contact jamais appelé est proposé', () => {
  creer('Claire');
  const file = game.callQueue(10);
  assert.strictEqual(file.length, 1);
  assert.strictEqual(file[0].first_name, 'Claire');
});

test('appelé aujourd’hui, il sort de la liste du jour', () => {
  const file = game.callQueue(10);
  game.logAction({ contact_id: file[0].id, type: 'appel', note: 'répondeur' });
  assert.strictEqual(game.callQueue(10).length, 0);
});

test('et il ne revient PAS le lendemain : sa relance est programmée', () => {
  // Le coeur du bug. On avance la date du jour au lendemain en regardant ce que
  // la file proposerait : le contact appelé hier a une prochaine action dans le
  // futur, il doit rester en dehors.
  const fiche = dbApi.get('SELECT * FROM contacts WHERE first_name = ?', 'Claire');
  assert.notStrictEqual(fiche.next_action_at, '', 'un appel programme bien la suite');
  assert.ok(fiche.next_action_at > dbApi.localDay(), `relance dans le futur (${fiche.next_action_at})`);

  // On simule le lendemain en effaçant la trace « appelé aujourd'hui » :
  // seule la date de prochaine action doit encore le protéger.
  dbApi.run("DELETE FROM activities WHERE type = 'appel'");
  assert.strictEqual(game.callQueue(10).length, 0, 'toujours pas proposé le lendemain');
});

test('le jour venu, il revient', () => {
  const fiche = dbApi.get('SELECT * FROM contacts WHERE first_name = ?', 'Claire');
  dbApi.updateContact(fiche.id, { next_action_at: dbApi.localDay() });
  const file = game.callQueue(10);
  assert.strictEqual(file.length, 1);
  assert.strictEqual(file[0].first_name, 'Claire');
});

test('un contact gagné ou perdu ne revient jamais', () => {
  const fiche = dbApi.get('SELECT * FROM contacts WHERE first_name = ?', 'Claire');
  dbApi.updateContact(fiche.id, { stage: 'gagne' });
  assert.strictEqual(game.callQueue(10).length, 0);
  dbApi.updateContact(fiche.id, { stage: 'perdu' });
  assert.strictEqual(game.callQueue(10).length, 0);
});

test('les deux listes racontent la même histoire', () => {
  // Mode Chasse et Appels du jour appliquaient deux règles différentes, d'où
  // l'incohérence. Sur un même contact dû, les deux doivent le proposer.
  dbApi.run("DELETE FROM contacts");
  const id = creer('Karim');
  dbApi.updateContact(id.id !== undefined ? id.id : id, { next_action_at: dbApi.localDay(), stage: 'contacte' });

  const dansAppels = game.callQueue(10).map((c) => c.first_name);
  const dansChasse = game.huntQueue(20).map((c) => c.first_name);
  assert.ok(dansAppels.includes('Karim'));
  assert.ok(dansChasse.includes('Karim'));

  // Et repoussé au mois prochain, il disparaît des deux.
  const fiche = dbApi.get('SELECT * FROM contacts WHERE first_name = ?', 'Karim');
  dbApi.updateContact(fiche.id, { next_action_at: dbApi.addDays(dbApi.localDay(), 30) });
  assert.ok(!game.callQueue(10).some((c) => c.first_name === 'Karim'));
  assert.ok(!game.huntQueue(20).some((c) => c.first_name === 'Karim'));
});
