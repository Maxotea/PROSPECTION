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
});

// ================================================================ l'état complet
test('etat : toutes les clés, et aucun tiret cadratin dans ce qui s’affiche', () => {
  nettoyer();
  const c = contact({ prenom: 'Clara', nom: 'Bertinatti', societe: 'EBRA Events', stage: 'rdv' });
  activite({ contactId: c, type: 'rdv_pris', jour: addDays(today, -3) });
  const E = cockpit.etat();
  for (const cle of ['genere_le', 'jour', 'jour_long', 'argent', 'plan', 'ca_mois', 'pipeline', 'conversion', 'relances', 'reponses', 'autopilote', 'journee', 'agenda', 'activite', 'jeu', 'rafraichissement_s', 'stages']) {
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
