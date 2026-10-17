/*
 * Fournaise — modèle de chaleur intérieure (version 1, Paris).
 *
 * Tout le calcul tourne dans le navigateur, sans serveur. Chaque coefficient
 * est écrit ici en clair pour que le score reste vérifiable.
 *
 * Chaîne de calcul, pour chaque jour du 1er juin au 30 septembre des 10 derniers étés :
 *   1. Relevés réels Tn / Tx de la station Paris-Montsouris.
 *   2. Correction de quartier (îlot de chaleur, grille IGN de 100 m) : Tn + U·f(nuit), Tx + 0,25·U.
 *   3. Moyenne glissante sur 4 jours (inertie du bâtiment) : Trm.
 *   4. Température « libre » du logement le soir :
 *        Tlibre = Trm + apports internes + s · ensoleillement(Tx)
 *   5. Ventilation nocturne : Tnuit = Tlibre − V · (Tlibre − Tn local).
 *   6. Nuit étouffante si Tnuit ≥ 26 °C ; très difficile si ≥ 28 °C.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Géographie de Paris
  // ---------------------------------------------------------------------------
  var MONTSOURIS = [2.3378, 48.8222];
  var BBOX = { minLon: 2.224, maxLon: 2.47, minLat: 48.815, maxLat: 48.903 };
  var KM_LON = 111.32 * Math.cos((48.86 * Math.PI) / 180); // km par degré de longitude
  var KM_LAT = 110.57;

  // Tracé simplifié de la Seine, d'amont en aval (dessin de la carte uniquement).
  var SEINE = [
    [2.414, 48.8235], [2.392, 48.83], [2.378, 48.8395], [2.366, 48.8465], [2.359, 48.8505],
    [2.352, 48.8535], [2.344, 48.8565], [2.338, 48.8585], [2.329, 48.861], [2.32, 48.864],
    [2.31, 48.8645], [2.302, 48.8635], [2.2945, 48.86], [2.287, 48.8545], [2.28, 48.8485],
    [2.273, 48.841], [2.263, 48.834]
  ];

  function pointInRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function arrondissementAt(lon, lat, arrs) {
    if (!arrs) return null;
    for (var i = 0; i < arrs.length; i++) {
      for (var r = 0; r < arrs[i].rings.length; r++) {
        if (pointInRing(lon, lat, arrs[i].rings[r])) return arrs[i];
      }
    }
    return null;
  }

  /*
   * Îlot de chaleur nocturne : grille de 100 m précalculée par scripts/build_heat.py
   * (js/data-heat.js) à partir des bâtiments, de la végétation et de l'eau de la BD TOPO (IGN).
   * delta = écart de température nocturne par rapport à la station Montsouris, par nuit chaude.
   */
  var GRID = null;
  function grid() {
    if (GRID === null) GRID = (root.FOURNAISE_DATA && root.FOURNAISE_DATA.heat) || false;
    return GRID;
  }
  function setHeatGrid(g) { GRID = g; }

  // Valeur interpolée (bilinéaire) d'un champ de la grille au point donné.
  function sample(g, field, lon, lat, scale) {
    var x = ((lon - g.lon0) * g.kmLon * 1000) / g.cellM - 0.5;
    var y = ((g.lat1 - lat) * g.kmLat * 1000) / g.cellM - 0.5;
    var c0 = Math.max(0, Math.min(g.cols - 2, Math.floor(x))), r0 = Math.max(0, Math.min(g.rows - 2, Math.floor(y)));
    var tx = Math.max(0, Math.min(1, x - c0)), ty = Math.max(0, Math.min(1, y - r0));
    var a = g[field], i = r0 * g.cols + c0;
    var top = a[i] * (1 - tx) + a[i + 1] * tx, bot = a[i + g.cols] * (1 - tx) + a[i + g.cols + 1] * tx;
    return (top * (1 - ty) + bot * ty) * scale;
  }

  // Écart nocturne du point (°C) par rapport à la station Montsouris, et ce qui l'explique.
  function localHeat(lon, lat, arrs) {
    var g = grid();
    var out = { arr: arrondissementAt(lon, lat, arrs), delta: 0, built: null, veg: null, height: null };
    if (!g) return out;
    out.delta = sample(g, "delta", lon, lat, 0.1);
    out.built = sample(g, "built", lon, lat, 1);
    out.veg = sample(g, "veg", lon, lat, 1);
    out.height = sample(g, "height", lon, lat, 1);
    return out;
  }

  function inParis(lon, lat, arrs) {
    if (lon < BBOX.minLon || lon > BBOX.maxLon || lat < BBOX.minLat || lat > BBOX.maxLat) return false;
    return !arrs || !!arrondissementAt(lon, lat, arrs);
  }

  // ---------------------------------------------------------------------------
  // Paramètres du logement
  // ---------------------------------------------------------------------------
  var DEFAULT_PROFILE = {
    floor: "mid",        // low | mid | top | roof
    orient: "unknown",   // N | E | S | W | unknown
    windows: "double",   // single | double | recent | roof | unknown
    shutters: "unknown", // ext | int | none | unknown
    traversant: "unknown", // yes | no | unknown
    nightOpen: "yes",    // yes | no
    era: "unknown",      // pre1914 | 1914_1948 | 1949_1974 | 1975_2005 | post2005 | unknown
    size: "s",           // xs (<15 m²) | s (15-40 m²) | m (>40 m²)
    dpeEte: "unknown",   // bon | moyen | insuffisant | unknown
    ac: "no"             // yes | no
  };

  // Poids de la moyenne glissante (jour J, J-1, J-2, J-3) selon l'inertie.
  var MASS = {
    heavy: [0.36, 0.28, 0.2, 0.16],
    medium: [0.46, 0.27, 0.16, 0.11],
    light: [0.58, 0.24, 0.11, 0.07]
  };
  // Part des écarts de température extérieure qui traverse l'enveloppe (amortissement).
  var DAMPING = { heavy: 0.74, medium: 0.82, light: 0.9 };
  var T_REF = 20; // °C : température autour de laquelle l'enveloppe amortit les écarts

  // Chaque option renvoie ses effets : roof/facade = coefficient solaire (°C au plus fort),
  // gain = apports internes (°C), vent = efficacité de la ventilation nocturne.
  var FACTORS = {
    floor: {
      low: { label: "Rez-de-chaussée ou 1er étage", roof: 0, gain: -0.4 },
      mid: { label: "Étage intermédiaire", roof: 0, gain: 0 },
      top: { label: "Dernier étage", roof: 1.4, gain: 0.2 },
      roof: { label: "Sous les toits", roof: 3.4, gain: 0.4, mass: "light" }
    },
    orient: {
      N: { label: "Nord", facade: 0.3 },
      E: { label: "Est", facade: 0.9 },
      S: { label: "Sud", facade: 1.1 },
      W: { label: "Ouest", facade: 1.6 },
      unknown: { label: "Orientation inconnue", facade: 1.0, unknown: true }
    },
    windows: {
      single: { label: "Simple vitrage", solar: 1.05, gain: 0.2 },
      double: { label: "Double vitrage", solar: 1.0, gain: 0 },
      recent: { label: "Double vitrage récent (contrôle solaire)", solar: 0.85, gain: 0 },
      roof: { label: "Fenêtres de toit (Velux)", solar: 1.0, extraRoof: 1.2, gain: 0 },
      unknown: { label: "Vitrage inconnu", solar: 1.0, gain: 0, unknown: true }
    },
    shutters: {
      ext: { label: "Volets ou stores extérieurs", solar: 0.45 },
      int: { label: "Rideaux ou stores intérieurs", solar: 0.8 },
      none: { label: "Aucune protection solaire", solar: 1.0 },
      unknown: { label: "Protections solaires inconnues", solar: 0.8, unknown: true }
    },
    traversant: {
      yes: { label: "Traversant", vent: 0.36 },
      no: { label: "Une seule façade", vent: 0.2 },
      unknown: { label: "Traversant ou non : inconnu", vent: 0.26, unknown: true }
    },
    nightOpen: {
      yes: { label: "Fenêtres ouvertes la nuit", vent: 1 },
      no: { label: "Fenêtres fermées la nuit (bruit, sécurité)", vent: 0.3 }
    },
    era: {
      pre1914: { label: "Avant 1914 (pierre, haussmannien)", mass: "heavy", gain: -0.3, solar: 1.0 },
      "1914_1948": { label: "1914 à 1948 (brique)", mass: "medium", gain: -0.1, solar: 1.0 },
      "1949_1974": { label: "1949 à 1974 (béton peu isolé)", mass: "medium", gain: 0.3, solar: 1.1 },
      "1975_2005": { label: "1975 à 2005", mass: "medium", gain: 0.1, solar: 1.0 },
      post2005: { label: "Après 2005", mass: "medium", gain: 0.2, solar: 0.95 },
      unknown: { label: "Époque inconnue", mass: "medium", gain: 0, solar: 1.0, unknown: true }
    },
    size: {
      xs: { label: "Moins de 15 m²", gain: 0.6 },
      s: { label: "15 à 40 m²", gain: 0.2 },
      m: { label: "Plus de 40 m²", gain: 0 }
    },
    dpeEte: {
      bon: { label: "Confort d'été DPE : bon", solar: 0.8, gain: -0.3 },
      moyen: { label: "Confort d'été DPE : moyen", solar: 1.0, gain: 0 },
      insuffisant: { label: "Confort d'été DPE : insuffisant", solar: 1.15, gain: 0.3 },
      unknown: { label: "Confort d'été DPE inconnu", solar: 1.0, gain: 0, unknown: true }
    }
  };

  var BASE_GAIN = 1.0; // apports internes d'un logement occupé (personnes, appareils)

  function params(profile) {
    var p = Object.assign({}, DEFAULT_PROFILE, profile || {});
    var fl = FACTORS.floor[p.floor], or = FACTORS.orient[p.orient], wi = FACTORS.windows[p.windows];
    var sh = FACTORS.shutters[p.shutters], tr = FACTORS.traversant[p.traversant];
    var no = FACTORS.nightOpen[p.nightOpen], er = FACTORS.era[p.era], sz = FACTORS.size[p.size];
    var dp = FACTORS.dpeEte[p.dpeEte];

    var roofExposure = fl.roof + (p.windows === "roof" ? wi.extraRoof : 0);
    var solarMult = wi.solar * sh.solar * er.solar * dp.solar;
    // Les combles subissent la toiture même volets fermés : la protection ne joue que sur les baies.
    var roofMult = er.solar * dp.solar * (p.windows === "roof" ? sh.solar * 0.5 + 0.5 : 1);
    var facade = or.facade * solarMult;
    var roof = roofExposure * roofMult;
    var gain = BASE_GAIN + fl.gain + wi.gain + er.gain + sz.gain + dp.gain;
    var vent = tr.vent * no.vent;
    if (p.floor === "roof" && p.windows === "roof") vent = Math.max(vent, 0.24 * no.vent); // tirage thermique des Velux
    var mass = fl.mass || er.mass;
    var unknowns = [or, wi, sh, tr, er, dp].filter(function (f) { return f.unknown; }).length;
    return { profile: p, facade: facade, roof: roof, gain: gain, vent: vent, weights: MASS[mass], damping: DAMPING[mass], mass: mass, unknowns: unknowns };
  }

  // Ensoleillement relatif d'une journée, déduit de la température maximale.
  function sunFactor(tx) {
    return Math.max(0, Math.min(1.25, (tx - 18) / 12));
  }

  // Facteur d'intensité de l'îlot de chaleur : maximal les nuits chaudes et calmes.
  function uhiNightFactor(tn) {
    return Math.max(0.35, Math.min(1.15, (tn - 8) / 11));
  }

  var THRESHOLD = 26; // °C : seuil de sommeil difficile dans une chambre
  var THRESHOLD_HARD = 28;

  /*
   * Simule tous les étés. delta = {tn, tx} décale le climat (projection 2050),
   * shift ajoute des degrés constants (test de sensibilité).
   */
  function simulate(climate, heat, prm, opts) {
    opts = opts || {};
    var dTn = opts.tn || 0, dTx = opts.tx || 0, shift = opts.shift || 0, uhiScale = opts.uhiScale == null ? 1 : opts.uhiScale;
    var threshold = opts.threshold || THRESHOLD;
    var years = [];
    for (var y = 0; y < climate.years.length; y++) {
      var tnY = climate.tn[y], txY = climate.tx[y];
      var tm = [], indoor = [], tnLocal = [];
      var n26 = 0, n28 = 0, tropical = 0;
      for (var d = 0; d < tnY.length; d++) {
        var tn = tnY[d] + dTn, tx = txY[d] + dTx;
        var u = heat * uhiScale * uhiNightFactor(tn);
        var tnl = tn + u, txl = tx + 0.25 * heat * uhiScale;
        tm.push((tnl + txl) / 2);
        tnLocal.push(tnl);
        var w = prm.weights, trm = 0, wsum = 0;
        for (var k = 0; k < w.length; k++) {
          var idx = Math.max(0, d - k);
          trm += w[k] * tm[idx];
          wsum += w[k];
        }
        trm /= wsum;
        var free = T_REF + prm.damping * (trm - T_REF) + prm.gain + (prm.facade + prm.roof) * sunFactor(txl) + shift;
        var tin = free > tnl ? free - prm.vent * (free - tnl) : free;
        indoor.push(Math.round(tin * 10) / 10);
        if (tin >= threshold) n26++;
        if (tin >= THRESHOLD_HARD) n28++;
        if (tnl >= 20) tropical++;
      }
      years.push({ year: climate.years[y], indoor: indoor, tnLocal: tnLocal, n26: n26, n28: n28, tropical: tropical });
    }
    var avg = function (key) {
      return years.reduce(function (s, yy) { return s + yy[key]; }, 0) / years.length;
    };
    return { years: years, n26: avg("n26"), n28: avg("n28"), tropical: avg("tropical") };
  }

  // Score sur 10 : nuits étouffantes pondérées (une nuit ≥ 28 °C compte 1,5).
  function scoreFrom(n26, n28) {
    var weighted = n26 + 0.5 * n28;
    var s = 1 + 9 * Math.sqrt(Math.min(weighted, 60) / 60);
    return Math.max(1, Math.min(10, s));
  }

  var VERDICTS = [
    { max: 2.5, label: "Frais", text: "Un logement qui encaisse bien l'été parisien." },
    { max: 4.5, label: "Supportable", text: "Quelques nuits pénibles pendant les canicules." },
    { max: 6.5, label: "Chaud", text: "Plusieurs semaines de nuits difficiles chaque été." },
    { max: 8.5, label: "Étuve", text: "L'été se vit fenêtres grandes ouvertes et ventilateur à fond." },
    { max: 11, label: "Fournaise", text: "Dormir ici en juillet relève de l'exploit." }
  ];

  function verdict(score) {
    for (var i = 0; i < VERDICTS.length; i++) if (score < VERDICTS[i].max) return VERDICTS[i];
    return VERDICTS[VERDICTS.length - 1];
  }

  // Projection 2050 : écarts estivaux par rapport à 2017-2026.
  // Source publiée : TRACC, France hexagonale +2 °C en 2030, +2,7 °C en 2050, +4 °C en 2100
  // (ministère de la Transition écologique, 27/01/2026). Le passage à un écart d'été
  // (+1,2 °C la nuit, +1,4 °C le jour) est une ESTIMATION de Fournaise : le document ne
  // donne pas de chiffre estival. Fourchette basse et haute pour l'incertitude des modèles.
  var SCENARIOS_2050 = {
    low: { tn: 0.6, tx: 0.7, label: "fourchette basse" },
    central: { tn: 1.2, tx: 1.4, label: "trajectoire de référence (TRACC)" },
    high: { tn: 2.0, tx: 2.4, label: "fourchette haute" }
  };

  // Décomposition d'une soirée chaude typique (jours où Montsouris dépasse 28 °C) :
  // d'où vient chaque degré de la température du logement au coucher.
  function hotEvening(climate, heat, prm) {
    var acc = { outdoor: 0, quartier: 0, roof: 0, facade: 0, gain: 0, vent: 0, indoor: 0, nightOut: 0 }, n = 0;
    var w = prm.weights;
    for (var y = 0; y < climate.years.length; y++) {
      var tmS = [], tmL = [];
      for (var d = 0; d < climate.tn[y].length; d++) {
        var tn = climate.tn[y][d], tx = climate.tx[y][d];
        var tnl = tn + heat * uhiNightFactor(tn), txl = tx + 0.25 * heat;
        tmS.push((tn + tx) / 2);
        tmL.push((tnl + txl) / 2);
        if (tx < 28) continue;
        var rS = 0, rL = 0, ws = 0;
        for (var k = 0; k < w.length; k++) {
          var i = Math.max(0, d - k);
          rS += w[k] * tmS[i]; rL += w[k] * tmL[i]; ws += w[k];
        }
        rS /= ws; rL /= ws;
        var outdoor = T_REF + prm.damping * (rS - T_REF);
        var quartier = prm.damping * (rL - rS);
        var sun = sunFactor(txl);
        var free = outdoor + quartier + prm.gain + (prm.roof + prm.facade) * sun;
        var vent = free > tnl ? -prm.vent * (free - tnl) : 0;
        acc.outdoor += outdoor; acc.quartier += quartier; acc.roof += prm.roof * sun;
        acc.facade += prm.facade * sun; acc.gain += prm.gain; acc.vent += vent;
        acc.indoor += free + vent; acc.nightOut += tnl; n++;
      }
    }
    Object.keys(acc).forEach(function (k) { acc[k] /= n || 1; });
    acc.days = n / climate.years.length;
    return acc;
  }

  // Niveau de confiance : localisation, réponses connues, nature du modèle.
  function confidence(opts, prm) {
    var points = 0, reasons = [];
    if (opts.precision === "address") { points += 3; reasons.push({ ok: true, text: "Adresse localisée précisément" }); }
    else if (opts.precision === "map") { points += 2; reasons.push({ ok: true, text: "Position placée sur la carte" }); }
    else { points += 0; reasons.push({ ok: false, text: "Seul l'arrondissement est connu" }); }
    var known = 6 - prm.unknowns;
    points += known * 0.5;
    reasons.push({ ok: prm.unknowns <= 1, text: known + (known > 1 ? " caractéristiques" : " caractéristique") + " du logement sur 6 " + (known > 1 ? "renseignées" : "renseignée") });
    if (prm.profile.dpeEte !== "unknown") {
      points += opts.dpeFrom === "building" ? 0.5 : 1;
      reasons.push({ ok: true, text: opts.dpeFrom === "building" ? "Confort d'été repris des DPE de l'immeuble (ADEME), pas forcément ton logement" : "Confort d'été du DPE pris en compte" });
    }
    reasons.push({ ok: true, text: "10 étés de relevés réels à Paris-Montsouris" });
    reasons.push({ ok: true, text: "Bâti, végétation et eau du quartier mesurés par l'IGN (mailles de 100 m)" });
    reasons.push({ ok: false, text: "Îlot de chaleur déduit de ces mesures, pas encore de températures de surface satellite" });
    reasons.push({ ok: false, text: "Modèle simplifié, non calibré sur des mesures dans ce logement" });
    var level = points >= 6.5 ? "bonne" : points >= 4.5 ? "moyenne" : "faible";
    return { level: level, label: level === "bonne" ? "Bonne" : level === "moyenne" ? "Moyenne" : "Faible", points: points, reasons: reasons };
  }

  // Analyse complète d'un logement.
  function analyze(climate, location, profile, arrs) {
    var heatInfo = localHeat(location.lon, location.lat, arrs);
    var heat = heatInfo.delta;
    var prm = params(profile);
    var conf = confidence(location, prm);
    var spread = conf.level === "bonne" ? 0.8 : conf.level === "moyenne" ? 1.2 : 1.6;

    var now = simulate(climate, heat, prm);
    var lo = simulate(climate, heat, prm, { shift: -spread, uhiScale: 0.75 });
    var hi = simulate(climate, heat, prm, { shift: spread, uhiScale: 1.25 });
    var s50 = simulate(climate, heat, prm, SCENARIOS_2050.central);
    var s50lo = simulate(climate, heat, prm, SCENARIOS_2050.low);
    var s50hi = simulate(climate, heat, prm, SCENARIOS_2050.high);

    var acFactor = prm.profile.ac === "yes" ? 0.15 : 1;
    var effective = function (sim) { return { n26: sim.n26 * acFactor, n28: sim.n28 * acFactor }; };
    var e = effective(now), e50 = effective(s50);
    var score = scoreFrom(e.n26, e.n28);
    var score2050 = scoreFrom(e50.n26, e50.n28);

    return {
      heat: heatInfo,
      params: prm,
      confidence: conf,
      now: now,
      range: [lo.n26 * acFactor, hi.n26 * acFactor],
      passive: now.n26,
      ac: prm.profile.ac === "yes",
      n26: e.n26,
      n28: e.n28,
      score: score,
      scoreRounded: Math.round(score),
      verdict: verdict(score),
      y2050: {
        sim: s50,
        n26: e50.n26,
        n28: e50.n28,
        range: [s50lo.n26 * acFactor, s50hi.n26 * acFactor],
        score: score2050,
        scoreRounded: Math.round(score2050),
        tropical: s50.tropical
      },
      evening: hotEvening(climate, heat, prm)
    };
  }

  // ---------------------------------------------------------------------------
  // Conseils : chaque piste est simulée pour chiffrer les nuits gagnées.
  // ---------------------------------------------------------------------------
  var ADVICE = [
    {
      id: "volets", when: function (p) { return p.shutters !== "ext"; },
      change: { shutters: "ext" }, who: "Propriétaire ou toi",
      title: "Bloquer le soleil avant la vitre",
      text: "Volets fermés en journée, store extérieur ou toile tendue côté extérieur : la chaleur est arrêtée avant d'entrer. Un store intérieur en garde la moitié dedans."
    },
    {
      id: "velux", when: function (p) { return p.windows === "roof" && p.shutters !== "ext"; },
      change: { shutters: "ext" }, who: "Propriétaire ou toi",
      title: "Équiper les Velux d'un store pare-soleil extérieur",
      text: "Les fenêtres de toit reçoivent le soleil de plein fouet. Un store extérieur adapté au modèle de fenêtre se pose sans travaux."
    },
    {
      id: "courant", when: function (p) { return p.traversant !== "yes" && p.nightOpen === "yes"; },
      change: { traversant: "yes" }, who: "Toi",
      title: "Créer un courant d'air la nuit",
      text: "Ouvre en grand dès que l'air dehors est plus frais que dedans, portes intérieures ouvertes. Sans deuxième façade, un ventilateur posé dans la fenêtre et tourné vers l'extérieur aspire l'air chaud."
    },
    {
      id: "bruit", when: function (p) { return p.nightOpen === "no"; },
      change: { nightOpen: "yes" }, who: "Toi",
      title: "Rendre possible l'aération nocturne",
      text: "Moustiquaire, bouchons d'oreille, entrebâilleur sécurisé ou aération côté cour : tout ce qui permet de garder une fenêtre ouverte la nuit change l'été."
    },
    {
      id: "apports", when: function () { return true; },
      change: { _gain: -0.4 }, who: "Toi",
      title: "Réduire la chaleur produite dedans",
      text: "Éteindre les appareils en veille, passer aux ampoules LED, cuisiner tôt le matin ou à froid, étendre le linge dehors : chaque appareil est un petit radiateur."
    },
    {
      id: "vegetal", when: function (p) { return p.floor !== "roof"; },
      change: { _solar: 0.88 }, who: "Toi ou la copropriété",
      title: "Végétaliser la façade ou le balcon",
      text: "Jardinières, plantes grimpantes sur treillage, arbres dans la cour : l'ombre et l'évaporation rafraîchissent l'air qui entre."
    },
    {
      id: "toiture", when: function (p) { return p.floor === "roof" || p.floor === "top"; },
      change: { _roof: 0.6 }, who: "Copropriété",
      title: "Isoler la toiture ou la peindre en clair",
      text: "Isolant sous les combles ou peinture réflective sur le zinc : c'est une décision de copropriété, mais c'est le levier le plus puissant pour un dernier étage."
    }
  ];

  function applyChange(prm, change) {
    var next = Object.assign({}, prm);
    if (change._gain) next.gain = prm.gain + change._gain;
    if (change._solar) next.facade = prm.facade * change._solar;
    if (change._roof) next.roof = prm.roof * change._roof;
    return next;
  }

  function advice(climate, location, profile, arrs, result) {
    var p = result.params.profile;
    var heat = result.heat.delta;
    var list = [];
    ADVICE.forEach(function (a) {
      if (!a.when(p)) return;
      var changed = Object.keys(a.change).filter(function (k) { return k[0] !== "_"; });
      var prm = changed.length ? params(Object.assign({}, p, a.change)) : result.params;
      prm = applyChange(prm, a.change);
      var sim = simulate(climate, heat, prm);
      var saved = result.passive - sim.n26;
      list.push({ id: a.id, title: a.title, text: a.text, who: a.who, saved: Math.max(0, saved) });
    });
    // Le ventilateur ne refroidit pas l'air mais déplace le seuil de confort d'environ 2 °C.
    var fan = simulate(climate, heat, result.params, { threshold: THRESHOLD + 2 });
    list.push({
      id: "ventilateur", who: "Toi", saved: Math.max(0, result.passive - fan.n26), felt: true,
      title: "Un ventilateur dirigé vers le lit",
      text: "L'air ne baisse pas d'un degré, mais le corps ressent environ 2 °C de moins. C'est le meilleur rapport efficacité-prix pour dormir."
    });
    list.sort(function (a, b) { return b.saved - a.saved; });
    if (list[0] && list[0].id === "velux") list = list.filter(function (x) { return x.id !== "volets"; });
    else list = list.filter(function (x) { return x.id !== "velux"; });
    return list;
  }

  var api = {
    MONTSOURIS: MONTSOURIS, BBOX: BBOX, SEINE: SEINE,
    FACTORS: FACTORS, DEFAULT_PROFILE: DEFAULT_PROFILE, SCENARIOS_2050: SCENARIOS_2050,
    THRESHOLD: THRESHOLD, THRESHOLD_HARD: THRESHOLD_HARD, KM_LON: KM_LON, KM_LAT: KM_LAT,
    arrondissementAt: arrondissementAt, localHeat: localHeat, setHeatGrid: setHeatGrid, inParis: inParis,
    params: params, simulate: simulate, scoreFrom: scoreFrom, verdict: verdict,
    analyze: analyze, advice: advice, confidence: confidence, hotEvening: hotEvening
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FournaiseModel = api;
})(this);
