# Identité visuelle « Affût »

Le poste d'affût du chasseur : calme, précis, prêt. OTEA Moteur est un outil
qu'on ouvre tous les matins. Il doit se lire en un coup d'œil, rester dense sans
être chargé, et garder l'esprit de la chasse et du jeu sans crier.

## L'intention en dix lignes

1. **Intention** : un carnet de terrain posé sur une table de pilotage. Le jour sur papier chaud, le soir sur ardoise.
2. **Clair** : fond `#F5F3EE`, surfaces `#FFFFFF`, creux `#EFECE5`, traits `#E2DED4`, encre `#17181C`, encre secondaire `#565B66`, tertiaire `#62677A`.
3. **Sombre** : fond `#111214`, surfaces `#18191D`, creux `#0D0E10`, traits `#2A2C33`, encre `#EDEBE6`, secondaire `#A9ACB5`, tertiaire `#8C909B`.
4. **Accent** : l'orange de chasse, `#C2410C` le jour (texte `#B83D08`), `#FF6B2C` le soir (texte `#FF8A52`).
5. **États** : succès vert forêt `#23704F` / `#4CC38A`, alerte `#C2261F` / `#FF7B7B`, info ardoise `#2F5D8A` / `#7FB0E0`. Le jeu (XP, boss, badges) parle en or laiton `#8A6510` / `#E0B04A`.
6. **Contrastes** (WCAG AA vérifiés) : encre 16:1, secondaire 6,1:1, tertiaire 5,1:1 ; texte blanc sur bouton orange 5,2:1 ; en sombre, texte sur orange 6,8:1.
7. **Typographie, deux familles** : *Bricolage Grotesque* (titres, gros chiffres, marque), hébergée dans l'app (`public/fonts`, licence OFL, aucun appel extérieur) ; la police système pour le texte (SF Pro sur Mac, iPad et iPhone).
8. **Icônes** : un seul jeu, au trait de 1,75 px, en SVG dans `index.html`. Les emoji restent dans le contenu (typologies de clients, badges, messages) mais ne portent plus la structure : navigation, titres d'écran et boutons utilisent les icônes.
9. **Règle de l'accent** : l'orange plein est réservé à l'action principale de l'écran et à ce qui est vital. Une action répétée dans une liste prend la version douce. Le bouton « fort » (encre pleine) sert à l'action secondaire importante.
10. **Densité** : base 15 px (16 px au doigt), rythme de 4 px, cibles tactiles de 44 px minimum, cartes à filet fin et ombre légère, tableaux à lignes de 44 à 48 px.

## Où ça vit

- `public/app.css` : tous les jetons (couleurs des deux thèmes, tailles, espacements, arrondis, ombres) en tête de fichier. On change un jeton, pas un composant.
- `public/theme.js` : pose le thème choisi avant le premier affichage (clair, sombre ou auto qui suit l'appareil).
- `public/ui.js` : la coque (menu repliable, barre basse au téléphone, palette de commandes, raccourcis, premier lancement, icônes des titres).

## Les parcours

- **Ma journée** s'ouvre sur « L'essentiel du jour » : les trois choses à faire en premier, chacune avec Ouvrir, Demain et Fait. Le reste suit, sans répéter ces trois-là.
- **Palette** (`Ctrl K`, `⌘K` ou `/`) : aller à un écran, chercher un contact, lancer une action. Raccourcis : `G` puis une lettre pour changer d'écran, `N` nouveau contact, `T` nouvelle tâche, `?` pour la liste complète.
- **Fiches contact** en panneau latéral : posées à côté de la liste sur grand écran, en feuille sur iPad et iPhone.
- **Navigation** : barre latérale repliable sur ordinateur, rail d'icônes sur iPad, barre basse à cinq onglets sur iPhone avec « Plus » pour le reste.
- **Retours** : squelettes pendant le chargement, confirmations discrètes avec « Annuler » quand le retour en arrière est exact, erreurs qui disent ce qui s'est passé et quoi faire.
- **Mouvement** : fondu entre écrans (View Transitions quand le navigateur sait le faire), tout coupé si l'appareil demande moins d'animations.
