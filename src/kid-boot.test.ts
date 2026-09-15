// Kid-tablet boot scoping (mini-app port slice 3). The unauthenticated tablet boot
// surfaces (GET /family, GET /children) used to pin to the instance's FIRST household.
// Now: a paired device's bearer scopes them to ITS family, a NEW family can pair a
// tablet with the parent's 6-digit code, and a public instance can turn the legacy
// first-household fallback off entirely (HATCH_LEGACY_BOOT=0).

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { families } from "./routes/families";
import { children } from "./routes/children";
import { chores } from "./routes/chores";
import { lockRoutes } from "./routes/lock";
import { onboardRoutes, resetRateLimits } from "./routes/onboard";

const app = new Hono()
  .route("/api", families)
  .route("/api", children)
  .route("/api", chores)
  .route("/api", lockRoutes)
  .route("/api", onboardRoutes);

type House = { fam: repo.Family; kid: repo.Child; bearer: string };
let A: House; // first household (the legacy live install)
let B: House; // a self-serve family

async function makeHouse(label: string, kidLabel: string): Promise<House> {
  const f = repo.createFamily(label, "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  const fam = repo.getFamily(f.id)!;
  const kid = repo.createChild(fam.id, kidLabel, "🦖");
  const bearer = newToken();
  lockRepo.createParentToken(fam.id, `${label}'s phone`, await sha256Hex(bearer));
  return { fam, kid, bearer };
}

const ENV_KEYS = ["HATCH_LEGACY_BOOT", "KIOSK_SETUP_CODE"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  initTestDb();
  resetRateLimits();
  A = await makeHouse("Mom A", "Ada");
  B = await makeHouse("Dad B", "Ben");
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const plain = (method: string, path: string, body?: Record<string, unknown>) =>
  app.request(`http://hatch.test${path}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });

const asBearer = (bearer: string, method: string, path: string, body?: Record<string, unknown>) =>
  app.request(`http://hatch.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** Parent of `house` mints a pair code, then a fresh tablet registers with it. */
async function pairTablet(house: House): Promise<{ token: string; deviceId: string }> {
  const minted = await asBearer(house.bearer, "POST", "/api/parent/pair-code", {});
  expect(minted.status).toBe(201);
  const { code } = await minted.json();
  const reg = await plain("POST", "/api/devices/register", { pairCode: code, label: "Kid tablet" });
  expect(reg.status).toBe(201);
  return reg.json();
}

// ---- pairing a NEW family's tablet ----

test("a second family pairs a tablet with the parent's 6-digit code — no env setup code needed", async () => {
  const { token } = await pairTablet(B); // KIOSK_SETUP_CODE is unset in this test

  // The paired device's boot surfaces scope to family B, never the first household.
  const fam = await (await asBearer(token, "GET", "/api/family")).json();
  expect(fam.family.id).toBe(B.fam.id);
  const kids = await (await asBearer(token, "GET", "/api/children")).json();
  expect(kids.children.map((k: { id: string }) => k.id)).toEqual([B.kid.id]);
  const chorelist = await (await asBearer(token, "GET", "/api/chores")).json();
  expect(Array.isArray(chorelist.chores)).toBe(true);

  // And the device row itself lives in B.
  const devices = lockRepo.listDevices(B.fam.id);
  expect(devices.length).toBe(1);
  expect(lockRepo.listDevices(A.fam.id).length).toBe(0);
});

test("a pair code is single use for device registration", async () => {
  const minted = await asBearer(B.bearer, "POST", "/api/parent/pair-code", {});
  const { code } = await minted.json();
  expect((await plain("POST", "/api/devices/register", { pairCode: code, label: "T1" })).status).toBe(201);
  expect((await plain("POST", "/api/devices/register", { pairCode: code, label: "T2" })).status).toBe(403);
});

test("device state for a pair-code tablet follows ITS family's kids", async () => {
  const { token } = await pairTablet(B);
  const res = await asBearer(token, "GET", "/api/device/state");
  expect(res.status).toBe(200);
  expect((await res.json()).childId).toBe(B.kid.id);
});

// ---- legacy env setup-code path (regression) ----

test("the env setup code still pairs to the FIRST household, exactly as before", async () => {
  process.env.KIOSK_SETUP_CODE = "424242";
  const reg = await plain("POST", "/api/devices/register", { setupCode: "424242", label: "Legacy tablet" });
  expect(reg.status).toBe(201);
  const { token } = await reg.json();
  const fam = await (await asBearer(token, "GET", "/api/family")).json();
  expect(fam.family.id).toBe(A.fam.id);
});

test("unauthenticated boot still falls back to the first household by default", async () => {
  const kids = await (await plain("GET", "/api/children")).json();
  expect(kids.children.map((k: { id: string }) => k.id)).toEqual([A.kid.id]);
  const fam = await (await plain("GET", "/api/family")).json();
  expect(fam.family.id).toBe(A.fam.id);
});

// ---- public instance: legacy fallback off ----

test("HATCH_LEGACY_BOOT=0 closes the unauthenticated boot surfaces", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  for (const path of ["/api/family", "/api/children", "/api/chores"]) {
    const res = await plain("GET", path);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("pairing_required");
  }
  // POST surfaces too — nobody adds kids to the first household anonymously.
  expect((await plain("POST", "/api/children", { label: "Sneaky" })).status).toBe(401);
});

test("HATCH_LEGACY_BOOT=0: parent bearers and paired devices keep working", async () => {
  const { token } = await pairTablet(B);
  process.env.HATCH_LEGACY_BOOT = "0";

  const viaParent = await (await asBearer(A.bearer, "GET", "/api/children")).json();
  expect(viaParent.children.map((k: { id: string }) => k.id)).toEqual([A.kid.id]);

  const viaDevice = await (await asBearer(token, "GET", "/api/children")).json();
  expect(viaDevice.children.map((k: { id: string }) => k.id)).toEqual([B.kid.id]);

  // A garbage bearer is the same as none.
  const junk = await asBearer("f".repeat(64), "GET", "/api/children");
  expect(junk.status).toBe(401);
});

test("HATCH_LEGACY_BOOT=0: self-serve onboarding still works (it never used the fallback)", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  const res = await plain("POST", "/api/onboard", { parentLabel: "Newcomer", kidLabel: "Kid" });
  expect(res.status).toBe(201);
  const body = await res.json();
  const kids = await (await asBearer(body.token, "GET", "/api/children")).json();
  expect(kids.children.length).toBe(1);
});
