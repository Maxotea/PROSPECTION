/* 🧭 Cockpit : tout ce qui se passe, en un écran.
   La vue #/cockpit de l'app, et son mode écran (plein écran, sans menu, texte
   lisible à trois mètres) pour l'iMac qui reste allumé toute la journée.
   Les mêmes chiffres s'ouvrent sur le MacBook, l'iPad et l'iPhone : même
   adresse, même code d'accès, mise en page qui suit l'écran.

   Le poste d'affût, vivant : derrière les cartes, la lunette de visée dérive
   lentement et suit la souris (parallaxe) ; l'horloge bat la seconde, son
   anneau se remplit jusqu'au prochain rafraîchissement ; les chiffres comptent
   quand ils changent, les barres poussent, la jauge respire, le fil des
   dernières actions défile. Tout s'éteint si l'appareil demande moins
   d'animations.

   Rien n'est calculé ici : le serveur (/api/cockpit) donne l'état complet,
   l'écran le dessine et se rafraîchit tout seul. */

let ckEtat = null;        // dernier état reçu du serveur
let ckTimer = null;       // rafraîchissement des données
let ckSeconde = null;     // l'horloge, l'anneau et « mis à jour il y a », chaque seconde
let ckVerrou = null;      // verrou d'écran (le Mac ne s'endort pas en mode écran)
let ckDepuis = 0;         // Date.now() de la dernière mise à jour reçue
let ckPeriode = 60000;    // ms entre deux rafraîchissements
let ckVue = null;         // l'élément #view tant que le Cockpit est affiché
let ckPremier = true;     // première peinture : les entrées s'animent, les chiffres comptent depuis zéro
const ckValeurs = {};     // dernière valeur affichée par chiffre, pour compter de l'ancienne à la nouvelle
const ckFond = { canvas: null, ctx: null, raf: 0, t0: 0, souris: { x: 0, y: 0 }, cible: { x: 0, y: 0 }, defil: 0, lie: false };

const CK_CLE_ECRAN = 'otea-ecran';
const ckMoinsDeMouvement = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function ckIco(nom) { return `<svg class="ico" aria-hidden="true"><use href="#i-${nom}"/></svg>`; }
function ckKeur(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(v).toLocaleString('fr-FR')} €`;
}
function ckPluriel(n, un, plusieurs) { return `${n} ${n > 1 ? plusieurs : un}`; }
function ckDepuisTexte() {
  if (!ckDepuis) return '';
  const s = Math.round((Date.now() - ckDepuis) / 1000);
  if (s < 10) return 'à jour';
  if (s < 90) return `il y a ${s} s`;
  return `il y a ${Math.round(s / 60)} min`;
}
function ckDateCourte(j) { return j ? `${j.slice(8, 10)}/${j.slice(5, 7)}` : ''; }

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
  if (!ckVue) return;
  if (document.visibilityState !== 'visible') { ckFondPause(); return; }
  if (ckEnModeEcran()) ckVerrouEcran(true);
  ckFondReprend();
  ckCharger();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ckVue && ckEnModeEcran()) { ckPoserModeEcran(false); ckDessiner(); }
});
addEventListener('hashchange', () => { if (!location.hash.startsWith('#/cockpit')) ckArreter(); });

function ckArreter() {
  if (ckTimer) clearInterval(ckTimer);
  if (ckSeconde) clearInterval(ckSeconde);
  ckTimer = null; ckSeconde = null; ckVue = null; ckPremier = true;
  ckFondDemonter();
  // Le menu revient dès qu'on quitte le Cockpit ; le choix reste mémorisé pour la prochaine fois.
  ckPoserModeEcran(false, { memoriser: false });
}

// ---------------------------------------------------------------- la vue
async function vCockpit(view) {
  ckArreter();
  ckVue = view;
  ckPoserModeEcran(ckModeEcranDemande(), { memoriser: false });
  ckFondMonter();
  await ckCharger();
  ckPeriode = Math.max(15, (ckEtat && ckEtat.rafraichissement_s) || 60) * 1000;
  ckTimer = setInterval(ckCharger, ckPeriode);
  ckSeconde = setInterval(ckTic, 1000);
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
    const maj = $('#ck-maj'); if (maj) maj.textContent = `mise à jour impossible : ${e.message}`;
  }
}

// L'horloge bat la seconde ; l'anneau se remplit jusqu'au prochain rafraîchissement.
function ckTic() {
  const d = new Date();
  const hm = $('#ck-hm'); if (hm) hm.textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const s = $('#ck-s'); if (s) s.textContent = String(d.getSeconds()).padStart(2, '0');
  const m = $('#ck-maj'); if (m) m.textContent = ckDepuisTexte();
  const anneau = $('#ck-anneau'); if (anneau && ckDepuis) {
    const avance = Math.min(1, (Date.now() - ckDepuis) / ckPeriode);
    anneau.style.strokeDashoffset = String(Math.round((1 - avance) * 1000) / 10);
  }
}

function ckDessiner() {
  if (!ckVue || !ckEtat) return;
  const E = ckEtat;
  const ecran = ckEnModeEcran();
  const d = new Date();
  let i = 0;
  const idx = () => `style="--i:${i++}"`;
  ckVue.innerHTML = `
    <div class="view-header spread ck-tete">
      <div>
        <h1>🧭 Cockpit</h1>
        <div class="sub">${esc(E.jour_long)} · <span id="ck-maj">${ckDepuisTexte()}</span></div>
      </div>
      <div class="row ck-outils">
        <div class="ck-cadran" title="L’anneau se remplit jusqu’au prochain rafraîchissement">
          <svg class="ck-anneau-svg" viewBox="0 0 48 48" aria-hidden="true"><circle class="ck-anneau-fond" cx="24" cy="24" r="21"/><circle id="ck-anneau" class="ck-anneau-avance" cx="24" cy="24" r="21" pathLength="100"/></svg>
          <div class="ck-heure" aria-live="off"><span id="ck-hm">${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span><span class="ck-sec" id="ck-s">${String(d.getSeconds()).padStart(2, '0')}</span></div>
        </div>
        <button type="button" class="ghost" id="ck-rafraichir" title="Recharger les chiffres maintenant">Actualiser</button>
        <button type="button" class="${ecran ? 'ghost' : ''}" id="ck-ecran" title="${ecran ? 'Revenir à l’app, avec le menu (Échap)' : 'Plein écran, sans menu, pour l’iMac'}">${ckIco('ecran')} ${ecran ? 'Quitter le mode écran' : 'Mode écran'}</button>
      </div>
    </div>
    <section class="ck-grille ${ckPremier && !ckMoinsDeMouvement() ? 'ck-entree' : ''}" aria-label="Tableau de bord">
      ${ckHeroHtml(E.argent, idx)}
      ${ckTuilesArgent(E.argent, idx)}
      ${ckPlanHtml(E.plan, idx)}
      <div class="card ck-5 ck-haut ${E.journee.vitaux ? 'bord-alerte' : ''}" ${idx()}>${ckJourneeHtml(E.journee)}</div>
      <div class="card ck-3 ck-haut" ${idx()}>${ckRelancesHtml(E)}</div>
      <div class="card ck-4 ck-haut" ${idx()}><div class="spread"><h2>Pipeline</h2>${ckConversionChip(E.conversion)}</div>${ckPipelineHtml(E.pipeline)}</div>
      <div class="card ck-8 ck-graph" ${idx()}><div class="spread"><h2>Facturé par mois</h2><span class="chip faint ck-detail">devis marqués « facturé »</span></div>${ckGrapheMois(E.ca_mois, ecran ? 120 : 170)}</div>
      <div class="card ck-4 ck-graph" ${idx()}>${ckActiviteHtml(E)}</div>
      ${ckAgendaHtml(E.agenda, idx)}
      ${ckFilHtml(E.fil, idx)}
    </section>`;

  $('#ck-rafraichir').onclick = ckCharger;
  $('#ck-ecran').onclick = () => { ckPoserModeEcran(!ckEnModeEcran()); ckPremier = true; ckDessiner(); };
  $$('[data-open-contact]', ckVue).forEach((el) => { el.onclick = (e) => { e.preventDefault(); openContact(el.dataset.openContact); }; });
  ckCompterLesChiffres();
  ckTic();
  ckPremier = false;
  if (window.habillerVue) window.habillerVue('cockpit');
}

// ---------------------------------------------------------------- les chiffres comptent
// Chaque grand chiffre porte sa valeur et son format ; on l'anime de la valeur
// précédente à la nouvelle (de zéro à la première peinture).
function ckChiffre(cle, valeur, fmt = 'eur') {
  return `<span class="ck-compte" data-ck-cle="${esc(cle)}" data-ck-val="${Number(valeur) || 0}" data-ck-fmt="${fmt}">${ckFormat(valeur, fmt)}</span>`;
}
function ckFormat(v, fmt) {
  const n = Number(v) || 0;
  if (fmt === 'eur') return eur(n);
  if (fmt === 'keur') return ckKeur(n);
  return String(Math.round(n));
}
function ckCompterLesChiffres() {
  const statique = ckMoinsDeMouvement();
  $$('.ck-compte', ckVue).forEach((el) => {
    const cle = el.dataset.ckCle;
    const vers = Number(el.dataset.ckVal) || 0;
    const fmt = el.dataset.ckFmt;
    const de = cle in ckValeurs ? ckValeurs[cle] : 0;
    ckValeurs[cle] = vers;
    if (statique || de === vers) { el.textContent = ckFormat(vers, fmt); return; }
    const debut = performance.now();
    const duree = ckPremier ? 900 : 650;
    const pas = (t) => {
      const p = Math.min(1, (t - debut) / duree);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = ckFormat(de + (vers - de) * e, fmt);
      if (p < 1) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
  });
}

// ---------------------------------------------------------------- 💰 l'argent : une tuile héros et trois tuiles
function ckLigneArgent(l, { montant = true } = {}) {
  return `<span class="ck-ligne-argent" data-open-contact="${l.contact_id}" role="link" tabindex="0">
    <span class="ck-ligne-qui"><b>${esc(l.societe || l.nom)}</b>${l.societe ? ` <span class="muted">${esc(l.nom)}</span>` : ''}</span>
    ${montant ? `<span class="ck-ligne-montant">${eur(l.montant)}</span>` : ''}
    <span class="ck-ligne-jours ${l.jours >= 7 ? 'tard' : ''}">${l.jours} j</span>
  </span>`;
}
function ckHeroHtml(A, idx) {
  const f = A.a_facturer;
  if (f.n) {
    return `<a class="ck-tuile ck-hero vital" href="#/pipeline" ${idx()}>
      <div class="ck-l">À facturer<span class="ck-l-note">${ckPluriel(f.n, 'devis accepté', 'devis acceptés')}, pas encore facturé${f.n > 1 ? 's' : ''}</span></div>
      <div class="ck-n">${ckChiffre('a_facturer', f.total)}</div>
      <div class="ck-lignes">${f.lignes.slice(0, 3).map((l) => ckLigneArgent(l)).join('')}</div>
      <div class="ck-s">${f.plus_vieux_j ? `Le plus ancien attend depuis <b>${f.plus_vieux_j} j</b>. Chaque jour de plus repousse l’encaissement d’autant.` : 'Accepté aujourd’hui : facture-le avant ce soir.'}</div>
    </a>`;
  }
  const d = A.devis_en_cours;
  return `<a class="ck-tuile ck-hero calme" href="#/pipeline" ${idx()}>
    <div class="ck-l">À facturer<span class="ck-l-note">rien n’attend</span></div>
    <div class="ck-n">${ckChiffre('a_facturer', 0)}</div>
    ${d.lignes.length ? `<div class="ck-lignes"><div class="ck-lignes-titre">En attente de réponse</div>${d.lignes.slice(0, 3).map((l) => ckLigneArgent(l)).join('')}</div>` : ''}
    <div class="ck-s">Chaque devis accepté est facturé. ${d.a_relancer ? `<b>${ckPluriel(d.a_relancer, 'devis attend une relance', 'devis attendent une relance')}.</b>` : 'La prochaine facture viendra d’un devis signé.'}</div>
  </a>`;
}
function ckTuile({ classe = '', libelle, valeur, sous, href, idx }) {
  return `<a class="ck-tuile ${classe}" href="${href}" ${idx()}>
    <div class="ck-l">${libelle}</div>
    <div class="ck-n">${valeur}</div>
    <div class="ck-s">${sous}</div>
  </a>`;
}
function ckTuilesArgent(A, idx) {
  const d = A.devis_en_cours, q = A.devis_a_faire, m = A.facture_mois;
  return [
    ckTuile({
      idx, classe: d.a_relancer ? 'attention' : '', libelle: 'Devis en attente', valeur: ckChiffre('devis', d.total), href: '#/pipeline',
      sous: d.n ? `${ckPluriel(d.n, 'devis envoyé', 'devis envoyés')}${d.a_relancer ? ` · <b>${d.a_relancer} à relancer</b>` : ' · relancés'}` : 'Aucun devis envoyé en attente',
    }),
    ckTuile({
      idx, classe: q.n ? 'attention' : '', libelle: 'Devis à faire', valeur: ckChiffre('devis_a_faire', q.n, 'n'), href: '#/journee',
      sous: q.n ? `RDV sans devis${q.plus_vieux_j ? ` · le plus ancien : <b>${q.plus_vieux_j} j</b>` : ''}` : 'Chaque RDV a son devis',
    }),
    ckTuile({
      idx, classe: m.total ? 'succes' : '', libelle: 'Facturé ce mois', valeur: ckChiffre('facture_mois', m.total), href: '#/pipeline',
      sous: m.n ? ckPluriel(m.n, 'facture', 'factures') : 'Pas encore de facture ce mois-ci',
    }),
  ].join('');
}

// ---------------------------------------------------------------- 🎯 le plan : une piste, trois paliers, le repère du jour
function ckPlanHtml(P, idx) {
  const pct = (v) => Math.min(100, Math.round((v / P.paliers.wow) * 1000) / 10);
  const noms = { moyen: 'Moyen', bien: 'Bien', wow: 'Wow' };
  const ordre = ['moyen', 'bien', 'wow'];
  const atteintIdx = ordre.indexOf(P.atteint);
  const paliers = ordre.map((k, i) => `<div class="ck-palier ${i <= atteintIdx ? 'atteint' : ''}" style="left:${pct(P.paliers[k])}%"><span>${noms[k]} · ${ckKeur(P.paliers[k])}</span></div>`).join('');
  const phrase = P.atteint === 'wow'
    ? 'Palier Wow atteint. Monte les paliers dans Réglages.'
    : P.prochain
      ? `Il manque <b>${eur(P.prochain.manque)}</b> pour le palier ${noms[P.prochain.nom]}${P.atteint ? ` (${noms[P.atteint]} atteint)` : ''}.`
      : '';
  // Le repère du jour : où en est le temps sur la même piste. La barre devant le
  // repère, c'est de l'avance ; derrière, du retard sur le rythme du palier Wow.
  const repere = Math.round(P.avancement * 1000) / 10;
  return `<div class="card ck-12 ck-plan" ${idx()}>
    <div class="spread">
      <div>
        <div class="ck-l">Facturé du ${ckDateCourte(P.debut)} au ${ckDateCourte(P.fin)}</div>
        <div class="ck-n">${ckChiffre('plan', P.total)}<small> · ${ckPluriel(P.n, 'facture', 'factures')}</small></div>
      </div>
      <div class="a-droite">
        <div class="ck-l">J-${P.jours_restants}</div>
        <div class="ck-plan-phrase">${phrase}</div>
      </div>
    </div>
    <div class="ck-piste" role="img" aria-label="Facturé ${eur(P.total)} sur un objectif Wow de ${eur(P.paliers.wow)}, ${Math.round(P.avancement * 100)} % du temps écoulé">
      <div class="ck-jauge ${P.atteint ? 'ok' : ''}"><i style="width:${pct(P.total)}%"></i>${paliers}</div>
      <div class="ck-repere" style="left:${repere}%"><span>aujourd’hui · ${Math.round(P.avancement * 100)} % du temps</span></div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- 📈 facturé par mois : barres en encre, grille légère, libellés directs
function ckGrapheMois(mois, H = 170) {
  const W = 600, padL = 12, padR = 12, padB = 30, padT = 26;
  const max = Math.max(...mois.map((m) => m.total), 1);
  const bw = (W - padL - padR) / mois.length;
  const haut = H - padT - padB;
  const grille = [0.5, 1].map((f) => `<line class="ck-grille-l" x1="${padL}" y1="${padT + haut * (1 - f)}" x2="${W - padR}" y2="${padT + haut * (1 - f)}"/>`).join('');
  const barres = mois.map((m, i) => {
    const h = m.total ? Math.max(3, (m.total / max) * haut) : 0;
    const x = padL + i * bw + bw * 0.2;
    const w = bw * 0.6;
    const y = H - padB - h;
    const r = Math.min(5, h / 2);
    const forme = h ? `<path class="ck-barre ${m.courant ? 'courant' : ''}" style="--i:${i}" d="M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z"><title>${m.libelle} ${m.annee} : ${eur(m.total)} (${m.n} facture${m.n > 1 ? 's' : ''})</title></path>` : '';
    return `<g>${forme}
      <text class="ck-val ${m.total ? '' : 'vide'}" x="${x + w / 2}" y="${(h ? y : H - padB) - 8}" text-anchor="middle">${m.total ? ckKeur(m.total) : '0'}</text>
      <text class="ck-mois ${m.courant ? 'courant' : ''}" x="${x + w / 2}" y="${H - 9}" text-anchor="middle">${m.libelle}</text></g>`;
  }).join('');
  const table = `<table class="sr-only"><caption>Facturé par mois</caption><tbody>${mois.map((m) => `<tr><th>${m.libelle} ${m.annee}</th><td>${eur(m.total)}</td></tr>`).join('')}</tbody></table>`;
  return `<svg class="ck-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Facturé par mois sur six mois">${grille}<line class="ck-base" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"/>${barres}</svg>${table}`;
}

// ---------------------------------------------------------------- 📊 pipeline : contacts par étape, euros en face
function ckConversionChip(C) {
  if (C.taux === null) return `<span class="chip faint" title="Aucun devis créé sur ${C.jours} jours">pas de devis sur ${C.jours} j</span>`;
  return `<span class="chip ${C.taux >= 0.5 ? 'ok' : ''}" title="${C.signes} devis signés (acceptés ou facturés) sur ${C.envoyes} envoyés depuis ${C.jours} jours">${Math.round(C.taux * 100)} % signés · ${C.signes}/${C.envoyes} sur ${C.jours} j</span>`;
}
function ckPipelineHtml(stages) {
  const rows = stages.filter((s) => s.code !== 'perdu');
  const max = Math.max(...rows.map((s) => s.count), 1);
  return `<div class="ck-pipe">${rows.map((s, i) => {
    const pct = Math.round((s.count / max) * 100);
    const mix = 30 + Math.round((i / Math.max(rows.length - 1, 1)) * 65);
    return `<div class="funnel-row" style="--i:${i}"><div class="f-label">${s.emoji} ${esc(s.label)}</div>
      <div class="f-bar"><i style="width:${pct}%; background: color-mix(in srgb, var(--encre) ${mix}%, var(--trait-fort))"></i></div>
      <div class="f-n">${s.count}</div>
      <div class="f-eur ${s.montant ? '' : 'vide'}">${s.montant ? ckKeur(s.montant) : ''}</div></div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- ☀️ la journée : les trois choses qui comptent
function ckJourneeHtml(J) {
  const ess = J.essentiels.map((it, i) => {
    const cible = it.action && it.action.type === 'contact' && it.action.id
      ? `href="#/contacts" data-open-contact="${it.action.id}"`
      : `href="${it.action && it.action.href ? esc(it.action.href) : '#/journee'}"`;
    return `<a class="ck-ess" ${cible} style="--i:${i}">
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
    <div class="ck-ess-liste">${ess || '<p class="muted">Rien d’urgent. Mails, WhatsApp, appels et CRM sont lus en continu.</p>'}</div>
    ${J.reste ? `<p class="muted small mt-3">et ${ckPluriel(J.reste, 'autre chose', 'autres choses')} dans Ma journée</p>` : ''}`;
}

// ---------------------------------------------------------------- 🔔 relances, réponses, autopilote
function ckChiffreCarte(n, l, { alerte = false, href = '', cle = '' } = {}) {
  const corps = `<div class="ck-n">${cle ? ckChiffre(cle, n, 'n') : n}</div><div class="ck-l">${l}</div>`;
  return href ? `<a class="ck-chiffre ${alerte ? 'alerte' : ''}" href="${href}">${corps}</a>` : `<div class="ck-chiffre ${alerte ? 'alerte' : ''}">${corps}</div>`;
}
function ckRelancesHtml(E) {
  const R = E.relances, Q = E.reponses, A = E.autopilote;
  const auto = !A.configured
    ? '<span class="chip due">à brancher</span>'
    : A.enabled
      ? `<span class="chip ok"><i class="ck-point-vif" aria-hidden="true"></i>actif</span> ${A.sent_today}/${A.daily_cap} envoyés${A.awaiting ? ` · <b class="texte-or">${A.awaiting} à valider</b>` : ''}`
      : `<span class="chip">en veille</span>${A.awaiting ? ` · <b class="texte-or">${A.awaiting} à valider</b>` : ''}`;
  return `<h2>Relances et réponses</h2>
    <div class="ck-duo">
      ${ckChiffreCarte(R.dues, R.dues ? `relance${R.dues > 1 ? 's' : ''} due${R.dues > 1 ? 's' : ''}${R.plus_vieille_j ? `, la plus vieille : ${R.plus_vieille_j} j` : ''}` : 'relance due', { alerte: R.plus_vieille_j >= 7, href: '#/chasse', cle: 'relances' })}
      ${ckChiffreCarte(Q.a_traiter, Q.a_traiter ? `réponse${Q.a_traiter > 1 ? 's' : ''} à traiter` : 'réponse à traiter', { alerte: Q.a_traiter > 0, href: '#/inbox', cle: 'reponses' })}
    </div>
    <div class="ck-ligne-info"><span class="muted small">${R.chaudes ? `${ckPluriel(R.chaudes, 'contact chaud', 'contacts chauds')} dans les relances dues · ` : ''}${ckPluriel(Q.recues_7j, 'réponse reçue', 'réponses reçues')} sur 7 j</span></div>
    <div class="ck-ligne-info"><a href="#/autopilot" class="lien-texte"><b>Autopilote</b></a> ${auto}</div>`;
}

// ---------------------------------------------------------------- ⚡ activité : une courbe en aire, le point du jour qui bat
function ckCourbe(jours) {
  const W = 300, H = 72, padX = 6, padY = 8;
  const max = Math.max(...jours.map((j) => j.n), 1);
  const n = jours.length;
  const px = (i) => padX + (i / (n - 1)) * (W - padX * 2);
  const py = (v) => H - padY - (v / max) * (H - padY * 2);
  // Courbe lissée : une tangente moyenne à chaque point, en cubiques.
  const pts = jours.map((j, i) => [px(i), py(j.n)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  const aire = `${d} L${pts[n - 1][0]},${H - padY} L${pts[0][0]},${H - padY} Z`;
  const fin = pts[n - 1];
  const table = `<table class="sr-only"><caption>Actions par jour</caption><tbody>${jours.map((j) => `<tr><th>${j.day}</th><td>${j.n}</td></tr>`).join('')}</tbody></table>`;
  return `<svg class="ck-courbe" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Actions par jour sur 14 jours">
    <path class="ck-aire" d="${aire}"/>
    <path class="ck-trait" d="${d}" pathLength="100"/>
    <circle class="ck-halo" cx="${fin[0]}" cy="${fin[1]}" r="9"/>
    <circle class="ck-point" cx="${fin[0]}" cy="${fin[1]}" r="4"><title>Aujourd’hui : ${ckPluriel(jours[n - 1].n, 'action', 'actions')}</title></circle>
    ${jours.map((j, i) => `<circle class="ck-cible" cx="${pts[i][0]}" cy="${pts[i][1]}" r="7"><title>${j.day.slice(8, 10)}/${j.day.slice(5, 7)} : ${ckPluriel(j.n, 'action', 'actions')} · ${j.xp} XP</title></circle>`).join('')}
  </svg>${table}`;
}
function ckActiviteHtml(E) {
  const total = E.activite.reduce((s, j) => s + j.n, 0);
  const aujourdhui = E.activite[E.activite.length - 1];
  const J = E.jeu;
  return `<div class="spread"><h2>Activité</h2><span class="chip">${ckPluriel(total, 'action', 'actions')} sur 14 j</span></div>
    <p class="muted small ck-sous-titre">Aujourd’hui : ${ckPluriel(aujourdhui.n, 'action', 'actions')}, ${aujourdhui.xp} XP${E.campagne ? ` · campagne « ${esc(E.campagne.name)} » ${({ a_venir: 'à venir', en_cours: 'en cours', terminee: 'terminée' })[E.campagne.status] || ''}` : ''}</p>
    ${ckCourbe(E.activite)}
    <div class="ck-jeu">
      <span>🔥 <b>${J.streak.current}</b> j de suite</span>
      <span>Niveau <b>${J.level.level}</b> · ${esc(J.level.title)}</span>
      <span>🎯 <b>${J.boss.count}</b>/${J.boss.goal} factures</span>
    </div>`;
}

// ---------------------------------------------------------------- 🗓️ l'agenda du jour, s'il est branché
function ckAgendaHtml(ag, idx) {
  if (!ag.branche) return '';
  const lignes = ag.prochains.length
    ? ag.prochains.map((ev) => `<div class="ck-agenda-ligne niveau-${esc(ev.niveau)}"><span class="ck-agenda-heure mono">${ev.journee ? 'journée' : esc(ev.heure)}</span><span class="ck-agenda-titre">${esc(ev.titre)}</span></div>`).join('')
    : '<p class="muted small">Plus rien dans l’agenda aujourd’hui.</p>';
  return `<div class="card ck-12 ck-agenda" ${idx()}><div class="spread"><h2>Agenda du jour</h2><span class="chip faint">${ckPluriel(ag.total, 'événement', 'événements')}</span></div><div class="ck-agenda-lignes">${lignes}</div></div>`;
}

// ---------------------------------------------------------------- 📜 le fil : les dernières actions, qui défilent
function ckQuand(iso) {
  const d = new Date(iso);
  const jour = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const aujourdhui = new Date().toDateString() === d.toDateString();
  return aujourdhui ? h : `${jour} ${h}`;
}
function ckFilHtml(fil, idx) {
  if (!fil || !fil.length) return '';
  const items = fil.map((f) => `<span class="ck-fil-item"><span class="ck-fil-quand mono">${ckQuand(f.quand)}</span><span class="ck-fil-emoji">${f.emoji}</span><span class="ck-fil-texte"><b>${esc(f.label)}</b>${f.nom ? ` · ${esc(f.nom)}${f.societe ? ` <span class="muted">${esc(f.societe)}</span>` : ''}` : ''}</span>${f.xp ? `<span class="ck-fil-xp">+${f.xp}</span>` : ''}</span>`).join('');
  // Le contenu est doublé pour que la bande tourne sans couture.
  return `<div class="ck-fil" ${idx()} aria-label="Dernières actions"><div class="ck-fil-etiquette">Dernières actions</div><div class="ck-fil-fenetre"><div class="ck-fil-piste">${items}${items}</div></div></div>`;
}

// ---------------------------------------------------------------- 🔭 le fond : la lunette de visée qui dérive
// Deux cercles concentriques, les réticules, un balayage lent : dessinés très
// clair derrière les cartes, décalés par la souris et le défilement (le cercle
// proche bouge plus que le lointain : c'est la parallaxe). En mode écran, le
// balayage tourne comme un radar. Sous « moins d'animations », une seule image.
function ckCouleur(nom) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
  const m = v.match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return [23, 24, 28];
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function ckFondMonter() {
  if (ckFond.canvas) return;
  const c = document.createElement('canvas');
  c.id = 'ck-fond';
  c.setAttribute('aria-hidden', 'true');
  document.body.appendChild(c);
  document.documentElement.classList.add('ck-actif');
  ckFond.canvas = c;
  ckFond.ctx = c.getContext('2d');
  ckFond.t0 = performance.now();
  if (!ckFond.lie) {
    ckFond.lie = true;
    addEventListener('pointermove', (e) => {
      if (!ckFond.canvas || (e.pointerType && e.pointerType !== 'mouse')) return;
      ckFond.cible.x = e.clientX / innerWidth - 0.5;
      ckFond.cible.y = e.clientY / innerHeight - 0.5;
    }, { passive: true });
    addEventListener('scroll', () => { if (ckFond.canvas) ckFond.defil = scrollY; }, { passive: true });
    addEventListener('resize', () => { if (ckFond.canvas) ckFondTaille(); });
  }
  ckFondTaille();
  if (ckMoinsDeMouvement()) ckFondPeindre(0);
  else ckFondReprend();
}
function ckFondTaille() {
  const c = ckFond.canvas;
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = Math.round(innerWidth * dpr);
  c.height = Math.round(innerHeight * dpr);
  ckFond.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function ckFondPause() { if (ckFond.raf) cancelAnimationFrame(ckFond.raf); ckFond.raf = 0; }
function ckFondReprend() {
  if (!ckFond.canvas || ckFond.raf || ckMoinsDeMouvement()) return;
  const boucle = (t) => { ckFondPeindre(t - ckFond.t0); ckFond.raf = requestAnimationFrame(boucle); };
  ckFond.raf = requestAnimationFrame(boucle);
}
function ckFondDemonter() {
  ckFondPause();
  if (ckFond.canvas) ckFond.canvas.remove();
  document.documentElement.classList.remove('ck-actif');
  ckFond.canvas = null; ckFond.ctx = null;
}
function ckFondPeindre(t) {
  const ctx = ckFond.ctx; if (!ctx) return;
  const W = innerWidth, H = innerHeight;
  const s = t / 1000;
  // La souris est suivie avec retard, pour que le fond glisse au lieu de sauter.
  ckFond.souris.x += (ckFond.cible.x - ckFond.souris.x) * 0.04;
  ckFond.souris.y += (ckFond.cible.y - ckFond.souris.y) * 0.04;
  const [r, g, b] = ckCouleur('--encre');
  const [ar, ag, ab] = ckCouleur('--accent');
  const encre = (a) => `rgba(${r}, ${g}, ${b}, ${a})`;
  const sombre = document.documentElement.dataset.theme === 'sombre' || (document.documentElement.dataset.theme !== 'clair' && matchMedia('(prefers-color-scheme: dark)').matches);
  const alpha = sombre ? 1.9 : 1.5;
  ctx.clearRect(0, 0, W, H);

  const ecran = ckEnModeEcran();
  const R = Math.max(W, H) * (ecran ? 0.62 : 0.55);
  // Le centre de la lunette : en haut à droite, dérive lente, souris et défilement.
  const cx = W * 0.82 + Math.sin(s / 23) * 26 + ckFond.souris.x * 28;
  const cy = H * 0.18 + Math.cos(s / 31) * 18 + ckFond.souris.y * 20 - ckFond.defil * 0.18;

  ctx.lineWidth = 1;
  // Cercle lointain : bouge peu.
  const loin = { x: cx - ckFond.souris.x * 10, y: cy - ckFond.souris.y * 8 };
  ctx.strokeStyle = encre(0.05 * alpha);
  ctx.beginPath(); ctx.arc(loin.x, loin.y, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(loin.x, loin.y, R * 0.72, 0, Math.PI * 2); ctx.stroke();
  // Graduations sur le cercle lointain : une tous les 6 degrés, plus longue tous les 30.
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 + s / 180;
    const l = i % 5 === 0 ? 14 : 6;
    ctx.beginPath();
    ctx.moveTo(loin.x + Math.cos(a) * (R * 0.72), loin.y + Math.sin(a) * (R * 0.72));
    ctx.lineTo(loin.x + Math.cos(a) * (R * 0.72 - l), loin.y + Math.sin(a) * (R * 0.72 - l));
    ctx.stroke();
  }
  // Cercle proche : bouge plus, avec les réticules.
  const pres = { x: cx + ckFond.souris.x * 22, y: cy + ckFond.souris.y * 16 };
  ctx.strokeStyle = encre(0.07 * alpha);
  ctx.beginPath(); ctx.arc(pres.x, pres.y, R * 0.42, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(pres.x, pres.y, R * 0.12, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.moveTo(pres.x - R * 0.5, pres.y); ctx.lineTo(pres.x + R * 0.5, pres.y);
  ctx.moveTo(pres.x, pres.y - R * 0.5); ctx.lineTo(pres.x, pres.y + R * 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = encre(0.12 * alpha);
  ctx.beginPath(); ctx.arc(pres.x, pres.y, 2.2, 0, Math.PI * 2); ctx.fill();

  // Le balayage : un secteur très clair qui tourne (seulement en mode écran, et si le navigateur sait).
  if (ecran && ctx.createConicGradient) {
    const angle = (s / 14) * Math.PI * 2;
    const grad = ctx.createConicGradient(angle, pres.x, pres.y);
    grad.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, 0)`);
    grad.addColorStop(0.08, `rgba(${ar}, ${ag}, ${ab}, ${0.06 * alpha})`);
    grad.addColorStop(0.1, `rgba(${ar}, ${ag}, ${ab}, 0)`);
    grad.addColorStop(1, `rgba(${ar}, ${ag}, ${ab}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(pres.x, pres.y, R * 0.72, 0, Math.PI * 2); ctx.fill();
  }
}
