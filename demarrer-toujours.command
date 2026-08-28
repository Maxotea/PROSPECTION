#!/bin/bash
# ⚙️ La Chasse : la lancer automatiquement, pour de bon.
#
# Double-clique ce fichier UNE FOIS. Ensuite La Chasse démarre toute seule à
# chaque ouverture de session, se relance si elle s'arrête, et tourne sans
# fenêtre noire à garder ouverte. C'est ce qui permet à l'Autopilote d'envoyer
# tes relances pendant que tu tournes.
#
# Pour revenir en arrière : double-clique ce même fichier, il propose de retirer
# le démarrage automatique.

cd "$(dirname "$0")"
DOSSIER="$(pwd)"
ETIQUETTE="com.oteaproduction.lachasse"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETTE.plist"
JOURNAL="$HOME/Library/Logs/la-chasse.log"

echo ""
echo "⚙️  LA CHASSE : DÉMARRAGE AUTOMATIQUE"
echo "────────────────────────────────────────────"
echo ""

if [ "$(uname)" != "Darwin" ]; then
  echo "❌ Ce fichier ne fonctionne que sur Mac."
  read -r -p "Appuie sur Entrée pour fermer… "
  exit 1
fi

# ---------------------------------------------------------------- retrait
if [ -f "$PLIST" ]; then
  echo "Le démarrage automatique est DÉJÀ installé."
  echo ""
  printf "Veux-tu le RETIRER ? (tape o pour oui, ou Entrée pour ne rien changer) : "
  read -r REPONSE
  if [ "$REPONSE" = "o" ] || [ "$REPONSE" = "O" ]; then
    launchctl bootout "gui/$(id -u)/$ETIQUETTE" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
    rm -f "$PLIST"
    echo ""
    echo "✅ Retiré. La Chasse ne démarrera plus toute seule."
    echo "   Pour la lancer : double-clique sur demarrer.command (et laisse la fenêtre ouverte)."
  else
    echo ""
    echo "Rien n'a été changé. La Chasse continue de démarrer toute seule."
    echo "→ Ton app : http://localhost:1337"
  fi
  echo ""
  read -r -p "Appuie sur Entrée pour fermer… "
  exit 0
fi

# ---------------------------------------------------------------- installation
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js n'est pas installé : installe la version LTS depuis nodejs.org, puis reviens ici."
  open "https://nodejs.org/fr"
  read -r -p "Appuie sur Entrée pour fermer… "
  exit 1
fi

# Un programme lancé au démarrage n'hérite pas de ton PATH : il faut le chemin complet.
NODE="$(command -v node)"
echo "Node.js utilisé : $NODE"
echo "Dossier de l'app : $DOSSIER"
echo ""

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLISTFIN
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$ETIQUETTE</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>$DOSSIER/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$DOSSIER</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>StandardOutPath</key>
  <string>$JOURNAL</string>
  <key>StandardErrorPath</key>
  <string>$JOURNAL</string>
</dict>
</plist>
PLISTFIN

# On repart d'un état propre au cas où une version tournerait déjà.
launchctl bootout "gui/$(id -u)/$ETIQUETTE" 2>/dev/null
: > "$JOURNAL"

if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null; then
  echo "⏳ Démarrage en cours…"
  sleep 6
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1337/ 2>/dev/null)
  if [ "$CODE" = "200" ]; then
    echo ""
    echo "✅ C'EST FAIT. La Chasse tourne, et elle tournera toujours."
    echo ""
    echo "   · Ton app : http://localhost:1337 (mets-la en favori)"
    echo "   · Elle redémarre toute seule à chaque ouverture de session."
    echo "   · Plus besoin de garder une fenêtre noire ouverte."
    echo "   · L'Autopilote peut enfin envoyer tes relances toute la journée."
    echo ""
    echo "   Pour tout arrêter : double-clique à nouveau sur ce fichier."
    open "http://localhost:1337" 2>/dev/null
  else
    echo ""
    echo "⚠️  L'installation a réussi mais l'app ne répond pas encore."
    echo "   Voici ce qu'elle a écrit :"
    echo ""
    sed 's/^/   | /' "$JOURNAL" 2>/dev/null | head -30
    echo ""
    echo "   → Double-clique sur diagnostic.command et envoie-moi le rapport."
  fi
else
  echo "❌ macOS a refusé d'installer le démarrage automatique."
  echo "   → Lance La Chasse normalement avec demarrer.command,"
  echo "     et envoie-moi le rapport de diagnostic.command."
  rm -f "$PLIST"
fi

echo ""
read -r -p "Appuie sur Entrée pour fermer… "
