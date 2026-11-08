'use strict';
// 🧭 Le Cap : la projection business dans l'outil, pas dans un document à part.
//
// Trois horizons de jalons à cocher (les prochaines 24 et 48 heures, les
// prochains jours, les sept semaines de fin d'année, 2027), les six chiffres
// du lundi calculés depuis le CRM, la trajectoire 2027 face aux trois
// scénarios (prudent, cible, ambitieux) et les garde-fous. Le plan de
// départ vient de src/cap_plan.json ; Maxime coche, ajoute, supprime, et tout
// vit dans la base. Rien n'est estimé : ce qui n'est pas dans le CRM est
// marqué « à la main ».

const fs = require('node:fs');
const path = require('node:path');
const dbApi = require('./db');
const { db, get, all, run, nowIso, localDay } = dbApi;

const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, 'cap_plan.json'), 'utf8'));
const HORIZONS = [
  { code: '24h', titre: 'Les prochaines 24 heures', terme: 'court' },
  { code: '48h', titre: 'Les prochaines 48 heures', terme: 'court' },
  { code: 'jours', titre: 'Les prochains jours', terme: 'court' },
  { code: 'semaines', titre: 'Les prochaines semaines', terme: 'moyen' },
  { code: '2027', titre: '2027', terme: 'long' },
];
const SCENARIOS = Object.keys(PLAN.scenarios);

db.exec(`
CREATE TABLE IF NOT EXISTS cap_jalons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cle TEXT UNIQUE,                   -- jalons du plan de départ ; vide pour ceux ajoutés à la main
  horizon TEXT NOT NULL,             -- 24h | 48h | jours | semaines | 2027
  titre TEXT NOT NULL,
  detail TEXT DEFAULT '',
  echeance TEXT DEFAULT '',          -- jour (YYYY-MM-DD) ou vide
  ordre INTEGER DEFAULT 100,
  fait INTEGER DEFAULT 0,
  fait_le TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cap_jalons_horizon ON cap_jalons(horizon, fait, echeance);
`);

// Le plan de départ entre une fois ; un jalon déjà présent (coché ou modifié) n'est jamais réécrit.
function semer() {
  const now = nowIso();
  const ins = db.prepare('INSERT OR IGNORE INTO cap_jalons (cle, horizon, titre, detail, echeance, ordre, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const j of PLAN.jalons) ins.run(j.cle, j.horizon, j.titre, j.detail || '', j.echeance || '', j.ordre || 100, now, now);
}
semer();

// ---------------------------------------------------------------- réglages
function scenarioCourant() {
  const s = dbApi.getSetting('cap_scenario');
  return SCENARIOS.includes(s) ? s : 'cible';
}
function choisirScenario(code) {
  if (!SCENARIOS.includes(code)) throw new Error('Scénario inconnu. Choisis prudent, cible ou ambitieux.');
  dbApi.setSetting('cap_scenario', code);
  return code;
}
const CONCENTRATION_MAX = 25; // % du facturé des douze derniers mois

// ---------------------------------------------------------------- dates
function lundiDe(jour) {
  const d = new Date(jour + 'T12:00:00Z');
  const decal = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - decal);
  return d.toISOString().slice(0, 10);
}
function trimestreDe(jour) { return 'T' + (Math.floor((Number(jour.slice(5, 7)) - 1) / 3) + 1); }
function bornesTrimestre(annee, t) {
  const m = (Number(t.slice(1)) - 1) * 3 + 1;
  const debut = `${annee}-${String(m).padStart(2, '0')}-01`;
  const finM = m + 2;
  const fin = finM >= 12 ? `${annee + 1}-01-01` : `${annee}-${String(finM + 1).padStart(2, '0')}-01`;
  return { debut, fin };
}
const n = (sql, ...p) => Number(get(sql, ...p).n || 0);
const FACTURE = "status = 'facture'";
const ENVOYE_OU_PLUS = "status IN ('devis_envoye', 'accepte', 'facture', 'refuse')";

// ---------------------------------------------------------------- les six chiffres du lundi
function sixChiffres(jour = localDay()) {
  const lundi = lundiDe(jour);
  const huitSemaines = dbApi.addDays(lundi, -49);
  const scen = PLAN.scenarios[scenarioCourant()];
  const annee = Number(jour.slice(0, 4));
  const tri = trimestreDe(jour);
  const { debut: debutTri, fin: finTri } = bornesTrimestre(annee, tri);
  const cibleTri = annee === 2027 ? scen.trimestres[tri] : Number(dbApi.getSetting('cockpit_palier_moyen') || 0) || scen.trimestres.T1;

  // 1. Devis sous 48 h : les rendez-vous pris sur huit semaines suivis d'un devis dans les 48 h.
  const rdvs = all(`SELECT contact_id, created_at FROM activities WHERE type = 'rdv_pris' AND day >= ? AND day <= ? AND contact_id IS NOT NULL`, huitSemaines, jour);
  let sous48 = 0;
  for (const r of rdvs) {
    const limite = new Date(new Date(r.created_at).getTime() + 48 * 3600 * 1000).toISOString();
    if (get(`SELECT id FROM deals WHERE contact_id = ? AND created_at >= ? AND created_at <= ? AND status != 'brouillon'`, r.contact_id, r.created_at, limite)) sous48++;
  }
  const rdvSansDevis = all(`SELECT a.contact_id, a.created_at, c.first_name, c.last_name, c.company FROM activities a JOIN contacts c ON c.id = a.contact_id
    WHERE a.type = 'rdv_pris' AND a.day >= ? AND a.created_at <= ? AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = a.contact_id AND d.created_at >= a.created_at AND d.status != 'brouillon')
    ORDER BY a.created_at ASC`, dbApi.addDays(jour, -60), new Date(Date.now() - 48 * 3600 * 1000).toISOString());

  // 2. Devis envoyés cette semaine.
  const envoyes = get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM deals WHERE ${ENVOYE_OU_PLUS} AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`, lundi, jour);

  // 3. Taux de signature sur huit semaines glissantes.
  const base8 = n(`SELECT COUNT(*) AS n FROM deals WHERE ${ENVOYE_OU_PLUS} AND substr(created_at, 1, 10) >= ?`, huitSemaines);
  const signes8 = n(`SELECT COUNT(*) AS n FROM deals WHERE status IN ('accepte', 'facture') AND substr(created_at, 1, 10) >= ?`, huitSemaines);

  // 4. Couverture du pipeline : devis ouverts pondérés face à ce qui manque au trimestre.
  const ouverts = Number(get(`SELECT COALESCE(SUM(amount), 0) AS n FROM deals WHERE status = 'devis_envoye'`).n);
  const acceptes = Number(get(`SELECT COALESCE(SUM(amount), 0) AS n FROM deals WHERE status = 'accepte'`).n);
  const factureTri = Number(get(`SELECT COALESCE(SUM(amount), 0) AS n FROM deals WHERE ${FACTURE} AND invoiced_at >= ? AND invoiced_at < ?`, debutTri, finTri).n);
  const reste = Math.max(0, cibleTri - factureTri);
  const pondere = ouverts * 0.5 + acceptes * 0.9;

  // 5. Recommandations reçues cette semaine : contacts arrivés par le réseau.
  const recos = n(`SELECT COUNT(*) AS n FROM contacts WHERE substr(created_at, 1, 10) >= ? AND (lower(origin) LIKE '%bni%' OR lower(origin) LIKE '%recommand%' OR lower(origin) LIKE '%reco%' OR lower(tags) LIKE '%recommand%')`, lundi);

  // 6. Cash : facturé du mois face à la cible mensuelle, et ce qui attend d'être facturé.
  const mois = jour.slice(0, 7);
  const factureMois = Number(get(`SELECT COALESCE(SUM(amount), 0) AS n FROM deals WHERE ${FACTURE} AND substr(invoiced_at, 1, 7) = ?`, mois).n);
  const aFacturer = acceptes;

  return {
    semaine_du: lundi,
    scenario: scenarioCourant(),
    chiffres: [
      { code: 'devis_48h', titre: 'Devis sous 48 h', valeur: rdvs.length ? Math.round((sous48 / rdvs.length) * 100) : null, unite: '%', cible: 100, detail: rdvs.length ? `${sous48} sur ${rdvs.length} rendez-vous en huit semaines` : 'Aucun rendez-vous noté sur huit semaines', etat: rdvs.length ? (sous48 === rdvs.length ? 'ok' : 'alerte') : 'vide', retard: rdvSansDevis.map((r) => ({ contact_id: r.contact_id, nom: `${r.first_name} ${r.last_name}`.trim() || r.company, societe: r.company, depuis: r.created_at.slice(0, 10) })) },
      { code: 'devis_envoyes', titre: 'Devis envoyés cette semaine', valeur: Number(envoyes.total), unite: '€', cible: Math.round((cibleTri / 3) * 2), detail: `${envoyes.n} devis depuis lundi · objectif : deux fois le mois, soit ${Math.round((cibleTri / 3) * 2).toLocaleString('fr-FR')} € par mois`, etat: Number(envoyes.total) >= (cibleTri / 3) * 2 / 4 ? 'ok' : 'alerte' },
      { code: 'taux_signature', titre: 'Taux de signature (8 semaines)', valeur: base8 ? Math.round((signes8 / base8) * 100) : null, unite: '%', cible: 30, detail: base8 ? `${signes8} signé${signes8 > 1 ? 's' : ''} sur ${base8} devis` : 'Aucun devis envoyé sur huit semaines', etat: base8 ? (signes8 / base8 >= 0.3 ? 'ok' : 'alerte') : 'vide' },
      { code: 'couverture', titre: 'Couverture du pipeline', valeur: reste ? Math.round((pondere / reste) * 10) / 10 : null, unite: '×', cible: 2, detail: reste ? `${Math.round(pondere).toLocaleString('fr-FR')} € pondérés face aux ${Math.round(reste).toLocaleString('fr-FR')} € qui manquent au trimestre` : 'Objectif du trimestre atteint', etat: !reste ? 'ok' : pondere / reste >= 2 ? 'ok' : 'alerte' },
      { code: 'recommandations', titre: 'Recommandations reçues', valeur: recos, unite: '', cible: 1, detail: 'Contacts arrivés par le BNI ou une recommandation depuis lundi', etat: recos >= 1 ? 'ok' : 'alerte' },
      { code: 'cash', titre: 'Facturé ce mois', valeur: factureMois, unite: '€', cible: Math.round(cibleTri / 3), detail: `${Math.round(aFacturer).toLocaleString('fr-FR')} € acceptés pas encore facturés · solde bancaire et plancher : à vérifier à la main`, etat: factureMois >= cibleTri / 3 ? 'ok' : 'alerte' },
    ],
  };
}

// ---------------------------------------------------------------- trajectoire 2027
function trajectoire(jour = localDay()) {
  const scen = scenarioCourant();
  const annee = 2027;
  const trimestres = ['T1', 'T2', 'T3', 'T4'].map((t) => {
    const { debut, fin } = bornesTrimestre(annee, t);
    const facture = Number(get(`SELECT COALESCE(SUM(amount), 0) AS n FROM deals WHERE ${FACTURE} AND invoiced_at >= ? AND invoiced_at < ?`, debut, fin).n);
    const precedent = Number(get(`SELECT COALESCE(SUM(amount), 0) AS n FROM deals WHERE ${FACTURE} AND invoiced_at >= ? AND invoiced_at < ?`, debut.replace('2027', '2026'), fin.replace('2027', '2026').replace('2028', '2027')).n);
    return {
      code: t, debut, fin,
      facture, facture_2026: precedent,
      cibles: Object.fromEntries(SCENARIOS.map((s) => [s, PLAN.scenarios[s].trimestres[t]])),
      cible: PLAN.scenarios[scen].trimestres[t],
      en_cours: jour >= debut && jour < fin,
      passe: jour >= fin,
    };
  });
  const totalFacture = trimestres.reduce((s, t) => s + t.facture, 0);
  const facture2026 = Number(get(`SELECT COALESCE(SUM(amount), 0) AS n FROM deals WHERE ${FACTURE} AND invoiced_at >= '2026-01-01' AND invoiced_at < '2027-01-01'`).n);
  return {
    scenario: scen,
    scenarios: Object.fromEntries(SCENARIOS.map((s) => [s, { ...PLAN.scenarios[s] }])),
    trimestres,
    total_facture: totalFacture,
    total_cible: PLAN.scenarios[scen].total,
    facture_2026: facture2026,
  };
}

// ---------------------------------------------------------------- garde-fous
function gardeFous(jour = localDay()) {
  const depuis = dbApi.addDays(jour, -365);
  const total = Number(get(`SELECT COALESCE(SUM(d.amount), 0) AS n FROM deals d WHERE d.${FACTURE} AND d.invoiced_at >= ?`, depuis).n);
  const premier = get(`SELECT COALESCE(NULLIF(c.company, ''), c.last_name) AS nom, SUM(d.amount) AS total FROM deals d JOIN contacts c ON c.id = d.contact_id
    WHERE d.${FACTURE} AND d.invoiced_at >= ? GROUP BY nom ORDER BY total DESC LIMIT 1`, depuis);
  const part = premier && total ? Math.round((Number(premier.total) / total) * 100) : null;
  const six = sixChiffres(jour);
  const devis48 = six.chiffres.find((c) => c.code === 'devis_48h');
  return PLAN.garde_fous.map((g) => {
    if (g.code === 'concentration') {
      return { ...g, etat: part === null ? 'vide' : part > CONCENTRATION_MAX ? 'alerte' : 'ok', valeur: part === null ? 'Aucune facture sur douze mois dans le CRM' : `${premier.nom} : ${part} % du facturé des douze derniers mois (${Math.round(total).toLocaleString('fr-FR')} € HT)` };
    }
    if (g.code === 'devis_48h') {
      const retard = devis48.retard.length;
      return { ...g, etat: retard ? 'alerte' : devis48.valeur === null ? 'vide' : 'ok', valeur: retard ? `${retard} rendez-vous sans devis depuis plus de 48 h` : 'Aucun rendez-vous sans devis' };
    }
    return { ...g, etat: 'manuel', valeur: '' };
  });
}

// ---------------------------------------------------------------- jalons
function listerJalons() {
  const lignes = all('SELECT * FROM cap_jalons ORDER BY horizon, fait ASC, ordre ASC, echeance ASC, id ASC');
  const jour = localDay();
  return HORIZONS.map((h) => {
    const jalons = lignes.filter((j) => j.horizon === h.code).map((j) => ({ ...j, fait: !!j.fait, en_retard: !j.fait && j.echeance && j.echeance < jour }));
    const faits = jalons.filter((j) => j.fait).length;
    return { ...h, jalons, total: jalons.length, faits, pct: jalons.length ? Math.round((faits / jalons.length) * 100) : 0 };
  });
}
function ajouterJalon({ horizon, titre, detail = '', echeance = '' }) {
  if (!HORIZONS.some((h) => h.code === horizon)) throw new Error('Horizon inconnu.');
  const t = String(titre || '').trim();
  if (!t) throw new Error('Écris le jalon avant de l\'ajouter.');
  const now = nowIso();
  const maxOrdre = n('SELECT COALESCE(MAX(ordre), 0) AS n FROM cap_jalons WHERE horizon = ?', horizon);
  const { lastId } = run('INSERT INTO cap_jalons (cle, horizon, titre, detail, echeance, ordre, created_at, updated_at) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)', horizon, t, String(detail || '').trim(), String(echeance || '').slice(0, 10), maxOrdre + 1, now, now);
  return get('SELECT * FROM cap_jalons WHERE id = ?', lastId);
}
function basculerJalon(id) {
  const j = get('SELECT * FROM cap_jalons WHERE id = ?', id);
  if (!j) throw new Error('Ce jalon n\'existe plus.');
  const fait = j.fait ? 0 : 1;
  run('UPDATE cap_jalons SET fait = ?, fait_le = ?, updated_at = ? WHERE id = ?', fait, fait ? nowIso() : '', nowIso(), id);
  return get('SELECT * FROM cap_jalons WHERE id = ?', id);
}
function supprimerJalon(id) {
  const { changes } = run('DELETE FROM cap_jalons WHERE id = ?', id);
  if (!changes) throw new Error('Ce jalon n\'existe plus.');
  return { ok: true };
}

// ---------------------------------------------------------------- l'état complet
function etat() {
  const jour = localDay();
  return {
    genere_le: nowIso(),
    jour,
    version_plan: PLAN.version,
    horizons: listerJalons(),
    lundi: sixChiffres(jour),
    trajectoire: trajectoire(jour),
    garde_fous: gardeFous(jour),
  };
}

module.exports = { etat, sixChiffres, trajectoire, gardeFous, listerJalons, ajouterJalon, basculerJalon, supprimerJalon, choisirScenario, scenarioCourant, lundiDe, trimestreDe, HORIZONS, SCENARIOS, PLAN };
