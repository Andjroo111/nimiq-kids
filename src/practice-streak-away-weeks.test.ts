// A WEEK THE KID WAS NOT HERE MUST NOT BREAK THE STREAK.
//
// Andjroo's two are with their mother half the time — "every other Wednesday, Thursday, Friday
// and Sunday" — so on the off week nobody so much as picks up the tablet. Counting that as a
// week under target reset the streak every fortnight forever: NEITHER CHILD COULD EVER HOLD A
// STREAK LONGER THAN 1, whatever they did, and nothing in the app would have explained why.
//
// He chose to infer the away week rather than declare a custody schedule, because a schedule
// needs upkeep and a stale one silently hides real days. So the rule under test is: a week with
// no trace of this child at all is stepped over — it neither counts nor ends the streak — and
// any trace at all makes the week real again.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as practices from "./repo-practices";
import * as stickersRepo from "./repo-stickers";
import { mondayOf, addDays } from "./days";

let famId = "";
let kidId = "";

// A fixed Monday, so the fortnight arithmetic below is readable rather than relative-to-now.
const TODAY = "2026-08-27";
const week = (n: number) => addDays(mondayOf(TODAY), -7 * n);

beforeEach(() => {
  initTestDb();
  famId = repo.createFamily("Dad", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000").id;
  kidId = repo.createChild(famId, "Mia", "🦄").id;
});

const piano = (target = 2) =>
  practices.createPractice(famId, kidId, "Practice piano", { targetPerWeek: target, emoji: "🎹" });

/** Days of piano in the week `n` weeks back. */
function logWeek(practiceId: string, n: number, offsets: number[]) {
  for (const off of offsets) practices.logSession(practiceId, kidId, addDays(week(n), off));
}

/** The kid picked up the tablet that week but did no piano — a routine run is created the
 *  moment the board is OPENED, which is exactly the signal `activeDays` reads. */
function openedTheBoard(n: number, dayOffset = 0) {
  const r = routines.createRoutine(famId, kidId, "Morning routine", "morning", "🌅");
  routines.addTask(r.id, "Get dressed", 300, {});
  routines.todayRun(r, addDays(week(n), dayOffset));
}

test("the fortnight that could never build a streak, now builds one", () => {
  // Home weeks 1, 3 and 5, met every time. Weeks 2 and 4 they are at their mother's, so there
  // is nothing at all in the app for those. Before this fix the answer was 1.
  const p = piano();
  for (const n of [1, 3, 5]) logWeek(p.id, n, [2, 3]);
  expect(practices.weekStreak(p.id, TODAY, 2, kidId)).toBe(3);
});

test("a week they WERE here and fell short still ends the streak", () => {
  // The rule has to keep its teeth, or it is just "the streak never breaks". Opening the board
  // is what makes a week real, and opening the board is what a kid does.
  const p = piano();
  logWeek(p.id, 1, [2, 3]);   // met
  openedTheBoard(2);          // here, no piano  -> the wall
  logWeek(p.id, 3, [2, 3]);   // met, but on the far side of it
  expect(practices.weekStreak(p.id, TODAY, 2, kidId)).toBe(1);
});

test("one day of piano in a week is a MISS, not an away week", () => {
  // A session is itself a trace, so a week with any piano in it is unambiguously a week they
  // were here. Falling one short of the target has to read as falling short.
  const p = piano();
  logWeek(p.id, 1, [2, 3]);   // met
  logWeek(p.id, 2, [2]);      // here, one of two -> the wall
  logWeek(p.id, 3, [2, 3]);   // met
  expect(practices.weekStreak(p.id, TODAY, 2, kidId)).toBe(1);
});

test("a sticker on its own is enough to make a week real", () => {
  // The THIRD of the three tables activeDays reads, and the only one the other tests here do
  // not reach. A kid who put a sticker on something was in the house.
  const p = piano();
  logWeek(p.id, 1, [2, 3]);
  stickersRepo.ensureStarterGrant(kidId);
  stickersRepo.placeSticker({
    childId: kidId, subjectKind: "chore", subjectId: "a-chore-they-did",
    day: addDays(week(2), 1), stickerId: stickersRepo.ownedStickers(kidId)[0]!.id,
    xPct: 50, yPct: 50, tiltDeg: 0, state: "shined",
  });
  logWeek(p.id, 3, [2, 3]);
  expect(practices.weekStreak(p.id, TODAY, 2, kidId)).toBe(1);
});

test("a kid with no history at all terminates, and answers zero", () => {
  // ⚠️ THE LOOP'S BOUND. Skipping a dead week is precisely what removed the old stopping
  // condition, so without a floor an empty history walks backwards forever. This test is the
  // one that would hang rather than fail.
  const p = piano();
  expect(practices.weekStreak(p.id, TODAY, 2, kidId)).toBe(0);
});

test("the streak stops at the start of history rather than running off the end of it", () => {
  // Same bound, from the other side: three met weeks and nothing before them must answer 3,
  // not loop through every empty week back to the epoch.
  const p = piano();
  for (const n of [1, 2, 3]) logWeek(p.id, n, [2, 3]);
  expect(practices.weekStreak(p.id, TODAY, 2, kidId)).toBe(3);
});
