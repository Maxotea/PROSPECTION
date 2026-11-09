'use strict';
// Une réponse automatique (absence du bureau, accusé de réception, répondeur de
// plateforme) n'est pas une réponse. Elle ne doit ni arrêter une séquence, ni créer
// une tâche « répondre », ni compter comme une réponse reçue. Seul un humain qui écrit
// compte. Ce module est le seul endroit qui décide ce qui est automatique : la
// journée, le radar Gmail et l'Autopilote s'en servent tous les trois.

// Dans l'objet ou les premières lignes du texte.
const MOTIFS_ABSENCE = /r[ée]ponse automatique|automatic reply|auto-?reply|autoreply|auto-?response|out of (the )?office|absence du bureau|absent(e)? du bureau|je suis absent|actuellement absent|en cong[ée]s?|on (annual )?leave|away from (the )?office|hors du bureau|de retour le|back on|back in the office/i;
const MOTIFS_ACCUSE = /accus[ée] de r[ée]ception|votre (message|demande|email|e-mail|mail) a (bien )?[ée]t[ée] (re[çc]u|bien re[çc]u|enregistr[ée]e?|pris en compte)|nous avons bien re[çc]u|we('ve| have) received your|this is an automated|ceci est un (message|e-?mail) automatique|ne pas r[ée]pondre|do not reply|message automatique|ticket (ouvert|cr[ée][ée]|#?\d+)/i;

// Jours de pause quand la personne est absente : on ne relance pas une boîte vide.
const PAUSE_ABSENCE_J = 7;

function texteDe(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }

// En-têtes posés par les répondeurs (RFC 3834 et usages courants).
function enTetesAutomatiques(msg) {
  const auto = texteDe(msg.auto_submitted).toLowerCase();
  if (auto && auto !== 'no') return true;
  const prec = texteDe(msg.precedence).toLowerCase();
  if (['auto_reply', 'auto-reply', 'autoreply'].includes(prec)) return true;
  if (texteDe(msg.x_autoreply) || texteDe(msg.x_autorespond)) return true;
  if (/^(oof|autoreply|auto-?reply)\b/i.test(texteDe(msg.x_auto_response_suppress))) return true;
  return false;
}

// Renvoie { auto, type, pause } : type 'absence' | 'accuse' | 'automatique' | ''.
function analyser(msg = {}) {
  const sujet = texteDe(msg.subject);
  const debut = texteDe(msg.texte || msg.content || msg.body).slice(0, 400);
  if (MOTIFS_ABSENCE.test(sujet) || MOTIFS_ABSENCE.test(debut)) return { auto: true, type: 'absence', pause: PAUSE_ABSENCE_J };
  if (MOTIFS_ACCUSE.test(sujet) || MOTIFS_ACCUSE.test(debut)) return { auto: true, type: 'accuse', pause: 0 };
  if (enTetesAutomatiques(msg)) return { auto: true, type: 'automatique', pause: 0 };
  return { auto: false, type: '', pause: 0 };
}

function estReponseAutomatique(msg) { return analyser(msg).auto; }

function libelle(type) {
  if (type === 'absence') return 'absence du bureau';
  if (type === 'accuse') return 'accusé de réception';
  return 'message automatique';
}

module.exports = { analyser, estReponseAutomatique, libelle, MOTIFS_ABSENCE, MOTIFS_ACCUSE, PAUSE_ABSENCE_J };
