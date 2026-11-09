'use strict';
// Fusionner deux OTEA Moteur en un seul.
//
// Le cas : l'app a tourné sur le Mac et en ligne en même temps, chacune avec
// sa base. Au lieu d'en écraser une (la restauration), on verse l'autre base
// dans celle-ci : les contacts se rapprochent (email, LinkedIn, Pennylane,
// nom + société), l'historique s'additionne, les réglages déjà remplis ici
// restent. Rien n'est jamais perdu de ce côté-ci : on ajoute, on complète, on
// n'efface pas.
//
// Tout se passe dans une seule transaction. En simulation, on compte puis on
// annule : Maxime voit ce qui va arriver avant de dire oui.

const dbApi = require('./db');
const playbooks = require('./playbooks');
const { db, get, all, run } = dbApi;

// L'ordre du pipeline : quand deux fiches se rapprochent, l'étape la plus avancée gagne.
const ORDRE_ETAPES = playbooks.STAGES.map((s) => s.code);

function avancement(stage) {
  const i = ORDRE_ETAPES.indexOf(stage);
  return i < 0 ? 0 : i;
}

function colonnes(table, schema = 'main') {
  return db.prepare(`PRAGMA ${schema}.table_info(${table})`).all().map((r) => r.name);
}

// Colonnes communes aux deux bases (une base plus ancienne peut en avoir moins).
function colonnesCommunes(table) {
  const ici = new Set(colonnes(table, 'main'));
  return colonnes(table, 'autre').filter((c) => ici.has(c));
}

function insererLigne(table, ligne, cols) {
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return run(sql, ...cols.map((c) => ligne[c] === undefined ? null : ligne[c])).lastId;
}

function compteur() { return { ajoutes: 0, fusionnes: 0, ignores: 0 }; }

// ---------------------------------------------------------------- la fusion
function fusionnerBase(cheminAutre, { simulation = false } = {}) {
  const rapport = { simulation, tables: {}, reglages: { repris: [], gardes: [] }, avertissements: [] };
  const T = (nom) => (rapport.tables[nom] = rapport.tables[nom] || compteur());

  db.exec(`ATTACH DATABASE '${String(cheminAutre).replace(/'/g, "''")}' AS autre`);
  try {
    const tablesAutre = all("SELECT name FROM autre.sqlite_master WHERE type = 'table'").map((r) => r.name);
    for (const attendue of ['contacts', 'settings', 'activities']) {
      if (!tablesAutre.includes(attendue)) throw new Error("Ce fichier n'est pas une sauvegarde d'OTEA Moteur (il lui manque des tables).");
    }
    const a = (table) => tablesAutre.includes(table);

    db.exec('BEGIN');
    try {
      // ---- réglages : ce qui est vide ici prend la valeur de l'autre
      for (const r of all('SELECT key, value FROM autre.settings')) {
        const ici = get('SELECT value FROM settings WHERE key = ?', r.key);
        const defaut = dbApi.SETTINGS_DEFAULTS[r.key];
        const vide = !ici || ici.value === '' || ici.value === null || (defaut !== undefined && String(ici.value) === String(defaut));
        const autreVide = r.value === '' || r.value === null || (defaut !== undefined && String(r.value) === String(defaut));
        if (autreVide) continue;
        if (vide) { dbApi.setSetting(r.key, r.value); rapport.reglages.repris.push(r.key); }
        else if (String(ici.value) !== String(r.value)) rapport.reglages.gardes.push(r.key);
      }

      // ---- campagnes : même nom, même semaine
      const idCampagne = new Map();
      if (a('campaigns')) {
        const c = T('campaigns'); const cols = colonnesCommunes('campaigns').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.campaigns')) {
          const ici = get('SELECT id FROM campaigns WHERE name = ? AND week_start = ?', r.name, r.week_start);
          if (ici) { idCampagne.set(r.id, ici.id); c.ignores++; continue; }
          const ligne = { ...r, sequence_id: 0 };
          idCampagne.set(r.id, insererLigne('campaigns', ligne, cols)); c.ajoutes++;
        }
      }

      // ---- modèles, séquences, références : par code, les intégrés ne bougent pas
      const idSequence = new Map();
      if (a('templates')) {
        const c = T('templates'); const cols = colonnesCommunes('templates').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.templates')) {
          if (r.builtin) { c.ignores++; continue; }
          if (r.code && get('SELECT id FROM templates WHERE code = ?', r.code)) { c.ignores++; continue; }
          if (!r.code && get('SELECT id FROM templates WHERE name = ? AND body = ?', r.name, r.body)) { c.ignores++; continue; }
          const ligne = { ...r, campaign_id: idCampagne.get(r.campaign_id) || 0 };
          insererLigne('templates', ligne, cols); c.ajoutes++;
        }
      }
      if (a('sequences')) {
        const c = T('sequences'); const cols = colonnesCommunes('sequences').filter((x) => x !== 'id');
        const colsEtapes = a('sequence_steps') ? colonnesCommunes('sequence_steps').filter((x) => x !== 'id') : [];
        for (const r of all('SELECT * FROM autre.sequences')) {
          const ici = r.code ? get('SELECT id FROM sequences WHERE code = ?', r.code) : get('SELECT id FROM sequences WHERE name = ?', r.name);
          if (ici) { idSequence.set(r.id, ici.id); c.ignores++; continue; }
          if (r.builtin) { c.ignores++; continue; }
          const nid = insererLigne('sequences', r, cols); idSequence.set(r.id, nid); c.ajoutes++;
          if (colsEtapes.length) {
            for (const e of all('SELECT * FROM autre.sequence_steps WHERE sequence_id = ?', r.id)) insererLigne('sequence_steps', { ...e, sequence_id: nid }, colsEtapes);
          }
        }
        // les campagnes ajoutées pointent vers la séquence correspondante
        for (const r of all('SELECT id, sequence_id FROM autre.campaigns')) {
          const nid = idCampagne.get(r.id);
          if (nid && r.sequence_id && idSequence.get(r.sequence_id)) run('UPDATE campaigns SET sequence_id = ? WHERE id = ? AND sequence_id = 0', idSequence.get(r.sequence_id), nid);
        }
      }
      if (a('refs')) {
        const c = T('refs'); const cols = colonnesCommunes('refs').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.refs')) {
          if (r.builtin || (r.code && get('SELECT id FROM refs WHERE code = ?', r.code)) || get('SELECT id FROM refs WHERE name = ?', r.name)) { c.ignores++; continue; }
          insererLigne('refs', r, cols); c.ajoutes++;
        }
      }

      // ---- contacts : le cœur. Rapprochement, puis complément des champs vides.
      const idContact = new Map();
      {
        const c = T('contacts'); const cols = colonnesCommunes('contacts').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.contacts')) {
          const ligne = { ...r, campaign_id: idCampagne.get(r.campaign_id) || 0 };
          const existant = dbApi.findDuplicate(ligne);
          if (!existant) { idContact.set(r.id, insererLigne('contacts', ligne, cols)); c.ajoutes++; continue; }
          idContact.set(r.id, existant.id);
          const patch = {};
          for (const k of cols) {
            const v = ligne[k];
            if (v === '' || v === null || v === undefined || k === 'created_at' || k === 'updated_at') continue;
            if (k === 'stage') { if (avancement(v) > avancement(existant.stage)) patch.stage = v; continue; }
            if (k === 'is_former_client') { if (v && !existant.is_former_client) patch[k] = 1; continue; }
            if (k === 'partage_memorem') { if (v && !existant.partage_memorem) patch[k] = 1; continue; }
            if (k === 'revenue_history') { if (v > (existant.revenue_history || 0)) patch[k] = v; continue; }
            if (k === 'segment') { if ((existant.segment === 'inconnu' || !existant.segment) && v !== 'inconnu') patch[k] = v; continue; }
            if (k === 'last_touch_at' || k === 'next_action_at') { if (!existant[k] || String(v) > String(existant[k])) patch[k] = v; continue; }
            if (k === 'next_action') { if (!existant.next_action || (ligne.last_touch_at && String(ligne.last_touch_at) > String(existant.last_touch_at || ''))) patch[k] = v; continue; }
            if (k === 'notes') { if (existant.notes && !existant.notes.includes(v)) patch.notes = existant.notes + '\n' + v; else if (!existant.notes) patch.notes = v; continue; }
            if (k === 'tags') {
              try {
                const ici = JSON.parse(existant.tags || '[]'); const la = JSON.parse(v || '[]');
                const union = [...new Set([...ici, ...la])];
                if (union.length !== ici.length) patch.tags = JSON.stringify(union);
              } catch { /* étiquettes illisibles : on garde celles d'ici */ }
              continue;
            }
            if (k === 'archived' || k === 'origin' || k === 'campaign_id' || k === 'enrich_status') continue;
            if (existant[k] === '' || existant[k] === null || existant[k] === 0 || existant[k] === undefined) patch[k] = v;
          }
          if (Object.keys(patch).length) dbApi.updateContact(existant.id, patch);
          c.fusionnes++;
        }
      }
      const contactIci = (id) => (id ? idContact.get(id) || null : null);

      // ---- devis : par identifiant Pennylane, sinon même contact, même titre, même montant, même date
      const idDeal = new Map();
      if (a('deals')) {
        const c = T('deals'); const cols = colonnesCommunes('deals').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.deals')) {
          const cid = contactIci(r.contact_id);
          if (!cid) { c.ignores++; continue; }
          let ici = null;
          if (r.pennylane_quote_id) ici = get('SELECT * FROM deals WHERE pennylane_quote_id = ?', r.pennylane_quote_id);
          if (!ici) ici = get('SELECT * FROM deals WHERE contact_id = ? AND title = ? AND amount = ? AND created_at = ?', cid, r.title, r.amount, r.created_at);
          if (ici) {
            idDeal.set(r.id, ici.id);
            // l'état le plus avancé l'emporte : une facture émise là-bas reste émise
            const patch = {};
            if (r.invoiced_at && !ici.invoiced_at) { patch.invoiced_at = r.invoiced_at; patch.status = r.status; }
            if (r.pennylane_invoice_id && !ici.pennylane_invoice_id) patch.pennylane_invoice_id = r.pennylane_invoice_id;
            if (r.pennylane_quote_url && !ici.pennylane_quote_url) patch.pennylane_quote_url = r.pennylane_quote_url;
            if (Object.keys(patch).length) run(`UPDATE deals SET ${Object.keys(patch).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(patch), ici.id);
            c.fusionnes++; continue;
          }
          idDeal.set(r.id, insererLigne('deals', { ...r, contact_id: cid }, cols)); c.ajoutes++;
        }
      }

      // ---- historique : une action = (contact, type, date, note). Jamais deux fois la même.
      {
        const c = T('activities'); const cols = colonnesCommunes('activities').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.activities')) {
          const cid = contactIci(r.contact_id);
          if (r.contact_id && !cid) { c.ignores++; continue; }
          const deja = get('SELECT id FROM activities WHERE COALESCE(contact_id, 0) = COALESCE(?, 0) AND type = ? AND created_at = ? AND note = ?', cid, r.type, r.created_at, r.note || '');
          if (deja) { c.ignores++; continue; }
          insererLigne('activities', { ...r, contact_id: cid, deal_id: r.deal_id ? idDeal.get(r.deal_id) || null : null }, cols); c.ajoutes++;
        }
      }

      // ---- le jeu : badges (le plus ancien gagné compte), quêtes du jour
      if (a('badges')) {
        const c = T('badges');
        for (const r of all('SELECT * FROM autre.badges')) {
          const ici = get('SELECT * FROM badges WHERE code = ?', r.code);
          if (!ici) { run('INSERT INTO badges (code, awarded_at) VALUES (?, ?)', r.code, r.awarded_at); c.ajoutes++; }
          else if (r.awarded_at < ici.awarded_at) { run('UPDATE badges SET awarded_at = ? WHERE id = ?', r.awarded_at, ici.id); c.fusionnes++; }
          else c.ignores++;
        }
      }
      if (a('quest_awards')) {
        const c = T('quest_awards');
        for (const r of all('SELECT * FROM autre.quest_awards')) {
          const { changes } = run('INSERT OR IGNORE INTO quest_awards (day, code) VALUES (?, ?)', r.day, r.code);
          if (changes) c.ajoutes++; else c.ignores++;
        }
      }

      // ---- Autopilote : inscriptions, envois, réponses
      const idInscription = new Map();
      if (a('enrollments')) {
        const c = T('enrollments'); const cols = colonnesCommunes('enrollments').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.enrollments')) {
          const cid = contactIci(r.contact_id); const sid = idSequence.get(r.sequence_id);
          if (!cid || !sid) { c.ignores++; continue; }
          const ici = get('SELECT id FROM enrollments WHERE contact_id = ? AND sequence_id = ? AND started_at = ?', cid, sid, r.started_at);
          if (ici) { idInscription.set(r.id, ici.id); c.ignores++; continue; }
          idInscription.set(r.id, insererLigne('enrollments', { ...r, contact_id: cid, sequence_id: sid }, cols)); c.ajoutes++;
        }
      }
      if (a('outbox')) {
        const c = T('outbox'); const cols = colonnesCommunes('outbox').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.outbox')) {
          const cid = contactIci(r.contact_id);
          if (r.contact_id && !cid) { c.ignores++; continue; }
          const deja = r.message_id
            ? get('SELECT id FROM outbox WHERE message_id = ?', r.message_id)
            : get('SELECT id FROM outbox WHERE to_email = ? AND subject = ? AND created_at = ?', r.to_email, r.subject, r.created_at);
          if (deja) { c.ignores++; continue; }
          // un envoi encore en attente là-bas ne doit pas repartir d'ici sans relecture
          const statut = ['queued', 'awaiting_review'].includes(r.status) ? 'awaiting_review' : r.status;
          insererLigne('outbox', { ...r, contact_id: cid, enrollment_id: r.enrollment_id ? idInscription.get(r.enrollment_id) || null : null, status: statut }, cols); c.ajoutes++;
        }
      }
      if (a('replies')) {
        const c = T('replies'); const cols = colonnesCommunes('replies').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.replies')) {
          const cid = contactIci(r.contact_id);
          if (get('SELECT id FROM replies WHERE from_email = ? AND subject = ? AND received_at = ?', r.from_email, r.subject, r.received_at)) { c.ignores++; continue; }
          // Les numéros IMAP sont propres à chaque boîte lue : un numéro déjà pris ici ne dit rien, on l'oublie.
          const uidPris = r.imap_uid !== null && r.imap_uid !== undefined && get('SELECT id FROM replies WHERE imap_uid = ?', r.imap_uid);
          insererLigne('replies', { ...r, contact_id: cid, imap_uid: uidPris ? null : r.imap_uid }, cols); c.ajoutes++;
        }
      }
      if (a('inbox')) {
        const c = T('inbox'); const cols = colonnesCommunes('inbox').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.inbox')) {
          const cid = contactIci(r.contact_id);
          if (get('SELECT id FROM inbox WHERE COALESCE(contact_id, 0) = COALESCE(?, 0) AND content = ? AND created_at = ?', cid, r.content, r.created_at)) { c.ignores++; continue; }
          insererLigne('inbox', { ...r, contact_id: cid }, cols); c.ajoutes++;
        }
      }
      if (a('enrich_jobs')) {
        const c = T('enrich_jobs'); const cols = colonnesCommunes('enrich_jobs').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.enrich_jobs')) {
          if (r.external_id && get('SELECT id FROM enrich_jobs WHERE external_id = ?', r.external_id)) { c.ignores++; continue; }
          let ids = [];
          try { ids = JSON.parse(r.contact_ids || '[]').map((i) => idContact.get(i)).filter(Boolean); } catch { ids = []; }
          insererLigne('enrich_jobs', { ...r, contact_ids: JSON.stringify(ids) }, cols); c.ajoutes++;
        }
      }

      // ---- Ma journée : tâches, décisions, agenda, radar, briefs, répertoire en attente
      if (a('journee_taches')) {
        const c = T('journee_taches'); const cols = colonnesCommunes('journee_taches').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.journee_taches')) {
          if (get('SELECT id FROM journee_taches WHERE texte = ? AND created_at = ?', r.texte, r.created_at)) { c.ignores++; continue; }
          insererLigne('journee_taches', { ...r, contact_id: contactIci(r.contact_id) }, cols); c.ajoutes++;
        }
      }
      if (a('journee_decisions')) {
        const c = T('journee_decisions');
        for (const r of all('SELECT * FROM autre.journee_decisions')) {
          const ici = get('SELECT * FROM journee_decisions WHERE cle = ?', r.cle);
          if (!ici) { run('INSERT INTO journee_decisions (cle, statut, jusqu_au, titre, decide_le) VALUES (?, ?, ?, ?, ?)', r.cle, r.statut, r.jusqu_au, r.titre, r.decide_le); c.ajoutes++; }
          else if (r.decide_le > ici.decide_le) { run('UPDATE journee_decisions SET statut = ?, jusqu_au = ?, titre = ?, decide_le = ? WHERE cle = ?', r.statut, r.jusqu_au, r.titre, r.decide_le, r.cle); c.fusionnes++; }
          else c.ignores++;
        }
      }
      if (a('journee_agenda')) {
        const c = T('journee_agenda');
        for (const r of all('SELECT * FROM autre.journee_agenda')) {
          const { changes } = run('INSERT OR IGNORE INTO journee_agenda (cle, event_id, calendar_id, titre, debut, fin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', r.cle, r.event_id, r.calendar_id, r.titre, r.debut, r.fin, r.created_at);
          if (changes) c.ajoutes++; else c.ignores++;
        }
      }
      if (a('journee_radar')) {
        const c = T('journee_radar');
        for (const r of all('SELECT * FROM autre.journee_radar')) {
          const ici = get('SELECT * FROM journee_radar WHERE source = ?', r.source);
          if (!ici) { run('INSERT INTO journee_radar (source, charge, lu_le, erreur) VALUES (?, ?, ?, ?)', r.source, r.charge, r.lu_le, r.erreur); c.ajoutes++; }
          else if (r.lu_le > (ici.lu_le || '')) { run('UPDATE journee_radar SET charge = ?, lu_le = ?, erreur = ? WHERE source = ?', r.charge, r.lu_le, r.erreur, r.source); c.fusionnes++; }
          else c.ignores++;
        }
      }
      if (a('journee_briefs')) {
        const c = T('journee_briefs');
        for (const r of all('SELECT * FROM autre.journee_briefs')) {
          const { changes } = run('INSERT OR IGNORE INTO journee_briefs (jour, charge, envoye_le, created_at) VALUES (?, ?, ?, ?)', r.jour, r.charge, r.envoye_le, r.created_at);
          if (changes) c.ajoutes++; else c.ignores++;
        }
      }
      if (a('repertoire_attente')) {
        const c = T('repertoire_attente');
        for (const r of all('SELECT * FROM autre.repertoire_attente')) {
          const { changes } = run('INSERT OR IGNORE INTO repertoire_attente (cle, charge, recu_le) VALUES (?, ?, ?)', r.cle, r.charge, r.recu_le);
          if (changes) c.ajoutes++; else c.ignores++;
        }
      }

      // ---- 🧭 Pilotage : factures et devis. Une pièce Pennylane se reconnaît à son
      // identifiant ; une pièce saisie à la main, à son client, son numéro, sa date et son montant.
      if (a('pieces')) {
        const c = T('pieces'); const cols = colonnesCommunes('pieces').filter((x) => x !== 'id');
        for (const r of all('SELECT * FROM autre.pieces')) {
          const ici = r.source_id
            ? get('SELECT * FROM pieces WHERE source = ? AND type = ? AND source_id = ?', r.source, r.type, r.source_id)
            : get(`SELECT * FROM pieces WHERE source_id = '' AND type = ? AND client = ? AND numero = ? AND date = ? AND montant_ttc = ?`, r.type, r.client, r.numero, r.date, r.montant_ttc);
          if (!ici) { insererLigne('pieces', { ...r, contact_id: contactIci(r.contact_id) }, cols); c.ajoutes++; continue; }
          // La version la plus récente gagne (un « Payée » coché d'un côté ne se perd pas).
          if ((r.updated_at || '') > (ici.updated_at || '')) {
            run('UPDATE pieces SET statut = ?, reste_du = ?, paye_le = ?, echeance = ?, updated_at = ? WHERE id = ?', r.statut, r.reste_du, r.paye_le, r.echeance, r.updated_at, ici.id);
            c.fusionnes++;
          } else c.ignores++;
        }
      }

      // ---- 📈 Résultats clients : un client suivi se reconnaît à son nom, un
      // indicateur à son libellé ; un chiffre déjà saisi ici n'est jamais écrasé.
      if (a('clients_suivis')) {
        const c = T('clients_suivis'); const ci = T('clients_indicateurs'); const cm = T('clients_mesures');
        const colsC = colonnesCommunes('clients_suivis').filter((x) => x !== 'id');
        const colsI = a('clients_indicateurs') ? colonnesCommunes('clients_indicateurs').filter((x) => x !== 'id' && x !== 'client_id') : [];
        for (const r of all('SELECT * FROM autre.clients_suivis')) {
          const ici = all('SELECT * FROM clients_suivis').find((x) => String(x.nom).trim().toLowerCase() === String(r.nom).trim().toLowerCase());
          let idIci;
          if (ici) { idIci = ici.id; c.fusionnes++; } else { idIci = insererLigne('clients_suivis', { ...r, contact_id: contactIci(r.contact_id) }, colsC); c.ajoutes++; }
          if (!a('clients_indicateurs')) continue;
          for (const ind of all('SELECT * FROM autre.clients_indicateurs WHERE client_id = ?', r.id)) {
            const indIci = get('SELECT * FROM clients_indicateurs WHERE client_id = ? AND libelle = ?', idIci, ind.libelle);
            let iid;
            if (indIci) {
              iid = indIci.id; ci.fusionnes++;
              if (indIci.baseline === null && ind.baseline !== null) run('UPDATE clients_indicateurs SET baseline = ? WHERE id = ?', ind.baseline, iid);
            } else {
              // Le rôle (réservations, CA, pub) ne se prend que s'il est libre ici : jamais deux CA.
              const role = ind.role && get('SELECT id FROM clients_indicateurs WHERE client_id = ? AND role = ?', idIci, ind.role) ? '' : ind.role;
              iid = insererLigne('clients_indicateurs', { ...ind, client_id: idIci, role }, ['client_id', ...colsI]); ci.ajoutes++;
            }
            if (!a('clients_mesures')) continue;
            for (const m of all('SELECT * FROM autre.clients_mesures WHERE indicateur_id = ?', ind.id)) {
              const mIci = get('SELECT * FROM clients_mesures WHERE indicateur_id = ? AND mois = ?', iid, m.mois);
              if (!mIci) { run('INSERT INTO clients_mesures (indicateur_id, mois, objectif, reel) VALUES (?, ?, ?, ?)', iid, m.mois, m.objectif, m.reel); cm.ajoutes++; continue; }
              const objectif = mIci.objectif ?? m.objectif, reel = mIci.reel ?? m.reel;
              if (objectif !== mIci.objectif || reel !== mIci.reel) { run('UPDATE clients_mesures SET objectif = ?, reel = ? WHERE indicateur_id = ? AND mois = ?', objectif, reel, iid, m.mois); cm.fusionnes++; }
              else cm.ignores++;
            }
          }
        }
      }

      if (simulation) db.exec('ROLLBACK'); else db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* déjà annulé */ }
      throw e;
    }
  } finally {
    try { db.exec('DETACH DATABASE autre'); } catch { /* jamais attachée */ }
  }
  return rapport;
}

// Une phrase lisible pour Maxime, à partir du rapport.
function resumer(rapport) {
  const t = rapport.tables;
  const n = (k, champ) => (t[k] ? t[k][champ] : 0);
  const phrases = [];
  phrases.push(`${n('contacts', 'ajoutes')} contact${n('contacts', 'ajoutes') > 1 ? 's' : ''} ajouté${n('contacts', 'ajoutes') > 1 ? 's' : ''}, ${n('contacts', 'fusionnes')} rapproché${n('contacts', 'fusionnes') > 1 ? 's' : ''} d'une fiche existante`);
  phrases.push(`${n('activities', 'ajoutes')} action${n('activities', 'ajoutes') > 1 ? 's' : ''} d'historique et ${n('deals', 'ajoutes')} devis ajoutés`);
  const jeu = n('badges', 'ajoutes') + n('quest_awards', 'ajoutes');
  if (jeu) phrases.push(`${jeu} badge${jeu > 1 ? 's' : ''} ou quête${jeu > 1 ? 's' : ''} récupérés`);
  const auto = n('enrollments', 'ajoutes') + n('outbox', 'ajoutes');
  if (auto) phrases.push(`${auto} ligne${auto > 1 ? 's' : ''} d'Autopilote`);
  if (rapport.reglages.repris.length) phrases.push(`${rapport.reglages.repris.length} réglage${rapport.reglages.repris.length > 1 ? 's' : ''} repris de l'autre base`);
  if (rapport.reglages.gardes.length) phrases.push(`${rapport.reglages.gardes.length} réglage${rapport.reglages.gardes.length > 1 ? 's' : ''} différent${rapport.reglages.gardes.length > 1 ? 's' : ''} gardé${rapport.reglages.gardes.length > 1 ? 's' : ''} tel${rapport.reglages.gardes.length > 1 ? 's' : ''} quel${rapport.reglages.gardes.length > 1 ? 's' : ''} ici`);
  return phrases.join(' · ') + '.';
}

module.exports = { fusionnerBase, resumer, ORDRE_ETAPES };
