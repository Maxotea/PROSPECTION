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

- `public/jetons.css` : **la seule source** des couleurs (deux thèmes), tailles de texte, espacements, arrondis, ombres, durées d'animation et zones sûres de l'iPhone. On change un jeton, pas un composant. `test/jetons.test.js` refuse toute valeur écrite en dur ailleurs et recalcule les contrastes WCAG AA des deux thèmes.
- `public/app.css` : les composants, qui ne font qu'assembler les jetons, plus quelques utilitaires de marge (`mt-3`, `fin`, `flex-1`…) à la place des styles écrits dans le JS.
- `public/connexion.css` et `connexion.js` : la page de connexion (mêmes jetons, mêmes thèmes), seule page servie sans code avec ses fichiers publics.
- `public/theme.js` : pose le thème choisi avant le premier affichage (clair, sombre ou auto qui suit l'appareil).
- `public/ui.js` : la coque (menu repliable, barre basse au téléphone, palette de commandes, raccourcis, premier lancement, icônes des titres).

## Les parcours

- **Ma journée** s'ouvre sur « L'essentiel du jour » : les trois choses à faire en premier, chacune avec Ouvrir, Demain et Fait. Le reste suit, sans répéter ces trois-là.
- **Palette** (`Ctrl K`, `⌘K` ou `/`) : aller à un écran, chercher un contact, lancer une action. Raccourcis : `G` puis une lettre pour changer d'écran, `N` nouveau contact, `T` nouvelle tâche, `?` pour la liste complète.
- **Fiches contact** en panneau latéral : posées à côté de la liste sur grand écran, en feuille sur iPad et iPhone.
- **Navigation** : barre latérale repliable sur ordinateur, rail d'icônes sur iPad, barre basse à cinq onglets sur iPhone avec « Plus » pour le reste.
- **Retours** : squelettes pendant le chargement, confirmations discrètes avec « Annuler » quand le retour en arrière est exact, erreurs qui disent ce qui s'est passé et quoi faire.
- **Mouvement** : fondu entre écrans (View Transitions quand le navigateur sait le faire), tout coupé si l'appareil demande moins d'animations.

## Passe 2 : ce qui a été resserré

- **Annuler pour de vrai.** Fait, Demain, Ignorer, supprimer (contact, tâche, devis, campagne, séquence, template, référence, demande), changer d'étape (pipeline, liste, fiche, Chasse) : chaque confirmation porte « Annuler ». Le serveur photographie l'état avant l'action (`src/annulation.js`) et le remet à l'identique, XP, badges et quêtes compris. Plus de « Es-tu sûr ? » : l'action part, le retour reste ouvert 15 minutes. `Ctrl Z` (`⌘Z` sur Mac) rejoue le dernier. Testé dans `test/annuler.test.js`.
- **Retour immédiat.** La ligne décidée s'efface tout de suite, la carte du pipeline change de colonne avant la réponse du serveur ; en cas de refus, l'écran se redessine tel qu'il est vraiment.
- **Clavier partout.** Lignes de contacts atteignables au clavier (Entrée ouvre, flèches haut et bas), tris de colonnes en vrais boutons, cartes du pipeline déplaçables avec les flèches gauche et droite, focus gardé dans les fenêtres et la fiche en feuille, plus aucun bouton dans un lien.
- **iPhone.** Zones sûres (encoche, barre d'accueil, paysage) via `--sur-*`. Clavier virtuel mesuré (`--clavier`) : la fiche, les fenêtres et la palette remontent au-dessus, la barre du bas s'efface, le champ touché reste visible.
- **Textes longs.** Pastilles qui passent à la ligne, emails coupés proprement avec le texte entier au survol, sociétés sur deux lignes au plus dans les listes et le pipeline.
- **Rythme.** Marges de mise en page sur la grille de 4 px ; les demi-pas (2, 6, 10, 14 px) restent à l'intérieur des contrôles.
