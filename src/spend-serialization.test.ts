// Two approvals must never spend the same balance — CONCURRENTLY, not just in sequence.
//
// The sequential overdraft was closed by re-checking affordability at execution time
// (src/cashlink-overdraft.test.ts pins it). This file pins the concurrent case: two
// approvals for the same child fired at the same time each read the pre-spend balance
// across their await points and both proceeded. Execution now serializes per balance
// owner (src/wallet/spend-lock.ts), and value that is committed but not yet settled is
// reserved out of what a later approval considers spendable.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as approvalsRepo from "./repo-approvals";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import * as stickersRepo from "./repo-stickers";
import { newToken, sha256Hex } from "./auth";
import { walletRoutes } from "./routes/wallet";
import { approvalsRoutes } from "./routes/approvals";
import { storeRoutes } from "./routes/store";
import { executeSendRequest } from "./wallet/kid-wallet";
import { withSpendLock } from "./wallet/spend-lock";

const app = new Hono()
  .route("/api", walletRoutes)
  .route("/api", approvalsRoutes)
  .route("/api", storeRoutes);

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ada", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
  // The screen-time tiles these tests race against are only stocked for a household with a
  // tablet to spend the minutes on (#306).
  lockRepo.createDevice(fam.id, "Ada's tablet", "hash-spend-serialization", null);
  // Opening balance: 75,000 luna.
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 75_000 });
});

const auth = () => ({ Authorization: `Bearer ${bearer}` });

async function queueSend(valueLuna: number): Promise<{ approvalId: string; requestId: string }> {
  const res = await post(`/api/kids/${kid.id}/send`, { cashlink: { valueLuna } });
  expect(res.status).toBe(202);
  const body = await res.json();
  return { approvalId: body.approvalId as string, requestId: body.requestId as string };
}

const approve = (approvalId: string) => post(`/api/approvals/${approvalId}/approve`, {}, auth());

// ---- the mutex itself ----

test("withSpendLock serializes same-key work and keeps keys independent", async () => {
  const order: string[] = [];
  const slow = (label: string, ms: number) => async () => {
    order.push(`${label}:start`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${label}:end`);
  };
  await Promise.all([
    withSpendLock("k1", slow("a", 20)),
    withSpendLock("k1", slow("b", 1)),
    withSpendLock("k2", slow("c", 1)),
  ]);
  // b never starts before a ends (same key); c overlaps a (different key).
  expect(order.indexOf("b:start")).toBeGreaterThan(order.indexOf("a:end"));
  expect(order.indexOf("c:start")).toBeLessThan(order.indexOf("a:end"));
});

test("withSpendLock: a rejection reaches its caller and does not poison the chain", async () => {
  const boom = withSpendLock("k", async () => { throw new Error("boom"); });
  await expect(boom).rejects.toThrow("boom");
  await expect(withSpendLock("k", async () => "next")).resolves.toBe("next");
});

// ---- the concurrent race (ops finding: both approvals read the pre-spend balance) ----

test("execution layer: two concurrent send executions cannot both spend the same balance", async () => {
  // The service seam the approval route drives. Before the spend lock, both executions
  // read 75,000 across their await points, both passed the re-check, and both minted —
  // 100,000 luna of spendable Cashlinks against a 75,000 balance.
  const r1 = wrepo.createSendRequest(fam.id, kid.id, 50_000, null);
  const r2 = wrepo.createSendRequest(fam.id, kid.id, 50_000, null);

  const results = await Promise.allSettled([
    executeSendRequest(fam, r1),
    executeSendRequest(fam, r2),
  ]);

  const outcomes = results.map((r) => r.status).sort();
  expect(outcomes).toEqual(["fulfilled", "rejected"]);
  const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  expect(String(loser.reason?.message ?? loser.reason)).toBe("insufficient_funds");

  // Ledger consistent: one Cashlink, no negative balance, loser request still pending.
  expect(wrepo.spendableFromLedger(kid.id)).toBe(25_000);
  expect(repo.listCashlinksForChild(kid.id).length).toBe(1);
  const requests = [wrepo.getSendRequest(r1.id)!, wrepo.getSendRequest(r2.id)!];
  expect(requests.map((r) => r.status).sort()).toEqual(["executed", "pending"]);
});

test("two CONCURRENT approvals for the same child cannot both spend the same balance", async () => {
  const first = await queueSend(50_000);
  const second = await queueSend(50_000);

  const [a, b] = await Promise.all([approve(first.approvalId), approve(second.approvalId)]);

  const statuses = [a.status, b.status].sort();
  expect(statuses).toEqual([200, 400]);
  const loser = a.status === 400 ? a : b;
  // The whole shape, not just the code: the parent app keys its race handling on this
  // answer, and a refusal must never surface as a scary 502. `neededLuna` is always a
  // number — the route falls back to 0 rather than dropping through to pay_failed if the
  // request row cannot be re-read.
  const loserBody = await loser.json();
  expect(loserBody.error).toBe("insufficient_funds");
  expect(typeof loserBody.neededLuna).toBe("number");
  expect(loserBody.neededLuna).toBe(50_000);

  // The ledger never goes negative and exactly one Cashlink exists.
  expect(wrepo.spendableFromLedger(kid.id)).toBe(25_000);
  expect(repo.listCashlinksForChild(kid.id).length).toBe(1);

  // The loser is left PENDING — approvable again once the kid earns the difference.
  const pending = approvalsRepo.listApprovals(fam.id, "pending");
  expect(pending.length).toBe(1);
});

test("a concurrent send + stake approval for the same child serialize too", async () => {
  const send = await queueSend(50_000);
  const stakeRes = await post(`/api/kids/${kid.id}/stake`, { valueLuna: 50_000 });
  expect(stakeRes.status).toBe(202);
  const stakeApprovalId = (await stakeRes.json()).approvalId as string;

  const [a, b] = await Promise.all([approve(send.approvalId), approve(stakeApprovalId)]);
  expect([a.status, b.status].sort()).toEqual([200, 400]);

  // Exactly 50,000 luna moved — as a Cashlink OR into staking, never both.
  const minted = repo.listCashlinksForChild(kid.id).reduce((s, c) => s + c.value_luna, 0);
  expect(minted + wrepo.stakedFromLedger(kid.id)).toBe(50_000);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(25_000);
});

test("two concurrent instant transfers (demo mode) cannot overdraw either", async () => {
  const f = repo.createFamily("Demo", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  const demoFam = repo.getFamily(f.id)!; // mode 'demo' — the instant path
  const demoKid = repo.createChild(demoFam.id, "Rex", "🦕");
  wrepo.addWalletEvent({ familyId: demoFam.id, childId: demoKid.id, kind: "earn", valueLuna: 75_000 });

  const send = () => post(`/api/kids/${demoKid.id}/send`, { toParent: true, valueLuna: 50_000 });
  const [a, b] = await Promise.all([send(), send()]);
  expect([a.status, b.status].sort()).toEqual([200, 400]);
  expect(wrepo.spendableFromLedger(demoKid.id)).toBe(25_000);
});

test("two concurrent Treasure Box buys cannot overdraw the kid", async () => {
  const cat = stickersRepo.createCategory("Fun", null, fam.id);
  const item = stickersRepo.createStoreItem({
    categoryId: cat.id, kind: "screen_time", title: "Screen time",
    priceLuna: 50_000, payload: { minutes: 30 }, familyId: fam.id,
  });
  const buy = () => post(`/api/kids/${kid.id}/buy`, { itemId: item.id });
  const [a, b] = await Promise.all([buy(), buy()]);
  expect([a.status, b.status].sort()).toEqual([200, 400]);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(25_000);
});

// ---- a lock guards ONE invariant, and affordability was the wrong one ----
//
// Reproduced on MAINNET with real NIM (#129, 2026-08-02): three simultaneous buys of the same
// 2,000 NIM sticker pack answered 200/200/400, moved 4,000 NIM in two separate on-chain
// transactions, and left the kid owning exactly one pack. The spend lock was working — it
// serialised the debits perfectly. It was wrapped around the balance while the invariant that
// mattered was "at most one of these exists", and the ownership test sat outside it, so both
// callers passed "do you own this?" before either had charged.
//
// These fire buys that are EACH INDIVIDUALLY AFFORDABLE, which is what makes overdraft
// protection irrelevant and the ownership re-read the only thing standing in the way.

/** A pack the kid can afford several times over, and the shelf item that sells it. */
function affordablePack(priceLuna: number) {
  const cat = stickersRepo.createCategory("Stickers", null, fam.id);
  const pack = stickersRepo.listPacks()[0];
  expect(pack).toBeTruthy();
  return stickersRepo.createStoreItem({
    categoryId: cat.id, kind: "pack", title: "Space pack",
    priceLuna, payload: { packId: pack!.id }, familyId: fam.id,
  });
}

test("three concurrent buys of the same pack charge for it exactly once", async () => {
  const item = affordablePack(20_000); // 75,000 on hand: three of these are affordable
  const buy = () => post(`/api/kids/${kid.id}/buy`, { itemId: item.id });

  const results = await Promise.all([buy(), buy(), buy()]);
  const statuses = results.map((r) => r.status).sort();
  expect(statuses).toEqual([200, 400, 400]);
  for (const r of results.filter((x) => x.status === 400)) {
    expect((await r.json()).error).toBe("already_owned");
  }

  // THE POINT: one pack, one debit. It used to be one pack and two.
  const spends = wrepo.listWalletEvents(kid.id).filter((e) => e.kind === "spend");
  expect(spends.length).toBe(1);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(55_000);
  expect(stickersRepo.listPurchases(kid.id).length).toBe(1);
});

test("a timer style is the same shape and holds the same line", async () => {
  const cat = stickersRepo.createCategory("Timers", null, fam.id);
  const styleId = stickersRepo.TIMER_STYLE_IDS[0]!;
  const item = stickersRepo.createStoreItem({
    categoryId: cat.id, kind: "timer_style", title: "A timer",
    priceLuna: 20_000, payload: { styleId }, familyId: fam.id,
  });
  const buy = () => post(`/api/kids/${kid.id}/buy`, { itemId: item.id });

  const [a, b] = await Promise.all([buy(), buy()]);
  expect([a.status, b.status].sort()).toEqual([200, 400]);
  expect(wrepo.listWalletEvents(kid.id).filter((e) => e.kind === "spend").length).toBe(1);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(55_000);
});

test("a coupon is genuinely buyable twice — two ice creams is a real thing to want", async () => {
  const cat = stickersRepo.createCategory("Prizes", null, fam.id);
  const item = stickersRepo.createStoreItem({
    categoryId: cat.id, kind: "coupon", title: "Ice cream",
    priceLuna: 20_000, payload: {}, familyId: fam.id,
  });
  const buy = () => post(`/api/kids/${kid.id}/buy`, { itemId: item.id });

  const [a, b] = await Promise.all([buy(), buy()]);
  expect([a.status, b.status]).toEqual([200, 200]);
  expect(wrepo.listWalletEvents(kid.id).filter((e) => e.kind === "spend").length).toBe(2);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(35_000);
});

// ---- reservation: committed-but-unsettled value is not spendable ----

test("a broadcast-but-unconfirmed stake reserves its value against a send approval", async () => {
  // Queue the send while the full 75,000 is free, THEN a stake broadcast goes pending
  // (off-SIM the chain has not yet shown the debit — the money is spoken for).
  const send = await queueSend(50_000);
  wrepo.addWalletEvent({
    familyId: fam.id, childId: kid.id, kind: "stake", valueLuna: -40_000, status: "pending",
  });

  const res = await approve(send.approvalId);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("insufficient_funds");
  expect(repo.listCashlinksForChild(kid.id).length).toBe(0);
  expect(approvalsRepo.getApproval(send.approvalId)!.status).toBe("pending");
});

test("an approved-but-unsettled send reserves its value (crash-window state)", async () => {
  // B queues while everything is free; then A is decided 'approved' but its request never
  // settles (the process died between deciding and settling). A's value must stay reserved.
  const a = await queueSend(30_000);
  const b = await queueSend(50_000);
  expect(approvalsRepo.decideApproval(a.approvalId, "approved", "remote", null, null)).toBe(true);
  expect(wrepo.getSendRequest(a.requestId)!.status).toBe("pending");

  const res = await approve(b.approvalId);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("insufficient_funds");
  expect(repo.listCashlinksForChild(kid.id).length).toBe(0);
});

test("an approved-but-unsettled UNSTAKE reserves nothing (it adds money, never spends it)", async () => {
  // 125,000 earned, 50,000 staked -> 75,000 spendable.
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 50_000 });
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "stake", valueLuna: -50_000 });

  const un = await post(`/api/kids/${kid.id}/unstake`, { valueLuna: 20_000 });
  expect(un.status).toBe(202);
  const unBody = await un.json();
  expect(approvalsRepo.decideApproval(unBody.approvalId, "approved", "remote", null, null)).toBe(true);

  // The whole 75,000 spendable is still spendable.
  const send = await queueSend(75_000);
  const res = await approve(send.approvalId);
  expect(res.status).toBe(200);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(0);
});

// ---- reservation pins per outflow kind (sequential — the ledger reflects each at once) ----

test("a minted, still-unclaimed Cashlink already reduced what the next approval can spend", async () => {
  const first = await queueSend(50_000);
  const second = await queueSend(30_000);
  expect((await approve(first.approvalId)).status).toBe(200);
  // 25,000 left; the ready Cashlink's 50,000 is gone even though nobody claimed it yet.
  expect(repo.listCashlinksForChild(kid.id)[0]!.status).toBe("ready");
  const res = await approve(second.approvalId);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("insufficient_funds");
});

test("an executed family transfer already reduced what the next approval can spend", async () => {
  const send = await queueSend(30_000); // queued while the whole 75,000 was free
  const t = await post(`/api/kids/${kid.id}/send`, { toParent: true, valueLuna: 50_000 });
  expect(t.status).toBe(202); // family mode queues in-family transfers too
  const tBody = await t.json();
  expect((await approve(tBody.approvalId)).status).toBe(200);

  // 25,000 left — the transfer's value is gone from what the send may use.
  const res = await approve(send.approvalId);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("insufficient_funds");
});

test("a Treasure Box buy already reduced what the next approval can spend", async () => {
  const send = await queueSend(30_000); // queued while the whole 75,000 was free
  const cat = stickersRepo.createCategory("Fun", null, fam.id);
  const item = stickersRepo.createStoreItem({
    categoryId: cat.id, kind: "screen_time", title: "Screen time",
    priceLuna: 50_000, payload: { minutes: 30 }, familyId: fam.id,
  });
  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: item.id })).status).toBe(200);

  const res = await approve(send.approvalId);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("insufficient_funds");
});
