'use strict';
// Fusionner deux OTEA Moteur : l'autre base est versée dans celle-ci sans rien
// effacer. Les fiches se rapprochent, l'historique s'additionne, les réglages
// déjà remplis ici restent, et la simulation ne change rien.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'moteur-fusion-test-'));
process.env.NODE_ENV = 'test';
const dbApi = require('../src/db');
const fusion = require('../src/fusion');

test.after(() => { try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

const combien = (sql, ...p) => Number(dbApi.get(sql, ...p).n);

// Une « autre base » : même schéma (copie à vide de celle-ci), remplie à la main.
function autreBase(remplir) {
  const chemin = path.join(process.env.DATA_DIR, `autre-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  dbApi.db.exec(`VACUUM INTO '${chemin.replace(/'/g, "''")}'`);
  const autre = new DatabaseSync(chemin);
  for (const t of ['contacts', 'deals', 'activities', 'badges', 'quest_awards', 'journee_taches', 'campaigns', 'enrollments', 'outbox', 'replies', 'inbox']) autre.exec(`DELETE FROM ${t}`);
  autre.exec("DELETE FROM settings");
  autre.exec("DELETE FROM templates WHERE builtin = 0");
  remplir(autre);
  autre.close();
  return chemin;
}

function vider() {
  for (const t of ['activities', 'deals', 'contacts', 'badges', 'quest_awards', 'journee_taches', 'campaigns', 'enrollments', 'outbox', 'replies', 'inbox']) dbApi.run(`DELETE FROM ${t}`);
  dbApi.run("DELETE FROM templates WHERE builtin = 0");
}

test('la simulation compte sans rien changer', () => {
  vider();
  const chemin = autreBase((autre) => {
    autre.prepare("INSERT INTO contacts (first_name, last_name, email, company, created_at, updated_at) VALUES ('Jeanne', 'Martin', 'jeanne@exemple.fr', 'Exemple', '2026-01-01T09:00:00.000Z', '2026-01-01T09:00:00.000Z')").run();
  });
  const rapport = fusion.fusionnerBase(chemin, { simulation: true });
  assert.strictEqual(rapport.tables.contacts.ajoutes, 1);
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM contacts'), 0, 'la simulation ne doit rien écrire');
});

test('un contact inconnu ici est ajouté, un contact connu est rapproché et complété', () => {
  vider();
  const ici = dbApi.insertContact({ first_name: 'Paul', last_name: 'Durand', email: 'paul@durand.fr', company: '', stage: 'contacte', notes: 'Vu au BNI' });
  const chemin = autreBase((autre) => {
    const ins = autre.prepare('INSERT INTO contacts (first_name, last_name, email, phone, company, stage, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    // le même Paul, vu de l'autre côté : plus avancé, avec un téléphone et une société
    ins.run('Paul', 'Durand', 'paul@durand.fr', '0600000000', 'Durand & Fils', 'rdv', 'Rappelé le 3', '2026-02-01T09:00:00.000Z', '2026-02-01T09:00:00.000Z');
    ins.run('Léa', 'Petit', 'lea@petit.fr', '', 'Petit SA', 'a_contacter', '', '2026-02-02T09:00:00.000Z', '2026-02-02T09:00:00.000Z');
  });
  const rapport = fusion.fusionnerBase(chemin);
  assert.strictEqual(rapport.tables.contacts.ajoutes, 1);
  assert.strictEqual(rapport.tables.contacts.fusionnes, 1);
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM contacts'), 2);
  const paul = dbApi.get('SELECT * FROM contacts WHERE id = ?', ici.id);
  assert.strictEqual(paul.phone, '0600000000', 'le champ vide ici prend la valeur de là-bas');
  assert.strictEqual(paul.company, 'Durand & Fils');
  assert.strictEqual(paul.stage, 'rdv', "l'étape la plus avancée gagne");
  assert.match(paul.notes, /Vu au BNI/); assert.match(paul.notes, /Rappelé le 3/);
});

test("l'historique, les devis et le jeu s'additionnent, jamais en double", () => {
  vider();
  const paul = dbApi.insertContact({ first_name: 'Paul', last_name: 'Durand', email: 'paul@durand.fr' });
  dbApi.run("INSERT INTO activities (contact_id, type, note, xp, day, created_at) VALUES (?, 'message_envoye', 'bonjour', 10, '2026-03-01', '2026-03-01T10:00:00.000Z')", paul.id);
  dbApi.run("INSERT INTO badges (code, awarded_at) VALUES ('premier_sang', '2026-03-05T10:00:00.000Z')");
  const chemin = autreBase((autre) => {
    const { lastInsertRowid } = autre.prepare("INSERT INTO contacts (first_name, last_name, email, created_at, updated_at) VALUES ('Paul', 'Durand', 'paul@durand.fr', '2026-01-01T09:00:00.000Z', '2026-01-01T09:00:00.000Z')").run();
    const cid = Number(lastInsertRowid);
    const act = autre.prepare('INSERT INTO activities (contact_id, type, note, xp, day, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    act.run(cid, 'message_envoye', 'bonjour', 10, '2026-03-01', '2026-03-01T10:00:00.000Z'); // la même qu'ici
    act.run(cid, 'rdv_pris', 'café', 50, '2026-03-02', '2026-03-02T10:00:00.000Z');          // nouvelle
    autre.prepare("INSERT INTO deals (contact_id, title, amount, status, created_at, updated_at) VALUES (?, 'Film corporate', 3200, 'envoye', '2026-03-03T10:00:00.000Z', '2026-03-03T10:00:00.000Z')").run(cid);
    autre.prepare("INSERT INTO badges (code, awarded_at) VALUES ('premier_sang', '2026-02-20T10:00:00.000Z')").run(); // gagné plus tôt là-bas
    autre.prepare("INSERT INTO badges (code, awarded_at) VALUES ('premier_devis', '2026-03-03T10:00:00.000Z')").run();
    autre.prepare("INSERT INTO quest_awards (day, code) VALUES ('2026-03-02', 'contacts_5')").run();
  });
  const rapport = fusion.fusionnerBase(chemin);
  assert.strictEqual(rapport.tables.activities.ajoutes, 1);
  assert.strictEqual(rapport.tables.activities.ignores, 1, "l'action identique n'est pas recopiée");
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM activities'), 2);
  assert.strictEqual(combien('SELECT COALESCE(SUM(xp), 0) AS n FROM activities'), 60, "l'XP s'additionne une seule fois");
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM deals WHERE contact_id = ?', paul.id), 1);
  assert.strictEqual(dbApi.get("SELECT awarded_at FROM badges WHERE code = 'premier_sang'").awarded_at, '2026-02-20T10:00:00.000Z', 'le badge garde sa date la plus ancienne');
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM badges'), 2);
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM quest_awards'), 1);
});

test('les réglages remplis ici restent, les vides prennent la valeur de là-bas', () => {
  dbApi.setSetting('pennylane_api_key', 'cle-ici');
  dbApi.setSetting('fullenrich_api_key', '');
  const chemin = autreBase((autre) => {
    const ins = autre.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    ins.run('pennylane_api_key', 'cle-la-bas');
    ins.run('fullenrich_api_key', 'fe-la-bas');
  });
  const rapport = fusion.fusionnerBase(chemin);
  assert.strictEqual(dbApi.getSetting('pennylane_api_key'), 'cle-ici');
  assert.strictEqual(dbApi.getSetting('fullenrich_api_key'), 'fe-la-bas');
  assert.ok(rapport.reglages.repris.includes('fullenrich_api_key'));
  assert.ok(rapport.reglages.gardes.includes('pennylane_api_key'));
  dbApi.setSetting('pennylane_api_key', ''); dbApi.setSetting('fullenrich_api_key', '');
});

test('un fichier qui n’est pas une sauvegarde est refusé sans rien toucher', () => {
  vider();
  dbApi.insertContact({ first_name: 'Témoin', last_name: 'Ici', email: 'temoin@ici.fr' });
  const chemin = path.join(process.env.DATA_DIR, 'pas-une-base.db');
  const vide = new DatabaseSync(chemin);
  vide.exec('CREATE TABLE truc (x TEXT)');
  vide.close();
  assert.throws(() => fusion.fusionnerBase(chemin), /pas une sauvegarde/);
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM contacts'), 1);
});

test('le résumé parle français et donne les comptes', () => {
  const texte = fusion.resumer({ tables: { contacts: { ajoutes: 3, fusionnes: 2, ignores: 0 }, activities: { ajoutes: 10, fusionnes: 0, ignores: 4 }, deals: { ajoutes: 1, fusionnes: 0, ignores: 0 } }, reglages: { repris: ['a'], gardes: [] } });
  assert.match(texte, /3 contacts ajoutés, 2 rapprochés/);
  assert.match(texte, /10 actions d'historique et 1 devis/);
  assert.match(texte, /1 réglage repris/);
  assert.ok(!/[\u2014\u2013]/.test(texte), 'pas de tiret cadratin');
});

test('les pièces du Pilotage et les chiffres clients se fusionnent sans doublon ni écrasement', () => {
  vider();
  for (const t of ['pieces', 'clients_suivis']) dbApi.run(`DELETE FROM ${t}`);
  const clients = require('../src/clients');
  const pilotage = require('../src/pilotage');
  // Ici : Off Golf, réservations de septembre saisies, et la facture Raja encore à payer.
  const og = clients.creerClient({ nom: 'Off Golf', debut: '2026-09', modele: 'vierge' });
  const resa = clients.ajouterIndicateur(og.id, { libelle: 'Réservations', role: 'reservations' });
  clients.saisirMois(og.id, '2026-09', [{ indicateur_id: resa.id, reel: 352 }]);
  pilotage.enregistrer(pilotage.factureDepuisPennylane({ id: 765, amount: '2400', date: '2026-10-01', paid: false }));
  const chemin = autreBase((autre) => {
    // Là-bas : un autre chiffre de septembre (ne doit pas écraser), octobre en plus,
    // un point de départ, la même facture marquée payée plus tard, et une pièce à la main.
    const idInd = autre.prepare(`SELECT id FROM clients_indicateurs WHERE libelle = 'Réservations'`).get().id;
    autre.prepare(`UPDATE clients_indicateurs SET baseline = 300 WHERE id = ?`).run(idInd);
    autre.prepare(`UPDATE clients_mesures SET reel = 999 WHERE indicateur_id = ? AND mois = '2026-09'`).run(idInd);
    autre.prepare(`INSERT INTO clients_mesures (indicateur_id, mois, objectif, reel) VALUES (?, '2026-10', 360, 341)`).run(idInd);
    autre.prepare(`UPDATE pieces SET statut = 'payee', reste_du = 0, paye_le = '2026-11-06', updated_at = '2099-01-01T00:00:00.000Z' WHERE source_id = '765'`).run();
    autre.prepare(`INSERT INTO pieces (type, source, client, montant_ttc, date, statut, created_at, updated_at) VALUES ('facture', 'manuel', 'Culotée', 2004, '2026-11-03', 'a_payer', '2026-11-03', '2026-11-03')`).run();
  });
  fusion.fusionnerBase(chemin);
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM clients_suivis'), 1);
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM clients_indicateurs'), 1);
  const ind = dbApi.get('SELECT * FROM clients_indicateurs');
  assert.strictEqual(ind.baseline, 300);
  assert.strictEqual(dbApi.get(`SELECT reel FROM clients_mesures WHERE mois = '2026-09'`).reel, 352);
  assert.strictEqual(dbApi.get(`SELECT reel FROM clients_mesures WHERE mois = '2026-10'`).reel, 341);
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM pieces'), 2);
  assert.strictEqual(dbApi.get(`SELECT statut FROM pieces WHERE source_id = '765'`).statut, 'payee');
  // Une seconde fusion du même fichier n'ajoute rien.
  fusion.fusionnerBase(chemin);
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM pieces'), 2);
  assert.strictEqual(combien('SELECT COUNT(*) AS n FROM clients_mesures'), 2);
});
