@echo off
rem La Chasse - MODE RESEAU (Windows) : accessible depuis iPad/telephone sur le meme Wi-Fi.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe - installe la version LTS depuis nodejs.org puis relance.
  start https://nodejs.org/fr
  pause
  exit /b 1
)

echo.
echo La Chasse - MODE RESEAU
echo Ton iPad/telephone doit etre sur LE MEME Wi-Fi que ce PC.
echo L'adresse a ouvrir sur l'iPad s'affiche au demarrage ci-dessous (http://...:1337),
echo ainsi que le CODE D'ACCES a saisir (une fois par appareil).
echo LAISSE CETTE FENETRE OUVERTE : c'est ce PC qui fait tourner l'app et l'Autopilote.
echo.
set HOST=0.0.0.0
node --disable-warning=ExperimentalWarning server.js
pause
