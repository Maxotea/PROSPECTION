'use strict';
// Intégration HubSpot (CRM hybride) :
//  - import des contacts HubSpot → la Chasse
//  - push : créer/mettre à jour un contact dans HubSpot depuis la Chasse
// Auth : token d'application privée (Réglages → HubSpot).
// Créer le token : HubSpot → Paramètres → Intégrations → Applications privées
// (scopes : crm.objects.contacts.read + crm.objects.contacts.write).

const dbApi = require('../db');
const { get, getSetting, upsertContact } = dbApi;
const game = require('../gamification');
const { apiFetch } = require('./util');

const BASE = 'https://api.hubapi.com';
const PROPS = ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle', 'website', 'city', 'lifecyclestage'];

function headers() {
  const token = getSetting('hubspot_token');
  if (!token) throw new Error("Token HubSpot manquant — renseigne-le dans Réglages (application privée).");
  return { Authorization: `Bearer ${token}` };
}

async function test() {
  await apiFetch(`${BASE}/crm/v3/objects/contacts?limit=1`, { headers: headers() });
  return { ok: true, message: 'Connexion HubSpot OK' };
}

async function importContacts() {
  let after = null;
  let created = 0, merged = 0, total = 0;
  for (let page = 0; page < 100; page++) {
    const url = `${BASE}/crm/v3/objects/contacts?limit=100&properties=${PROPS.join(',')}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const body = await apiFetch(url, { headers: headers() });
    const results = (body && body.results) || [];
    total += results.length;
    for (const r of results) {
      const p = r.properties || {};
      if (!p.firstname && !p.lastname && !p.email && !p.company) continue;
      const isClient = ['customer', 'client'].includes(String(p.lifecyclestage || '').toLowerCase());
      const { created: isNew } = upsertContact({
        first_name: p.firstname || '',
        last_name: p.lastname || '',
        email: p.email || '',
        phone: p.phone || '',
        company: p.company || '',
        job_title: p.jobtitle || '',
        domain: p.website || '',
        city: p.city || '',
        hubspot_id: String(r.id),
        origin: 'hubspot',
        is_former_client: isClient ? 1 : 0,
      });
      if (isNew) created++; else merged++;
    }
    after = body && body.paging && body.paging.next ? body.paging.next.after : null;
    if (!after) break;
  }
  if (created + merged > 0) {
    game.insertActivity({ type: 'import', xp: Math.min(created, 50), note: `Import HubSpot : ${created} nouveaux, ${merged} fusionnés`, meta: { count: created, source: 'hubspot' } });
    game.checkBadges();
  }
  return { created, merged, total };
}

function toHubspotProps(contact) {
  const props = {
    firstname: contact.first_name || '',
    lastname: contact.last_name || '',
    phone: contact.phone || '',
    company: contact.company || '',
    jobtitle: contact.job_title || '',
  };
  if (contact.email) props.email = contact.email;
  if (contact.city) props.city = contact.city;
  return props;
}

// Pousse un contact vers HubSpot (création ou mise à jour). Renvoie l'id HubSpot.
async function pushContact(contactId) {
  const contact = get('SELECT * FROM contacts WHERE id = ?', contactId);
  if (!contact) throw new Error(`Contact ${contactId} introuvable.`);

  let hsId = contact.hubspot_id;
  if (!hsId && contact.email) {
    // Recherche par email pour éviter les doublons côté HubSpot.
    try {
      const found = await apiFetch(`${BASE}/crm/v3/objects/contacts/search`, {
        method: 'POST', headers: headers(),
        body: { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: contact.email }] }], limit: 1 },
      });
      if (found && found.results && found.results[0]) hsId = String(found.results[0].id);
    } catch { /* la recherche est un confort : on crée si elle échoue */ }
  }

  if (hsId) {
    await apiFetch(`${BASE}/crm/v3/objects/contacts/${hsId}`, { method: 'PATCH', headers: headers(), body: { properties: toHubspotProps(contact) } });
  } else {
    const res = await apiFetch(`${BASE}/crm/v3/objects/contacts`, { method: 'POST', headers: headers(), body: { properties: toHubspotProps(contact) } });
    hsId = String(res.id);
  }
  dbApi.updateContact(contact.id, { hubspot_id: hsId });
  return { hubspot_id: hsId };
}

async function pushMany(contactIds) {
  const out = { pushed: 0, errors: [] };
  for (const id of contactIds) {
    try { await pushContact(id); out.pushed++; }
    catch (e) { out.errors.push({ contact_id: id, error: e.message }); }
  }
  return out;
}

module.exports = { test, importContacts, pushContact, pushMany };
