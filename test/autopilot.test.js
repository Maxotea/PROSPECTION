'use strict';
// Tests du moteur Autopilote contre des serveurs SMTP/IMAP factices locaux.
// Lancer : npm test  (node --test)

process.env.DATA_DIR = require('node:path').join(require('node:os').tmpdir(), `chasse-test-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');

const dbApi = require('../src/db');
const { get, all, run, setSetting, localDay, addDays } = dbApi;
const playbooks = require('../src/playbooks');
const game = require('../src/gamification');
const autopilot = require('../src/autopilot');
const smtp = require('../src/mail/smtp');

playbooks.seedTemplates(dbApi);
playbooks.seedSequences(dbApi);

// ---------------------------------------------------------------- mock SMTP
function startMockSmtp() {
  const state = { messages: [], auths: [], rejects: new Set() };
  const server = net.createServer((sock) => {
    sock.write('220 mock ESMTP\r\n');
    let inData = false;
    let data = '';
    let buffer = '';
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const idx = buffer.indexOf('\r\n');
        if (idx === -1) return;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            state.messages.push(data);
            data = '';
            sock.write('250 OK stored\r\n');
          } else data += (data ? '\r\n' : '') + line;
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) sock.write('250-mock\r\n250 AUTH PLAIN\r\n');
        else if (cmd.startsWith('AUTH PLAIN')) { state.auths.push(line.slice(11)); sock.write('235 ok\r\n'); }
        else if (cmd.startsWith('MAIL FROM')) sock.write('250 ok\r\n');
        else if (cmd.startsWith('RCPT TO')) {
          const to = line.match(/<([^>]+)>/);
          if (to && state.rejects.has(to[1].toLowerCase())) sock.write('550 5.1.1 utilisateur inconnu\r\n');
          else sock.write('250 ok\r\n');
        }
        else if (cmd.startsWith('DATA')) { inData = true; sock.write('354 go\r\n'); }
        else if (cmd.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, state })));
}

// ---------------------------------------------------------------- mock IMAP
// Scénario configurable : uidnext, messages INBOX, dossier Envoyés.
function startMockImap(scenario) {
  const server = net.createServer((sock) => {
    sock.write('* OK mock IMAP ready\r\n');
    let buffer = '';
    let selected = '';
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const idx = buffer.indexOf('\r\n');
        if (idx === -1) return;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const m = line.match(/^(\S+) (.+)$/);
        if (!m) continue;
        const [, tag, cmd] = m;
        const C = cmd.toUpperCase();
        if (C.startsWith('LOGIN')) sock.write(`${tag} OK logged in\r\n`);
        else if (C.startsWith('SELECT')) {
          selected = /INBOX/i.test(cmd) ? 'INBOX' : 'SENT';
          const uidnext = selected === 'INBOX' ? scenario.uidnext : 1000;
          sock.write(`* 3 EXISTS\r\n* OK [UIDNEXT ${uidnext}] predicted\r\n${tag} OK [READ-WRITE] selected\r\n`);
        }
        else if (C.startsWith('UID SEARCH')) {
          const msgs = selected === 'INBOX' ? scenario.inbox : scenario.sent;
          const uids = msgs.map((x) => x.uid).join(' ');
          sock.write(`* SEARCH${uids ? ' ' + uids : ''}\r\n${tag} OK search done\r\n`);
        }
        else if (C.startsWith('UID FETCH')) {
          const msgs = selected === 'INBOX' ? scenario.inbox : scenario.sent;
          const wanted = cmd.match(/FETCH ([\d,:]+|\d+:\*)/i);
          for (let i = 0; i < msgs.length; i++) {
            const msg = msgs[i];
            if (wanted && !wanted[1].includes('*') && !wanted[1].split(',').map(Number).includes(msg.uid)) continue;
            const hdr = msg.headers.replace(/\n/g, '\r\n') + '\r\n';
            const lit = Buffer.from(hdr, 'utf8');
            sock.write(`* ${i + 1} FETCH (UID ${msg.uid} BODY[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)] {${lit.length}}\r\n`);
            sock.write(lit);
            sock.write(')\r\n');
          }
          sock.write(`${tag} OK fetch done\r\n`);
        }
        else if (C.startsWith('LIST')) {
          sock.write(`* LIST (\\HasNoChildren \\Sent) "/" "Sent"\r\n* LIST (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK list done\r\n`);
        }
        else if (C.startsWith('LOGOUT')) { sock.write(`* BYE\r\n${tag} OK bye\r\n`); sock.end(); }
        else sock.write(`${tag} OK noop\r\n`);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, scenario })));
}

// ---------------------------------------------------------------- helpers
function freshContact(data) {
  return dbApi.insertContact({ first_name: 'Test', last_name: 'Client', company: 'TestCo', segment: 'pme', ...data });
}
const seqReactivation = () => get(`SELECT * FROM sequences WHERE code = 'seq_reactivation'`);

// ================================================================ tests
test('MIME : encodage quoted-printable + en-têtes UTF-8 + threading', () => {
  const m = smtp.buildMessage({
    from: 'moi@otea.fr', fromName: 'Maxime Été', to: 'x@y.fr',
    subject: 'Café ?', body: 'Ligne é accentuée\n.point initial\nsigne = ici',
    inReplyTo: '<abc@otea.fr>', references: ['<abc@otea.fr>'],
  });
  assert.match(m.raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(m.raw, /From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <moi@otea\.fr>/);
  assert.match(m.raw, /In-Reply-To: <abc@otea\.fr>/);
  assert.match(m.raw, /References: <abc@otea\.fr>/);
  assert.match(m.raw, /Ligne =C3=A9 accentu=C3=A9e/);
  assert.match(m.raw, /signe =3D ici/);
  assert.ok(m.messageId.startsWith('<chasse-'));
});

test('SMTP : envoi complet contre le mock (AUTH, dot-stuffing, contenu)', async () => {
  const mock = await startMockSmtp();
  const { messageId } = await smtp.sendMail({
    host: '127.0.0.1', port: mock.port, secure: false, user: 'u@x.fr', pass: 'pw',
    from: 'u@x.fr', fromName: 'U', to: 'dest@y.fr', subject: 'Test é', body: 'Bonjour.\n.ligne point',
  });
  assert.ok(messageId);
  assert.strictEqual(mock.state.messages.length, 1);
  const raw = mock.state.messages[0];
  assert.match(raw, /To: dest@y\.fr/);
  assert.match(raw, /\r?\n?\.\.ligne point|^\.\.ligne point/m); // dot-stuffing conservé côté serveur
  const auth = Buffer.from(mock.state.auths[0], 'base64').toString('utf8');
  const NUL = String.fromCharCode(0);
  assert.strictEqual(auth, `${NUL}u@x.fr${NUL}pw`);
  mock.server.close();
});

test('Autopilote : configuration + enrôlement avec garde-fous', () => {
  setSetting('gmail_user', 'maxime@otea.fr');
  setSetting('gmail_app_password', 'aaaa bbbb cccc dddd'); // les espaces doivent être tolérés
  setSetting('autopilot_weekdays_only', '0');
  setSetting('autopilot_mode', 'review');
  setSetting('autopilot_daily_cap', '20');

  const ok = freshContact({ email: 'client1@testco.fr', is_former_client: 1 });
  const noEmail = freshContact({ email: '', last_name: 'SansEmail' });
  const seq = seqReactivation();

  const res = autopilot.enroll(seq.id, [ok.id, noEmail.id, 99999]);
  assert.strictEqual(res.enrolled, 1);
  assert.strictEqual(res.skipped.length, 2);
  // double enrôlement refusé
  const res2 = autopilot.enroll(seq.id, [ok.id]);
  assert.strictEqual(res2.enrolled, 0);
  const e = get('SELECT * FROM enrollments WHERE contact_id = ?', ok.id);
  assert.strictEqual(e.status, 'active');
  assert.strictEqual(e.next_send_at, localDay()); // étape 0 = jour même
});

test('Autopilote : processDue crée un email en attente de validation (mode revue)', () => {
  const r = autopilot.processDue({ ignoreWindow: true });
  assert.strictEqual(r.queued, 1);
  const item = get(`SELECT * FROM outbox WHERE status = 'awaiting_review'`);
  assert.ok(item, 'un email doit attendre la validation');
  assert.strictEqual(item.to_email, 'client1@testco.fr');
  assert.match(item.subject, /TestCo/);
  assert.match(item.body, /Test/); // prénom injecté
  // pas de doublon si on relance processDue
  const r2 = autopilot.processDue({ ignoreWindow: true });
  assert.strictEqual(r2.queued, 0);
});

test('Autopilote : approbation → envoi SMTP → étape suivante planifiée', async () => {
  const mock = await startMockSmtp();
  setSetting('smtp_host', '127.0.0.1');
  setSetting('smtp_port', String(mock.port));
  setSetting('smtp_secure', '0');

  assert.strictEqual(autopilot.approveAll(), 1);
  const flush = await autopilot.flushOutbox({ force: true });
  assert.strictEqual(flush.sent, 1);

  const sent = get(`SELECT * FROM outbox WHERE status = 'sent'`);
  assert.ok(sent.message_id.startsWith('<chasse-'));

  const e = get(`SELECT * FROM enrollments ORDER BY id LIMIT 1`);
  assert.strictEqual(e.current_step, 1);
  assert.strictEqual(e.status, 'active');
  assert.strictEqual(e.first_message_id, sent.message_id);
  assert.strictEqual(e.next_send_at, addDays(localDay(), 4)); // réactivation : J+4
  assert.ok(!/^Re:/.test(e.first_subject));

  const contact = get('SELECT * FROM contacts WHERE id = ?', e.contact_id);
  assert.strictEqual(contact.stage, 'contacte'); // avancé automatiquement
  const act = get(`SELECT * FROM activities WHERE contact_id = ? AND type = 'message_envoye'`, e.contact_id);
  assert.match(act.note, /Autopilote/);
  mock.server.close();
});

test('Autopilote : la relance part dans le même fil (In-Reply-To)', async () => {
  const mock = await startMockSmtp();
  setSetting('smtp_port', String(mock.port));

  const e = get(`SELECT * FROM enrollments ORDER BY id LIMIT 1`);
  run('UPDATE enrollments SET next_send_at = ? WHERE id = ?', localDay(), e.id); // forcer l'échéance
  const r = autopilot.processDue({ ignoreWindow: true });
  assert.strictEqual(r.queued, 1);
  const item = get(`SELECT * FROM outbox WHERE status = 'awaiting_review'`);
  assert.match(item.subject, /^Re: /);
  autopilot.approveAll();
  const flush = await autopilot.flushOutbox({ force: true });
  assert.strictEqual(flush.sent, 1);
  const raw = mock.state.messages[0];
  assert.ok(raw.includes(`In-Reply-To: ${e.first_message_id}`), 'la relance doit référencer le premier message');
  mock.server.close();
});

test('Autopilote : une réponse détectée stoppe la séquence et crée la tâche', async () => {
  const scenario = {
    uidnext: 43,
    inbox: [{
      uid: 42,
      headers: 'From: Test Client <client1@testco.fr>\nTo: maxime@otea.fr\nSubject: Re: On remet ça ?\nDate: Wed, 26 Aug 2026 10:00:00 +0000\nMessage-ID: <x1@testco.fr>',
    }],
    sent: [],
  };
  const mock = await startMockImap(scenario);
  setSetting('imap_host', '127.0.0.1');
  setSetting('imap_port', String(mock.port));
  setSetting('imap_secure', '0');
  setSetting('autopilot_last_uid', '41');

  const res = await autopilot.pollReplies();
  assert.strictEqual(res.replies, 1);

  const e = get(`SELECT * FROM enrollments ORDER BY id LIMIT 1`);
  assert.strictEqual(e.status, 'replied');
  const contact = get('SELECT * FROM contacts WHERE id = ?', e.contact_id);
  assert.strictEqual(contact.stage, 'en_discussion');
  assert.strictEqual(contact.email_status, 'valid');
  const inboxItem = get(`SELECT * FROM inbox WHERE contact_id = ?`, e.contact_id);
  assert.match(inboxItem.content, /a répondu/);

  // même uid re-poussé → dédupliqué (lastUid a avancé)
  const res2 = await autopilot.pollReplies();
  assert.strictEqual(res2.replies, 0);
  mock.server.close();
});

test('Autopilote : bounce → email invalide + séquence stoppée', async () => {
  const mock = await startMockSmtp();
  mock.state.rejects.add('bounce@testco.fr');
  setSetting('smtp_port', String(mock.port));

  const c = freshContact({ email: 'bounce@testco.fr', last_name: 'Bounce' });
  autopilot.enroll(seqReactivation().id, [c.id]);
  autopilot.processDue({ ignoreWindow: true });
  autopilot.approveAll();
  const flush = await autopilot.flushOutbox({ force: true });
  assert.strictEqual(flush.sent, 0);

  const contact = get('SELECT * FROM contacts WHERE id = ?', c.id);
  assert.strictEqual(contact.email_status, 'invalid');
  assert.strictEqual(get('SELECT status FROM enrollments WHERE contact_id = ?', c.id).status, 'bounced');
  assert.match(get(`SELECT error FROM outbox WHERE contact_id = ? AND status = 'failed'`, c.id).error, /refusée/);
  mock.server.close();
});

test('Autopilote : le cap quotidien limite la planification', () => {
  const c1 = freshContact({ email: 'cap1@testco.fr', last_name: 'Cap1' });
  const c2 = freshContact({ email: 'cap2@testco.fr', last_name: 'Cap2' });
  autopilot.enroll(seqReactivation().id, [c1.id, c2.id]);
  const already = Number(get(`SELECT COUNT(*) AS n FROM outbox WHERE day = ? AND status = 'sent'`, localDay()).n);
  setSetting('autopilot_daily_cap', String(already + 1));
  const r = autopilot.processDue({ ignoreWindow: true });
  assert.strictEqual(r.queued, 1, 'une seule place restante sous le cap');
  setSetting('autopilot_daily_cap', '20');
});

test('Envoi direct (Mode Chasse) : envoie, logge, compte dans le cap', async () => {
  const mock = await startMockSmtp();
  setSetting('smtp_host', '127.0.0.1');
  setSetting('smtp_port', String(mock.port));
  setSetting('smtp_secure', '0');

  const c = freshContact({ email: 'direct@testco.fr', last_name: 'Direct', stage: 'a_contacter' });
  const before = Number(get(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'sent' AND day = ?`, localDay()).n);
  const r = await autopilot.sendOneOff({ contact_id: c.id, subject: 'Salut é', body: 'Corps du message' });
  assert.ok(r.message_id.startsWith('<chasse-'));
  assert.strictEqual(r.to, 'direct@testco.fr');
  assert.ok(r.celebration.xp_gained >= 10);

  const after = Number(get(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'sent' AND day = ?`, localDay()).n);
  assert.strictEqual(after, before + 1); // compté dans le cap quotidien
  const contact = get('SELECT * FROM contacts WHERE id = ?', c.id);
  assert.strictEqual(contact.stage, 'contacte'); // pipeline avancé
  const act = get(`SELECT * FROM activities WHERE contact_id = ? AND type = 'message_envoye'`, c.id);
  assert.match(act.note, /Email envoyé/);
  assert.match(mock.state.messages[mock.state.messages.length - 1], /Corps du message/);

  // sans email → refus clair
  const noMail = freshContact({ email: '', last_name: 'SansMail2' });
  await assert.rejects(() => autopilot.sendOneOff({ contact_id: noMail.id, subject: 'x', body: 'y' }), /pas d.email/);
  mock.server.close();
});

test('Scan Gmail : agrège les destinataires du dossier Envoyés', async () => {
  const scenario = {
    uidnext: 43,
    inbox: [],
    sent: [
      { uid: 1, headers: 'To: Paul Durand <paul@client-a.fr>\nDate: Mon, 03 Mar 2025 10:00:00 +0000' },
      { uid: 2, headers: 'To: paul@client-a.fr, Zoé <zoe@client-b.fr>\nDate: Tue, 04 Mar 2025 10:00:00 +0000' },
      { uid: 3, headers: 'To: no-reply@spam.fr\nDate: Tue, 04 Mar 2025 10:00:00 +0000' },
    ],
  };
  const mock = await startMockImap(scenario);
  setSetting('imap_port', String(mock.port));

  const found = await autopilot.scanSent({ days: 999 });
  assert.strictEqual(found.length, 2, 'no-reply filtré');
  assert.strictEqual(found[0].email, 'paul@client-a.fr');
  assert.strictEqual(found[0].count, 2);
  assert.strictEqual(found[0].name, 'Paul Durand');

  const imported = autopilot.importScanned(found);
  assert.strictEqual(imported.created, 2);
  const paul = get(`SELECT * FROM contacts WHERE email = 'paul@client-a.fr'`);
  assert.strictEqual(paul.first_name, 'Paul');
  assert.strictEqual(paul.origin, 'gmail');
  mock.server.close();
});
