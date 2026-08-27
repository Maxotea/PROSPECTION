'use strict';
// 🤖 AUTOPILOTE : le moteur qui prospecte à ta place.
// Boucle : détecter les réponses (IMAP) → planifier les étapes dues (séquences)
// → envoyer (SMTP, dans la fenêtre horaire, sous le cap quotidien, jours ouvrés).
// Règle d'or : dès qu'un prospect répond, sa séquence S'ARRÊTE : c'est à toi de
// transformer la réponse en call.

const dbApi = require('./db');
const { get, all, run, nowIso, localDay, addDays, getSetting, setSetting, allSettings } = dbApi;
const game = require('./gamification');
const playbooks = require('./playbooks');
const smtp = require('./mail/smtp');
const imap = require('./mail/imap');

// ---------------------------------------------------------------- config
function isConfigured() {
  return !!(getSetting('gmail_user') && getSetting('gmail_app_password'));
}

function mailCfg() {
  const user = getSetting('gmail_user');
  const pass = String(getSetting('gmail_app_password') || '').replace(/\s+/g, ''); // Gmail affiche "xxxx xxxx xxxx xxxx"
  if (!user || !pass) throw new Error('Gmail non configuré : renseigne ton adresse et un mot de passe d’application dans Réglages.');
  return {
    smtp: { host: getSetting('smtp_host'), port: Number(getSetting('smtp_port')), secure: getSetting('smtp_secure') !== '0', user, pass },
    imap: { host: getSetting('imap_host'), port: Number(getSetting('imap_port')), secure: getSetting('imap_secure') !== '0', user, pass },
    from: user,
    fromName: getSetting('user_signature') || getSetting('user_name') || '',
  };
}

function windowOpen(now = new Date()) {
  const h = now.getHours();
  return h >= Number(getSetting('autopilot_window_start') || 9) && h < Number(getSetting('autopilot_window_end') || 18);
}
function workday(now = new Date()) {
  if (getSetting('autopilot_weekdays_only') === '0') return true;
  const d = now.getDay();
  return d >= 1 && d <= 5;
}
function sentToday() {
  return Number(get(`SELECT COUNT(*) AS n FROM outbox WHERE day = ? AND status = 'sent'`, localDay()).n);
}
function pendingCount() {
  const r = get(`SELECT
    SUM(CASE WHEN status = 'awaiting_review' THEN 1 ELSE 0 END) AS awaiting,
    SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued
    FROM outbox`);
  return { awaiting: Number(r.awaiting || 0), queued: Number(r.queued || 0) };
}

// ---------------------------------------------------------------- enrôlement
// Un contact = une seule séquence active à la fois. On refuse sans email valide.
function enroll(sequenceId, contactIds) {
  const seq = get('SELECT * FROM sequences WHERE id = ?', sequenceId);
  if (!seq) throw new Error('Séquence introuvable');
  const steps = all('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_index', sequenceId);
  if (!steps.length) throw new Error('Cette séquence n’a aucune étape');

  let enrolled = 0;
  const skipped = [];
  for (const id of contactIds) {
    const c = get('SELECT * FROM contacts WHERE id = ?', id);
    if (!c) { skipped.push({ id, reason: 'introuvable' }); continue; }
    if (c.archived) { skipped.push({ id, reason: 'archivé' }); continue; }
    if (!c.email) { skipped.push({ id, reason: 'pas d’email (enrichis-le d’abord)' }); continue; }
    if (c.email_status === 'invalid') { skipped.push({ id, reason: 'email invalide' }); continue; }
    if (['gagne', 'perdu'].includes(c.stage)) { skipped.push({ id, reason: `étape « ${c.stage} »` }); continue; }
    if (get(`SELECT id FROM enrollments WHERE contact_id = ? AND status IN ('active','paused')`, id)) {
      skipped.push({ id, reason: 'déjà dans une séquence' }); continue;
    }
    const now = nowIso();
    run(`INSERT INTO enrollments (contact_id, sequence_id, status, current_step, next_send_at, started_at, updated_at)
         VALUES (?, ?, 'active', 0, ?, ?, ?)`,
      id, sequenceId, addDays(localDay(), steps[0].delay_days || 0), now, now);
    dbApi.updateContact(id, { next_action: `🤖 Séquence « ${seq.name} »`, next_action_at: '' });
    enrolled++;
  }
  return { enrolled, skipped, sequence: seq.name };
}

// Stoppe les séquences d'un contact (réponse reçue, désinscription, bounce…).
function stopForContact(contactId, reason, status = 'stopped') {
  const res = run(`UPDATE enrollments SET status = ?, stop_reason = ?, updated_at = ? WHERE contact_id = ? AND status IN ('active','paused')`,
    status, reason, nowIso(), contactId);
  if (res.changes > 0) {
    run(`UPDATE outbox SET status = 'cancelled', error = ? WHERE contact_id = ? AND status IN ('awaiting_review','queued')`, reason, contactId);
  }
  return res.changes;
}

// ---------------------------------------------------------------- détection des réponses (IMAP)
async function pollReplies() {
  const cfg = mailCfg();
  const lastUid = Number(getSetting('autopilot_last_uid') || 0);
  const res = await imap.fetchNewInbox(cfg.imap, lastUid);
  setSetting('autopilot_last_uid', String(res.lastUid));
  if (res.initialized) return { initialized: true, replies: 0 };

  let repliesFound = 0;
  for (const msg of res.messages) {
    const ins = run('INSERT OR IGNORE INTO replies (imap_uid, from_email, subject, received_at, created_at) VALUES (?, ?, ?, ?, ?)',
      msg.uid, msg.from.email, msg.subject, msg.date, nowIso());
    if (!ins.changes) continue; // déjà traité
    if (!msg.from.email) continue;
    const contact = get(`SELECT * FROM contacts WHERE email = ? AND email != ''`, msg.from.email);
    if (!contact) continue;

    run('UPDATE replies SET contact_id = ? WHERE imap_uid = ?', contact.id, msg.uid);
    const hadSequence = stopForContact(contact.id, 'a répondu 🎉', 'replied');
    // Ne compter une "réponse reçue" que pour un contact réellement en prospection.
    const inProspection = hadSequence || !['gagne', 'perdu', 'a_contacter'].includes(contact.stage);
    if (inProspection) {
      game.logAction({ contact_id: contact.id, type: 'reponse_recue', note: `🤖 Réponse détectée : « ${msg.subject.slice(0, 80)} »`, meta: { auto: true, imap_uid: msg.uid } });
      dbApi.updateContact(contact.id, { email_status: 'valid' });
      run('INSERT INTO inbox (contact_id, source, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        contact.id, 'gmail-auto',
        `📬 ${contact.first_name} ${contact.last_name} (${contact.company || contact.email}) a répondu : objet : « ${msg.subject} ». Ouvre Gmail pour lire le message et propose un call !`,
        'nouveau', nowIso(), nowIso());
      repliesFound++;
    }
  }
  return { replies: repliesFound, scanned: res.messages.length };
}

// ---------------------------------------------------------------- planification des étapes dues
function renderStep(contact, step, enrollment) {
  const tpl = get('SELECT * FROM templates WHERE code = ?', step.template_code);
  if (!tpl) throw new Error(`Template « ${step.template_code} » introuvable`);
  const rendered = playbooks.renderTemplate(tpl, contact, allSettings());
  let subject = rendered.subject || `Prise de contact : ${getSetting('company_name')}`;
  if (step.step_index > 0) subject = 'Re: ' + (enrollment.first_subject || subject.replace(/^Re:\s*/i, ''));
  return { subject, body: rendered.body };
}

function nextSlot() {
  // Espace les envois de 3 à 7 minutes pour rester naturel.
  const lastQ = get(`SELECT MAX(scheduled_at) AS m FROM outbox WHERE day = ? AND status IN ('queued','sent')`, localDay());
  const base = Math.max(Date.now(), lastQ && lastQ.m ? Date.parse(lastQ.m) : 0);
  return new Date(base + (3 + Math.random() * 4) * 60000).toISOString();
}

function processDue({ ignoreWindow = false } = {}) {
  const now = new Date();
  if (!workday(now)) return { queued: 0, reason: 'week-end : repos du guerrier' };
  if (!ignoreWindow && !windowOpen(now)) return { queued: 0, reason: `hors fenêtre d'envoi (${getSetting('autopilot_window_start')}h-${getSetting('autopilot_window_end')}h)` };

  const cap = Number(getSetting('autopilot_daily_cap') || 20);
  const pending = pendingCount();
  let budget = Math.max(0, cap - sentToday() - pending.queued - pending.awaiting);
  if (!budget) return { queued: 0, reason: 'cap quotidien atteint' };

  const due = all(`
    SELECT e.*, s.name AS seq_name FROM enrollments e
    JOIN sequences s ON s.id = e.sequence_id
    WHERE e.status = 'active' AND s.active = 1 AND e.next_send_at != '' AND e.next_send_at <= ?
      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.enrollment_id = e.id AND o.status IN ('awaiting_review','queued'))
    ORDER BY e.next_send_at LIMIT 200`, localDay());

  const mode = getSetting('autopilot_mode') === 'auto' ? 'auto' : 'review';
  let queued = 0;
  for (const e of due) {
    if (budget <= 0) break;
    const contact = get('SELECT * FROM contacts WHERE id = ?', e.contact_id);
    if (!contact || contact.archived || !contact.email || ['gagne', 'perdu'].includes(contact.stage)) {
      stopForContact(e.contact_id, 'contact plus éligible'); continue;
    }
    const step = get('SELECT * FROM sequence_steps WHERE sequence_id = ? AND step_index = ?', e.sequence_id, e.current_step);
    if (!step) {
      run(`UPDATE enrollments SET status = 'finished', updated_at = ? WHERE id = ?`, nowIso(), e.id);
      continue;
    }
    let msg;
    try { msg = renderStep(contact, step, e); }
    catch (err) {
      run(`UPDATE enrollments SET status = 'paused', stop_reason = ?, updated_at = ? WHERE id = ?`, err.message, nowIso(), e.id);
      continue;
    }
    run(`INSERT INTO outbox (enrollment_id, contact_id, step_index, to_email, subject, body, status, scheduled_at, day, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      e.id, contact.id, e.current_step, contact.email, msg.subject, msg.body,
      mode === 'auto' ? 'queued' : 'awaiting_review',
      mode === 'auto' ? nextSlot() : '', localDay(), nowIso());
    queued++; budget--;
  }
  return { queued, mode };
}

// ---------------------------------------------------------------- approbation (mode revue)
function approve(ids) {
  let n = 0;
  for (const id of ids) {
    const item = get(`SELECT * FROM outbox WHERE id = ? AND status = 'awaiting_review'`, id);
    if (!item) continue;
    run(`UPDATE outbox SET status = 'queued', scheduled_at = ? WHERE id = ?`, nextSlot(), id);
    n++;
  }
  return n;
}
function approveAll() {
  return approve(all(`SELECT id FROM outbox WHERE status = 'awaiting_review'`).map((r) => r.id));
}

// ---------------------------------------------------------------- envoi (SMTP)
async function flushOutbox({ force = false } = {}) {
  const cfg = mailCfg();
  const cap = Number(getSetting('autopilot_daily_cap') || 20);
  let budget = Math.max(0, cap - sentToday());
  if (!budget) return { sent: 0, reason: 'cap quotidien atteint' };

  const nowIsoStr = new Date().toISOString();
  const items = all(`SELECT * FROM outbox WHERE status = 'queued' AND (scheduled_at = '' OR scheduled_at <= ?) ORDER BY scheduled_at LIMIT ?`,
    force ? '9999' : nowIsoStr, budget);
  let sent = 0;
  const errors = [];
  for (const item of items) {
    const e = item.enrollment_id ? get('SELECT * FROM enrollments WHERE id = ?', item.enrollment_id) : null;
    if (e && e.status !== 'active') { run(`UPDATE outbox SET status = 'cancelled', error = 'séquence arrêtée' WHERE id = ?`, item.id); continue; }
    try {
      const { messageId } = await smtp.sendMail({
        ...cfg.smtp, from: cfg.from, fromName: getSetting('user_name') || cfg.fromName,
        to: item.to_email, subject: item.subject, body: item.body,
        inReplyTo: e && item.step_index > 0 && e.first_message_id ? e.first_message_id : undefined,
        references: e && item.step_index > 0 && e.first_message_id ? [e.first_message_id] : undefined,
      });
      run(`UPDATE outbox SET status = 'sent', sent_at = ?, message_id = ? WHERE id = ?`, nowIso(), messageId, item.id);
      sent++;

      if (e) {
        const nextStep = get('SELECT * FROM sequence_steps WHERE sequence_id = ? AND step_index = ?', e.sequence_id, item.step_index + 1);
        const patch = {
          last_sent_at: nowIso(),
          current_step: item.step_index + 1,
          first_message_id: item.step_index === 0 ? messageId : e.first_message_id,
          first_subject: item.step_index === 0 ? item.subject.replace(/^Re:\s*/i, '') : e.first_subject,
          next_send_at: nextStep ? addDays(localDay(), nextStep.delay_days || 1) : '',
          status: nextStep ? 'active' : 'finished',
        };
        run(`UPDATE enrollments SET last_sent_at = ?, current_step = ?, first_message_id = ?, first_subject = ?, next_send_at = ?, status = ?, updated_at = ? WHERE id = ?`,
          patch.last_sent_at, patch.current_step, patch.first_message_id, patch.first_subject, patch.next_send_at, patch.status, nowIso(), e.id);
      }

      const contact = get('SELECT * FROM contacts WHERE id = ?', item.contact_id);
      if (contact) {
        const type = item.step_index === 0 ? 'message_envoye' : 'relance';
        game.insertActivity({ contact_id: contact.id, type, note: `🤖 Autopilote : « ${item.subject.slice(0, 70)} »`, meta: { auto: true, outbox_id: item.id } });
        const patch = { last_touch_at: nowIso() };
        if (contact.stage === 'a_contacter') patch.stage = 'contacte';
        if (e) {
          const nx = get('SELECT next_send_at, status FROM enrollments WHERE id = ?', e.id);
          patch.next_action = nx.status === 'finished' ? 'Séquence terminée : passer en manuel' : '🤖 Séquence : prochaine étape';
          patch.next_action_at = nx.status === 'finished' ? localDay() : '';
        }
        dbApi.updateContact(contact.id, patch);
      }
    } catch (err) {
      if (err.rejectedRecipient) {
        run(`UPDATE outbox SET status = 'failed', error = ? WHERE id = ?`, `adresse refusée : ${err.message}`.slice(0, 300), item.id);
        dbApi.updateContact(item.contact_id, { email_status: 'invalid' });
        stopForContact(item.contact_id, 'email invalide (bounce)', 'bounced');
      } else {
        run(`UPDATE outbox SET status = 'failed', error = ? WHERE id = ?`, String(err.message).slice(0, 300), item.id);
        errors.push(err.message);
        if (err.smtpCode === 535 || /auth/i.test(err.message)) break; // identifiants KO : inutile d'insister
      }
    }
  }
  if (sent > 0) { game.awardQuests(); game.checkBadges(); }
  return { sent, errors };
}

// ---------------------------------------------------------------- boucle principale
let lastTickReport = null;
async function tick({ ignoreWindow = false, force = false } = {}) {
  if (!isConfigured()) return { skipped: true, reason: 'Gmail non configuré' };
  if (getSetting('autopilot_enabled') !== '1' && !force) return { skipped: true, reason: 'Autopilote désactivé (Réglages)' };
  const report = { at: nowIso() };
  try { report.replies = await pollReplies(); }
  catch (e) { report.replies_error = e.message; }
  report.due = processDue({ ignoreWindow });
  try { report.flush = await flushOutbox({ force: false }); }
  catch (e) { report.flush_error = e.message; }
  lastTickReport = report;
  return report;
}

function state() {
  const pending = pendingCount();
  return {
    configured: isConfigured(),
    enabled: getSetting('autopilot_enabled') === '1',
    mode: getSetting('autopilot_mode') === 'auto' ? 'auto' : 'review',
    daily_cap: Number(getSetting('autopilot_daily_cap') || 20),
    sent_today: sentToday(),
    awaiting: pending.awaiting,
    queued: pending.queued,
    active_enrollments: Number(get(`SELECT COUNT(*) AS n FROM enrollments WHERE status = 'active'`).n),
    replies_today: Number(get(`SELECT COUNT(*) AS n FROM activities WHERE type = 'reponse_recue' AND day = ? AND json_extract(meta,'$.auto') = 1`, localDay()).n || 0),
    window: `${getSetting('autopilot_window_start')}h-${getSetting('autopilot_window_end')}h`,
    last_tick: lastTickReport,
  };
}

// ---------------------------------------------------------------- scan Gmail (dossier Envoyés)
async function scanSent({ days = 730 } = {}) {
  const cfg = mailCfg();
  const found = await imap.scanSentRecipients(cfg.imap, { days });
  // Marque ceux qui existent déjà dans le CRM.
  return found.map((f) => {
    const existing = get(`SELECT id, first_name, last_name FROM contacts WHERE email = ?`, f.email);
    return { ...f, existing_id: existing ? existing.id : null };
  });
}

function importScanned(entries) {
  let created = 0, merged = 0;
  for (const e of entries) {
    if (!e.email) continue;
    const parts = String(e.name || '').trim().split(/\s+/);
    const { created: isNew } = dbApi.upsertContact({
      email: e.email,
      first_name: parts[0] || '',
      last_name: parts.slice(1).join(' '),
      origin: 'gmail',
      notes: e.count ? `Trouvé dans Gmail (${e.count} email(s) échangés, dernier : ${String(e.last_date).slice(0, 10)})` : '',
    });
    if (isNew) created++; else merged++;
  }
  if (created + merged > 0) {
    game.insertActivity({ type: 'import', xp: Math.min(created, 50), note: `Scan Gmail : ${created} nouveaux, ${merged} fusionnés`, meta: { count: created, source: 'gmail' } });
    game.checkBadges();
  }
  return { created, merged };
}

// ---------------------------------------------------------------- envoi direct (Mode Chasse / fiche contact)
// Envoie UN email tout de suite, hors séquence : compté dans le cap quotidien,
// loggé dans le journal, XP et étape pipeline comme un envoi manuel.
async function sendOneOff({ contact_id, subject, body }) {
  const contact = get('SELECT * FROM contacts WHERE id = ?', contact_id);
  if (!contact) throw new Error('Contact introuvable');
  if (!contact.email) throw new Error("Ce contact n'a pas d'email : enrichis-le (FullEnrich) ou contacte-le via LinkedIn.");
  const cfg = mailCfg();
  const cap = Number(getSetting('autopilot_daily_cap') || 20);
  if (sentToday() >= cap) throw new Error(`Cap quotidien atteint (${cap} emails aujourd'hui). Remonte-le dans Réglages si besoin.`);

  let messageId;
  try {
    ({ messageId } = await smtp.sendMail({
      ...cfg.smtp, from: cfg.from, fromName: getSetting('user_name') || cfg.fromName,
      to: contact.email, subject: subject || '(sans objet)', body: body || '',
    }));
  } catch (e) {
    if (e.rejectedRecipient) {
      dbApi.updateContact(contact.id, { email_status: 'invalid' });
      throw new Error(`Adresse refusée par le serveur (email marqué invalide) : ${e.message}`);
    }
    throw e;
  }

  run(`INSERT INTO outbox (contact_id, step_index, to_email, subject, body, status, sent_at, message_id, day, created_at)
       VALUES (?, 0, ?, ?, ?, 'sent', ?, ?, ?, ?)`,
    contact.id, contact.email, subject || '', body || '', nowIso(), messageId, localDay(), nowIso());

  const touchTypes = ['connexion_linkedin', 'message_envoye', 'relance', 'appel', 'reponse_envoyee'];
  const touches = Number(get(`SELECT COUNT(*) AS n FROM activities WHERE contact_id = ? AND type IN (${touchTypes.map(() => '?').join(',')})`, contact.id, ...touchTypes).n);
  const celebration = game.logAction({
    contact_id: contact.id,
    type: touches > 0 ? 'relance' : 'message_envoye',
    note: `📤 Email envoyé : « ${String(subject || '').slice(0, 70)} »`,
    meta: { direct_send: true, message_id: messageId },
  });
  return { message_id: messageId, to: contact.email, celebration };
}

// ---------------------------------------------------------------- tests de connexion
async function testSmtp() { await smtp.testAuth({ ...mailCfg().smtp }); return { ok: true, message: 'SMTP Gmail OK : prêt à envoyer' }; }
async function testImap() { await imap.testLogin(mailCfg().imap); return { ok: true, message: 'IMAP Gmail OK : détection des réponses prête' }; }
async function sendTestEmail() {
  const cfg = mailCfg();
  const { messageId } = await smtp.sendMail({
    ...cfg.smtp, from: cfg.from, fromName: getSetting('user_name') || '', to: cfg.from,
    subject: '⚔️ Test La Chasse : ton autopilote fonctionne',
    body: `Si tu lis ceci dans ta boîte, l'envoi SMTP marche parfaitement.\n\nProchaine étape : enrôle tes anciens clients dans la séquence « Réactivation » et laisse tourner. 🎯\n\nLa Chasse`,
  });
  return { ok: true, message: `Email de test envoyé à ${cfg.from}`, message_id: messageId };
}

module.exports = {
  isConfigured, enroll, stopForContact, pollReplies, processDue, approve, approveAll,
  flushOutbox, tick, state, scanSent, importScanned, testSmtp, testImap, sendTestEmail, sendOneOff,
};
