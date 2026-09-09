'use strict';
// ☀️ Ma journée : la to-do du matin, lue dans Gmail, WhatsApp, les appels et le CRM.
// Lancer : npm test  (node --test)

process.env.DATA_DIR = require('node:path').join(require('node:os').tmpdir(), `chasse-journee-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const fs = require('node:fs');

const dbApi = require('../src/db');
const { get, run, setSetting, localDay, addDays } = dbApi;
const playbooks = require('../src/playbooks');
const game = require('../src/gamification');
const journee = require('../src/journee');
const imap = require('../src/mail/imap');
const whatsapp = require('../src/importers/whatsapp');
const appels = require('../src/importers/appels');
const { fusionner } = require('../src/importers/fusion');

playbooks.seedTemplates(dbApi);
playbooks.seedSequences(dbApi);

const TIRET = '\u2014';
const today = localDay();
const il_y_a = (h) => new Date(Date.now() - h * 3600000).toISOString();
const nettoyer = () => {
  for (const t of ['journee_taches', 'journee_decisions', 'journee_radar', 'journee_briefs', 'deals', 'inbox', 'outbox', 'activities', 'replies', 'contacts']) run(`DELETE FROM ${t}`);
};

// ================================================================ analyse d'une ligne
test('vide-cerveau : une ligne suffit à donner durée, importance et échéance', () => {
  const a = journee.analyserTexte('Monter la vidéo du Loft 3h !! avant le 12/09', { today: '2026-09-08' });
  assert.deepStrictEqual(a, { texte: 'Monter la vidéo du Loft', duree: 'long', minutes: 180, importance: 3, echeance: '2026-09-12' });

  const b = journee.analyserTexte('répondre au mail de Claire', { today: '2026-09-08' });
  assert.strictEqual(b.duree, 'court');
  assert.strictEqual(b.importance, 1);
  assert.strictEqual(b.echeance, '');

  const c = journee.analyserTexte('Devis Pullman demain !', { today: '2026-09-08' });
  assert.strictEqual(c.duree, 'moyen', 'devis = moyen');
  assert.strictEqual(c.importance, 2, 'un ! = important');
  assert.strictEqual(c.echeance, '2026-09-09');

  const d = journee.analyserTexte('Payer la facture URSSAF (20 min) vendredi', { today: '2026-09-08' });
  assert.strictEqual(d.texte, 'Payer la facture URSSAF vendredi', 'la parenthèse de durée disparaît proprement');
  assert.strictEqual(d.minutes, 20);
  assert.strictEqual(d.duree, 'moyen', '20 min dépasse le court');
  assert.strictEqual(d.echeance, '2026-09-11', 'mardi → vendredi de la même semaine');

  const e = journee.analyserTexte('Relance impayé Galec', { today: '2026-09-08' });
  assert.strictEqual(e.importance, 3, 'impayé = vital');

  const f = journee.analyserTexte('Loft', { today: '2026-09-08' });
  assert.strictEqual(f.duree, 'moyen', 'sans indice, moyen par défaut');

  const g = journee.analyserTexte('Tournage 1h30 mardi', { today: '2026-09-08' });
  assert.strictEqual(g.minutes, 90);
  assert.strictEqual(g.echeance, '2026-09-15', 'mardi, on est mardi : le prochain');

  const h = journee.analyserTexte('Envoyer le devis pour le 03/01', { today: '2026-12-20' });
  assert.strictEqual(h.echeance, '2027-01-03', 'une date déjà passée cette année bascule sur la suivante');
});

test('tâche ajoutée, modifiée, faite, supprimée', () => {
  nettoyer();
  const t = journee.ajouterTache('Écrire le script du reel Gossip 45 min !');
  assert.strictEqual(t.duree, 'moyen');
  assert.strictEqual(t.minutes, 45);
  assert.strictEqual(t.importance, 2);
  const m = journee.modifierTache(t.id, { duree: 'long', importance: 3, echeance: today });
  assert.strictEqual(m.duree, 'long');
  assert.strictEqual(m.importance, 3);
  const items = journee.signauxTaches(today);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].pourquoi, "Pour aujourd'hui");
  journee.decider(`tache:${t.id}`, 'fait');
  assert.strictEqual(get('SELECT statut FROM journee_taches WHERE id = ?', t.id).statut, 'fait');
  assert.strictEqual(journee.signauxTaches(today).length, 0);
  journee.decider(`tache:${t.id}`, 'annuler');
  assert.strictEqual(get('SELECT statut FROM journee_taches WHERE id = ?', t.id).statut, 'a_faire');
  journee.decider(`tache:${t.id}`, 'ignore');
  assert.strictEqual(get('SELECT id FROM journee_taches WHERE id = ?', t.id), undefined, 'ignorer une tâche à soi la supprime');
});

// ================================================================ placement
test('placement : les courtes le matin, la grosse pierre, les moyennes l’après-midi', () => {
  const it = (o) => ({ duree: 'court', minutes: 10, importance: 1, urgence: 0, argent: 0, futur: false, ...o });
  const blocs = journee.placer([
    it({ cle: 'a', duree: 'court', importance: 3 }),
    it({ cle: 'b', duree: 'court', importance: 1 }),
    it({ cle: 'c', duree: 'long', importance: 3 }),
    it({ cle: 'd', duree: 'long', importance: 2 }),
    it({ cle: 'e', duree: 'long', importance: 2 }),
    it({ cle: 'f', duree: 'long', importance: 1 }),
    it({ cle: 'g', duree: 'moyen', importance: 2 }),
    it({ cle: 'h', duree: 'moyen', importance: 1 }),
    it({ cle: 'i', duree: 'moyen', importance: 1, urgence: 2 }),
    it({ cle: 'j', duree: 'court', importance: 2, futur: true }),
  ]);
  assert.deepStrictEqual(blocs.matin.map((x) => x.cle), ['a', 'b'], 'les courtes, la plus importante d’abord');
  assert.deepStrictEqual(blocs.pierre.map((x) => x.cle), ['c', 'd'], 'deux grosses pierres au plus, par importance');
  assert.deepStrictEqual(blocs.apres_midi.map((x) => x.cle), ['e', 'g', 'i', 'h'], 'la 3e longue importante et les moyennes');
  assert.deepStrictEqual(blocs.plus_tard.map((x) => x.cle), ['j', 'f'], 'la longue sans importance et ce qui est pour plus tard dans la semaine');

  const pleins = journee.placer([
    ...Array.from({ length: 5 }, (_, i) => it({ cle: `m${i}`, duree: 'moyen', importance: 2 })),
    it({ cle: 'calme', duree: 'moyen', importance: 1 }),
  ]);
  assert.strictEqual(pleins.apres_midi.length, 5, 'les moyennes importantes restent');
  assert.deepStrictEqual(pleins.plus_tard.map((x) => x.cle), ['calme'], 'l’après-midi déjà plein : la moyenne qui ne presse pas attend');
});

test('placement : plus de douze courtes, les moins importantes glissent', () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ cle: `c${i}`, duree: 'court', minutes: 5, importance: i < 3 ? 3 : 1, urgence: 0, argent: 0, futur: false }));
  const blocs = journee.placer(items);
  assert.strictEqual(blocs.matin.length, 12);
  assert.strictEqual(blocs.plus_tard.length, 3);
  assert.ok(blocs.matin.slice(0, 3).every((x) => x.importance === 3));
});

// ================================================================ signaux CRM
test('CRM : devis à relancer, à facturer, à faire, relances dues, demandes, Autopilote', () => {
  nettoyer();
  const galec = dbApi.insertContact({ first_name: 'Claire', last_name: 'Arnaud', company: 'Le Galec', email: 'claire@galec.fr', segment: 'grand_compte', stage: 'devis_envoye' });
  const vieux = new Date(Date.now() - 12 * 86400000).toISOString();
  run(`INSERT INTO deals (contact_id, title, amount, status, created_at, updated_at) VALUES (?, 'Film corporate', 4800, 'devis_envoye', ?, ?)`, galec.id, vieux, vieux);
  const pullman = dbApi.insertContact({ first_name: 'Marc', last_name: 'Dupont', company: 'Pullman', email: 'marc@pullman.fr', segment: 'pme', stage: 'negociation' });
  run(`INSERT INTO deals (contact_id, title, amount, status, created_at, updated_at) VALUES (?, 'Aftermovie', 2500, 'accepte', ?, ?)`, pullman.id, vieux, vieux);
  const loft = dbApi.insertContact({ first_name: 'William', last_name: 'Loft', company: 'Le Loft', segment: 'pme', stage: 'rdv' });
  const retard = dbApi.insertContact({ first_name: 'Anne', last_name: 'Retard', company: 'Agence X', segment: 'pme', stage: 'contacte', next_action: 'Relance 1', next_action_at: addDays(today, -3) });
  const futur = dbApi.insertContact({ first_name: 'Paul', last_name: 'Futur', company: 'Y', segment: 'pme', stage: 'contacte', next_action: 'Relance 1', next_action_at: addDays(today, 3) });
  run(`INSERT INTO inbox (contact_id, source, content, created_at, updated_at) VALUES (NULL, 'instagram', 'Bonjour, vous faites des vidéos pour des restaurants ?', ?, ?)`, il_y_a(60), il_y_a(60));
  run(`INSERT INTO outbox (contact_id, to_email, subject, body, status, day, created_at) VALUES (?, 'x@y.fr', 'Objet', 'Corps', 'awaiting_review', ?, ?)`, retard.id, today, il_y_a(1));

  const items = journee.signauxCrm(today);
  const cles = items.map((i) => i.cle);
  const par = (prefix) => items.find((i) => i.cle.startsWith(prefix));

  const devis = par('crm:devis:');
  assert.ok(devis, 'le devis sans nouvelle depuis 12 j est à relancer');
  assert.strictEqual(devis.importance, 3);
  assert.strictEqual(devis.argent, 4800);
  assert.match(devis.titre, /Relancer le devis de Claire Arnaud \(Le Galec\) \(4[\s\u202f\u00a0]800 €\)/);
  assert.ok(!cles.some((c) => c.startsWith(`crm:relance:${galec.id}:`)), 'pas de doublon relance contact + relance devis');

  const fact = par('crm:facturer:');
  assert.ok(fact && fact.duree === 'moyen' && fact.importance === 3, 'le devis accepté est à facturer');

  const aFaire = par('crm:devis_a_faire:');
  assert.ok(aFaire && aFaire.contact.id === loft.id, 'RDV pris sans devis : le devis est à faire');

  const rel = items.find((i) => i.cle === `crm:relance:${retard.id}:${addDays(today, -3)}`);
  assert.ok(rel, 'la relance en retard de 3 jours est là');
  assert.match(rel.pourquoi, /en retard de 3 j/);
  assert.strictEqual(rel.importance, 2, 'normal + 1 pour le retard');
  assert.ok(!cles.some((c) => c.startsWith(`crm:relance:${futur.id}:`)), 'une relance dans 3 jours n’est pas pour aujourd’hui');

  const demande = par('crm:demande:');
  assert.ok(demande && demande.importance === 3, 'demande entrante de plus de 48 h : vitale');
  assert.match(demande.pourquoi, /restaurants/);

  const outbox = par('crm:outbox:');
  assert.ok(outbox, 'les emails de l’Autopilote attendent le feu vert');
  assert.match(outbox.titre, /Valider 1 email de l'Autopilote/);
});

test('décisions : fait, plus tard, ignoré ; un « fait » sur une relance vaut une action de jeu', () => {
  nettoyer();
  const c = dbApi.insertContact({ first_name: 'Anne', last_name: 'Retard', company: 'Agence X', segment: 'pme', stage: 'contacte', next_action: 'Relance 1', next_action_at: addDays(today, -1) });
  const cle = `crm:relance:${c.id}:${addDays(today, -1)}`;
  let p = journee.plan();
  assert.ok(p.blocs.matin.some((i) => i.cle === cle));

  const r = journee.decider(cle, 'plus_tard', { jours: 2 });
  assert.strictEqual(r.jusqu_au, addDays(today, 2));
  p = journee.plan();
  assert.ok(!Object.values(p.blocs).flat().some((i) => i.cle === cle), 'remis à plus tard : masqué');
  assert.ok(Object.values(journee.plan({ now: new Date(Date.now() + 3 * 86400000) }).blocs).flat().some((i) => i.cle === cle), 'il revient une fois la date passée');

  const xpAvant = game.totalXp();
  const f = journee.decider(cle, 'fait');
  assert.ok(f.celebration && f.celebration.xp_gained > 0, 'relance faite = XP');
  assert.ok(game.totalXp() > xpAvant);
  const apres = get('SELECT * FROM contacts WHERE id = ?', c.id);
  assert.ok(apres.next_action_at > today, 'la prochaine relance est reprogrammée par le jeu');
  assert.ok(!Object.values(journee.plan().blocs).flat().some((i) => i.cle === cle));

  const i = journee.decider('mail:<abc@x>', 'ignore');
  assert.strictEqual(i.statut, 'ignore');
  assert.throws(() => journee.decider('x', 'peut-être'), /Décision inconnue/);
});

// ================================================================ signaux Gmail
function radarGmail(charge) {
  journee.ecrireRadar('gmail', charge);
  return journee.lireRadar();
}

test('Gmail : un mail d’humain sans réponse devient une chose à faire, le reste non', () => {
  nettoyer();
  const galec = dbApi.insertContact({ first_name: 'Claire', last_name: 'Arnaud', company: 'Le Galec', email: 'claire@galec.fr', segment: 'grand_compte', stage: 'en_discussion' });
  run(`INSERT INTO replies (imap_uid, contact_id, from_email, subject, received_at, created_at) VALUES (7, ?, 'claire@galec.fr', 'Re: film', ?, ?)`, galec.id, il_y_a(2), il_y_a(2));
  const radar = radarGmail({
    moi: 'maxime@otea.fr',
    recus: [
      { uid: 7, from: { name: 'Claire Arnaud', email: 'claire@galec.fr' }, subject: 'Re: film corporate : budget', date: il_y_a(50), message_id: '<m7@galec>', lu: true, repondu: false },
      { uid: 8, from: { name: 'Jean', email: 'jean@x.fr' }, subject: 'Question', date: il_y_a(3), message_id: '<m8@x>', lu: false, repondu: true },
      { uid: 9, from: { name: 'Léa', email: 'lea@y.fr' }, subject: 'Devis ?', date: il_y_a(4), message_id: '<m9@y>', lu: false, repondu: false },
      { uid: 10, from: { name: 'Zoé', email: 'zoe@z.fr' }, subject: 'Salut', date: il_y_a(30), message_id: '<m10@z>', lu: true, repondu: false },
      { uid: 11, from: { name: 'LinkedIn', email: 'messages-noreply@linkedin.com' }, subject: 'Vous avez 3 nouvelles notifications', date: il_y_a(1), message_id: '<m11@li>', lu: false, repondu: false },
      { uid: 12, from: { name: 'Moi', email: 'maxime@otea.fr' }, subject: 'note à moi-même', date: il_y_a(1), message_id: '<m12@me>', lu: true, repondu: false },
      { uid: 13, from: { name: 'Zoé', email: 'zoe@z.fr' }, subject: 'Re: Salut', date: il_y_a(2), message_id: '<m13@z>', lu: true, repondu: false },
      { uid: 14, from: { name: 'Banque', email: 'contact@banque.fr' }, subject: 'Votre code de vérification', date: il_y_a(2), message_id: '<m14@b>', lu: false, repondu: false },
    ],
    repondus: ['<m9@y>'],
    ecritsA: { 'zoe@z.fr': Date.now() - 20 * 3600000 },
  });
  const items = journee.signauxGmail(radar, { parEmail: new Map([['claire@galec.fr', galec]]), parTel: new Map() }, Date.now());
  const cles = items.map((i) => i.cle).sort();
  assert.deepStrictEqual(cles, ['mail:<m13@z>', 'mail:<m7@galec>'], 'Jean (répondu dans Gmail), Léa (répondu depuis Envoyés), LinkedIn, moi-même et la banque sont écartés ; Zoé garde son dernier mail, plus récent que ce qu’on lui a écrit');

  const claire = items.find((i) => i.cle === 'mail:<m7@galec>');
  assert.strictEqual(claire.importance, 3, 'contact chaud + mot budget + plus de 48 h + réponse à ta prospection : plafonné à vital');
  assert.strictEqual(claire.contact.id, galec.id);
  assert.match(claire.titre, /Répondre à Claire Arnaud \(Le Galec\)/);
  assert.match(claire.pourquoi, /il répond à ta prospection/);
  assert.match(claire.pourquoi, /mots : budget/);
  assert.ok(claire.actions.some((a) => a.type === 'lien' && a.href.includes('rfc822msgid:m7%40galec')));
  assert.ok(claire.actions.some((a) => a.type === 'repondre_mail' && a.uid === 7));

  const zoe = items.find((i) => i.cle === 'mail:<m13@z>');
  assert.strictEqual(zoe.importance, 1);
  assert.strictEqual(zoe.duree, 'court');
});

// ================================================================ WhatsApp et appels
test('WhatsApp : seules les conversations où le dernier mot n’est pas de toi comptent', () => {
  const entrees = [
    { key: 'wa:1', name: 'William', phone: '+33611111111', excerpt: 'Tu peux m’envoyer le devis ?', signaux: ['devis'], dernier_de_moi: false, dernier_entrant_le: il_y_a(5), messages: 40 },
    { key: 'wa:2', name: 'Maman', phone: '+33622222222', excerpt: 'Bisous', signaux: [], dernier_de_moi: true, dernier_entrant_le: il_y_a(3), messages: 900 },
    { key: 'wa:3', name: 'Vieux', phone: '+33633333333', excerpt: 'Ok', signaux: [], dernier_de_moi: false, dernier_entrant_le: il_y_a(24 * 40), messages: 3 },
    { key: 'wa:4', name: 'Inconnu', phone: '+33644444444', excerpt: '', signaux: [], dernier_de_moi: null, dernier_entrant_le: null, messages: 1 },
  ];
  const gardees = journee.filtrerWhatsapp(entrees, 14);
  assert.deepStrictEqual(gardees.map((e) => e.name), ['William']);

  journee.ecrireRadar('whatsapp', { conversations: gardees, via: 'mac', jours: 14 });
  const items = journee.signauxWhatsapp(journee.lireRadar(), { parEmail: new Map(), parTel: new Map() }, Date.now());
  assert.strictEqual(items.length, 1);
  assert.match(items[0].titre, /Répondre à William sur WhatsApp/);
  assert.strictEqual(items[0].importance, 2, 'mot devis');
  assert.match(items[0].pourquoi, /« Tu peux m’envoyer le devis \? » · reçu il y a 5 h · mots : devis/);
  assert.ok(items[0].actions[0].href === 'https://wa.me/33611111111');
});

test('appels : un appel manqué jamais rappelé devient « Rappeler »', () => {
  const entrees = [
    { key: 'tel:1', name: 'Client', phone: '+33611111111', calls: 3, manques: 1, dernier_manque_le: il_y_a(20), last_at: il_y_a(20), dernier_appel_de_moi: false },
    { key: 'tel:2', name: 'Rappelé', phone: '+33622222222', calls: 3, manques: 1, dernier_manque_le: il_y_a(30), last_at: il_y_a(10), dernier_appel_de_moi: true },
    { key: 'tel:3', name: 'Ancien', phone: '+33633333333', calls: 1, manques: 2, dernier_manque_le: il_y_a(24 * 60), last_at: il_y_a(24 * 60), dernier_appel_de_moi: false },
    { key: 'tel:4', name: 'Sans manqué', phone: '+33644444444', calls: 5, manques: 0, dernier_manque_le: null, last_at: il_y_a(2), dernier_appel_de_moi: false },
  ];
  const gardes = journee.filtrerAppels(entrees, 14);
  assert.deepStrictEqual(gardes.map((e) => e.name), ['Client']);
  journee.ecrireRadar('appels', { manques: gardes, via: 'mac', jours: 14 });
  const items = journee.signauxAppels(journee.lireRadar(), { parEmail: new Map(), parTel: new Map() }, Date.now());
  assert.strictEqual(items.length, 1);
  assert.match(items[0].titre, /Rappeler Client/);
  assert.strictEqual(items[0].actions[0].href, 'tel:+33611111111');
});

test('agrégation des appels : les appels manqués sont comptés sans devenir des relations', () => {
  // Horodatages figés une fois : les recalculer plus bas donnerait une milliseconde de décalage.
  const t100 = il_y_a(100), t5 = il_y_a(5), t3 = il_y_a(3);
  const t = (h) => ({ 100: t100, 5: t5, 3: t3 })[h];
  const lignes = [
    { address: '+33611111111', date: t(100), duration: 120, originated: 0, name: 'Claire' },
    { address: '+33611111111', date: t(5), duration: 0, originated: 0, name: 'Claire' },
    { address: '+33699999999', date: t(3), duration: 0, originated: 0, name: '' },
  ];
  const agg = appels.agreger(lignes, { days: 30 });
  assert.strictEqual(agg.length, 1, 'un numéro jamais décroché ne fait pas une relation');
  assert.strictEqual(agg[0].manques, 1);
  assert.strictEqual(agg[0].dernier_appel_de_moi, false);
  assert.strictEqual(agg[0].dernier_manque_le, t(5));
});

test('export WhatsApp .txt : on sait qui a parlé en dernier', () => {
  const txt = [
    '[03/09/2026 14:32:11] Claire Arnaud : Salut Maxime, tu peux me faire un devis pour le film ?',
    '[03/09/2026 15:02:00] Maxime : Oui je te prépare ça',
    '[04/09/2026 09:12:00] Claire Arnaud : Super merci',
  ].join('\n');
  const r = whatsapp.parseExport(txt, { moi: 'Maxime', days: 3650 });
  assert.strictEqual(r.monNom, 'Maxime');
  assert.strictEqual(r.entries.length, 1);
  assert.strictEqual(r.entries[0].dernier_de_moi, false, 'le dernier message est de Claire');
  assert.ok(r.entries[0].dernier_entrant_le);

  const r2 = whatsapp.parseExport(txt + '\n[04/09/2026 10:00:00] Maxime : Je t’envoie ça demain', { moi: 'Maxime', days: 3650 });
  assert.strictEqual(r2.entries[0].dernier_de_moi, true);
});

test('fusion : les champs de la journée suivent la source la plus récente', () => {
  const f = fusionner([
    [{ source: 'appels', key: 'tel:611111111', phone: '+33611111111', calls: 1, messages: 0, incoming: 1, outgoing: 0, duration_sec: 60, last_at: il_y_a(10), signaux: [], manques: 1, dernier_manque_le: il_y_a(10) }],
    [{ source: 'whatsapp', key: 'wa:611111111', phone: '+33611111111', calls: 0, messages: 5, incoming: 3, outgoing: 2, duration_sec: 0, last_at: il_y_a(2), signaux: ['devis'], dernier_de_moi: false, dernier_entrant_le: il_y_a(2) }],
  ]);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].manques, 1);
  assert.strictEqual(f[0].dernier_de_moi, false);
  assert.deepStrictEqual(f[0].sources, ['appels', 'whatsapp']);
});

// ================================================================ IMAP : lecture des récents
function startMockImap(scenario) {
  const server = net.createServer((sock) => {
    sock.write('* OK mock IMAP ready\r\n');
    let buffer = '';
    let selected = '';
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const idx = buffer.indexOf('\r\n');
        if (idx === -1) return;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const m = line.match(/^(\S+) (.+)$/);
        if (!m) continue;
        const [, tag, cmd] = m;
        const C = cmd.toUpperCase();
        if (C.startsWith('LOGIN')) sock.write(`${tag} OK logged in\r\n`);
        else if (C.startsWith('SELECT')) {
          selected = /INBOX/i.test(cmd) ? 'INBOX' : 'SENT';
          sock.write(`* 3 EXISTS\r\n* OK [UIDNEXT 100] predicted\r\n${tag} OK [READ-WRITE] selected\r\n`);
        }
        else if (C.startsWith('UID SEARCH X-GM-RAW')) {
          scenario.gmRaw = (scenario.gmRaw || 0) + 1;
          if (scenario.gmail) sock.write(`* SEARCH ${scenario.inbox.map((x) => x.uid).join(' ')}\r\n${tag} OK gmail search\r\n`);
          else sock.write(`${tag} NO [CANNOT] Unknown search key\r\n`);
        }
        else if (C.startsWith('UID SEARCH')) {
          const msgs = selected === 'INBOX' ? scenario.inbox : scenario.sent;
          sock.write(`* SEARCH ${msgs.map((x) => x.uid).join(' ')}\r\n${tag} OK search done\r\n`);
        }
        else if (C.startsWith('UID FETCH')) {
          const msgs = selected === 'INBOX' ? scenario.inbox : scenario.sent;
          const wanted = cmd.match(/FETCH ([\d,:]+)/i);
          const ids = wanted ? wanted[1].split(',').map(Number) : [];
          const full = /BODY\.PEEK\[\]/i.test(cmd);
          for (let i = 0; i < msgs.length; i++) {
            const msg = msgs[i];
            if (ids.length && !ids.includes(msg.uid)) continue;
            const contenu = (full ? msg.raw || msg.headers : msg.headers).replace(/\n/g, '\r\n') + '\r\n';
            const lit = Buffer.from(contenu, 'utf8');
            const flags = msg.flags ? `FLAGS (${msg.flags}) ` : (/FLAGS/i.test(cmd) ? 'FLAGS () ' : '');
            sock.write(`* ${i + 1} FETCH (UID ${msg.uid} ${flags}BODY[${full ? '' : 'HEADER.FIELDS (X)'}] {${lit.length}}\r\n`);
            sock.write(lit);
            sock.write(')\r\n');
          }
          sock.write(`${tag} OK fetch done\r\n`);
        }
        else if (C.startsWith('LIST')) sock.write(`* LIST (\\HasNoChildren \\Sent) "/" "Sent"\r\n* LIST (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK list done\r\n`);
        else if (C.startsWith('LOGOUT')) { sock.write(`* BYE\r\n${tag} OK bye\r\n`); sock.end(); }
        else sock.write(`${tag} OK noop\r\n`);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, scenario })));
}

const scenarioBoite = () => ({
  gmail: true,
  inbox: [
    { uid: 1, flags: '\\Seen', headers: 'From: Claire Arnaud <claire@galec.fr>\nTo: maxime@otea.fr\nSubject: =?UTF-8?B?RGV2aXMgZmlsbSA/?=\nDate: Mon, 7 Sep 2026 10:00:00 +0200\nMessage-ID: <m1@galec>' },
    { uid: 2, flags: '\\Seen \\Answered', headers: 'From: Jean <jean@x.fr>\nTo: maxime@otea.fr\nSubject: Question\nDate: Mon, 7 Sep 2026 11:00:00 +0200\nMessage-ID: <m2@x>\nIn-Reply-To: <chasse-1@otea.fr>' },
  ],
  sent: [
    { uid: 50, headers: 'To: Léa <lea@y.fr>\nDate: Mon, 7 Sep 2026 12:00:00 +0200\nIn-Reply-To: <m9@y>\nReferences: <m8@y> <m9@y>' },
  ],
});

test('IMAP : lecture des récents avec drapeaux, dossier Envoyés, et repli hors Gmail', async () => {
  const mock = await startMockImap(scenarioBoite());
  const cfg = { host: '127.0.0.1', port: mock.port, secure: false, user: 'maxime@otea.fr', pass: 'x' };
  try {
    const r = await imap.lireBoiteRecente(cfg, { days: 10 });
    assert.strictEqual(r.gmail, true, 'Gmail a répondu à la recherche par catégorie');
    assert.strictEqual(r.recus.length, 2);
    const m1 = r.recus.find((m) => m.uid === 1);
    assert.strictEqual(m1.subject, 'Devis film ?', 'objet décodé');
    assert.strictEqual(m1.from.email, 'claire@galec.fr');
    assert.strictEqual(m1.lu, true);
    assert.strictEqual(m1.repondu, false);
    const m2 = r.recus.find((m) => m.uid === 2);
    assert.strictEqual(m2.repondu, true);
    assert.strictEqual(m2.in_reply_to, '<chasse-1@otea.fr>');
    assert.deepStrictEqual(r.repondus.sort(), ['<m8@y>', '<m9@y>']);
    assert.ok(r.ecritsA['lea@y.fr'] > 0);
    assert.strictEqual(r.dossier_envoyes, 'Sent');
  } finally { mock.server.close(); }

  const mock2 = await startMockImap({ ...scenarioBoite(), gmail: false });
  try {
    const r = await imap.lireBoiteRecente({ ...cfg, port: mock2.port }, { days: 10 });
    assert.strictEqual(r.gmail, false, 'le serveur ne connaît pas X-GM-RAW : recherche par date');
    assert.strictEqual(r.recus.length, 2);
  } finally { mock2.server.close(); }
});

test('radar Gmail de bout en bout : rafraîchir puis planifier', async () => {
  nettoyer();
  const mock = await startMockImap(scenarioBoite());
  setSetting('gmail_user', 'maxime@otea.fr');
  setSetting('gmail_app_password', 'x');
  setSetting('imap_host', '127.0.0.1');
  setSetting('imap_port', String(mock.port));
  setSetting('imap_secure', '0');
  try {
    const bilan = await journee.rafraichir({ sources: ['gmail'] });
    assert.strictEqual(bilan.gmail.recus, 2);
    const p = journee.plan();
    const mails = Object.values(p.blocs).flat().filter((i) => i.source === 'gmail');
    assert.strictEqual(mails.length, 1, 'Jean a eu sa réponse, Claire non');
    assert.match(mails[0].titre, /Claire Arnaud/);
    assert.strictEqual(mails[0].duree, 'moyen', 'un devis à faire, pas un simple mail');
    assert.ok(p.sources.gmail.branche && !p.sources.gmail.erreur);
    assert.ok(p.sources.gmail.lu_le);
  } finally {
    mock.server.close();
    setSetting('gmail_user', ''); setSetting('gmail_app_password', '');
  }
  const bilan = await journee.rafraichir({ sources: ['gmail'] });
  assert.strictEqual(bilan.gmail.branche, false);
  assert.match(journee.plan().sources.gmail.erreur, /pas encore branché/);
});

test('IMAP : le texte d’un message, multipart ou html, pour rédiger la réponse', () => {
  const qp = 'Content-Type: multipart/alternative; boundary="b1"\nMIME-Version: 1.0\n\n--b1\nContent-Type: text/plain; charset="UTF-8"\nContent-Transfer-Encoding: quoted-printable\n\nBonjour Maxime,\nTu peux m=E2=80=99envoyer le devis =C3=A0 jour ?\n--b1\nContent-Type: text/html; charset="UTF-8"\n\n<p>Bonjour Maxime,</p>\n--b1--\n';
  assert.strictEqual(imap.extraireTexte(qp).texte, 'Bonjour Maxime,\nTu peux m’envoyer le devis à jour ?');

  const b64 = 'Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n' + Buffer.from('Salut, café demain ?').toString('base64') + '\n';
  assert.strictEqual(imap.extraireTexte(b64).texte, 'Salut, café demain ?');

  const html = 'Content-Type: text/html; charset=utf-8\n\n<html><body><style>p{}</style><p>Bonjour&nbsp;!</p><p>On se voit <b>lundi</b> ?</p></body></html>';
  const t = imap.extraireTexte(html);
  assert.strictEqual(t.type, 'html');
  assert.match(t.texte, /Bonjour !\s*On se voit lundi \?/);
});

test('IMAP : lire un message entier puis préparer la réponse (sans clé IA : template)', async () => {
  nettoyer();
  const sc = scenarioBoite();
  sc.inbox[0].raw = sc.inbox[0].headers + '\nContent-Type: text/plain; charset=utf-8\n\nBonjour Maxime, peux-tu me renvoyer le devis du film ?\nClaire';
  const mock = await startMockImap(sc);
  setSetting('gmail_user', 'maxime@otea.fr');
  setSetting('gmail_app_password', 'x');
  setSetting('imap_host', '127.0.0.1');
  setSetting('imap_port', String(mock.port));
  setSetting('imap_secure', '0');
  dbApi.insertContact({ first_name: 'Claire', last_name: 'Arnaud', company: 'Le Galec', email: 'claire@galec.fr', segment: 'grand_compte', stage: 'devis_envoye' });
  try {
    const r = await journee.preparerReponseMail(1);
    assert.strictEqual(r.from.email, 'claire@galec.fr');
    assert.match(r.texte_recu, /renvoyer le devis du film/);
    assert.strictEqual(r.contact.nom, 'Claire Arnaud');
    assert.strictEqual(r.brouillon.source, 'template');
    assert.ok(r.brouillon.body.length > 20);
    assert.ok(!r.brouillon.body.includes(TIRET));
    assert.match(r.brouillon.subject, /^Re: Devis film \?$/);
  } finally {
    mock.server.close();
    setSetting('gmail_user', ''); setSetting('gmail_app_password', '');
  }
});

// ================================================================ le brief
test('le brief du matin : lisible, sans tiret cadratin, mémorisé une fois par jour', async () => {
  nettoyer();
  journee.ecrireRadar('gmail', { moi: 'maxime@otea.fr', recus: [], repondus: [], ecritsA: {} });
  journee.ecrireRadar('whatsapp', { conversations: [], via: 'mac' });
  journee.ecrireRadar('appels', { manques: [], via: 'mac' });
  journee.ecrireRadar('agenda', { evenements: [] });
  const galec = dbApi.insertContact({ first_name: 'Claire', last_name: 'Arnaud', company: 'Le Galec', email: 'claire@galec.fr', segment: 'grand_compte', stage: 'devis_envoye' });
  const vieux = new Date(Date.now() - 12 * 86400000).toISOString();
  run(`INSERT INTO deals (contact_id, title, amount, status, created_at, updated_at) VALUES (?, 'Film corporate', 4800, 'devis_envoye', ?, ?)`, galec.id, vieux, vieux);
  journee.ajouterTache('Monter la vidéo du Loft 3h !!');
  journee.ajouterTache('Préparer le calendrier Gossip');
  journee.ajouterTache('Ranger le studio samedi');

  const p = journee.plan();
  const texte = journee.texteBrief(p);
  assert.ok(!texte.includes(TIRET));
  assert.match(texte, /^☀️ .*\. 4 choses à faire, dont 2 vitales, 4[\s\u202f\u00a0]800 € en jeu\./m);
  assert.match(texte, /⚡ Ce matin \(≈ 10 min\) : relancer le devis de Claire Arnaud/);
  assert.match(texte, /🏔️ La grosse pierre : Monter la vidéo du Loft \(≈ 3h\)/);
  assert.match(texte, /🧱 Cet après-midi : Préparer le calendrier Gossip/);
  assert.match(texte, /💤 Peut attendre : 1 chose\./);
  assert.ok(!/Sources pas lues/.test(texte), 'toutes les sources sont lues');

  const m = journee.mailBrief(p);
  assert.match(m.subject, /^☀️ Ta journée du .* : 4 choses, 2 vitales$/);
  assert.match(m.body, /🔴 📄 Relancer le devis/);
  assert.ok(!m.body.includes(TIRET));

  const b1 = await journee.briefDuMatin({ envoyer: false });
  assert.strictEqual(b1.total, 4);
  assert.strictEqual(b1.envoye, false);
  const b2 = await journee.briefDuMatin({ envoyer: false });
  assert.strictEqual(b2.deja_fait, true, 'une fois par jour');
  assert.ok(journee.briefDuJour().texte.includes('4 choses'));
  assert.strictEqual(journee.plan().brief.calcule_le !== '', true);
  assert.strictEqual(journee.plan().brief.envoye_le, '');

  // Boîtes vides : le brief le dit, sans inventer.
  nettoyer();
  journee.ecrireRadar('gmail', { moi: 'maxime@otea.fr', recus: [], repondus: [], ecritsA: {} });
  journee.ecrireRadar('whatsapp', { conversations: [], via: 'mac' });
  journee.ecrireRadar('appels', { manques: [], via: 'mac' });
  assert.match(journee.texteBrief(journee.plan()), /Rien qui attend/);
});

test('le mail du brief ne part pas : on le dit, et on réessaie au lieu d’attendre demain', async () => {
  nettoyer();
  run('DELETE FROM journee_briefs');
  // Un port fermé : Gmail « injoignable ».
  const libre = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  setSetting('gmail_user', 'maxime@otea.fr'); setSetting('gmail_app_password', 'x');
  setSetting('smtp_host', '127.0.0.1'); setSetting('smtp_port', String(libre)); setSetting('smtp_secure', '0');
  setSetting('journee_dernier_brief', '');
  try {
    const b1 = await journee.briefDuMatin({ envoyer: true });
    assert.strictEqual(b1.envoye, false);
    assert.match(b1.erreur, /Le mail du brief n'est pas parti/);
    assert.strictEqual(dbApi.getSetting('journee_dernier_brief'), '', 'pas marqué fait : la boucle réessaiera');
    const etat = journee.plan().brief;
    assert.match(etat.erreur, /n'est pas parti/);
    assert.strictEqual(etat.envoye_le, '');

    const b2 = await journee.briefDuMatin({ envoyer: true });
    assert.strictEqual(b2.deja_fait, undefined, 'deuxième passage : nouvel essai, pas « déjà fait »');
    assert.strictEqual(b2.envoye, false);

    // Mail désactivé : le brief du jour existe, on n'insiste pas.
    const b3 = await journee.briefDuMatin({ envoyer: false });
    assert.strictEqual(b3.deja_fait, true);
  } finally {
    setSetting('gmail_user', ''); setSetting('gmail_app_password', '');
    setSetting('smtp_host', 'smtp.gmail.com'); setSetting('smtp_port', '465'); setSetting('smtp_secure', '1');
    setSetting('journee_brief_erreur', '');
  }
});

test('la boucle : relit quand ça date, et fabrique le brief une fois l’heure passée', async () => {
  nettoyer();
  setSetting('journee_brief_heure', '08:00');
  setSetting('journee_dernier_brief', '');
  setSetting('journee_brief_mail', '0');
  const tot = new Date(); tot.setHours(7, 30, 0, 0);
  const r1 = await journee.boucle({ now: tot });
  assert.ok(r1.radar, 'le radar est relu : rien n’avait jamais été lu');
  assert.strictEqual(r1.brief, undefined, '7h30 : pas encore l’heure');
  const tard = new Date(); tard.setHours(8, 5, 0, 0);
  // « now » est une heure fictive : la fraîcheur du radar se juge sur l'horloge réelle,
  // on la rend donc très large pour que ce test ne dépende pas de l'heure qu'il est.
  const r2 = await journee.boucle({ now: tard, fraicheurMin: 100000 });
  assert.strictEqual(r2.radar, undefined, 'lu il y a une seconde : on ne relit pas');
  assert.ok(r2.brief && r2.brief.jour === localDay(tard));
  assert.strictEqual(dbApi.getSetting('journee_dernier_brief'), localDay(tard));
  const r3 = await journee.boucle({ now: tard, fraicheurMin: 100000 });
  assert.strictEqual(r3.brief, undefined, 'pas deux briefs le même jour');
});

test('rien qui sort de la journée ne contient de tiret cadratin', () => {
  const textes = [
    ...Object.values(journee.DUREES).map((d) => `${d.label} ${d.aide}`),
    ...Object.values(journee.IMPORTANCES).map((i) => i.label),
    ...Object.values(journee.BLOCS).map((b) => `${b.titre} ${b.aide}`),
  ];
  assert.ok(textes.every((t) => !t.includes(TIRET)));
});

test.after(() => { try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });
