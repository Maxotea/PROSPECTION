'use strict';
/* ☀️ Ma journée : la to-do du matin, lue dans Gmail, WhatsApp, les appels et le CRM.
   Chargé avant app.js ; utilise ses helpers ($, esc, api, modal, fx, celebrate, openContact)
   qui existent au moment où la vue s'affiche. */

const J_SOURCES = {
  gmail: { emoji: '📧', label: 'Gmail' },
  whatsapp: { emoji: '💬', label: 'WhatsApp' },
  appels: { emoji: '📞', label: 'Appels' },
  agenda: { emoji: '🗓️', label: 'Agenda' },
};

function jDepuis(iso) {
  if (!iso) return '';
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (h < 1) return "à l'instant";
  if (h < 60) return `il y a ${h} min`;
  if (h < 1440) return `il y a ${Math.round(h / 60)} h`;
  return `il y a ${Math.round(h / 1440)} j`;
}
function jDuree(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
}

let jPlan = null;

async function vJournee(view) {
  jPlan = await api('/journee');
  dessinerJournee(view);
  // Sur téléphone la barre du bas est là pour ça : rien à faire de plus.
}

function jItemHtml(it, P) {
  const imp = P.vocabulaire.importances[it.importance];
  const dur = P.vocabulaire.durees[it.duree];
  const actions = it.actions.map((a) => {
    if (a.type === 'lien') {
      const externe = /^https?:/i.test(a.href);
      return `<a class="btn" href="${esc(a.href)}" ${externe ? 'target="_blank" rel="noopener"' : ''}>${esc(a.label)}</a>`;
    }
    if (a.type === 'contact') return `<button data-j-contact="${a.id}">${esc(a.label || '👤 Fiche')}</button>`;
    if (a.type === 'repondre_mail') return `<button class="primary" data-j-mail="${a.uid}" data-j-cle="${esc(it.cle)}">${esc(a.label)}</button>`;
    return '';
  }).join('');
  const cale = P.agenda && P.agenda.cales && P.agenda.cales[it.cle];
  const caler = P.agenda && P.agenda.branche
    ? (cale
      ? `<button class="ghost" data-j-caler="${esc(it.cle)}" title="Déplacer dans l'agenda">📅 calé à ${esc(jHeure(cale.debut))}</button>`
      : `<button data-j-caler="${esc(it.cle)}" title="Poser sur un créneau libre de Google Agenda">📅 Caler</button>`)
    : '';
  return `
    <div class="j-item imp-${it.importance}" data-j-item="${esc(it.cle)}">
      <div class="j-imp" title="${esc(imp.label)}">${imp.emoji}</div>
      <div class="j-main">
        <div class="j-titre">${it.emoji} ${esc(it.titre)} <span class="chip" title="${esc(dur.aide)}">${dur.emoji} ${jDuree(it.minutes)}</span>${it.contact && it.contact.stage ? ` <span class="chip faint">${esc(it.contact.stage.replace(/_/g, ' '))}</span>` : ''}</div>
        ${it.pourquoi ? `<div class="j-why muted small">${esc(it.pourquoi)}</div>` : ''}
        ${actions || caler ? `<div class="row j-actions">${actions}${caler}</div>` : ''}
      </div>
      <div class="j-decide">
        ${it.tache_id ? `<button class="ghost" title="Modifier" data-j-edit="${it.tache_id}">✏️</button>` : ''}
        <button class="ghost" title="Plus tard" aria-label="Reporter : ${esc(it.titre)}" data-j-tard="${esc(it.cle)}">${jIco('horloge')}</button>
        <button class="ghost" title="Ignorer : ne plus me le proposer" aria-label="Ignorer : ${esc(it.titre)}" data-j-ignore="${esc(it.cle)}">${jIco('fermer')}</button>
        <button class="gold" title="Fait" aria-label="Fait : ${esc(it.titre)}" data-j-fait="${esc(it.cle)}">${jIco('check')}</button>
      </div>
    </div>`;
}

function jIco(nom) { return `<svg class="ico" aria-hidden="true"><use href="#i-${nom}"/></svg>`; }

// Même barème que le serveur pour classer : importance, puis urgence, puis argent en jeu.
function jScore(it) { return it.importance * 100 + (it.urgence || 0) * 20 + Math.min(50, Math.round((it.argent || 0) / 200)); }

// Le matin, en un coup d'œil : les trois choses qui comptent le plus, chacune
// avec son action directe (ouvrir, reporter à demain, fait).
function jTop3(P) {
  const tout = [...P.blocs.matin, ...P.blocs.pierre, ...P.blocs.apres_midi].sort((a, b) => jScore(b) - jScore(a));
  return { tout, top: tout.slice(0, 3) };
}
function jEssentielHtml(P) {
  const { tout, top } = jTop3(P);
  const ouvrir = (it) => {
    const a = it.actions[0];
    if (!a) return '';
    if (a.type === 'contact') return `<button data-j-contact="${a.id}">Ouvrir ${jIco('fleche')}</button>`;
    if (a.type === 'repondre_mail') return `<button data-j-mail="${a.uid}" data-j-cle="${esc(it.cle)}">Répondre ${jIco('fleche')}</button>`;
    if (a.type === 'lien') {
      const externe = /^https?:/i.test(a.href);
      return `<a class="btn" href="${esc(a.href)}" ${externe ? 'target="_blank" rel="noopener"' : ''}>Ouvrir ${jIco('fleche')}</a>`;
    }
    return '';
  };
  const reste = Math.max(0, tout.length - top.length);
  return `
    <section class="j-essentiel" aria-labelledby="j-ess-titre">
      <div class="j-ess-tete">
        <h2 id="j-ess-titre">L'essentiel du jour</h2>
        <span class="muted">${top.length ? `${top.length === 1 ? 'La chose' : `Les ${top.length} choses`} à faire en premier${reste ? ` · ${reste} autre${reste > 1 ? 's' : ''} plus bas` : ''}` : ''}</span>
      </div>
      ${top.length ? `<ol class="j-ess-liste">${top.map((it, i) => {
        const imp = P.vocabulaire.importances[it.importance];
        return `<li class="j-ess ${it.importance >= 3 ? 'vital' : ''}" data-j-item="${esc(it.cle)}">
          <span class="j-ess-rang" aria-hidden="true">${i + 1}</span>
          <div>
            <div class="j-ess-titre">${esc(it.titre)}</div>
            <div class="j-ess-meta">${it.importance >= 3 ? `<span class="chip due">${esc(imp.label)}</span>` : ''}<span>${jDuree(it.minutes)}</span>${it.pourquoi ? `<span>${esc(it.pourquoi)}</span>` : ''}</div>
          </div>
          <div class="j-ess-actions">
            ${ouvrir(it)}
            <button class="ghost" data-j-demain="${esc(it.cle)}" title="Reporter à demain">${jIco('horloge')} Demain</button>
            <button class="primary j-fait-btn" data-j-fait="${esc(it.cle)}" aria-label="Fait : ${esc(it.titre)}">${jIco('check')} Fait</button>
          </div>
        </li>`;
      }).join('')}</ol>`
      : `<div class="j-ess-vide"><div class="vide-etat"><b>Rien d'urgent ce matin.</b><br>${P.faits_aujourdhui ? `${P.faits_aujourdhui} chose${P.faits_aujourdhui > 1 ? 's' : ''} déjà faite${P.faits_aujourdhui > 1 ? 's' : ''}. ` : ''}C'est le bon moment pour provoquer des réponses.<div class="row centre mt-3"><a class="btn primary" href="#/chasse">Lancer La Chasse</a></div></div></div>`}
    </section>`;
}

function jBlocHtml(code, P, dejaEnHaut = new Set()) {
  const b = P.vocabulaire.blocs[code];
  // Ce qui est déjà dans « L'essentiel » n'est pas répété plus bas.
  const liste = P.blocs[code].filter((it) => !dejaEnHaut.has(it.cle));
  const remonte = P.blocs[code].length - liste.length;
  const minutes = liste.reduce((t, it) => t + (Number(it.minutes) || 0), 0);
  const ouvert = code !== 'plus_tard' || !P.blocs.matin.length;
  return `
    <section class="card j-bloc j-${code}">
      <div class="spread">
        <h2>${b.emoji} ${esc(b.titre)}</h2>
        <span class="chip ${liste.length && code === 'pierre' ? 'former' : ''}">${liste.length}${liste.length ? ` · ≈ ${jDuree(minutes)}` : ''}</span>
      </div>
      <p class="muted small j-aide">${esc(b.aide)}</p>
      ${code === 'plus_tard' && liste.length && !ouvert
        ? `<details><summary class="muted small cliquable">Voir les ${liste.length} choses qui peuvent attendre</summary>${liste.map((it) => jItemHtml(it, P)).join('')}</details>`
        : liste.length ? liste.map((it) => jItemHtml(it, P)).join('') : `<p class="muted small j-vide">${remonte ? `Tout est dans l'essentiel, en haut de la page.` : code === 'matin' ? 'Rien de court en attente. Belle matinée.' : code === 'pierre' ? 'Pas de grosse pierre aujourd’hui : ajoute-la dans le vide-cerveau si tu en as une en tête.' : code === 'apres_midi' ? 'Rien de moyen.' : 'Rien.'}</p>`}
    </section>`;
}

function jHeure(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Le fil de la journée tel qu'il est dans Google Agenda, avec les trous, et
// l'urgence de chaque événement changeable d'un clic (c'est sa couleur là-bas).
function jAgendaHtml(A) {
  if (!A.branche) {
    return `<div class="card mt-4"><div class="spread"><div><h3 class="mb-1">🗓️ Ton agenda</h3><p class="muted small m-0">${esc(A.erreur || 'Pas encore branché.')} Une fois branché, ta journée se lit ici et tes tâches se posent sur tes créneaux libres, colorées par urgence.</p></div><a class="btn" href="#/reglages">⚙️ Brancher</a></div></div>`;
  }
  const N = A.niveaux;
  const boutonsNiveau = (ev) => [3, 2, 1, 0].map((n) => `<button class="ghost j-niv ${ev.niveau === n ? 'actif' : ''}" data-j-niv="${n}" data-j-ev="${esc(ev.id)}" data-j-cal="${esc(ev.calendrier || '')}" title="${esc(N[n].label)}">${N[n].emoji}</button>`).join('')
    + `<button class="ghost j-niv ${ev.niveau === null ? 'actif' : ''}" data-j-niv="" data-j-ev="${esc(ev.id)}" data-j-cal="${esc(ev.calendrier || '')}" title="Juste une info, pas d'urgence">⚪</button>`;
  const lignes = [];
  const evs = A.evenements;
  const cren = A.creneaux;
  // On entrelace événements et trous par heure de début.
  const tout = [
    ...evs.map((ev) => ({ t: ev.journee ? '' : ev.debut, ev })),
    ...cren.map((c) => ({ t: c.debut, c })),
  ].sort((x, y) => String(x.t).localeCompare(String(y.t)));
  for (const x of tout) {
    if (x.ev) {
      const ev = x.ev;
      const couleur = ev.couleur && A.palette[ev.couleur] ? A.palette[ev.couleur].hex : '';
      lignes.push(`<div class="j-ev">
        <span class="j-ev-h mono">${ev.journee ? 'journée' : `${esc(ev.heure)}<span class="faint">-${esc(ev.heure_fin)}</span>`}</span>
        <span class="j-ev-dot" style="background:${couleur || 'var(--trait-fort)'}"></span>
        <span class="j-ev-t">${ev.niveau !== null && ev.niveau !== undefined ? N[ev.niveau].emoji + ' ' : ''}${esc(ev.titre || '(sans titre)')}${ev.calendrier_nom ? ` <span class="faint small">· ${esc(ev.calendrier_nom)}</span>` : ''}${ev.lieu ? ` <span class="faint small">📍 ${esc(ev.lieu)}</span>` : ''}</span>
        <span class="j-ev-niv">${boutonsNiveau(ev)}</span>
      </div>`);
    } else {
      lignes.push(`<div class="j-ev j-libre"><span class="j-ev-h mono">${esc(jHeure(x.c.debut))}<span class="faint">-${esc(jHeure(x.c.fin))}</span></span><span class="j-ev-dot"></span><span class="j-ev-t muted">libre · ${jDuree(x.c.minutes)}</span></div>`);
    }
  }
  const libreTotal = cren.reduce((s, c) => s + c.minutes, 0);
  return `
    <div class="card mt-4">
      <div class="spread">
        <div><h3 class="mb-1">🗓️ Aujourd'hui dans l'agenda</h3><p class="muted small m-0">${evs.length ? `${evs.length} événement${evs.length > 1 ? 's' : ''}` : 'Rien de prévu'} · ${libreTotal ? `${jDuree(libreTotal)} de libre d'ici ${esc(String(Math.floor(A.heures.fin / 60)).padStart(2, '0'))}:${esc(String(A.heures.fin % 60).padStart(2, '0'))}` : 'plus de créneau libre aujourd’hui'} · clique un rond pour changer l'urgence, elle change de couleur dans Google Agenda</p></div>
        <button class="gold" id="j-caler-tout" ${cren.length ? '' : 'disabled'} title="Pose les courtes au plus tôt, la grosse pierre dans le plus grand trou, les moyennes ensuite">🗓️ Caler ma journée</button>
      </div>
      <div class="j-agenda">${lignes.join('') || '<p class="muted small j-vide">Journée vide.</p>'}</div>
      ${jSemaineHtml(A)}
    </div>`;
}

// Ce qui compte dans les sept prochains jours : les prods et l'important, sans les rappels quotidiens.
function jSemaineHtml(A) {
  const sem = A.semaine || [];
  if (!sem.length) return '';
  const N = A.niveaux;
  const jour = (d) => { const [y, m, j] = d.split('-').map(Number); const x = new Date(y, m - 1, j); return `${['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'][x.getDay()]}. ${x.getDate()}`; };
  const lignes = sem.slice(0, 8).map((ev) => `<div class="j-ev"><span class="j-ev-h mono">${esc(jour(ev.jour))}${ev.heure ? ` <span class="faint">${esc(ev.heure)}</span>` : ''}</span><span class="j-ev-dot" style="background:${ev.niveau >= 2 ? N[ev.niveau].couleur && A.palette[N[ev.niveau].couleur] ? A.palette[N[ev.niveau].couleur].hex : 'var(--trait-fort)' : 'var(--trait-fort)'}"></span><span class="j-ev-t">${ev.niveau >= 2 ? N[ev.niveau].emoji + ' ' : ''}${esc(ev.titre)}${ev.lieu ? ` <span class="faint small">📍 ${esc(ev.lieu)}</span>` : ''}</span></div>`);
  return `<h4 class="mt-4 mb-1">📆 Cette semaine</h4><div class="j-agenda">${lignes.join('')}</div>`;
}

function dessinerJournee(view) {
  const P = jPlan;
  const radar = ['gmail', 'whatsapp', 'appels', 'agenda'].map((s) => {
    const r = P.sources[s];
    const src = J_SOURCES[s];
    const ok = r.branche && !r.erreur;
    const cls = ok ? 'ok' : r.erreur && r.branche ? 'due' : '';
    const detail = ok ? `lu ${jDepuis(r.lu_le)}${r.via === 'pont' ? ' (via le Mac)' : ''}` : r.branche ? `erreur (${jDepuis(r.lu_le)})` : 'pas branché';
    return `<span class="chip ${cls}" title="${esc(r.erreur || `${src.label} : ${detail}`)}">${src.emoji} ${src.label} · ${detail}</span>`;
  }).join('');
  const total = P.total;
  const titre = total
    ? `${total} chose${total > 1 ? 's' : ''} à faire${P.vitaux ? `, dont <b class="texte-alerte">${P.vitaux} vitale${P.vitaux > 1 ? 's' : ''}</b>` : ''}${P.argent ? ` · ${eur(P.argent)} en jeu` : ''}${P.faits_aujourdhui ? ` · ✅ ${P.faits_aujourdhui} déjà fait${P.faits_aujourdhui > 1 ? 's' : ''}` : ''}`
    : `Rien qui attend. ${P.faits_aujourdhui ? `✅ ${P.faits_aujourdhui} fait${P.faits_aujourdhui > 1 ? 's' : ''} aujourd'hui. ` : ''}Va provoquer des réponses : <a href="#/chasse">Mode Chasse</a>.`;

  const enHaut = new Set(jTop3(P).top.map((it) => it.cle));
  view.innerHTML = `
    <div class="view-header spread">
      <div><h1>☀️ ${esc(P.jour_long.charAt(0).toUpperCase() + P.jour_long.slice(1))}</h1><div class="sub">${titre}</div></div>
      <div class="row">
        <button id="j-scan">🔄 Relire mes boîtes</button>
        <button class="ghost" id="j-brief" title="Le brief du matin, tel qu'il part par mail">📨 Le brief</button>
      </div>
    </div>
    ${jEssentielHtml(P)}
    <div class="card mt-4">
      <h3><label for="j-texte">🧠 Vide-cerveau</label></h3>
      <div class="j-capture">
        <input id="j-texte" placeholder="Une chose à faire, en une ligne : « monter la vidéo du Loft 3h !! avant le 12/09 »" autocomplete="off">
        <button class="gold" id="j-add">Ajouter</button>
      </div>
      <p class="muted small mt-2 mb-0">Astuces : <b>!</b> important, <b>!!</b> vital · <b>2h</b>, <b>30 min</b> pour la durée · <b>demain</b>, <b>vendredi</b>, <b>avant le 12/09</b> pour l'échéance. Sans rien, l'app devine à partir des mots (montage = long, devis = moyen, mail = court).</p>
    </div>
    <div class="j-blocs mt-4">
      <div class="j-col">${jBlocHtml('matin', P, enHaut)}${jBlocHtml('apres_midi', P, enHaut)}</div>
      <div class="j-col">${jBlocHtml('pierre', P, enHaut)}${jBlocHtml('plus_tard', P, enHaut)}</div>
    </div>
    ${jAgendaHtml(P.agenda)}
    <details class="card j-sources mt-4">
      <summary>Ce que l'app a lu ce matin : sources et brief</summary>
      <div class="j-radar"><span class="muted small">Radar :</span>${radar}<span class="muted small">· CRM lu en direct</span></div>
      <div class="j-radar mt-2"><span class="muted small">Brief :</span>${briefChip(P.brief)}</div>
    </details>`;

  const recharger = async () => { jPlan = await api('/journee'); dessinerJournee(view); };

  $('#j-scan').onclick = async () => {
    const b = $('#j-scan');
    b.disabled = true; b.textContent = '🔄 Lecture en cours…';
    try {
      const r = await api('/journee/scan', { method: 'POST', body: {} });
      jPlan = r.plan;
      const soucis = Object.entries(r.bilan).filter(([, v]) => v.erreur).map(([k, v]) => `${J_SOURCES[k].label} : ${v.erreur}`);
      if (soucis.length) fx.error(soucis.join(' · '));
      else fx.toast('📡 Boîtes relues');
      dessinerJournee(view);
    } catch (e) { fx.error(e.message); b.disabled = false; b.textContent = '🔄 Relire mes boîtes'; }
  };

  $('#j-brief').onclick = async () => {
    try {
      const r = await api('/journee/brief');
      const m = modal(`
        <h2>📨 Le brief du matin</h2>
        <p class="muted small">Calculé ${r.brief ? `ce matin${r.brief.envoye_le ? ` et envoyé sur ton Gmail à ${new Date(r.brief.envoye_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}` : 'à l’instant'}. Il part chaque matin par mail à l'heure choisie dans Réglages.</p>
        <div class="j-brief">${esc(r.texte)}</div>
        <div class="row fin mt-3">
          <button id="jb-copy">📋 Copier</button>
          <button class="primary" id="jb-send">📨 Me l'envoyer maintenant</button>
        </div>`);
      $('#jb-copy', m).onclick = async () => { await copyText(r.texte); fx.toast('📋 Copié'); };
      $('#jb-send', m).onclick = async () => {
        try {
          const s = await api('/journee/brief', { method: 'POST', body: { envoyer: true } });
          if (s.envoye) { fx.toast('📨 Brief envoyé sur ta boîte'); m.remove(); }
          else fx.error(s.erreur || 'Gmail n’est pas branché : renseigne ton adresse et un mot de passe d’application dans Réglages.');
        } catch (e) { fx.error(e.message); }
      };
    } catch (e) { fx.error(e.message); }
  };

  const ajouter = async () => {
    const texte = $('#j-texte').value.trim();
    if (!texte) return;
    try {
      const r = await api('/journee/taches', { method: 'POST', body: { texte } });
      const t = r.tache;
      const P2 = jPlan.vocabulaire;
      fx.toast(`🧠 Ajouté : ${P2.importances[t.importance].emoji} ${P2.durees[t.duree].emoji} ${esc(t.texte)}${t.echeance ? ` · pour le ${t.echeance.slice(8, 10)}/${t.echeance.slice(5, 7)}` : ''}`);
      await recharger();
      $('#j-texte').focus();
    } catch (e) { fx.error(e.message); }
  };
  $('#j-add').onclick = ajouter;
  $('#j-texte').onkeydown = (e) => { if (e.key === 'Enter') ajouter(); };

  // Mise à jour optimiste : la ligne s'efface tout de suite, le serveur suit.
  // Chaque décision (même celle qui rapporte de l'XP ou efface une tâche) se
  // rattrape avec « Annuler » : le serveur remet l'état exact d'avant.
  const decider = async (cle, statut, extra = {}) => {
    const it = trouverItem(cle);
    const lignes = $$(`[data-j-item="${CSS.escape(cle)}"]`, view);
    lignes.forEach((l) => { l.classList.add('j-part'); l.setAttribute('aria-hidden', 'true'); });
    try {
      const r = await api('/journee/decision', { method: 'POST', body: { cle, statut, titre: it ? it.titre : '', ...extra } });
      const titre = it ? esc(it.titre) : '';
      const message = statut === 'fait' ? `Fait : ${titre || 'bien joué'}`
        : statut === 'plus_tard' ? `Reporté au ${r.jusqu_au.slice(8, 10)}/${r.jusqu_au.slice(5, 7)}${titre ? ` : ${titre}` : ''}`
          : 'Ignoré : il ne reviendra plus';
      confirmerAvecRetour(message, r, recharger);
      if (r.celebration) await celebrate(r.celebration);
      await recharger();
    } catch (e) {
      lignes.forEach((l) => { l.classList.remove('j-part'); l.removeAttribute('aria-hidden'); });
      fx.error(e.message);
    }
  };

  $$('[data-j-fait]', view).forEach((b) => { b.onclick = () => decider(b.dataset.jFait, 'fait'); });
  $$('[data-j-ignore]', view).forEach((b) => { b.onclick = () => decider(b.dataset.jIgnore, 'ignore'); });
  $$('[data-j-demain]', view).forEach((b) => { b.onclick = () => decider(b.dataset.jDemain, 'plus_tard', { jours: 1 }); });
  $$('[data-j-tard]', view).forEach((b) => {
    b.onclick = () => {
      const cle = b.dataset.jTard;
      const it = trouverItem(cle);
      const d = new Date();
      const versLundi = ((8 - d.getDay()) % 7) || 7;
      const m = modal(`
        <h2>⏰ Plus tard</h2>
        <p class="muted small">${it ? esc(it.titre) : ''}</p>
        <div class="row ">
          <button data-jours="1">Demain</button>
          <button data-jours="2">Dans 2 jours</button>
          <button data-jours="${versLundi}">Lundi prochain</button>
          <button data-jours="7">Dans une semaine</button>
          <button data-jours="30">Dans un mois</button>
        </div>`);
      $$('[data-jours]', m).forEach((x) => { x.onclick = () => { m.remove(); decider(cle, 'plus_tard', { jours: Number(x.dataset.jours) }); }; });
    };
  });
  $$('[data-j-contact]', view).forEach((b) => { b.onclick = () => openContact(b.dataset.jContact); });
  $$('[data-j-caler]', view).forEach((b) => { b.onclick = () => jCalerModal(b.dataset.jCaler, recharger); });
  $$('[data-j-niv]', view).forEach((b) => {
    b.onclick = async () => {
      const niveau = b.dataset.jNiv === '' ? null : Number(b.dataset.jNiv);
      $$('.j-niv', b.parentElement).forEach((x) => { x.disabled = true; });
      try {
        await api('/agenda/urgence', { method: 'POST', body: { id: b.dataset.jEv, calendrier: b.dataset.jCal, niveau } });
        const N = jPlan.agenda.niveaux;
        fx.toast(niveau === null ? '⚪ Plus d’urgence sur cet événement' : `${N[niveau].emoji} ${N[niveau].label} : couleur changée dans Google Agenda`);
        await api('/journee/scan', { method: 'POST', body: { sources: ['agenda'] } });
        await recharger();
      } catch (e) { fx.error(e.message); $$('.j-niv', b.parentElement).forEach((x) => { x.disabled = false; }); }
    };
  });
  const calerTout = $('#j-caler-tout');
  if (calerTout) calerTout.onclick = async () => {
    calerTout.disabled = true; calerTout.textContent = '🗓️ Je cale…';
    try {
      const r = await api('/journee/caler_tout', { method: 'POST', body: {} });
      if (r.cales.length) fx.toast(`🗓️ ${r.cales.length} chose${r.cales.length > 1 ? 's' : ''} posée${r.cales.length > 1 ? 's' : ''} dans ton agenda : ${esc(r.cales.map((c) => `${c.heure} ${c.titre}`).join(' · ').slice(0, 160))}`);
      else fx.toast('🗓️ Rien à caler : tout est déjà posé, ou plus de place aujourd’hui.');
      if (r.sans_place.length) setTimeout(() => fx.error(`Pas de place aujourd'hui pour : ${r.sans_place.join(' · ').slice(0, 200)}`), 600);
      await api('/journee/scan', { method: 'POST', body: { sources: ['agenda'] } });
      await recharger();
    } catch (e) { fx.error(e.message); calerTout.disabled = false; calerTout.textContent = '🗓️ Caler ma journée'; }
  };
  $$('[data-j-edit]', view).forEach((b) => { b.onclick = () => jEditerTache(Number(b.dataset.jEdit), recharger); });
  $$('[data-j-mail]', view).forEach((b) => { b.onclick = () => jRepondreMail(Number(b.dataset.jMail), b.dataset.jCle, recharger); });
}

// « Envoyé à 08:02 », « pas encore », ou la raison pour laquelle il n'est pas parti.
function briefChip(b) {
  const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (b.envoye_le) return `<span class="chip ok">📨 envoyé sur ta boîte à ${heure(b.envoye_le)}</span>`;
  if (b.erreur) return `<span class="chip due" title="${esc(b.erreur)}">⚠️ ${esc(b.erreur)}</span><span class="muted small">· nouvel essai toutes les 5 min</span>`;
  if (!b.par_mail) return `<span class="chip">📨 mail désactivé</span><span class="muted small">· à activer dans Réglages si tu le veux chaque matin</span>`;
  if (!b.gmail) return `<span class="chip due">📨 Gmail pas branché</span><span class="muted small">· adresse et mot de passe d'application dans Réglages</span>`;
  if (b.calcule_le) return `<span class="chip">📨 calculé à ${heure(b.calcule_le)}, mail en cours</span>`;
  return `<span class="chip">📨 part à ${esc(b.heure)}</span><span class="muted small">· l'app doit tourner à cette heure-là : sur Mac, demarrer-toujours.command ; sinon il part dès l'ouverture</span>`;
}

function trouverItem(cle) {
  if (!jPlan) return null;
  for (const liste of Object.values(jPlan.blocs)) {
    const it = liste.find((x) => x.cle === cle);
    if (it) return it;
  }
  return null;
}

// ---------------------------------------------------------------- 📅 poser une chose sur un créneau libre
function jCalerModal(cle, apres) {
  const it = trouverItem(cle);
  if (!it) return;
  const A = jPlan.agenda;
  const cale = A.cales && A.cales[cle];
  const minutes = Math.max(15, Number(it.minutes) || 30);
  const creneaux = A.creneaux.filter((c) => c.minutes >= 15);
  const m = modal(`
    <h2>📅 ${cale ? 'Déplacer' : 'Caler'} dans l'agenda</h2>
    <p class="muted small">${esc(it.titre)} · ${jDuree(minutes)} · ${jPlan.vocabulaire.importances[it.importance].emoji} la couleur suivra l'urgence</p>
    ${creneaux.length ? `<div class="grid gap-2 mt-2">${creneaux.map((c, i) => `<label class="chip cliquable debut"><input type="radio" name="jc-cren" value="${esc(c.debut)}" ${i === 0 ? 'checked' : ''}> ${esc(jHeure(c.debut))} → ${esc(jHeure(c.fin))} <span class="faint">· ${jDuree(c.minutes)} de libre</span></label>`).join('')}</div>` : '<p class="muted small">Plus de créneau libre aujourd’hui dans tes heures de travail. Choisis une heure à la main :</p>'}
    <div class="form-grid mt-3">
      <label class="field">Ou à cette heure<input id="jc-heure" type="time" value=""></label>
      <label class="field">Durée (min)<input id="jc-min" type="number" min="15" step="5" value="${minutes}"></label>
    </div>
    <div class="spread mt-3">
      ${cale ? '<button class="danger" id="jc-del">🗑 Retirer de l’agenda</button>' : '<span></span>'}
      <button class="primary" id="jc-ok">📅 ${cale ? 'Déplacer' : 'Caler'}</button>
    </div>`);
  $('#jc-ok', m).onclick = async () => {
    const heure = $('#jc-heure', m).value;
    const coche = m.querySelector('input[name="jc-cren"]:checked');
    let debut = coche ? coche.value : '';
    if (heure) { const d = new Date(); const [h, mn] = heure.split(':').map(Number); d.setHours(h, mn, 0, 0); debut = d.toISOString(); }
    if (!debut) { fx.error('Choisis un créneau ou une heure.'); return; }
    try {
      const r = await api('/journee/caler', { method: 'POST', body: { cle, debut, minutes: Number($('#jc-min', m).value) || minutes } });
      m.remove();
      fx.toast(`📅 ${r.deplace ? 'Déplacé' : 'Posé'} à ${esc(r.heure)} dans Google Agenda`);
      await api('/journee/scan', { method: 'POST', body: { sources: ['agenda'] } });
      await apres();
    } catch (e) { fx.error(e.message); }
  };
  const del = $('#jc-del', m);
  if (del) del.onclick = async () => {
    try { await api('/journee/decaler', { method: 'POST', body: { cle } }); m.remove(); fx.toast('🗑 Retiré de l’agenda'); await api('/journee/scan', { method: 'POST', body: { sources: ['agenda'] } }); await apres(); }
    catch (e) { fx.error(e.message); }
  };
}

// ---------------------------------------------------------------- ✏️ modifier une tâche
function jEditerTache(id, apres) {
  const it = trouverItem(`tache:${id}`);
  if (!it) return;
  const V = jPlan.vocabulaire;
  const m = modal(`
    <h2>✏️ Modifier</h2>
    <div class="form-grid mt-3">
      <label class="field wide">Quoi<input id="jt-texte" value="${esc(it.titre)}"></label>
      <label class="field">Durée<select id="jt-duree">${Object.values(V.durees).map((d) => `<option value="${d.code}" ${d.code === it.duree ? 'selected' : ''}>${d.emoji} ${d.label} (${d.aide})</option>`).join('')}</select></label>
      <label class="field">Minutes <span class="faint">(0 = par défaut)</span><input id="jt-min" type="number" min="0" value="${Number(it.minutes) || 0}"></label>
      <label class="field">Importance<select id="jt-imp">${[3, 2, 1].map((i) => `<option value="${i}" ${i === it.importance ? 'selected' : ''}>${V.importances[i].emoji} ${V.importances[i].label}</option>`).join('')}</select></label>
      <label class="field">Pour le<input id="jt-ech" type="date" value="${esc(it.echeance || '')}"></label>
    </div>
    <div class="spread mt-3">
      <button class="danger" id="jt-del">🗑 Supprimer</button>
      <button class="primary" id="jt-save">💾 Enregistrer</button>
    </div>`);
  $('#jt-save', m).onclick = async () => {
    try {
      await api(`/journee/taches/${id}`, { method: 'PATCH', body: {
        texte: $('#jt-texte', m).value, duree: $('#jt-duree', m).value, minutes: Number($('#jt-min', m).value) || 0,
        importance: Number($('#jt-imp', m).value), echeance: $('#jt-ech', m).value,
      } });
      m.remove(); await apres();
    } catch (e) { fx.error(e.message); }
  };
  $('#jt-del', m).onclick = async () => {
    try { const r = await api(`/journee/taches/${id}`, { method: 'DELETE' }); m.remove(); confirmerAvecRetour('Tâche supprimée', r, apres); await apres(); }
    catch (e) { fx.error(e.message); }
  };
}

// ---------------------------------------------------------------- ✨ répondre à un mail sans quitter la journée
async function jRepondreMail(uid, cle, apres) {
  const it = trouverItem(cle);
  const m = modal(`<h2>✨ Répondre</h2><p class="muted">Lecture du mail et rédaction du brouillon…</p>`);
  let r;
  try {
    r = await api(`/journee/mail/${uid}/reponse`, { method: 'POST', body: {} });
  } catch (e) {
    m.remove(); fx.error(e.message); return;
  }
  const qui = r.from.name ? `${r.from.name} <${r.from.email}>` : r.from.email;
  m.querySelector('.modal').innerHTML = `
    <h2>✨ Répondre à ${esc(r.contact ? r.contact.nom : (r.from.name || r.from.email))}</h2>
    <p class="muted small">${esc(qui)} · « ${esc(r.subject)} »${r.brouillon.source === 'claude' ? ' · brouillon rédigé par l’IA' : ' · brouillon depuis un template (ajoute une clé IA dans Réglages pour du sur-mesure)'}</p>
    <details open><summary class="muted small cliquable">Le mail reçu</summary><div class="j-mail-recu">${esc(r.texte_recu || '(pas de texte lisible : ouvre-le dans Gmail)')}</div></details>
    <div class="form-grid mt-3">
      <label class="field wide">Objet<input id="jm-subj" value="${esc(r.brouillon.subject || '')}"></label>
      <label class="field wide"><span>Ta réponse</span><textarea id="jm-body" rows="10">${esc(r.brouillon.body || '')}</textarea></label>
    </div>
    <div class="row fin mt-3">
      <button id="jm-copy">📋 Copier</button>
      <a class="btn" href="https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(String(r.message_id || '').replace(/^<|>$/g, ''))}" target="_blank" rel="noopener">📬 Ouvrir dans Gmail</a>
      <button class="gold" id="jm-done">✅ J'ai répondu ailleurs</button>
      <button class="primary" id="jm-send">📤 Envoyer depuis mon Gmail</button>
    </div>`;
  $('#jm-copy', m).onclick = async () => { await copyText($('#jm-body', m).value); fx.toast('📋 Copié'); };
  $('#jm-done', m).onclick = async () => {
    try { const r = await api('/journee/decision', { method: 'POST', body: { cle, statut: 'fait', titre: it ? it.titre : '' } }); m.remove(); confirmerAvecRetour('Marqué fait', r, apres); await apres(); }
    catch (e) { fx.error(e.message); }
  };
  $('#jm-send', m).onclick = async () => {
    const b = $('#jm-send', m);
    b.disabled = true; b.textContent = '📤 Envoi…';
    try {
      const res = await api('/journee/mail/envoyer', { method: 'POST', body: { uid, to: r.from.email, subject: $('#jm-subj', m).value, body: $('#jm-body', m).value, message_id: r.message_id, cle } });
      m.remove();
      fx.toast(`📤 Réponse envoyée à ${esc(r.from.email)}`);
      if (res.celebration) await celebrate(res.celebration);
      await apres();
    } catch (e) { fx.error(e.message); b.disabled = false; b.textContent = '📤 Envoyer depuis mon Gmail'; }
  };
}
