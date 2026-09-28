'use strict';
// 📅 Campagnes hebdo thématiques : une semaine = un secteur + un persona cible.
// Chaque campagne génère son kit complet : recette Sales Navigator, séquence
// email 3 étapes citant les références OTEA du secteur, post LinkedIn et DM.
// « Qu'on voie OTEA Production partout. »
//
// Un preset peut aussi être un PROJET LONG (kind: 'projet') : même mécanique
// (fiches rattachées, séquence, kit, checklist) mais la campagne reste « en
// cours » jusqu'à sa date de fin (ends_on) au lieu de sept jours, et son kit
// est écrit par une fonction dédiée (preset.kit) plutôt que par le gabarit
// « vente de vidéo ». Premier projet : le sponsoring de Pierre et Antoine.

const fs = require('node:fs');
const path = require('node:path');
const dbApi = require('./db');
const { get, all, run, nowIso, localDay, addDays, getSetting, setSetting, allSettings } = dbApi;
const game = require('./gamification');
const autopilot = require('./autopilot');
const { apiFetch } = require('./integrations/util');

// ---------------------------------------------------------------- références OTEA
// ⚠️ verified: 0 = nom/orthographe à vérifier dans l'UI (transcription vocale).
const REFERENCE_SEED = [
  { code: 'galec', name: 'Le Galec · centrale E.Leclerc', detail: 'Vidéos de communication interne pour la centrale d’achats des centres E.Leclerc', sectors: ['grande_distribution', 'agriculture', 'corporate_industrie'], verified: 1 },
  { code: 'la_poste', name: 'La Poste', detail: 'Production vidéo (nouvelle vidéo en cours)', sectors: ['corporate_industrie', 'grande_distribution', 'aeronautique', 'collectivites'], verified: 1 },
  { code: 'nina_ramen', name: 'Nina Ramen', detail: 'Accompagnement contenu d’une figure du copywriting, contrat renouvelé', sectors: ['influence_media'], verified: 1 },
  { code: 'madiness', name: 'Madiness (média)', detail: 'Production de contenus pour un média', sectors: ['influence_media'], verified: 0 },
  { code: 'pullman', name: 'Hôtels Pullman', detail: 'Photos & vidéos pour l’hôtellerie premium', sectors: ['hotellerie', 'agences_voyage'], verified: 1 },
  { code: 'puteaux', name: 'Ville de Puteaux', detail: 'Contenus vidéo pour la collectivité', sectors: ['collectivites'], verified: 1 },
  { code: 'thorigny', name: 'Ville de Thorigny', detail: 'Contenus vidéo pour la collectivité', sectors: ['collectivites'], verified: 0 },
  { code: 'jessica_bataille', name: 'Jessica Bataille (architecture & décoration)', detail: 'Contenus pour une maison d’architecture d’intérieur', sectors: ['immobilier_archi'], verified: 0 },
  { code: 'rep_dominicaine', name: 'Délégation de la République Dominicaine', detail: 'Suivi presse & images d’une délégation officielle (agence de presse)', sectors: ['agences_voyage', 'collectivites', 'influence_media'], verified: 1 },
  { code: 'raja', name: 'RAJA', detail: 'Production corporate', sectors: ['corporate_industrie', 'grande_distribution'], verified: 0 },
  { code: 'raiff', name: 'RAIFF', detail: 'Production corporate', sectors: ['corporate_industrie', 'aeronautique'], verified: 0 },
];

function seedReferences() {
  for (const r of REFERENCE_SEED) {
    if (!get('SELECT id FROM refs WHERE code = ?', r.code)) {
      run('INSERT INTO refs (code, name, detail, sectors, verified, builtin) VALUES (?, ?, ?, ?, ?, 1)',
        r.code, r.name, r.detail, JSON.stringify(r.sectors), r.verified);
    }
  }
}

// ---------------------------------------------------------------- presets secteurs
// sn_recipe : à coller dans Sales Navigator (filtres en clair, prêts à reproduire).
const PRESETS = {
  grande_distribution: {
    emoji: '🛒', label: 'Grande distribution',
    persona: 'Responsable communication interne / Dircom enseigne',
    refs: ['galec', 'la_poste', 'raja'],
    angle: "La communication interne des enseignes : embarquer des milliers de collaborateurs en magasin, c'est un métier, et la vidéo est le format qui marche.",
    pain: 'faire passer les messages du siège jusqu’aux équipes en magasin',
    sn_recipe: `Filtres Sales Navigator :
• Fonction : Communication / Marketing
• Intitulé de poste : "responsable communication interne" OU "chargé(e) de communication interne" OU "directeur communication"
• Secteur : Commerce de détail, Grande distribution, Supermarchés
• Effectif : 1 000+ · Région : France
Astuce : cible aussi les centrales et coopératives (E.Leclerc, U, Intermarché…) et les sièges d'enseigne.`,
  },
  aeronautique: {
    emoji: '✈️', label: 'Aéronautique',
    persona: 'Responsable communication / marque employeur',
    refs: ['la_poste', 'raiff'],
    angle: "Un secteur qui recrute massivement et qui a besoin d'images à la hauteur de ses machines : marque employeur, films de site, sécurité.",
    pain: 'attirer des candidats et valoriser des sites industriels impressionnants',
    sn_recipe: `Filtres Sales Navigator :
• Intitulé : "responsable communication" OU "marque employeur" OU "communication interne"
• Secteur : Aéronautique et aérospatiale, Défense
• Effectif : 200+ · Région : France (Toulouse, Bordeaux, Île-de-France en priorité)
Astuce : vise aussi les sous-traitants rang 1/2 (moins sollicités que les grands noms).`,
  },
  agriculture: {
    emoji: '🌾', label: 'Agriculture & agroalimentaire',
    persona: 'Responsable communication coopérative / marque agro',
    refs: ['galec'],
    angle: "Les coopératives et marques agro ont des histoires vraies à raconter (terrain, producteurs, savoir-faire) et peu d'images à la hauteur.",
    pain: 'raconter le terrain et les producteurs avec des images authentiques',
    sn_recipe: `Filtres Sales Navigator :
• Intitulé : "responsable communication" OU "chargé(e) de communication"
• Secteur : Agriculture, Agroalimentaire, Produits alimentaires
• Effectif : 50+ · Région : France
Astuce : les coopératives (InVivo, Agrial, Sodiaal…) et interprofessions ont de vrais budgets com.`,
  },
  hotellerie: {
    emoji: '🏨', label: 'Hôtellerie',
    persona: 'Directeur d’hôtel / Responsable marketing groupe',
    refs: ['pullman', 'rep_dominicaine'],
    angle: "Un hôtel se vend en images : les établissements qui investissent dans la vidéo remplissent mieux, tout simplement.",
    pain: 'se démarquer sur Booking/Instagram avec de vraies images pro',
    sn_recipe: `Filtres Sales Navigator :
• Intitulé : "directeur" OU "responsable marketing" OU "responsable communication"
• Secteur : Hôtellerie, Hébergement
• Effectif : 10+ · Région : France (littoral + grandes villes)
Astuce : commence par les 4-5 étoiles et les groupes régionaux (plus de budget, décision rapide).`,
  },
  agences_voyage: {
    emoji: '🧳', label: 'Agences de voyage & tourisme',
    persona: 'Fondateur / Responsable marketing',
    refs: ['rep_dominicaine', 'pullman'],
    angle: "Le voyage s'achète en vidéo : destinations, expériences, avis clients : le contenu fait la réservation.",
    pain: 'vendre du rêve avec de vraies images de destination',
    sn_recipe: `Filtres Sales Navigator :
• Intitulé : "fondateur" OU "directeur" OU "responsable marketing"
• Secteur : Voyages et tourisme, Loisirs
• Effectif : 2-200 · Région : France
Astuce : ajoute les offices de tourisme et les DMC françaises (délégations, éductours = notre terrain de jeu).`,
  },
  collectivites: {
    emoji: '🏛️', label: 'Collectivités & villes',
    persona: 'Dircom mairie / chargé(e) de communication',
    refs: ['puteaux', 'thorigny', 'la_poste'],
    angle: "Les villes qui communiquent bien créent du lien avec leurs habitants : événements, travaux, portraits : la vidéo municipale qui donne envie.",
    pain: 'rendre l’action municipale visible et concrète pour les habitants',
    sn_recipe: `Filtres Sales Navigator :
• Intitulé : "directeur de la communication" OU "chargé de communication"
• Secteur : Administration publique, Collectivités
• Région : Île-de-France + ta région
Astuce : vise les villes de 10 000 à 100 000 habitants (assez de budget, moins d'agences en face).`,
  },
  influence_media: {
    emoji: '🎤', label: 'Influence & médias',
    persona: 'Créateurs, médias, agences d’influence',
    refs: ['nina_ramen', 'madiness', 'rep_dominicaine'],
    angle: "Les créateurs qui durent sont ceux qui se dotent d'une vraie prod : régularité, qualité, formats qui convertissent.",
    pain: 'produire régulièrement sans sacrifier la qualité',
    sn_recipe: `Filtres Sales Navigator :
• Intitulé : "créateur" OU "fondateur" OU "head of content"
• Secteur : Médias, Production audiovisuelle, Marketing
• Effectif : 1-50 · Région : France
Astuce : les créateurs B2B (LinkedIn) investissent : regarde qui poste beaucoup avec une prod moyenne.`,
  },
  immobilier_archi: {
    emoji: '🏗️', label: 'Immobilier & architecture',
    persona: 'Promoteur / architecte / agence immo premium',
    refs: ['jessica_bataille'],
    angle: "Un bien ou un projet d'architecture se vend à l'image : films de réalisation, visites, avant/après.",
    pain: 'vendre des projets sur plan et des réalisations en images',
    sn_recipe: `Filtres Sales Navigator :
• Intitulé : "directeur" OU "fondateur" OU "responsable marketing"
• Secteur : Immobilier, Architecture et urbanisme
• Effectif : 5+ · Région : France
Astuce : les promoteurs régionaux et architectes d'intérieur haut de gamme d'abord.`,
  },
  corporate_industrie: {
    emoji: '🏭', label: 'Corporate & industrie',
    persona: 'Dircom / responsable communication interne',
    refs: ['raja', 'raiff', 'la_poste', 'galec'],
    angle: "Films corporate, communication interne, sécurité, marque employeur : l'industrie a des budgets et un vrai besoin d'images.",
    pain: 'moderniser l’image et embarquer les équipes',
    sn_recipe: `Filtres Sales Navigator :
• Intitulé : "responsable communication" OU "directeur de la communication" OU "communication interne"
• Secteur : Industrie, Logistique, Machines
• Effectif : 500+ · Région : France
Astuce : les ETI industrielles familiales adorent les films d'entreprise anniversaire / transmission.`,
  },
  sport_event: {
    emoji: '🏃', label: 'Sport & événementiel',
    persona: 'Organisateur d’événements sportifs (type Hyrox)',
    refs: ['rep_dominicaine', 'pullman'],
    angle: "L'aftermovie de l'édition N vend l'édition N+1 : couverture jour J, réels à chaud, interviews.",
    pain: 'transformer l’événement en contenu qui vend la prochaine édition',
    sn_recipe: `Filtres Sales Navigator :
• Intitulé : "organisateur" OU "fondateur" OU "event manager"
• Secteur : Sports, Événementiel
• Effectif : 1-100 · Région : France
Astuce : cherche les courses/compétitions à billetterie (Hyrox, trails, courses à obstacles).`,
  },

  // ---------------------------------------------------------------- projets longs
  sponsoring_hyrox: {
    emoji: '🏋️', label: 'Sponsoring HYROX · Pierre & Antoine',
    kind: 'projet', ends_on: '2027-06-13', // dernier jour du championnat du monde
    persona: 'Responsable sponsoring, partenariats ou marketing sport (équipementiers, montres, nutrition, récupération, distribution, entreprises)',
    refs: ['la_poste', 'puteaux'],
    angle: "Pierre Huiban et Antoine Bouhana viennent de se qualifier en doubles pro hommes 35-39 pour les PUMA HYROX World Championships de Hong Kong (10 au 13 juin 2027). OTEA filme leur route jusqu'au départ : un partenaire achète une histoire vraie, des images prêtes à diffuser et deux athlètes visibles pendant neuf mois.",
    pain: 'financer le voyage, la préparation et la tenue de deux qualifiés au championnat du monde',
    projet: {
      athletes: "Pierre Huiban (responsable commercial Europe chez LexisNexis) et Antoine Bouhana (kinésithérapeute à Pontault-Combault), tous deux en région parisienne",
      categorie: 'doubles pro hommes 35-39',
      evenement: 'PUMA HYROX World Championships, AsiaWorld-Expo, Hong Kong, du 10 au 13 juin 2027 (environ 0,5 % des compétiteurs se qualifient)',
      offre: "la marque du partenaire sur la tenue à l'entraînement, en course et à Hong Kong ; une série documentaire « la route vers Hong Kong » produite par OTEA, avec des épisodes réguliers ; des images prêtes à diffuser ; un épisode dédié pour un partenaire principal",
      demande: 'financer le voyage, la préparation, la tenue et le matériel ; une dotation produit pour les marques équipement, nutrition et récupération',
      contexte: "PUMA est le sponsor-titre du championnat du monde et l'équipementier officiel de HYROX, Amazfit la montre officielle, Red Bull et Centr des partenaires mondiaux. Un concurrent direct d'un partenaire officiel peut être gêné par l'affichage à l'arrivée.",
    },
    delays: [0, 5, 7], // J0 → J+5 → J+12 : les décideurs sponsoring répondent moins vite qu'un dircom
    kit: kitSponsoring,
    sn_recipe: `Filtres Sales Navigator :
• Intitulé : "sponsoring" OU "partenariats" OU "sports marketing" OU "brand marketing" OU "athlete"
• Secteur : Articles de sport, Vente au détail, Santé et bien-être, Produits alimentaires
• Effectif : 11+ · Région : France
Astuce : vise d'abord les marques déjà présentes sur les courses HYROX (village exposants, dotations) et les marques françaises de nutrition et de récupération : elles disent oui plus vite que les géants. PUMA est le sponsor-titre du championnat : Nike et adidas en dernier.`,
  },
};

// ---------------------------------------------------------------- helpers
function mondayOf(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const shift = (dt.getDay() + 6) % 7; // lundi = 0
  return addDays(dayStr, -shift);
}

function refsById(ids) {
  return ids.map((id) => get('SELECT * FROM refs WHERE id = ?', id)).filter(Boolean);
}

function refsSentence(refs) {
  const names = refs.map((r) => r.name.replace(/\s*\(.*?\)\s*/g, ' ').trim());
  if (!names.length) return `des marques et collectivités françaises`;
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' ou encore ' + names[names.length - 1];
}

// ---------------------------------------------------------------- kit sponsoring
// Écrit pour chercher des partenaires, pas pour vendre de la vidéo : le prospect
// lit qui sont les athlètes, ce qu'il gagne et ce qu'on lui demande.
function kitSponsoring(preset, refs, settings) {
  const pj = preset.projet;
  const boite = settings.company_name || 'OTEA Production';
  const sentence = refsSentence(refs);
  const rdv = settings.booking_url ? `\nMon agenda si c'est plus simple : ${settings.booking_url}` : '';
  const objet = "Deux qualifiés pour les Mondiaux HYROX, filmés jusqu'à Hong Kong";

  const emails = [
    {
      subject: objet,
      body: `Bonjour {prenom},

{accroche}Pierre Huiban et Antoine Bouhana viennent de se qualifier en ${pj.categorie} pour les PUMA HYROX World Championships de Hong Kong, du 10 au 13 juin 2027. Environ 0,5 % des compétiteurs y arrivent.

Je pratique le HYROX moi-même et je filme leur route jusqu'au départ : une série documentaire, des formats courts chaque semaine, un film au retour.

Ce que je propose à {entreprise} : Pierre et Antoine portent votre marque à l'entraînement, en course et à Hong Kong, et vous recevez des images prêtes à diffuser sans rien produire. En face, on cherche des partenaires pour financer le voyage, la préparation et la tenue.

Est-ce le genre d'histoire que {entreprise} a envie de porter ? Si oui, 15 minutes suffisent pour vous montrer les premières images.${rdv}

{signature}`,
    },
    {
      subject: `Re: ${objet}`,
      body: `Bonjour {prenom},

Je me permets une relance courte, avec du concret. Trois façons d'accompagner Pierre et Antoine jusqu'à Hong Kong :

• Partenaire produit (équipement, nutrition, récupération) : vous fournissez, c'est visible à chaque entraînement filmé et en course
• Partenaire principal : votre marque sur la tenue et dans chaque épisode de la série, avec un épisode qui vous est consacré
• Partenaire entreprise ou local : un soutien financier contre une visibilité et un film à partager à vos équipes et à vos clients

Les images sont produites par ${boite}, qui travaille pour ${sentence}. Un créneau de 15 minutes cette semaine pour voir ce qui collerait à {entreprise} ?${rdv}

{signature}`,
    },
    {
      subject: `Dernier mot sur Pierre et Antoine ({entreprise})`,
      body: `Bonjour {prenom},

Dernier message de ma part, je ne veux pas encombrer votre boîte.

Si le sponsoring sportif n'est pas d'actualité chez {entreprise}, aucun problème. La préparation dure jusqu'en juin 2027 et un partenaire peut monter à bord à tout moment : il y aura toujours des images à venir.

Et si c'est juste un mauvais timing, dites-le-moi en un mot, je reviendrai au bon moment.

Belle continuation !

{signature}`,
    },
  ];

  const post = `🏋️ Pierre et Antoine viennent de se qualifier pour les PUMA HYROX World Championships de Hong Kong, en ${pj.categorie}. Environ 0,5 % des compétiteurs y arrivent.

Pierre est commercial, Antoine est kiné. Ils s'entraînent avant le travail et après.

Je les filme jusqu'au départ, le 10 juin 2027 : la préparation, les doutes, les courses, Hong Kong.

Ce qu'il leur manque : des partenaires. Équipement, montre, nutrition, récupération, ou une entreprise qui a envie de porter une histoire vraie pendant neuf mois.

Si votre marque veut être sur leur tenue et dans chaque épisode, écrivez-moi. Et si vous connaissez la bonne personne, un partage suffit.

#HYROX #sponsoring #sport`;

  const dm = `Bonjour {prenom} ! Je me permets : Pierre et Antoine, deux athlètes que j'accompagne, viennent de se qualifier en doubles pro 35-39 pour le championnat du monde HYROX à Hong Kong. Je filme leur route jusqu'au départ et je cherche les marques qui les accompagneront. Votre rôle chez {entreprise} m'a fait penser à vous : 15 minutes pour vous montrer les premières images ?`;

  return { emails, post, dm };
}

// ---------------------------------------------------------------- kit statique
function buildKit(preset, persona, refs, settings) {
  if (typeof preset.kit === 'function') return preset.kit(preset, refs, settings);
  const phare = refs[0] ? refs[0].name : 'de grands groupes';
  const sentence = refsSentence(refs);
  const boite = settings.company_name || 'OTEA Production';
  const rdv = settings.booking_url ? `\nMon agenda si c'est plus simple : ${settings.booking_url}` : '';

  const emails = [
    {
      subject: `${preset.label} × vidéo : ce qu'on a fait pour ${phare}`,
      body: `Bonjour {prenom},

{accroche}Je vous écris car cette semaine, chez ${boite}, on se concentre sur un seul secteur : ${preset.label.toLowerCase()}.

${preset.angle}

On a déjà accompagné ${sentence}, et le sujet « ${preset.pain} » revient à chaque fois.

Est-ce que c'est un enjeu chez {entreprise} en ce moment ? Si oui, je vous montre en 15 minutes ce qu'on a produit et ce que ça a changé.${rdv}

{signature}`,
    },
    {
      subject: `Re: ${preset.label} × vidéo : ce qu'on a fait pour ${phare}`,
      body: `Bonjour {prenom},

Je me permets une relance courte, avec du concret. Trois formats qui marchent très bien en ce moment dans votre secteur :

• Un film « immersion » de 2 min qui montre le vrai quotidien des équipes
• Une série de formats courts (8-12 réels à partir d'une journée de tournage)
• La couverture d'un temps fort (séminaire, lancement, événement) avec livraison à chaud

C'est exactement ce qu'on a fait pour ${phare}. Un créneau de 15 min cette semaine pour voir ce qui collerait à {entreprise} ?${rdv}

{signature}`,
    },
    {
      subject: `On se garde sous le coude ? ({entreprise})`,
      body: `Bonjour {prenom},

Dernier message de ma part, je ne veux pas encombrer votre boîte.

Si le sujet vidéo/contenu n'est pas d'actualité chez {entreprise}, aucun problème : gardez mon contact pour le jour où un projet sort (on a l'habitude des délais courts).

Et si c'est juste un mauvais timing, dites-le-moi en un mot, je reviendrai au bon moment.

Belle continuation !

{signature}`,
    },
  ];

  const post = `🎯 Cette semaine chez ${boite} : cap sur ${preset.emoji} ${preset.label.toLowerCase()}.

${preset.angle}

On a eu la chance d'accompagner ${sentence} sur ces sujets : communication interne, films de marque, couverture d'événements.

Si vous travaillez dans ${preset.label.toLowerCase()} et que « ${preset.pain} » vous parle, ma porte est ouverte cette semaine : 15 minutes, je vous montre des exemples concrets, vous repartez avec des idées (même si on ne travaille jamais ensemble).

📩 En DM ou en commentaire.

#communication #video #${preset.label.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;

  const dm = `Bonjour {prenom} ! Je me permets : cette semaine chez ${boite} on se consacre à ${preset.label.toLowerCase()}, et votre profil chez {entreprise} a retenu mon attention. On a accompagné ${phare} sur des sujets très proches (${preset.pain}). 15 minutes cette semaine pour vous montrer ce qu'on a produit ? Même si ça ne va pas plus loin, vous repartirez avec 2-3 idées.`;

  return { emails, post, dm };
}

// ---------------------------------------------------------------- création
function createCampaign({ sector, week_start, persona, reference_ids, name, ends_on }) {
  const preset = PRESETS[sector];
  if (!preset) throw new Error(`Secteur inconnu : ${sector}. Disponibles : ${Object.keys(PRESETS).join(', ')}`);
  const projet = preset.kind === 'projet';
  const week = mondayOf(week_start || localDay());
  let endsOn = '';
  if (projet) {
    endsOn = ends_on || preset.ends_on || addDays(week, 90);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) throw new Error('Date de fin du projet invalide : attendu AAAA-MM-JJ.');
    if (endsOn < week) throw new Error('Le projet ne peut pas finir avant de commencer : recule la date de début ou avance la date de fin.');
    const ouvert = get(`SELECT id FROM campaigns WHERE sector = ? AND ends_on != '' AND ends_on >= ?`, sector, localDay());
    if (ouvert) throw new Error('Ce projet est déjà ouvert : retrouve-le dans la liste des campagnes, plus bas.');
  } else {
    const existing = get('SELECT id FROM campaigns WHERE week_start = ? AND sector = ?', week, sector);
    if (existing) throw new Error('Une campagne existe déjà sur ce secteur cette semaine-là.');
  }

  const refIds = reference_ids && reference_ids.length
    ? reference_ids
    : preset.refs.map((code) => { const r = get('SELECT id FROM refs WHERE code = ?', code); return r ? r.id : null; }).filter(Boolean);
  const refs = refsById(refIds);
  const settings = allSettings();
  const kit = buildKit(preset, persona || preset.persona, refs, settings);

  const campName = name || (projet
    ? `${preset.emoji} ${preset.label}`
    : `${preset.emoji} ${preset.label} · semaine du ${week.slice(8, 10)}/${week.slice(5, 7)}`);
  const now = nowIso();
  const { lastId: campaignId } = run(
    `INSERT INTO campaigns (name, sector, emoji, persona, week_start, ends_on, reference_ids, sn_recipe, angle, post_draft, dm_draft, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    campName, sector, preset.emoji, persona || preset.persona, week, endsOn,
    JSON.stringify(refIds), preset.sn_recipe, preset.angle, kit.post, kit.dm, now
  );

  // Templates dédiés (masqués de la bibliothèque générale via campaign_id).
  const templateCodes = [];
  kit.emails.forEach((e, i) => {
    const code = `camp_${campaignId}_${i + 1}`;
    run('INSERT INTO templates (code, name, segment, channel, subject, body, builtin, sort, campaign_id) VALUES (?, ?, ?, ?, ?, ?, 0, 200, ?)',
      code, `${preset.emoji} ${preset.label} · email ${i + 1}`, '', 'email', e.subject, e.body, campaignId);
    templateCodes.push(code);
  });

  // Séquence dédiée : J0 → J+4 → J+10 (ou la cadence propre au preset).
  const { lastId: sequenceId } = run('INSERT INTO sequences (code, name, segment, description, builtin, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    `seq_camp_${campaignId}`, campName, '', `Séquence ${projet ? 'du projet' : 'de la campagne'} « ${preset.label} »`, now);
  const delays = preset.delays || [0, 4, 6]; // écarts entre deux emails : J0, J+4, J+10
  templateCodes.forEach((code, i) => {
    run('INSERT INTO sequence_steps (sequence_id, step_index, delay_days, template_code) VALUES (?, ?, ?, ?)', sequenceId, i, delays[i], code);
  });
  run('UPDATE campaigns SET sequence_id = ? WHERE id = ?', sequenceId, campaignId);

  return get('SELECT * FROM campaigns WHERE id = ?', campaignId);
}

// ---------------------------------------------------------------- projets livrés avec l'app
// Un preset projet peut embarquer ses fiches (src/projets/<code>.json, champs de
// l'app) : au premier démarrage, le projet s'ouvre tout seul et ses fiches se
// rattachent. Une seule fois par base (réglage projet_seed_<code>), pour qu'un
// projet supprimé à la main ne revienne pas au redémarrage suivant.
function seedProjects() {
  const ouverts = [];
  for (const [code, preset] of Object.entries(PRESETS)) {
    if (preset.kind !== 'projet') continue;
    const cleReglage = `projet_seed_${code}`;
    if (getSetting(cleReglage)) continue;
    const today = localDay();
    let campagne = get(`SELECT * FROM campaigns WHERE sector = ? AND ends_on != '' AND ends_on >= ? ORDER BY id DESC LIMIT 1`, code, today);
    if (!campagne) {
      if (preset.ends_on && preset.ends_on < today) { setSetting(cleReglage, '1'); continue; } // projet déjà passé : rien à ouvrir
      campagne = createCampaign({ sector: code, week_start: today });
    }
    let fiches = [];
    const fichier = path.join(__dirname, 'projets', `${code}.json`);
    if (fs.existsSync(fichier)) {
      try { fiches = JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { fiches = []; }
    }
    let crees = 0, fusionnes = 0;
    for (const f of fiches) {
      if (!f || (!f.first_name && !f.last_name && !f.company)) continue;
      const { created } = dbApi.upsertContact({ ...f, origin: f.origin || 'linkedin', campaign_id: campagne.id });
      if (created) crees++; else fusionnes++;
    }
    if (fiches.length) {
      game.insertActivity({ type: 'import', xp: 0, note: `Projet « ${campagne.name} » ouvert : ${crees} fiche(s) rattachée(s), ${fusionnes} déjà connue(s)`, meta: { count: crees, source: 'projet' } });
    }
    setSetting(cleReglage, '1');
    ouverts.push({ code, id: campagne.id, name: campagne.name, fiches: fiches.length, crees, fusionnes });
  }
  return ouverts;
}

// ---------------------------------------------------------------- stats & état
function campaignStats(c) {
  const n = (sql, ...p) => Number(get(sql, ...p).n);
  return {
    contacts: n('SELECT COUNT(*) AS n FROM contacts WHERE campaign_id = ? AND archived = 0', c.id),
    avec_email: n(`SELECT COUNT(*) AS n FROM contacts WHERE campaign_id = ? AND archived = 0 AND email != ''`, c.id),
    enrolled: n('SELECT COUNT(*) AS n FROM enrollments e JOIN contacts co ON co.id = e.contact_id WHERE co.campaign_id = ?', c.id),
    sent: n(`SELECT COUNT(*) AS n FROM outbox o JOIN contacts co ON co.id = o.contact_id WHERE co.campaign_id = ? AND o.status = 'sent'`, c.id),
    replies: n(`SELECT COUNT(*) AS n FROM activities a JOIN contacts co ON co.id = a.contact_id WHERE co.campaign_id = ? AND a.type = 'reponse_recue'`, c.id),
    rdv: n(`SELECT COUNT(*) AS n FROM activities a JOIN contacts co ON co.id = a.contact_id WHERE co.campaign_id = ? AND a.type = 'rdv_pris'`, c.id),
    devis: n(`SELECT COUNT(*) AS n FROM deals d JOIN contacts co ON co.id = d.contact_id WHERE co.campaign_id = ?`, c.id),
  };
}

// Une semaine thématique dure sept jours ; un projet dure jusqu'à sa date de fin incluse.
function campaignStatus(c) {
  const today = localDay();
  if (today < c.week_start) return 'a_venir';
  const end = c.ends_on ? addDays(c.ends_on, 1) : addDays(c.week_start, 7);
  if (today < end) return 'en_cours';
  return 'terminee';
}

// « J0 → J+4 → J+10 » : la cadence réelle de la séquence, lue dans ses étapes.
function cadenceOf(c) {
  if (!c.sequence_id) return '';
  let cumul = 0;
  return all('SELECT delay_days FROM sequence_steps WHERE sequence_id = ? ORDER BY step_index', c.sequence_id)
    .map((s) => { cumul += Number(s.delay_days) || 0; return cumul === 0 ? 'J0' : `J+${cumul}`; })
    .join(' → ');
}

function decorate(c) {
  const ids = JSON.parse(c.reference_ids || '[]');
  return {
    ...c,
    ends_on: c.ends_on || '',
    kind: c.ends_on ? 'projet' : 'semaine',
    cadence: cadenceOf(c),
    reference_ids: ids,
    references: refsById(ids),
    status: campaignStatus(c),
    stats: campaignStats(c),
  };
}

function listCampaigns() {
  return all('SELECT * FROM campaigns ORDER BY week_start DESC, id DESC').map(decorate);
}

// La campagne mise en avant : la semaine thématique en cours, sinon un projet
// encore ouvert, sinon la dernière commencée.
function currentCampaign() {
  const today = localDay();
  const monday = mondayOf(today);
  const c = get(`SELECT * FROM campaigns WHERE week_start = ? AND ends_on = '' ORDER BY id DESC LIMIT 1`, monday)
    || get(`SELECT * FROM campaigns WHERE week_start <= ? AND ends_on != '' AND ends_on >= ? ORDER BY week_start DESC, id DESC LIMIT 1`, today, today)
    || get('SELECT * FROM campaigns WHERE week_start <= ? ORDER BY week_start DESC, id DESC LIMIT 1', today);
  if (!c) return null;
  return decorate(c);
}

// Enrôle tous les contacts de la campagne (avec email, pas déjà en séquence).
function enrollAll(campaignId) {
  const c = get('SELECT * FROM campaigns WHERE id = ?', campaignId);
  if (!c) throw new Error('Campagne introuvable');
  if (!c.sequence_id) throw new Error('Cette campagne n’a pas de séquence associée');
  const ids = all('SELECT id FROM contacts WHERE campaign_id = ? AND archived = 0', campaignId).map((r) => r.id);
  if (!ids.length) throw new Error('Aucun contact rattaché à cette campagne : importe d’abord ton CSV Sales Navigator.');
  return autopilot.enroll(c.sequence_id, ids);
}

// ---------------------------------------------------------------- régénération IA
async function regenerateKit(campaignId) {
  const key = getSetting('anthropic_api_key');
  if (!key) throw new Error('Pas de clé API Claude dans Réglages. Le kit statique reste en place (il est déjà solide).');
  const c = get('SELECT * FROM campaigns WHERE id = ?', campaignId);
  if (!c) throw new Error('Campagne introuvable');
  const preset = PRESETS[c.sector] || { label: c.sector, angle: c.angle, pain: '', emoji: c.emoji };
  const refs = refsById(JSON.parse(c.reference_ids || '[]'));
  const settings = allSettings();

  const system = `Tu es le directeur commercial de ${settings.company_name}, agence de production vidéo et communication (fondateur : ${settings.user_name}). Tu écris en français, style direct, chaleureux, concret, vouvoiement, zéro jargon, jamais de tiret cadratin. Réponds EXACTEMENT au format demandé, sans commentaire autour.`;
  const variables = `Variables à utiliser telles quelles dans les emails/DM : {prenom} {entreprise} {signature}${settings.booking_url ? ' ' + settings.booking_url : ''}.`;
  const user = preset.projet
    ? `Campagne de recherche de sponsors et de partenaires pour deux athlètes (ce n'est PAS une vente de vidéo).
Athlètes : ${preset.projet.athletes}. Catégorie : ${preset.projet.categorie}.
Événement : ${preset.projet.evenement}.
Persona ciblé : ${c.persona}.
Angle : ${c.angle}
Ce qu'on offre au partenaire : ${preset.projet.offre}.
Ce qu'on lui demande : ${preset.projet.demande}.
Contexte à respecter : ${preset.projet.contexte}
Qui produit les images : ${settings.company_name}, qui travaille pour ${refs.map((r) => r.name).join(', ') || 'des marques et collectivités françaises'} (ne pas inventer d'autres références).
${variables}

Génère :
===EMAIL1_OBJET=== (objet court, qui nomme les Mondiaux HYROX)
===EMAIL1_CORPS=== (140 mots max : qui sont les athlètes, ce que le partenaire gagne, ce qu'on demande, question finale simple)
===EMAIL2_OBJET===
===EMAIL2_CORPS=== (relance J+5 : 3 formules de partenariat en bullets, 110 mots max)
===EMAIL3_OBJET===
===EMAIL3_CORPS=== (dernière relance J+12 : porte ouverte, 70 mots max)
===POST=== (post LinkedIn : hook fort 1re ligne, l'histoire des deux athlètes, ce qu'ils cherchent, CTA en DM, hashtags)
===DM=== (message LinkedIn court, 60 mots max)`
    : `Campagne de prospection de la semaine.
Secteur : ${preset.label}. Persona ciblé : ${c.persona}.
Angle : ${c.angle}
Références clients à citer naturellement (ne pas inventer d'autres) : ${refs.map((r) => `${r.name} (${r.detail})`).join(' ; ') || 'aucune'}.
${variables}

Génère :
===EMAIL1_OBJET=== (objet court, spécifique secteur)
===EMAIL1_CORPS=== (120 mots max, 1 référence citée, question finale simple)
===EMAIL2_OBJET===
===EMAIL2_CORPS=== (relance J+4 : 3 formats concrets en bullets, 100 mots max)
===EMAIL3_OBJET===
===EMAIL3_CORPS=== (dernière relance J+10 : porte ouverte, 70 mots max)
===POST=== (post LinkedIn de la semaine : hook fort 1re ligne, références, CTA en DM, hashtags)
===DM=== (message LinkedIn court, 60 mots max)`;

  const res = await apiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: { model: getSetting('ai_model') || 'claude-sonnet-5', max_tokens: 2000, system, messages: [{ role: 'user', content: user }] },
    timeoutMs: 90000,
  });
  const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const section = (tag) => {
    const m = text.match(new RegExp(`===${tag}===\\s*([\\s\\S]*?)(?====|$)`));
    return m ? m[1].trim() : '';
  };

  const emails = [1, 2, 3].map((i) => ({ subject: section(`EMAIL${i}_OBJET`), body: section(`EMAIL${i}_CORPS`) }));
  if (emails.some((e) => !e.body)) throw new Error('Réponse IA incomplète, kit inchangé. Réessaie.');

  emails.forEach((e, i) => {
    run('UPDATE templates SET subject = ?, body = ? WHERE code = ?', e.subject || '', e.body, `camp_${campaignId}_${i + 1}`);
  });
  run('UPDATE campaigns SET post_draft = ?, dm_draft = ? WHERE id = ?', section('POST') || c.post_draft, section('DM') || c.dm_draft, campaignId);
  return { ok: true, model: res.model };
}

module.exports = { PRESETS, REFERENCE_SEED, seedReferences, seedProjects, createCampaign, listCampaigns, currentCampaign, campaignStats, campaignStatus, cadenceOf, enrollAll, regenerateKit, mondayOf, buildKit, kitSponsoring };
