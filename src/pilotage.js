'use strict';
// 🧭 Pilotage : la revue de la semaine d'OTEA Production (le CEO Day).
// L'argent d'abord, en séparant toujours facturé (la date de la facture) et
// encaissé (la date du paiement). Puis les devis qui attendent, les relances
// dues, les échéances de la semaine et l'état des clients suivis.

const dbApi = require('./db');
const { get, all, run, nowIso, localDay, addDays } = dbApi;
const clients = require('./clients');

const STATUTS_FACTURE = ['brouillon', 'a_payer', 'payee', 'annulee'];
const STATUTS_DEVIS = ['en_attente', 'accepte', 'refuse', 'expire', 'facture'];

function erreur(message, status = 400) { const e = new Error(message); e.httpStatus = status; return e; }
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const jour = (v) => (String(v || '').match(/^\d{4}-\d{2}-\d{2}/) || [''])[0];
const arr = (n) => Math.round(n * 100) / 100;

function pick(obj, ...keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, part) => (o ? o[part] : undefined), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

// ---------------------------------------------------------------- Pennylane → pièces
// Traduit une facture client Pennylane (API v2) en pièce. Pure : testable sans réseau.
function factureDepuisPennylane(inv, { nomClient = '' } = {}) {
  const ttc = num(pick(inv, 'amount', 'currency_amount'));
  const ht = num(pick(inv, 'currency_amount_before_tax', 'amount_before_tax')) || ttc;
  const reste = pick(inv, 'remaining_amount_with_tax', 'remaining_amount');
  const brut = String(pick(inv, 'status') || '').toLowerCase();
  const paye = inv.paid === true || brut === 'paid';
  // Un avoir (montant négatif ou lié à une facture créditée) n'est ni à encaisser
  // ni encaissé : on le range avec les annulées, sinon il passerait « en retard »
  // et serait retiré une seconde fois du facturé quand sa facture est déjà annulée.
  const avoir = ttc < 0 || !!pick(inv, 'credited_invoice', 'credited_invoice_id') || inv.is_credit_note === true;
  let statut = 'a_payer';
  if (inv.draft === true || brut === 'draft') statut = 'brouillon';
  else if (avoir || ['cancelled', 'canceled', 'archived'].includes(brut)) statut = 'annulee';
  else if (paye) statut = 'payee';
  return {
    type: 'facture', source: 'pennylane', source_id: String(pick(inv, 'id')),
    numero: String(pick(inv, 'invoice_number', 'number') || ''),
    client: nomClient || String(pick(inv, 'customer.name', 'thirdparty.name') || ''),
    libelle: String(pick(inv, 'label', 'pdf_invoice_subject') || ''),
    date: jour(pick(inv, 'date', 'issue_date')),
    echeance: jour(pick(inv, 'deadline', 'due_date')),
    montant_ht: arr(ht), montant_ttc: arr(ttc),
    reste_du: statut === 'a_payer' ? arr(reste === '' ? ttc : num(reste)) : 0,
    statut,
    paye_le: statut === 'payee' ? jour(pick(inv, 'paid_at', 'payment_date', 'fully_paid_at')) : '',
    customer_id: String(pick(inv, 'customer.id', 'customer_id') || ''),
  };
}

function devisDepuisPennylane(q, { nomClient = '' } = {}) {
  const brut = String(pick(q, 'status') || '').toLowerCase();
  const statut = { pending: 'en_attente', accepted: 'accepte', denied: 'refuse', refused: 'refuse', expired: 'expire', invoiced: 'facture' }[brut] || 'en_attente';
  const ttc = num(pick(q, 'amount', 'currency_amount'));
  return {
    type: 'devis', source: 'pennylane', source_id: String(pick(q, 'id')),
    numero: String(pick(q, 'quote_number', 'number') || ''),
    client: nomClient || String(pick(q, 'customer.name', 'thirdparty.name') || ''),
    libelle: String(pick(q, 'label', 'pdf_invoice_subject') || ''),
    date: jour(pick(q, 'date')), echeance: jour(pick(q, 'deadline')),
    montant_ht: arr(num(pick(q, 'currency_amount_before_tax', 'amount_before_tax')) || ttc), montant_ttc: arr(ttc),
    reste_du: 0, statut, paye_le: '',
    customer_id: String(pick(q, 'customer.id', 'customer_id') || ''),
  };
}

// Enregistre (ou met à jour) une pièce venue d'une source externe.
// Une facture qui passe de « à payer » à « payée » sans date de paiement
// connue prend la date du jour où on l'a vue payée : c'est l'encaissement.
// Déjà payée à la première lecture et sans date : on n'en invente pas, elle
// reste sans date d'encaissement (la revue le signale) plutôt que dans le mauvais mois.
function enregistrer(p) {
  const contact = p.customer_id ? get('SELECT id, company, first_name, last_name FROM contacts WHERE pennylane_customer_id = ?', p.customer_id) : null;
  const nomContact = contact ? (contact.company || `${contact.first_name || ''} ${contact.last_name || ''}`.trim()) : '';
  const nom = p.client || nomContact || p.libelle || '';
  const exist = get('SELECT * FROM pieces WHERE source = ? AND type = ? AND source_id = ?', p.source, p.type, p.source_id);
  let paye_le = p.paye_le;
  if (p.statut === 'payee' && !paye_le) paye_le = exist ? (exist.paye_le || (exist.statut !== 'payee' ? localDay() : '')) : '';
  const now = nowIso();
  if (exist) {
    // Ce que Maxime a coché à la main (« Payée », « Accepté ») ne recule pas
    // parce que Pennylane n'a pas encore rapproché le paiement.
    if (p.type === 'facture' && exist.statut === 'payee' && p.statut === 'a_payer') { p.statut = 'payee'; p.reste_du = 0; paye_le = exist.paye_le; }
    if (p.type === 'devis' && ['accepte', 'facture'].includes(exist.statut) && p.statut === 'en_attente') p.statut = exist.statut;
    run(`UPDATE pieces SET numero = ?, client = ?, libelle = ?, date = ?, echeance = ?, montant_ht = ?, montant_ttc = ?, reste_du = ?, statut = ?, paye_le = ?, contact_id = COALESCE(?, contact_id), updated_at = ? WHERE id = ?`,
      p.numero, nom, p.libelle, p.date, p.echeance, p.montant_ht, p.montant_ttc, p.reste_du, p.statut, paye_le || '', contact ? contact.id : null, now, exist.id);
    return { id: exist.id, cree: false };
  }
  const { lastId } = run(`INSERT INTO pieces (type, source, source_id, numero, client, libelle, date, echeance, montant_ht, montant_ttc, reste_du, statut, paye_le, contact_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.type, p.source, p.source_id, p.numero, nom, p.libelle, p.date, p.echeance, p.montant_ht, p.montant_ttc, p.reste_du, p.statut, paye_le || '', contact ? contact.id : null, now, now);
  return { id: lastId, cree: true };
}

async function synchroniserPennylane() {
  const pennylane = require('./integrations/pennylane');
  const out = { factures: 0, devis: 0, nouvelles: 0, erreur_devis: null };
  for (const inv of await pennylane.listAll('/customer_invoices')) {
    const p = factureDepuisPennylane(inv);
    if (!p.source_id) continue;
    if (enregistrer(p).cree) out.nouvelles++;
    out.factures++;
  }
  try {
    for (const q of await pennylane.listAll('/quotes')) {
      const p = devisDepuisPennylane(q);
      if (!p.source_id) continue;
      enregistrer(p);
      out.devis++;
    }
  } catch (e) { out.erreur_devis = e.message; }
  dbApi.setSetting('pilotage_sync_le', nowIso());
  return out;
}

// ---------------------------------------------------------------- saisie à la main
function nettoyer(b, partiel = false) {
  const p = {};
  if (b.type !== undefined || !partiel) { p.type = b.type === 'devis' ? 'devis' : 'facture'; }
  for (const k of ['numero', 'client', 'libelle']) if (b[k] !== undefined) p[k] = String(b[k]).trim();
  for (const k of ['date', 'echeance', 'paye_le']) if (b[k] !== undefined) { p[k] = jour(b[k]); if (b[k] && !p[k]) throw erreur('Une date doit être au format AAAA-MM-JJ.'); }
  for (const k of ['montant_ht', 'montant_ttc', 'reste_du']) if (b[k] !== undefined) p[k] = arr(num(b[k]));
  if (b.statut !== undefined) p.statut = b.statut;
  return p;
}

function creerPiece(b = {}) {
  const p = nettoyer(b);
  if (!p.client) throw erreur('Indique le client de la pièce.');
  if (!p.montant_ht && !p.montant_ttc) throw erreur('Indique un montant (HT ou TTC).');
  if (!p.montant_ttc) p.montant_ttc = arr(p.montant_ht * 1.2);
  if (!p.montant_ht) p.montant_ht = arr(p.montant_ttc / 1.2);
  const statuts = p.type === 'devis' ? STATUTS_DEVIS : STATUTS_FACTURE;
  p.statut = statuts.includes(p.statut) ? p.statut : statuts[p.type === 'devis' ? 0 : 1];
  p.date = p.date || localDay();
  if (p.type === 'facture' && p.statut === 'a_payer' && b.reste_du === undefined) p.reste_du = p.montant_ttc;
  if (p.statut === 'payee' && !p.paye_le) p.paye_le = localDay();
  const now = nowIso();
  const { lastId } = run(`INSERT INTO pieces (type, source, numero, client, libelle, date, echeance, montant_ht, montant_ttc, reste_du, statut, paye_le, created_at, updated_at)
    VALUES (?, 'manuel', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.type, p.numero || '', p.client, p.libelle || '', p.date, p.echeance || '', p.montant_ht, p.montant_ttc, p.reste_du || 0, p.statut, p.paye_le || '', now, now);
  return get('SELECT * FROM pieces WHERE id = ?', lastId);
}

function modifierPiece(id, b = {}) {
  const exist = get('SELECT * FROM pieces WHERE id = ?', Number(id));
  if (!exist) throw erreur('Cette pièce n’existe plus. Recharge la page.', 404);
  const p = nettoyer(b, true);
  delete p.type;
  if (p.statut !== undefined) {
    const statuts = exist.type === 'devis' ? STATUTS_DEVIS : STATUTS_FACTURE;
    if (!statuts.includes(p.statut)) throw erreur(`Statut inconnu pour un ${exist.type}.`);
    // Marquer payée = encaissement du jour, sauf date donnée.
    if (p.statut === 'payee') { p.reste_du = 0; if (!p.paye_le) p.paye_le = exist.paye_le || localDay(); }
    if (p.statut === 'a_payer' && exist.statut === 'payee') { p.paye_le = ''; if (p.reste_du === undefined) p.reste_du = exist.montant_ttc; }
  }
  const cles = Object.keys(p);
  if (cles.length) run(`UPDATE pieces SET ${cles.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...cles.map((k) => p[k]), nowIso(), exist.id);
  return get('SELECT * FROM pieces WHERE id = ?', exist.id);
}

function supprimerPiece(id) { run('DELETE FROM pieces WHERE id = ?', Number(id)); return { ok: true }; }

// ---------------------------------------------------------------- la revue
function lundi(d) {
  const [y, m, j] = d.split('-').map(Number);
  const dt = new Date(y, m - 1, j);
  return addDays(d, -((dt.getDay() + 6) % 7));
}
const ecart = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

function argentDuMois(mois) {
  const f = get(`SELECT COALESCE(SUM(montant_ht), 0) AS ht, COALESCE(SUM(montant_ttc), 0) AS ttc, COUNT(*) AS n FROM pieces
    WHERE type = 'facture' AND statut IN ('a_payer', 'payee') AND substr(date, 1, 7) = ?`, mois);
  const e = get(`SELECT COALESCE(SUM(montant_ttc), 0) AS ttc, COALESCE(SUM(montant_ht), 0) AS ht, COUNT(*) AS n FROM pieces
    WHERE type = 'facture' AND statut = 'payee' AND substr(paye_le, 1, 7) = ?`, mois);
  return { mois, facture_ht: arr(f.ht), facture_ttc: arr(f.ttc), factures: f.n, encaisse_ttc: arr(e.ttc), encaisse_ht: arr(e.ht), encaissements: e.n };
}

// Les devis ouverts : Pennylane (ou saisis à la main) + ceux du pipeline local pas encore facturés.
function devisOuverts(today) {
  const dans7 = addDays(today, 7);
  const devis = all(`SELECT * FROM pieces WHERE type = 'devis' AND statut IN ('en_attente', 'accepte') ORDER BY date`)
    .map((p) => ({ ...p, origine: 'piece', age: p.date ? ecart(p.date, today) : 0, expire_bientot: !!(p.echeance && p.echeance >= today && p.echeance <= dans7), expire: !!(p.echeance && p.echeance < today) }));
  // Un devis connu de Pennylane se lit toujours par sa pièce (son vrai statut),
  // même facturé, refusé ou expiré : jamais une seconde fois par le pipeline.
  const plIds = new Set(all(`SELECT source_id FROM pieces WHERE type = 'devis' AND source = 'pennylane'`).map((r) => String(r.source_id)));
  const deals = all(`SELECT d.*, c.company, c.first_name, c.last_name FROM deals d JOIN contacts c ON c.id = d.contact_id
    WHERE d.status IN ('devis_envoye', 'accepte') ORDER BY d.updated_at`)
    .filter((d) => !d.pennylane_invoice_id && (!d.pennylane_quote_id || !plIds.has(String(d.pennylane_quote_id))))
    .map((d) => ({
      id: d.id, origine: 'deal', contact_id: d.contact_id, client: d.company || `${d.first_name} ${d.last_name}`.trim(),
      libelle: d.title, montant_ht: d.amount, statut: d.status === 'accepte' ? 'accepte' : 'en_attente',
      date: jour(d.updated_at), age: ecart(jour(d.updated_at), today), expire_bientot: false, expire: false,
    }));
  return { devis, deals, tousDevis: [...devis, ...deals] };
}

// ---------------------------------------------------------------- la prévision
// Ce qui doit rentrer sur les 8 prochaines semaines (lundi au dimanche), en TTC.
// · À encaisser : les factures « à payer », rangées à leur échéance (sans
//   échéance : date de facture + 30 jours). Ce qui est déjà échu va dans une
//   première colonne « en retard ».
// · Acceptés à facturer : un potentiel, pas une créance. Un devis accepté pas
//   encore facturé est supposé payé 30 jours après sa date, jamais avant
//   aujourd'hui. Les montants HT sans TTC connu prennent 20 % de TVA (estimé).
const NB_SEMAINES = 8;
const DELAI_PAIEMENT = 30;
const TVA = 0.2;

function prevision({ today = localDay() } = {}) {
  const debut = lundi(today);
  const semaines = [];
  for (let i = 0; i < NB_SEMAINES; i++) {
    const d = addDays(debut, i * 7);
    semaines.push({ debut: d, fin: addDays(d, 6), a_encaisser_ttc: 0, acceptes_ttc: 0, factures: 0, devis: 0 });
  }
  const fin = semaines[NB_SEMAINES - 1].fin;
  const retard = { a_encaisser_ttc: 0, factures: 0 };
  const plusTard = { a_encaisser_ttc: 0, acceptes_ttc: 0 };
  const semaineDe = (d) => semaines[Math.floor(ecart(debut, d) / 7)];

  for (const p of all(`SELECT * FROM pieces WHERE type = 'facture' AND statut = 'a_payer'`)) {
    const du = Number(p.reste_du) || 0;
    if (du <= 0) continue;
    const attendu = p.echeance || (p.date ? addDays(p.date, DELAI_PAIEMENT) : today);
    if (attendu < today) { retard.a_encaisser_ttc += du; retard.factures++; }
    else if (attendu > fin) plusTard.a_encaisser_ttc += du;
    else { const s = semaineDe(attendu); s.a_encaisser_ttc += du; s.factures++; }
  }

  for (const d of devisOuverts(today).tousDevis.filter((x) => x.statut === 'accepte')) {
    const ttc = Number(d.montant_ttc) > 0 ? Number(d.montant_ttc) : (Number(d.montant_ht) || 0) * (1 + TVA);
    if (ttc <= 0) continue;
    let attendu = d.date ? addDays(d.date, DELAI_PAIEMENT) : today;
    if (attendu < today) attendu = today;
    if (attendu > fin) plusTard.acceptes_ttc += ttc;
    else { const s = semaineDe(attendu); s.acceptes_ttc += ttc; s.devis++; }
  }

  for (const s of semaines) { s.a_encaisser_ttc = arr(s.a_encaisser_ttc); s.acceptes_ttc = arr(s.acceptes_ttc); }
  retard.a_encaisser_ttc = arr(retard.a_encaisser_ttc);
  plusTard.a_encaisser_ttc = arr(plusTard.a_encaisser_ttc); plusTard.acceptes_ttc = arr(plusTard.acceptes_ttc);
  const total = {
    a_encaisser_ttc: arr(retard.a_encaisser_ttc + semaines.reduce((a, s) => a + s.a_encaisser_ttc, 0)),
    acceptes_ttc: arr(semaines.reduce((a, s) => a + s.acceptes_ttc, 0)),
  };
  total.cumul_ttc = arr(total.a_encaisser_ttc + total.acceptes_ttc);
  // Le cumul semaine après semaine : ce qui sera rentré à la fin de chaque semaine si tout est payé à l'heure.
  let c = retard.a_encaisser_ttc;
  for (const s of semaines) { c += s.a_encaisser_ttc + s.acceptes_ttc; s.cumul_ttc = arr(c); }
  return { today, debut, fin, retard, semaines, plus_tard: plusTard, total };
}

function revue({ today = localDay() } = {}) {
  const mois = today.slice(0, 7);
  const debutSemaine = lundi(today);
  const finSemaine = addDays(debutSemaine, 6);
  const dans7 = addDays(today, 7);

  // L'argent : ce mois, et les 6 derniers mois pour la tendance.
  const historique = [];
  for (let i = 5; i >= 0; i--) historique.push(argentDuMois(clients.moisSuivant(mois, -i)));
  const ceMois = historique[historique.length - 1];
  const moisPrecedent = historique[historique.length - 2];

  const aEncaisser = all(`SELECT * FROM pieces WHERE type = 'facture' AND statut = 'a_payer' ORDER BY CASE WHEN echeance = '' THEN date ELSE echeance END`)
    .map((p) => ({ ...p, retard: p.echeance && p.echeance < today ? ecart(p.echeance, today) : 0 }));
  const enRetard = aEncaisser.filter((p) => p.retard > 0);
  const brouillons = all(`SELECT * FROM pieces WHERE type = 'facture' AND statut = 'brouillon' ORDER BY date DESC`);

  const { devis, tousDevis } = devisOuverts(today);
  const devisEnAttente = tousDevis.filter((d) => d.statut === 'en_attente');
  const acceptesAFacturer = tousDevis.filter((d) => d.statut === 'accepte');

  const relances = all(`SELECT id, first_name, last_name, company, next_action, next_action_at, stage FROM contacts
    WHERE archived = 0 AND stage NOT IN ('gagne', 'perdu') AND next_action_at != '' AND next_action_at <= ? ORDER BY next_action_at LIMIT 30`, today);
  const nbRelances = get(`SELECT COUNT(*) AS n FROM contacts WHERE archived = 0 AND stage NOT IN ('gagne', 'perdu') AND next_action_at != '' AND next_action_at <= ?`, today).n;
  const echeances = all(`SELECT id, texte, echeance, importance FROM journee_taches WHERE statut = 'a_faire' AND echeance != '' AND echeance <= ? ORDER BY echeance, importance DESC`, finSemaine > dans7 ? finSemaine : dans7);
  const suivis = clients.liste();

  const somme = (l, k) => arr(l.reduce((a, p) => a + (Number(p[k]) || 0), 0));
  const total = {
    a_encaisser_ttc: somme(aEncaisser, 'reste_du'),
    en_retard_ttc: somme(enRetard, 'reste_du'),
    devis_en_attente_ht: somme(devisEnAttente, 'montant_ht'),
    acceptes_ht: somme(acceptesAFacturer, 'montant_ht'),
  };

  // Les points d'attention : des phrases, dans l'ordre où il faut s'en occuper.
  const fmt = (n) => `${Math.round(n).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} €`;
  const points = [];
  if (enRetard.length) {
    const plusVieille = [...enRetard].sort((a, b) => b.retard - a.retard)[0];
    points.push({ niveau: 'alerte', texte: `${enRetard.length} facture${enRetard.length > 1 ? 's' : ''} en retard pour ${fmt(total.en_retard_ttc)} TTC. Relance d’abord ${plusVieille.client || plusVieille.numero} (${plusVieille.retard} jours de retard).` });
  }
  if (acceptesAFacturer.length) points.push({ niveau: 'or', texte: `${acceptesAFacturer.length} devis accepté${acceptesAFacturer.length > 1 ? 's' : ''} pas encore facturé${acceptesAFacturer.length > 1 ? 's' : ''} (${fmt(total.acceptes_ht)} HT) : à facturer.` });
  const vieux = devisEnAttente.filter((d) => d.age >= 10);
  if (vieux.length) points.push({ niveau: 'or', texte: `${vieux.length} devis sans réponse depuis plus de 10 jours : ${vieux.slice(0, 3).map((d) => d.client).filter(Boolean).join(', ')}. Une relance cette semaine.` });
  const expirent = devis.filter((d) => d.expire_bientot);
  if (expirent.length) points.push({ niveau: 'or', texte: `${expirent.length} devis expire${expirent.length > 1 ? 'nt' : ''} dans les 7 jours.` });
  const sansDate = get(`SELECT COUNT(*) AS n, COALESCE(SUM(montant_ttc), 0) AS ttc FROM pieces WHERE type = 'facture' AND statut = 'payee' AND paye_le = ''`);
  if (sansDate.n) points.push({ niveau: 'info', texte: `${sansDate.n} facture${sansDate.n > 1 ? 's' : ''} payée${sansDate.n > 1 ? 's' : ''} sans date d’encaissement connue (${fmt(sansDate.ttc)} TTC) : hors de l’encaissé du mois. Pose la date à la main si tu en as besoin.` });
  if (brouillons.length) points.push({ niveau: 'info', texte: `${brouillons.length} facture${brouillons.length > 1 ? 's' : ''} en brouillon dans Pennylane : à envoyer ou à supprimer.` });
  if (nbRelances) points.push({ niveau: 'info', texte: `${nbRelances} relance${nbRelances > 1 ? 's' : ''} prospect due${nbRelances > 1 ? 's' : ''}.` });
  for (const c of suivis) if (c.premier_manque) points.push({ niveau: 'info', texte: `${c.nom} : ${c.premier_manque}` });
  if (!points.length) points.push({ niveau: 'ok', texte: 'Rien qui brûle : argent, devis et relances sont à jour.' });

  return {
    today, mois, semaine: { debut: debutSemaine, fin: finSemaine },
    sync_le: dbApi.getSetting('pilotage_sync_le') || '',
    argent: { ce_mois: ceMois, mois_precedent: moisPrecedent, historique },
    total, a_encaisser: aEncaisser, en_retard: enRetard.length, brouillons,
    devis_en_attente: devisEnAttente, acceptes_a_facturer: acceptesAFacturer,
    relances, nb_relances: nbRelances, echeances, clients: suivis, points,
    prevision: prevision({ today }),
  };
}

// La revue en texte : à coller dans un mail, une note ou le Projet Claude.
function texteRevue(r = revue()) {
  const fmt = (n) => `${Math.round(n || 0).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} €`;
  const d = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
  const L = [`Revue de la semaine du ${d(r.semaine.debut)} au ${d(r.semaine.fin)}`, ''];
  L.push('Argent (facturé et encaissé sont séparés)');
  L.push(`· Facturé ce mois : ${fmt(r.argent.ce_mois.facture_ht)} HT (${fmt(r.argent.ce_mois.facture_ttc)} TTC), ${r.argent.ce_mois.factures} facture(s)`);
  L.push(`· Encaissé ce mois : ${fmt(r.argent.ce_mois.encaisse_ttc)} TTC`);
  L.push(`· Reste à encaisser : ${fmt(r.total.a_encaisser_ttc)} TTC, dont ${fmt(r.total.en_retard_ttc)} en retard`);
  for (const p of r.a_encaisser.slice(0, 8)) L.push(`   ${p.client || '?'} ${p.numero ? `(${p.numero}) ` : ''}: ${fmt(p.reste_du)}${p.retard ? `, ${p.retard} j de retard` : p.echeance ? `, échéance ${d(p.echeance)}` : ''}`);
  L.push('');
  L.push(`Devis en attente : ${r.devis_en_attente.length} pour ${fmt(r.total.devis_en_attente_ht)} HT`);
  for (const x of r.devis_en_attente.slice(0, 8)) L.push(`   ${x.client || '?'} : ${fmt(x.montant_ht)} HT, envoyé il y a ${x.age} j`);
  if (r.acceptes_a_facturer.length) L.push(`Acceptés à facturer : ${r.acceptes_a_facturer.map((x) => `${x.client} (${fmt(x.montant_ht)} HT)`).join(', ')}`);
  if (r.prevision) {
    const pv = r.prevision;
    L.push('');
    L.push(`Ce qui doit rentrer, 8 semaines (jusqu’au ${d(pv.fin)}) : ${fmt(pv.total.cumul_ttc)} TTC`);
    L.push(`· À encaisser : ${fmt(pv.total.a_encaisser_ttc)} TTC${pv.retard.a_encaisser_ttc ? `, dont ${fmt(pv.retard.a_encaisser_ttc)} déjà en retard` : ''}`);
    L.push(`· Acceptés à facturer : ${fmt(pv.total.acceptes_ttc)} TTC (potentiel, rien n’est encore facturé)`);
    for (const s of pv.semaines.filter((x) => x.a_encaisser_ttc || x.acceptes_ttc)) {
      L.push(`   Semaine du ${d(s.debut)} : ${fmt(s.a_encaisser_ttc)} à encaisser${s.acceptes_ttc ? ` + ${fmt(s.acceptes_ttc)} à facturer` : ''}`);
    }
    if (pv.plus_tard.a_encaisser_ttc || pv.plus_tard.acceptes_ttc) L.push(`   Au-delà : ${fmt(pv.plus_tard.a_encaisser_ttc + pv.plus_tard.acceptes_ttc)} TTC`);
  }
  L.push('');
  L.push('Points d’attention');
  for (const p of r.points) L.push(`· ${p.texte}`);
  if (r.echeances.length) {
    L.push('');
    L.push('Échéances');
    for (const e of r.echeances.slice(0, 10)) L.push(`· ${d(e.echeance)} ${e.texte}`);
  }
  if (r.clients.length) {
    L.push('');
    L.push('Clients suivis');
    for (const c of r.clients) {
      const k = c.cumul;
      L.push(`· ${c.nom} : ${k.mois_suivis} mois suivis${k.reservations !== null ? `, ${k.reservations} réservations` : ''}${k.ca_total !== null ? `, ${fmt(k.ca_total)} de CA généré` : ''}${k.roi !== null ? `, ROI ${Math.round(k.roi * 100)} %` : ''}`);
    }
  }
  return L.join('\n');
}

// ---------------------------------------------------------------- relance de facture
// Prépare un mail de relance pour une facture à encaisser. Rien ne part :
// le texte est proposé à Maxime, qui le copie ou l'ouvre dans sa messagerie.
// Trois tons selon le retard : courtoise (moins de 15 jours), ferme (15 à 45),
// dernière relance (plus de 45). Vouvoiement par défaut ; tutoiement si le
// contact lié porte l'étiquette « tutoiement » (ou si Maxime le demande).
const SIGNATURE = 'Maxime Dietrich\nOTEA Production';
const NIVEAUX_RELANCE = {
  courtoise: 'Relance courtoise',
  ferme: 'Relance ferme',
  derniere: 'Dernière relance',
};

function niveauRelance(retard) {
  if (retard > 45) return 'derniere';
  if (retard >= 15) return 'ferme';
  return 'courtoise';
}

function contactTutoie(contact) {
  if (!contact) return false;
  let tags = [];
  try { tags = JSON.parse(contact.tags || '[]'); } catch { tags = String(contact.tags || '').split(','); }
  if (!Array.isArray(tags)) tags = [];
  return tags.some((t) => /^(tutoiement|tutoyer|tu)$/i.test(String(t).trim()));
}

function texteRelance(piece, { today = localDay(), contact = null, tutoiement } = {}) {
  if (!piece) throw erreur('Cette facture n’existe plus. Recharge la page.', 404);
  const fmtEur = (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u202f|\u00a0/g, ' ')} €`;
  const fr = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
  const echeance = piece.echeance || (piece.date ? addDays(piece.date, DELAI_PAIEMENT) : '');
  const retard = echeance && echeance < today ? ecart(echeance, today) : 0;
  const niveau = niveauRelance(retard);
  const tu = tutoiement === undefined ? contactTutoie(contact) : !!tutoiement;
  const prenom = contact ? String(contact.first_name || '').trim() : '';
  const client = piece.client || (contact && contact.company) || '';
  const du = Number(piece.reste_du) > 0 ? Number(piece.reste_du) : Number(piece.montant_ttc) || 0;
  const partiel = Number(piece.reste_du) > 0 && Number(piece.montant_ttc) > Number(piece.reste_du);
  const ref = piece.numero ? `n° ${piece.numero}` : (piece.libelle ? `« ${piece.libelle} »` : '');
  const laFacture = `la facture ${ref}`.trim();
  const datee = piece.date ? ` du ${fr(piece.date)}` : '';
  const montant = partiel ? `${fmtEur(du)} TTC restant dus sur ${fmtEur(piece.montant_ttc)} TTC` : `${fmtEur(du)} TTC`;
  const pourEcheance = echeance ? (retard ? `, arrivée à échéance le ${fr(echeance)} (${retard} jour${retard > 1 ? 's' : ''} de retard)` : `, à régler pour le ${fr(echeance)}`) : '';
  const v = (vous, toi) => (tu ? toi : vous);

  const L = [];
  if (niveau === 'courtoise') {
    L.push(`${v('Je me permets de revenir vers vous', 'Je reviens vers toi')} au sujet de ${laFacture}${datee}, d’un montant de ${montant}${pourEcheance}.`);
    L.push(`Sauf erreur de ma part, je n’ai pas encore vu passer le règlement. Il s’est peut-être croisé avec ce message : dans ce cas, ${v('merci de ne pas tenir compte de ce mail', 'ne tiens pas compte de ce mail')}.`);
    L.push(`Si besoin, je ${v('vous', 'te')} renvoie la facture ou le RIB.`);
  } else if (niveau === 'ferme') {
    L.push(`Je ${v('vous', 'te')} relance concernant ${laFacture}${datee}, d’un montant de ${montant}${pourEcheance}.`);
    L.push(`Le règlement n’est toujours pas arrivé. ${v('Pouvez-vous', 'Peux-tu')} me confirmer la date de paiement prévue, ou me dire si quelque chose bloque de ${v('votre', 'ton')} côté ?`);
    L.push(`Je ${v('vous', 'te')} remercie de faire le nécessaire dans les prochains jours.`);
  } else {
    L.push(`Malgré mes précédentes relances, ${laFacture}${datee}, d’un montant de ${montant}${pourEcheance}, reste impayée.`);
    L.push(`${v('Je vous demande', 'Je te demande')} de procéder au règlement sous 8 jours. Sans retour de ${v('votre', 'ta')} part d’ici là, je serai contraint d’engager une procédure de recouvrement, avec les pénalités de retard et l’indemnité forfaitaire de 40 € prévues par la loi.`);
    L.push(`Si un souci empêche le paiement, ${v('appelez-moi', 'appelle-moi')} : on trouvera une solution ensemble.`);
  }
  const corps = [prenom ? `Bonjour ${prenom},` : 'Bonjour,', ...L, `${v('Bien cordialement,', 'Belle journée,')}\n${SIGNATURE}`].join('\n\n');

  const sujet = {
    courtoise: `Facture ${piece.numero || ''} : petit rappel`,
    ferme: `Facture ${piece.numero || ''} : règlement en attente`,
    derniere: `Dernière relance : facture ${piece.numero || ''} impayée`,
  }[niveau].replace(/\s+/g, ' ').trim();

  return {
    piece_id: piece.id, niveau, libelle_niveau: NIVEAUX_RELANCE[niveau], retard, echeance,
    tutoiement: tu, email: contact && contact.email ? String(contact.email).trim() : '',
    destinataire: prenom || client, client, montant_du: arr(du),
    sujet, corps,
    tache: `Relancer ${client || 'le client'}${piece.numero ? ` (facture ${piece.numero})` : ''}`,
  };
}

function relancePiece(id, { today = localDay(), tutoiement } = {}) {
  const piece = get('SELECT * FROM pieces WHERE id = ?', Number(id));
  if (!piece) throw erreur('Cette facture n’existe plus. Recharge la page.', 404);
  if (piece.type !== 'facture') throw erreur('Seule une facture se relance. Pour un devis, passe par la fiche du contact.');
  if (piece.statut !== 'a_payer') throw erreur('Cette facture n’est plus à encaisser : rien à relancer.');
  const contact = piece.contact_id ? get('SELECT * FROM contacts WHERE id = ?', piece.contact_id) : null;
  return texteRelance(piece, { today, contact, tutoiement });
}

// Pose « Relancer X (facture N°) » dans Ma journée, pour aujourd'hui.
// Une seule fois : si la tâche existe déjà et n'est pas faite, on la renvoie.
function tacheRelance(id, { today = localDay() } = {}) {
  const r = relancePiece(id, { today });
  const piece = get('SELECT contact_id FROM pieces WHERE id = ?', Number(id));
  const deja = get(`SELECT * FROM journee_taches WHERE texte = ? AND statut = 'a_faire'`, r.tache);
  if (deja) return { tache: deja, deja: true };
  const journee = require('./journee');
  let t = journee.ajouterTache(r.tache, { echeance: today, contact_id: piece.contact_id || null, importance: r.niveau === 'courtoise' ? 2 : 3 });
  if (t.texte !== r.tache) t = journee.modifierTache(t.id, { texte: r.tache });
  return { tache: t, deja: false };
}

module.exports = {
  STATUTS_FACTURE, STATUTS_DEVIS,
  factureDepuisPennylane, devisDepuisPennylane, enregistrer, synchroniserPennylane,
  creerPiece, modifierPiece, supprimerPiece,
  argentDuMois, prevision, revue, texteRevue,
  niveauRelance, texteRelance, relancePiece, tacheRelance,
};
