#!/usr/bin/env node
/*
 * Génère une page par arrondissement de Paris (paris-1er.html … paris-20e.html) et par commune de la petite couronne
 * (montreuil-93.html, boulogne-billancourt-92.html…), avec des chiffres calculés par le modèle sur toutes les mailles
 * de 100 m de la zone (tuiles data/heat/), et les DPE de data/dpe/.
 * Usage : node scripts/build_zone_pages.js   (puis python3 scripts/build_pages.py pour le plan du site)
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
D.heat.tiles.forEach((k) => M.addHeatTile(JSON.parse(fs.readFileSync(path.join(root, "data/heat", k + ".json"), "utf8"))));
const ZONES = D.zones;
const BASE = "https://aloysdeboissezon.github.io/Fournaise/";
const ISSUES = "https://github.com/aloysdeboissezon/Fournaise/issues/new";

const ord = (n) => (n === 1 ? "1er" : n + "e");
const roundN = (n) => (n >= 20 ? Math.round(n / 5) * 5 : Math.round(n));
const fr = (n, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sign = (v) => (v >= 0 ? "+" : "−") + fr(Math.abs(v), 1);

// Noms et tournures : « Paris 9e », « Montreuil », « dans le 9e arrondissement », « à Montreuil », « au Kremlin-Bicêtre »
const isParis = (z) => z.dep === "75";
const fileOf = (z) => (isParis(z) ? `paris-${ord(z.n)}.html` : `${z.slug}-${z.dep}.html`);
const title = (z) => (isParis(z) ? `Paris ${ord(z.n)}` : z.name);
const inZ = (z) => (isParis(z) ? `dans le ${ord(z.n)} arrondissement` : /^Le /.test(z.name) ? "au " + z.name.slice(3) : /^Les /.test(z.name) ? "aux " + z.name.slice(4) : "à " + z.name);
const ofZ = (z) => (isParis(z) ? `du ${ord(z.n)} arrondissement` : /^Le /.test(z.name) ? "du " + z.name.slice(3) : /^Les /.test(z.name) ? "des " + z.name.slice(4) : /^[AEIOUYÉÈÎH]/i.test(z.name) ? "d'" + z.name : "de " + z.name);
const kind = (z) => (isParis(z) ? "l'arrondissement" : "la commune");

const PROFILES = [
  { id: "frais", label: "Étage intermédiaire, nord, traversant, volets extérieurs, pierre", p: { floor: "mid", orient: "N", windows: "double", shutters: "ext", traversant: "yes", nightOpen: "yes", era: "pre1914", size: "m", dpeEte: "moyen" } },
  { id: "dernier", label: "Dernier étage, plein sud, rideaux intérieurs, une seule façade", p: { floor: "top", orient: "S", windows: "double", shutters: "int", traversant: "no", nightOpen: "yes", era: "1949_1974", size: "s", dpeEte: "unknown" } },
  { id: "bonne", label: "Chambre de bonne sous les toits, ouest, Velux, sans protection", p: { floor: "roof", orient: "W", windows: "roof", shutters: "none", traversant: "no", nightOpen: "yes", era: "pre1914", size: "xs", dpeEte: "unknown" } }
].map((x) => Object.assign(x, { prm: M.params(x.p) }));

// Mailles de 100 m de chaque zone (centre de la maille dans le contour)
const G = D.heat, FINE = G.fineM;
const rows = Math.round(G.rows * G.cellM / FINE), cols = Math.round(G.cols * G.cellM / FINE);
const cells = {};
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const lon = G.lon0 + ((c + 0.5) * FINE) / (G.kmLon * 1000), lat = G.lat1 - ((r + 0.5) * FINE) / (G.kmLat * 1000);
  const z = M.zoneAt(lon, lat, ZONES);
  if (!z) continue;
  const heat = M.localHeat(lon, lat, ZONES);
  (cells[z.code] = cells[z.code] || []).push({ lon, lat, delta: Math.round(heat.delta * 10) / 10, built: heat.built, veg: heat.veg });
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const centroid = (z) => {
  const ring = z.rings.reduce((b, r) => (r.length > b.length ? r : b), z.rings[0]);
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; x += (ring[j][0] + ring[i][0]) * f; y += (ring[j][1] + ring[i][1]) * f;
  }
  return [x / (3 * a), y / (3 * a)];
};
const NUDGE = { "75116": [2.268, 48.858], "75112": [2.398, 48.838] };

// Les simulations ne dépendent que de l'écart de quartier, arrondi au dixième : on les garde en cache.
const simCache = {};
const sim = (pr, delta, fut) => {
  const k = pr.id + delta + (fut ? "f" : "");
  return simCache[k] || (simCache[k] = M.simulate(D.climate, delta, pr.prm, fut ? M.SCENARIOS_2050.central : undefined));
};

function stats(z) {
  const cs = cells[z.code], deltas = cs.map((c) => c.delta).sort((a, b) => a - b);
  const out = { cells: cs.length, areaKm2: cs.length * 0.01, delta: mean(deltas), lo: deltas[Math.floor(deltas.length * 0.1)], hi: deltas[Math.floor(deltas.length * 0.9)], built: mean(cs.map((c) => c.built)), veg: mean(cs.map((c) => c.veg)) };
  out.profiles = PROFILES.map((pr) => {
    let n26 = 0, n28 = 0, f26 = 0, f28 = 0;
    cs.forEach((c) => {
      const s = sim(pr, c.delta), f = sim(pr, c.delta, true);
      n26 += s.n26; n28 += s.n28; f26 += f.n26; f28 += f.n28;
    });
    n26 /= cs.length; n28 /= cs.length; f26 /= cs.length; f28 /= cs.length;
    return { label: pr.label, n26, score: M.scoreFrom(n26, n28), f26, fscore: M.scoreFrom(f26, f28), p: pr.p };
  });
  const fp = path.join(root, "data/dpe", z.code + ".json");
  let bon = 0, moy = 0, ins = 0, dpe = 0;
  if (fs.existsSync(fp)) JSON.parse(fs.readFileSync(fp, "utf8")).rows.forEach((r) => { dpe += r[3]; bon += r[4][0]; moy += r[4][1]; ins += r[4][2]; });
  out.dpe = { n: dpe, rated: bon + moy + ins, bon, moy, ins };
  return out;
}

const QUERY_KEYS = ["floor", "orient", "windows", "shutters", "ac", "traversant", "nightOpen", "era", "size", "dpeEte"];
const link = (lon, lat, p) => {
  const prof = Object.assign({}, M.DEFAULT_PROFILE, p);
  return "./?lon=" + lon.toFixed(3) + "&lat=" + lat.toFixed(3) + "&" + QUERY_KEYS.map((k) => k + "=" + encodeURIComponent(prof[k])).join("&");
};

const all = ZONES.filter((z) => cells[z.code]).map((z) => ({ z, s: stats(z) }));
const DEPS = D.departements;

all.forEach(({ z, s }) => {
  const file = fileOf(z);
  let c = NUDGE[z.code] || centroid(z);
  if (!M.zoneAt(c[0], c[1], ZONES)) c = [cells[z.code][0].lon, cells[z.code][0].lat];
  const pageTitle = `Chaleur ${isParis(z) ? "à " + title(z) : inZ(z)} : nuits étouffantes en été`;
  const desc = isParis(z)
    ? `Combien de nuits étouffantes dans un logement du ${ord(z.n)} arrondissement de Paris ? Estimation par type de logement, DPE de l'arrondissement et projection 2050.`
    : `Combien de nuits étouffantes dans un logement ${inZ(z)} (${DEPS[z.dep]}) ? Estimation par type de logement, DPE de la commune et projection 2050.`;
  const rows = s.profiles.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${fr(roundN(x.n26))}</td><td class="num">${Math.round(x.score)}/10</td><td class="num">${fr(roundN(x.f26))}</td><td><a href="${link(c[0], c[1], x.p)}">Calculer pour mon logement</a></td></tr>`).join("");
  const d = s.dpe;
  const dpeText = d.rated >= 30
    ? `Sur ${fr(d.n)} DPE de logements établis depuis juillet 2021 ${isParis(z) ? "dans l'arrondissement" : "dans la commune"}, ${fr(d.rated)} indiquent un confort d'été : ${fr(Math.round((100 * d.ins) / d.rated))} % « insuffisant », ${fr(Math.round((100 * d.moy) / d.rated))} % « moyen », ${fr(Math.round((100 * d.bon) / d.rated))} % « bon » (ADEME, données déclaratives, regroupées par adresse).`
    : `Peu de DPE publiés depuis 2021 ${isParis(z) ? "dans l'arrondissement" : "dans la commune"} pour en tirer une tendance (ADEME).`;
  const short = (o) => (isParis(o.z) ? ord(o.z.n) : o.z.name);
  const same = all.filter((o) => o.z.dep === z.dep);
  const nav = same.map((o) => (o.z.code === z.code ? `<span aria-current="page">${esc(short(o))}</span>` : `<a href="${fileOf(o.z)}">${esc(short(o))}</a>`)).join(" · ");
  const otherDeps = Object.keys(DEPS).filter((d) => d !== z.dep).map((d) => { const first = all.find((o) => o.z.dep === d); return `<a href="${fileOf(first.z)}">${esc(DEPS[d])}</a>`; }).join(" · ");
  const wood = s.veg >= 25 ? ` Les chiffres ${ofZ(z)} incluent ses bois et grands parcs (${fr(Math.round(s.veg))} % de végétation en moyenne autour d'un point), ce qui les rafraîchit : un logement en zone bâtie est plus chaud que la moyenne indiquée.` : "";
  const suburb = isParis(z) ? "" : `
<h2>Moins fiable qu'à Paris</h2>
<p>Hors de Paris, Fournaise garde une seule station de référence, Paris-Montsouris, et corrige la nuit par le volume bâti et la végétation du quartier, avec des poids calés sur ${G.stationFit ? G.stationFit.stations.length : "quelques"} stations Météo-France de la région. Le relief (plateaux, vallées de la Seine et de la Marne) n'est pas pris en compte, et le modèle du logement est pensé pour les appartements : pour une maison individuelle, le score est une indication. Le niveau de confiance affiché à côté du score en tient compte.</p>`;
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(pageTitle)} · Fournaise</title>
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
<meta property="og:title" content="${esc(pageTitle)}">
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
<h1>Chaleur ${isParis(z) ? "à " + esc(title(z)) : esc(inZ(z)) + " (" + z.dep + ")"} : combien de nuits étouffantes ?</h1>
<p>Fournaise estime le nombre de nuits où la chambre dépasse 26 °C au coucher, à partir de dix étés de relevés réels à Paris-Montsouris (2017-2026), du bâti et de la végétation autour de chaque maille de 100 m (IGN, poids calés sur des stations Météo-France) et des caractéristiques du logement. Voici ce que cela donne ${isParis(z) ? "pour le " + ord(z.n) + " arrondissement" : "pour " + esc(z.name.replace(/^Le /, "le ").replace(/^Les /, "les ").replace(/^La /, "la ")) + " (" + esc(DEPS[z.dep]) + ")"}.</p>
<h2>Trois logements types</h2>
<p>Moyenne sur les ${fr(s.cells)} mailles de 100 m de ${kind(z)} (environ ${fr(Math.round(s.areaKm2))} km²), nuits étouffantes par été, moyenne 2017-2026, arrondies à 5 au-dessus de 20.</p>
<div class="tbl-wrap"><table><thead><tr><th scope="col">Logement</th><th scope="col" class="num">Nuits par été</th><th scope="col" class="num">Score</th><th scope="col" class="num">En 2050</th><th scope="col"><span class="sr-only">Lien</span></th></tr></thead><tbody>${rows}</tbody></table></div>
<p>L'étage, la toiture, l'orientation et les protections solaires pèsent environ trois fois plus que le quartier : deux logements ${isParis(z) ? "du même arrondissement" : "de la même commune"} peuvent avoir des étés très différents.</p>
<h2>Le quartier, la nuit</h2>
<p>Par rapport au parc Montsouris, les nuits chaudes sont en moyenne ${s.delta >= 0 ? "plus chaudes" : "plus fraîches"} de ${fr(Math.abs(s.delta), 1)} °C ${esc(inZ(z))} (de ${sign(s.lo)} à ${sign(s.hi)} °C selon la maille, pour 80 % d'entre elles). Autour d'un point moyen : ${fr(Math.round(s.built))} % de bâti et ${fr(Math.round(s.veg))} % de végétation.${wood}</p>${suburb}
<h2>Ce que disent les DPE</h2>
<p>${dpeText}</p>
<h2>Calculer pour ton logement</h2>
<p>Ces moyennes ne remplacent pas ton cas : tape ton adresse, réponds à quelques questions sur l'étage, les fenêtres et les protections solaires, et Fournaise te donne ton score, un niveau de confiance et des conseils chiffrés.</p>
<p><a class="btn hot big" href="${link(c[0], c[1], {})}">Calculer mon score ${isParis(z) ? "dans le " + ord(z.n) : esc(inZ(z))}</a></p>
<p class="note">Estimation de Fournaise, non mesurée dans des logements : voir <a href="./#methode">la méthode</a> et <a href="./#sources">le niveau de preuve des données</a>. <a href="${ISSUES}" target="_blank" rel="noopener">Signaler une erreur</a>.</p>
<h2>${isParis(z) ? "Les autres arrondissements" : "Les autres communes du département (" + esc(DEPS[z.dep]) + ")"}</h2>
<p>${nav}</p>
<p>Ailleurs : ${otherDeps}</p>
</main>
<footer><div class="wrap foot"><nav class="foot-nav foot-legal" aria-label="Informations légales"><a href="mentions-legales.html">Mentions légales</a><a href="confidentialite.html">Confidentialité</a><a href="donnees-licences.html">Données et licences</a><a href="${ISSUES}" target="_blank" rel="noopener">Signaler une erreur</a></nav></div></footer>
</body>
</html>
`;
  fs.writeFileSync(path.join(root, file), html);
});
console.log(all.map(({ z, s }) => `${title(z)}: ${s.cells} mailles, quartier ${s.delta.toFixed(1)} °C, ${s.profiles.map((x) => roundN(x.n26)).join("/")}`).join("\n"));
fs.writeFileSync(path.join(root, "data", "zone-pages.json"), JSON.stringify(all.map(({ z, s }) => ({ code: z.code, file: fileOf(z), name: title(z), dep: z.dep, delta: +s.delta.toFixed(2) })), null, 0));

// Page d'index des communes de la petite couronne, classées par département, du quartier le plus chaud au plus frais.
{
  const file = "petite-couronne.html";
  const pageTitle = "Chaleur en petite couronne : nuits étouffantes commune par commune";
  const desc = "Hauts-de-Seine, Seine-Saint-Denis, Val-de-Marne : combien de nuits étouffantes dans un logement de chaque commune ? Estimation Fournaise par commune et projection 2050.";
  const sections = Object.keys(DEPS).filter((d) => d !== "75").map((d) => {
    const list = all.filter((o) => o.z.dep === d).sort((a, b) => a.z.name.localeCompare(b.z.name, "fr"));
    const items = list.map((o) => `<tr><td><a href="${fileOf(o.z)}">${esc(o.z.name)}</a></td><td class="num">${sign(o.s.delta)} °C</td><td class="num">${fr(roundN(o.s.profiles[1].n26))}</td></tr>`).join("");
    return `<h2>${esc(DEPS[d])} (${d})</h2>
<div class="tbl-wrap"><table><thead><tr><th scope="col">Commune</th><th scope="col" class="num">Nuits chaudes par rapport à Montsouris</th><th scope="col" class="num">Dernier étage sud, nuits par été</th></tr></thead><tbody>${items}</tbody></table></div>`;
  }).join("\n");
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(pageTitle)} · Fournaise</title>
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
<meta property="og:title" content="${esc(pageTitle)}">
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
<h1>Chaleur en petite couronne, commune par commune</h1>
<p>Pour chaque commune des Hauts-de-Seine, de la Seine-Saint-Denis et du Val-de-Marne : l'écart moyen des nuits chaudes par rapport au parc Montsouris (bâti et végétation du quartier, IGN, poids calés sur les stations Météo-France) et le nombre de nuits étouffantes par été pour un même logement type, un dernier étage plein sud. Les communes boisées paraissent plus fraîches en moyenne : un logement en zone bâtie y est plus chaud que la moyenne.</p>
<p>Hors de Paris, l'estimation est moins fiable : une seule station de référence (Montsouris), relief non pris en compte, et un modèle pensé pour les appartements. Voir <a href="./#sources">le niveau de preuve des données</a>.</p>
${sections}
<h2>Paris</h2>
<p>${all.filter((o) => isParis(o.z)).map((o) => `<a href="${fileOf(o.z)}">${ord(o.z.n)}</a>`).join(" · ")}</p>
</main>
<footer><div class="wrap foot"><nav class="foot-nav foot-legal" aria-label="Informations légales"><a href="mentions-legales.html">Mentions légales</a><a href="confidentialite.html">Confidentialité</a><a href="donnees-licences.html">Données et licences</a><a href="${ISSUES}" target="_blank" rel="noopener">Signaler une erreur</a></nav></div></footer>
</body>
</html>
`;
  fs.writeFileSync(path.join(root, file), html);
}
