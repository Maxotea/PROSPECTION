'use strict';
// Intégration Pennylane (API externe v2) :
//  - import des clients existants ("anciens clients") + CA facturé par client
//  - création de client, création de devis (quotes), facture depuis devis (brouillon)
// Doc : https://pennylane.readme.io — base https://app.pennylane.com/api/external/v2

const dbApi = require('../db');
const { get, all, run, getSetting, nowIso, upsertContact } = dbApi;
const game = require('../gamification');
const { apiFetch } = require('./util');

function base() { return (getSetting('pennylane_base') || 'https://app.pennylane.com/api/external/v2').replace(/\/$/, ''); }
function headers() {
  const key = getSetting('pennylane_api_key');
  if (!key) throw new Error("Clé API Pennylane manquante — renseigne-la dans Réglages.");
  return { Authorization: `Bearer ${key}` };
}

// Liste paginée v2 (curseur) avec garde-fous sur les formats de réponse.
async function listAll(path, { maxPages = 60 } = {}) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${base()}${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = await apiFetch(url, { headers: headers() });
    let chunk = [];
    if (Array.isArray(body)) chunk = body;
    else if (body && Array.isArray(body.items)) chunk = body.items;
    else if (body && typeof body === 'object') {
      const arr = Object.values(body).find((v) => Array.isArray(v));
      if (arr) chunk = arr;
    }
    items.push(...chunk);
    cursor = body && (body.next_cursor || body.nextCursor) ? (body.next_cursor || body.nextCursor) : null;
    const hasMore = body && (body.has_more === true || !!cursor);
    if (!hasMore || !chunk.length) break;
  }
  return items;
}

async function test() {
  await listAll('/customers', { maxPages: 1 });
  return { ok: true, message: 'Connexion Pennylane OK' };
}

function pick(obj, ...keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, part) => (o ? o[part] : undefined), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

// Import des clients Pennylane → contacts "anciens clients", avec CA cumulé
// pour auto-segmenter (>= seuil → grand compte, sinon PME).
async function importCustomers() {
  const customers = await listAll('/customers');

  // CA par client via les factures de vente (best effort : si l'appel échoue, on importe sans CA).
  const revenue = {};
  let invoicesError = null;
  try {
    const invoices = await listAll('/customer_invoices');
    for (const inv of invoices) {
      const cid = String(pick(inv, 'customer_id', 'customer.id') || '');
      if (!cid) continue;
      const amount = parseFloat(String(pick(inv, 'currency_amount', 'amount', 'currency_amount_before_tax', 'amount_before_tax') || '0').replace(',', '.')) || 0;
      revenue[cid] = (revenue[cid] || 0) + amount;
    }
  } catch (e) { invoicesError = e.message; }

  const seuil = Number(getSetting('seuil_grand_compte') || 5000);
  let created = 0, merged = 0;
  for (const c of customers) {
    const id = String(pick(c, 'id') || '');
    if (!id) continue;
    const isCompany = (pick(c, 'customer_type') || '').toLowerCase() !== 'individual';
    const emails = c.emails || c.billing_email || c.email || [];
    const email = Array.isArray(emails) ? (emails[0] || '') : String(emails);
    const rev = revenue[id] || 0;
    const data = {
      first_name: pick(c, 'first_name'),
      last_name: pick(c, 'last_name'),
      company: isCompany ? pick(c, 'name', 'company_name') : pick(c, 'company_name'),
      email,
      phone: pick(c, 'phone', 'phone_number'),
      city: pick(c, 'billing_address.city', 'city'),
      country: pick(c, 'billing_address.country_alpha2', 'country'),
      domain: pick(c, 'website'),
      pennylane_customer_id: id,
      origin: 'pennylane',
      is_former_client: 1,
      revenue_history: rev,
      segment: rev >= seuil ? 'grand_compte' : (rev > 0 ? 'pme' : 'inconnu'),
      notes: rev > 0 ? `CA historique Pennylane : ${rev.toFixed(0)} €` : '',
    };
    if (!data.company && !data.first_name && !data.last_name) continue;
    const { created: isNew } = upsertContact(data);
    if (isNew) created++; else merged++;
  }

  if (created + merged > 0) {
    game.insertActivity({ type: 'import', xp: Math.min(created, 50), note: `Import Pennylane : ${created} nouveaux, ${merged} fusionnés`, meta: { count: created, source: 'pennylane' } });
    game.checkBadges();
  }
  return { created, merged, total: customers.length, invoices_error: invoicesError };
}

// Crée le client dans Pennylane s'il n'existe pas encore, retourne son id.
async function ensureCustomer(contact, extra = {}) {
  if (contact.pennylane_customer_id) return contact.pennylane_customer_id;

  const asCompany = !!(contact.company || extra.as_company);
  const payload = asCompany
    ? {
        customer_type: 'company',
        name: contact.company || `${contact.first_name} ${contact.last_name}`.trim(),
        emails: contact.email ? [contact.email] : [],
      }
    : {
        customer_type: 'individual',
        first_name: contact.first_name || '—',
        last_name: contact.last_name || '—',
        emails: contact.email ? [contact.email] : [],
      };
  const address = {
    address: extra.address || 'Adresse à compléter',
    postal_code: extra.postal_code || '00000',
    city: extra.city || contact.city || 'À compléter',
    country_alpha2: extra.country_alpha2 || 'FR',
  };
  payload.billing_address = address;
  if (contact.phone) payload.phone = contact.phone;

  const res = await apiFetch(`${base()}/customers`, { method: 'POST', headers: headers(), body: payload });
  const id = String(pick(res, 'id', 'customer.id') || '');
  if (!id) throw new Error(`Client créé mais id introuvable dans la réponse Pennylane : ${JSON.stringify(res).slice(0, 300)}`);
  dbApi.updateContact(contact.id, { pennylane_customer_id: id });
  return id;
}

// Crée un devis Pennylane pour un contact. lines : [{label, quantity, unit_price, vat_rate}]
async function createQuote(contact, { title = '', lines = [], deadline_days = 30, extra = {} }) {
  const customerId = await ensureCustomer(contact, extra);
  const today = dbApi.localDay();
  const payload = {
    customer_id: isNaN(Number(customerId)) ? customerId : Number(customerId),
    date: today,
    deadline: dbApi.addDays(today, deadline_days),
    invoice_lines: lines.map((l) => ({
      label: l.label,
      quantity: Number(l.quantity) || 1,
      unit: 'piece',
      raw_currency_unit_price: String(l.unit_price),
      vat_rate: l.vat_rate || 'FR_200',
    })),
  };
  const res = await apiFetch(`${base()}/quotes`, { method: 'POST', headers: headers(), body: payload });
  const quoteId = String(pick(res, 'id', 'quote.id') || '');
  const fileUrl = pick(res, 'file_url', 'public_file_url', 'public_url', 'quote.file_url');

  const amount = lines.reduce((s, l) => s + (Number(l.quantity) || 1) * (Number(l.unit_price) || 0), 0);
  const now = nowIso();
  const { lastId } = run(
    `INSERT INTO deals (contact_id, title, amount, status, pennylane_quote_id, pennylane_quote_url, created_at, updated_at)
     VALUES (?, ?, ?, 'devis_envoye', ?, ?, ?, ?)`,
    contact.id, title || `Devis ${contact.company || contact.last_name}`, amount, quoteId, String(fileUrl || ''), now, now
  );
  const celebration = game.logAction({ contact_id: contact.id, deal_id: lastId, type: 'devis_envoye', note: `Devis Pennylane #${quoteId} — ${amount.toFixed(0)} € HT` });
  return { deal: get('SELECT * FROM deals WHERE id = ?', lastId), quote_id: quoteId, file_url: fileUrl, celebration, raw: res };
}

// Facture (BROUILLON par défaut : rien n'est finalisé en compta sans validation
// dans Pennylane). Le champ exact varie selon les versions d'API → on tente
// plusieurs formes et on remonte l'erreur Pennylane telle quelle sinon.
async function invoiceFromQuote(deal) {
  if (!deal.pennylane_quote_id) throw new Error('Ce deal n’a pas de devis Pennylane associé.');
  const qid = isNaN(Number(deal.pennylane_quote_id)) ? deal.pennylane_quote_id : Number(deal.pennylane_quote_id);
  const url = `${base()}/customer_invoices/create_from_quote`;
  const attempts = [
    { quote_id: qid, create_draft: true },
    { quote_id: qid, draft: true },
    { quote_id: qid },
  ];
  let lastErr = null;
  for (const body of attempts) {
    try {
      const res = await apiFetch(url, { method: 'POST', headers: headers(), body });
      const invId = String(pick(res, 'id', 'customer_invoice.id', 'invoice.id') || '');
      run('UPDATE deals SET pennylane_invoice_id = ?, updated_at = ? WHERE id = ?', invId, nowIso(), deal.id);
      return { invoice_id: invId, raw: res };
    } catch (e) {
      lastErr = e;
      if (!e.status || e.status >= 500) break; // erreur réseau/serveur : inutile de retenter d'autres formes
    }
  }
  throw lastErr;
}

module.exports = { test, importCustomers, ensureCustomer, createQuote, invoiceFromQuote };
