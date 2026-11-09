'use strict';
// 🧭 Le Cockpit : l'état complet en un appel, à partir de la base, sans rien inventer.
// Lancer : npm test  (node --test)

process.env.DATA_DIR = require('node:path').join(require('node:os').tmpdir(), `chasse-cockpit-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

const dbApi = require('../src/db');
const { run, setSetting, nowIso, localDay, addDays } = dbApi;
const playbooks = require('../src/playbooks');
const cockpit = require('../src/cockpit');

playbooks.seedTemplates(dbApi);
playbooks.seedSequences(dbApi);

const today = localDay();
const moisCourant = today.slice(0, 7);
const TIRET = '\u2014';

function nettoyer() {
  for (const t of ['journee_taches', 'journee_decisions', 'journee_radar', 'journee_briefs', 'deals', 'inbox', 'outbox', 'activities', 'replies', 'contacts']) run(`DELETE FROM ${t}`);
  for (const k of ['cockpit_plan_debut', 'cockpit_plan_fin', 'cockpit_palier_moyen', 'cockpit_palier_bien', 'cockpit_palier_wow']) setSetting(k, '');
}
function contact({ prenom, nom, societe, stage = 'a_contacter', next = '', ancien = 0 }) {
  const now = nowIso();
  return run(`INSERT INTO contacts (first_name, last_name, company, stage, next_action_at, is_former_client, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    prenom, nom, societe, stage, next, ancien, now, now).lastId;
}
// `jour` : date (AAAA-MM-JJ) à laquelle le devis a été créé et mis à jour.
function deal({ contactId, titre, montant, statut, jour = today, facture = '' }) {
  const iso = `${jour}T10:00:00.000Z`;
  return run(`INSERT INTO deals (contact_id, title, amount, status, invoiced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    contactId, titre, montant, statut, facture, iso, iso).lastId;
}
function activite({ contactId, type, jour = today, xp = 10 }) {
  run(`INSERT INTO activities (contact_id, type, note, xp, meta, day, created_at) VALUES (?, ?, '', ?, '{}', ?, ?)`, contactId, type, xp, jour, `${jour}T09:00:00.000Z`);
}
function moisPrecedent(n) {
  const [a, m] = today.split('-').map(Number);
  const d = new Date(a, m - 1 - n, 15);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
}

// ================================================================ l'argent le plus proche
test('argent : à facturer, devis en attente (dont à relancer), devis à faire, facturé ce mois', () => {
  nettoyer();
  setSetting('journee_delai_devis', '5');
  const galec = contact({ prenom: 'Margot', nom: 'Bousquet', societe: 'Galec', stage: 'gagne' });
  deal({ contactId: galec, titre: 'Solde micro-trottoir', montant: 5175, statut: 'accepte', jour: addDays(today, -11) });

  const raja = contact({ prenom: 'Déborah', nom: 'Chouraqui', societe: 'RAJA', stage: 'devis_envoye' });
  deal({ contactId: raja, titre: 'Étude de cas', montant: 2000, statut: 'devis_envoye', jour: addDays(today, -9) });
  // Pas d'échange depuis 9 jours : à relancer.

  const amundi = contact({ prenom: 'Mado', nom: 'B.', societe: 'Amundi', stage: 'devis_envoye' });
  deal({ contactId: amundi, titre: 'Matinée', montant: 1400, statut: 'devis_envoye', jour: addDays(today, -9) });
  activite({ contactId: amundi, type: 'relance', jour: addDays(today, -1) }); // relancé hier : pas à relancer

  const ebra = contact({ prenom: 'Clara', nom: 'Bertinatti', societe: 'EBRA Events', stage: 'rdv' });
  activite({ contactId: ebra, type: 'rdv_pris', jour: addDays(today, -11) });

  const nina = contact({ prenom: 'Nina', nom: 'Ramen', societe: 'Nina Ramen', stage: 'gagne' });
  deal({ contactId: nina, titre: 'Reels', montant: 1000, statut: 'facture', jour: today, facture: `${today}T12:00:00.000Z` });
  deal({ contactId: nina, titre: 'Podcast', montant: 3340, statut: 'facture', jour: moisPrecedent(1), facture: `${moisPrecedent(1)}T12:00:00.000Z` });

  const A = cockpit.argent(today);
  assert.strictEqual(A.a_facturer.n, 1);
  assert.strictEqual(A.a_facturer.total, 5175);
  assert.strictEqual(A.a_facturer.plus_vieux_j, 11);
  assert.strictEqual(A.a_facturer.lignes[0].societe, 'Galec');

  assert.strictEqual(A.devis_en_cours.n, 2);
  assert.strictEqual(A.devis_en_cours.total, 3400);
  assert.strictEqual(A.devis_en_cours.a_relancer, 1, 'RAJA est à relancer, Amundi a été relancé hier');
  assert.strictEqual(A.devis_en_cours.lignes[0].societe, 'RAJA', 'le plus gros montant en premier');
  assert.strictEqual(A.devis_en_cours.lignes[0].a_relancer, true);
  assert.strictEqual(A.devis_en_cours.lignes[1].a_relancer, false);

  assert.strictEqual(A.devis_a_faire.n, 1);
  assert.strictEqual(A.devis_a_faire.lignes[0].societe, 'EBRA Events');
  assert.strictEqual(A.devis_a_faire.plus_vieux_j, 11);

  assert.strictEqual(A.facture_mois.n, 1, 'seule la facture de ce mois compte');
  assert.strictEqual(A.facture_mois.total, 1000);
});

// ================================================================ le plan et ses paliers
test('plan : sans réglage, le trimestre en cours ; avec réglage, les dates et les paliers de Maxime', () => {
  nettoyer();
  const sans = cockpit.plan(today);
  assert.strictEqual(sans.debut.slice(0, 4), today.slice(0, 4));
  assert.ok(sans.debut <= today && sans.fin >= today, 'le trimestre en cours contient aujourd’hui');
  assert.deepStrictEqual(sans.paliers, { moyen: 20000, bien: 25000, wow: 35000 });
  assert.strictEqual(sans.total, 0);
  assert.strictEqual(sans.atteint, '');
  assert.deepStrictEqual(sans.prochain, { nom: 'moyen', manque: 20000 });

  setSetting('cockpit_plan_debut', addDays(today, -30));
  setSetting('cockpit_plan_fin', addDays(today, 60));
  setSetting('cockpit_palier_moyen', '10000');
  setSetting('cockpit_palier_bien', '15000');
  setSetting('cockpit_palier_wow', '20000');
  const c = contact({ prenom: 'A', nom: 'B', societe: 'Client', stage: 'gagne' });
  deal({ contactId: c, titre: 'Dans le plan', montant: 12000, statut: 'facture', jour: addDays(today, -10), facture: `${addDays(today, -10)}T12:00:00.000Z` });
  deal({ contactId: c, titre: 'Avant le plan', montant: 9000, statut: 'facture', jour: addDays(today, -40), facture: `${addDays(today, -40)}T12:00:00.000Z` });
  deal({ contactId: c, titre: 'Pas encore facturé', montant: 4000, statut: 'accepte', jour: today });

  const P = cockpit.plan(today);
  assert.strictEqual(P.total, 12000, 'seul le facturé entre les deux dates compte');
  assert.strictEqual(P.n, 1);
  assert.strictEqual(P.atteint, 'moyen');
  assert.deepStrictEqual(P.prochain, { nom: 'bien', manque: 3000 });
  assert.strictEqual(P.jours_restants, 60);
  assert.ok(P.avancement > 0.3 && P.avancement < 0.4, `un tiers du temps écoulé (${P.avancement})`);
  assert.ok(Math.abs(P.pct - 0.6) < 0.001);
});

test('plan : des paliers dans le désordre sont remis dans l’ordre, une date invalide ramène au trimestre', () => {
  nettoyer();
  setSetting('cockpit_palier_moyen', '30000');
  setSetting('cockpit_palier_bien', '20000'); // plus bas que Moyen : on le remonte
  setSetting('cockpit_palier_wow', '10000');
  setSetting('cockpit_plan_debut', '2026-13-45');
  const P = cockpit.plan(today);
  assert.deepStrictEqual(P.paliers, { moyen: 30000, bien: 30000, wow: 30000 });
  assert.ok(P.debut <= today && P.fin >= today);
});

// ================================================================ facturé par mois, pipeline, conversion
test('facturé par mois : six mois, le courant marqué, les montants au bon mois', () => {
  nettoyer();
  const c = contact({ prenom: 'A', nom: 'B', societe: 'Client', stage: 'gagne' });
  deal({ contactId: c, titre: 'Ce mois', montant: 1500, statut: 'facture', jour: today, facture: `${today}T12:00:00.000Z` });
  deal({ contactId: c, titre: 'Il y a deux mois', montant: 800, statut: 'facture', jour: moisPrecedent(2), facture: `${moisPrecedent(2)}T12:00:00.000Z` });
  // Un devis facturé sans date de facturation : on prend sa date de mise à jour.
  deal({ contactId: c, titre: 'Sans date', montant: 200, statut: 'facture', jour: moisPrecedent(2) });
  const M = cockpit.caParMois(today);
  assert.strictEqual(M.length, 6);
  assert.strictEqual(M[5].mois, moisCourant);
  assert.strictEqual(M[5].courant, true);
  assert.strictEqual(M[5].total, 1500);
  assert.strictEqual(M[3].total, 1000);
  assert.strictEqual(M[3].n, 2);
  assert.strictEqual(M[4].total, 0);
  assert.ok(M.every((m) => typeof m.libelle === 'string' && m.libelle.length >= 3));
});

test('pipeline : les contacts par étape, et les euros des devis ouverts en face', () => {
  nettoyer();
  const a = contact({ prenom: 'A', nom: 'A', societe: 'A', stage: 'devis_envoye' });
  const b = contact({ prenom: 'B', nom: 'B', societe: 'B', stage: 'devis_envoye' });
  contact({ prenom: 'C', nom: 'C', societe: 'C', stage: 'a_contacter' });
  deal({ contactId: a, titre: 'x', montant: 1000, statut: 'devis_envoye' });
  deal({ contactId: b, titre: 'y', montant: 500, statut: 'brouillon' });
  deal({ contactId: b, titre: 'z', montant: 999, statut: 'facture', facture: `${today}T12:00:00.000Z` }); // facturé : plus dans le pipe
  const P = cockpit.pipeline();
  const devis = P.find((s) => s.code === 'devis_envoye');
  assert.strictEqual(devis.count, 2);
  assert.strictEqual(devis.montant, 1500);
  assert.strictEqual(P.find((s) => s.code === 'a_contacter').count, 1);
  assert.strictEqual(P.find((s) => s.code === 'a_contacter').montant, 0);
});

test('conversion : signés sur envoyés depuis 90 jours, et rien quand il n’y a aucun devis', () => {
  nettoyer();
  assert.strictEqual(cockpit.conversion(today).taux, null);
  const c = contact({ prenom: 'A', nom: 'B', societe: 'Client' });
  deal({ contactId: c, titre: '1', montant: 1, statut: 'devis_envoye', jour: addDays(today, -10) });
  deal({ contactId: c, titre: '2', montant: 1, statut: 'accepte', jour: addDays(today, -20) });
  deal({ contactId: c, titre: '3', montant: 1, statut: 'facture', jour: addDays(today, -30) });
  deal({ contactId: c, titre: '4', montant: 1, statut: 'brouillon', jour: addDays(today, -5) });     // pas envoyé : hors compte
  deal({ contactId: c, titre: '5', montant: 1, statut: 'facture', jour: addDays(today, -120) });    // trop vieux
  const C = cockpit.conversion(today);
  assert.deepStrictEqual(C, { jours: 90, envoyes: 3, signes: 2, taux: 2 / 3 });
});

// ================================================================ relances, réponses, activité
test('relances dues : combien, combien de chauds, la plus vieille', () => {
  nettoyer();
  contact({ prenom: 'A', nom: 'A', societe: 'A', stage: 'contacte', next: addDays(today, -12) });
  contact({ prenom: 'B', nom: 'B', societe: 'B', stage: 'en_discussion', next: today });
  contact({ prenom: 'C', nom: 'C', societe: 'C', stage: 'a_contacter', next: addDays(today, 3) }); // pas encore due
  contact({ prenom: 'D', nom: 'D', societe: 'D', stage: 'gagne', next: addDays(today, -40) });     // gagné : plus de relance
  const R = cockpit.relances(today);
  assert.deepStrictEqual(R, { dues: 2, chaudes: 1, plus_vieille_j: 12 });
});

test('activité : quatorze jours, les notes exclues, aujourd’hui en dernier', () => {
  nettoyer();
  const c = contact({ prenom: 'A', nom: 'B', societe: 'Client' });
  activite({ contactId: c, type: 'relance', xp: 10 });
  activite({ contactId: c, type: 'appel', xp: 15 });
  activite({ contactId: c, type: 'note', xp: 0 });
  activite({ contactId: c, type: 'relance', jour: addDays(today, -13), xp: 10 });
  activite({ contactId: c, type: 'relance', jour: addDays(today, -14), xp: 10 }); // hors fenêtre
  const A = cockpit.activite(today);
  assert.strictEqual(A.length, 14);
  assert.strictEqual(A[13].day, today);
  assert.deepStrictEqual({ n: A[13].n, xp: A[13].xp }, { n: 2, xp: 25 });
  assert.strictEqual(A[0].n, 1);

  // Le fil : les dernières actions, la plus récente en premier, les notes exclues, le nom du contact posé.
  const F = cockpit.fil();
  assert.strictEqual(F.length, 4);
  assert.strictEqual(F[0].type, 'appel');
  assert.strictEqual(F[0].nom, 'A B');
  assert.strictEqual(F[0].societe, 'Client');
  assert.ok(F[0].label && F[0].emoji, 'chaque action a un libellé et un emoji');
  assert.ok(F.every((f) => f.type !== 'note'));
  assert.ok(F.every((f) => Number.isInteger(f.id)), 'chaque entrée du fil porte l’identifiant de son activité');

  // La cadence : les actions du jour face au meilleur jour des 30 derniers (les notes et les bonus ne comptent pas).
  const C = cockpit.cadence(today);
  assert.deepStrictEqual(C, { aujourdhui: 2, record: 1, record_jour: addDays(today, -13) });
});

test('radar : les chauds d’abord avec leurs euros, les froids ensuite, les anciens clients en tête des froids', () => {
  nettoyer();
  const a = contact({ prenom: 'A', nom: 'A', societe: 'Alpha', stage: 'devis_envoye' });
  deal({ contactId: a, titre: 'x', montant: 1500, statut: 'devis_envoye' });
  contact({ prenom: 'B', nom: 'B', societe: 'Beta', stage: 'a_contacter' });
  contact({ prenom: 'C', nom: 'C', societe: 'Gamma', stage: 'contacte', ancien: 1 });
  contact({ prenom: 'D', nom: 'D', societe: 'Delta', stage: 'perdu' });
  const R = cockpit.radar();
  assert.strictEqual(R.total, 3, 'un perdu n’est plus sur le radar');
  assert.strictEqual(R.chauds, 1);
  assert.strictEqual(R.points[0].societe, 'Alpha');
  assert.strictEqual(R.points[0].chaud, true);
  assert.strictEqual(R.points[0].montant, 1500);
  assert.strictEqual(R.points[1].societe, 'Gamma', 'l’ancien client passe devant parmi les froids');
  assert.strictEqual(R.points[1].ancien, true);
  assert.strictEqual(R.points.length, 3);
});

test('jeu : niveau, quêtes du jour et badges, prêts pour le tableau de chasse', () => {
  nettoyer();
  const J = cockpit.jeu(today);
  assert.ok(J.level && typeof J.level.level === 'number');
  assert.strictEqual(J.quetes.length, 3, 'trois quêtes par jour');
  assert.ok(J.quetes.every((q) => 'progress' in q && 'target' in q && 'bonus' in q && 'done' in q));
  assert.strictEqual(J.badges.total, J.badges.tous.length);
  assert.strictEqual(J.badges.gagnes, J.badges.tous.filter((b) => b.won).length);
  assert.strictEqual(typeof J.xp_jour, 'number');
});

// ================================================================ l'état complet
test('etat : toutes les clés, et aucun tiret cadratin dans ce qui s’affiche', () => {
  nettoyer();
  const c = contact({ prenom: 'Clara', nom: 'Bertinatti', societe: 'EBRA Events', stage: 'rdv' });
  activite({ contactId: c, type: 'rdv_pris', jour: addDays(today, -3) });
  const E = cockpit.etat();
  for (const cle of ['genere_le', 'jour', 'jour_long', 'argent', 'plan', 'ca_mois', 'pipeline', 'conversion', 'relances', 'reponses', 'autopilote', 'journee', 'agenda', 'activite', 'fil', 'radar', 'cadence', 'jeu', 'rafraichissement_s', 'stages']) {
    assert.ok(cle in E, `clé manquante : ${cle}`);
  }
  assert.strictEqual(E.jour, today);
  assert.strictEqual(E.rafraichissement_s, 60);
  assert.ok(E.journee.essentiels.length >= 1, 'le devis à faire d’EBRA est une chose à faire aujourd’hui');
  const devis = E.journee.essentiels.find((it) => /EBRA/.test(it.titre));
  assert.ok(devis, 'le devis EBRA est dans l’essentiel du jour');
  assert.strictEqual(devis.action.type, 'contact');
  assert.strictEqual(devis.action.id, c);
  assert.strictEqual(E.agenda.branche, false);
  assert.strictEqual(E.autopilote.configured, false);
  assert.ok(!JSON.stringify(E).includes(TIRET), 'aucun tiret cadratin dans l’état du Cockpit');
});

test('etat : le rafraîchissement suit le réglage, jamais sous 15 secondes', () => {
  nettoyer();
  setSetting('cockpit_rafraichissement', '5');
  assert.strictEqual(cockpit.etat().rafraichissement_s, 15);
  setSetting('cockpit_rafraichissement', '120');
  assert.strictEqual(cockpit.etat().rafraichissement_s, 120);
  setSetting('cockpit_rafraichissement', '');
});

// ================================================================ l'argent réel (Pilotage) et les clients suivis
const pilotage = require('../src/pilotage');
const clients = require('../src/clients');
function viderPilotage() { for (const t of ['pieces', 'clients_suivis']) run(`DELETE FROM ${t}`); }

test('argent réel : sans aucune facture, le Cockpit ne change rien', () => {
  nettoyer(); viderPilotage();
  const galec = contact({ prenom: 'Margot', nom: 'Bousquet', societe: 'Galec', stage: 'gagne' });
  deal({ contactId: galec, titre: 'Reels', montant: 1000, statut: 'facture', jour: today, facture: `${today}T12:00:00.000Z` });
  const E = cockpit.etat();
  assert.strictEqual(E.argent_reel, null, 'pas de pièce : pas de bloc argent réel');
  assert.deepStrictEqual(E.argent.facture_mois, { n: 1, total: 1000 }, 'le facturé du pipeline reste le même');
  assert.deepStrictEqual(E.clients, []);
  // Un devis seul, ou une facture annulée, ne suffit pas à parler d'argent réel.
  pilotage.creerPiece({ type: 'devis', client: 'Raja', montant_ht: 2000 });
  pilotage.creerPiece({ client: 'Amundi', montant_ttc: 600, statut: 'annulee' });
  assert.strictEqual(cockpit.etat().argent_reel, null);
});

test('argent réel : encaissé ce mois, reste à encaisser, en retard, lus dans Pilotage', () => {
  nettoyer(); viderPilotage();
  const moisDernier = moisPrecedent(1);
  pilotage.creerPiece({ client: 'Galec', montant_ttc: 2400, statut: 'payee', date: addDays(today, -20), paye_le: today });
  pilotage.creerPiece({ client: 'Nina Ramen', montant_ttc: 900, statut: 'payee', date: moisDernier, paye_le: moisDernier });
  pilotage.creerPiece({ client: 'RAJA', montant_ttc: 1200, statut: 'a_payer', date: addDays(today, -40), echeance: addDays(today, -10) });
  pilotage.creerPiece({ client: 'EBRA', montant_ttc: 600, statut: 'a_payer', date: today, echeance: addDays(today, 20) });
  const R = cockpit.etat().argent_reel;
  assert.ok(R, 'des factures existent : le bloc argent réel est là');
  assert.strictEqual(R.mois, moisCourant);
  assert.strictEqual(R.encaisse_mois_ttc, 2400, 'seul le paiement de ce mois compte');
  assert.strictEqual(R.encaissements, 1);
  assert.strictEqual(R.reste_ttc, 1800);
  assert.strictEqual(R.a_payer, 2);
  assert.strictEqual(R.en_retard_ttc, 1200);
  assert.strictEqual(R.en_retard, 1);
  // Les mêmes chiffres que la revue de Pilotage : une seule source.
  const rv = pilotage.revue({ today });
  assert.strictEqual(R.reste_ttc, rv.total.a_encaisser_ttc);
  assert.strictEqual(R.en_retard_ttc, rv.total.en_retard_ttc);
  assert.strictEqual(R.encaisse_mois_ttc, rv.argent.ce_mois.encaisse_ttc);
  viderPilotage();
});

test('clients suivis : une ligne par client, ROI cumulé et mois fini à saisir', () => {
  nettoyer(); viderPilotage();
  const m2 = clients.moisSuivant(moisCourant, -2);
  const c = clients.creerClient({ nom: 'Off Golf', debut: m2, honoraires_mensuels: 1000, budget_pub_mensuel: 0, modele: 'vierge' });
  const ca = clients.ajouterIndicateur(c.id, { libelle: 'CA généré', unite: 'euros', role: 'ca', baseline: 0 });
  const resa = clients.ajouterIndicateur(c.id, { libelle: 'Réservations', role: 'reservations', baseline: 0 });
  clients.saisirMois(c.id, m2, [{ indicateur_id: ca.id, reel: 3000 }, { indicateur_id: resa.id, reel: 60 }]);
  const E = cockpit.etat();
  assert.strictEqual(E.clients.length, 1);
  const l = E.clients[0];
  assert.strictEqual(l.nom, 'Off Golf');
  assert.strictEqual(l.roi, 2, '3 000 € rapportés pour 1 000 € payés');
  assert.strictEqual(l.mois_manquant, clients.moisSuivant(moisCourant, -1), 'le mois dernier n’est pas saisi');
  assert.ok(l.mois_manquant_libelle);
  clients.saisirMois(c.id, l.mois_manquant, [{ indicateur_id: ca.id, reel: 1000 }]);
  const apres = cockpit.etat().clients[0];
  assert.strictEqual(apres.mois_manquant, '', 'saisi : plus rien ne manque');
  assert.ok(!JSON.stringify(cockpit.etat()).includes(TIRET));
  viderPilotage();
});
