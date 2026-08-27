'use strict';
// Client SMTP minimal, zéro dépendance (node:tls / node:net).
// Conçu pour Gmail (smtp.gmail.com:465, TLS implicite, AUTH PLAIN avec mot de
// passe d'application), mais hosts/ports configurables : dont un mode non-TLS
// réservé aux serveurs de test locaux.

const tls = require('node:tls');
const net = require('node:net');
const crypto = require('node:crypto');

// ---------------------------------------------------------------- MIME
// Encode un en-tête UTF-8 (RFC 2047) si nécessaire.
function encodeHeader(value) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

// Corps en quoted-printable (RFC 2045), lignes ≤ 76 caractères.
function quotedPrintable(text) {
  const bytes = Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8');
  let out = '';
  let lineLen = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0d && bytes[i + 1] === 0x0a) { out += '\r\n'; lineLen = 0; i++; continue; }
    let chunk;
    if ((b >= 33 && b <= 126 && b !== 61) || b === 32 || b === 9) chunk = String.fromCharCode(b);
    else chunk = '=' + b.toString(16).toUpperCase().padStart(2, '0');
    if (lineLen + chunk.length > 74) { out += '=\r\n'; lineLen = 0; }
    out += chunk; lineLen += chunk.length;
  }
  return out;
}

function makeMessageId(domain) {
  return `<chasse-${Date.now()}-${crypto.randomBytes(8).toString('hex')}@${domain}>`;
}

// Construit le message MIME complet. Retourne { raw, messageId }.
function buildMessage({ from, fromName, to, subject, body, inReplyTo, references }) {
  const domain = (from.split('@')[1] || 'localhost');
  const messageId = makeMessageId(domain);
  const headers = [
    `From: ${fromName ? `${encodeHeader(fromName)} <${from}>` : from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject || '(sans objet)')}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${messageId}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references && references.length ? `References: ${references.join(' ')}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
  ].filter(Boolean);
  const raw = headers.join('\r\n') + '\r\n\r\n' + quotedPrintable(body || '');
  return { raw, messageId };
}

// ---------------------------------------------------------------- client SMTP
function smtpConnect({ host, port, secure, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const onError = (e) => reject(new Error(`SMTP ${host}:${port} : ${e.message}`));
    const sock = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(sock))
      : net.connect({ host, port }, () => resolve(sock));
    sock.setTimeout(timeoutMs, () => { sock.destroy(); reject(new Error(`SMTP ${host}:${port} : délai dépassé`)); });
    sock.once('error', onError);
  });
}

// Lit les réponses SMTP (gère le multi-ligne "250-… 250 ").
function reader(sock) {
  let buffer = '';
  let pending = null;
  sock.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    tryFlush();
  });
  function tryFlush() {
    if (!pending) return;
    const lines = buffer.split('\r\n');
    // une réponse est complète quand la dernière ligne non vide est "NNN texte" (espace, pas tiret)
    for (let i = 0; i < lines.length; i++) {
      if (/^\d{3} /.test(lines[i])) {
        const upto = lines.slice(0, i + 1).join('\r\n');
        buffer = lines.slice(i + 1).join('\r\n');
        const p = pending; pending = null;
        clearTimeout(p.timer);
        p.resolve(upto);
        return;
      }
    }
  }
  return {
    read() {
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        pending.timer = setTimeout(() => { if (pending) { pending = null; reject(new Error('SMTP : pas de réponse du serveur')); } }, 20000);
        tryFlush();
      });
    },
  };
}

async function expect(r, sock, cmd, codes) {
  if (cmd !== null) sock.write(cmd + '\r\n');
  const res = await r.read();
  const code = Number(res.slice(0, 3));
  if (!codes.includes(code)) {
    const err = new Error(`SMTP : réponse ${res.split('\r\n').pop() || res}`.slice(0, 300));
    err.smtpCode = code;
    throw err;
  }
  return res;
}

// Envoie un email. opts : { host, port, secure, user, pass, from, fromName, to, subject, body, inReplyTo, references }
// Retourne { messageId }.
async function sendMail(opts) {
  const { host, port, secure = true, user, pass } = opts;
  const sock = await smtpConnect({ host, port: Number(port), secure });
  const r = reader(sock);
  try {
    await expect(r, sock, null, [220]);
    await expect(r, sock, `EHLO la-chasse.local`, [250]);
    if (user) {
      const token = Buffer.from(`\u0000${user}\u0000${pass}`, 'utf8').toString('base64');
      await expect(r, sock, `AUTH PLAIN ${token}`, [235]);
    }
    await expect(r, sock, `MAIL FROM:<${opts.from}>`, [250]);
    try {
      await expect(r, sock, `RCPT TO:<${opts.to}>`, [250, 251]);
    } catch (e) {
      e.rejectedRecipient = true; // adresse refusée → email probablement invalide
      throw e;
    }
    await expect(r, sock, 'DATA', [354]);
    const { raw, messageId } = buildMessage(opts);
    // "dot-stuffing" : une ligne commençant par "." doit être doublée
    const stuffed = raw.replace(/\r\n\./g, '\r\n..');
    await expect(r, sock, stuffed + '\r\n.', [250]);
    sock.write('QUIT\r\n');
    return { messageId };
  } finally {
    sock.destroy();
  }
}

// Vérifie la connexion + l'authentification sans rien envoyer.
async function testAuth({ host, port, secure = true, user, pass }) {
  const sock = await smtpConnect({ host, port: Number(port), secure });
  const r = reader(sock);
  try {
    await expect(r, sock, null, [220]);
    await expect(r, sock, `EHLO la-chasse.local`, [250]);
    const token = Buffer.from(`\u0000${user}\u0000${pass}`, 'utf8').toString('base64');
    await expect(r, sock, `AUTH PLAIN ${token}`, [235]);
    sock.write('QUIT\r\n');
    return true;
  } finally {
    sock.destroy();
  }
}

module.exports = { sendMail, testAuth, buildMessage, quotedPrintable, encodeHeader };
