/*
 * Fournaise — modèle de chaleur intérieure (version 1, Paris).
 *
 * Tout le calcul tourne dans le navigateur, sans serveur. Chaque coefficient
 * est écrit ici en clair pour que le score reste vérifiable.
 *
 * Chaîne de calcul, pour chaque jour du 1er juin au 30 septembre des 10 derniers étés :
 *   1. Relevés réels Tn / Tx de la station Paris-Montsouris.
 *   2. Correction de quartier (îlot de chaleur) : Tn + U·f(nuit), Tx + 0,25·U.
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
  var CORE = [2.347, 48.8605]; // Châtelet, cœur minéral de l'îlot de chaleur
  var BBOX = { minLon: 2.224, maxLon: 2.47, minLat: 48.815, maxLat: 48.903 };
  var KM_LON = 111.32 * Math.cos((48.86 * Math.PI) / 180); // km par degré de longitude
  var KM_LAT = 110.57;

  // Espaces verts majeurs : [nom, lon, lat, demi-axe E-O (km), demi-axe N-S (km), type]
  // type "bois" : rafraîchissement fort et étendu ; "parc" : effet local.
  var GREEN = [
    ["Bois de Boulogne", 2.2525, 48.862, 1.25, 2.2, "bois"],
    ["Bois de Vincennes", 2.438, 48.834, 2.1, 1.0, "bois"],
    ["Jardin du Luxembourg", 2.3372, 48.8462, 0.33, 0.3, "parc"],
    ["Jardin des Plantes", 2.36, 48.844, 0.28, 0.25, "parc"],
    ["Buttes-Chaumont", 2.3825, 48.88, 0.32, 0.24, "parc"],
    ["Parc Montsouris", 2.338, 48.822, 0.25, 0.22, "parc"],
    ["Cité universitaire", 2.337, 48.8195, 0.35, 0.12, "parc"],
    ["Parc Monceau", 2.309, 48.8795, 0.2, 0.17, "parc"],
    ["Jardin des Tuileries", 2.327, 48.8635, 0.45, 0.13, "parc"],
    ["Jardins des Champs-Élysées", 2.315, 48.867, 0.4, 0.1, "parc"],
    ["Champ-de-Mars", 2.298, 48.856, 0.22, 0.45, "parc"],
    ["Esplanade des Invalides", 2.3135, 48.859, 0.15, 0.35, "parc"],
    ["Jardins du Trocadéro", 2.2895, 48.8615, 0.18, 0.15, "parc"],
    ["Père-Lachaise", 2.3935, 48.861, 0.45, 0.33, "parc"],
    ["Parc de la Villette", 2.3905, 48.8935, 0.35, 0.4, "parc"],
    ["Parc André-Citroën", 2.275, 48.841, 0.25, 0.2, "parc"],
    ["Parc de Bercy", 2.383, 48.835, 0.35, 0.12, "parc"],
    ["Cimetière du Montparnasse", 2.3265, 48.838, 0.3, 0.22, "parc"],
    ["Cimetière de Montmartre", 2.3305, 48.8875, 0.25, 0.15, "parc"],
    ["Parc Georges-Brassens", 2.3005, 48.8325, 0.18, 0.15, "parc"],
    ["Parc Martin-Luther-King", 2.316, 48.888, 0.25, 0.12, "parc"],
    ["Parc de Belleville", 2.385, 48.8715, 0.15, 0.12, "parc"],
    ["Parc Kellermann", 2.355, 48.819, 0.15, 0.12, "parc"]
  ];
  var GREEN_EFFECT = { bois: { a: 2.2, l: 0.45 }, parc: { a: 1.0, l: 0.2 } };

  // Tracé simplifié de la Seine, d'amont en aval.
  var SEINE = [
    [2.414, 48.8235], [2.392, 48.83], [2.378, 48.8395], [2.366, 48.8465], [2.359, 48.8505],
    [2.352, 48.8535], [2.344, 48.8565], [2.338, 48.8585], [2.329, 48.861], [2.32, 48.864],
    [2.31, 48.8645], [2.302, 48.8635], [2.2945, 48.86], [2.287, 48.8545], [2.28, 48.8485],
    [2.273, 48.841], [2.263, 48.834]
  ];

  // Densité bâtie et minéralité par arrondissement (°C ajoutés la nuit).
  var DENSITY = {
    1: 0.1, 2: 0.35, 3: 0.35, 4: 0.2, 5: 0.1, 6: 0.1, 7: 0, 8: 0.1, 9: 0.3, 10: 0.35,
    11: 0.4, 12: 0, 13: 0.1, 14: 0, 15: 0.1, 16: -0.2, 17: 0.15, 18: 0.3, 19: 0.15, 20: 0.25
  };

  function toKm(lon, lat) {
    return [(lon - CORE[0]) * KM_LON, (lat - CORE[1]) * KM_LAT];
  }

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

  function distToSegmentKm(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1);
    t = Math.max(0, Math.min(1, t));
    var x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
    return Math.sqrt(x * x + y * y);
  }

  var SEINE_KM = SEINE.map(function (c) { return toKm(c[0], c[1]); });

  function seineDistanceKm(lon, lat) {
    var p = toKm(lon, lat), best = Infinity;
    for (var i = 1; i < SEINE_KM.length; i++) best = Math.min(best, distToSegmentKm(p, SEINE_KM[i - 1], SEINE_KM[i]));
    return best;
  }

  // Effet de chaque espace vert : renvoie {cooling (°C, négatif), nearest:{name, km}}
  function greenEffect(lon, lat) {
    var cooling = 0, nearest = null;
    for (var i = 0; i < GREEN.length; i++) {
      var g = GREEN[i];
      var dx = (lon - g[1]) * KM_LON, dy = (lat - g[2]) * KM_LAT;
      var r = Math.sqrt((dx / g[3]) * (dx / g[3]) + (dy / g[4]) * (dy / g[4]));
      var outside = r <= 1 ? 0 : (r - 1) * Math.sqrt(g[3] * g[4]);
      var e = GREEN_EFFECT[g[5]];
      cooling -= e.a * Math.exp(-outside / e.l);
      if (!nearest || outside < nearest.km) nearest = { name: g[0], km: outside, type: g[5] };
    }
    return { cooling: Math.max(cooling, -2.6), nearest: nearest };
  }

  // Îlot de chaleur nocturne brut (°C, échelle relative).
  function uhiRawParts(lon, lat, arrs) {
    var c = toKm(lon, lat);
    var d = Math.sqrt(c[0] * c[0] + c[1] * c[1]);
    var arr = arrondissementAt(lon, lat, arrs);
    var g = greenEffect(lon, lat);
    var seineKm = seineDistanceKm(lon, lat);
    return {
      base: 0.5,
      core: 0.8 * Math.exp(-Math.pow(d / 3.0, 2)),
      density: arr ? DENSITY[arr.n] || 0 : 0,
      green: g.cooling,
      seine: -0.35 * Math.exp(-seineKm / 0.15),
      arr: arr,
      nearestGreen: g.nearest,
      seineKm: seineKm,
      coreKm: d
    };
  }

  function sumParts(p) {
    return p.base + p.core + p.density + p.green + p.seine;
  }

  var UHI_SCALE = 0.8; // calage : centre de Paris ≈ +1,5 °C la nuit par rapport à Montsouris
  var STATION_UHI = null;
  // Écart nocturne du point (°C) par rapport à la station Montsouris, par nuit chaude.
  function localHeat(lon, lat, arrs) {
    if (STATION_UHI === null) STATION_UHI = sumParts(uhiRawParts(MONTSOURIS[0], MONTSOURIS[1], arrs));
    var p = uhiRawParts(lon, lat, arrs);
    p.delta = UHI_SCALE * (sumParts(p) - STATION_UHI);
    return p;
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

  // Projection 2050 : écarts estivaux par rapport à la période 2017-2026, d'après la
  // trajectoire de réchauffement de référence (TRACC : France +2,7 °C en 2050 contre
  // environ +1,8 °C au début des années 2020), avec un été qui se réchauffe ~1,3 fois
  // plus vite que l'année. Fourchette basse et haute pour l'incertitude des modèles.
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
    if (prm.profile.dpeEte !== "unknown") { points += 1; reasons.push({ ok: true, text: "Confort d'été du DPE pris en compte" }); }
    reasons.push({ ok: true, text: "10 étés de relevés réels à Paris-Montsouris" });
    reasons.push({ ok: false, text: "Carte des îlots de chaleur estimée à l'échelle du quartier, pas de l'immeuble" });
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
    MONTSOURIS: MONTSOURIS, BBOX: BBOX, GREEN: GREEN, SEINE: SEINE, DENSITY: DENSITY,
    FACTORS: FACTORS, DEFAULT_PROFILE: DEFAULT_PROFILE, SCENARIOS_2050: SCENARIOS_2050,
    THRESHOLD: THRESHOLD, THRESHOLD_HARD: THRESHOLD_HARD, KM_LON: KM_LON, KM_LAT: KM_LAT,
    arrondissementAt: arrondissementAt, localHeat: localHeat, inParis: inParis,
    params: params, simulate: simulate, scoreFrom: scoreFrom, verdict: verdict,
    analyze: analyze, advice: advice, confidence: confidence, hotEvening: hotEvening
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FournaiseModel = api;
})(this);
