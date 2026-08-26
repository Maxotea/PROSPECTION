'use strict';
/* ⚔️ La Chasse — SPA vanilla (aucune dépendance, aucun build).
   Vues : QG, Mode Chasse, Pipeline, Contacts, Réponses, Imports, Réglages. */

// ---------------------------------------------------------------- helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* réponses non-JSON (export) */ }
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysStr(dayStr, n) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function fmtDay(s) { return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : ''; }
function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''; }
function eur(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' €'; }
function dueLabel(dateStr) {
  if (!dateStr) return '';
  const t = today();
  if (dateStr < t) return `⚠️ en retard`;
  if (dateStr === t) return `🔔 aujourd'hui`;
  return `📆 ${fmtDay(dateStr)}`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
    return true;
  }
}

function mailtoHref(email, subject, body) {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
}

function modal(html) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal">${html}</div>`;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
  $('#modal-root').appendChild(wrap);
  return wrap;
}

// ---------------------------------------------------------------- état global
let S = null;             // état de jeu global (GET /api/state)
let templatesCache = null;
let pollTimer = null;     // polling FullEnrich (vue Imports)

async function refreshState() {
  S = await api('/state');
  renderSideLevel();
  return S;
}

function renderSideLevel() {
  if (!S) return;
  const el = $('#side-level');
  el.innerHTML = `
    <div>Niv. <b>${S.level.level}</b> · <span class="lvl-title">${esc(S.level.title)}</span></div>
    <div class="bar" title="${S.xp_total} XP"><i style="width:${Math.round(S.level.progress * 100)}%"></i></div>
    <div class="muted" style="margin-top:3px">⚡ ${S.xp_total} XP · 🔥 ${S.streak.current}j</div>`;
}

function segChip(code) {
  const seg = (S && S.segments[code]) || { label: code, emoji: '❓', color: '#64748b' };
  return `<span class="chip seg" style="--seg:${seg.color}">${seg.emoji} ${esc(seg.label)}</span>`;
}
function stageLabel(code) {
  const st = (S && S.stages.find((s) => s.code === code)) || { label: code, emoji: '' };
  return `${st.emoji} ${esc(st.label)}`;
}

async function getTemplates(force = false) {
  if (!templatesCache || force) templatesCache = (await api('/templates')).templates;
  return templatesCache;
}

// ---------------------------------------------------------------- célébrations
async function celebrate(res) {
  if (!res) { await refreshState(); return; }
  const prevBoss = S ? S.boss.count : 0;
  if (res.xp_gained) fx.xp(res.xp_gained);
  const bossUp = res.boss && res.boss.count > prevBoss;
  (res.quests_completed || []).forEach((q, i) => setTimeout(() => fx.quest(q), 350 + i * 300));
  (res.badges_won || []).filter((b) => !(bossUp && b.code === 'boss_final')).forEach((b, i) => setTimeout(() => fx.badge(b), 700 + i * 450));
  if (res.level_up) setTimeout(() => fx.levelUp(res.level_up), 1000);
  if (bossUp) {
    if (res.boss.done) setTimeout(() => fx.bossDown(res.boss), 500);
    else setTimeout(() => fx.facture(res.boss), 500);
  }
  await refreshState();
}

// ---------------------------------------------------------------- routeur
const VIEWS = { qg: vQG, chasse: vChasse, autopilot: vAutopilot, pipeline: vPipeline, contacts: vContacts, inbox: vInbox, import: vImport, reglages: vReglages };

async function render() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  const hash = location.hash.replace('#/', '') || 'qg';
  const name = VIEWS[hash] ? hash : 'qg';
  $$('#sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  const view = $('#view');
  view.innerHTML = '<p class="muted">Chargement…</p>';
  try {
    if (!S) await refreshState();
    await VIEWS[name](view);
  } catch (e) {
    view.innerHTML = `<div class="card"><h2>💥 Oups</h2><p>${esc(e.message)}</p></div>`;
  }
}
addEventListener('hashchange', render);

// ================================================================ QG
async function vQG(view) {
  await refreshState();
  const k = S.kpis;
  const boss = S.boss;
  const segments = Array.from({ length: boss.goal }, (_, i) => `<div class="boss-seg ${i < boss.count ? 'full' : ''}"></div>`).join('');
  const onboarding = k.contacts_total === 0 ? `
    <div class="card onboarding" style="border-color:rgba(234,179,8,.4)">
      <h2>👋 Bienvenue dans la Chasse</h2>
      <p class="muted">3 étapes pour lancer la machine :</p>
      <ol>
        <li><b>📦 Importe tes anciens clients</b> — bouton Pennylane dans <a href="#/import">Imports</a> (ou un CSV) : ce sont tes prospects les plus chauds.</li>
        <li><b>🧲 Ajoute tes cibles LinkedIn</b> — export Sales Navigator via FullEnrich → CSV → <a href="#/import">Imports</a>.</li>
        <li><b>⚔️ Lance le <a href="#/chasse">Mode Chasse</a></b> — l'app te sert les bons prospects avec le bon message.</li>
      </ol>
      <div class="row"><button class="gold" id="btn-demo">🎮 Ou charge la démo pour essayer</button></div>
    </div>` : '';

  view.innerHTML = `
    <div class="view-header spread">
      <div><h1>🏰 Quartier général</h1><div class="sub">Salut chasseur. ${S.streak.alive_today ? 'Streak sécurisée pour aujourd’hui ✅' : 'Ta streak attend une action aujourd’hui 👀'}</div></div>
      <a href="#/chasse"><button class="primary big">⚔️ LANCER LE MODE CHASSE</button></a>
    </div>
    ${onboarding}
    <div class="grid" style="grid-template-columns: 1.4fr 1fr; align-items:start">
      <div class="grid">
        <div class="card boss-card">
          <div class="spread">
            <div>
              <div class="boss-title">🎯 OBJECTIF — DÉCLENCHER ${boss.goal} FACTURES</div>
              <div class="boss-count">${boss.count}<small> / ${boss.goal} factures</small></div>
            </div>
            <div style="text-align:right">
              <div class="muted small">CA facturé</div>
              <div style="font-size:24px;font-weight:900">${eur(boss.revenue)}</div>
            </div>
          </div>
          <div class="boss-segments">${segments}</div>
          ${boss.done ? '<div class="boss-done">🏆 BOSS VAINCU — objectif atteint ! Monte l’objectif dans Réglages.</div>' : `<div class="muted small">Chaque deal marqué « facturé » remplit un segment. Le boss tombe à ${boss.goal}.</div>`}
        </div>
        <div class="kpis">
          <div class="kpi"><div class="n">${k.a_contacter}</div><div class="l">🎯 à contacter</div></div>
          <div class="kpi ${k.relances_dues > 0 ? 'alert' : ''}"><div class="n">${k.relances_dues}</div><div class="l">🔔 relances dues</div></div>
          <div class="kpi"><div class="n">${k.en_discussion}</div><div class="l">💬 en discussion / RDV</div></div>
          <div class="kpi"><div class="n">${k.devis_en_cours}</div><div class="l">📄 devis en cours (${eur(k.ca_pipeline)})</div></div>
          <div class="kpi"><div class="n">${k.reponses_semaine}</div><div class="l">📈 réponses / 7 j</div></div>
        </div>
        <div class="card">
          <h2>⚡ XP — 7 derniers jours</h2>
          <div class="chart-wrap">${weeklyChart(S.weekly_xp)}</div>
        </div>
      </div>
      <div class="grid">
        <div class="card" style="border-color:${S.autopilot.enabled ? 'rgba(5,150,105,.5)' : 'var(--border)'}">
          <div class="spread">
            <div>
              <h2 style="margin-bottom:2px">🤖 Autopilote ${S.autopilot.enabled ? '<span class="chip ok">ACTIF</span>' : S.autopilot.configured ? '<span class="chip">en veille</span>' : '<span class="chip due">à brancher</span>'}</h2>
              <div class="muted small">
                ${S.autopilot.configured
                  ? `📤 ${S.autopilot.sent_today}/${S.autopilot.daily_cap} aujourd'hui · 👥 ${S.autopilot.active_enrollments} en séquence${S.autopilot.awaiting ? ` · 👀 <b style="color:var(--gold2)">${S.autopilot.awaiting} email(s) à valider</b>` : ''}${S.autopilot.replies_today ? ` · 💬 ${S.autopilot.replies_today} réponse(s) !` : ''}`
                  : 'Branche ton Gmail et laisse la machine relancer tes anciens clients toute seule.'}
              </div>
            </div>
            <a href="#/autopilot"><button class="${S.autopilot.awaiting ? 'gold' : ''}">${S.autopilot.awaiting ? '👀 Valider' : 'Ouvrir'}</button></a>
          </div>
        </div>
        <div class="card">
          <div class="level-badge">
            <div class="lvl-num">${S.level.level}</div>
            <div style="flex:1">
              <div style="font-weight:800">${esc(S.level.title)}</div>
              <div class="bar" style="margin:6px 0 4px"><i style="width:${Math.round(S.level.progress * 100)}%"></i></div>
              <div class="muted small">${S.xp_total} XP${S.level.next_at ? ` · prochain niveau à ${S.level.next_at}` : ' · niveau max !'}</div>
            </div>
            <div style="text-align:center">
              <div class="streak-flame">🔥</div>
              <div style="font-weight:900">${S.streak.current} j</div>
            </div>
          </div>
        </div>
        <div class="card">
          <h2>📜 Quêtes du jour</h2>
          ${S.quests.map((q) => `
            <div class="quest ${q.done ? 'done' : ''}">
              <div class="q-emoji">${q.emoji}</div>
              <div style="flex:1.2"><div class="q-label">${esc(q.label)}</div></div>
              <div class="q-bar bar"><i style="width:${Math.round((q.progress / q.target) * 100)}%"></i></div>
              <div class="q-count">${q.progress}/${q.target}</div>
              <div class="q-bonus">${q.done ? '✅' : `+${q.bonus}`}</div>
            </div>`).join('')}
        </div>
        <div class="card">
          <h2>📊 Pipeline</h2>
          ${funnel(S.pipeline)}
        </div>
        <div class="card">
          <h2>🏅 Badges (${S.badges.filter((b) => b.won).length}/${S.badges.length})</h2>
          <div class="badges-strip">
            ${S.badges.map((b) => `<div class="badge-tile ${b.won ? 'won' : ''}" title="${esc(b.desc)}${b.won ? '' : ' (à débloquer)'}"><div class="b-emoji">${b.emoji}</div><div class="b-name">${esc(b.name)}</div></div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;

  const demoBtn = $('#btn-demo');
  if (demoBtn) demoBtn.onclick = async () => {
    try { const r = await api('/demo', { method: 'POST' }); fx.toast(esc(r.message)); await refreshState(); render(); }
    catch (e) { fx.error(e.message); }
  };
}

// Graphe barres XP (série unique — libellé direct sur le max, tooltips natifs, table sr-only).
function weeklyChart(days) {
  const W = 560, H = 170, padL = 34, padB = 24, padT = 16;
  const max = Math.max(...days.map((d) => d.xp), 10);
  const bw = (W - padL - 14) / days.length;
  const names = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  const grid = [0.5, 1].map((f) => {
    const y = padT + (H - padT - padB) * (1 - f);
    return `<line class="grid-line" x1="${padL}" y1="${y}" x2="${W - 8}" y2="${y}"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end">${Math.round(max * f)}</text>`;
  }).join('');
  const bars = days.map((d, i) => {
    const h = Math.max(2, (d.xp / max) * (H - padT - padB));
    const x = padL + i * bw + 5;
    const w = bw - 10;
    const y = H - padB - h;
    const r = Math.min(4, h / 2);
    const [yy, m, dd] = d.day.split('-').map(Number);
    const dow = names[new Date(yy, m - 1, dd).getDay()];
    const isMax = d.xp === max && d.xp > 0;
    return `<g><path class="bar-rect" d="M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z"><title>${dow} ${fmtDay(d.day)} — ${d.xp} XP</title></path>
      ${isMax ? `<text class="bar-label" x="${x + w / 2}" y="${y - 5}" text-anchor="middle">${d.xp}</text>` : ''}
      <text x="${x + w / 2}" y="${H - 7}" text-anchor="middle">${dow}</text></g>`;
  }).join('');
  const table = `<table class="sr-only"><caption>XP par jour</caption><tbody>${days.map((d) => `<tr><th>${d.day}</th><td>${d.xp} XP</td></tr>`).join('')}</tbody></table>`;
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="XP gagnée sur les 7 derniers jours">${grid}${bars}</svg>${table}`;
}

// Funnel pipeline : rampe ordinale d'une seule teinte (violet), libellés systématiques.
function funnel(stages) {
  const rows = stages.filter((s) => s.code !== 'perdu');
  const max = Math.max(...rows.map((s) => s.count), 1);
  return rows.map((s, i) => {
    const pct = Math.round((s.count / max) * 100);
    const mix = 35 + Math.round((i / Math.max(rows.length - 1, 1)) * 60);
    return `<div class="funnel-row"><div class="f-label">${s.emoji} ${esc(s.label)}</div>
      <div class="f-bar"><i style="width:${pct}%; background: color-mix(in srgb, #8b5cf6 ${mix}%, #232a52)"></i></div>
      <div class="f-n">${s.count}</div></div>`;
  }).join('');
}

// ================================================================ MODE CHASSE
let hunt = null; // { queue, idx, xp, actions, combo, lastAt }

async function vChasse(view) {
  if (!hunt) {
    view.innerHTML = `
      <div class="view-header"><h1>⚔️ Mode Chasse</h1><div class="sub">L'app te sert les prospects prioritaires un par un, avec le bon message pré-rempli. Toi, tu dégaines.</div></div>
      <div class="card hunt-empty">
        <div class="big-emoji">🏹</div>
        <h2>Prêt à chasser ?</h2>
        <p class="muted">File d'attente : anciens clients à réactiver, relances dues, nouveaux prospects — triés par priorité.</p>
        <div class="row" style="justify-content:center; margin-top:14px">
          <label class="field">Taille de session
            <select id="hunt-size"><option value="5">5 cibles</option><option value="10" selected>10 cibles</option><option value="15">15 cibles</option><option value="25">25 cibles</option></select>
          </label>
          <button class="primary big" id="hunt-start" style="margin-top:14px">🎯 LANCER LA SESSION</button>
        </div>
      </div>`;
    $('#hunt-start').onclick = async () => {
      try {
        const limit = $('#hunt-size').value;
        const { queue } = await api(`/queue?limit=${limit}`);
        if (!queue.length) { fx.toast('File vide : importe des contacts ou reviens quand des relances seront dues 🎉'); return; }
        hunt = { queue, idx: 0, xp: 0, actions: 0, combo: 0, lastAt: 0 };
        fx.play('pop');
        vChasse(view);
      } catch (e) { fx.error(e.message); }
    };
    return;
  }

  if (hunt.idx >= hunt.queue.length) {
    const h = hunt;
    view.innerHTML = `
      <div class="card session-recap" style="max-width:560px;margin:40px auto">
        <div class="big-emoji" style="font-size:64px">🏁</div>
        <h1>Session terminée !</h1>
        <div class="r-xp">+${h.xp} XP</div>
        <p class="muted">${h.actions} action(s) sur ${h.queue.length} cible(s). ${h.combo >= 3 ? `Meilleur combo : 🔥 x${h.combo}.` : ''}</p>
        <div class="row" style="justify-content:center;margin-top:14px">
          <button class="primary" id="hunt-again">🎯 Nouvelle session</button>
          <a href="#/qg"><button>🏰 Retour au QG</button></a>
        </div>
      </div>`;
    fx.confetti(120);
    $('#hunt-again').onclick = () => { hunt = null; vChasse(view); };
    return;
  }

  const c = hunt.queue[hunt.idx];
  const tpls = await getTemplates();
  view.innerHTML = `
    <div class="hunt-top">
      <div><b>Cible ${hunt.idx + 1}/${hunt.queue.length}</b> <span class="muted">· session +${hunt.xp} XP</span></div>
      <div class="combo-meter">${hunt.combo >= 2 ? `🔥 COMBO x${hunt.combo}` : ''}</div>
      <button class="ghost" id="hunt-quit">✖ Quitter</button>
    </div>
    <div class="card hunt-card">
      <div class="hunt-id">
        <div>
          <div class="hunt-name">${esc(c.first_name)} ${esc(c.last_name)}</div>
          <div class="muted">${esc(c.job_title || '')}${c.job_title && c.company ? ' · ' : ''}<b>${esc(c.company || '')}</b>${c.city ? ' · ' + esc(c.city) : ''}</div>
          <div class="row" style="margin-top:8px">
            ${segChip(c.segment)}
            ${c.is_former_client ? `<span class="chip former">💰 Ancien client · ${eur(c.revenue_history)}</span>` : ''}
            <span class="chip">${stageLabel(c.stage)}</span>
            ${c.next_action ? `<span class="chip due">${esc(c.next_action)} · ${dueLabel(c.next_action_at)}</span>` : ''}
          </div>
        </div>
        <div style="text-align:right" class="small muted">Priorité<br><b style="font-size:22px;color:var(--gold2)">${c.score}</b></div>
      </div>
      ${c.notes ? `<div class="hunt-note">📝 ${esc(c.notes)}</div>` : ''}
      <div class="hunt-links">
        ${c.linkedin_url ? `<a href="${esc(c.linkedin_url)}" target="_blank" rel="noopener"><button>🔗 Ouvrir LinkedIn</button></a>` : ''}
        ${c.email ? `<a id="hunt-mailto" href="#"><button>✉️ Ouvrir un email</button></a>` : ''}
        ${c.phone ? `<a href="tel:${esc(c.phone)}"><button>☎️ ${esc(c.phone)}</button></a>` : ''}
        <button id="hunt-open-fiche" class="ghost">👤 Fiche complète</button>
      </div>
      <div class="hunt-msg">
        <div class="spread" style="margin-bottom:6px">
          <label class="field" style="flex:1">Template
            <select id="hunt-tpl">${tpls.map((t) => `<option value="${t.id}" ${t.code === c.suggested_template ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
          </label>
          <button id="hunt-ai" title="Rédiger avec l'IA">✨ IA</button>
          <button id="hunt-copy" title="Copier le message">📋 Copier</button>
        </div>
        <input id="hunt-subject" placeholder="Objet (si email)" style="width:100%;margin-bottom:7px">
        <textarea id="hunt-body" placeholder="Ton message…"></textarea>
      </div>
      <div class="hunt-actions">
        <button class="primary" data-act="send">✉️ Message envoyé <span class="kbd">1</span></button>
        ${c.linkedin_url ? `<button data-act="connect">🔗 Connexion envoyée <span class="kbd">2</span></button>` : ''}
        <button data-act="call">📞 Appelé <span class="kbd">3</span></button>
        <button data-act="replied">💬 A répondu <span class="kbd">4</span></button>
        <button class="gold" data-act="meeting">📅 RDV pris <span class="kbd">5</span></button>
        <button data-act="skip">⏭️ Plus tard <span class="kbd">6</span></button>
        <button class="danger" data-act="disqualify">🪦 Disqualifier <span class="kbd">7</span></button>
      </div>
    </div>`;

  const renderTpl = async () => {
    try {
      const { rendered } = await api('/templates/render', { method: 'POST', body: { template_id: Number($('#hunt-tpl').value), contact_id: c.id } });
      $('#hunt-subject').value = rendered.subject || '';
      $('#hunt-body').value = rendered.body || '';
      updateMailto();
    } catch (e) { fx.error(e.message); }
  };
  const updateMailto = () => {
    const a = $('#hunt-mailto');
    if (a) a.href = mailtoHref(c.email, $('#hunt-subject').value, $('#hunt-body').value);
  };
  $('#hunt-tpl').onchange = renderTpl;
  $('#hunt-subject').oninput = updateMailto;
  $('#hunt-body').oninput = updateMailto;
  await renderTpl();

  $('#hunt-quit').onclick = () => { hunt = null; vChasse(view); };
  $('#hunt-open-fiche').onclick = () => openContact(c.id);
  $('#hunt-copy').onclick = async () => { await copyText($('#hunt-body').value); fx.toast('📋 Message copié'); };
  $('#hunt-ai').onclick = async () => {
    const btn = $('#hunt-ai'); btn.disabled = true; btn.textContent = '✨ …';
    try {
      const purpose = c.stage === 'devis_envoye' || c.stage === 'negociation' ? 'relance_devis' : (c.touches > 0 ? 'relance' : 'premier_contact');
      const d = await api('/ai/draft', { method: 'POST', body: { contact_id: c.id, purpose } });
      if (d.subject) $('#hunt-subject').value = d.subject;
      $('#hunt-body').value = d.body;
      updateMailto();
      fx.toast(d.source === 'claude' ? '✨ Rédigé par l’IA' : '📄 Template appliqué (pas de clé API IA)');
    } catch (e) { fx.error(e.message); }
    btn.disabled = false; btn.textContent = '✨ IA';
  };

  const advance = () => { hunt.idx++; vChasse(view); };
  const act = async (type, { note = '', noXp = false } = {}) => {
    try {
      if (noXp) { advance(); return; }
      const res = await api('/actions', { method: 'POST', body: { contact_id: c.id, type, note } });
      const now = Date.now();
      hunt.combo = now - hunt.lastAt < 90000 ? hunt.combo + 1 : 1;
      hunt.lastAt = now;
      hunt.xp += res.xp_gained; hunt.actions++;
      await celebrate(res);
      advance();
    } catch (e) { fx.error(e.message); }
  };
  const tplName = () => { const t = tpls.find((x) => x.id === Number($('#hunt-tpl').value)); return t ? t.name : ''; };
  const handlers = {
    send: async () => { await copyText($('#hunt-body').value); act(c.touches > 0 ? 'relance' : 'message_envoye', { note: tplName() }); },
    connect: () => act('connexion_linkedin', { note: 'Depuis le Mode Chasse' }),
    call: () => act('appel'),
    replied: () => act('reponse_recue'),
    meeting: () => act('rdv_pris'),
    skip: async () => {
      try { await api(`/contacts/${c.id}`, { method: 'PATCH', body: { next_action_at: addDaysStr(today(), 1), next_action: c.next_action || 'Reprendre contact' } }); } catch { /* pas bloquant */ }
      advance();
    },
    disqualify: () => act('disqualifie'),
  };
  $$('[data-act]', view).forEach((b) => { b.onclick = () => handlers[b.dataset.act](); });
  view.onkeydown = null;
  document.onkeydown = (e) => {
    if (location.hash.replace('#/', '') !== 'chasse' || !hunt) { document.onkeydown = null; return; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    const map = { 1: 'send', 2: 'connect', 3: 'call', 4: 'replied', 5: 'meeting', 6: 'skip', 7: 'disqualify' };
    if (map[e.key]) { const btn = $(`[data-act="${map[e.key]}"]`, view); if (btn) btn.click(); }
  };
}

// ================================================================ PIPELINE (kanban)
async function vPipeline(view) {
  const { contacts } = await api('/contacts?limit=500');
  const { deals } = await api('/deals');
  const dealByContact = {};
  for (const d of deals) if (['devis_envoye', 'accepte', 'brouillon'].includes(d.status)) dealByContact[d.contact_id] = d;

  view.innerHTML = `
    <div class="view-header spread">
      <div><h1>📊 Pipeline</h1><div class="sub">Glisse-dépose les cartes pour faire avancer tes prospects (+5 XP par mouvement).</div></div>
    </div>
    <div class="kanban">
      ${S.stages.map((st) => `
        <div class="kcol" data-stage="${st.code}">
          <h3><span>${st.emoji} ${esc(st.label)}</span><span>${contacts.filter((c) => c.stage === st.code).length}</span></h3>
          ${contacts.filter((c) => c.stage === st.code).map((c) => {
            const deal = dealByContact[c.id];
            return `<div class="kcard" draggable="true" data-id="${c.id}">
              <div class="k-name">${esc(c.first_name)} ${esc(c.last_name)}</div>
              <div class="k-co">${esc(c.company || '')}</div>
              <div class="k-meta">
                ${segChip(c.segment)}
                ${c.is_former_client ? '<span class="chip former">💰</span>' : ''}
                ${deal ? `<span class="chip ok">📄 ${eur(deal.amount)}</span>` : ''}
                ${c.next_action_at && c.next_action_at <= today() && !['gagne', 'perdu'].includes(c.stage) ? `<span class="chip due">🔔</span>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>`).join('')}
    </div>`;

  let draggedId = null;
  $$('.kcard', view).forEach((card) => {
    card.addEventListener('dragstart', () => { draggedId = card.dataset.id; });
    card.addEventListener('click', () => openContact(card.dataset.id));
  });
  $$('.kcol', view).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('dragover'); });
    col.addEventListener('dragleave', () => col.classList.remove('dragover'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('dragover');
      if (!draggedId) return;
      try {
        const res = await api(`/contacts/${draggedId}`, { method: 'PATCH', body: { stage: col.dataset.stage } });
        await celebrate(res.celebration);
        vPipeline(view);
      } catch (err) { fx.error(err.message); }
    });
  });
}

// ================================================================ CONTACTS
const cFilter = { search: '', segment: '', stage: '', origin: '', former: false, enrichable: false };
const cSelected = new Set();

async function vContacts(view) {
  const params = new URLSearchParams({ limit: '300' });
  if (cFilter.search) params.set('search', cFilter.search);
  if (cFilter.segment) params.set('segment', cFilter.segment);
  if (cFilter.stage) params.set('stage', cFilter.stage);
  if (cFilter.origin) params.set('origin', cFilter.origin);
  if (cFilter.former) params.set('former', '1');
  if (cFilter.enrichable) params.set('enrichable', '1');
  const { total, contacts } = await api('/contacts?' + params);

  view.innerHTML = `
    <div class="view-header spread">
      <div><h1>👥 Contacts</h1><div class="sub">${total} contact(s)${cSelected.size ? ` · ${cSelected.size} sélectionné(s)` : ''}</div></div>
      <div class="row">
        <button id="c-new" class="primary">➕ Nouveau</button>
        <a href="/api/export.csv" download><button>📤 Export CSV</button></a>
      </div>
    </div>
    <div class="toolbar">
      <input type="search" id="c-search" placeholder="🔍 Nom, boîte, email…" value="${esc(cFilter.search)}">
      <select id="c-seg"><option value="">Typologie : toutes</option>${Object.entries(S.segments).map(([k, s]) => `<option value="${k}" ${cFilter.segment === k ? 'selected' : ''}>${s.emoji} ${esc(s.label)}</option>`).join('')}</select>
      <select id="c-stage"><option value="">Étape : toutes</option>${S.stages.map((s) => `<option value="${s.code}" ${cFilter.stage === s.code ? 'selected' : ''}>${s.emoji} ${esc(s.label)}</option>`).join('')}</select>
      <select id="c-origin"><option value="">Origine : toutes</option>${['pennylane', 'hubspot', 'csv', 'linkedin', 'manuel', 'demo'].map((o) => `<option ${cFilter.origin === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <label class="chip" style="cursor:pointer"><input type="checkbox" id="c-former" ${cFilter.former ? 'checked' : ''}> 💰 anciens clients</label>
      <label class="chip" style="cursor:pointer"><input type="checkbox" id="c-enrich" ${cFilter.enrichable ? 'checked' : ''}> 🕳️ email/tél manquant</label>
    </div>
    ${cSelected.size ? `<div class="toolbar card" style="padding:10px 14px">
      <b>${cSelected.size} sélectionné(s) :</b>
      <button id="b-sequence" class="primary">🤖 Enrôler en séquence</button>
      <button id="b-enrich">🧪 Enrichir (FullEnrich)</button>
      <button id="b-hubspot">⬆️ Pousser vers HubSpot</button>
      <select id="b-seg"><option value="">→ Typologie…</option>${Object.entries(S.segments).map(([k, s]) => `<option value="${k}">${s.emoji} ${esc(s.label)}</option>`).join('')}</select>
      <button id="b-delete" class="danger">🗑️ Supprimer</button>
      <button id="b-clear" class="ghost">✖ Désélectionner</button>
    </div>` : ''}
    <div class="card table-scroll" style="padding:6px 10px">
      <table class="list">
        <thead><tr>
          <th><input type="checkbox" id="c-all"></th><th>Contact</th><th>Typologie</th><th>Étape</th><th>Data</th><th>Prochaine action</th><th>CA hist.</th>
        </tr></thead>
        <tbody>
          ${contacts.map((c) => `<tr class="rowc" data-id="${c.id}">
            <td><input type="checkbox" class="c-check" data-id="${c.id}" ${cSelected.has(c.id) ? 'checked' : ''}></td>
            <td><div class="t-name">${esc(c.first_name)} ${esc(c.last_name)} ${c.is_former_client ? '💰' : ''}</div><div class="t-sub">${esc(c.company || '')}${c.job_title ? ' · ' + esc(c.job_title) : ''}</div></td>
            <td>${segChip(c.segment)}</td>
            <td>${stageLabel(c.stage)}</td>
            <td class="presence" title="email / téléphone / LinkedIn">${c.email ? '✉️' : '·'}${c.phone ? '☎️' : '·'}${c.linkedin_url ? '🔗' : '·'}</td>
            <td class="small">${c.next_action ? `${esc(c.next_action)}<br><span class="muted">${dueLabel(c.next_action_at)}</span>` : '<span class="faint">—</span>'}</td>
            <td>${c.revenue_history ? eur(c.revenue_history) : '<span class="faint">—</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${contacts.length === 0 ? '<p class="muted" style="padding:14px">Aucun contact — passe par <a href="#/import">Imports</a> pour remplir ton terrain de chasse.</p>' : ''}
    </div>`;

  let searchTimer = null;
  $('#c-search').oninput = (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { cFilter.search = e.target.value; vContacts(view); }, 300); };
  $('#c-seg').onchange = (e) => { cFilter.segment = e.target.value; vContacts(view); };
  $('#c-stage').onchange = (e) => { cFilter.stage = e.target.value; vContacts(view); };
  $('#c-origin').onchange = (e) => { cFilter.origin = e.target.value; vContacts(view); };
  $('#c-former').onchange = (e) => { cFilter.former = e.target.checked; vContacts(view); };
  $('#c-enrich').onchange = (e) => { cFilter.enrichable = e.target.checked; vContacts(view); };
  $('#c-all').onchange = (e) => {
    contacts.forEach((c) => e.target.checked ? cSelected.add(c.id) : cSelected.delete(c.id));
    vContacts(view);
  };
  $$('.c-check', view).forEach((cb) => {
    cb.onclick = (e) => { e.stopPropagation(); const id = Number(cb.dataset.id); cb.checked ? cSelected.add(id) : cSelected.delete(id); vContacts(view); };
  });
  $$('tr.rowc', view).forEach((tr) => { tr.onclick = (e) => { if (e.target.type !== 'checkbox') openContact(tr.dataset.id); }; });

  $('#c-new').onclick = () => newContactModal(() => vContacts(view));
  if (cSelected.size) {
    $('#b-clear').onclick = () => { cSelected.clear(); vContacts(view); };
    $('#b-delete').onclick = async () => {
      if (!confirm(`Supprimer définitivement ${cSelected.size} contact(s) ?`)) return;
      await api('/contacts/bulk', { method: 'POST', body: { ids: [...cSelected], action: 'delete' } });
      cSelected.clear(); fx.toast('🗑️ Supprimés'); vContacts(view);
    };
    $('#b-seg').onchange = async (e) => {
      if (!e.target.value) return;
      await api('/contacts/bulk', { method: 'POST', body: { ids: [...cSelected], patch: { segment: e.target.value } } });
      fx.toast('✅ Typologie mise à jour'); vContacts(view);
    };
    $('#b-sequence').onclick = () => sequencePickerModal([...cSelected], () => { cSelected.clear(); vContacts(view); });
    $('#b-enrich').onclick = () => launchEnrich([...cSelected], () => vContacts(view));
    $('#b-hubspot').onclick = async () => {
      const btn = $('#b-hubspot'); btn.disabled = true;
      try {
        const r = await api('/hubspot/push', { method: 'POST', body: { contact_ids: [...cSelected] } });
        fx.toast(`⬆️ HubSpot : ${r.pushed} poussé(s)${r.errors.length ? `, ${r.errors.length} erreur(s)` : ''}`);
        if (r.errors.length) fx.error(r.errors[0].error);
      } catch (e) { fx.error(e.message); }
      btn.disabled = false;
    };
  }
}

async function launchEnrich(ids, after) {
  if (!confirm(`Enrichir ${Math.min(ids.length, 100)} contact(s) via FullEnrich ?\n⚠️ Consomme des crédits FullEnrich (email + téléphone en cascade).`)) return;
  try {
    const r = await api('/fullenrich/enrich', { method: 'POST', body: { contact_ids: ids } });
    fx.toast(`🧪 Enrichissement lancé (${r.count} contacts). Résultats dans quelques minutes — vois la vue Imports.`);
    if (after) after();
  } catch (e) { fx.error(e.message); }
}

function newContactModal(after) {
  const m = modal(`
    <h2>➕ Nouveau contact</h2>
    <div class="form-grid" style="margin-top:10px">
      <label class="field">Prénom<input id="n-fn"></label>
      <label class="field">Nom<input id="n-ln"></label>
      <label class="field">Entreprise<input id="n-co"></label>
      <label class="field">Poste<input id="n-jt"></label>
      <label class="field">Email<input id="n-em" type="email"></label>
      <label class="field">Téléphone<input id="n-ph"></label>
      <label class="field wide">URL LinkedIn<input id="n-li" placeholder="https://www.linkedin.com/in/…"></label>
      <label class="field">Typologie<select id="n-seg">${Object.entries(S.segments).map(([k, s]) => `<option value="${k}">${s.emoji} ${esc(s.label)}</option>`).join('')}</select></label>
      <label class="field">Ville<input id="n-ci"></label>
      <label class="field wide"><span>Notes</span><textarea id="n-no" rows="2"></textarea></label>
      <label class="chip wide" style="cursor:pointer"><input type="checkbox" id="n-former"> 💰 C'est un ancien client</label>
    </div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="primary" id="n-save">Créer</button></div>`);
  $('#n-seg', m).value = 'inconnu';
  $('#n-save', m).onclick = async () => {
    try {
      await api('/contacts', { method: 'POST', body: {
        first_name: $('#n-fn', m).value, last_name: $('#n-ln', m).value, company: $('#n-co', m).value,
        job_title: $('#n-jt', m).value, email: $('#n-em', m).value, phone: $('#n-ph', m).value,
        linkedin_url: $('#n-li', m).value, segment: $('#n-seg', m).value, city: $('#n-ci', m).value,
        notes: $('#n-no', m).value, is_former_client: $('#n-former', m).checked ? 1 : 0,
      } });
      m.remove(); fx.toast('✅ Contact créé'); if (after) after();
    } catch (e) { fx.error(e.message); }
  };
}

// ================================================================ FICHE CONTACT (drawer)
async function openContact(id) {
  const backdrop = $('#drawer-backdrop');
  const drawer = $('#drawer');
  backdrop.classList.remove('hidden');
  drawer.classList.remove('hidden');
  drawer.innerHTML = '<p class="muted">Chargement…</p>';
  backdrop.onclick = closeDrawer;

  let data;
  try { data = await api(`/contacts/${id}`); }
  catch (e) { drawer.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  const { contact: c, activities, deals } = data;
  const tpls = await getTemplates();

  drawer.innerHTML = `
    <div class="spread">
      <div>
        <h1 style="font-size:22px">${esc(c.first_name)} ${esc(c.last_name)} ${c.is_former_client ? '💰' : ''}</h1>
        <div class="muted">${esc(c.job_title || '')}${c.job_title && c.company ? ' · ' : ''}${esc(c.company || '')}</div>
      </div>
      <button class="ghost" id="d-close">✖</button>
    </div>
    <div class="row" style="margin:10px 0">
      ${segChip(c.segment)}
      <span class="chip">${stageLabel(c.stage)}</span>
      ${c.is_former_client ? `<span class="chip former">Ancien client · ${eur(c.revenue_history)}</span>` : ''}
      <span class="chip">${esc(c.origin)}</span>
    </div>
    <div class="row">
      ${c.linkedin_url ? `<a href="${esc(c.linkedin_url)}" target="_blank" rel="noopener"><button>🔗 LinkedIn</button></a>` : ''}
      ${c.email ? `<a id="d-mailto" href="${mailtoHref(c.email, '', '')}"><button>✉️ ${esc(c.email)}</button></a>` : ''}
      ${c.phone ? `<a href="tel:${esc(c.phone)}"><button>☎️ ${esc(c.phone)}</button></a>` : ''}
      ${!c.email || !c.phone ? `<button id="d-enrich">🧪 Enrichir</button>` : ''}
      <button id="d-hubspot">⬆️ HubSpot</button>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>✏️ Infos</h3>
      <div class="form-grid">
        <label class="field">Prénom<input id="e-fn" value="${esc(c.first_name)}"></label>
        <label class="field">Nom<input id="e-ln" value="${esc(c.last_name)}"></label>
        <label class="field">Email<input id="e-em" value="${esc(c.email)}"></label>
        <label class="field">Téléphone<input id="e-ph" value="${esc(c.phone)}"></label>
        <label class="field">Entreprise<input id="e-co" value="${esc(c.company)}"></label>
        <label class="field">Poste<input id="e-jt" value="${esc(c.job_title)}"></label>
        <label class="field">Typologie<select id="e-seg">${Object.entries(S.segments).map(([k, s]) => `<option value="${k}" ${c.segment === k ? 'selected' : ''}>${s.emoji} ${esc(s.label)}</option>`).join('')}</select></label>
        <label class="field">Étape<select id="e-stage">${S.stages.map((s) => `<option value="${s.code}" ${c.stage === s.code ? 'selected' : ''}>${s.emoji} ${esc(s.label)}</option>`).join('')}</select></label>
        <label class="field">Prochaine action<input id="e-na" value="${esc(c.next_action)}"></label>
        <label class="field">Échéance<input id="e-nad" type="date" value="${esc(c.next_action_at)}"></label>
        <label class="field wide"><span>Notes</span><textarea id="e-no" rows="3">${esc(c.notes)}</textarea></label>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="primary" id="d-save">💾 Enregistrer</button></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="spread"><h3>📄 Devis & factures</h3>
        <div class="row">
          <button id="d-quote-pl" class="primary">➕ Devis Pennylane</button>
          <button id="d-quote-manual">➕ Devis manuel</button>
        </div>
      </div>
      ${deals.length === 0 ? '<p class="muted small">Aucun devis pour l’instant. Un devis envoyé = +75 XP. Une facture = +250 XP et un segment du boss. 😉</p>' : ''}
      ${deals.map((d) => `
        <div class="deal-line">
          <div>
            <b>${esc(d.title)}</b> <span class="d-amount">${eur(d.amount)}</span>
            <span class="chip ${d.status === 'facture' ? 'ok' : ''}">${{ brouillon: '📝 brouillon', devis_envoye: '📤 envoyé', accepte: '🤝 accepté', facture: '💰 FACTURÉ', perdu: '🪦 perdu' }[d.status] || esc(d.status)}</span>
            ${d.pennylane_quote_id ? `<span class="chip">PL #${esc(d.pennylane_quote_id)}</span>` : ''}
          </div>
          <div class="row">
            ${d.pennylane_quote_url ? `<a href="${esc(d.pennylane_quote_url)}" target="_blank" rel="noopener"><button class="ghost">📄 PDF</button></a>` : ''}
            ${d.status === 'brouillon' ? `<button data-deal="${d.id}" data-status="devis_envoye">📤 Marquer envoyé</button>` : ''}
            ${d.status === 'devis_envoye' ? `<button data-deal="${d.id}" data-status="accepte">🤝 Accepté</button>` : ''}
            ${['devis_envoye', 'accepte'].includes(d.status) && d.pennylane_quote_id ? `<button data-invoice-pl="${d.id}" class="gold">🧾 Facture PL (brouillon)</button>` : ''}
            ${['devis_envoye', 'accepte'].includes(d.status) ? `<button data-deal="${d.id}" data-status="facture" class="gold">💰 Facturée !</button>` : ''}
            ${d.status !== 'facture' && d.status !== 'perdu' ? `<button data-deal="${d.id}" data-status="perdu" class="ghost">🪦</button>` : ''}
          </div>
        </div>`).join('')}
    </div>

    <div class="card" style="margin-top:14px">
      <h3>💬 Composer un message</h3>
      <div class="row" style="margin-bottom:7px">
        <select id="d-tpl" style="flex:1">${tpls.map((t) => `<option value="${t.id}" ${t.code === data.suggested_template ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <select id="d-purpose" title="Objectif IA">
          <option value="premier_contact">✨ Premier contact</option>
          <option value="relance">✨ Relance</option>
          <option value="envoi_devis">✨ Envoi devis</option>
          <option value="relance_devis">✨ Relance devis</option>
        </select>
        <button id="d-ai">✨ IA</button>
      </div>
      <input id="d-subject" placeholder="Objet" style="width:100%;margin-bottom:7px">
      <textarea id="d-body" rows="7"></textarea>
      <div class="row" style="margin-top:8px">
        <button id="d-copy">📋 Copier</button>
        ${c.email ? `<a id="d-send-mail" href="#"><button class="primary">✉️ Ouvrir l'email</button></a>` : ''}
        <span style="flex:1"></span>
        <select id="d-log-type">
          <option value="message_envoye">📤 Message envoyé</option>
          <option value="relance">🔁 Relance</option>
          <option value="appel">📞 Appel</option>
          <option value="reponse_recue">💬 Réponse reçue</option>
          <option value="rdv_pris">📅 RDV pris</option>
          <option value="note">📝 Note</option>
        </select>
        <button id="d-log" class="gold">⚡ Logger</button>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>🕓 Historique</h3>
      <div class="timeline">
        ${activities.length === 0 ? '<p class="muted small">Rien pour l’instant.</p>' : ''}
        ${activities.map((a) => {
          const def = S.actions[a.type] || { label: a.type, emoji: '•' };
          return `<div class="tl-item"><div class="tl-date">${fmtDateTime(a.created_at)} ${a.xp ? `· <b style="color:var(--gold2)">+${a.xp} XP</b>` : ''}</div>${def.emoji} <b>${esc(def.label)}</b>${a.note ? ` — ${esc(a.note)}` : ''}</div>`;
        }).join('')}
      </div>
    </div>
    <div style="height:30px"></div>`;

  $('#d-close').onclick = closeDrawer;
  $('#d-save').onclick = async () => {
    try {
      const res = await api(`/contacts/${c.id}`, { method: 'PATCH', body: {
        first_name: $('#e-fn').value, last_name: $('#e-ln').value, email: $('#e-em').value, phone: $('#e-ph').value,
        company: $('#e-co').value, job_title: $('#e-jt').value, segment: $('#e-seg').value, stage: $('#e-stage').value,
        next_action: $('#e-na').value, next_action_at: $('#e-nad').value, notes: $('#e-no').value,
      } });
      await celebrate(res.celebration);
      fx.toast('💾 Enregistré');
      openContact(c.id);
    } catch (e) { fx.error(e.message); }
  };
  const enrichBtn = $('#d-enrich');
  if (enrichBtn) enrichBtn.onclick = () => launchEnrich([c.id]);
  $('#d-hubspot').onclick = async () => {
    try { await api('/hubspot/push', { method: 'POST', body: { contact_ids: [c.id] } }); fx.toast('⬆️ Poussé vers HubSpot'); }
    catch (e) { fx.error(e.message); }
  };

  // Devis
  $('#d-quote-pl').onclick = () => quoteModal(c, () => openContact(c.id));
  $('#d-quote-manual').onclick = () => manualDealModal(c, () => openContact(c.id));
  $$('[data-deal]', drawer).forEach((b) => {
    b.onclick = async () => {
      try {
        const res = await api(`/deals/${b.dataset.deal}`, { method: 'PATCH', body: { status: b.dataset.status } });
        await celebrate(res.celebration);
        openContact(c.id);
      } catch (e) { fx.error(e.message); }
    };
  });
  $$('[data-invoice-pl]', drawer).forEach((b) => {
    b.onclick = async () => {
      b.disabled = true; b.textContent = '🧾 …';
      try {
        await api('/pennylane/invoice_from_quote', { method: 'POST', body: { deal_id: Number(b.dataset.invoicePl) } });
        fx.toast('🧾 Facture créée en BROUILLON dans Pennylane — valide-la là-bas.');
        const res = await api(`/deals/${b.dataset.invoicePl}`, { method: 'PATCH', body: { status: 'facture' } });
        await celebrate(res.celebration);
        openContact(c.id);
      } catch (e) { fx.error(e.message); b.disabled = false; b.textContent = '🧾 Facture PL (brouillon)'; }
    };
  });

  // Composer
  const renderTpl = async () => {
    try {
      const { rendered } = await api('/templates/render', { method: 'POST', body: { template_id: Number($('#d-tpl').value), contact_id: c.id } });
      $('#d-subject').value = rendered.subject || '';
      $('#d-body').value = rendered.body || '';
      syncMail();
    } catch (e) { fx.error(e.message); }
  };
  const syncMail = () => { const a = $('#d-send-mail'); if (a) a.href = mailtoHref(c.email, $('#d-subject').value, $('#d-body').value); };
  $('#d-tpl').onchange = renderTpl;
  $('#d-subject').oninput = syncMail;
  $('#d-body').oninput = syncMail;
  await renderTpl();
  $('#d-copy').onclick = async () => { await copyText($('#d-body').value); fx.toast('📋 Copié'); };
  $('#d-ai').onclick = async () => {
    const btn = $('#d-ai'); btn.disabled = true; btn.textContent = '✨ …';
    try {
      const d = await api('/ai/draft', { method: 'POST', body: { contact_id: c.id, purpose: $('#d-purpose').value } });
      if (d.subject) $('#d-subject').value = d.subject;
      $('#d-body').value = d.body; syncMail();
      fx.toast(d.source === 'claude' ? '✨ Rédigé par l’IA' : '📄 Template appliqué (pas de clé IA)');
    } catch (e) { fx.error(e.message); }
    btn.disabled = false; btn.textContent = '✨ IA';
  };
  $('#d-log').onclick = async () => {
    try {
      const res = await api('/actions', { method: 'POST', body: { contact_id: c.id, type: $('#d-log-type').value, note: '' } });
      await celebrate(res);
      openContact(c.id);
    } catch (e) { fx.error(e.message); }
  };
}

function closeDrawer() {
  $('#drawer').classList.add('hidden');
  $('#drawer-backdrop').classList.add('hidden');
}

// Modale devis Pennylane
function quoteModal(contact, after) {
  const lineHtml = () => `<div class="ql">
    <input class="ql-label" placeholder="Prestation (ex : Aftermovie 90s)">
    <input class="ql-qty" type="number" value="1" min="0" step="0.5" title="Quantité">
    <input class="ql-price" type="number" placeholder="Prix HT" min="0" step="10" title="Prix unitaire HT">
    <select class="ql-vat" title="TVA"><option value="FR_200">TVA 20 %</option><option value="FR_100">TVA 10 %</option><option value="FR_55">TVA 5,5 %</option><option value="FR_0">TVA 0 %</option></select>
    <button class="ghost ql-del">🗑</button>
  </div>`;
  const m = modal(`
    <h2>📄 Devis Pennylane</h2>
    <p class="muted small">Créé directement dans ton Pennylane (client créé au passage si besoin), puis trackés ici pour l'objectif 5 factures.</p>
    <label class="field" style="margin:10px 0">Titre interne<input id="q-title" value="${esc('Devis ' + (contact.company || contact.last_name))}"></label>
    <div class="quote-lines" id="q-lines">${lineHtml()}</div>
    <button class="ghost" id="q-add">➕ Ajouter une ligne</button>
    <div class="spread" style="margin-top:10px">
      <label class="field">Validité (jours)<input id="q-deadline" type="number" value="30" style="width:90px"></label>
      <div style="text-align:right"><span class="muted small">Total HT</span><div id="q-total" style="font-size:22px;font-weight:900">0 €</div></div>
    </div>
    <details style="margin:10px 0"><summary class="muted">🏠 Adresse du client (utile si le client n'existe pas encore dans Pennylane)</summary>
      <div class="form-grid" style="margin-top:8px">
        <label class="field wide">Adresse<input id="q-addr"></label>
        <label class="field">Code postal<input id="q-cp"></label>
        <label class="field">Ville<input id="q-city" value="${esc(contact.city || '')}"></label>
      </div>
    </details>
    <div id="q-error" class="hidden" style="color:var(--red2);background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.4);border-radius:9px;padding:9px 12px;margin:8px 0;font-size:13px"></div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="primary big" id="q-go">🚀 Créer le devis</button></div>`);

  const recalc = () => {
    let total = 0;
    $$('.ql', m).forEach((l) => { total += (Number($('.ql-qty', l).value) || 0) * (Number($('.ql-price', l).value) || 0); });
    $('#q-total', m).textContent = eur(total);
  };
  m.addEventListener('input', recalc);
  m.addEventListener('click', (e) => { if (e.target.classList.contains('ql-del')) { if ($$('.ql', m).length > 1) e.target.closest('.ql').remove(); recalc(); } });
  $('#q-add', m).onclick = () => { $('#q-lines', m).insertAdjacentHTML('beforeend', lineHtml()); };
  $('#q-go', m).onclick = async () => {
    const lines = $$('.ql', m).map((l) => ({
      label: $('.ql-label', l).value.trim(),
      quantity: Number($('.ql-qty', l).value) || 1,
      unit_price: Number($('.ql-price', l).value) || 0,
      vat_rate: $('.ql-vat', l).value,
    })).filter((l) => l.label);
    if (!lines.length) { $('#q-error', m).textContent = 'Ajoute au moins une ligne avec un libellé.'; $('#q-error', m).classList.remove('hidden'); return; }
    const btn = $('#q-go', m); btn.disabled = true; btn.textContent = '🚀 Création…';
    try {
      const res = await api('/pennylane/quote', { method: 'POST', body: {
        contact_id: contact.id, title: $('#q-title', m).value, lines,
        deadline_days: Number($('#q-deadline', m).value) || 30,
        extra: { address: $('#q-addr', m).value, postal_code: $('#q-cp', m).value, city: $('#q-city', m).value },
      } });
      m.remove();
      await celebrate(res.celebration);
      fx.toast(`📄 Devis créé dans Pennylane${res.file_url ? ' — PDF dispo sur la fiche' : ''}`);
      if (after) after();
    } catch (e) {
      $('#q-error', m).textContent = e.message;
      $('#q-error', m).classList.remove('hidden');
      btn.disabled = false; btn.textContent = '🚀 Créer le devis';
    }
  };
}

function manualDealModal(contact, after) {
  const m = modal(`
    <h2>➕ Devis manuel</h2>
    <p class="muted small">Pour tracker un devis fait ailleurs (Pennylane à la main, etc.).</p>
    <div class="form-grid" style="margin-top:10px">
      <label class="field wide">Titre<input id="md-title" value="${esc('Devis ' + (contact.company || contact.last_name))}"></label>
      <label class="field">Montant HT (€)<input id="md-amount" type="number" min="0" step="50"></label>
      <label class="field">Statut<select id="md-status"><option value="devis_envoye">📤 Envoyé</option><option value="brouillon">📝 Brouillon</option></select></label>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="primary" id="md-go">Créer</button></div>`);
  $('#md-go', m).onclick = async () => {
    try {
      const res = await api('/deals', { method: 'POST', body: { contact_id: contact.id, title: $('#md-title', m).value, amount: Number($('#md-amount', m).value) || 0, status: $('#md-status', m).value } });
      m.remove();
      await celebrate(res.celebration);
      if (after) after();
    } catch (e) { fx.error(e.message); }
  };
}

// ================================================================ RÉPONSES (inbox + templates)
async function vInbox(view) {
  const { requests } = await api('/inbox');
  const tpls = await getTemplates(true);
  const { contacts } = await api('/contacts?limit=300');

  view.innerHTML = `
    <div class="view-header"><h1>📥 Réponses aux demandes</h1><div class="sub">Colle une demande entrante (mail, DM, formulaire), l'app rédige la réponse. +15 XP par demande traitée.</div></div>
    <div class="card">
      <h3>➕ Nouvelle demande reçue</h3>
      <textarea id="i-content" rows="3" placeholder="Colle ici le message reçu…"></textarea>
      <div class="row" style="margin-top:8px">
        <select id="i-contact"><option value="">🔍 Lier à un contact (optionnel)</option>${contacts.map((c) => `<option value="${c.id}">${esc(c.first_name)} ${esc(c.last_name)} — ${esc(c.company || '')}</option>`).join('')}</select>
        <select id="i-source"><option>email</option><option>instagram</option><option>linkedin</option><option>site web</option><option>téléphone</option></select>
        <button class="primary" id="i-add">Ajouter</button>
      </div>
    </div>
    <div class="grid" style="margin-top:14px">
      ${requests.length === 0 ? '<div class="card"><p class="muted">Aucune demande en attente. C’est le moment d’aller en provoquer → <a href="#/chasse">Mode Chasse</a> 😏</p></div>' : ''}
      ${requests.map((r) => `
        <div class="card" data-req="${r.id}">
          <div class="spread">
            <div>
              <b>${r.status === 'nouveau' ? '🆕' : '✅'} ${esc(r.source)}</b>
              ${r.contact_id ? `<span class="muted">· ${esc(r.first_name || '')} ${esc(r.last_name || '')} (${esc(r.company || '')})</span>` : '<span class="faint">· non lié</span>'}
              <span class="faint small">· ${fmtDateTime(r.created_at)}</span>
            </div>
            <button class="ghost" data-del-req="${r.id}">🗑</button>
          </div>
          <p style="white-space:pre-wrap;background:var(--bg2);border-radius:9px;padding:10px 12px;font-size:13.5px">${esc(r.content)}</p>
          ${r.status === 'nouveau' ? `
            <div class="row">
              <button data-gen-req="${r.id}">✨ Générer la réponse</button>
            </div>
            <textarea data-reply-req="${r.id}" rows="6" placeholder="La réponse apparaîtra ici…" style="margin-top:8px">${esc(r.reply || '')}</textarea>
            <div class="row" style="margin-top:8px">
              <button data-copy-req="${r.id}">📋 Copier</button>
              <button class="gold" data-done-req="${r.id}">✅ Marquer répondu (+15 XP)</button>
            </div>` : `<p class="muted small">✅ Répondu.</p>`}
        </div>`).join('')}
    </div>

    <div class="card" style="margin-top:20px">
      <div class="spread"><h2>📝 Templates de messages</h2><button id="t-new">➕ Nouveau template</button></div>
      <div class="table-scroll"><table class="list">
        <thead><tr><th>Nom</th><th>Typologie</th><th>Canal</th><th></th></tr></thead>
        <tbody>${tpls.map((t) => `<tr>
          <td class="t-name">${esc(t.name)}</td>
          <td>${t.segment ? segChip(t.segment) : '<span class="faint">tous</span>'}</td>
          <td>${esc(t.channel)}</td>
          <td class="row" style="justify-content:flex-end"><button class="ghost" data-edit-tpl="${t.id}">✏️</button>${t.builtin ? '' : `<button class="ghost" data-del-tpl="${t.id}">🗑</button>`}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small">Variables : {prenom} {nom} {entreprise} {poste} {ville} {moi} {ma_boite} {signature}</p>
    </div>`;

  $('#i-add').onclick = async () => {
    const content = $('#i-content').value.trim();
    if (!content) return;
    await api('/inbox', { method: 'POST', body: { content, contact_id: Number($('#i-contact').value) || null, source: $('#i-source').value } });
    vInbox(view);
  };
  $$('[data-del-req]', view).forEach((b) => { b.onclick = async () => { await api(`/inbox/${b.dataset.delReq}`, { method: 'DELETE' }); vInbox(view); }; });
  $$('[data-gen-req]', view).forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.genReq;
      const req = requests.find((r) => String(r.id) === id);
      b.disabled = true; b.textContent = '✨ Rédaction…';
      try {
        const d = await api('/ai/draft', { method: 'POST', body: { contact_id: req.contact_id, purpose: 'reponse_demande', incoming_text: req.content } });
        $(`[data-reply-req="${id}"]`, view).value = (d.subject ? `OBJET : ${d.subject}\n\n` : '') + d.body;
        fx.toast(d.source === 'claude' ? '✨ Réponse rédigée par l’IA' : '📄 Template appliqué (ajoute une clé IA dans Réglages pour du sur-mesure)');
      } catch (e) { fx.error(e.message); }
      b.disabled = false; b.textContent = '✨ Générer la réponse';
    };
  });
  $$('[data-copy-req]', view).forEach((b) => { b.onclick = async () => { await copyText($(`[data-reply-req="${b.dataset.copyReq}"]`, view).value); fx.toast('📋 Copié'); }; });
  $$('[data-done-req]', view).forEach((b) => {
    b.onclick = async () => {
      try {
        const res = await api(`/inbox/${b.dataset.doneReq}`, { method: 'PATCH', body: { reply: $(`[data-reply-req="${b.dataset.doneReq}"]`, view).value, status: 'repondu' } });
        await celebrate(res.celebration);
        vInbox(view);
      } catch (e) { fx.error(e.message); }
    };
  });

  const tplModal = (t) => {
    const m = modal(`
      <h2>${t ? '✏️ Modifier' : '➕ Nouveau'} template</h2>
      <div class="form-grid" style="margin-top:10px">
        <label class="field wide">Nom<input id="tp-name" value="${esc(t ? t.name : '')}"></label>
        <label class="field">Typologie<select id="tp-seg"><option value="">Tous</option>${Object.entries(S.segments).filter(([k]) => k !== 'inconnu').map(([k, s]) => `<option value="${k}" ${t && t.segment === k ? 'selected' : ''}>${s.emoji} ${esc(s.label)}</option>`).join('')}</select></label>
        <label class="field">Canal<select id="tp-chan">${['email', 'linkedin', 'autre'].map((ch) => `<option ${t && t.channel === ch ? 'selected' : ''}>${ch}</option>`).join('')}</select></label>
        <label class="field wide">Objet (emails)<input id="tp-subj" value="${esc(t ? t.subject : '')}"></label>
        <label class="field wide"><span>Corps</span><textarea id="tp-body" rows="10">${esc(t ? t.body : '')}</textarea></label>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="primary" id="tp-save">💾 Enregistrer</button></div>`);
    $('#tp-save', m).onclick = async () => {
      const body = { name: $('#tp-name', m).value, segment: $('#tp-seg', m).value, channel: $('#tp-chan', m).value, subject: $('#tp-subj', m).value, body: $('#tp-body', m).value };
      try {
        if (t) await api(`/templates/${t.id}`, { method: 'PATCH', body });
        else await api('/templates', { method: 'POST', body });
        m.remove(); await getTemplates(true); vInbox(view);
      } catch (e) { fx.error(e.message); }
    };
  };
  $('#t-new').onclick = () => tplModal(null);
  $$('[data-edit-tpl]', view).forEach((b) => { b.onclick = () => tplModal(tpls.find((t) => String(t.id) === b.dataset.editTpl)); });
  $$('[data-del-tpl]', view).forEach((b) => { b.onclick = async () => { if (confirm('Supprimer ce template ?')) { await api(`/templates/${b.dataset.delTpl}`, { method: 'DELETE' }); await getTemplates(true); vInbox(view); } }; });
}

// ================================================================ 🤖 AUTOPILOTE
const OUTBOX_STATUS = { awaiting_review: '👀 à valider', queued: '⏱️ planifié', sent: '✅ envoyé', failed: '⚠️ échec', cancelled: '✖ annulé' };
const ENROLL_STATUS = { active: '🟢 en cours', paused: '⏸️ en pause', replied: '💬 A RÉPONDU', finished: '🏁 terminée', stopped: '⏹️ stoppée', bounced: '📛 bounce' };

async function vAutopilot(view) {
  await refreshState();
  const ap = S.autopilot;
  const { sequences } = await api('/sequences');
  const { items: awaiting } = await api('/outbox?status=awaiting_review');
  const { items: queuedItems } = await api('/outbox?status=queued');
  const { items: recent } = await api('/outbox');
  const { enrollments } = await api('/enrollments');
  const tpls = await getTemplates();

  const notConfigured = !ap.configured ? `
    <div class="card" style="border-color:rgba(234,179,8,.5)">
      <h2>🔌 Branche ton Gmail (2 minutes)</h2>
      <ol>
        <li>Active la <b>validation en 2 étapes</b> sur ton compte Google (si pas déjà fait) ;</li>
        <li>Va sur <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a> → crée un mot de passe d'application « La Chasse » ;</li>
        <li>Colle-le dans <a href="#/reglages">Réglages → Gmail</a> avec ton adresse, puis teste SMTP + IMAP.</li>
      </ol>
      <p class="muted small">L'autopilote enverra depuis TON adresse Gmail (réponses naturelles, délivrabilité maximale), gardera chaque relance dans le même fil, et lira ta boîte pour détecter les réponses — jamais les contenus, seulement les en-têtes.</p>
    </div>` : '';

  view.innerHTML = `
    <div class="view-header spread">
      <div><h1>🤖 Autopilote</h1><div class="sub">La machine prospecte, toi tu prends les calls. Une réponse = séquence stoppée + tâche « proposer un RDV ».</div></div>
      <div class="row">
        <button id="ap-tick" ${ap.configured ? '' : 'disabled'}>▶️ Exécuter maintenant</button>
      </div>
    </div>
    ${notConfigured}
    <div class="card">
      <div class="row" style="gap:22px">
        <label class="chip" style="cursor:pointer;font-size:14px;padding:8px 14px">
          <input type="checkbox" id="ap-enabled" ${ap.enabled ? 'checked' : ''} ${ap.configured ? '' : 'disabled'}>
          ${ap.enabled ? '🟢 Autopilote ACTIF' : '⚪ Autopilote en veille'}
        </label>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px">Mode
          <select id="ap-mode">
            <option value="review" ${ap.mode === 'review' ? 'selected' : ''}>👀 Revue — je valide chaque email</option>
            <option value="auto" ${ap.mode === 'auto' ? 'selected' : ''}>🚀 Auto — envoi sans validation</option>
          </select>
        </label>
        <div class="muted small">📤 <b>${ap.sent_today}</b>/${ap.daily_cap} envoyés aujourd'hui · 🕘 fenêtre ${ap.window} · 👥 <b>${ap.active_enrollments}</b> en séquence · 💬 <b>${ap.replies_today}</b> réponse(s) auto détectée(s) aujourd'hui</div>
      </div>
    </div>

    ${awaiting.length ? `
    <div class="card" style="margin-top:14px;border-color:rgba(234,179,8,.45)">
      <div class="spread"><h2>👀 À valider (${awaiting.length})</h2><button class="gold" id="ap-approve-all">✅ Tout approuver</button></div>
      ${awaiting.map((o) => `
        <div class="deal-line" style="flex-direction:column;align-items:stretch" data-ob="${o.id}">
          <div class="spread">
            <div><b>${esc(o.first_name || '')} ${esc(o.last_name || '')}</b> <span class="muted">&lt;${esc(o.to_email)}&gt; · ${esc(o.seq_name || '')} · étape ${o.step_index + 1}</span></div>
            <div class="row">
              <button class="primary" data-ob-approve="${o.id}">✅ Approuver</button>
              <button class="ghost" data-ob-cancel="${o.id}">✖</button>
            </div>
          </div>
          <input data-ob-subject="${o.id}" value="${esc(o.subject)}" style="margin:6px 0">
          <textarea data-ob-body="${o.id}" rows="5">${esc(o.body)}</textarea>
        </div>`).join('')}
    </div>` : ''}

    ${queuedItems.length ? `
    <div class="card" style="margin-top:14px">
      <h2>⏱️ Départ imminent (${queuedItems.length})</h2>
      ${queuedItems.map((o) => `<div class="small" style="padding:4px 0">📨 ${esc(o.first_name || '')} ${esc(o.last_name || '')} — « ${esc(o.subject)} » · ${o.scheduled_at ? new Date(o.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'dès que possible'} <button class="ghost" data-ob-cancel="${o.id}" style="padding:2px 8px">✖</button></div>`).join('')}
    </div>` : ''}

    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:14px;align-items:start">
      <div class="card">
        <div class="spread"><h2>🧬 Séquences</h2><button id="seq-new">➕ Créer</button></div>
        ${sequences.map((s) => `
          <div class="deal-line" style="flex-direction:column;align-items:stretch">
            <div class="spread">
              <div>
                <b>${esc(s.name)}</b> ${s.active ? '' : '<span class="chip">⏸️ inactive</span>'}
                ${s.segment ? segChip(s.segment) : ''}
                <div class="muted small">${s.steps.map((st, i) => `${i === 0 ? 'J0' : 'J+' + s.steps.slice(1, i + 1).reduce((a, x) => a + x.delay_days, 0)} ${esc((tpls.find((t) => t.code === st.template_code) || { name: st.template_code }).name.replace(/^[^ ]+ /, ''))}`).join(' → ')}</div>
                <div class="small">🟢 ${s.active_count} en cours · 💬 ${s.replied_count} réponses · 🏁 ${s.finished_count} terminées</div>
              </div>
              <div class="row">
                <button class="primary" data-seq-enroll="${s.id}">👥 Enrôler</button>
                <button class="ghost" data-seq-edit="${s.id}">✏️</button>
              </div>
            </div>
          </div>`).join('')}
        <p class="muted small">💡 Commence par « 🔮 Réactivation anciens clients » : importe Pennylane, enrôle tous tes anciens clients, active l'autopilote.</p>
      </div>
      <div class="card">
        <h2>👥 En séquence (${enrollments.length})</h2>
        <div class="table-scroll"><table class="list">
          <thead><tr><th>Contact</th><th>Séquence</th><th>Étape</th><th>Prochain envoi</th><th>Statut</th><th></th></tr></thead>
          <tbody>${enrollments.slice(0, 60).map((e) => `<tr>
            <td class="t-name">${esc(e.first_name)} ${esc(e.last_name)}<div class="t-sub">${esc(e.company || e.email)}</div></td>
            <td class="small">${esc(e.seq_name)}</td>
            <td class="mono">${Math.min(e.current_step + 1, e.total_steps)}/${e.total_steps}</td>
            <td class="small">${e.status === 'active' ? (e.next_send_at ? dueLabel(e.next_send_at) : '—') : '—'}</td>
            <td class="small">${ENROLL_STATUS[e.status] || esc(e.status)}${e.stop_reason ? `<div class="faint">${esc(e.stop_reason)}</div>` : ''}</td>
            <td class="row" style="justify-content:flex-end">
              ${e.status === 'active' ? `<button class="ghost" data-en-pause="${e.id}" title="Pause">⏸️</button>` : ''}
              ${['paused', 'stopped'].includes(e.status) ? `<button class="ghost" data-en-resume="${e.id}" title="Reprendre">▶️</button>` : ''}
              ${['active', 'paused'].includes(e.status) ? `<button class="ghost" data-en-stop="${e.id}" title="Stopper">⏹️</button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${enrollments.length === 0 ? '<p class="muted small">Personne en séquence. Clique « 👥 Enrôler » sur une séquence, ou sélectionne des contacts dans la vue Contacts.</p>' : ''}
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <h2>📜 Journal d'envoi</h2>
      ${recent.filter((o) => ['sent', 'failed', 'cancelled'].includes(o.status)).slice(0, 15).map((o) => `
        <div class="small" style="padding:3px 0">${OUTBOX_STATUS[o.status]} · ${esc(o.first_name || '')} ${esc(o.last_name || '')} — « ${esc(o.subject)} » ${o.sent_at ? '· ' + fmtDateTime(o.sent_at) : ''}${o.error ? ` <span style="color:var(--red2)">${esc(o.error.slice(0, 90))}</span>` : ''}</div>`).join('') || '<p class="muted small">Rien envoyé pour l’instant.</p>'}
    </div>`;

  // --- interrupteurs
  $('#ap-enabled').onchange = async (e) => {
    await api('/settings', { method: 'PUT', body: { autopilot_enabled: e.target.checked ? '1' : '0' } });
    fx.toast(e.target.checked ? '🟢 Autopilote activé — il tourne toutes les 10 min' : '⚪ Autopilote en veille');
    fx.play('pop');
    vAutopilot(view);
  };
  $('#ap-mode').onchange = async (e) => {
    await api('/settings', { method: 'PUT', body: { autopilot_mode: e.target.value } });
    fx.toast(e.target.value === 'auto' ? '🚀 Mode AUTO : les emails partent sans validation' : '👀 Mode revue : chaque email attend ton feu vert');
    vAutopilot(view);
  };
  $('#ap-tick').onclick = async () => {
    const btn = $('#ap-tick'); btn.disabled = true; btn.textContent = '▶️ …';
    try {
      const r = await api('/autopilot/tick', { method: 'POST', body: { ignore_window: true } });
      const bits = [];
      if (r.replies && r.replies.replies) bits.push(`💬 ${r.replies.replies} réponse(s) détectée(s)`);
      if (r.due && r.due.queued) bits.push(`📝 ${r.due.queued} email(s) préparé(s)`);
      if (r.flush && r.flush.sent) bits.push(`📤 ${r.flush.sent} envoyé(s)`);
      if (r.due && r.due.reason) bits.push(r.due.reason);
      if (r.replies_error) fx.error(r.replies_error);
      if (r.flush_error) fx.error(r.flush_error);
      fx.toast(bits.length ? bits.join(' · ') : 'Rien à faire pour le moment ✅');
      await celebrate({});
      vAutopilot(view);
    } catch (e) { fx.error(e.message); btn.disabled = false; btn.textContent = '▶️ Exécuter maintenant'; }
  };

  // --- file d'envoi
  const approveOne = async (id) => {
    const subject = $(`[data-ob-subject="${id}"]`, view);
    const body = $(`[data-ob-body="${id}"]`, view);
    if (subject && body) await api(`/outbox/${id}`, { method: 'PATCH', body: { subject: subject.value, body: body.value } });
    await api(`/outbox/${id}/approve`, { method: 'POST' });
  };
  const apAll = $('#ap-approve-all');
  if (apAll) apAll.onclick = async () => {
    try {
      for (const o of awaiting) await approveOne(o.id);
      fx.toast(`✅ ${awaiting.length} email(s) approuvé(s) — envoi dans les minutes qui viennent`);
      fx.play('quest');
      vAutopilot(view);
    } catch (e) { fx.error(e.message); }
  };
  $$('[data-ob-approve]', view).forEach((b) => {
    b.onclick = async () => { try { await approveOne(Number(b.dataset.obApprove)); fx.toast('✅ Approuvé'); vAutopilot(view); } catch (e) { fx.error(e.message); } };
  });
  $$('[data-ob-cancel]', view).forEach((b) => {
    b.onclick = async () => { try { await api(`/outbox/${b.dataset.obCancel}/cancel`, { method: 'POST' }); fx.toast('✖ Annulé (séquence en pause)'); vAutopilot(view); } catch (e) { fx.error(e.message); } };
  });

  // --- enrôlements
  $$('[data-en-pause]', view).forEach((b) => { b.onclick = async () => { await api(`/enrollments/${b.dataset.enPause}`, { method: 'PATCH', body: { status: 'paused' } }); vAutopilot(view); }; });
  $$('[data-en-resume]', view).forEach((b) => { b.onclick = async () => { await api(`/enrollments/${b.dataset.enResume}`, { method: 'PATCH', body: { status: 'active' } }); fx.toast('▶️ Séquence reprise'); vAutopilot(view); }; });
  $$('[data-en-stop]', view).forEach((b) => { b.onclick = async () => { await api(`/enrollments/${b.dataset.enStop}`, { method: 'PATCH', body: { status: 'stopped' } }); vAutopilot(view); }; });

  // --- séquences
  $('#seq-new').onclick = () => seqEditModal(null, tpls, () => vAutopilot(view));
  $$('[data-seq-edit]', view).forEach((b) => { b.onclick = () => seqEditModal(sequences.find((s) => String(s.id) === b.dataset.seqEdit), tpls, () => vAutopilot(view)); });
  $$('[data-seq-enroll]', view).forEach((b) => {
    b.onclick = () => enrollPickerModal(sequences.find((s) => String(s.id) === b.dataset.seqEnroll), () => vAutopilot(view));
  });
}

// Choisir des contacts à enrôler dans une séquence donnée.
async function enrollPickerModal(seq, after) {
  const { contacts } = await api('/contacts?limit=500');
  const eligible = contacts.filter((c) => c.email && !['gagne', 'perdu'].includes(c.stage));
  const m = modal(`
    <h2>👥 Enrôler dans « ${esc(seq.name)} »</h2>
    <p class="muted small">Seuls les contacts AVEC email sont listés (enrichis les autres via FullEnrich). Un contact = une séquence à la fois. Premier email : dès le prochain passage de l'autopilote.</p>
    <div class="row" style="margin:8px 0">
      <input type="search" id="ep-search" placeholder="🔍 filtrer…" style="flex:1">
      <label class="chip" style="cursor:pointer"><input type="checkbox" id="ep-former"> 💰 anciens clients</label>
      <label class="chip" style="cursor:pointer"><input type="checkbox" id="ep-all"> tout cocher</label>
    </div>
    <div id="ep-list" style="max-height:320px;overflow-y:auto"></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="primary big" id="ep-go">🤖 Enrôler la sélection</button></div>`);

  const checked = new Set();
  const renderList = () => {
    const q = $('#ep-search', m).value.toLowerCase();
    const former = $('#ep-former', m).checked;
    const list = eligible.filter((c) => (!former || c.is_former_client) &&
      (!q || `${c.first_name} ${c.last_name} ${c.company} ${c.email}`.toLowerCase().includes(q)));
    $('#ep-list', m).innerHTML = list.map((c) => `
      <label class="row" style="padding:5px 6px;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" data-ep="${c.id}" ${checked.has(c.id) ? 'checked' : ''}>
        <b>${esc(c.first_name)} ${esc(c.last_name)}</b> ${c.is_former_client ? '💰' : ''}
        <span class="muted small">${esc(c.company || '')} · ${esc(c.email)}</span>
        ${segChip(c.segment)}
      </label>`).join('') || '<p class="muted small">Aucun contact éligible avec ces filtres.</p>';
    $$('[data-ep]', m).forEach((cb) => { cb.onchange = () => { cb.checked ? checked.add(Number(cb.dataset.ep)) : checked.delete(Number(cb.dataset.ep)); syncGo(); }; });
    return list;
  };
  const syncGo = () => { $('#ep-go', m).textContent = `🤖 Enrôler ${checked.size || 'la sélection'}`; };
  $('#ep-search', m).oninput = renderList;
  $('#ep-former', m).onchange = renderList;
  $('#ep-all', m).onchange = (e) => { const list = renderList(); list.forEach((c) => e.target.checked ? checked.add(c.id) : checked.delete(c.id)); renderList(); syncGo(); };
  renderList();

  $('#ep-go', m).onclick = async () => {
    if (!checked.size) { fx.error('Coche au moins un contact.'); return; }
    try {
      const r = await api(`/sequences/${seq.id}/enroll`, { method: 'POST', body: { contact_ids: [...checked] } });
      m.remove();
      fx.toast(`🤖 ${r.enrolled} enrôlé(s) dans « ${esc(seq.name)} »${r.skipped.length ? ` · ${r.skipped.length} ignoré(s)` : ''}`);
      fx.play('quest');
      if (r.skipped.length) fx.toast(`Ignorés : ${r.skipped.slice(0, 3).map((s) => s.reason).join(', ')}${r.skipped.length > 3 ? '…' : ''}`, '', 5000);
      if (after) after();
    } catch (e) { fx.error(e.message); }
  };
}

// Choisir une séquence pour des contacts déjà sélectionnés (vue Contacts).
async function sequencePickerModal(contactIds, after) {
  const { sequences } = await api('/sequences');
  const m = modal(`
    <h2>🤖 Enrôler ${contactIds.length} contact(s)</h2>
    <div class="grid" style="margin-top:10px">
      ${sequences.filter((s) => s.active).map((s) => `
        <button data-pick-seq="${s.id}" style="justify-content:flex-start;text-align:left">
          <div><b>${esc(s.name)}</b><div class="muted small">${esc(s.description || '')} · ${s.steps.length} étapes</div></div>
        </button>`).join('')}
    </div>`);
  $$('[data-pick-seq]', m).forEach((b) => {
    b.onclick = async () => {
      try {
        const r = await api(`/sequences/${b.dataset.pickSeq}/enroll`, { method: 'POST', body: { contact_ids: contactIds } });
        m.remove();
        fx.toast(`🤖 ${r.enrolled} enrôlé(s)${r.skipped.length ? ` · ${r.skipped.length} ignoré(s) (${r.skipped.slice(0, 2).map((s) => s.reason).join(', ')}…)` : ''}`, '', 5000);
        fx.play('quest');
        if (after) after();
      } catch (e) { fx.error(e.message); }
    };
  });
}

// Éditeur de séquence (étapes : délai + template).
function seqEditModal(seq, tpls, after) {
  const steps = seq ? seq.steps.map((s) => ({ delay_days: s.delay_days, template_code: s.template_code })) : [{ delay_days: 0, template_code: 'pme_first' }];
  const stepRow = (s, i) => `
    <div class="row" data-step-row style="margin-bottom:6px">
      <span class="chip">${i === 0 ? 'J0' : '⏳ +'}</span>
      ${i === 0 ? '' : `<input type="number" class="st-delay" value="${s.delay_days}" min="1" style="width:70px" title="jours après l'étape précédente"> j puis`}
      <select class="st-tpl" style="flex:1">${tpls.map((t) => `<option value="${t.code}" ${t.code === s.template_code ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <button class="ghost st-del">🗑</button>
    </div>`;
  const m = modal(`
    <h2>${seq ? '✏️ Modifier' : '➕ Nouvelle'} séquence</h2>
    <div class="form-grid" style="margin:10px 0">
      <label class="field wide">Nom<input id="sq-name" value="${esc(seq ? seq.name : '')}" placeholder="Ex : Relance devis dormants"></label>
      <label class="field">Typologie<select id="sq-seg"><option value="">Toutes</option>${Object.entries(S.segments).filter(([k]) => k !== 'inconnu').map(([k, s]) => `<option value="${k}" ${seq && seq.segment === k ? 'selected' : ''}>${s.emoji} ${esc(s.label)}</option>`).join('')}</select></label>
      <label class="chip" style="cursor:pointer;margin-top:18px"><input type="checkbox" id="sq-active" ${!seq || seq.active ? 'checked' : ''}> séquence active</label>
    </div>
    <h3>Étapes</h3>
    <div id="sq-steps">${steps.map(stepRow).join('')}</div>
    <button class="ghost" id="sq-add">➕ Ajouter une étape</button>
    <div class="row" style="justify-content:space-between;margin-top:14px">
      ${seq && !seq.builtin ? `<button class="danger" id="sq-del">🗑 Supprimer</button>` : '<span></span>'}
      <button class="primary" id="sq-save">💾 Enregistrer</button>
    </div>`);
  const redraw = () => { $$('[data-step-row]', m).forEach((r, i) => { const del = $('.st-del', r); del.onclick = () => { if ($$('[data-step-row]', m).length > 1) { r.remove(); } }; }); };
  redraw();
  $('#sq-add', m).onclick = () => {
    const container = $('#sq-steps', m);
    container.insertAdjacentHTML('beforeend', stepRow({ delay_days: 4, template_code: tpls[0].code }, container.children.length));
    redraw();
  };
  $('#sq-save', m).onclick = async () => {
    const newSteps = $$('[data-step-row]', m).map((r, i) => ({
      delay_days: i === 0 ? 0 : Number(($('.st-delay', r) || { value: 4 }).value) || 1,
      template_code: $('.st-tpl', r).value,
    }));
    const body = { name: $('#sq-name', m).value || 'Séquence', segment: $('#sq-seg', m).value, active: $('#sq-active', m).checked, steps: newSteps };
    try {
      if (seq) await api(`/sequences/${seq.id}`, { method: 'PATCH', body });
      else await api('/sequences', { method: 'POST', body });
      m.remove(); if (after) after();
    } catch (e) { fx.error(e.message); }
  };
  const delBtn = $('#sq-del', m);
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm('Supprimer cette séquence ?')) return;
    try { await api(`/sequences/${seq.id}`, { method: 'DELETE' }); m.remove(); if (after) after(); }
    catch (e) { fx.error(e.message); }
  };
}

// ================================================================ IMPORTS
let csvData = null; // { headers, rows, auto_mapping }

async function vImport(view) {
  const enrichables = await api('/contacts?enrichable=1&limit=1');
  const { jobs } = await api('/fullenrich/jobs');
  const pendingJobs = jobs.filter((j) => j.status === 'pending');

  view.innerHTML = `
    <div class="view-header"><h1>📦 Imports & enrichissement</h1><div class="sub">Remplis ton terrain de chasse : anciens clients Pennylane, listes LinkedIn/Sales Nav, HubSpot.</div></div>
    <div class="grid" style="grid-template-columns:1fr 1fr; align-items:start">
      <div class="card">
        <h2>🧲 CSV (LinkedIn / Sales Navigator / autre)</h2>
        <p class="muted small">Workflow conseillé : recherche <b>Sales Navigator</b> → export via l'extension <b>FullEnrich</b> (ou tout autre outil d'export) → CSV → ici. L'export de tes relations LinkedIn (Réglages LinkedIn → « Obtenir une copie de mes données » → Connections.csv) marche aussi. Les colonnes sont détectées automatiquement, les doublons fusionnés.</p>
        <input type="file" id="csv-file" accept=".csv,text/csv">
        <div id="csv-map"></div>
      </div>
      <div class="grid">
        <div class="card">
          <h2>💶 Pennylane — tes anciens clients</h2>
          <p class="muted small">Importe tous tes clients Pennylane avec leur CA facturé : auto-marqués « ancien client » et segmentés (≥ seuil → Grand Compte). Ce sont tes leads les plus chauds.</p>
          <div class="row"><button id="pl-test">🔌 Tester</button><button class="primary" id="pl-import">📥 Importer les clients</button><span id="pl-status" class="small muted"></span></div>
        </div>
        <div class="card">
          <h2>🟠 HubSpot — CRM hybride</h2>
          <p class="muted small">Import des contacts HubSpot ici, et push des contacts de la Chasse vers HubSpot (bouton ⬆️ sur les fiches / la vue Contacts). La Chasse pilote la prospection, HubSpot reste ta base "officielle".</p>
          <div class="row"><button id="hs-test">🔌 Tester</button><button class="primary" id="hs-import">📥 Importer les contacts</button><span id="hs-status" class="small muted"></span></div>
        </div>
        <div class="card">
          <h2>📧 Gmail — retrouve tes contacts</h2>
          <p class="muted small">Scanne le dossier « Messages envoyés » de ta boîte (en-têtes uniquement, jamais le contenu) pour retrouver toutes les personnes à qui tu as déjà écrit — souvent des clients ou prospects oubliés.</p>
          <div class="row">
            <select id="gm-days"><option value="365">12 derniers mois</option><option value="730" selected>24 derniers mois</option><option value="1825">5 ans</option></select>
            <button class="primary" id="gm-scan">🔍 Scanner ma boîte</button>
          </div>
          <div id="gm-results"></div>
        </div>
        <div class="card">
          <h2>🧪 FullEnrich — emails & téléphones</h2>
          <p class="muted small"><b>${enrichables.total}</b> contact(s) sans email ou téléphone. L'enrichissement (cascade 15+ fournisseurs) consomme des crédits FullEnrich — confirmation avant chaque lancement.</p>
          <div class="row">
            <button class="primary" id="fe-launch" ${enrichables.total === 0 ? 'disabled' : ''}>🧪 Enrichir les contacts incomplets</button>
            ${pendingJobs.length ? `<button id="fe-poll">🔄 Vérifier les résultats (${pendingJobs.length} en cours)</button>` : ''}
          </div>
          ${jobs.length ? `<div style="margin-top:10px">${jobs.slice(0, 5).map((j) => `<div class="small muted">· Job #${j.id} — ${j.status === 'pending' ? '⏳ en cours' : j.status === 'done' ? '✅ terminé' : '⚠️ ' + esc(j.status)} ${j.error ? `<span class="faint">(${esc(j.error.slice(0, 80))})</span>` : ''}</div>`).join('')}</div>` : ''}
        </div>
      </div>
    </div>`;

  // --- CSV
  $('#csv-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      csvData = await api('/import/parse', { method: 'POST', body: { text } });
      renderCsvMap(view);
    } catch (err) { fx.error(err.message); }
  };

  // --- Pennylane
  $('#pl-test').onclick = () => testIntegration('pennylane', $('#pl-status'));
  $('#pl-import').onclick = async () => {
    const el = $('#pl-status'); el.textContent = '⏳ Import en cours…';
    try {
      const r = await api('/pennylane/import', { method: 'POST' });
      el.textContent = `✅ ${r.created} nouveaux, ${r.merged} fusionnés (${r.total} clients Pennylane)`;
      if (r.invoices_error) fx.toast('⚠️ CA non récupéré : ' + r.invoices_error, 'err', 6000);
      await refreshState();
    } catch (e) { el.textContent = ''; fx.error(e.message); }
  };

  // --- HubSpot
  $('#hs-test').onclick = () => testIntegration('hubspot', $('#hs-status'));
  $('#hs-import').onclick = async () => {
    const el = $('#hs-status'); el.textContent = '⏳ Import en cours…';
    try {
      const r = await api('/hubspot/import', { method: 'POST' });
      el.textContent = `✅ ${r.created} nouveaux, ${r.merged} fusionnés (${r.total} contacts HubSpot)`;
      await refreshState();
    } catch (e) { el.textContent = ''; fx.error(e.message); }
  };

  // --- scan Gmail
  $('#gm-scan').onclick = async () => {
    const btn = $('#gm-scan'); btn.disabled = true; btn.textContent = '🔍 Scan en cours…';
    try {
      const { found } = await api('/mail/scan', { method: 'POST', body: { days: Number($('#gm-days').value) } });
      const news = found.filter((f) => !f.existing_id);
      $('#gm-results').innerHTML = `
        <p style="margin-top:10px"><b>${found.length}</b> correspondant(s) trouvés — <b>${news.length}</b> pas encore dans le CRM :</p>
        <div style="max-height:260px;overflow-y:auto">
          ${found.slice(0, 200).map((f, i) => `
            <label class="row small" style="padding:3px 4px;border-bottom:1px solid var(--border);cursor:pointer">
              <input type="checkbox" data-gm="${i}" ${f.existing_id ? '' : 'checked'}>
              <b>${esc(f.name || f.email.split('@')[0])}</b>
              <span class="muted">${esc(f.email)} · ${f.count} email(s) · dernier ${String(f.last_date).slice(0, 10)}</span>
              ${f.existing_id ? '<span class="chip ok">déjà dans le CRM</span>' : ''}
            </label>`).join('')}
        </div>
        <button class="primary" id="gm-import" style="margin-top:8px">📥 Importer la sélection</button>`;
      $('#gm-import').onclick = async () => {
        const entries = [...view.querySelectorAll('[data-gm]:checked')].map((cb) => found[Number(cb.dataset.gm)]);
        if (!entries.length) { fx.error('Coche au moins un correspondant.'); return; }
        const r = await api('/mail/scan_import', { method: 'POST', body: { entries } });
        fx.toast(`📥 Gmail : ${r.created} créés, ${r.merged} fusionnés`);
        fx.xp(Math.min(r.created, 50));
        await refreshState();
        vImport(view);
      };
    } catch (e) { fx.error(e.message); }
    btn.disabled = false; btn.textContent = '🔍 Scanner ma boîte';
  };

  // --- FullEnrich
  $('#fe-launch').onclick = async () => {
    const { contacts } = await api('/contacts?enrichable=1&limit=100');
    launchEnrich(contacts.map((c) => c.id), () => vImport(view));
  };
  const pollBtn = $('#fe-poll');
  const doPoll = async (silent = false) => {
    try {
      const { results } = await api('/fullenrich/poll', { method: 'POST' });
      const done = results.filter((r) => r.status === 'FINISHED');
      if (done.length) {
        fx.toast(`🧪 Enrichissement terminé : ${done.reduce((s, r) => s + r.enriched, 0)} contact(s) complété(s) !`);
        fx.play('quest');
        vImport(view);
      } else if (!silent) fx.toast('⏳ Toujours en cours — FullEnrich prend quelques minutes.');
    } catch (e) { if (!silent) fx.error(e.message); }
  };
  if (pollBtn) pollBtn.onclick = () => doPoll(false);
  if (pendingJobs.length) pollTimer = setInterval(() => doPoll(true), 30000);
}

function renderCsvMap(view) {
  const FIELDS = [
    ['first_name', 'Prénom'], ['last_name', 'Nom'], ['email', 'Email'], ['phone', 'Téléphone'],
    ['company', 'Entreprise'], ['job_title', 'Poste'], ['linkedin_url', 'URL LinkedIn'],
    ['domain', 'Site web'], ['city', 'Ville'], ['notes', 'Notes'],
  ];
  const d = csvData;
  $('#csv-map').innerHTML = `
    <div style="margin-top:12px">
      <p><b>${d.total}</b> ligne(s) détectée(s) (séparateur « ${d.delimiter === '\t' ? 'tab' : d.delimiter} »). Vérifie le mapping :</p>
      <div class="form-grid">
        ${FIELDS.map(([f, label]) => `<label class="field">${label}
          <select data-map="${f}"><option value="">— ignorer —</option>${d.headers.map((h, i) => `<option value="${i}" ${d.auto_mapping[f] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>
        </label>`).join('')}
      </div>
      <div class="row" style="margin-top:10px">
        <label class="field">Typologie par défaut<select id="csv-seg">${Object.entries(S.segments).map(([k, s]) => `<option value="${k}" ${k === 'inconnu' ? 'selected' : ''}>${s.emoji} ${esc(s.label)}</option>`).join('')}</select></label>
        <label class="field">Origine<select id="csv-origin"><option>linkedin</option><option>csv</option></select></label>
        <label class="chip" style="cursor:pointer;margin-top:14px"><input type="checkbox" id="csv-former"> 💰 anciens clients</label>
        <button class="primary big" id="csv-go" style="margin-top:8px">📥 Importer ${d.total} contacts</button>
      </div>
      <div id="csv-report" class="muted small" style="margin-top:8px"></div>
    </div>`;

  $('#csv-go').onclick = async () => {
    const mapping = {};
    $$('[data-map]', view).forEach((s) => { if (s.value !== '') mapping[s.dataset.map] = Number(s.value); });
    if (mapping.first_name === undefined && mapping.last_name === undefined && mapping.email === undefined && mapping.company === undefined) {
      fx.error('Mappe au moins Prénom/Nom, Email ou Entreprise.'); return;
    }
    const rows = d.rows.map((r) => {
      const o = {};
      for (const [f, i] of Object.entries(mapping)) o[f] = r[i] || '';
      return o;
    });
    const btn = $('#csv-go'); btn.disabled = true; btn.textContent = '📥 Import…';
    try {
      let created = 0, merged = 0, skipped = 0, celebration = null;
      for (let i = 0; i < rows.length; i += 500) {
        const r = await api('/import/csv', { method: 'POST', body: {
          rows: rows.slice(i, i + 500),
          origin: $('#csv-origin').value,
          default_segment: $('#csv-seg').value,
          as_former: $('#csv-former').checked,
        } });
        created += r.created; merged += r.merged; skipped += r.skipped;
        celebration = r.celebration || celebration;
      }
      $('#csv-report').innerHTML = `✅ <b>${created}</b> créés · <b>${merged}</b> fusionnés (doublons) · ${skipped} ignorés`;
      fx.xp(Math.min(created, 50));
      if (celebration) await celebrate({ ...celebration, xp_gained: 0 });
      await refreshState();
      csvData = null;
    } catch (e) { fx.error(e.message); }
    btn.disabled = false; btn.textContent = '📥 Importer';
  };
}

async function testIntegration(name, statusEl) {
  statusEl.textContent = '⏳…';
  try {
    const r = await api(`/${name}/test`);
    statusEl.textContent = '✅ ' + (r.message || 'OK');
  } catch (e) {
    statusEl.textContent = '';
    fx.error(e.message);
  }
}

// ================================================================ RÉGLAGES
async function vReglages(view) {
  const { settings: s } = await api('/settings');
  view.innerHTML = `
    <div class="view-header"><h1>⚙️ Réglages</h1><div class="sub">Tout reste en local sur ta machine (data/prospection.db).</div></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;align-items:start">
      <div class="grid">
        <div class="card">
          <h2>👤 Identité</h2>
          <div class="form-grid">
            <label class="field">Ton prénom<input id="s-user" value="${esc(s.user_name)}"></label>
            <label class="field">Ta boîte<input id="s-company" value="${esc(s.company_name)}"></label>
            <label class="field wide">Signature (fin des messages)<input id="s-sig" value="${esc(s.user_signature)}"></label>
          </div>
        </div>
        <div class="card">
          <h2>🎯 Objectif & jeu</h2>
          <div class="form-grid">
            <label class="field">Objectif factures (boss)<input id="s-goal" type="number" min="1" value="${esc(s.objectif_factures)}"></label>
            <label class="field">Seuil Grand Compte (€ CA)<input id="s-seuil" type="number" min="0" value="${esc(s.seuil_grand_compte)}"></label>
          </div>
          <p class="muted small">Le boss tombe quand tu marques « facturé » ce nombre de deals. Les sons se coupent avec 🔊 en bas de la barre latérale.</p>
        </div>
        <div class="card">
          <h2>🎮 Démo & données</h2>
          <div class="row">
            <button id="s-demo">🎮 Recharger la démo</button>
            <a href="/api/export.csv" download><button>📤 Exporter mes contacts (CSV)</button></a>
          </div>
          <p class="muted small">Pour tout remettre à zéro : <code>npm run reset</code> (ou supprime data/prospection.db).</p>
        </div>
      </div>
      <div class="grid">
      <div class="card">
        <h2>📧 Gmail & Autopilote</h2>
        <p class="muted small">L'autopilote envoie depuis TON Gmail et lit les en-têtes de ta boîte pour détecter les réponses. Crée un <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">mot de passe d'application</a> (nécessite la validation en 2 étapes).</p>
        <div class="form-grid">
          <label class="field">Adresse Gmail<input id="s-gmail" value="${esc(s.gmail_user)}" placeholder="toi@gmail.com"></label>
          <label class="field">Mot de passe d'application<input id="s-gmailpw" type="password" value="${esc(s.gmail_app_password)}"></label>
          <label class="field">Cap d'envoi / jour<input id="s-cap" type="number" min="1" max="100" value="${esc(s.autopilot_daily_cap)}"></label>
          <label class="field">Fenêtre d'envoi<div class="row"><input id="s-ws" type="number" min="0" max="23" value="${esc(s.autopilot_window_start)}" style="width:64px">h → <input id="s-we" type="number" min="1" max="24" value="${esc(s.autopilot_window_end)}" style="width:64px">h</div></label>
          <label class="field wide">Lien de RDV (Calendly, Google…) — variable {lien_rdv}<input id="s-booking" value="${esc(s.booking_url)}" placeholder="https://calendly.com/…"></label>
          <label class="chip wide" style="cursor:pointer"><input type="checkbox" id="s-weekdays" ${s.autopilot_weekdays_only !== '0' ? 'checked' : ''}> envoyer uniquement en jours ouvrés</label>
        </div>
        <div class="row" style="margin-top:10px">
          <button data-mailtest="test_smtp">🔌 Tester SMTP</button>
          <button data-mailtest="test_imap">🔌 Tester IMAP</button>
          <button data-mailtest="send_test" class="gold">📤 M'envoyer un email de test</button>
        </div>
        <p class="small" id="t-mail"></p>
        <p class="muted small">💡 Enregistre les réglages avant de tester. Démarre avec un cap bas (10-15/jour) puis monte progressivement : c'est la meilleure protection de ta délivrabilité.</p>
      </div>
      <div class="card">
        <h2>🔑 Clés API</h2>
        <p class="muted small">Chaque clé est stockée en local. Les champs affichent « •••• » quand une clé est déjà enregistrée : ne les modifie que pour la remplacer.</p>
        <label class="field" style="margin-bottom:10px">💶 Pennylane — <a href="https://app.pennylane.com" target="_blank" rel="noopener">app.pennylane.com</a> → Paramètres → API
          <div class="row"><input id="s-pl" type="password" value="${esc(s.pennylane_api_key)}" style="flex:1"><button data-test="pennylane">🔌</button></div>
          <span class="small" id="t-pennylane"></span>
        </label>
        <label class="field" style="margin-bottom:10px">🧪 FullEnrich — app.fullenrich.com → Settings → API
          <div class="row"><input id="s-fe" type="password" value="${esc(s.fullenrich_api_key)}" style="flex:1"><button data-test="fullenrich">🔌</button></div>
          <span class="small" id="t-fullenrich"></span>
        </label>
        <label class="field" style="margin-bottom:10px">🟠 HubSpot — token d'application privée (scopes contacts read/write)
          <div class="row"><input id="s-hs" type="password" value="${esc(s.hubspot_token)}" style="flex:1"><button data-test="hubspot">🔌</button></div>
          <span class="small" id="t-hubspot"></span>
        </label>
        <label class="field" style="margin-bottom:10px">✨ Claude (rédaction IA) — console.anthropic.com → API keys
          <div class="row"><input id="s-ai" type="password" value="${esc(s.anthropic_api_key)}" style="flex:1"></div>
        </label>
        <label class="field">Modèle IA
          <input id="s-model" list="models" value="${esc(s.ai_model)}">
          <datalist id="models"><option value="claude-sonnet-5"><option value="claude-opus-5"><option value="claude-haiku-4-5-20251001"></datalist>
        </label>
      </div>
      </div>
    </div>
    <div class="row" style="margin-top:16px"><button class="primary big" id="s-save">💾 Enregistrer les réglages</button><span id="s-status" class="muted"></span></div>`;

  $('#s-save').onclick = async () => {
    try {
      await api('/settings', { method: 'PUT', body: {
        user_name: $('#s-user').value, company_name: $('#s-company').value, user_signature: $('#s-sig').value,
        objectif_factures: $('#s-goal').value, seuil_grand_compte: $('#s-seuil').value,
        pennylane_api_key: $('#s-pl').value, fullenrich_api_key: $('#s-fe').value,
        hubspot_token: $('#s-hs').value, anthropic_api_key: $('#s-ai').value, ai_model: $('#s-model').value,
        gmail_user: $('#s-gmail').value, gmail_app_password: $('#s-gmailpw').value,
        autopilot_daily_cap: $('#s-cap').value, autopilot_window_start: $('#s-ws').value,
        autopilot_window_end: $('#s-we').value, autopilot_weekdays_only: $('#s-weekdays').checked ? '1' : '0',
        booking_url: $('#s-booking').value,
      } });
      $('#s-status').textContent = '✅ Enregistré';
      fx.play('pop');
      await refreshState();
      setTimeout(() => { $('#s-status') && ($('#s-status').textContent = ''); }, 2500);
    } catch (e) { fx.error(e.message); }
  };
  $$('[data-test]', view).forEach((b) => { b.onclick = () => testIntegration(b.dataset.test, $(`#t-${b.dataset.test}`)); });
  $$('[data-mailtest]', view).forEach((b) => {
    b.onclick = async () => {
      const el = $('#t-mail'); el.textContent = '⏳…'; b.disabled = true;
      try {
        const r = await api(`/mail/${b.dataset.mailtest}`, { method: 'POST' });
        el.textContent = '✅ ' + (r.message || 'OK');
        fx.play('pop');
      } catch (e) { el.textContent = ''; fx.error(e.message); }
      b.disabled = false;
    };
  });
  $('#s-demo').onclick = async () => {
    try { const r = await api('/demo', { method: 'POST' }); fx.toast(esc(r.message)); await refreshState(); }
    catch (e) { fx.error(e.message); }
  };
}

// ---------------------------------------------------------------- init
$('#sound-toggle').onclick = () => {
  const on = localStorage.getItem('chasse_sounds') !== '0';
  localStorage.setItem('chasse_sounds', on ? '0' : '1');
  $('#sound-toggle').textContent = on ? '🔇' : '🔊';
  if (!on) fx.play('pop');
};
$('#sound-toggle').textContent = localStorage.getItem('chasse_sounds') === '0' ? '🔇' : '🔊';

refreshState().then(render).catch((e) => {
  $('#view').innerHTML = `<div class="card"><h2>💥 Impossible de joindre le serveur</h2><p>${esc(e.message)}</p></div>`;
});
