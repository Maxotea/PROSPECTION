#!/bin/bash
# ⚔️ La Chasse : démarrage en double-clic (macOS).
# Premier lancement bloqué par Apple ? C'est normal (fichier téléchargé d'internet) :
#   Réglages Système → Confidentialité et sécurité → tout en bas → « Ouvrir quand même »,
#   puis re-double-clique. Une seule fois.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "❌ Node.js n'est pas installé sur ce Mac."
  echo "→ La page nodejs.org va s'ouvrir : clique le gros bouton vert (version LTS),"
  echo "  installe, puis double-clique à nouveau sur ce fichier."
  open "https://nodejs.org/fr"
  read -r -p "Appuie sur Entrée pour fermer… "
  exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$MAJOR" -lt 22 ] || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -lt 13 ]; }; then
  echo ""
  echo "❌ Ta version de Node.js ($(node -v)) est trop ancienne : il faut la 22.13 ou plus."
  echo "→ Installe la dernière version LTS depuis nodejs.org puis relance ce fichier."
  open "https://nodejs.org/fr"
  read -r -p "Appuie sur Entrée pour fermer… "
  exit 1
fi

( sleep 2 && open "http://localhost:1337" ) &
echo ""
echo "⚔️  La Chasse démarre… ton navigateur va s'ouvrir tout seul."
echo "⚠️  LAISSE CETTE FENÊTRE OUVERTE : c'est elle qui fait tourner l'Autopilote."
echo "    (Pour arrêter : ferme simplement cette fenêtre.)"
echo ""
node --disable-warning=ExperimentalWarning server.js
CODE=$?
if [ "$CODE" -ne 0 ]; then
  echo ""
  echo "La Chasse s'est arrêtée. Le message ci-dessus explique pourquoi."
  read -r -p "Appuie sur Entrée pour fermer cette fenêtre… "
fi
