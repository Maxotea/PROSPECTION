# ⚙️ OTEA Moteur · ta journée, ta prospection, ton autopilote (OTEA Production)

Un outil de travail **local, zéro dépendance**, sur une seule adresse : le matin, **☀️ Ma journée** dit quoi faire ; le reste du temps, **⚔️ la Prospection** (les prospects un par un, les campagnes, l'Autopilote, le CRM) fait rentrer les factures. Objectif : **déclencher 5 factures**.

*L'app s'appelait « La Chasse ». Elle a grandi : la chasse est devenue l'écran Prospection et le jeu, OTEA Moteur est l'ensemble. Le service en ligne garde son nom technique `la-chasse` (changer le nom d'un service Render recréerait un service sans son disque), mais tout ce que tu vois s'appelle OTEA Moteur.*

**Identité visuelle « Affût »** : papier chaud le jour, ardoise le soir (thème clair, sombre ou automatique), un seul signal fort, l'orange de chasse, réservé à l'action principale et à ce qui est vital. Le matin, Ma journée s'ouvre sur les trois choses à faire en premier. `Ctrl K` (ou `⌘K`) ouvre la palette : un écran, un contact, une action ; `?` affiche tous les raccourcis. Détail des couleurs, des polices et des règles d'usage : [`docs/design.md`](docs/design.md).

Quatre moteurs :

0. **☀️ Ma journée** : la to-do du matin, faite par la machine au lieu de la tête. Elle lit **Gmail** (les mails sans réponse), **WhatsApp** et **les appels** du Mac (les conversations où le dernier mot n'est pas de toi, les appels manqués jamais rappelés), et le **CRM** (relances dues, devis à relancer ou à faire, factures à émettre), classe chaque chose par **importance** et par **durée**, et la place dans la journée : les courtes ce matin, la grosse pierre, les moyennes cet après-midi. Le brief part par mail chaque matin.
1. **📅 Les Campagnes hebdo** : la stratégie : une semaine = un secteur (grande distribution, aéronautique, agriculture, hôtellerie, agences de voyage…) et un persona cible. Chaque campagne se crée en 2 clics avec sa **recette Sales Navigator** prête à copier, sa **séquence email** citant tes vraies références (le Galec, La Poste, Pullman…), son **post LinkedIn** et son **script DM** : pour qu'on voie OTEA partout, partout, partout.
2. **🤖 L'Autopilote** : la machine qui prospecte à ta place : elle enrôle tes contacts (anciens clients Pennylane, HubSpot, ta boîte Gmail) dans des **séquences email**, envoie depuis **ton Gmail** (chaque relance reste dans le même fil), respecte un cap quotidien et des horaires ouvrés, **détecte les réponses dans ta boîte** et stoppe la séquence dès qu'on te répond : il ne te reste qu'à transformer la réponse en call.
3. **🎮 Le CRM gamifié** : import Pennylane / LinkedIn / HubSpot, enrichissement FullEnrich, typologies de clients, Prospection, devis Pennylane en 2 clics, XP, quêtes, streak, badges, boss final « 5 factures ».

Et, au-dessus des quatre, **🧭 le Cockpit** : tout ce qui se passe en un seul écran, l'argent d'abord (à facturer, devis en attente, devis à faire, facturé ce mois), le plan et ses paliers, le facturé par mois, la journée, le radar du pipeline, les relances, et le tableau de chasse (XP, quêtes, badges, célébrations) qui fait du Cockpit un jeu. Il se rafraîchit tout seul et possède un **mode écran** pour rester affiché sur l'iMac toute la journée. Détail plus bas.

---

## 🚀 Démarrage (2 minutes)

Prérequis : **Node.js ≥ 22.13** (aucun `npm install`, aucune dépendance) : installe la version **LTS** depuis [nodejs.org](https://nodejs.org/fr) si besoin.

**Sans terminal (recommandé)** : télécharge le projet (GitHub → bouton vert **Code** → **Download ZIP** → décompresse), puis double-clique :
- sur Mac : **`demarrer.command`**. Au premier lancement, macOS bloque (« Apple n'a pas pu confirmer… ») : clique **« Terminé »** (pas « corbeille »), puis **Réglages Système → Confidentialité et sécurité → tout en bas → « Ouvrir quand même »**, et re-double-clique. C'est une seule fois. (Plan B : ouvre Terminal, tape `bash ` avec un espace, glisse le fichier dans la fenêtre, Entrée.)
- sur Windows : **`demarrer.bat`** (si « Windows a protégé votre PC » : « Informations complémentaires » → « Exécuter quand même »).

Le navigateur s'ouvre tout seul sur l'app. **Laisse la petite fenêtre noire ouverte** : c'est elle qui fait tourner l'Autopilote.

**📱 Depuis un iPad / iPhone (même Wi-Fi)** : lance **`demarrer-reseau.command`** (Mac) ou **`demarrer-reseau.bat`** (Windows) au lieu du lanceur normal. La fenêtre noire affiche l'adresse à ouvrir sur l'iPad (`http://IP-de-l'ordinateur:1337`) et un **code d'accès à 6 caractères** (demandé une fois par appareil : l'app reste verrouillée pour le reste du réseau). L'ordinateur doit rester allumé : c'est lui qui fait tourner l'app et l'Autopilote, l'iPad n'est qu'un écran. Astuce : sur l'iPad, Safari → Partager → « Sur l'écran d'accueil » pour avoir OTEA Moteur comme une app. Pour y accéder **hors de chez toi** (4G, autre lieu), installe [Tailscale](https://tailscale.com) (gratuit) sur l'ordinateur et l'iPad : même adresse, où que tu sois, sans rien exposer sur internet.

**Avec terminal** :

```bash
git clone <ce-repo>
cd PROSPECTION
npm start          # ou : node server.js
```

➜ Ouvre **http://localhost:1337**

Pour essayer avec des données fictives : `npm run demo` (et `npm run reset` pour tout remettre à zéro).

Toutes tes données (contacts, clés API, historique) restent **sur ta machine**, dans `data/prospection.db` (gitignoré). Le serveur n'écoute que sur `127.0.0.1`.

### 🧭 Le Cockpit : l'écran qui reste allumé

Le Cockpit (`#/cockpit`, ou `G` puis `K`) rassemble en un écran ce que le QG, Ma journée,
le Pipeline et l'Autopilote savent chacun de leur côté, dans l'ordre qui compte pour la
trésorerie :

1. **L'argent, en quatre tuiles** : à facturer (devis acceptés pas encore facturés, le plus
   ancien depuis combien de jours), devis en attente (et combien sont à relancer), devis à
   faire (RDV pris sans devis), facturé ce mois.
2. **Le plan** : le facturé entre deux dates face à trois paliers Moyen / Bien / Wow, avec ce
   qu'il manque pour le prochain et le temps qu'il reste. Les dates et les paliers se règlent
   dans Réglages → Cockpit ; sans réglage, c'est le trimestre en cours.
3. **Le facturé par mois** (six mois), **la journée** (les trois choses qui comptent, cliquables),
   **le radar** (chaque contact du pipeline est un point, du premier contact au centre : plus il
   est proche, plus il est près de la facture ; les chauds brillent, le balayage tourne),
   **relances et réponses**, **l'activité** des 14 derniers jours avec les segments du boss, et
   l'agenda du jour s'il est branché.
4. **Le tableau de chasse**, le jeu de la Chasse posé dans le Cockpit : niveau et barre d'XP,
   XP du jour, série de jours (la flamme), cadence du jour face au record (une jauge à aiguille),
   les trois quêtes du jour avec leur avancement et leur récompense, et la vitrine des badges
   (les gagnés en couleur, les autres en silhouette). La tuile « à facturer » dit ce que rapporte
   la facture (+100 XP et un segment du boss), les paliers du plan portent des trophées.

Chaque chiffre vient de la base : un devis, un contact, une activité. Rien n'est estimé.

Et quand quelque chose se passe, le Cockpit le fête : à chaque rafraîchissement il compare
l'état d'avant et l'état d'après. De l'XP gagnée flotte au-dessus du tableau de chasse, une
quête finie, un badge débloqué ou un devis accepté font un toast avec le bon son, une facture
émise, un niveau gagné, le boss battu, un palier du plan atteint ou la série qui passe un cap
(7, 14, 30 jours) déclenchent une grande célébration plein écran, confettis compris. Les cartes
s'inclinent légèrement sous la souris, la lunette de visée tourne dans la tuile « à facturer ».

L'écran est vivant : la lunette de visée dérive derrière les cartes et suit la souris, l'horloge
bat la seconde et son anneau se remplit jusqu'au prochain rafraîchissement, les chiffres comptent
quand ils changent, le fil des dernières actions défile en bas. Si ton appareil demande « moins
d'animations », tout se pose d'un coup et plus rien ne bouge.

**Le mode écran** (bouton en haut à droite, ou `⌘K` → « Mode écran ») enlève le menu, agrandit
tout d'un cran et demi, affiche l'heure en grand, se rafraîchit toutes les 60 secondes (réglable)
et empêche l'écran de s'endormir tant que la page est visible. `Échap` ou « Quitter le mode
écran » pour revenir à l'app. L'adresse directe : **`http://localhost:1337/?ecran=1#/cockpit`**.

**Sur l'iMac** : double-clique **`ecran-imac.command`**. Il lance OTEA Moteur si besoin et ouvre
le Cockpit en plein écran (Chrome en mode application s'il est installé, sinon Safari : `⌃⌘F`).
Pour que l'iMac ne coupe jamais l'écran : Réglages Système → Écran de verrouillage → « Éteindre
l'écran sur secteur » : jamais. Avec `demarrer-toujours.command` installé, l'app est déjà là au
réveil : il ne reste qu'à rouvrir la fenêtre du Cockpit.

**Sur le MacBook, l'iPad et l'iPhone** : la même adresse que le reste de l'app (mode réseau sur
le même Wi-Fi, Tailscale en déplacement, ou la version en ligne) suivie de `#/cockpit`. La grille
se replie seule : deux tuiles par ligne sur l'iPad, une colonne sur l'iPhone. Safari → Partager →
**Sur l'écran d'accueil** sur l'adresse `…/?ecran=1#/cockpit` donne une icône qui ouvre directement
le tableau de bord, plein écran, sans menu.

### 🧭 Le Cap : la projection business dans l'outil

Le Cap (`#/cap`, ou `G` puis `B`) remplace le plan d'action qu'on gardait dans un document :

1. **Six chiffres le lundi**, calculés depuis le CRM pour la semaine en cours : devis sous 48 h
   après un rendez-vous (avec la liste des rendez-vous qui attendent encore leur devis), devis
   envoyés depuis lundi, taux de signature sur huit semaines, couverture du pipeline face à ce
   qui manque au trimestre, recommandations reçues, facturé du mois. Chaque chiffre dit s'il est
   dans les clous. Ce que le CRM ne sait pas (solde bancaire, plancher) est marqué « à vérifier
   à la main », jamais estimé.
2. **Trois horizons de jalons à cocher** : court terme (les prochaines 24 heures, 48 heures, les
   prochains jours), moyen terme (les sept semaines de fin d'année, classées par euro encaissé),
   long terme (2027 : les outils à construire dans l'ordre, les abonnements, la capacité, la
   décision SaaS). Le plan de départ est semé une fois depuis `src/cap_plan.json` ; tu coches,
   tu ajoutes, tu retires, tout vit dans la base. Un jalon coché fait le son et les confettis de la
   quête.
3. **La trajectoire 2027** : le facturé par trimestre face à la cible du scénario choisi
   (prudent 91 800, cible 122 500, ambitieux 150 200 € HT), avec le même trimestre de 2026 en
   rappel. Le scénario se change en haut de l'écran.
4. **Les garde-fous** de la clôture mensuelle : deux sont calculés (part du premier client sur
   douze mois, devis en retard après un rendez-vous), les autres sont rappelés pour la revue.

### ☁️ Mettre OTEA Moteur en ligne (comme Make)

Une adresse à ouvrir de n'importe où, sur n'importe quel appareil, sans rien lancer :
l'app tourne sur un serveur au lieu de ton Mac.

**Ce que ça change, honnêtement :**

| | Sur ton Mac | En ligne |
|---|---|---|
| Accès | l'ordinateur doit être allumé | partout, tout le temps |
| Autopilote | tourne quand l'app est ouverte | tourne 24 h/24 |
| Tes données | uniquement chez toi | sur le serveur de l'hébergeur |
| Coût | rien | quelques euros par mois |
| Répertoire chaud (appels, WhatsApp) | lecture automatique | seulement par dépôt de fichier |

Le dernier point est le seul vrai renoncement : lire l'historique d'appels et les
discussions WhatsApp suppose d'être **sur** ton Mac. En ligne, il reste l'import
d'une conversation exportée en .txt et le CSV d'appels, qui marchent depuis l'iPad.

**Déploiement sur Render** (le dépôt contient déjà `Dockerfile` et `render.yaml`) :

1. Crée un compte sur [render.com](https://render.com) et connecte ton GitHub.
2. **New → Blueprint**, choisis ce dépôt : Render lit `render.yaml` et prépare tout.
3. Il demande la variable **CODE_ACCES** : mets un vrai mot de passe, 12 caractères
   ou plus. C'est lui qui protège ton CRM du reste d'internet.
4. Valide. Quelques minutes plus tard tu as une adresse en `.onrender.com`.
5. Ouvre-la sur ton iPad, Safari → Partager → **Sur l'écran d'accueil**. Tu as une icône
   comme une vraie app.

Le disque persistant (1 Go, facturé [$0.25/Go/mois](https://render.com/pricing)) garde ta
base entre les mises à jour. Un service gratuit ne peut pas avoir de disque : il faut une
offre payante, sinon tes contacts disparaissent à chaque redéploiement.

Le `Dockerfile` fonctionne pareil sur Railway, Fly.io ou un petit serveur privé, avec
les mêmes variables : `CODE_ACCES`, `DATA_DIR=/data`, `EN_LIGNE=1`.

**Sécurité de la version en ligne :** mot de passe obligatoire (l'app refuse de démarrer
sans, ou avec moins de 8 caractères), cookie qui ne contient jamais le mot de passe,
connexion chiffrée exigée, et pause de 15 minutes après 5 essais ratés. Le navigateur
reçoit aussi la consigne de ne charger que les fichiers d'OTEA Moteur lui-même (aucun
script extérieur, impossible d'encadrer l'app dans un autre site).

**Déménager tes données du Mac vers la version en ligne :**

1. Sur ton OTEA Moteur actuel : Réglages → **Télécharger ma sauvegarde**.
2. Sur la version en ligne : Réglages → **Remettre une sauvegarde**, choisis le fichier.
3. Elle remplace tout et redémarre, la page se recharge seule. Tes contacts, ton
   historique, ton XP et tes réglages sont là.

L'ancienne base est mise de côté (`prospection.db.avant-restauration`) avant d'être
remplacée, et un fichier qui n'est pas une sauvegarde d'OTEA Moteur est refusé sans rien
toucher.

**Sauvegarde régulière :** le même bouton, de temps en temps. Un hébergeur peut perdre
un disque, pas toi.

### 🌉 Garder WhatsApp et les appels branchés quand l'app est en ligne

**OTEA Moteur ne se connecte pas à WhatsApp, et ne le peut pas.** Il n'existe aucune
connexion officielle donnant accès à tes conversations personnelles : l'API WhatsApp
Business sert à écrire à des clients qui ont donné leur accord, elle ne lit pas ton
historique. Les bibliothèques qui se font passer pour un appareil lié existent, mais
elles violent les conditions de WhatsApp et font bannir des numéros. Ton numéro est ta
ligne professionnelle : on n'y touche pas.

Ce que l'app fait à la place : elle **lit les fichiers de l'app WhatsApp installée sur
ton Mac**, en lecture seule. Pas de connexion, donc rien à maintenir connecté. Il suffit
que WhatsApp pour Mac reste ouvert et lié à ton téléphone, comme d'habitude.

Quand OTEA Moteur est hébergé en ligne, il n'a plus accès à ces fichiers. D'où le pont :

1. Double-clique **`pont-mac.command`** sur ton Mac, une seule fois.
2. Il demande l'adresse de ton OTEA Moteur en ligne et ton mot de passe.
3. Chaque matin à 8h30, ton Mac lit tes appels et tes discussions, et **envoie
   seulement le résultat** : des compteurs, les mots de travail repérés, un court
   extrait du dernier message. Jamais tes conversations.
4. Les relations trouvées t'attendent dans **Imports**, sur n'importe quel appareil.
   Rien n'entre dans le CRM sans ton clic, comme toujours.

Le Mac doit être allumé à ce moment-là. S'il dort, l'envoi se fait au réveil suivant.
Pour tout arrêter : double-clique à nouveau sur le même fichier.

### ♾️ Ne plus jamais avoir à la lancer

Double-clique **une fois** sur `demarrer-toujours.command`. OTEA Moteur démarre alors
toute seule à chaque ouverture de session, se relance si elle s'arrête, et tourne sans
fenêtre noire à garder ouverte. C'est aussi ce qui permet à **l'Autopilote d'envoyer tes
relances toute la journée** : sans ça, il ne tourne que pendant que la fenêtre est ouverte.

Pour revenir en arrière, double-clique à nouveau sur le même fichier : il propose de
retirer le démarrage automatique.

### 🩺 Quand ça ne s'ouvre pas

**« Ce site est inaccessible » / ERR_CONNECTION_REFUSED dans le navigateur** veut dire
une seule chose : l'app ne tourne pas. Le navigateur n'est qu'une fenêtre ouverte sur
lui. **OTEA Moteur ne tourne que pendant que la fenêtre noire est ouverte** : si tu la
fermes (ou si tu redémarres le Mac), l'adresse ne répond plus tant que tu n'as pas
relancé `demarrer.command`.

Si le relancement ne suffit pas, **double-clique sur `diagnostic.command`**. Il ne
répare rien et ne touche à aucune donnée : il vérifie Node, les fichiers, ta base, le
port, essaie de démarrer l'app, et écrit un rapport lisible (une copie est déposée sur
ton Bureau) à envoyer tel quel.

### 🧩 Fusionner deux OTEA Moteur en un seul

Le cas classique : l'app a tourné sur le Mac **et** en ligne pendant des semaines, chacune avec
ses contacts, son XP, ses réglages. « Remettre une sauvegarde » écraserait l'une des deux.
**Fusionner** les additionne :

1. Sur la version que tu veux abandonner : Réglages → **Télécharger ma sauvegarde**.
2. Sur la version que tu gardes (en ligne, en général) : Réglages → **Fusionner avec une autre
   base**, choisis le fichier. L'app lit d'abord l'autre base et t'annonce ce qui va se passer
   (« 112 contacts ajoutés, 38 rapprochés, 540 actions d'historique… »). Tu confirmes.
3. Ce qui se passe : un contact connu des deux côtés (même email, même LinkedIn, même client
   Pennylane, ou même nom dans la même société) devient une seule fiche, l'étape la plus
   avancée l'emporte, les champs vides d'ici prennent la valeur de là-bas, les notes se
   cumulent. L'historique, les devis, l'XP, les badges et les quêtes s'additionnent sans
   doublon. Les réglages déjà remplis ici restent, les vides sont repris. Les emails encore en
   attente là-bas arrivent « à relire », jamais prêts à partir.
4. Rien n'est effacé de ce côté-ci, et la base d'ici est mise de côté avant (`.avant-fusion`).

### 🔄 Mettre à jour sans perdre tes données

Tes contacts, tes clés API et ton historique vivent dans le dossier **`data/`** : jamais dans le code. Donc pour passer à une nouvelle version :

1. Ferme la fenêtre noire (ça arrête l'app).
2. Télécharge le nouveau ZIP (GitHub → **Code** → **Download ZIP**) et décompresse-le. Tu as maintenant deux dossiers côte à côte.
3. **Glisse le dossier `data` de l'ANCIEN dossier dans le NOUVEAU.** C'est l'étape qui préserve tout : contacts, réglages Gmail, XP, campagnes.
4. Double-clique `demarrer.command` dans le **nouveau** dossier. Tu retrouves l'app exactement où tu l'avais laissée, avec les nouveautés en plus.
5. Une fois que tout va bien, tu peux jeter l'ancien dossier.

> Le blocage macOS (« Apple n'a pas pu confirmer… ») revient à chaque nouveau dossier : même manip que la première fois, **Réglages Système → Confidentialité et sécurité → « Ouvrir quand même »**.

---

## ☀️ Ma journée : la to-do du matin, lue dans tes boîtes

C'est la page d'accueil. Avant, la liste du matin se faisait de tête, classée par
importance et par durée, et il en manquait toujours une : le mail qu'on voulait
envoyer, le devis promis au téléphone, le montage qu'on repousse. Maintenant la
liste se fait toute seule, à partir de ce qui se passe vraiment.

**Ce qu'elle lit** (et relit toutes les 15 minutes tant que l'app tourne) :

| Source | Ce qui devient une chose à faire |
|---|---|
| 📧 **Gmail** (onglet Principale) | un mail reçu, d'un humain, auquel tu n'as pas répondu (ni depuis Gmail, ni depuis l'app, ni en lui écrivant depuis) |
| 💬 **WhatsApp** (Mac) | une conversation où le dernier message n'est pas de toi |
| 📞 **Appels** (Mac) | un appel manqué d'une personne que tu connais, jamais rappelé |
| 🗓️ **Google Agenda** | une prod colorée urgent ou très urgent dans les jours qui viennent, un titre qui dit tournage, livraison, rendu, deadline… |
| 🗂️ **CRM** | relance arrivée à échéance (un contact chaud a sa ligne ; au-delà de trois prospects froids en retard, ils tiennent sur une seule ligne « Relances de prospection »), devis envoyé sans nouvelle depuis N jours, devis accepté pas facturé, RDV pris sans devis, demande entrante pas traitée (une réponse automatique n'en est pas une, un contact qui a écrit n'est pas relancé en plus, une demande à laquelle tu as répondu depuis Gmail sort toute seule de la liste, et au-delà de trois semaines les vieilles demandes tiennent sur une ligne « à répondre ou classer »), emails de l'Autopilote à valider, post de campagne pas publié, session d'appels du jour |
| 🧠 **Ton cerveau** | ce que tu tapes dans le vide-cerveau, en une ligne |

Sur téléphone ou en ligne, WhatsApp et les appels passent par le pont du Mac
(`pont-mac.command`), comme pour le répertoire chaud : le Mac lit, envoie le
résultat, rien de plus.

**Comment elle classe.** Chaque chose reçoit une importance (🔴 vitale, 🟠
importante, 🟢 normale) et une durée (⚡ court, 15 min ou moins ; 🧱 moyen ;
🏔️ long, plus d'1h30). L'argent pèse lourd : un devis, une facture, un mot comme
« budget » ou « acompte » dans un objet de mail montent d'un cran. Un mail sans
réponse depuis deux jours aussi. Puis chaque chose prend sa place, exactement
comme avant :

- **⚡ Ce matin** : toutes les courtes, les plus importantes d'abord (douze au plus).
- **🏔️ La grosse pierre** : une ou deux longues et importantes. Bloque le créneau.
- **🧱 Cet après-midi** : les moyennes.
- **💤 Peut attendre** : ni urgent ni vital.

**Le vide-cerveau.** Une ligne suffit : `monter la vidéo du Loft 3h !! avant le 12/09`.
Un `!` rend la chose importante, `!!` vitale ; `2h`, `1h30`, `30 min` donnent
la durée ; `demain`, `vendredi`, `avant le 12/09` l'échéance. Sans indication,
l'app devine à partir des mots (montage, tournage = long ; devis, réunion,
stories = moyen ; mail, appel, relance = court) et tu corriges d'un clic.

**Sur chaque ligne** : ✅ fait, ⏰ plus tard (demain, lundi, dans une semaine…),
🙈 ignorer. Ce que tu décides ne revient pas le lendemain ; un nouveau message de
la même personne, si. Un « fait » sur une relance compte comme une relance dans
le jeu (XP, prochaine relance programmée). Pour un mail, **✨ Rédiger la réponse**
lit le message, propose un brouillon (IA si tu as une clé, template sinon), et
**📤 Envoyer depuis mon Gmail** répond dans le même fil. Rien ne part sans ton clic.

**Le brief du matin.** À l'heure choisie dans Réglages (8h par défaut), l'app
calcule la journée et te l'envoie par mail, à toi-même, depuis ton Gmail :
« 9 choses à faire, dont 3 vitales, 4 800 € en jeu. Ce matin (≈ 1h10) :
répondre à Claire, rappeler Le Loft… La grosse pierre : monter la vidéo du
Loft (≈ 3h). » Le bouton **📨 Le brief** l'affiche et le renvoie à la demande.

Deux conditions pour qu'il arrive à l'heure : **l'app doit tourner à ce moment-là**
(sur Mac, `demarrer-toujours.command` la garde allumée ; sinon le brief part dès
que tu la lances, et un Mac endormi l'envoie au réveil), et Gmail doit être
branché dans Réglages. Si le mail ne part pas, la page le dit sous le radar, et
l'app réessaie toutes les 5 minutes. L'app vit à l'heure de Paris, même hébergée
chez Render.

### 🗓️ Google Agenda : lire ta journée, y poser tes tâches, colorer l'urgence

L'agenda est le deuxième œil du matin : les prods, les RDV, et les couleurs que
tu leur donnes déjà. Branché, il fait trois choses.

1. **Il lit.** Le fil d'aujourd'hui s'affiche sous le radar, avec les trous entre
   les rendez-vous. Sur les jours qui viennent (7 par défaut), une prod colorée
   « urgent » ou « très urgent », ou un événement dont le titre dit *tournage,
   livraison, rendu, deadline, montage…*, devient une chose à préparer dans la
   liste, avec son importance. Un titre qui dit déjà l'action (« Envoyer le devis
   Galec ») reste tel quel. Un rappel qui revient chaque jour (« Vérifier PPT BNI »)
   reste dans l'agenda, pas dans la liste. Le brief ajoute une ligne **📆 Cette
   semaine** : les prods et l'important des sept prochains jours.
2. **Il pose.** Sur chaque ligne, **📅 Caler** propose les créneaux libres du jour ;
   **🗓️ Caler ma journée** fait tout d'un coup : les courtes au plus tôt, la grosse
   pierre dans le plus grand trou, les moyennes ensuite. Chaque tâche devient un
   événement dans ton agenda, de la couleur de son urgence. Ce qui ne rentre pas
   est dit, pas forcé.
3. **Il classe.** Sur chaque événement du jour, cinq ronds : 🔴 très urgent,
   🟠 urgent, 🟡 moyen, 🟢 pas urgent, ⚪ juste une info. Un clic change la couleur
   de l'événement **dans Google Agenda**. Le sens de chaque couleur se règle dans
   Réglages (par défaut : Tomate = très urgent, Mandarine et Flamant rose = urgent,
   Banane = moyen, Basilic et Sauge = pas urgent, le reste = info) : si tu as déjà
   ton code couleur, dis-le à l'app une fois, elle le respecte.

**Brancher, en 3 minutes et sans projet Google Cloud.** Réglages → Google Agenda
donne un petit script à coller sur [script.google.com](https://script.google.com)
(ton secret est déjà dedans), à déployer en « Application web » exécutée en tant
que toi et accessible à « Tout le monde ». Ce « tout le monde » ne voit rien :
sans le secret, le script répond « Mauvais secret ». Colle l'URL en `/exec`,
teste, choisis les agendas à lire et celui où poser tes tâches.

## 📅 Les Campagnes hebdo : une semaine, un secteur, tes références partout

Le rythme : **chaque lundi, un nouveau terrain de chasse.** Semaine 1 la grande distribution (responsables communication interne : tu as le Galec en référence), semaine 2 l'aéronautique, puis l'agriculture, les hôtels (Pullman !), les agences de voyage, les collectivités (Puteaux)…

**Créer la semaine = 2 clics** (vue Campagnes → choisir le secteur → la date) et tu obtiens :

- 🧲 **La recette Sales Navigator** : filtres exacts à reproduire (intitulés de poste, secteur, effectif, région + astuce de ciblage), à exporter ensuite via l'extension FullEnrich → CSV → bouton « Importer le CSV de la campagne » ;
- 📧 **La séquence email dédiée** (J0 → J+4 → J+10) : rédigée pour le secteur, citant **tes références réelles** (« ce qu'on a fait pour le Galec »), envoyée par l'Autopilote, stoppée à la première réponse ;
- 📣 **Le post LinkedIn de la semaine** (hook, références, CTA en DM) + **le script DM** pour les prospects sans email : c'est le « partout » : email + DM + contenu en même temps sur le même secteur ;
- ✅ **La checklist de la semaine** avec stats en direct : sourcé → enrichi → enrôlé → posté → réponses/RDV/devis.

**Tes références** vivent dans la vue Campagnes (⭐) : chacune est éditable, et celles issues de la dictée vocale sont marquées **⚠️ à vérifier** (Madiness, Thorigny, Jessica Bataille, RAJA, RAIFF…) : corrige l'orthographe une fois, tous les futurs kits l'utilisent. Le bouton **✨ Régénérer le kit** réécrit emails/post/DM avec l'IA (clé Claude requise) en ne citant QUE tes références réelles.

10 secteurs pré-configurés : grande distribution, aéronautique, agriculture & agro, hôtellerie, agences de voyage & tourisme, collectivités & villes, influence & médias, immobilier & architecture, corporate & industrie, sport & événementiel.

### 🏋️ Les projets longs : même machine, autre durée

Certaines chasses ne tiennent pas en une semaine : chercher des sponsors pour deux athlètes, monter un partenariat, remplir un événement. Dans la vue Campagnes, le menu propose donc aussi des **projets longs** : un projet se crée comme une semaine thématique (fiches rattachées, séquence email, post, DM, checklist, recette Sales Navigator) mais il reste **en cours jusqu'à sa date de fin** au lieu de sept jours. Il garde sa place dans le menu d'import CSV et dans la carte « Campagne » de Ma journée tant qu'il court, et la semaine thématique en cours passe devant lui quand il y en a une.

Premier projet livré : **Sponsoring HYROX · Pierre & Antoine** (jusqu'au 13 juin 2027, fin du championnat du monde à Hong Kong). Il s'ouvre **tout seul au premier démarrage** qui suit la mise à jour, avec ses 46 fiches rattachées (le fichier `src/projets/sponsoring_hyrox.json`, 36 emails vérifiés par FullEnrich) : rien à importer. Ça n'arrive qu'une fois par base (réglage `projet_seed_sponsoring_hyrox`) : un projet supprimé à la main ne revient pas. Son kit n'est pas le gabarit « vente de vidéo » : les trois emails, le post et le DM sont écrits pour chercher des partenaires (qui sont les athlètes, ce que la marque gagne, ce qu'on lui demande), avec une cadence plus lente (J0 → J+5 → J+12) parce qu'un responsable sponsoring répond moins vite qu'un dircom. Le bouton ✨ Régénérer le kit reçoit lui aussi un brief « sponsoring », pas un brief « vidéo ». Les fiches à rattacher (marques, montres, nutrition, récupération, distribution, employeur, ville) arrivent par l'import CSV habituel, avec le projet sélectionné dans le menu « Campagne ».

## 🤖 L'Autopilote : la machine qui prospecte à ta place

### Brancher ton Gmail (2 minutes, sans projet Google Cloud)

1. Active la **validation en 2 étapes** sur ton compte Google ;
2. Va sur [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → crée un mot de passe d'application « OTEA Moteur » ;
3. Colle-le dans **Réglages → Gmail & Autopilote** avec ton adresse → **Tester SMTP** + **Tester IMAP** → « 📤 M'envoyer un email de test ».

### La boucle (toutes les 10 minutes quand l'Autopilote est actif)

1. **Détection des réponses** : lecture des *en-têtes* (jamais les contenus) des nouveaux emails de ta boîte. Si un prospect en séquence a répondu → séquence **stoppée**, +25 XP, contact passé « En discussion », et une tâche « Répondre → proposer un call » apparaît dans Réponses + Mode Chasse.
2. **Planification** : chaque contact enrôlé dont l'étape est due (J0, J+4, J+10…) a son email généré depuis les templates, personnalisé (prénom, boîte, {lien_rdv}…).
3. **Envoi** : sous le **cap quotidien** (20 par défaut : démarre à 10-15), dans la **fenêtre 9h-18h**, **jours ouvrés**, avec 3 à 7 minutes entre chaque envoi. Les relances partent **dans le même fil Gmail** que le premier message (In-Reply-To) : c'est ce qui fait répondre.

### Deux modes

- **👀 Revue** (défaut) : chaque email attend ta validation dans la vue Autopilote : tu peux l'éditer, l'approuver, ou tout approuver d'un clic. Le bouton **« Un par un »** passe les emails en revue l'un après l'autre, en grand, avec les décisions sous le pouce : c'est la façon de valider depuis l'iPhone, dans le train.
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
- Un contact = **une seule séquence à la fois** ; jamais d'enrôlement sans email ; les contacts en séquence sortent de la file de la Prospection ;
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

**Si macOS bloque la lecture** (message « Accès complet au disque ») : Réglages Système → Confidentialité et sécurité → **Accès complet au disque** → active **Terminal**, puis relance OTEA Moteur. Le message reste affiché à l'écran tant que ce n'est pas fait : il ne disparaît pas tout seul.

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

## 📱 Sur téléphone, iPad et Mac

La même app s'adapte à l'écran. Sur téléphone, la navigation passe **en bas**, à portée
de pouce, avec des libellés courts. Les textes grandissent, les champs passent à 16 px
(en dessous, Safari zoome tout seul dès qu'on tape), et les boutons font au moins 44 px
de haut. Les tableaux et le kanban défilent dans leur propre cadre : la page, elle, ne
part jamais de travers. La liste des contacts, elle, se présente en cartes (nom, typologie,
étape, prochaine action) plutôt qu'en tableau à sept colonnes, et la barre du bas
s'estompe sur la droite tant qu'il reste des onglets à faire défiler.

Au clavier : `Échap` ferme la fiche contact ou la fenêtre ouverte, et `Tab` montre
toujours où l'on est. Le réglage système « réduire les animations » coupe les confettis
et les glissements.

## 🧭 Pilotage : la revue de la semaine

L'argent d'OTEA en un écran, à ouvrir le vendredi (CEO Day).

- **🔄 Lire Pennylane** : récupère les factures et les devis. Une facture vue « payée » au passage suivant est encaissée ce jour-là.
- **Facturé et encaissé restent séparés** : facturé ce mois (HT et TTC, et l'écart avec le mois d'avant), encaissé ce mois, reste à encaisser, retards en jours.
- **Devis et propales** : ceux de Pennylane et ceux du pipeline, leur âge, ceux qui expirent, les acceptés pas encore facturés.
- **Points d'attention** : des phrases dans l'ordre où s'en occuper (« Relance d'abord Raja, 7 jours de retard »).
- Les échéances de la semaine, les relances prospects dues, l'état des clients suivis.
- **📋 Copier la revue** : la même chose en texte, à coller où tu veux.
- **➕ Pièce à la main** : une facture ou un devis qui n'est pas dans Pennylane.

## 📈 Résultats clients : le tableau de bord promis aux clients

Pour Off Golf et les suivants : du chiffre, mois par mois.

1. **➕ Nouveau client suivi** : nom, modèle (lieu de loisirs, commerce, vierge), accompagnement mensuel, budget pub, panier moyen d'une réservation.
2. **Le point de départ** : clique sur chaque indicateur et saisis sa valeur d'avant OTEA (réservations par mois, demandes séminaire, CA...).
3. **✍️ Saisir un mois** : l'objectif et le réel de chaque indicateur. Les objectifs des mois suivants peuvent se poser d'avance.
4. L'écran calcule tout seul : CA généré, investi (accompagnement + pub), **ROI**, ce que rapporte chaque euro, **coût par réservation**, réservations en plus par rapport à avant. Sans CA saisi, il l'estime (réservations × panier moyen) et le dit.
5. **📨 Rapport du mois** : le texte prêt à coller dans le mail au client.

## 🎮 La boucle de jeu

1. **🏰 Quartier général** : le boss (« 5 factures ») en barre de progression, tes 3 quêtes du jour, ta streak 🔥, tes KPI et ton XP de la semaine.
2. **🎯 Prospection** : le cœur de l'outil : l'app te sert les prospects **un par un, triés par priorité** (anciens clients d'abord, relances dues, grands comptes…), avec **le bon message déjà rédigé** selon la typologie et l'étape. Toi tu n'as qu'à : copier → envoyer → cliquer « Message envoyé ». XP, combo, suite.
3. Chaque action rapporte de l'XP : message +10, réponse reçue +25, RDV +50, devis +75, **facture +250**. Les quêtes et badges tombent tout seuls.
4. Un deal marqué **« Facturée ! »** remplit un segment du boss. À 5 → 🏆.

Raccourcis clavier dans la Prospection : `1` message envoyé · `2` connexion LinkedIn · `3` appelé · `4` a répondu · `5` RDV pris · `6` pas maintenant · `7` disqualifier.

### Pourquoi la liste ne te ressert pas toujours les mêmes têtes

Trois règles empêchent la file du jour de tourner en rond :

- **« Mettre de côté »** (vue Contacts, sélection puis bouton 📦) : les contacts choisis sortent de la chasse et du brief sans être supprimés. Le filtre « mis de côté » les retrouve, « Reprendre dans la chasse » les ramène, et le geste s'annule. La case « Tout sélectionner » propose de prendre tous les contacts du filtre, pas seulement la page.
- **« Pas maintenant » repousse loin** : un mois et demi (45 jours) au premier report, puis trois mois, puis six. Un contact mis de côté ne revient pas à la session suivante.
  Passer quelqu'un une fois ne le ramène pas dès le lendemain.
- **Un prospect froid relancé sans réponse redescend** dans le classement : jusqu'à
  40 points de moins après cinq tentatives. Un devis ou un RDV en cours, lui, ne perd
  rien : là, les relances sont un bon signe.
- **La moitié des places est réservée à des gens jamais présentés.** Sinon les
  relances dues mangent toute la liste chaque matin et un fichier de 200 prospects se
  travaille par les 20 mêmes.

Et une fois la cadence du segment épuisée, les relances s'espacent (14, 30, 60, 90 jours)
au lieu de repartir en boucle, puis le contact passe en veille.

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
`Imports → FullEnrich` : enrichit les contacts sans email/téléphone (cascade de fournisseurs, par lots de 100). ⚠️ consomme des crédits FullEnrich → confirmation systématique.

L'enrichissement est asynchrone : FullEnrich met quelques minutes. **Le serveur va chercher les résultats tout seul, toutes les deux minutes, même si tu as fermé l'app.** Le bouton « Vérifier » de la vue Imports force juste un passage immédiat. Quand un lot revient sans rien, l'app te le dit au lieu de faire la fête : c'est en général qu'il manque l'entreprise ou l'URL LinkedIn sur les fiches envoyées.

Les résultats sont rattachés à leur fiche par l'identifiant renvoyé, sinon par l'URL LinkedIn, sinon par le nom, sinon par la position dans le lot. Et rien n'est jamais écrasé : l'enrichissement ne remplit que les cases vides.

Pour être enrichissable, une fiche a besoin, comme le demande FullEnrich, d'une URL LinkedIn, ou bien d'un prénom, d'un nom et d'une entreprise (nom ou site web). Les fiches sélectionnées qui ne remplissent pas cette règle restent de côté et l'app dit combien. La liste part sous la clé `data` (API v2) : l'ancienne clé `datas` de la v1 faisait répondre « data is empty » même avec des contacts sélectionnés. Une fiche à laquelle il manque le site n'est plus envoyée avec un champ vide (FullEnrich refusait alors tout le lot des 100 avec « domain cannot be empty ») : le champ est simplement omis. Et quand FullEnrich refuse quelque chose, l'app le dit en français avec quoi faire, au lieu d'afficher le code HTTP.

### CRM hybride : HubSpot
Import des contacts HubSpot dans OTEA Moteur, et **push** vers HubSpot (fiche contact ou sélection dans Contacts). Philosophie : **OTEA Moteur pilote la prospection au quotidien, HubSpot reste la base « officielle »** que tu synchronises quand tu veux.

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
| **Claude** (optionnel) | console.anthropic.com → API keys | rédaction IA des messages et réponses. La clé seule ne suffit pas : le compte doit avoir du crédit prépayé (console.anthropic.com → Plans & Billing), sinon chaque demande est refusée. Sans clé, tout retombe sur les templates. |

Les clés sont stockées en local (ou via un fichier `.env` : `PENNYLANE_API_KEY=…`, `FULLENRICH_API_KEY=…`, `HUBSPOT_TOKEN=…`, `ANTHROPIC_API_KEY=…`). Chaque service a un bouton **🔌 Tester**.

## 🧱 Sous le capot

- **Zéro dépendance** : Node ≥ 22.13, SQLite natif (`node:sqlite`), frontend vanilla, clients **SMTP et IMAP écrits maison** (`src/mail/`). `git clone` → `node server.js`, c'est tout.
- `server.js` : serveur HTTP + API REST (`/api/*`) + boucle Autopilote (10 min) + radar de la journée (5 min) + relève des enrichissements FullEnrich (2 min) · `src/journee.js` : Ma journée (signaux Gmail / WhatsApp / appels / agenda / CRM, classement, placement, brief) · `src/integrations/agenda.js` + `agenda.gs` : Google Agenda via un script Apps Script sur le compte de Maxime (lecture, créneaux libres, pose des tâches, couleurs d'urgence) · `src/autopilot.js` : séquences, enrôlements, file d'envoi, détection des réponses · `src/db.js` : schéma + upsert/dédoublonnage · `src/gamification.js` : XP, niveaux, quêtes, streak, badges, boss · `src/playbooks.js` : segments, cadences, templates, séquences · `src/integrations/` : Pennylane, FullEnrich, HubSpot, Claude · `src/importers/` : répertoire chaud (appels macOS, WhatsApp, scoring des relations) · `public/` : l'app.
- API Pennylane **v2** (`/api/external/v2` : `customers`, `customer_invoices`, `quotes`, `create_from_quote`) ; FullEnrich **v2** (`/api/v2/contact/enrich/bulk`, fallback v1 automatique) ; HubSpot **v3** ; Gmail en **SMTP/IMAP standard** (mot de passe d'application, aucun projet Google Cloud à créer).
- Les réponses d'API inattendues remontent **verbatim** dans l'interface pour diagnostiquer vite.
- **Tests** : `npm test` : 165 tests. Pilotage (facturé et encaissé séparés, lecture des factures Pennylane, points d'attention) et Résultats clients (ROI, coût par réservation, CA estimé, rapport mensuel), Ma journée (analyse du vide-cerveau, placement, signaux CRM / Gmail / WhatsApp / appels contre un IMAP factice, décisions, brief), moteur Autopilote contre des serveurs SMTP/IMAP factices (envoi, threading, réponses, bounces, cap, scan), campagnes hebdo, et répertoire chaud contre de fausses bases d'appels/WhatsApp et de vrais formats d'export.

## 🗺️ Pistes pour la suite

- Aspirer le *contenu* des demandes entrantes Gmail dans l'inbox (aujourd'hui : détection + en-têtes)
- Détection automatique des factures payées via l'API Pennylane (boss auto-rempli)
- Sync HubSpot bidirectionnelle programmée
- Stats de séquences (taux d'ouverture impossible sans tracking pixel : volontairement exclu ; taux de réponse par séquence, lui, est déjà là)
- Multi-joueur (si l'équipe grandit : leaderboard)
