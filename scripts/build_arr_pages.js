#!/usr/bin/env node
/*
 * Génère une page par arrondissement (paris-1er.html ... paris-20e.html) avec des chiffres calculés
 * par le modèle sur toutes les mailles de 100 m de l'arrondissement, et les DPE de data/dpe/.
 * Usage : node scripts/build_arr_pages.js   (puis python3 scripts/build_pages.py pour le plan du site)
 */
const fs = require("fs");
const path = require("path");
global.window = global;
const root = path.join(__dirname, "..");
require(path.join(root, "js/data-paris.js"));
require(path.join(root, "js/data-heat.js"));
const M = require(path.join(root, "js/model.js"));
const D = global.FOURNAISE_DATA;
M.setHeatGrid(D.heat);
const G = D.heat, ARRS = D.arrondissements;
const BASE = "https://aloysdeboissezon.github.io/Fournaise/";
const ISSUES = "https://github.com/aloysdeboissezon/Fournaise/issues/new";

const ord = (n) => (n === 1 ? "1er" : n + "e");
const roundN = (n) => (n >= 20 ? Math.round(n / 5) * 5 : Math.round(n));
const fr = (n, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const PROFILES = [
  { id: "frais", label: "Étage intermédiaire, nord, traversant, volets extérieurs, pierre", p: { floor: "mid", orient: "N", windows: "double", shutters: "ext", traversant: "yes", nightOpen: "yes", era: "pre1914", size: "m", dpeEte: "moyen" } },
  { id: "dernier", label: "Dernier étage, plein sud, rideaux intérieurs, une seule façade", p: { floor: "top", orient: "S", windows: "double", shutters: "int", traversant: "no", nightOpen: "yes", era: "1949_1974", size: "s", dpeEte: "unknown" } },
  { id: "bonne", label: "Chambre de bonne sous les toits, ouest, Velux, sans protection", p: { floor: "roof", orient: "W", windows: "roof", shutters: "none", traversant: "no", nightOpen: "yes", era: "pre1914", size: "xs", dpeEte: "unknown" } }
].map((x) => Object.assign(x, { prm: M.params(x.p) }));

// Mailles de chaque arrondissement
const cells = {};
for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
  const lon = G.lon0 + ((c + 0.5) * G.cellM) / (G.kmLon * 1000), lat = G.lat1 - ((r + 0.5) * G.cellM) / (G.kmLat * 1000);
  const a = M.arrondissementAt(lon, lat, ARRS);
  if (!a) continue;
  const heat = M.localHeat(lon, lat, ARRS);
  (cells[a.n] = cells[a.n] || []).push({ lon, lat, delta: heat.delta, built: heat.built, veg: heat.veg });
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const centroid = (a) => {
  const ring = a.rings.reduce((b, r) => (r.length > b.length ? r : b), a.rings[0]);
  let x = 0, y = 0;
  ring.forEach((p) => { x += p[0]; y += p[1]; });
  return [x / ring.length, y / ring.length];
};
const NUDGE = { 16: [2.268, 48.858], 12: [2.398, 48.838] };

function stats(n) {
  const cs = cells[n], deltas = cs.map((c) => c.delta).sort((a, b) => a - b);
  const out = { cells: cs.length, areaKm2: cs.length * 0.01, delta: mean(deltas), lo: deltas[Math.floor(deltas.length * 0.1)], hi: deltas[Math.floor(deltas.length * 0.9)], built: mean(cs.map((c) => c.built)), veg: mean(cs.map((c) => c.veg)) };
  out.profiles = PROFILES.map((pr) => {
    let n26 = 0, n28 = 0, f26 = 0, f28 = 0;
    cs.forEach((c) => {
      const s = M.simulate(D.climate, c.delta, pr.prm), f = M.simulate(D.climate, c.delta, pr.prm, M.SCENARIOS_2050.central);
      n26 += s.n26; n28 += s.n28; f26 += f.n26; f28 += f.n28;
    });
    n26 /= cs.length; n28 /= cs.length; f26 /= cs.length; f28 /= cs.length;
    return { label: pr.label, n26, score: M.scoreFrom(n26, n28), f26, fscore: M.scoreFrom(f26, f28), p: pr.p };
  });
  // DPE
  const f = JSON.parse(fs.readFileSync(path.join(root, "data/dpe", String(75100 + n) + ".json"), "utf8"));
  let bon = 0, moy = 0, ins = 0, dpe = 0;
  f.rows.forEach((r) => { dpe += r[3]; bon += r[4][0]; moy += r[4][1]; ins += r[4][2]; });
  out.dpe = { n: dpe, rated: bon + moy + ins, bon, moy, ins };
  return out;
}

const QUERY_KEYS = ["floor", "orient", "windows", "shutters", "ac", "traversant", "nightOpen", "era", "size", "dpeEte"];
const link = (lon, lat, p) => {
  const prof = Object.assign({}, M.DEFAULT_PROFILE, p);
  return "./?lon=" + lon.toFixed(3) + "&lat=" + lat.toFixed(3) + "&" + QUERY_KEYS.map((k) => k + "=" + encodeURIComponent(prof[k])).join("&");
};

const all = ARRS.map((a) => ({ a, s: stats(a.n) }));

all.forEach(({ a, s }) => {
  const file = `paris-${ord(a.n)}.html`;
  const c = NUDGE[a.n] || centroid(a);
  const title = `Chaleur à Paris ${ord(a.n)} : nuits étouffantes en été`;
  const desc = `Combien de nuits étouffantes dans un logement du ${ord(a.n)} arrondissement de Paris (${a.name}) ? Estimation par type de logement, DPE de l'arrondissement et projection 2050.`;
  const rows = s.profiles.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${fr(roundN(x.n26))}</td><td class="num">${Math.round(x.score)}/10</td><td class="num">${fr(roundN(x.f26))}</td><td><a href="${link(c[0], c[1], x.p)}">Calculer pour mon logement</a></td></tr>`).join("");
  const d = s.dpe;
  const dpeText = d.rated >= 30
    ? `Sur ${fr(d.n)} DPE de logements établis depuis juillet 2021 dans l'arrondissement, ${fr(d.rated)} indiquent un confort d'été : ${fr(Math.round((100 * d.ins) / d.rated))} % « insuffisant », ${fr(Math.round((100 * d.moy) / d.rated))} % « moyen », ${fr(Math.round((100 * d.bon) / d.rated))} % « bon » (ADEME, données déclaratives, regroupées par adresse).`
    : `Peu de DPE publiés depuis 2021 dans l'arrondissement pour en tirer une tendance (ADEME).`;
  const nav = all.map((o) => (o.a.n === a.n ? `<span aria-current="page">${ord(o.a.n)}</span>` : `<a href="paris-${ord(o.a.n)}.html">${ord(o.a.n)}</a>`)).join(" · ");
  const wood = a.n === 12 || a.n === 16 ? " Les chiffres de l'arrondissement incluent le bois (Vincennes ou Boulogne), ce qui les rafraîchit : un logement en zone bâtie est plus chaud que la moyenne indiquée." : "";
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)} · Fournaise</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#edf0f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d1116" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${BASE}${file}">
<link rel="icon" type="image/svg+xml" href="img/favicon.svg">
<link rel="apple-touch-icon" href="img/apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<meta property="og:type" content="article">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="Fournaise">
<meta property="og:url" content="${BASE}${file}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${BASE}img/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="fonts/instrument-sans-046090.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="css/fonts.css">
<link rel="stylesheet" href="css/style.css">
<script>try{var t=localStorage.getItem("fournaise-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
</head>
<body>
<a class="skip" href="#contenu">Aller au contenu</a>
<header class="topbar"><div class="wrap topbar-in"><a class="brand" href="./"><span class="brand-mark" aria-hidden="true"></span>Fournaise</a><span class="grow"></span><a class="btn ghost" href="./">Calculer mon score</a></div></header>
<main id="contenu" class="wrap prose">
<h1>Chaleur à Paris ${ord(a.n)} (${esc(a.name)}) : combien de nuits étouffantes ?</h1>
<p>Fournaise estime le nombre de nuits où la chambre dépasse 26 °C au coucher, à partir de dix étés de relevés réels à Paris-Montsouris (2017-2026), de la végétation et de l'eau autour de chaque maille de 100 m (IGN) et des caractéristiques du logement. Voici ce que cela donne pour le ${ord(a.n)} arrondissement.</p>
<h2>Trois logements types</h2>
<p>Moyenne sur les ${fr(s.cells)} mailles de 100 m de l'arrondissement (environ ${fr(Math.round(s.areaKm2))} km²), nuits étouffantes par été, moyenne 2017-2026, arrondies à 5 au-dessus de 20.</p>
<div class="tbl-wrap"><table><thead><tr><th scope="col">Logement</th><th scope="col" class="num">Nuits par été</th><th scope="col" class="num">Score</th><th scope="col" class="num">En 2050</th><th scope="col"><span class="sr-only">Lien</span></th></tr></thead><tbody>${rows}</tbody></table></div>
<p>L'étage, la toiture, l'orientation et les protections solaires pèsent environ trois fois plus que le quartier : deux logements du même arrondissement peuvent avoir des étés très différents.</p>
<h2>Le quartier, la nuit</h2>
<p>Par rapport au parc Montsouris, les nuits sont en moyenne ${s.delta >= 0 ? "plus chaudes" : "plus fraîches"} de ${fr(Math.abs(s.delta), 1)} °C dans le ${ord(a.n)} arrondissement (de ${s.lo >= 0 ? "+" : "−"}${fr(Math.abs(s.lo), 1)} à ${s.hi >= 0 ? "+" : "−"}${fr(Math.abs(s.hi), 1)} °C selon la maille, pour 80 % d'entre elles). Autour d'un point moyen : ${fr(Math.round(s.built))} % de bâti et ${fr(Math.round(s.veg))} % de végétation.${wood}</p>
<h2>Ce que disent les DPE</h2>
<p>${dpeText}</p>
<h2>Calculer pour ton logement</h2>
<p>Ces moyennes ne remplacent pas ton cas : tape ton adresse, réponds à quelques questions sur l'étage, les fenêtres et les protections solaires, et Fournaise te donne ton score, un niveau de confiance et des conseils chiffrés.</p>
<p><a class="btn hot big" href="${link(c[0], c[1], {})}">Calculer mon score dans le ${ord(a.n)}</a></p>
<p class="note">Estimation de Fournaise, non mesurée dans des logements : voir <a href="./#methode">la méthode</a> et <a href="./#sources">le niveau de preuve des données</a>. <a href="${ISSUES}" target="_blank" rel="noopener">Signaler une erreur</a>.</p>
<h2>Les autres arrondissements</h2>
<p>${nav}</p>
</main>
<footer><div class="wrap foot"><nav class="foot-nav foot-legal" aria-label="Informations légales"><a href="mentions-legales.html">Mentions légales</a><a href="confidentialite.html">Confidentialité</a><a href="donnees-licences.html">Données et licences</a><a href="${ISSUES}" target="_blank" rel="noopener">Signaler une erreur</a></nav></div></footer>
</body>
</html>
`;
  fs.writeFileSync(path.join(root, file), html);
});
console.log(all.map(({ a, s }) => `${ord(a.n)}: ${s.cells} mailles, quartier ${s.delta.toFixed(1)} °C, ${s.profiles.map((x) => roundN(x.n26)).join("/")}`).join("\n"));
