'use strict';
// 🖨️ La version à envoyer d'un rapport client : les chiffres d'un mois, le cumul
// arrêté à ce mois, les objectifs du suivant, et une page qui s'imprime proprement.

process.env.DATA_DIR = require('node:path').join(require('node:os').tmpdir(), `moteur-rapport-client-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../src/db');
const clients = require('../src/clients');

const PUBLIC = path.join(__dirname, '..', 'public');
const lire = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

function offGolf() {
  run('DELETE FROM clients_suivis');
  const c = clients.creerClient({ nom: 'Off Golf', debut: '2026-09', honoraires_mensuels: 1750, budget_pub_mensuel: 500, modele: 'vierge' });
  const resa = clients.ajouterIndicateur(c.id, { libelle: 'Réservations en ligne', role: 'reservations', baseline: 100 });
  const ca = clients.ajouterIndicateur(c.id, { libelle: 'CA généré', unite: 'euros', role: 'ca', baseline: 4000 });
  const abo = clients.ajouterIndicateur(c.id, { libelle: 'Abonnés Instagram', cumul: 'dernier', baseline: 900 });
  clients.saisirMois(c.id, '2026-09', [
    { indicateur_id: resa.id, objectif: 120, reel: 150 },
    { indicateur_id: ca.id, objectif: 5000, reel: 6750 },
  ]);
  clients.saisirMois(c.id, '2026-10', [
    { indicateur_id: resa.id, objectif: 140, reel: 130 },
    { indicateur_id: ca.id, objectif: 6000, reel: 5850 },
    { indicateur_id: abo.id, reel: 1000 },
  ]);
  // Novembre : saisi aussi, il ne doit jamais fuiter dans le rapport d'octobre.
  clients.saisirMois(c.id, '2026-11', [
    { indicateur_id: resa.id, objectif: 160, reel: 400 },
    { indicateur_id: ca.id, reel: 20000 },
  ]);
  clients.saisirMois(c.id, '2026-12', [{ indicateur_id: resa.id, objectif: 180 }, { indicateur_id: ca.id, objectif: 8000 }]);
  return { c, resa, ca, abo };
}

test('la version à envoyer d’octobre arrête le cumul à octobre', () => {
  const { c } = offGolf();
  const r = clients.rapportImprimable(c.id, '2026-10');
  assert.strictEqual(r.mois, '2026-10');
  assert.strictEqual(r.libelle_mois, 'octobre 2026');
  assert.strictEqual(r.client.nom, 'Off Golf');
  // Le cumul ne voit que septembre et octobre.
  assert.strictEqual(r.cumul.mois_suivis, 2);
  assert.strictEqual(r.cumul.reservations, 280);
  assert.strictEqual(r.cumul.ca_total, 12600);
  assert.strictEqual(r.cumul.cout_total, 4500);
  assert.strictEqual(r.cumul.reservations_en_plus, 80);
  // Identique à tableau() arrêté au même mois : une seule source de vérité.
  assert.deepStrictEqual(r.cumul, clients.tableau(c.id, { jusqu_a: '2026-10' }).cumul);
  assert.strictEqual(r.du_mois.mois, '2026-10');
  assert.strictEqual(r.du_mois.reservations, 130);
  // Aucun chiffre de novembre nulle part.
  assert.ok(!JSON.stringify(r).includes('20000'));
  assert.ok(!r.graphique.mois.some((l) => l.mois > '2026-10'));
});

test('le tableau du mois donne objectif, réel, atteinte et écart au départ', () => {
  const { c, resa, abo } = offGolf();
  const r = clients.rapportImprimable(c.id, '2026-10');
  const l = r.lignes.find((x) => x.indicateur_id === resa.id);
  assert.strictEqual(l.objectif, 140);
  assert.strictEqual(l.reel, 130);
  assert.strictEqual(l.atteinte, 0.929);
  assert.strictEqual(l.vs_baseline, 0.3);
  const a = r.lignes.find((x) => x.indicateur_id === abo.id);
  assert.strictEqual(a.objectif, null);
  assert.strictEqual(a.reel, 1000);
  // Septembre : les abonnés ne sont pas saisis, la ligne disparaît plutôt que d'afficher du vide.
  const sept = clients.rapportImprimable(c.id, '2026-09');
  assert.ok(!sept.lignes.some((x) => x.indicateur_id === abo.id));
});

test('le graphique suit les réservations et les objectifs du mois suivant sont joints', () => {
  const { c, resa } = offGolf();
  const r = clients.rapportImprimable(c.id, '2026-11');
  assert.strictEqual(r.graphique.indicateur_id, resa.id);
  assert.deepStrictEqual(r.graphique.mois.map((l) => l.mois), ['2026-09', '2026-10', '2026-11']);
  assert.strictEqual(r.graphique.baseline, 100);
  assert.strictEqual(r.libelle_mois_suivant, 'décembre 2026');
  assert.deepStrictEqual(r.objectifs_suivants.map((o) => [o.libelle, o.objectif]), [['Réservations en ligne', 180], ['CA généré', 8000]]);
  // Les mois saisis alimentent le choix du mois sur la page.
  assert.deepStrictEqual(r.mois_saisis, ['2026-09', '2026-10', '2026-11']);
});

test('le graphique tient sur la page : 12 mois au plus', () => {
  run('DELETE FROM clients_suivis');
  const c = clients.creerClient({ nom: 'Long', debut: '2025-01', honoraires_mensuels: 1000, modele: 'vierge' });
  const resa = clients.ajouterIndicateur(c.id, { libelle: 'Réservations', role: 'reservations', baseline: 10 });
  for (let i = 0; i < 20; i++) clients.saisirMois(c.id, clients.moisSuivant('2025-01', i), [{ indicateur_id: resa.id, reel: 10 + i }]);
  const r = clients.rapportImprimable(c.id, '2026-08');
  assert.strictEqual(r.graphique.mois.length, 12);
  assert.strictEqual(r.graphique.mois[11].mois, '2026-08');
});

test('sans mois choisi, c’est le dernier mois saisi ; un mois hors période est refusé avec une phrase claire', () => {
  const { c } = offGolf();
  assert.strictEqual(clients.rapportImprimable(c.id).mois, '2026-11');
  assert.throws(() => clients.rapportImprimable(c.id, '2025-01'), /hors de la période.*Choisis un autre mois/);
  assert.throws(() => clients.rapportImprimable(c.id, 'octobre'), /AAAA-MM/);
  assert.throws(() => clients.rapportImprimable(99999, '2026-10'), /n’existe plus/);
});

test('un client sans indicateur de réservations a un rapport sans graphique', () => {
  run('DELETE FROM clients_suivis');
  const c = clients.creerClient({ nom: 'Sans résa', debut: '2026-09', honoraires_mensuels: 500, modele: 'vierge' });
  const ca = clients.ajouterIndicateur(c.id, { libelle: 'CA', unite: 'euros', role: 'ca' });
  clients.saisirMois(c.id, '2026-09', [{ indicateur_id: ca.id, reel: 2000 }]);
  const r = clients.rapportImprimable(c.id, '2026-09');
  assert.strictEqual(r.graphique, null);
  assert.strictEqual(r.cumul.roi, 3);
  assert.deepStrictEqual(r.objectifs_suivants, []);
});

test('le rapport texte reprend les mêmes objectifs du mois suivant', () => {
  const { c } = offGolf();
  const { texte } = clients.rapport(c.id, '2026-11');
  assert.match(texte, /Objectifs de décembre 2026/);
  assert.match(texte, /Réservations en ligne : 180/);
});

// ---------------------------------------------------------------- la page
test('la page imprimable est branchée : route, bouton, signature OTEA', () => {
  assert.match(lire('app.js'), /'rapport-client': vRapportClient/);
  const js = lire('pilotage.js');
  assert.match(js, /🖨️ Version à envoyer/);
  assert.match(js, /Préparé par OTEA Production/);
  assert.match(js, /rapport-imprimable\$\{q\}/);
});

test('à l’impression, le menu, la barre d’onglets et les boutons disparaissent', () => {
  const css = lire('app.css');
  const i = css.indexOf('@media print');
  assert.ok(i >= 0, 'un bloc @media print est attendu dans app.css');
  const bloc = css.slice(i);
  for (const sel of ['#sidebar', '#tabbar', 'button', '.no-print']) assert.ok(bloc.includes(sel), `${sel} doit être masqué à l’impression`);
  assert.match(bloc, /size: A4/);
});
