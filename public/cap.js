/* 🧭 Le Cap : la projection business dans l'outil.
   Trois horizons de jalons à cocher (court, moyen, long terme), les six
   chiffres du lundi calculés depuis le CRM, la trajectoire 2027 face aux
   trois scénarios, les garde-fous. Rien n'est calculé ici : le serveur
   (/api/cap) donne l'état, l'écran le dessine. */

let capEtat = null;

function capEur(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(v).toLocaleString('fr-FR')} €`;
}
function capDate(j) { return j ? `${j.slice(8, 10)}/${j.slice(5, 7)}` : ''; }
function capChipEtat(etat) {
  if (etat === 'ok') return '<span class="chip ok">dans les clous</span>';
  if (etat === 'alerte') return '<span class="chip due">à travailler</span>';
  if (etat === 'manuel') return '<span class="chip faint">à vérifier à la main</span>';
  return '<span class="chip faint">pas encore de données</span>';
}

async function vCap(view) {
  capEtat = await api('/cap');
  capDessiner(view);
}

function capDessiner(view) {
  const E = capEtat;
  const L = E.lundi;
  const T = E.trajectoire;
  const court = E.horizons.filter((h) => h.terme === 'court');
  const moyen = E.horizons.filter((h) => h.terme === 'moyen');
  const long = E.horizons.filter((h) => h.terme === 'long');

  view.innerHTML = `
    <div class="view-header spread">
      <div><h1>${ckIco('cap')} Le Cap</h1><div class="sub">Court, moyen, long terme : ce qu'on fait, ce qu'on vise, et si on y est. Semaine du ${capDate(L.semaine_du)} · scénario ${esc(T.scenarios[T.scenario].libelle.toLowerCase())}.</div></div>
      <div class="row">
        <label class="field cap-scenario">Scénario 2027
          <select id="cap-scenario">${Object.entries(T.scenarios).map(([code, s]) => `<option value="${code}" ${code === T.scenario ? 'selected' : ''}>${esc(s.libelle)} · ${capEur(s.total)}</option>`).join('')}</select>
        </label>
      </div>
    </div>

    <section class="card cap-section">
      <div class="spread"><h2>Six chiffres le lundi</h2><span class="chip faint">calculés depuis le CRM, semaine du ${capDate(L.semaine_du)}</span></div>
      <div class="cap-chiffres">
        ${L.chiffres.map((c) => `
          <div class="cap-chiffre ${c.etat}">
            <div class="ck-l">${esc(c.titre)}</div>
            <div class="cap-valeur">${c.valeur === null ? '<span class="muted">…</span>' : c.unite === '€' ? capEur(c.valeur) : `${c.valeur.toLocaleString('fr-FR')}${c.unite === '%' ? ' %' : c.unite === '×' ? ' ×' : ''}`}</div>
            <div class="small muted">Cible ${c.unite === '€' ? capEur(c.cible) : `${c.cible}${c.unite === '%' ? ' %' : c.unite === '×' ? ' ×' : ''}`}${c.code === 'recommandations' ? ' par semaine' : ''}</div>
            <div class="cap-detail small">${esc(c.detail)}</div>
            ${c.retard && c.retard.length ? `<ul class="cap-retard small">${c.retard.slice(0, 4).map((r) => `<li><a href="#" data-contact="${r.contact_id}">${esc(r.nom)}</a>${r.societe && r.nom !== r.societe ? ` <span class="muted">${esc(r.societe)}</span>` : ''} · rendez-vous le ${capDate(r.depuis)}, pas de devis</li>`).join('')}</ul>` : ''}
            <div class="mt-2">${capChipEtat(c.etat)}</div>
          </div>`).join('')}
      </div>
    </section>

    <div class="cap-horizons">
      <section class="card cap-section">
        <div class="spread"><h2>Court terme</h2><span class="chip faint">${court.reduce((s, h) => s + h.faits, 0)}/${court.reduce((s, h) => s + h.total, 0)} faits</span></div>
        ${court.map(capHorizonHtml).join('')}
      </section>
      <section class="card cap-section">
        <div class="spread"><h2>Moyen terme</h2><span class="chip faint">${moyen.reduce((s, h) => s + h.faits, 0)}/${moyen.reduce((s, h) => s + h.total, 0)} faits</span></div>
        <p class="muted small">Sept semaines classées par euro encaissé : chaque semaine commence par l'argent le plus proche.</p>
        ${moyen.map(capHorizonHtml).join('')}
      </section>
      <section class="card cap-section">
        <div class="spread"><h2>Long terme : 2027</h2><span class="chip faint">${long.reduce((s, h) => s + h.faits, 0)}/${long.reduce((s, h) => s + h.total, 0)} faits</span></div>
        <p class="muted small">${esc(T.scenarios[T.scenario].phrase)}</p>
        ${capTrajectoireHtml(T)}
        ${long.map(capHorizonHtml).join('')}
      </section>
    </div>

    <section class="card cap-section">
      <div class="spread"><h2>Garde-fous</h2><span class="chip faint">vérifiés à chaque clôture mensuelle</span></div>
      <ul class="cap-gardes">
        ${E.garde_fous.map((g) => `<li class="cap-garde ${g.etat}"><div class="spread"><b>${esc(g.titre)}</b>${capChipEtat(g.etat)}</div><div class="small muted">${esc(g.regle)}</div>${g.valeur ? `<div class="small">${esc(g.valeur)}</div>` : ''}</li>`).join('')}
      </ul>
    </section>`;

  // ---- interactions
  $('#cap-scenario').onchange = async (e) => {
    await api('/cap/scenario', { method: 'POST', body: { scenario: e.target.value } });
    toast('Scénario changé : les cibles du trimestre suivent.');
    await vCap(view);
  };
  $$('[data-cap-fait]').forEach((cb) => {
    cb.onchange = async () => {
      const id = Number(cb.dataset.capFait);
      const r = await api(`/cap/jalons/${id}/basculer`, { method: 'POST' });
      if (r.jalon.fait && window.fx) { fx.play('quest'); fx.confetti(30, { spread: 60 }); }
      await vCap(view);
    };
  });
  $$('[data-cap-suppr]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Retirer ce jalon du plan ?')) return;
      await api(`/cap/jalons/${Number(b.dataset.capSuppr)}`, { method: 'DELETE' });
      await vCap(view);
    };
  });
  $$('form[data-cap-ajout]').forEach((f) => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      const titre = f.querySelector('input[name=titre]').value.trim();
      const echeance = f.querySelector('input[name=echeance]').value;
      if (!titre) return;
      await api('/cap/jalons', { method: 'POST', body: { horizon: f.dataset.capAjout, titre, echeance } });
      await vCap(view);
    };
  });
  $$('[data-contact]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); openContact(Number(a.dataset.contact)); }; });
}

function capHorizonHtml(h) {
  return `
    <div class="cap-horizon">
      <div class="spread cap-horizon-tete"><h3>${esc(h.titre)}</h3><span class="small muted">${h.faits}/${h.total}</span></div>
      <div class="cap-progres" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${h.pct}"><span style="width:${h.pct}%"></span></div>
      <ul class="cap-jalons">
        ${h.jalons.map((j) => `
          <li class="cap-jalon ${j.fait ? 'fait' : ''} ${j.en_retard ? 'retard' : ''}">
            <label class="cap-jalon-ligne">
              <input type="checkbox" data-cap-fait="${j.id}" ${j.fait ? 'checked' : ''} aria-label="Marquer fait : ${esc(j.titre)}">
              <span class="cap-jalon-corps">
                <span class="cap-jalon-titre">${esc(j.titre)}</span>
                ${j.detail ? `<span class="cap-jalon-detail small muted">${esc(j.detail)}</span>` : ''}
              </span>
              ${j.echeance ? `<span class="chip ${j.en_retard ? 'due' : 'faint'} cap-jalon-date">${j.en_retard ? 'en retard · ' : ''}${capDate(j.echeance)}</span>` : ''}
            </label>
            <button class="ghost cap-jalon-suppr" data-cap-suppr="${j.id}" title="Retirer ce jalon" aria-label="Retirer ce jalon">×</button>
          </li>`).join('')}
      </ul>
      <form class="cap-ajout row" data-cap-ajout="${h.code}">
        <input name="titre" placeholder="Ajouter un jalon…" aria-label="Nouveau jalon pour ${esc(h.titre)}">
        <input name="echeance" type="date" aria-label="Échéance">
        <button class="ghost" type="submit">Ajouter</button>
      </form>
    </div>`;
}

function capTrajectoireHtml(T) {
  const max = Math.max(...T.trimestres.map((t) => Math.max(t.facture, t.cibles.ambitieux, t.facture_2026)), 1);
  const w = (v) => Math.max(0, Math.min(100, Math.round((v / max) * 100)));
  return `
    <div class="cap-traj">
      <div class="spread small"><b>Facturé par trimestre face à la cible ${esc(T.scenarios[T.scenario].libelle.toLowerCase())}</b><span class="muted">${capEur(T.total_facture)} facturés sur ${capEur(T.total_cible)}</span></div>
      ${T.trimestres.map((t) => `
        <div class="cap-traj-ligne ${t.en_cours ? 'en-cours' : ''} ${t.passe ? 'passe' : ''}">
          <span class="cap-traj-nom">${t.code}${t.en_cours ? ' <span class="muted small">en cours</span>' : ''}</span>
          <div class="cap-traj-barre" title="2026 : ${capEur(t.facture_2026)} · cible : ${capEur(t.cible)}">
            <span class="cap-traj-2026" style="width:${w(t.facture_2026)}%"></span>
            <span class="cap-traj-fait" style="width:${w(t.facture)}%"></span>
            <span class="cap-traj-cible" style="left:${w(t.cible)}%"></span>
          </div>
          <span class="cap-traj-val"><b>${capEur(t.facture)}</b> <span class="muted">/ ${capEur(t.cible)}</span></span>
        </div>`).join('')}
      <div class="cap-legende small muted"><span class="cap-leg cap-leg-fait"></span> facturé 2027 <span class="cap-leg cap-leg-2026"></span> même trimestre 2026 <span class="cap-leg cap-leg-cible"></span> cible du scénario</div>
      <div class="small muted mt-2">2026 facturé dans le CRM : ${capEur(T.facture_2026)}. Les cibles prudent et ambitieux sont réparties au prorata de la trajectoire cible (26, 29, 32, 35 k€) : une proposition, pas une promesse.</div>
    </div>`;
}
