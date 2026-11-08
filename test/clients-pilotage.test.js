'use strict';
// 📈 Résultats clients et 🧭 Pilotage : les chiffres doivent être justes,
// parce qu'ils partent chez le client (ROI) et pilotent la trésorerie.

process.env.DATA_DIR = require('node:path').join(require('node:os').tmpdir(), `moteur-clients-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const dbApi = require('../src/db');
const { run, localDay, addDays } = dbApi;
const clients = require('../src/clients');
const pilotage = require('../src/pilotage');

const TIRET = '\u2014';
const vider = () => { for (const t of ['clients_suivis', 'pieces', 'deals', 'journee_taches', 'contacts']) run(`DELETE FROM ${t}`); };

// ================================================================ clients
test('un client créé avec le modèle loisirs reçoit ses indicateurs', () => {
  vider();
  const c = clients.creerClient({ nom: 'Off Golf', debut: '2026-12', honoraires_mensuels: 1750, budget_pub_mensuel: 500, panier_moyen: 45 });
  const t = clients.tableau(c.id, { jusqu_a: '2027-03' });
  assert.deepStrictEqual(t.mois, ['2026-12', '2027-01', '2027-02', '2027-03']);
  assert.ok(t.indicateurs.length >= 6);
  assert.ok(t.indicateurs.find((i) => i.role === 'reservations'));
  assert.ok(t.indicateurs.find((i) => i.role === 'ca'));
  assert.strictEqual(t.indicateurs.find((i) => i.unite === 'pourcent').cumul, 'moyenne');
});

test('le ROI, le coût par réservation et le cumul se calculent sur les mois saisis', () => {
  vider();
  const c = clients.creerClient({ nom: 'Off Golf', debut: '2026-12', honoraires_mensuels: 1750, budget_pub_mensuel: 500, modele: 'vierge' });
  const resa = clients.ajouterIndicateur(c.id, { libelle: 'Réservations', role: 'reservations', baseline: 100 });
  const ca = clients.ajouterIndicateur(c.id, { libelle: 'CA généré', unite: 'euros', role: 'ca', baseline: 4000 });
  const pub = clients.ajouterIndicateur(c.id, { libelle: 'Pub', unite: 'euros', role: 'pub', sens: 'neutre' });
  clients.saisirMois(c.id, '2026-12', [
    { indicateur_id: resa.id, objectif: 120, reel: 150 },
    { indicateur_id: ca.id, objectif: 5000, reel: 6750 },
    { indicateur_id: pub.id, reel: 250 },
  ]);
  clients.saisirMois(c.id, '2027-01', [
    { indicateur_id: resa.id, objectif: 140, reel: 130 },
    { indicateur_id: ca.id, reel: 5850 },
  ]);
  // Un objectif posé à l'avance ne compte pas tant que le mois n'est pas saisi.
  clients.saisirMois(c.id, '2027-02', [{ indicateur_id: resa.id, objectif: 160 }]);

  const t = clients.tableau(c.id, { jusqu_a: '2027-02' });
  const dec = t.synthese[0], jan = t.synthese[1], fev = t.synthese[2];
  assert.strictEqual(dec.cout, 2000);          // 1750 d'accompagnement + 250 de pub réelle
  assert.strictEqual(jan.cout, 2250);          // pas de pub saisie : le budget prévu (500) fait foi
  assert.strictEqual(fev.actif, false);
  assert.strictEqual(dec.cout_par_reservation, 13.33);
  assert.strictEqual(dec.multiple, 3.38);
  assert.strictEqual(dec.roi, 2.375);

  const r = t.indicateurs.find((i) => i.id === resa.id);
  assert.strictEqual(r.mois[0].atteinte, 1.25);
  assert.strictEqual(r.mois[0].vs_baseline, 0.5);
  assert.strictEqual(r.total_reel, 280);
  assert.strictEqual(r.total_objectif, 260);   // février (pas encore joué) n'entre pas dans l'objectif cumulé

  assert.strictEqual(t.cumul.mois_suivis, 2);
  assert.strictEqual(t.cumul.cout_total, 4250);
  assert.strictEqual(t.cumul.ca_total, 12600);
  assert.strictEqual(t.cumul.reservations, 280);
  assert.strictEqual(t.cumul.reservations_en_plus, 80);
  assert.strictEqual(t.cumul.roi, Math.round(((12600 - 4250) / 4250) * 1000) / 1000);
});

test('sans CA saisi, le panier moyen donne un CA estimé, signalé comme tel', () => {
  vider();
  const c = clients.creerClient({ nom: 'Bar à jeux', debut: '2026-11', honoraires_mensuels: 1000, panier_moyen: 30, modele: 'vierge' });
  const resa = clients.ajouterIndicateur(c.id, { libelle: 'Réservations', role: 'reservations' });
  clients.saisirMois(c.id, '2026-11', [{ indicateur_id: resa.id, reel: 50 }]);
  const t = clients.tableau(c.id, { jusqu_a: '2026-11' });
  assert.strictEqual(t.synthese[0].ca, 1500);
  assert.strictEqual(t.synthese[0].ca_estime, true);
  assert.strictEqual(t.cumul.ca_estime, true);
  const { texte } = clients.rapport(c.id, '2026-11');
  assert.match(texte, /estimé/);
});

test('une case vidée efface la valeur, une saisie invalide est refusée avec une phrase claire', () => {
  vider();
  const c = clients.creerClient({ nom: 'Test', debut: '2026-11', modele: 'vierge' });
  const i = clients.ajouterIndicateur(c.id, { libelle: 'Réservations', role: 'reservations' });
  clients.saisirMois(c.id, '2026-11', [{ indicateur_id: i.id, reel: 10, objectif: 12 }]);
  clients.saisirMois(c.id, '2026-11', [{ indicateur_id: i.id, reel: '', objectif: '' }]);
  assert.strictEqual(clients.tableau(c.id, { jusqu_a: '2026-11' }).indicateurs[0].mois[0].reel, null);
  assert.throws(() => clients.saisirMois(c.id, '2026-11', [{ indicateur_id: i.id, reel: 'beaucoup' }]), /pas un nombre/);
  assert.throws(() => clients.saisirMois(c.id, '2026-13', []), /AAAA-MM/);
  assert.throws(() => clients.creerClient({ nom: '  ' }), /nom/);
});

test('un seul indicateur par rôle : le CA ne peut pas compter deux fois', () => {
  vider();
  const c = clients.creerClient({ nom: 'Test', modele: 'vierge' });
  const a = clients.ajouterIndicateur(c.id, { libelle: 'CA 1', unite: 'euros', role: 'ca' });
  const b = clients.ajouterIndicateur(c.id, { libelle: 'CA 2', unite: 'euros', role: 'ca' });
  const t = clients.tableau(c.id);
  assert.strictEqual(t.indicateurs.find((i) => i.id === a.id).role, '');
  assert.strictEqual(t.indicateurs.find((i) => i.id === b.id).role, 'ca');
});

test('le rapport mensuel parle en chiffres, sans tiret cadratin', () => {
  vider();
  const c = clients.creerClient({ nom: 'Off Golf', debut: '2026-12', honoraires_mensuels: 1750, budget_pub_mensuel: 500, panier_moyen: 45 });
  const t0 = clients.tableau(c.id);
  const valeurs = t0.indicateurs.map((i, k) => ({ indicateur_id: i.id, objectif: 100 + k, reel: 120 + k }));
  clients.saisirMois(c.id, '2026-12', valeurs);
  clients.saisirMois(c.id, '2027-01', t0.indicateurs.map((i) => ({ indicateur_id: i.id, objectif: 200 })));
  const { texte } = clients.rapport(c.id, '2026-12');
  assert.match(texte, /Rapport mensuel · Off Golf · décembre 2026/);
  assert.match(texte, /Coût par réservation/);
  assert.match(texte, /Objectifs de janvier 2027/);
  assert.ok(!texte.includes(TIRET));
  assert.throws(() => clients.rapport(c.id, '2025-01'), /hors de la période/);
});

// ================================================================ pilotage
test('une facture Pennylane se traduit en pièce : statut, montants, reste dû', () => {
  const a = pilotage.factureDepuisPennylane({ id: 765, invoice_number: 'F-0765', label: 'Facture Raja', date: '2026-10-01', deadline: '2026-10-31', amount: '2400.0', currency_amount_before_tax: '2000.0', remaining_amount_with_tax: '2400.0', paid: false, status: 'late', customer: { id: 9 } });
  assert.strictEqual(a.statut, 'a_payer');
  assert.strictEqual(a.montant_ht, 2000);
  assert.strictEqual(a.reste_du, 2400);
  assert.strictEqual(a.customer_id, '9');
  const b = pilotage.factureDepuisPennylane({ id: 1, amount: '100', paid: true, status: 'paid', date: '2026-10-02' });
  assert.strictEqual(b.statut, 'payee');
  assert.strictEqual(b.reste_du, 0);
  assert.strictEqual(pilotage.factureDepuisPennylane({ id: 2, amount: '50', draft: true }).statut, 'brouillon');
  assert.strictEqual(pilotage.devisDepuisPennylane({ id: 3, status: 'pending', amount: '600' }).statut, 'en_attente');
  assert.strictEqual(pilotage.devisDepuisPennylane({ id: 4, status: 'accepted', amount: '720' }).statut, 'accepte');
});

test('une facture vue payée au passage suivant est encaissée ce jour-là', () => {
  vider();
  const inv = { id: 51, invoice_number: 'F-51', label: 'Amundi', date: '2026-09-15', deadline: '2026-10-15', amount: '1680', currency_amount_before_tax: '1400', paid: false, status: 'late' };
  pilotage.enregistrer(pilotage.factureDepuisPennylane(inv));
  pilotage.enregistrer(pilotage.factureDepuisPennylane({ ...inv, paid: true, status: 'paid' }));
  const p = dbApi.get(`SELECT * FROM pieces WHERE source_id = '51'`);
  assert.strictEqual(p.statut, 'payee');
  assert.strictEqual(p.paye_le, localDay());
  assert.strictEqual(dbApi.get('SELECT COUNT(*) AS n FROM pieces').n, 1);
});

test('la revue sépare facturé et encaissé, et classe ce qui presse', () => {
  vider();
  const today = localDay();
  const mois = today.slice(0, 7);
  // Facturée ce mois, pas payée, échéance passée : en retard.
  pilotage.creerPiece({ client: 'Raja', numero: 'F-0765', montant_ht: 2000, date: `${mois}-01`, echeance: addDays(today, -5) });
  // Facturée le mois dernier, encaissée aujourd'hui : compte en encaissé, pas en facturé du mois.
  const vieille = pilotage.creerPiece({ client: 'Amundi', montant_ht: 1400, date: addDays(`${mois}-01`, -20) });
  pilotage.modifierPiece(vieille.id, { statut: 'payee' });
  pilotage.creerPiece({ type: 'devis', client: 'Pure Ocean', montant_ht: 1500, date: addDays(today, -12) });
  pilotage.creerPiece({ type: 'devis', client: 'France Active', montant_ht: 600, statut: 'accepte' });
  run(`INSERT INTO journee_taches (texte, echeance, created_at, updated_at) VALUES ('Propale Off Golf', ?, ?, ?)`, addDays(today, 2), dbApi.nowIso(), dbApi.nowIso());

  const r = pilotage.revue({ today });
  assert.strictEqual(r.argent.ce_mois.facture_ht, 2000);
  assert.strictEqual(r.argent.ce_mois.facture_ttc, 2400);
  assert.strictEqual(r.argent.ce_mois.encaisse_ttc, 1680);
  assert.strictEqual(r.total.a_encaisser_ttc, 2400);
  assert.strictEqual(r.total.en_retard_ttc, 2400);
  assert.strictEqual(r.en_retard, 1);
  assert.strictEqual(r.a_encaisser[0].retard, 5);
  assert.strictEqual(r.devis_en_attente.length, 1);
  assert.strictEqual(r.acceptes_a_facturer.length, 1);
  assert.strictEqual(r.echeances.length, 1);
  assert.strictEqual(r.argent.historique.length, 6);
  assert.strictEqual(r.points[0].niveau, 'alerte');
  assert.match(r.points[0].texte, /Raja/);
  assert.ok(r.points.some((p) => /Pure Ocean/.test(p.texte)));

  const texte = pilotage.texteRevue(r);
  assert.match(texte, /Facturé ce mois : 2 000 € HT/);
  assert.match(texte, /Encaissé ce mois : 1 680 € TTC/);
  assert.ok(!texte.includes(TIRET));
});

test('repasser une facture payée en à payer remet le reste dû', () => {
  vider();
  const p = pilotage.creerPiece({ client: 'Culotée', montant_ttc: 2004 });
  const payee = pilotage.modifierPiece(p.id, { statut: 'payee' });
  assert.strictEqual(payee.reste_du, 0);
  const re = pilotage.modifierPiece(p.id, { statut: 'a_payer' });
  assert.strictEqual(re.reste_du, 2004);
  assert.strictEqual(re.paye_le, '');
  assert.throws(() => pilotage.modifierPiece(p.id, { statut: 'accepte' }), /Statut inconnu/);
});

// ================================================================ régressions (revue de la PR #11)
test('le rapport d’un mois ne contient aucun chiffre des mois suivants', () => {
  vider();
  const c = clients.creerClient({ nom: 'Club', debut: '2026-08', honoraires_mensuels: 1000, panier_moyen: 50, modele: 'vierge' });
  const r = clients.ajouterIndicateur(c.id, { libelle: 'Réservations', role: 'reservations' });
  for (const [m, v] of [['2026-08', 20], ['2026-09', 10], ['2026-10', 10]]) clients.saisirMois(c.id, m, [{ indicateur_id: r.id, reel: v }]);
  clients.saisirMois(c.id, '2026-09', [{ indicateur_id: r.id, objectif: 25 }]);
  const { texte } = clients.rapport(c.id, '2026-08');
  assert.ok(!/Depuis le début/.test(texte), 'un seul mois suivi en août : pas de bloc cumulé');
  assert.match(texte, /Objectifs de septembre 2026/);
  const sept = clients.rapport(c.id, '2026-09').texte;
  assert.match(sept, /Depuis le début \(2 mois\)/);
  assert.match(sept, /30 réservations/);
});

test('les ratios cumulés ne comptent que le coût des mois qui ont le chiffre', () => {
  vider();
  const c = clients.creerClient({ nom: 'Club', debut: '2026-08', honoraires_mensuels: 1000, panier_moyen: 50, modele: 'vierge' });
  const r = clients.ajouterIndicateur(c.id, { libelle: 'Réservations', role: 'reservations', baseline: 0 });
  const ab = clients.ajouterIndicateur(c.id, { libelle: 'Abonnés', cumul: 'dernier' });
  clients.saisirMois(c.id, '2026-08', [{ indicateur_id: r.id, reel: 20, objectif: 20 }, { indicateur_id: ab.id, reel: 100 }]);
  clients.saisirMois(c.id, '2026-09', [{ indicateur_id: r.id, reel: 20, objectif: 20 }, { indicateur_id: ab.id, reel: 110 }]);
  clients.saisirMois(c.id, '2026-10', [{ indicateur_id: r.id, objectif: 20 }, { indicateur_id: ab.id, reel: 120 }]);
  const t = clients.tableau(c.id, { jusqu_a: '2026-10' });
  assert.strictEqual(t.cumul.cout_total, 3000);           // l'investi reste complet
  assert.strictEqual(t.cumul.cout_par_reservation, 50);   // 2000 / 40, pas 3000 / 40
  assert.strictEqual(t.cumul.multiple, 1);
  assert.strictEqual(t.cumul.roi, 0);
  const ind = t.indicateurs.find((i) => i.id === r.id);
  assert.strictEqual(ind.total_objectif, 40);             // octobre (sans réel) hors de l'objectif cumulé
  assert.strictEqual(ind.atteinte, 1);
  assert.strictEqual(t.cumul.reservations_en_plus, 40);   // point de départ 0 : une vraie valeur
});

test('au-delà de 36 mois, ce sont les plus récents qui restent', () => {
  const m = clients.plageMois('2020-01', '2026-11');
  assert.strictEqual(m.length, 36);
  assert.strictEqual(m[m.length - 1], '2026-11');
});

test('un avoir Pennylane n’est ni à encaisser ni en retard', () => {
  vider();
  const a = pilotage.factureDepuisPennylane({ id: 70, invoice_number: 'AV-1', amount: '-720', date: '2026-10-01', deadline: '2026-10-15', paid: false, status: 'late' });
  assert.strictEqual(a.statut, 'annulee');
  assert.strictEqual(a.reste_du, 0);
  pilotage.enregistrer(a);
  const r = pilotage.revue({ today: '2026-11-08' });
  assert.strictEqual(r.total.a_encaisser_ttc, 0);
  assert.strictEqual(r.en_retard, 0);
});

test('une facture déjà payée à la première lecture n’est pas rangée dans un mois inventé', () => {
  vider();
  pilotage.enregistrer(pilotage.factureDepuisPennylane({ id: 80, amount: '1200', date: '2026-07-01', paid: true, status: 'paid' }));
  const p = dbApi.get(`SELECT * FROM pieces WHERE source_id = '80'`);
  assert.strictEqual(p.paye_le, '');
  const r = pilotage.revue({ today: '2026-11-08' });
  assert.ok(r.points.some((x) => /sans date d’encaissement/.test(x.texte)));
});

test('« Payée » cochée à la main tient face à la lecture suivante de Pennylane', () => {
  vider();
  const inv = { id: 90, amount: '2400', date: '2026-10-01', deadline: '2026-10-31', paid: false, status: 'late' };
  pilotage.enregistrer(pilotage.factureDepuisPennylane(inv));
  const p = dbApi.get(`SELECT * FROM pieces WHERE source_id = '90'`);
  pilotage.modifierPiece(p.id, { statut: 'payee' });
  pilotage.enregistrer(pilotage.factureDepuisPennylane(inv));
  const apres = dbApi.get(`SELECT * FROM pieces WHERE source_id = '90'`);
  assert.strictEqual(apres.statut, 'payee');
  assert.strictEqual(apres.reste_du, 0);
});

test('le nom vient du contact CRM avant le libellé de la facture', () => {
  vider();
  dbApi.insertContact({ company: 'Raja', pennylane_customer_id: '9' });
  pilotage.enregistrer(pilotage.factureDepuisPennylane({ id: 95, label: 'Facture F-0765', amount: '2400', date: '2026-10-01', customer: { id: 9 } }));
  assert.strictEqual(dbApi.get(`SELECT client FROM pieces WHERE source_id = '95'`).client, 'Raja');
  pilotage.enregistrer(pilotage.factureDepuisPennylane({ id: 96, label: 'Facture F-0999', amount: '100', date: '2026-10-01' }));
  assert.strictEqual(dbApi.get(`SELECT client FROM pieces WHERE source_id = '96'`).client, 'Facture F-0999');
});

test('un devis du pipeline connu de Pennylane (même refusé) ou déjà facturé ne réapparaît pas', () => {
  vider();
  const c = dbApi.insertContact({ company: 'Pure Ocean' });
  const now = dbApi.nowIso();
  run(`INSERT INTO deals (contact_id, title, amount, status, pennylane_quote_id, created_at, updated_at) VALUES (?, 'Vidéo', 1500, 'devis_envoye', '28160', ?, ?)`, c.id, now, now);
  run(`INSERT INTO deals (contact_id, title, amount, status, pennylane_invoice_id, created_at, updated_at) VALUES (?, 'Montage', 600, 'accepte', '777', ?, ?)`, c.id, now, now);
  pilotage.enregistrer(pilotage.devisDepuisPennylane({ id: 28160, status: 'denied', amount: '1800' }));
  const r = pilotage.revue({ today: localDay() });
  assert.strictEqual(r.devis_en_attente.length, 0);
  assert.strictEqual(r.acceptes_a_facturer.length, 0);
});
