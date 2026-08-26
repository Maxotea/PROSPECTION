'use strict';
// Intégration FullEnrich : enrichissement email + téléphone en cascade (waterfall).
// API v2 : POST /api/v2/contact/enrich/bulk (max 100 contacts), puis polling
// GET /api/v2/contact/enrich/bulk/{enrichment_id}. Fallback v1 si le compte
// n'a pas accès à la v2 (champs firstname/lastname au lieu de first_name/last_name).
// ⚠️ Chaque enrichissement consomme des crédits FullEnrich.

const dbApi = require('../db');
const { get, all, run, getSetting, nowIso } = dbApi;
const game = require('../gamification');
const { apiFetch } = require('./util');

function base() { return (getSetting('fullenrich_base') || 'https://app.fullenrich.com/api/v2').replace(/\/$/, ''); }
function headers() {
  const key = getSetting('fullenrich_api_key');
  if (!key) throw new Error('Clé API FullEnrich manquante — renseigne-la dans Réglages.');
  return { Authorization: `Bearer ${key}` };
}

async function test() {
  // Pas d'endpoint "ping" documenté : on tente une lecture avec un id bidon,
  // un 404 propre prouve que l'authentification passe.
  try {
    await apiFetch(`${base()}/contact/enrich/bulk/test-ping`, { headers: headers() });
    return { ok: true, message: 'Connexion FullEnrich OK' };
  } catch (e) {
    if (e.status && e.status !== 401 && e.status !== 403) return { ok: true, message: 'Connexion FullEnrich OK (clé acceptée)' };
    throw e;
  }
}

function domainFromContact(c) {
  if (c.domain) return String(c.domain).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (c.email && c.email.includes('@')) {
    const d = c.email.split('@')[1];
    if (!/gmail|hotmail|outlook|yahoo|orange|free|sfr|wanadoo|icloud|laposte/i.test(d)) return d;
  }
  return '';
}

function contactPayloadV2(c) {
  return {
    first_name: c.first_name || '',
    last_name: c.last_name || '',
    domain: domainFromContact(c),
    company_name: c.company || '',
    linkedin_url: c.linkedin_url || '',
    enrich_fields: ['contact.work_emails', 'contact.personal_emails', 'contact.phones'],
    custom: { contact_id: String(c.id) },
  };
}

function contactPayloadV1(c) {
  return {
    firstname: c.first_name || '',
    lastname: c.last_name || '',
    domain: domainFromContact(c),
    company_name: c.company || '',
    linkedin_url: c.linkedin_url || '',
    enrich_fields: ['contact.emails', 'contact.phones'],
    custom: { contact_id: String(c.id) },
  };
}

// Lance un enrichissement bulk pour une liste de contacts (ids). Retourne le job créé.
async function startEnrich(contactIds) {
  const contacts = contactIds
    .map((id) => get('SELECT * FROM contacts WHERE id = ?', id))
    .filter(Boolean)
    .filter((c) => (c.first_name || c.last_name) && (c.company || c.domain || c.linkedin_url || c.email));
  if (!contacts.length) throw new Error('Aucun contact enrichissable : il faut au minimum un nom ET (entreprise, domaine ou URL LinkedIn).');
  const batch = contacts.slice(0, 100);

  const name = `la-chasse ${dbApi.localDay()} (${batch.length} contacts)`;
  let res;
  let apiVersion = 'v2';
  try {
    res = await apiFetch(`${base()}/contact/enrich/bulk`, {
      method: 'POST', headers: headers(),
      body: { name, datas: batch.map(contactPayloadV2) },
    });
  } catch (e) {
    if (e.status && e.status >= 400 && e.status < 500 && base().includes('/v2')) {
      // Fallback v1 : anciens comptes / anciens noms de champs.
      apiVersion = 'v1';
      res = await apiFetch(`${base().replace('/v2', '/v1')}/contact/enrich/bulk`, {
        method: 'POST', headers: headers(),
        body: { name, datas: batch.map(contactPayloadV1) },
      });
    } else throw e;
  }

  const externalId = String(res && (res.enrichment_id || res.id || (res.data && res.data.enrichment_id)) || '');
  if (!externalId) throw new Error(`Enrichissement lancé mais id introuvable dans la réponse : ${JSON.stringify(res).slice(0, 300)}`);

  const now = nowIso();
  const { lastId } = run(
    'INSERT INTO enrich_jobs (provider, external_id, status, contact_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    `fullenrich-${apiVersion}`, externalId, 'pending', JSON.stringify(batch.map((c) => c.id)), now, now
  );
  for (const c of batch) dbApi.updateContact(c.id, { enrich_status: 'pending' });
  return { job_id: lastId, external_id: externalId, count: batch.length, skipped: contacts.length - batch.length };
}

function extractContactData(entry) {
  const c = entry.contact || entry;
  const email =
    c.most_probable_email ||
    (Array.isArray(c.work_emails) && c.work_emails[0] && (c.work_emails[0].email || c.work_emails[0])) ||
    (Array.isArray(c.emails) && c.emails[0] && (c.emails[0].email || c.emails[0])) ||
    (Array.isArray(c.personal_emails) && c.personal_emails[0] && (c.personal_emails[0].email || c.personal_emails[0])) || '';
  const phone =
    c.most_probable_phone ||
    (Array.isArray(c.phones) && c.phones[0] && (c.phones[0].number || c.phones[0].phone || c.phones[0])) || '';
  return {
    email: typeof email === 'string' ? email : '',
    email_status: c.most_probable_email_status || '',
    phone: typeof phone === 'string' ? phone : '',
    job_title: c.job_title || c.title || '',
    company: (c.company && (c.company.name || c.company.company_name)) || '',
    linkedin_url: c.linkedin_url || '',
  };
}

// Interroge un job en attente et écrit les résultats sur les contacts.
async function pollJob(job) {
  const apiBase = job.provider.endsWith('v1') ? base().replace('/v2', '/v1') : base();
  const res = await apiFetch(`${apiBase}/contact/enrich/bulk/${encodeURIComponent(job.external_id)}`, { headers: headers() });
  const status = String(res && (res.status || res.state) || '').toUpperCase();

  if (!['FINISHED', 'COMPLETED', 'DONE'].includes(status)) {
    run('UPDATE enrich_jobs SET status = ?, updated_at = ? WHERE id = ?', 'pending', nowIso(), job.id);
    return { job_id: job.id, status: status || 'PENDING', enriched: 0, pending: true };
  }

  const entries = (res && (res.datas || res.data || res.results)) || [];
  let enriched = 0;
  for (const entry of entries) {
    const custom = entry.custom || {};
    const cid = Number(custom.contact_id || 0);
    if (!cid) continue;
    const contact = get('SELECT * FROM contacts WHERE id = ?', cid);
    if (!contact) continue;
    const data = extractContactData(entry);
    const patch = { enrich_status: (data.email || data.phone) ? 'done' : 'not_found' };
    // On ne remplit que les trous — on n'écrase jamais une donnée existante.
    if (data.email && !contact.email) patch.email = data.email;
    if (data.email_status) patch.email_status = data.email_status;
    if (data.phone && !contact.phone) patch.phone = data.phone;
    if (data.job_title && !contact.job_title) patch.job_title = data.job_title;
    if (data.company && !contact.company) patch.company = data.company;
    if (data.linkedin_url && !contact.linkedin_url) patch.linkedin_url = data.linkedin_url;
    dbApi.updateContact(cid, patch);
    if (data.email || data.phone) enriched++;
  }

  run('UPDATE enrich_jobs SET status = ?, result = ?, updated_at = ? WHERE id = ?', 'done', JSON.stringify({ enriched, total: entries.length }), nowIso(), job.id);
  if (enriched > 0) {
    game.insertActivity({ type: 'enrich', xp: Math.min(enriched * 3, 60), note: `FullEnrich : ${enriched} contact(s) enrichi(s)`, meta: { count: enriched } });
    game.checkBadges();
  }
  return { job_id: job.id, status: 'FINISHED', enriched, total: entries.length, pending: false };
}

// Poll tous les jobs en attente (appelé par le front tant qu'il en reste).
async function pollPending() {
  const jobs = all(`SELECT * FROM enrich_jobs WHERE status = 'pending' ORDER BY id`);
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await pollJob(job));
    } catch (e) {
      run('UPDATE enrich_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?', 'error', e.message, nowIso(), job.id);
      results.push({ job_id: job.id, status: 'ERROR', error: e.message, pending: false });
    }
  }
  return results;
}

module.exports = { test, startEnrich, pollJob, pollPending };
