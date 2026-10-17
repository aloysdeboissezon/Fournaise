/* Fournaise — interface. Dépend de js/data-paris.js et js/model.js. */
(function () {
  "use strict";

  var D = window.FOURNAISE_DATA;
  var M = window.FournaiseModel;
  var ZONES = D.zones;
  var ZONE_BY_CODE = {};
  ZONES.forEach(function (z) { ZONE_BY_CODE[z.code] = z; });
  // Communes fusionnées dont la BAN garde parfois l'ancien code (Pierrefitte-sur-Seine dans Saint-Denis depuis 2025).
  var MERGED = { "93059": "93066" };
  var $ = function (id) { return document.getElementById(id); };
  var track = function (name) { if (window.FournaiseTrack) window.FournaiseTrack(name); };

  // ---------------------------------------------------------------------------
  // Questions du formulaire
  // ---------------------------------------------------------------------------
  var Q_MAIN = [
    { key: "floor", label: "Étage", opts: [["low", "RDC ou 1er"], ["mid", "Intermédiaire"], ["top", "Dernier étage"], ["roof", "Sous les toits"]] },
    { key: "orient", label: "Orientation des fenêtres principales", hint: "côté chambre ou séjour", opts: [["N", "Nord"], ["E", "Est"], ["S", "Sud"], ["W", "Ouest"], ["unknown", "Je ne sais pas"]] },
    { key: "windows", label: "Fenêtres", opts: [["single", "Simple vitrage"], ["double", "Double vitrage"], ["recent", "Double récent"], ["roof", "Velux"], ["unknown", "Je ne sais pas"]] },
    { key: "shutters", label: "Protection contre le soleil", opts: [["ext", "Volets ou stores extérieurs"], ["int", "Rideaux intérieurs"], ["none", "Rien"], ["unknown", "Je ne sais pas"]] },
    { key: "ac", label: "Climatisation", opts: [["no", "Non"], ["yes", "Oui"]] }
  ];
  var Q_MORE = [
    { key: "traversant", label: "Fenêtres sur deux façades opposées", hint: "appartement traversant", opts: [["yes", "Oui"], ["no", "Non"], ["unknown", "Je ne sais pas"]] },
    { key: "nightOpen", label: "Fenêtres ouvertes la nuit", opts: [["yes", "Possible"], ["no", "Non, bruit ou sécurité"]] },
    { key: "era", label: "Construction de l'immeuble", opts: [["pre1914", "Avant 1914"], ["1914_1948", "1914-1948"], ["1949_1974", "1949-1974"], ["1975_2005", "1975-2005"], ["post2005", "Après 2005"], ["unknown", "Je ne sais pas"]] },
    { key: "size", label: "Surface", opts: [["xs", "Moins de 15 m²"], ["s", "15 à 40 m²"], ["m", "Plus de 40 m²"]] },
    { key: "dpeEte", label: "Confort d'été du DPE", hint: "case présente sur les DPE depuis 2021", opts: [["bon", "Bon"], ["moyen", "Moyen"], ["insuffisant", "Insuffisant"], ["unknown", "Je ne sais pas"]] }
  ];

  var EXAMPLES = [
    {
      id: "bonne", label: "Chambre de bonne, 9e",
      location: { lon: 2.3397, lat: 48.8795, label: "Rue des Martyrs, Paris 9e", precision: "address" },
      profile: { floor: "roof", orient: "W", windows: "roof", shutters: "none", ac: "no", traversant: "no", nightOpen: "yes", era: "pre1914", size: "xs", dpeEte: "unknown" }
    },
    {
      id: "haussmann", label: "Haussmannien, 15e",
      location: { lon: 2.295, lat: 48.8395, label: "Rue de la Convention, Paris 15e", precision: "address" },
      profile: { floor: "mid", orient: "N", windows: "double", shutters: "ext", ac: "no", traversant: "yes", nightOpen: "yes", era: "pre1914", size: "m", dpeEte: "moyen" }
    },
    {
      id: "seventies", label: "Studio des années 70, 13e",
      location: { lon: 2.3577, lat: 48.8255, label: "Avenue d'Italie, Paris 13e", precision: "address" },
      profile: { floor: "top", orient: "S", windows: "double", shutters: "int", ac: "no", traversant: "no", nightOpen: "no", era: "1949_1974", size: "s", dpeEte: "insuffisant" }
    }
  ];

  var state = {
    location: null,
    profile: Object.assign({}, M.DEFAULT_PROFILE),
    example: null,
    view: "now",
    result: null,
    networkDown: 0,        // horodatage de la dernière panne réseau ; on réessaie après 20 s
    adviceSelf: false,
    lastAdvice: [],
    touched: {},      // réponses données par l'utilisateur : jamais écrasées par les données de l'immeuble
    prefilled: {},    // réponses préremplies depuis les DPE ou la BDNB
    building: null
  };

  // ---------------------------------------------------------------------------
  // Couleurs (lues dans les jetons CSS pour suivre le thème)
  // ---------------------------------------------------------------------------
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function hexToRgb(h) {
    h = h.replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  var palette = null;
  function readPalette() {
    palette = ["--h0", "--h1", "--h2", "--h3", "--h4", "--h5", "--h6"].map(function (v) { return hexToRgb(cssVar(v) || "#888888"); });
  }
  function ramp(stops, value) {
    if (value <= stops[0][0]) return palette[stops[0][1]];
    for (var i = 1; i < stops.length; i++) {
      if (value <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], t = (value - a[0]) / (b[0] - a[0]);
        var ca = palette[a[1]], cb = palette[b[1]];
        return [0, 1, 2].map(function (k) { return Math.round(ca[k] + (cb[k] - ca[k]) * t); });
      }
    }
    return palette[stops[stops.length - 1][1]];
  }
  var TEMP_STOPS = [[19, 0], [22.5, 1], [25, 2], [26.5, 3], [28.5, 4], [31.5, 5], [35, 6]];
  var SCORE_STOPS = [[1, 0], [3, 1], [4.5, 2], [6, 3], [7.5, 4], [9, 5], [10, 6]];
  var MAP_STOPS = [[-1.1, 0], [-0.4, 1], [0.6, 2], [1.3, 3], [1.9, 4]];
  function rgb(c, a) { return a == null ? "rgb(" + c.join(",") + ")" : "rgba(" + c.join(",") + "," + a + ")"; }
  function tempColor(t) { return rgb(ramp(TEMP_STOPS, t)); }
  function scoreColor(s) { return rgb(ramp(SCORE_STOPS, s)); }

  // ---------------------------------------------------------------------------
  // Formatage
  // ---------------------------------------------------------------------------
  function fr(n, digits) {
    return n.toLocaleString("fr-FR", { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }
  // Au-dessus de 20 nuits, on arrondit à 5 : le modèle n'est pas calé sur des mesures intérieures,
  // une précision à la nuit près ferait croire à plus de certitude qu'il n'y en a.
  function roundNights(n) {
    if (n >= 20) return Math.round(n / 5) * 5;
    return Math.round(n);
  }
  function nights(n) {
    if (n < 0.5) return "0";
    if (n < 1) return "< 1";
    return fr(roundNights(n));
  }
  function plural(n, one, many) { return roundNights(n) >= 2 ? many : one; }
  var MONTHS = ["juin", "juillet", "août", "septembre"];
  var MONTH_START = [0, 30, 61, 92];
  function dayLabel(d) {
    for (var m = 3; m >= 0; m--) if (d >= MONTH_START[m]) return (d - MONTH_START[m] + 1) + (d - MONTH_START[m] === 0 ? "er" : "") + " " + MONTHS[m];
    return "";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  // ---------------------------------------------------------------------------
  // Formulaire
  // ---------------------------------------------------------------------------
  function renderQuestions(container, list) {
    container.innerHTML = list.map(function (q) {
      var name = "f-" + q.key;
      var opts = q.opts.map(function (o) {
        var id = name + "-" + o[0];
        return '<input type="radio" name="' + name + '" id="' + id + '" value="' + o[0] + '">' +
          '<label for="' + id + '"' + (o[0] === "unknown" ? ' class="unknown"' : "") + ">" + escapeHtml(o[1]) + "</label>";
      }).join("");
      return '<div class="q" role="radiogroup" aria-labelledby="' + name + '-l">' +
        '<span class="q-label" id="' + name + '-l">' + escapeHtml(q.label) + (q.hint ? "<small>" + escapeHtml(q.hint) + "</small>" : "") + "</span>" +
        '<div class="seg">' + opts + "</div></div>";
    }).join("");
  }

  function syncForm() {
    Q_MAIN.concat(Q_MORE).forEach(function (q) {
      var el = document.getElementById("f-" + q.key + "-" + state.profile[q.key]);
      if (el) el.checked = true;
    });
  }

  function renderExamples() {
    var box = $("examples");
    EXAMPLES.forEach(function (ex) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = ex.label;
      b.dataset.example = ex.id;
      b.addEventListener("click", function () { track("exemple"); loadExample(ex.id); document.dispatchEvent(new CustomEvent("fournaise:reveal")); });
      box.appendChild(b);
    });
  }

  function loadExample(id) {
    var ex = EXAMPLES.filter(function (e) { return e.id === id; })[0];
    state.example = ex.id;
    state.profile = Object.assign({}, M.DEFAULT_PROFILE, ex.profile);
    state.location = Object.assign({}, ex.location);
    state.touched = {}; state.prefilled = {}; state.building = null;
    $("addr-input").value = $("map-search-input").value = "";
    syncForm();
    update();
  }

  function markEdited() {
    state.example = null;
  }

  // ---------------------------------------------------------------------------
  // Carte de Paris et de la petite couronne
  // ---------------------------------------------------------------------------
  var MAPB = { minLon: 2.14, maxLon: 2.62, minLat: 48.684, maxLat: 49.016 };
  var MAP_W = 600;
  var MAP_K = MAP_W / ((MAPB.maxLon - MAPB.minLon) * M.KM_LON);
  var MAP_H = Math.round((MAPB.maxLat - MAPB.minLat) * M.KM_LAT * MAP_K);
  function project(lon, lat) {
    return [(lon - MAPB.minLon) * M.KM_LON * MAP_K, (MAPB.maxLat - lat) * M.KM_LAT * MAP_K];
  }
  function unproject(x, y) {
    return [MAPB.minLon + x / (M.KM_LON * MAP_K), MAPB.maxLat - y / (M.KM_LAT * MAP_K)];
  }
  function ringPath(ring) {
    return ring.map(function (c, i) { var p = project(c[0], c[1]); return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("") + "Z";
  }
  function ringCentroid(ring) {
    var a = 0, cx = 0, cy = 0;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
    }
    a *= 0.5;
    return [cx / (6 * a), cy / (6 * a)];
  }
  function mainRing(z) {
    return z.rings.reduce(function (best, r) { return r.length > best.length ? r : best; }, z.rings[0]);
  }
  // Points de centre ajustés à la main là où le centroïde tombe dans un bois.
  var CENTER_NUDGE = { "75116": [2.268, 48.858], "75112": [2.398, 48.838] };
  function zoneCenter(z) { return CENTER_NUDGE[z.code] || ringCentroid(mainRing(z)); }
  var OUTSIDE = "Ce point est hors de la zone couverte. Fournaise couvre Paris et la petite couronne (Hauts-de-Seine, Seine-Saint-Denis, Val-de-Marne) pour l'instant.";
  var NS = "http://www.w3.org/2000/svg";
  // Vues prédéfinies : toute la zone, ou Paris en grand (plus lisible sur téléphone).
  var VIEWS = { zone: [MAPB.minLon, MAPB.maxLon, MAPB.minLat, MAPB.maxLat], paris: [2.215, 2.475, 48.812, 48.906] };
  var ASPECT = MAP_H / MAP_W, W_MIN = 34;
  var reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function presetView(name) {
    var b = VIEWS[name], a = project(b[0], b[3]), z = project(b[1], b[2]);
    return { cx: (a[0] + z[0]) / 2, cy: (a[1] + z[1]) / 2, w: z[0] - a[0] };
  }
  // La vue : centre (cx, cy) et largeur w en unités de la carte (MAP_W = toute la zone).
  var view = presetView("zone"), viewAnim = 0;
  function viewBoxOf(v) { var h = v.w * ASPECT; return [v.cx - v.w / 2, v.cy - h / 2, v.w, h]; }
  function clampView(v) {
    var w = Math.max(W_MIN, Math.min(MAP_W, v.w)), h = w * ASPECT;
    return { w: w, cx: Math.max(w / 2, Math.min(MAP_W - w / 2, v.cx)), cy: Math.max(h / 2, Math.min(MAP_H - h / 2, v.cy)) };
  }

  // Image de la carte de chaleur sur le rectangle (x0, y0, x1, y1) de la carte : carte d'ensemble de 400 m,
  // puis tuiles fines de 100 m là où elles sont chargées. Découpée sur la zone par le SVG.
  function heatRaster(x0, y0, x1, y1, RW) {
    var RH = Math.max(1, Math.round((RW * (y1 - y0)) / (x1 - x0)));
    var c = document.createElement("canvas");
    c.width = RW; c.height = RH;
    var ctx = c.getContext("2d");
    var img = ctx.createImageData(RW, RH);
    for (var y = 0; y < RH; y++) {
      for (var x = 0; x < RW; x++) {
        var ll = unproject(x0 + ((x + 0.5) / RW) * (x1 - x0), y0 + ((y + 0.5) / RH) * (y1 - y0));
        var col = ramp(MAP_STOPS, M.localHeat(ll[0], ll[1]).delta);
        var o = (y * RW + x) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 210;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  // Position (lon, lat) d'un événement souris sur la carte, quelle que soit la vue.
  function eventUnits(svg, ev) {
    var pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }
  function eventLonLat(svg, ev) {
    var p = eventUnits(svg, ev);
    return unproject(p[0], p[1]);
  }

  function applyView(v) {
    view = clampView(v);
    var svg = $("map");
    svg.setAttribute("viewBox", viewBoxOf(view).map(function (n) { return n.toFixed(1); }).join(" "));
    svg.style.setProperty("--mk", (view.w / MAP_W).toFixed(3));
    svg.classList.toggle("zoomed", view.w < 420);
    svg.classList.toggle("zoom-in", view.w < 150);
    var pv = presetView("paris");
    Array.prototype.forEach.call(document.querySelectorAll("[data-view]"), function (btn) {
      var on = btn.dataset.view === "zone" ? view.w > MAP_W - 1 : Math.abs(view.w - pv.w) < 6 && Math.abs(view.cx - pv.cx) < 12 && Math.abs(view.cy - pv.cy) < 12;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var zi = $("zoom-in"), zo = $("zoom-out");
    if (zi) { zi.disabled = view.w <= W_MIN + 0.5; zo.disabled = view.w >= MAP_W - 0.5; }
    placePin();
    scheduleDetail();
  }

  // Déplacement animé de la vue (ms = 0 : immédiat).
  function flyTo(target, ms) {
    target = clampView(target);
    cancelAnimationFrame(viewAnim);
    if (ms === 0 || reducedMotion) { applyView(target); return; }
    var from = view, t0 = performance.now(), dur = ms || 380;
    (function step(now) {
      var t = Math.min(1, (now - t0) / dur), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      applyView({
        w: Math.exp(Math.log(from.w) + (Math.log(target.w) - Math.log(from.w)) * e),
        cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e
      });
      if (t < 1) viewAnim = requestAnimationFrame(step);
    })(t0);
  }
  function setMapView(name) { flyTo(presetView(name)); }
  // Zoom autour d'un point de la carte (le centre de la vue par défaut).
  function zoomAt(factor, ax, ay, ms) {
    if (ax == null) { ax = view.cx; ay = view.cy; }
    var w = Math.max(W_MIN, Math.min(MAP_W, view.w * factor)), k = w / view.w;
    var v = { w: w, cx: ax - (ax - view.cx) * k, cy: ay - (ay - view.cy) * k };
    if (ms) flyTo(v, ms); else { cancelAnimationFrame(viewAnim); applyView(v); }
  }
  function focusOn(lon, lat, w) {
    var p = project(lon, lat);
    flyTo({ cx: p[0], cy: p[1], w: w || 50 });
  }
  function focusZone(z) {
    var xs = [], ys = [];
    mainRing(z).forEach(function (c) { var p = project(c[0], c[1]); xs.push(p[0]); ys.push(p[1]); });
    var bw = Math.max.apply(null, xs) - Math.min.apply(null, xs), bh = Math.max.apply(null, ys) - Math.min.apply(null, ys);
    var c = zoneCenter(z), p = project(c[0], c[1]);
    flyTo({ cx: p[0], cy: p[1], w: Math.max(60, Math.min(300, Math.max(bw, bh / ASPECT) * 1.5)) });
  }
  // Si le repère sort de la vue (adresse choisie ailleurs, flèches du clavier), la vue le rejoint.
  function revealPin() {
    if (!state.location) return;
    var p = project(state.location.lon, state.location.lat), b = viewBoxOf(view), m = 0.08;
    if (p[0] < b[0] + b[2] * m || p[0] > b[0] + b[2] * (1 - m) || p[1] < b[1] + b[3] * m || p[1] > b[1] + b[3] * (1 - m)) flyTo({ cx: p[0], cy: p[1], w: view.w });
  }

  // Détail fin : quand on zoome, la carte est redessinée à partir des tuiles de 100 m de la zone affichée.
  var detailTimer = 0, detailGen = 0;
  function scheduleDetail() { clearTimeout(detailTimer); detailTimer = setTimeout(drawDetail, 180); }
  function drawDetail() {
    var img = document.getElementById("map-detail");
    if (!img) return;
    if (view.w > 320) { img.setAttribute("visibility", "hidden"); return; }
    var gen = ++detailGen, b = viewBoxOf(view), m = b[2] * 0.2;
    var x0 = b[0] - m, y0 = b[1] - m, x1 = b[0] + b[2] + m, y1 = b[1] + b[3] + m, need = [];
    for (var i = 0; i <= 4; i++) {
      for (var j = 0; j <= 4; j++) {
        var ll = unproject(x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * j) / 4);
        if (!M.hasTiles(ll[0], ll[1])) M.tilesFor(ll[0], ll[1]).forEach(function (k) { if (need.indexOf(k) < 0) need.push(k); });
      }
    }
    Promise.all(need.map(loadTile)).catch(function () {}).then(function () {
      if (gen !== detailGen) return;
      img.setAttribute("href", heatRaster(x0, y0, x1, y1, 340));
      img.setAttribute("x", x0.toFixed(1)); img.setAttribute("y", y0.toFixed(1));
      img.setAttribute("width", (x1 - x0).toFixed(1)); img.setAttribute("height", (y1 - y0).toFixed(1));
      img.setAttribute("visibility", "visible");
    });
  }

  function renderMap() {
    var svg = $("map");
    var allPaths = ZONES.map(function (z) { return z.rings.map(ringPath).join(""); }).join("");
    var depLabels = [["Paris", 2.345, 48.869], ["92", 2.19, 48.875], ["93", 2.5, 48.945], ["94", 2.49, 48.765]].map(function (l) {
      var p = project(l[1], l[2]);
      return '<text class="dep-label" x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) + '" text-anchor="middle">' + l[0] + "</text>";
    }).join("");
    var arrLabels = ZONES.filter(function (z) { return z.dep === "75"; }).map(function (z) {
      var p = project.apply(null, zoneCenter(z));
      return '<text class="arr-label" x="' + p[0].toFixed(1) + '" y="' + (p[1] + 3).toFixed(1) + '" text-anchor="middle">' + z.n + "</text>";
    }).join("");
    var comLabels = ZONES.filter(function (z) { return z.dep !== "75"; }).map(function (z) {
      var p = project.apply(null, zoneCenter(z));
      return '<text class="com-label" x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) + '" text-anchor="middle">' + escapeHtml(z.name) + "</text>";
    }).join("");
    // Seine, Marne et plans d'eau (BD TOPO), codés en entiers de 1e-4 degré : premier point puis écarts.
    var water = (D.heat.water || []).map(function (f) {
      var x = 0, y = 0, ring = [];
      for (var i = 0; i < f.length; i += 2) { x += f[i]; y += f[i + 1]; ring.push([x / 1e4, y / 1e4]); }
      return ringPath(ring);
    }).join("");
    svg.style.aspectRatio = MAP_W + " / " + MAP_H;
    svg.innerHTML =
      '<defs><clipPath id="zone-clip"><path d="' + allPaths + '"/></clipPath></defs>' +
      '<image id="map-heat" x="0" y="0" width="' + MAP_W + '" height="' + MAP_H + '" preserveAspectRatio="none" clip-path="url(#zone-clip)" href="' + heatRaster(0, 0, MAP_W, MAP_H, 300) + '"/>' +
      '<image id="map-detail" visibility="hidden" preserveAspectRatio="none" clip-path="url(#zone-clip)"/>' +
      '<path class="water" d="' + water + '" clip-path="url(#zone-clip)"/>' +
      ZONES.map(function (z) { return '<path class="' + (z.dep === "75" ? "z-arr" : "z-com") + '" d="' + z.rings.map(ringPath).join("") + '"/>'; }).join("") +
      '<g class="arr-labels">' + arrLabels + '</g><g class="com-labels">' + comLabels + "</g>" + depLabels +
      '<g id="map-pin" visibility="hidden"><circle class="pin-halo" r="15"/><circle class="pin-dot" r="6"/></g>';
    applyView(view);
    Array.prototype.forEach.call(document.querySelectorAll("[data-view]"), function (btn) {
      btn.addEventListener("click", function () { setMapView(btn.dataset.view); });
    });
    wireMapGestures(svg);
  }

  // Gestes : glisser pour déplacer, pincer ou Ctrl + molette pour zoomer, toucher ou cliquer pour placer le repère.
  // Sur écran tactile, la carte laisse d'abord défiler la page : « Déplacer » active le glissement à un doigt.
  function wireMapGestures(svg) {
    var box = svg.parentNode, ptrs = {}, g = null, hintTimer = 0;
    var lockOn = function () { return box.classList.contains("pan-lock"); };
    function snapshot() {
      var ids = Object.keys(ptrs);
      g = { view0: Object.assign({}, view), rect: svg.getBoundingClientRect(), p0: {}, moved: g ? g.moved : false };
      ids.forEach(function (id) { g.p0[id] = ptrs[id].slice(); });
      if (ids.length > 1) g.moved = true;
    }
    function unitAt(px, py) {
      var v = g.view0, r = g.rect, upp = v.w / r.width;
      return [v.cx - v.w / 2 + (px - r.left) * upp, v.cy - (v.w * ASPECT) / 2 + (py - r.top) * upp];
    }
    svg.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      cancelAnimationFrame(viewAnim);
      ptrs[ev.pointerId] = [ev.clientX, ev.clientY];
      if (Object.keys(ptrs).length === 1) g = null;
      snapshot();
      try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    svg.addEventListener("pointermove", function (ev) {
      if (!ptrs[ev.pointerId] || !g) return;
      ptrs[ev.pointerId] = [ev.clientX, ev.clientY];
      var ids = Object.keys(ptrs), r = g.rect;
      if (ids.length === 1) {
        var p0 = g.p0[ids[0]], dx = ev.clientX - p0[0], dy = ev.clientY - p0[1];
        if (Math.sqrt(dx * dx + dy * dy) > 6) g.moved = true;
        if (g.moved && !(ev.pointerType === "touch" && lockOn())) {
          var upp = g.view0.w / r.width;
          applyView({ w: g.view0.w, cx: g.view0.cx - dx * upp, cy: g.view0.cy - dy * upp });
        }
      } else if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]], a0 = g.p0[ids[0]], b0 = g.p0[ids[1]];
        var d1 = Math.hypot(a[0] - b[0], a[1] - b[1]), d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]);
        if (d0 < 10 || d1 < 10) return;
        var m0 = unitAt((a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2);
        var w = Math.max(W_MIN, Math.min(MAP_W, (g.view0.w * d0) / d1)), upp1 = w / r.width;
        applyView({ w: w, cx: m0[0] - ((a[0] + b[0]) / 2 - r.left - r.width / 2) * upp1, cy: m0[1] - ((a[1] + b[1]) / 2 - r.top - r.height / 2) * upp1 });
      }
    });
    function release(ev, cancelled) {
      if (!ptrs[ev.pointerId]) return;
      var wasSingle = Object.keys(ptrs).length === 1, wasMoved = g && g.moved;
      delete ptrs[ev.pointerId];
      if (Object.keys(ptrs).length) snapshot(); else g = null;
      if (!cancelled && wasSingle && !wasMoved) placeFromEvent(ev);
    }
    svg.addEventListener("pointerup", function (ev) { release(ev, false); });
    svg.addEventListener("pointercancel", function (ev) { release(ev, true); });
    svg.addEventListener("wheel", function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) {
        var hint = $("map-hint");
        hint.hidden = false; clearTimeout(hintTimer);
        hintTimer = setTimeout(function () { hint.hidden = true; }, 1600);
        return;
      }
      ev.preventDefault();
      var u = eventUnits(svg, ev), d = Math.max(-60, Math.min(60, ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY));
      zoomAt(Math.exp(d * 0.006), u[0], u[1]);
    }, { passive: false });
    $("zoom-in").addEventListener("click", function () { zoomAt(0.55, null, null, 220); });
    $("zoom-out").addEventListener("click", function () { zoomAt(1 / 0.55, null, null, 220); });
    var pan = $("map-pan");
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
      box.classList.add("pan-lock");
      pan.hidden = false;
      pan.addEventListener("click", function () {
        var on = lockOn();
        box.classList.toggle("pan-lock", !on);
        pan.setAttribute("aria-pressed", on ? "true" : "false");
        note(on ? "Glisse la carte avec un doigt. Touche « Déplacer » pour reprendre le défilement de la page." : "Le défilement de la page est rétabli.");
      });
    }
    $("map-locate").addEventListener("click", function () {
      if (!navigator.geolocation) { note("La localisation n'est pas disponible sur cet appareil. Tape une adresse ou clique sur la carte.", true); return; }
      note("Recherche de ta position…");
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lon = pos.coords.longitude, lat = pos.coords.latitude, z = M.zoneAt(lon, lat, ZONES);
        if (!z) { note(OUTSIDE, true); return; }
        markEdited();
        setLocation({ lon: lon, lat: lat, precision: "map", label: "Ma position, " + z.name });
        focusOn(lon, lat, 50);
        note("Position trouvée. Elle ne quitte pas ton navigateur.");
      }, function () { note("Position refusée ou indisponible : tape une adresse ou clique sur la carte.", true); }, { timeout: 8000, maximumAge: 60000 });
    });
  }

  function placeFromEvent(ev) {
    var ll = eventLonLat($("map"), ev);
    var z = M.zoneAt(ll[0], ll[1], ZONES);
    if (!z) { note(OUTSIDE, true); return; }
    markEdited();
    setLocation({ lon: ll[0], lat: ll[1], precision: "map", label: "Point placé sur la carte, " + z.name });
    note("Position enregistrée. Tu peux la déplacer en cliquant ailleurs.");
  }

  function refreshMapHeat() {
    var img = document.getElementById("map-heat");
    if (img) img.setAttribute("href", heatRaster(0, 0, MAP_W, MAP_H, 300));
    drawDetail();
  }

  function placePin() {
    var pin = $("map-pin");
    if (!pin || !state.location) return;
    var p = project(state.location.lon, state.location.lat);
    var k = Math.max(0.1, view.w / MAP_W);  // le repère garde la même taille à l'écran quand on zoome
    pin.setAttribute("transform", "translate(" + p[0].toFixed(1) + " " + p[1].toFixed(1) + ") scale(" + k.toFixed(3) + ")");
    pin.setAttribute("visibility", "visible");
  }

  function arrName(n) { return n === 1 ? "1er" : n + "e"; }
  // « dans le 9e arrondissement », « à Montreuil », « au Kremlin-Bicêtre », « aux Lilas »
  function inZoneText(z) {
    if (z.dep === "75") return "dans le " + arrName(z.n) + " arrondissement";
    if (/^Le /.test(z.name)) return "au " + z.name.slice(3);
    if (/^Les /.test(z.name)) return "aux " + z.name.slice(4);
    return "à " + z.name;
  }
  var collator = typeof Intl !== "undefined" && Intl.Collator ? new Intl.Collator("fr") : null;

  function renderZoneSelect() {
    var sel = $("arr-select");
    var groups = Object.keys(D.departements).map(function (dep) {
      var list = ZONES.filter(function (z) { return z.dep === dep; });
      if (dep !== "75" && collator) list.sort(function (a, b) { return collator.compare(a.name, b.name); });
      return '<optgroup label="' + escapeHtml(D.departements[dep] + (dep === "75" ? "" : " (" + dep + ")")) + '">' + list.map(function (z) {
        return '<option value="' + z.code + '">' + escapeHtml(z.name) + "</option>";
      }).join("") + "</optgroup>";
    }).join("");
    sel.innerHTML = '<option value="">Ou choisis la commune ou l\'arrondissement</option>' + groups;
    sel.addEventListener("change", function () {
      if (!sel.value) return;
      markEdited();
      setZone(ZONE_BY_CODE[sel.value]);
      sel.value = "";
    });
  }

  function setZone(z) {
    var c = zoneCenter(z);
    setLocation({ lon: c[0], lat: c[1], precision: "arr", label: z.dep === "75" ? "Centre du " + arrName(z.n) + " arrondissement" : "Centre de " + z.name });
    focusZone(z);
    note("Position approximative au centre " + (z.dep === "75" ? "de l'arrondissement" : "de la commune") + ". Clique sur la carte pour la préciser.");
  }

  function setLocation(loc) {
    state.location = loc;
    state.building = null;
    clearPrefill();
    update();
    if (loc.precision !== "arr" && !loc.approx) lookupBuilding(loc);
  }

  // Tuiles fines de la carte de chaleur (data/heat/, 100 m) : chargées à la demande, puis le score est recalculé.
  var tileCache = {};
  function loadTile(k) {
    if (!tileCache[k]) {
      tileCache[k] = fetchJson("data/heat/" + k + ".json", 8000).then(function (t) { M.addHeatTile(t); return t; },
        function (e) { setTimeout(function () { delete tileCache[k]; }, 20000); throw e; });
    }
    return tileCache[k];
  }
  function ensureTiles(loc) {
    if (M.hasTiles(loc.lon, loc.lat)) return;
    Promise.all(M.tilesFor(loc.lon, loc.lat).map(loadTile)).then(function () {
      if (state.location === loc) update();
    }, function () {});
  }

  // ---------------------------------------------------------------------------
  // L'immeuble : DPE de l'ADEME regroupés par adresse (data/dpe/, précalculés) et BDNB (précalculée)
  // ---------------------------------------------------------------------------
  var dpeCache = {};
  var ERA_OF = function (y) {
    return y < 1915 ? "pre1914" : y < 1949 ? "1914_1948" : y < 1975 ? "1949_1974" : y < 2006 ? "1975_2005" : "post2005";
  };

  function loadDpe(code) {
    if (!dpeCache[code]) {
      dpeCache[code] = fetchJson("data/dpe/" + code + ".json", 8000).catch(function (e) { delete dpeCache[code]; throw e; });
    }
    return dpeCache[code];
  }

  // Clé d'une adresse dans les fichiers par commune : identifiant BAN sans le code commune, ou complet
  // quand ce code n'est pas celui du fichier (commune fusionnée).
  function banKey(banId, code) {
    banId = banId.toLowerCase();
    return banId.slice(0, 5) === code ? banId.slice(6) : banId;
  }

  // Adresse exacte (identifiant BAN) sinon adresse avec DPE la plus proche, à 30 m au plus.
  function findDpe(file, loc) {
    var rows = file.rows, best = null, bestD = 0.03;
    if (loc.banId) {
      var key = banKey(loc.banId, file.commune);
      for (var i = 0; i < rows.length; i++) if (rows[i][0] === key) return { row: rows[i], exact: true, km: 0 };
    }
    for (var j = 0; j < rows.length; j++) {
      var dx = (rows[j][1] - loc.lon) * M.KM_LON, dy = (rows[j][2] - loc.lat) * M.KM_LAT;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = rows[j]; }
    }
    return best ? { row: best, exact: false, km: bestD } : null;
  }

  function dpeSummary(row) {
    var ete = row[4], prot = row[5], trav = row[6];
    return {
      n: row[3], ete: ete, eteN: ete[0] + ete[1] + ete[2],
      eteMain: ete[2] >= ete[1] && ete[2] >= ete[0] ? "insuffisant" : ete[1] >= ete[0] ? "moyen" : "bon",
      prot: prot, trav: trav, year: row[7], etq: row[8], floor: row[9]
    };
  }

  // BDNB (CSTB) : caractéristiques de l'immeuble par adresse, précalculées (data/bdnb/, scripts/build_bdnb.py).
  var bdnbCache = {};
  function loadBdnb(banId, code) {
    if (!bdnbCache[code]) {
      bdnbCache[code] = fetchJson("data/bdnb/" + code + ".json", 8000).catch(function (e) { delete bdnbCache[code]; throw e; });
    }
    var key = banKey(banId, code);
    return bdnbCache[code].then(function (file) {
      for (var i = 0; i < file.rows.length; i++) {
        var r = file.rows[i];
        if (r[0] === key) {
          return {
            annee_construction: r[1] || 0, mat_mur_txt: r[2] >= 0 ? file.murs[r[2]] : "", mat_toit_txt: r[3] >= 0 ? file.toits[r[3]] : "",
            hauteur_mean: r[4] || 0, nb_niveau: r[5] || 0, nb_log: r[6] || 0
          };
        }
      }
      return null;
    });
  }

  function lookupBuilding(loc) {
    // Fichier de la commune : celle de l'identifiant BAN quand il est dans la zone, sinon celle qui contient le point.
    var fromBan = loc.banId ? loc.banId.slice(0, 5) : "";
    fromBan = MERGED[fromBan] || fromBan;
    var z = ZONE_BY_CODE[fromBan] || M.zoneAt(loc.lon, loc.lat, ZONES);
    if (!z) return;
    var code = z.code;
    var info = { dpe: null, bdnb: null, dpeDone: false, bdnbDone: !loc.banId, failed: false };
    state.building = info;
    var done = function () { if (state.location === loc) { applyBuilding(); update(); } };
    loadDpe(code).then(function (file) {
      var hit = findDpe(file, loc);
      if (hit) info.dpe = Object.assign(dpeSummary(hit.row), { exact: hit.exact, m: Math.round(hit.km * 1000) });
    }, function () { info.failed = true; }).then(function () { info.dpeDone = true; done(); });
    if (loc.banId) {
      loadBdnb(loc.banId, code).then(function (b) { info.bdnb = b; }, function () {}).then(function () { info.bdnbDone = true; done(); });
    }
  }

  function clearPrefill() {
    Object.keys(state.prefilled).forEach(function (k) {
      if (!state.touched[k]) state.profile[k] = M.DEFAULT_PROFILE[k];
    });
    state.prefilled = {};
    if (state.location) state.location.dpeFrom = "";
    syncForm();
  }

  function prefill(key, value) {
    if (state.touched[key] || state.example || !value) return;
    state.profile[key] = value;
    state.prefilled[key] = true;
  }

  function applyBuilding() {
    var b = state.building;
    if (!b) return;
    var d = b.dpe;
    if (d && d.eteN) {
      prefill("dpeEte", d.eteMain);
      if (state.prefilled.dpeEte) state.location.dpeFrom = "building";
    }
    var year = (d && d.year) || (b.bdnb && b.bdnb.annee_construction) || 0;
    if (year) prefill("era", ERA_OF(year));
    syncForm();
  }

  function renderBuilding() {
    var el = $("v-building"), b = state.building;
    if (!el) return;
    if (!b || state.example) { el.hidden = true; return; }
    var parts = [];
    var d = b.dpe;
    if (d) {
      var where = d.exact ? "à cette adresse" : "à " + d.m + " m";
      var line = "<strong>" + d.n + " " + plural(d.n, "DPE", "DPE") + " " + where + "</strong> depuis 2021";
      if (d.eteN) line += " · confort d'été : " + [["bon", 0], ["moyen", 1], ["insuffisant", 2]].filter(function (x) { return d.ete[x[1]]; })
        .map(function (x) { return d.ete[x[1]] + " " + x[0]; }).join(", ");
      parts.push(line);
      var facts = [];
      if (d.year) facts.push("construit vers " + d.year);
      if (d.prot[0] + d.prot[1]) facts.push(Math.round((100 * d.prot[0]) / (d.prot[0] + d.prot[1])) + " % avec protection solaire extérieure");
      if (d.trav[0] + d.trav[1]) facts.push(Math.round((100 * d.trav[0]) / (d.trav[0] + d.trav[1])) + " % traversants");
      if (facts.length) parts.push(facts.join(" · "));
    }
    var x = b.bdnb;
    if (x) {
      var f2 = [];
      if (x.annee_construction) f2.push("année " + x.annee_construction);
      var known = function (t) { return t && !/^ind[eé]termin/i.test(t); };
      if (known(x.mat_mur_txt)) f2.push("murs : " + x.mat_mur_txt.toLowerCase());
      if (known(x.mat_toit_txt)) f2.push("toit : " + x.mat_toit_txt.toLowerCase());
      if (x.hauteur_mean) f2.push(x.hauteur_mean + " m de haut");
      if (x.nb_niveau) f2.push(x.nb_niveau + " niveaux");
      if (f2.length) parts.push("BDNB : " + f2.join(" · "));
    }
    var pre = Object.keys(state.prefilled).map(function (k) { return k === "era" ? "l'époque de construction" : "le confort d'été"; });
    if (pre.length) parts.push("<em>Prérempli : " + pre.join(" et ") + ". Change-les si ton logement diffère.</em>");
    if (!parts.length) {
      if (!b.dpeDone || !b.bdnbDone) parts.push("Recherche des DPE de l'immeuble…");
      else if (b.failed) parts.push("Les données de l'immeuble n'ont pas pu être chargées : le score utilise des valeurs moyennes. <button type=\"button\" class=\"linklike\" id=\"b-retry\">Réessayer</button>");
      else parts.push("Aucun DPE publié depuis 2021 à moins de 30 m.");
    }
    el.innerHTML = parts.map(function (p) { return "<span>" + p + "</span>"; }).join("");
    el.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Recherche d'adresse (Base Adresse Nationale)
  // ---------------------------------------------------------------------------
  var GEOCODERS = [
    function (q) { return "https://data.geopf.fr/geocodage/search?q=" + encodeURIComponent(q) + "&limit=10&lat=48.8566&lon=2.3522"; },
    function (q) { return "https://api-adresse.data.gouv.fr/search/?q=" + encodeURIComponent(q) + "&limit=10&lat=48.8566&lon=2.3522"; }
  ];

  function fetchJson(url, ms) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }, function (e) { clearTimeout(timer); throw e; });
  }

  function geocode(q) {
    var i = 0;
    function next() {
      if (i >= GEOCODERS.length) return Promise.reject(new Error("offline"));
      var url = GEOCODERS[i++](q);
      return fetchJson(url, 5000).then(function (json) {
        return (json.features || []).map(function (f) {
          var p = f.properties || {};
          return {
            label: p.label || q, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
            postcode: p.postcode || "", citycode: p.citycode || "", type: p.type || "", id: p.id || ""
          };
        });
      }).catch(next);
    }
    return next();
  }

  function zoneOnly(results) {
    return results.filter(function (r) { return M.inZone(r.lon, r.lat, ZONES); });
  }

  function fold(t) { return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  // Sans réseau : code postal, nom de commune, ou « 11e », « Paris 11 ».
  function parsePlace(text) {
    var arr = function (n) { return ZONE_BY_CODE[String(75100 + n)]; };
    var m = text.match(/\b75(?:0(\d\d)|116)\b/);
    if (m) return arr(m[1] ? parseInt(m[1], 10) : 16) || null;
    m = text.match(/\b(9[234]\d\d\d)\b/);
    if (m) { var byCp = ZONES.filter(function (z) { return z.cp === m[1]; })[0]; if (byCp) return byCp; }
    var f = " " + fold(text) + " ";
    var named = ZONES.filter(function (z) { return z.dep !== "75" && f.indexOf(" " + fold(z.name) + " ") >= 0; })
      .sort(function (a, b) { return b.name.length - a.name.length; })[0];
    if (named) return named;
    m = text.match(/\b(\d{1,2})\s*(?:e|è|ème|eme|er)\b/i) || text.match(/paris\s+(\d{1,2})\b/i);
    if (m) { var n = parseInt(m[1], 10); if (n >= 1 && n <= 20) return arr(n); }
    return null;
  }

  function note(text, warn) {
    var el = $("addr-note");
    el.textContent = text;
    el.classList.toggle("warn", !!warn);
  }

  function suggestionsHtml(list) {
    return list.map(function (r, i) {
      var m = /^(.*?)\s(\d{5}\s.*)$/.exec(r.label);
      var text = m ? escapeHtml(m[1]) + "<small>" + escapeHtml(m[2]) + "</small>" : escapeHtml(r.label);
      return '<li role="option" id="sug-' + i + '" data-i="' + i + '"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="9.5" r="2.3" fill="currentColor"/></svg><span>' + text + "</span></li>";
    }).join("");
  }

  function chooseSuggestion(r) {
    $("addr-input").value = $("map-search-input").value = r.label;
    markEdited();
    setLocation({ lon: r.lon, lat: r.lat, precision: r.type === "housenumber" ? "address" : "map", label: r.label, banId: r.type === "housenumber" ? r.id : "", approx: r.type !== "housenumber" && r.type !== "street" });
    focusOn(r.lon, r.lat, r.type === "housenumber" ? 46 : 90);
    note(r.type === "housenumber" ? "Adresse localisée." : "Rue localisée. Ajoute le numéro pour plus de précision.");
  }

  function offlineFallback(text) {
    var z = parsePlace(text);
    if (z) {
      markEdited();
      setZone(z);
      note("Recherche d'adresse indisponible ici : position placée au centre " + (z.dep === "75" ? "du " + arrName(z.n) : "de " + z.name) + ". Clique sur la carte pour la préciser.", true);
    } else {
      note("La recherche d'adresse ne répond pas depuis cette page. Clique sur la carte, choisis la commune, ou tape un code postal (ex. 75011 ou 93100).", true);
    }
  }

  // Un champ d'adresse avec sa liste de suggestions : celui du formulaire et celui posé sur la carte.
  function makeSearch(input, ul, id) {
    var suggestions = [], activeIdx = -1, debounce = null, lastQuery = "";
    function show(list) {
      suggestions = list;
      activeIdx = -1;
      input.removeAttribute("aria-activedescendant");
      ul.innerHTML = suggestionsHtml(list).replace(/id="sug-/g, 'id="' + id + '-sug-');
      ul.hidden = !list.length;
    }
    function choose(r) { show([]); other().show([]); chooseSuggestion(r); }
    function other() { return input.id === "addr-input" ? searches.map : searches.main; }
    input.addEventListener("input", function () {
      var q = input.value.trim();
      clearTimeout(debounce);
      if (q.length < 5 || isDown()) { show([]); return; }
      debounce = setTimeout(function () {
        lastQuery = q;
        busy(true);
        geocode(q).then(function (res) {
          if (lastQuery !== q) return;
          show(zoneOnly(res).slice(0, 5));
        }).catch(function () { state.networkDown = Date.now(); show([]); }).then(function () { if (lastQuery === q) busy(false); });
      }, 280);
    });
    input.addEventListener("keydown", function (e) {
      if (ul.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        activeIdx = (activeIdx + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
        Array.prototype.forEach.call(ul.children, function (li, i) { li.setAttribute("aria-selected", i === activeIdx ? "true" : "false"); });
        input.setAttribute("aria-activedescendant", id + "-sug-" + activeIdx);
      } else if (e.key === "Escape") {
        show([]);
      }
    });
    ul.addEventListener("mousedown", function (e) {
      var li = e.target.closest("li");
      if (li) { e.preventDefault(); choose(suggestions[+li.dataset.i]); }
    });
    input.addEventListener("blur", function () { setTimeout(function () { show([]); }, 150); });
    return {
      show: show,
      submit: function () {
        if (!ul.hidden && suggestions.length) { choose(suggestions[Math.max(0, activeIdx)]); return; }
        var q = input.value.trim();
        if (!q) { note("Tape une adresse, ou clique sur la carte.", true); return; }
        $("addr-input").value = $("map-search-input").value = q;
        if (isDown()) { offlineFallback(q); return; }
        note("Recherche de l'adresse…");
        lastQuery = q;
        busy(true);
        geocode(q).then(function (res) {
          busy(false);
          var inside = zoneOnly(res);
          if (inside.length) chooseSuggestion(inside[0]);
          else if (res.length) note("Cette adresse est hors de Paris et de la petite couronne. Fournaise couvre Paris, les Hauts-de-Seine, la Seine-Saint-Denis et le Val-de-Marne pour l'instant.", true);
          else note("Adresse introuvable. Vérifie l'orthographe ou clique sur la carte.", true);
        }).catch(function () { busy(false); state.networkDown = Date.now(); offlineFallback(q); });
      }
    };
  }
  var searches = {};
  function wireAddress() {
    searches.main = makeSearch($("addr-input"), $("addr-suggest"), "sug");
    searches.map = makeSearch($("map-search-input"), $("map-suggest"), "msug");
    $("form").addEventListener("submit", function (e) {
      e.preventDefault();
      (document.activeElement === $("map-search-input") ? searches.map : searches.main).submit();
    });
  }

  function isDown() { return !!state.networkDown && Date.now() - state.networkDown < 20000; }

  function busy(on) {
    $("addr-go").classList.toggle("loading", on);
    $("addr-go").setAttribute("aria-busy", on ? "true" : "false");
  }

  // ---------------------------------------------------------------------------
  // Rendu des résultats
  // ---------------------------------------------------------------------------
  function heatSentence(delta) {
    var a = Math.abs(delta);
    if (a < 0.25) return "nuits proches de celles du parc Montsouris";
    return "nuits environ " + fr(a, 1) + " °C plus " + (delta > 0 ? "chaudes" : "fraîches") + " qu'au parc Montsouris";
  }

  function renderVerdict(r) {
    var color = scoreColor(Math.min(r.score, 9.2));
    var scoreEl = $("v-score");
    scoreEl.style.setProperty("--score-color", color);
    $("verdict").style.setProperty("--score-accent", color);
    var changed = scoreEl.dataset.v !== String(r.scoreRounded);
    scoreEl.innerHTML = r.scoreRounded + "<small>/10</small>";
    scoreEl.dataset.v = r.scoreRounded;
    if (changed) { scoreEl.classList.remove("pop"); void scoreEl.offsetWidth; scoreEl.classList.add("pop"); }
    $("dock-score").textContent = r.scoreRounded;
    $("dock-score").style.setProperty("--score-color", color);
    $("dock-name").textContent = r.verdict.label;
    $("dock-sub").textContent = r.scoreRounded + "/10 · " + nights(r.n26) + " " + plural(r.n26, "nuit étouffante", "nuits étouffantes") + " par été";
    $("v-mark").style.left = ((r.score - 1) / 9) * 100 + "%";
    $("v-name").textContent = r.verdict.label;
    $("v-text").textContent = r.ac
      ? "Avec la clim, l'été reste vivable. Sans elle, ce logement serait noté " + Math.round(M.scoreFrom(r.passive, r.now.n28)) + "/10."
      : r.verdict.text;
    $("v-example").hidden = !state.example;
    $("s-n26").innerHTML = nights(r.n26) + '<span class="u">' + plural(r.n26, "nuit", "nuits") + "</span>";
    $("s-range").textContent = r.ac
      ? "clim allumée les autres nuits (" + nights(r.passive) + " sans clim)"
      : "plage de sensibilité : " + nights(r.range[0]) + " à " + nights(r.range[1]);
    $("s-n28").innerHTML = nights(r.n28) + '<span class="u">' + plural(r.n28, "nuit", "nuits") + "</span>";
    $("s-2050").innerHTML = nights(r.y2050.n26) + '<span class="u">' + plural(r.y2050.n26, "nuit", "nuits") + "</span>";
    var diff = roundNights(r.y2050.n26) - roundNights(r.n26);
    $("s-2050s").textContent = "score " + r.y2050.scoreRounded + "/10" + (diff > 0 ? " · " + diff + " de plus" : "");
    $("s-trop").innerHTML = nights(r.now.tropical) + '<span class="u">par été</span>';

    var arr = r.heat.zone ? r.heat.zone.name : "Paris";
    $("v-extra").textContent = "Moyenne 2017-2026 · pire été : " + r.worstYear.year + " avec " + nights(r.worstYear.n26) + " " + plural(r.worstYear.n26, "nuit", "nuits") +
      " · au seuil de 24 °C recommandé par l'OMS : " + nights(r.n24) + " " + plural(r.n24, "nuit", "nuits") + ".";
    $("v-live").textContent = "Score " + r.scoreRounded + " sur 10, " + r.verdict.label.toLowerCase() + ". " + nights(r.n26) + " " + plural(r.n26, "nuit étouffante", "nuits étouffantes") + " par été, " + nights(r.y2050.n26) + " en 2050. Confiance " + r.confidence.label.toLowerCase() + ".";
    var around = r.heat.built == null ? "" : " (autour : " + Math.round(r.heat.built) + " % bâti, " + Math.round(r.heat.veg) + " % de végétation)";
    $("v-place").textContent = (state.location.label || arr) + " · " + heatSentence(r.heat.delta) + around + ".";
    renderBuilding();

    var conf = r.confidence;
    var chip = $("v-conf");
    chip.className = "chip conf-" + conf.level;
    $("v-conf-text").textContent = "Confiance " + conf.label.toLowerCase();
    $("v-conf-list").innerHTML = conf.reasons.map(function (x) {
      return '<li class="' + (x.ok ? "ok" : "ko") + '">' + escapeHtml(x.text) + "</li>";
    }).join("");
  }

  // Rayures des étés -----------------------------------------------------------
  var stripesGeom = null;
  function renderStripes(r) {
    var canvas = $("stripes"), wrap = $("stripes-wrap");
    var sim = state.view === "now" ? r.now : r.y2050.sim;
    var W = Math.max(300, wrap.clientWidth);
    var narrow = W < 520;
    var labelW = narrow ? 36 : 46, countW = narrow ? 30 : 56, top = 24, rowH = 20, gap = 4;
    var rows = sim.years.length;
    var H = top + rows * (rowH + gap);
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var ink = cssVar("--ink"), muted = cssVar("--muted"), line = cssVar("--line");
    var cellW = (W - labelW - countW) / 122;
    ctx.font = "500 11px " + cssVar("--font-data");
    ctx.fillStyle = muted;
    ctx.textBaseline = "middle";
    MONTH_START.forEach(function (d, i) {
      var x = labelW + d * cellW;
      ctx.fillText(narrow ? MONTHS[i].slice(0, 4) + "." : MONTHS[i], x + 2, 10);
      ctx.fillStyle = line;
      ctx.fillRect(x, 17, 1, H - 17);
      ctx.fillStyle = muted;
    });
    ctx.textAlign = "right";
    ctx.fillText("nuits", W, 10);
    sim.years.forEach(function (y, row) {
      var yy = top + row * (rowH + gap);
      ctx.fillStyle = muted;
      ctx.textAlign = "left";
      ctx.font = "500 " + (narrow ? 10 : 12) + "px " + cssVar("--font-data");
      ctx.fillText(narrow ? "'" + String(y.year).slice(2) : String(y.year), 0, yy + rowH / 2);
      for (var d = 0; d < y.indoor.length; d++) {
        ctx.fillStyle = tempColor(y.indoor[d]);
        ctx.fillRect(labelW + d * cellW, yy, Math.ceil(cellW + 0.4), rowH);
      }
      ctx.textAlign = "right";
      ctx.fillStyle = y.n26 >= 1 ? ink : muted;
      ctx.font = (y.n26 >= 20 ? "600 " : "500 ") + "12px " + cssVar("--font-data");
      ctx.fillText(String(y.n26), W, yy + rowH / 2);
    });
    $("years-caption").textContent = state.view === "now" ? "Nuits étouffantes par été, climat observé 2017-2026" : "Nuits étouffantes par été, mêmes étés en version 2050";
    $("years-table").querySelector("tbody").innerHTML = sim.years.map(function (y) {
      return "<tr><th scope=\"row\">" + y.year + '</th><td class="num">' + y.n26 + '</td><td class="num">' + y.n28 + '</td><td class="num">' + y.tropical + "</td></tr>";
    }).join("");
    stripesGeom = { W: W, labelW: labelW, countW: countW, top: top, rowH: rowH, gap: gap, cellW: cellW, sim: sim };
    renderStripesLegend();
  }

  function renderStripesLegend() {
    var stops = [19, 22.5, 25, 26.5, 28.5, 31.5, 35];
    var grad = "linear-gradient(90deg," + stops.map(function (t, i) { return tempColor(t) + " " + Math.round((i / (stops.length - 1)) * 100) + "%"; }).join(",") + ")";
    var label = state.view === "now"
      ? "Climat observé 2017-2026"
      : "Mêmes étés, +" + fr(M.SCENARIOS_2050.central.tn, 1) + " °C la nuit et +" + fr(M.SCENARIOS_2050.central.tx, 1) + " °C le jour";
    $("stripes-legend").innerHTML =
      '<span class="ramp"><span class="num">19 °C</span><span class="bar" style="background:' + grad + '"></span><span class="num">35 °C</span></span>' +
      "<span>Seuil de nuit étouffante : 26 °C dans la chambre</span><span>" + escapeHtml(label) + "</span>";
  }

  function wireStripes() {
    var canvas = $("stripes"), tip = $("stripes-tip");
    function move(ev) {
      var g = stripesGeom;
      if (!g) return;
      var rect = canvas.getBoundingClientRect();
      var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      var row = Math.floor((y - g.top) / (g.rowH + g.gap));
      var d = Math.floor((x - g.labelW) / g.cellW);
      if (row < 0 || row >= g.sim.years.length || d < 0 || d >= 122 || (y - g.top) % (g.rowH + g.gap) > g.rowH) { tip.hidden = true; return; }
      var yr = g.sim.years[row], t = yr.indoor[d];
      var label = dayLabel(d) + " " + yr.year + (state.view === "now" ? "" : " (version 2050)");
      tip.innerHTML = escapeHtml(label) + " · chambre <span class=\"num\">" + fr(t, 1) + " °C</span>" + " · nuit dehors <span class=\"num\">" + fr(yr.tnLocal[d], 1) + " °C</span>";
      tip.style.left = Math.min(Math.max(x, 120), g.W - 120) + "px";
      tip.style.top = g.top + row * (g.rowH + g.gap) + "px";
      tip.hidden = false;
    }
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("click", move);
    canvas.addEventListener("mouseleave", function () { tip.hidden = true; });
    ["now", "2050"].forEach(function (v) {
      $("view-" + v).addEventListener("click", function () {
        state.view = v;
        $("view-now").setAttribute("aria-pressed", v === "now" ? "true" : "false");
        $("view-2050").setAttribute("aria-pressed", v === "2050" ? "true" : "false");
        if (state.result) renderStripes(state.result);
      });
    });
  }

  // Soirée chaude ------------------------------------------------------------
  function renderWaterfall(r) {
    var e = r.evening;
    var items = [
      { label: "Air extérieur des derniers jours", value: e.outdoor, base: true },
      { label: "Îlot de chaleur du quartier", value: e.quartier },
      { label: r.params.profile.floor === "roof" ? "Toiture juste au-dessus" : "Chaleur de la toiture", value: e.roof, skip: e.roof < 0.05 },
      { label: "Soleil par les fenêtres", value: e.facade },
      { label: "Chaleur produite dedans", value: e.gain },
      { label: "Fraîcheur de la nuit", value: e.vent },
      { label: "Chambre au coucher", value: e.indoor, total: true }
    ].filter(function (x) { return !x.skip; });
    var running = 0, rows = [];
    items.forEach(function (it) {
      if (it.base) { rows.push({ it: it, from: 18, to: it.value }); running = it.value; }
      else if (it.total) rows.push({ it: it, from: 18, to: it.value });
      else { rows.push({ it: it, from: running, to: running + it.value }); running += it.value; }
    });
    var maxT = Math.max.apply(null, rows.map(function (r) { return Math.max(r.from, r.to); }));
    var lo = 18, hi = Math.max(30, Math.ceil(maxT + 0.5));
    var pct = function (t) { return ((t - lo) / (hi - lo)) * 100; };
    var thr = pct(M.THRESHOLD);
    var html = rows.map(function (row) {
      var a = Math.min(row.from, row.to), b = Math.max(row.from, row.to);
      var color = row.it.total ? tempColor(row.it.value) : row.it.base ? cssVar("--muted") : row.to < row.from ? cssVar("--h0") : cssVar("--h3");
      var val = row.it.base || row.it.total ? fr(row.it.value, 1) + " °C" : (row.it.value >= 0 ? "+" : "−") + fr(Math.abs(row.it.value), 1) + " °C";
      return '<div class="wf-row' + (row.it.total ? " total" : "") + '" role="listitem"><span class="lab">' + escapeHtml(row.it.label) + "</span>" +
        '<span class="wf-track"><span class="wf-bar" style="left:' + pct(a).toFixed(2) + "%;width:" + Math.max(0.6, pct(b) - pct(a)).toFixed(2) + "%;background:" + color + '"></span>' +
        '<span class="wf-thr" style="left:' + thr.toFixed(2) + '%"></span></span><span class="val">' + val + "</span></div>";
    }).join("");
    var ticks = [];
    var step = $("wf").clientWidth < 480 ? 4 : 2;
    for (var t = lo; t <= hi; t += step) ticks.push('<span style="left:' + pct(t).toFixed(2) + '%">' + t + "°</span>");
    html += '<div class="wf-axis" aria-hidden="true"><span></span><span class="ticks">' + ticks.join("") + "</span><span></span></div>";
    $("wf").innerHTML = html;
    $("wf-sub").textContent = "Moyenne des " + Math.round(e.days) + " jours par été où il fait plus de 28 °C à Paris-Montsouris.";
    $("wf-caption").textContent = e.indoor >= M.THRESHOLD
      ? "Ces soirs-là, la chambre dépasse en moyenne le seuil de 26 °C (ligne pointillée)."
      : "Ces soirs-là, la chambre reste en moyenne sous le seuil de 26 °C (ligne pointillée).";
  }

  // 2050 ---------------------------------------------------------------------
  function renderFuture(r) {
    $("f-now").innerHTML = nights(r.n26) + ' <small style="font-size:.4em;font-weight:600;color:var(--muted)">' + plural(r.n26, "nuit", "nuits") + "</small>";
    $("f-now").style.color = "color-mix(in srgb, " + scoreColor(Math.min(r.score, 9.2)) + " 80%, var(--ink))";
    $("f-now-s").textContent = "score " + r.scoreRounded + "/10 · " + r.verdict.label.toLowerCase();
    $("f-2050").innerHTML = nights(r.y2050.n26) + ' <small style="font-size:.4em;font-weight:600;color:var(--muted)">' + plural(r.y2050.n26, "nuit", "nuits") + "</small>";
    $("f-2050").style.color = "color-mix(in srgb, " + scoreColor(Math.min(r.y2050.score, 9.2)) + " 80%, var(--ink))";
    $("f-2050-s").textContent = "score " + r.y2050.scoreRounded + "/10 · entre " + nights(r.y2050.range[0]) + " et " + nights(r.y2050.range[1]) + " nuits";
    var lines = [
      ["Aujourd'hui", r.n26, r.score],
      ["2050, fourchette basse", r.y2050.range[0], M.scoreFrom(r.y2050.range[0], 0)],
      ["2050, référence", r.y2050.n26, r.y2050.score],
      ["2050, fourchette haute", r.y2050.range[1], M.scoreFrom(r.y2050.range[1], 0)]
    ];
    var max = Math.max(10, lines.reduce(function (m, l) { return Math.max(m, l[1]); }, 0));
    $("f-bars").innerHTML = lines.map(function (l) {
      return '<div class="bar-row"><span>' + l[0] + '</span><span class="track"><span class="fill" style="display:block;width:' + Math.max(1, (l[1] / max) * 100).toFixed(1) + "%;background:" + scoreColor(l[2]) + '"></span></span><span class="num">' + nights(l[1]) + "</span></div>";
    }).join("");
  }

  // Conseils -----------------------------------------------------------------
  function renderAdvice(list) {
    if (list) state.lastAdvice = list; else list = state.lastAdvice;
    if (state.adviceSelf) list = list.filter(function (a) { return a.who === "Toi"; });
    $("advice").innerHTML = list.slice(0, 6).map(function (a) {
      var gain = a.saved >= 0.5
        ? "−" + Math.round(a.saved) + " " + plural(a.saved, "nuit", "nuits") + (a.felt ? " <small>ressenties</small>" : " <small>par été</small>")
        : "Effet faible <small>ici</small>";
      return '<article class="card tip-card"><span class="who">' + escapeHtml(a.who) + '</span><span class="gain">' + gain + "</span><h3>" + escapeHtml(a.title) + "</h3><p>" + escapeHtml(a.text) + "</p></article>";
    }).join("");
  }

  // Questions de visite --------------------------------------------------------
  function renderVisit() {
    var p = state.profile, items = [];
    if (p.shutters === "unknown" || p.shutters === "none") items.push([p.shutters === "unknown", "Y a-t-il des volets ou des stores extérieurs ? Si non, le propriétaire accepte-t-il d'en poser ?"]);
    if (p.orient === "unknown") items.push([true, "De quel côté donnent la chambre et le séjour ? La boussole du téléphone suffit."]);
    if (p.traversant === "unknown") items.push([true, "L'appartement a-t-il des fenêtres sur deux façades opposées pour faire un courant d'air ?"]);
    if (p.dpeEte === "unknown") items.push([true, "Que dit la case « confort d'été » du DPE ? Elle figure sur les diagnostics réalisés depuis 2021."]);
    if (p.era === "unknown") items.push([true, "En quelle année l'immeuble a-t-il été construit ?"]);
    if (p.floor === "roof" || p.floor === "top") items.push([false, "La toiture ou les combles ont-ils été isolés ? Des travaux sont-ils votés en copropriété ?"]);
    items.push([false, "La chambre donne-t-elle sur rue ou sur cour ? Pourras-tu dormir fenêtre ouverte ?"]);
    items.push([false, "Comment était l'appartement en juillet dernier ? Pose la question au locataire qui part ou à un voisin."]);
    $("questions").innerHTML = items.map(function (it) {
      return '<li><span class="tag' + (it[0] ? " todo" : "") + '">' + (it[0] ? "à vérifier" : "à demander") + "</span><span>" + escapeHtml(it[1]) + "</span></li>";
    }).join("");
  }

  // Partage ------------------------------------------------------------------
  function shareLine(r) {
    if (r.scoreRounded >= 8) return "RIP mon été.";
    if (r.scoreRounded >= 6) return "Ventilo obligatoire.";
    if (r.scoreRounded >= 4) return "Ça passe, avec des volets.";
    return "Je dormirai au frais.";
  }
  function shareText(r) {
    var url = shareUrl();
    return "Mon appart a eu " + r.scoreRounded + "/10 sur Fournaise : " + nights(r.n26) + " " + plural(r.n26, "nuit étouffante", "nuits étouffantes") +
      " par été, " + nights(r.y2050.n26) + " en 2050. " + shareLine(r) + (url ? " " + url : "");
  }
  function renderShare(r) {
    $("share-text").textContent = shareText(r);
  }

  function toast(text) {
    var t = $("share-toast");
    t.textContent = text;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.textContent = ""; }, 3500);
  }

  function selectText(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  var downloads = null;
  function wireShare() {
    $("link-btn").addEventListener("click", function () {
      var url = shareUrl();
      if (!url) { toast("Le lien n'existe que sur le site en ligne."); return; }
      track("partage-lien");
      var done = function () { toast("Lien copié."); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt("Copie le lien :", url); });
        else window.prompt("Copie le lien :", url);
      } catch (e) { window.prompt("Copie le lien :", url); }
    });
    if (navigator.share) {
      $("native-btn").hidden = false;
      $("native-btn").addEventListener("click", function () {
        track("partage-natif");
        var data = { title: "Fournaise", text: $("share-text").textContent };
        var url = shareUrl();
        if (url) data.url = url;
        navigator.share(data).catch(function () {});
      });
    }
    $("copy-btn").addEventListener("click", function () {
      track("partage-texte");
      var text = $("share-text").textContent;
      var done = function () { toast("Message copié."); };
      var fallback = function () { selectText($("share-text")); toast("Texte sélectionné : copie-le avec Ctrl+C ou un appui long."); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
        else fallback();
      } catch (e) { fallback(); }
    });
    // Dans l'environnement Claude, l'enregistrement de fichier passe par l'espace « downloads ».
    if (window.claude && typeof window.claude.use === "function") {
      $("img-btn").hidden = true;
      window.claude.use("downloads").then(function (ns) { downloads = ns; $("img-btn").hidden = !ns; }, function () { $("img-btn").hidden = true; });
    }
  }


  // ---------------------------------------------------------------------------
  // État du calcul dans l'adresse de la page (lien partageable)
  // ---------------------------------------------------------------------------
  var PROFILE_KEYS = Q_MAIN.concat(Q_MORE).map(function (q) { return q.key; });
  var QUERY_LIMITS = {};
  Q_MAIN.concat(Q_MORE).forEach(function (q) { QUERY_LIMITS[q.key] = q.opts.map(function (o) { return o[0]; }); });

  function stateQuery() {
    if (!state.location) return "";
    var parts = ["lon=" + state.location.lon.toFixed(3), "lat=" + state.location.lat.toFixed(3)];
    PROFILE_KEYS.forEach(function (k) { parts.push(k + "=" + encodeURIComponent(state.profile[k])); });
    return "?" + parts.join("&");
  }

  function pageBase() { return location.href.split(/[?#]/)[0]; }
  function shareUrl() { return /^https?:/.test(location.protocol) ? pageBase() + stateQuery() : ""; }

  function syncUrl() {
    if (!window.history || !history.replaceState || !/^https?:/.test(location.protocol)) return;
    try { history.replaceState(null, "", state.example ? location.pathname + location.hash : location.pathname + stateQuery() + location.hash); } catch (e) {}
  }

  // Relit un lien partagé. Renvoie true si l'adresse de la page décrivait un logement valide.
  function loadFromQuery() {
    var q = location.search;
    if (!q || q.length < 5) return false;
    var vals = {};
    q.slice(1).split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) { try { vals[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {} }
    });
    var lon = parseFloat(vals.lon), lat = parseFloat(vals.lat);
    if (!isFinite(lon) || !isFinite(lat) || !M.inZone(lon, lat, ZONES)) return false;
    var profile = Object.assign({}, M.DEFAULT_PROFILE);
    PROFILE_KEYS.forEach(function (k) {
      if (vals[k] && QUERY_LIMITS[k].indexOf(vals[k]) >= 0) { profile[k] = vals[k]; state.touched[k] = true; }
    });
    var zone = M.zoneAt(lon, lat, ZONES);
    state.example = null;
    state.profile = profile;
    state.location = { lon: lon, lat: lat, precision: "map", label: "Position partagée, " + zone.name, approx: true };
    state.prefilled = {}; state.building = null;
    $("addr-input").value = $("map-search-input").value = "";
    syncForm();
    note("Lien partagé : position arrondie à environ 100 m. Tu peux la préciser en tapant une adresse.");
    update();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Comparer des logements (gardés dans ce navigateur)
  // ---------------------------------------------------------------------------
  var CMP_KEY = "fournaise-compare", CMP_MAX = 3;
  var compareList = [];
  function readCompare() {
    try {
      var a = JSON.parse(localStorage.getItem(CMP_KEY) || "[]");
      if (Array.isArray(a)) compareList = a.filter(function (x) { return x && typeof x.label === "string" && typeof x.q === "string"; }).slice(0, CMP_MAX);
    } catch (e) { compareList = []; }
  }
  function writeCompare() { try { localStorage.setItem(CMP_KEY, JSON.stringify(compareList)); } catch (e) {} }

  function addCompare() {
    var r = state.result, note = $("cmp-note");
    if (!r || !state.location) return;
    var q = stateQuery();
    if (compareList.some(function (x) { return x.q === q; })) { note.textContent = "Ce logement est déjà dans la comparaison."; return; }
    if (compareList.length >= CMP_MAX) { note.textContent = "Tu peux garder " + CMP_MAX + " logements : retire-en un pour en ajouter."; return; }
    var F = M.FACTORS, p = state.profile;
    compareList.push({
      label: state.location.label, q: q, score: r.scoreRounded, s: r.score, verdict: r.verdict.label,
      n26: roundNights(r.n26), n28: roundNights(r.n28), n2050: roundNights(r.y2050.n26), s2050: r.y2050.scoreRounded,
      delta: Math.round(r.heat.delta * 10) / 10, conf: r.confidence.label,
      traits: [F.floor[p.floor].label, F.orient[p.orient].label, F.shutters[p.shutters].label]
    });
    writeCompare();
    renderCompare();
    track("comparer");
    note.textContent = "Ajouté : " + compareList.length + " logement" + (compareList.length > 1 ? "s" : "") + " gardé" + (compareList.length > 1 ? "s" : "") + ". La comparaison est plus bas.";
  }

  function renderCompare() {
    var sec = $("comparer");
    sec.hidden = !compareList.length;
    if (!compareList.length) return;
    var n = compareList.length;
    var best = n > 1 ? compareList.reduce(function (b, x, i) { return x.s < compareList[b].s || (x.s === compareList[b].s && x.n26 < compareList[b].n26) ? i : b; }, 0) : -1;
    var worst = n > 1 ? compareList.reduce(function (w, x, i) { return x.s > compareList[w].s ? i : w; }, 0) : -1;
    var max26 = Math.max.apply(null, compareList.map(function (x) { return Math.max(x.n26, x.n2050); })) || 1;
    var summary = "";
    if (n === 1) summary = "Un seul logement gardé. Ajoute-en un autre pour voir lequel passe l'été le mieux.";
    else if (compareList[best].n26 === compareList[worst].n26) summary = "Ces logements ont autant de nuits étouffantes par été : départage-les avec les conseils et les questions à poser.";
    else summary = compareList[best].label + " passe l'été le mieux : " + (compareList[worst].n26 - compareList[best].n26) + " nuits étouffantes de moins par été que " + compareList[worst].label + " (" + compareList[best].n26 + " contre " + compareList[worst].n26 + ").";
    $("cmp-summary").textContent = summary;
    var bar = function (v, s) {
      return '<span class="cmp-track"><span class="cmp-fill" style="width:' + Math.max(2, (v / max26) * 100).toFixed(1) + "%;background:" + scoreColor(Math.min(s, 9.2)) + '"></span></span>';
    };
    $("cmp").innerHTML = compareList.map(function (x, i) {
      var win = i === best, gap = best >= 0 && !win ? x.n26 - compareList[best].n26 : 0;
      return '<article class="cmp-card' + (win ? " winner" : "") + '" style="--c:' + scoreColor(Math.min(x.s, 9.2)) + '" aria-label="' + escapeHtml(x.label) + '">' +
        (win ? '<span class="cmp-crown"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 17l-1-9 5 4 4-7 4 7 5-4-1 9z" fill="currentColor"/></svg>Le plus frais</span>' : n > 1 ? '<span class="cmp-crown ghost">' + (gap > 0 ? "+" + gap + " nuits vs le plus frais" : "À égalité") + "</span>" : "") +
        '<h3 class="cmp-name">' + escapeHtml(x.label) + "</h3>" +
        '<div class="cmp-score"><span class="num">' + x.score + "</span><small>/10</small><span class=\"cmp-verdict\">" + escapeHtml(x.verdict) + "</span></div>" +
        '<div class="cmp-metric"><span>Nuits étouffantes par été</span><b>' + x.n26 + "</b>" + bar(x.n26, x.s) + "</div>" +
        '<div class="cmp-metric"><span>En 2050</span><b>' + x.n2050 + "</b>" + bar(x.n2050, x.s2050) + "</div>" +
        '<ul class="cmp-facts"><li>' + x.traits.map(escapeHtml).join("</li><li>") + "</li><li>Quartier la nuit : " + (x.delta >= 0 ? "+" : "−") + fr(Math.abs(x.delta), 1) + " °C</li><li>Confiance " + escapeHtml(x.conf.toLowerCase()) + "</li></ul>" +
        '<div class="cmp-acts"><a href="' + escapeHtml(x.q) + '">Rouvrir</a><button type="button" class="linklike" data-remove="' + i + '">Retirer</button></div></article>';
    }).join("");
    $("cmp-add").hidden = n >= CMP_MAX;
  }

  function wireCompare() {
    readCompare();
    renderCompare();
    $("cmp-btn").addEventListener("click", addCompare);
    $("cmp").addEventListener("click", function (e) {
      var b = e.target.closest("[data-remove]");
      if (!b) return;
      compareList.splice(parseInt(b.getAttribute("data-remove"), 10), 1);
      writeCompare();
      renderCompare();
      $("cmp-note").textContent = "Logement retiré de la comparaison.";
    });
  }

  // Carte au clavier : les flèches déplacent le point, validé après une courte pause.
  function wireMapKeys() {
    var svg = $("map"), timer = null, cur = null;
    svg.addEventListener("keydown", function (e) {
      if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") { e.preventDefault(); zoomAt(e.key === "-" || e.key === "_" ? 1 / 0.55 : 0.55, null, null, 200); return; }
      var dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (!dir) return;
      e.preventDefault();
      if (!cur) cur = state.location ? { lon: state.location.lon, lat: state.location.lat } : { lon: 2.3522, lat: 48.8566 };
      var step = e.shiftKey ? 0.6 : 0.15;
      var lon = cur.lon + (dir[0] * step) / M.KM_LON, lat = cur.lat + (dir[1] * step) / M.KM_LAT;
      var z = M.zoneAt(lon, lat, ZONES);
      if (!z) { note(OUTSIDE, true); return; }
      cur = { lon: lon, lat: lat };
      clearTimeout(timer);
      timer = setTimeout(function () {
        markEdited();
        setLocation({ lon: cur.lon, lat: cur.lat, precision: "map", label: "Point placé sur la carte, " + z.name });
        note("Position déplacée " + inZoneText(z) + ".");
        cur = null;
      }, 350);
    });
    svg.addEventListener("blur", function () { cur = null; });
  }

  function wireAdviceFilter() {
    ["all", "self"].forEach(function (v) {
      $("adv-" + v).addEventListener("click", function () {
        state.adviceSelf = v === "self";
        $("adv-all").setAttribute("aria-pressed", v === "all" ? "true" : "false");
        $("adv-self").setAttribute("aria-pressed", v === "self" ? "true" : "false");
        renderAdvice();
      });
    });
  }

  // Tableau des coefficients (calculé depuis le modèle) -------------------------
  function renderCoefTable() {
    var base = { floor: "mid", orient: "N", windows: "double", shutters: "none", traversant: "no", nightOpen: "yes", era: "1914_1948", size: "m", dpeEte: "moyen", ac: "no" };
    function evening(p) {
      var prm = M.params(Object.assign({}, base, p));
      var trm = 29, tn = 22, sun = 1.25;
      var free = 20 + prm.damping * (trm - 20) + prm.gain + (prm.roof + prm.facade) * sun;
      return free - prm.vent * (free - tn);
    }
    var ref = evening({});
    var rows = [
      ["Sous les toits (au lieu d'un étage intermédiaire)", { floor: "roof" }],
      ["Velux sous les toits", { floor: "roof", windows: "roof" }],
      ["Dernier étage", { floor: "top" }],
      ["Fenêtres plein ouest (au lieu du nord)", { orient: "W" }],
      ["Fenêtres plein sud", { orient: "S" }],
      ["Volets ou stores extérieurs, côté sud", { orient: "S", shutters: "ext" }],
      ["Rideaux intérieurs, côté sud", { orient: "S", shutters: "int" }],
      ["Moins de 15 m²", { size: "xs" }],
      ["Immeuble 1949-1974", { era: "1949_1974" }],
      ["Pierre, avant 1914", { era: "pre1914" }],
      ["Confort d'été DPE insuffisant", { dpeEte: "insuffisant" }],
      ["Appartement traversant", { traversant: "yes" }],
      ["Fenêtres fermées la nuit", { nightOpen: "no" }]
    ];
    $("coef-table").querySelector("tbody").innerHTML = rows.map(function (r) {
      var d = evening(r[1]) - ref;
      return "<tr><td>" + escapeHtml(r[0]) + '</td><td class="num">' + (d >= 0 ? "+" : "−") + fr(Math.abs(d), 1) + " °C</td></tr>";
    }).join("");
  }

  // ---------------------------------------------------------------------------
  function update() {
    if (!state.location) return;
    ensureTiles(state.location);
    var r = M.analyze(D.climate, state.location, state.profile, ZONES);
    state.result = r;
    renderVerdict(r);
    renderStripes(r);
    renderWaterfall(r);
    renderFuture(r);
    renderAdvice(M.advice(D.climate, state.location, state.profile, ZONES, r));
    renderVisit();
    renderShare(r);
    placePin();
    revealPin();
    syncUrl();
    document.dispatchEvent(new CustomEvent("fournaise:update"));
    $("loc-text").innerHTML = "<strong>" + escapeHtml(state.location.label) + "</strong>";
    Array.prototype.forEach.call(document.querySelectorAll("[data-example]"), function (b) {
      b.setAttribute("aria-pressed", b.dataset.example === state.example ? "true" : "false");
    });
  }

  var HERO_STOPS = [[8, 0], [13, 1], [17, 2], [19.5, 3], [22, 4], [24, 5], [26, 6]];
  function renderHero() {
    var canvas = $("hero-stripes");
    if (!canvas) return;
    var W = Math.max(280, canvas.parentNode.clientWidth), rows = D.climate.tn.length, rowH = 18, gap = 3, pad = 14, labelW = 34;
    var H = pad * 2 + rows * (rowH + gap) - gap;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = H + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cw = (W - pad * 2 - labelW) / 122;
    ctx.font = "500 11px " + cssVar("--font-data"); ctx.fillStyle = cssVar("--muted"); ctx.textBaseline = "middle";
    D.climate.tn.forEach(function (row, i) {
      var y = pad + i * (rowH + gap);
      ctx.fillStyle = cssVar("--muted"); ctx.fillText("'" + String(D.climate.years[i]).slice(2), pad, y + rowH / 2);
      row.forEach(function (t, d) {
        ctx.fillStyle = rgb(ramp(HERO_STOPS, t));
        ctx.fillRect(pad + labelW + d * cw, y, Math.ceil(cw + 0.4), rowH);
      });
    });
  }

  function wireTheme() {
    var btn = $("theme-btn"), root = document.documentElement;
    try { var saved = localStorage.getItem("fournaise-theme"); if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved); } catch (e) {}
    btn.addEventListener("click", function () {
      var dark = root.getAttribute("data-theme") === "dark" || (!root.getAttribute("data-theme") && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      var next = dark ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("fournaise-theme", next); } catch (e) {}
    });
  }

  function wireMapTip() {
    var svg = $("map"), box = svg.parentNode, tip = document.createElement("div");
    tip.className = "map-tip"; tip.hidden = true; box.appendChild(tip);
    svg.addEventListener("mousemove", function (ev) {
      var ll = eventLonLat(svg, ev);
      var z = M.zoneAt(ll[0], ll[1], ZONES);
      if (!z) { tip.hidden = true; return; }
      var d = M.localHeat(ll[0], ll[1]).delta;
      tip.textContent = z.name + " · " + (d >= 0 ? "+" : "−") + fr(Math.abs(d), 1) + " °C la nuit";
      tip.style.left = (ev.clientX - box.getBoundingClientRect().left) + "px";
      tip.style.top = (ev.clientY - box.getBoundingClientRect().top) + "px";
      tip.hidden = false;
    });
    svg.addEventListener("mouseleave", function () { tip.hidden = true; });
  }

  function syncThemeColor() {
    var bg = cssVar("--bg");
    Array.prototype.forEach.call(document.querySelectorAll('meta[name="theme-color"]'), function (m) { m.setAttribute("content", bg); });
  }

  // Barre de score flottante sur mobile : visible tant qu'on remplit le formulaire sans voir le verdict.
  function wireDock() {
    var dock = $("dock");
    if (!window.IntersectionObserver) return;
    var seen = { form: false, verdict: false };
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { seen[e.target.id] = e.isIntersecting; });
      var show = seen.form && !seen.verdict && state.result && window.matchMedia("(max-width: 900px)").matches;
      dock.hidden = false;
      dock.classList.toggle("on", !!show);
      dock.setAttribute("aria-hidden", show ? "false" : "true");
      dock.tabIndex = show ? 0 : -1;
    }, { rootMargin: "-30% 0px -10% 0px" });
    io.observe($("form"));
    io.observe($("verdict"));
  }

  // Lien actif dans la barre du haut selon la section lue.
  function wireScrollSpy() {
    if (!window.IntersectionObserver) return;
    var links = {};
    Array.prototype.forEach.call(document.querySelectorAll(".topbar nav a"), function (a) { links[a.getAttribute("href").slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        Object.keys(links).forEach(function (id) { links[id].removeAttribute("aria-current"); });
        links[e.target.id].setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    Object.keys(links).forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  }

  function onThemeChange() {
    syncThemeColor();
    readPalette();
    refreshMapHeat();
    renderHero();
    if (state.result) update();
    renderCompare();
    document.dispatchEvent(new CustomEvent("fournaise:theme"));
  }

  // Ce que les modules complémentaires (js/share.js, …) peuvent utiliser.
  window.FournaiseApp = {
    state: state, M: M, D: D, ZONES: ZONES, Q_MAIN: Q_MAIN, syncForm: syncForm, note: note,
    nights: nights, plural: plural, fr: fr, roundNights: roundNights, escapeHtml: escapeHtml,
    scoreColor: scoreColor, tempColor: tempColor, toast: toast, track: track,
    shareLine: shareLine, shareText: shareText, shareUrl: shareUrl,
    downloads: function () { return downloads; },
    siteHost: function () { return "aloysdeboissezon.github.io/Fournaise"; }
  };

  function init() {
    readPalette();
    renderQuestions($("q-main"), Q_MAIN);
    renderQuestions($("q-more"), Q_MORE);
    $("form").addEventListener("change", function (e) {
      var t = e.target;
      if (t.type !== "radio") return;
      state.profile[t.name.slice(2)] = t.value;
      state.touched[t.name.slice(2)] = true;
      delete state.prefilled[t.name.slice(2)];
      markEdited();
      update();
    });
    renderExamples();
    renderZoneSelect();
    renderMap();
    wireAddress();
    wireStripes();
    wireShare();
    renderCoefTable();
    wireTheme();
    wireMapTip();
    renderHero();
    if (!loadFromQuery()) loadExample("bonne");
    wireCompare();
    wireMapKeys();
    wireAdviceFilter();
    $("v-building").addEventListener("click", function (e) { if (e.target.id === "b-retry" && state.location) { state.building = null; lookupBuilding(state.location); } });
    wireDock();
    wireScrollSpy();
    syncThemeColor();
    document.documentElement.classList.add("ready");
    if ("serviceWorker" in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(function () {});

    var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (mq && mq.addEventListener) mq.addEventListener("change", onThemeChange);
    if (window.MutationObserver) new MutationObserver(onThemeChange).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    var lastW = 0;
    var onResize = function () {
      var w = $("stripes-wrap").clientWidth;
      renderHero();
      if (w !== lastW && state.result) { lastW = w; renderStripes(state.result); }
    };
    if (window.ResizeObserver) new ResizeObserver(onResize).observe($("stripes-wrap"));
    else window.addEventListener("resize", onResize);
    window.addEventListener("resize", renderHero);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (state.result) renderStripes(state.result); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
