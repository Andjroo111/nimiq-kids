// The weeks behind a demo family. What these pin, in order of what would hurt most:
// the trail costs no money, it reaches the one row a visitor always sees, and it is the
// same trail for every visitor.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as stickersRepo from "./repo-stickers";
import * as routines from "./repo-routines";
import { mintDemoFamily, DEMO_KIDS } from "./demo-family";
import * as practicesRepo from "./repo-practices";
import * as approvalsRepo from "./repo-approvals";
import { pastDays, dayShapes, PAST_WEEKS, MAX_LAST_WEEK_GAPS, rowAboveToday } from "./demo-past";
import { mondayOf, weekDays, monthDays } from "./days";

const HOT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";

beforeEach(() => { initTestDb(); });

test("the trail starts on a Monday and stops short of today", () => {
  const days = pastDays("2026-08-03"); // a Monday
  expect(days[0]).toBe("2026-06-29");          // a Monday
  expect(days.at(-1)).toBe("2026-08-02");
  expect(days).not.toContain("2026-08-03");    // today belongs to the paid history
  expect(days.length % 7).toBe(0);             // whole weeks, because today is a Monday

  // Mid-week the trail simply grows: the elapsed part of this week joins it.
  const thursday = pastDays("2026-08-06");
  expect(thursday.at(-1)).toBe("2026-08-05");
  expect(thursday).toHaveLength(days.length + 3);
});

/**
 * THE RULE THAT USED TO BE A NUMBER, and the bug it hid.
 *
 * `PAST_WEEKS = 4` was asserted here as an exact length, which made the test agree with the
 * seeder without either of them being right: four weeks does NOT always reach the previous
 * month, and the comment claiming it did was wrong for eight days of every month. On Monday
 * 2026-08-24 it reached five days of July; on Monday 2026-08-31 it reached ZERO.
 *
 * So the invariant is stated as what a visitor actually gets, on EVERY day of a month, rather
 * than as a week count. This is the assertion that would have caught it, and it is date-driven
 * on purpose: the old suite went red on the real calendar roughly half of every month, which
 * is how a scheduled run on 2026-08-24 failed a commit that had been green two days earlier.
 */
test("the back arrow always reaches a month with real history in it, on every date", () => {
  for (const today of [
    "2026-08-24", "2026-08-25", "2026-08-30", "2026-08-31", // the old dead zone
    "2026-09-01", "2026-09-02", "2026-09-06",               // the start of a month
    "2026-02-01", "2026-02-28", "2026-03-01",               // a short month, either side
    "2027-01-01", "2026-12-31",                             // across a year boundary
  ]) {
    const days = pastDays(today);
    const prevMonth = `${today.slice(0, 4)}-${today.slice(5, 7)}` === today.slice(0, 7)
      ? new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, 0)).toISOString().slice(0, 7)
      : "";
    const inPrev = days.filter((d) => d.startsWith(prevMonth));
    expect(inPrev.length, `${today} -> only ${inPrev.length} days of ${prevMonth}`)
      .toBeGreaterThan(5);
    // Never seeds a day that has not happened.
    expect(days.every((d) => d < today), today).toBe(true);
    // Always starts on a Monday, so the grid's top row is never a part week.
    expect(mondayOf(days[0]!), today).toBe(days[0]!);
  }
});

test("most days, not every day", () => {
  // Andjroo, 2026-08-04: "make it where not every day they got a sticker, but most days."
  // Both halves are the assertion. An unbroken block of four weeks reads as generated, and
  // a run of days only looks like a run if something breaks it; a sparse trail is the bug
  // this whole file exists to fix. So: kept most of the time, never all of the time.
  //
  // Swept over every start date of several months rather than a handful, because a visitor
  // arrives on whichever day they arrive on and the last-week behaviour differs by weekday.
  let sawAFullWeek = false;
  let sawAGap = false;
  for (const kid of ["Sam", "Ava"]) {
    for (let d = 1; d <= 28; d++) {
      for (const month of ["2026-08", "2026-09", "2026-12", "2027-02"]) {
        const today = `${month}-${String(d).padStart(2, "0")}`;
        const byDay = new Map(dayShapes(kid, today).map((s) => [s.day, s.shape]));
        const shapes = [...byDay.values()];
        const kept = shapes.filter((s) => s !== "off").length / shapes.length;
        expect(kept, `${kid} ${today} kept`).toBeGreaterThan(0.6);
        expect(kept, `${kid} ${today} kept`).toBeLessThan(0.95);

        // The row above Today is the only COMPLETE past week the grid shows without paging,
        // so it has to carry the claim on its own: mostly kept, and never bare.
        //
        // ⚠️ Measured over the CALENDAR week, never `shapes.slice(-7)`. This assertion used
        // to take that shortcut and it is what let the bug through: the two windows agree
        // only on a Monday, so the sweep passed on every date while the row a visitor
        // actually reads went unfloored from Wednesday on.
        const gaps = rowAboveToday(today).filter((day) => (byDay.get(day) ?? "off") === "off").length;
        expect(gaps, `${kid} ${today} row above today`).toBeLessThanOrEqual(MAX_LAST_WEEK_GAPS);
        if (gaps === 0) sawAFullWeek = true;
        if (gaps > 0) sawAGap = true;
      }
    }
  }
  // Both have to occur across the sweep. Only-perfect weeks would mean the floor has
  // swallowed the variation; never-perfect would mean the trail cannot look like a good run.
  expect(sawAFullWeek).toBe(true);
  expect(sawAGap).toBe(true);
});

test("the same visitor-facing trail every time", () => {
  // Keyed off the kid's LABEL, so two mints of the same demo agree. A uuid key would
  // give every visitor a differently shaped month and make this unpinnable.
  const a = dayShapes("Sam", "2026-08-03");
  const b = dayShapes("Sam", "2026-08-03");
  expect(a).toEqual(b);
  expect(new Set(a.map((s) => s.shape)).size).toBeGreaterThan(1); // not one shape repeated
  expect(a).not.toEqual(dayShapes("Ava", "2026-08-03")); // and the two kids differ
});

test("a minted family has stickers on most of the week above today", async () => {
  const demo = await mintDemoFamily(HOT);
  const today = routines.localDay(repo.getFamily(demo.familyId)!.tz);
  const rowAbove = weekDays(mondayOf(today)).map((d) => {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, dd! - 7)).toISOString().slice(0, 10);
  });

  for (const kid of demo.children) {
    const placed = stickersRepo.placementsForDays(kid.id, rowAbove);
    const covered = new Set(placed.map((p) => p.day));
    // Most, not all: the gaps are deliberate, and MAX_LAST_WEEK_GAPS is what bounds them.
    expect(covered.size, `${kid.label}`).toBeGreaterThanOrEqual(rowAbove.length - MAX_LAST_WEEK_GAPS);
    for (const day of covered) expect(rowAbove, `${kid.label} ${day}`).toContain(day);
    // Settled history: nothing back there is still waiting on a parent.
    expect(placed.every((p) => p.state === "shined")).toBe(true);
  }
});

test("the trail moves no money at all", async () => {
  // The whole reason it can be this long. `payDemoHistory` is what costs NIM, one
  // transaction per job, and it is deliberately not called here.
  const demo = await mintDemoFamily(HOT);
  for (const kid of demo.children) {
    expect(wrepo.listWalletEvents(kid.id)).toHaveLength(0);
  }
});

test("the trail adds no rows to the parent's board", async () => {
  // THE ONE THAT COST A REWRITE. The trail was built out of one approved chore per past
  // day, and `/api/chores` hands the parent board every job that was never removed: Sam
  // came out with 34 rows, 28 of them seeded history wearing "Again" buttons, and the
  // four real jobs a judge is meant to find were buried under them. A practice is one row
  // whatever its history, which is why the trail is made of practices now.
  const demo = await mintDemoFamily(HOT);
  for (const kid of demo.children) {
    const board = repo.listActiveChores(demo.familyId, kid.id);
    expect(board.length, kid.label).toBe(DEMO_KIDS.find((k) => k.label === kid.label)!.chores.length);
    expect(practicesRepo.listPractices(demo.familyId, kid.id)).toHaveLength(1);
  }
});

test("the trail leaves nothing in the parent's approval queue", async () => {
  // A three-week-old job still waiting on a parent is a household in trouble. Only the
  // two submitted chores the seed puts on the board today may be pending.
  const demo = await mintDemoFamily(HOT);
  const pending = repo.listChores(demo.familyId).filter((c) => c.status === "submitted");
  expect(pending).toHaveLength(demo.children.length);
  expect(approvalsRepo.listApprovals(demo.familyId, "pending")).toHaveLength(demo.children.length);
});

test("past routine runs are finished, so the calendar can call those days done", async () => {
  const demo = await mintDemoFamily(HOT);
  const kid = demo.children[0]!;
  const today = routines.localDay(repo.getFamily(demo.familyId)!.tz);
  const routine = routines.listRoutines(demo.familyId, kid.id)[0]!;

  const runs = pastDays(today)
    .map((d) => routines.findRun(routine.id, d))
    .filter((r): r is NonNullable<typeof r> => !!r);
  expect(runs.length).toBeGreaterThan(0);
  for (const run of runs) {
    expect(run.status).toBe("approved");
    expect(routines.allTasksFinished(run.id)).toBe(true);
  }
});

test("the month a visitor lands on has history in it, and so does the month before", async () => {
  const demo = await mintDemoFamily(HOT);
  const today = routines.localDay(repo.getFamily(demo.familyId)!.tz);
  const kid = demo.children[0]!;

  const thisMonth = today.slice(0, 7);
  const [y, m] = thisMonth.split("-").map(Number);
  const prevMonth = `${m === 1 ? y! - 1 : y}-${String(m === 1 ? 12 : m! - 1).padStart(2, "0")}`;

  // THE TWO MONTHS PROMISE DIFFERENT THINGS, and asking both for the same count is what
  // reddened CI on 2026-09-01 against a demo that was behaving exactly as designed.
  //
  // `pastDays` stops BEFORE today, because today belongs to `payDemoHistory`. So on the 1st
  // of a month the current month contains zero past days and can hold no trail at all, while
  // the previous month is completely filled. A flat "more than 5 in each" is therefore false
  // one day in thirty, and it was the assertion that was wrong, not the seeder.

  // The previous month is the promise `pastDays` can always keep: its start bound is the
  // Monday on or before that month's 1st, so it is filled whatever day a visitor arrives.
  expect(
    stickersRepo.placementsForDays(kid.id, monthDays(prevMonth)).length, prevMonth,
  ).toBeGreaterThan(5);

  // The current month can only ever carry the days that have already happened. What is
  // actually promised there is that a visitor does not land on a run of blank squares, so
  // the test is against the days the trail covers rather than a fixed count. Half, because
  // `dayShapes` deliberately leaves days 'off' — a kid who never misses is not a kid.
  const coveredThisMonth = pastDays(today).filter((d) => d.startsWith(thisMonth));
  const placedThisMonth = stickersRepo.placementsForDays(kid.id, coveredThisMonth);
  expect(placedThisMonth.length * 2, thisMonth).toBeGreaterThanOrEqual(coveredThisMonth.length);
});
