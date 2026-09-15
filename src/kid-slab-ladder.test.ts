// THE SLAB, AND WHAT IT DOES TO THE ELEVATION LADDER (Andjroo, 2026-09-10).
//
// The complaint that started it, off a photo of the real tablet: the contact layer of the
// #467 ladder (7px down, 5px of blur) reads as a hard LINE drawn under each card, with
// nothing holding it up. "I kind of like the hard lines, but ... it would be kind of nice if
// we had another shadow container underneath everything, so that way the outlines were very
// clear." Four treatments were rendered side by side at true tablet size; he picked the slab.
//
// So the board's weight moved off nine cards and onto one surface. Everything below is a way
// that move can silently un-do itself while the board still renders perfectly:
//
//   1. the slab stops overriding the rungs, and nine cards go back to claiming 28px of height
//      each ON a surface that is already claiming 48 — the muddiest of the four treatments
//   2. it starts overriding --lift-6 too, and the kid pill stops reading as above the board
//   3. an override gets LOUDER than the :root rung it replaces, which is the same defect as 1
//   4. the in-slab rungs stop being a ladder, so the money card no longer sits above the
//      calendar and the board is flat again, just quietly
//   5. the slab is given `flex: 1` in portrait, stretches to the screen, and paints over the
//      scene art the whole app is built around (this one is VISIBLE and was caught in review;
//      it is here so it is caught by CI next time)

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const KID = read("public/kid/kid.css");
const SCENE = read("public/kid/css/scene.css");
const CHART = read("public/kid/css/chart.css");

/** The `.k-slab { ... }` body in scene.css, where the paint and the overrides live. */
const slabBlock = SCENE.match(/\.k-slab\s*\{([^}]*)\}/)?.[1] ?? "";
/** One `--lift-N:` declaration, from whichever block is passed. */
const lift = (css: string, n: number) => css.match(new RegExp(`--lift-${n}:([^;]*);`))?.[1]?.trim() ?? null;
/** The widest blur radius in a shadow list: how far the card's weight spreads. */
const widestBlur = (shadow: string) =>
  Math.max(...[...shadow.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])).filter((n) => n > 0), 0);

const RUNGS = [5, 4, 3, 1];

test("the slab overrides the board's rungs, and only inside itself", () => {
  expect(slabBlock).not.toBe("");
  for (const n of RUNGS) {
    expect({ rung: n, overridden: lift(slabBlock, n) !== null }).toEqual({ rung: n, overridden: true });
    // The :root ladder still has to exist: the money screen, the Treasure Box and the games
    // shelf are not in a slab and read it directly.
    expect({ rung: n, atRoot: lift(KID, n) !== null }).toEqual({ rung: n, atRoot: true });
  }
});

test("--lift-6 is NOT overridden: the kid pill floats over the slab", () => {
  // Rung 6 is the floating chrome — the name pill and the battery. The pill is emitted
  // outside the slab and has to stay louder than everything on it, or the one element that is
  // always on top reads as level with the surface it is over.
  expect({ six: lift(slabBlock, 6) }).toEqual({ six: null });
  expect(lift(KID, 6)).not.toBeNull();
});

test("every in-slab rung is QUIETER than the one it replaces", () => {
  // The slab carries the height now. A card that still spreads 55px of blur on top of it is
  // the "too much of everything" version of this treatment, and it is what the board looked
  // like before the slab existed.
  for (const n of RUNGS) {
    const root = widestBlur(lift(KID, n)!);
    const slab = widestBlur(lift(slabBlock, n)!);
    expect({ rung: n, root, slab, quieter: slab < root }).toEqual({ rung: n, root, slab, quieter: true });
  }
});

test("the in-slab rungs are still a LADDER", () => {
  // Rung by what a card IS: the money card is the hero, a job in a tray sits lowest. Quieting
  // them all to the same value is flat, which is the thing #467 set out to fix.
  const blurs = RUNGS.map((n) => widestBlur(lift(slabBlock, n)!));
  const descending = blurs.every((b, i) => i === 0 || b < blurs[i - 1]!);
  expect({ blurs, descending }).toEqual({ blurs, descending: true });
});

test("the slab is a surface: translucent, and it carries the one big shadow", () => {
  expect(slabBlock).toMatch(/background:\s*rgba\(255,\s*255,\s*255/);
  expect(slabBlock).toMatch(/box-shadow:/);
  // Bigger than anything on it, or the cards are lifting the thing that is supposed to be
  // lifting them.
  const slabShadow = slabBlock.match(/box-shadow:([^;]*);/)![1]!;
  const heaviest = Math.max(...RUNGS.map((n) => widestBlur(lift(slabBlock, n)!)));
  expect({ slab: widestBlur(slabShadow), heaviestCard: heaviest, slabIsBiggest: widestBlur(slabShadow) > heaviest })
    .toEqual({ slab: widestBlur(slabShadow), heaviestCard: heaviest, slabIsBiggest: true });
});

test("every child of the slab asks for its CONTENT, or the hug slices the screen", () => {
  // ⚠️ THE PAIR TO THE HUG, and the least obvious line in the sheet. A slab that hugs is only
  // as tall as what its children ASK for, and every child was written for a parent that
  // filled the screen: `.k-feed-card` is `flex: 1` (basis 0, asks for nothing) and
  // `.ch-today` is `flex: 1 1 30svh` (asks for 384px against 645px of cards). Left alone the
  // money screen hugged to an empty feed and the board sliced the third job in half at the
  // slab's own bottom edge, with the lower half of the screen empty.
  expect(SCENE).toMatch(/\.k-slab\s*>\s*\*\s*\{[^}]*flex-basis:\s*auto/);
  // The rules it is compensating for are untouched: they are still right for a column that
  // IS the screen, which is what landscape gives them.
  expect(CHART).toMatch(/\.ch-today\s*\{[^}]*flex:\s*1 1 30svh/);
  expect(read("public/kid/css/wallet.css")).toMatch(/\.k-feed-card\s*\{[^}]*flex:\s*1;/);
});

test("in portrait the slab HUGS its content, so the scene still reads", () => {
  // ⚠️ `flex: 1` here stretches the slab to the full screen and washes the artwork out under
  // a white panel — the board stops sitting IN a world and starts sitting on a sheet of
  // paper. The landscape sheet deliberately overrides this back to `flex: 1`, where the two
  // columns are the screen; that override is asserted in kid-landscape.test.ts.
  expect(slabBlock).toMatch(/flex:\s*0 1 auto/);
  // The other half: a board with enough jobs to overflow still has to give, and the give has
  // to land in .ch-groups as a scroll rather than growing the screen past the dock.
  expect(slabBlock).toMatch(/min-height:\s*0/);
  // It runs the column each screen's root used to run. The GAP is not here: it is the
  // screen's own, so the board keeps var(--s5) and the Box keeps 12px, each next to that
  // screen's other spacing.
  expect(slabBlock).toMatch(/flex-direction:\s*column/);
  expect(CHART).toMatch(/\.ch-slab\s*\{\s*gap:\s*var\(--s5\)/);
});
