'use strict';
// Le tiret cadratin est interdit dans tout le projet (voir CLAUDE.md) : c'est la
// signature d'écriture la plus reconnaissable d'un texte produit par une IA, et
// ces textes partent chez de vrais prospects au nom d'OTEA Production.
//
// Ce test est là pour que la règle survive aux prochaines modifications : il
// échoue dès qu'un tiret réapparaît, en nommant le fichier et la ligne.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-style-test-'));

const TIRET = '—';
const RACINE = path.join(__dirname, '..');

// Seules exceptions admises, chacune justifiée :
//  · CLAUDE.md et ce test doivent pouvoir NOMMER le caractère qu'ils interdisent ;
//  · le parseur WhatsApp doit le RECONNAÎTRE dans les fichiers qu'il reçoit ;
//  · la migration doit le CHERCHER pour le retirer des textes déjà enregistrés.
const EXEMPTS = new Set(['CLAUDE.md', 'test/style.test.js', 'src/importers/whatsapp.js', 'src/migrations/tirets.js']);
const IGNORES = ['node_modules', '.git', 'data'];
const EXTENSIONS = ['.js', '.html', '.css', '.md', '.json', '.command', '.bat'];

function fichiersDuProjet(dir = RACINE, acc = []) {
  for (const entree of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORES.includes(entree.name)) continue;
    const complet = path.join(dir, entree.name);
    if (entree.isDirectory()) fichiersDuProjet(complet, acc);
    else if (EXTENSIONS.includes(path.extname(entree.name))) acc.push(complet);
  }
  return acc;
}

test('aucun tiret cadratin dans le projet', () => {
  const fautes = [];
  for (const complet of fichiersDuProjet()) {
    const relatif = path.relative(RACINE, complet);
    if (EXEMPTS.has(relatif)) continue;
    const lignes = fs.readFileSync(complet, 'utf8').split('\n');
    lignes.forEach((ligne, i) => {
      if (ligne.includes(TIRET)) fautes.push(`${relatif}:${i + 1}  ${ligne.trim().slice(0, 90)}`);
    });
  }
  assert.deepStrictEqual(
    fautes, [],
    `Tiret cadratin interdit (voir CLAUDE.md). Remplace-le par « : », « , », « · » ou un point :\n${fautes.join('\n')}`
  );
});

test('les textes qui partent chez les prospects sont propres', () => {
  // Vérification au niveau des données, pas des fichiers : ce sont ces chaînes
  // exactes qui composent les emails, les posts LinkedIn et les scripts de DM.
  const playbooks = require('../src/playbooks');
  const campaigns = require('../src/campaigns');
  const claude = require('../src/integrations/claude');

  const aVerifier = [];
  for (const t of playbooks.TEMPLATE_SEED) aVerifier.push([`template ${t.code}`, `${t.name} ${t.subject} ${t.body}`]);
  for (const s of playbooks.SEQUENCE_SEED) aVerifier.push([`séquence ${s.code}`, JSON.stringify(s)]);
  for (const [code, p] of Object.entries(campaigns.PRESETS)) aVerifier.push([`secteur ${code}`, JSON.stringify(p)]);
  for (const r of campaigns.REFERENCE_SEED) aVerifier.push([`référence ${r.code}`, `${r.name} ${r.detail}`]);
  for (const [nom, consigne] of Object.entries(claude.PURPOSES || {})) aVerifier.push([`consigne IA ${nom}`, consigne]);

  const fautes = aVerifier.filter(([, texte]) => String(texte).includes(TIRET)).map(([quoi]) => quoi);
  assert.deepStrictEqual(fautes, [], `Tiret cadratin dans du contenu sortant : ${fautes.join(', ')}`);
});

test('le kit de campagne généré est propre', () => {
  const campaigns = require('../src/campaigns');
  const reglages = { user_name: 'Maxime', company_name: 'OTEA Production', user_signature: 'Maxime, OTEA Production', booking_url: '' };
  const refs = campaigns.REFERENCE_SEED.slice(0, 3).map((r) => ({ ...r, id: 1 }));

  for (const [code, preset] of Object.entries(campaigns.PRESETS)) {
    const kit = campaigns.buildKit(preset, preset.persona, refs, reglages);
    const textes = [
      ...kit.emails.flatMap((e) => [e.subject, e.body]),
      kit.post, kit.dm,
    ];
    for (const t of textes) {
      assert.ok(!String(t || '').includes(TIRET), `Tiret cadratin dans le kit « ${code} » : ${String(t).slice(0, 120)}`);
    }
  }
});

test('la migration nettoie les textes déjà enregistrés', () => {
  const { nettoyer } = require('../src/migrations/tirets');
  assert.strictEqual(nettoyer('Maxime — OTEA Production'), 'Maxime : OTEA Production');
  assert.strictEqual(nettoyer('Le Galec — centrale E.Leclerc'), 'Le Galec : centrale E.Leclerc');
  assert.strictEqual(nettoyer('Sans tiret ici'), 'Sans tiret ici');
  assert.strictEqual(nettoyer(''), '');
  assert.ok(!nettoyer('— en début de ligne').includes(TIRET));
  assert.ok(!nettoyer('collé—au—texte').includes(TIRET));
});

test('la migration reprend la base puis se tait', () => {
  const dbApi = require('../src/db');
  const playbooks = require('../src/playbooks');
  const { migrer, DRAPEAU } = require('../src/migrations/tirets');

  playbooks.seedTemplates(dbApi);
  // On simule une base d'avant la règle : signature et template avec des tirets.
  dbApi.setSetting('user_signature', 'Maxime — OTEA Production');
  dbApi.setSetting(DRAPEAU, '');
  const seed = playbooks.TEMPLATE_SEED[0];
  dbApi.run('UPDATE templates SET body = ? WHERE code = ?', 'Bonjour — voici un vieux texte.', seed.code);

  const bilan = migrer(dbApi, playbooks);
  assert.ok(!bilan.deja_fait);
  assert.strictEqual(dbApi.getSetting('user_signature'), 'Maxime, OTEA Production', 'la signature prend une virgule, pas deux-points');

  const apres = dbApi.get('SELECT body FROM templates WHERE code = ?', seed.code);
  assert.strictEqual(apres.body, seed.body, 'un template fourni avec l’app est réécrit depuis la version relue');

  // Deuxième passage : elle ne doit plus rien toucher.
  assert.deepStrictEqual(migrer(dbApi, playbooks), { deja_fait: true });
});

test.after(() => { try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

test('la migration ne casse jamais le démarrage sur une base incomplète', () => {
  // Le bug qui a empêché La Chasse de s'ouvrir : une base créée par une version
  // antérieure n'a pas toutes les colonnes d'aujourd'hui. Une retouche de texte
  // ne doit jamais valoir un plantage au lancement.
  const { DatabaseSync } = require('node:sqlite');
  const { nettoyerTable, migrerSansRisque, DRAPEAU } = require('../src/migrations/tirets');
  const playbooks = require('../src/playbooks');

  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-vieille-'));
  const brute = new DatabaseSync(path.join(dossier, 'ancienne.db'));
  brute.exec("CREATE TABLE campaigns (id INTEGER PRIMARY KEY, name TEXT, angle TEXT)"); // ni post_draft ni notes
  brute.exec("INSERT INTO campaigns (name, angle) VALUES ('Grande distribution — semaine du 24/08', 'un angle — avec tiret')");

  const faussebd = {
    all: (sql, ...p) => brute.prepare(sql).all(...p),
    run: (sql, ...p) => brute.prepare(sql).run(...p),
    get: (sql, ...p) => brute.prepare(sql).get(...p),
  };

  // Les colonnes absentes sont ignorées, celles qui existent sont nettoyées.
  const touchees = nettoyerTable(faussebd, 'campaigns', ['name', 'angle', 'post_draft', 'dm_draft', 'notes']);
  assert.strictEqual(touchees, 1);
  const apres = brute.prepare('SELECT name, angle FROM campaigns').get();
  assert.ok(!apres.name.includes(TIRET) && !apres.angle.includes(TIRET));

  // Une table qui n'existe pas du tout ne fait pas d'histoire non plus.
  assert.strictEqual(nettoyerTable(faussebd, 'table_qui_nexiste_pas', ['name']), 0);
  brute.close();

  // Et quoi qu'il arrive, l'enveloppe de démarrage rend la main sans lever.
  const casse = { all() { throw new Error('base illisible'); }, run() {}, get() {},
    getSetting: () => '', setSetting: () => {} };
  const resultat = migrerSansRisque(casse, playbooks);
  assert.ok(resultat.incidents || resultat.echec, 'l’incident est signalé, pas propagé');
  assert.notStrictEqual(casse.getSetting(DRAPEAU), '1', 'le drapeau reste baissé pour retenter plus tard');

  fs.rmSync(dossier, { recursive: true, force: true });
});
