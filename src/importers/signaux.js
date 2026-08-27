'use strict';
// 🔎 SIGNAUX — la partie "cerveau" du répertoire chaud, commune aux appels et à WhatsApp.
// Elle répond à une seule question : parmi tous les gens à qui Maxime a parlé,
// lesquels ressemblent à des CLIENTS (ou à des clients potentiels) plutôt qu'à
// son plombier, sa mère ou un code de vérification à 4 chiffres ?

// Mots qui prouvent qu'il y a eu une NÉGOCIATION, pas juste une discussion de
// métier : quelqu'un qui t'a parlé budget ou devis est un client (ou un client
// perdu). Ces mots-là pèsent lourd même si l'échange date d'il y a deux ans.
const MOTS_DEAL = [
  'devis', 'budget', 'tarif', 'prix', 'contrat', 'facture', 'acompte',
  'commande', 'bon de commande', 'proposition', 'offre', 'virement',
  'paiement', 'honoraires', 'signature', 'signer',
];

// Mots qui trahissent une conversation de travail dans le métier d'OTEA.
const MOTS_BUSINESS = [
  'devis', 'tarif', 'prix', 'budget', 'facture', 'acompte', 'contrat', 'prestation', 'presta',
  'mission', 'projet', 'collaboration', 'partenariat', 'prestataire', 'commande', 'bon de commande',
  'proposition', 'offre', 'virement', 'paiement', 'siret', 'tva', 'honoraires',
  'vidéo', 'tournage', 'film', 'montage', 'captation', 'drone', 'interview', 'photo',
  'shooting', 'reportage', 'clip', 'teaser', 'aftermovie', 'motion', 'rush', 'plateau', 'studio',
  'livrable', 'brief', 'deadline', 'sous-titres', 'derush', 'cadrage', 'lumière',
  'séminaire', 'événement', 'salon', 'conférence',
  'réseaux sociaux', 'reels', 'instagram', 'linkedin', 'communication',
  'rdv', 'rendez-vous', 'réunion', 'visio', 'call', 'point tel', 'dispo',
];

// Mots qui trahissent un robot, une pub ou un service — jamais un prospect.
const MOTS_BRUIT = [
  'code de vérification', 'votre code', 'code confidentiel', 'otp',
  'ne pas répondre', 'no-reply', 'noreply', 'stop au ', 'stop sms',
  'désabonn', 'promo', 'soldes', 'réduction', 'offre spéciale',
  'votre colis', 'livraison prévue', 'suivi de commande', 'transporteur',
  'votre solde', 'opération bancaire', 'prélèvement',
  'rappel automatique', 'message automatique', 'spam',
];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// ---------------------------------------------------------------- téléphone
// Objectif : reconnaître le même humain qu'il soit noté +33 6 11 22 33 44,
// 0033611223344 ou 06.11.22.33.44 dans le CRM.
function normPhone(raw) {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+') && s.startsWith('0') && s.length === 10) s = '+33' + s.slice(1); // 06… → +336…
  return s;
}

// Clé de comparaison : les 9 derniers chiffres suffisent à identifier un numéro
// (l'indicatif pays et le 0 initial changent d'une source à l'autre).
function phoneKey(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 6) return '';
  return digits.slice(-9);
}

// Un numéro trop court est un service (SMS surtaxé, opérateur, banque), pas un contact.
function estNumeroDeService(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length && digits.length < 9) return true;
  return /^(?:\+?33)?(?:0)?8\d{8}$/.test(String(raw || '').replace(/[^\d+]/g, '')); // 08xx surtaxé
}

function joliTelephone(raw) {
  const p = normPhone(raw);
  const m = /^\+33(\d{9})$/.exec(p);
  if (!m) return p;
  return ('0' + m[1]).replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}

// ---------------------------------------------------------------- détection des signaux
function motsBusinessTrouves(texte) {
  const hay = norm(texte);
  if (!hay) return [];
  const found = [];
  for (const mot of MOTS_BUSINESS) {
    const n = norm(mot);
    if (hay.includes(n) && !found.some((f) => norm(f) === n)) found.push(mot);
  }
  return found;
}

function ressembleAuBruit({ nom = '', texte = '', phone = '' } = {}) {
  if (estNumeroDeService(phone)) return true;
  const hay = norm(nom + ' ' + texte);
  return MOTS_BRUIT.some((m) => hay.includes(norm(m)));
}

// ---------------------------------------------------------------- score de relation
// 0 à 100. Une note haute = "tu connais vraiment cette personne, et ça sent le travail".
function scoreRelation(e) {
  const jours = e.last_at ? Math.max(0, Math.round((Date.now() - new Date(e.last_at).getTime()) / 86400000)) : 9999;
  let score = 0;

  // Récence — un contact d'il y a 3 ans se rappelle moins de toi.
  if (jours <= 30) score += 30;
  else if (jours <= 90) score += 22;
  else if (jours <= 180) score += 15;
  else if (jours <= 365) score += 9;
  else score += 3;

  // Volume d'échanges.
  score += Math.min(25, (e.calls || 0) * 4 + Math.min(e.messages || 0, 200) / 10);

  // Réciprocité : il t'a rappelé / il t'a répondu — c'est le signal le plus fort.
  if (e.incoming > 0 && e.outgoing > 0) score += 15;

  // Temps passé au téléphone ensemble.
  const minutes = (e.duration_sec || 0) / 60;
  if (minutes >= 10) score += 15;
  else if (minutes >= 3) score += 8;
  else if (minutes >= 1) score += 4;

  // Vocabulaire de travail.
  const signaux = e.signaux || [];
  score += Math.min(20, signaux.length * 4);

  // Preuve de négociation : ça vaut plus que du vocabulaire de métier, et ça ne
  // se périme pas. Un « budget validé » d'il y a deux ans est un deal à relancer,
  // pas un contact froid — sans ce bonus, l'ancienneté l'enterrerait.
  const deals = signaux.filter((s) => MOTS_DEAL.some((d) => norm(d) === norm(s)));
  score += Math.min(15, deals.length * 8);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function temperature(score) {
  if (score >= 60) return 'chaud';
  if (score >= 35) return 'tiede';
  return 'froid';
}

module.exports = {
  MOTS_BUSINESS, MOTS_DEAL, MOTS_BRUIT, norm,
  normPhone, phoneKey, estNumeroDeService, joliTelephone,
  motsBusinessTrouves, ressembleAuBruit, scoreRelation, temperature,
};
