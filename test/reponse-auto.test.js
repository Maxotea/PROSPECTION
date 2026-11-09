'use strict';
// Une réponse automatique n'est pas une réponse (cas Hugo Boutet, Panenka, 09/11/2026).
const test = require('node:test');
const assert = require('node:assert');
const { estReponseAutomatique } = require('../src/mail/reponse-auto');

const auto = (x) => estReponseAutomatique(x).auto;

test('les en-têtes posés par les serveurs suffisent', () => {
  assert.ok(auto({ subject: 'Re: échange rapide ?', headers: { 'auto-submitted': 'auto-replied' } }));
  assert.ok(auto({ subject: 'Re: échange rapide ?', headers: { 'x-autoreply': 'yes' } }));
  assert.ok(auto({ subject: 'Re: échange rapide ?', headers: { precedence: 'auto_reply' } }));
  assert.ok(auto({ subject: 'Re: échange rapide ?', headers: { 'x-auto-response-suppress': 'All' } }));
  assert.ok(!auto({ subject: 'Re: échange rapide ?', headers: { 'auto-submitted': 'no' } }));
});

test('les objets d’absence, en français et en anglais', () => {
  for (const s of ['Réponse automatique : Re: échange rapide ?', 'Automatic reply: On remet ça ?', 'Absent du bureau', 'Out of Office: Re: devis',
    'Absente jusqu’au 16/11', 'En congés jusqu’au lundi', 'Accusé de réception', 'Votre message a bien été reçu', 'Hugo Boutet ne fait plus partie de Panenka']) {
    assert.ok(auto({ subject: s }), s);
  }
});

test('un humain qui parle d’absence ou de congés n’est pas pris pour un robot', () => {
  for (const s of ['Re: absence de réponse du client', 'Re: échange rapide ?', 'Re: vidéo de nos congés annuels', 'Merci pour votre retour', 'Re: Je suis actuellement intéressé']) {
    assert.ok(!auto({ subject: s }), s);
  }
});

test('le motif dit pourquoi', () => {
  const r = estReponseAutomatique({ subject: 'Réponse automatique : Re: échange rapide ?' });
  assert.match(r.motif, /objet/);
});
