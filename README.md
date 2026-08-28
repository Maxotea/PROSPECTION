# ⚔️ La Chasse · CRM de prospection gamifié + Autopilote (OTEA Production)

Un outil de prospection **local, zéro dépendance**, pensé pour un seul objectif : **déclencher 5 factures**.

Trois moteurs :

1. **📅 Les Campagnes hebdo** : la stratégie : une semaine = un secteur (grande distribution, aéronautique, agriculture, hôtellerie, agences de voyage…) et un persona cible. Chaque campagne se crée en 2 clics avec sa **recette Sales Navigator** prête à copier, sa **séquence email** citant tes vraies références (le Galec, La Poste, Pullman…), son **post LinkedIn** et son **script DM** : pour qu'on voie OTEA partout, partout, partout.
2. **🤖 L'Autopilote** : la machine qui prospecte à ta place : elle enrôle tes contacts (anciens clients Pennylane, HubSpot, ta boîte Gmail) dans des **séquences email**, envoie depuis **ton Gmail** (chaque relance reste dans le même fil), respecte un cap quotidien et des horaires ouvrés, **détecte les réponses dans ta boîte** et stoppe la séquence dès qu'on te répond : il ne te reste qu'à transformer la réponse en call.
3. **🎮 Le CRM gamifié** : import Pennylane / LinkedIn / HubSpot, enrichissement FullEnrich, typologies de clients, Mode Chasse, devis Pennylane en 2 clics, XP, quêtes, streak, badges, boss final « 5 factures ».

---

## 🚀 Démarrage (2 minutes)

Prérequis : **Node.js ≥ 22.13** (aucun `npm install`, aucune dépendance) : installe la version **LTS** depuis [nodejs.org](https://nodejs.org/fr) si besoin.

**Sans terminal (recommandé)** : télécharge le projet (GitHub → bouton vert **Code** → **Download ZIP** → décompresse), puis double-clique :
- sur Mac : **`demarrer.command`**. Au premier lancement, macOS bloque (« Apple n'a pas pu confirmer… ») : clique **« Terminé »** (pas « corbeille »), puis **Réglages Système → Confidentialité et sécurité → tout en bas → « Ouvrir quand même »**, et re-double-clique. C'est une seule fois. (Plan B : ouvre Terminal, tape `bash ` avec un espace, glisse le fichier dans la fenêtre, Entrée.)
- sur Windows : **`demarrer.bat`** (si « Windows a protégé votre PC » : « Informations complémentaires » → « Exécuter quand même »).

Le navigateur s'ouvre tout seul sur l'app. **Laisse la petite fenêtre noire ouverte** : c'est elle qui fait tourner l'Autopilote.

**📱 Depuis un iPad / iPhone (même Wi-Fi)** : lance **`demarrer-reseau.command`** (Mac) ou **`demarrer-reseau.bat`** (Windows) au lieu du lanceur normal. La fenêtre noire affiche l'adresse à ouvrir sur l'iPad (`http://IP-de-l'ordinateur:1337`) et un **code d'accès à 6 caractères** (demandé une fois par appareil : l'app reste verrouillée pour le reste du réseau). L'ordinateur doit rester allumé : c'est lui qui fait tourner l'app et l'Autopilote, l'iPad n'est qu'un écran. Astuce : sur l'iPad, Safari → Partager → « Sur l'écran d'accueil » pour avoir La Chasse comme une app. Pour y accéder **hors de chez toi** (4G, autre lieu), installe [Tailscale](https://tailscale.com) (gratuit) sur l'ordinateur et l'iPad : même adresse, où que tu sois, sans rien exposer sur internet.

**Avec terminal** :

```bash
git clone <ce-repo>
cd PROSPECTION
npm start          # ou : node server.js
```

➜ Ouvre **http://localhost:1337**

Pour essayer avec des données fictives : `npm run demo` (et `npm run reset` pour tout remettre à zéro).

Toutes tes données (contacts, clés API, historique) restent **sur ta machine**, dans `data/prospection.db` (gitignoré). Le serveur n'écoute que sur `127.0.0.1`.

### 🩺 Quand ça ne s'ouvre pas

**« Ce site est inaccessible » / ERR_CONNECTION_REFUSED dans le navigateur** veut dire
une seule chose : l'app ne tourne pas. Le navigateur n'est qu'une fenêtre ouverte sur
elle. **La Chasse ne tourne que pendant que la fenêtre noire est ouverte** : si tu la
fermes (ou si tu redémarres le Mac), l'adresse ne répond plus tant que tu n'as pas
relancé `demarrer.command`.

Si le relancement ne suffit pas, **double-clique sur `diagnostic.command`**. Il ne
répare rien et ne touche à aucune donnée : il vérifie Node, les fichiers, ta base, le
port, essaie de démarrer l'app, et écrit un rapport lisible (une copie est déposée sur
ton Bureau) à envoyer tel quel.

### 🔄 Mettre à jour sans perdre tes données

Tes contacts, tes clés API et ton historique vivent dans le dossier **`data/`** : jamais dans le code. Donc pour passer à une nouvelle version :

1. Ferme la fenêtre noire (ça arrête l'app).
2. Télécharge le nouveau ZIP (GitHub → **Code** → **Download ZIP**) et décompresse-le. Tu as maintenant deux dossiers côte à côte.
3. **Glisse le dossier `data` de l'ANCIEN dossier dans le NOUVEAU.** C'est l'étape qui préserve tout : contacts, réglages Gmail, XP, campagnes.
4. Double-clique `demarrer.command` dans le **nouveau** dossier. Tu retrouves l'app exactement où tu l'avais laissée, avec les nouveautés en plus.
5. Une fois que tout va bien, tu peux jeter l'ancien dossier.

> Le blocage macOS (« Apple n'a pas pu confirmer… ») revient à chaque nouveau dossier : même manip que la première fois, **Réglages Système → Confidentialité et sécurité → « Ouvrir quand même »**.

---

## 📅 Les Campagnes hebdo : une semaine, un secteur, tes références partout

Le rythme : **chaque lundi, un nouveau terrain de chasse.** Semaine 1 la grande distribution (responsables communication interne : tu as le Galec en référence), semaine 2 l'aéronautique, puis l'agriculture, les hôtels (Pullman !), les agences de voyage, les collectivités (Puteaux)…

**Créer la semaine = 2 clics** (vue Campagnes → choisir le secteur → la date) et tu obtiens :

- 🧲 **La recette Sales Navigator** : filtres exacts à reproduire (intitulés de poste, secteur, effectif, région + astuce de ciblage), à exporter ensuite via l'extension FullEnrich → CSV → bouton « Importer le CSV de la campagne » ;
- 📧 **La séquence email dédiée** (J0 → J+4 → J+10) : rédigée pour le secteur, citant **tes références réelles** (« ce qu'on a fait pour le Galec »), envoyée par l'Autopilote, stoppée à la première réponse ;
- 📣 **Le post LinkedIn de la semaine** (hook, références, CTA en DM) + **le script DM** pour les prospects sans email : c'est le « partout » : email + DM + contenu en même temps sur le même secteur ;
- ✅ **La checklist de la semaine** avec stats en direct : sourcé → enrichi → enrôlé → posté → réponses/RDV/devis.

**Tes références** vivent dans la vue Campagnes (⭐) : chacune est éditable, et celles issues de la dictée vocale sont marquées **⚠️ à vérifier** (Madiness, Thorigny, Jessica Bataille, RAJA, RAIFF…) : corrige l'orthographe une fois, tous les futurs kits l'utilisent. Le bouton **✨ Régénérer le kit** réécrit emails/post/DM avec l'IA (clé Claude requise) en ne citant QUE tes références réelles.

10 secteurs pré-configurés : grande distribution, aéronautique, agriculture & agro, hôtellerie, agences de voyage & tourisme, collectivités & villes, influence & médias, immobilier & architecture, corporate & industrie, sport & événementiel.

## 🤖 L'Autopilote : la machine qui prospecte à ta place

### Brancher ton Gmail (2 minutes, sans projet Google Cloud)

1. Active la **validation en 2 étapes** sur ton compte Google ;
2. Va sur [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → crée un mot de passe d'application « La Chasse » ;
3. Colle-le dans **Réglages → Gmail & Autopilote** avec ton adresse → **Tester SMTP** + **Tester IMAP** → « 📤 M'envoyer un email de test ».

### La boucle (toutes les 10 minutes quand l'Autopilote est actif)

1. **Détection des réponses** : lecture des *en-têtes* (jamais les contenus) des nouveaux emails de ta boîte. Si un prospect en séquence a répondu → séquence **stoppée**, +25 XP, contact passé « En discussion », et une tâche « Répondre → proposer un call » apparaît dans Réponses + Mode Chasse.
2. **Planification** : chaque contact enrôlé dont l'étape est due (J0, J+4, J+10…) a son email généré depuis les templates, personnalisé (prénom, boîte, {lien_rdv}…).
3. **Envoi** : sous le **cap quotidien** (20 par défaut : démarre à 10-15), dans la **fenêtre 9h-18h**, **jours ouvrés**, avec 3 à 7 minutes entre chaque envoi. Les relances partent **dans le même fil Gmail** que le premier message (In-Reply-To) : c'est ce qui fait répondre.

### Deux modes

- **👀 Revue** (défaut) : chaque email attend ta validation dans la vue Autopilote : tu peux l'éditer, l'approuver, ou tout approuver d'un clic.
- **🚀 Auto** : envoi sans validation. À activer quand tu fais confiance aux séquences.

### Séquences fournies (modifiables, + création libre)

| Séquence | Étapes |
|---|---|
| 🔮 **Réactivation anciens clients** | J0 « On remet ça ? » → J+4 relance douce → J+12 dernière |
| 🐘 Conquête grand compte | J0 étude de cas → J+7 relance → J+21 long terme |
| 🏪 Offre packagée PME | J0 offre → J+4 rappel prix → J+14 dernière |
| 🏃 Événementiel / B2C | J0 aftermovie → J+3 urgence saison |

**Workflow gagnant** : Imports → Pennylane (anciens clients) → vue Autopilote → « 👥 Enrôler » sur Réactivation → active l'Autopilote. Les réponses tombent, tu prends les calls.

### Garde-fous intégrés

- Une réponse (même détectée à la main) **stoppe la séquence** : personne ne reçoit une relance après avoir répondu ;
- Un bounce (adresse refusée) marque l'email invalide et stoppe la séquence ;
- Un contact = **une seule séquence à la fois** ; jamais d'enrôlement sans email ; les contacts en séquence sortent de la file du Mode Chasse ;
- Cap quotidien + fenêtre horaire + jours ouvrés + espacement aléatoire : le rythme d'un humain, pas d'un robot ;
- **Délivrabilité** : tu envoies depuis ton vrai Gmail (SPF/DKIM déjà en place), à faible volume, en texte simple : la meilleure config possible. Monte le cap progressivement.
- **Cadre légal (France/RGPD)** : la réactivation de clients existants est du B2B légitime ; pour la prospection B2B à froid, reste sur des adresses professionnelles, propose toujours une porte de sortie et honore immédiatement tout « stop » (la séquence s'arrête à la moindre réponse, quelle qu'elle soit).

### Scanner ta boîte Gmail

**Imports → Gmail** : scanne le dossier « Messages envoyés » (en-têtes uniquement) et retrouve tous tes correspondants (souvent des clients oubliés) avec volume d'échanges et date du dernier contact, prêts à importer puis enrôler.

---

## 🗂️ Le Répertoire chaud · tes appels et ton WhatsApp

Le gisement le plus rentable n'est pas sur LinkedIn : ce sont les gens que tu as **déjà eus au téléphone ou sur WhatsApp** et que tu n'as jamais relancés. **Imports → Répertoire chaud** les retrouve.

**Ce que ça lit, et où.** Tout se passe **en local sur ton Mac**, en lecture seule : rien n'est envoyé sur Internet, aucun message n'est recopié dans la base.

| Source | Fichier lu | Comment l'activer |
|---|---|---|
| 📞 Appels | l'historique que ton Mac synchronise avec ton iPhone | iPhone → Réglages → Téléphone → **Appels sur d'autres appareils** → coche ton Mac |
| 💬 WhatsApp | les discussions de l'app WhatsApp pour Mac | installe **WhatsApp pour Mac** et connecte-le à ton téléphone |

**Si macOS bloque la lecture** (message « Accès complet au disque ») : Réglages Système → Confidentialité et sécurité → **Accès complet au disque** → active **Terminal**, puis relance la Chasse. Le message reste affiché à l'écran tant que ce n'est pas fait : il ne disparaît pas tout seul.

**Plans B, sans rien installer :**
- **WhatsApp** : sur ton téléphone, ouvre une discussion → tape le nom du contact en haut → **Exporter la discussion** → **Sans les médias** → envoie-toi le .txt → dépose-le dans la carte. Formats iPhone et Android, français et anglais, reconnus.
- **Appels** : un CSV exporté depuis un Android (colonnes numéro / date / durée / type).

**Comment la note sur 100 est calculée.** Elle répond à « est-ce que cette personne te connaît, et est-ce que ça sentait le travail ? » :

- **récence** du dernier échange (jusqu'à 30 points) ;
- **volume** d'appels et de messages (jusqu'à 25) ;
- **réciprocité** : il t'a rappelé ou répondu (15) ;
- **temps passé au téléphone** ensemble (jusqu'à 15) ;
- **vocabulaire de métier** : tournage, montage, séminaire… (jusqu'à 20) ;
- **preuve de négociation** : devis, budget, contrat, facture (jusqu'à 15). Ce bonus **ne se périme pas** : un « budget validé » d'il y a deux ans est un deal à relancer, pas un contact froid.

🔥 chaud ≥ 60 · 🌤️ tiède ≥ 35 · ❄️ froid en dessous. Les nouveaux contacts à partir de 45 sont pré-cochés.

**Ce qui est écarté d'office** : les numéros courts et les 08 surtaxés, les banques, colis, codes de vérification et messages automatiques, les groupes WhatsApp (un groupe n'est pas quelqu'un qu'on appelle), et les appels de moins de 8 secondes (une erreur de manip ne prouve rien).

**Rien n'entre dans le CRM sans ton clic.** Tu vois la liste triée, tu décoches ton dentiste et ta belle-sœur, tu importes le reste. Un contact déjà présent est **retrouvé par son numéro** (même écrit autrement) et enrichi au lieu d'être dupliqué. La note de relation atterrit dans ses Notes : donc dans les suggestions d'accroche du Mode Chasse.

> **Un mot sur le RGPD.** Ces personnes t'ont parlé : tu as une relation d'affaires ou un contact professionnel avéré, ce qui est la base légale de la prospection B2B en France. Ça ne vaut pas pour tes contacts privés : d'où l'étape de validation, qui est là exprès. Et toute relance doit rester une relance de pro à pro, avec un moyen de te dire stop.

---

## 🎮 La boucle de jeu

1. **🏰 Quartier général** : le boss (« 5 factures ») en barre de progression, tes 3 quêtes du jour, ta streak 🔥, tes KPI et ton XP de la semaine.
2. **🎯 Mode Chasse** : le cœur de l'outil : l'app te sert les prospects **un par un, triés par priorité** (anciens clients d'abord, relances dues, grands comptes…), avec **le bon message déjà rédigé** selon la typologie et l'étape. Toi tu n'as qu'à : copier → envoyer → cliquer « Message envoyé ». XP, combo, suite.
3. Chaque action rapporte de l'XP : message +10, réponse reçue +25, RDV +50, devis +75, **facture +250**. Les quêtes et badges tombent tout seuls.
4. Un deal marqué **« Facturée ! »** remplit un segment du boss. À 5 → 🏆.

Raccourcis clavier en Mode Chasse : `1` message envoyé · `2` connexion LinkedIn · `3` appelé · `4` a répondu · `5` RDV pris · `6` plus tard · `7` disqualifier.

## 🐘🏪🏃 Typologies de clients

| Segment | Approche | Cadence de relance |
|---|---|---|
| **Grand Compte** 🐘 | sur-mesure, preuve, cycle long | J+3 message valeur → J+7 étude de cas → J+14 → J+30 |
| **PME / Petit budget** 🏪 | offre packagée, prix direct | J+4 relance → J+10 dernière relance |
| **B2C / Événementiel** 🏃 (type Hyrox) | énergie, aftermovie, urgence saison | J+2 relance DM → J+7 fin |

L'import Pennylane **segmente automatiquement** : CA historique ≥ seuil (5 000 € par défaut, réglable) → Grand Compte. Chaque segment a ses templates (modifiables dans **Réponses → Templates**), et la prochaine relance est **planifiée automatiquement** après chaque action.

## 📦 Remplir le terrain de chasse

### Anciens clients : Pennylane
`Imports → Pennylane` : importe tous tes clients avec leur **CA facturé**, marqués « ancien client » 💰 (tes leads les plus chauds : la quête « Nécromancien » 🔮 t'attend).

### Nouveaux prospects : LinkedIn / Sales Navigator
⚠️ **Pas de scraping automatisé de LinkedIn ici** : c'est contraire aux CGU LinkedIn et ça met ton compte Sales Navigator en danger. Le workflow sûr et plus efficace :

1. Recherche ciblée dans **Sales Navigator** ;
2. Export de la liste via **l'extension Chrome FullEnrich** (ou tout autre outil d'export que tu utilises déjà) → CSV ;
3. `Imports → CSV` : mapping des colonnes **auto-détecté** (exports LinkedIn `Connections.csv`, FullEnrich, HubSpot…), doublons fusionnés automatiquement.

### Enrichissement : FullEnrich
`Imports → FullEnrich` : enrichit les contacts sans email/téléphone (cascade de fournisseurs, par lots de 100). ⚠️ consomme des crédits FullEnrich → confirmation systématique. Les résultats reviennent en quelques minutes (bouton « Vérifier », polling automatique).

### CRM hybride : HubSpot
Import des contacts HubSpot dans la Chasse, et **push** vers HubSpot (fiche contact ou sélection dans Contacts). Philosophie : **la Chasse pilote la prospection au quotidien, HubSpot reste la base « officielle »** que tu synchronises quand tu veux.

## 📄 Devis Pennylane en 2 clics

Sur une fiche contact : **➕ Devis Pennylane** → lignes (prestation, quantité, prix HT, TVA) → le devis est créé **directement dans ton Pennylane** (le client y est créé au passage si besoin), le deal est tracké ici (+75 XP), et le template « Envoi du devis » est prêt dans le composeur.

Ensuite : **🧾 Facture PL** crée la facture **en brouillon** dans Pennylane (rien n'est finalisé en compta sans ta validation là-bas), et **💰 Facturée !** remplit le boss (+250 XP 🎉). Un « Devis manuel » existe aussi pour tracker un devis fait ailleurs.

## 📥 Réponses aux demandes

`Réponses` : colle une demande entrante (mail, DM Insta, formulaire), lie-la à un contact, **✨ Générer la réponse** : via l'API Claude si tu as mis une clé dans Réglages, sinon via les templates. Copier → envoyer → « Marquer répondu » (+15 XP).

## ⚙️ Clés API (Réglages)

| Service | Où trouver la clé | Sert à |
|---|---|---|
| **Pennylane** | app.pennylane.com → Paramètres → API (scopes clients, devis, factures) | import anciens clients, création devis/factures |
| **FullEnrich** | app.fullenrich.com → Settings → API | enrichissement emails + téléphones |
| **HubSpot** | Paramètres → Intégrations → **Applications privées** (scopes `crm.objects.contacts` read + write) | import / push contacts |
| **Claude** (optionnel) | console.anthropic.com → API keys | rédaction IA des messages et réponses |

Les clés sont stockées en local (ou via un fichier `.env` : `PENNYLANE_API_KEY=…`, `FULLENRICH_API_KEY=…`, `HUBSPOT_TOKEN=…`, `ANTHROPIC_API_KEY=…`). Chaque service a un bouton **🔌 Tester**.

## 🧱 Sous le capot

- **Zéro dépendance** : Node ≥ 22.13, SQLite natif (`node:sqlite`), frontend vanilla, clients **SMTP et IMAP écrits maison** (`src/mail/`). `git clone` → `node server.js`, c'est tout.
- `server.js` : serveur HTTP + API REST (`/api/*`) + boucle Autopilote (10 min) · `src/autopilot.js` : séquences, enrôlements, file d'envoi, détection des réponses · `src/db.js` : schéma + upsert/dédoublonnage · `src/gamification.js` : XP, niveaux, quêtes, streak, badges, boss · `src/playbooks.js` : segments, cadences, templates, séquences · `src/integrations/` : Pennylane, FullEnrich, HubSpot, Claude · `src/importers/` : répertoire chaud (appels macOS, WhatsApp, scoring des relations) · `public/` : l'app.
- API Pennylane **v2** (`/api/external/v2` : `customers`, `customer_invoices`, `quotes`, `create_from_quote`) ; FullEnrich **v2** (`/api/v2/contact/enrich/bulk`, fallback v1 automatique) ; HubSpot **v3** ; Gmail en **SMTP/IMAP standard** (mot de passe d'application, aucun projet Google Cloud à créer).
- Les réponses d'API inattendues remontent **verbatim** dans l'interface pour diagnostiquer vite.
- **Tests** : `npm test` : 36 tests. Moteur Autopilote contre des serveurs SMTP/IMAP factices (envoi, threading, réponses, bounces, cap, scan), campagnes hebdo, et répertoire chaud contre de fausses bases d'appels/WhatsApp et de vrais formats d'export.

## 🗺️ Pistes pour la suite

- Aspirer le *contenu* des demandes entrantes Gmail dans l'inbox (aujourd'hui : détection + en-têtes)
- Détection automatique des factures payées via l'API Pennylane (boss auto-rempli)
- Sync HubSpot bidirectionnelle programmée
- Stats de séquences (taux d'ouverture impossible sans tracking pixel : volontairement exclu ; taux de réponse par séquence, lui, est déjà là)
- Multi-joueur (si l'équipe grandit : leaderboard)
