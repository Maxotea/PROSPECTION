'use strict';
// 🗓️ Google Agenda : lecture, créneaux libres, pose des tâches, couleurs d'urgence.
// Le « Google » des tests est un petit serveur local qui imite le script Apps
// Script, redirection 302 comprise (c'est ainsi que Google répond aux POST).

process.env.DATA_DIR = require('node:path').join(require('node:os').tmpdir(), `chasse-agenda-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');

const dbApi = require('../src/db');
const { run, setSetting, getSetting, localDay, addDays } = dbApi;
const playbooks = require('../src/playbooks');
const agenda = require('../src/integrations/agenda');
const journee = require('../src/journee');

playbooks.seedTemplates(dbApi);
playbooks.seedSequences(dbApi);

const today = localDay();
const TIRET = '\u2014';
const a = (day, hhmm) => new Date(`${day}T${hhmm}:00`).toISOString();

// ---------------------------------------------------------------- faux Apps Script
function fauxGoogle() {
  const etat = { evenements: [], appels: [], secret: '' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/resultat') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(Buffer.from(u.searchParams.get('p'), 'base64url').toString('utf8'));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = {}; }
      etat.appels.push(body);
      let rep;
      if (etat.mode === 'login') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><title>Se connecter : Google</title>accounts.google.com</html>'); return; }
      if (body.secret !== etat.secret) rep = { error: 'Mauvais secret' };
      else if (body.action === 'ping') rep = { ok: true, email: 'maxime@otea.fr', principal: 'cal-pro', calendriers: [{ id: 'cal-pro', nom: 'OTEA', couleur: '#8e24aa', a_moi: true }, { id: 'cal-perso', nom: 'Perso', couleur: '#33b679', a_moi: true }] };
      else if (body.action === 'evenements') rep = { evenements: etat.evenements.filter((e) => !body.calendriers.length || body.calendriers.includes(e.calendrier)) };
      else if (body.action === 'creer') { const id = `ev-${etat.evenements.length + 1}`; etat.evenements.push({ id, calendrier: body.calendrier || 'cal-pro', calendrier_nom: 'OTEA', titre: body.titre, debut: body.debut, fin: body.fin, journee: false, couleur: body.couleur || '', description: body.description || '' }); rep = { id, calendrier: body.calendrier || 'cal-pro' }; }
      else if (body.action === 'couleur') { const ev = etat.evenements.find((e) => e.id === body.id); if (!ev) rep = { error: 'Événement introuvable' }; else { ev.couleur = body.couleur; rep = { ok: true }; } }
      else if (body.action === 'deplacer') { const ev = etat.evenements.find((e) => e.id === body.id); if (!ev) rep = { error: 'Événement introuvable' }; else { ev.debut = body.debut; ev.fin = body.fin; rep = { ok: true }; } }
      else if (body.action === 'supprimer') { etat.evenements = etat.evenements.filter((e) => e.id !== body.id); rep = { ok: true }; }
      else rep = { error: 'Action inconnue : ' + body.action };
      // Comme Google : le POST est redirigé vers l'adresse qui porte la réponse.
      res.writeHead(302, { Location: `/resultat?p=${Buffer.from(JSON.stringify(rep)).toString('base64url')}` });
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, etat, url: `http://127.0.0.1:${server.address().port}/exec` })));
}

let G;
test.before(async () => {
  G = await fauxGoogle();
  setSetting('agenda_url', G.url);
  G.etat.secret = agenda.secret();
});
test.after(() => { G.server.close(); try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

const reset = () => {
  G.etat.evenements = [];
  G.etat.appels = [];
  G.etat.mode = '';
  for (const t of ['journee_taches', 'journee_decisions', 'journee_radar', 'journee_agenda', 'contacts', 'deals']) run(`DELETE FROM ${t}`);
  setSetting('agenda_calendriers', '[]');
  setSetting('agenda_couleurs', '{}');
};

// ================================================================ couleurs et urgences
test('couleurs : le code par défaut, celui de Maxime, et la couleur à poser pour un niveau', () => {
  reset();
  const m = agenda.couleurs();
  assert.strictEqual(m['11'], 3, 'Tomate = très urgent');
  assert.strictEqual(m['6'], 2);
  assert.strictEqual(m['5'], 1);
  assert.strictEqual(m['10'], 0);
  assert.strictEqual(m['7'], null, 'Paon = juste une info');
  assert.strictEqual(agenda.couleurPour(3), '11');
  assert.strictEqual(agenda.couleurPour(0), '10');

  // Maxime a son propre code : Raisin = très urgent, Tomate = info.
  setSetting('agenda_couleurs', JSON.stringify({ 3: 3, 11: null, 7: 'n’importe quoi' }));
  const p = agenda.couleurs();
  assert.strictEqual(p['3'], 3);
  assert.strictEqual(p['11'], null);
  assert.strictEqual(p['7'], null, 'une valeur cassée redevient info');
  assert.strictEqual(agenda.couleurPour(3), '3', 'on pose SA couleur, pas la nôtre');
  assert.strictEqual(agenda.couleurPour(2), '6', 'inchangé : Mandarine');

  assert.deepStrictEqual(agenda.niveauDe({ titre: 'Café', couleur: '3' }, p), { niveau: 3, source: 'couleur' });
  assert.deepStrictEqual(agenda.niveauDe({ titre: 'Tournage Le Loft', couleur: '' }, p), { niveau: 1, source: 'mot', mot: 'tournage' });
  assert.deepStrictEqual(agenda.niveauDe({ titre: 'Dentiste', couleur: '' }, p), { niveau: null, source: '' });
  assert.deepStrictEqual(agenda.niveauDe({ titre: 'Dentiste', couleur: '11' }, p), { niveau: null, source: '' }, 'Tomate reclassée « info » par Maxime');
});

test('créneaux libres : les trous entre les rendez-vous, dans les heures de travail, à partir de maintenant', () => {
  reset();
  const day = '2026-09-10';
  const evs = [
    { debut: a(day, '10:00'), fin: a(day, '11:00'), journee: false },
    { debut: a(day, '10:30'), fin: a(day, '12:00'), journee: false },  // chevauche
    { debut: a(day, '14:00'), fin: a(day, '15:00'), journee: false },
    { debut: a(day, '00:00'), fin: a(addDays(day, 1), '00:00'), journee: true }, // journée entière : n'occupe pas
    { debut: a(day, '19:00'), fin: a(day, '20:00'), journee: false }, // hors heures
  ];
  const c = agenda.creneauxLibres(evs, { day, now: new Date(`${day}T08:00:00`) });
  assert.deepStrictEqual(c.map((x) => [agenda.heureCourte(x.debut), agenda.heureCourte(x.fin), x.minutes]), [
    ['09:00', '10:00', 60], ['12:00', '14:00', 120], ['15:00', '18:30', 210],
  ]);
  // En cours de journée : on part de maintenant (au multiple de 5 min suivant).
  const c2 = agenda.creneauxLibres(evs, { day, now: new Date(`${day}T12:33:00`) });
  assert.strictEqual(agenda.heureCourte(c2[0].debut), '12:35');
  assert.strictEqual(c2.length, 2);
  // Trop court : ignoré.
  const c3 = agenda.creneauxLibres([{ debut: a(day, '09:10'), fin: a(day, '18:30'), journee: false }], { day, now: new Date(`${day}T08:00:00`) });
  assert.deepStrictEqual(c3, []);
});

// ================================================================ le pont
test('le pont : test, secret, redirection Google, et les erreurs expliquées', async () => {
  reset();
  const t = await agenda.test();
  assert.match(t.message, /Google Agenda OK \(maxime@otea\.fr\) : 2 agenda\(s\)/);
  assert.strictEqual(getSetting('agenda_calendrier_ecriture'), 'cal-pro', 'le principal devient l’agenda d’écriture');
  assert.strictEqual(agenda.calendriersConnus().length, 2);
  assert.ok(agenda.codeDuScript().includes(`var SECRET = '${agenda.secret()}'`), 'le code à coller porte le secret');
  assert.ok(!agenda.codeDuScript().includes('__SECRET__'));

  const bon = G.etat.secret;
  G.etat.secret = 'autre';
  await assert.rejects(agenda.test(), /ne reconnaît pas le secret/);
  G.etat.secret = bon;

  G.etat.mode = 'login';
  await assert.rejects(agenda.test(), /Tout le monde/);
  G.etat.mode = '';

  setSetting('agenda_url', 'https://script.google.com/macros/d/abc/edit');
  await assert.rejects(agenda.test(), /doit ressembler à/);
  setSetting('agenda_url', G.url);
});

test('lecture : les événements arrivent triés, filtrés par agendas choisis, et entrent dans le radar', async () => {
  reset();
  G.etat.evenements = [
    { id: 'e2', calendrier: 'cal-pro', calendrier_nom: 'OTEA', titre: 'Montage Loft', debut: a(today, '14:00'), fin: a(today, '16:00'), journee: false, couleur: '' },
    { id: 'e1', calendrier: 'cal-perso', calendrier_nom: 'Perso', titre: 'Dentiste', debut: a(today, '09:00'), fin: a(today, '10:00'), journee: false, couleur: '' },
  ];
  const r = await agenda.lireEvenements();
  assert.deepStrictEqual(r.evenements.map((e) => e.id), ['e1', 'e2']);
  setSetting('agenda_calendriers', JSON.stringify(['cal-pro']));
  const r2 = await agenda.lireEvenements();
  assert.deepStrictEqual(r2.evenements.map((e) => e.id), ['e2'], 'seul l’agenda coché est lu');

  const bilan = await journee.rafraichir({ sources: ['agenda'] });
  assert.strictEqual(bilan.agenda.evenements, 1);
  const p = journee.plan();
  assert.ok(p.sources.agenda.branche);
  assert.strictEqual(p.agenda.evenements.length, 1);
  assert.strictEqual(p.agenda.evenements[0].heure, '14:00');
  assert.strictEqual(p.agenda.evenements[0].niveau, 1, 'montage = mot de prod = moyen');
});

// ================================================================ les signaux
test('signaux : une prod urgente ou un mot de prod devient une chose à préparer, pas un RDV perso', () => {
  reset();
  const j1 = addDays(today, 1), j2 = addDays(today, 2), j5 = addDays(today, 5);
  journee.ecrireRadar('agenda', { evenements: [
    { id: 't1', calendrier: 'cal-pro', calendrier_nom: 'OTEA', titre: 'Tournage Galec', debut: a(j2, '09:00'), fin: a(j2, '12:00'), journee: false, couleur: '11', lieu: 'Paris' },
    { id: 't2', calendrier: 'cal-pro', calendrier_nom: 'OTEA', titre: 'Livraison film Pullman', debut: a(j1, '18:00'), fin: a(j1, '18:30'), journee: false, couleur: '' },
    { id: 't3', calendrier: 'cal-pro', calendrier_nom: 'OTEA', titre: 'Point stories Gossip', debut: a(j5, '10:00'), fin: a(j5, '11:00'), journee: false, couleur: '6' },
    { id: 't4', calendrier: 'cal-perso', calendrier_nom: 'Perso', titre: 'Dentiste', debut: a(j1, '09:00'), fin: a(j1, '10:00'), journee: false, couleur: '' },
    { id: 't5', calendrier: 'cal-pro', calendrier_nom: 'OTEA', titre: 'Montage teaser', debut: a(j5, '10:00'), fin: a(j5, '11:00'), journee: false, couleur: '' },
    { id: 't6', calendrier: 'cal-pro', calendrier_nom: 'OTEA', titre: 'Truc vert', debut: a(j1, '10:00'), fin: a(j1, '11:00'), journee: false, couleur: '10' },
    { id: 't7', calendrier: 'cal-pro', calendrier_nom: 'OTEA', titre: 'Tournage passé', debut: a(addDays(today, -1), '10:00'), fin: a(addDays(today, -1), '11:00'), journee: false, couleur: '11' },
  ] });
  const items = journee.signauxAgenda(journee.lireRadar(), today, Date.now());
  const par = Object.fromEntries(items.map((i) => [i.cle, i]));
  assert.deepStrictEqual(Object.keys(par).sort(), ['agenda:t1', 'agenda:t2', 'agenda:t3'], 'le dentiste, le vert (pas urgent), le montage à 5 jours sans couleur et le passé restent dehors');
  assert.strictEqual(par['agenda:t1'].importance, 3);
  assert.match(par['agenda:t1'].titre, /^Préparer : Tournage Galec/);
  assert.match(par['agenda:t1'].pourquoi, /à 09:00 · OTEA · couleur 🔴 très urgent dans l'agenda · 📍 Paris/);
  assert.strictEqual(par['agenda:t2'].importance, 2, 'livraison demain, sans couleur : important');
  assert.match(par['agenda:t2'].titre, /^Livrer : Livraison film Pullman/);
  assert.match(par['agenda:t2'].pourquoi, /^demain à 18:00/);
  assert.strictEqual(par['agenda:t3'].importance, 2);
  assert.strictEqual(par['agenda:t3'].futur, true, 'dans 5 jours et pas vital : peut attendre');
  const p = journee.plan();
  assert.ok(p.blocs.plus_tard.some((i) => i.cle === 'agenda:t3'));
  assert.ok(p.blocs.apres_midi.some((i) => i.cle === 'agenda:t1'), 'moyen et vital : cet après-midi');
  const brief = journee.texteBrief(p);
  assert.ok(!brief.includes(TIRET));
});

// ================================================================ poser et reclasser
test('caler : une chose se pose sur un créneau, de la couleur de son urgence, puis se déplace, puis se retire', async () => {
  reset();
  setSetting('agenda_calendrier_ecriture', 'cal-pro');
  journee.ecrireRadar('agenda', { evenements: [] });
  const t = journee.ajouterTache('Relancer le devis Galec !!');
  const cle = `tache:${t.id}`;
  const debut = a(today, '11:00');
  const r = await journee.calerDansAgenda(cle, { debut, minutes: 20 });
  assert.strictEqual(r.cree, true);
  assert.strictEqual(r.heure, '11:00');
  assert.strictEqual(r.couleur, '11', 'vital = Tomate');
  const ev = G.etat.evenements[0];
  assert.strictEqual(ev.titre, '🧠 Relancer le devis Galec');
  assert.strictEqual(ev.calendrier, 'cal-pro');
  assert.match(ev.description, /Calé par OTEA Moteur/);
  assert.strictEqual(agenda.heureCourte(ev.fin), '11:20');
  assert.ok(journee.plan().agenda.cales[cle], 'la ligne sait qu’elle est calée');

  const r2 = await journee.calerDansAgenda(cle, { debut: a(today, '15:00'), minutes: 30 });
  assert.strictEqual(r2.deplace, true);
  assert.strictEqual(G.etat.evenements.length, 1, 'déplacé, pas dupliqué');
  assert.strictEqual(agenda.heureCourte(G.etat.evenements[0].debut), '15:00');

  await agenda.decaler(cle);
  assert.strictEqual(G.etat.evenements.length, 0);
  assert.strictEqual(agenda.evenementDe(cle), undefined);

  await assert.rejects(journee.calerDansAgenda('tache:999', { debut }), /plus dans la journée/);
});

test('caler ma journée : les courtes au plus tôt, la grosse pierre dans le plus grand trou, le reste dit', async () => {
  reset();
  setSetting('agenda_calendrier_ecriture', 'cal-pro');
  const now = new Date(`${today}T08:30:00`);
  G.etat.evenements = [
    { id: 'rdv', calendrier: 'cal-pro', calendrier_nom: 'OTEA', titre: 'RDV client', debut: a(today, '10:00'), fin: a(today, '12:00'), journee: false, couleur: '' },
    { id: 'aprem', calendrier: 'cal-pro', calendrier_nom: 'OTEA', titre: 'Visio', debut: a(today, '16:00'), fin: a(today, '18:30'), journee: false, couleur: '' },
  ];
  await journee.rafraichir({ sources: ['agenda'] });
  journee.ajouterTache('Répondre au mail de Claire');           // court, 10 min
  journee.ajouterTache('Rappeler William');                    // court, 10 min
  journee.ajouterTache('Monter la vidéo du Loft 3h !!');       // long : la grosse pierre
  journee.ajouterTache('Préparer le devis Pullman 45 min');    // moyen
  journee.ajouterTache('Écrire le script Gossip 2h !');        // long important : plus de trou assez grand

  const r = await journee.calerToutDansAgenda({ now });
  const heures = Object.fromEntries(r.cales.map((c) => [c.titre, c.heure]));
  assert.strictEqual(heures['Répondre au mail de Claire'], '09:00');
  assert.strictEqual(heures['Rappeler William'], '09:20', '15 min au minimum, puis 5 min de battement');
  assert.strictEqual(heures['Monter la vidéo du Loft'], '12:00', 'le plus grand trou : 12h à 16h');
  assert.strictEqual(heures['Préparer le devis Pullman'], '15:05', '45 min : plus de place le matin, après la grosse pierre');
  assert.deepStrictEqual(r.sans_place, ['Écrire le script Gossip'], 'plus de place pour 2h : on le dit');
  assert.strictEqual(G.etat.evenements.length, 2 + 4);
  const loft = G.etat.evenements.find((e) => e.titre.includes('Loft'));
  assert.strictEqual(loft.couleur, '11');
  assert.strictEqual(agenda.heureCourte(loft.fin), '15:00');

  // Deuxième passage : rien ne se pose deux fois.
  await journee.rafraichir({ sources: ['agenda'] });
  const r2 = await journee.calerToutDansAgenda({ now });
  assert.strictEqual(r2.cales.length, 0);
  assert.strictEqual(G.etat.evenements.length, 6);
});

test('urgence : un clic change la couleur de l’événement chez Google, selon le code de Maxime', async () => {
  reset();
  G.etat.evenements = [{ id: 'x', calendrier: 'cal-pro', calendrier_nom: 'OTEA', titre: 'Tournage', debut: a(today, '10:00'), fin: a(today, '11:00'), journee: false, couleur: '' }];
  await agenda.changerUrgence({ calendrier: 'cal-pro', id: 'x', niveau: 3 });
  assert.strictEqual(G.etat.evenements[0].couleur, '11');
  await agenda.changerUrgence({ calendrier: 'cal-pro', id: 'x', niveau: 0 });
  assert.strictEqual(G.etat.evenements[0].couleur, '10');
  await agenda.changerUrgence({ calendrier: 'cal-pro', id: 'x', niveau: null });
  assert.strictEqual(G.etat.evenements[0].couleur, '');
  await assert.rejects(agenda.changerUrgence({ calendrier: 'cal-pro', id: 'x', niveau: 9 }), /Niveau inconnu/);
  await assert.rejects(agenda.changerUrgence({ calendrier: 'cal-pro', id: 'absent', niveau: 1 }), /introuvable/);
});

test('rien qui sort de l’agenda ne contient de tiret cadratin', () => {
  const textes = [agenda.codeDuScript(), ...Object.values(agenda.NIVEAUX).map((n) => n.label), ...Object.values(agenda.PALETTE).map((p) => p.nom)];
  assert.ok(textes.every((t) => !t.includes(TIRET)));
});
