// Scene lightness, as arithmetic. Pure on purpose: util.js owns the canvas and
// the cache, this file owns the numbers, and bun can test the numbers without a
// browser. The classification feeds one decision — does the scene get the
// `bg-dark` chrome or the default (light-scene) chrome — so the bare labels can
// always wear the OPPOSITE of what they sit on (Andjroo, 2026-08-27: "if there
// was a lighter background, then the cards would be a darker color. If it was a
// darker background, then the cards would be a lighter color").

/** Below this mean relative luminance a scene counts as dark. 0.5 rather than
 *  anything cleverer: the two chrome treatments are both readable near the
 *  middle, so the threshold only has to keep obviously-light art (clouds,
 *  meadows) out of the light-text treatment and obviously-dark art (space)
 *  out of the dark-text one. */
export const DARK_LUMA = 0.5;

export const isDarkLuma = (mean) => mean < DARK_LUMA;

/** Mean relative luminance (Rec. 709 weights) of an RGBA byte array, 0..1.
 *  Alpha is ignored: scenes are opaque JPEG/PNG art, and a transparent pixel
 *  in a PNG sticker-scene reads against white in practice. */
export function meanLuma(rgba) {
  const px = rgba.length / 4;
  if (!px) return 1;
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    sum += (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
  }
  return sum / px;
}
