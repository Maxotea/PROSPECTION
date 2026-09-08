'use strict';
// Client IMAP minimal, zéro dépendance : juste ce qu'il faut pour :
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
      this.sock.setTimeout(timeoutMs, () => { this.sock.destroy(); const e = new Error(`IMAP ${host}:${port} : délai dépassé`); this.pending ? this.pending.reject(e) : reject(e); });
      this.sock.once('error', (e) => { const err = new Error(`IMAP ${host}:${port} : ${e.message}`); this.pending ? this.pending.reject(err) : reject(err); });
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
        else p.reject(new Error(`IMAP : ${line.slice(0, 200)}`));
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

// ---------------------------------------------------------------- ☀️ Ma journée : les mails qui attendent une réponse
// Lit les en-têtes récents de la boîte de réception ET du dossier Envoyés, pour
// savoir à qui Maxime n'a pas encore répondu. Jamais les corps : seulement qui,
// quoi, quand, et le drapeau « répondu » que Gmail pose quand on répond.

function uidsDe(entries) {
  let uids = [];
  for (const e of entries) {
    const m = e.line && e.line.match(/^\* SEARCH(.*)$/i);
    if (m) uids = m[1].trim().split(/\s+/).filter(Boolean).map(Number);
  }
  return uids;
}

function drapeauxDe(line) {
  const m = String(line || '').match(/FLAGS \(([^)]*)\)/i);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

// Sur Gmail, on demande directement l'onglet « Principale » : les promotions,
// les notifications de réseaux sociaux et les newsletters restent dehors.
// Ailleurs (ou si Gmail refuse), on retombe sur une simple recherche par date.
async function chercherRecents(imap, days) {
  try {
    const r = await imap.command(`UID SEARCH X-GM-RAW "category:primary newer_than:${Math.max(1, Math.round(days))}d"`);
    return { uids: uidsDe(r), gmail: true };
  } catch {
    const since = new Date(Date.now() - days * 86400000);
    const r = await imap.command(`UID SEARCH SINCE ${imapDate(since)}`);
    return { uids: uidsDe(r), gmail: false };
  }
}

async function lireBoiteRecente(cfg, { days = 10, maxMessages = 400 } = {}) {
  const imap = await open(cfg);
  try {
    await imap.command('SELECT INBOX');
    const { uids: tous, gmail } = await chercherRecents(imap, days);
    const uids = tous.slice(-maxMessages);
    const recus = [];
    const CHUNK = 200;
    for (let i = 0; i < uids.length; i += CHUNK) {
      const fetch = await imap.command(`UID FETCH ${uids.slice(i, i + CHUNK).join(',')} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO)])`);
      for (const e of fetch) {
        if (e.type !== 'literal') continue;
        const um = e.line.match(/UID (\d+)/);
        const h = parseHeaders(e.data);
        const flags = drapeauxDe(e.line);
        recus.push({
          uid: um ? Number(um[1]) : 0,
          ...h,
          in_reply_to: (String(e.data).replace(/\r\n[ \t]+/g, ' ').match(/^In-Reply-To:\s*(.+)$/im) || [])[1] || '',
          lu: flags.some((f) => /\\Seen/i.test(f)),
          repondu: flags.some((f) => /\\Answered/i.test(f)),
        });
      }
    }

    // Dossier Envoyés : à qui a-t-on écrit, et en réponse à quoi.
    const repondus = new Set();
    const ecritsA = new Map();
    const folder = await findSentFolder(imap);
    if (folder) {
      await imap.command(`SELECT ${quoteStr(folder)}`);
      const since = new Date(Date.now() - days * 86400000);
      const search = await imap.command(`UID SEARCH SINCE ${imapDate(since)}`);
      const envoyes = uidsDe(search).slice(-maxMessages);
      for (let i = 0; i < envoyes.length; i += CHUNK) {
        const fetch = await imap.command(`UID FETCH ${envoyes.slice(i, i + CHUNK).join(',')} (BODY.PEEK[HEADER.FIELDS (TO DATE IN-REPLY-TO REFERENCES)])`);
        for (const e of fetch) {
          if (e.type !== 'literal') continue;
          const h = parseHeaders(e.data);
          const plat = String(e.data).replace(/\r\n[ \t]+/g, ' ');
          const irt = (plat.match(/^In-Reply-To:\s*(.+)$/im) || [])[1] || '';
          const refs = (plat.match(/^References:\s*(.+)$/im) || [])[1] || '';
          for (const id of `${irt} ${refs}`.match(/<[^>]+>/g) || []) repondus.add(id.trim());
          const t = Date.parse(h.date);
          for (const a of h.to) {
            if (!a.email) continue;
            const prev = ecritsA.get(a.email) || 0;
            if (t && t > prev) ecritsA.set(a.email, t);
          }
        }
      }
    }
    return { recus, repondus: [...repondus], ecritsA: Object.fromEntries(ecritsA), gmail, dossier_envoyes: folder || '' };
  } finally {
    imap.close();
  }
}

// ---------------------------------------------------------------- texte d'un message (pour rédiger la réponse)
// Lu à la demande, seulement quand Maxime clique « rédiger la réponse » : le
// texte sert à l'IA pour un brouillon, il n'est jamais enregistré.
function decoderCorps(corps, encodage, charset) {
  const enc = String(encodage || '').toLowerCase();
  const cs = /utf-?8/i.test(charset || '') || !charset ? 'utf8' : 'latin1';
  if (enc === 'base64') {
    try { return Buffer.from(corps.replace(/\s+/g, ''), 'base64').toString(cs); } catch { return corps; }
  }
  if (enc === 'quoted-printable') {
    const bin = corps.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bin, 'binary').toString(cs);
  }
  return corps;
}

function sansHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

// Extrait le texte lisible d'un message brut (en-têtes + corps), multipart compris.
// Préfère text/plain, sinon text/html débarrassé de ses balises.
function extraireTexte(raw) {
  const s = String(raw || '').replace(/\r\n/g, '\n');
  const sep = s.indexOf('\n\n');
  const entetes = (sep === -1 ? s : s.slice(0, sep)).replace(/\n[ \t]+/g, ' ');
  const corps = sep === -1 ? '' : s.slice(sep + 2);
  const ct = (entetes.match(/^Content-Type:\s*(.+)$/im) || [])[1] || 'text/plain';
  const cte = (entetes.match(/^Content-Transfer-Encoding:\s*(.+)$/im) || [])[1] || '';
  const charset = (ct.match(/charset="?([^";\s]+)"?/i) || [])[1] || '';
  const boundary = (ct.match(/boundary="?([^";]+)"?/i) || [])[1];

  if (boundary) {
    const parts = corps.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith('--'));
    let html = '';
    for (const part of parts) {
      const t = extraireTexte(part.replace(/^\n/, ''));
      if (!t.texte) continue;
      if (t.type === 'plain') return { texte: t.texte, type: 'plain' };
      if (t.type === 'html' && !html) html = t.texte;
    }
    return { texte: html, type: html ? 'html' : 'aucun' };
  }
  if (/^text\/html/i.test(ct)) return { texte: sansHtml(decoderCorps(corps, cte, charset)), type: 'html' };
  if (/^text\//i.test(ct) || !/^\w+\//.test(ct)) return { texte: decoderCorps(corps, cte, charset).trim(), type: 'plain' };
  return { texte: '', type: 'aucun' };
}

async function lireMessageTexte(cfg, uid, { maxBytes = 60000 } = {}) {
  const imap = await open(cfg);
  try {
    await imap.command('SELECT INBOX');
    const fetch = await imap.command(`UID FETCH ${Number(uid)} (BODY.PEEK[]<0.${maxBytes}>)`);
    for (const e of fetch) {
      if (e.type !== 'literal') continue;
      const h = parseHeaders(e.data.split(/\r\n\r\n/)[0] || '');
      const { texte } = extraireTexte(e.data);
      return { ...h, texte: texte.slice(0, 6000) };
    }
    throw new Error('Message introuvable dans la boîte de réception (il a peut-être été archivé ou supprimé).');
  } finally {
    imap.close();
  }
}

module.exports = { testLogin, fetchNewInbox, scanSentRecipients, lireBoiteRecente, lireMessageTexte, extraireTexte, parseHeaders, parseAddress, decodeWords, Imap };
