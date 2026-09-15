/**
 * The calendar's back arrow stops at the month the kid's history starts.
 *
 * Forward has always stopped at the month Today is in, because a kid cannot have done chores
 * in the future. Back had no bound at all: hold the arrow down and the calendar walks into
 * 2019, one empty grid at a time (Andjroo, 2026-08-04: "the kid could be able to go to years,
 * but not like that ... should just be back and forth months").
 *
 * ⚠️ THE BOUND IS THE FIRST DAY WITH SOMETHING ON IT, NOT THE CHILD'S `created_at`. A demo
 * family is minted today and seeded four weeks of history behind it (src/demo-past.ts), so a
 * created_at bound would grey out the back arrow on exactly the trail the demo exists to show.
 * That is the case this file pins hardest.
 */
import { test, expect, beforeEach } from "bun:test";
import { initTestDb, getDb } from "./db";
import * as stickersRepo from "./repo-stickers";
import * as repo from "./repo";

let famId = "";
let kidId = "";

beforeEach(() => {
  initTestDb();
  famId = repo.createFamily("Dad", "NQ00").id;
  kidId = repo.createChild(famId, "Sam", "🦊").id;
});

const placeOn = (day: string) => {
  const chore = repo.createChore(famId, kidId, "Tidy", 50_000, "🧽");
  getDb().run(
    `INSERT INTO sticker_placements
       (id, child_id, subject_kind, subject_id, day, sticker_id, x_pct, y_pct, tilt_deg, state, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), kidId, "chore", chore.id, day, "stk-star", 50, 50, 0, "shined", Date.now()],
  );
};

test("a child with nothing yet has no earlier month to reach", () => {
  expect(stickersRepo.firstActivityDay(kidId)).toBeNull();
});

test("the bound is the earliest day the calendar can draw, across months", () => {
  placeOn("2026-08-03");
  placeOn("2026-06-14");   // out of order on purpose — MIN, not first-written
  placeOn("2026-07-21");
  expect(stickersRepo.firstActivityDay(kidId)).toBe("2026-06-14");
});

test("history seeded BEHIND a child created today still reaches back", () => {
  // Exactly the demo's shape: the child row is minted now, the trail is in the past.
  placeOn("2026-07-08");
  const first = stickersRepo.firstActivityDay(kidId)!;
  expect(first.slice(0, 7)).toBe("2026-07");
  // A created_at bound would answer with this month and kill the trail.
  const createdMonth = new Date(repo.getChild(kidId)!.created_at).toISOString().slice(0, 7);
  expect(first.slice(0, 7)).not.toBe(createdMonth);
});

test("one child's history does not move another child's bound", () => {
  const other = repo.createChild(famId, "Alex", "🐼").id;
  placeOn("2026-05-02");
  expect(stickersRepo.firstActivityDay(other)).toBeNull();
  expect(stickersRepo.firstActivityDay(kidId)).toBe("2026-05-02");
});
