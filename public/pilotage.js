'use strict';
/* 🧭 Pilotage (la revue de la semaine) et 📈 Résultats clients (le tableau de bord
   promis aux clients). Chargé avant app.js : les helpers ($, esc, api, eur, modal…)
   viennent d'app.js et ne servent qu'au moment où l'écran s'affiche. */

// ---------------------------------------------------------------- formats
function fmtVal(n, unite) {
  if (n === null || n === undefined) return '';
  if (unite === 'pourcent') return `${(Math.round(n * 10) / 10).toLocaleString('fr-FR')} %`;
  if (unite === 'euros') return eur(n);
  return Math.round(n).toLocaleString('fr-FR');
}
// Un coût par réservation se lit au centime près.
function eurFin(n) { return n === null || n === undefined ? '' : (Math.abs(n) < 100 ? `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : eur(n)); }
function fmtPct(r, signe = false) { return r === null || r === undefined ? '' : `${signe && r > 0 ? '+' : ''}${Math.round(r * 100)} %`; }
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function moisCourt(m) { const [y, mo] = m.split('-').map(Number); return `${MOIS_COURTS[mo - 1]} ${String(y).slice(2)}`; }
function moisLong(m) { const [y, mo] = m.split('-').map(Number); return `${MOIS_LONGS[mo - 1]} ${y}`; }
function moisDecale(m, n) { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

// Barres groupées : deux séries par mois (facturé / encaissé, objectif / réel).
function barresGroupees(lignes, series, { unite = 'euros', label = 'Graphique' } = {}) {
  const W = 560, H = 190, padL = 46, padB = 26, padT = 18;
  const max = Math.max(1, ...lignes.flatMap((l) => series.map((s) => Number(l[s.cle]) || 0)));
  const bw = (W - padL - 10) / Math.max(lignes.length, 1);
  const larg = Math.max(4, Math.min(22, (bw - 10) / series.length));
  const court = (n) => (unite === 'euros' ? (n >= 1000 ? `${(Math.round(n / 100) / 10).toLocaleString('fr-FR')} k` : String(Math.round(n))) : fmtVal(n, unite));
  const grille = [0.5, 1].map((f) => {
    const y = padT + (H - padT - padB) * (1 - f);
    return `<line class="grid-line" x1="${padL}" y1="${y}" x2="${W - 6}" y2="${y}"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end">${court(max * f)}</text>`;
  }).join('');
  const barres = lignes.map((l, i) => {
    const x0 = padL + i * bw + (bw - larg * series.length) / 2;
    const rects = series.map((s, k) => {
      const v = Number(l[s.cle]) || 0;
      if (l[s.cle] === null || l[s.cle] === undefined) return '';
      const h = Math.max(2, (v / max) * (H - padT - padB));
      return `<rect class="${s.classe}" x="${x0 + k * larg}" y="${H - padB - h}" width="${larg - 2}" height="${h}" rx="3"><title>${esc(s.libelle)} ${esc(l.libelle)} : ${esc(fmtVal(v, unite))}</title></rect>`;
    }).join('');
    return `<g>${rects}<text x="${padL + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(l.libelle)}</text></g>`;
  }).join('');
  const legende = `<div class="legende">${series.map((s) => `<span><i class="${s.classe}"></i>${esc(s.libelle)}</span>`).join('')}</div>`;
  const table = `<table class="sr-only"><caption>${esc(label)}</caption><tbody>${lignes.map((l) => `<tr><th>${esc(l.libelle)}</th>${series.map((s) => `<td>${esc(s.libelle)} ${esc(fmtVal(l[s.cle], unite))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `${legende}<svg class="chart-svg graphe-borne" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}">${grille}${barres}</svg>${table}`;
}

// ================================================================ PILOTAGE
async function vPilotage(view) {
  const r = await api('/pilotage');
  const cm = r.argent.ce_mois, mp = r.argent.mois_precedent;
  const evol = mp.facture_ht ? (cm.facture_ht - mp.facture_ht) / mp.facture_ht : null;
  const niveaux = { alerte: 'due', or: 'former', info: '', ok: 'ok' };
  const synchro = r.sync_le ? `Pennylane lu le ${fmtDateTime(r.sync_le)}` : 'Pennylane pas encore lu';

  view.innerHTML = `
    <div class="view-header spread">
      <div><h1>🧭 Pilotage</h1><div class="sub">Revue de la semaine du ${fmtDay(r.semaine.debut)} au ${fmtDay(r.semaine.fin)} · ${esc(synchro)}</div></div>
      <div class="row">
        <button id="p-sync" class="primary">🔄 Lire Pennylane</button>
        <button id="p-copier">📋 Copier la revue</button>
        <button id="p-ajout" class="ghost">➕ Pièce à la main</button>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="n">${eur(cm.facture_ht)}</div><div class="l">🧾 facturé ce mois (HT)<br><span class="muted">${eur(cm.facture_ttc)} TTC${evol !== null ? ` · ${fmtPct(evol, true)} vs ${esc(moisCourt(mp.mois))}` : ''}</span></div></div>
      <div class="kpi"><div class="n">${eur(cm.encaisse_ttc)}</div><div class="l">💶 encaissé ce mois (TTC)</div></div>
      <div class="kpi"><div class="n">${eur(r.total.a_encaisser_ttc)}</div><div class="l">⏳ reste à encaisser (TTC)</div></div>
      <div class="kpi ${r.en_retard ? 'alert' : ''}"><div class="n">${eur(r.total.en_retard_ttc)}</div><div class="l">⚠️ en retard (${r.en_retard} facture${r.en_retard > 1 ? 's' : ''})</div></div>
      <div class="kpi"><div class="n">${r.devis_en_attente.length}</div><div class="l">📄 devis en attente (${eur(r.total.devis_en_attente_ht)} HT)</div></div>
      <div class="kpi"><div class="n">${r.acceptes_a_facturer.length}</div><div class="l">🤝 acceptés à facturer (${eur(r.total.acceptes_ht)} HT)</div></div>
    </div>
    <div class="grid qg-grille">
      <div class="grid">
        <div class="card ${r.points.some((p) => p.niveau === 'alerte') ? 'bord-alerte' : 'bord-or'}">
          <h2>🎯 Points d’attention</h2>
          <ul class="points">${r.points.map((p) => `<li><span class="chip ${niveaux[p.niveau] || ''}">${{ alerte: 'urgent', or: 'à faire', info: 'à voir', ok: 'ok' }[p.niveau]}</span> ${esc(p.texte)}</li>`).join('')}</ul>
        </div>
        <div class="card">
          <h2>⏳ À encaisser</h2>
          ${r.a_encaisser.length ? `<div class="table-scroll"><table class="list"><thead><tr><th>Client</th><th>N°</th><th>Facturé le</th><th>Échéance</th><th>Reste dû</th><th></th></tr></thead><tbody>
            ${r.a_encaisser.map((p) => `<tr>
              <td><b>${esc(p.client || '?')}</b>${p.libelle ? `<div class="muted small">${esc(p.libelle)}</div>` : ''}</td>
              <td class="mono small">${esc(p.numero)}</td>
              <td>${fmtDay(p.date)}</td>
              <td>${p.retard ? `<span class="chip due">${p.retard} j de retard</span>` : fmtDay(p.echeance)}</td>
              <td class="a-droite"><b>${eur(p.reste_du)}</b></td>
              <td class="a-droite"><button class="small" data-payee="${p.id}">💶 Payée</button>${p.source === 'manuel' ? ` <button class="ghost small" data-suppr="${p.id}" aria-label="Supprimer">🗑️</button>` : ''}</td>
            </tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Tout est encaissé. Lis Pennylane pour mettre à jour.</p>'}
          ${r.brouillons.length ? `<p class="muted small mt-3">📝 En brouillon : ${r.brouillons.map((b) => `${esc(b.client || b.numero)} (${eur(b.montant_ttc)} TTC)`).join(', ')}</p>` : ''}
        </div>
        <div class="card">
          <h2>📄 Devis et propales</h2>
          ${r.devis_en_attente.length || r.acceptes_a_facturer.length ? `<div class="table-scroll"><table class="list"><thead><tr><th>Client</th><th>Objet</th><th>Montant HT</th><th>Âge</th><th></th></tr></thead><tbody>
            ${[...r.acceptes_a_facturer, ...r.devis_en_attente].map((d) => `<tr>
              <td>${d.origine === 'deal' ? `<button type="button" class="lien-texte" data-open-contact="${d.contact_id}"><b>${esc(d.client)}</b></button>` : `<b>${esc(d.client || '?')}</b>`}</td>
              <td class="small">${esc(d.libelle || d.numero || '')}</td>
              <td class="a-droite">${eur(d.montant_ht)}</td>
              <td>${d.statut === 'accepte' ? '<span class="chip ok">accepté, à facturer</span>' : d.expire ? '<span class="chip due">expiré</span>' : d.expire_bientot ? '<span class="chip former">expire bientôt</span>' : `${d.age} j`}</td>
              <td class="a-droite">${d.origine === 'piece' && d.statut === 'en_attente' ? `<button class="small" data-devis="${d.id}" data-statut="accepte">🤝 Accepté</button> <button class="ghost small" data-devis="${d.id}" data-statut="refuse">Refusé</button>` : ''}${d.origine === 'piece' && d.statut === 'accepte' ? `<button class="small" data-devis="${d.id}" data-statut="facture">🧾 Facturé</button>` : ''}</td>
            </tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Aucun devis en attente.</p>'}
        </div>
      </div>
      <div class="grid">
        <div class="card">
          <h2>📊 Facturé et encaissé, 6 mois</h2>
          ${barresGroupees(r.argent.historique.map((h) => ({ libelle: moisCourt(h.mois), facture: h.facture_ttc, encaisse: h.encaisse_ttc })),
            [{ cle: 'facture', libelle: 'Facturé TTC', classe: 'serie-a' }, { cle: 'encaisse', libelle: 'Encaissé TTC', classe: 'serie-b' }],
            { label: 'Facturé et encaissé sur 6 mois' })}
        </div>
        <div class="card">
          <h2>📈 Clients suivis</h2>
          ${r.clients.length ? r.clients.map((c) => `<div class="spread small py-1 ligne-pointillee">
              <a href="#/clients" data-ouvrir-client="${c.id}"><b>${esc(c.nom)}</b></a>
              <span>${c.cumul.roi !== null ? `ROI <b>${fmtPct(c.cumul.roi, true)}</b>` : '<span class="muted">ROI à venir</span>'}${c.manques ? ` <span class="chip former">${c.manques} à compléter</span>` : ''}</span>
            </div>`).join('') : '<p class="muted small">Aucun client suivi. <a href="#/clients">Créer le premier</a> (Off Golf).</p>'}
        </div>
        <div class="card">
          <h2>📆 Échéances</h2>
          ${r.echeances.length ? r.echeances.map((e) => `<div class="spread small py-1 ligne-pointillee"><span>${e.importance >= 3 ? '🔴 ' : ''}${esc(e.texte)}</span><span>${dueLabel(e.echeance)}</span></div>`).join('') : '<p class="muted small">Rien d’échu cette semaine.</p>'}
        </div>
        <div class="card">
          <h2>🔔 Relances prospects</h2>
          ${r.relances.length ? r.relances.slice(0, 10).map((c) => `<div class="spread small py-1 ligne-pointillee">
              <button type="button" class="lien-texte" data-open-contact="${c.id}"><b>${esc(`${c.first_name} ${c.last_name}`.trim() || c.company)}</b> <span class="muted">${esc(c.company || '')}</span></button>
              <span>${dueLabel(c.next_action_at)}</span></div>`).join('') + (r.nb_relances > 10 ? `<p class="muted small mt-2">et ${r.nb_relances - 10} autres dans <a href="#/contacts">Contacts</a>.</p>` : '') : '<p class="muted small">Aucune relance due.</p>'}
        </div>
      </div>
    </div>`;

  $$('[data-open-contact]', view).forEach((el) => { el.onclick = () => openContact(el.dataset.openContact); });
  $$('[data-ouvrir-client]', view).forEach((el) => { el.onclick = () => { clientOuvert = Number(el.dataset.ouvrirClient); }; });
  $('#p-copier').onclick = async () => { await copyText(r.texte); fx.toast('Revue copiée : colle-la où tu veux.', '', 2600); };
  $('#p-sync').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = '⏳ Lecture…';
    try {
      const s = await api('/pilotage/sync', { method: 'POST' });
      fx.toast(`Pennylane lu : ${s.factures} factures, ${s.devis} devis${s.nouvelles ? `, ${s.nouvelles} nouvelle(s)` : ''}.`, '', 3500);
      if (s.erreur_devis) fx.error(`Les devis n’ont pas pu être lus : ${s.erreur_devis}`);
      render();
    } catch (err) { fx.error(err.message); b.disabled = false; b.textContent = '🔄 Lire Pennylane'; }
  };
  $$('[data-payee]', view).forEach((b) => { b.onclick = async () => {
    try { await api(`/pilotage/pieces/${b.dataset.payee}`, { method: 'PATCH', body: { statut: 'payee' } }); fx.toast('Encaissée aujourd’hui ✅', '', 2400); render(); } catch (e) { fx.error(e.message); }
  }; });
  $$('[data-devis]', view).forEach((b) => { b.onclick = async () => {
    try { await api(`/pilotage/pieces/${b.dataset.devis}`, { method: 'PATCH', body: { statut: b.dataset.statut } }); render(); } catch (e) { fx.error(e.message); }
  }; });
  $$('[data-suppr]', view).forEach((b) => { b.onclick = async () => {
    if (!confirm('Supprimer cette pièce saisie à la main ?')) return;
    try { await api(`/pilotage/pieces/${b.dataset.suppr}`, { method: 'DELETE' }); render(); } catch (e) { fx.error(e.message); }
  }; });
  $('#p-ajout').onclick = () => pieceModal();
}

function pieceModal() {
  const m = modal(`
    <h2>➕ Pièce à la main</h2>
    <p class="muted small">Pour une facture ou un devis qui n’est pas dans Pennylane. Ce qui vient de Pennylane se met à jour tout seul.</p>
    <div class="form-grid mt-3">
      <label class="field">Type<select id="pm-type"><option value="facture">Facture</option><option value="devis">Devis</option></select></label>
      <label class="field">Client<input id="pm-client" placeholder="Raja"></label>
      <label class="field">Montant HT (€)<input id="pm-ht" type="number" min="0" step="10"></label>
      <label class="field">N°<input id="pm-num" placeholder="optionnel"></label>
      <label class="field">Date<input id="pm-date" type="date" value="${today()}"></label>
      <label class="field">Échéance<input id="pm-ech" type="date" value="${addDaysStr(today(), 30)}"></label>
      <label class="field wide">Objet<input id="pm-lib" placeholder="Vidéo séminaire, accompagnement réseaux…"></label>
    </div>
    <div class="row fin mt-3"><button class="primary" id="pm-go">Ajouter</button></div>`);
  $('#pm-go', m).onclick = async () => {
    try {
      await api('/pilotage/pieces', { method: 'POST', body: {
        type: $('#pm-type', m).value, client: $('#pm-client', m).value, montant_ht: $('#pm-ht', m).value,
        numero: $('#pm-num', m).value, date: $('#pm-date', m).value, echeance: $('#pm-ech', m).value, libelle: $('#pm-lib', m).value,
      } });
      m.remove(); render();
    } catch (e) { fx.error(e.message); }
  };
}

// ================================================================ RÉSULTATS CLIENTS
let clientOuvert = null;
let indicateurGraphique = null;

async function vClients(view) {
  if (clientOuvert) {
    try { return await vClientDetail(view, clientOuvert); }
    catch (e) { clientOuvert = null; fx.error(e.message); }
  }
  const { clients, modeles } = await api('/clients');
  view.innerHTML = `
    <div class="view-header spread">
      <div><h1>📈 Résultats clients</h1><div class="sub">Ce que les réseaux rapportent à chaque client : réservations, CA généré, coût par réservation, ROI. Du chiffre, mois par mois.</div></div>
      <button class="primary" id="cl-nouveau">➕ Nouveau client suivi</button>
    </div>
    ${clients.length ? `<div class="grid cartes-clients">${clients.map((c) => `
      <button type="button" class="card carte-client" data-client="${c.id}">
        <div class="spread"><h2 class="mb-1">${esc(c.nom)}</h2>${c.manques ? `<span class="chip former">${c.manques} à compléter</span>` : '<span class="chip ok">à jour</span>'}</div>
        <div class="muted small">${c.cumul.mois_suivis} mois suivi${c.cumul.mois_suivis > 1 ? 's' : ''} depuis ${esc(moisLong(c.debut))}</div>
        <div class="kpis mt-3">
          <div class="kpi"><div class="n">${c.cumul.roi !== null ? fmtPct(c.cumul.roi, true) : '?'}</div><div class="l">ROI</div></div>
          <div class="kpi"><div class="n">${c.cumul.ca_total !== null ? eur(c.cumul.ca_total) : '?'}</div><div class="l">CA généré${c.cumul.ca_estime ? ' (estimé)' : ''}</div></div>
          <div class="kpi"><div class="n">${c.cumul.cout_par_reservation !== null ? eurFin(c.cumul.cout_par_reservation) : '?'}</div><div class="l">par réservation</div></div>
        </div>
        ${c.premier_manque ? `<p class="muted small mt-2">${esc(c.premier_manque)}</p>` : ''}
      </button>`).join('')}</div>`
    : `<div class="card onboarding bord-or">
        <h2>Le premier tableau de bord client</h2>
        <p class="muted">Off Golf veut des chiffres : combien de réservations, combien de CA, combien ça coûte, combien ça rapporte. Crée-le ici, saisis le point de départ (les chiffres d’avant OTEA), puis les objectifs et le réel chaque mois. Le ROI et le rapport mensuel se calculent tout seuls.</p>
      </div>`}`;
  $('#cl-nouveau').onclick = () => nouveauClientModal(modeles);
  $$('[data-client]', view).forEach((b) => { b.onclick = () => { clientOuvert = Number(b.dataset.client); render(); }; });
}

function nouveauClientModal(modeles) {
  const m = modal(`
    <h2>➕ Nouveau client suivi</h2>
    <div class="form-grid mt-3">
      <label class="field">Nom<input id="nc-nom" placeholder="Off Golf"></label>
      <label class="field">Modèle<select id="nc-modele">${Object.entries(modeles).map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join('')}</select></label>
      <label class="field">Premier mois<input id="nc-debut" type="month" value="${today().slice(0, 7)}"></label>
      <label class="field">Accompagnement / mois (€ HT)<input id="nc-hon" type="number" min="0" step="50"></label>
      <label class="field">Budget pub / mois (€ HT)<input id="nc-pub" type="number" min="0" step="50"></label>
      <label class="field">Panier moyen d’une réservation (€)<input id="nc-panier" type="number" min="0" step="1"></label>
    </div>
    <p class="muted small mt-2">Le panier moyen sert à estimer le CA quand le client ne donne que le nombre de réservations.</p>
    <div class="row fin mt-3"><button class="primary" id="nc-go">Créer</button></div>`);
  $('#nc-go', m).onclick = async () => {
    try {
      const { client } = await api('/clients', { method: 'POST', body: {
        nom: $('#nc-nom', m).value, modele: $('#nc-modele', m).value, debut: $('#nc-debut', m).value,
        honoraires_mensuels: $('#nc-hon', m).value, budget_pub_mensuel: $('#nc-pub', m).value, panier_moyen: $('#nc-panier', m).value,
      } });
      m.remove(); clientOuvert = client.id; render();
    } catch (e) { fx.error(e.message); }
  };
}

// Atteinte de l'objectif : vert si atteint, alerte sous 80 %, rien entre les deux.
function chipAtteinte(atteinte, sens) {
  if (atteinte === null || atteinte === undefined || sens === 'neutre') return '';
  const bon = sens === 'baisse' ? atteinte <= 1 : atteinte >= 1;
  const mauvais = sens === 'baisse' ? atteinte > 1.2 : atteinte < 0.8;
  return `<span class="chip ${bon ? 'ok' : mauvais ? 'due' : ''}">${fmtPct(atteinte)}</span>`;
}

async function vClientDetail(view, id) {
  const t = await api(`/clients/${id}`);
  const c = t.client, k = t.cumul;
  const actifs = new Set(t.synthese.filter((s) => s.actif).map((s) => s.mois));
  if (!indicateurGraphique || !t.indicateurs.some((i) => i.id === indicateurGraphique)) {
    indicateurGraphique = (t.indicateurs.find((i) => i.role === 'reservations') || t.indicateurs[0] || {}).id || null;
  }
  const indG = t.indicateurs.find((i) => i.id === indicateurGraphique);

  view.innerHTML = `
    <div class="view-header spread">
      <div>
        <button type="button" class="lien-texte small" id="cl-retour">← Tous les clients</button>
        <h1>📈 ${esc(c.nom)}</h1>
        <div class="sub">Depuis ${esc(moisLong(c.debut))} · accompagnement ${eur(c.honoraires_mensuels)} HT / mois · pub ${eur(c.budget_pub_mensuel)} / mois${c.panier_moyen ? ` · panier moyen ${eur(c.panier_moyen)}` : ''}</div>
      </div>
      <div class="row">
        <button class="primary" id="cl-saisir">✍️ Saisir un mois</button>
        <button id="cl-rapport">📨 Rapport du mois</button>
        <button class="ghost" id="cl-reglages">⚙️ Réglages</button>
      </div>
    </div>
    ${t.manques.length ? `<div class="card bord-or"><h2>🧩 À compléter</h2><ul class="points">${t.manques.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="n">${k.ca_total !== null ? eur(k.ca_total) : '?'}</div><div class="l">💰 CA généré${k.ca_estime ? ' (en partie estimé)' : ''}</div></div>
      <div class="kpi"><div class="n">${eur(k.cout_total)}</div><div class="l">🧾 investi (accompagnement + pub)</div></div>
      <div class="kpi"><div class="n">${k.roi !== null ? fmtPct(k.roi, true) : '?'}</div><div class="l">📈 ROI sur ${k.mois_suivis} mois</div></div>
      <div class="kpi"><div class="n">${k.multiple !== null ? `× ${k.multiple.toLocaleString('fr-FR')}` : '?'}</div><div class="l">💶 chaque euro investi rapporte</div></div>
      <div class="kpi"><div class="n">${k.reservations !== null ? fmtVal(k.reservations) : '?'}</div><div class="l">🎟️ réservations${k.reservations_en_plus !== null ? ` (${k.reservations_en_plus >= 0 ? '+' : ''}${fmtVal(k.reservations_en_plus)} vs avant)` : ''}</div></div>
      <div class="kpi"><div class="n">${k.cout_par_reservation !== null ? eurFin(k.cout_par_reservation) : '?'}</div><div class="l">🎯 coût par réservation</div></div>
    </div>
    ${indG ? `<div class="card">
      <div class="spread"><h2>📊 Objectif et réel</h2>
        <select id="cl-graph" aria-label="Indicateur affiché">${t.indicateurs.map((i) => `<option value="${i.id}" ${i.id === indG.id ? 'selected' : ''}>${esc(i.libelle)}</option>`).join('')}</select></div>
      ${barresGroupees(indG.mois.map((l) => ({ libelle: moisCourt(l.mois), objectif: l.objectif, reel: l.reel })),
        [{ cle: 'objectif', libelle: 'Objectif', classe: 'serie-c' }, { cle: 'reel', libelle: 'Réel', classe: 'serie-a' }],
        { unite: indG.unite, label: `${indG.libelle} : objectif et réel par mois` })}
      ${indG.baseline !== null ? `<p class="muted small">Point de départ avant OTEA : <b>${fmtVal(indG.baseline, indG.unite)}</b> par mois.</p>` : ''}
    </div>` : ''}
    <div class="card">
      <div class="spread"><h2>🗂️ Indicateurs, mois par mois</h2><button class="ghost small" id="cl-ind-ajout">➕ Indicateur</button></div>
      <div class="table-scroll"><table class="list tableau-client"><thead><tr><th>Indicateur</th><th>Départ</th>${t.mois.map((m) => `<th class="${actifs.has(m) ? '' : 'a-venir'}">${esc(moisCourt(m))}</th>`).join('')}<th>Total</th></tr></thead><tbody>
        ${t.indicateurs.map((i) => `<tr>
          <td><button type="button" class="lien-texte" data-ind="${i.id}"><b>${esc(i.libelle)}</b></button>${i.role ? `<div class="muted small">${{ reservations: 'compte les réservations', ca: 'compte le CA', pub: 'dépense pub' }[i.role]}</div>` : ''}</td>
          <td>${i.baseline !== null ? fmtVal(i.baseline, i.unite) : i.role === 'pub' ? '' : '<span class="chip former" title="Point de départ à saisir">?</span>'}</td>
          ${i.mois.map((l) => `<td>${l.reel !== null ? `<b>${fmtVal(l.reel, i.unite)}</b>` : ''}${l.objectif !== null ? `<div class="muted small">obj. ${fmtVal(l.objectif, i.unite)} ${chipAtteinte(l.atteinte, i.sens)}</div>` : ''}</td>`).join('')}
          <td><b>${fmtVal(i.total_reel, i.unite)}</b>${i.total_objectif !== null ? `<div class="muted small">obj. ${fmtVal(i.total_objectif, i.unite)} ${chipAtteinte(i.atteinte, i.sens)}</div>` : ''}</td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="card">
      <h2>💶 Ce que ça rapporte, mois par mois</h2>
      <div class="table-scroll"><table class="list"><thead><tr><th></th>${t.synthese.filter((s) => s.actif).map((s) => `<th>${esc(moisCourt(s.mois))}</th>`).join('')}</tr></thead><tbody>
        ${[
          ['Investi (HT)', (s) => eur(s.cout)],
          ['CA généré', (s) => (s.ca !== null ? `${eur(s.ca)}${s.ca_estime ? ' <span class="muted">(est.)</span>' : ''}` : '')],
          ['Réservations', (s) => fmtVal(s.reservations)],
          ['Coût par réservation', (s) => (s.cout_par_reservation !== null ? eurFin(s.cout_par_reservation) : '')],
          ['1 € investi rapporte', (s) => (s.multiple !== null ? `${s.multiple.toLocaleString('fr-FR')} €` : '')],
          ['ROI', (s) => fmtPct(s.roi, true)],
        ].map(([lib, f]) => `<tr><th>${lib}</th>${t.synthese.filter((s) => s.actif).map((s) => `<td>${f(s)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      ${!actifs.size ? '<p class="muted small">Rien de saisi pour l’instant. Commence par « Saisir un mois ».</p>' : ''}
    </div>`;

  $('#cl-retour').onclick = () => { clientOuvert = null; render(); };
  const g = $('#cl-graph'); if (g) g.onchange = () => { indicateurGraphique = Number(g.value); render(); };
  $('#cl-saisir').onclick = () => saisieMoisModal(t);
  $('#cl-rapport').onclick = () => rapportModal(t);
  $('#cl-reglages').onclick = () => reglagesClientModal(c);
  $('#cl-ind-ajout').onclick = () => indicateurModal(c.id, null);
  $$('[data-ind]', view).forEach((b) => { b.onclick = () => indicateurModal(c.id, t.indicateurs.find((i) => i.id === Number(b.dataset.ind))); });
}

function saisieMoisModal(t, moisChoisi) {
  const moisCourant = today().slice(0, 7);
  const choix = [...new Set([...t.mois, moisDecale(t.mois[t.mois.length - 1], 1), moisDecale(t.mois[t.mois.length - 1], 2)])];
  // Par défaut : le mois qui vient de finir, sinon le mois en cours, jamais un mois futur.
  const precedent = moisDecale(moisCourant, -1);
  const mois = moisChoisi || (choix.includes(precedent) ? precedent : choix.includes(moisCourant) ? moisCourant : t.mois[t.mois.length - 1]);
  const val = (i, cle) => { const l = i.mois.find((x) => x.mois === mois); return l && l[cle] !== null ? l[cle] : ''; };
  const m = modal(`
    <h2>✍️ Saisir un mois</h2>
    <label class="field">Mois<select id="sm-mois">${choix.map((x) => `<option value="${x}" ${x === mois ? 'selected' : ''}>${esc(moisLong(x))}</option>`).join('')}</select></label>
    <p class="muted small mt-2">Une case vide = pas de valeur. Les objectifs des mois à venir peuvent se poser d’avance.</p>
    <div class="table-scroll mt-3"><table class="list saisie"><thead><tr><th>Indicateur</th><th>Objectif</th><th>Réel</th></tr></thead><tbody>
      ${t.indicateurs.map((i) => `<tr><td>${esc(i.libelle)}<div class="muted small">${{ nombre: 'nombre', euros: '€', pourcent: '%' }[i.unite]}</div></td>
        <td><input type="number" step="any" data-obj="${i.id}" value="${esc(val(i, 'objectif'))}"></td>
        <td><input type="number" step="any" data-reel="${i.id}" value="${esc(val(i, 'reel'))}"></td></tr>`).join('')}
    </tbody></table></div>
    <div class="row fin mt-3"><button class="primary" id="sm-go">Enregistrer</button></div>`);
  $('#sm-mois', m).onchange = (e) => { m.remove(); saisieMoisModal(t, e.target.value); };
  $('#sm-go', m).onclick = async () => {
    const valeurs = t.indicateurs.map((i) => ({ indicateur_id: i.id, objectif: $(`[data-obj="${i.id}"]`, m).value, reel: $(`[data-reel="${i.id}"]`, m).value }));
    try {
      await api(`/clients/${t.client.id}/mois/${mois}`, { method: 'PUT', body: { valeurs } });
      m.remove(); fx.toast(`${moisLong(mois)} enregistré.`, '', 2400); render();
    } catch (e) { fx.error(e.message); }
  };
}

async function rapportModal(t, moisChoisi) {
  const actifs = t.synthese.filter((s) => s.actif).map((s) => s.mois);
  if (!actifs.length) return fx.error('Aucun mois saisi : saisis d’abord les chiffres d’un mois.');
  const mois = moisChoisi || actifs[actifs.length - 1];
  let texte = '';
  try { texte = (await api(`/clients/${t.client.id}/rapport?mois=${mois}`)).texte; } catch (e) { return fx.error(e.message); }
  const m = modal(`
    <h2>📨 Rapport du mois</h2>
    <label class="field">Mois<select id="rp-mois">${actifs.map((x) => `<option value="${x}" ${x === mois ? 'selected' : ''}>${esc(moisLong(x))}</option>`).join('')}</select></label>
    <textarea id="rp-texte" class="mt-3 rapport-texte" rows="18" readonly>${esc(texte)}</textarea>
    <div class="row fin mt-3"><button class="primary" id="rp-copier">📋 Copier</button></div>`);
  $('#rp-mois', m).onchange = (e) => { m.remove(); rapportModal(t, e.target.value); };
  $('#rp-copier', m).onclick = async () => { await copyText(texte); fx.toast('Rapport copié : colle-le dans le mail du client.', '', 2600); };
}

function reglagesClientModal(c) {
  const m = modal(`
    <h2>⚙️ ${esc(c.nom)}</h2>
    <div class="form-grid mt-3">
      <label class="field">Nom<input id="rc-nom" value="${esc(c.nom)}"></label>
      <label class="field">Premier mois<input id="rc-debut" type="month" value="${esc(c.debut)}"></label>
      <label class="field">Accompagnement / mois (€ HT)<input id="rc-hon" type="number" min="0" value="${c.honoraires_mensuels}"></label>
      <label class="field">Budget pub / mois (€ HT)<input id="rc-pub" type="number" min="0" value="${c.budget_pub_mensuel}"></label>
      <label class="field">Panier moyen (€)<input id="rc-panier" type="number" min="0" value="${c.panier_moyen}"></label>
      <label class="field wide">Notes<input id="rc-notes" value="${esc(c.notes)}"></label>
    </div>
    <div class="row spread mt-3"><button class="ghost" id="rc-suppr">🗑️ Supprimer ce suivi</button><button class="primary" id="rc-go">Enregistrer</button></div>`);
  $('#rc-go', m).onclick = async () => {
    try {
      await api(`/clients/${c.id}`, { method: 'PATCH', body: { nom: $('#rc-nom', m).value, debut: $('#rc-debut', m).value, honoraires_mensuels: $('#rc-hon', m).value, budget_pub_mensuel: $('#rc-pub', m).value, panier_moyen: $('#rc-panier', m).value, notes: $('#rc-notes', m).value } });
      m.remove(); render();
    } catch (e) { fx.error(e.message); }
  };
  $('#rc-suppr', m).onclick = async () => {
    if (!confirm(`Supprimer le suivi de ${c.nom} et tous ses chiffres ? Ça ne se rattrape pas.`)) return;
    try { await api(`/clients/${c.id}`, { method: 'DELETE' }); m.remove(); clientOuvert = null; render(); } catch (e) { fx.error(e.message); }
  };
}

function indicateurModal(clientId, ind) {
  const i = ind || { libelle: '', unite: 'nombre', sens: 'hausse', cumul: 'somme', role: '', baseline: null };
  const opt = (liste, v) => liste.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('');
  const m = modal(`
    <h2>${ind ? '✏️ Indicateur' : '➕ Nouvel indicateur'}</h2>
    <div class="form-grid mt-3">
      <label class="field wide">Nom<input id="im-lib" value="${esc(i.libelle)}" placeholder="Demandes séminaire"></label>
      <label class="field">Point de départ (par mois, avant OTEA)<input id="im-base" type="number" step="any" value="${i.baseline !== null ? esc(i.baseline) : ''}"></label>
      <label class="field">Unité<select id="im-unite">${opt([['nombre', 'Nombre'], ['euros', 'Euros'], ['pourcent', 'Pourcentage']], i.unite)}</select></label>
      <label class="field">Rôle dans le ROI<select id="im-role">${opt([['', 'Aucun'], ['reservations', 'Compte les réservations'], ['ca', 'Compte le CA généré'], ['pub', 'Dépense pub du mois']], i.role)}</select></label>
      <label class="field">Bon sens<select id="im-sens">${opt([['hausse', 'Plus, c’est mieux'], ['baisse', 'Moins, c’est mieux'], ['neutre', 'Ni l’un ni l’autre']], i.sens)}</select></label>
      <label class="field">Total sur la période<select id="im-cumul">${opt([['somme', 'Somme des mois'], ['dernier', 'Dernière valeur (abonnés)'], ['moyenne', 'Moyenne (taux)']], i.cumul)}</select></label>
    </div>
    <div class="row spread mt-3">${ind ? '<button class="ghost" id="im-suppr">🗑️ Supprimer</button>' : '<span></span>'}<button class="primary" id="im-go">Enregistrer</button></div>`);
  // Nouvel indicateur : le total suit l'unité (un taux se moyenne) tant que Maxime ne le choisit pas lui-même.
  if (!ind) {
    let cumulTouche = false;
    $('#im-cumul', m).onchange = () => { cumulTouche = true; };
    $('#im-unite', m).onchange = () => { if (!cumulTouche) $('#im-cumul', m).value = $('#im-unite', m).value === 'pourcent' ? 'moyenne' : 'somme'; };
  }
  $('#im-go', m).onclick = async () => {
    const body = { libelle: $('#im-lib', m).value, baseline: $('#im-base', m).value, unite: $('#im-unite', m).value, role: $('#im-role', m).value, sens: $('#im-sens', m).value, cumul: $('#im-cumul', m).value };
    try {
      if (ind) await api(`/indicateurs/${ind.id}`, { method: 'PATCH', body });
      else await api(`/clients/${clientId}/indicateurs`, { method: 'POST', body });
      m.remove(); render();
    } catch (e) { fx.error(e.message); }
  };
  if (ind) $('#im-suppr', m).onclick = async () => {
    if (!confirm(`Supprimer « ${ind.libelle} » et ses chiffres ?`)) return;
    try { await api(`/indicateurs/${ind.id}`, { method: 'DELETE' }); m.remove(); render(); } catch (e) { fx.error(e.message); }
  };
}
