'use strict';
// La reprise des absences enregistrées comme de vraies réponses avant reponse-auto.js.

process.env.DATA_DIR = require('node:path').join(require('node:os').tmpdir(), `chasse-test-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const dbApi = require('../src/db');
const { get, run, nowIso, insertContact, getSetting } = dbApi;
const game = require('../src/gamification');
const migration = require('../src/migrations/reponses-auto');

// Reproduit ce que faisait l'Autopilote avant la correction : réponse, action, demande.
function ancienneReponse(contact, uid, subject) {
  run('INSERT INTO replies (imap_uid, contact_id, from_email, subject, received_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    uid, contact.id, contact.email, subject, nowIso(), nowIso());
  game.logAction({ contact_id: contact.id, type: 'reponse_recue', note: `🤖 Réponse détectée : « ${subject} »`, meta: { auto: true, imap_uid: uid } });
  run('INSERT INTO inbox (contact_id, source, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    contact.id, 'gmail-auto', `📬 ${contact.first_name} a répondu : objet : « ${subject} ». Ouvre Gmail pour lire le message et propose un call !`, 'nouveau', nowIso(), nowIso());
}

test('Reprise : une absence enregistrée comme réponse redevient une relance', () => {
  const absente = insertContact({ first_name: 'Claire', last_name: 'Absente', company: 'Conseil SA', email: 'claire@conseil.test', stage: 'contacte' });
  ancienneReponse(absente, 501, 'Réponse automatique : Idée contenu vidéo pour Conseil SA');
  assert.strictEqual(get('SELECT stage, next_action FROM contacts WHERE id = ?', absente.id).next_action, 'Répondre et proposer un RDV');

  const reel = insertContact({ first_name: 'Paul', last_name: 'Present', company: 'Sport SAS', email: 'paul@sport.test', stage: 'contacte' });
  ancienneReponse(reel, 502, 'Re: Une idée de vidéo pour Sport SAS');

  const bilan = migration.migrer(dbApi);
  assert.strictEqual(bilan.reponses, 1);
  assert.deepStrictEqual(bilan.fiches, ['Claire Absente (Conseil SA)']);

  const c = get('SELECT * FROM contacts WHERE id = ?', absente.id);
  assert.strictEqual(c.next_action, migration.ACTION_RELANCER);
  assert.strictEqual(c.stage, 'contacte');
  assert.strictEqual(get(`SELECT COUNT(*) AS n FROM activities WHERE contact_id = ? AND type = 'reponse_recue'`, absente.id).n, 0);
  assert.strictEqual(get(`SELECT status FROM inbox WHERE contact_id = ?`, absente.id).status, 'automatique');
  assert.strictEqual(get('SELECT automatique FROM replies WHERE imap_uid = 501').automatique, 1);

  // Une vraie réponse ne bouge pas.
  const h = get('SELECT * FROM contacts WHERE id = ?', reel.id);
  assert.strictEqual(h.next_action, 'Répondre et proposer un RDV');
  assert.strictEqual(h.stage, 'en_discussion');
  assert.strictEqual(get(`SELECT status FROM inbox WHERE contact_id = ?`, reel.id).status, 'nouveau');

  assert.strictEqual(getSetting(migration.DRAPEAU), '1');
  assert.deepStrictEqual(migration.migrer(dbApi), { deja_fait: true });
});
