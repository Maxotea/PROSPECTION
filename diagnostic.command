#!/bin/bash
# 🩺 La Chasse : diagnostic en double-clic.
# À lancer quand l'app ne s'ouvre pas. Ce fichier ne répare rien et ne touche à
# aucune donnée : il regarde ce qui se passe et écrit un rapport à m'envoyer.

cd "$(dirname "$0")"
RAPPORT="diagnostic-la-chasse.txt"
: > "$RAPPORT"

dire() { echo "$1"; echo "$1" >> "$RAPPORT"; }

dire ""
dire "🩺 DIAGNOSTIC DE LA CHASSE"
dire "   $(date '+%d/%m/%Y à %H:%M')"
dire "   Dossier : $(pwd)"
dire "──────────────────────────────────────────────"
dire ""

VERDICT=""

# 1. Node.js est-il là, et assez récent ?
if ! command -v node >/dev/null 2>&1; then
  dire "❌ Node.js n'est pas installé sur cet ordinateur."
  dire "   C'est le moteur qui fait tourner La Chasse."
  dire "   → Installe la version LTS depuis nodejs.org, puis relance demarrer.command."
  VERDICT="Node.js manquant"
else
  V=$(node -v)
  MAJEUR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)
  MINEUR=$(node -p "process.versions.node.split('.')[1]" 2>/dev/null)
  if [ "$MAJEUR" -lt 22 ] 2>/dev/null || { [ "$MAJEUR" -eq 22 ] 2>/dev/null && [ "$MINEUR" -lt 13 ] 2>/dev/null; }; then
    dire "❌ Node.js $V est trop ancien (il faut 22.13 ou plus)."
    dire "   → Installe la dernière version LTS depuis nodejs.org."
    VERDICT="Node.js trop ancien ($V)"
  else
    dire "✅ Node.js $V : bonne version."
  fi
fi

# 2. Les fichiers de l'app sont-ils bien là ?
MANQUANTS=""
for f in server.js public/index.html src/db.js; do
  [ -f "$f" ] || MANQUANTS="$MANQUANTS $f"
done
if [ -n "$MANQUANTS" ]; then
  dire "❌ Il manque des fichiers de l'app :$MANQUANTS"
  dire "   → Le dossier est incomplet. Retélécharge le ZIP depuis GitHub."
  [ -z "$VERDICT" ] && VERDICT="dossier incomplet"
else
  dire "✅ Les fichiers de l'app sont présents."
fi

# 3. Et tes données ?
if [ -f "data/prospection.db" ]; then
  TAILLE=$(du -h "data/prospection.db" 2>/dev/null | cut -f1)
  dire "✅ Tes données sont là : data/prospection.db ($TAILLE)."
else
  dire "ℹ️  Pas encore de fichier de données (data/prospection.db)."
  dire "   Normal si c'est un dossier tout neuf : il se crée au premier lancement."
  dire "   Si tu viens de mettre à jour, c'est que le dossier data n'a pas été copié"
  dire "   depuis l'ancien dossier. Tes contacts sont toujours dans l'ancien."
fi

# 4. Une autre fenêtre de La Chasse tourne-t-elle déjà ?
OCCUPE=""
if command -v lsof >/dev/null 2>&1; then
  OCCUPE=$(lsof -ti tcp:1337 2>/dev/null | head -1)
fi
if [ -n "$OCCUPE" ]; then
  dire "ℹ️  La Chasse tourne déjà (une autre fenêtre est ouverte)."
  dire "   → Va simplement sur http://localhost:1337"
else
  dire "ℹ️  Aucune Chasse en cours : le port 1337 est libre."
fi

# 5. Le test qui compte : est-ce que l'app démarre ?
dire ""
dire "──────────────────────────────────────────────"
dire "🚀 Test de démarrage (une dizaine de secondes)…"
dire ""

if [ -n "$OCCUPE" ]; then
  dire "   (ignoré : une Chasse tourne déjà)"
  REPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1337/ 2>/dev/null)
else
  SORTIE=$(mktemp)
  node --disable-warning=ExperimentalWarning server.js > "$SORTIE" 2>&1 &
  PID=$!
  sleep 6
  REPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1337/ 2>/dev/null)
  kill "$PID" 2>/dev/null
  wait "$PID" 2>/dev/null

  dire "   Ce que l'app a répondu au démarrage :"
  dire ""
  while IFS= read -r ligne; do dire "   | $ligne"; done < "$SORTIE"
  rm -f "$SORTIE"
  dire ""
fi

if [ "$REPONSE" = "200" ]; then
  dire "✅ L'APP DÉMARRE ET RÉPOND CORRECTEMENT."
  dire ""
  dire "   Donc si ton navigateur affiche « Ce site est inaccessible », c'est que"
  dire "   la fenêtre noire était fermée. L'app ne tourne QUE pendant que cette"
  dire "   fenêtre est ouverte : ferme-la et le site n'existe plus."
  dire ""
  dire "   → Double-clique sur demarrer.command, laisse la fenêtre noire ouverte,"
  dire "     puis va sur http://localhost:1337"
  [ -z "$VERDICT" ] && VERDICT="tout va bien, l'app doit juste être lancée"
else
  dire "❌ L'APP NE DÉMARRE PAS."
  dire "   La raison est dans les lignes qui commencent par « | » ci-dessus."
  [ -z "$VERDICT" ] && VERDICT="l'app ne démarre pas"
fi

dire ""
dire "──────────────────────────────────────────────"
dire "RÉSUMÉ : $VERDICT"
dire ""
dire "Ce rapport est enregistré dans le fichier :"
dire "   $(pwd)/$RAPPORT"
dire "Envoie-le à Claude si tu ne t'en sors pas."
dire ""

# Une copie sur le Bureau, plus facile à retrouver qu'au fond d'un dossier.
if [ -d "$HOME/Desktop" ]; then
  cp "$RAPPORT" "$HOME/Desktop/$RAPPORT" 2>/dev/null && dire "(Une copie a été mise sur ton Bureau.)"
fi

echo ""
read -r -p "Appuie sur Entrée pour fermer cette fenêtre… "
