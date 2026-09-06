'use strict';
// La file du jour doit TOURNER. Le bug signalé par Maxime : « sur la session
// d'appels, c'est toujours les mêmes contacts ». Trois causes, trois garde-fous
// ici : le report qui ramenait la personne dès le lendemain, la cadence qui
// bouclait à l'infini, et le score figé qui servait éternellement le même haut
// de classement pendant que le reste du fichier n'était jamais appelé.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-rotation-test-'));

const dbApi = require('../src/db');
const game = require('../src/gamification');
const playbooks = require('../src/playbooks');

test.after(() => { try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

function creer(nom, extra = {}) {
  return dbApi.insertContact({
    first_name: nom, last_name: 'Test', phone: '06 00 00 ' + nom.length + ' ' + nom.charCodeAt(0),
    segment: 'pme', stage: 'a_contacter', ...extra,
  });
}
const vide = () => { dbApi.run('DELETE FROM activities'); dbApi.run('DELETE FROM contacts'); };
const ecart = (fiche) => {
  const j = dbApi.localDay();
  let n = 0;
  while (dbApi.addDays(j, n) < fiche.next_action_at && n < 400) n++;
  return n;
};

test('« pas maintenant » repousse de plus en plus loin', () => {
  vide();
  const { id } = creer('Nadia');
  const vus = [];
  for (let i = 0; i < 5; i++) {
    game.logAction({ contact_id: id, type: 'reporte' });
    vus.push(ecart(dbApi.get('SELECT * FROM contacts WHERE id = ?', id)));
  }
  assert.deepStrictEqual(vus, playbooks.REPORTS, `attendu ${playbooks.REPORTS}, obtenu ${vus}`);
  // Et surtout : jamais le lendemain, c'était ça le bug.
  assert.ok(vus.every((j) => j > 1), 'un report ne ramène jamais la personne dès demain');
});

test('la cadence ne boucle pas : après la séquence, les relances s’espacent', () => {
  vide();
  const { id } = creer('Bruno');
  const ecarts = [];
  for (let i = 0; i < 7; i++) {
    const fiche = dbApi.get('SELECT * FROM contacts WHERE id = ?', id);
    // On ramène la date à aujourd'hui pour mesurer l'écart de chaque étape.
    dbApi.updateContact(id, { next_action_at: dbApi.localDay() });
    game.logAction({ contact_id: id, type: 'appel' });
    ecarts.push(ecart(dbApi.get('SELECT * FROM contacts WHERE id = ?', id)));
    assert.ok(fiche);
  }
  const croissant = ecarts.every((v, i) => i === 0 || v >= ecarts[i - 1]);
  assert.ok(croissant, `les écarts doivent grandir, obtenu ${ecarts}`);
  assert.ok(ecarts.at(-1) >= 30, `après 7 relances sans réponse on espace vraiment (obtenu ${ecarts.at(-1)} j)`);
});

test('un prospect jamais appelé passe devant un prospect relancé sans succès', () => {
  vide();
  const acharne = creer('Acharne');
  const neuf = creer('Neuf');
  for (let i = 0; i < 5; i++) dbApi.run(
    "INSERT INTO activities (contact_id, type, xp, note, day, created_at) VALUES (?, 'appel', 0, '', ?, ?)",
    acharne.id, dbApi.localDay(), dbApi.nowIso());

  const hist = game.historiqueParContact();
  const sAcharne = game.contactScore(dbApi.get('SELECT * FROM contacts WHERE id = ?', acharne.id), hist.get(acharne.id).tentatives);
  const sNeuf = game.contactScore(dbApi.get('SELECT * FROM contacts WHERE id = ?', neuf.id), 0);
  assert.ok(sNeuf > sAcharne, `le neuf (${sNeuf}) doit passer devant l'acharné (${sAcharne})`);
});

test('mais un devis envoyé ne subit pas cette fatigue', () => {
  vide();
  const { id } = creer('Devis', { stage: 'devis_envoye' });
  const fiche = dbApi.get('SELECT * FROM contacts WHERE id = ?', id);
  assert.strictEqual(game.contactScore(fiche, 0), game.contactScore(fiche, 8),
    'sur un devis, les relances sont un bon signe, pas de la fatigue');
});

test('la moitié de la liste est réservée à des gens jamais présentés', () => {
  vide();
  // 6 contacts déjà relancés et dus aujourd'hui, 6 jamais touchés.
  for (let i = 0; i < 6; i++) {
    const { id } = creer('Vieux' + i, { is_former_client: 1, revenue_history: 9000 });
    dbApi.updateContact(id, { next_action_at: dbApi.localDay(), stage: 'contacte' });
    dbApi.run("INSERT INTO activities (contact_id, type, xp, note, day, created_at) VALUES (?, 'appel', 0, '', ?, ?)",
      id, dbApi.addDays(dbApi.localDay(), -9), dbApi.nowIso());
  }
  for (let i = 0; i < 6; i++) creer('Neuf' + i);

  const file = game.callQueue(6);
  const neufs = file.filter((c) => c.first_name.startsWith('Neuf')).length;
  assert.strictEqual(file.length, 6);
  assert.ok(neufs >= 3, `au moins la moitié de nouvelles têtes, obtenu ${neufs}/6 : ${file.map((c) => c.first_name).join(' ')}`);
});

test('sur deux semaines, tout le fichier passe : plus de boucle sur les mêmes', () => {
  vide();
  for (let i = 1; i <= 40; i++) {
    dbApi.insertContact({
      first_name: 'P' + String(i).padStart(2, '0'), last_name: 'X', company: 'Boite ' + i,
      phone: '06 00 00 00 ' + String(i).padStart(2, '0'), email: i % 3 ? `p${i}@x.fr` : '',
      segment: ['grand_compte', 'pme', 'pme', 'inconnu', 'b2c_event'][i % 5], stage: 'a_contacter',
      is_former_client: i <= 5 ? 1 : 0, revenue_history: i <= 5 ? 4000 : 0,
    });
  }
  // « Un jour passe » : on recule d'un jour tout ce qui est daté.
  const jourSuivant = () => {
    dbApi.run("UPDATE contacts SET next_action_at = date(next_action_at, '-1 day') WHERE next_action_at != ''");
    dbApi.run("UPDATE contacts SET last_touch_at = datetime(last_touch_at, '-1 day') WHERE last_touch_at != ''");
    dbApi.run("UPDATE activities SET day = date(day, '-1 day')");
  };

  const vus = new Map();
  for (let jour = 0; jour < 14; jour++) {
    const file = game.callQueue(5);
    file.forEach((c, i) => {
      vus.set(c.first_name, (vus.get(c.first_name) || 0) + 1);
      // Personne ne décroche : 4 appels notés, 1 reporté. Le pire des cas.
      game.logAction({ contact_id: c.id, type: i < 4 ? 'appel' : 'reporte' });
    });
    jourSuivant();
  }
  const passagesMax = Math.max(...vus.values());
  assert.ok(vus.size >= 34, `il doit voir presque tout le fichier, vu ${vus.size}/40`);
  assert.ok(passagesMax <= 4, `personne ne doit revenir sans arrêt, max observé ${passagesMax}`);
});
