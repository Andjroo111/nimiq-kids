// Which kid a tablet is acting as, after the secret-picture gate came out (2026-09-16,
// Andjroo: "remove the pin entry where the kid has to pick two different characters").
// What is pinned now: unlock is free and always records the kid, one tablet is one kid at a
// time in the device row, a parent is never gated, and a stranger's household is a 404.
// The gate's own tests (secrets, guesses, the family PIN, the picture order) left with it;
// git has them at `fb0bbe4` and before.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { sha256Hex, newToken } from "./auth";
import { children } from "./routes/children";
import { kidSwitchRoutes } from "./routes/kid-switch";
import { storeRoutes } from "./routes/store";
import { walletRoutes } from "./routes/wallet";
import { deviceMayActAs } from "./kid-switch";
import { resetRateLimits } from "./rate-limit";

const app = new Hono()
  .route("/api", children)
  .route("/api", kidSwitchRoutes)
  .route("/api", storeRoutes)
  .route("/api", walletRoutes);

let fam: repo.Family;
let ada: repo.Child;
let ben: repo.Child;
let tablet: { device: lockRepo.Device; token: string };

const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (path: string, token: string, body: unknown = {}) =>
  app.request(path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });

async function pairTablet(label: string) {
  const token = newToken();
  const device = lockRepo.createDevice(fam.id, label, await sha256Hex(token), null);
  return { device, token };
}

// Strict multi-tenant behaviour: the relaxed default would let an un-tokened caller through
// the money gate entirely, which is not the surface this issue is about.
const savedBoot = { v: undefined as string | undefined };

beforeEach(async () => {
  savedBoot.v = process.env.HATCH_LEGACY_BOOT;
  process.env.HATCH_LEGACY_BOOT = "0";
  initTestDb();
  resetRateLimits();
  const created = repo.createFamily("Mom", "NQ00");
  repo.updateFamilySettings(created.id, { mode: "family" });
  fam = repo.getFamily(created.id)!;
  ada = repo.createChild(fam.id, "Ada", "🦖");
  ben = repo.createChild(fam.id, "Ben", "🦕");
  tablet = await pairTablet("Kitchen tablet");
});

afterEach(() => {
  if (savedBoot.v === undefined) delete process.env.HATCH_LEGACY_BOOT;
  else process.env.HATCH_LEGACY_BOOT = savedBoot.v;
});

// ---- unlock is free, and it is still the record of who the tablet is ----

test("tapping a kid's name opens the kid, nothing to prove", async () => {
  const r = await post(`/api/kids/${ada.id}/unlock`, tablet.token, {});
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, via: "open" });
  expect(lockRepo.getDevice(tablet.device.id)?.unlocked_child_id).toBe(ada.id);
});

test("whatever the body carries is ignored: an old client sending a secret still gets in", async () => {
  const r = await post(`/api/kids/${ada.id}/unlock`, tablet.token, { secret: "1-4" });
  expect(await r.json()).toEqual({ ok: true, via: "open" });
  const p = await post(`/api/kids/${ada.id}/unlock`, tablet.token, { pin: "0000" });
  expect(await p.json()).toEqual({ ok: true, via: "open" });
});

test("one tablet is one kid at a time in the device row", async () => {
  await post(`/api/kids/${ada.id}/unlock`, tablet.token, {});
  await post(`/api/kids/${ben.id}/unlock`, tablet.token, {});
  expect(lockRepo.getDevice(tablet.device.id)?.unlocked_child_id).toBe(ben.id);
});

test("a second tablet keeps its own idea of who it is", async () => {
  const other = await pairTablet("Bedroom tablet");
  await post(`/api/kids/${ada.id}/unlock`, tablet.token, {});
  await post(`/api/kids/${ben.id}/unlock`, other.token, {});
  expect(lockRepo.getDevice(tablet.device.id)?.unlocked_child_id).toBe(ada.id);
  expect(lockRepo.getDevice(other.device.id)?.unlocked_child_id).toBe(ben.id);
});

// ---- nobody is locked out ----

test("the money routes accept any kid of the household from any of its tablets", async () => {
  // The consequence Andjroo accepted on 2026-09-16, stated as a test so it is a decision and
  // not an accident: Ada's tablet can open Ben's wallet and Treasure Box.
  await post(`/api/kids/${ada.id}/unlock`, tablet.token, {});
  expect(deviceMayActAs(lockRepo.getDevice(tablet.device.id)!, ben.id)).toBe(true);
  expect((await app.request(`/api/kids/${ben.id}/wallet`, { headers: bearer(tablet.token) })).status).toBe(200);
  const spend = await post(`/api/kids/${ben.id}/buy`, tablet.token, { itemId: "item-screen-15" });
  expect(spend.status).not.toBe(403);
});

test("a parent bearer acts for every kid", async () => {
  const parentToken = newToken();
  await lockRepo.createParentToken(fam.id, "Mom's phone", await sha256Hex(parentToken));
  for (const kid of [ada, ben]) {
    const r = await app.request(`/api/kids/${kid.id}/wallet`, { headers: bearer(parentToken) });
    expect({ kid: kid.label, status: r.status }).toEqual({ kid: kid.label, status: 200 });
  }
});

test("the roster carries no gate field any more", async () => {
  const body = await (await app.request("/api/children", { headers: bearer(tablet.token) })).json();
  for (const c of body.children) expect(c).not.toHaveProperty("hasSecret");
  expect(JSON.stringify(body)).not.toContain("secret");
});

test("a tablet from another household gets 404, not 403", async () => {
  const other = repo.createFamily("Dad", "NQ00");
  const kid = repo.createChild(other.id, "Cal", "🐢");
  const r = await post(`/api/kids/${kid.id}/unlock`, tablet.token, {});
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: "child_not_found" });
});

test("no bearer, no unlock", async () => {
  const r = await app.request(`/api/kids/${ada.id}/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  expect(r.status).toBe(401);
});
