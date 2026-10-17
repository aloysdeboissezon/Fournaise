// Tests du modèle : node --test tests/
// Les valeurs de référence (« golden ») figent le comportement actuel : si un coefficient change volontairement,
// relancer `node tests/model.test.js --print` et reporter les nouvelles valeurs ci-dessous.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

global.window = global;
const root = path.join(__dirname, "..", "js");
require(path.join(root, "data-paris.js"));
require(path.join(root, "data-heat.js"));
const M = require(path.join(root, "model.js"));
const D = global.FOURNAISE_DATA;
M.setHeatGrid(D.heat);
// Tuiles fines de 100 m (data/heat/), comme la page les charge à l'adresse.
D.heat.tiles.forEach((k) => M.addHeatTile(JSON.parse(fs.readFileSync(path.join(root, "..", "data", "heat", k + ".json"), "utf8"))));

const ZONES = D.zones;
const MARTYRS = { lon: 2.3397, lat: 48.8795, precision: "address" };
const MONTSOURIS = { lon: 2.3378, lat: 48.8222, precision: "address" };
const analyze = (profile, loc) => M.analyze(D.climate, loc || MARTYRS, profile, ZONES);

const CASES = {
  "chambre de bonne (toit, ouest, Velux)": { floor: "roof", orient: "W", windows: "roof", shutters: "none", traversant: "no", nightOpen: "yes", era: "pre1914", size: "xs" },
  "haussmannien nord traversant volets": { floor: "mid", orient: "N", windows: "double", shutters: "ext", traversant: "yes", nightOpen: "yes", era: "pre1914", size: "m", dpeEte: "moyen" },
  "dernier étage sud années 70": { floor: "top", orient: "S", windows: "double", shutters: "int", traversant: "no", nightOpen: "no", era: "1949_1974", size: "s", dpeEte: "insuffisant" },
  "profil par défaut": {}
};
// [nuits étouffantes, nuits >= 28 °C, score, score 2050], moyennes 2017-2026 à l'adresse des Martyrs
const GOLDEN = {
  "chambre de bonne (toit, ouest, Velux)": [51.9, 34.9, 7.84, 9.06],
  "haussmannien nord traversant volets": [4.3, 1, 2.8, 3.67],
  "dernier étage sud années 70": [48.4, 26.5, 7.45, 8.71],
  "profil par défaut": [13, 4.1, 4.19, 5.22]
};

if (process.argv.includes("--print")) {
  for (const [name, p] of Object.entries(CASES)) {
    const r = analyze(p);
    console.log(JSON.stringify(name), [r.n26, r.n28, r.score, r.y2050.score].map((x) => +x.toFixed(2)));
  }
  process.exit(0);
}

test("valeurs de référence", () => {
  for (const [name, p] of Object.entries(CASES)) {
    const r = analyze(p);
    const got = [r.n26, r.n28, r.score, r.y2050.score];
    got.forEach((v, i) => assert.ok(Math.abs(v - GOLDEN[name][i]) <= 0.15, `${name} : indicateur ${i} = ${v.toFixed(2)}, attendu ${GOLDEN[name][i]}`));
  }
});

test("le score reste bordé et ne sature pas pour les logements courants", () => {
  for (const n of [0, 5, 20, 60, 120, 400]) {
    const s = M.scoreFrom(n, 0);
    assert.ok(s >= 1 && s <= 10);
  }
  assert.ok(M.scoreFrom(60, 0) < 8.5, "60 nuits ne doivent pas valoir 10");
  assert.ok(M.scoreFrom(50, 33) < 8.5, "la chambre de bonne ne doit pas être à 10");
  assert.ok(M.scoreFrom(100, 0) > M.scoreFrom(60, 0), "le score continue de monter au-delà de 60 nuits");
  assert.equal(M.scoreFrom(M.SCORE_FULL, 0), 10);
});

test("monotonie : plus de soleil ou moins d'air, plus de nuits", () => {
  const mid = analyze({ floor: "mid" }).n26, top = analyze({ floor: "top" }).n26, roof = analyze({ floor: "roof" }).n26;
  assert.ok(mid < top && top < roof);
  assert.ok(analyze({ shutters: "ext" }).n26 < analyze({ shutters: "none" }).n26);
  assert.ok(analyze({ traversant: "yes" }).n26 < analyze({ traversant: "no" }).n26);
  assert.ok(analyze({ nightOpen: "yes" }).n26 < analyze({ nightOpen: "no" }).n26);
});

test("2050 est plus chaud qu'aujourd'hui, la plage haute plus que la basse", () => {
  for (const p of Object.values(CASES)) {
    const r = analyze(p);
    assert.ok(r.y2050.n26 >= r.n26);
    assert.ok(r.range[0] <= r.n26 && r.n26 <= r.range[1]);
    assert.ok(r.y2050.range[0] <= r.y2050.n26 && r.y2050.n26 <= r.y2050.range[1]);
    assert.ok(r.n24 >= r.n26, "le seuil de 24 °C compte au moins autant de nuits que 26 °C");
  }
});

test("le quartier pèse moins que le logement", () => {
  const spread = analyze({}, MARTYRS).score - analyze({}, MONTSOURIS).score;
  const logement = analyze({ floor: "roof", shutters: "none" }).score - analyze({ floor: "mid", shutters: "ext" }).score;
  assert.ok(spread > 0, "Martyrs est plus chaud que Montsouris");
  assert.ok(logement > 2 * spread);
});

test("la climatisation réduit fortement les nuits étouffantes", () => {
  const sans = analyze({ floor: "roof" }), avec = analyze({ floor: "roof", ac: "yes" });
  assert.ok(avec.n26 < sans.n26 * 0.2);
});

test("la zone couvre Paris et la petite couronne, pas au-delà", () => {
  assert.equal(M.zoneAt(2.3522, 48.8566, ZONES).code, "75104");
  assert.equal(M.zoneAt(2.4415, 48.8611, ZONES).name, "Montreuil");          // Seine-Saint-Denis
  assert.equal(M.zoneAt(2.2399, 48.8352, ZONES).name, "Boulogne-Billancourt"); // Hauts-de-Seine
  assert.equal(M.zoneAt(2.4553, 48.7904, ZONES).name, "Créteil");            // Val-de-Marne
  assert.ok(!M.inZone(2.13, 48.80, ZONES), "Versailles (78) est hors zone");
  assert.ok(!M.inZone(2.35, 49.5, ZONES));
  assert.equal(ZONES.length, 142);
});

test("hors de Paris, la confiance baisse et le dit", () => {
  const paris = analyze({}, MARTYRS), banlieue = analyze({}, { lon: 2.4415, lat: 48.8611, precision: "address" });
  assert.ok(banlieue.confidence.points < paris.confidence.points);
  assert.ok(banlieue.confidence.reasons.some((x) => !x.ok && /Hors de Paris/.test(x.text)));
  assert.ok(!paris.confidence.reasons.some((x) => /Hors de Paris/.test(x.text)));
});

test("la carte fine et la carte d'ensemble concordent", () => {
  for (const [lon, lat] of [[2.3397, 48.8795], [2.4415, 48.8611], [2.2399, 48.8352], [2.4553, 48.7904]]) {
    const fine = M.localHeat(lon, lat, ZONES);
    assert.ok(fine.fine, "tuile chargée");
    M.setHeatGrid(D.heat);
    const coarse = M.localHeat(lon, lat, ZONES);
    D.heat.tiles.forEach((k) => M.addHeatTile(JSON.parse(fs.readFileSync(path.join(root, "..", "data", "heat", k + ".json"), "utf8"))));
    assert.ok(!coarse.fine && Math.abs(coarse.delta - fine.delta) < 0.6, `${lon},${lat} : ${coarse.delta} contre ${fine.delta}`);
  }
});
