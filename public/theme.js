'use strict';
/* Chargé dans <head>, avant la feuille de style : on pose le thème choisi
   (clair, sombre, ou auto qui suit l'appareil) et l'état du menu replié
   avant le premier affichage. Sans ça, l'écran flashe en blanc le soir. */
(function () {
  const racine = document.documentElement;
  let theme = 'auto';
  let replie = false;
  try {
    theme = localStorage.getItem('otea_theme') || 'auto';
    replie = localStorage.getItem('otea_nav') === 'replie';
  } catch { /* navigation privée : on garde les valeurs par défaut */ }
  if (theme === 'clair' || theme === 'sombre') racine.dataset.theme = theme;
  if (replie) racine.dataset.nav = 'replie';
}());
