// Dessine les icônes d'installation (écran d'accueil, PWA) à partir de img/logo.svg.
// Usage : node scripts/build_icons.js   (nécessite Playwright ; CHROMIUM=/chemin/chrome si besoin)
// Sortie : img/icon-192.png, img/icon-512.png, img/icon-maskable-512.png, img/apple-touch-icon.png (img/favicon.svg et img/logo.svg sont écrits à la main).
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const img = path.join(__dirname, "..", "img");
const logo = fs.readFileSync(path.join(img, "logo.svg"), "utf8").replace(/id="f"/, 'id="g"').replace("url(#f)", "url(#g)");

const shot = (size, scale, rounded, name) => ({ size, name, html:
  `<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;background:#13171c;border-radius:${rounded ? Math.round(size * 0.22) : 0}px;display:grid;place-items:center"><div style="width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px">${logo}</div></div></body>` });

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  for (const s of [shot(192, 0.66, true, "icon-192.png"), shot(512, 0.66, true, "icon-512.png"), shot(512, 0.5, false, "icon-maskable-512.png"), shot(180, 0.62, false, "apple-touch-icon.png")]) {
    const page = await browser.newPage({ viewport: { width: s.size, height: s.size } });
    await page.setContent(s.html);
    await page.screenshot({ path: path.join(img, s.name), omitBackground: true });
    await page.close();
  }
  await browser.close();
  console.log("icônes écrites dans img/");
})();
