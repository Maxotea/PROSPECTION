'use strict';
// Reconnaître une réponse automatique (absence, congés, accusé de réception,
// changement d'adresse) avant de dire « il a répondu ».
//
// Le cas qui a fait naître ce fichier : Hugo Boutet (Panenka) avait un message
// d'absence. L'app l'a pris pour une vraie réponse, a arrêté la séquence de
// relance et a proposé à Maxime de répondre « Merci pour votre retour ». Une
// réponse automatique ne dit rien du prospect : la relance doit continuer.
//
// Deux indices, du plus sûr au moins sûr :
//  1. les en-têtes posés par les serveurs de mail (Auto-Submitted, X-Autoreply,
//     Precedence, X-Auto-Response-Suppress d'Outlook...) ;
//  2. l'objet du message (« Réponse automatique », « Absent du bureau »...).

const OBJET_AUTO = new RegExp([
  'r[ée]ponse automatique', 'message automatique', 'automatic reply', 'auto(matic)?[ -]?(reply|response|antwort)',
  // Prudent sur « absence » : « Re: absence de réponse » est écrit par un humain.
  'autoreply', 'out of (the )?office', '\\booo\\b', 'absence du bureau', 'absent(e)? (du bureau|jusqu|du \\d|le \\d)',
  'en cong[ée]s? (jusqu|du \\d)', '\\bde retour le \\d',
  'je suis actuellement (absent|en cong|en d[ée]placement)', 'accus[ée] de r[ée]ception', 'votre (message|demande) a bien [ée]t[ée] (re[çc]u|prise)',
  'thank you for your (email|message)', 'merci pour votre (message|e-?mail), (je|nous) (vous r[ée]pondr|reviendr)',
  'changement d.adresse', 'n.est plus (en poste|joignable)', 'ne fait plus partie', 'has left the company',
  'abwesenheit', 'fuera de la oficina',
].join('|'), 'i');

// Les en-têtes se lisent tels que parseHeaders les rend (noms en minuscules).
function indicesEnTetes(h = {}) {
  const auto = String(h['auto-submitted'] || '').toLowerCase().trim();
  if (auto && auto !== 'no') return `en-tête Auto-Submitted : ${auto}`;
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-autoresponse']) return 'en-tête X-Autoreply';
  const prec = String(h.precedence || '').toLowerCase();
  if (/auto_reply|bulk|junk/.test(prec)) return `en-tête Precedence : ${prec}`;
  // Outlook / Exchange pose cet en-tête sur ses messages d'absence.
  if (/\b(all|oof|autoreply)\b/i.test(String(h['x-auto-response-suppress'] || ''))) return 'message d’absence Outlook';
  return '';
}

// Renvoie { auto, motif } : motif dit à Maxime POURQUOI ce n'est pas une vraie réponse.
function estReponseAutomatique({ subject = '', headers = {}, extrait = '' } = {}) {
  const parEnTete = indicesEnTetes(headers);
  if (parEnTete) return { auto: true, motif: parEnTete };
  const objet = String(subject || '');
  const m = objet.match(OBJET_AUTO);
  if (m) return { auto: true, motif: `objet « ${objet.slice(0, 80)} »` };
  const debut = String(extrait || '').slice(0, 400);
  const n = debut.match(OBJET_AUTO);
  if (n) return { auto: true, motif: `début du message : « ${n[0]} »` };
  return { auto: false, motif: '' };
}

// En-têtes à demander au serveur IMAP en plus des habituels.
const ENTETES_AUTO = 'AUTO-SUBMITTED X-AUTOREPLY X-AUTORESPOND X-AUTORESPONSE PRECEDENCE X-AUTO-RESPONSE-SUPPRESS';

module.exports = { estReponseAutomatique, ENTETES_AUTO, OBJET_AUTO };
