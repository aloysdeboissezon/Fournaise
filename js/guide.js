/* Fournaise — parcours guidé (mode rapide : une adresse et 4 questions) et résultat qui se dévoile pas à pas.
   Dépend de js/app.js (window.FournaiseApp). Les réponses passent par les mêmes boutons radio que le formulaire complet. */
(function () {
  "use strict";
  var A = window.FournaiseApp;
  if (!A) return;
  var $ = function (id) { return document.getElementById(id); };
  var form = $("form");
  var KEYS = ["floor", "orient", "shutters", "ac"];
  var COPY = {
    floor: ["À quel étage se trouve le logement ?", "Sous les toits ou au dernier étage, la toiture chauffe la chambre toute la journée."],
    orient: ["Vers où donnent les fenêtres de la chambre ou du séjour ?", "La boussole du téléphone suffit. Si tu hésites, choisis « Je ne sais pas »."],
    shutters: ["Comment la fenêtre est-elle protégée du soleil ?", "Un volet ou un store extérieur arrête la chaleur avant la vitre ; un rideau en laisse entrer la moitié."],
    ac: ["Y a-t-il la climatisation ?", "Avec elle, les nuits étouffantes sont comptées à part : le score dit ce que serait le logement sans."]
  };
  var QS = {};
  A.Q_MAIN.forEach(function (q) { QS[q.key] = q; });
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var mode = "quick", step = 0, started = false;

  function save(m) { try { localStorage.setItem("fournaise-mode", m); } catch (e) {} }
  function saved() { try { return localStorage.getItem("fournaise-mode"); } catch (e) { return null; } }

  function setMode(m, focus) {
    mode = m;
    form.classList.toggle("mode-quick", m === "quick");
    form.classList.toggle("mode-full", m === "full");
    $("wizard").hidden = m !== "quick";
    Array.prototype.forEach.call($("mode-toggle").querySelectorAll("button"), function (b) { b.setAttribute("aria-pressed", b.dataset.mode === m ? "true" : "false"); });
    $("mode-hint").textContent = m === "quick"
      ? "Une adresse et 4 questions suffisent. Le score se précise si tu réponds à plus."
      : "Toutes les questions : le score est plus fiable et la plage de sensibilité se resserre.";
    if (m === "quick") render(focus);
    save(m);
  }

  function located() { return !!(A.state.location && !A.state.example); }

  // Étape 0 : l'adresse ; 1 à 4 : les questions ; 5 : récapitulatif.
  function render(focus) {
    var total = KEYS.length + 1, title = $("wz-title"), opts = $("wz-opts"), next = $("wz-next"), back = $("wz-back");
    $("wz-step").textContent = step <= KEYS.length ? "Étape " + (step + 1) + " sur " + total : "Terminé";
    $("wz-fill").style.width = Math.round(((Math.min(step, KEYS.length) + (step > KEYS.length ? 1 : 0)) / total) * 100) + "%";
    back.hidden = step === 0;
    opts.innerHTML = "";
    $("wz-hint").textContent = "";
    next.hidden = false;
    next.disabled = false;
    if (step === 0) {
      title.textContent = "Où est le logement ?";
      $("wz-hint").textContent = located()
        ? "Adresse prise en compte. Tu peux encore la préciser sur la carte."
        : "Tape une adresse, cherche-la sur la carte ou touche-la. Un exemple est affiché en attendant.";
      next.textContent = "Suivant";
      next.disabled = !located();
      if (!located()) {
        var ex = document.createElement("button");
        ex.type = "button"; ex.className = "linklike"; ex.textContent = "Continuer avec l'exemple affiché";
        ex.addEventListener("click", function () { step = 1; render(true); });
        opts.appendChild(ex);
      }
    } else if (step <= KEYS.length) {
      var key = KEYS[step - 1], q = QS[key];
      title.textContent = COPY[key][0];
      $("wz-hint").textContent = COPY[key][1];
      var cur = A.state.profile[key], touched = !!A.state.touched[key];
      q.opts.forEach(function (o) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = o[1]; b.dataset.value = o[0];
        b.className = "wz-opt" + (o[0] === "unknown" ? " unknown" : "");
        b.setAttribute("aria-pressed", touched && cur === o[0] ? "true" : "false");
        b.addEventListener("click", function () { answer(key, o[0]); });
        opts.appendChild(b);
      });
      next.textContent = step === KEYS.length ? "Voir mon score" : "Suivant";
      next.disabled = !touched;
    } else {
      title.textContent = "Ton score est prêt";
      var r = A.state.result;
      $("wz-hint").textContent = "Basé sur " + KEYS.length + " réponses" + (r ? ", niveau de confiance " + r.confidence.label.toLowerCase() : "") +
        ". Réponds à plus de questions pour le resserrer.";
      next.textContent = "Affiner avec toutes les questions";
      back.textContent = "Recommencer";
    }
    if (step <= KEYS.length) back.textContent = "Retour";
    $("wz-live").textContent = title.textContent;
    if (focus) title.focus({ preventScroll: true });
  }

  function answer(key, value) {
    var input = $("f-" + key + "-" + value);
    if (!input) return;
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    render(false);
    // La question suivante arrive d'elle-même : un seul tap suffit.
    var at = step;
    clearTimeout(answer._t);
    answer._t = setTimeout(function () { if (mode === "quick" && step === at) advance(); }, reduced ? 0 : 280);
  }

  function advance() {
    if (step === 0) { if (!located()) return; step = 1; render(true); return; }
    if (step < KEYS.length) { step++; render(true); return; }
    if (step === KEYS.length) { step++; render(true); showResult(); return; }
    setMode("full");
    $("refine").open = true;
    $("fs-logement").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  function showResult() {
    var v = $("verdict");
    if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) v.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    setTimeout(reveal, reduced ? 0 : 350);
  }

  // Le résultat se dévoile : score, nuits, 2050, avec un compte à rebours de chaque chiffre.
  var revealTimer = 0;
  function tween(el, ms, delay) {
    var node = el && el.childNodes[0];
    if (!node || node.nodeType !== 3) return;
    var final = node.nodeValue, n = parseFloat(final.replace(/[^\d.,]/g, "").replace(",", "."));
    if (!isFinite(n) || n === 0) return;
    node.nodeValue = "0";
    setTimeout(function () {
      var t0 = performance.now();
      (function step(now) {
        var t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
        node.nodeValue = t < 1 ? String(Math.round(n * e)) : final;
        if (t < 1) requestAnimationFrame(step);
      })(t0);
    }, delay);
  }
  function reveal() {
    var v = $("verdict");
    if (reduced || !A.state.result) return;
    v.classList.remove("revealing"); void v.offsetWidth; v.classList.add("revealing");
    $("v-mark").style.transition = "none"; $("v-mark").style.left = "0%";
    void $("v-mark").offsetWidth; $("v-mark").style.transition = "";
    $("v-mark").style.left = ((A.state.result.score - 1) / 9) * 100 + "%";
    tween($("v-score"), 900, 0);
    tween($("s-n26"), 900, 350);
    tween($("s-n28"), 700, 600);
    tween($("s-2050"), 1000, 900);
    clearTimeout(revealTimer);
    revealTimer = setTimeout(function () { v.classList.remove("revealing"); }, 2600);
  }

  function wire() {
    Array.prototype.forEach.call($("mode-toggle").querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () { A.track("mode-" + b.dataset.mode); step = 0; setMode(b.dataset.mode, false); });
    });
    $("wz-next").addEventListener("click", advance);
    $("wz-back").addEventListener("click", function () {
      clearTimeout(answer._t);
      if (step > KEYS.length) { step = 0; render(true); return; }
      step = Math.max(0, step - 1); render(true);
    });
    document.addEventListener("fournaise:update", function () { if (mode === "quick" && step === 0) render(false); });
    document.addEventListener("fournaise:reveal", reveal);
    // Un lien partagé ou une adresse déjà choisie arrive avec toutes ses réponses : le formulaire complet est plus parlant.
    var fromLink = /[?&]floor=/.test(location.search);
    setMode(fromLink ? "full" : saved() === "full" ? "full" : "quick", false);
  }
  wire();
})();
