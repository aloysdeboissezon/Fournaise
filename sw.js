/* Fournaise : service worker minimal. Réseau d'abord, copie en cache si le réseau échoue (hors ligne). */
var CACHE = "fournaise-v4";
var CORE = ["./", "index.html", "css/style.css", "css/fonts.css", "js/data-paris.js", "js/data-heat.js", "js/model.js", "js/analytics.js", "js/app.js", "js/share.js", "js/guide.js", "js/heatwave.js", "js/canicule.js",
  "fonts/instrument-sans-046090.woff2", "fonts/unbounded-06f2e4.woff2", "fonts/ibm-plex-mono-d196e8.woff2", "fonts/ibm-plex-mono-a7544c.woff2", "img/favicon.svg", "site.webmanifest"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== "fournaise-prefs"; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()); });
  }));
});

// Alerte canicule en arrière-plan (Chrome installé : synchronisation périodique) et clic sur la notification.
importScripts("js/heatwave.js");
self.addEventListener("periodicsync", function (e) {
  if (e.tag !== "fournaise-canicule") return;
  e.waitUntil(caches.open("fournaise-prefs").then(function (c) {
    return c.match("prefs").then(function (r) { return r ? r.json() : null; }).then(function (p) {
      if (!p || !p.on) return;
      return fetch(self.FournaiseHeat.url(p.lat, p.lon)).then(function (r) { return r.json(); }).then(function (j) {
        var a = self.FournaiseHeat.analyze(self.FournaiseHeat.parse(j));
        if (a.level !== "wave" || p.lastWave === a.from) return;
        p.lastWave = a.from;
        return c.put("prefs", new Response(JSON.stringify(p))).then(function () {
          return self.registration.showNotification("Fournaise : vague de chaleur", { body: self.FournaiseHeat.message(a) + (p.label ? " (" + p.label + ")" : ""), tag: "fournaise-canicule", icon: "img/icon-192.png", data: { url: "./#alerte" } });
        });
      });
    });
  }).catch(function () {}));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(function (list) {
    for (var i = 0; i < list.length; i++) if ("focus" in list[i]) return list[i].focus();
    return self.clients.openWindow(url);
  }));
});
