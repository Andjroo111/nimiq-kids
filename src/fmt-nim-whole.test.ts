// How a reward is printed on a kid's board (public/kid/js/util.js).
//
// The rule is whole coins: rewards are agreed in dollars and paid in NIM, so a kid reads
// "4 317 NIM" rather than "4 317.28 NIM". The rule had one hole in it — anything under
// half a coin rounded to zero, so a real 0.25 NIM job advertised itself as "+0 NIM"
// (issue #30). Three places had already routed around it by editing the DATA rather than
// the formatter, which is the tell that the formatter was the bug.
//
// Pure function, no DOM: imported straight out of the kid app the way egg-timer.test.ts
// imports timer.js.

import { test, expect, mock } from "bun:test";
import { kidIconsMock } from "./kid-icons-mock";

// util.js pulls in icons.js for the sheet close button, and icons.js imports
// `/js/lib/box-glyphs.js` — a browser-absolute path that means nothing to a test runner.
// The shared stub, so the formatter can be exercised for real rather than asserted against
// as source text. It is shared because the last mock.module for a path wins for the whole
// run: see src/kid-icons-mock.ts.
mock.module("../public/kid/js/icons.js", kidIconsMock);

const { fmtNimWhole, LUNA } = await import("../public/kid/js/util.js");

test("a reward of a coin or more still reads as whole coins", () => {
  expect(fmtNimWhole(1 * LUNA)).toBe("1");
  expect(fmtNimWhole(2 * LUNA)).toBe("2");
  // The dollar-priced case the rule exists for: never 4 317.28.
  expect(fmtNimWhole(4_317.28 * LUNA)).toBe("4317");
  // Grouping matches the wallet: a U+202F narrow no-break space, and only once the
  // integer part passes four digits, so a four-figure reward stays unbroken.
  expect(fmtNimWhole(999 * LUNA)).toBe("999");
  expect(fmtNimWhole(2_142 * LUNA)).toBe("2142");
  expect(fmtNimWhole(10_496 * LUNA)).toBe("10 496");
});

test("a sub-coin reward shows what it is worth instead of zero", () => {
  // The seeded "Feed the dog" chore, and the reason this issue exists.
  expect(fmtNimWhole(LUNA / 4)).toBe("0.25");
  expect(fmtNimWhole(LUNA / 2 - 1)).toBe("0.49999");
  expect(fmtNimWhole(LUNA / 10)).toBe("0.1");
  // A single luna is still not nothing. This is the amount Nimiq's fees make
  // worth paying at all, so erasing it erases the point.
  expect(fmtNimWhole(1)).toBe("0.00001");
});

test("no positive reward is ever printed as zero", () => {
  for (const luna of [1, 10, 100, 1_000, 12_345, LUNA / 4, LUNA / 2 - 1]) {
    expect(fmtNimWhole(luna)).not.toBe("0");
  }
});

test("half a coin rounds up rather than down, and zero is still zero", () => {
  expect(fmtNimWhole(LUNA / 2)).toBe("1"); // the boundary belongs to the whole-coin path
  expect(fmtNimWhole(0)).toBe("0");
});

test("a negative sub-coin amount keeps its sign", () => {
  expect(fmtNimWhole(-LUNA / 4)).toBe("-0.25");
  expect(fmtNimWhole(-2 * LUNA)).toBe("-2");
});
