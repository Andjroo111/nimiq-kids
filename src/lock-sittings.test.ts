// Sittings (play for N minutes in one go, then rest for M), driven through the REAL repos +
// routes. Split from lock-routes.test.ts for the 800-line guard; same hermetic harness
// (in-memory DB + app.request()), same reason the rest of that file has one.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as lockRepo from "./repo-lock";
import { hashPin, newToken, sha256Hex } from "./auth";
import { lockRoutes } from "./routes/lock";
import { onboardRoutes } from "./routes/onboard";

const SETUP_CODE = "hatch-4242";
const app = new Hono().route("/api", lockRoutes).route("/api", onboardRoutes);

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
const patch = (path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.request(path, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });

let fam: repo.Family;
let kid: repo.Child;
let parentBearer: string;

beforeEach(async () => {
  initTestDb();
  process.env.KIOSK_SETUP_CODE = SETUP_CODE;
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  parentBearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(parentBearer));
});
afterEach(() => { delete process.env.KIOSK_SETUP_CODE; });

const asParent = () => ({ Authorization: `Bearer ${parentBearer}` });
const asDevice = (token: string) => ({ Authorization: `Bearer ${token}` });
const usage = (token: string, body: Record<string, unknown>) => post("/api/device/usage", body, asDevice(token));

async function registerDevice(childId: string): Promise<{ deviceId: string; token: string }> {
  const res = await post("/api/devices/register", { label: "Test tablet", setupCode: SETUP_CODE, childId });
  expect(res.status).toBe(201);
  return res.json();
}
async function deviceState(token: string) {
  const res = await app.request("/api/device/state", { headers: asDevice(token) });
  expect(res.status).toBe(200);
  return res.json();
}
const screenState = async () => {
  const res = await app.request("/api/parent/screen-state", { headers: asParent() });
  expect(res.status).toBe(200);
  return res.json();
};

test("sittings: a full sitting locks the tablet for the rest, and the state says which lock", async () => {
  const { token } = await registerDevice(kid.id);
  repo.setScreenBreaks(kid.id, 5, 5);
  expect((await deviceState(token)).state).toBe("UNLOCKED");
  await usage(token, { deltaSec: 300 });
  const after = await deviceState(token);
  expect(after.state).toBe("LOCKED_BREAK");
  expect(after.reason).toBe("break_time");
  // `until` is the end of the rest: five minutes from the tick, give or take the test's own clock.
  expect(after.until).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
  expect(after.until).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 1000);
});

test("sittings: the rest is served by silence, and the tablet reopens on its own", async () => {
  const { token } = await registerDevice(kid.id);
  repo.setScreenBreaks(kid.id, 5, 5);
  const day = routines.localDay(fam.tz);
  // A sitting that filled six minutes ago, and not a tick since: the rest is over.
  lockRepo.addUsageSec(kid.id, day, 300, Date.now() - 6 * 60 * 1000, { restSec: 300 });
  expect(lockRepo.usageFor(kid.id, day)!.sitting_sec).toBe(300);
  expect((await deviceState(token)).state).toBe("UNLOCKED");
});

test("sittings: a pause shorter than the rest does not restart the sitting", () => {
  repo.setScreenBreaks(kid.id, 5, 5);
  const day = routines.localDay(fam.tz);
  const t0 = Date.now() - 20 * 60 * 1000;
  const rest = { restSec: 300 };
  lockRepo.addUsageSec(kid.id, day, 120, t0, rest);
  lockRepo.addUsageSec(kid.id, day, 120, t0 + 4 * 60 * 1000, rest);   // 4 min away: same sitting
  expect(lockRepo.usageFor(kid.id, day)!.sitting_sec).toBe(240);
  lockRepo.addUsageSec(kid.id, day, 60, t0 + 10 * 60 * 1000, rest);   // 6 min away: rested
  const row = lockRepo.usageFor(kid.id, day)!;
  expect(row.sitting_sec).toBe(60);
  expect(row.used_sec).toBe(300); // the DAY's meter never forgets any of it
});

test("sittings: with no rule the sitting stays at 0 and the tablet payload grows nothing", async () => {
  const { token } = await registerDevice(kid.id);
  await usage(token, { deltaSec: 300 });
  const day = routines.localDay(fam.tz);
  expect(lockRepo.usageFor(kid.id, day)!.sitting_sec).toBe(0);
  expect(lockRepo.usageFor(kid.id, day)!.last_burn_at).toBeGreaterThan(0);
  const payload = await deviceState(token);
  expect(payload.state).toBe("UNLOCKED");
  // No new field on the tablet's payload: the exhaustive-keys test above stays the guard.
  expect("sitting" in payload).toBe(false);
});

test("sittings: PATCH screen-budget sets the rule, and leaves it alone when not mentioned", async () => {
  let r = await patch(`/api/children/${kid.id}/screen-budget`, { dailyMin: 60, maxEarnedMin: 0, playMin: 30, restMin: 30 }, asParent());
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ dailyMin: 60, maxEarnedMin: 0, playMin: 30, restMin: 30 });
  r = await patch(`/api/children/${kid.id}/screen-budget`, { dailyMin: 90 }, asParent());
  expect(await r.json()).toEqual({ dailyMin: 90, maxEarnedMin: 0, playMin: 30, restMin: 30 });
  expect((await patch(`/api/children/${kid.id}/screen-budget`, { dailyMin: 90, playMin: -5 }, asParent())).status).toBe(400);
});

test("sittings: the parent's screen reads the rest as its own lock", async () => {
  const { token } = await registerDevice(kid.id);
  repo.setScreenBreaks(kid.id, 5, 5);
  await usage(token, { deltaSec: 300 });
  const { screens } = await screenState();
  expect(screens[0].state).toBe("LOCKED_BREAK");
  expect(screens[0].reason).toBe("break_time");
  expect(screens[0].until).toBeGreaterThan(Date.now());
});
