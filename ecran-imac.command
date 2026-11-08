#!/bin/bash
# 🧭 Le Cockpit en plein écran sur l'iMac (macOS).
#
# Double-clique : OTEA Moteur démarre si elle ne tourne pas déjà, puis le
# Cockpit s'ouvre en mode écran (plein écran, sans menu, texte lisible de
# loin). L'écran se rafraîchit tout seul et empêche le Mac de s'endormir tant
# que la page est visible.
#
# Premier lancement bloqué par Apple ? Réglages Système → Confidentialité et
# sécurité → tout en bas → « Ouvrir quand même », puis re-double-clique.
cd "$(dirname "$0")"

PORT=1337
URL="http://localhost:$PORT/?ecran=1#/cockpit"

ouvrir_cockpit() {
  if [ -d "/Applications/Google Chrome.app" ]; then
    # Chrome en « application » : pas de barre d'adresse, pas d'onglets, plein écran.
    open -na "Google Chrome" --args --app="$URL" --start-fullscreen
    echo "    Chrome s'ouvre en plein écran. Pour en sortir : Échap puis ⌘Q."
  else
    open "$URL"
    echo "    Safari s'ouvre : appuie sur ⌃⌘F (Contrôle Commande F) pour le plein écran."
  fi
}

echo ""
echo "🧭  OTEA MOTEUR : LE COCKPIT SUR L'IMAC"
echo "────────────────────────────────────────────"

if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/sante"; then
  echo "    OTEA Moteur tourne déjà."
  ouvrir_cockpit
  echo ""
  echo "    Astuce : pour que l'écran ne s'éteigne jamais, Réglages Système → Écran de"
  echo "    verrouillage → « Éteindre l'écran sur secteur » : jamais."
  echo ""
  read -r -p "Appuie sur Entrée pour fermer cette fenêtre… "
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js n'est pas installé : installe la version LTS depuis nodejs.org puis relance."
  open "https://nodejs.org/fr"
  read -r -p "Appuie sur Entrée pour fermer… "
  exit 1
fi

echo "    OTEA Moteur ne tournait pas : je la lance."
echo "    ⚠️  LAISSE CETTE FENÊTRE OUVERTE : c'est elle qui fait tourner l'app, l'Autopilote"
echo "    et le brief du matin. (Pour ne plus y penser : demarrer-toujours.command.)"
echo ""
( for i in $(seq 1 30); do sleep 0.5; curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/sante" && break; done; ouvrir_cockpit ) &
# caffeinate -d : l'écran de l'iMac reste allumé tant que l'app tourne.
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -d node --disable-warning=ExperimentalWarning server.js
else
  node --disable-warning=ExperimentalWarning server.js
fi
CODE=$?
if [ "$CODE" -ne 0 ]; then
  echo ""
  echo "OTEA Moteur s'est arrêté. Le message ci-dessus explique pourquoi."
  read -r -p "Appuie sur Entrée pour fermer cette fenêtre… "
fi
