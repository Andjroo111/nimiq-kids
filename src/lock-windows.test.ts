// A parent setting the lock schedule (#303).
//
// The state machine has always been able to read a window; nothing but the seed script could
// ever write one, so a household's schedule was whatever `src/scripts/seed.ts` happened to
// say. These tests are about the steering wheel: the three routes, what they refuse, and the
// two things a schedule change has to do beyond writing a row — reach the tablet, and survive
// a round trip through the machine that reads it.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as routinesRepo from "./repo-routines";
import * as lockRepo from "./repo-lock";
import * as memberRepo from "./repo-members";
import { newToken, sha256Hex } from "./auth";
import { routinesRoutes } from "./routes/routines";
import { computeLockState } from "./lock-machine";
import { subscribe } from "./lock-events";

const app = new Hono().route("/api", routinesRoutes);

let fam: repo.Family;
let kid: repo.Child;
let routine: routinesRepo.Routine;
let parent: string;    // the owner's bearer
let supporter: string; // a grandparent's

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Mom", "NQ43 040G 2081 040G 2081 040G 2081 040G 2081");
  repo.updateFamilySettings(f.id, { mode: "family", tz: "America/Chicago" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ada", "🦖");
  routine = routinesRepo.createRoutine(fam.id, kid.id, "Morning routine", "morning");

  parent = newToken();
  lockRepo.createParentToken(fam.id, "Mom's phone", await sha256Hex(parent), memberRepo.ownerOf(fam.id)!.id);
  const gran = memberRepo.createMember(fam.id, "Grandma Jo", "supporter");
  supporter = newToken();
  lockRepo.createParentToken(fam.id, "Jo's phone", await sha256Hex(supporter), gran.id);
});

const req = (bearer: string | null, method: string, path: string, body?: Record<string, unknown>) =>
  app.request(`http://hatch.test${path}`, {
    method,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const add = (body: Record<string, unknown>, bearer = parent) =>
  req(bearer, "POST", `/api/routines/${routine.id}/windows`, body);

test("a parent adds, edits and deletes a window without touching the database", async () => {
  const made = await add({ startHhmm: "06:30", endHhmm: "08:30", days: "1111100" });
  expect(made.status).toBe(201);
  const { window } = await made.json() as { window: lockRepo.LockWindow };
  expect([window.start_hhmm, window.end_hhmm, window.days]).toEqual(["06:30", "08:30", "1111100"]);

  // The routine carries its schedule: this is the read the parent's card paints from, and
  // the reason there is no windows-only endpoint.
  const listed = await (await req(parent, "GET", `/api/routines?childId=${kid.id}`)).json() as
    { routines: { id: string; windows: lockRepo.LockWindow[] }[] };
  expect(listed.routines[0]!.windows.map((w) => w.id)).toEqual([window.id]);

  // One field at a time: the two it does not mention stay exactly as they were.
  const edited = await req(parent, "PATCH", `/api/routines/${routine.id}/windows/${window.id}`,
    { endHhmm: "09:00" });
  expect(edited.status).toBe(200);
  expect(lockRepo.getLockWindow(window.id)).toMatchObject(
    { start_hhmm: "06:30", end_hhmm: "09:00", days: "1111100" },
  );

  expect((await req(parent, "DELETE", `/api/routines/${routine.id}/windows/${window.id}`)).status).toBe(200);
  expect(lockRepo.getLockWindow(window.id)).toBeNull();
  expect(lockRepo.listWindows(routine.id)).toEqual([]);
});

test("every mutation tells the tablet — one lock-change event each", async () => {
  let beats = 0;
  const unsub = subscribe(() => { beats++; });
  try {
    const { window } = await (await add({ startHhmm: "19:00", endHhmm: "20:30", days: "1111111" }))
      .json() as { window: lockRepo.LockWindow };
    expect(beats).toBe(1);
    await req(parent, "PATCH", `/api/routines/${routine.id}/windows/${window.id}`, { days: "0000011" });
    expect(beats).toBe(2);
    await req(parent, "DELETE", `/api/routines/${routine.id}/windows/${window.id}`);
    expect(beats).toBe(3);
    // A refusal is not a change, and a tablet re-computing its whole state for one is waste.
    await add({ startHhmm: "25:00", endHhmm: "08:00", days: "1111100" });
    expect(beats).toBe(3);
  } finally { unsub(); }
});

test("a bedtime window crosses midnight and the machine still locks on both sides of it", async () => {
  const made = await add({ startHhmm: "20:30", endHhmm: "06:30", days: "1111111" });
  expect(made.status).toBe(201); // end <= start is a real schedule, never a validation error

  const windows = lockRepo.windowsForChild(kid.id).map((w) => ({
    routineId: w.routine_id, startHhmm: w.start_hhmm, endHhmm: w.end_hhmm, days: w.days,
  }));
  const at = (iso: string) => computeLockState({
    nowMs: new Date(iso).getTime(), tz: fam.tz, windows,
    runsToday: [], pendingApprovalRunIds: [], override: null,
  });
  // 2026-08-05 is a Wednesday. 22:00 Chicago is 03:00Z the next day; 05:00 Chicago is 10:00Z.
  expect(at("2026-08-06T03:00:00Z").state).toBe("LOCKED_ROUTINE"); // 22:00, the evening half
  expect(at("2026-08-06T10:00:00Z").state).toBe("LOCKED_ROUTINE"); // 05:00, the morning tail
  expect(at("2026-08-05T17:00:00Z").state).toBe("UNLOCKED");       // 12:00, between them
});

test("the shape is checked, and an empty week is refused rather than saved", async () => {
  const refused = async (body: Record<string, unknown>, error: string) => {
    const r = await add(body);
    expect([error, r.status]).toEqual([error, 400]);
    expect(await r.json()).toEqual({ error });
  };
  await refused({ startHhmm: "6:30", endHhmm: "08:30", days: "1111100" }, "invalid_time");
  await refused({ startHhmm: "24:00", endHhmm: "08:30", days: "1111100" }, "invalid_time");
  await refused({ startHhmm: "06:30", endHhmm: "08:75", days: "1111100" }, "invalid_time");
  await refused({ endHhmm: "08:30", days: "1111100" }, "invalid_time"); // absent, not just malformed
  await refused({ startHhmm: "06:30", endHhmm: "08:30", days: "111110" }, "invalid_days");
  await refused({ startHhmm: "06:30", endHhmm: "08:30", days: "1111102" }, "invalid_days");
  // A mask nothing is set in is a window that can never fire. Saving it silently is how a
  // parent comes to believe they set a schedule they did not.
  await refused({ startHhmm: "06:30", endHhmm: "08:30", days: "0000000" }, "no_days");
  expect(lockRepo.listWindows(routine.id)).toEqual([]);
});

test("the same window twice is refused, on the way in and on the way past an edit", async () => {
  await add({ startHhmm: "06:30", endHhmm: "08:30", days: "1111100" });
  const dupe = await add({ startHhmm: "06:30", endHhmm: "08:30", days: "1111100" });
  expect(dupe.status).toBe(409);
  expect(await dupe.json()).toEqual({ error: "duplicate_window" });
  // A different mask over the same hours is a different rule, not a duplicate.
  const weekend = await add({ startHhmm: "06:30", endHhmm: "08:30", days: "0000011" });
  expect(weekend.status).toBe(201);
  const { window } = await weekend.json() as { window: lockRepo.LockWindow };
  const collide = await req(parent, "PATCH", `/api/routines/${routine.id}/windows/${window.id}`,
    { days: "1111100" });
  expect(collide.status).toBe(409);
  expect(lockRepo.getLockWindow(window.id)!.days).toBe("0000011"); // and it did not half-apply
});

test("another family's routine cannot be targeted, and neither can another routine's window", async () => {
  const other = repo.createFamily("Dad next door", "NQ23 0810 40G2 0810 40G2 0810 40G2 0810 40G2");
  repo.updateFamilySettings(other.id, { mode: "family" });
  const theirKid = repo.createChild(other.id, "Ben", "🦕");
  const theirs = routinesRepo.createRoutine(other.id, theirKid.id, "Bedtime", "evening");

  // 404 rather than 403: whether that routine exists is not this household's business.
  const reach = await req(parent, "POST", `/api/routines/${theirs.id}/windows`,
    { startHhmm: "19:00", endHhmm: "20:00", days: "1111111" });
  expect(reach.status).toBe(404);
  expect(lockRepo.listWindows(theirs.id)).toEqual([]);

  const mine = lockRepo.addLockWindow(routine.id, "06:30", "08:30", "1111100");
  const second = routinesRepo.createRoutine(fam.id, kid.id, "Bedtime", "evening");
  expect((await req(parent, "PATCH", `/api/routines/${second.id}/windows/${mine.id}`,
    { days: "1111111" })).status).toBe(404);
  expect((await req(parent, "DELETE", `/api/routines/${second.id}/windows/${mine.id}`)).status).toBe(404);
  expect(lockRepo.getLockWindow(mine.id)!.days).toBe("1111100");
});

test("a supporter does not set the schedule", async () => {
  const r = await add({ startHhmm: "06:30", endHhmm: "08:30", days: "1111100" }, supporter);
  expect(r.status).toBe(403);
  expect(await r.json()).toEqual({ error: "not_allowed" });

  const mine = lockRepo.addLockWindow(routine.id, "06:30", "08:30", "1111100");
  expect((await req(supporter, "PATCH", `/api/routines/${routine.id}/windows/${mine.id}`,
    { days: "1111111" })).status).toBe(403);
  expect((await req(supporter, "DELETE", `/api/routines/${routine.id}/windows/${mine.id}`)).status).toBe(403);
  expect(lockRepo.listWindows(routine.id).length).toBe(1);
});

test("a routine's schedule is capped, and the cap refuses rather than trims", async () => {
  for (let i = 0; i < 8; i++) {
    expect((await add({ startHhmm: `0${i}:00`, endHhmm: `0${i}:30`, days: "1111111" })).status).toBe(201);
  }
  const over = await add({ startHhmm: "21:00", endHhmm: "21:30", days: "1111111" });
  expect(over.status).toBe(409);
  expect(await over.json()).toEqual({ error: "too_many_windows" });
  expect(lockRepo.listWindows(routine.id).length).toBe(8);
});
