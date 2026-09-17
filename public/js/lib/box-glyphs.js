// The Treasure Box glyph palette, shared by BOTH apps: the kid app draws these
// on the shelf tiles, the parent app offers them when creating a shelf or a
// thing to buy. One list and one set of paths on purpose — a palette the parent
// can pick from but the kid cannot draw is a bug waiting to happen, and it is
// exactly the drift that put five drawing styles in this app to begin with.
//
// SINCE 2026-09-15 THE PALETTE IS PHOSPHOR (public/js/lib/phosphor.js, generated from
// tools/icons/phosphor-list.json). Andjroo: "the parents are gonna need basically to be able to
// pick an icon for their coupons or for other stuff that they wanna give to the kid", and "I
// don't want to be generating these all the time." 133 kid-safe glyphs in nine categories,
// duotone with the shade at Nimiq's 0.4, navy. The eleven names the two apps drew before
// (Nimiq duotones and three app-own drawings) still resolve through ALIAS, so a shelf or a
// coupon a parent already saved keeps its picture and no row moves.

import { PH, PH_CATALOG, ph } from "./phosphor.js";

/** The old names, mapped to the Phosphor glyph that means the same thing. A `payload.icon` or
 *  a `store_categories.icon` written before 2026-09-15 carries one of these; the seeded rows
 *  in src/sticker-catalog.ts still do (dinner, moon, gamepad, ticket). Never remove a key. */
export const ALIAS = {
  dinner: "fork-knife", gamepad: "game-controller", "high-five": "hands-clapping",
  handshake: "handshake", group: "users", globe: "globe", bell: "bell", "nim-phone": "device-mobile",
  medal: "medal", moon: "moon", ticket: "ticket", music: "music-notes", picture: "image", camera: "camera",
};
const resolve = (name) => (PH[name] ? name : ALIAS[name]);

/** What a parent may pick, by category, in order. Names are Phosphor's. */
export const CATALOG = PH_CATALOG;
/** THE palette, flat. Everything in it renders in both apps. */
export const GLYPHS = [...new Set(Object.values(PH_CATALOG).flat())];
/** The three chrome glyphs the kid app's sheets draw (Sounds, Background, the camera tile). */
export const DRAWN_GLYPHS = {
  music: ph("music-notes", "r"), picture: ph("image", "r"), camera: ph("camera", "r"),
};

/** Nothing to fetch any more: the glyphs are in the module. Kept so both apps' boot sequences
 *  keep their one call. */
export async function loadGlyphs() {}

/** Raw <svg> for a glyph name, duotone. "" for a name neither Phosphor nor ALIAS knows, which
 *  is what a caller's placeholder is for. */
export function glyphSvg(name) {
  const n = resolve(name);
  return n ? ph(n, "d") : "";
}

/**
 * Minutes as a face. The three shelf values are Phosphor clocks (quarter past, half past, a
 * full turn); any other number of minutes the shelf might sell is drawn as a dial whose wedge
 * is minutes/60 of a turn, the same duotone, so 45 or 90 minutes get honest art with nothing
 * new drawn.
 */
export function minuteDialSvg(minutes) {
  const m = Number(minutes) || 0;
  const named = { 15: "clock", 30: "clock-afternoon", 60: "clock-countdown" }[m];
  if (named) return ph(named, "d");
  const f = Math.max(0, Math.min(1, m / 60));
  const R = 9.4;
  let wedge = "";
  if (f >= 1) {
    wedge = `<circle cx="12" cy="12" r="${R}" fill="currentColor" fill-opacity="0.4" stroke="none"/>`;
  } else if (f > 0) {
    const th = 2 * Math.PI * f;
    const x = (12 + R * Math.sin(th)).toFixed(2);
    const y = (12 - R * Math.cos(th)).toFixed(2);
    wedge = `<path d="M12 12V${12 - R}A${R} ${R} 0 ${f > 0.5 ? 1 : 0} 1 ${x} ${y}Z" fill="currentColor" fill-opacity="0.4" stroke="none"/>`;
  }
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    ${wedge}<circle cx="12" cy="12" r="${R}"/><path d="M12 2.6v2.4M12 12V2.6"/></svg>`;
}

// ---------------------------------------------------------------- pack art
//
// A sticker's face, and the fan of three that stands for a whole pack.
//
// This lives in the SHARED lib for the same reason the glyph palette does. The
// kid app drew packs as their real stickers while the parent's Treasure Box
// manager drew a generic ticket for the same shelf row, so the two sides of one
// product did not look like one product (#34). The art already shipped; only the
// parent view was not wired to it. Copying four lines of markup across would have
// re-created the drift this file exists to prevent.

import { esc as escAttr } from "./esc.js";
import { isLocalPhotoRef, resolveLocalPhoto } from "./local-photos.js";

/** The face a photo sticker wears on a device that does not hold the photo. */
const AWAY_FACE = `<span class="stk-away" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="6.5" width="18" height="13" rx="3"/><circle cx="12" cy="13" r="3.6"/>
  <path d="M8.5 6.5 9.8 4.2h4.4l1.3 2.3"/></svg></span>`;

/**
 * One sticker's face. The PNG is the art; emoji is a label and a last-resort
 * fallback, and the lettered dot is the last resort's last resort.
 *
 * A photo sticker's `assetUrl` is a `local:<uuid>` handle since #282 — the picture is in this
 * browser's IndexedDB or it is on the other tablet, and only the device that took it can
 * draw it. Everywhere else renders the camera face: the sticker is REAL, it sits on that day
 * of the chart, and the parent's phone simply cannot see the photograph. That is the point,
 * not a loading failure, so it must not read as a broken image.
 *
 * `stk-photo` marks the one kind of face that should be CROPPED to its disc. A photograph
 * has no silhouette and no right edge, so filling the circle is what makes it a sticker.
 * The drawn art is the opposite: each PNG is cut to its own outline at its own aspect
 * (0.68 for the alien, 1.61 for the rainbow), so cropping it to a circle takes the ears
 * off. See the `object-fit` rules in chart.css.
 */
export function stickerFace(s) {
  if (isLocalPhotoRef(s?.assetUrl)) {
    const src = resolveLocalPhoto(s.assetUrl);
    return src
      ? `<img class="stk-photo" src="${escAttr(src)}" alt="${escAttr(s.label ?? "")}" draggable="false" />`
      : AWAY_FACE;
  }
  if (s?.assetUrl) return `<img src="${escAttr(s.assetUrl)}" alt="${escAttr(s.label ?? "")}" draggable="false" />`;
  if (s?.emoji) return `<span class="stk-emoji" role="img" aria-label="${escAttr(s.label ?? "")}">${escAttr(s.emoji)}</span>`;
  return `<span class="stk-fallback">${escAttr(String(s?.label ?? "?").slice(0, 1))}</span>`;
}

/**
 * A pack, as the fanned stack of its own first three stickers. Returns "" when
 * the pack carries no stickers, so a caller can fall back to a glyph rather than
 * render an empty box.
 */
export function packFan(stickers, cls = "") {
  const preview = (stickers ?? []).slice(0, 3);
  if (!preview.length) return "";
  return `<span class="bx-fan ${cls}">${preview.map((s, i) =>
    `<span class="stk stk-flat bx-fan-stk" style="--i:${i}">${stickerFace(s)}</span>`).join("")}</span>`;
}
