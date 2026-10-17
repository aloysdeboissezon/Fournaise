// Capture scripts/og.html en img/og.png (1200 × 630). Usage : node scripts/build_og.js (nécessite Playwright).
const path = require("path");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  if (process.env.RELAY) {
    // Environnements derrière un proxy : relayer les polices via curl.
    const { execFileSync } = require("child_process");
    await page.route(/^https:/, (route) => {
      const u = route.request().url();
      const body = execFileSync("curl", ["-sSL", "-m", "20", u], { maxBuffer: 1e8 });
      route.fulfill({ status: 200, body, headers: { "content-type": u.includes("gstatic") ? "font/woff2" : "text/css" } });
    });
  }
  await page.goto("file://" + path.join(__dirname, "og.html"));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(__dirname, "..", "img", "og.png") });
  await browser.close();
  console.log("img/og.png");
})();
