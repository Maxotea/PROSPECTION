/* 🧭 Cockpit : tout ce qui se passe, en un écran.
   La vue #/cockpit de l'app, et son mode écran (plein écran, sans menu, texte
   lisible à trois mètres) pour l'iMac qui reste allumé toute la journée.
   Les mêmes chiffres s'ouvrent sur le MacBook, l'iPad et l'iPhone : même
   adresse, même code d'accès, mise en page qui suit l'écran.
   Rien n'est calculé ici : le serveur (/api/cockpit) donne l'état complet,
   l'écran le dessine et se rafraîchit tout seul. */

let ckEtat = null;        // dernier état reçu du serveur
let ckTimer = null;       // rafraîchissement des données
let ckHorloge = null;     // l'heure et « mis à jour il y a », toutes les 15 s
let ckVerrou = null;      // verrou d'écran (le Mac ne s'endort pas en mode écran)
let ckDepuis = 0;         // Date.now() de la dernière mise à jour reçue
let ckVue = null;         // l'élément #view tant que le Cockpit est affiché

const CK_CLE_ECRAN = 'otea-ecran';

function ckIco(nom) { return `<svg class="ico" aria-hidden="true"><use href="#i-${nom}"/></svg>`; }
function ckKeur(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(v).toLocaleString('fr-FR')} €`;
}
function ckHeure(d = new Date()) { return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function ckPluriel(n, un, plusieurs) { return `${n} ${n > 1 ? plusieurs : un}`; }
function ckDepuisTexte() {
  if (!ckDepuis) return '';
  const s = Math.round((Date.now() - ckDepuis) / 1000);
  if (s < 20) return 'mis à jour à l’instant';
  if (s < 90) return `mis à jour il y a ${s} s`;
  return `mis à jour il y a ${Math.round(s / 60)} min`;
}

// ---------------------------------------------------------------- mode écran
function ckEnModeEcran() { return document.documentElement.dataset.ecran === '1'; }
function ckModeEcranDemande() {
  if (new URLSearchParams(location.search).get('ecran') === '1') return true;
  try { return localStorage.getItem(CK_CLE_ECRAN) === '1'; } catch { return false; }
}
function ckPoserModeEcran(on, { memoriser = true } = {}) {
  if (on) document.documentElement.dataset.ecran = '1';
  else delete document.documentElement.dataset.ecran;
  if (memoriser) { try { localStorage.setItem(CK_CLE_ECRAN, on ? '1' : '0'); } catch { /* navigation privée */ } }
  ckVerrouEcran(on);
}
// Le navigateur sait empêcher l'écran de s'éteindre tant que la page est visible
// (Safari depuis 16.4, Chrome depuis longtemps). Sans ça, l'iMac s'endort au
// bout de dix minutes et le Cockpit ne sert à rien.
async function ckVerrouEcran(on) {
  if (!('wakeLock' in navigator)) return;
  if (!on) {
    if (ckVerrou) { try { await ckVerrou.release(); } catch { /* déjà relâché */ } }
    ckVerrou = null;
    return;
  }
  if (ckVerrou) return;
  try {
    ckVerrou = await navigator.wakeLock.request('screen');
    ckVerrou.addEventListener('release', () => { ckVerrou = null; });
  } catch { ckVerrou = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !ckVue) return;
  if (ckEnModeEcran()) ckVerrouEcran(true);
  ckCharger();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ckVue && ckEnModeEcran()) { ckPoserModeEcran(false); ckDessiner(); }
});
addEventListener('hashchange', () => { if (!location.hash.startsWith('#/cockpit')) ckArreter(); });

function ckArreter() {
  if (ckTimer) clearInterval(ckTimer);
  if (ckHorloge) clearInterval(ckHorloge);
  ckTimer = null; ckHorloge = null; ckVue = null;
  // Le menu revient dès qu'on quitte le Cockpit ; le choix reste mémorisé pour la prochaine fois.
  ckPoserModeEcran(false, { memoriser: false });
}

// ---------------------------------------------------------------- la vue
async function vCockpit(view) {
  ckArreter();
  ckVue = view;
  ckPoserModeEcran(ckModeEcranDemande(), { memoriser: false });
  await ckCharger();
  const periode = Math.max(15, (ckEtat && ckEtat.rafraichissement_s) || 60) * 1000;
  ckTimer = setInterval(ckCharger, periode);
  ckHorloge = setInterval(ckTic, 15000);
}

async function ckCharger() {
  if (!ckVue || !location.hash.startsWith('#/cockpit')) return;
  try {
    ckEtat = await api('/cockpit');
    ckDepuis = Date.now();
    ckDessiner();
  } catch (e) {
    if (!ckEtat) ckVue.innerHTML = `<div class="card erreur" role="alert"><h2>Le Cockpit n’a pas pu charger</h2><p>${esc(e.message)}</p><div class="row mt-3"><button class="primary" id="ck-reessayer">Réessayer</button></div></div>`;
    const b = $('#ck-reessayer'); if (b) b.onclick = ckCharger;
    const maj = $('#ck-maj'); if (maj) maj.textContent = `dernière mise à jour impossible : ${e.message}`;
  }
}

function ckTic() {
  const h = $('#ck-heure'); if (h) h.textContent = ckHeure();
  const m = $('#ck-maj'); if (m) m.textContent = ckDepuisTexte();
}

function ckDessiner() {
  if (!ckVue || !ckEtat) return;
  const E = ckEtat;
  const ecran = ckEnModeEcran();
  ckVue.innerHTML = `
    <div class="view-header spread ck-tete">
      <div>
        <h1>🧭 Cockpit</h1>
        <div class="sub">${esc(E.jour_long)} · <span id="ck-maj">${ckDepuisTexte()}</span></div>
      </div>
      <div class="row ck-outils">
        <div class="ck-heure" id="ck-heure" aria-live="off">${ckHeure()}</div>
        <button type="button" class="ghost" id="ck-rafraichir" title="Recharger les chiffres maintenant">Actualiser</button>
        <button type="button" class="${ecran ? 'ghost' : ''}" id="ck-ecran" title="${ecran ? 'Revenir à l’app, avec le menu (Échap)' : 'Plein écran, sans menu, pour l’iMac'}">${ckIco('ecran')} ${ecran ? 'Quitter le mode écran' : 'Mode écran'}</button>
      </div>
    </div>
    <section class="ck-grille" aria-label="Tableau de bord">
      ${ckTuilesArgent(E.argent)}
      ${ckPlanHtml(E.plan)}
      <div class="card ck-5 ck-haut ${E.journee.vitaux ? 'bord-alerte' : ''}">${ckJourneeHtml(E.journee)}</div>
      <div class="card ck-3 ck-haut">${ckRelancesHtml(E)}</div>
      <div class="card ck-4 ck-haut"><div class="spread"><h2>Pipeline</h2>${ckConversionChip(E.conversion)}</div>${ckPipelineHtml(E.pipeline)}</div>
      <div class="card ck-8 ck-graph"><h2>Facturé par mois</h2><p class="muted small ck-sous-titre ck-detail">Les six derniers mois, d’après les devis marqués « facturé ». Ce mois-ci en encre pleine.</p>${ckGrapheMois(E.ca_mois)}</div>
      <div class="card ck-4 ck-graph">${ckActiviteHtml(E)}</div>
      ${ckAgendaHtml(E.agenda)}
    </section>`;

  $('#ck-rafraichir').onclick = ckCharger;
  $('#ck-ecran').onclick = () => { ckPoserModeEcran(!ckEnModeEcran()); ckDessiner(); };
  $$('[data-open-contact]', ckVue).forEach((el) => { el.onclick = (e) => { e.preventDefault(); openContact(el.dataset.openContact); }; });
  if (window.habillerVue) window.habillerVue('cockpit');
}

// ---------------------------------------------------------------- 💰 l'argent, quatre tuiles
function ckTuile({ classe = '', libelle, valeur, sous, href, aria = '' }) {
  return `<a class="ck-tuile ${classe}" href="${href}" ${aria ? `aria-label="${esc(aria)}"` : ''}>
    <div class="ck-l">${libelle}</div>
    <div class="ck-n">${valeur}</div>
    <div class="ck-s">${sous}</div>
  </a>`;
}
function ckTuilesArgent(A) {
  const f = A.a_facturer, d = A.devis_en_cours, q = A.devis_a_faire, m = A.facture_mois;
  return [
    ckTuile({
      classe: f.n ? 'vital' : 'calme', libelle: 'À facturer', valeur: eur(f.total), href: '#/pipeline',
      sous: f.n ? `${ckPluriel(f.n, 'devis accepté', 'devis acceptés')}${f.plus_vieux_j ? ` · le plus ancien attend depuis ${f.plus_vieux_j} j` : ''}` : 'Rien n’attend : chaque devis accepté est facturé',
    }),
    ckTuile({
      classe: d.a_relancer ? 'attention' : '', libelle: 'Devis en attente', valeur: eur(d.total), href: '#/pipeline',
      sous: d.n ? `${ckPluriel(d.n, 'devis envoyé', 'devis envoyés')}${d.a_relancer ? ` · <b>${ckPluriel(d.a_relancer, 'à relancer', 'à relancer')}</b>` : ' · tous relancés récemment'}` : 'Aucun devis envoyé en attente',
    }),
    ckTuile({
      classe: q.n ? 'attention' : '', libelle: 'Devis à faire', valeur: String(q.n), href: '#/journee',
      sous: q.n ? `RDV ${q.n > 1 ? 'pris' : 'pris'} sans devis${q.plus_vieux_j ? ` · le plus ancien il y a ${q.plus_vieux_j} j` : ''}` : 'Chaque RDV a son devis',
    }),
    ckTuile({
      classe: m.total ? 'succes' : '', libelle: 'Facturé ce mois', valeur: eur(m.total), href: '#/pipeline',
      sous: m.n ? ckPluriel(m.n, 'facture', 'factures') : 'Pas encore de facture ce mois-ci',
    }),
  ].join('');
}

// ---------------------------------------------------------------- 🎯 le plan et ses trois paliers
function ckDateCourte(j) { return j ? `${j.slice(8, 10)}/${j.slice(5, 7)}` : ''; }
function ckPlanHtml(P) {
  const pct = (v) => Math.min(100, Math.round((v / P.paliers.wow) * 100));
  const noms = { moyen: 'Moyen', bien: 'Bien', wow: 'Wow' };
  const ordre = ['moyen', 'bien', 'wow'];
  const atteintIdx = ordre.indexOf(P.atteint);
  const paliers = ordre.map((k, i) => `<div class="ck-palier ${i <= atteintIdx ? 'atteint' : ''}" style="left:${pct(P.paliers[k])}%"><span>${noms[k]} · ${ckKeur(P.paliers[k])}</span></div>`).join('');
  const phrase = P.atteint === 'wow'
    ? 'Palier Wow atteint. Monte les paliers dans Réglages.'
    : P.prochain
      ? `Il manque <b>${eur(P.prochain.manque)}</b> pour le palier ${noms[P.prochain.nom]}${P.atteint ? ` (palier ${noms[P.atteint]} atteint)` : ''}.`
      : '';
  const temps = `J-${P.jours_restants} · ${Math.round(P.avancement * 100)} % du temps écoulé`;
  return `<div class="card ck-12 ck-plan">
    <div class="spread">
      <div>
        <div class="ck-l">Facturé du ${ckDateCourte(P.debut)} au ${ckDateCourte(P.fin)}</div>
        <div class="ck-n">${eur(P.total)}<small> · ${ckPluriel(P.n, 'facture', 'factures')}</small></div>
      </div>
      <div class="a-droite">
        <div class="ck-l">${esc(temps)}</div>
        <div class="ck-plan-phrase">${phrase}</div>
      </div>
    </div>
    <div class="ck-jauge ${P.atteint ? 'ok' : ''}" role="img" aria-label="Facturé ${eur(P.total)} sur un objectif Wow de ${eur(P.paliers.wow)}"><i style="width:${pct(P.total)}%"></i>${paliers}</div>
  </div>`;
}

// ---------------------------------------------------------------- 📈 facturé par mois (barres, une seule teinte, libellés directs)
function ckGrapheMois(mois) {
  const W = 600, H = 170, padL = 12, padR = 12, padB = 30, padT = 26;
  const max = Math.max(...mois.map((m) => m.total), 1);
  const bw = (W - padL - padR) / mois.length;
  const barres = mois.map((m, i) => {
    const h = m.total ? Math.max(3, (m.total / max) * (H - padT - padB)) : 0;
    const x = padL + i * bw + bw * 0.18;
    const w = bw * 0.64;
    const y = H - padB - h;
    const r = Math.min(4, h / 2);
    const forme = h ? `<path class="ck-barre ${m.courant ? 'courant' : ''}" d="M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z"><title>${m.libelle} ${m.annee} : ${eur(m.total)} (${m.n} facture${m.n > 1 ? 's' : ''})</title></path>` : '';
    return `<g>${forme}
      <text class="ck-val ${m.total ? '' : 'vide'}" x="${x + w / 2}" y="${(h ? y : H - padB) - 8}" text-anchor="middle">${m.total ? ckKeur(m.total) : '0'}</text>
      <text class="ck-mois ${m.courant ? 'courant' : ''}" x="${x + w / 2}" y="${H - 9}" text-anchor="middle">${m.libelle}</text></g>`;
  }).join('');
  const table = `<table class="sr-only"><caption>Facturé par mois</caption><tbody>${mois.map((m) => `<tr><th>${m.libelle} ${m.annee}</th><td>${eur(m.total)}</td></tr>`).join('')}</tbody></table>`;
  return `<svg class="ck-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Facturé par mois sur six mois"><line class="ck-base" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"/>${barres}</svg>${table}`;
}

// ---------------------------------------------------------------- 📊 pipeline : contacts par étape, euros en face
function ckConversionChip(C) {
  if (C.taux === null) return `<span class="chip faint" title="Aucun devis créé sur ${C.jours} jours">pas encore de devis sur ${C.jours} j</span>`;
  return `<span class="chip ${C.taux >= 0.5 ? 'ok' : ''}" title="${C.signes} devis signés (acceptés ou facturés) sur ${C.envoyes} envoyés depuis ${C.jours} jours">${Math.round(C.taux * 100)} % signés · ${C.signes}/${C.envoyes} sur ${C.jours} j</span>`;
}
function ckPipelineHtml(stages) {
  const rows = stages.filter((s) => s.code !== 'perdu');
  const max = Math.max(...rows.map((s) => s.count), 1);
  return `<div class="ck-pipe">${rows.map((s, i) => {
    const pct = Math.round((s.count / max) * 100);
    const mix = 35 + Math.round((i / Math.max(rows.length - 1, 1)) * 60);
    return `<div class="funnel-row"><div class="f-label">${s.emoji} ${esc(s.label)}</div>
      <div class="f-bar"><i style="width:${pct}%; background: color-mix(in srgb, var(--encre) ${mix}%, var(--trait-fort))"></i></div>
      <div class="f-n">${s.count}</div>
      <div class="f-eur ${s.montant ? '' : 'vide'}">${s.montant ? ckKeur(s.montant) : ''}</div></div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- ☀️ la journée : les trois choses qui comptent
function ckJourneeHtml(J) {
  const ess = J.essentiels.map((it) => {
    const cible = it.action && it.action.type === 'contact' && it.action.id
      ? `href="#/contacts" data-open-contact="${it.action.id}"`
      : `href="${it.action && it.action.href ? esc(it.action.href) : '#/journee'}"`;
    return `<a class="ck-ess" ${cible}>
      <span class="ck-imp imp-${it.importance}" aria-hidden="true"></span>
      <span class="ck-ess-corps">
        <span class="ck-ess-titre">${it.emoji} ${esc(it.titre)}</span>
        ${it.pourquoi ? `<span class="ck-ess-why">${esc(it.pourquoi)}</span>` : ''}
      </span>
      ${it.argent ? `<span class="chip">${eur(it.argent)}</span>` : ''}
    </a>`;
  }).join('');
  const resume = J.total
    ? `${ckPluriel(J.total, 'chose', 'choses')} à faire${J.vitaux ? ` · <b class="texte-alerte">${ckPluriel(J.vitaux, 'vitale', 'vitales')}</b>` : ''}${J.argent ? ` · ${eur(J.argent)} en jeu` : ''}${J.faits ? ` · ✅ ${J.faits} fait${J.faits > 1 ? 's' : ''}` : ''}`
    : `Rien qui attend${J.faits ? ` · ✅ ${J.faits} fait${J.faits > 1 ? 's' : ''}` : ''}`;
  return `<div class="spread"><h2>Aujourd’hui</h2><a class="btn" href="#/journee">Ma journée ${ckIco('fleche')}</a></div>
    <p class="muted small ck-sous-titre">${resume}</p>
    ${ess || '<p class="muted">Rien d’urgent. Mails, WhatsApp, appels et CRM sont lus en continu.</p>'}
    ${J.reste ? `<p class="muted small mt-3">et ${ckPluriel(J.reste, 'autre chose', 'autres choses')} dans Ma journée</p>` : ''}`;
}

// ---------------------------------------------------------------- 🔔 relances, réponses, autopilote
function ckChiffre(n, l, { alerte = false, href = '' } = {}) {
  const corps = `<div class="ck-n">${n}</div><div class="ck-l">${l}</div>`;
  return href ? `<a class="ck-chiffre ${alerte ? 'alerte' : ''}" href="${href}">${corps}</a>` : `<div class="ck-chiffre ${alerte ? 'alerte' : ''}">${corps}</div>`;
}
function ckRelancesHtml(E) {
  const R = E.relances, Q = E.reponses, A = E.autopilote;
  const auto = !A.configured
    ? '<span class="chip due">à brancher</span>'
    : A.enabled
      ? `<span class="chip ok">actif</span> ${A.sent_today}/${A.daily_cap} envoyés${A.awaiting ? ` · <b class="texte-or">${A.awaiting} à valider</b>` : ''}`
      : `<span class="chip">en veille</span>${A.awaiting ? ` · <b class="texte-or">${A.awaiting} à valider</b>` : ''}`;
  return `<h2>Relances et réponses</h2>
    <div class="ck-duo">
      ${ckChiffre(R.dues, R.dues ? `relance${R.dues > 1 ? 's' : ''} due${R.dues > 1 ? 's' : ''}${R.plus_vieille_j ? `, la plus vieille : ${R.plus_vieille_j} j` : ''}` : 'relance due', { alerte: R.plus_vieille_j >= 7, href: '#/chasse' })}
      ${ckChiffre(Q.a_traiter, Q.a_traiter ? `réponse${Q.a_traiter > 1 ? 's' : ''} à traiter` : 'réponse à traiter', { alerte: Q.a_traiter > 0, href: '#/inbox' })}
    </div>
    <div class="ck-ligne-info"><span class="muted small">${R.chaudes ? `${ckPluriel(R.chaudes, 'contact chaud', 'contacts chauds')} dans les relances dues · ` : ''}${ckPluriel(Q.recues_7j, 'réponse reçue', 'réponses reçues')} sur 7 j</span></div>
    <div class="ck-ligne-info"><a href="#/autopilot" class="lien-texte"><b>Autopilote</b></a> ${auto}</div>`;
}

// ---------------------------------------------------------------- ⚡ activité des 14 derniers jours, et le jeu
function ckSpark(jours) {
  const W = 280, H = 60, pad = 2;
  const max = Math.max(...jours.map((j) => j.n), 1);
  const bw = (W - pad * 2) / jours.length;
  const barres = jours.map((j, i) => {
    const h = j.n ? Math.max(3, (j.n / max) * (H - 6)) : 2;
    const x = pad + i * bw + bw * 0.2;
    const dernier = i === jours.length - 1;
    return `<rect class="ck-barre ${dernier ? 'courant' : ''}" x="${x}" y="${H - h}" width="${bw * 0.6}" height="${h}" rx="2"><title>${j.day.slice(8, 10)}/${j.day.slice(5, 7)} : ${ckPluriel(j.n, 'action', 'actions')} · ${j.xp} XP</title></rect>`;
  }).join('');
  const table = `<table class="sr-only"><caption>Actions par jour</caption><tbody>${jours.map((j) => `<tr><th>${j.day}</th><td>${j.n}</td></tr>`).join('')}</tbody></table>`;
  return `<svg class="ck-spark" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Actions par jour sur 14 jours">${barres}</svg>${table}`;
}
function ckActiviteHtml(E) {
  const total = E.activite.reduce((s, j) => s + j.n, 0);
  const aujourdhui = E.activite[E.activite.length - 1];
  const J = E.jeu;
  return `<div class="spread"><h2>Activité</h2><span class="chip">${ckPluriel(total, 'action', 'actions')} sur 14 j</span></div>
    <p class="muted small ck-sous-titre">Aujourd’hui : ${ckPluriel(aujourdhui.n, 'action', 'actions')}, ${aujourdhui.xp} XP${E.campagne ? ` · campagne « ${esc(E.campagne.name)} » ${({ a_venir: 'à venir', en_cours: 'en cours', terminee: 'terminée' })[E.campagne.status] || ''}` : ''}</p>
    ${ckSpark(E.activite)}
    <div class="ck-jeu">
      <span>🔥 <b>${J.streak.current}</b> j de suite</span>
      <span>Niveau <b>${J.level.level}</b> · ${esc(J.level.title)}</span>
      <span>🎯 <b>${J.boss.count}</b>/${J.boss.goal} factures</span>
    </div>`;
}

// ---------------------------------------------------------------- 🗓️ l'agenda du jour, s'il est branché
function ckAgendaHtml(ag) {
  if (!ag.branche) return '';
  const lignes = ag.prochains.length
    ? ag.prochains.map((ev) => `<div class="ck-agenda-ligne niveau-${esc(ev.niveau)}"><span class="ck-agenda-heure mono">${ev.journee ? 'journée' : esc(ev.heure)}</span><span class="ck-agenda-titre">${esc(ev.titre)}</span></div>`).join('')
    : '<p class="muted small">Plus rien dans l’agenda aujourd’hui.</p>';
  return `<div class="card ck-12 ck-agenda"><div class="spread"><h2>Agenda du jour</h2><span class="chip faint">${ckPluriel(ag.total, 'événement', 'événements')}</span></div><div class="ck-agenda-lignes">${lignes}</div></div>`;
}
