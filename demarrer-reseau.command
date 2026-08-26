#!/bin/bash
# ⚔️ La Chasse — MODE RÉSEAU (macOS) : accessible depuis ton iPad/iPhone sur le même Wi-Fi.
# Premier lancement bloqué par Apple ? Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js n'est pas installé — installe la version LTS depuis nodejs.org puis relance."
  open "https://nodejs.org/fr"
  read -r -p "Appuie sur Entrée pour fermer… "
  exit 1
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo ""
echo "⚔️  La Chasse — MODE RÉSEAU"
echo "    Ton iPad/iPhone doit être sur LE MÊME Wi-Fi que ce Mac."
[ -n "$IP" ] && echo "    ➜ Sur l'iPad, ouvre Safari et va sur :  http://$IP:1337"
echo "    Le CODE D'ACCÈS s'affiche juste en dessous — saisis-le sur l'iPad (une fois par appareil)."
echo "    ⚠️  LAISSE CETTE FENÊTRE OUVERTE : c'est ce Mac qui fait tourner l'app et l'Autopilote."
echo ""
HOST=0.0.0.0 node --disable-warning=ExperimentalWarning server.js
