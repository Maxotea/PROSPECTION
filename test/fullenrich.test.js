'use strict';
// FullEnrich disait « c'est lancé » et rien n'arrivait jamais dans les fiches.
// Ces tests rejouent la VRAIE forme de réponse de l'API (test/fixtures/
// fullenrich-bulk.json, calquée sur une réponse réelle) contre un faux serveur
// FullEnrich local. C'est le seul moyen d'attraper ce bug : le code lisait les
// emails à un endroit où l'API n'en met pas, et personne ne s'en apercevait.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-fe-test-'));

const dbApi = require('../src/db');
const fullenrich = require('../src/integrations/fullenrich');

const REPONSE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/fullenrich-bulk.json'), 'utf8'));

// Faux FullEnrich : accepte un lot, puis répond « en cours » jusqu'à ce que le
// test le déclare terminé.
let etat = { termine: false, corps: REPONSE, recu: null, urlsAppelees: [] };
let serveur;

test.before(async () => {
  serveur = http.createServer((req, res) => {
    let brut = '';
    req.on('data', (c) => { brut += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url.endsWith('/contact/enrich/bulk')) {
        etat.recu = JSON.parse(brut || '{}');
        etat.urlsAppelees.push(req.url);
        // Refuse comme le vrai : un champ vide, ou un contact marqué exprès pour le test.
        const vide = (etat.recu.datas || []).some((d) => Object.values(d).some((v) => v === '') || d.company_name === 'REFUSE-MOI');
        if (vide) {
          res.statusCode = 400;
          res.end(JSON.stringify({ code: 'error.enrichment.domain.empty', message: 'Domain cannot be empty' }));
          return;
        }
        res.end(JSON.stringify({ enrichment_id: 'job-test-1' }));
        return;
      }
      if (req.method === 'GET' && req.url.includes('/contact/enrich/bulk/')) {
        res.end(JSON.stringify(etat.termine ? etat.corps : { status: 'IN_PROGRESS' }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  dbApi.setSetting('fullenrich_api_key', 'cle-de-test');
  dbApi.setSetting('fullenrich_base', `http://127.0.0.1:${serveur.address().port}/api/v2`);
});

test.after(async () => {
  await new Promise((r) => serveur.close(r));
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

function creer(prenom, nom, boite, extra = {}) {
  return dbApi.insertContact({
    first_name: prenom, last_name: nom, company: boite,
    linkedin_url: `https://www.linkedin.com/in/${prenom.toLowerCase()}-${nom.toLowerCase()}-demo`,
    segment: 'pme', stage: 'a_contacter', ...extra,
  });
}

let ids = [];

test('un enrichissement se lance et met les fiches en attente', async () => {
  ids = [creer('Camille', 'Roux', 'Studio Nord').id, creer('Yanis', 'Belkacem', 'Atelier Sud').id];
  const r = await fullenrich.startEnrich(ids);
  assert.strictEqual(r.count, 2);
  assert.strictEqual(r.external_id, 'job-test-1');
  assert.strictEqual(etat.recu.datas.length, 2, 'les deux contacts sont bien envoyés');
  for (const id of ids) {
    assert.strictEqual(dbApi.get('SELECT * FROM contacts WHERE id = ?', id).enrich_status, 'pending');
  }
});

test('tant que FullEnrich travaille, le job reste en attente', async () => {
  const [r] = await fullenrich.pollPending();
  assert.strictEqual(r.pending, true);
  assert.strictEqual(r.enriched, 0);
});

test('quand c’est fini, les emails atterrissent VRAIMENT dans les fiches', async () => {
  etat.termine = true;
  const [r] = await fullenrich.pollPending();
  assert.strictEqual(r.pending, false);
  assert.strictEqual(r.enriched, 2, `2 contacts devaient être enrichis, obtenu ${r.enriched}`);
  assert.strictEqual(r.orphelins, 0, 'aucun résultat ne doit rester sans fiche');

  const camille = dbApi.get('SELECT * FROM contacts WHERE first_name = ?', 'Camille');
  assert.strictEqual(camille.email, 'camille.roux@studionord.fr');
  assert.strictEqual(camille.email_status, 'DELIVERABLE');
  assert.strictEqual(camille.phone, '+33612345678', 'le téléphone est un objet { number }, pas une chaîne');
  assert.strictEqual(camille.enrich_status, 'done');
  assert.strictEqual(camille.city, 'Puteaux');
  assert.match(camille.job_title, /DIRECTRICE COMMUNICATION/);

  const yanis = dbApi.get('SELECT * FROM contacts WHERE first_name = ?', 'Yanis');
  assert.strictEqual(yanis.email, 'yanis.belkacem@ateliersud.fr');
  assert.strictEqual(yanis.phone, '', 'pas de téléphone trouvé : on n’invente rien');
});

test('le rattachement marche sans identifiant renvoyé par FullEnrich', () => {
  // La fixture ne contient AUCUN champ `custom` : c'est le cas réel qui cassait
  // tout, puisque le code exigeait un contact_id renvoyé par l'API.
  const brut = JSON.stringify(REPONSE);
  assert.ok(!brut.includes('contact_id'), 'la fixture ne doit renvoyer aucun contact_id');
});

test('un enrichissement sans résultat le dit, au lieu de faire semblant', async () => {
  const id = creer('Ines', 'Fabre', 'Boite Vide').id;
  etat.termine = false;
  await fullenrich.startEnrich([id]);
  etat.termine = true;
  etat.corps = {
    status: 'FINISHED',
    datas: [{
      input: { first_name: 'Ines', last_name: 'Fabre', company_name: 'Boite Vide' },
      contact_info: { most_probable_work_email: null, most_probable_phone: null, work_emails: [] },
      profile: {},
    }],
  };
  const [r] = await fullenrich.pollPending();
  assert.strictEqual(r.enriched, 0);
  assert.strictEqual(r.total, 1);
  assert.strictEqual(dbApi.get('SELECT * FROM contacts WHERE id = ?', id).enrich_status, 'not_found');
});

test('un email déjà rempli n’est jamais écrasé', async () => {
  const id = creer('Camille', 'Roux', 'Studio Nord', { email: 'perso@camille.fr' }).id;
  etat.termine = false;
  await fullenrich.startEnrich([id]);
  etat.termine = true;
  etat.corps = { status: 'FINISHED', datas: [REPONSE.datas[0]] };
  await fullenrich.pollPending();
  assert.strictEqual(dbApi.get('SELECT * FROM contacts WHERE id = ?', id).email, 'perso@camille.fr');
});

test('un contact sans site web ne fait plus échouer tout le lot', async () => {
  // Le bug de Maxime : « 452 contacts sans email », et dès qu'un seul n'avait
  // pas de domaine, FullEnrich refusait les 100 avec « domain cannot be empty ».
  etat.urlsAppelees = [];
  const avecSite = creer('Ines', 'Fabre', 'Boite Vide', { domain: 'boitevide.fr' }).id;
  const sansSite = dbApi.insertContact({ first_name: 'Karim', last_name: 'Sans', company: 'Sans Site', segment: 'pme', stage: 'a_contacter' }).id;
  const r = await fullenrich.startEnrich([avecSite, sansSite]);
  assert.strictEqual(r.count, 2, 'les deux partent');
  const karim = etat.recu.datas.find((d) => d.first_name === 'Karim');
  assert.ok(karim, 'Karim est bien dans le lot');
  assert.ok(!('domain' in karim), 'sans domaine, pas de champ domain du tout');
  assert.ok(!('linkedin_url' in karim), 'sans LinkedIn, pas de champ linkedin_url');
  assert.strictEqual(karim.company_name, 'Sans Site');
  assert.ok(etat.urlsAppelees.every((u) => u.includes('/api/v2/')), 'aucun repli vers la v1');
});

test('une erreur de validation ne déclenche pas le repli v1 et parle français', async () => {
  // Le faux serveur refuse ce lot avec le code exact vu chez Maxime. Ce qu'on
  // vérifie : pas de second essai en v1, un message en français, et des fiches
  // qui ne restent pas bloquées « en attente ».
  etat.urlsAppelees = [];
  const id = creer('Lea', 'Vide', 'REFUSE-MOI', { domain: 'refuse.fr' }).id;
  let erreur = null;
  try { await fullenrich.startEnrich([id]); } catch (e) { erreur = e; }
  assert.ok(erreur, 'le lot est refusé');
  assert.ok(!/HTTP 400/.test(erreur.message), `message lisible, obtenu : ${erreur.message}`);
  assert.match(erreur.message, /site web|entreprise|LinkedIn/, 'dit quoi compléter');
  assert.strictEqual(etat.urlsAppelees.length, 1, 'un seul appel : pas de second essai en v1');
  assert.ok(etat.urlsAppelees[0].includes('/api/v2/'));
  assert.notStrictEqual(dbApi.get('SELECT * FROM contacts WHERE id = ?', id).enrich_status, 'pending',
    "un lot refusé ne laisse pas les fiches marquées « en attente »");
});

test('un domaine fait d’espaces ou d’une URL complète est nettoyé', () => {
  const p = fullenrich.contactPayloadV2({ id: 1, first_name: 'A', last_name: 'B', company: 'C', domain: '   ' });
  assert.ok(!('domain' in p), 'des espaces ne sont pas un domaine');
  const q = fullenrich.contactPayloadV2({ id: 2, first_name: 'A', last_name: 'B', domain: ' https://www.exemple.fr/contact ' });
  assert.strictEqual(q.domain, 'exemple.fr');
});
