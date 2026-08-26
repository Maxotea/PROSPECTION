'use strict';
// Client IMAP minimal, zéro dépendance — juste ce qu'il faut pour :
//  1. détecter les nouvelles réponses dans INBOX (UID SEARCH + FETCH d'en-têtes)
//  2. scanner le dossier "Messages envoyés" pour retrouver ses correspondants
// Conçu pour Gmail (imap.gmail.com:993, LOGIN avec mot de passe d'application),
// hosts/ports configurables (mode non-TLS réservé aux serveurs de test locaux).

const tls = require('node:tls');
const net = require('node:net');

// ---------------------------------------------------------------- connexion + protocole
class Imap {
  constructor({ host, port, secure = true, timeoutMs = 30000 }) {
    this.cfg = { host, port: Number(port), secure, timeoutMs };
    this.buffer = Buffer.alloc(0);
    this.tagN = 0;
    this.pending = null; // { tag, entries, currentLiteralNeed, resolve, reject }
  }

  connect() {
    return new Promise((resolve, reject) => {
      const { host, port, secure, timeoutMs } = this.cfg;
      const onReady = () => resolve();
      this.sock = secure
        ? tls.connect({ host, port, servername: host }, onReady)
        : net.connect({ host, port }, onReady);
      this.sock.setTimeout(timeoutMs, () => { this.sock.destroy(); const e = new Error(`IMAP ${host}:${port} — délai dépassé`); this.pending ? this.pending.reject(e) : reject(e); });
      this.sock.once('error', (e) => { const err = new Error(`IMAP ${host}:${port} — ${e.message}`); this.pending ? this.pending.reject(err) : reject(err); });
      this.sock.on('data', (chunk) => { this.buffer = Buffer.concat([this.buffer, chunk]); this._drain(); });
    });
  }

  // Découpe le flux en lignes + littéraux ({N} octets bruts qui suivent une ligne).
  _drain() {
    if (!this.pending) return;
    const p = this.pending;
    for (;;) {
      if (p.literalNeed > 0) {
        if (this.buffer.length < p.literalNeed) return; // attendre la suite
        const data = this.buffer.subarray(0, p.literalNeed).toString('utf8');
        this.buffer = this.buffer.subarray(p.literalNeed);
        p.entries.push({ type: 'literal', line: p.literalLine, data });
        p.literalNeed = 0;
        continue;
      }
      const idx = this.buffer.indexOf('\r\n');
      if (idx === -1) return;
      const line = this.buffer.subarray(0, idx).toString('utf8');
      this.buffer = this.buffer.subarray(idx + 2);
      const lit = line.match(/\{(\d+)\}$/);
      if (lit) {
        p.literalNeed = Number(lit[1]);
        p.literalLine = line;
        continue;
      }
      p.entries.push({ type: 'line', line });
      if (line.startsWith(p.tag + ' ')) {
        this.pending = null;
        if (/^\S+ OK/i.test(line)) p.resolve(p.entries);
        else p.reject(new Error(`IMAP — ${line.slice(0, 200)}`));
        return;
      }
    }
  }

  // Attend le greeting "* OK ..." initial du serveur.
  greeting() {
    return this.command(null);
  }

  command(cmd) {
    return new Promise((resolve, reject) => {
      const tag = cmd === null ? '*greeting*' : `A${++this.tagN}`;
      this.pending = { tag, entries: [], literalNeed: 0, literalLine: '', resolve, reject };
      if (cmd === null) {
        // le greeting est une simple ligne "* OK ..." : on la considère "taguée" dès la 1re ligne
        this.pending.tag = '*';
      } else {
        this.sock.write(`${tag} ${cmd}\r\n`);
      }
      this._drain();
    });
  }

  close() { try { this.sock && this.sock.destroy(); } catch { /* déjà fermé */ } }
}

function quoteStr(s) { return `"${String(s).replace(/(["\\])/g, '\\$1')}"`; }

// ---------------------------------------------------------------- parsing d'en-têtes
// Décode les mots encodés RFC 2047 (=?charset?B/Q?...?=).
function decodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (m, cs, enc, data) => {
    try {
      let buf;
      if (enc.toUpperCase() === 'B') buf = Buffer.from(data, 'base64');
      else buf = Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'binary');
      return buf.toString(/utf-?8/i.test(cs) ? 'utf8' : 'latin1');
    } catch { return m; }
  }).replace(/\?=\s+=\?/g, '?==?');
}

// "Jean Dupont <jean@x.fr>" → { name, email }
function parseAddress(raw) {
  const s = decodeWords(String(raw || '').trim());
  const angle = s.match(/<([^>]+)>/);
  if (angle) return { name: s.replace(angle[0], '').replace(/^"|"$/g, '').trim(), email: angle[1].trim().toLowerCase() };
  const bare = s.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return { name: '', email: bare ? bare[0].toLowerCase() : '' };
}

// Bloc d'en-têtes brut → objet {from, to, subject, date, message_id}
function parseHeaders(block) {
  const unfolded = String(block).replace(/\r\n[ \t]+/g, ' ');
  const out = {};
  for (const line of unfolded.split('\r\n')) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!m) continue;
    out[m[1].toLowerCase()] = m[2];
  }
  return {
    from: parseAddress(out.from),
    to: (out.to || '').split(',').map(parseAddress).filter((a) => a.email),
    subject: decodeWords(out.subject || ''),
    date: out.date || '',
    message_id: (out['message-id'] || '').trim(),
  };
}

// ---------------------------------------------------------------- opérations de haut niveau
async function open(cfg) {
  const imap = new Imap(cfg);
  await imap.connect();
  await imap.greeting();
  await imap.command(`LOGIN ${quoteStr(cfg.user)} ${quoteStr(cfg.pass)}`);
  return imap;
}

async function testLogin(cfg) {
  const imap = await open(cfg);
  try { await imap.command('LOGOUT'); } catch { /* certains serveurs coupent direct */ }
  imap.close();
  return true;
}

function findUidNext(entries) {
  for (const e of entries) {
    const m = e.line && e.line.match(/\[UIDNEXT (\d+)\]/);
    if (m) return Number(m[1]);
  }
  return null;
}

// Nouvelles réponses dans INBOX depuis lastUid. Retourne { messages, lastUid }.
// lastUid = 0 → on n'aspire rien, on initialise juste le curseur à UIDNEXT-1.
async function fetchNewInbox(cfg, lastUid) {
  const imap = await open(cfg);
  try {
    const sel = await imap.command('SELECT INBOX');
    const uidnext = findUidNext(sel) || 1;
    if (!lastUid || lastUid < 1) return { messages: [], lastUid: uidnext - 1, initialized: true };
    if (uidnext - 1 <= lastUid) return { messages: [], lastUid };

    const search = await imap.command(`UID SEARCH UID ${lastUid + 1}:*`);
    let uids = [];
    for (const e of search) {
      const m = e.line && e.line.match(/^\* SEARCH(.*)$/i);
      if (m) uids = m[1].trim().split(/\s+/).filter(Boolean).map(Number);
    }
    uids = uids.filter((u) => u > lastUid); // Gmail renvoie parfois le dernier connu sur N:*
    if (!uids.length) return { messages: [], lastUid: uidnext - 1 };

    const fetch = await imap.command(`UID FETCH ${uids.join(',')} (BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])`);
    const messages = [];
    for (const e of fetch) {
      if (e.type !== 'literal') continue;
      const um = e.line.match(/UID (\d+)/);
      const h = parseHeaders(e.data);
      messages.push({ uid: um ? Number(um[1]) : 0, ...h });
    }
    return { messages, lastUid: Math.max(uidnext - 1, ...uids) };
  } finally {
    imap.close();
  }
}

// Trouve le dossier "Messages envoyés" via l'attribut SPECIAL-USE \Sent.
async function findSentFolder(imap) {
  const list = await imap.command('LIST "" "*"');
  for (const e of list) {
    const m = e.line && e.line.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|\S+) (.+)$/);
    if (m && /\\Sent/i.test(m[1])) {
      let name = m[2].trim();
      if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
      return name;
    }
  }
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function imapDate(d) { return `${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`; }

// Scanne les destinataires du dossier Envoyés (headers uniquement, jamais les corps).
// Retourne [{ email, name, count, last_date }] trié par volume d'échanges.
async function scanSentRecipients(cfg, { days = 730, maxMessages = 1500 } = {}) {
  const imap = await open(cfg);
  try {
    const folder = await findSentFolder(imap);
    if (!folder) throw new Error("Dossier « Messages envoyés » introuvable (IMAP activé dans Gmail ?)");
    await imap.command(`SELECT ${quoteStr(folder)}`);
    const since = new Date(Date.now() - days * 86400000);
    const search = await imap.command(`UID SEARCH SINCE ${imapDate(since)}`);
    let uids = [];
    for (const e of search) {
      const m = e.line && e.line.match(/^\* SEARCH(.*)$/i);
      if (m) uids = m[1].trim().split(/\s+/).filter(Boolean).map(Number);
    }
    if (!uids.length) return [];
    uids = uids.slice(-maxMessages); // les N plus récents

    const byEmail = new Map();
    const CHUNK = 300;
    for (let i = 0; i < uids.length; i += CHUNK) {
      const fetch = await imap.command(`UID FETCH ${uids.slice(i, i + CHUNK).join(',')} (BODY.PEEK[HEADER.FIELDS (TO DATE)])`);
      for (const e of fetch) {
        if (e.type !== 'literal') continue;
        const h = parseHeaders(e.data);
        for (const addr of h.to) {
          if (!addr.email || addr.email === (cfg.user || '').toLowerCase()) continue;
          if (/no-?reply|notification|mailer-daemon|newsletter|donotreply/i.test(addr.email)) continue;
          const cur = byEmail.get(addr.email) || { email: addr.email, name: addr.name, count: 0, last_date: '' };
          cur.count++;
          if (!cur.name && addr.name) cur.name = addr.name;
          const t = Date.parse(h.date);
          if (t && (!cur.last_date || t > Date.parse(cur.last_date))) cur.last_date = new Date(t).toISOString();
          byEmail.set(addr.email, cur);
        }
      }
    }
    return [...byEmail.values()].sort((a, b) => b.count - a.count);
  } finally {
    imap.close();
  }
}

module.exports = { testLogin, fetchNewInbox, scanSentRecipients, parseHeaders, parseAddress, decodeWords, Imap };
