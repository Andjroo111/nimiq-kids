// Battery reports (KIOSK-CONTRACT §11), driven through the REAL repos + routes. Same hermetic
// harness as lock-routes.test.ts (in-memory DB + app.request()).

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { hashPin, newToken, sha256Hex } from "./auth";
import { lockRoutes } from "./routes/lock";

const SETUP_CODE = "hatch-4242";
const app = new Hono().route("/api", lockRoutes);

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });

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
const report = (token: string, body: Record<string, unknown>) => post("/api/device/battery", body, asDevice(token));

async function registerDevice(): Promise<{ deviceId: string; token: string }> {
  const res = await post("/api/devices/register", { label: "Test tablet", setupCode: SETUP_CODE, childId: kid.id });
  expect(res.status).toBe(201);
  return res.json();
}
const screenState = async () => {
  const res = await app.request("/api/parent/screen-state", { headers: asParent() });
  expect(res.status).toBe(200);
  return res.json();
};

test("battery: a report lands on the device row and reaches the parent's screen", async () => {
  const { deviceId, token } = await registerDevice();
  // Before any report, the parent reads null -- never a zeroed battery.
  let { screens } = await screenState();
  expect(screens[0].batteryPct).toBeNull();
  expect(screens[0].batteryCharging).toBeNull();

  const r = await report(token, { pct: 80, charging: true });
  expect(r.status).toBe(200);
  ({ screens } = await screenState());
  expect(screens[0]).toMatchObject({ deviceId, batteryPct: 80, batteryCharging: true });
  expect(screens[0].batteryAt).toBeGreaterThan(0);
  expect(lockRepo.getDevice(deviceId)!.battery_pct).toBe(80);
});

test("battery: the number is clamped and must be a number", async () => {
  const { deviceId, token } = await registerDevice();
  await report(token, { pct: 250, charging: "yes" });
  const d = lockRepo.getDevice(deviceId)!;
  expect(d.battery_pct).toBe(100);
  expect(d.battery_charging).toBe(0); // only a literal true counts as charging
  expect((await report(token, { pct: "full" })).status).toBe(400);
  expect((await post("/api/device/battery", { pct: 50 })).status).toBe(401);
});

test("battery: every accepted report is kept, readable by the parent, and pruned at 30 days", async () => {
  const { deviceId, token } = await registerDevice();
  const now = Date.now();
  lockRepo.noteBattery(deviceId, 40, false, now - 31 * 86_400_000); // older than the log keeps
  lockRepo.noteBattery(deviceId, 90, true, now - 3600_000);
  await report(token, { pct: 85, charging: false });
  const res = await app.request(`/api/parent/devices/${deviceId}/battery?days=1`, { headers: asParent() });
  expect(res.status).toBe(200);
  const { points } = await res.json();
  expect(points.map((p: { pct: number }) => p.pct)).toEqual([90, 85]);
  expect(lockRepo.batteryHistory(deviceId, 0).map((p) => p.pct)).toEqual([90, 85]); // the 40 is gone
});

test("battery: another household's tablet is not found", async () => {
  const { deviceId } = await registerDevice();
  const other = repo.createFamily("Mum", "NQ01");
  const bearer = newToken();
  lockRepo.createParentToken(other.id, "Other phone", await sha256Hex(bearer));
  const res = await app.request(`/api/parent/devices/${deviceId}/battery`, { headers: { Authorization: `Bearer ${bearer}` } });
  expect(res.status).toBe(404);
});

test("battery: the tablet's own payload grows nothing", async () => {
  const { token } = await registerDevice();
  await report(token, { pct: 80, charging: true });
  const res = await app.request("/api/device/state", { headers: asDevice(token) });
  const payload = await res.json();
  expect("batteryPct" in payload).toBe(false);
});
