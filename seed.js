'use strict';
// Données de démo pour essayer la Chasse à vide (contacts fictifs).
//   node seed.js          → ajoute la démo si elle n'existe pas déjà
//   node seed.js --wipe   → vide TOUTE la base puis re-seed la démo

const dbApi = require('./src/db');
const { get, run, nowIso, localDay, addDays } = dbApi;
const game = require('./src/gamification');
const playbooks = require('./src/playbooks');

const DEMO_CONTACTS = [
  // Anciens clients (comme un import Pennylane)
  { first_name: 'Claire', last_name: 'Arnaud', company: 'Maison Arnaud', job_title: 'Gérante', email: 'claire@maison-arnaud.example', phone: '06 11 22 33 44', segment: 'pme', is_former_client: 1, revenue_history: 2400, city: 'Lyon', stage: 'a_contacter', notes: 'CA historique : 2 400 € (2 vidéos vitrine). Très satisfaite, à réactiver.' },
  { first_name: 'Marc', last_name: 'Vertano', company: 'Groupe Vertano', job_title: 'Directeur communication', email: 'm.vertano@vertano.example', segment: 'grand_compte', is_former_client: 1, revenue_history: 8200, city: 'Paris', stage: 'a_contacter', notes: 'Film corporate 2024. Parlait d’une série marque employeur.' },
  { first_name: 'Sofia', last_name: 'Reyes', company: 'Studio Yoga Flow', job_title: 'Fondatrice', email: 'sofia@yogaflow.example', segment: 'pme', is_former_client: 1, revenue_history: 950, city: 'Lyon', stage: 'contacte' },
  // Nouveaux prospects grands comptes
  { first_name: 'Isabelle', last_name: 'Charvet', company: 'Neolia Santé', job_title: 'Responsable marketing', linkedin_url: 'https://www.linkedin.com/in/icharvet-demo', segment: 'grand_compte', city: 'Villeurbanne', stage: 'a_contacter', notes: 'Vu sur Sales Nav — groupe 400 salariés, recrute beaucoup (marque employeur ?)' },
  { first_name: 'Thomas', last_name: 'Blanchard', company: 'Alpina Matériaux', job_title: 'DG', linkedin_url: 'https://www.linkedin.com/in/tblanchard-demo', segment: 'grand_compte', city: 'Grenoble', stage: 'contacte' },
  // PME
  { first_name: 'Julien', last_name: 'Perrin', company: 'Garage Perrin & Fils', job_title: 'Gérant', email: 'contact@garage-perrin.example', segment: 'pme', city: 'Bron', stage: 'a_contacter' },
  { first_name: 'Amélie', last_name: 'Costa', company: 'Fleuriste Bloom', job_title: 'Gérante', segment: 'pme', city: 'Lyon', stage: 'a_contacter', linkedin_url: 'https://www.linkedin.com/in/amelie-costa-demo' },
  { first_name: 'Karim', last_name: 'Slimani', company: 'K-Fit Coaching', job_title: 'Fondateur', email: 'karim@kfit.example', phone: '07 88 99 00 11', segment: 'pme', city: 'Villeurbanne', stage: 'en_discussion' },
  // B2C / événementiel (type Hyrox)
  { first_name: 'Laura', last_name: 'Nguyen', company: 'UrbanRace Lyon', job_title: 'Organisatrice', email: 'laura@urbanrace.example', segment: 'b2c_event', city: 'Lyon', stage: 'rdv', notes: 'Course à obstacles, 3 000 participants en mai. Veut un aftermovie + réels.' },
  { first_name: 'Damien', last_name: 'Roche', company: 'Fitness Games Sud', job_title: 'Fondateur', linkedin_url: 'https://www.linkedin.com/in/damien-roche-demo', segment: 'b2c_event', city: 'Marseille', stage: 'a_contacter' },
  { first_name: 'Eva', last_name: 'Marchal', company: 'Trail des Cimes', job_title: 'Cheffe de projet', segment: 'b2c_event', city: 'Annecy', stage: 'contacte' },
  { first_name: 'Hugo', last_name: 'Lefèvre', company: 'CrossTraining Days', job_title: 'Organisateur', email: 'hugo@ctdays.example', segment: 'b2c_event', city: 'Lyon', stage: 'devis_envoye' },
];

function seedDemo(wipe = false) {
  if (wipe) {
    for (const t of ['activities', 'deals', 'inbox', 'enrich_jobs', 'badges', 'quest_awards', 'contacts']) run(`DELETE FROM ${t}`);
  }
  if (get(`SELECT id FROM contacts WHERE origin = 'demo' LIMIT 1`)) {
    return { already: true, message: 'La démo est déjà chargée.' };
  }

  const today = localDay();
  const ids = {};
  for (const c of DEMO_CONTACTS) {
    const contact = dbApi.insertContact({ ...c, origin: 'demo' });
    ids[c.company] = contact.id;
  }

  // Historique d'activité sur les derniers jours (streak + graphe XP).
  const past = (daysAgo, contactCompany, type, note, xp) => {
    const def = game.ACTIONS[type] || { xp: 0 };
    run('INSERT INTO activities (contact_id, type, note, xp, meta, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      contactCompany ? ids[contactCompany] : null, type, note || '', xp !== undefined ? xp : def.xp, '{}', addDays(today, -daysAgo), nowIso());
  };

  past(4, null, 'import', 'Import démo : 12 contacts', 12);
  past(3, 'Studio Yoga Flow', 'message_envoye', 'Réactivation envoyée');
  past(3, 'Alpina Matériaux', 'connexion_linkedin', '');
  past(3, 'Trail des Cimes', 'message_envoye', 'DM LinkedIn');
  past(2, 'Alpina Matériaux', 'message_envoye', 'Message valeur');
  past(2, 'K-Fit Coaching', 'reponse_recue', 'Intéressé par le pack mensuel');
  past(2, 'UrbanRace Lyon', 'reponse_recue', 'Veut un devis aftermovie');
  past(1, 'UrbanRace Lyon', 'rdv_pris', 'Visio vendredi 10h');
  past(1, 'CrossTraining Days', 'devis_envoye', 'Devis couverture événement');

  // Deals : un devis en cours + une facture déjà tombée (boss 1/5).
  const now = nowIso();
  run(`INSERT INTO deals (contact_id, title, amount, status, created_at, updated_at) VALUES (?, 'Aftermovie + pack réels', 2400, 'devis_envoye', ?, ?)`, ids['CrossTraining Days'], now, now);
  run(`INSERT INTO deals (contact_id, title, amount, status, invoiced_at, created_at, updated_at) VALUES (?, 'Pack vidéo vitrine', 950, 'facture', ?, ?, ?)`, ids['Studio Yoga Flow'], now, now, now);
  past(1, 'Studio Yoga Flow', 'facture', 'Pack vidéo vitrine — 950 €');

  // Prochaines actions pour remplir la file du Mode Chasse dès aujourd'hui.
  const due = (company, action, offset = 0) => dbApi.updateContact(ids[company], { next_action: action, next_action_at: addDays(today, offset) });
  due('Maison Arnaud', 'Réactivation ancien client', 0);
  due('Groupe Vertano', 'Réactivation ancien client', 0);
  due('Alpina Matériaux', 'Email étude de cas', 0);
  due('K-Fit Coaching', 'Répondre et proposer un RDV', 0);
  due('UrbanRace Lyon', 'Préparer le RDV + le devis', 0);
  due('CrossTraining Days', 'Relancer le devis', 1);

  // Une demande entrante en attente dans l'inbox.
  run(`INSERT INTO inbox (contact_id, source, content, status, created_at, updated_at) VALUES (?, 'email', ?, 'nouveau', ?, ?)`,
    ids['Garage Perrin & Fils'],
    `Bonjour, on m'a parlé de vous pour des vidéos. On voudrait présenter notre nouvel atelier et être plus visibles sur Instagram. Vous faites quoi comme formules et à quel prix ? Julien`,
    now, now);

  game.checkBadges();
  return { already: false, contacts: DEMO_CONTACTS.length, message: 'Démo chargée : 12 contacts, 2 deals, 1 demande entrante.' };
}

if (require.main === module) {
  const wipe = process.argv.includes('--wipe');
  const res = seedDemo(wipe);
  console.log(res.message);
}

module.exports = { seedDemo };
