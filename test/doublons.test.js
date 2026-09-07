'use strict';
// Le dédoublonnage butait sur les majuscules accentuées : lower() de SQLite ne
// connaît que l'ASCII, alors que toLowerCase() de JavaScript descend tout. Une
// société comme « CCI Paris Île-de-France » était donc recréée à chaque import.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-doublons-test-'));
const dbApi = require('../src/db');

test.after(() => { try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

const vide = () => dbApi.run('DELETE FROM contacts');
const combien = () => Number(dbApi.get('SELECT COUNT(*) AS n FROM contacts').n);

test('une société à majuscule accentuée ne se dédouble pas', () => {
  vide();
  const fiche = { company: 'CCI Paris Île-de-France', notes: 'partenaire' };
  assert.strictEqual(dbApi.upsertContact(fiche).created, true);
  assert.strictEqual(dbApi.upsertContact(fiche).created, false, 'le même import ne doit rien recréer');
  assert.strictEqual(combien(), 1);
});

test('et la casse comme les accents sont ignorés', () => {
  vide();
  dbApi.upsertContact({ company: 'CCI Paris Île-de-France' });
  for (const variante of ['cci paris île-de-france', 'CCI PARIS ILE-DE-FRANCE', 'Cci Paris Ile-De-France']) {
    assert.strictEqual(dbApi.upsertContact({ company: variante }).created, false, `« ${variante} » doit fusionner`);
  }
  assert.strictEqual(combien(), 1);
});

test('un prénom à majuscule accentuée non plus', () => {
  vide();
  const fiche = { first_name: 'Élodie', last_name: 'Ébrard', company: 'Éditions Ouest' };
  assert.strictEqual(dbApi.upsertContact(fiche).created, true);
  assert.strictEqual(dbApi.upsertContact(fiche).created, false);
  assert.strictEqual(combien(), 1);
});

test('mais deux sociétés différentes restent séparées', () => {
  vide();
  dbApi.upsertContact({ company: 'CCI Paris Île-de-France' });
  dbApi.upsertContact({ company: 'CCI Lyon Métropole' });
  assert.strictEqual(combien(), 2);
});

test('et deux personnes de la même boîte ne fusionnent jamais', () => {
  vide();
  dbApi.upsertContact({ first_name: 'Noellie', last_name: 'Faustino', company: 'Paris La Défense' });
  dbApi.upsertContact({ first_name: 'Jean', last_name: 'Durand', company: 'Paris La Défense' });
  // Ni avec la fiche société du même nom.
  dbApi.upsertContact({ company: 'Paris La Défense' });
  assert.strictEqual(combien(), 3);
});
