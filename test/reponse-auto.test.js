'use strict';
// Une réponse automatique n'est pas une réponse : absence du bureau, accusé de
// réception, répondeur. Seul un humain qui écrit compte.

const test = require('node:test');
const assert = require('node:assert');
const ra = require('../src/mail/reponse_auto');

test('absence du bureau : à l’objet, dans le texte, en français ou en anglais', () => {
  assert.deepStrictEqual(ra.analyser({ subject: 'Réponse automatique : Absence du bureau' }), { auto: true, type: 'absence', pause: 7 });
  assert.strictEqual(ra.analyser({ subject: 'Automatic reply: Re: On remet ça ?' }).type, 'absence');
  assert.strictEqual(ra.analyser({ subject: 'Re: On remet ça ?', texte: 'Bonjour, je suis actuellement absent et de retour le 17 novembre.' }).type, 'absence');
  assert.strictEqual(ra.analyser({ subject: 'Out of Office: devis' }).type, 'absence');
});

test('accusé de réception et répondeurs de plateforme : automatique, sans pause', () => {
  assert.deepStrictEqual(ra.analyser({ subject: 'Accusé de réception de votre demande' }), { auto: true, type: 'accuse', pause: 0 });
  assert.strictEqual(ra.analyser({ subject: 'Re: Film', texte: 'Nous avons bien reçu votre message, ticket #4521 ouvert.' }).type, 'accuse');
  assert.strictEqual(ra.analyser({ subject: 'Re: Film', auto_submitted: 'auto-replied' }).type, 'automatique');
  assert.strictEqual(ra.analyser({ subject: 'Re: Film', precedence: 'auto_reply' }).type, 'automatique');
  assert.strictEqual(ra.analyser({ subject: 'Re: Film', x_auto_response_suppress: 'OOF' }).type, 'automatique');
});

test('une vraie réponse reste une vraie réponse', () => {
  assert.strictEqual(ra.estReponseAutomatique({ subject: 'Re: On remet ça ?', texte: 'Oui, avec plaisir, on se cale un café la semaine prochaine ?' }), false);
  assert.strictEqual(ra.estReponseAutomatique({ subject: 'Re: Devis', auto_submitted: 'no' }), false);
  assert.strictEqual(ra.estReponseAutomatique({ subject: 'Merci pour le devis, je reviens vers vous jeudi' }), false);
  assert.strictEqual(ra.estReponseAutomatique({}), false);
});

test('les libellés parlent français, sans tiret cadratin', () => {
  for (const t of ['absence', 'accuse', 'automatique']) {
    const l = ra.libelle(t);
    assert.ok(l.length > 3 && !/[\u2014\u2013]/.test(l));
  }
});
