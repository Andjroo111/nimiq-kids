// The Treasure Box glyph palette, shared by BOTH apps: the kid app draws these
// on the shelf tiles, the parent app offers them when creating a shelf or a
// thing to buy. One list and one set of paths on purpose — a palette the parent
// can pick from but the kid cannot draw is a bug waiting to happen, and it is
// exactly the drift that put five drawing styles in this app to begin with.
//
// Two sources, and which is which is deliberate:
//  · DUOTONE — Nimiq's own vendored set (/vendor/nq/icons/duotone-*.svg),
//    fetched once and inlined so `currentColor` still applies.
//  · DRAWN — app-own, in the wallet's stroke language, ONLY for the things the
//    Nimiq set cannot say. It has no meal, no bedtime and no prize ticket, and
//    its one food icon is a Bitcoin-pizza reference at a 0.6 stroke that
//    dissolves at tile size.

/** Names the vendored Nimiq duotone set covers. */
export const DUOTONE_GLYPHS = [
  "gamepad", "high-five", "medal", "handshake", "group", "globe", "bell", "nim-phone",
];

const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const box24 = (body) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" ${S}>${body}</svg>`;

/** App-own glyphs, raw <svg>. Each app wraps these in its own icon box. */
export const DRAWN_GLYPHS = {
  // Plate between a fork and a knife — "pick what's for dinner".
  dinner: box24(`<circle cx="12" cy="12" r="5.2"/>
    <path d="M2.6 2.8v4.6a1.9 1.9 0 003.8 0V2.8M4.5 2.8v4.6M4.5 9.3V21.2"/>
    <path d="M19.5 21.2V2.8c-1.7 1.3-2.5 3.9-2.5 6.6h2.5"/>`),
  // Crescent and a spark — "stay up late".
  moon: box24(`<path d="M21 14.4A8.9 8.9 0 019.8 3.2a8.7 8.7 0 1011.2 11.2z"/>
    <path d="M5.6 2.6v3.2M4 4.2h3.2"/>`),
  // Torn ticket — the generic "a prize the parent makes real" face.
  ticket: box24(`<path d="M2.8 7.4a1.6 1.6 0 011.6-1.6h15.2a1.6 1.6 0 011.6 1.6v2a2.6 2.6 0 000 5.2v2a1.6 1.6 0 01-1.6 1.6H4.4a1.6 1.6 0 01-1.6-1.6v-2a2.6 2.6 0 000-5.2z"/>
    <path d="M13.8 6.6v1.8M13.8 11.1v1.8M13.8 15.6v1.8"/>`),
  music: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`,
  picture: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.8"/>
    <path d="M3.5 17.5l4.8-4.6a2 2 0 012.7 0l3 2.9 1.6-1.5a2 2 0 012.7 0l2.2 2.1"/></svg>`,
  camera: `<svg viewBox="0 0 18 16" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1.5 5.2A1.7 1.7 0 013.2 3.5h2l1.3-2h5l1.3 2h2a1.7 1.7 0 011.7 1.7v7.6a1.7 1.7 0 01-1.7 1.7H3.2a1.7 1.7 0 01-1.7-1.7z"/>
    <circle cx="9" cy="8.7" r="3"/></svg>`,
};

/** THE palette. Everything in it must render in both apps. */
export const GLYPHS = [...DUOTONE_GLYPHS, ...Object.keys(DRAWN_GLYPHS)];

const cache = new Map();

/** Fetch the duotone half once. Safe to call from either app, and to call twice. */
export async function loadGlyphs() {
  await Promise.all(DUOTONE_GLYPHS.map(async (name) => {
    if (cache.has(name)) return;
    try {
      const res = await fetch(`/vendor/nq/icons/duotone-${name}.svg`);
      if (res.ok) cache.set(name, await res.text());
    } catch { /* offline + uncached: the caller's placeholder renders */ }
  }));
}

/** Raw <svg> for a glyph name — "" until loadGlyphs() has run, for duotones. */
export function glyphSvg(name) {
  return DRAWN_GLYPHS[name] ?? cache.get(name) ?? "";
}

/**
 * Minutes as a DIAL: the wedge is minutes/60 of a turn.
 *
 * The three Screen time tiles all drew one gamepad, so 15, 30 and 60 minutes
 * were the same picture three times. Deriving the face from the datum means the
 * difference IS the difference, and a shelf that later sells 45 or 90 minutes
 * gets correct art with nothing new drawn.
 */
export function minuteDialSvg(minutes) {
  const f = Math.max(0, Math.min(1, (Number(minutes) || 0) / 60));
  const R = 6.6;
  // A full turn has no arc endpoint distinct from its start, so it is a disc.
  let wedge = "";
  if (f >= 1) {
    wedge = `<circle cx="12" cy="12" r="${R}" fill="currentColor" stroke="none"/>`;
  } else if (f > 0) {
    const th = 2 * Math.PI * f;
    const x = (12 + R * Math.sin(th)).toFixed(2);
    const y = (12 - R * Math.cos(th)).toFixed(2);
    wedge = `<path d="M12 12V${12 - R}A${R} ${R} 0 ${f > 0.5 ? 1 : 0} 1 ${x} ${y}Z" fill="currentColor" stroke="none"/>`;
  }
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9.4"/><path d="M12 1.4v1.8"/>${wedge}</svg>`;
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
