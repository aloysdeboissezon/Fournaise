// Détection d'une vague de chaleur dans la prévision à 7 jours.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../js/heatwave.js");

const mk = (tx, tn) => tx.map((x, i) => ({ date: "2026-07-0" + (i + 1), tx: x, tn: tn[i] }));

test("trois jours au-dessus de 21 °C la nuit et 31 °C le jour : vague de chaleur", () => {
  const a = H.analyze(mk([27, 32, 34, 33, 28, 26, 25], [16, 21, 23, 22, 18, 15, 15]));
  assert.equal(a.level, "wave");
  assert.equal(a.from, "2026-07-02");
  assert.equal(a.to, "2026-07-05"); // la fenêtre glissante 3-5 juillet dépasse encore les seuils
});

test("un jour très chaud isolé ne fait pas une vague", () => {
  const a = H.analyze(mk([27, 36, 28, 27, 26, 25, 25], [16, 19, 17, 16, 15, 15, 15]));
  assert.equal(a.level, "calm");
});

test("des nuits tropicales sans vague sont signalées", () => {
  const a = H.analyze(mk([29, 30, 30, 29, 28, 26, 25], [20, 20, 19, 18, 17, 15, 15]));
  assert.equal(a.level, "tropical");
  assert.equal(a.tropical, 2);
});

test("la réponse Open-Meteo est lue et le message cite les jours", () => {
  const days = H.parse({ daily: { time: ["2026-07-02", "2026-07-03", "2026-07-04"], temperature_2m_max: [32, 34, 33], temperature_2m_min: [21, 23, 22] } });
  assert.equal(days.length, 3);
  const m = H.message(H.analyze(days));
  assert.match(m, /Vague de chaleur annoncée du jeudi 2 au samedi 4/);
  assert.throws(() => H.parse({}));
});

test("l'adresse de la requête arrondit la position à environ un kilomètre", () => {
  assert.match(H.url(48.87654, 2.34567), /latitude=48\.88&longitude=2\.35/);
});
