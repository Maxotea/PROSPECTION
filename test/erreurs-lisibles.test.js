'use strict';
// Les deux écrans d'erreur envoyés par Maxime : un JSON brut de FullEnrich
// (« domain cannot be empty ») et un JSON brut d'Anthropic (« credit balance is
// too low »). Un message d'erreur doit dire ce qui s'est passé ET quoi faire,
// en français, sans jargon. Ces tests verrouillent la traduction.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-erreurs-test-'));
const fullenrich = require('../src/integrations/fullenrich');
const claude = require('../src/integrations/claude');

test.after(() => { try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

const erreurHttp = (status, body, url = 'https://exemple.test') => {
  const e = new Error(`HTTP ${status} sur POST ${url} : ${JSON.stringify(body)}`);
  e.status = status; e.body = body;
  return e;
};
const lisible = (msg) => {
  assert.ok(!/HTTP \d{3}/.test(msg), `pas de code HTTP dans « ${msg} »`);
  assert.ok(!/https?:\/\//.test(msg), `pas d'URL dans « ${msg} »`);
  assert.ok(!/\{"/.test(msg), `pas de JSON dans « ${msg} »`);
};

test('FullEnrich : « domain cannot be empty » devient une consigne', () => {
  const e = fullenrich.traduireErreur(erreurHttp(400, { code: 'error.enrichment.domain.empty', message: 'Domain cannot be empty' }));
  lisible(e.message);
  assert.match(e.message, /site web|entreprise|LinkedIn/, 'dit quoi compléter');
  assert.match(e.message, /relance/, 'dit quoi faire ensuite');
  assert.strictEqual(e.httpStatus, 502, "une panne du fournisseur n'est pas une panne de l'app");
  assert.match(e.detail, /HTTP 400/, 'le détail technique reste disponible pour le journal');
});

test('FullEnrich : clé refusée, crédits épuisés, surcharge', () => {
  assert.match(fullenrich.traduireErreur(erreurHttp(401, {})).message, /Clé API FullEnrich/);
  assert.match(fullenrich.traduireErreur(erreurHttp(402, {})).message, /crédits/);
  assert.match(fullenrich.traduireErreur(erreurHttp(429, {})).message, /minute/);
  assert.match(fullenrich.traduireErreur(erreurHttp(503, {})).message, /indisponible/);
  for (const s of [401, 402, 429, 503]) lisible(fullenrich.traduireErreur(erreurHttp(s, {})).message);
});

test('FullEnrich : la charge utile ne contient plus jamais de champ vide', () => {
  const sansSite = fullenrich.contactPayloadV2({ id: 7, first_name: 'Nadia', last_name: 'Roux', company: 'Studio Nord', domain: '', linkedin_url: '', email: '' });
  assert.ok(!('domain' in sansSite), 'pas de domain vide');
  assert.ok(!('linkedin_url' in sansSite), 'pas de linkedin_url vide');
  assert.strictEqual(sansSite.company_name, 'Studio Nord');
  assert.deepStrictEqual(sansSite.enrich_fields, ['contact.work_emails', 'contact.phones'], 'seulement les champs documentés');
  assert.deepStrictEqual(sansSite.custom, { contact_id: '7' });

  const complet = fullenrich.contactPayloadV2({ id: 8, first_name: 'Yanis', last_name: 'B', company: 'Atelier Sud', domain: 'https://www.ateliersud.fr/', linkedin_url: 'https://www.linkedin.com/in/yanis' });
  assert.strictEqual(complet.domain, 'ateliersud.fr', 'le domaine est nettoyé');
  assert.strictEqual(complet.linkedin_url, 'https://www.linkedin.com/in/yanis');
});

test('Anthropic : « credit balance is too low » dit où recharger et comment repasser sur les templates', () => {
  const e = claude.traduireErreurAnthropic(erreurHttp(400, {
    type: 'error',
    error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' },
    request_id: 'req_011Cew86R1',
  }, 'https://api.anthropic.com/v1/messages'));
  lisible(e.message);
  assert.match(e.message, /crédit/);
  assert.match(e.message, /console\.anthropic\.com/, 'dit où aller');
  assert.match(e.message, /Réglages/, 'dit comment retomber sur les templates');
  assert.strictEqual(e.httpStatus, 502);
});

test('Anthropic : clé refusée, modèle inconnu, limite de rythme, surcharge', () => {
  const cas = [
    [401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, /Clé API Anthropic/],
    [404, { error: { type: 'not_found_error', message: 'model: nope' } }, /modèle/i],
    [429, { error: { type: 'rate_limit_error', message: 'rate limited' } }, /minute/],
    [529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, /surchargée/],
  ];
  for (const [status, body, attendu] of cas) {
    const e = claude.traduireErreurAnthropic(erreurHttp(status, body));
    lisible(e.message);
    assert.match(e.message, attendu, `statut ${status}`);
  }
});
