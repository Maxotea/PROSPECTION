'use strict';
/* La coque d'OTEA Moteur : thème, navigation (menu replié, feuille « Plus »
   au téléphone), palette de commandes (Ctrl K ou ⌘K), raccourcis clavier,
   premier lancement guidé, et l'habillage des écrans (icônes au trait à la
   place des emoji qui portaient la structure).
   Chargé après app.js : utilise ses helpers ($, $$, esc, api, modal,
   fermerFenetre, openContact, fx, render). Rien ici ne touche aux données. */

(() => {
  const racine = document.documentElement;
  const ico = (nom) => `<svg class="ico" aria-hidden="true"><use href="#i-${nom}"/></svg>`;
  const lire = (cle, defaut) => { try { return localStorage.getItem(cle) ?? defaut; } catch { return defaut; } };
  const ecrire = (cle, val) => { try { localStorage.setItem(cle, val); } catch { /* navigation privée */ } };
  const estMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const touche = estMac ? '⌘' : 'Ctrl';
  const kbdCmd = $('.kbd-cmd');
  if (kbdCmd) kbdCmd.textContent = `${touche} K`;

  // ------------------------------------------------------------ écrans
  const ECRANS = [
    { vue: 'journee', titre: 'Ma journée', ico: 'journee', lettre: 'j', aide: 'Les 3 choses du jour, le vide-cerveau, l’agenda' },
    { vue: 'qg', titre: 'Quartier général', ico: 'qg', lettre: 'q', aide: 'Objectif factures, chiffres, quêtes, badges' },
    { vue: 'chasse', titre: 'La Chasse', ico: 'chasse', lettre: 'c', aide: 'Les prospects un par un, message prêt' },
    { vue: 'autopilot', titre: 'Autopilote', ico: 'autopilot', lettre: 'a', aide: 'Séquences email, emails à valider' },
    { vue: 'campagnes', titre: 'Campagnes', ico: 'campagnes', lettre: 'm', aide: 'Une semaine, un secteur' },
    { vue: 'pipeline', titre: 'Pipeline', ico: 'pipeline', lettre: 'p', aide: 'Les prospects par étape' },
    { vue: 'contacts', titre: 'Contacts', ico: 'contacts', lettre: 'o', aide: 'Tout le CRM, filtres et actions groupées' },
    { vue: 'inbox', titre: 'Réponses', ico: 'inbox', lettre: 'r', aide: 'Demandes entrantes et réponses' },
    { vue: 'import', titre: 'Imports', ico: 'import', lettre: 'i', aide: 'Pennylane, CSV, LinkedIn, enrichissement' },
    { vue: 'reglages', titre: 'Réglages', ico: 'reglages', lettre: 's', aide: 'Gmail, agenda, IA, objectifs' },
  ];
  const ecranCourant = () => (location.hash.replace('#/', '') || 'journee');
  const aller = (vue) => { if (ecranCourant() === vue) render(); else location.hash = '#/' + vue; };

  // Aller sur un écran puis y déclencher un bouton, dès qu'il est affiché.
  function allerPuis(vue, selecteur, faire = (el) => el.click()) {
    if (ecranCourant() !== vue) location.hash = '#/' + vue;
    const debut = Date.now();
    const essai = () => {
      const el = $(selecteur);
      if (el && !el.closest('.squelette')) { faire(el); return; }
      if (Date.now() - debut < 4000) setTimeout(essai, 80);
    };
    setTimeout(essai, 60);
  }

  // ------------------------------------------------------------ thème
  const THEMES = { auto: { suivant: 'clair', nom: 'Auto (suit l’appareil)', ico: 'auto' }, clair: { suivant: 'sombre', nom: 'Clair', ico: 'clair' }, sombre: { suivant: 'auto', nom: 'Sombre', ico: 'lune' } };
  function poserTheme(t) {
    if (t === 'auto') delete racine.dataset.theme; else racine.dataset.theme = t;
    ecrire('otea_theme', t);
    const b = $('#theme-toggle');
    b.innerHTML = ico(THEMES[t].ico);
    b.title = `Thème : ${THEMES[t].nom}`;
    b.setAttribute('aria-label', `Thème : ${THEMES[t].nom}. Changer de thème`);
  }
  function themeSuivant() {
    const t = THEMES[lire('otea_theme', 'auto')] ? lire('otea_theme', 'auto') : 'auto';
    const n = THEMES[t].suivant;
    poserTheme(n);
    fx.toast(`Thème : ${THEMES[n].nom}`, '', 1800);
  }
  poserTheme(THEMES[lire('otea_theme', 'auto')] ? lire('otea_theme', 'auto') : 'auto');
  $('#theme-toggle').onclick = themeSuivant;

  // ------------------------------------------------------------ menu
  function replierMenu() {
    const replie = racine.dataset.nav === 'replie';
    if (replie) delete racine.dataset.nav; else racine.dataset.nav = 'replie';
    ecrire('otea_nav', replie ? 'ouvert' : 'replie');
    majReplier();
  }
  function majReplier() {
    const replie = racine.dataset.nav === 'replie';
    const b = $('#nav-replier');
    b.title = replie ? 'Déplier le menu ( [ )' : 'Replier le menu ( [ )';
    b.setAttribute('aria-label', replie ? 'Déplier le menu' : 'Replier le menu');
    b.setAttribute('aria-expanded', replie ? 'false' : 'true');
    // Menu replié : chaque lien garde son nom en info-bulle.
    $$('#sidebar > a[data-view]').forEach((a) => { if (replie) a.title = a.textContent.trim(); else a.removeAttribute('title'); });
  }
  $('#nav-replier').onclick = replierMenu;
  majReplier();

  // Téléphone : « Plus » ouvre le menu complet en feuille.
  const plus = $('#tab-plus');
  function feuilleNav(ouvrir) {
    racine.classList.toggle('nav-ouverte', ouvrir);
    $('#nav-voile').classList.toggle('hidden', !ouvrir);
    plus.setAttribute('aria-expanded', ouvrir ? 'true' : 'false');
    if (ouvrir) { const a = $('#sidebar > a.active') || $('#sidebar > a'); if (a) a.focus(); }
  }
  plus.onclick = () => feuilleNav(!racine.classList.contains('nav-ouverte'));
  $('#nav-voile').onclick = () => feuilleNav(false);
  $$('#sidebar > a').forEach((a) => a.addEventListener('click', () => feuilleNav(false)));

  // ------------------------------------------------------------ habillage des écrans
  // Les emoji restent dans le contenu (typologies, badges, messages) mais ne
  // portent plus la structure : titres et boutons perdent leur emoji de tête,
  // et le titre de chaque écran reçoit son icône au trait.
  const EMOJI_TETE = /^(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]+\s*)+/u;
  // Boutons qui n'étaient qu'un emoji (crayon, croix, poubelle) : une icône au trait.
  // Écrits en échappements : jamais de caractère invisible (sélecteur de variante) en dur.
  const BOUTONS_ICONES = {
    '\u270F\uFE0F': ['crayon', 'Modifier'], '\u270F': ['crayon', 'Modifier'],
    '\u2716': ['fermer', 'Retirer'], '\u2716\uFE0F': ['fermer', 'Retirer'], '\u2715': ['fermer', 'Retirer'],
    '\u{1F5D1}': ['poubelle', 'Supprimer'], '\u{1F5D1}\uFE0F': ['poubelle', 'Supprimer'],
  };
  function premierTexte(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) return n; continue; }
      if (n.nodeType !== 1) continue;
      if (n.nodeName.toLowerCase() === 'svg' || n.classList.contains('vue-ico')) continue;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(n.nodeName) || n.classList.contains('chip')) return null;
      return premierTexte(n);
    }
    return null;
  }
  function retirerEmojiDeTete(el) {
    const t = premierTexte(el);
    if (!t) return;
    const avant = t.nodeValue;
    const lead = avant.match(/^\s*/)[0];
    const reste = avant.slice(lead.length).replace(EMOJI_TETE, '');
    if (reste.length !== avant.length - lead.length) {
      // Ne jamais vider un bouton : s'il ne reste rien, l'emoji était tout le libellé.
      if (!reste.trim() && el.textContent.trim() === avant.trim()) return;
      t.nodeValue = lead + reste;
    }
  }
  function habiller(racineDom) {
    $$('h1, h2, h3, h4, .kpi .l, .boss-title, .j-titre, .kcol h3 > span:first-child, .view-header .sub', racineDom).forEach(retirerEmojiDeTete);
    $$('button, a.btn', racineDom).forEach((b) => {
      if (b.closest('#tabbar, #sidebar, .toast, .modal.celebration')) return;
      const texte = b.textContent.trim();
      const icone = BOUTONS_ICONES[texte];
      if (icone && !b.querySelector('svg')) {
        b.innerHTML = ico(icone[0]);
        if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', b.title || icone[1]);
        if (!b.title) b.title = icone[1];
        b.classList.add('ico-btn');
      } else if (texte) retirerEmojiDeTete(b);
    });
  }

  // Fenêtres et fiche : rôle annoncé, focus posé dedans à l'ouverture.
  const dejaVues = new WeakSet();
  function accessibilite() {
    $$('#modal-root .modal-backdrop').forEach((w) => {
      if (dejaVues.has(w)) return;
      dejaVues.add(w);
      const m = $('.modal', w);
      if (!m) return;
      m.setAttribute('role', 'dialog');
      m.setAttribute('aria-modal', 'true');
      const titre = $('h2', m);
      if (titre) { titre.id = titre.id || `fenetre-${Date.now()}`; m.setAttribute('aria-labelledby', titre.id); }
      if (!m.contains(document.activeElement)) {
        const premier = $('input:not([type="hidden"]):not([disabled]), textarea, select, button.primary, button', m);
        if (premier) premier.focus({ preventScroll: true });
      }
    });
    const fiche = $('#drawer');
    const fermer = $('#d-close', fiche);
    if (fermer && !fiche.classList.contains('hidden') && !fermer.dataset.focus) {
      fermer.dataset.focus = '1';
      const h1 = $('h1', fiche);
      if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
    }
  }
  window.habillerVue = (nom) => {
    const view = $('#view');
    const h1 = $('.view-header h1', view);
    const ecran = ECRANS.find((e) => e.vue === nom);
    if (h1 && ecran && !$('.vue-ico', h1)) h1.insertAdjacentHTML('afterbegin', `<span class="vue-ico">${ico(ecran.ico)}</span>`);
    document.title = ecran ? `${ecran.titre} · OTEA Moteur` : 'OTEA Moteur';
    habiller(view);
  };
  // Tout ce qui s'affiche après coup (fiche, fenêtres, listes rechargées) est habillé aussi.
  let enAttente = false;
  const observer = new MutationObserver(() => {
    if (enAttente) return;
    enAttente = true;
    requestAnimationFrame(() => {
      enAttente = false;
      observer.disconnect();
      ['#view', '#drawer', '#modal-root'].forEach((s) => habiller($(s)));
      accessibilite();
      const h1 = $('#view .view-header h1');
      const ecran = ECRANS.find((e) => e.vue === ecranCourant());
      if (h1 && ecran && !$('.vue-ico', h1)) h1.insertAdjacentHTML('afterbegin', `<span class="vue-ico">${ico(ecran.ico)}</span>`);
      brancher();
    });
  });
  const brancher = () => ['#view', '#drawer', '#modal-root'].forEach((s) => observer.observe($(s), { childList: true, subtree: true }));
  brancher();


  // ------------------------------------------------------------ palette de commandes
  let palette = null;
  function actions() {
    return [
      { titre: 'Ajouter une chose à faire', sous: 'Dans le vide-cerveau de Ma journée', ico: 'plus', cles: 'tache todo vide cerveau', faire: () => allerPuis('journee', '#j-texte', (el) => el.focus()) },
      { titre: 'Nouveau contact', sous: 'Fiche vierge dans Contacts', ico: 'contacts', cles: 'creer ajouter prospect', faire: () => allerPuis('contacts', '#c-new') },
      { titre: 'Lancer une session de prospection', sous: 'La Chasse, les prospects un par un', ico: 'chasse', cles: 'chasse session prospection', faire: () => allerPuis('chasse', '#hunt-start') },
      { titre: 'Lancer la session d’appels', sous: 'Les personnes à joindre aujourd’hui', ico: 'chasse', cles: 'appels telephone call', faire: () => allerPuis('chasse', '#hunt-start-calls') },
      { titre: 'Relire mes boîtes', sous: 'Gmail, WhatsApp, appels, agenda', ico: 'inbox', cles: 'scan mails relire', faire: () => allerPuis('journee', '#j-scan') },
      { titre: 'Créer une séquence email', sous: 'Autopilote', ico: 'autopilot', cles: 'sequence autopilote', faire: () => allerPuis('autopilot', '#seq-new') },
      { titre: 'Changer de thème', sous: 'Clair, sombre ou auto', ico: 'lune', cles: 'theme sombre clair nuit jour', faire: themeSuivant },
      { titre: 'Raccourcis clavier', sous: 'Tout ce qui se fait sans souris', ico: 'clavier', cles: 'aide clavier', faire: aideRaccourcis },
    ];
  }
  const normaliser = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function ouvrirPalette() {
    if (palette) return;
    feuilleNav(false);
    const precedent = document.activeElement;
    const voile = document.createElement('div');
    voile.className = 'palette-voile';
    voile.innerHTML = `
      <div class="palette" role="dialog" aria-modal="true" aria-label="Palette de commandes">
        <div class="palette-champ">${ico('loupe')}<input type="text" placeholder="Aller à un écran, chercher un contact, lancer une action…" aria-label="Rechercher" aria-controls="palette-liste" aria-autocomplete="list" autocomplete="off" spellcheck="false"></div>
        <ul class="palette-liste" id="palette-liste" role="listbox"></ul>
        <div class="palette-pied"><span><kbd>↑</kbd> <kbd>↓</kbd> choisir</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>Échap</kbd> fermer</span><span><kbd>?</kbd> tous les raccourcis</span></div>
      </div>`;
    $('#palette-root').appendChild(voile);
    const champ = $('input', voile);
    const liste = $('.palette-liste', voile);
    let items = [];
    let choix = 0;
    let contacts = [];
    let requete = 0;
    let minuterie = null;

    const fermer = () => { voile.remove(); palette = null; if (precedent && document.contains(precedent)) precedent.focus(); };
    palette = { fermer };
    voile.addEventListener('mousedown', (e) => { if (e.target === voile) fermer(); });

    function dessiner() {
      const q = normaliser(champ.value.trim());
      const correspond = (t) => !q || normaliser(t).includes(q);
      const ecrans = ECRANS.filter((e) => correspond(`${e.titre} ${e.aide}`)).map((e) => ({ groupe: 'Aller à', titre: e.titre, sous: e.aide, ico: e.ico, raccourci: `G ${e.lettre.toUpperCase()}`, faire: () => aller(e.vue) }));
      const acts = actions().filter((a) => correspond(`${a.titre} ${a.sous} ${a.cles}`)).map((a) => ({ groupe: 'Actions', ...a }));
      const pers = contacts.map((c) => ({ groupe: 'Contacts', titre: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'Contact', sous: [c.company, c.job_title].filter(Boolean).join(' · ') || c.email || '', ico: 'contacts', faire: () => openContact(c.id) }));
      items = q ? [...pers, ...ecrans, ...acts] : [...ecrans, ...acts];
      if (choix >= items.length) choix = Math.max(0, items.length - 1);
      let groupe = '';
      liste.innerHTML = items.length ? items.map((it, i) => {
        const tete = it.groupe !== groupe ? `<li class="palette-groupe" role="presentation">${esc(it.groupe)}</li>` : '';
        groupe = it.groupe;
        return `${tete}<li class="palette-item" role="option" id="p-opt-${i}" data-i="${i}" aria-selected="${i === choix}">${ico(it.ico)}<div class="p-texte"><div class="p-titre">${esc(it.titre)}</div>${it.sous ? `<div class="p-sous">${esc(it.sous)}</div>` : ''}</div>${it.raccourci ? `<kbd>${it.raccourci}</kbd>` : ''}</li>`;
      }).join('') : `<li class="palette-vide">Rien ne correspond à « ${esc(champ.value)} ». Essaie un nom, une entreprise ou un écran.</li>`;
      champ.setAttribute('aria-activedescendant', items.length ? `p-opt-${choix}` : '');
      const sel = $(`#p-opt-${choix}`, liste);
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
    function chercherContacts() {
      clearTimeout(minuterie);
      const q = champ.value.trim();
      if (q.length < 2) { contacts = []; dessiner(); return; }
      minuterie = setTimeout(async () => {
        const n = ++requete;
        try {
          const r = await api(`/contacts?${new URLSearchParams({ search: q, limit: '6', offset: '0' })}`);
          if (n === requete && palette) { contacts = r.contacts || []; choix = 0; dessiner(); }
        } catch { /* la recherche de contacts est un bonus : les écrans et actions restent proposés */ }
      }, 160);
    }
    const lancer = (i) => { const it = items[i]; if (!it) return; fermer(); it.faire(); };
    champ.addEventListener('input', () => { choix = 0; dessiner(); chercherContacts(); });
    champ.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); choix = Math.min(items.length - 1, choix + 1); dessiner(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); choix = Math.max(0, choix - 1); dessiner(); }
      else if (e.key === 'Enter') { e.preventDefault(); lancer(choix); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); }
      else if (e.key === 'Tab') e.preventDefault(); // le focus reste dans la palette
    });
    liste.addEventListener('mousemove', (e) => { const li = e.target.closest('[data-i]'); if (li && Number(li.dataset.i) !== choix) { choix = Number(li.dataset.i); dessiner(); } });
    liste.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) lancer(Number(li.dataset.i)); });
    dessiner();
    champ.focus();
  }
  $('#nav-palette').onclick = ouvrirPalette;

  // ------------------------------------------------------------ raccourcis
  const RACCOURCIS = [
    [[touche, 'K'], 'Palette : aller à un écran, chercher un contact, lancer une action'],
    [['/'], 'Ouvrir la palette aussi'],
    [['G', 'J'], 'Ma journée'], [['G', 'Q'], 'Quartier général'], [['G', 'C'], 'La Chasse'], [['G', 'A'], 'Autopilote'],
    [['G', 'M'], 'Campagnes'], [['G', 'P'], 'Pipeline'], [['G', 'O'], 'Contacts'], [['G', 'R'], 'Réponses'],
    [['G', 'I'], 'Imports'], [['G', 'S'], 'Réglages'],
    [['N'], 'Nouveau contact'], [['T'], 'Ajouter une chose à faire'],
    [['1', '…', '5'], 'La Chasse : les actions sur la cible affichée'],
    [['['], 'Replier ou déplier le menu'],
    [['Échap'], 'Fermer la fenêtre, la fiche ou la palette'],
    [['?'], 'Cette aide'],
  ];
  function aideRaccourcis() {
    if ($('#modal-root .raccourcis')) return;
    const m = modal(`
      <h2>Raccourcis clavier</h2>
      <p class="muted small">Tout se fait aussi sans souris. Les lettres ne marchent pas pendant que tu écris dans un champ.</p>
      <dl class="raccourcis">${RACCOURCIS.map(([ks, quoi]) => `<dt>${ks.map((k) => k === '…' ? '<span class="muted">à</span>' : `<kbd>${esc(k)}</kbd>`).join(' ')}</dt><dd>${esc(quoi)}</dd>`).join('')}</dl>
      <div class="row" style="justify-content:flex-end;margin-top:18px"><button class="primary" data-fermer>Compris</button></div>`);
    $('[data-fermer]', m).onclick = () => fermerFenetre(m);
    $('[data-fermer]', m).focus();
  }
  $('#aide-raccourcis').onclick = aideRaccourcis;

  let attenteG = 0;
  addEventListener('keydown', (e) => {
    const cible = e.target;
    const enSaisie = cible && (cible.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName));
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (palette) palette.fermer(); else ouvrirPalette(); return; }
    if (e.key === 'Escape' && racine.classList.contains('nav-ouverte')) { feuilleNav(false); return; }
    if (enSaisie || e.metaKey || e.ctrlKey || e.altKey || palette) return;
    if ($('#modal-root .modal-backdrop')) return; // une fenêtre est ouverte : on ne navigue pas derrière
    const k = e.key.toLowerCase();
    if (Date.now() - attenteG < 1200) {
      attenteG = 0;
      const ecran = ECRANS.find((x) => x.lettre === k);
      if (ecran) { e.preventDefault(); aller(ecran.vue); }
      return;
    }
    if (k === 'g') { attenteG = Date.now(); return; }
    if (e.key === '/') { e.preventDefault(); ouvrirPalette(); return; }
    if (e.key === '?') { e.preventDefault(); aideRaccourcis(); return; }
    if (e.key === '[') { e.preventDefault(); replierMenu(); return; }
    if (k === 'n') { e.preventDefault(); allerPuis('contacts', '#c-new'); return; }
    if (k === 't') { e.preventDefault(); allerPuis('journee', '#j-texte', (el) => el.focus()); }
  });

  // ------------------------------------------------------------ premier lancement
  // Une seule fois par appareil : ce qui a changé et où sont les choses.
  function bienvenue() {
    if (lire('otea_bienvenue', '') === '2') return;
    ecrire('otea_bienvenue', '2');
    const m = modal(`
      <div class="bienvenue">
        <h2>Bienvenue dans le nouvel OTEA Moteur</h2>
        <p class="muted">Même moteur, même données. Trois réflexes pour aller plus vite :</p>
        <ol>
          <li><div><b>Le matin, ouvre Ma journée.</b><br><span class="muted">En haut, les 3 choses à faire en premier, chacune avec ses boutons : ouvrir, reporter à demain, fait.</span></div></li>
          <li><div><b>${estMac ? '⌘' : 'Ctrl'} K pour tout trouver.</b><br><span class="muted">Un contact, un écran, une action : tape quelques lettres et Entrée. Sur iPhone, c'est dans « Plus ».</span></div></li>
          <li><div><b>Les fiches s'ouvrent sur le côté.</b><br><span class="muted">Tu restes sur ta liste et tu passes d'un contact à l'autre. Échap pour fermer.</span></div></li>
        </ol>
        <div class="row" style="justify-content:flex-end"><button class="ghost" data-raccourcis>Voir les raccourcis</button><button class="primary" data-fermer>C'est parti</button></div>
      </div>`);
    $('[data-fermer]', m).onclick = () => fermerFenetre(m);
    $('[data-raccourcis]', m).onclick = () => { fermerFenetre(m); aideRaccourcis(); };
    $('[data-fermer]', m).focus();
  }
  setTimeout(bienvenue, 700);
})();
