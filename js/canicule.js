/* Fournaise — alerte canicule sans serveur : prévision à 7 jours, plan adapté au logement, notification à l'ouverture,
   rappels dans l'agenda. Dépend de js/app.js et js/heatwave.js. Rien n'est envoyé à Fournaise : la prévision vient d'Open-Meteo,
   appelée seulement quand tu le demandes, avec une position arrondie à environ 1 km. */
(function () {
  "use strict";
  var A = window.FournaiseApp, H = window.FournaiseHeat;
  if (!A || !H) return;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "fournaise-alert";
  var VIGILANCE = "https://vigilance.meteofrance.fr/fr";
  var last = null;   // { days, a, loc }

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function write(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
    // Copie lisible par le service worker (qui n'a pas accès à localStorage).
    if (window.caches) caches.open("fournaise-prefs").then(function (c) { return c.put("prefs", new Response(JSON.stringify(v))); }).catch(function () {});
  }
  function here() {
    var l = A.state.location;
    return l ? { lat: Math.round(l.lat * 100) / 100, lon: Math.round(l.lon * 100) / 100, label: l.label } : null;
  }

  // ---------------------------------------------------------------- prévision
  function fetchForecast(loc) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    return fetch(H.url(loc.lat, loc.lon), ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) { var days = H.parse(j); return { days: days, a: H.analyze(days), loc: loc }; }, function (e) { clearTimeout(timer); throw e; });
  }

  function renderForecast(f) {
    var days = f.days, a = f.a, box = $("al-result");
    var max = Math.max(36, Math.ceil(a.maxTx)), min = 8;
    var h = function (t) { return Math.max(4, ((t - min) / (max - min)) * 100).toFixed(0); };
    var title = a.level === "wave" ? "Vague de chaleur possible du " + H.dayName(a.from) + (a.from === a.to ? "" : " au " + H.dayName(a.to))
      : a.level === "tropical" ? "Pas de vague de chaleur, mais " + a.tropical + " nuit" + (a.tropical > 1 ? "s" : "") + " au-dessus de 20 °C"
      : "Pas de vague de chaleur prévue ces 7 prochains jours";
    box.innerHTML =
      '<p class="al-status ' + a.level + '"><strong>' + A.escapeHtml(title) + "</strong></p>" +
      '<ol class="al-days" aria-label="Prévision des 7 prochains jours à ' + A.escapeHtml(f.loc.label || "ce logement") + '">' + days.map(function (d, i) {
        return '<li class="' + (a.wave[i] ? "hot" : "") + '"><span class="al-vals"><b>' + Math.round(d.tx) + '°</b><span>' + Math.round(d.tn) + '°</span></span>' +
          '<span class="al-bars" aria-hidden="true"><i style="height:' + h(d.tx) + "%;background:" + A.tempColor(d.tx - 2) + '"></i><i style="height:' + h(d.tn) + "%;background:" + A.tempColor(d.tn + 3) + '"></i></span>' +
          '<span class="al-day">' + A.escapeHtml(H.dayName(d.date, { weekday: "short", day: "numeric" })) + "</span>" +
          '<span class="sr-only">maximum ' + Math.round(d.tx) + " degrés, minimum " + Math.round(d.tn) + " degrés" + (a.wave[i] ? ", chaleur forte" : "") + "</span></li>";
      }).join("") + "</ol>" +
      '<p class="caption">Maximum en gras, minimum en dessous. Repère : Fournaise parle de vague quand la moyenne sur 3 jours dépasse environ 21 °C la nuit et 31 °C le jour (ordre de grandeur de Paris). La vigilance officielle est celle de <a href="' + VIGILANCE + '" target="_blank" rel="noopener">Météo-France</a>. Prévisions : <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, position arrondie à environ 1 km.</p>';
    $("al-wave-ics").hidden = a.level !== "wave";
  }

  function check() {
    var loc = here(), btn = $("al-check"), box = $("al-result");
    if (!loc) { box.textContent = "Choisis d'abord un logement."; return Promise.resolve(); }
    btn.disabled = true; btn.textContent = "Chargement…";
    box.textContent = "";
    A.track("canicule-prevision");
    return fetchForecast(loc).then(function (f) { last = f; renderForecast(f); }, function () {
      box.innerHTML = '<p class="note warn">La prévision n\'a pas pu être chargée (réseau ou service indisponible). Consulte directement la <a href="' + VIGILANCE + '" target="_blank" rel="noopener">vigilance Météo-France</a>.</p>';
    }).then(function () { btn.disabled = false; btn.textContent = "Actualiser la prévision"; });
  }

  // ---------------------------------------------------------------- plan adapté au logement
  function plan() {
    var p = A.state.profile, items = [];
    var sunny = p.orient === "S" || p.orient === "W" || p.orient === "E" || p.orient === "unknown";
    var top = p.floor === "roof" || p.floor === "top";
    if (p.shutters === "ext") items.push(["Matin", "Ferme les volets ou les stores extérieurs du côté du soleil avant 9 h, et garde-les fermés tant qu'il fait chaud."]);
    else if (p.shutters === "int") items.push(["Matin", "Tire les rideaux côté soleil dès le matin, de préférence clairs et épais. Ils arrêtent la lumière mais gardent la moitié de la chaleur : une toile claire tendue à l'extérieur fait mieux."]);
    else items.push(["Matin", "Sans volets ni rideaux, une couverture de survie ou un drap clair tendu contre la vitre, côté " + (sunny ? "soleil" : "sud et ouest") + ", arrête une bonne part du soleil."]);
    items.push(["Journée", "Garde les fenêtres fermées tant qu'il fait plus chaud dehors que dedans. Éteins les appareils inutiles : chacun est un petit radiateur."]);
    if (top) items.push(["Journée", "Sous le toit, la pièce chauffe jusqu'au soir : passe l'après-midi dans un lieu frais (bibliothèque, commerce climatisé, parc ombragé) si tu peux."]);
    if (p.ac === "yes") items.push(["Soirée", "Clim à 26 °C plutôt que moins, fenêtres fermées, filtres propres : elle consomme moins et tu supportes mieux l'écart avec dehors."]);
    else if (p.nightOpen === "no") items.push(["Soirée", "Tu ne peux pas ouvrir la nuit : essaie la fenêtre côté cour, une moustiquaire, ou aère à l'aube (vers 5 h ou 6 h), quand l'air est le plus frais."]);
    else if (p.traversant === "yes") items.push(["Soirée", "Dès que l'air dehors est plus frais que dedans (souvent après 22 h), ouvre les deux façades en grand : le courant d'air vide la chaleur."]);
    else items.push(["Soirée", "Ouvre en grand dès que l'air dehors est plus frais que dedans, et pose un ventilateur dans la fenêtre, tourné vers l'extérieur, pour aspirer l'air chaud."]);
    items.push(["Nuit", "Un ventilateur dirigé vers le lit, un drap humide essoré ou une bouillotte d'eau froide aident. Si la chambre reste étouffante, dors dans la pièce la plus fraîche, la plus basse ou côté nord."]);
    items.push(["Santé", "Bois régulièrement, même sans soif. Si tu es isolé ou fragile, inscris-toi au registre canicule de ta mairie. Malaise, confusion ou forte fièvre : appelle le 15."]);
    return items;
  }
  function renderPlan() {
    $("al-plan-list").innerHTML = plan().map(function (it) {
      return '<li><span class="tag">' + it[0] + "</span><span>" + A.escapeHtml(it[1]) + "</span></li>";
    }).join("");
    var loc = here();
    $("al-loc").textContent = loc ? loc.label : "Aucun logement choisi";
    var st = read();
    var on = !!(st && st.on);
    $("al-notif").setAttribute("aria-pressed", on ? "true" : "false");
    $("al-notif").textContent = on ? "Notifications activées (désactiver)" : "Me prévenir à l'ouverture du site";
  }

  // ---------------------------------------------------------------- notification à l'ouverture
  function notify(text, tag) {
    var opts = { body: text, tag: tag || "fournaise-canicule", icon: "img/icon-192.png", badge: "img/icon-192.png", data: { url: "./#alerte" } };
    var title = "Fournaise : vague de chaleur";
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.showNotification) return reg.showNotification(title, opts);
        new Notification(title, opts);
      });
    }
    new Notification(title, opts);
    return Promise.resolve();
  }

  function enable() {
    var loc = here();
    if (!loc) { A.toast("Choisis d'abord un logement."); return; }
    if (!("Notification" in window)) { $("al-notif-note").textContent = "Ce navigateur ne sait pas afficher de notifications. L'agenda ci-dessous marche partout."; return; }
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") { $("al-notif-note").textContent = "Notifications refusées dans le navigateur. Tu peux les autoriser dans les réglages du site, ou utiliser l'agenda."; return; }
      A.track("canicule-notifications");
      write({ on: true, lat: loc.lat, lon: loc.lon, label: loc.label, lastWave: "", lastCheck: 0 });
      $("al-notif-note").textContent = "C'est noté pour " + loc.label + ". Le site vérifie la prévision à chaque ouverture, et en tâche de fond si ton navigateur le permet.";
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg.periodicSync) reg.periodicSync.register("fournaise-canicule", { minInterval: 12 * 3600 * 1000 }).catch(function () {});
        }).catch(function () {});
      }
      renderPlan();
      checkOnOpen(true);
    });
  }
  function disable() {
    write({ on: false });
    $("al-notif-note").textContent = "Notifications désactivées.";
    renderPlan();
  }

  // À l'ouverture : au plus une vérification toutes les 6 heures, une notification par vague.
  function checkOnOpen(force) {
    var st = read();
    if (!st || !st.on || !("Notification" in window) || Notification.permission !== "granted") return;
    if (!force && Date.now() - (st.lastCheck || 0) < 6 * 3600 * 1000) return;
    fetchForecast({ lat: st.lat, lon: st.lon, label: st.label }).then(function (f) {
      st.lastCheck = Date.now();
      if (f.a.level === "wave" && st.lastWave !== f.a.from) {
        st.lastWave = f.a.from;
        notify(H.message(f.a) + (st.label ? " (" + st.label + ")" : ""));
      }
      write(st);
    }, function () {});
  }

  // ---------------------------------------------------------------- agenda (.ics)
  function esc(t) { return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
  function fold(line) {
    var out = [];
    while (line.length > 60) { out.push(line.slice(0, 60)); line = " " + line.slice(60); }
    out.push(line);
    return out.join("\r\n");
  }
  function ymd(date) { return date.replace(/-/g, ""); }
  function nextDay(date) { var d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ""); }
  function ics(events) {
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fournaise//Alerte canicule//FR", "CALSCALE:GREGORIAN"];
    events.forEach(function (e, i) {
      lines.push("BEGIN:VEVENT", "UID:fournaise-" + stamp + "-" + i + "@aloysdeboissezon.github.io", "DTSTAMP:" + stamp,
        "DTSTART;VALUE=DATE:" + e.start, "DTEND;VALUE=DATE:" + e.end, "SUMMARY:" + esc(e.title), "DESCRIPTION:" + esc(e.text));
      if (e.rrule) lines.push("RRULE:" + e.rrule);
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(e.title), "TRIGGER:" + (e.trigger || "-PT12H"), "END:VALARM", "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }
  function planText() { return plan().map(function (it) { return it[0] + " : " + it[1]; }).join("\n") + "\n\nPrévision et score : " + A.siteHost(); }
  function download(name, text) {
    var blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function yearlyIcs() {
    var y = new Date().getFullYear(), start = y + "0601";
    if (new Date() > new Date(y + "-06-01T12:00:00")) start = (y + 1) + "0601";
    download("fournaise-preparer-l-ete.ics", ics([{
      start: start, end: start.slice(0, 4) + "0602", rrule: "FREQ=YEARLY", trigger: "PT9H",
      title: "Préparer l'été : volets, ventilateur, moustiquaire",
      text: "Avant les premières chaleurs, vérifie :\n" + planText()
    }]));
    A.track("canicule-agenda-annuel");
    A.toast("Rappel du 1er juin téléchargé : ouvre-le pour l'ajouter à ton agenda.");
  }
  function waveIcs() {
    if (!last || last.a.level !== "wave") return;
    download("fournaise-vague-de-chaleur.ics", ics([{
      start: ymd(last.a.from), end: nextDay(last.a.to),
      title: "Vague de chaleur annoncée : " + (last.loc.label || "ton logement"),
      text: H.message(last.a) + "\n\n" + planText()
    }]));
    A.track("canicule-agenda-vague");
    A.toast("Vague de chaleur téléchargée : ouvre le fichier pour l'ajouter à ton agenda.");
  }

  function wire() {
    $("al-check").addEventListener("click", check);
    $("al-notif").addEventListener("click", function () { var st = read(); if (st && st.on) disable(); else enable(); });
    $("al-year-ics").addEventListener("click", yearlyIcs);
    $("al-wave-ics").addEventListener("click", waveIcs);
    document.addEventListener("fournaise:update", function () { renderPlan(); });
    renderPlan();
    checkOnOpen(false);
  }
  wire();
})();
