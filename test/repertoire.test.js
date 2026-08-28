'use strict';
// Tests du répertoire chaud : on fabrique de fausses bases SQLite au format
// macOS / WhatsApp et de vrais exports .txt, puis on vérifie que le moteur
// retrouve les bonnes personnes : et surtout qu'il écarte le bruit.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chasse-rep-test-'));
process.env.DATA_DIR = DATA_DIR;

const sig = require('../src/importers/signaux');
const appels = require('../src/importers/appels');
const whatsapp = require('../src/importers/whatsapp');
const repertoire = require('../src/importers/repertoire');
const bl = require('../src/importers/bases_locales');

const EPOCH_2001 = 978307200;
const versCoreData = (date) => date.getTime() / 1000 - EPOCH_2001;
const ilYA = (jours) => new Date(Date.now() - jours * 86400000);

test.after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

// ---------------------------------------------------------------- numéros
test('normalise les numéros écrits de dix façons différentes', () => {
  const attendu = '+33611223344';
  for (const brut of ['06 11 22 33 44', '+33 6 11 22 33 44', '0033611223344', '06.11.22.33.44', '+33611223344']) {
    assert.strictEqual(sig.normPhone(brut), attendu, `échec sur ${brut}`);
  }
  assert.strictEqual(sig.phoneKey('06 11 22 33 44'), sig.phoneKey('+33611223344'));
  assert.strictEqual(sig.joliTelephone('+33611223344'), '06 11 22 33 44');
});

test('écarte les numéros de service et garde les mobiles', () => {
  assert.ok(sig.estNumeroDeService('3949'));
  assert.ok(sig.estNumeroDeService('0899123456'));
  assert.ok(!sig.estNumeroDeService('0611223344'));
  assert.ok(!sig.estNumeroDeService('+33611223344'));
});

// ---------------------------------------------------------------- signaux
test('repère le vocabulaire de travail malgré les accents manquants', () => {
  const avec = sig.motsBusinessTrouves('Tu peux m envoyer un devis pour le tournage ? budget ok');
  assert.ok(avec.includes('devis'));
  assert.ok(avec.includes('tournage'));
  assert.deepStrictEqual(sig.motsBusinessTrouves('on prevoit une video'), ['vidéo']); // sans accent → trouvé, affiché correctement
  assert.deepStrictEqual(sig.motsBusinessTrouves('Bonne soirée à tous'), []);
});

test('reconnaît le bruit automatique', () => {
  assert.ok(sig.ressembleAuBruit({ texte: 'Votre code de vérification est 4821' }));
  assert.ok(sig.ressembleAuBruit({ texte: 'votre colis arrive demain' }));
  assert.ok(sig.ressembleAuBruit({ phone: '3949' }));
  assert.ok(!sig.ressembleAuBruit({ nom: 'Claire Arnaud', texte: 'on se cale un tournage ?', phone: '+33611223344' }));
});

test('un devis discuté il y a deux ans bat un bavardage récent sans enjeu', () => {
  // Le cas qui compte pour Maxime : retrouver un DEAL perdu, pas le copain
  // à qui il a envoyé trois messages la semaine dernière.
  const dealDormant = sig.scoreRelation({
    last_at: ilYA(440).toISOString(), calls: 0, messages: 6, incoming: 3, outgoing: 3,
    duration_sec: 0, signaux: ['budget', 'devis', 'tournage', 'vidéo', 'séminaire', 'projet'],
  });
  const bavardageRecent = sig.scoreRelation({
    last_at: ilYA(7).toISOString(), calls: 0, messages: 4, incoming: 2, outgoing: 2,
    duration_sec: 0, signaux: ['dispo'],
  });
  assert.ok(dealDormant > bavardageRecent, `deal dormant (${dealDormant}) doit passer devant le bavardage (${bavardageRecent})`);
  assert.ok(dealDormant >= 45, `le deal dormant doit être pré-coché (${dealDormant}/100)`);
});

test('note haut une relation récente et bavarde, bas un contact mort', () => {
  const chaud = sig.scoreRelation({ last_at: ilYA(5).toISOString(), calls: 4, messages: 60, incoming: 2, outgoing: 2, duration_sec: 1200, signaux: ['devis', 'tournage'] });
  const froid = sig.scoreRelation({ last_at: ilYA(900).toISOString(), calls: 1, messages: 0, incoming: 1, outgoing: 0, duration_sec: 15, signaux: [] });
  assert.ok(chaud >= 60, `attendu chaud, reçu ${chaud}`);
  assert.strictEqual(sig.temperature(chaud), 'chaud');
  assert.ok(froid < 35, `attendu froid, reçu ${froid}`);
  assert.strictEqual(sig.temperature(froid), 'froid');
});

// ---------------------------------------------------------------- historique d'appels
function fausseBaseAppels(fichier, lignes) {
  const db = new DatabaseSync(fichier);
  db.exec(`CREATE TABLE ZCALLRECORD (
    Z_PK INTEGER PRIMARY KEY, ZADDRESS BLOB, ZDATE REAL, ZDURATION REAL,
    ZORIGINATED INTEGER, ZANSWERED INTEGER, ZNAME TEXT, ZSERVICE_PROVIDER TEXT)`);
  const ins = db.prepare('INSERT INTO ZCALLRECORD (ZADDRESS, ZDATE, ZDURATION, ZORIGINATED, ZANSWERED, ZNAME) VALUES (?, ?, ?, ?, ?, ?)');
  for (const l of lignes) ins.run(Buffer.from(l.address), versCoreData(l.date), l.duration, l.originated, 1, l.name || null);
  db.close();
}

test("lit une base d'appels macOS et agrège par correspondant", () => {
  const f = path.join(DATA_DIR, 'CallHistory.storedata');
  fausseBaseAppels(f, [
    { address: '+33611223344', date: ilYA(3), duration: 320, originated: 1, name: 'Claire Arnaud' },
    { address: '0611223344', date: ilYA(10), duration: 180, originated: 0 },   // même personne, autre écriture
    { address: '+33611223344', date: ilYA(40), duration: 2, originated: 1 },   // raccroché : ne compte pas
    { address: '+33788990011', date: ilYA(500), duration: 90, originated: 1 }, // hors fenêtre de 365 j
    { address: '3949', date: ilYA(2), duration: 300, originated: 1 },          // service : écarté
  ]);

  const conn = bl.ouvrirLecture(f);
  const dispo = bl.colonnes(conn.db, 'ZCALLRECORD');
  conn.close();
  assert.ok(dispo.includes('ZADDRESS'), 'le schéma doit être introspectable');

  const lignes = [
    { address: Buffer.from('+33611223344'), date: ilYA(3).toISOString(), duration: 320, originated: 1, name: 'Claire Arnaud' },
    { address: Buffer.from('0611223344'), date: ilYA(10).toISOString(), duration: 180, originated: 0, name: '' },
    { address: Buffer.from('+33611223344'), date: ilYA(40).toISOString(), duration: 2, originated: 1, name: '' },
    { address: Buffer.from('+33788990011'), date: ilYA(500).toISOString(), duration: 90, originated: 1, name: '' },
    { address: Buffer.from('3949'), date: ilYA(2).toISOString(), duration: 300, originated: 1, name: '' },
  ];
  const out = appels.agreger(lignes, { days: 365 });
  assert.strictEqual(out.length, 1, 'un seul correspondant retenu');
  const claire = out[0];
  assert.strictEqual(claire.name, 'Claire Arnaud');
  assert.strictEqual(claire.calls, 2, 'les appels de 2 secondes ne comptent pas');
  assert.strictEqual(claire.outgoing, 1);
  assert.strictEqual(claire.incoming, 1);
  assert.strictEqual(claire.duration_sec, 500);
});

test('lit un CSV d’appels Android', () => {
  const rows = [
    { number: '+33611223344', date: String(ilYA(4).getTime()), duration: '240', type: 'sortant', name: 'Claire Arnaud' },
    { number: '+33611223344', date: String(ilYA(6).getTime()), duration: '120', type: 'entrant', name: '' },
  ];
  const out = appels.lireCsv(rows, { days: 365 });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].calls, 2);
  assert.strictEqual(out[0].outgoing, 1);
  assert.strictEqual(out[0].incoming, 1);
});

// ---------------------------------------------------------------- WhatsApp : base locale
function fausseBaseWhatsapp(fichier, sessions) {
  const db = new DatabaseSync(fichier);
  db.exec(`CREATE TABLE ZWACHATSESSION (
    Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZPARTNERNAME TEXT,
    ZLASTMESSAGEDATE REAL, ZMESSAGECOUNTER INTEGER)`);
  db.exec(`CREATE TABLE ZWAMESSAGE (
    Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER, ZISFROMME INTEGER,
    ZMESSAGEDATE REAL, ZTEXT TEXT)`);
  const insS = db.prepare('INSERT INTO ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME, ZLASTMESSAGEDATE, ZMESSAGECOUNTER) VALUES (?, ?, ?, ?, ?)');
  const insM = db.prepare('INSERT INTO ZWAMESSAGE (ZCHATSESSION, ZISFROMME, ZMESSAGEDATE, ZTEXT) VALUES (?, ?, ?, ?)');
  for (const s of sessions) {
    insS.run(s.pk, s.jid, s.nom, versCoreData(s.last), s.messages.length);
    for (const m of s.messages) insM.run(s.pk, m.fromMe ? 1 : 0, versCoreData(m.date), m.texte);
  }
  db.close();
}

test('lit la base WhatsApp du Mac, ignore les groupes et le bruit', () => {
  const f = path.join(DATA_DIR, 'ChatStorage.sqlite');
  fausseBaseWhatsapp(f, [
    {
      pk: 1, jid: '33611223344@s.whatsapp.net', nom: 'Claire Arnaud', last: ilYA(6),
      messages: [
        { fromMe: false, date: ilYA(6), texte: 'On peut caler le tournage la semaine prochaine ? Envoie-moi un devis' },
        { fromMe: true, date: ilYA(7), texte: 'Oui bien sûr, je te prépare ça' },
      ],
    },
    { pk: 2, jid: '120363000000000000@g.us', nom: 'Famille', last: ilYA(1), messages: [{ fromMe: false, date: ilYA(1), texte: 'coucou' }] },
    { pk: 3, jid: '33700000000@s.whatsapp.net', nom: 'Banque', last: ilYA(2), messages: [{ fromMe: false, date: ilYA(2), texte: 'Votre code de vérification est 4821' }] },
  ]);

  // On appelle le lecteur bas niveau via une base copiée, comme en production.
  const conn = bl.ouvrirLecture(f);
  const sessions = conn.db.prepare('SELECT Z_PK AS pk, ZCONTACTJID AS jid, ZPARTNERNAME AS nom FROM ZWACHATSESSION').all();
  conn.close();
  assert.strictEqual(sessions.length, 3);

  assert.ok(whatsapp.estGroupe('120363000000000000@g.us'));
  assert.strictEqual(whatsapp.jidVersTelephone('33611223344@s.whatsapp.net'), '+33611223344');
  assert.strictEqual(whatsapp.jidVersTelephone('120363000000000000@g.us'), '');
});

// ---------------------------------------------------------------- WhatsApp : exports .txt
test('parse un export iOS français (avec marques invisibles)', () => {
  const LRM = '‎';
  const texte = [
    `${LRM}[03/12/2024 14:32:11] Claire Arnaud : Salut Maxime !`,
    `${LRM}[03/12/2024 14:35:02] Maxime : Salut Claire`,
    `[04/12/2024 09:10:00] Claire Arnaud : Tu peux m'envoyer un devis pour le tournage ?`,
    'suite du message sur une autre ligne',
  ].join('\n');

  const r = whatsapp.parseExport(texte, { moi: 'Maxime', days: 36500 });
  assert.strictEqual(r.monNom, 'Maxime');
  assert.strictEqual(r.entries.length, 1, 'seul le correspondant est retenu');
  const claire = r.entries[0];
  assert.strictEqual(claire.name, 'Claire Arnaud');
  assert.strictEqual(claire.incoming, 2);
  assert.strictEqual(claire.outgoing, 1);
  assert.ok(claire.signaux.includes('devis'));
  assert.ok(claire.signaux.includes('tournage'));
  assert.ok(claire.excerpt.includes('suite du message'), 'les lignes de continuation sont recollées');
  assert.strictEqual(String(claire.last_at).slice(0, 10), '2024-12-04');
});

test('dans une discussion de groupe, mes messages ne contaminent personne', () => {
  // Piège : si on recolle mes messages à chaque participant, celui qui n'a jamais
  // parlé d'argent hérite du « devis » écrit à quelqu'un d'autre : et remonte à tort.
  const texte = [
    '[03/12/2024 14:32:11] Claire Arnaud : On voudrait une vidéo pour le séminaire',
    '[03/12/2024 14:35:02] Maxime : Je te prépare un devis tout de suite',
    '[03/12/2024 15:00:00] Karim Slimani : Moi je passe juste dire bonjour',
  ].join('\n');
  const r = whatsapp.parseExport(texte, { moi: 'Maxime', days: 36500 });
  const karim = r.entries.find((e) => e.name === 'Karim Slimani');
  const claire = r.entries.find((e) => e.name === 'Claire Arnaud');
  assert.ok(karim, 'Karim est bien détecté');
  assert.ok(!karim.signaux.includes('devis'), 'Karim n’hérite pas du devis écrit à Claire');
  assert.strictEqual(karim.messages, 1, 'ses messages à lui, pas les miens');
  assert.ok(claire.signaux.includes('vidéo'));
});

test('en tête-à-tête, mes propres messages comptent dans l’analyse', () => {
  const texte = [
    '[03/12/2024 14:32:11] Claire Arnaud : On voudrait une vidéo pour le séminaire',
    '[03/12/2024 14:35:02] Maxime : Je te prépare un devis tout de suite',
  ].join('\n');
  const r = whatsapp.parseExport(texte, { moi: 'Maxime', days: 36500 });
  assert.strictEqual(r.entries.length, 1);
  const claire = r.entries[0];
  assert.ok(claire.signaux.includes('devis'), 'le devis que J’AI proposé prouve la négociation');
  assert.strictEqual(claire.messages, 2, 'les deux côtés comptent dans un tête-à-tête');
  assert.strictEqual(claire.outgoing, 1);
});

test('parse un export Android français (séparateur tiret)', () => {
  const texte = [
    '03/12/2024 à 14:32 - Claire Arnaud : Salut',
    '03/12/2024 à 14:33 - Maxime : Salut',
  ].join('\n');
  const r = whatsapp.parseExport(texte, { moi: 'Maxime', days: 36500 });
  assert.strictEqual(r.entries.length, 1);
  assert.strictEqual(r.entries[0].name, 'Claire Arnaud');
});

test('parse un export anglais avec AM/PM et année sur deux chiffres', () => {
  const texte = [
    '[3/12/24, 2:32:11 PM] Claire Arnaud: Hi',
    '[3/12/24, 2:40:00 PM] Maxime: Hello',
  ].join('\n');
  const r = whatsapp.parseExport(texte, { moi: 'Maxime', days: 36500 });
  assert.strictEqual(r.entries.length, 1);
  const d = new Date(r.entries[0].last_at);
  assert.strictEqual(d.getFullYear(), 2024);
  assert.strictEqual(d.getHours(), 14, 'PM converti en 24 h');
});

test('refuse un fichier qui n’est pas un export WhatsApp', () => {
  assert.throws(() => whatsapp.parseExport('Bonjour, ceci est un simple mail.'), /Aucun message reconnu/);
});

// ---------------------------------------------------------------- fusion et import
test('fusionne la même personne vue dans les appels et dans WhatsApp', () => {
  const fusion = repertoire.fusionner([
    [{ source: 'appels', key: 'tel:611223344', name: 'Claire Arnaud', phone: '+33611223344', calls: 3, messages: 0, incoming: 1, outgoing: 2, duration_sec: 600, last_at: ilYA(10).toISOString(), signaux: [] }],
    [{ source: 'whatsapp', key: 'wa:611223344', name: '', phone: '+33611223344', calls: 0, messages: 42, incoming: 20, outgoing: 22, duration_sec: 0, last_at: ilYA(2).toISOString(), signaux: ['devis'], excerpt: 'On signe quand ?' }],
  ]);
  assert.strictEqual(fusion.length, 1);
  const c = fusion[0];
  assert.strictEqual(c.name, 'Claire Arnaud', 'le nom vient des appels');
  assert.strictEqual(c.calls, 3);
  assert.strictEqual(c.messages, 42);
  assert.deepStrictEqual(c.sources.sort(), ['appels', 'whatsapp']);
  assert.strictEqual(String(c.last_at).slice(0, 10), ilYA(2).toISOString().slice(0, 10), 'on garde la date la plus récente');
  assert.strictEqual(c.excerpt, 'On signe quand ?');
});

test('écrit une note lisible et découpe le nom correctement', () => {
  const note = repertoire.resumeRelation({
    calls: 3, duration_sec: 900, messages: 42, last_at: '2025-06-10T10:00:00.000Z',
    signaux: ['devis', 'tournage'], excerpt: 'On signe quand ?',
  });
  assert.match(note, /3 appel\(s\) \(15 min au total\)/);
  assert.match(note, /42 message\(s\) WhatsApp/);
  assert.match(note, /mots repérés : devis, tournage/);
  assert.match(note, /« On signe quand \? »/);

  assert.deepStrictEqual(repertoire.decouperNom('Claire Arnaud'), { first_name: 'Claire', last_name: 'Arnaud' });
  assert.deepStrictEqual(repertoire.decouperNom('Jean-Pierre De La Tour'), { first_name: 'Jean-Pierre', last_name: 'De La Tour' });
  assert.deepStrictEqual(repertoire.decouperNom(''), { first_name: '', last_name: '' });
});

test('importe dans le CRM, reconnaît un contact déjà présent et alimente l’accroche', () => {
  const dbApi = require('../src/db');
  dbApi.insertContact({ first_name: 'Claire', last_name: 'Arnaud', phone: '06 11 22 33 44', company: 'Maison Arnaud' });

  const entree = {
    source: 'whatsapp', sources: ['appels', 'whatsapp'], key: 'wa:611223344',
    name: 'Claire Arnaud', phone: '+33611223344',
    calls: 2, messages: 30, incoming: 15, outgoing: 15, duration_sec: 600,
    last_at: ilYA(3).toISOString(), signaux: ['devis'], excerpt: 'On relance le projet ?',
  };

  // Le croisement doit la retrouver malgré l'écriture différente du numéro.
  const prepare = repertoire.preparer([entree]);
  assert.ok(prepare.entries[0].existing_id, 'contact existant retrouvé via le numéro');
  assert.strictEqual(prepare.stats.nouveaux, 0);

  const r = repertoire.importer([entree]);
  assert.strictEqual(r.created, 0, 'pas de doublon créé');
  assert.strictEqual(r.merged, 1);

  const fiche = dbApi.get('SELECT * FROM contacts WHERE phone != ?', '');
  assert.match(fiche.notes, /2 appel\(s\)/, 'la note de relation nourrit la fiche (et donc les accroches)');

  // Un inconnu, lui, crée bien une fiche.
  const nouveau = repertoire.importer([{ ...entree, name: 'Karim Slimani', phone: '+33788990011', key: 'wa:788990011', sources: ['appels'] }]);
  assert.strictEqual(nouveau.created, 1);
  const karim = dbApi.get('SELECT * FROM contacts WHERE last_name = ?', 'Slimani');
  assert.strictEqual(karim.origin, 'appels');
  assert.strictEqual(karim.stage, 'a_contacter', 'il atterrit directement dans la file de chasse');
});

test('un accès refusé par macOS ne se dit jamais « pas installé »', () => {
  // Le bug signalé par Maxime : WhatsApp est bien là, mais macOS interdit la
  // lecture du dossier. statSync échoue dans les deux cas, et confondre les deux
  // revient à envoyer quelqu'un réinstaller une app qu'il a déjà.
  const bl = require('../src/importers/bases_locales');

  const refus = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
  assert.ok(bl.estRefusMacos(refus));
  assert.ok(!bl.estRefusMacos(Object.assign(new Error('no such file'), { code: 'ENOENT' })));

  // Fichier vraiment absent : état « absent ».
  const vide = path.join(DATA_DIR, 'nulle-part', 'rien.sqlite');
  assert.deepStrictEqual(bl.chercher([vide]), { chemin: null, etat: 'absent' });

  // Fichier bien présent : état « trouve ».
  const present = path.join(DATA_DIR, 'present.sqlite');
  fs.writeFileSync(present, 'x');
  assert.deepStrictEqual(bl.chercher([present]), { chemin: present, etat: 'trouve' });

  // Et les messages disent trois choses différentes.
  const conseilMac = 'conseil pour le Mac';
  assert.match(bl.expliquerAbsence('refuse', 'tes discussions', conseilMac), /Accès complet au disque/);
  const horsMac = bl.expliquerAbsence('absent', 'tes discussions WhatsApp', conseilMac);
  if (process.platform === 'darwin') {
    assert.strictEqual(horsMac, conseilMac);
  } else {
    assert.match(horsMac, /tourne sur un serveur en ligne/);
    assert.match(horsMac, /pont-mac\.command/);
    assert.ok(!/n'est pas installé/.test(horsMac), 'on n’accuse pas l’app d’être absente');
  }
});
