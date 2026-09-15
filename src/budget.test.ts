// Per-family payout budget (mini-app port slice 3). A public instance runs ONE hot
// wallet for every household, so a non-exempt family's cumulative hot-wallet payouts
// must never exceed its budget (demo grant + attributed credits). Hermetic: in-memory
// DB + app.request(), mirroring src/multifamily.test.ts.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync } from "node:fs";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { initDb, initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as approvalsRepo from "./repo-approvals";
import * as budget from "./repo-budget";
import { newToken, sha256Hex } from "./auth";
import { getNimiq } from "./nimiq/client";
import { families } from "./routes/families";
import { children } from "./routes/children";
import { chores } from "./routes/chores";
import { approvalsRoutes } from "./routes/approvals";
import { parseTopUpTx, topUpExecuted, walletRoutes } from "./routes/wallet";
import { starsRoutes } from "./routes/stars";
import { storeRoutes } from "./routes/store";
import * as stickersRepo from "./repo-stickers";

const app = new Hono()
  .route("/api", families)
  .route("/api", children)
  .route("/api", chores)
  .route("/api", approvalsRoutes)
  .route("/api", walletRoutes)
  .route("/api", starsRoutes)
  .route("/api", storeRoutes);

type House = { fam: repo.Family; kid: repo.Child; bearer: string };
let A: House; // first family — grandfathered by default
let B: House; // second family — lives under the budget

async function makeHouse(label: string, kidLabel: string): Promise<House> {
  const f = repo.createFamily(label, "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  const fam = repo.getFamily(f.id)!;
  const kid = repo.createChild(fam.id, kidLabel, "🦖");
  const bearer = newToken();
  lockRepo.createParentToken(fam.id, `${label}'s phone`, await sha256Hex(bearer));
  return { fam, kid, bearer };
}

const ENV_KEYS = ["HATCH_DEMO_GRANT_LUNA", "HATCH_GRANDFATHER_FIRST"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  initTestDb();
  A = await makeHouse("Mom A", "Ada");
  B = await makeHouse("Dad B", "Ben");
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const req = (bearer: string, method: string, path: string, body?: Record<string, unknown>) =>
  app.request(`http://hatch.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** Create + submit + approve one chore for the house; returns the approve Response. */
async function approveChore(house: House, rewardLuna: number): Promise<Response> {
  const made = await req(house.bearer, "POST", "/api/chores", { childId: house.kid.id, title: "Chore", rewardLuna });
  const chore = (await made.json()).chore;
  await req(house.bearer, "POST", `/api/chores/${chore.id}/submit`);
  const pending = approvalsRepo.listApprovals(house.fam.id, "pending")[0]!;
  return req(house.bearer, "POST", `/api/approvals/${pending.id}/approve`, {});
}

// ---- enforcement ----

test("a second family's payouts stop at the demo grant and the approval stays pending", async () => {
  expect((await approveChore(B, 300_000)).status).toBe(200); // 3 of the 5 NIM grant

  const made = await req(B.bearer, "POST", "/api/chores", { childId: B.kid.id, title: "Big", rewardLuna: 300_000 });
  const chore = (await made.json()).chore;
  await req(B.bearer, "POST", `/api/chores/${chore.id}/submit`);
  const pending = approvalsRepo.listApprovals(B.fam.id, "pending")[0]!;
  const res = await req(B.bearer, "POST", `/api/approvals/${pending.id}/approve`, {});
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe("budget_exhausted");
  expect(body.neededLuna).toBe(300_000);
  expect(body.availableLuna).toBe(200_000);

  // Nothing half-applied: the approval is still pending, the chore still submitted,
  // and no money moved.
  expect(approvalsRepo.getApproval(pending.id)!.status).toBe("pending");
  expect(repo.getChore(chore.id)!.status).toBe("submitted");
  expect(budget.spentLuna(B.fam.id)).toBe(300_000);

  // A credit unblocks the SAME approval.
  budget.addBudgetCredit(B.fam.id, 100_000, "manual", null, "test top-up");
  const retry = await req(B.bearer, "POST", `/api/approvals/${pending.id}/approve`, {});
  expect(retry.status).toBe(200);
  expect(budget.spentLuna(B.fam.id)).toBe(600_000);
});

test("the direct family-mode chore approve route enforces the same cap", async () => {
  const made = await req(B.bearer, "POST", "/api/chores", { childId: B.kid.id, title: "Huge", rewardLuna: 600_000 });
  const chore = (await made.json()).chore;
  const res = await req(B.bearer, "POST", `/api/chores/${chore.id}/approve`, {});
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("budget_exhausted");
  expect(repo.getChore(chore.id)!.status).toBe("open");
});

test("allowance-day star payout is budget-gated too", async () => {
  repo.addStars(B.kid.id, 60); // 60 stars x 10_000 = 600_000 > the 500_000 grant
  const res = await req(B.bearer, "POST", `/api/children/${B.kid.id}/payout`, {});
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("budget_exhausted");
});

test("HATCH_DEMO_GRANT_LUNA=0 disables self-serve payouts until a credit lands", async () => {
  process.env.HATCH_DEMO_GRANT_LUNA = "0";
  const blocked = await approveChore(B, 10_000);
  expect(blocked.status).toBe(400);
  expect((await blocked.json()).error).toBe("budget_exhausted");

  budget.addBudgetCredit(B.fam.id, 50_000, "manual");
  expect((await approveChore(B, 10_000)).status).toBe(200);
});

// ---- exemptions ----

test("the first household is grandfathered by default (live-instance regression)", async () => {
  // Way past the 5 NIM grant — an exempt family has no budget bound, so it sails through.
  expect((await approveChore(A, 900_000)).status).toBe(200);
  expect((await approveChore(A, 900_000)).status).toBe(200);
  expect(budget.isBudgetExempt(repo.getFamily(A.fam.id)!)).toBe(true);
});

test("HATCH_GRANDFATHER_FIRST=0 puts the first family under the budget (public instance)", async () => {
  process.env.HATCH_GRANDFATHER_FIRST = "0";
  const res = await approveChore(A, 900_000);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("budget_exhausted");
});

test("budget_exempt=1 lifts the cap for a specific family", async () => {
  repo.setBudgetExempt(B.fam.id, true);
  expect((await approveChore(B, 900_000)).status).toBe(200);
  expect((await approveChore(B, 900_000)).status).toBe(200);
});

// ---- isolation ----

test("budgets are per-family: one family exhausting its grant never touches another", async () => {
  process.env.HATCH_GRANDFATHER_FIRST = "0"; // both households budgeted
  expect((await approveChore(A, 500_000)).status).toBe(200); // A's grant fully spent
  expect((await approveChore(A, 10_000)).status).toBe(400);
  // B is untouched — full grant available.
  expect(budget.budgetView(repo.getFamily(B.fam.id)!).availableLuna).toBe(500_000);
  expect((await approveChore(B, 500_000)).status).toBe(200);
  // A credit to A does nothing for B.
  budget.addBudgetCredit(A.fam.id, 100_000, "manual");
  expect(budget.budgetView(repo.getFamily(B.fam.id)!).availableLuna).toBe(0);
});

// ---- the ledger formula ----

test("a Treasure Box spend -> reject -> refund loop is budget-neutral and never blocked", async () => {
  // The coupon's price comes from the catalog (repriced with rewards), so the
  // budget and the chore that funds the kid are sized off it rather than off a
  // literal that silently stops covering the purchase.
  const coupon = stickersRepo.getStoreItem("item-coupon-dinner")!.price_luna;
  budget.addBudgetCredit(B.fam.id, coupon, "manual");
  expect((await approveChore(B, coupon)).status).toBe(200); // kid holds the coupon's price
  expect(budget.spentLuna(B.fam.id)).toBe(coupon);

  // Kid buys the 500_000 coupon (spend back to the family wallet) — spent unchanged.
  const buy = await app.request(`http://hatch.test/api/kids/${B.kid.id}/buy`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId: "item-coupon-dinner" }),
  });
  expect(buy.status).toBe(200);
  expect(budget.spentLuna(B.fam.id)).toBe(coupon);

  // Parent rejects: the refund (hot wallet -> kid) executes even at the budget edge,
  // and nets to zero against the spend.
  const pending = approvalsRepo.listApprovals(B.fam.id, "pending")[0]!;
  const rej = await req(B.bearer, "POST", `/api/approvals/${pending.id}/reject`, {});
  expect(rej.status).toBe(200);
  expect(budget.spentLuna(B.fam.id)).toBe(coupon);

  const wallet = await (await app.request(`http://hatch.test/api/kids/${B.kid.id}/wallet`)).json();
  expect(wallet.balanceLuna).toBe(coupon); // the kid got their money back
});

test("credits dedupe on tx hash: the same on-chain tx can never credit twice", () => {
  expect(budget.addBudgetCredit(B.fam.id, 100_000, "topup", "abc123")).not.toBeNull();
  expect(budget.addBudgetCredit(B.fam.id, 100_000, "topup", "abc123")).toBeNull();
  expect(budget.creditsLuna(B.fam.id)).toBe(100_000);
  // Manual credits carry no hash and stack freely.
  expect(budget.addBudgetCredit(B.fam.id, 50_000, "manual")).not.toBeNull();
  expect(budget.addBudgetCredit(B.fam.id, 50_000, "manual")).not.toBeNull();
  expect(budget.creditsLuna(B.fam.id)).toBe(200_000);
});

// ---- deposit attribution ----

test("deposit-info carries the per-family budget view and family code, isolated per family", async () => {
  budget.addBudgetCredit(B.fam.id, 250_000, "manual");
  const infoB = await (await req(B.bearer, "GET", "/api/family/deposit-info")).json();
  expect(infoB.budget.availableLuna).toBe(750_000); // grant 500k + credit 250k
  expect(infoB.budget.exempt).toBe(false);
  expect(typeof infoB.familyCode).toBe("string");
  expect(infoB.familyCode.length).toBe(8);

  // The first (grandfathered) family sees no cap and its OWN code.
  const infoA = await (await req(A.bearer, "GET", "/api/family/deposit-info")).json();
  expect(infoA.budget.exempt).toBe(true);
  expect(infoA.budget.availableLuna).toBeNull();
  expect(infoA.familyCode).not.toBe(infoB.familyCode);
});

test("topup-broadcast in SIM mode stays a no-op and credits nothing", async () => {
  const res = await req(B.bearer, "POST", "/api/family/topup-broadcast", { serializedTx: "aa".repeat(40) });
  expect(res.status).toBe(200);
  expect((await res.json()).sim).toBe(true);
  expect(budget.creditsLuna(B.fam.id)).toBe(0);
});

test("parseTopUpTx reads sender, recipient, value, fee and hash from a real signed tx", async () => {
  const Nimiq = await getNimiq();
  const sender = Nimiq.KeyPair.generate();
  const hot = Nimiq.KeyPair.generate();
  const tx = Nimiq.TransactionBuilder.newBasicWithData(
    sender.toAddress(), hot.toAddress(),
    new TextEncoder().encode("hatch:TESTCODE1"),
    123_000n, 0n, 1, 5,
  );
  tx.sign(sender, undefined);

  const parsed = await parseTopUpTx(tx.toHex());
  expect(parsed).not.toBeNull();
  // The SENDER is what makes attribution possible at all — see topUpExecuted.
  expect(parsed!.sender).toBe(sender.toAddress().toUserFriendlyAddress());
  expect(parsed!.recipient).toBe(hot.toAddress().toUserFriendlyAddress());
  expect(parsed!.valueLuna).toBe(123_000);
  expect(parsed!.feeLuna).toBe(0);
  expect(parsed!.txHash).toBe(tx.hash());

  // Garbage hex is not a transaction — attribution simply does not happen.
  expect(await parseTopUpTx("deadbeef".repeat(10))).toBeNull();
});

// ---- a broadcast is not a payment, and neither is the shared wallet going up ----
//
// The exploit this guards (verified against live testnet 2026-07-31): a node accepts a
// transaction signed by an EMPTY account into its mempool and hands back a hash, exactly
// as it does for a funded one. The tx then never executes. Crediting on that hash let a
// self-serve family mint unlimited payout budget and spend it out of the shared hot
// wallet.
//
// Waiting for the hot wallet's balance to RISE did not fix it, because the hot wallet is
// SHARED: an attacker sizes an unfunded tx to an inflow they expect and another
// household's deposit satisfies the wait. The gate is now the SENDER's balance falling —
// a chain fact only this transaction can produce — AND the arrival, together.

const noSleep = async () => {};
const fast = { timeoutMs: 30, pollMs: 1, sleep: noSleep };

test("topUpExecuted: false when the sender is empty and nothing moves", async () => {
  let reads = 0;
  const landed = await topUpExecuted(
    async () => { reads += 1; return 0; }, async () => 1_000,
    0, 1_000, 500_000_000, 0, fast,
  );
  expect(landed).toBe(false);
  expect(reads).toBeGreaterThan(0);
});

test("topUpExecuted: true once the sender pays value+fee AND the hot wallet receives it", async () => {
  const senders = [900_000, 900_000, 900_000 - 234_000 - 100];
  const hots = [1_000, 1_000, 1_000 + 234_000];
  let i = 0;
  const landed = await topUpExecuted(
    async () => senders[Math.min(i, senders.length - 1)]!,
    async () => hots[Math.min(i++, hots.length - 1)]!,
    900_000, 1_000, 234_000, 100, { timeoutMs: 5_000, pollMs: 1, sleep: noSleep },
  );
  expect(landed).toBe(true);
});

// THE REGRESSION PIN for the cross-household credit. The hot wallet rises by far more
// than the tx value — somebody else's money landing — while the caller's own account is
// untouched. The old balance-rise gate returned true here and paid the attacker.
test("topUpExecuted: another household's inflow can NEVER stand in for the caller's payment", async () => {
  const landed = await topUpExecuted(
    async () => 0,                    // attacker's account: empty, never moves
    async () => 1_000 + 9_000_000,    // hot wallet: someone else's 90 NIM just landed
    0, 1_000, 1_000_000, 0, fast,
  );
  expect(landed).toBe(false);
});

test("topUpExecuted: a partial arrival is NOT enough to credit", async () => {
  const landed = await topUpExecuted(
    async () => 5_000_000 - 999_999, async () => 1_000 + 999_999,
    5_000_000, 1_000, 1_000_000, 0, fast,
  );
  expect(landed).toBe(false);
});

test("topUpExecuted: the sender paying without the money arriving is not a credit either", async () => {
  const landed = await topUpExecuted(
    async () => 5_000_000 - 1_000_000, async () => 1_000, // hot wallet never moved
    5_000_000, 1_000, 1_000_000, 0, fast,
  );
  expect(landed).toBe(false);
});

test("topUpExecuted: a failing balance read is treated as no execution, never as one", async () => {
  const landed = await topUpExecuted(
    async () => { throw new Error("rpc down"); }, async () => { throw new Error("rpc down"); },
    5_000_000, 1_000, 1_000, 0, fast,
  );
  expect(landed).toBe(false);
});

test("hasBudgetCreditTx spots an already-credited tx so a replay skips the wait", () => {
  expect(budget.hasBudgetCreditTx("abc123")).toBe(false);
  expect(budget.hasBudgetCreditTx("")).toBe(false);
  budget.addBudgetCredit(B.fam.id, 1_234_000, "topup", "abc123");
  expect(budget.hasBudgetCreditTx("abc123")).toBe(true);
  // ...and it is global, so another household cannot re-claim the same on-chain tx.
  expect(budget.addBudgetCredit(A.fam.id, 1_234_000, "topup", "abc123")).toBeNull();
  expect(budget.creditsLuna(A.fam.id)).toBe(0);
});

// ---- migration grandfathering ----

test("upgrading a pre-budget DB marks every existing family exempt, later families not", async () => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/hatch-budget-migration-${crypto.randomUUID()}.db`;
  // Build an OLD-schema DB: a families table WITHOUT budget_exempt + one live household.
  const old = new Database(path);
  old.run(`CREATE TABLE families (
    id TEXT PRIMARY KEY, parent_label TEXT NOT NULL, parent_address TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'demo', pin_hash TEXT, pin_attempts INTEGER NOT NULL DEFAULT 0,
    pin_locked_until INTEGER, star_rate_luna INTEGER NOT NULL DEFAULT 10000, notify_url TEXT,
    tz TEXT NOT NULL DEFAULT 'America/Chicago', created_at INTEGER NOT NULL)`);
  old.run("INSERT INTO families (id, parent_label, parent_address, created_at) VALUES ('legacy-fam', 'Andjroo', 'NQ00', 1)");
  old.close();

  try {
    initDb(path); // schema no-ops on the existing table; migrate() adds the column + backfills
    expect(repo.getFamily("legacy-fam")!.budget_exempt).toBe(1);
    const later = repo.createFamily("Newcomer", "NQ00");
    expect(repo.getFamily(later.id)!.budget_exempt).toBe(0);

    // Re-running migrations (every later boot) must NOT re-flip newcomers.
    initDb(path);
    expect(repo.getFamily(later.id)!.budget_exempt).toBe(0);
    expect(repo.getFamily("legacy-fam")!.budget_exempt).toBe(1);
  } finally {
    initTestDb(); // hand the module DB back to the in-memory harness
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(path + suffix); } catch { /* already gone */ }
    }
  }
  // 20s, not the 5s default. This is the only test in the suite that opens a REAL on-disk
  // WAL database, twice, and every other one runs in memory — so it is the only one whose
  // wall-clock depends on the runner's disk rather than on our code. It timed out at 5.6s
  // on a shared CI runner while taking ~28ms locally, and the assertion it makes is about a
  // migration's OUTCOME, not its speed. A tight timeout here does not measure anything we
  // want measured; it just fails the build when GitHub's I/O is busy.
}, 20_000);
