// "Until bedtime" on the parent's unlock sheet (#377).
//
// The arithmetic that decides how long that row grants. It is the kind of thing that is
// quietly wrong for months: a value that is merely plausible still produces a tablet that
// unlocks and then shuts at the wrong moment, and nobody looks at a number they asked for
// once. So it is tested against fixed instants rather than eyeballed on a sheet.

import { test, expect, mock } from "bun:test";

// views-kid-lock.js reaches core.js (DOM, fetch, the shell) on import. Only the pure
// function below is under test, so the module graph is stubbed rather than stood up.
const state: { allowWindows?: unknown } = {};
mock.module("../public/parent/core.js", () => ({
  state, t: (k: string) => k, call: async () => null, closeSheet() {}, openSheet() {},
  refresh() {}, toast() {}, lang: () => "en", rowTitle: (r: { title?: string }) => r?.title ?? "",
  views: {}, viewEl: () => null, go() {}, render() {}, $: () => null,
}));
mock.module("../public/parent/fmt.js", () => ({ esc: String, timeHM: String, fmtNim: String, LUNA: 1e5 }));
mock.module("../public/parent/icons.js", () => ({ icon: () => "", boxMinutes: () => "", duotone: () => "" }));
mock.module("../public/parent/views-screentime.js", () => ({ loadScreenTime: async () => {} }));
mock.module("../public/parent/views-screens.js", () => ({ screenForKid: () => null, screenSentence: () => ({}) }));
mock.module("../public/parent/grownups.js", () => ({ canManageHousehold: () => true, canManageBoard: () => true }));

const { untilCurfewMins } = await import("../public/parent/views-kid-lock.js");

/** Andjroo's house: Sun-Thu 07:00-20:00, Fri-Sat 07:00-21:00. Mask is Mon..Sun, Mon = 0. */
const CURFEW = [
  { start_hhmm: "07:00", end_hhmm: "20:00", days: "1111001" },
  { start_hhmm: "07:00", end_hhmm: "21:00", days: "0000110" },
];
// Local wall-clock instants. `new Date(y, m, d, h, m)` is the runner's own zone, which is
// the same zone the browser doing this arithmetic would be in — that is the point.
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test("a weekday evening: minutes to the 20:00 close", () => {
  state.allowWindows = CURFEW;
  expect(untilCurfewMins(at(2026, 7, 15, 18, 30))).toBe(90); // Wed 18:30 -> 20:00
});

test("Friday runs an hour later than a weeknight", () => {
  state.allowWindows = CURFEW;
  expect(untilCurfewMins(at(2026, 7, 17, 20, 30))).toBe(30); // Fri 20:30 -> 21:00
});

test("Sunday is a weeknight here, not a weekend", () => {
  state.allowWindows = CURFEW;
  expect(untilCurfewMins(at(2026, 7, 19, 19, 0))).toBe(60); // Sun 19:00 -> 20:00
});

test("outside the hours there is nothing to offer", () => {
  // A row that expires the moment it is tapped is worse than no row.
  state.allowWindows = CURFEW;
  expect(untilCurfewMins(at(2026, 7, 15, 22, 0))).toBeNull(); // Wed 22:00
  expect(untilCurfewMins(at(2026, 7, 15, 6, 0))).toBeNull();  // Wed 06:00
});

test("exactly at the close is not 'until bedtime', it IS bedtime", () => {
  state.allowWindows = CURFEW;
  expect(untilCurfewMins(at(2026, 7, 15, 20, 0))).toBeNull();
});

test("a household with no curfew gets no row at all", () => {
  state.allowWindows = [];
  expect(untilCurfewMins(at(2026, 7, 15, 18, 0))).toBeNull();
  state.allowWindows = undefined;
  expect(untilCurfewMins(at(2026, 7, 15, 18, 0))).toBeNull();
});

test("a window that crosses midnight counts through it", () => {
  state.allowWindows = [{ start_hhmm: "07:00", end_hhmm: "01:00", days: "1111111" }];
  expect(untilCurfewMins(at(2026, 7, 15, 23, 30))).toBe(90); // 23:30 -> 01:00
});

test("with two windows open at once the SOONER close wins", () => {
  // Never the longer grant: the tablet shuts at the first one, and a row promising more
  // would be a promise the machine is about to break.
  state.allowWindows = [
    { start_hhmm: "07:00", end_hhmm: "20:00", days: "1111111" },
    { start_hhmm: "07:00", end_hhmm: "18:00", days: "1111111" },
  ];
  expect(untilCurfewMins(at(2026, 7, 15, 17, 0))).toBe(60);
});
