// Tests du modèle : node --test tests/
// Les valeurs de référence (« golden ») figent le comportement actuel : si un coefficient change volontairement,
// relancer `node tests/model.test.js --print` et reporter les nouvelles valeurs ci-dessous.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

global.window = global;
const root = path.join(__dirname, "..", "js");
require(path.join(root, "data-paris.js"));
require(path.join(root, "data-heat.js"));
const M = require(path.join(root, "model.js"));
const D = global.FOURNAISE_DATA;
M.setHeatGrid(D.heat);

const ARRS = D.arrondissements;
const MARTYRS = { lon: 2.3397, lat: 48.8795, precision: "address" };
const MONTSOURIS = { lon: 2.3378, lat: 48.8222, precision: "address" };
const analyze = (profile, loc) => M.analyze(D.climate, loc || MARTYRS, profile, ARRS);

const CASES = {
  "chambre de bonne (toit, ouest, Velux)": { floor: "roof", orient: "W", windows: "roof", shutters: "none", traversant: "no", nightOpen: "yes", era: "pre1914", size: "xs" },
  "haussmannien nord traversant volets": { floor: "mid", orient: "N", windows: "double", shutters: "ext", traversant: "yes", nightOpen: "yes", era: "pre1914", size: "m", dpeEte: "moyen" },
  "dernier étage sud années 70": { floor: "top", orient: "S", windows: "double", shutters: "int", traversant: "no", nightOpen: "no", era: "1949_1974", size: "s", dpeEte: "insuffisant" },
  "profil par défaut": {}
};
// [nuits étouffantes, nuits >= 28 °C, score, score 2050], moyennes 2017-2026 à l'adresse des Martyrs
const GOLDEN = {
  "chambre de bonne (toit, ouest, Velux)": [49.9, 32.5, 7.68, 8.9],
  "haussmannien nord traversant volets": [3.9, 0.8, 2.7, 3.53],
  "dernier étage sud années 70": [46.2, 25.1, 7.3, 8.53],
  "profil par défaut": [11.6, 3.9, 4.02, 5.07]
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

test("la grille de chaleur couvre Paris et pas l'extérieur de la boîte", () => {
  assert.ok(M.inParis(2.3522, 48.8566, ARRS));
  assert.ok(!M.inParis(2.5, 48.86, ARRS));
  assert.ok(!M.inParis(2.35, 49.5, ARRS));
});
