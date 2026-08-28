#!/bin/bash
# 🌉 Relier ton Mac à La Chasse en ligne.
#
# À faire une fois. Ensuite, chaque matin, ton Mac lit tes appels et tes
# discussions WhatsApp et envoie à La Chasse les relations trouvées. Elles
# t'attendent dans Imports : rien n'entre dans le CRM sans ton clic.
#
# Ce qui part en ligne : des compteurs, les mots de travail repérés, un court
# extrait du dernier message. Jamais tes conversations.

cd "$(dirname "$0")"
DOSSIER="$(pwd)"
ETIQUETTE="com.oteaproduction.lachasse.pont"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETTE.plist"
JOURNAL="$HOME/Library/Logs/la-chasse-pont.log"
CONFIG="$DOSSIER/pont.config.json"

echo ""
echo "🌉  RELIER TON MAC À LA CHASSE EN LIGNE"
echo "────────────────────────────────────────────"
echo ""

if [ "$(uname)" != "Darwin" ]; then
  echo "❌ Ce fichier ne fonctionne que sur Mac."
  read -r -p "Appuie sur Entrée pour fermer… "
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js n'est pas installé : installe la version LTS depuis nodejs.org, puis reviens ici."
  open "https://nodejs.org/fr"
  read -r -p "Appuie sur Entrée pour fermer… "
  exit 1
fi

# ---------------------------------------------------------------- retrait
if [ -f "$PLIST" ]; then
  echo "Le pont est DÉJÀ installé."
  echo ""
  printf "Veux-tu le RETIRER ? (tape o pour oui, ou Entrée pour ne rien changer) : "
  read -r REPONSE
  if [ "$REPONSE" = "o" ] || [ "$REPONSE" = "O" ]; then
    launchctl bootout "gui/$(id -u)/$ETIQUETTE" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
    rm -f "$PLIST" "$CONFIG"
    echo ""
    echo "✅ Retiré. Ton Mac n'envoie plus rien à La Chasse."
  else
    echo ""
    echo "Rien n'a été changé."
  fi
  echo ""
  read -r -p "Appuie sur Entrée pour fermer… "
  exit 0
fi

# ---------------------------------------------------------------- réglages
echo "Deux informations à saisir."
echo ""
printf "1. L'adresse de ta Chasse en ligne (ex : https://la-chasse.onrender.com) : "
read -r URL
printf "2. Ton mot de passe (celui que tu as mis dans CODE_ACCES) : "
read -rs CODE
echo ""
echo ""

URL="${URL%/}"
if [ -z "$URL" ] || [ -z "$CODE" ]; then
  echo "❌ Il manque l'adresse ou le mot de passe. Relance ce fichier."
  read -r -p "Appuie sur Entrée pour fermer… "
  exit 1
fi

# Le mot de passe est écrit dans un fichier lisible par toi seul.
node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({ url: process.argv[2], code: process.argv[3], jours: 1095 }, null, 2));
' "$CONFIG" "$URL" "$CODE"
chmod 600 "$CONFIG"

echo "⏳ Premier envoi en cours…"
echo ""
if node --disable-warning=ExperimentalWarning pont-mac.js; then
  echo ""
else
  echo ""
  echo "⚠️  L'envoi a échoué. Le message ci-dessus dit pourquoi."
  echo "   Le pont est quand même installé : il réessaiera demain matin."
  echo ""
fi

# ---------------------------------------------------------------- automatisation
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
    <string>$(command -v node)</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>$DOSSIER/pont-mac.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$DOSSIER</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>8</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$JOURNAL</string>
  <key>StandardErrorPath</key>
  <string>$JOURNAL</string>
</dict>
</plist>
PLISTFIN

launchctl bootout "gui/$(id -u)/$ETIQUETTE" 2>/dev/null
if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null; then
  echo "✅ LE PONT EST EN PLACE."
  echo ""
  echo "   Chaque matin à 8h30, ton Mac enverra à La Chasse les nouvelles"
  echo "   relations trouvées dans tes appels et tes discussions WhatsApp."
  echo "   Tu les valides dans Imports, sur n'importe quel appareil."
  echo ""
  echo "   Ton Mac doit être allumé à ce moment-là. S'il dort, l'envoi se fait"
  echo "   au réveil suivant."
  echo ""
  echo "   Pour tout arrêter : double-clique à nouveau sur ce fichier."
else
  echo "❌ macOS a refusé d'installer l'envoi automatique."
  echo "   Tu peux quand même lancer l'envoi à la main quand tu veux,"
  echo "   en double-cliquant sur ce fichier."
  rm -f "$PLIST"
fi

echo ""
read -r -p "Appuie sur Entrée pour fermer… "
