'use strict';
// ⚔️ LA CHASSE : CRM de prospection gamifié d'OTEA Production.
// Serveur zéro dépendance (Node ≥ 22.13) : node server.js puis http://localhost:1337
// Les clés API restent en local (data/prospection.db) : le serveur n'écoute que sur 127.0.0.1.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Filet de sécurité : Maxime n'est pas développeur. Si quelque chose casse au
// démarrage, il doit lire une phrase qui lui dit quoi faire, pas une trace Node.
function expliquerEtSortir(erreur) {
  const detail = (erreur && erreur.stack) || String(erreur);

  // Cas de très loin le plus fréquent : une première fenêtre de La Chasse est
  // restée ouverte. Ce n'est pas une panne, il n'y a rien à réparer.
  if (erreur && erreur.code === 'EADDRINUSE') {
    console.error(`
  ℹ️  LA CHASSE TOURNE DÉJÀ

  Une autre fenêtre de La Chasse est encore ouverte sur cet ordinateur :
  deux ne peuvent pas tourner en même temps.

  Deux solutions, au choix :
   · Va simplement sur http://localhost:${PORT} : ton app est là, elle fonctionne.
   · Ou ferme l'autre fenêtre noire, puis relance « demarrer.command ».

  (Rien n'est cassé et aucune donnée n'est perdue.)
`);
    process.exit(1);
  }
  console.error(`
  ⚠️  LA CHASSE N'A PAS PU DÉMARRER

  Tes données ne sont pas perdues : elles sont dans le dossier « data ».

  À essayer, dans l'ordre :
   1. Ferme cette fenêtre et relance en double-cliquant sur « demarrer.command ».
   2. Vérifie qu'aucune autre fenêtre de La Chasse ne tourne déjà.
   3. Si ça recommence, copie le texte ci-dessous et envoie-le à Claude.

  ────────────── détail technique ──────────────
${detail}
`);
  process.exit(1);
}
process.on('uncaughtException', expliquerEtSortir);

// Garde-fou version : node:sqlite exige Node ≥ 22.13 : message clair plutôt qu'une erreur cryptique.
{
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    console.error(`\n❌ Ta version de Node.js (${process.version}) est trop ancienne pour La Chasse (il faut la 22.13 ou plus).\n→ Installe la dernière version LTS depuis https://nodejs.org puis relance.\n`);
    process.exit(1);
  }
}

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
const autopilot = require('./src/autopilot');
const campaigns = require('./src/campaigns');
const repertoire = require('./src/importers/repertoire');
const { seedDemo } = require('./seed');
const migrationTirets = require('./src/migrations/tirets');

playbooks.seedTemplates(dbApi);
playbooks.seedSequences(dbApi);
campaigns.seedReferences();

// Reprise unique des textes enregistrés avant l'interdiction du tiret cadratin.
// Retouche cosmétique : elle ne doit jamais empêcher l'app de démarrer.
const bilanTirets = migrationTirets.migrerSansRisque(dbApi, playbooks);
if (bilanTirets.echec || bilanTirets.incidents) {
  console.log('✍️  Réécriture des anciens textes remise à plus tard :', bilanTirets.echec || bilanTirets.incidents.join(' | '));
} else if (!bilanTirets.deja_fait) {
  const total = Object.values(bilanTirets).filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0);
  if (total) console.log(`✍️  Tirets cadratins retirés des textes enregistrés (${JSON.stringify(bilanTirets)})`);
}

const PORT = Number(process.env.PORT || 1337);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

// Mode RÉSEAU (iPad/téléphone sur le même Wi-Fi) : l'app devient visible par
// tout le réseau local → on la verrouille derrière un code d'accès à 6 caractères.
const NETWORK_MODE = !['127.0.0.1', 'localhost', '::1'].includes(HOST);
let RESEAU_CODE = '';
if (NETWORK_MODE) {
  RESEAU_CODE = dbApi.getSetting('reseau_code');
  if (!RESEAU_CODE) {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I/L ambigus
    RESEAU_CODE = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    dbApi.setSetting('reseau_code', RESEAU_CODE);
  }
}

function loginPage(wrong) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>⚔️ La Chasse : accès</title>
  <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0d18;color:#e9edff;font:16px system-ui,sans-serif}
  .box{background:#131830;border:1px solid #242c52;border-radius:16px;padding:32px 36px;text-align:center;max-width:340px}
  input{font:inherit;font-size:26px;letter-spacing:8px;text-align:center;text-transform:uppercase;width:100%;padding:10px;border-radius:10px;border:1px solid #34406e;background:#0e1222;color:#e9edff;margin:14px 0}
  button{font:inherit;font-weight:700;width:100%;padding:12px;border-radius:10px;border:0;background:linear-gradient(135deg,#7c3aed,#8b5cf6);color:#fff;cursor:pointer}
  .err{color:#f87171;font-size:14px}</style></head><body>
  <form class="box" method="POST" action="/acces">
    <div style="font-size:44px">⚔️</div><h2 style="margin:6px 0">La Chasse</h2>
    <p style="color:#93a0c9;font-size:14px">Entre le code affiché dans la fenêtre noire de ton ordinateur.</p>
    ${wrong ? '<p class="err">❌ Mauvais code, réessaie.</p>' : ''}
    <input name="code" maxlength="6" autofocus autocomplete="off" placeholder="••••••">
    <button type="submit">Entrer</button>
  </form></body></html>`;
}

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
route('GET', '/api/state', async () => ({ ...game.fullState(), autopilot: autopilot.state(), campaign: campaigns.currentCampaign() }));

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
  if (query.campaign) { where.push('campaign_id = ?'); args.push(Number(query.campaign)); }
  if (query.sans_icebreaker === '1') where.push(`icebreaker = '' AND is_former_client = 0`);
  if (query.due === '1') { where.push(`stage NOT IN ('gagne','perdu') AND next_action_at != '' AND next_action_at <= ?`); args.push(localDay()); }

  const total = Number(get(`SELECT COUNT(*) AS n FROM contacts WHERE ${where.join(' AND ')}`, ...args).n);
  const sortCols = { updated_at: 'updated_at', created_at: 'created_at', name: 'last_name', company: 'company', next_action_at: 'next_action_at', revenue: 'revenue_history', segment: 'segment', stage: 'stage' };
  const sort = sortCols[query.sort] || 'updated_at';
  const dir = query.dir === 'asc' ? 'ASC' : 'DESC';
  // Les contacts sans échéance passent en dernier quand on trie par prochaine action.
  const orderBy = sort === 'next_action_at' ? `(next_action_at = '') ASC, next_action_at ${dir}` : `${sort} ${dir}`;
  const limit = Math.min(Number(query.limit) || 100, 500);
  const offset = Number(query.offset) || 0;
  const rows = all(`SELECT * FROM contacts WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, ...args);
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
  return {
    contact, activities, deals, touches,
    suggested_template: playbooks.suggestedTemplateCode(contact, touches),
    hints: playbooks.icebreakerHints(contact, dbApi.allSettings()),
  };
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
  const { rows = [], origin = 'csv', default_segment = 'inconnu', as_former = false, campaign_id = 0 } = await readBody(req);
  let created = 0, merged = 0, skipped = 0;
  for (const r of rows) {
    if (!r.first_name && !r.last_name && !r.email && !r.company) { skipped++; continue; }
    const { created: isNew } = dbApi.upsertContact({
      ...r,
      origin,
      segment: r.segment || default_segment,
      is_former_client: as_former ? 1 : (r.is_former_client ? 1 : 0),
      campaign_id: Number(campaign_id) || 0,
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

// ---- file du Mode Chasse (mode=calls → session d'appels)
route('GET', '/api/queue', async (req, params, query) => {
  const limit = Math.min(Number(query.limit) || 15, 50);
  const queue = query.mode === 'calls' ? game.callQueue(limit) : game.huntQueue(limit);
  const settings = dbApi.allSettings();
  return { queue: queue.map((c) => ({ ...c, hints: playbooks.icebreakerHints(c, settings) })) };
});

// ---- actions (cœur de la gamification)
route('POST', '/api/actions', async (req) => {
  const body = await readBody(req);
  if (!USER_ACTIONS.includes(body.type)) throw httpError(400, `Type d'action non autorisé : ${body.type}`);
  const res = game.logAction({ contact_id: body.contact_id || null, deal_id: body.deal_id || null, type: body.type, note: body.note || '', meta: body.meta || {} });
  // Une réponse (ou une disqualification) loggée à la main stoppe la séquence Autopilote du contact.
  if (body.contact_id && ['reponse_recue', 'rdv_pris', 'disqualifie'].includes(body.type)) {
    autopilot.stopForContact(body.contact_id, body.type === 'disqualifie' ? 'disqualifié' : 'a répondu 🎉', body.type === 'disqualifie' ? 'stopped' : 'replied');
  }
  return res;
});

// ---- templates (par défaut : sans les templates de campagne, générés à part)
route('GET', '/api/templates', async (req, params, query) => ({
  templates: query.all === '1'
    ? all('SELECT * FROM templates ORDER BY sort, id')
    : all('SELECT * FROM templates WHERE campaign_id = 0 ORDER BY sort, id'),
}));
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
    celebration = game.logAction({ contact_id: b.contact_id, deal_id: lastId, type: 'devis_envoye', note: `${b.title || 'Devis'} : ${Number(b.amount) || 0} €` });
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
    if (b.status === 'facture') celebration = game.logAction({ contact_id: deal.contact_id, deal_id: deal.id, type: 'facture', note: `${deal.title} : ${deal.amount} €` });
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
const SECRET_KEYS = ['pennylane_api_key', 'fullenrich_api_key', 'hubspot_token', 'anthropic_api_key', 'gmail_app_password'];
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

// ---- 🤖 Autopilote : séquences
route('GET', '/api/sequences', async () => {
  const sequences = all('SELECT * FROM sequences ORDER BY builtin DESC, id').map((s) => ({
    ...s,
    steps: all('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_index', s.id),
    active_count: Number(get(`SELECT COUNT(*) AS n FROM enrollments WHERE sequence_id = ? AND status = 'active'`, s.id).n),
    replied_count: Number(get(`SELECT COUNT(*) AS n FROM enrollments WHERE sequence_id = ? AND status = 'replied'`, s.id).n),
    finished_count: Number(get(`SELECT COUNT(*) AS n FROM enrollments WHERE sequence_id = ? AND status = 'finished'`, s.id).n),
  }));
  return { sequences };
});
route('POST', '/api/sequences', async (req) => {
  const b = await readBody(req);
  const { lastId } = run('INSERT INTO sequences (code, name, segment, description, builtin, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    `custom_${Date.now()}`, b.name || 'Nouvelle séquence', b.segment || '', b.description || '', nowIso());
  for (let i = 0; i < (b.steps || []).length; i++) {
    run('INSERT INTO sequence_steps (sequence_id, step_index, delay_days, template_code) VALUES (?, ?, ?, ?)',
      lastId, i, Number(b.steps[i].delay_days) || 0, b.steps[i].template_code);
  }
  return { id: lastId };
});
route('PATCH', '/api/sequences/:id', async (req, params) => {
  const b = await readBody(req);
  const seq = get('SELECT * FROM sequences WHERE id = ?', params.id);
  if (!seq) throw httpError(404, 'Séquence introuvable');
  if (b.name !== undefined || b.active !== undefined || b.description !== undefined || b.segment !== undefined) {
    run('UPDATE sequences SET name = ?, active = ?, description = ?, segment = ? WHERE id = ?',
      b.name !== undefined ? b.name : seq.name,
      b.active !== undefined ? (b.active ? 1 : 0) : seq.active,
      b.description !== undefined ? b.description : seq.description,
      b.segment !== undefined ? b.segment : seq.segment,
      params.id);
  }
  if (Array.isArray(b.steps)) {
    run('DELETE FROM sequence_steps WHERE sequence_id = ?', params.id);
    for (let i = 0; i < b.steps.length; i++) {
      run('INSERT INTO sequence_steps (sequence_id, step_index, delay_days, template_code) VALUES (?, ?, ?, ?)',
        params.id, i, Number(b.steps[i].delay_days) || 0, b.steps[i].template_code);
    }
  }
  return { ok: true };
});
route('DELETE', '/api/sequences/:id', async (req, params) => {
  const n = Number(get(`SELECT COUNT(*) AS n FROM enrollments WHERE sequence_id = ? AND status = 'active'`, params.id).n);
  if (n > 0) throw httpError(400, `${n} contact(s) encore actifs dans cette séquence : stoppe-les d'abord.`);
  run('DELETE FROM sequences WHERE id = ? AND builtin = 0', params.id);
  return { ok: true };
});
route('POST', '/api/sequences/:id/enroll', async (req, params) => {
  const b = await readBody(req);
  return autopilot.enroll(Number(params.id), b.contact_ids || []);
});

// ---- 🤖 Autopilote : enrôlements, file d'envoi, moteur
route('GET', '/api/enrollments', async (req, params, query) => {
  const where = query.status ? `WHERE e.status = ?` : '';
  const args = query.status ? [query.status] : [];
  const enrollments = all(`
    SELECT e.*, c.first_name, c.last_name, c.company, c.email, s.name AS seq_name,
      (SELECT COUNT(*) FROM sequence_steps st WHERE st.sequence_id = e.sequence_id) AS total_steps
    FROM enrollments e JOIN contacts c ON c.id = e.contact_id JOIN sequences s ON s.id = e.sequence_id
    ${where} ORDER BY e.updated_at DESC LIMIT 300`, ...args);
  return { enrollments };
});
route('PATCH', '/api/enrollments/:id', async (req, params) => {
  const b = await readBody(req);
  const e = get('SELECT * FROM enrollments WHERE id = ?', params.id);
  if (!e) throw httpError(404, 'Enrôlement introuvable');
  if (b.status === 'active') {
    const next = e.next_send_at && e.next_send_at > localDay() ? e.next_send_at : localDay();
    run(`UPDATE enrollments SET status = 'active', stop_reason = '', next_send_at = ?, updated_at = ? WHERE id = ?`, next, nowIso(), params.id);
  } else if (['paused', 'stopped'].includes(b.status)) {
    run(`UPDATE enrollments SET status = ?, stop_reason = ?, updated_at = ? WHERE id = ?`, b.status, b.reason || 'manuel', nowIso(), params.id);
    run(`UPDATE outbox SET status = 'cancelled', error = 'séquence mise en pause' WHERE enrollment_id = ? AND status IN ('awaiting_review','queued')`, params.id);
  }
  return { ok: true };
});
route('GET', '/api/outbox', async (req, params, query) => {
  const where = query.status ? `WHERE o.status = ?` : '';
  const args = query.status ? [query.status] : [];
  const items = all(`
    SELECT o.*, c.first_name, c.last_name, c.company, s.name AS seq_name
    FROM outbox o LEFT JOIN contacts c ON c.id = o.contact_id
    LEFT JOIN enrollments e ON e.id = o.enrollment_id LEFT JOIN sequences s ON s.id = e.sequence_id
    ${where} ORDER BY o.id DESC LIMIT 200`, ...args);
  return { items };
});
route('PATCH', '/api/outbox/:id', async (req, params) => {
  const b = await readBody(req);
  const item = get(`SELECT * FROM outbox WHERE id = ? AND status = 'awaiting_review'`, params.id);
  if (!item) throw httpError(400, 'Seuls les emails en attente de validation sont modifiables.');
  run('UPDATE outbox SET subject = ?, body = ? WHERE id = ?',
    b.subject !== undefined ? b.subject : item.subject, b.body !== undefined ? b.body : item.body, params.id);
  return { ok: true };
});
route('POST', '/api/outbox/:id/approve', async (req, params) => ({ approved: autopilot.approve([Number(params.id)]) }));
route('POST', '/api/outbox/approve_all', async () => ({ approved: autopilot.approveAll() }));
route('POST', '/api/outbox/:id/cancel', async (req, params) => {
  const item = get('SELECT * FROM outbox WHERE id = ?', params.id);
  if (!item) throw httpError(404, 'Introuvable');
  run(`UPDATE outbox SET status = 'cancelled' WHERE id = ? AND status IN ('awaiting_review','queued')`, params.id);
  if (item.enrollment_id) run(`UPDATE enrollments SET status = 'paused', stop_reason = 'email annulé manuellement', updated_at = ? WHERE id = ?`, nowIso(), item.enrollment_id);
  return { ok: true };
});
route('POST', '/api/autopilot/tick', async (req) => {
  const b = await readBody(req);
  return autopilot.tick({ ignoreWindow: !!b.ignore_window, force: true });
});
route('GET', '/api/autopilot/state', async () => autopilot.state());

// ---- 🤖 Autopilote : Gmail (tests + scan de la boîte)
route('POST', '/api/mail/send_one', async (req) => {
  const b = await readBody(req);
  return autopilot.sendOneOff({ contact_id: b.contact_id, subject: b.subject, body: b.body });
});
route('POST', '/api/mail/test_smtp', async () => autopilot.testSmtp());
route('POST', '/api/mail/test_imap', async () => autopilot.testImap());
route('POST', '/api/mail/send_test', async () => autopilot.sendTestEmail());
route('POST', '/api/mail/scan', async (req) => {
  const b = await readBody(req);
  return { found: await autopilot.scanSent({ days: Number(b.days) || 730 }) };
});
route('POST', '/api/mail/scan_import', async (req) => {
  const b = await readBody(req);
  return autopilot.importScanned(b.entries || []);
});

// ---- 🗂️ Répertoire chaud (historique d'appels + WhatsApp, lus en local)
route('GET', '/api/repertoire/etat', async () => repertoire.etat());
route('POST', '/api/repertoire/scan', async (req) => {
  const b = await readBody(req);
  const sources = Array.isArray(b.sources) && b.sources.length ? b.sources : ['appels', 'whatsapp'];
  return repertoire.scan({ days: Number(b.days) || 1095, sources });
});
route('POST', '/api/repertoire/whatsapp_export', async (req) => {
  const b = await readBody(req);
  if (!String(b.text || '').trim()) throw httpError(400, 'Colle le contenu du fichier .txt exporté par WhatsApp.');
  return repertoire.scanExportWhatsapp(String(b.text), { days: Number(b.days) || 3650 });
});
route('POST', '/api/repertoire/appels_csv', async (req) => {
  const b = await readBody(req);
  return repertoire.scanCsvAppels(Array.isArray(b.rows) ? b.rows : [], { days: Number(b.days) || 1095 });
});
route('POST', '/api/repertoire/import', async (req) => {
  const b = await readBody(req);
  return repertoire.importer(Array.isArray(b.entries) ? b.entries : []);
});

// ---- 📅 Campagnes hebdo thématiques
route('GET', '/api/campaign_presets', async () => ({
  presets: Object.entries(campaigns.PRESETS).map(([code, p]) => ({ code, emoji: p.emoji, label: p.label, persona: p.persona, angle: p.angle })),
}));
route('GET', '/api/campaigns', async () => ({ campaigns: campaigns.listCampaigns() }));
route('POST', '/api/campaigns', async (req) => {
  const b = await readBody(req);
  return { campaign: campaigns.createCampaign(b) };
});
route('PATCH', '/api/campaigns/:id', async (req, params) => {
  const b = await readBody(req);
  const c = get('SELECT * FROM campaigns WHERE id = ?', params.id);
  if (!c) throw httpError(404, 'Campagne introuvable');
  const fields = ['name', 'persona', 'week_start', 'post_draft', 'dm_draft', 'sn_recipe', 'notes'];
  const sets = fields.filter((f) => b[f] !== undefined);
  if (b.week_start !== undefined) b.week_start = campaigns.mondayOf(b.week_start);
  if (sets.length) run(`UPDATE campaigns SET ${sets.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, ...sets.map((f) => b[f]), params.id);
  if (b.posted !== undefined) run('UPDATE campaigns SET posted = ? WHERE id = ?', b.posted ? 1 : 0, params.id);
  return { ok: true };
});
route('DELETE', '/api/campaigns/:id', async (req, params) => {
  const c = get('SELECT * FROM campaigns WHERE id = ?', params.id);
  if (!c) return { ok: true };
  const active = Number(get(`SELECT COUNT(*) AS n FROM enrollments WHERE sequence_id = ? AND status = 'active'`, c.sequence_id).n);
  if (active > 0) throw httpError(400, `${active} contact(s) encore en séquence sur cette campagne : stoppe-les d'abord (vue Autopilote).`);
  run('DELETE FROM templates WHERE campaign_id = ?', params.id);
  if (c.sequence_id) run('DELETE FROM sequences WHERE id = ?', c.sequence_id);
  run('UPDATE contacts SET campaign_id = 0 WHERE campaign_id = ?', params.id);
  run('DELETE FROM campaigns WHERE id = ?', params.id);
  return { ok: true };
});
route('POST', '/api/campaigns/:id/enroll', async (req, params) => campaigns.enrollAll(Number(params.id)));
route('POST', '/api/campaigns/:id/regenerate', async (req, params) => campaigns.regenerateKit(Number(params.id)));

// ---- références clients (preuves sociales des campagnes)
route('GET', '/api/references', async () => ({
  references: all('SELECT * FROM refs ORDER BY verified DESC, id').map((r) => ({ ...r, sectors: JSON.parse(r.sectors || '[]') })),
}));
route('POST', '/api/references', async (req) => {
  const b = await readBody(req);
  const { lastId } = run('INSERT INTO refs (code, name, detail, sectors, verified, builtin) VALUES (?, ?, ?, ?, ?, 0)',
    `ref_${Date.now()}`, b.name || 'Référence', b.detail || '', JSON.stringify(b.sectors || []), b.verified === false ? 0 : 1);
  return { id: lastId };
});
route('PATCH', '/api/references/:id', async (req, params) => {
  const b = await readBody(req);
  const r = get('SELECT * FROM refs WHERE id = ?', params.id);
  if (!r) throw httpError(404, 'Référence introuvable');
  run('UPDATE refs SET name = ?, detail = ?, sectors = ?, verified = ? WHERE id = ?',
    b.name !== undefined ? b.name : r.name,
    b.detail !== undefined ? b.detail : r.detail,
    b.sectors !== undefined ? JSON.stringify(b.sectors) : r.sectors,
    b.verified !== undefined ? (b.verified ? 1 : 0) : r.verified,
    params.id);
  return { ok: true };
});
route('DELETE', '/api/references/:id', async (req, params) => { run('DELETE FROM refs WHERE id = ?', params.id); return { ok: true }; });

// ---- démo
route('POST', '/api/demo', async () => seedDemo(false));

// ---------------------------------------------------------------- serveur
function httpError(status, message) { const e = new Error(message); e.httpStatus = status; return e; }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const query = Object.fromEntries(u.searchParams.entries());

  // Verrou du mode réseau : tout passe par le code d'accès (cookie 30 jours).
  if (NETWORK_MODE) {
    const m = String(req.headers.cookie || '').match(/(?:^|;\s*)chasse_acces=([^;]+)/);
    const authed = !!(m && m[1] === RESEAU_CODE);
    if (!authed) {
      if (req.method === 'POST' && u.pathname === '/acces') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let code = '';
          try { code = decodeURIComponent((raw.match(/code=([^&]*)/) || [])[1] || '').trim().toUpperCase(); } catch { /* corps illisible */ }
          if (code === RESEAU_CODE) {
            res.writeHead(302, { 'Set-Cookie': `chasse_acces=${RESEAU_CODE}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`, Location: '/' });
            res.end();
          } else {
            res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(loginPage(true));
          }
        });
        return;
      }
      if (u.pathname.startsWith('/api')) { json(res, 401, { error: "Accès verrouillé : ouvre la page d'accueil et saisis le code affiché sur l'ordinateur." }); return; }
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(loginPage(false));
      return;
    }
  }

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

// Boucle Autopilote : toutes les 10 minutes (si activé + Gmail configuré).
let ticking = false;
async function autopilotLoop() {
  if (ticking) return;
  ticking = true;
  try {
    const r = await autopilot.tick();
    if (r && !r.skipped && ((r.flush && r.flush.sent) || (r.replies && r.replies.replies))) {
      console.log(`[autopilote] envoyés: ${r.flush ? r.flush.sent : 0} · réponses: ${r.replies ? r.replies.replies : 0}`);
    }
    if (r && (r.replies_error || r.flush_error)) console.error('[autopilote]', r.replies_error || r.flush_error);
  } catch (e) {
    console.error('[autopilote]', e.message);
  } finally {
    ticking = false;
  }
}
if (process.env.NODE_ENV !== 'test') {
  setInterval(autopilotLoop, 10 * 60 * 1000);
  setTimeout(autopilotLoop, 20 * 1000); // premier passage peu après le démarrage
}

server.listen(PORT, HOST, () => {
  let reseau = '';
  if (NETWORK_MODE) {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address);
    reseau = `
  📱 MODE RÉSEAU ACTIVÉ : depuis ton iPad/téléphone (même Wi-Fi) :
${ips.map((ip) => `  ➜  http://${ip}:${PORT}`).join('\n') || `  ➜  http://IP-de-cet-ordinateur:${PORT}`}
  🔑 CODE D'ACCÈS : ${RESEAU_CODE}
`;
  }
  console.log(`
  ⚔️  LA CHASSE : CRM de prospection gamifié (OTEA Production)
  ────────────────────────────────────────────────────────────
  ➜  http://localhost:${PORT}${reseau}
  Base de données : ${dbApi.DB_PATH}
  Objectif : ${dbApi.getSetting('objectif_factures')} factures. Bonne chasse. 🎯
`);
});
