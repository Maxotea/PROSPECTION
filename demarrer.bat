@echo off
rem La Chasse - demarrage en double-clic (Windows).
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js n'est pas installe sur ce PC.
  echo La page nodejs.org va s'ouvrir : clique le gros bouton vert version LTS,
  echo installe, puis double-clique a nouveau sur ce fichier.
  start https://nodejs.org/fr
  pause
  exit /b 1
)

start "" http://localhost:1337
echo.
echo La Chasse demarre... ton navigateur va s'ouvrir tout seul.
echo LAISSE CETTE FENETRE OUVERTE : c'est elle qui fait tourner l'Autopilote.
echo (Pour arreter : ferme simplement cette fenetre.)
echo.
node --disable-warning=ExperimentalWarning server.js
pause
