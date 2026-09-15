// THE CHART, TURNED SIDEWAYS — the four things that have to stay true, and each one is
// something that was actually wrong at some point while it was written.
//
// The defect: every kid stylesheet is written for 800x1280 portrait, so at 1280x800 the four
// stacked blocks kept their portrait size on a screen half as tall and Today's list was left
// 104px of viewport for 616px of cards. Andjroo, 2026-08-27: "when I flip it sideways the task
// gets scrunched ... I can barely scroll and see the tasks."
//
// None of this can be asserted from a stylesheet alone — whether a column really has room is a
// browser question, and tools/kid-drive.mjs is where that is measured. What CAN rot silently in
// CI is the wiring underneath it, and all four of these break the fix into a no-op that still
// renders a perfectly ordinary-looking portrait board:
//
//   1. the sheet is not linked, or is linked before the sheets it overrides
//   2. `.ch-aside { display: contents }` moves BELOW the media query and un-does the grid
//   3. showChart stops emitting .ch-aside, so the grid has one child where it places two
//   4. the media query loses its max-height and starts catching the PORTRAIT tablet, which is
//      800px wide and would take a two-column layout it has no width for

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const INDEX = read("public/kid/index.html");
const SHEET = read("public/kid/css/landscape.css");
const CHART_JS = read("public/kid/js/chart.js");

/** Stylesheet hrefs in document order. */
const linked = [...INDEX.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map((m) => m[1]!);

test("landscape.css is linked, and linked LAST", () => {
  // It overrides chart.css, calendar.css and chrome.css by source order alone — every rule in
  // it is the same specificity as the >=768px rule it is beating. Linked anywhere but last and
  // it silently does nothing on the blocks that matter.
  expect(linked).toContain("/kid/css/landscape.css");
  expect(linked.at(-1)).toBe("/kid/css/landscape.css");
});

test("the portrait fallback is declared BEFORE the media query that overrides it", () => {
  // ⚠️ THE TRAP, and it is invisible: `.ch-aside { display: contents }` and the
  // `.ch-aside { display: flex }` inside the media query are both (0,1,0), so the cascade is
  // settled by source order and nothing else. Written at the foot of the file — the natural
  // place for a fallback — it wins in landscape too and the two columns never appear.
  const fallback = SHEET.indexOf(".ch-aside { display: contents; }");
  const query = SHEET.indexOf("@media");
  expect(fallback).toBeGreaterThan(-1);
  expect(query).toBeGreaterThan(-1);
  expect(fallback).toBeLessThan(query);
});

test("the gate is short AND wide, so a portrait tablet is not caught", () => {
  // The tablet is 800x1280 portrait and 1280x800 landscape. A min-width alone takes both, and
  // the portrait board would be handed a two-column grid on a 800px screen. A phone held
  // sideways (844x390) IS meant to be caught — it has the same problem, worse.
  const gate = SHEET.match(/@media\s*\(min-width:\s*(\d+)px\)\s*and\s*\(max-height:\s*(\d+)px\)/);
  expect(gate).not.toBeNull();
  const [minW, maxH] = [Number(gate![1]), Number(gate![2])];
  const caught = (w: number, h: number) => w >= minW && h <= maxH;
  expect({ view: "tablet landscape 1280x800", caught: caught(1280, 800) }).toEqual({ view: "tablet landscape 1280x800", caught: true });
  expect({ view: "phone landscape 844x390", caught: caught(844, 390) }).toEqual({ view: "phone landscape 844x390", caught: true });
  expect({ view: "tablet portrait 800x1280", caught: caught(800, 1280) }).toEqual({ view: "tablet portrait 800x1280", caught: false });
  expect({ view: "phone portrait 390x844", caught: caught(390, 844) }).toEqual({ view: "phone portrait 390x844", caught: false });
});

test("showChart emits the aside, holding every at-a-glance block", () => {
  // The grid places .ch-aside and .ch-today by name. Without the wrapper the blocks are
  // loose children of a two-column grid and auto-place into rows of their own, which is the
  // stacked layout this file exists to replace — rendered through the landscape rules, so it
  // looks like a bug in the sizing rather than a missing element.
  const aside = CHART_JS.match(/<div class="ch-aside">([\s\S]*?)<\/div>/);
  expect(aside).not.toBeNull();
  // `gamesCard()` was here, then `shelfHtml()` after it, and BOTH are deliberately gone
  // (#398): games is a dock destination now, so the aside is what I have and my week.
  // Nothing on the board names an individual app any more.
  for (const block of ["balanceCard()", "calendarHtml(chart)"]) {
    expect({ block, inAside: aside![1]!.includes(block) }).toEqual({ block, inAside: true });
  }
  expect({ block: "shelfHtml()", inAside: aside![1]!.includes("shelfHtml()") })
    .toEqual({ block: "shelfHtml()", inAside: false });
  // ⚠️ `ch-hd` LEFT THE ASIDE with the slab (2026-09-10) and must not drift back in. The kid
  // pill is chrome that floats OVER the board, aligned to the fixed corner control by
  // .k-chart's own top padding; inside the aside it is inside the slab, riding its top edge
  // and one rung above a surface instead of above the scene.
  expect({ block: "ch-hd", inAside: aside![1]!.includes("ch-hd") })
    .toEqual({ block: "ch-hd", inAside: false });
});

test("the slab wraps both columns, and the header sits above it", () => {
  // THE SHAPE THE GRID NEEDS. .k-chart holds the header, the slab and the fixed dock; the
  // slab holds the two columns. Emit the slab around the wrong pair — or forget it — and the
  // landscape grid below has one child to place in two tracks.
  const slab = CHART_JS.match(/<div class="k-slab ch-slab">([\s\S]*?)<section class="ch-today">/);
  expect(slab).not.toBeNull();
  expect(slab![1]).toContain('<div class="ch-aside">');
  // The header is emitted BEFORE the slab opens, not inside it.
  const hd = CHART_JS.indexOf('<header class="ch-hd">');
  const slabOpen = CHART_JS.indexOf('<div class="k-slab ch-slab">');
  expect(hd).toBeGreaterThan(-1);
  expect(slabOpen).toBeGreaterThan(-1);
  expect({ headerAboveSlab: hd < slabOpen }).toEqual({ headerAboveSlab: true });
});

test("the two-column grid is on the SLAB, not on the screen", () => {
  // ⚠️ The grid used to live on .k-chart, which was the element holding .ch-aside and
  // .ch-today. It holds the SLAB now, so a grid left here places the slab in column one and
  // leaves column two empty — a one-column board that still looks deliberate.
  const block = SHEET.slice(SHEET.indexOf("@media"));
  const chart = block.match(/\.k-chart\s*\{([^}]*)\}/);
  const slab = block.match(/\.ch-slab\s*\{([^}]*)\}/);
  expect(chart).not.toBeNull();
  expect(slab).not.toBeNull();
  expect({ gridOnChart: /display:\s*grid/.test(chart![1]!) }).toEqual({ gridOnChart: false });
  expect(slab![1]).toMatch(/display:\s*grid/);
  expect(slab![1]).toMatch(/grid-template-columns:\s*minmax\(320px, 30%\) minmax\(0, 1fr\)/);
  // Sideways the columns ARE the screen, so the slab has to be given the height its
  // `minmax(0, 1fr)` row divides. In portrait it hugs its content instead (chart.css).
  expect(slab![1]).toMatch(/flex:\s*1\b/);
  expect(slab![1]).toMatch(/min-height:\s*0/);
});

test("Today is the column that gets the height, and it can still scroll inside it", () => {
  // `min-height: 0` on a grid item is the same load-bearing declaration it is on a flex item:
  // without it the track floors at the list's own content height, the screen grows, and the
  // last card goes under the fixed dock instead of the list scrolling.
  const todayRule = SHEET.match(/\.ch-today\s*\{([^}]*)\}/);
  expect(todayRule).not.toBeNull();
  expect(todayRule![1]).toMatch(/grid-column:\s*2/);
  expect(todayRule![1]).toMatch(/min-height:\s*0/);
});

test("the Treasure Box lays two shelf columns, and its tiles fit four to a shelf", () => {
  // Not the chart's defect. Measured at 1280x800 the Box was 1068px of content in an 800px
  // viewport and it SCROLLED correctly — nothing trapped, nothing cut. It was just a tall
  // single column, so a kid deciding what to spend their NIM on saw the header and one shelf.
  //
  // ⚠️ THE TILE FLOOR IS WHAT DECIDES THE HEIGHT, and that is not obvious from either rule.
  // A grid ROW is as tall as its tallest shelf, so one shelf wrapping to a second row of tiles
  // pushes every shelf beside it down. At the >=768px floor of 180px a ~590px column lays 3
  // across, so the fourth sticker pack wrapped and cost ~200px. Dropping the floor took the
  // whole Box from 1068px to 746px — it now fits a landscape screen with nothing to scroll.
  const block = SHEET.slice(SHEET.indexOf("@media"));
  // ⚠️ THE GRID MOVED ONTO THE SLAB (2026-09-10), same as the board's: .k-box holds the slab
  // and the floating back button, so a grid on .k-box would place the SLAB in column one.
  const boxRule = block.match(/\.bx-slab\s*\{([^}]*)\}/);
  expect(boxRule).not.toBeNull();
  expect(boxRule![1]).toMatch(/grid-template-columns:\s*1fr 1fr/);
  expect(block).toMatch(/\.bx-slab\s*>\s*\.bx-hd\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  expect({ gridOnBox: /\.k-box\s*\{[^}]*display:\s*grid/.test(block) }).toEqual({ gridOnBox: false });

  const floor = (css: string) => Number(css.match(/\.bx-row\s*\{[^}]*minmax\((\d+)px/)?.[1] ?? 0);
  const landscapeFloor = floor(block);
  const tabletFloor = floor(read("public/kid/css/box.css").split("@media (min-width: 768px)")[1] ?? "");
  expect(landscapeFloor).toBeGreaterThan(0);
  expect(tabletFloor).toBeGreaterThan(0);
  // The whole point: narrower than the portrait tablet's, or the shelf wraps and the two
  // columns buy nothing.
  expect({ landscapeFloor, tabletFloor, narrower: landscapeFloor < tabletFloor })
    .toEqual({ landscapeFloor, tabletFloor, narrower: true });
});
