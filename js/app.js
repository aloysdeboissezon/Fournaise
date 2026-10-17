/* Fournaise — interface. Dépend de js/data-paris.js et js/model.js. */
(function () {
  "use strict";

  var D = window.FOURNAISE_DATA;
  var M = window.FournaiseModel;
  var ARRS = D.arrondissements;
  var $ = function (id) { return document.getElementById(id); };

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
    networkDown: false,
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
  function nights(n) {
    if (n < 0.5) return "0";
    if (n < 1) return "< 1";
    return fr(Math.round(n));
  }
  function plural(n, one, many) { return Math.round(n) >= 2 ? many : one; }
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
      b.addEventListener("click", function () { loadExample(ex.id); });
      box.appendChild(b);
    });
  }

  function loadExample(id) {
    var ex = EXAMPLES.filter(function (e) { return e.id === id; })[0];
    state.example = ex.id;
    state.profile = Object.assign({}, M.DEFAULT_PROFILE, ex.profile);
    state.location = Object.assign({}, ex.location);
    state.touched = {}; state.prefilled = {}; state.building = null;
    $("addr-input").value = "";
    syncForm();
    update();
  }

  function markEdited() {
    state.example = null;
  }

  // ---------------------------------------------------------------------------
  // Carte de Paris
  // ---------------------------------------------------------------------------
  var MAPB = { minLon: 2.221, maxLon: 2.473, minLat: 48.813, maxLat: 48.905 };
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
  function mainRing(arr) {
    return arr.rings.reduce(function (best, r) { return r.length > best.length ? r : best; }, arr.rings[0]);
  }
  // Points d'étiquette ajustés à la main là où le centroïde tombe mal.
  var LABEL_NUDGE = { 16: [2.268, 48.858], 12: [2.398, 48.838] };
  var NS = "http://www.w3.org/2000/svg";

  function heatRaster() {
    var RW = 210, RH = Math.round((RW * MAP_H) / MAP_W);
    var c = document.createElement("canvas");
    c.width = RW; c.height = RH;
    var ctx = c.getContext("2d");
    var img = ctx.createImageData(RW, RH);
    for (var y = 0; y < RH; y++) {
      for (var x = 0; x < RW; x++) {
        var ll = unproject(((x + 0.5) / RW) * MAP_W, ((y + 0.5) / RH) * MAP_H);
        if (!M.inParis(ll[0], ll[1], ARRS)) continue;
        var col = ramp(MAP_STOPS, M.localHeat(ll[0], ll[1], ARRS).delta);
        var o = (y * RW + x) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 200;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  function renderMap() {
    var svg = $("map");
    svg.setAttribute("viewBox", "0 0 " + MAP_W + " " + MAP_H);
    var allPaths = ARRS.map(function (a) { return a.rings.map(ringPath).join(""); }).join("");
    var labels = ARRS.map(function (a) {
      var c = LABEL_NUDGE[a.n] || ringCentroid(mainRing(a));
      var p = project(c[0], c[1]);
      return '<text class="arr-label" x="' + p[0].toFixed(1) + '" y="' + (p[1] + 4).toFixed(1) + '" text-anchor="middle">' + a.n + "</text>";
    }).join("");
    var seine = M.SEINE.map(function (c, i) { var p = project(c[0], c[1]); return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("");
    svg.innerHTML =
      '<defs><clipPath id="paris-clip"><path d="' + allPaths + '"/></clipPath></defs>' +
      '<image id="map-heat" x="0" y="0" width="' + MAP_W + '" height="' + MAP_H + '" preserveAspectRatio="none" clip-path="url(#paris-clip)" href="' + heatRaster() + '"/>' +
      '<path d="' + seine + '" fill="none" stroke="var(--seine)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" clip-path="url(#paris-clip)"/>' +
      ARRS.map(function (a) { return '<path d="' + a.rings.map(ringPath).join("") + '" fill="none" stroke="var(--map-line)" stroke-width="0.9"/>'; }).join("") +
      labels +
      '<g id="map-pin" visibility="hidden"><circle class="pin-halo" r="15"/><circle class="pin-dot" r="6"/></g>';
    svg.addEventListener("click", function (ev) {
      var rect = svg.getBoundingClientRect();
      var x = ((ev.clientX - rect.left) / rect.width) * MAP_W, y = ((ev.clientY - rect.top) / rect.height) * MAP_H;
      var ll = unproject(x, y);
      var arr = M.arrondissementAt(ll[0], ll[1], ARRS);
      if (!arr) { note("Ce point est hors de Paris. Fournaise ne couvre que Paris pour l'instant.", true); return; }
      markEdited();
      setLocation({ lon: ll[0], lat: ll[1], precision: "map", label: "Point placé sur la carte, Paris " + arrName(arr.n) });
      note("Position enregistrée. Tu peux la déplacer en cliquant ailleurs.");
    });
  }

  function refreshMapHeat() {
    var img = document.getElementById("map-heat");
    if (img) img.setAttribute("href", heatRaster());
  }

  function placePin() {
    var pin = $("map-pin");
    if (!pin || !state.location) return;
    var p = project(state.location.lon, state.location.lat);
    pin.setAttribute("transform", "translate(" + p[0].toFixed(1) + " " + p[1].toFixed(1) + ")");
    pin.setAttribute("visibility", "visible");
  }

  function arrName(n) { return n === 1 ? "1er" : n + "e"; }

  function renderArrSelect() {
    var sel = $("arr-select");
    sel.innerHTML = '<option value="">Ou choisis l\'arrondissement</option>' + ARRS.map(function (a) {
      return '<option value="' + a.n + '">Paris ' + arrName(a.n) + " · " + escapeHtml(a.name) + "</option>";
    }).join("");
    sel.addEventListener("change", function () {
      if (!sel.value) return;
      markEdited();
      setArrondissement(parseInt(sel.value, 10));
      sel.value = "";
    });
  }

  function setArrondissement(n) {
    var arr = ARRS.filter(function (a) { return a.n === n; })[0];
    var c = LABEL_NUDGE[n] || ringCentroid(mainRing(arr));
    setLocation({ lon: c[0], lat: c[1], precision: "arr", label: "Centre du " + arrName(n) + " arrondissement" });
    note("Position approximative au centre de l'arrondissement. Clique sur la carte pour la préciser.");
  }

  function setLocation(loc) {
    state.location = loc;
    state.building = null;
    clearPrefill();
    update();
    if (loc.precision !== "arr" && !loc.approx) lookupBuilding(loc);
  }

  // ---------------------------------------------------------------------------
  // L'immeuble : DPE de l'ADEME regroupés par adresse (data/dpe/, précalculés) et BDNB (en direct)
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

  // Adresse exacte (identifiant BAN) sinon adresse avec DPE la plus proche, à 30 m au plus.
  function findDpe(file, loc) {
    var rows = file.rows, best = null, bestD = 0.03;
    if (loc.banId && loc.banId.slice(0, 5) === file.commune) {
      var key = loc.banId.slice(6);
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

  // BDNB (CSTB) : deux appels, adresse BAN → groupe de bâtiments → caractéristiques. Quota limité par visiteur.
  var BDNB = "https://api.bdnb.io/v1/bdnb/donnees/";
  function loadBdnb(banId) {
    return fetchJson(BDNB + "rel_batiment_groupe_adresse?select=batiment_groupe_id&cle_interop_adr=eq." + encodeURIComponent(banId), 6000).then(function (rel) {
      if (!rel.length) return null;
      return fetchJson(BDNB + "batiment_groupe_complet?select=annee_construction,mat_mur_txt,mat_toit_txt,hauteur_mean,nb_niveau&batiment_groupe_id=eq." + encodeURIComponent(rel[0].batiment_groupe_id), 6000)
        .then(function (b) { return b[0] || null; });
    });
  }

  function lookupBuilding(loc) {
    var arr = M.arrondissementAt(loc.lon, loc.lat, ARRS);
    if (!arr) return;
    var code = String(75100 + arr.n);
    var info = { dpe: null, bdnb: null, dpeDone: false, bdnbDone: !loc.banId, failed: false };
    state.building = info;
    var done = function () { if (state.location === loc) { applyBuilding(); update(); } };
    loadDpe(code).then(function (file) {
      var hit = findDpe(file, loc);
      if (hit) info.dpe = Object.assign(dpeSummary(hit.row), { exact: hit.exact, m: Math.round(hit.km * 1000) });
    }, function () { info.failed = true; }).then(function () { info.dpeDone = true; done(); });
    if (loc.banId) {
      loadBdnb(loc.banId).then(function (b) { info.bdnb = b; }, function () {}).then(function () { info.bdnbDone = true; done(); });
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
      if (f2.length) parts.push("BDNB : " + f2.join(" · "));
    }
    var pre = Object.keys(state.prefilled).map(function (k) { return k === "era" ? "l'époque de construction" : "le confort d'été"; });
    if (pre.length) parts.push("<em>Prérempli : " + pre.join(" et ") + ". Change-les si ton logement diffère.</em>");
    if (!parts.length) {
      if (!b.dpeDone || !b.bdnbDone) parts.push("Recherche des DPE de l'immeuble…");
      else if (b.failed) parts.push("Les DPE de l'immeuble ne sont pas disponibles dans cette version de la page.");
      else parts.push("Aucun DPE publié depuis 2021 à moins de 30 m.");
    }
    el.innerHTML = parts.map(function (p) { return "<span>" + p + "</span>"; }).join("");
    el.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Recherche d'adresse (Base Adresse Nationale)
  // ---------------------------------------------------------------------------
  var GEOCODERS = [
    function (q) { return "https://data.geopf.fr/geocodage/search?q=" + encodeURIComponent(q) + "&limit=6&lat=48.8566&lon=2.3522"; },
    function (q) { return "https://api-adresse.data.gouv.fr/search/?q=" + encodeURIComponent(q) + "&limit=6&lat=48.8566&lon=2.3522"; }
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

  function parisOnly(results) {
    return results.filter(function (r) { return M.inParis(r.lon, r.lat, ARRS); });
  }

  // Sans réseau : code postal 750xx ou « 11e », « Paris 11 ».
  function parseArrondissement(text) {
    var m = text.match(/\b75(?:0(\d\d)|116)\b/);
    if (m) return m[1] ? parseInt(m[1], 10) : 16;
    m = text.match(/\b(\d{1,2})\s*(?:e|è|ème|eme|er)\b/i) || text.match(/paris\s+(\d{1,2})\b/i);
    if (m) { var n = parseInt(m[1], 10); if (n >= 1 && n <= 20) return n; }
    return null;
  }

  function note(text, warn) {
    var el = $("addr-note");
    el.textContent = text;
    el.classList.toggle("warn", !!warn);
  }

  var suggestions = [], activeIdx = -1, debounce = null, lastQuery = "";

  function showSuggestions(list) {
    suggestions = list;
    activeIdx = -1;
    var ul = $("addr-suggest");
    if (!list.length) { ul.hidden = true; ul.innerHTML = ""; return; }
    ul.innerHTML = list.map(function (r, i) {
      return '<li role="option" id="sug-' + i + '" data-i="' + i + '">' + escapeHtml(r.label) + "</li>";
    }).join("");
    ul.hidden = false;
  }

  function chooseSuggestion(r) {
    showSuggestions([]);
    $("addr-input").value = r.label;
    markEdited();
    setLocation({ lon: r.lon, lat: r.lat, precision: r.type === "housenumber" ? "address" : "map", label: r.label, banId: r.type === "housenumber" ? r.id : "", approx: r.type !== "housenumber" && r.type !== "street" });
    note(r.type === "housenumber" ? "Adresse localisée." : "Rue localisée. Ajoute le numéro pour plus de précision.");
  }

  function offlineFallback(text) {
    var n = parseArrondissement(text);
    if (n) {
      markEdited();
      setArrondissement(n);
      note("Recherche d'adresse indisponible ici : position placée au centre du " + arrName(n) + ". Clique sur la carte pour la préciser.", true);
    } else {
      note("La recherche d'adresse ne répond pas depuis cette page. Clique sur la carte, choisis l'arrondissement, ou tape un code postal (ex. 75011).", true);
    }
  }

  function wireAddress() {
    var input = $("addr-input"), ul = $("addr-suggest");
    input.addEventListener("input", function () {
      var q = input.value.trim();
      clearTimeout(debounce);
      if (q.length < 5 || state.networkDown) { showSuggestions([]); return; }
      debounce = setTimeout(function () {
        lastQuery = q;
        geocode(q + (/paris|750\d\d/i.test(q) ? "" : " Paris")).then(function (res) {
          if (lastQuery !== q) return;
          showSuggestions(parisOnly(res).slice(0, 5));
        }).catch(function () { state.networkDown = true; showSuggestions([]); });
      }, 280);
    });
    input.addEventListener("keydown", function (e) {
      if (ul.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        activeIdx = (activeIdx + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
        Array.prototype.forEach.call(ul.children, function (li, i) { li.setAttribute("aria-selected", i === activeIdx ? "true" : "false"); });
        input.setAttribute("aria-activedescendant", "sug-" + activeIdx);
      } else if (e.key === "Escape") {
        showSuggestions([]);
      }
    });
    ul.addEventListener("mousedown", function (e) {
      var li = e.target.closest("li");
      if (li) { e.preventDefault(); chooseSuggestion(suggestions[+li.dataset.i]); }
    });
    input.addEventListener("blur", function () { setTimeout(function () { showSuggestions([]); }, 150); });
    $("form").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!ul.hidden && suggestions.length) { chooseSuggestion(suggestions[Math.max(0, activeIdx)]); return; }
      var q = input.value.trim();
      if (!q) { note("Tape une adresse, ou clique sur la carte.", true); return; }
      if (state.networkDown) { offlineFallback(q); return; }
      note("Recherche…");
      geocode(q + (/paris|750\d\d/i.test(q) ? "" : " Paris")).then(function (res) {
        var paris = parisOnly(res);
        if (paris.length) chooseSuggestion(paris[0]);
        else if (res.length) note("Cette adresse est hors de Paris. Fournaise ne couvre que Paris pour l'instant ; Lyon, Marseille et Toulouse sont les prochaines villes.", true);
        else note("Adresse introuvable. Vérifie l'orthographe ou clique sur la carte.", true);
      }).catch(function () { state.networkDown = true; offlineFallback(q); });
    });
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
    scoreEl.innerHTML = r.scoreRounded + "<small>/10</small>";
    $("v-mark").style.left = ((r.score - 1) / 9) * 100 + "%";
    $("v-name").textContent = r.verdict.label;
    $("v-text").textContent = r.ac
      ? "Avec la clim, l'été reste vivable. Sans elle, ce logement serait noté " + Math.round(M.scoreFrom(r.passive, r.now.n28)) + "/10."
      : r.verdict.text;
    $("v-example").hidden = !state.example;
    $("s-n26").innerHTML = nights(r.n26) + '<span class="u">' + plural(r.n26, "nuit", "nuits") + "</span>";
    $("s-range").textContent = r.ac
      ? "clim allumée les autres nuits (" + nights(r.passive) + " sans clim)"
      : "fourchette probable : " + nights(r.range[0]) + " à " + nights(r.range[1]);
    $("s-n28").innerHTML = nights(r.n28) + '<span class="u">' + plural(r.n28, "nuit", "nuits") + "</span>";
    $("s-2050").innerHTML = nights(r.y2050.n26) + '<span class="u">' + plural(r.y2050.n26, "nuit", "nuits") + "</span>";
    var diff = Math.round(r.y2050.n26) - Math.round(r.n26);
    $("s-2050s").textContent = "score " + r.y2050.scoreRounded + "/10" + (diff > 0 ? " · " + diff + " de plus" : "");
    $("s-trop").innerHTML = nights(r.now.tropical) + '<span class="u">par été</span>';

    var arr = r.heat.arr ? "Paris " + arrName(r.heat.arr.n) : "Paris";
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
    $("f-now").innerHTML = nights(r.n26) + ' <small style="font-size:.4em;font-weight:600">' + plural(r.n26, "nuit", "nuits") + "</small>";
    $("f-now").style.color = scoreColor(Math.min(r.score, 9.2));
    $("f-now-s").textContent = "score " + r.scoreRounded + "/10 · " + r.verdict.label.toLowerCase();
    $("f-2050").innerHTML = nights(r.y2050.n26) + ' <small style="font-size:.4em;font-weight:600">' + plural(r.y2050.n26, "nuit", "nuits") + "</small>";
    $("f-2050").style.color = scoreColor(Math.min(r.y2050.score, 9.2));
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
    return "Mon appart a eu " + r.scoreRounded + "/10 sur Fournaise : " + nights(r.n26) + " " + plural(r.n26, "nuit étouffante", "nuits étouffantes") +
      " par été, " + nights(r.y2050.n26) + " en 2050. " + shareLine(r);
  }
  function renderShare(r) {
    var story = $("story");
    var c1 = scoreColor(Math.min(10, r.score + 1.2)), c2 = scoreColor(Math.min(10, r.score + 3));
    story.style.setProperty("--story-a", c1);
    story.style.setProperty("--story-b", c2);
    $("story-score").innerHTML = r.scoreRounded + "<small>/10</small>";
    $("story-line").textContent = shareLine(r);
    var arr = r.heat.arr ? "Paris " + arrName(r.heat.arr.n) : "Paris";
    $("story-meta").textContent = nights(r.n26) + " " + plural(r.n26, "nuit étouffante", "nuits étouffantes") + " par été · " + arr;
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

  function drawShareImage(r) {
    var W = 1080, H = 1350;
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var ctx = c.getContext("2d");
    var g = ctx.createRadialGradient(W * 0.2, 0, 50, W * 0.4, H * 0.4, H * 1.05);
    g.addColorStop(0, scoreColor(Math.min(10, r.score + 1.2)));
    g.addColorStop(0.55, scoreColor(Math.min(10, r.score + 3)));
    g.addColorStop(1, "#24061b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    var shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, "rgba(12,6,14,0.28)");
    shade.addColorStop(1, "rgba(12,6,14,0.7)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "alphabetic";
    ctx.font = "800 52px Unbounded, 'Arial Black', sans-serif";
    ctx.fillText("fournaise", 80, 130);
    ctx.font = "800 420px Unbounded, 'Arial Black', sans-serif";
    var s = String(r.scoreRounded);
    ctx.fillText(s, 70, 760);
    var sw = ctx.measureText(s).width;
    ctx.globalAlpha = 0.8;
    ctx.font = "700 120px Unbounded, 'Arial Black', sans-serif";
    ctx.fillText("/10", 90 + sw, 760);
    ctx.globalAlpha = 1;
    ctx.font = "700 76px Unbounded, 'Arial Black', sans-serif";
    ctx.fillText(shareLine(r), 80, 900);
    ctx.font = "500 44px 'Instrument Sans', 'Segoe UI', sans-serif";
    var arr = r.heat.arr ? "Paris " + arrName(r.heat.arr.n) : "Paris";
    ctx.fillText(nights(r.n26) + " " + plural(r.n26, "nuit étouffante", "nuits étouffantes") + " par été", 80, 1010);
    ctx.fillText(nights(r.y2050.n26) + " en 2050 · " + arr, 80, 1070);
    ctx.globalAlpha = 0.75;
    ctx.font = "500 34px 'Instrument Sans', 'Segoe UI', sans-serif";
    ctx.fillText("Score de chaleur estimé avant de louer · Fournaise", 80, 1250);
    ctx.globalAlpha = 1;
    return c;
  }

  var downloads = null;
  function wireShare() {
    $("copy-btn").addEventListener("click", function () {
      var text = $("share-text").textContent;
      var done = function () { toast("Message copié."); };
      var fallback = function () { selectText($("share-text")); toast("Texte sélectionné : copie-le avec Ctrl+C ou un appui long."); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
        else fallback();
      } catch (e) { fallback(); }
    });
    var imgBtn = $("img-btn");
    var hasClaude = window.claude && typeof window.claude.use === "function";
    if (hasClaude) {
      imgBtn.hidden = true;
      window.claude.use("downloads").then(function (ns) { downloads = ns; imgBtn.hidden = !ns; }, function () { imgBtn.hidden = true; });
    }
    imgBtn.addEventListener("click", function () {
      if (!state.result) return;
      var ready = document.fonts && document.fonts.load
        ? Promise.all([document.fonts.load("800 100px Unbounded"), document.fonts.load("500 40px 'Instrument Sans'")]).catch(function () {})
        : Promise.resolve();
      ready.then(function () {
        var canvas = drawShareImage(state.result);
        canvas.toBlob(function (blob) {
          if (!blob) { toast("L'image n'a pas pu être créée."); return; }
          if (downloads) {
            downloads.save({ filename: "fournaise-score.png", data: blob }).then(function () { toast("Image enregistrée."); }, function (err) {
              if (err && err.code === "declined") return;
              toast("L'enregistrement n'est pas disponible ici.");
            });
          } else {
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "fournaise-score.png";
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            toast("Image enregistrée.");
          }
        }, "image/png");
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
    var r = M.analyze(D.climate, state.location, state.profile, ARRS);
    state.result = r;
    renderVerdict(r);
    renderStripes(r);
    renderWaterfall(r);
    renderFuture(r);
    renderAdvice(M.advice(D.climate, state.location, state.profile, ARRS, r));
    renderVisit();
    renderShare(r);
    placePin();
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
      var rect = svg.getBoundingClientRect();
      var ll = unproject(((ev.clientX - rect.left) / rect.width) * MAP_W, ((ev.clientY - rect.top) / rect.height) * MAP_H);
      var arr = M.arrondissementAt(ll[0], ll[1], ARRS);
      if (!arr) { tip.hidden = true; return; }
      var d = M.localHeat(ll[0], ll[1], ARRS).delta;
      tip.textContent = "Paris " + arrName(arr.n) + " · " + (d >= 0 ? "+" : "−") + fr(Math.abs(d), 1) + " °C la nuit";
      tip.style.left = (ev.clientX - box.getBoundingClientRect().left) + "px";
      tip.style.top = (ev.clientY - box.getBoundingClientRect().top) + "px";
      tip.hidden = false;
    });
    svg.addEventListener("mouseleave", function () { tip.hidden = true; });
  }

  function onThemeChange() {
    readPalette();
    refreshMapHeat();
    renderHero();
    if (state.result) update();
  }

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
    renderArrSelect();
    renderMap();
    wireAddress();
    wireStripes();
    wireShare();
    renderCoefTable();
    wireTheme();
    wireMapTip();
    renderHero();
    loadExample("bonne");

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
