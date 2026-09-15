// AN OPEN CALENDAR, AND WHAT IT IS NOT ALLOWED TO DO (#401, #402).
//
// Andjroo, 2026-09-01: "if the calendar is out it kinda cuts everything off. It starts at the
// word Today. You can't really scroll down either. And it's hard to know how to close it
// because there's three arrows."
//
// Both defects are invisible in a screenshot of a SHUT calendar, which is every screenshot
// anyone takes, and both come back the moment someone tidies one line.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const CAL_CSS = read("public/kid/css/calendar.css");
const CHART_CSS = read("public/kid/css/chart.css");
const CAL_JS = read("public/kid/js/calendar.js");

const rule = (css: string, sel: string) => {
  const m = strip(css).match(
    new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  return m?.[1] ?? null;
};

test("an open month is bounded, so it cannot take the whole column", () => {
  // Measured at 800x1280: a 6-week grid is 627px of an 1116px column, and `.ch-today` is the
  // only block in that column that can shrink, so it absorbed the entire shortfall. `.ch-groups`
  // is the app's sole scroller and it was what went to zero — a 0px scroller has nothing to
  // scroll, which is the "you can't scroll down" half of the report.
  const dates = rule(CAL_CSS, ".k-cal.is-open .cal-dates");
  expect(dates).not.toBeNull();
  expect(dates!).toMatch(/max-height:\s*\d+svh/);
  expect(dates!).toMatch(/overflow-y:\s*auto/);
  // ⚠️ `svh`, not `vh`: `.screen` is `position: fixed; inset: 0`, so `vh` hands back the
  // toolbar's height as usable room and puts the last week under the fold.
  expect(dates!).not.toMatch(/max-height:\s*\d+vh/);
});

test("Today asks for its height up front instead of living on the leftovers", () => {
  const today = rule(CHART_CSS, ".ch-today");
  expect(today).not.toBeNull();
  // ⚠️ `min-height: 0` STAYS. It is what lets .ch-groups shrink and scroll at all; replacing it
  // with a pixel floor re-arms the overflow this column is shaped to avoid.
  expect(today!).toMatch(/min-height:\s*0/);
  // The floor is the flex BASIS, so Today is served before the calendar's leftovers rather
  // than out of them, and can still be squeezed below it on a genuinely short screen.
  expect(today!).toMatch(/flex:\s*1 1 \d+svh/);
});

test("the cap bounds the DATES, never the card", () => {
  // Capping `.k-cal` would clip its own padding and the month name with it. The rule this whole
  // file is built on is that nothing above the dates ever moves.
  expect(rule(CAL_CSS, ".k-cal")).not.toMatch(/max-height/);
});

test("every cell still renders: the grid scrolls, it is never truncated", () => {
  // `invariant.ts` asserts an open grid has MORE cells than a shut one, and a kid paging back
  // to a month they filled has to reach the bottom of it. Hiding rows would satisfy the
  // height cap and break the feature.
  const g = CAL_JS.slice(CAL_JS.indexOf("function grid("));
  expect(g.slice(0, g.indexOf("\n}"))).toMatch(/feed\?\.days\?\.length \? feed\.days : monthGrid\(month\)/);
});

test("open, the close control is an X and not a third chevron", () => {
  // All three arrows were the same glyph: one closed the month, two stepped it, and the
  // forward one is disabled on the very first open. So of three identical controls, one did
  // what a kid wanted and one did nothing.
  const inner = CAL_JS.slice(CAL_JS.indexOf("function inner("));
  const body = inner.slice(0, inner.indexOf("\nexport function calendarHtml"));
  expect(body).toMatch(/id="cal-shut"/);
  expect(body).toMatch(/\$\{closeIcon\(\)\}/);
  // ⚠️ Shut, the row is byte-for-byte what it always was: name plus chevron. Shut it has one
  // job, and a chevron is the right glyph for one job.
  // The shut row wears the row chevron (icons.js chevronIcon, verbatim nimiq chevron-right) since
  // the 2026-09-15 icon system; before that it was arrowIcon("right"). Still one glyph, still not an X.
  expect(body).toMatch(/<span class="cal-chev">\$\{chevronIcon\(\)\}<\/span>/);
  // Three ways out, all wired through the one toggle. The X is the one a kid is told about;
  // the header is what they opened it with; a date is where their finger already is.
  expect(CAL_JS).toMatch(/for \(const id of \["cal-hd", "cal-dates", "cal-shut"\]\)/);
});
