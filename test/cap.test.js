'use strict';
// 🧭 Le Cap : le plan de départ entre une fois, les jalons se cochent, les six
// chiffres du lundi et la trajectoire 2027 se calculent depuis le CRM.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'moteur-cap-test-'));
process.env.NODE_ENV = 'test';
const dbApi = require('../src/db');
const cap = require('../src/cap');

test.after(() => { try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

const n = (sql, ...p) => Number(dbApi.get(sql, ...p).n);

test('le plan de départ est semé une fois, dans les cinq horizons', () => {
  const total = n('SELECT COUNT(*) AS n FROM cap_jalons');
  assert.strictEqual(total, cap.PLAN.jalons.length);
  const horizons = cap.listerJalons();
  assert.deepStrictEqual(horizons.map((h) => h.code), ['24h', '48h', 'jours', 'semaines', '2027']);
  for (const h of horizons) assert.ok(h.total > 0, `l'horizon ${h.code} a des jalons`);
  // un second démarrage ne duplique rien
  const cle = cap.PLAN.jalons[0].cle;
  dbApi.run("INSERT OR IGNORE INTO cap_jalons (cle, horizon, titre, created_at, updated_at) VALUES (?, '24h', 'doublon', 'x', 'x')", cle);
  assert.strictEqual(n('SELECT COUNT(*) AS n FROM cap_jalons WHERE cle = ?', cle), 1);
});

test('un jalon se coche, se décoche, s’ajoute et se retire', () => {
  const premier = dbApi.get("SELECT * FROM cap_jalons WHERE horizon = '24h' ORDER BY ordre LIMIT 1");
  const coche = cap.basculerJalon(premier.id);
  assert.strictEqual(coche.fait, 1); assert.ok(coche.fait_le);
  const decoche = cap.basculerJalon(premier.id);
  assert.strictEqual(decoche.fait, 0); assert.strictEqual(decoche.fait_le, '');
  const ajoute = cap.ajouterJalon({ horizon: 'semaines', titre: 'Appeler Amundi', echeance: '2026-11-17' });
  assert.strictEqual(ajoute.cle, null);
  assert.strictEqual(ajoute.echeance, '2026-11-17');
  assert.throws(() => cap.ajouterJalon({ horizon: 'semaines', titre: '   ' }), /Écris le jalon/);
  assert.throws(() => cap.ajouterJalon({ horizon: 'jamais', titre: 'x' }), /Horizon inconnu/);
  cap.supprimerJalon(ajoute.id);
  assert.throws(() => cap.supprimerJalon(ajoute.id), /n'existe plus/);
});

test('le scénario se choisit et change les cibles', () => {
  assert.strictEqual(cap.scenarioCourant(), 'cible');
  cap.choisirScenario('ambitieux');
  assert.strictEqual(cap.trajectoire('2027-02-10').trimestres[0].cible, 32000);
  assert.throws(() => cap.choisirScenario('fou'), /Scénario inconnu/);
  cap.choisirScenario('cible');
  assert.strictEqual(cap.trajectoire('2027-02-10').trimestres[0].cible, 26000);
});

test('les six chiffres du lundi se calculent depuis les rendez-vous et les devis', () => {
  for (const t of ['activities', 'deals', 'contacts']) dbApi.run(`DELETE FROM ${t}`);
  const a = dbApi.insertContact({ first_name: 'Anne', last_name: 'Rapide', company: 'Rapide SA', origin: 'bni' });
  const b = dbApi.insertContact({ first_name: 'Bob', last_name: 'Lent', company: 'Lent SARL' });
  // Anne : rendez-vous mardi, devis le lendemain (sous 48 h), accepté
  dbApi.run("INSERT INTO activities (contact_id, type, note, xp, day, created_at) VALUES (?, 'rdv_pris', '', 0, '2026-11-03', '2026-11-03T10:00:00.000Z')", a.id);
  dbApi.run("INSERT INTO deals (contact_id, title, amount, status, created_at, updated_at) VALUES (?, 'Film', 4000, 'accepte', '2026-11-04T09:00:00.000Z', '2026-11-04T09:00:00.000Z')", a.id);
  // Bob : rendez-vous il y a trois semaines, toujours pas de devis
  dbApi.run("INSERT INTO activities (contact_id, type, note, xp, day, created_at) VALUES (?, 'rdv_pris', '', 0, '2026-10-20', '2026-10-20T10:00:00.000Z')", b.id);
  // un devis envoyé cette semaine (à Anne, Bob n'en a toujours pas), un facturé ce mois
  dbApi.run("INSERT INTO deals (contact_id, title, amount, status, created_at, updated_at) VALUES (?, 'Aftermovie', 3200, 'devis_envoye', '2026-11-09T09:00:00.000Z', '2026-11-09T09:00:00.000Z')", a.id);
  dbApi.run("INSERT INTO deals (contact_id, title, amount, status, invoiced_at, created_at, updated_at) VALUES (?, 'Captation', 1400, 'facture', '2026-11-06T09:00:00.000Z', '2026-10-01T09:00:00.000Z', '2026-11-06T09:00:00.000Z')", a.id);

  const L = cap.sixChiffres('2026-11-10');
  assert.strictEqual(L.semaine_du, '2026-11-09');
  const c = Object.fromEntries(L.chiffres.map((x) => [x.code, x]));
  assert.strictEqual(c.devis_48h.valeur, 50, 'un rendez-vous sur deux a eu son devis sous 48 h');
  assert.strictEqual(c.devis_48h.retard.length, 1);
  assert.strictEqual(c.devis_48h.retard[0].nom, 'Bob Lent');
  assert.strictEqual(c.devis_envoyes.valeur, 3200, 'seul le devis de cette semaine compte');
  assert.strictEqual(c.taux_signature.valeur, 67, 'deux signés (accepté, facturé) sur trois devis en huit semaines');
  assert.strictEqual(c.cash.valeur, 1400);
  assert.ok(c.recommandations.valeur >= 0);
  assert.ok(c.couverture.valeur === null || typeof c.couverture.valeur === 'number');
  for (const x of L.chiffres) assert.ok(['ok', 'alerte', 'vide'].includes(x.etat), `état lisible pour ${x.code}`);
});

test('la trajectoire 2027 additionne le facturé par trimestre et rappelle 2026', () => {
  dbApi.run('DELETE FROM deals');
  const a = dbApi.get('SELECT id FROM contacts LIMIT 1');
  dbApi.run("INSERT INTO deals (contact_id, title, amount, status, invoiced_at, created_at, updated_at) VALUES (?, 'Janvier', 5000, 'facture', '2027-01-15T09:00:00.000Z', '2027-01-10T09:00:00.000Z', '2027-01-15T09:00:00.000Z')", a.id);
  dbApi.run("INSERT INTO deals (contact_id, title, amount, status, invoiced_at, created_at, updated_at) VALUES (?, 'Mars', 7000, 'facture', '2027-03-30T09:00:00.000Z', '2027-03-20T09:00:00.000Z', '2027-03-30T09:00:00.000Z')", a.id);
  dbApi.run("INSERT INTO deals (contact_id, title, amount, status, invoiced_at, created_at, updated_at) VALUES (?, 'Mai', 2000, 'facture', '2027-05-02T09:00:00.000Z', '2027-05-01T09:00:00.000Z', '2027-05-02T09:00:00.000Z')", a.id);
  dbApi.run("INSERT INTO deals (contact_id, title, amount, status, invoiced_at, created_at, updated_at) VALUES (?, 'Fév 2026', 30000, 'facture', '2026-02-10T09:00:00.000Z', '2026-02-01T09:00:00.000Z', '2026-02-10T09:00:00.000Z')", a.id);
  const T = cap.trajectoire('2027-05-10');
  assert.strictEqual(T.trimestres[0].facture, 12000);
  assert.strictEqual(T.trimestres[1].facture, 2000);
  assert.strictEqual(T.trimestres[0].facture_2026, 30000);
  assert.strictEqual(T.trimestres[1].en_cours, true);
  assert.strictEqual(T.trimestres[0].passe, true);
  assert.strictEqual(T.total_facture, 14000);
  assert.strictEqual(T.total_cible, 122500);
  assert.strictEqual(T.facture_2026, 30000);
});

test('les garde-fous calculés voient la concentration et les devis en retard', () => {
  dbApi.run('DELETE FROM deals'); dbApi.run('DELETE FROM activities');
  const a = dbApi.insertContact({ first_name: '', last_name: '', company: 'Leclerc' });
  const b = dbApi.insertContact({ first_name: '', last_name: '', company: 'RAJA' });
  dbApi.run("INSERT INTO deals (contact_id, title, amount, status, invoiced_at, created_at, updated_at) VALUES (?, 'Accompagnement', 38700, 'facture', '2026-06-01T09:00:00.000Z', '2026-06-01T09:00:00.000Z', '2026-06-01T09:00:00.000Z')", a.id);
  dbApi.run("INSERT INTO deals (contact_id, title, amount, status, invoiced_at, created_at, updated_at) VALUES (?, 'VIP', 2000, 'facture', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z')", b.id);
  const G = Object.fromEntries(cap.gardeFous('2026-11-10').map((g) => [g.code, g]));
  assert.strictEqual(G.concentration.etat, 'alerte');
  assert.match(G.concentration.valeur, /Leclerc : 95 %/);
  assert.strictEqual(G.devis_48h.etat, 'vide');
  assert.strictEqual(G.plancher.etat, 'manuel');
});

test('les dates : lundi de la semaine et trimestre', () => {
  assert.strictEqual(cap.lundiDe('2026-11-08'), '2026-11-02', 'un dimanche appartient à la semaine du lundi précédent');
  assert.strictEqual(cap.lundiDe('2026-11-09'), '2026-11-09');
  assert.strictEqual(cap.trimestreDe('2027-03-31'), 'T1');
  assert.strictEqual(cap.trimestreDe('2027-10-01'), 'T4');
});
