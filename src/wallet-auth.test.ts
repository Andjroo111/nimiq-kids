// The kid-endpoint money gate (src/routes/families.ts childMoneyGate). Hermetic:
// in-memory DB, SIM, Hono app.request(). The policy reads env at CALL time, so each
// block sets the instance shape it needs and restores it — no subprocess required.
//
// What must hold: where the instance demands auth, a money request without a bearer is
// 401 kid_auth_required BEFORE any lookup (no id oracle); the household's own device or
// parent bearer passes; a bearer from another household is 404; and with no strictness
// env at all the open kid-tablet behavior is byte-identical to before the gate existed.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { walletRoutes } from "./routes/wallet";
import { storeRoutes } from "./routes/store";
import { cashlinks } from "./routes/cashlinks";

const app = new Hono().route("/api", walletRoutes).route("/api", storeRoutes).route("/api", cashlinks);

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let fam: repo.Family;
let kid: repo.Child;
let otherKid: repo.Child;
let deviceToken: string;
let parentToken: string;
let otherDeviceToken: string;
let otherParentToken: string;

const STRICT_VARS = ["HATCH_LEGACY_BOOT", "HATCH_REQUIRE_PARENT_APPROVAL"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of STRICT_VARS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  initTestDb();
  const f = repo.createFamily("Mom", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ada", "🦖");
  deviceToken = newToken();
  lockRepo.createDevice(fam.id, "Kitchen tablet", await sha256Hex(deviceToken), null);
  parentToken = newToken();
  lockRepo.createParentToken(fam.id, "Mom's phone", await sha256Hex(parentToken));

  const other = repo.createFamily("Rival", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  otherKid = repo.createChild(other.id, "Zed", "🦂");
  otherDeviceToken = newToken();
  lockRepo.createDevice(other.id, "Rival tablet", await sha256Hex(otherDeviceToken), null);
  otherParentToken = newToken();
  lockRepo.createParentToken(other.id, "Rival phone", await sha256Hex(otherParentToken));
});

afterEach(() => {
  for (const k of STRICT_VARS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function fund(childId: string, valueLuna: number) {
  wrepo.addWalletEvent({
    familyId: fam.id, childId, kind: "deposit", valueLuna,
    counterpartyLabel: "Test deposit", txHash: `sim:${crypto.randomUUID()}`,
  });
}

const MONEY_POSTS = (id: string) => [
  [`/api/kids/${id}/send`, { toParent: true, valueLuna: 1_000 }],
  [`/api/kids/${id}/stake`, { valueLuna: 1_000 }],
  [`/api/kids/${id}/unstake`, { valueLuna: 1_000 }],
  [`/api/kids/${id}/buy`, { itemId: "x" }],
  [`/api/children/${id}/send`, { valueLuna: 1_000 }],
] as const;

for (const strict of STRICT_VARS) {
  test(`${strict} demands a bearer: every money endpoint answers 401 kid_auth_required`, async () => {
    process.env[strict] = strict === "HATCH_LEGACY_BOOT" ? "0" : "1";
    for (const [path, body] of MONEY_POSTS(kid.id)) {
      const res = await post(path, body as Record<string, unknown>);
      expect(res.status, path).toBe(401);
      expect((await res.json()).error, path).toBe("kid_auth_required");
    }
    for (const path of [`/api/kids/${kid.id}/wallet`, `/api/kids/${kid.id}/staking`]) {
      const res = await get(path);
      expect(res.status, path).toBe(401);
      expect((await res.json()).error, path).toBe("kid_auth_required");
    }
  });
}

test("strict: 401 comes BEFORE the child lookup — a garbage id leaks nothing", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  const bogus = await get("/api/kids/not-a-real-id/wallet");
  expect(bogus.status).toBe(401);
  expect((await bogus.json()).error).toBe("kid_auth_required");
  // With a valid bearer the same id is an honest 404.
  const seen = await get("/api/kids/not-a-real-id/wallet", auth(deviceToken));
  expect(seen.status).toBe(404);
});

test("strict: the household's DEVICE bearer passes; its PARENT bearer passes too", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  fund(kid.id, 100_000);
  const viaDevice = await get(`/api/kids/${kid.id}/wallet`, auth(deviceToken));
  expect(viaDevice.status).toBe(200);
  expect((await viaDevice.json()).balanceLuna).toBe(100_000);
  const viaParent = await get(`/api/kids/${kid.id}/staking`, auth(parentToken));
  expect(viaParent.status).toBe(200);
  // And a money POST goes through the gate to normal handling — which for a family-mode
  // household is the approval queue, family transfer included (v0.43).
  const send = await post(`/api/kids/${kid.id}/send`, { toParent: true, valueLuna: 10_000 }, auth(deviceToken));
  expect(send.status).toBe(202);
  expect((await send.json()).status).toBe("pending_approval");
  expect(wrepo.spendableFromLedger(kid.id)).toBe(100_000); // queued moves nothing
});

test("a bearer from ANOTHER household is 404, device and parent alike, strict or not", async () => {
  for (const strictVal of ["0", undefined]) {
    if (strictVal === undefined) delete process.env.HATCH_LEGACY_BOOT;
    else process.env.HATCH_LEGACY_BOOT = strictVal;
    for (const token of [otherDeviceToken, otherParentToken]) {
      const res = await get(`/api/kids/${kid.id}/wallet`, auth(token));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("child_not_found");
    }
  }
});

test("relaxed (no strictness env): no-token behavior is identical to before the gate", async () => {
  fund(kid.id, 50_000);
  const w = await get(`/api/kids/${kid.id}/wallet`);
  expect(w.status).toBe(200);
  // No token needed here. The household is family mode, so the send still queues — that is
  // custody, not auth, and it is the same answer a bearer would get.
  const send = await post(`/api/kids/${kid.id}/send`, { toParent: true, valueLuna: 10_000 });
  expect(send.status).toBe(202);
  // The other family's kid is reachable by id alone — the id IS the capability there.
  expect((await get(`/api/kids/${otherKid.id}/wallet`)).status).toBe(200);
});

test("demo mode on a relaxed instance keeps the instant family transfer", async () => {
  repo.updateFamilySettings(fam.id, { mode: "demo" });
  fund(kid.id, 50_000);
  const send = await post(`/api/kids/${kid.id}/send`, { toParent: true, valueLuna: 10_000 });
  expect(send.status).toBe(200);
  expect((await send.json()).status).toBe("sent");
  expect(wrepo.spendableFromLedger(kid.id)).toBe(40_000);
});

test("strict: custody in the wallet payload reports per-family enforcement honestly", async () => {
  process.env.HATCH_REQUIRE_PARENT_APPROVAL = "1";
  const body = await (await get(`/api/kids/${kid.id}/wallet`, auth(deviceToken))).json();
  expect(body.custody.requiresParentApproval).toBe(true);
  expect(body.custody.demoUnlocked).toBe(false);
  expect(body.custody.warning).toBeNull();
  expect(body.custody.kidAuthRequired).toBe(true);
});
