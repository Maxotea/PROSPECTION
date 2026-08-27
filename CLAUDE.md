# La Chasse — consignes de travail

## ✍️ Règle d'écriture absolue : jamais de tiret cadratin

**Le caractère `—` est interdit.** Partout : dans les emails et posts générés, dans
l'interface, dans le README, dans les commentaires de code, dans les messages de
commit, et dans les réponses à Maxime.

Pourquoi : c'est la signature d'écriture la plus reconnaissable d'un texte produit
par une IA. Les mails de prospection partent au nom d'OTEA Production, chez de
vrais prospects, dans un métier où l'écrit se juge. Un seul de ces tirets et le
message sent le robot.

Ça vaut aussi pour le tiret demi-cadratin `–` dans du texte. Le trait d'union
normal (`-`) reste évidemment permis : porte-parole, sous-titres, Jean-Pierre.

### Par quoi le remplacer

Le tiret cadratin sert presque toujours à quatre choses, et le français a mieux :

| Usage | Remplacer par | Exemple |
|---|---|---|
| Introduire une explication | deux-points | `Je relance : les plannings se remplissent tôt.` |
| Enchaîner une idée | virgule | `Les journées sont chargées, je fais remonter mon message.` |
| Incise | parenthèses ou deux virgules | `Le devis (envoyé lundi) attend une réponse.` |
| Couper deux idées | point | `Je ferme le dossier. Aucun souci.` |
| Séparer un libellé | `·` ou deux-points | `Grand compte · 1er contact` |

Ne jamais se contenter de supprimer le tiret : la phrase doit rester correcte.

Un test automatique (`test/style.test.js`) fait échouer la suite si un tiret
cadratin réapparaît dans un texte destiné à sortir de l'app (templates, séquences,
kits de campagne, consignes envoyées à l'IA). Il est là pour que la règle survive
aux prochaines modifications.

## 🗣️ Le reste du ton

- Tout est en **français**, tutoiement, direct. Maxime n'est pas développeur :
  aucun jargon technique dans l'interface ni dans les messages d'erreur.
- Un message d'erreur dit ce qui s'est passé **et** quoi faire pour le régler.
- Les textes de prospection sont courts, concrets, sans superlatif marketing.

## 🧱 Technique

- **Zéro dépendance** : Node ≥ 22.13, `node:sqlite`, frontend vanilla. Ne jamais
  ajouter de paquet npm.
- SQLite refuse les chaînes entre guillemets doubles : **toujours des apostrophes
  simples** dans le SQL (`WHERE stage = 'facture'`).
- Jamais de caractère invisible écrit en dur dans le code (marques de direction,
  combinants) : utiliser les échappements (`\u200e`, `\u0300-\u036f`).
- `npm test` doit rester vert avant chaque commit.
