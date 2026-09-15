// THE ONE LIMIT WE ACCEPT (public/kid/js/snapshot.js `isStaleDay`).
//
// Routine task runs are created server-side, lazily, by the chart read itself:
// src/routes/stickers.ts calls `todayRun(routine, today)` while building the week. A tablet
// that never reaches the server across midnight therefore has no runs for the new day and
// nothing to tick. Andjroo's call, 2026-09-11: say so on the board rather than pre-fetch days
// of runs, because creating runs ahead of time changes WHEN a run exists for the lock
// machine, `reconcileRun` and the parent's approval queue.
//
// Chores, lessons, practices and goals are not per-day and are unaffected, which is most of
// what the live family board actually carries.
import { test, expect } from "bun:test";
import { isStaleDay } from "../public/kid/js/snapshot.js";

const at = (iso: string) => new Date(`${iso}T09:00:00`);

test("a board read today is not stale", () => {
  expect(isStaleDay("2026-09-11", at("2026-09-11"))).toBe(false);
});

test("a board read yesterday is", () => {
  expect(isStaleDay("2026-09-10", at("2026-09-11"))).toBe(true);
});

test("single-digit months and days compare correctly", () => {
  // A naive `toISOString()` here would also shift the day by the timezone offset, which in
  // America/Chicago means the board reads as stale for the first six hours of every day.
  expect(isStaleDay("2026-01-05", at("2026-01-05"))).toBe(false);
  expect(isStaleDay("2026-01-05", at("2026-01-06"))).toBe(true);
});

test("a board with no day at all is not called stale", () => {
  // An older snapshot, or a payload from before `today` existed. Silence beats a wrong claim.
  expect(isStaleDay(undefined)).toBe(false);
  expect(isStaleDay("")).toBe(false);
});
