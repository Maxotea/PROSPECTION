'use strict';
// Regrouper les correspondants venus de plusieurs sources en une fiche chacun.
// Volontairement séparé du reste : l'agent qui tourne sur le Mac s'en sert sans
// avoir à ouvrir la base du CRM, qui vit ailleurs quand l'app est hébergée.

const sig = require('./signaux');

// ---------------------------------------------------------------- fusion des sources
// Le même humain apparaît dans les appels ET dans WhatsApp : une seule fiche.
function fusionner(listes) {
  const parCle = new Map();
  for (const entree of listes.flat()) {
    const cle = sig.phoneKey(entree.phone) || entree.key;
    const existant = parCle.get(cle);
    if (!existant) {
      parCle.set(cle, { ...entree, sources: [entree.source], signaux: [...(entree.signaux || [])] });
      continue;
    }
    existant.calls += entree.calls || 0;
    existant.messages += entree.messages || 0;
    existant.incoming += entree.incoming || 0;
    existant.outgoing += entree.outgoing || 0;
    existant.duration_sec += entree.duration_sec || 0;
    if (entree.last_at && (!existant.last_at || entree.last_at > existant.last_at)) existant.last_at = entree.last_at;
    if (entree.first_at && (!existant.first_at || entree.first_at < existant.first_at)) existant.first_at = entree.first_at;
    if (entree.name && !existant.name) existant.name = entree.name;
    if (entree.phone && !existant.phone) existant.phone = entree.phone;
    if (entree.excerpt && !existant.excerpt) existant.excerpt = entree.excerpt;
    for (const s of entree.signaux || []) if (!existant.signaux.includes(s)) existant.signaux.push(s);
    if (!existant.sources.includes(entree.source)) existant.sources.push(entree.source);
  }
  return [...parCle.values()];
}

module.exports = { fusionner };
