'use strict';
// 🤖 MIGRATION : défaire les fausses « réponses » reçues avant la détection des
// réponses automatiques.
//
// Le cas : un prospect n'avait envoyé qu'un message d'absence, début septembre.
// L'app l'avait pris pour une vraie réponse : Ma journée demandait encore, deux
// mois plus tard, de « Répondre et proposer un RDV ». Depuis reponse-auto.js, les
// nouvelles absences sont bien reconnues, mais celles déjà enregistrées gardaient
// leurs tâches. Cette migration les reprend une fois, puis se désactive.
//
// Pour chaque réponse déjà enregistrée dont l'objet trahit une réponse automatique :
//  · la réponse est marquée « automatique » ;
//  · l'action « Réponse reçue » devient une simple note (sans XP) ;
//  · la demande « a répondu » sort de la liste à traiter ;
//  · la fiche revient à l'étape d'avant si c'est cette absence qui l'avait fait
//    passer « En discussion » ;
//  · « Répondre et proposer un RDV » devient une relance à faire.
//
// Jamais touché : une fiche qui a AUSSI une vraie réponse, et les séquences
// arrêtées. Les relancer enverrait des emails tout seuls : c'est à Maxime de
// décider, fiche par fiche.
//
// RÈGLE DE SÛRETÉ : comme la migration des tirets, elle ne doit jamais empêcher
// l'app de démarrer. Le moindre incident est avalé et signalé.

const { estReponseAutomatique } = require('../mail/reponse-auto');

const DRAPEAU = 'migration_reponses_auto_v1';
const ACTION_REPONDRE = 'Répondre et proposer un RDV';
const ACTION_RELANCER = 'Relancer : il n’a envoyé qu’une réponse automatique';

const lireMeta = (m) => { try { return JSON.parse(m || '{}'); } catch { return {}; } };

function migrer(dbApi) {
  const { all, get, run, getSetting, setSetting, localDay } = dbApi;
  if (getSetting(DRAPEAU) === '1') return { deja_fait: true };

  const bilan = { reponses: 0, actions: 0, demandes: 0, etapes: 0, taches: 0, sequences_arretees: 0, fiches: [] };
  const fausses = all('SELECT * FROM replies WHERE COALESCE(automatique, 0) = 0')
    .map((r) => ({ r, verdict: estReponseAutomatique({ subject: r.subject }) }))
    .filter((x) => x.verdict.auto);

  const contacts = new Map();
  for (const { r, verdict } of fausses) {
    run('UPDATE replies SET automatique = 1 WHERE id = ?', r.id);
    bilan.reponses++;
    if (!r.contact_id) continue;

    const actions = all(`SELECT * FROM activities WHERE contact_id = ? AND type = 'reponse_recue'`, r.contact_id)
      .filter((a) => Number(lireMeta(a.meta).imap_uid) === Number(r.imap_uid));
    for (const a of actions) {
      const meta = { ...lireMeta(a.meta), reponse_automatique: true };
      run(`UPDATE activities SET type = 'note', xp = 0, note = ?, meta = ? WHERE id = ?`,
        `🤖 Réponse automatique, pas une vraie réponse (${verdict.motif}) : corrigé après coup.`, JSON.stringify(meta), a.id);
      bilan.actions++;
      const etape = all(`SELECT * FROM activities WHERE contact_id = ? AND type = 'stage_change' AND id > ? AND id <= ? ORDER BY id`, r.contact_id, a.id, a.id + 3)
        .find((s) => lireMeta(s.meta).auto && lireMeta(s.meta).to === 'en_discussion');
      if (etape) contacts.set(r.contact_id, { ...(contacts.get(r.contact_id) || {}), avant: lireMeta(etape.meta).from });
    }

    const demande = run(`UPDATE inbox SET status = 'automatique', updated_at = ? WHERE contact_id = ? AND source = 'gmail-auto' AND status = 'nouveau' AND content LIKE ?`,
      new Date().toISOString(), r.contact_id, `%${r.subject}%`);
    bilan.demandes += Number(demande.changes || 0);
    if (!contacts.has(r.contact_id)) contacts.set(r.contact_id, {});
  }

  for (const [id, { avant }] of contacts) {
    const c = get('SELECT * FROM contacts WHERE id = ?', id);
    if (!c) continue;
    // Une vraie réponse existe aussi : la fiche reste telle quelle.
    if (get(`SELECT id FROM activities WHERE contact_id = ? AND type = 'reponse_recue'`, id)) continue;
    const patch = {};
    if (avant && c.stage === 'en_discussion') { patch.stage = avant; bilan.etapes++; }
    if (c.next_action === ACTION_REPONDRE) {
      patch.next_action = ACTION_RELANCER;
      patch.next_action_at = localDay();
      bilan.taches++;
    }
    if (Object.keys(patch).length) dbApi.updateContact(id, patch);
    if (get(`SELECT id FROM enrollments WHERE contact_id = ? AND status = 'replied'`, id)) bilan.sequences_arretees++;
    bilan.fiches.push([c.first_name, c.last_name].filter(Boolean).join(' ') + (c.company ? ` (${c.company})` : ''));
  }

  setSetting(DRAPEAU, '1');
  return bilan;
}

function migrerSansRisque(dbApi) {
  try {
    return migrer(dbApi);
  } catch (e) {
    return { echec: e.message };
  }
}

module.exports = { migrer, migrerSansRisque, DRAPEAU, ACTION_RELANCER };
