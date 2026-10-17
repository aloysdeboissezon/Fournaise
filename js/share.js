/* Fournaise — carte de partage (image pour TikTok, Instagram, WhatsApp). Dépend de js/app.js (window.FournaiseApp). */
(function () {
  "use strict";
  var A = window.FournaiseApp;
  if (!A) return;
  var $ = function (id) { return document.getElementById(id); };
  var FORMATS = { story: { w: 1080, h: 1920, name: "story" }, post: { w: 1080, h: 1350, name: "post" } };
  var format = "story";
  var FONT_D = "Unbounded, 'Arial Black', sans-serif", FONT_B = "'Instrument Sans', 'Segoe UI', sans-serif";
  var drawTimer = null;
  // La flamme de img/logo.svg : contour puis bandes de la plus chaude (haut) à la plus sombre (bas).
  var FLAME = new Path2D("M16 2.2c2.3 4.9 8.6 8.2 8.6 16.8 0 5.8-3.8 10.2-8.6 10.2S7.4 24.8 7.4 19c0-3.7 1.8-5.9 3.6-7.9.3 2.5 1.4 3.9 2.8 4.5-.7-4.2 0-9.4 2.2-13.4z");
  var BANDS = [[0, 9.4, "#efd37a"], [10, 5, "#f19a3e"], [15.6, 5, "#de4a22"], [21.2, 4.2, "#a3133f"], [26, 5, "#4b0b33"]];

  // Découpe un texte en lignes qui tiennent dans maxW (la police du contexte doit déjà être réglée).
  function wrap(ctx, text, maxW) {
    var words = text.split(" "), lines = [], line = "";
    words.forEach(function (w) {
      var t = line ? line + " " + w : w;
      if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }

  function pill(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw(r, fmt) {
    var W = fmt.w, H = fmt.h, tall = H > 1500;
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var ctx = c.getContext("2d");
    var g = ctx.createRadialGradient(W * 0.15, 0, 60, W * 0.4, H * 0.4, H * 1.05);
    g.addColorStop(0, A.scoreColor(Math.min(10, r.score + 1.2)));
    g.addColorStop(0.55, A.scoreColor(Math.min(10, r.score + 3)));
    g.addColorStop(1, "#24061b");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, "rgba(12,6,14,0.22)"); shade.addColorStop(1, "rgba(12,6,14,0.78)");
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);

    var X = 84, top = tall ? 150 : 110;
    // Marque : la flamme en bandes (comme img/logo.svg) et le nom
    var k = 2.1;
    ctx.save();
    ctx.translate(X - 7.4 * k, top - 64 - 2.2 * k); ctx.scale(k, k);
    ctx.clip(FLAME);
    BANDS.forEach(function (bd) { ctx.fillStyle = bd[2]; ctx.fillRect(0, bd[0], 32, bd[1]); });
    ctx.restore();
    ctx.fillStyle = "#fff"; ctx.textBaseline = "alphabetic";
    ctx.font = "800 54px " + FONT_D; ctx.fillText("fournaise", X + 56, top - 8);

    // Score
    var y = top + (tall ? 150 : 110);
    ctx.globalAlpha = 0.9; ctx.font = "600 52px " + FONT_B; ctx.fillText("Mon appart a eu", X, y); ctx.globalAlpha = 1;
    var big = tall ? 520 : 400;
    y += big * 0.86;
    ctx.font = "800 " + big + "px " + FONT_D;
    var s = String(r.scoreRounded);
    ctx.fillText(s, X - 10, y);
    var sw = ctx.measureText(s).width;
    ctx.globalAlpha = 0.8; ctx.font = "700 " + Math.round(big * 0.29) + "px " + FONT_D; ctx.fillText("/10", X + sw, y); ctx.globalAlpha = 1;

    // Phrase d'accroche
    y += tall ? 130 : 100;
    ctx.font = "700 " + (tall ? 78 : 70) + "px " + FONT_D;
    wrap(ctx, A.shareLine(r), W - 2 * X).forEach(function (l) { ctx.fillText(l, X, y); y += tall ? 92 : 84; });

    // Deux chiffres : aujourd'hui et 2050
    y += 18;
    var cw = (W - 2 * X - 24) / 2, ch = 170;
    [[A.nights(r.n26), A.plural(r.n26, "nuit étouffante", "nuits étouffantes") + " par été"], [A.nights(r.y2050.n26), "en 2050"]].forEach(function (b, i) {
      var x = X + i * (cw + 24);
      ctx.fillStyle = "rgba(255,255,255,0.14)"; pill(ctx, x, y, cw, ch, 28); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "800 84px " + FONT_D; ctx.fillText(b[0], x + 32, y + 98);
      ctx.globalAlpha = 0.9; ctx.font = "500 32px " + FONT_B; ctx.fillText(b[1], x + 32, y + 146); ctx.globalAlpha = 1;
    });
    y += ch;

    // Dix étés en bandes de couleur
    var footY = H - 130;
    var bandTop = y + (tall ? 70 : 50), bandH = footY - 150 - bandTop;
    if (bandH > 120) {
      var years = r.now.years, rows = years.length, gap = 4;
      var rh = Math.min(30, (bandH - (rows - 1) * gap) / rows), bw = W - 2 * X;
      var by = bandTop + (bandH - (rows * rh + (rows - 1) * gap)) / 2;
      ctx.save(); pill(ctx, X, by, bw, rows * rh + (rows - 1) * gap, 18); ctx.clip();
      years.forEach(function (yr, row) {
        var cwid = bw / yr.indoor.length;
        for (var d = 0; d < yr.indoor.length; d++) {
          ctx.fillStyle = A.tempColor(yr.indoor[d]);
          ctx.fillRect(X + d * cwid, by + row * (rh + gap), Math.ceil(cwid + 0.5), rh);
        }
      });
      ctx.restore();
      ctx.globalAlpha = 0.8; ctx.fillStyle = "#fff"; ctx.font = "500 28px " + FONT_B;
      ctx.fillText("Ma chambre, chaque nuit des étés 2017 à 2026", X, by + rows * rh + (rows - 1) * gap + 44);
      ctx.globalAlpha = 1;
    }

    // Lieu et appel à l'action
    ctx.fillStyle = "#fff";
    ctx.font = "600 38px " + FONT_B;
    ctx.fillText((r.heat.zone ? r.heat.zone.name : "Paris") + " · score de chaleur estimé", X, footY - 56);
    ctx.globalAlpha = 0.85; ctx.font = "500 34px " + FONT_B;
    ctx.fillText("Et le tien ? " + A.siteHost(), X, footY);
    ctx.globalAlpha = 1;
    return c;
  }

  function fontsReady() {
    return document.fonts && document.fonts.load
      ? Promise.all([document.fonts.load("800 100px Unbounded"), document.fonts.load("700 40px Unbounded"), document.fonts.load("500 40px 'Instrument Sans'"), document.fonts.load("600 40px 'Instrument Sans'")]).catch(function () {})
      : Promise.resolve();
  }

  function renderPreview() {
    var r = A.state.result, view = $("share-canvas");
    if (!r || !view) return;
    fontsReady().then(function () {
      if (r !== A.state.result) return;
      var c = draw(r, FORMATS[format]);
      view.width = c.width / 2; view.height = c.height / 2;
      view.getContext("2d").drawImage(c, 0, 0, view.width, view.height);
      view.style.aspectRatio = c.width + " / " + c.height;
      view.setAttribute("aria-label", "Aperçu de l'image : score " + r.scoreRounded + " sur 10, " + A.nights(r.n26) + " nuits étouffantes par été");
    });
  }

  function makeBlob() {
    return fontsReady().then(function () {
      return new Promise(function (res) { draw(A.state.result, FORMATS[format]).toBlob(res, "image/png"); });
    });
  }

  function save(blob) {
    var name = "fournaise-score-" + A.state.result.scoreRounded + "sur10-" + format + ".png";
    if (A.downloads()) {
      A.downloads().save({ filename: name, data: blob }).then(function () { A.toast("Image enregistrée."); }, function (err) {
        if (err && err.code === "declined") return;
        A.toast("L'enregistrement n'est pas disponible ici.");
      });
      return;
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    A.toast("Image enregistrée dans tes téléchargements.");
  }

  function wire() {
    var seg = $("share-format");
    if (!seg) return;
    Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        format = b.dataset.format;
        Array.prototype.forEach.call(seg.querySelectorAll("button"), function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
        renderPreview();
      });
    });
    $("img-btn").addEventListener("click", function () {
      if (!A.state.result) return;
      makeBlob().then(function (blob) {
        if (!blob) { A.toast("L'image n'a pas pu être créée."); return; }
        A.track("partage-image"); save(blob);
      });
    });
    var share = $("img-share-btn"), probe = null;
    try { probe = new File([new Blob(["x"], { type: "image/png" })], "x.png", { type: "image/png" }); } catch (e) {}
    if (navigator.share && navigator.canShare && probe && navigator.canShare({ files: [probe] })) {
      share.hidden = false;
      share.addEventListener("click", function () {
        if (!A.state.result) return;
        makeBlob().then(function (blob) {
          if (!blob) return;
          A.track("partage-image-natif");
          var file = new File([blob], "fournaise-score.png", { type: "image/png" });
          navigator.share({ files: [file], title: "Fournaise", text: $("share-text").textContent }).catch(function () {});
        });
      });
    }
    document.addEventListener("fournaise:update", function () { clearTimeout(drawTimer); drawTimer = setTimeout(renderPreview, 120); });
    document.addEventListener("fournaise:theme", renderPreview);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderPreview);
    renderPreview();
  }
  wire();
  window.FournaiseShare = { draw: draw, FORMATS: FORMATS };
})();
