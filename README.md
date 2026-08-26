# ⚔️ La Chasse — CRM de prospection gamifié (OTEA Production)

Un outil de prospection **local, zéro dépendance**, pensé pour un seul objectif : **déclencher 5 factures**.

Il réunit tout le workflow : import des **anciens clients Pennylane**, des listes **LinkedIn / Sales Navigator**, enrichissement **FullEnrich** (emails + téléphones), CRM par **typologies de clients**, relances automatiquement planifiées, **devis Pennylane en 2 clics**, réponses aux demandes entrantes (avec IA en option), et une couche de **gamification** complète (XP, niveaux, quêtes du jour, streak, badges, boss final) pour que prospecter devienne un jeu et plus une corvée.

---

## 🚀 Démarrage (2 minutes)

Prérequis : **Node.js ≥ 22.13** (aucun `npm install`, aucune dépendance).

```bash
git clone <ce-repo>
cd PROSPECTION
npm start          # ou : node server.js
```

➜ Ouvre **http://localhost:1337**

Pour essayer avec des données fictives : `npm run demo` (et `npm run reset` pour tout remettre à zéro).

Toutes tes données (contacts, clés API, historique) restent **sur ta machine**, dans `data/prospection.db` (gitignoré). Le serveur n'écoute que sur `127.0.0.1`.

---

## 🎮 La boucle de jeu

1. **🏰 Quartier général** — le boss (« 5 factures ») en barre de progression, tes 3 quêtes du jour, ta streak 🔥, tes KPI et ton XP de la semaine.
2. **🎯 Mode Chasse** — le cœur de l'outil : l'app te sert les prospects **un par un, triés par priorité** (anciens clients d'abord, relances dues, grands comptes…), avec **le bon message déjà rédigé** selon la typologie et l'étape. Toi tu n'as qu'à : copier → envoyer → cliquer « Message envoyé ». XP, combo, suite.
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

### Anciens clients — Pennylane
`Imports → Pennylane` : importe tous tes clients avec leur **CA facturé**, marqués « ancien client » 💰 (tes leads les plus chauds — la quête « Nécromancien » 🔮 t'attend).

### Nouveaux prospects — LinkedIn / Sales Navigator
⚠️ **Pas de scraping automatisé de LinkedIn ici** : c'est contraire aux CGU LinkedIn et ça met ton compte Sales Navigator en danger. Le workflow sûr et plus efficace :

1. Recherche ciblée dans **Sales Navigator** ;
2. Export de la liste via **l'extension Chrome FullEnrich** (ou tout autre outil d'export que tu utilises déjà) → CSV ;
3. `Imports → CSV` : mapping des colonnes **auto-détecté** (exports LinkedIn `Connections.csv`, FullEnrich, HubSpot…), doublons fusionnés automatiquement.

### Enrichissement — FullEnrich
`Imports → FullEnrich` : enrichit les contacts sans email/téléphone (cascade de fournisseurs, par lots de 100). ⚠️ consomme des crédits FullEnrich → confirmation systématique. Les résultats reviennent en quelques minutes (bouton « Vérifier », polling automatique).

### CRM hybride — HubSpot
Import des contacts HubSpot dans la Chasse, et **push** vers HubSpot (fiche contact ou sélection dans Contacts). Philosophie : **la Chasse pilote la prospection au quotidien, HubSpot reste la base « officielle »** que tu synchronises quand tu veux.

## 📄 Devis Pennylane en 2 clics

Sur une fiche contact : **➕ Devis Pennylane** → lignes (prestation, quantité, prix HT, TVA) → le devis est créé **directement dans ton Pennylane** (le client y est créé au passage si besoin), le deal est tracké ici (+75 XP), et le template « Envoi du devis » est prêt dans le composeur.

Ensuite : **🧾 Facture PL** crée la facture **en brouillon** dans Pennylane (rien n'est finalisé en compta sans ta validation là-bas), et **💰 Facturée !** remplit le boss (+250 XP 🎉). Un « Devis manuel » existe aussi pour tracker un devis fait ailleurs.

## 📥 Réponses aux demandes

`Réponses` : colle une demande entrante (mail, DM Insta, formulaire), lie-la à un contact, **✨ Générer la réponse** — via l'API Claude si tu as mis une clé dans Réglages, sinon via les templates. Copier → envoyer → « Marquer répondu » (+15 XP).

## ⚙️ Clés API (Réglages)

| Service | Où trouver la clé | Sert à |
|---|---|---|
| **Pennylane** | app.pennylane.com → Paramètres → API (scopes clients, devis, factures) | import anciens clients, création devis/factures |
| **FullEnrich** | app.fullenrich.com → Settings → API | enrichissement emails + téléphones |
| **HubSpot** | Paramètres → Intégrations → **Applications privées** (scopes `crm.objects.contacts` read + write) | import / push contacts |
| **Claude** (optionnel) | console.anthropic.com → API keys | rédaction IA des messages et réponses |

Les clés sont stockées en local (ou via un fichier `.env` : `PENNYLANE_API_KEY=…`, `FULLENRICH_API_KEY=…`, `HUBSPOT_TOKEN=…`, `ANTHROPIC_API_KEY=…`). Chaque service a un bouton **🔌 Tester**.

## 🧱 Sous le capot

- **Zéro dépendance** : Node ≥ 22.13, SQLite natif (`node:sqlite`), frontend vanilla. `git clone` → `node server.js`, c'est tout.
- `server.js` — serveur HTTP + API REST (`/api/*`) · `src/db.js` — schéma + upsert/dédoublonnage · `src/gamification.js` — XP, niveaux, quêtes, streak, badges, boss · `src/playbooks.js` — segments, cadences, templates · `src/integrations/` — Pennylane, FullEnrich, HubSpot, Claude · `public/` — l'app.
- API Pennylane **v2** (`/api/external/v2` : `customers`, `customer_invoices`, `quotes`, `create_from_quote`) ; FullEnrich **v2** (`/api/v2/contact/enrich/bulk`, fallback v1 automatique) ; HubSpot **v3**.
- Les réponses d'API inattendues remontent **verbatim** dans l'interface pour diagnostiquer vite.

## 🗺️ Pistes pour la suite

- Connexion boîte mail (Gmail) pour aspirer les demandes entrantes automatiquement
- Détection automatique des factures payées via l'API Pennylane (boss auto-rempli)
- Sync HubSpot bidirectionnelle programmée
- Multi-joueur (si l'équipe grandit : leaderboard)
