'use strict';
// 📈 Résultats clients : le tableau de bord promis aux clients (Off Golf en premier).
// Un client suivi = des indicateurs (réservations, demandes séminaire, CA...),
// un point de départ (baseline) par indicateur, et pour chaque mois un objectif
// et un réel. On en tire ce que le client veut voir : du chiffre. Combien de
// réservations, combien de CA généré, combien ça lui coûte, et ce que ça lui rapporte.

const dbApi = require('./db');
const { get, all, run, nowIso, localDay } = dbApi;

const UNITES = ['nombre', 'euros', 'pourcent'];
const SENS = ['hausse', 'baisse', 'neutre'];
const CUMULS = ['somme', 'dernier', 'moyenne'];
const ROLES = ['', 'reservations', 'ca', 'pub'];
const MOIS_RX = /^\d{4}-(0[1-9]|1[0-2])$/;
const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Les modèles : les indicateurs qu'on pose d'office à la création.
const MODELES = {
  loisirs: {
    titre: 'Lieu de loisirs (golf, salle, bar à jeux)',
    indicateurs: [
      { libelle: 'Réservations en ligne', unite: 'nombre', role: 'reservations' },
      { libelle: 'Demandes séminaire et entreprise', unite: 'nombre' },
      { libelle: 'Demandes afterwork et privatisation', unite: 'nombre' },
      { libelle: 'CA généré par les réseaux', unite: 'euros', role: 'ca' },
      { libelle: 'Dépense pub Meta', unite: 'euros', role: 'pub', sens: 'neutre' },
      { libelle: 'Abonnés Instagram', unite: 'nombre', cumul: 'dernier' },
      { libelle: 'Portée du mois', unite: 'nombre' },
      { libelle: 'Taux d’engagement', unite: 'pourcent', cumul: 'moyenne' },
    ],
  },
  commerce: {
    titre: 'Commerce ou service local',
    indicateurs: [
      { libelle: 'Prises de contact (appels, DM, formulaires)', unite: 'nombre', role: 'reservations' },
      { libelle: 'CA généré par les réseaux', unite: 'euros', role: 'ca' },
      { libelle: 'Dépense pub Meta', unite: 'euros', role: 'pub', sens: 'neutre' },
      { libelle: 'Abonnés Instagram', unite: 'nombre', cumul: 'dernier' },
      { libelle: 'Portée du mois', unite: 'nombre' },
    ],
  },
  vierge: { titre: 'Vierge (je pose mes indicateurs)', indicateurs: [] },
};

function erreur(message, status = 400) { const e = new Error(message); e.httpStatus = status; return e; }
function nombreOuNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw erreur(`« ${v} » n’est pas un nombre. Tape juste le chiffre, sans unité.`);
  return n;
}
function moisCourant() { return localDay().slice(0, 7); }
function moisSuivant(m, n = 1) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// Au plus 36 mois : les plus récents, pour que le mois en cours reste toujours visible.
function plageMois(debut, fin) {
  const plancher = moisSuivant(fin, -35);
  const out = [];
  for (let m = debut > plancher ? debut : plancher; m <= fin; m = moisSuivant(m)) out.push(m);
  return out;
}
function libelleMois(m) { const [y, mo] = m.split('-').map(Number); return `${NOMS_MOIS[mo - 1]} ${y}`; }
function verifierMois(m) {
  if (!MOIS_RX.test(String(m || ''))) throw erreur('Le mois doit être au format AAAA-MM (par exemple 2026-12).');
  return m;
}

// ---------------------------------------------------------------- clients
function client(id) {
  const c = get('SELECT * FROM clients_suivis WHERE id = ?', Number(id));
  if (!c) throw erreur('Ce client suivi n’existe plus. Recharge la page.', 404);
  return c;
}

function creerClient(b = {}) {
  const nom = String(b.nom || '').trim();
  if (!nom) throw erreur('Donne un nom au client (par exemple « Off Golf »).');
  const modele = MODELES[b.modele || 'loisirs'] ? (b.modele || 'loisirs') : 'loisirs';
  const debut = b.debut ? verifierMois(b.debut) : moisCourant();
  const now = nowIso();
  const { lastId } = run(
    `INSERT INTO clients_suivis (nom, secteur, contact_id, debut, honoraires_mensuels, budget_pub_mensuel, panier_moyen, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nom, String(b.secteur || ''), b.contact_id ? Number(b.contact_id) : null, debut,
    nombreOuNull(b.honoraires_mensuels) || 0, nombreOuNull(b.budget_pub_mensuel) || 0, nombreOuNull(b.panier_moyen) || 0,
    String(b.notes || ''), now, now
  );
  MODELES[modele].indicateurs.forEach((ind, i) => ajouterIndicateur(lastId, { ...ind, ordre: i + 1 }));
  return client(lastId);
}

function modifierClient(id, b = {}) {
  client(id);
  const champs = { nom: 'texte', secteur: 'texte', notes: 'texte', debut: 'mois', honoraires_mensuels: 'nombre', budget_pub_mensuel: 'nombre', panier_moyen: 'nombre', archive: 'bool' };
  const sets = [], vals = [];
  for (const [k, type] of Object.entries(champs)) {
    if (b[k] === undefined) continue;
    let v = b[k];
    if (type === 'texte') v = String(v).trim();
    if (type === 'mois') v = verifierMois(v);
    if (type === 'nombre') v = nombreOuNull(v) || 0;
    if (type === 'bool') v = v ? 1 : 0;
    if (k === 'nom' && !v) throw erreur('Le nom du client ne peut pas être vide.');
    sets.push(`${k} = ?`); vals.push(v);
  }
  if (sets.length) run(`UPDATE clients_suivis SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...vals, nowIso(), Number(id));
  return client(id);
}

function supprimerClient(id) { client(id); run('DELETE FROM clients_suivis WHERE id = ?', Number(id)); return { ok: true }; }

// ---------------------------------------------------------------- indicateurs
function nettoyerIndicateur(b, existant = {}) {
  const out = {};
  if (b.libelle !== undefined) { out.libelle = String(b.libelle).trim(); if (!out.libelle) throw erreur('Donne un nom à l’indicateur.'); }
  if (b.unite !== undefined) { if (!UNITES.includes(b.unite)) throw erreur('Unité inconnue : choisis nombre, euros ou pourcent.'); out.unite = b.unite; }
  if (b.sens !== undefined) { if (!SENS.includes(b.sens)) throw erreur('Sens inconnu : hausse, baisse ou neutre.'); out.sens = b.sens; }
  if (b.cumul !== undefined) { if (!CUMULS.includes(b.cumul)) throw erreur('Cumul inconnu : somme, dernier ou moyenne.'); out.cumul = b.cumul; }
  if (b.role !== undefined) { if (!ROLES.includes(b.role || '')) throw erreur('Rôle inconnu.'); out.role = b.role || ''; }
  if (b.baseline !== undefined) out.baseline = nombreOuNull(b.baseline);
  if (b.ordre !== undefined) out.ordre = Number(b.ordre) || 0;
  // Un pourcentage ne s'additionne pas d'un mois à l'autre.
  const unite = out.unite || existant.unite;
  if (unite === 'pourcent' && b.cumul === undefined && !existant.id) out.cumul = 'moyenne';
  return out;
}

function ajouterIndicateur(clientId, b = {}) {
  client(clientId);
  const v = nettoyerIndicateur({ unite: 'nombre', sens: 'hausse', role: '', ...b });
  if (!v.libelle) throw erreur('Donne un nom à l’indicateur.');
  // Un seul indicateur par rôle : sinon le ROI compterait deux fois le même CA.
  if (v.role) run(`UPDATE clients_indicateurs SET role = '' WHERE client_id = ? AND role = ?`, Number(clientId), v.role);
  const ordre = v.ordre || ((get('SELECT MAX(ordre) AS m FROM clients_indicateurs WHERE client_id = ?', Number(clientId)).m || 0) + 1);
  const { lastId } = run(
    'INSERT INTO clients_indicateurs (client_id, libelle, unite, sens, cumul, role, baseline, ordre) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    Number(clientId), v.libelle, v.unite, v.sens, v.cumul || 'somme', v.role, v.baseline === undefined ? null : v.baseline, ordre
  );
  return get('SELECT * FROM clients_indicateurs WHERE id = ?', lastId);
}

function modifierIndicateur(id, b = {}) {
  const ind = get('SELECT * FROM clients_indicateurs WHERE id = ?', Number(id));
  if (!ind) throw erreur('Cet indicateur n’existe plus. Recharge la page.', 404);
  const v = nettoyerIndicateur(b, ind);
  if (v.role) run(`UPDATE clients_indicateurs SET role = '' WHERE client_id = ? AND role = ? AND id != ?`, ind.client_id, v.role, ind.id);
  const cles = Object.keys(v);
  if (cles.length) run(`UPDATE clients_indicateurs SET ${cles.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cles.map((k) => v[k]), ind.id);
  return get('SELECT * FROM clients_indicateurs WHERE id = ?', ind.id);
}

function supprimerIndicateur(id) { run('DELETE FROM clients_indicateurs WHERE id = ?', Number(id)); return { ok: true }; }

// ---------------------------------------------------------------- saisie du mois
// valeurs : [{ indicateur_id, objectif, reel }] ; une case vide efface la valeur.
function saisirMois(clientId, mois, valeurs = []) {
  client(clientId);
  verifierMois(mois);
  const ids = new Set(all('SELECT id FROM clients_indicateurs WHERE client_id = ?', Number(clientId)).map((r) => r.id));
  let n = 0;
  for (const v of valeurs) {
    const iid = Number(v.indicateur_id);
    if (!ids.has(iid)) continue;
    const exist = get('SELECT * FROM clients_mesures WHERE indicateur_id = ? AND mois = ?', iid, mois);
    const objectif = v.objectif !== undefined ? nombreOuNull(v.objectif) : (exist ? exist.objectif : null);
    const reel = v.reel !== undefined ? nombreOuNull(v.reel) : (exist ? exist.reel : null);
    if (objectif === null && reel === null) { run('DELETE FROM clients_mesures WHERE indicateur_id = ? AND mois = ?', iid, mois); continue; }
    run(`INSERT INTO clients_mesures (indicateur_id, mois, objectif, reel) VALUES (?, ?, ?, ?)
         ON CONFLICT(indicateur_id, mois) DO UPDATE SET objectif = excluded.objectif, reel = excluded.reel`, iid, mois, objectif, reel);
    n++;
  }
  return { enregistres: n, tableau: tableau(clientId) };
}

// ---------------------------------------------------------------- calculs
function cumuler(valeurs, mode) {
  const v = valeurs.filter((x) => x !== null && x !== undefined);
  if (!v.length) return null;
  if (mode === 'dernier') return v[v.length - 1];
  if (mode === 'moyenne') return v.reduce((a, b) => a + b, 0) / v.length;
  return v.reduce((a, b) => a + b, 0);
}
const ratio = (a, b) => (a === null || b === null || !b ? null : a / b);
const arrondi = (n, d = 2) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);

// Le tableau complet d'un client : indicateurs × mois, plus la synthèse argent.
function tableau(clientId, { jusqu_a } = {}) {
  const c = client(clientId);
  const inds = all('SELECT * FROM clients_indicateurs WHERE client_id = ? ORDER BY ordre, id', c.id);
  const mesures = inds.length
    ? all(`SELECT * FROM clients_mesures WHERE indicateur_id IN (${inds.map(() => '?').join(',')}) ORDER BY mois`, ...inds.map((i) => i.id))
    : [];
  const parInd = {};
  for (const m of mesures) (parInd[m.indicateur_id] = parInd[m.indicateur_id] || {})[m.mois] = m;

  const debut = c.debut || (mesures[0] && mesures[0].mois) || moisCourant();
  const dernierSaisi = mesures.reduce((max, m) => (m.mois > max ? m.mois : max), '');
  let fin = jusqu_a ? verifierMois(jusqu_a) : (dernierSaisi > moisCourant() ? dernierSaisi : moisCourant());
  if (fin < debut) fin = debut;
  const mois = plageMois(debut, fin);
  // Les mois « clos » (avec au moins un réel) servent aux cumuls ; les mois à venir ne portent que des objectifs.
  const moisAvecReel = new Set(mesures.filter((m) => m.reel !== null).map((m) => m.mois));

  const indicateurs = inds.map((ind) => {
    const lignes = mois.map((m) => {
      const x = (parInd[ind.id] || {})[m] || {};
      const reel = x.reel ?? null, objectif = x.objectif ?? null;
      return {
        mois: m, objectif, reel,
        atteinte: arrondi(ratio(reel, objectif), 3),
        vs_baseline: ind.baseline ? arrondi(ratio(reel === null ? null : reel - ind.baseline, ind.baseline), 3) : null,
      };
    });
    const total_reel = cumuler(lignes.map((l) => l.reel), ind.cumul);
    // L'objectif cumulé ne compte que les mois où CET indicateur a un réel : on compare le même périmètre.
    const total_objectif = cumuler(lignes.filter((l) => l.reel !== null).map((l) => l.objectif), ind.cumul);
    return { ...ind, mois: lignes, total_reel: arrondi(total_reel), total_objectif: arrondi(total_objectif), atteinte: arrondi(ratio(total_reel, total_objectif), 3) };
  });

  const parRole = (r) => indicateurs.find((i) => i.role === r);
  const indResa = parRole('reservations'), indCa = parRole('ca'), indPub = parRole('pub');

  // Synthèse argent, mois par mois : ce que le client a payé (honoraires + pub)
  // contre ce que les réseaux lui ont rapporté.
  const synthese = mois.map((m, i) => {
    const actif = moisAvecReel.has(m);
    const pub = indPub && indPub.mois[i].reel !== null ? indPub.mois[i].reel : (actif ? c.budget_pub_mensuel : null);
    const cout = actif ? (c.honoraires_mensuels || 0) + (pub || 0) : null;
    const reservations = indResa ? indResa.mois[i].reel : null;
    let ca = indCa ? indCa.mois[i].reel : null;
    let ca_estime = false;
    if (ca === null && reservations !== null && c.panier_moyen) { ca = reservations * c.panier_moyen; ca_estime = true; }
    return {
      mois: m, actif, cout, pub, reservations, ca: arrondi(ca), ca_estime,
      cout_par_reservation: arrondi(ratio(cout, reservations)),
      multiple: arrondi(ratio(ca, cout)),
      roi: cout && ca !== null ? arrondi((ca - cout) / cout, 3) : null,
    };
  });
  const actifs = synthese.filter((s) => s.actif);
  const somme = (k) => actifs.reduce((a, s) => a + (s[k] || 0), 0);
  const cout_total = somme('cout');
  const ca_total = actifs.some((s) => s.ca !== null) ? somme('ca') : null;
  const resa_total = actifs.some((s) => s.reservations !== null) ? somme('reservations') : null;
  // Un point de départ à 0 est une vraie valeur (aucune réservation en ligne avant OTEA).
  const baselineResa = indResa && indResa.baseline !== null && indResa.baseline !== undefined ? indResa.baseline : null;
  // Chaque ratio rapporte un chiffre au coût des MÊMES mois : un mois où seuls les
  // abonnés sont saisis ne doit pas gonfler le coût par réservation ni baisser le ROI.
  const coutSur = (f) => actifs.filter(f).reduce((a, s) => a + (s.cout || 0), 0);
  const cout_resa = coutSur((s) => s.reservations !== null);
  const cout_ca = coutSur((s) => s.ca !== null);
  const cumul = {
    mois_suivis: actifs.length,
    cout_total: arrondi(cout_total),
    ca_total: arrondi(ca_total),
    ca_estime: actifs.some((s) => s.ca_estime),
    reservations: resa_total,
    cout_periode_ca: arrondi(cout_ca),
    cout_par_reservation: arrondi(ratio(cout_resa, resa_total)),
    multiple: arrondi(ratio(ca_total, cout_ca)),
    roi: cout_ca && ca_total !== null ? arrondi((ca_total - cout_ca) / cout_ca, 3) : null,
    // Réservations en plus de ce que le client faisait avant nous, sur la période.
    reservations_en_plus: baselineResa !== null && resa_total !== null ? arrondi(resa_total - baselineResa * actifs.filter((s) => s.reservations !== null).length) : null,
  };
  const manques = [];
  const moisFini = moisSuivant(moisCourant(), -1);
  if (mois.includes(moisFini) && !moisAvecReel.has(moisFini) && moisFini >= debut) manques.push(`Les chiffres de ${libelleMois(moisFini)} ne sont pas saisis.`);
  for (const ind of indicateurs) if (ind.baseline === null && ind.role !== 'pub') manques.push(`Point de départ manquant : ${ind.libelle}.`);
  if (!indResa) manques.push('Aucun indicateur ne compte les réservations : le coût par réservation ne peut pas se calculer.');
  if (!indCa && !c.panier_moyen) manques.push('Ni CA saisi ni panier moyen : le ROI ne peut pas se calculer.');

  return { client: c, mois, indicateurs, synthese, cumul, manques, modeles: Object.fromEntries(Object.entries(MODELES).map(([k, m]) => [k, m.titre])) };
}

function liste() {
  return all('SELECT * FROM clients_suivis WHERE archive = 0 ORDER BY nom').map((c) => {
    const t = tableau(c.id);
    const dernier = [...t.synthese].reverse().find((s) => s.actif) || null;
    return { ...c, cumul: t.cumul, dernier_mois: dernier, manques: t.manques.length, premier_manque: t.manques[0] || '' };
  });
}

// ---------------------------------------------------------------- rapport
function fmtNombre(n, unite) {
  if (n === null || n === undefined) return 'non saisi';
  if (unite === 'pourcent') return `${(Math.round(n * 10) / 10).toLocaleString('fr-FR')} %`;
  // Sous 100 €, les centimes comptent (un coût par réservation de 6,66 €).
  const d = unite === 'euros' && Math.abs(n) < 100 && n % 1 ? 2 : 0;
  const s = n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/\u202f|\u00a0/g, ' ');
  return unite === 'euros' ? `${s} €` : s;
}
function fmtPct(r) { return r === null || r === undefined ? '' : `${Math.round(r * 100)} %`; }

// Le rapport mensuel, en texte prêt à coller dans un mail ou un doc.
function rapport(clientId, mois) {
  const m = mois ? verifierMois(mois) : moisSuivant(moisCourant(), -1);
  // Le rapport d'un mois s'arrête à ce mois : jamais de chiffres que le client ne pouvait pas encore avoir.
  const t = tableau(clientId, { jusqu_a: m });
  const i = t.mois.indexOf(m);
  if (i < 0) throw erreur(`${libelleMois(m)} est hors de la période suivie (depuis ${libelleMois(t.mois[0])}).`);
  const s = t.synthese[i];
  const L = [];
  L.push(`Rapport mensuel · ${t.client.nom} · ${libelleMois(m)}`);
  L.push('');
  L.push('Les chiffres du mois');
  for (const ind of t.indicateurs) {
    const l = ind.mois[i];
    if (l.reel === null && l.objectif === null) continue;
    let ligne = `· ${ind.libelle} : ${fmtNombre(l.reel, ind.unite)}`;
    if (l.objectif !== null) ligne += ` (objectif ${fmtNombre(l.objectif, ind.unite)}${l.atteinte !== null ? `, atteint à ${fmtPct(l.atteinte)}` : ''})`;
    if (l.vs_baseline !== null && ind.role !== 'pub') ligne += `, ${l.vs_baseline >= 0 ? '+' : ''}${Math.round(l.vs_baseline * 100)} % par rapport au point de départ`;
    L.push(ligne);
  }
  L.push('');
  L.push('Ce que ça rapporte');
  if (s.reservations !== null) L.push(`· Réservations : ${fmtNombre(s.reservations)}`);
  if (s.ca !== null) L.push(`· CA généré : ${fmtNombre(s.ca, 'euros')}${s.ca_estime ? ` (estimé : réservations × panier moyen de ${fmtNombre(t.client.panier_moyen, 'euros')})` : ''}`);
  if (s.cout !== null) L.push(`· Investissement du mois (accompagnement + pub) : ${fmtNombre(s.cout, 'euros')} HT`);
  if (s.cout_par_reservation !== null) L.push(`· Coût par réservation : ${fmtNombre(s.cout_par_reservation, 'euros')}`);
  if (s.multiple !== null) L.push(`· Chaque euro investi a rapporté ${s.multiple.toLocaleString('fr-FR')} €`);
  const c = t.cumul;
  if (c.mois_suivis > 1) {
    L.push('');
    L.push(`Depuis le début (${c.mois_suivis} mois)`);
    if (c.reservations !== null) L.push(`· ${fmtNombre(c.reservations)} réservations${c.reservations_en_plus !== null ? `, dont ${fmtNombre(c.reservations_en_plus)} de plus qu’avant l’accompagnement` : ''}`);
    if (c.ca_total !== null) L.push(`· ${fmtNombre(c.ca_total, 'euros')} de CA généré pour ${fmtNombre(c.cout_periode_ca, 'euros')} investis`);
    if (c.roi !== null) L.push(`· Retour sur investissement : ${c.roi >= 0 ? '+' : ''}${Math.round(c.roi * 100)} %`);
  }
  const suivant = moisSuivant(m);
  const tSuiv = tableau(clientId, { jusqu_a: suivant });
  const j = tSuiv.mois.indexOf(suivant);
  const objectifs = j >= 0 ? tSuiv.indicateurs.filter((ind) => ind.mois[j].objectif !== null) : [];
  if (objectifs.length) {
    L.push('');
    L.push(`Objectifs de ${libelleMois(suivant)}`);
    for (const ind of objectifs) L.push(`· ${ind.libelle} : ${fmtNombre(ind.mois[j].objectif, ind.unite)}`);
  }
  return { mois: m, texte: L.join('\n') };
}

module.exports = {
  MODELES, UNITES, SENS, CUMULS, ROLES,
  creerClient, modifierClient, supprimerClient, client,
  ajouterIndicateur, modifierIndicateur, supprimerIndicateur,
  saisirMois, tableau, liste, rapport,
  moisSuivant, libelleMois, plageMois,
};
