/* Fournaise — détection d'une vague de chaleur dans une prévision à 7 jours (Open-Meteo).
   Partagé par la page et par le service worker (sw.js) : pas de DOM ici. */
(function (root) {
  "use strict";
  // Ordre de grandeur des seuils de vigilance canicule de Paris : moyennes sur 3 jours de Tn ≥ 21 °C et de Tx ≥ 31 °C.
  // Ce n'est pas la vigilance officielle de Météo-France, qui dépend du département et de sa propre méthode.
  var TN = 21, TX = 31;

  function url(lat, lon) {
    return "https://api.open-meteo.com/v1/forecast?latitude=" + lat.toFixed(2) + "&longitude=" + lon.toFixed(2) +
      "&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FParis&forecast_days=7";
  }

  // days : [{ date: "2026-07-01", tx, tn }]. Renvoie les jours dans une fenêtre de 3 jours au-dessus des seuils.
  function analyze(days) {
    var wave = days.map(function () { return false; });
    for (var i = 0; i + 2 < days.length; i++) {
      var tn = (days[i].tn + days[i + 1].tn + days[i + 2].tn) / 3, tx = (days[i].tx + days[i + 1].tx + days[i + 2].tx) / 3;
      if (tn >= TN && tx >= TX) { wave[i] = wave[i + 1] = wave[i + 2] = true; }
    }
    var first = wave.indexOf(true), last = wave.lastIndexOf(true);
    var tropical = days.filter(function (d) { return d.tn >= 20; }).length;
    return {
      level: first >= 0 ? "wave" : tropical ? "tropical" : "calm",
      from: first >= 0 ? days[first].date : null, to: first >= 0 ? days[last].date : null,
      wave: wave, tropical: tropical, maxTx: Math.max.apply(null, days.map(function (d) { return d.tx; })),
      maxTn: Math.max.apply(null, days.map(function (d) { return d.tn; }))
    };
  }

  function parse(json) {
    var d = json && json.daily;
    if (!d || !d.time || !d.temperature_2m_max || !d.temperature_2m_min) throw new Error("prévision illisible");
    return d.time.map(function (t, i) { return { date: t, tx: d.temperature_2m_max[i], tn: d.temperature_2m_min[i] }; })
      .filter(function (x) { return typeof x.tx === "number" && typeof x.tn === "number"; });
  }

  function dayName(date, opts) {
    return new Date(date + "T12:00:00").toLocaleDateString("fr-FR", opts || { weekday: "long", day: "numeric", month: "long" });
  }

  function message(a) {
    if (a.level !== "wave") return "";
    var from = dayName(a.from, { weekday: "long", day: "numeric" }), to = dayName(a.to, { weekday: "long", day: "numeric" });
    return "Vague de chaleur annoncée du " + from + (a.from === a.to ? "" : " au " + to) + " : ferme les volets côté soleil dès le matin, ouvre en grand quand la nuit rafraîchit.";
  }

  var api = { TN: TN, TX: TX, url: url, analyze: analyze, parse: parse, dayName: dayName, message: message };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FournaiseHeat = api;
})(typeof self !== "undefined" ? self : this);
