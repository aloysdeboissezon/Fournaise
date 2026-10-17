/* Fournaise — finitions : les sections apparaissent en douceur quand on arrive dessus. Sans effet si le navigateur ne sait pas observer
   ou si l'utilisateur réduit les animations : tout reste visible. */
(function () {
  "use strict";
  // Le ciel de Paris sous le bandeau d'accueil : toits de zinc, lucarnes, cheminées et un soleil qui se lève.
  // Dessiné par le code (graine fixe, donc toujours le même) pour ne rien ajouter au poids de la page.
  function skyline() {
    var box = document.getElementById("skyline");
    if (!box) return;
    var seed = 7, W = 1200, H = 150, x = -10, out = "";
    var rnd = function () { seed = (seed + 0x6d2b79f5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    while (x < W) {
      var w = pick([56, 64, 72, 80, 92]), h = pick([44, 52, 60, 68, 76, 88]), top = H - h, rh = pick([18, 22, 26]);
      out += '<rect x="' + x + '" y="' + top + '" width="' + w + '" height="' + h + '" class="b"/><path d="M' + x + " " + top + "h" + w + "l-8 -" + rh + "h-" + (w - 16) + 'z" class="r"/>';
      var nd = Math.max(1, Math.floor((w - 24) / 28)), step = Math.floor((w - 28) / nd);
      for (var d = 0; d < nd; d++) out += '<path d="M' + (x + 14 + d * step + Math.floor(step / 2) - 4) + " " + (top - 4) + 'v-7h8v7z" class="d"/>';
      if (rnd() < 0.6) out += '<rect x="' + (x + 10 + Math.floor(rnd() * (w - 28))) + '" y="' + (top - rh - 9) + '" width="5" height="9" class="c"/>';
      for (var row = 0, rows = pick([2, 3, 4]); row < rows; row++) {
        var wy = top + 10 + row * 16;
        if (wy > H - 12) break;
        for (var col = 0; col < Math.max(2, Math.floor(w / 22)); col++) { var wx = x + 8 + col * 18; if (wx + 6 < x + w - 4) out += '<rect x="' + wx + '" y="' + wy + '" width="6" height="9" class="w"/>'; }
      }
      x += w + pick([0, 0, 2]);
    }
    var wave = function (y) { return '<path d="M0 ' + y + "q50 -12 100 0" + "t100 0".repeat(12) + '"/>'; };
    box.innerHTML = '<svg class="skyline-svg" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMax slice" focusable="false"><defs><linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--h2)"/><stop offset="1" stop-color="var(--h4)"/></linearGradient></defs>' +
      '<circle cx="880" cy="70" r="62" fill="url(#sun)" class="sun"/><g class="shimmer">' + wave(40) + wave(58) + "</g>" + out + "</svg>";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", skyline); else skyline();

  if (!window.IntersectionObserver || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  var targets = Array.prototype.slice.call(document.querySelectorAll("main .section, .method .card"));
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("rv-in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.04 });
  targets.forEach(function (el) {
    // Ce qui est déjà à l'écran (ou au-dessus) n'est pas masqué : pas de clignotement au chargement ni sur un lien d'ancre.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.95) return;
    el.classList.add("rv");
    io.observe(el);
  });
  // Une ancre (#conseils…) ou l'impression révèle tout de suite ce qui était masqué.
  window.addEventListener("hashchange", function () { document.querySelectorAll(".rv:not(.rv-in)").forEach(function (el) { el.classList.add("rv-in"); }); });
  window.addEventListener("beforeprint", function () { document.querySelectorAll(".rv").forEach(function (el) { el.classList.add("rv-in"); }); });
})();
