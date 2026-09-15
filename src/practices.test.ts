// Practices: weekly-target habits (piano, a workout) and their sessions.
// The interesting behaviour is all in the counting — a session is unique per DAY,
// and the streak is counted in WEEKS so rest days never break it.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as practices from "./repo-practices";
import * as stickersRepo from "./repo-stickers";
import { hashPin } from "./auth";
import { practicesRoutes } from "./routes/practices";
import { stickersRoutes } from "./routes/stickers";
import { mondayOf, addDays } from "./days";

const app = new Hono().route("/api", practicesRoutes).route("/api", stickersRoutes);
const get = (p: string) => app.request(p);
const post = (p: string, body: Record<string, unknown> = {}) =>
  app.request(p, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const put = (p: string, body: Record<string, unknown> = {}) =>
  app.request(p, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

let fam: repo.Family;
let kid: repo.Child;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
});

const today = () => routines.localDay(fam.tz);
/** Log `offsets` (day numbers within the week) for the week `weeksAgo` back. */
function logWeek(practiceId: string, weeksAgo: number, offsets: number[]) {
  const weekStart = addDays(mondayOf(today()), -7 * weeksAgo);
  for (const off of offsets) practices.logSession(practiceId, kid.id, addDays(weekStart, off));
}

// ---- sessions ----
test("a session is unique per day: twice on the same day is still one", () => {
  const p = practices.createPractice(fam.id, kid.id, "Piano", { targetPerWeek: 4 });
  const first = practices.logSession(p.id, kid.id, today());
  const second = practices.logSession(p.id, kid.id, today());
  expect(second.id).toBe(first.id);
  expect(practices.weekCount(p.id, mondayOf(today()))).toBe(1);
});

test("logging keeps the longest sitting, never a shorter overwrite", () => {
  const p = practices.createPractice(fam.id, kid.id, "Piano");
  practices.logSession(p.id, kid.id, today(), 600);
  practices.logSession(p.id, kid.id, today(), 200); // a shorter second sitting
  expect(practices.getSession(p.id, today())!.seconds).toBe(600);
  practices.logSession(p.id, kid.id, today(), 900);
  expect(practices.getSession(p.id, today())!.seconds).toBe(900);
});

// ---- the weekly streak ----
test("streak counts WEEKS that met target, so rest days never break it", () => {
  const p = practices.createPractice(fam.id, kid.id, "Piano", { targetPerWeek: 3 });
  // Three whole weeks met, each with four rest days in them.
  logWeek(p.id, 3, [0, 2, 4]);
  logWeek(p.id, 2, [1, 3, 5]);
  logWeek(p.id, 1, [0, 3, 6]);
  expect(practices.weekStreak(p.id, today(), 3, kid.id)).toBe(3);
});

test("a week in progress does not break the streak, and extends it once met", () => {
  const p = practices.createPractice(fam.id, kid.id, "Piano", { targetPerWeek: 2 });
  logWeek(p.id, 2, [0, 1]);
  logWeek(p.id, 1, [0, 1]);
  // Nothing yet this week: the streak a kid earned still stands.
  expect(practices.weekStreak(p.id, today(), 2, kid.id)).toBe(2);
  // One of two: still in progress, still standing, still not counted.
  logWeek(p.id, 0, [0]);
  expect(practices.weekStreak(p.id, today(), 2, kid.id)).toBe(2);
  // Target met: this week now counts.
  logWeek(p.id, 0, [1]);
  expect(practices.weekStreak(p.id, today(), 2, kid.id)).toBe(3);
});

test("a missed week ends the streak at the weeks since", () => {
  const p = practices.createPractice(fam.id, kid.id, "Workout", { targetPerWeek: 3 });
  logWeek(p.id, 4, [0, 1, 2]); // met
  logWeek(p.id, 3, [0]);       // MISSED — the wall
  logWeek(p.id, 2, [0, 1, 2]); // met
  logWeek(p.id, 1, [0, 1, 2]); // met
  expect(practices.weekStreak(p.id, today(), 3, kid.id)).toBe(2);
});

test("no history is a zero streak, not a crash", () => {
  const p = practices.createPractice(fam.id, kid.id, "Reading", { targetPerWeek: 5 });
  expect(practices.weekStreak(p.id, today(), 5, kid.id)).toBe(0);
  expect(practices.practiceView(p, today()).weekDone).toBe(0);
});

// ---- routes ----
test("create + list: target is validated and clamped to a real week", async () => {
  const res = await post("/api/practices", {
    childId: kid.id, title: "Piano", emoji: "🎹", targetPerWeek: 4, durationS: 1200,
  });
  expect(res.status).toBe(201);
  expect((await res.json()).practice.targetPerWeek).toBe(4);

  for (const bad of [0, 8, -1, "lots"]) {
    const r = await post("/api/practices", { childId: kid.id, title: "X", targetPerWeek: bad });
    expect(r.status).toBe(400);
  }
  expect((await post("/api/practices", { childId: kid.id, title: "" })).status).toBe(400);
  expect((await post("/api/practices", { childId: "nope", title: "X" })).status).toBe(404);

  const list = await (await get(`/api/practices?childId=${kid.id}`)).json();
  expect(list.practices.length).toBe(1);
  expect(list.practices[0].title).toBe("Piano");
});

test("practices are PER KID: one child's never show on another", async () => {
  const other = repo.createChild(fam.id, "Kid 2", "🐙");
  practices.createPractice(fam.id, kid.id, "Piano", { targetPerWeek: 4 });
  practices.createPractice(fam.id, other.id, "Piano", { targetPerWeek: 2 });

  const mine = await (await get(`/api/practices?childId=${kid.id}`)).json();
  const theirs = await (await get(`/api/practices?childId=${other.id}`)).json();
  expect(mine.practices.length).toBe(1);
  expect(theirs.practices.length).toBe(1);
  // Same practice, different targets — that is the point of per-kid.
  expect(mine.practices[0].targetPerWeek).toBe(4);
  expect(theirs.practices[0].targetPerWeek).toBe(2);
});

test("POST session is idempotent per day and reports the week back", async () => {
  const p = practices.createPractice(fam.id, kid.id, "Piano", { targetPerWeek: 3 });
  const first = await (await post(`/api/practices/${p.id}/session`)).json();
  expect(first.practice.weekDone).toBe(1);
  expect(first.practice.doneToday).toBe(true);

  const second = await (await post(`/api/practices/${p.id}/session`)).json();
  expect(second.session.id).toBe(first.session.id);
  expect(second.practice.weekDone).toBe(1); // still one day, not two
  expect((await post("/api/practices/nope/session")).status).toBe(404);
});

test("edit changes the target without touching the history", async () => {
  const p = practices.createPractice(fam.id, kid.id, "Piano", { targetPerWeek: 4 });
  logWeek(p.id, 0, [0, 1]);
  const res = await put(`/api/practices/${p.id}`, { targetPerWeek: 2, title: "Piano practice" });
  expect(res.status).toBe(200);
  const view = (await res.json()).practice;
  expect(view.targetPerWeek).toBe(2);
  expect(view.title).toBe("Piano practice");
  expect(view.weekDone).toBe(2); // the days already logged still count
  expect((await put(`/api/practices/${p.id}`, { targetPerWeek: 9 })).status).toBe(400);
});

// ---- the chart + calendar ----
test("chart feed carries practices, and their days land on the calendar", async () => {
  const p = practices.createPractice(fam.id, kid.id, "Piano", { targetPerWeek: 3 });
  logWeek(p.id, 0, [0, 1]);

  const chart = await (await get(`/api/kids/${kid.id}/chart`)).json();
  const view = chart.practices.find((x: { title: string }) => x.title === "Piano");
  expect(view.weekDone).toBe(2);
  expect(view.targetPerWeek).toBe(3);

  // The row is SPARSE: a cell only for days it actually happened, because a rest
  // day owes nothing and must not drag that day's completeness down.
  const row = chart.rows.find((r: { kind: string }) => r.kind === "practice");
  expect(row.cells.length).toBe(2);
  expect(row.cells.every((c: { done: number; total: number }) => c.done === 1 && c.total === 1)).toBe(true);

  const monthRow = (await (await get(`/api/kids/${kid.id}/month`)).json())
    .rows.find((r: { kind: string }) => r.kind === "practice");
  expect(monthRow.cells.length).toBe(2);
});

test("a practice session wears its own sticker, one per day", async () => {
  // ⚠️ TWO DAYS OF ONE WEEK, ANCHORED — NOT "yesterday and today".
  // This read `addDays(today(), -1)` and `today()`, and the chart renders exactly one
  // week: `weekDays(mondayOf(anchor))` in routes/stickers.ts. So on a MONDAY, "yesterday"
  // is Sunday, which belongs to the previous week, and only one of the two sessions was
  // ever in the response — one sticker id where the test wants two.
  // It therefore failed every Monday and passed the other six days, which is the worst
  // shape a test can have: it reads as a real regression in whatever landed that morning.
  // The subject here is "two sessions, two stickers"; which week they fall in is
  // incidental, so both are pinned inside one known week and the chart is asked for it
  // by `?week=`. Nothing about this test depends on the day it is run now.
  const p = practices.createPractice(fam.id, kid.id, "Piano", { targetPerWeek: 3 });
  const week = mondayOf(addDays(today(), -14));   // a settled week, never the future
  const day1 = practices.logSession(p.id, kid.id, week);
  const day2 = practices.logSession(p.id, kid.id, addDays(week, 1));
  stickersRepo.ensureStarterGrant(kid.id); // the kid's collection, normally granted on first chart read
  const [a, b] = stickersRepo.ownedStickers(kid.id);

  expect((await post(`/api/practice-sessions/${day1.id}/sticker`, { stickerId: a!.id })).status).toBe(200);
  expect((await post(`/api/practice-sessions/${day2.id}/sticker`, { stickerId: b!.id })).status).toBe(200);
  expect((await post(`/api/practice-sessions/nope/sticker`, { stickerId: a!.id })).status).toBe(404);

  // Two days of the same practice, two different stickers — the subject is the
  // session, so a streak is not forced to wear one sticker over and over.
  const row = (await (await get(`/api/kids/${kid.id}/chart?week=${week}`)).json())
    .rows.find((r: { kind: string }) => r.kind === "practice");
  const ids = row.cells.map((c: { placements: { stickerId: string }[] }) => c.placements[0]!.stickerId);
  expect(new Set(ids).size).toBe(2);
});

test("routine slots now include afternoon, so the middle of the day is reachable", async () => {
  expect(routines.ROUTINE_SLOTS).toContain("afternoon");
  const routinesApp = new Hono().route("/api", (await import("./routes/routines")).routinesRoutes);
  const res = await routinesApp.request("/api/routines", {
    method: "POST",
    body: JSON.stringify({ childId: kid.id, title: "After school", slot: "afternoon", pin: "1234" }),
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.routine.slot).toBe("afternoon");
  expect(body.routine.emoji).toBe("☀️");
});
