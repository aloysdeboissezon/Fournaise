/* Fournaise : service worker minimal. Réseau d'abord, copie en cache si le réseau échoue (hors ligne). */
var CACHE = "fournaise-v3";
var CORE = ["./", "index.html", "css/style.css", "css/fonts.css", "js/data-paris.js", "js/data-heat.js", "js/model.js", "js/analytics.js", "js/app.js", "js/share.js",
  "fonts/instrument-sans-046090.woff2", "fonts/unbounded-06f2e4.woff2", "fonts/ibm-plex-mono-d196e8.woff2", "fonts/ibm-plex-mono-a7544c.woff2", "img/favicon.svg", "site.webmanifest"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
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
