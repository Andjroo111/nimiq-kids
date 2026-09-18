// SCROLL THAT WORKS FROM ANYWHERE, AND CHROME THAT IS THE OPPOSITE OF THE SCENE.
//
// Two defects from one walkthrough (Andjroo, 2026-08-27):
//
//   1. "It's like I can only go so far" — a wheel or a swipe starting ON a task card
//      scrolled nothing. .ch-tasks kept `overflow-y: auto; overscroll-behavior: contain`
//      from when it WAS the list, but it now sits inside the .ch-groups scroller at full
//      content height: a scroll container that cannot scroll, with contain on it, eats
//      every gesture that starts inside it instead of chaining up. With the groups open,
//      most of the screen is those cards.
//
//   2. "Some of them can look so light on light" — the bare labels ("Today", "Your games",
//      the minutes left) wore a translucent WHITE pill with 70% ink, on scenes that are
//      mostly light. And only the space id ever got the dark-scene flip: catalog and earned
//      art was never classified at all. The labels now wear the OPPOSITE polarity of the
//      scene, and the scene's lightness is measured from its pixels (luma.js), not from a
//      hand-kept list.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { meanLuma, isDarkLuma, DARK_LUMA } from "../public/kid/js/luma.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const CHART = read("public/kid/css/chart.css");
const SCENE = read("public/kid/css/scene.css");
const GAMES = read("public/kid/css/games.css");
const UTIL = read("public/kid/js/util.js");

const rule = (css: string, sel: string) => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? null;
};
/** The body of the rule that DRESSES a selector, whether it owns the rule or shares it.
 *  Added 2026-09-10, when the three section headings stopped having a rule each. */
const dressing = (css: string, sel: string) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)[^{}]*${esc}[^{}]*\\{([^}]*background:[^}]*)\\}`));
  return m?.[1] ?? null;
};

// ---------- 1. the gesture trap ----------

test(".ch-tasks is not a scroll container — the groups column is the one scroller", () => {
  const tasks = rule(CHART, ".ch-tasks");
  expect(tasks).not.toBeNull();
  // Re-adding either declaration re-arms the trap: overflow makes it a scroll container
  // again, and contain is what stops the gesture chaining to .ch-groups.
  expect(tasks!).not.toMatch(/overflow/);
  expect(tasks!).not.toMatch(/overscroll-behavior/);
  // The scroller it hands the gesture to must still BE one.
  const groups = rule(CHART, ".ch-groups");
  expect(groups).toMatch(/overflow-y:\s*auto/);
});

// ---------- 2. the luminance math ----------

const px = (r: number, g: number, b: number, n = 1) =>
  new Uint8ClampedArray(Array.from({ length: n }, () => [r, g, b, 255]).flat());

test("meanLuma reads white as light, black as dark, and averages honestly", () => {
  expect(meanLuma(px(255, 255, 255))).toBeCloseTo(1, 5);
  expect(meanLuma(px(0, 0, 0))).toBeCloseTo(0, 5);
  // Half white, half black — dead on the threshold's midpoint.
  const half = new Uint8ClampedArray([...px(255, 255, 255), ...px(0, 0, 0)]);
  expect(meanLuma(half)).toBeCloseTo(0.5, 5);
  // Rec. 709: green carries most of the weight, blue the least. A pure-blue scene is DARK.
  expect(meanLuma(px(0, 255, 0))).toBeCloseTo(0.7152, 4);
  expect(isDarkLuma(meanLuma(px(0, 0, 255)))).toBe(true);
  // Empty data must not divide by zero — and an unmeasurable scene defaults LIGHT, which
  // keeps the ink-on-white treatment the app has always had.
  expect(meanLuma(new Uint8ClampedArray(0))).toBe(1);
});

test("the classifier splits at the documented threshold", () => {
  expect(isDarkLuma(DARK_LUMA - 0.01)).toBe(true);
  expect(isDarkLuma(DARK_LUMA)).toBe(false);
});

test("bgFor consults the measurement and the measurement wins over the static list", () => {
  // The wiring the classifier is useless without: art scenes look the cache up, kick off a
  // measure on a miss, and only fall back to DARK_BGS while unmeasured.
  const body = UTIL.slice(UTIL.indexOf("export function bgFor"));
  expect(body).toMatch(/lumaStore\(\)\[id\]/);
  expect(body).toMatch(/measureScene\(id, entry\.url\)/);
  expect(body).toMatch(/mean === undefined \? DARK_BGS\.includes\(id\) : isDarkLuma\(mean\)/);
  // And the module the sw precaches is the one util.js imports.
  expect(UTIL).toMatch(/from "\.\/luma\.js"/);
  expect(read("public/sw.js")).toContain("/kid/js/luma.js");
});

// ---------- 3. the labels ----------
// Andjroo, 2026-08-28: cards and headers are WHITE again — but SOLID white with full ink,
// never the 0.82 wash with 70% ink that vanished into cloud art and started all of this.

// ⚠️ SOLID means the TOKEN now (2026-09-10). It was `rgba(255,255,255,0.92)` written into
// each label's own rule, which is what the 0.82 wash had been corrected to; the heading pass
// took all three onto one rule reading `var(--card)`, which is #ffffff and therefore MORE
// solid, not less. The rule below still fails on a wash, which is what this section is for.
const SOLID_WHITE = /background:\s*(var\(--card\)|rgba\(255,\s*255,\s*255,\s*0\.9)/;

for (const [name, css, sel] of [
  ["Today", SCENE, ".ch-sec-hd"],
  // The app shelf's two labels died with it (#398). The games screen's row headings are
  // the same pill for the same reason: a heading bare on a scene the kid chose is the one
  // thing this app keeps relearning. Since 2026-09-10 all three share ONE rule in scene.css,
  // so this looks up the rule that dresses the selector rather than one it owns alone.
  ["Play / Learn / Make", SCENE, ".games-row-hd"],
  ["the Box's shelves", SCENE, ".bx-shelf-hd"],
] as const) {
  test(`the "${name}" label is a solid white pill with full ink`, () => {
    const base = dressing(css, sel);
    expect(base).not.toBeNull();
    expect(base!).toMatch(SOLID_WHITE);
    expect(base!).toMatch(/color:\s*var\(--ink\)/);
    // The ring is what gives a white pill an edge on white art. It arrives through the
    // elevation rung now, so the chain is what has to hold: the rule takes --lift-1, and
    // --lift-1 ends in --lift-ring, which is the 1px ring.
    expect(base!).toMatch(/box-shadow:\s*var\(--lift-1\)/);
    const kid = read("public/kid/kid.css");
    expect(kid).toMatch(/--lift-1:[^;]*var\(--lift-ring\)/);
    // The ring is the LINE now (the paint set, 2026-09-18), at the alpha it always had.
    expect(kid).toMatch(/--lift-ring:\s*0 0 0 1px rgba\(28, 27, 19/);
  });
}

test("cards are white on every scene: the token holds its :root white, the ring stays", () => {
  // "Keep all white for right now" (Andjroo, 2026-08-28). The token mechanism stays — a future
  // recolor is one override here — so what this locks is that scene.css no longer overrides
  // --card, that :root still says white, and that the scene screens still carry the ring.
  // White by way of the paint set's own white token (2026-09-18), still white.
  expect(read("public/kid/kid.css")).toMatch(/--card:\s*var\(--paint-white\)/);
  expect(read("public/kid/kid.css")).toMatch(/--paint-white:\s*#FFFFFF/i);
  // comments may TALK about the token; only a declaration outside them is the regression
  expect(SCENE.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/--card:/);
  const ring = SCENE.match(/#kid-app\.bg-image[^{]*\{([^}]*)\}/);
  expect(ring).not.toBeNull();
  expect(ring![1]).toMatch(/0 0 0 1px rgba\(28, 27, 19/);
  for (const cls of ["bg-meadow", "bg-ocean", "bg-space", "bg-city"]) {
    expect(ring![0]).toContain(`#kid-app.${cls}`);
  }
});

test("every solid card on a scene reads the token, not a literal white", () => {
  // Representative card from each scene screen: the chart, the calendar, the shelf, the
  // Treasure Box, the money/send/scan screens, the practice thermometer, the games grid.
  // A card added with `background: #fff` on a scene screen is the regression this catches.
  const uses: Array<[string, string]> = [
    ["public/kid/css/chart.css", ".ch-task"],
    ["public/kid/css/chart.css", ".ch-group-hd"],
    ["public/kid/css/chart.css", ".ch-kid"],
    ["public/kid/css/calendar.css", ".k-cal"],
    ["public/kid/css/box.css", ".bx-item"],
    ["public/kid/css/wallet.css", ".k-wallet-card"],
    ["public/kid/css/wallet.css", ".k-feed-card"],
    ["public/kid/css/thermo.css", ".k-th"],
    ["public/kid/kid.css", ".game-tile"],
  ];
  for (const [file, sel] of uses) {
    const body = rule(read(file), sel);
    expect({ file, sel, found: body !== null }).toEqual({ file, sel, found: true });
    expect({ file, sel, token: /background:\s*var\(--card\)/.test(body!) })
      .toEqual({ file, sel, token: true });
  }
});
