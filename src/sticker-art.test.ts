/**
 * THE DISC IS A CIRCLE, SO THE ART HAS TO BE CUT TO A CIRCLE.
 *
 * This is the third time the sticker crop has been chased, and the first two both went
 * looking in CSS. The geometry, measured against a running instance rather than reasoned
 * about: `object-fit: contain` fits a sticker's BOUNDING BOX to the disc's square content
 * box (25.22px at the 34px calendar size), and `border-radius: 50%` then clips to the
 * circle INSCRIBED in that square (measured at 25.25px across — the same circle). A
 * square's corners sit 5.2px outside it, which is where the ears, horns, claws, tails and
 * feet were going: 29 of 30 files lost ink, the unicorn 17.4% of it.
 *
 * No padding can fix that. The overhang is a property of a square meeting a circle, and
 * `padding` shrinks both together. What fixes it is cutting each PNG so its ink fits the
 * circle inscribed in its own canvas — see tools/recut-stickers.py.
 *
 * So the invariant that has to hold for every sticker, for good:
 *
 *     the canvas is SQUARE, and every non-transparent pixel is inside the
 *     circle inscribed in it, with a little margin for antialiasing.
 *
 * A new sticker pack that is drawn to its bounding box will fail here rather than ship
 * looking clipped. Run tools/recut-stickers.py over it and it will pass.
 *
 * ⚠️ This reads the PNGs directly (8-bit RGBA, non-interlaced — all 30 are) rather than
 * asserting on a browser render, because the guard has to run in CI with no browser.
 */
import { test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { STICKER_ART_SHIPPED } from "./sticker-catalog";

const DIR = "public/assets/stickers";
const ALPHA = 16;      // above this counts as ink, matching the re-cut tool
const MARGIN = 0.99;   // ink must sit inside 99% of the inscribed radius

/** The alpha plane of an 8-bit RGBA, non-interlaced PNG. Enough of the format to hold a
 *  guard honest; anything else in the folder should fail loudly rather than be skipped. */
function alphaPlane(buf: Buffer): { w: number; h: number; a: Uint8Array } {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const depth = buf[24], color = buf[25], interlace = buf[28];
  if (depth !== 8 || color !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG (depth ${depth}, colour ${color}, interlace ${interlace})`);
  }
  const idat: Buffer[] = [];
  for (let p = 8; p + 8 <= buf.length;) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    if (type === "IDAT") idat.push(buf.subarray(p + 8, p + 8 + len));
    if (type === "IEND") break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = new Uint8Array(w * h);
  const prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0, o = 0; y < h; y++) {
    const filter = raw[o++];
    for (let i = 0; i < stride; i++) {
      const x = raw[o + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p0 = a + b - c, pa = Math.abs(p0 - a), pb = Math.abs(p0 - b), pc = Math.abs(p0 - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`bad PNG filter ${filter}`);
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) out[y * w + x] = cur[x * bpp + 3];
    prev.set(cur);
    o += stride;
  }
  return { w, h, a: out };
}

/** How far the furthest ink pixel sits from the canvas centre, as a share of the
 *  inscribed circle's radius. 1.0 means it is exactly on the circle; over 1.0 means the
 *  disc will clip it. */
function inkReach(w: number, h: number, a: Uint8Array): number {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2;
  let worst = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a[y * w + x] <= ALPHA) continue;
      // +0.5 to measure from the pixel's centre, and only the outermost matters.
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > worst) worst = d;
    }
  }
  return worst / r;
}

// The whole file is a gate on art that is IN THE TREE. While none ships (2026-09-15, the art
// repass; sticker-catalog.ts) the directory is gone and there is nothing to measure, so the
// three checks skip rather than fail. Flipping STICKER_ART_SHIPPED brings them back as-is.
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".png")).sort() : [];

test("the flag and the tree agree about whether sticker art ships", () => {
  expect(files.length > 0).toBe(STICKER_ART_SHIPPED);
});

test.skipIf(!STICKER_ART_SHIPPED)("there are stickers to check", () => {
  expect(files.length).toBeGreaterThanOrEqual(30);
});

test.skipIf(!STICKER_ART_SHIPPED)("every sticker canvas is square, so `contain` cannot letterbox it off-circle", () => {
  const oblong: string[] = [];
  for (const f of files) {
    const buf = readFileSync(join(DIR, f));
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    if (w !== h) oblong.push(`${f} ${w}x${h}`);
  }
  expect(oblong).toEqual([]);
});

test.skipIf(!STICKER_ART_SHIPPED)("no sticker's ink reaches outside the circle the disc clips it to", () => {
  const over: string[] = [];
  for (const f of files) {
    const { w, h, a } = alphaPlane(readFileSync(join(DIR, f)));
    const reach = inkReach(w, h, a);
    if (reach > MARGIN) over.push(`${f} reaches ${(reach * 100).toFixed(1)}% of the radius`);
  }
  // A failure here is not a CSS bug. Re-cut the art:
  //   python3 tools/recut-stickers.py public/assets/stickers public/assets/stickers
  expect(over).toEqual([]);
});
