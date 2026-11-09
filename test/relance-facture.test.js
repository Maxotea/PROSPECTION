'use strict';
// ✉️ Relance de facture depuis Pilotage : un texte préparé, jamais envoyé.
// Trois tons selon le retard, vouvoiement par défaut, signé Maxime.

process.env.DATA_DIR = require('node:path').join(require('node:os').tmpdir(), `moteur-relance-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const dbApi = require('../src/db');
const { run, get, insertContact } = dbApi;
const pilotage = require('../src/pilotage');

const TODAY = '2026-11-09';
const vider = () => { for (const t of ['pieces', 'journee_taches', 'contacts']) run(`DELETE FROM ${t}`); };
const facture = (b = {}) => pilotage.creerPiece({ client: 'Raja', numero: 'F-2026-042', montant_ttc: 1200, date: '2026-09-01', echeance: '2026-10-01', ...b });

test('trois niveaux selon le retard', () => {
  assert.strictEqual(pilotage.niveauRelance(0), 'courtoise');
  assert.strictEqual(pilotage.niveauRelance(14), 'courtoise');
  assert.strictEqual(pilotage.niveauRelance(15), 'ferme');
  assert.strictEqual(pilotage.niveauRelance(45), 'ferme');
  assert.strictEqual(pilotage.niveauRelance(46), 'derniere');

  const base = { id: 1, client: 'Raja', numero: 'F-1', montant_ttc: 1200, reste_du: 1200, date: '2026-08-01' };
  const c = pilotage.texteRelance({ ...base, echeance: '2026-11-01' }, { today: TODAY });
  assert.strictEqual(c.niveau, 'courtoise');
  assert.strictEqual(c.retard, 8);
  const f = pilotage.texteRelance({ ...base, echeance: '2026-10-15' }, { today: TODAY });
  assert.strictEqual(f.niveau, 'ferme');
  const d = pilotage.texteRelance({ ...base, echeance: '2026-09-01' }, { today: TODAY });
  assert.strictEqual(d.niveau, 'derniere');
  assert.match(d.sujet, /Dernière relance/);
  assert.match(d.corps, /recouvrement/);
  // Pas encore échue : relance courtoise, sans jours de retard.
  const pas = pilotage.texteRelance({ ...base, echeance: '2026-11-20' }, { today: TODAY });
  assert.strictEqual(pas.niveau, 'courtoise');
  assert.strictEqual(pas.retard, 0);
  assert.match(pas.corps, /à régler pour le 20\/11\/2026/);
});

test('le texte reprend la facture et est signé Maxime', () => {
  const r = pilotage.texteRelance({ id: 1, client: 'Raja', numero: 'F-2026-042', montant_ttc: 1200, reste_du: 1200, date: '2026-09-01', echeance: '2026-10-01' }, { today: TODAY });
  assert.match(r.corps, /F-2026-042/);
  assert.match(r.corps, /1 200,00 € TTC/);
  assert.match(r.corps, /01\/09\/2026/);
  assert.match(r.corps, /39 jours de retard/);
  assert.match(r.corps, /Maxime Dietrich\nOTEA Production$/);
  assert.strictEqual(r.tache, 'Relancer Raja (facture F-2026-042)');
});

test('aucun tiret cadratin ni demi-cadratin, aucun caractère invisible', () => {
  for (const echeance of ['2026-11-20', '2026-11-01', '2026-10-15', '2026-09-01']) {
    for (const tutoiement of [true, false]) {
      const r = pilotage.texteRelance({ id: 1, client: 'Raja', numero: 'F-1', montant_ttc: 1500, reste_du: 500, date: '2026-08-01', echeance }, { today: TODAY, tutoiement });
      const tout = `${r.sujet}\n${r.corps}\n${r.tache}`;
      assert.ok(!/[\u2013\u2014]/.test(tout), `tiret dans : ${tout}`);
      assert.ok(!/[\u00a0\u202f\u200b-\u200f]/.test(tout), 'caractère invisible');
    }
  }
});

test('vouvoiement par défaut, tutoiement si le contact porte l’étiquette', () => {
  vider();
  const p = facture();
  let r = pilotage.relancePiece(p.id, { today: TODAY });
  assert.strictEqual(r.tutoiement, false);
  assert.match(r.corps, /vous/);
  assert.match(r.corps, /^Bonjour,/);

  const c = insertContact({ first_name: 'Julie', last_name: 'Martin', company: 'Raja', email: 'julie@raja.fr', tags: JSON.stringify(['client', 'tutoiement']) });
  run('UPDATE pieces SET contact_id = ? WHERE id = ?', c.id, p.id);
  r = pilotage.relancePiece(p.id, { today: TODAY });
  assert.strictEqual(r.tutoiement, true);
  assert.match(r.corps, /^Bonjour Julie,/);
  assert.match(r.corps, /\bte\b|\btoi\b|\bton\b/);
  assert.ok(!/\bvous\b/.test(r.corps), r.corps);
  assert.strictEqual(r.email, 'julie@raja.fr');

  // Maxime peut forcer le vouvoiement depuis la fenêtre.
  r = pilotage.relancePiece(p.id, { today: TODAY, tutoiement: false });
  assert.strictEqual(r.tutoiement, false);
  assert.match(r.corps, /\bvous\b/);
});

test('email inconnu : relance quand même, sans destinataire', () => {
  vider();
  const p = facture();
  const r = pilotage.relancePiece(p.id, { today: TODAY });
  assert.strictEqual(r.email, '');
  const c = insertContact({ first_name: 'Paul', company: 'Raja' });
  run('UPDATE pieces SET contact_id = ? WHERE id = ?', c.id, p.id);
  const r2 = pilotage.relancePiece(p.id, { today: TODAY });
  assert.strictEqual(r2.email, '');
  assert.match(r2.corps, /^Bonjour Paul,/);
});

test('une facture payée ou un devis ne se relance pas', () => {
  vider();
  const p = facture({ statut: 'payee' });
  assert.throws(() => pilotage.relancePiece(p.id, { today: TODAY }), /plus à encaisser/);
  const d = pilotage.creerPiece({ type: 'devis', client: 'Raja', montant_ht: 1000 });
  assert.throws(() => pilotage.relancePiece(d.id, { today: TODAY }), /Seule une facture/);
  assert.throws(() => pilotage.relancePiece(999999, { today: TODAY }), /n’existe plus/);
});

test('ajouter à Ma journée crée la tâche du jour, une seule fois', () => {
  vider();
  const p = facture();
  const a = pilotage.tacheRelance(p.id, { today: TODAY });
  assert.strictEqual(a.deja, false);
  assert.strictEqual(a.tache.texte, 'Relancer Raja (facture F-2026-042)');
  assert.strictEqual(a.tache.echeance, TODAY);
  assert.strictEqual(a.tache.statut, 'a_faire');
  const b = pilotage.tacheRelance(p.id, { today: TODAY });
  assert.strictEqual(b.deja, true);
  assert.strictEqual(b.tache.id, a.tache.id);
  assert.strictEqual(get('SELECT COUNT(*) AS n FROM journee_taches').n, 1);
});
