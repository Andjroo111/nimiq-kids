// WHICH SCREENS SIT ON THE SLAB, and which deliberately do not.
//
// Andjroo, 2026-09-10, the day after the board shipped: "the other screens like box, and money
// didn't get the same treatment." They do now. The five that are the same shape -- floating
// chrome over a stack of cards on the kid's scene -- are all on one surface:
//
//   the board (.k-chart) · Money (.k-home) · Treasure Box (.k-box) · Games · Grow
//
// The three that are NOT on it are decisions, not oversights, and each would look like a bug
// if someone "fixed" it:
//
//   SHEETS (send, receive) are already one card over a scrim. A slab under one card is a
//     second surface saying the same thing.
//   The CAMERA (scan) is a viewfinder. Depth under a hole in the screen is a lie.
//   The EGG TIMER draws its own world on the kid's background, and a panel behind it covers
//     the thing the screen is about.
//
// What this file is really guarding is the pattern: every screen emits its FLOATING CHROME
// outside the slab. Put the back button inside and it stops being the thing on top, which is
// the whole reason --lift-6 is left alone.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** Every screen module that renders a slab, and the chrome that must stay off it. */
const ON_THE_SLAB = [
  { screen: "board", file: "public/kid/js/chart.js", chrome: ['<header class="ch-hd">'] },
  { screen: "money", file: "public/kid/js/money.js", chrome: ['<button class="back-btn" id="money-back">'] },
  { screen: "box", file: "public/kid/js/box.js", chrome: ['<button class="back-btn" id="bx-back">'] },
  // ⚠️ THE GAMES HEADER IS CONTENT, not chrome, since 2026-09-10. It was `position: absolute`
  // on the chrome line (Andjroo, 09-07); it is a page-title pill inside the slab now, the way
  // `.bx-hd` is on the Box ("Games should be in the container like the other"). Only the back
  // button floats.
  { screen: "games", file: "public/kid/js/games.js", chrome: ['<button class="back-btn" id="g-back">'] },
  { screen: "grow", file: "public/kid/js/grow.js", chrome: ['<button class="back-btn" id="grow-back">'] },
  // A goal opens as the climb path (2026-09-13): the same shape, a floating back button over a
  // slab that holds the set strip and the vendored duo-path.
  { screen: "goal", file: "public/kid/js/goal-path.js", chrome: ['<button class="back-btn" id="gp-back">'] },
];

const OFF_THE_SLAB = [
  { screen: "send", file: "public/kid/js/send.js", why: "a sheet over a scrim" },
  { screen: "receive", file: "public/kid/js/receive.js", why: "a sheet over a scrim" },
  { screen: "scan", file: "public/kid/js/scan.js", why: "a viewfinder, not a surface" },
  { screen: "egg timer", file: "public/kid/js/eggtimer.js", why: "draws its own world" },
];

test.each(ON_THE_SLAB)("$screen renders the slab", ({ file }) => {
  expect(read(file)).toContain('class="k-slab');
});

test.each(ON_THE_SLAB)("$screen keeps its floating chrome OFF the slab", ({ file, chrome }) => {
  const src = read(file);
  const slabAt = src.indexOf('<div class="k-slab');
  expect(slabAt).toBeGreaterThan(-1);
  for (const c of chrome) {
    const at = src.indexOf(c);
    expect({ chrome: c, present: at > -1 }).toEqual({ chrome: c, present: true });
    // Emitted BEFORE the slab opens. Inside it, the one element that must read as on top of
    // everything is instead sitting on the surface, at a rung the slab has quieted.
    expect({ chrome: c, aboveSlab: at < slabAt }).toEqual({ chrome: c, aboveSlab: true });
  }
});

test.each(OFF_THE_SLAB)("$screen stays off it: $why", ({ file }) => {
  expect(read(file)).not.toContain("k-slab");
});

test("the games screen's full-bleed wash stepped back for the slab", () => {
  // That wash (rgba(255,255,255,.55) over the whole scene) IS a slab with no edges: it is
  // there because 25 tiles on a bright sky do not read. With a real surface under the rows it
  // only has to be a floor for the dark-scene case, so it drops rather than doubling up.
  const alpha = (css: string, sel: string) =>
    Number(css.match(new RegExp(`${sel}::before\\s*\\{[^}]*rgba\\(255,\\s*255,\\s*255,\\s*([\\d.]+)\\)`))?.[1] ?? NaN);
  const before = alpha(read("public/kid/kid.css"), "\\.games-screen");
  const after = alpha(read("public/kid/css/games.css"), "#kid-app\\.games-screen");
  expect({ before, after, quieter: after < before }).toEqual({ before, after, quieter: true });
});

test("the games slab owns the gap, so the title is not sitting on the first row", () => {
  // Andjroo, 2026-09-10, off the real tablet: "now Games is sitting on Tools." Measured on the
  // page, the title pill's bottom edge and the first row heading's top edge were BOTH at
  // y=184 -- touching exactly. Two white pills stacked left-aligned with no air between them
  // read as one blob, and the screen's own name is the half that gets lost.
  //
  // The gap was on `.games`, which became a wrapper holding the padding, the floating back
  // button and one child, so it applied to nothing. This screen needs more air than the
  // others rather than less: it is the only one whose title sits directly above another pill
  // of the same colour.
  const games = read("public/kid/css/games.css");
  expect(games).toMatch(/\.games-slab\s*\{[^}]*gap:\s*var\(--s5\)/);
  // And the dead one is gone, so nobody moves it back thinking it does something.
  expect(read("public/kid/kid.css")).not.toMatch(/\.games\s*\{[^}]*gap:/);
});
