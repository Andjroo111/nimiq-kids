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
// The dock's six (chest, calendar, gamepad, money, hourglass, switch) were a generated PNG
// sheet drawn as CSS masks; a raster stroke cannot follow a CSS variable, so they are drawn
// here now, on the grid, tracing the sheet. The Nimiq set has no chest or calendar and its
// gamepad and hourglass are filled duotone, so these six are app-own, like the egg was.
// Where the Nimiq set HAS a stroke glyph (check, cross, plus, chevron, arrow, qr-lines) it is
// copied verbatim from nimiq-icons.json (rule 15 of the nimiq-ui skill): geometry untouched,
// only the stroke it renders at comes from the variable.

import { GLYPHS, DRAWN_GLYPHS, glyphSvg, minuteDialSvg, loadGlyphs } from "/js/lib/box-glyphs.js";
export { GLYPHS };

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
/** One stroke glyph on the 24 grid. `d` is the path data (several subpaths are fine); `extra`
 *  is any filled detail (the gamepad's two buttons, the target's centre). The stroke attributes
 *  are the drawing's own; icons.css overrides stroke-width with the variable. */
const line = (d, cls = "", extra = "", box = "0 0 24 24") =>
  `<span class="k-icon k-line ${cls}"><svg viewBox="${box}" ${NS} aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<path vector-effect="non-scaling-stroke" d="${d}"/>${extra}</svg></span>`;
/** A verbatim Nimiq glyph (nimiq-icons.json body on its own w x h grid) centred in the 24. */
const nimiq = (body, w, h, cls = "") => {
  const s = 18 / Math.max(w, h), tx = (24 - w * s) / 2, ty = (24 - h * s) / 2;
  return `<span class="k-icon k-line ${cls}"><svg viewBox="0 0 24 24" ${NS} aria-hidden="true">` +
    `<g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${s.toFixed(4)})">${body}</g></svg></span>`;
};
const dot = (cx, cy, r = 1.25) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;

/** The dock's glyphs, by the names the dock and the screens have always asked for. Each traces
 *  the retired PNG sheet (git: public/kid/assets/dock/*.png) so nothing on the tablet changed
 *  shape, only weight. */
const DOCK = {
  // the chest: dome lid, box, keyhole
  box: () => line("M3 10.5V10a9 6.5 0 0 1 18 0v.5M3 10.5h18M3 10.5V18a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-7.5",
    "", `<circle cx="12" cy="14.2" r="1.6" vector-effect="non-scaling-stroke"/><path vector-effect="non-scaling-stroke" d="M12 15.8v2.2"/>`),
  // the calendar: the same drawing calendar.js puts the day number into
  week: () => line(CAL_D),
  // the gamepad, the sheet's own outline on the grid
  games: () => line("M8.6 4.3h6.8c4 0 7.4 4.4 7.4 9.2 0 5-3.9 7-5.8 4.6L14.6 15H9.4l-2.4 3.1C5.1 20.5 1.2 18.5 1.2 13.5c0-4.8 3.4-9.2 7.4-9.2zM6.3 9.7h3.6M8.1 7.9v3.6",
    "", dot(14.8, 8.8) + dot(18.2, 12.2)),
  // the coin: a disc and its dollar
  money: () => line("M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM14.6 9.6c0-1.3-1.1-2.1-2.6-2.1s-2.6.8-2.6 2c0 2.6 5.2 1.2 5.2 3.8 0 1.3-1.2 2.1-2.6 2.1s-2.6-.8-2.6-2.1M12 6.3v1.2M12 15.4v1.3"),
  // the hourglass (the Timer)
  timer: () => line("M6.5 3h11M6.5 21h11M8 3v3.4c0 2.6 4 4 4 5.6 0-1.6 4-3 4-5.6V3M8 21v-3.4c0-2.6 4-4 4-5.6 0 1.6 4 3 4 5.6V21"),
  // switch kid: the arrow around the hexagon
  switch: () => line("M17.66 5.26A8.8 8.8 0 1 1 8.99 3.73M5.6 2.5L9 3.7 7.2 6.8",
    "", `<path vector-effect="non-scaling-stroke" transform="translate(8 8.4) scale(0.4)" d="M19.964 8.156 15.758.844A1.69 1.69 0 0014.299 0H5.887c-.6 0-1.156.32-1.456.844L.225 8.156c-.3.523-.3 1.165 0 1.688l4.206 7.312c.3.523.856.844 1.456.844h8.412c.6 0 1.156-.32 1.456-.844l4.206-7.312a1.69 1.69 0 00.003-1.688z"/>`),
};
/** The calendar's path, exported so calendar.js draws the SAME calendar with a day number in it. */
export const CAL_D = "M3.5 6.5A2.5 2.5 0 0 1 6 4h12a2.5 2.5 0 0 1 2.5 2.5v12A2.5 2.5 0 0 1 18 21H6a2.5 2.5 0 0 1-2.5-2.5v-12zM3.5 9.6h17M8 2.5v3.2M16 2.5v3.2";

/** A dock glyph by name. Kept under the name every screen already calls, so the Treasure Box
 *  header, the Games title and the Timer tile pick up the new drawing without moving. */
export function maskIcon(name, cls = "") {
  const draw = DOCK[name];
  return draw ? draw().replace('class="k-icon k-line "', `class="k-icon k-line ${cls}"`) : `<span class="k-icon ${cls}"></span>`;
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
/** Search magnifier, on the grid. */
export function searchIcon(cls = "") {
  return line("M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.3 15.3L20 20", cls);
}
/** Backspace for the number pads: the arrow's own stroke, with the small x inside. */
export function deleteIcon(cls = "") {
  return line("M20.5 5.5H9.6L3 12l6.6 6.5h10.9a1 1 0 0 0 1-1v-11a1 1 0 0 0-1-1zM12 9l6 6M18 9l-6 6", cls);
}
/** Little hourglass (pending / waiting states): the Timer's drawing, one hourglass in the app. */
export function waitIcon(cls = "") {
  return maskIcon("timer", cls);
}
/** Stroke play triangle (start buttons). */
export function playIcon(cls = "") {
  return line("M6 4.6v14.8c0 1.1 1.2 1.8 2.2 1.2l11.6-7.4c.9-.6.9-1.9 0-2.4L8.2 3.4C7.2 2.8 6 3.5 6 4.6z", cls);
}
/** The savings target (the thermometer row): rings and a centre. */
export function targetIcon(cls = "") {
  return line("M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z", cls, dot(12, 12, 1.4));
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


