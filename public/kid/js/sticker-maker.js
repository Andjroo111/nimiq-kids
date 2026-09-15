// nimiq.kids — Sticker Maker timer rig (placeholder art). A chunky friendly
// machine MANUFACTURES the kid's sticker while the countdown runs:
//   0-35%  outline self-draws (stroke-dashoffset on the die-cut silhouette)
//   35-75% color/art sweeps in top-down (clip-path inset, like a print head)
//   75-95% foil pass: a gleam sweeps across and a gold ring stamps on
//   95-100% the sticker rolls down toward the out-slot
// A dial on the machine face mirrors overall progress so "how much longer" is
// always readable. hatch() = the finished sticker POPS from the slot (bounce).
//
// ART CONTRACT (future NanoBanana re-skins — no JS edits needed): all colors,
// weights and timings are CSS custom properties on .maker-rig (--maker-*, see
// kid/css/sticker-maker.css). Swap parts by class: .mk-body, .mk-window, .mk-dial.
//
// API (same contract as createEggRig — flow.js swaps rigs by style id):
//   createMakerRig(container, opts) ->
//     { setProgress(p /*0..1*/), hatch({ imageUrl, onDone }), reset(), wobble(), destroy() }
//   opts.stickerUrl / opts.stickerLabel: the pre-picked sticker being made
//   (both empty = the mystery "?" sticker; the normal post-completion picker runs).

const PHASES = { outline: [0, 0.35], fill: [0.35, 0.75], foil: [0.75, 0.95], out: [0.95, 1] };
const sub = (p, [a, b]) => Math.min(1, Math.max(0, (p - a) / (b - a)));

let uidCounter = 0;

export function createMakerRig(container, opts = {}) {
  const uid = `mk${++uidCounter}`;
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const root = document.createElement("div");
  root.className = "maker-rig";
  root.innerHTML = buildSvg(uid, opts.stickerUrl ?? null, opts.stickerLabel ?? null);
  container.appendChild(root);

  const body = root.querySelector(".mk-body-wrap");
  const pop = root.querySelector(".mk-pop");
  let hatched = false;
  let destroyed = false;
  let doneTimer = 0;
  let lastPhase = "";

  const setVar = (name, v) => root.style.setProperty(name, String(v));

  function clearChug() { body.classList.remove("is-chugging"); }
  body.addEventListener("animationend", clearChug);

  function wobble() {
    if (destroyed || hatched || reduceMotion) return;
    clearChug();
    void body.offsetWidth; // restart the keyframe
    body.classList.add("is-chugging");
  }

  function setProgress(p) {
    if (destroyed || hatched) return;
    const clamped = Math.min(1, Math.max(0, Number(p) || 0));
    setVar("--mk-dial", clamped);
    setVar("--mk-outline", sub(clamped, PHASES.outline));
    setVar("--mk-fill", sub(clamped, PHASES.fill));
    setVar("--mk-foil", sub(clamped, PHASES.foil));
    setVar("--mk-out", sub(clamped, PHASES.out));
    // A little chug each time the machine switches jobs.
    const phase = Object.keys(PHASES).findLast((k) => clamped >= PHASES[k][0]) ?? "outline";
    if (phase !== lastPhase && lastPhase) wobble();
    lastPhase = phase;
  }

  function hatch({ imageUrl, onDone } = {}) {
    if (destroyed || hatched) return;
    hatched = true;
    // The pop sticker shows what the machine was making; a caller-supplied
    // imageUrl only fills in when no sticker was pre-picked (egg contract parity).
    if (!opts.stickerUrl && imageUrl) {
      const img = pop.querySelector("image");
      const q = pop.querySelector(".mk-question");
      if (img) img.setAttribute("href", imageUrl);
      if (q) q.remove();
    }
    ["--mk-dial", "--mk-outline", "--mk-fill", "--mk-foil", "--mk-out"].forEach((v) => setVar(v, 1));
    clearChug();
    root.classList.add("is-hatched");

    let fired = false;
    const finish = () => {
      if (fired || destroyed) return;
      fired = true;
      clearTimeout(doneTimer);
      pop.removeEventListener("animationend", finish);
      if (onDone) onDone();
    };
    pop.addEventListener("animationend", finish);
    doneTimer = setTimeout(finish, reduceMotion ? 900 : 2200);
  }

  function reset() {
    if (destroyed) return;
    hatched = false;
    lastPhase = "";
    clearTimeout(doneTimer);
    root.classList.remove("is-hatched");
    clearChug();
    ["--mk-dial", "--mk-outline", "--mk-fill", "--mk-foil", "--mk-out"].forEach((v) => setVar(v, 0));
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(doneTimer);
    body.removeEventListener("animationend", clearChug);
    root.remove();
  }

  return { setProgress, hatch, reset, wobble, destroy };
}

// ---------- SVG construction (placeholder art, all styling via CSS vars) ----------
/** The die-cut face: pre-picked art, a letter sticker, or the mystery "?". */
function stickerFace(uid, url, label, r) {
  if (url) {
    return `<image clip-path="url(#${uid}-die)" x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}"
              preserveAspectRatio="xMidYMid slice" href="${escAttr(url)}" />`;
  }
  const ch = label ? String(label).slice(0, 1) : "?";
  return `<text class="mk-question" x="0" y="4" text-anchor="middle" dominant-baseline="middle">${escText(ch)}</text>`;
}

const escAttr = (s) => String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function buildSvg(uid, stickerUrl, stickerLabel) {
  const R = 38; // die-cut sticker radius (sticker-local coords)
  return `
  <svg class="maker-rig-svg" viewBox="0 0 220 260" role="img" aria-label="Sticker maker">
    <defs>
      <clipPath id="${uid}-die"><circle r="${R}" /></clipPath>
      <clipPath id="${uid}-window"><circle cx="97" cy="120" r="42" /></clipPath>
    </defs>

    <ellipse class="mk-shadow" cx="110" cy="240" rx="72" ry="10" />

    <g class="mk-body-wrap">
      <!-- hopper: where sticker material goes in -->
      <rect class="mk-hopper" x="82" y="32" width="56" height="30" rx="10" />
      <!-- chunky machine body -->
      <rect class="mk-body" x="30" y="52" width="160" height="150" rx="22" />
      <!-- base tray + out-slot -->
      <rect class="mk-base" x="46" y="200" width="128" height="18" rx="9" />
      <rect class="mk-slot" x="72" y="205" width="76" height="8" rx="4" />

      <!-- porthole window: the sticker is made in here -->
      <circle class="mk-window" cx="97" cy="120" r="46" />
      <g clip-path="url(#${uid}-window)">
        <g class="mk-sticker" transform="translate(97 120)">
          <circle class="mk-sticker-base" r="${R}" />
          <g class="mk-sticker-art">
            <circle class="mk-sticker-fill" r="${R}" />
            ${stickerFace(uid, stickerUrl, stickerLabel, R)}
          </g>
          <g class="mk-gleam"><rect x="-14" y="-58" width="20" height="116" transform="rotate(18)" /></g>
          <circle class="mk-foil-ring" r="${R}" />
          <circle class="mk-outline" r="${R}" pathLength="1" />
        </g>
      </g>

      <!-- progress dial on the machine face -->
      <circle class="mk-dial-bg" cx="163" cy="90" r="13" />
      <circle class="mk-dial" cx="163" cy="90" r="13" pathLength="1" transform="rotate(-90 163 90)" />

      <!-- kawaii face (art contract: skins recolor via --maker-face / --maker-cheek) -->
      <ellipse class="mk-cheek" cx="146" cy="176" rx="9" ry="6" />
      <ellipse class="mk-cheek" cx="180" cy="176" rx="9" ry="6" />
      <path class="mk-eye" d="M152 162 q 6 -7 12 0" />
      <path class="mk-eye" d="M172 162 q 6 -7 12 0" />
    </g>

    <!-- the payoff: the finished sticker pops out of the slot, big, in front -->
    <g class="mk-pop" transform="translate(110 186)">
      <g class="mk-pop-inner">
        <circle class="mk-pop-paper" r="${R + 6}" />
        <g class="mk-pop-art">
          <circle class="mk-sticker-fill" r="${R}" />
          ${stickerFace(uid, stickerUrl, stickerLabel, R)}
        </g>
        <circle class="mk-foil-ring is-set" r="${R}" />
      </g>
    </g>
  </svg>`;
}
