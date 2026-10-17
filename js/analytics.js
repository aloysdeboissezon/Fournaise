/*
 * Mesure d'audience sans cookie (GoatCounter), désactivée tant que GOATCOUNTER_CODE est vide.
 * Pour l'activer : créer un compte gratuit sur goatcounter.com, puis mettre ici le code du site
 * (la partie avant « .goatcounter.com ») et ajouter la mention dans confidentialite.html.
 * Seuls des événements sans donnée personnelle sont envoyés : jamais l'adresse ni les réponses.
 */
(function () {
  "use strict";
  var GOATCOUNTER_CODE = "";
  window.FournaiseTrack = function (name) {
    if (!GOATCOUNTER_CODE || !window.goatcounter || !window.goatcounter.count) return;
    try { window.goatcounter.count({ path: "evenement/" + name, title: name, event: true }); } catch (e) {}
  };
  if (!GOATCOUNTER_CODE) return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.setAttribute("data-goatcounter", "https://" + GOATCOUNTER_CODE + ".goatcounter.com/count");
  document.head.appendChild(s);
})();
