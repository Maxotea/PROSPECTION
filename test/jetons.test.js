'use strict';
// L'identité « Affût » tient dans un seul fichier : public/jetons.css.
// Ces tests gardent la règle vivante :
//  · aucune couleur, taille de texte, ombre, arrondi ou espacement écrit en dur
//    ailleurs que dans les jetons (app.css, page de connexion, JS de l'interface) ;
//  · les couples texte / fond des deux thèmes passent WCAG AA (4,5:1).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const lire = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

// Retire les commentaires, puis découpe en « propriété: valeur ».
function declarations(css) {
  const sans = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const rx = /([a-z-]+)\s*:\s*([^;{}]+)/g;
  let m;
  while ((m = rx.exec(sans))) out.push({ prop: m[1], valeur: m[2].trim() });
  return out;
}

const PROPRIETES = /^(font-size|box-shadow|border-radius|border-(top|bottom)-(left|right)-radius|padding(-(top|bottom|left|right))?|margin(-(top|bottom|left|right))?|gap|row-gap|column-gap)$/;

for (const fichier of ['app.css', 'connexion.css']) {
  test(`${fichier} : aucune valeur de style écrite en dur hors des jetons`, () => {
    const css = lire(fichier).replace(/\/\*[\s\S]*?\*\//g, '');
    const couleurs = css.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) || [];
    assert.deepStrictEqual(couleurs, [], 'une couleur doit venir d’un jeton de jetons.css');

    const fautes = [];
    for (const { prop, valeur } of declarations(css)) {
      if (!PROPRIETES.test(prop)) continue;
      if (/^(0|none|auto|inherit|50%)$/.test(valeur)) continue;
      // Ce qui reste une fois les jetons et les env() retirés ne doit pas contenir de px.
      const reste = valeur.replace(/var\(--[a-z0-9-]+\)/gi, '').replace(/env\([^)]*\)/g, '');
      if (/\d+(\.\d+)?px/.test(reste)) fautes.push(`${prop}: ${valeur}`);
    }
    assert.deepStrictEqual(fautes, [], `Utilise un jeton (jetons.css) :\n${fautes.join('\n')}`);
  });
}

test('le JS de l’interface n’écrit ni couleur ni taille de texte en dur', () => {
  const fautes = [];
  for (const f of ['app.js', 'journee.js', 'ui.js', 'game.js', 'connexion.js']) {
    lire(f).split('\n').forEach((ligne, i) => {
      if (/^\s*\/\//.test(ligne)) return;
      if (/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/.test(ligne.replace(/href="#[^"]*"|'#[\w-]+'|"#[\w-]+"|`#[\w-]+|#\/\w+|#i-\w+/g, ''))) fautes.push(`${f}:${i + 1} couleur`);
      if (/font-size\s*:\s*\d/.test(ligne)) fautes.push(`${f}:${i + 1} taille de texte`);
      if (/box-shadow\s*:\s*\d/.test(ligne)) fautes.push(`${f}:${i + 1} ombre`);
    });
  }
  assert.deepStrictEqual(fautes, [], fautes.join('\n'));
});

// ---------------------------------------------------------------- contrastes
function jetonsDuTheme(css, theme) {
  const bloc = (selecteur) => {
    const i = css.indexOf(selecteur);
    assert.ok(i >= 0, `bloc ${selecteur} introuvable`);
    const debut = css.indexOf('{', i);
    return css.slice(debut + 1, css.indexOf('}', debut));
  };
  const valeurs = {};
  const remplir = (texte) => { for (const m of texte.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) valeurs[m[1]] = m[2].trim(); };
  remplir(bloc(':root {'));
  if (theme === 'sombre') remplir(bloc(':root[data-theme="sombre"]'));
  return valeurs;
}
function rgba(v) {
  if (v.startsWith('#')) {
    const h = v.length === 4 ? v.slice(1).split('').map((c) => c + c).join('') : v.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const m = v.match(/rgba?\(([^)]+)\)/);
  const p = m[1].split(',').map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
}
const surFond = (c, fond) => c.slice(0, 3).map((v, i) => v * c[3] + fond[i] * (1 - c[3]));
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }

// [texte, fond, fond sous le fond (pour les fonds translucides)]
const COUPLES = [
  ['encre', 'fond'], ['encre', 'surface'], ['encre-2', 'fond'], ['encre-2', 'surface'], ['encre-2', 'creux'],
  ['encre-3', 'surface'], ['encre-3', 'fond'], ['encre-3', 'creux'], ['encre-3', 'surface-2'],
  ['accent-texte', 'surface'], ['accent-texte', 'fond'], ['accent-texte', 'accent-doux', 'surface'],
  ['sur-accent', 'accent'], ['sur-fort', 'fort'], ['sur-succes', 'succes'],
  ['or-texte', 'surface'], ['or-texte', 'or-doux', 'surface'],
  ['succes', 'surface'], ['succes', 'succes-doux', 'surface'],
  ['alerte', 'surface'], ['alerte', 'alerte-doux', 'surface'], ['encre', 'alerte-doux', 'surface'],
  ['info', 'surface'], ['encre-2', 'nav-fond'], ['encre-3', 'nav-fond'],
];

for (const theme of ['clair', 'sombre']) {
  test(`contrastes WCAG AA du thème ${theme}`, () => {
    const j = jetonsDuTheme(lire('jetons.css'), theme);
    const fautes = [];
    for (const [texte, fond, dessous] of COUPLES) {
      assert.ok(j[texte] && j[fond], `jeton manquant : ${texte} ou ${fond}`);
      const base = dessous ? surFond(rgba(j[dessous]), [255, 255, 255]) : [255, 255, 255];
      const f = surFond(rgba(j[fond]), base);
      const t = surFond(rgba(j[texte]), f);
      const r = ratio(t, f);
      if (r < 4.5) fautes.push(`${texte} sur ${fond} : ${r.toFixed(2)}:1`);
    }
    assert.deepStrictEqual(fautes, [], `Contraste insuffisant (4,5:1 minimum) :\n${fautes.join('\n')}`);
  });
}
