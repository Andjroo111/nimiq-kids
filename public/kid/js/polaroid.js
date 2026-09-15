// nimiq.kids — Polaroid timer rig (placeholder art). An instant photo develops
// as the countdown runs: the frame slides out of a simple camera body when the
// timer starts, then the photo area develops with progress (washed-white + blur
// + a chemical swirl -> clear). WHICH photo it is stays a mystery until it
// develops — flow.js picks a random photo from the kid's own media (else the
// task icon / surprise art). hatch() = snap fully sharp + flash, the polaroid
// lifts off the camera with a wiggle.
//
// ART CONTRACT (future NanoBanana re-skins — no JS edits needed): all colors,
// geometry and timings are CSS custom properties on .pola-rig (--pola-*, see
// kid/css/polaroid.css). Camera artwork is an inline SVG (.pola-cam).
//
// API (same contract as createEggRig — flow.js swaps rigs by style id):
//   createPolaroidRig(container, opts) ->
//     { setProgress(p /*0..1*/), hatch({ imageUrl, onDone }), reset(), wobble(), destroy() }
//   opts.photoUrl: the photo that develops (flow resolves it; hatch imageUrl fills
//   in only when none was given). opts.ariaLabel: localized mystery label.

export function createPolaroidRig(container, opts = {}) {
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const root = document.createElement("div");
  root.className = "pola-rig";
  root.innerHTML = buildHtml(opts.ariaLabel ?? "Instant photo");
  container.appendChild(root);

  const cam = root.querySelector(".pola-cam-wrap");
  const frame = root.querySelector(".pola-frame");
  const img = root.querySelector(".pola-photo img");
  if (opts.photoUrl) img.src = opts.photoUrl;

  let hatched = false;
  let destroyed = false;
  let doneTimer = 0;

  function clearJiggle() { cam.classList.remove("is-jiggling"); }
  cam.addEventListener("animationend", clearJiggle);

  function wobble() {
    if (destroyed || hatched || reduceMotion) return;
    clearJiggle();
    void cam.offsetWidth; // restart the keyframe
    cam.classList.add("is-jiggling");
  }

  function setProgress(p) {
    if (destroyed || hatched) return;
    const clamped = Math.min(1, Math.max(0, Number(p) || 0));
    if (clamped > 0) root.classList.add("is-ejected"); // the frame slides out at start
    root.style.setProperty("--pola-dev", clamped.toFixed(4));
  }

  function hatch({ imageUrl, onDone } = {}) {
    if (destroyed || hatched) return;
    hatched = true;
    if (!opts.photoUrl && imageUrl) img.src = imageUrl;
    root.style.setProperty("--pola-dev", "1");
    root.classList.add("is-ejected", "is-snap");
    clearJiggle();

    let fired = false;
    const finish = (e) => {
      if (e && e.animationName !== "pola-lift" && e.animationName !== "pola-fade-in") return;
      if (fired || destroyed) return;
      fired = true;
      clearTimeout(doneTimer);
      frame.removeEventListener("animationend", finish);
      if (onDone) onDone();
    };
    frame.addEventListener("animationend", finish);
    doneTimer = setTimeout(finish, reduceMotion ? 900 : 2200);
  }

  function reset() {
    if (destroyed) return;
    hatched = false;
    clearTimeout(doneTimer);
    root.classList.remove("is-ejected", "is-snap");
    clearJiggle();
    root.style.setProperty("--pola-dev", "0");
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(doneTimer);
    cam.removeEventListener("animationend", clearJiggle);
    root.remove();
  }

  return { setProgress, hatch, reset, wobble, destroy };
}

// ---------- markup (camera = inline SVG; frame/photo = HTML for CSS filters) ----------
function buildHtml(ariaLabel) {
  return `
  <div class="pola-stage" role="img" aria-label="${escAttr(ariaLabel)}">
    <div class="pola-frame">
      <div class="pola-photo">
        <img src="" alt="" draggable="false" />
        <i class="pola-chem"></i>
        <i class="pola-wash"></i>
        <i class="pola-flash"></i>
      </div>
      <div class="pola-chin"></div>
    </div>
    <div class="pola-cam-wrap">
      <svg class="pola-cam" viewBox="0 0 220 120">
        <rect class="pc-body" x="14" y="8" width="192" height="86" rx="20" />
        <rect class="pc-stripe" x="14" y="42" width="192" height="16" />
        <circle class="pc-lens" cx="110" cy="50" r="30" />
        <circle class="pc-lens-in" cx="110" cy="50" r="19" />
        <circle class="pc-lens-glint" cx="103" cy="43" r="5" />
        <rect class="pc-flash" x="160" y="20" width="26" height="14" rx="5" />
        <circle class="pc-button" cx="40" cy="26" r="7" />
        <ellipse class="pc-cheek" cx="48" cy="66" rx="8" ry="5" />
        <ellipse class="pc-cheek" cx="172" cy="66" rx="8" ry="5" />
        <path class="pc-eye" d="M62 60 q 5 -6 10 0" />
        <path class="pc-eye" d="M148 60 q 5 -6 10 0" />
        <rect class="pc-slot" x="46" y="96" width="128" height="9" rx="4.5" />
      </svg>
    </div>
  </div>`;
}

const escAttr = (s) => String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
