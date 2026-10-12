'use strict';
/* Page de connexion : deux petits confort, rien de plus.
   · « Afficher » le mot de passe, pour vérifier ce qu'on a tapé au téléphone ;
   · le bouton dit qu'il travaille, et on ne l'envoie pas deux fois. */
(function () {
  const champ = document.getElementById('c-code');
  const voir = document.getElementById('c-voir');
  const form = champ && champ.form;
  if (voir && champ) {
    voir.hidden = false;
    voir.addEventListener('click', () => {
      const visible = champ.type === 'text';
      champ.type = visible ? 'password' : 'text';
      voir.textContent = visible ? 'Afficher' : 'Masquer';
      voir.setAttribute('aria-pressed', visible ? 'false' : 'true');
      champ.focus();
    });
  }
  if (form) {
    form.addEventListener('submit', (e) => {
      const bouton = form.querySelector('.c-entrer');
      if (!champ.value.trim()) { e.preventDefault(); champ.focus(); return; }
      if (bouton.getAttribute('aria-busy') === 'true') { e.preventDefault(); return; }
      bouton.setAttribute('aria-busy', 'true');
      bouton.textContent = 'Vérification…';
    });
  }
}());
