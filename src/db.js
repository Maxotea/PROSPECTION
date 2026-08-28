'use strict';
// Couche base de données : SQLite natif de Node (node:sqlite), zéro dépendance.
// Le fichier de base vit dans ./data/prospection.db (gitignoré : données locales).

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'prospection.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ---------------------------------------------------------------- schéma
db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  email_status TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  company TEXT DEFAULT '',
  job_title TEXT DEFAULT '',
  domain TEXT DEFAULT '',
  linkedin_url TEXT DEFAULT '',
  city TEXT DEFAULT '',
  country TEXT DEFAULT '',
  segment TEXT DEFAULT 'inconnu',
  origin TEXT DEFAULT 'manuel',
  is_former_client INTEGER DEFAULT 0,
  stage TEXT DEFAULT 'a_contacter',
  revenue_history REAL DEFAULT 0,
  next_action TEXT DEFAULT '',
  next_action_at TEXT DEFAULT '',
  last_touch_at TEXT DEFAULT '',
  pennylane_customer_id TEXT DEFAULT '',
  hubspot_id TEXT DEFAULT '',
  enrich_status TEXT DEFAULT 'none',
  tags TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  archived INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_linkedin ON contacts(linkedin_url);
CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(stage);
CREATE INDEX IF NOT EXISTS idx_contacts_segment ON contacts(segment);
CREATE INDEX IF NOT EXISTS idx_contacts_next ON contacts(next_action_at);
CREATE INDEX IF NOT EXISTS idx_contacts_pl ON contacts(pennylane_customer_id);
CREATE INDEX IF NOT EXISTS idx_contacts_hs ON contacts(hubspot_id);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT DEFAULT '',
  amount REAL DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  status TEXT DEFAULT 'brouillon',
  pennylane_quote_id TEXT DEFAULT '',
  pennylane_quote_url TEXT DEFAULT '',
  pennylane_invoice_id TEXT DEFAULT '',
  invoiced_at TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER,
  type TEXT NOT NULL,
  note TEXT DEFAULT '',
  xp INTEGER DEFAULT 0,
  meta TEXT DEFAULT '{}',
  day TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_day ON activities(day);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  segment TEXT DEFAULT '',
  channel TEXT DEFAULT 'email',
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  builtin INTEGER DEFAULT 0,
  sort INTEGER DEFAULT 100
);

CREATE TABLE IF NOT EXISTS badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  awarded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quest_awards (
  day TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (day, code)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS enrich_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT DEFAULT 'fullenrich',
  external_id TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  contact_ids TEXT DEFAULT '[]',
  result TEXT DEFAULT '',
  error TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER,
  source TEXT DEFAULT 'email',
  content TEXT DEFAULT '',
  reply TEXT DEFAULT '',
  status TEXT DEFAULT 'nouveau',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------- Autopilote : séquences email ----------------
CREATE TABLE IF NOT EXISTS sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  segment TEXT DEFAULT '',
  description TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  builtin INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sequence_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  delay_days INTEGER DEFAULT 0,
  template_code TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steps_seq ON sequence_steps(sequence_id);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active',      -- active | paused | replied | finished | stopped | bounced
  current_step INTEGER DEFAULT 0,    -- index de la PROCHAINE étape à envoyer
  next_send_at TEXT DEFAULT '',      -- jour (YYYY-MM-DD)
  first_message_id TEXT DEFAULT '',  -- pour garder les relances dans le même fil Gmail
  first_subject TEXT DEFAULT '',
  stop_reason TEXT DEFAULT '',
  started_at TEXT NOT NULL,
  last_sent_at TEXT DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enroll_contact ON enrollments(contact_id);
CREATE INDEX IF NOT EXISTS idx_enroll_status ON enrollments(status, next_send_at);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER REFERENCES enrollments(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  step_index INTEGER DEFAULT 0,
  to_email TEXT NOT NULL,
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  status TEXT DEFAULT 'awaiting_review', -- awaiting_review | queued | sent | failed | cancelled
  scheduled_at TEXT DEFAULT '',          -- ISO, heure d'envoi planifiée
  sent_at TEXT DEFAULT '',
  message_id TEXT DEFAULT '',
  error TEXT DEFAULT '',
  day TEXT DEFAULT '',               -- jour local de création (comptage du cap quotidien)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_outbox_day ON outbox(day, status);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imap_uid INTEGER,
  contact_id INTEGER,
  from_email TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  received_at TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_replies_uid ON replies(imap_uid);

-- ---------------- Campagnes hebdo thématiques ----------------
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sector TEXT DEFAULT '',
  emoji TEXT DEFAULT '📅',
  persona TEXT DEFAULT '',
  week_start TEXT NOT NULL,          -- lundi de la semaine (YYYY-MM-DD)
  sequence_id INTEGER DEFAULT 0,
  reference_ids TEXT DEFAULT '[]',
  sn_recipe TEXT DEFAULT '',         -- recette de recherche Sales Navigator
  angle TEXT DEFAULT '',
  post_draft TEXT DEFAULT '',        -- post LinkedIn de la semaine
  dm_draft TEXT DEFAULT '',          -- script DM LinkedIn
  posted INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_week ON campaigns(week_start);

CREATE TABLE IF NOT EXISTS refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  detail TEXT DEFAULT '',
  sectors TEXT DEFAULT '[]',
  verified INTEGER DEFAULT 1,        -- 0 = ⚠️ orthographe / infos à vérifier
  builtin INTEGER DEFAULT 0
);

-- Relations envoyées par l'agent qui tourne sur le Mac (appels, WhatsApp).
-- Elles attendent la validation de Maxime : rien n'entre dans le CRM tout seul.
CREATE TABLE IF NOT EXISTS repertoire_attente (
  cle TEXT PRIMARY KEY,
  charge TEXT NOT NULL,               -- la fiche complète, en JSON
  recu_le TEXT NOT NULL
);
`);

// Migrations douces : colonnes ajoutées après coup sur des bases existantes.
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('contacts', 'campaign_id', 'campaign_id INTEGER DEFAULT 0');
ensureColumn('templates', 'campaign_id', 'campaign_id INTEGER DEFAULT 0');
ensureColumn('contacts', 'icebreaker', `icebreaker TEXT DEFAULT ''`);   // le lien trouvé avec la personne
ensureColumn('contacts', 'profile', `profile TEXT DEFAULT ''`);         // données brutes FullEnrich (JSON)

// ---------------------------------------------------------------- helpers
function nowIso() { return new Date().toISOString(); }

// Jour local (et non UTC) : à 23h à Paris on est encore "aujourd'hui".
function localDay(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${j}`;
}

function addDays(dayStr, n) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return localDay(dt);
}

function get(sql, ...params) { return db.prepare(sql).get(...params); }
function all(sql, ...params) { return db.prepare(sql).all(...params); }
function run(sql, ...params) {
  const res = db.prepare(sql).run(...params);
  return { changes: Number(res.changes), lastId: Number(res.lastInsertRowid) };
}

// ---------------------------------------------------------------- settings
const SETTINGS_DEFAULTS = {
  user_name: 'Maxime',
  company_name: 'OTEA Production',
  user_signature: 'Maxime, OTEA Production',
  objectif_factures: '5',
  objectif_appels_jour: '5',
  mon_profil: '',
  seuil_grand_compte: '5000',
  sounds: '1',
  ai_model: 'claude-sonnet-5',
  pennylane_base: 'https://app.pennylane.com/api/external/v2',
  fullenrich_base: 'https://app.fullenrich.com/api/v2',
  pennylane_api_key: '',
  fullenrich_api_key: '',
  hubspot_token: '',
  anthropic_api_key: '',
  // Autopilote (envoi Gmail)
  gmail_user: '',
  gmail_app_password: '',
  smtp_host: 'smtp.gmail.com',
  smtp_port: '465',
  smtp_secure: '1',
  imap_host: 'imap.gmail.com',
  imap_port: '993',
  imap_secure: '1',
  autopilot_enabled: '0',
  autopilot_mode: 'review',      // 'review' : chaque email attend ton feu vert ; 'auto' : envoi direct
  autopilot_daily_cap: '20',
  autopilot_window_start: '9',
  autopilot_window_end: '18',
  autopilot_weekdays_only: '1',
  autopilot_last_uid: '0',
  booking_url: '',
};

// Variables d'environnement prioritaires sur la base (pratique pour .env).
const ENV_MAP = {
  pennylane_api_key: 'PENNYLANE_API_KEY',
  fullenrich_api_key: 'FULLENRICH_API_KEY',
  hubspot_token: 'HUBSPOT_TOKEN',
  anthropic_api_key: 'ANTHROPIC_API_KEY',
  gmail_user: 'GMAIL_USER',
  gmail_app_password: 'GMAIL_APP_PASSWORD',
};

function getSetting(key) {
  if (ENV_MAP[key] && process.env[ENV_MAP[key]]) return process.env[ENV_MAP[key]];
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  if (row && row.value !== '') return row.value;
  return SETTINGS_DEFAULTS[key] !== undefined ? SETTINGS_DEFAULTS[key] : '';
}

function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

function allSettings() {
  const out = { ...SETTINGS_DEFAULTS };
  for (const row of all('SELECT key, value FROM settings')) out[row.key] = row.value;
  for (const [k, env] of Object.entries(ENV_MAP)) if (process.env[env]) out[k] = process.env[env];
  return out;
}

// ---------------------------------------------------------------- contacts
const CONTACT_FIELDS = [
  'first_name', 'last_name', 'email', 'email_status', 'phone', 'company', 'job_title',
  'domain', 'linkedin_url', 'city', 'country', 'segment', 'origin', 'is_former_client',
  'stage', 'revenue_history', 'next_action', 'next_action_at', 'last_touch_at',
  'pennylane_customer_id', 'hubspot_id', 'enrich_status', 'tags', 'notes', 'archived', 'campaign_id',
  'icebreaker', 'profile',
];

function normEmail(v) { return String(v || '').trim().toLowerCase(); }

function normLinkedin(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  s = s.split('?')[0].replace(/\/+$/, '');
  s = s.replace(/^https?:\/\/(www\.)?/i, 'https://www.');
  return s.toLowerCase();
}

function cleanContactInput(data) {
  const c = {};
  for (const f of CONTACT_FIELDS) {
    if (data[f] === undefined || data[f] === null) continue;
    let v = data[f];
    if (f === 'is_former_client' || f === 'archived') v = v ? 1 : 0;
    else if (f === 'revenue_history' || f === 'campaign_id') v = Number(v) || 0;
    else v = String(v).trim();
    if (f === 'email') v = normEmail(v);
    if (f === 'linkedin_url') v = normLinkedin(v);
    c[f] = v;
  }
  return c;
}

function insertContact(data) {
  const c = cleanContactInput(data);
  const now = nowIso();
  const cols = Object.keys(c);
  const sql = `INSERT INTO contacts (${cols.join(', ')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`;
  const { lastId } = run(sql, ...cols.map((k) => c[k]), now, now);
  return get('SELECT * FROM contacts WHERE id = ?', lastId);
}

function updateContact(id, data) {
  const c = cleanContactInput(data);
  const cols = Object.keys(c);
  if (cols.length) {
    const sql = `UPDATE contacts SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
    run(sql, ...cols.map((k) => c[k]), nowIso(), id);
  }
  return get('SELECT * FROM contacts WHERE id = ?', id);
}

// Trouve un doublon potentiel pour des données entrantes.
function findDuplicate(data) {
  const email = normEmail(data.email);
  const li = normLinkedin(data.linkedin_url);
  if (data.pennylane_customer_id) {
    const r = get('SELECT * FROM contacts WHERE pennylane_customer_id = ?', String(data.pennylane_customer_id));
    if (r) return r;
  }
  if (data.hubspot_id) {
    const r = get('SELECT * FROM contacts WHERE hubspot_id = ?', String(data.hubspot_id));
    if (r) return r;
  }
  if (email) {
    const r = get(`SELECT * FROM contacts WHERE email = ? AND email != ''`, email);
    if (r) return r;
  }
  if (li) {
    const r = get(`SELECT * FROM contacts WHERE linkedin_url = ? AND linkedin_url != ''`, li);
    if (r) return r;
  }
  const fn = String(data.first_name || '').trim().toLowerCase();
  const ln = String(data.last_name || '').trim().toLowerCase();
  const co = String(data.company || '').trim().toLowerCase();
  if ((fn || ln) && co) {
    const r = get(
      'SELECT * FROM contacts WHERE lower(first_name) = ? AND lower(last_name) = ? AND lower(company) = ?',
      fn, ln, co
    );
    if (r) return r;
  }
  return null;
}

// Upsert avec fusion douce : ne remplit que les champs vides de l'existant
// (on n'écrase jamais une donnée saisie à la main), sauf drapeaux cumulatifs.
function upsertContact(data) {
  const existing = findDuplicate(data);
  if (!existing) return { contact: insertContact(data), created: true };
  const patch = {};
  const incoming = cleanContactInput(data);
  for (const [k, v] of Object.entries(incoming)) {
    if (v === '' || v === null || v === undefined) continue;
    if (k === 'is_former_client') { if (v && !existing.is_former_client) patch[k] = 1; continue; }
    if (k === 'revenue_history') { if (v > (existing.revenue_history || 0)) patch[k] = v; continue; }
    if (k === 'segment') { if ((existing.segment === 'inconnu' || !existing.segment) && v !== 'inconnu') patch[k] = v; continue; }
    if (k === 'stage' || k === 'origin' || k === 'archived') continue; // on garde l'état de travail existant
    if (existing[k] === '' || existing[k] === null || existing[k] === 0) patch[k] = v;
  }
  const contact = Object.keys(patch).length ? updateContact(existing.id, patch) : existing;
  return { contact, created: false };
}

module.exports = {
  db, get, all, run,
  nowIso, localDay, addDays,
  getSetting, setSetting, allSettings, SETTINGS_DEFAULTS,
  CONTACT_FIELDS, insertContact, updateContact, upsertContact, findDuplicate,
  normEmail, normLinkedin,
  DB_PATH, DATA_DIR,
};
