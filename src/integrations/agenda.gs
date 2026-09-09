// ⚙️ OTEA Moteur : pont Google Agenda.
//
// Ce script tourne CHEZ GOOGLE, sur ton compte, et sert de porte d'entrée à ton
// agenda pour OTEA Moteur : lire tes événements, poser tes tâches sur tes
// créneaux libres, changer la couleur (donc l'urgence) d'un événement.
//
// Installation (une fois, 3 minutes) :
//   1. Va sur https://script.google.com → « Nouveau projet ».
//   2. Efface tout, colle ce fichier entier, enregistre (💾), nomme le projet « OTEA Moteur ».
//   3. Déployer → Nouveau déploiement → ⚙️ type « Application web » :
//        Exécuter en tant que : MOI · Qui a accès : TOUT LE MONDE → Déployer.
//   4. Google demande l'autorisation : choisis ton compte → « Paramètres avancés »
//      → « Accéder à OTEA Moteur (non sécurisé) » : c'est TON script, sur TON compte.
//   5. Copie l'URL qui finit par /exec et colle-la dans OTEA Moteur → Réglages → Google Agenda.
//
// « Tout le monde » ne veut pas dire que ton agenda est public : sans le secret
// ci-dessous, le script répond « Mauvais secret » et rien d'autre.

var SECRET = '__SECRET__';

function doGet() {
  return reponse({ ok: true, message: 'Pont Google Agenda actif. OTEA Moteur parle à ce script en POST.' });
}

function doPost(e) {
  var req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return reponse({ error: 'Requête illisible' }); }
  if (!req.secret || req.secret !== SECRET) return reponse({ error: 'Mauvais secret' });
  try {
    return reponse(traiter(req));
  } catch (err) {
    return reponse({ error: String((err && err.message) || err) });
  }
}

function reponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function calendrier(id) {
  var cal = id ? CalendarApp.getCalendarById(id) : null;
  return cal || CalendarApp.getDefaultCalendar();
}

function trouver(req) {
  var cal = calendrier(req.calendrier);
  var ev = cal.getEventById(req.id);
  if (!ev) throw new Error('Événement introuvable dans cet agenda (déplacé ou supprimé ?)');
  return ev;
}

function traiter(req) {
  switch (req.action) {
    case 'ping':
      return {
        ok: true,
        email: Session.getActiveUser().getEmail(),
        principal: CalendarApp.getDefaultCalendar().getId(),
        calendriers: CalendarApp.getAllCalendars().map(function (c) {
          return { id: c.getId(), nom: c.getName(), couleur: c.getColor(), a_moi: c.isOwnedByMe() };
        }),
      };

    case 'evenements': {
      var de = new Date(req.de), a = new Date(req.a);
      var ids = (req.calendriers && req.calendriers.length) ? req.calendriers
        : CalendarApp.getAllCalendars().map(function (c) { return c.getId(); });
      var out = [];
      ids.forEach(function (id) {
        var cal = CalendarApp.getCalendarById(id);
        if (!cal) return;
        cal.getEvents(de, a).forEach(function (ev) {
          out.push({
            id: ev.getId(), calendrier: id, calendrier_nom: cal.getName(),
            titre: ev.getTitle(), debut: ev.getStartTime().toISOString(), fin: ev.getEndTime().toISOString(),
            journee: ev.isAllDayEvent(), couleur: ev.getColor() || '',
            description: String(ev.getDescription() || '').slice(0, 500), lieu: ev.getLocation() || '',
          });
        });
      });
      return { evenements: out };
    }

    case 'creer': {
      var cal = calendrier(req.calendrier);
      var ev = cal.createEvent(req.titre, new Date(req.debut), new Date(req.fin), { description: req.description || '' });
      if (req.couleur) ev.setColor(String(req.couleur));
      return { id: ev.getId(), calendrier: cal.getId() };
    }

    case 'couleur': {
      var ev2 = trouver(req);
      ev2.setColor(req.couleur ? String(req.couleur) : '');
      return { ok: true };
    }

    case 'deplacer': {
      trouver(req).setTime(new Date(req.debut), new Date(req.fin));
      return { ok: true };
    }

    case 'supprimer': {
      trouver(req).deleteEvent();
      return { ok: true };
    }

    default:
      throw new Error('Action inconnue : ' + req.action);
  }
}
