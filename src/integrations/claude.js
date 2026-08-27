'use strict';
// Rédaction assistée par Claude (API Anthropic) : premiers contacts personnalisés,
// relances, et réponses aux demandes entrantes. Sans clé API, le serveur retombe
// automatiquement sur les templates : l'app reste 100 % utilisable.

const dbApi = require('../db');
const { all, getSetting, allSettings } = dbApi;
const playbooks = require('../playbooks');
const { apiFetch } = require('./util');

const PURPOSES = {
  premier_contact: 'un premier message de prospection (court, personnalisé, sans jargon commercial)',
  relance: 'une relance polie et utile (apporter un élément nouveau, pas juste "je relance")',
  reponse_demande: 'une réponse à la demande entrante ci-dessous (chaleureuse, précise, qui pousse vers un appel de 15 min)',
  envoi_devis: "un email d'accompagnement de devis (rassurant, avec une échéance claire)",
  relance_devis: 'une relance de devis (lever les objections, proposer un appel)',
  icebreaker: "3 propositions d'icebreaker : une phrase naturelle qui crée un lien personnel avec ce prospect (ancien employeur ou client commun, ville, école, sport, passion, destination). RÈGLE ABSOLUE : n'utilise QUE les informations fournies dans la fiche et le profil de l'utilisateur, et n'invente RIEN. S'il n'y a aucun lien exploitable, dis-le et propose plutôt 3 questions à vérifier sur son profil LinkedIn. Format : une proposition par ligne, sans numérotation ni commentaire.",
};

function contactContext(contact) {
  if (!contact) return 'Pas de contact associé.';
  const seg = playbooks.SEGMENTS[contact.segment] || playbooks.SEGMENTS.inconnu;
  const lines = [
    contact.icebreaker ? `Icebreaker déjà trouvé (à réutiliser en 1re ligne) : ${contact.icebreaker}` : '',
    contact.profile ? `Profil enrichi (données FullEnrich) : ${String(contact.profile).slice(0, 1200)}` : '',
    `Nom : ${contact.first_name} ${contact.last_name}`.trim(),
    contact.company ? `Entreprise : ${contact.company}` : '',
    contact.job_title ? `Poste : ${contact.job_title}` : '',
    contact.city ? `Ville : ${contact.city}` : '',
    `Typologie : ${seg.label} (${seg.desc})`,
    contact.is_former_client ? `⚠️ ANCIEN CLIENT (CA historique : ${Math.round(contact.revenue_history || 0)} €) : ton de retrouvailles, pas de présentation from scratch.` : 'Nouveau prospect.',
    contact.notes ? `Notes : ${String(contact.notes).slice(0, 400)}` : '',
  ];
  const acts = all('SELECT type, note, created_at FROM activities WHERE contact_id = ? ORDER BY id DESC LIMIT 5', contact.id);
  if (acts.length) {
    lines.push('Historique récent : ' + acts.map((a) => `${a.created_at.slice(0, 10)} ${a.type}${a.note ? ` (${String(a.note).slice(0, 60)})` : ''}`).join(' ; '));
  }
  return lines.filter(Boolean).join('\n');
}

async function draft({ contact = null, purpose = 'premier_contact', incoming_text = '', instructions = '' }) {
  const key = getSetting('anthropic_api_key');
  const settings = allSettings();

  if (!key && purpose === 'icebreaker') {
    // Sans clé IA : on croise « mon profil » avec les données du contact + checklist manuelle.
    const hints = playbooks.icebreakerHints(contact || {}, settings);
    const lines = hints.length
      ? [`Liens détectés avec ton profil : ${hints.join(', ')}.`, '', ...hints.map((h) => `On partage un point commun : ${h}, ça m'a donné envie de vous écrire.`)]
      : ['Aucun lien automatique trouvé. Regarde son profil LinkedIn : parcours (ancien employeur commun ?), études, ville, posts récents, sports/passions, puis note le lien ici.'];
    return { subject: '', body: lines.join('\n'), source: 'hints' };
  }
  if (!key) {
    // Fallback templates : on rend le template le plus adapté, déjà rempli.
    const code = purpose === 'reponse_demande' ? 'reponse_demande'
      : purpose === 'envoi_devis' ? 'envoi_devis'
      : purpose === 'relance_devis' ? 'relance_devis'
      : contact ? playbooks.suggestedTemplateCode(contact, purpose === 'relance' ? 1 : 0) : 'pme_first';
    const tpl = dbApi.get('SELECT * FROM templates WHERE code = ?', code) || dbApi.get('SELECT * FROM templates ORDER BY sort LIMIT 1');
    const rendered = playbooks.renderTemplate(tpl, contact || {}, settings);
    return { subject: rendered.subject, body: rendered.body, source: 'template', template: tpl.code };
  }

  const system = `Tu es l'assistant commercial de ${settings.company_name}, une boîte de production vidéo et de community management fondée par ${settings.user_name}.
Tu écris des messages de prospection et des réponses clients EN FRANÇAIS.
Style : direct, chaleureux, professionnel, phrases courtes, zéro langue de bois, zéro flatterie exagérée. Tutoiement interdit sauf indication contraire ; vouvoiement par défaut.
Adapte le ton à la typologie : Grand Compte = posé et expert ; PME = concret et accessible (parler bénéfices et prix abordables) ; B2C/Événementiel = énergique.
Réponds UNIQUEMENT avec le message final, sans commentaire autour. Si c'est un email, commence par une ligne "OBJET: ..." puis une ligne vide puis le corps. Signature : "${settings.user_signature}".`;

  const userMsg = [
    `Rédige ${PURPOSES[purpose] || PURPOSES.premier_contact}`,
    '',
    '--- FICHE PROSPECT ---',
    contactContext(contact),
    purpose === 'icebreaker' && settings.mon_profil ? `\n--- MON PROFIL (pour trouver des points communs) ---\n${String(settings.mon_profil).slice(0, 1500)}` : '',
    incoming_text ? `\n--- MESSAGE REÇU À TRAITER ---\n${String(incoming_text).slice(0, 3000)}` : '',
    instructions ? `\n--- CONSIGNES SUPPLÉMENTAIRES ---\n${instructions}` : '',
  ].join('\n');

  const res = await apiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: {
      model: getSetting('ai_model') || 'claude-sonnet-5',
      max_tokens: 900,
      system,
      messages: [{ role: 'user', content: userMsg }],
    },
    timeoutMs: 60000,
  });

  const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  let subject = '';
  let body = text;
  const m = text.match(/^OBJET\s*:\s*(.+)\n+([\s\S]*)$/i);
  if (m) { subject = m[1].trim(); body = m[2].trim(); }
  return { subject, body, source: 'claude', model: res.model };
}

module.exports = { draft, PURPOSES };
