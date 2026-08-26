'use strict';
// ⚔️ LA CHASSE — CRM de prospection gamifié d'OTEA Production.
// Serveur zéro dépendance (Node ≥ 22.13) : node server.js puis http://localhost:1337
// Les clés API restent en local (data/prospection.db) : le serveur n'écoute que sur 127.0.0.1.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// --- .env optionnel (PENNYLANE_API_KEY=..., etc.) chargé avant le reste
(function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) process.env[m[1]] = process.env[m[1]] || m[2].replace(/^["']|["']$/g, '');
  }
})();

const dbApi = require('./src/db');
const { get, all, run, nowIso, localDay } = dbApi;
const playbooks = require('./src/playbooks');
const game = require('./src/gamification');
const csv = require('./src/csv');
const pennylane = require('./src/integrations/pennylane');
const fullenrich = require('./src/integrations/fullenrich');
const hubspot = require('./src/integrations/hubspot');
const claude = require('./src/integrations/claude');
const { seedDemo } = require('./seed');

playbooks.seedTemplates(dbApi);

const PORT = Number(process.env.PORT || 1337);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------- utilitaires HTTP
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Corps de requête trop volumineux')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function serveStatic(res, urlPath) {
  const clean = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, clean === '/' || clean === '\\' ? 'index.html' : clean);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(PUBLIC_DIR, 'index.html');
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(filePath).pipe(res);
}

// ---------------------------------------------------------------- routes
const routes = [];
function route(method, pattern, handler) {
  const names = [];
  const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (m, name) => { names.push(name); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, names, handler });
}

const USER_ACTIONS = ['note', 'connexion_linkedin', 'message_envoye', 'relance', 'appel', 'reponse_envoyee', 'reponse_recue', 'rdv_pris', 'devis_envoye', 'devis_accepte', 'facture', 'disqualifie'];

// ---- état global (dashboard)
route('GET', '/api/state', async () => game.fullState());

// ---- contacts
route('GET', '/api/contacts', async (req, params, query) => {
  const where = ['1=1'];
  const args = [];
  if (query.archived === '1') where.push('archived = 1'); else where.push('archived = 0');
  if (query.search) {
    where.push(`(first_name LIKE ? OR last_name LIKE ? OR company LIKE ? OR email LIKE ?)`);
    const s = `%${query.search}%`;
    args.push(s, s, s, s);
  }
  if (query.segment) { where.push('segment = ?'); args.push(query.segment); }
  if (query.stage) { where.push('stage = ?'); args.push(query.stage); }
  if (query.origin) { where.push('origin = ?'); args.push(query.origin); }
  if (query.former === '1') where.push('is_former_client = 1');
  if (query.enrichable === '1') where.push(`(email = '' OR phone = '')`);
  if (query.due === '1') { where.push(`stage NOT IN ('gagne','perdu') AND next_action_at != '' AND next_action_at <= ?`); args.push(localDay()); }

  const total = Number(get(`SELECT COUNT(*) AS n FROM contacts WHERE ${where.join(' AND ')}`, ...args).n);
  const sortCols = { updated_at: 'updated_at', created_at: 'created_at', name: 'last_name', company: 'company', next_action_at: 'next_action_at', revenue: 'revenue_history' };
  const sort = sortCols[query.sort] || 'updated_at';
  const dir = query.dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(query.limit) || 100, 500);
  const offset = Number(query.offset) || 0;
  const rows = all(`SELECT * FROM contacts WHERE ${where.join(' AND ')} ORDER BY ${sort} ${dir} LIMIT ${limit} OFFSET ${offset}`, ...args);
  return { total, contacts: rows };
});

route('POST', '/api/contacts', async (req) => {
  const body = await readBody(req);
  const contact = dbApi.insertContact({ ...body, origin: body.origin || 'manuel' });
  return { contact };
});

route('GET', '/api/contacts/:id', async (req, params) => {
  const contact = get('SELECT * FROM contacts WHERE id = ?', params.id);
  if (!contact) throw httpError(404, 'Contact introuvable');
  const activities = all('SELECT * FROM activities WHERE contact_id = ? ORDER BY id DESC LIMIT 100', params.id);
  const deals = all('SELECT * FROM deals WHERE contact_id = ? ORDER BY id DESC', params.id);
  const touches = Number(get(`SELECT COUNT(*) AS n FROM activities WHERE contact_id = ? AND type IN (${game.TOUCH_TYPES.map(() => '?').join(',')})`, params.id, ...game.TOUCH_TYPES).n);
  return { contact, activities, deals, touches, suggested_template: playbooks.suggestedTemplateCode(contact, touches) };
});

route('PATCH', '/api/contacts/:id', async (req, params) => {
  const body = await readBody(req);
  const existing = get('SELECT * FROM contacts WHERE id = ?', params.id);
  if (!existing) throw httpError(404, 'Contact introuvable');
  let celebration = null;
  if (body.stage && body.stage !== existing.stage) {
    celebration = game.logAction({ contact_id: existing.id, type: 'stage_change', note: `${existing.stage} → ${body.stage}`, meta: { manual: true } });
  }
  const contact = dbApi.updateContact(params.id, body);
  return { contact, celebration };
});

route('DELETE', '/api/contacts/:id', async (req, params) => {
  run('DELETE FROM contacts WHERE id = ?', params.id);
  return { ok: true };
});

route('POST', '/api/contacts/bulk', async (req) => {
  const { ids = [], patch = {}, action = 'patch' } = await readBody(req);
  if (action === 'delete') {
    for (const id of ids) run('DELETE FROM contacts WHERE id = ?', id);
    return { ok: true, count: ids.length };
  }
  for (const id of ids) dbApi.updateContact(id, patch);
  return { ok: true, count: ids.length };
});

// ---- import CSV (les lignes arrivent déjà mappées par le front)
route('POST', '/api/import/csv', async (req) => {
  const { rows = [], origin = 'csv', default_segment = 'inconnu', as_former = false } = await readBody(req);
  let created = 0, merged = 0, skipped = 0;
  for (const r of rows) {
    if (!r.first_name && !r.last_name && !r.email && !r.company) { skipped++; continue; }
    const { created: isNew } = dbApi.upsertContact({
      ...r,
      origin,
      segment: r.segment || default_segment,
      is_former_client: as_former ? 1 : (r.is_former_client ? 1 : 0),
    });
    if (isNew) created++; else merged++;
  }
  let celebration = null;
  if (created + merged > 0) {
    game.insertActivity({ type: 'import', xp: Math.min(created, 50), note: `Import ${origin} : ${created} nouveaux, ${merged} fusionnés`, meta: { count: created, source: origin } });
    const badges = game.checkBadges();
    celebration = { badges_won: badges };
  }
  return { created, merged, skipped, celebration };
});

route('POST', '/api/import/parse', async (req) => {
  // Reçoit le texte CSV brut, renvoie entêtes + aperçu + mapping auto-détecté.
  const { text = '' } = await readBody(req);
  const parsed = csv.parse(text);
  return {
    headers: parsed.headers,
    delimiter: parsed.delimiter,
    total: parsed.rows.length,
    preview: parsed.rows.slice(0, 5),
    rows: parsed.rows,
    auto_mapping: csv.autoMap(parsed.headers),
  };
});

route('GET', '/api/export.csv', async (req, params, query, res) => {
  const rows = all('SELECT * FROM contacts WHERE archived = 0 ORDER BY id');
  const headers = ['first_name', 'last_name', 'email', 'phone', 'company', 'job_title', 'linkedin_url', 'segment', 'stage', 'origin', 'is_former_client', 'revenue_history', 'city', 'notes'];
  const body = csv.toCsv(headers, rows);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="la-chasse-contacts.csv"' });
  res.end(body);
  return null; // réponse déjà envoyée
});

// ---- file du Mode Chasse
route('GET', '/api/queue', async (req, params, query) => {
  const queue = game.huntQueue(Math.min(Number(query.limit) || 15, 50));
  return { queue };
});

// ---- actions (cœur de la gamification)
route('POST', '/api/actions', async (req) => {
  const body = await readBody(req);
  if (!USER_ACTIONS.includes(body.type)) throw httpError(400, `Type d'action non autorisé : ${body.type}`);
  return game.logAction({ contact_id: body.contact_id || null, deal_id: body.deal_id || null, type: body.type, note: body.note || '', meta: body.meta || {} });
});

// ---- templates
route('GET', '/api/templates', async () => ({ templates: all('SELECT * FROM templates ORDER BY sort, id') }));
route('POST', '/api/templates', async (req) => {
  const b = await readBody(req);
  const { lastId } = run('INSERT INTO templates (code, name, segment, channel, subject, body, builtin, sort) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    b.code || `custom_${Date.now()}`, b.name || 'Sans titre', b.segment || '', b.channel || 'email', b.subject || '', b.body || '', b.sort || 90);
  return { template: get('SELECT * FROM templates WHERE id = ?', lastId) };
});
route('PATCH', '/api/templates/:id', async (req, params) => {
  const b = await readBody(req);
  const fields = ['name', 'segment', 'channel', 'subject', 'body', 'sort'];
  const sets = fields.filter((f) => b[f] !== undefined);
  if (sets.length) run(`UPDATE templates SET ${sets.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, ...sets.map((f) => b[f]), params.id);
  return { template: get('SELECT * FROM templates WHERE id = ?', params.id) };
});
route('DELETE', '/api/templates/:id', async (req, params) => {
  run('DELETE FROM templates WHERE id = ? AND builtin = 0', params.id);
  return { ok: true };
});
route('POST', '/api/templates/render', async (req) => {
  const { template_id, code, contact_id } = await readBody(req);
  const tpl = template_id ? get('SELECT * FROM templates WHERE id = ?', template_id) : get('SELECT * FROM templates WHERE code = ?', code);
  if (!tpl) throw httpError(404, 'Template introuvable');
  const contact = contact_id ? get('SELECT * FROM contacts WHERE id = ?', contact_id) : {};
  return { rendered: playbooks.renderTemplate(tpl, contact || {}, dbApi.allSettings()) };
});

// ---- deals (devis / factures)
route('GET', '/api/deals', async () => ({
  deals: all(`SELECT d.*, c.first_name, c.last_name, c.company FROM deals d JOIN contacts c ON c.id = d.contact_id ORDER BY d.id DESC`),
}));
route('POST', '/api/deals', async (req) => {
  const b = await readBody(req);
  if (!b.contact_id) throw httpError(400, 'contact_id requis');
  const now = nowIso();
  const { lastId } = run('INSERT INTO deals (contact_id, title, amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    b.contact_id, b.title || 'Devis', Number(b.amount) || 0, b.status || 'brouillon', now, now);
  let celebration = null;
  if ((b.status || 'brouillon') === 'devis_envoye') {
    celebration = game.logAction({ contact_id: b.contact_id, deal_id: lastId, type: 'devis_envoye', note: `${b.title || 'Devis'} — ${Number(b.amount) || 0} €` });
  }
  return { deal: get('SELECT * FROM deals WHERE id = ?', lastId), celebration };
});
route('PATCH', '/api/deals/:id', async (req, params) => {
  const b = await readBody(req);
  const deal = get('SELECT * FROM deals WHERE id = ?', params.id);
  if (!deal) throw httpError(404, 'Deal introuvable');
  let celebration = null;
  const fields = ['title', 'amount', 'currency'];
  const sets = fields.filter((f) => b[f] !== undefined);
  if (sets.length) run(`UPDATE deals SET ${sets.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...sets.map((f) => b[f]), nowIso(), params.id);
  if (b.status && b.status !== deal.status) {
    run(`UPDATE deals SET status = ?, updated_at = ?, invoiced_at = CASE WHEN ? = 'facture' THEN ? ELSE invoiced_at END WHERE id = ?`,
      b.status, nowIso(), b.status, nowIso(), params.id);
    if (b.status === 'devis_envoye') celebration = game.logAction({ contact_id: deal.contact_id, deal_id: deal.id, type: 'devis_envoye', note: deal.title });
    if (b.status === 'accepte') celebration = game.logAction({ contact_id: deal.contact_id, deal_id: deal.id, type: 'devis_accepte', note: deal.title });
    if (b.status === 'facture') celebration = game.logAction({ contact_id: deal.contact_id, deal_id: deal.id, type: 'facture', note: `${deal.title} — ${deal.amount} €` });
  }
  return { deal: get('SELECT * FROM deals WHERE id = ?', params.id), celebration };
});
route('DELETE', '/api/deals/:id', async (req, params) => {
  run('DELETE FROM deals WHERE id = ?', params.id);
  return { ok: true };
});

// ---- inbox (demandes entrantes)
route('GET', '/api/inbox', async () => ({
  requests: all(`SELECT i.*, c.first_name, c.last_name, c.company FROM inbox i LEFT JOIN contacts c ON c.id = i.contact_id ORDER BY i.id DESC`),
}));
route('POST', '/api/inbox', async (req) => {
  const b = await readBody(req);
  const now = nowIso();
  const { lastId } = run('INSERT INTO inbox (contact_id, source, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    b.contact_id || null, b.source || 'email', b.content || '', now, now);
  return { request: get('SELECT * FROM inbox WHERE id = ?', lastId) };
});
route('PATCH', '/api/inbox/:id', async (req, params) => {
  const b = await readBody(req);
  const item = get('SELECT * FROM inbox WHERE id = ?', params.id);
  if (!item) throw httpError(404, 'Demande introuvable');
  const fields = ['contact_id', 'source', 'content', 'reply', 'status'];
  const sets = fields.filter((f) => b[f] !== undefined);
  if (sets.length) run(`UPDATE inbox SET ${sets.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...sets.map((f) => b[f]), nowIso(), params.id);
  let celebration = null;
  if (b.status === 'repondu' && item.status !== 'repondu') {
    celebration = game.logAction({ contact_id: item.contact_id || b.contact_id || null, type: 'reponse_envoyee', note: 'Demande entrante traitée' });
  }
  return { request: get('SELECT * FROM inbox WHERE id = ?', params.id), celebration };
});
route('DELETE', '/api/inbox/:id', async (req, params) => { run('DELETE FROM inbox WHERE id = ?', params.id); return { ok: true }; });

// ---- IA (rédaction)
route('POST', '/api/ai/draft', async (req) => {
  const b = await readBody(req);
  const contact = b.contact_id ? get('SELECT * FROM contacts WHERE id = ?', b.contact_id) : null;
  return claude.draft({ contact, purpose: b.purpose || 'premier_contact', incoming_text: b.incoming_text || '', instructions: b.instructions || '' });
});

// ---- réglages
const SECRET_KEYS = ['pennylane_api_key', 'fullenrich_api_key', 'hubspot_token', 'anthropic_api_key'];
const MASK = '••••••••';
route('GET', '/api/settings', async () => {
  const s = dbApi.allSettings();
  const out = { ...s };
  for (const k of SECRET_KEYS) out[k] = s[k] ? MASK + String(s[k]).slice(-4) : '';
  return { settings: out };
});
route('PUT', '/api/settings', async (req) => {
  const b = await readBody(req);
  for (const [k, v] of Object.entries(b)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    if (SECRET_KEYS.includes(k) && String(v).startsWith(MASK)) continue; // valeur masquée inchangée
    dbApi.setSetting(k, v);
  }
  return { ok: true };
});

// ---- intégrations
route('GET', '/api/pennylane/test', async () => pennylane.test());
route('POST', '/api/pennylane/import', async () => pennylane.importCustomers());
route('POST', '/api/pennylane/quote', async (req) => {
  const b = await readBody(req);
  const contact = get('SELECT * FROM contacts WHERE id = ?', b.contact_id);
  if (!contact) throw httpError(404, 'Contact introuvable');
  return pennylane.createQuote(contact, { title: b.title, lines: b.lines || [], deadline_days: b.deadline_days || 30, extra: b.extra || {} });
});
route('POST', '/api/pennylane/invoice_from_quote', async (req) => {
  const b = await readBody(req);
  const deal = get('SELECT * FROM deals WHERE id = ?', b.deal_id);
  if (!deal) throw httpError(404, 'Deal introuvable');
  return pennylane.invoiceFromQuote(deal);
});

route('GET', '/api/fullenrich/test', async () => fullenrich.test());
route('POST', '/api/fullenrich/enrich', async (req) => {
  const b = await readBody(req);
  return fullenrich.startEnrich(b.contact_ids || []);
});
route('POST', '/api/fullenrich/poll', async () => ({ results: await fullenrich.pollPending() }));
route('GET', '/api/fullenrich/jobs', async () => ({ jobs: all('SELECT * FROM enrich_jobs ORDER BY id DESC LIMIT 20') }));

route('GET', '/api/hubspot/test', async () => hubspot.test());
route('POST', '/api/hubspot/import', async () => hubspot.importContacts());
route('POST', '/api/hubspot/push', async (req) => {
  const b = await readBody(req);
  return hubspot.pushMany(b.contact_ids || []);
});

// ---- démo
route('POST', '/api/demo', async () => seedDemo(false));

// ---------------------------------------------------------------- serveur
function httpError(status, message) { const e = new Error(message); e.httpStatus = status; return e; }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const query = Object.fromEntries(u.searchParams.entries());

  if (u.pathname.startsWith('/api')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = u.pathname.match(r.rx);
      if (!m) continue;
      const params = {};
      r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      try {
        const result = await r.handler(req, params, query, res);
        if (result !== null) json(res, 200, result);
      } catch (e) {
        const status = e.httpStatus || 500;
        if (status === 500) console.error(`[erreur] ${req.method} ${u.pathname} →`, e.message);
        json(res, status, { error: e.message });
      }
      return;
    }
    json(res, 404, { error: `Route inconnue : ${req.method} ${u.pathname}` });
    return;
  }

  serveStatic(res, u.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`
  ⚔️  LA CHASSE — CRM de prospection gamifié (OTEA Production)
  ────────────────────────────────────────────────────────────
  ➜  http://localhost:${PORT}
  Base de données : ${dbApi.DB_PATH}
  Objectif : ${dbApi.getSetting('objectif_factures')} factures. Bonne chasse. 🎯
`);
});
