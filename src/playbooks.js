'use strict';
// Playbooks par typologie de client : cadences de relance + templates seedés.
// 3 segments : grand_compte (cycles longs, ABM), pme (offres packagées),
// b2c_event (événementiel / sport type Hyrox, volume + réactivité).

// Couleurs validées daltonisme (dataviz) sur fond sombre ; toujours affichées
// avec emoji + libellé (jamais la couleur seule).
const SEGMENTS = {
  grand_compte: { label: 'Grand Compte', emoji: '🐘', color: '#8b5cf6', desc: 'Budget > 5 k€, cycle long, approche sur-mesure' },
  pme: { label: 'PME / Petit budget', emoji: '🏪', color: '#d97706', desc: 'Offres packagées, décision rapide' },
  b2c_event: { label: 'B2C / Événementiel', emoji: '🏃', color: '#059669', desc: 'Type Hyrox : événements, sport, volume' },
  inconnu: { label: 'À qualifier', emoji: '❓', color: '#64748b', desc: 'Segment pas encore déterminé' },
};

const STAGES = [
  { code: 'a_contacter', label: 'À contacter', emoji: '🎯' },
  { code: 'contacte', label: 'Contacté', emoji: '📤' },
  { code: 'en_discussion', label: 'En discussion', emoji: '💬' },
  { code: 'rdv', label: 'RDV pris', emoji: '📅' },
  { code: 'devis_envoye', label: 'Devis envoyé', emoji: '📄' },
  { code: 'negociation', label: 'Négociation', emoji: '🤝' },
  { code: 'gagne', label: 'Gagné 🏆', emoji: '🏆' },
  { code: 'perdu', label: 'Perdu', emoji: '🪦' },
];

// Cadence de relance par segment : après la N-ième prise de contact,
// la prochaine action est planifiée à J+gap avec le template indiqué.
const CADENCES = {
  grand_compte: [
    { gap: 3, label: 'Message valeur (LinkedIn)', template: 'gc_message_1' },
    { gap: 4, label: 'Email étude de cas', template: 'gc_email_1' },
    { gap: 7, label: 'Relance douce', template: 'gc_relance_1' },
    { gap: 14, label: 'Relance long terme', template: 'gc_relance_2' },
  ],
  pme: [
    { gap: 4, label: 'Relance offre', template: 'pme_relance_1' },
    { gap: 6, label: 'Dernière relance', template: 'pme_relance_2' },
  ],
  b2c_event: [
    { gap: 2, label: 'Relance DM', template: 'b2c_relance_1' },
    { gap: 5, label: 'Dernière relance', template: 'b2c_relance_2' },
  ],
  inconnu: [
    { gap: 4, label: 'Relance', template: 'pme_relance_1' },
    { gap: 7, label: 'Dernière relance', template: 'pme_relance_2' },
  ],
};

// Premier contact selon le segment ; un ancien client passe toujours par la réactivation.
const FIRST_TOUCH = {
  grand_compte: 'gc_first',
  pme: 'pme_first',
  b2c_event: 'b2c_first',
  inconnu: 'pme_first',
  ancien_client: 'reactivation',
};

// Template suggéré selon l'étape du pipeline.
function suggestedTemplateCode(contact, touches) {
  if (contact.stage === 'a_contacter') {
    return contact.is_former_client ? FIRST_TOUCH.ancien_client : FIRST_TOUCH[contact.segment] || FIRST_TOUCH.inconnu;
  }
  if (contact.stage === 'contacte') {
    const cad = CADENCES[contact.segment] || CADENCES.inconnu;
    const step = cad[Math.min(Math.max(touches - 1, 0), cad.length - 1)];
    return step.template;
  }
  if (contact.stage === 'en_discussion') return 'reponse_rdv';
  if (contact.stage === 'rdv') return 'envoi_devis';
  if (contact.stage === 'devis_envoye' || contact.stage === 'negociation') return 'relance_devis';
  return 'pme_relance_1';
}

// Prochaine action planifiée après une action loggée.
function nextStepAfter(contact, actionType, touches, helpers) {
  const { addDays, localDay } = helpers;
  const today = localDay();
  if (['gagne', 'perdu'].includes(contact.stage)) return { next_action: '', next_action_at: '' };
  if (actionType === 'reponse_recue') return { next_action: 'Répondre et proposer un RDV', next_action_at: today };
  if (actionType === 'rdv_pris') return { next_action: 'Préparer le RDV + le devis', next_action_at: addDays(today, 1) };
  if (actionType === 'devis_envoye') return { next_action: 'Relancer le devis', next_action_at: addDays(today, 4) };
  if (actionType === 'devis_accepte') return { next_action: 'Facturer 💰', next_action_at: today };
  if (['message_envoye', 'relance', 'appel', 'connexion_linkedin', 'reponse_envoyee'].includes(actionType)) {
    const cad = CADENCES[contact.segment] || CADENCES.inconnu;
    const step = cad[Math.min(Math.max(touches - 1, 0), cad.length - 1)];
    return { next_action: step.label, next_action_at: addDays(today, step.gap) };
  }
  return null; // pas de changement
}

// ---------------------------------------------------------------- templates seedés
// Variables disponibles : {prenom} {nom} {entreprise} {poste} {ville} {moi} {ma_boite} {signature}
const TEMPLATE_SEED = [
  {
    code: 'reactivation', name: '🔁 Réactivation ancien client', segment: '', channel: 'email', sort: 1,
    subject: 'On remet ça, {entreprise} ?',
    body: `Bonjour {prenom},

Ça fait un moment depuis notre dernier projet ensemble — j'espère que tout roule chez {entreprise}.

De notre côté on a pas mal évolué chez {ma_boite} : nouveaux formats vidéo courts, gestion complète des réseaux, et des résultats concrets chez nos clients.

Est-ce qu'il y a des sujets contenu / vidéo dans vos cartons pour les prochains mois ? Je serais ravi d'en reparler 15 minutes.

{signature}`,
  },
  {
    code: 'gc_first', name: '🐘 Grand compte — 1er contact (LinkedIn)', segment: 'grand_compte', channel: 'linkedin', sort: 10,
    subject: '',
    body: `Bonjour {prenom}, je suis tombé sur ce que fait {entreprise} et j'aimerais vous connecter. Chez {ma_boite}, on produit des vidéos et du contenu pour des marques qui veulent exister vraiment en ligne. Au plaisir d'échanger !`,
  },
  {
    code: 'gc_message_1', name: '🐘 Grand compte — message valeur', segment: 'grand_compte', channel: 'linkedin', sort: 11,
    subject: '',
    body: `Merci pour la connexion {prenom} !

Je vais droit au but : chez {ma_boite}, on accompagne des entreprises comme {entreprise} sur leur image vidéo — marque employeur, films corporate, contenus réseaux qui performent vraiment.

Est-ce que le sujet "contenu vidéo" est dans vos priorités cette année ? Si oui, je vous montre en 15 min ce qu'on a fait pour des structures comparables.`,
  },
  {
    code: 'gc_email_1', name: '🐘 Grand compte — email étude de cas', segment: 'grand_compte', channel: 'email', sort: 12,
    subject: 'Idée contenu vidéo pour {entreprise}',
    body: `Bonjour {prenom},

Je me permets ce mail car je pense que {entreprise} a un vrai potentiel inexploité côté vidéo.

Concrètement, voilà ce qu'on produit chez {ma_boite} pour des comptes de votre taille :
• Films de marque et marque employeur
• Formats courts mensuels pour les réseaux (tournage 1 jour → 8-12 contenus)
• Couverture d'événements internes et externes

Si vous avez 15 minutes cette semaine ou la suivante, je vous montre 2-3 références proches de votre secteur.

{signature}`,
  },
  {
    code: 'gc_relance_1', name: '🐘 Grand compte — relance douce', segment: 'grand_compte', channel: 'email', sort: 13,
    subject: 'Re: Idée contenu vidéo pour {entreprise}',
    body: `Bonjour {prenom},

Je me doute que les journées sont chargées — je fais juste remonter mon message au cas où il soit passé sous les radars.

Une question simple : qui gère les projets vidéo chez {entreprise} ? Si ce n'est pas vous, un nom me suffit et je ne vous embête plus. 🙂

{signature}`,
  },
  {
    code: 'gc_relance_2', name: '🐘 Grand compte — relance long terme', segment: 'grand_compte', channel: 'email', sort: 14,
    subject: 'On garde le contact ?',
    body: `Bonjour {prenom},

Dernier message de ma part : je comprends que ce n'est peut-être pas le bon moment pour {entreprise}.

Je vous laisse mes coordonnées — si un besoin vidéo ou contenu émerge d'ici quelques mois, je serai ravi d'en parler. D'ici là, je vous souhaite le meilleur !

{signature}`,
  },
  {
    code: 'pme_first', name: '🏪 PME — 1er contact (offre packagée)', segment: 'pme', channel: 'email', sort: 20,
    subject: 'Vos réseaux + vos vidéos, gérés pour vous',
    body: `Bonjour {prenom},

Je suis {moi}, de {ma_boite} ({ville} et alentours). On aide les commerces et PME à avoir une vraie présence en ligne sans y passer leurs soirées :

• Pack réseaux sociaux : on filme, on monte, on publie — chaque mois
• Vidéos pro pour votre vitrine, vos offres, vos coulisses
• Résultats concrets : plus de visibilité locale, plus de demandes

Nos clients actuels sont des commerces comme le vôtre. Est-ce que je peux vous montrer ce qu'on ferait pour {entreprise} ? 15 minutes suffisent.

{signature}`,
  },
  {
    code: 'pme_relance_1', name: '🏪 PME — relance offre', segment: 'pme', channel: 'email', sort: 21,
    subject: 'Re: Vos réseaux + vos vidéos',
    body: `Bonjour {prenom},

Petit rappel de mon message — je sais que quand on gère une boîte, ces sujets passent vite en bas de la pile.

Pour situer : nos accompagnements démarrent à quelques centaines d'euros par mois, tout compris (tournage, montage, publication). C'est souvent moins cher qu'on l'imagine.

Un créneau de 15 min cette semaine pour voir si ça colle ?

{signature}`,
  },
  {
    code: 'pme_relance_2', name: '🏪 PME — dernière relance', segment: 'pme', channel: 'email', sort: 22,
    subject: 'Je ferme le dossier {entreprise} ?',
    body: `Bonjour {prenom},

Sans retour de votre part, je vais fermer le dossier — aucun souci, je ne veux pas insister lourdement.

Si le sujet vous intéresse mais que le timing est mauvais, dites-le-moi simplement et je reviens vers vous au bon moment.

Belle continuation à {entreprise} !

{signature}`,
  },
  {
    code: 'b2c_first', name: '🏃 B2C/Event — 1er contact', segment: 'b2c_event', channel: 'linkedin', sort: 30,
    subject: 'Aftermovie & contenus pour vos événements',
    body: `Bonjour {prenom},

Votre événement mérite mieux que des stories filmées au téléphone. 🎬

Chez {ma_boite}, on couvre des événements sportifs et grand public (type Hyrox, compétitions, salons) : aftermovie qui claque, réels le jour J, photos et interviews à chaud.

Le contenu de l'édition N, c'est ce qui vend l'édition N+1.

Vous avez des dates à venir ? Je vous envoie nos références événementiel et une fourchette de prix directe.

{signature}`,
  },
  {
    code: 'b2c_relance_1', name: '🏃 B2C/Event — relance DM', segment: 'b2c_event', channel: 'linkedin', sort: 31,
    subject: '',
    body: `Re {prenom} ! Je relance vite fait — les plannings de prod se remplissent tôt pour la saison. Si vous voulez une couverture vidéo pour votre prochain événement, c'est le bon moment pour caler une date. Je vous envoie les références ?`,
  },
  {
    code: 'b2c_relance_2', name: '🏃 B2C/Event — dernière relance', segment: 'b2c_event', channel: 'email', sort: 32,
    subject: 'Dernière ligne droite pour caler la vidéo',
    body: `Bonjour {prenom},

Dernier message à ce sujet : si vous voulez qu'on couvre votre prochain événement, il me faut une réponse cette semaine pour bloquer l'équipe.

Sinon aucun souci — gardez mon contact pour une prochaine édition. 💪

{signature}`,
  },
  {
    code: 'reponse_rdv', name: '💬 Réponse reçue → proposer un RDV', segment: '', channel: 'email', sort: 40,
    subject: 'Re: échange rapide ?',
    body: `Bonjour {prenom},

Merci pour votre retour, ça fait plaisir !

Le plus simple : un appel de 15-20 minutes pour comprendre votre besoin et vous montrer des exemples concrets. Je vous propose :
• Mardi entre 10h et 12h
• Jeudi entre 14h et 17h

Dites-moi ce qui vous arrange (ou proposez un autre créneau), et je vous envoie une invitation.

{signature}`,
  },
  {
    code: 'envoi_devis', name: '📄 Envoi du devis', segment: '', channel: 'email', sort: 41,
    subject: 'Votre devis — {entreprise} × {ma_boite}',
    body: `Bonjour {prenom},

Comme convenu, voici le devis pour votre projet — vous le trouverez en pièce jointe / via le lien.

Deux points importants :
• Le devis est valable 30 jours
• Le planning de prod se cale à la signature : plus tôt on valide, plus tôt on tourne

Je reste disponible pour toute question ou ajustement. On peut aussi se faire un appel rapide si vous voulez le passer en revue ensemble.

{signature}`,
  },
  {
    code: 'relance_devis', name: '📄 Relance devis', segment: '', channel: 'email', sort: 42,
    subject: 'Re: Votre devis — {entreprise}',
    body: `Bonjour {prenom},

Avez-vous eu le temps de regarder le devis ?

S'il y a un point qui bloque (budget, périmètre, planning), dites-le-moi franchement : il y a souvent moyen d'ajuster pour que ça rentre.

Je peux vous appeler demain pour en parler 5 minutes ?

{signature}`,
  },
  {
    code: 'reponse_demande', name: '📥 Réponse à une demande entrante', segment: '', channel: 'email', sort: 50,
    subject: 'Re: votre demande',
    body: `Bonjour {prenom},

Merci pour votre message et votre intérêt pour {ma_boite} !

Bonne nouvelle : votre besoin correspond tout à fait à ce qu'on fait. Pour vous répondre précisément (et vous donner un prix juste), j'ai besoin de 2-3 infos :
• L'objectif du projet et le contexte
• Les délais souhaités
• Une fourchette de budget si vous en avez une

Le plus efficace reste un appel de 15 minutes — je vous propose un créneau dès demain si vous voulez.

{signature}`,
  },
];

// ---------------------------------------------------------------- séquences seedées (Autopilote)
// Chaque étape : delay_days = jours APRÈS l'étape précédente (0 = envoi immédiat à l'enrôlement).
// Toutes les étapes partent en EMAIL (l'Autopilote n'envoie que des emails) —
// les relances restent dans le même fil Gmail que le premier message.
const SEQUENCE_SEED = [
  {
    code: 'seq_reactivation', name: '🔮 Réactivation anciens clients', segment: '',
    description: 'La séquence la plus rentable : réveiller ceux qui ont déjà payé.',
    steps: [
      { delay_days: 0, template_code: 'reactivation' },
      { delay_days: 4, template_code: 'gc_relance_1' },
      { delay_days: 8, template_code: 'pme_relance_2' },
    ],
  },
  {
    code: 'seq_grand_compte', name: '🐘 Conquête grand compte', segment: 'grand_compte',
    description: 'Étude de cas → relance douce → relance long terme.',
    steps: [
      { delay_days: 0, template_code: 'gc_email_1' },
      { delay_days: 7, template_code: 'gc_relance_1' },
      { delay_days: 14, template_code: 'gc_relance_2' },
    ],
  },
  {
    code: 'seq_pme', name: '🏪 Offre packagée PME', segment: 'pme',
    description: 'Offre directe → rappel prix → dernière relance.',
    steps: [
      { delay_days: 0, template_code: 'pme_first' },
      { delay_days: 4, template_code: 'pme_relance_1' },
      { delay_days: 10, template_code: 'pme_relance_2' },
    ],
  },
  {
    code: 'seq_b2c', name: '🏃 Événementiel / B2C', segment: 'b2c_event',
    description: 'Aftermovie & couverture événement, avec urgence de saison.',
    steps: [
      { delay_days: 0, template_code: 'b2c_first' },
      { delay_days: 3, template_code: 'b2c_relance_2' },
    ],
  },
];

function seedSequences(dbApi) {
  const { get, run, nowIso } = dbApi;
  for (const s of SEQUENCE_SEED) {
    let seq = get('SELECT id FROM sequences WHERE code = ?', s.code);
    if (!seq) {
      const { lastId } = run('INSERT INTO sequences (code, name, segment, description, builtin, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        s.code, s.name, s.segment, s.description, nowIso());
      for (let i = 0; i < s.steps.length; i++) {
        run('INSERT INTO sequence_steps (sequence_id, step_index, delay_days, template_code) VALUES (?, ?, ?, ?)',
          lastId, i, s.steps[i].delay_days, s.steps[i].template_code);
      }
    }
  }
}

function seedTemplates(dbApi) {
  const { get, run } = dbApi;
  for (const t of TEMPLATE_SEED) {
    const existing = get('SELECT id FROM templates WHERE code = ?', t.code);
    if (!existing) {
      run(
        'INSERT INTO templates (code, name, segment, channel, subject, body, builtin, sort) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
        t.code, t.name, t.segment, t.channel, t.subject, t.body, t.sort
      );
    }
  }
}

// Remplace les {variables} d'un template avec les infos du contact + réglages.
function renderTemplate(tpl, contact, settings) {
  const vars = {
    prenom: (contact && contact.first_name) || 'bonjour',
    nom: (contact && contact.last_name) || '',
    entreprise: (contact && contact.company) || 'votre entreprise',
    poste: (contact && contact.job_title) || '',
    ville: (contact && contact.city) || settings.user_city || '',
    moi: settings.user_name || '',
    ma_boite: settings.company_name || '',
    signature: settings.user_signature || settings.user_name || '',
    lien_rdv: settings.booking_url || '',
  };
  const fill = (s) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return { subject: fill(tpl.subject), body: fill(tpl.body), channel: tpl.channel, name: tpl.name, code: tpl.code };
}

module.exports = { SEGMENTS, STAGES, CADENCES, FIRST_TOUCH, TEMPLATE_SEED, SEQUENCE_SEED, seedTemplates, seedSequences, renderTemplate, suggestedTemplateCode, nextStepAfter };
