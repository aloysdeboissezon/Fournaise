// Budget de poids : échoue si une ressource de la page dépasse son plafond (octets gzip).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.join(__dirname, "..");
const BUDGET = { "index.html": 14000, "css/style.css": 12000, "css/fonts.css": 2000, "js/app.js": 26000, "js/share.js": 4000, "js/guide.js": 3500, "js/model.js": 10000, "js/data-heat.js": 15000, "js/data-paris.js": 21000 };

test("poids gzip de la page et de ses scripts", () => {
  for (const [file, max] of Object.entries(BUDGET)) {
    const size = zlib.gzipSync(fs.readFileSync(path.join(root, file)), { level: 9 }).length;
    assert.ok(size <= max, `${file} : ${size} octets gzip, plafond ${max}`);
  }
});

test("tuiles de la carte de chaleur et fichiers par commune chargés à l'adresse", () => {
  const max = (dir) => Math.max(...fs.readdirSync(path.join(root, dir)).map((f) => zlib.gzipSync(fs.readFileSync(path.join(root, dir, f)), { level: 9 }).length));
  assert.ok(max("data/heat") <= 25000, "tuile de chaleur trop lourde");
  assert.ok(max("data/dpe") <= 130000, "fichier DPE trop lourd");
  assert.ok(max("data/bdnb") <= 120000, "fichier BDNB trop lourd");
});

test("aucune ressource externe sur la page d'accueil", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1])
    .filter((u) => !/^https:\/\/(aloysdeboissezon\.github\.io|github\.com\/aloysdeboissezon)/.test(u))
    .filter((u) => !/\.(pdf)$/.test(u));
  // Les liens vers les sources (<a>) sont attendus ; les ressources chargées (script, link stylesheet, img) ne doivent pas être externes.
  const loaded = [...html.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="(https?:\/\/[^"]+)"[^>]*>/g)].map((m) => m[0])
    .filter((tag) => !/rel="canonical"|rel="alternate"|property=|<link rel="author"/.test(tag) && /<script|stylesheet|<img|rel="(preload|icon)"/.test(tag));
  assert.deepEqual(loaded.filter((t) => !/aloysdeboissezon\.github\.io/.test(t)), [], "ressource externe chargée par la page : " + external.join(", "));
});
