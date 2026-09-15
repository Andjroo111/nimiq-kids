// Backward-compat regression (mini-app port slice 2). Simulates the LIVE household's
// existing DB — one family in family mode with a PIN, an existing parent token, kids,
// and a paired kiosk tablet — and proves every legacy surface behaves identically,
// BEFORE and AFTER a stranger self-serve-onboards a second family onto the instance.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { hashPin, newToken, sha256Hex } from "./auth";
import { families } from "./routes/families";
import { children } from "./routes/children";
import { chores } from "./routes/chores";
import { parentRoutes } from "./routes/parent";
import { walletRoutes } from "./routes/wallet";
import { lockRoutes } from "./routes/lock";
import { onboardRoutes, resetRateLimits } from "./routes/onboard";

const app = new Hono()
  .route("/api", families)
  .route("/api", children)
  .route("/api", chores)
  .route("/api", parentRoutes)
  .route("/api", walletRoutes)
  .route("/api", lockRoutes)
  .route("/api", onboardRoutes);

// The pre-existing household, exactly as the live DB has it.
let fam: repo.Family;
let kid1: repo.Child;
let kid2: repo.Child;
let parentBearer: string;   // the token already on Andjroo's phone
let tabletBearer: string;   // the token already inside the paired kiosk tablet
let device: lockRepo.Device;

beforeEach(async () => {
  initTestDb();
  resetRateLimits();
  const f = repo.createFamily("Andjroo", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid1 = repo.createChild(fam.id, "Kid One", "🦖");
  kid2 = repo.createChild(fam.id, "Kid Two", "🐸");
  parentBearer = newToken();
  lockRepo.createParentToken(fam.id, "Andjroo's phone", await sha256Hex(parentBearer));
  tabletBearer = newToken();
  device = lockRepo.createDevice(fam.id, "Kid One's tablet", await sha256Hex(tabletBearer), kid1.id);
});

const plain = (method: string, path: string, body?: Record<string, unknown>) =>
  app.request(`http://hatch.test${path}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
const withBearer = (bearer: string, method: string, path: string, body?: Record<string, unknown>) =>
  app.request(`http://hatch.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** Every legacy surface, asserted identical to pre-slice-2 behavior. */
async function expectHouseholdWorks() {
  // Kid tablet boot: unauthenticated instance-level surfaces serve THE household.
  const famRes = await (await plain("GET", "/api/family")).json();
  expect(famRes.family.id).toBe(fam.id);
  expect(famRes.family.hasPin).toBe(true);
  const kids = await (await plain("GET", "/api/children")).json();
  expect(kids.children.map((k: { id: string }) => k.id)).toEqual([kid1.id, kid2.id]);

  // On-tablet PIN pad (no bearer, PIN typed on the tablet).
  const pinOk = await plain("POST", "/api/parent/verify-pin", { pin: "1234" });
  expect(pinOk.status).toBe(200);

  // The existing phone token still drives the parent app for THIS family.
  const ov = await (await withBearer(parentBearer, "GET", "/api/parent/overview")).json();
  expect(ov.family.id).toBe(fam.id);
  expect(ov.children).toHaveLength(2);

  // The paired tablet's device token still resolves its own family's state.
  const state = await (await withBearer(tabletBearer, "GET", "/api/device/state")).json();
  expect(state.childId).toBe(kid1.id);
  expect(typeof state.state).toBe("string");

  // The phone still sees the tablet in Settings.
  const devices = await (await withBearer(parentBearer, "GET", "/api/devices")).json();
  expect(devices.devices.map((d: { id: string }) => d.id)).toEqual([device.id]);

  // The full tablet loop: create chore (unauth kid surface), submit, approve BY PIN
  // (typed on the tablet, no bearer), payout recorded in the kid's wallet.
  const made = await plain("POST", "/api/chores", { childId: kid1.id, title: "Feed the dog", rewardLuna: 25_000 });
  expect(made.status).toBe(201);
  const chore = (await made.json()).chore as repo.Chore;
  expect(chore.family_id).toBe(fam.id);
  await plain("POST", `/api/chores/${chore.id}/submit`);
  const approved = await plain("POST", `/api/chores/${chore.id}/approve`, { pin: "1234" });
  expect(approved.status).toBe(200);
  expect((await approved.json()).paidLuna).toBe(25_000);
  const wallet = await (await plain("GET", `/api/kids/${kid1.id}/wallet`)).json();
  expect(wallet.events.some((e: { kind: string; valueLuna: number }) => e.kind === "earn" && e.valueLuna === 25_000)).toBe(true);
}

test("the existing single-household DB behaves identically end to end", async () => {
  await expectHouseholdWorks();
});

test("...and STILL does after a stranger onboards a second family", async () => {
  const res = await plain("POST", "/api/onboard", { parentLabel: "Stranger", kidLabel: "New Kid" });
  expect(res.status).toBe(201);
  const stranger = await res.json();

  await expectHouseholdWorks();

  // And nothing of the stranger's household leaked into Andjroo's surfaces.
  const kids = await (await plain("GET", "/api/children")).json();
  expect(JSON.stringify(kids)).not.toContain(stranger.child.id);
  const ov = await (await withBearer(parentBearer, "GET", "/api/parent/overview")).json();
  expect(JSON.stringify(ov)).not.toContain(stranger.family.id);
});

test("a wrong tablet PIN still rate-limits exactly as before", async () => {
  for (let i = 0; i < 4; i++) {
    expect((await plain("POST", "/api/parent/verify-pin", { pin: "0000" })).status).toBe(401);
  }
  expect((await plain("POST", "/api/parent/verify-pin", { pin: "0000" })).status).toBe(423);
});
