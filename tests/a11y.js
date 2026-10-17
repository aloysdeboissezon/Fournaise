// Accessibilité : axe-core (WCAG 2.2 AA) sur la page d'accueil et les pages de texte, en thème clair et sombre.
// Usage : npm install && npx playwright install chromium && npm run test:a11y
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = "http://localhost:" + server.address().port + "/";
  const browser = await chromium.launch();
  let failed = 0;
  for (const [page, viewport] of [["index.html", { width: 1366, height: 850 }], ["index.html", { width: 375, height: 812 }], ["mentions-legales.html", { width: 1366, height: 850 }], ["confidentialite.html", { width: 1366, height: 850 }], ["donnees-licences.html", { width: 1366, height: 850 }], ["paris-15e.html", { width: 375, height: 812 }], ["montreuil-93.html", { width: 375, height: 812 }], ["petite-couronne.html", { width: 1366, height: 850 }]]) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
    const p = await ctx.newPage();
    await p.route(/geopf\.fr|data\.gouv\.fr/, (r) => r.abort());
    await p.goto(base + page, { waitUntil: "load" });
    await p.waitForTimeout(500);
    await p.addScriptTag({ path: require.resolve("axe-core") });
    for (const theme of ["light", "dark"]) {
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(250);
      const res = await p.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] }));
      for (const v of res.violations) {
        failed++;
        console.log(`${page} ${viewport.width}px ${theme} : ${v.id} (${v.nodes.length}) ${v.help}\n   ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n   ")}`);
      }
    }
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(failed ? failed + " violation(s)" : "Aucune violation axe.");
  process.exit(failed ? 1 : 0);
})();
