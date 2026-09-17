// nimiq.kids kid app: the icon system. ZERO emoji in chrome, and since 2026-09-15 ONE LINE
// WEIGHT: every stroke glyph on every screen renders at `--icon-stroke` (kid/css/icons.css)
// no matter how big its box is, because every path carries `vector-effect: non-scaling-stroke`
// and its stroke-width comes from that one CSS variable rather than from the drawing.
//
// Andjroo, 2026-09-15, looking at both tablets: "some of the icons and stuff it just seems like
// different size ... the calendar one looks undersized ... the controller seems small ... I
// just want to make sure that line thickness is the same, like we need to have a universal
// for our icons ... same thing for the ones on the bottom of the screen." Measured on Leo's
// tablet before this: six sources (PNG masks, wallet SVGs, nimiq duotone, inline SVG, emoji,
// the egg), rendered strokes from 1.5px to 5px, boxes from 11px to 84px.
//
// THE SYSTEM
//   grid     24x24 for everything drawn here; a verbatim Nimiq glyph keeps its own box and is
//            placed inside the 24 with one transform. The ink of a full glyph sits inside 2..22.
//   stroke   `--icon-stroke` px on screen, set ONCE in icons.css. `stroke-width` on a path is
//            the drawing's own value and only matters if the CSS is missing.
//   size     four steps, as font-size on .k-icon (kid/css/icons.css): --ic-s 20, --ic-m 28,
//            --ic-l 36, --ic-xl 56. A screen picks a step, never a number.
//   colour   currentColor. Navy at rest, blue selected, green is the money button only, white
//            on a filled surface, --ink-30 for an empty-state spot.
//   filled   the two SPOT glyphs, the high-five (all done) and the hexagon (no money moves),
//            are filled duotone marks at --ic-xl and --ink-30; they are the one exception to
//            the stroke rule and they look the same as each other on purpose.
//
// TWO SOURCES, IN THIS ORDER (2026-09-15, the icon pack research in docs/NEXT-SESSION.md):
//   1. Nimiq's own glyph, verbatim from nimiq-icons.json, where Nimiq has one: arrow, chevron,
//      check, cross, plus, qr-lines, the hexagon, the high-five, the staking plant. Rule 15 of
//      the nimiq-ui skill. Their strokes render at --icon-stroke like everything else.
//   2. Phosphor (public/js/lib/phosphor.js, MIT) for everything Nimiq lacks: the dock's six,
//      the target, the camera, the lock screen, the Treasure Box tiles. Andjroo, 2026-09-15:
//      "is there an icon pack that would match nimiq-ui? I don't want to be generating these
//      all the time." Phosphor reads closest to Nimiq's own Streamline-drawn hand and has
//      every glyph a kids app needs. Never a third pack, never a hand-drawn glyph.
//
// ⚠️ A Phosphor glyph is a FILLED outline, so --icon-stroke cannot thin or thicken it: its
// weight is a class. `ph(name, "r")` (regular, 16 of 256) for --ic-l and --ic-xl, `ph(name,
// "b")` (bold, 24 of 256) for --ic-s and --ic-m, so the two land at about the same pixels on
// screen as the stroke glyphs do. `maskIcon()` takes the weight for that reason.

import { GLYPHS, DRAWN_GLYPHS, glyphSvg, minuteDialSvg, loadGlyphs } from "/js/lib/box-glyphs.js";
import { ph } from "/js/lib/phosphor.js";
export { GLYPHS, ph };

// ---------- duotone set (fetched once at boot, inlined for currentColor) ----------
const DUOTONE = [
  "paper-plane", "document-text", "gamepad", "high-five", "safe-lock",
  "key-puzzle", "bell", "nimiq-environment", "speedmeter", "sparkling-swap",
];
const cache = new Map();

/** Prefetch all duotone icons (call once at boot; screens render after).
 *  The Treasure Box palette rides along — it is a different, overlapping set
 *  and it has to be warm before the Box paints its first shelf. */
export async function loadIcons() {
  await Promise.all([
    loadGlyphs(),
    ...DUOTONE.map(async (name) => {
      try {
        const res = await fetch(`/vendor/nq/icons/duotone-${name}.svg`);
        if (res.ok) cache.set(name, await res.text());
      } catch { /* offline + uncached: the placeholder renders */ }
    }),
  ]);
}

/** Inline duotone icon (24x24 viewBox, colors via currentColor). A filled SPOT glyph. */
export function icon(name, cls = "") {
  const svg = cache.get(name);
  if (!svg) return `<span class="k-icon ${cls}"></span>`;
  return `<span class="k-icon k-spot ${cls}">${svg}</span>`;
}

// ---------- the line glyphs ----------

const NS = 'xmlns="http://www.w3.org/2000/svg"';
/** A verbatim Nimiq glyph (nimiq-icons.json body on its own w x h grid) centred in the 24. */
const nimiq = (body, w, h, cls = "") => {
  const s = 18 / Math.max(w, h), tx = (24 - w * s) / 2, ty = (24 - h * s) / 2;
  return `<span class="k-icon k-line ${cls}"><svg viewBox="0 0 24 24" ${NS} aria-hidden="true">` +
    `<g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${s.toFixed(4)})">${body}</g></svg></span>`;
};

/** The dock's glyphs, by the names the dock and the screens have always asked for, and the
 *  Phosphor glyph each one is. `week` is the BLANK calendar so calendar.js can put the day in. */
const DOCK = {
  box: "treasure-chest", week: "calendar-blank", games: "game-controller",
  money: "currency-circle-dollar", timer: "hourglass", switch: "arrows-clockwise",
};
/** A dock glyph by name. Kept under the name every screen already calls, so the Treasure Box
 *  header, the Games title and the Timer tile pick it up without moving. weight: "r" at
 *  --ic-l and above (the dock, a title pill, a row glyph), "b" at --ic-s / --ic-m. */
export function maskIcon(name, cls = "", weight = "r") {
  const n = DOCK[name];
  return n ? `<span class="k-icon k-ph ${cls}">${ph(n, weight)}</span>` : `<span class="k-icon ${cls}"></span>`;
}
/** The calendar with the day number in its page: the dock's own drawing, so the month row and
 *  the Calendar button are one calendar. Phosphor's blank calendar keeps its page clear from
 *  y=96 to y=208 of 256, which is where the number sits. */
export function calendarIcon(day, cls = "") {
  const num = day ? `<text x="128" y="186" text-anchor="middle" font-size="92" font-weight="800" fill="currentColor" font-family="Mulish, system-ui, sans-serif" textLength="${day > 9 ? 108 : 56}" lengthAdjust="spacingAndGlyphs">${day}</text>` : "";
  return `<span class="k-icon k-ph ${cls}">${ph("calendar-blank", "r").replace("</svg>", `${num}</svg>`)}</span>`;
}

/** The arrow (verbatim nimiq `arrow-left`, turned). dir: up|down|left|right */
export function arrowIcon(dir = "right", cls = "") {
  const rot = { left: 0, up: 90, right: 180, down: -90 }[dir] ?? 0;
  return `<span class="k-icon k-line k-arrow ${cls}" style="transform:rotate(${rot}deg)"><svg viewBox="0 0 24 24" ${NS} aria-hidden="true">` +
    `<g transform="translate(3 3) scale(1.5)"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" vector-effect="non-scaling-stroke" d="M4.666 10 1 6l3.667-4M2.619 6H11"/></g></svg></span>`;
}
/** The row chevron (verbatim nimiq `chevron-right`). */
export function chevronIcon(cls = "") {
  return nimiq('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" vector-effect="non-scaling-stroke" d="m3.5 1 5 5-5 5"/>', 12, 12, cls);
}
/** The account-list row caret, the same chevron: one arrow shape in the app, not two. */
export function caretIcon() {
  return chevronIcon("caret");
}
/** Check (verbatim nimiq `check`). */
export function checkIcon(cls = "") {
  return nimiq('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" vector-effect="non-scaling-stroke" d="M11.082 1.111 5.022 8.89 1.363 5.687"/>', 12, 10, cls);
}
/** Plain X (verbatim nimiq `cross`). */
export function closeIcon(cls = "") {
  return nimiq('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" vector-effect="non-scaling-stroke" d="m1 1 10 10m0-10L1 11"/>', 12, 12, cls);
}
/** Plus (verbatim nimiq `plus`). Was the filled nq-plus-circle disc; a line now like the rest. */
export function plusIcon(cls = "") {
  return nimiq('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.133" vector-effect="non-scaling-stroke" d="M6.5 1.143V6.5m0 0v5.357m0-5.357h5.357M6.5 6.5H1.143"/>', 13, 13, cls);
}
/** Scan (verbatim nimiq `qr-lines`). Was the wallet's filled ScanQrCode glyph. */
export function scanIcon(cls = "") {
  return nimiq('<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.305" vector-effect="non-scaling-stroke" d="M7.658 12.299h2.32v-4.64M4.76.7H1.28a.58.58 0 00-.58.58v3.48c0 .32.26.58.58.58h3.48c.32 0 .58-.26.58-.58V1.28A.58.58 0 004.76.7m0 6.959H1.28a.58.58 0 00-.58.58v3.479c0 .32.26.58.58.58h3.48c.32 0 .58-.26.58-.58v-3.48a.58.58 0 00-.58-.58M11.719.7h-3.48a.58.58 0 00-.58.58v3.48c0 .32.26.58.58.58h3.48c.32 0 .58-.26.58-.58V1.28a.58.58 0 00-.58-.58M7.66 7.659v2.32m2.318-1.16h2.32m.002 2.321v1.159"/>', 13, 13, cls);
}
/** Search magnifier (Phosphor). */
export function searchIcon(cls = "") {
  return `<span class="k-icon k-ph ${cls}">${ph("magnifying-glass", "r")}</span>`;
}
/** Backspace for the number pads (Phosphor). */
export function deleteIcon(cls = "") {
  return `<span class="k-icon k-ph ${cls}">${ph("backspace", "r")}</span>`;
}
/** Little hourglass (pending / waiting states): the Timer's drawing, bold at the small steps. */
export function waitIcon(cls = "") {
  return maskIcon("timer", cls, "b");
}
/** Play triangle (start buttons), bold at its --ic-m step. */
export function playIcon(cls = "") {
  return `<span class="k-icon k-ph ${cls}">${ph("play", "b")}</span>`;
}
/** The savings target (the thermometer row). */
export function targetIcon(cls = "") {
  return `<span class="k-icon k-ph ${cls}">${ph("target", "r")}</span>`;
}
/** The Nimiq hexagon as a filled SPOT glyph (the money screen's empty feed): money is a
 *  hexagon (nimiq-ui rule 22), drawn like the high-five so the two empty states match. */
export function hexIcon(cls = "") {
  return `<span class="k-icon k-spot ${cls}"><svg viewBox="0 0 24 24" ${NS} aria-hidden="true"><path fill="currentColor" transform="translate(2 3)" d="M19.964 8.156 15.758.844A1.69 1.69 0 0014.299 0H5.887c-.6 0-1.156.32-1.456.844L.225 8.156c-.3.523-.3 1.165 0 1.688l4.206 7.312c.3.523.856.844 1.456.844h8.412c.6 0 1.156-.32 1.456-.844l4.206-7.312a1.69 1.69 0 00.003-1.688z"/></svg></span>`;
}

// ---------- verbatim wallet SVGs (from the nq registry account-header / status-screen) ----------
// Geometry untouched; their strokes render at --icon-stroke like everything else.

/** The wallet staking plant (account-header StakingIcon.vue geometry, recolored to currentColor). */
export function stakingIcon(cls = "") {
  return `<span class="k-icon k-stake-icon ${cls}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140">
    <path opacity=".6" fill="none" stroke="currentColor" stroke-width="3.02" d="M70 22h0a48 48 0 0148 48v0a48 48 0 01-48 48h0a48 48 0 01-48-48v0a48 48 0 0148-48z"/>
    <path opacity=".4" fill="none" stroke="currentColor" stroke-width="3.02" d="M70 12h0a58 58 0 0158 58h0a58 58 0 01-58 58h0a58 58 0 01-58-58h0a58 58 0 0158-58z" />
    <path d="M70.71 69.1v21.56m18.71-26.11c0 12.4-6.31 18.89-18.71 18.89 0-17.56 5.28-18.89 18.71-18.89zM54.18 53.98c0 13.33 4.13 20.07 16.53 20.07 0-13.43-1.03-20.07-16.53-20.07z" fill="none" stroke="currentColor" stroke-width="4.0316" stroke-linecap="round" stroke-linejoin="round"/>
  </svg></span>`;
}

/** The staking plant ALONE (same wallet geometry, no rings) — reads at small sizes
 *  (dock, pills, feed rows) where the ringed version's thin strokes vanish. */
export function plantIcon(cls = "") {
  return `<span class="k-icon k-stake-icon ${cls}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="46 46 48 48">
    <path d="M70.71 69.1v21.56m18.71-26.11c0 12.4-6.31 18.89-18.71 18.89 0-17.56 5.28-18.89 18.71-18.89zM54.18 53.98c0 13.33 4.13 20.07 16.53 20.07 0-13.43-1.03-20.07-16.53-20.07z" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg></span>`;
}

/** The registry close-button's own icon (vendor/nq/close-button), verbatim.
 *  Used inside .close-button, whose CSS runs it at 20% opacity and 40% on
 *  hover -- our closeIcon below is a bare 2px X and renders as a heavy black
 *  cross in that slot, which is not what the wallet's modals show.
 *  Keep the <svg> flush against the <button> tags at the call site: a
 *  whitespace text node inside .close-button adds visible width. */
export function nqCloseIcon() {
  return `<svg class="nq-icon" width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.528 3.52c4.683-4.684 12.275-4.686 16.96-.005 4.678 4.69 4.678 12.28 0 16.97-4.685 4.68-12.277 4.678-16.96-.005-4.682-4.684-4.682-12.276 0-16.96zm13.145 13.133a1 1 0 0 0 .036-1.374l-3.11-3.11a.25.25 0 0 1 0-.352l3.11-3.11a1 1 0 1 0-1.414-1.415l-3.11 3.11a.25.25 0 0 1-.354 0l-3.11-3.11a1 1 0 0 0-1.41 1.415l3.11 3.11a.249.249 0 0 1 0 .353l-3.11 3.109a1 1 0 0 0 0 1.415c.396.38 1.021.38 1.416 0l3.109-3.11a.252.252 0 0 1 .354 0l3.11 3.11a1 1 0 0 0 1.373-.041z" fill="currentColor"/></svg>`;
}


export function goldHexIcon(gid, cls = "") {
  return `<span class="k-icon ${cls}"><svg viewBox="0 0 20 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="none"><path fill="url(#${gid})" d="M19.964 8.156 15.758.844A1.69 1.69 0 0014.299 0H5.887c-.6 0-1.156.32-1.456.844L.225 8.156c-.3.523-.3 1.165 0 1.688l4.206 7.312c.3.523.856.844 1.456.844h8.412c.6 0 1.156-.32 1.456-.844l4.206-7.312a1.69 1.69 0 00.003-1.688"/><defs><radialGradient id="${gid}" cx="0" cy="0" r="1" gradientTransform="matrix(20.1956 0 0 20.2552 15.188 17.766)" gradientUnits="userSpaceOnUse"><stop stop-color="#ec991c"/><stop offset="1" stop-color="#e9b213"/></radialGradient></defs></g></svg></span>`;
}

/* Music note (the "Sounds" option), framed picture (the "Background" option)
 * and the camera (photo proof) are ALSO in the Treasure Box palette, so their
 * artwork lives in /js/lib/box-glyphs.js and these are wrappers. One copy: a
 * second one would drift the moment either app touched it. */
export const musicIcon = (cls = "") => `<span class="k-icon ${cls}">${DRAWN_GLYPHS.music}</span>`;
export const pictureIcon = (cls = "") => `<span class="k-icon ${cls}">${DRAWN_GLYPHS.picture}</span>`;
export const cameraIcon = (cls = "") => `<span class="k-icon ${cls}">${DRAWN_GLYPHS.camera}</span>`;


// ---------- Treasure Box item faces (palette shared with the parent app) ----------

/** An item's face by NAME, so the picture is data rather than a switch on id.
 *  The palette itself lives in /js/lib/box-glyphs.js because the PARENT app
 *  offers the same names when creating a shelf; one list means the parent can
 *  never pick something the kid cannot draw. */
export function glyph(name, cls = "") {
  return `<span class="k-icon ${cls}">${glyphSvg(name)}</span>`;
}

/** Minutes as a dial — see minuteDialSvg(); the wedge is minutes/60 of a turn. */
export function minuteDialIcon(minutes, cls = "") {
  return `<span class="k-icon ${cls}">${minuteDialSvg(minutes)}</span>`;
}


