// W3 (parent companion v2) server touches: the additive overview fields the family
// home renders from (per-kid address + stakedLuna, family hotWalletLuna) and the
// /family/topup-broadcast endpoint (SIM path). Hermetic: in-memory DB + app.request().

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as wrepo from "./repo-wallet";
import { ensureKidWallet } from "./wallet/kid-wallet";
import { newToken, sha256Hex } from "./auth";
import * as approvalsRepo from "./repo-approvals";
import { parentRoutes } from "./routes/parent";
import { walletRoutes, HOT_BALANCE_KEY } from "./routes/wallet";
import { approvalsRoutes } from "./routes/approvals";

const app = new Hono().route("/api", parentRoutes).route("/api", walletRoutes).route("/api", approvalsRoutes);

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});

const get = (path: string) =>
  app.request(path, { headers: { Authorization: `Bearer ${bearer}` } });
const post = (path: string, body: Record<string, unknown> = {}) =>
  app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
  });

test("overview carries per-kid address + stakedLuna and family hotWalletLuna", async () => {
  // Provision the kid's account explicitly, then stake from a deposit. This used to lean on
  // `GET /kids/:id/wallet` doing it as a side effect; reading no longer mints (#381), so the
  // setup asks for what it needs instead of getting it by accident.
  await ensureKidWallet(kid.id);
  const w = await (await app.request(`/api/kids/${kid.id}/wallet`)).json();
  expect(w.address).toMatch(/^NQ/);
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "deposit", valueLuna: 500_000 });
  // Family mode (v0.43): the stake queues for the parent; approve it so it executes.
  const stakeRes = await post(`/api/kids/${kid.id}/stake`, { valueLuna: 200_000 });
  expect(stakeRes.status).toBe(202);
  const { approvalId } = await stakeRes.json();
  expect(approvalsRepo.getApproval(approvalId)!.subject_kind).toBe("stake");
  expect((await post(`/api/approvals/${approvalId}/approve`)).status).toBe(200);
  wrepo.setWalletState(HOT_BALANCE_KEY, "1230000");

  const res = await get("/api/parent/overview");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.hotWalletLuna).toBe(1_230_000);
  const k = body.children.find((c: { id: string }) => c.id === kid.id);
  expect(k.address).toBe(w.address);
  expect(k.stakedLuna).toBe(200_000);
});

// Was: "reports hotWalletLuna 0". It should not — 0 is a claim about the chain that has
// not been read. Verified against a live testnet 2026-07-31: a fresh instance rendered
// "Family wallet 0 NIM / $0.00" while the hot wallet held 110,000 NIM, and TOTAL BALANCE
// silently omitted it. Only deposit-check writes the snapshot, so until it runs the
// honest answer is "unknown" and the parent app draws a dash.
test("overview without any snapshot reports hotWalletLuna null, not 0", async () => {
  const body = await (await get("/api/parent/overview")).json();
  expect(body.hotWalletLuna).toBeNull();
});

test("once the snapshot exists, a real zero is reported as 0 and not as unknown", async () => {
  wrepo.setWalletState(HOT_BALANCE_KEY, "0");
  const body = await (await get("/api/parent/overview")).json();
  expect(body.hotWalletLuna).toBe(0);
});

test("a budgeted family sees its own budget as the family wallet, not the shared float", async () => {
  // A public instance: one hot wallet, many households, nobody grandfathered.
  const grandfather = process.env.HATCH_GRANDFATHER_FIRST;
  const grant = process.env.HATCH_DEMO_GRANT_LUNA;
  process.env.HATCH_GRANDFATHER_FIRST = "0";
  process.env.HATCH_DEMO_GRANT_LUNA = "500000"; // 5 NIM
  try {
    wrepo.setWalletState(HOT_BALANCE_KEY, "32999000000"); // ~330 000 NIM of instance float
    const body = await (await get("/api/parent/overview")).json();
    expect(body.hotWalletLuna).toBe(500_000); // its budget, not the float

    // Exempt (the real single household) still sees the actual wallet.
    repo.setBudgetExempt(fam.id, true);
    const exempt = await (await get("/api/parent/overview")).json();
    expect(exempt.hotWalletLuna).toBe(32_999_000_000);
  } finally {
    if (grandfather === undefined) delete process.env.HATCH_GRANDFATHER_FIRST;
    else process.env.HATCH_GRANDFATHER_FIRST = grandfather;
    if (grant === undefined) delete process.env.HATCH_DEMO_GRANT_LUNA;
    else process.env.HATCH_DEMO_GRANT_LUNA = grant;
  }
});

test("topup-broadcast requires the parent bearer", async () => {
  const res = await app.request("/api/family/topup-broadcast", {
    method: "POST",
    body: JSON.stringify({ serializedTx: "ab".repeat(20) }),
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status).toBe(401);
});

test("topup-broadcast rejects a non-hex payload", async () => {
  const res = await post("/api/family/topup-broadcast", { serializedTx: "not-hex!" });
  expect(res.status).toBe(400);
});

test("topup-broadcast is a SIM no-op (no chain, sim flag returned)", async () => {
  const res = await post("/api/family/topup-broadcast", { serializedTx: "ab".repeat(40) });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.sim).toBe(true);
  expect(body.txHash).toBeNull();
});
