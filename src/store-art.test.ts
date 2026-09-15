// EVERY DRAWN TREASURE BOX FACE HAS A FILE BEHIND IT (#404).
//
// Modelled on `title-catalog.test.ts`'s icon gate, and it exists for the same reason: a name in
// a map with no PNG behind it renders a broken image on a kid's tablet and nothing anywhere
// fails. The art is the last thing in this repo to get one of these, and it needed one most —
// `storeArtUrl` returns a path, and a path is a promise about the filesystem.

import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { STORE_ART_SHIPPED, STORE_ART_SLUGS, storeArtPath, storeArtUrl } from "./store-art";
import { OTHER_STORE_ITEMS } from "./sticker-catalog";

const root = (p: string) => new URL(`../${p}`, import.meta.url);

// Three of these gate art that is IN THE TREE, and skip while none ships (2026-09-15,
// store-art.ts). The null-path tests below them are what runs meanwhile, plus one that pins
// the five seeded rows to null rather than to a guessed path.
test.skipIf(!STORE_ART_SHIPPED)("every slug this module can name is a file on disk", () => {
  for (const slug of STORE_ART_SLUGS) {
    const p = storeArtPath(slug);
    expect({ slug, onDisk: existsSync(root(p)) }).toEqual({ slug, onDisk: true });
  }
});

test.skipIf(!STORE_ART_SHIPPED)("the five seeded rows Andjroo asked for all resolve", () => {
  // Named individually, not derived from the map, so that DELETING a mapping fails here rather
  // than passing an emptier version of the first test. These five are the ask
  // (2026-09-01: "fifteen minutes, thirty minutes, sixty minutes, pick what's for dinner,
  // stay up late") and they are the reason the module exists.
  const want = [
    "item-screen-15", "item-screen-30", "item-screen-60",
    "item-coupon-dinner", "item-coupon-stayup",
  ];
  for (const id of want) {
    const seed = (OTHER_STORE_ITEMS as Record<string, { payload: Record<string, unknown> }>)[id];
    expect({ id, seeded: !!seed }).toEqual({ id, seeded: true });
    const kind = id.includes("screen") ? "screen_time" : "coupon";
    const url = storeArtUrl(kind, seed!.payload);
    expect({ id, url: typeof url }).toEqual({ id, url: "string" });
    expect({ id, onDisk: existsSync(root(`public${url}`)) }).toEqual({ id, onDisk: true });
  }
});

test("a face nobody drew returns null, and never a guessed path", () => {
  // A parent-created coupon falls back to the glyph it has always had. Returning
  // `/assets/store/<their-glyph>.png` instead would render a broken image on their own shelf.
  expect(storeArtUrl("coupon", { icon: "ticket" })).toBeNull();
  expect(storeArtUrl("screen_time", { minutes: 45 })).toBeNull();
  expect(storeArtUrl("coupon", {})).toBeNull();
  expect(storeArtUrl("pack", { packId: "pack-space" })).toBeNull();
  expect(storeArtUrl("app", { pkg: "com.mojang.minecraftpe" })).toBeNull();
});

test("the kind decides which key is read", () => {
  // A coupon carrying a stray `minutes` must not pick up a clock, and a screen-time row
  // carrying a stray `icon` must not pick up a dinner plate.
  expect(storeArtUrl("coupon", { minutes: 15 })).toBeNull();
  expect(storeArtUrl("screen_time", { icon: "dinner" })).toBeNull();
});

test.skipIf(STORE_ART_SHIPPED)("while no store art ships, the five seeded rows draw their glyphs", () => {
  for (const id of ["item-screen-15", "item-screen-30", "item-screen-60", "item-coupon-dinner", "item-coupon-stayup"]) {
    const seed = OTHER_STORE_ITEMS[id]!;
    const kind = id.startsWith("item-screen") ? "screen_time" : "coupon";
    expect({ id, url: storeArtUrl(kind, seed.payload) }).toEqual({ id, url: null });
  }
});

test.skipIf(!STORE_ART_SHIPPED)("the art is precached, or an offline tablet draws four tiles and a gap", () => {
  const sw = readFileSync(root("public/sw.js"), "utf8");
  for (const slug of STORE_ART_SLUGS) {
    expect({ slug, precached: sw.includes(`"/assets/store/${slug}.png"`) })
      .toEqual({ slug, precached: true });
  }
});
