// V2 wallet core — route + service tests. Hermetic: in-memory DB, SIM mode (tests never set
// DEV_PARENT_PRIV), Hono app.request(). Covers: account provisioning, the wallet read, family
// transfers (double-entry), the parent-gated cashlink send, staking + SIM accrual (fake clock),
// and the family deposit endpoints.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as approvalsRepo from "./repo-approvals";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import { hashPin, newToken, sha256Hex } from "./auth";
import { ensureKidWallet } from "./wallet/kid-wallet";
import { walletRoutes } from "./routes/wallet";
import { approvalsRoutes } from "./routes/approvals";
import { accrueSimRewards, settlePendingUnstakes, stakingView } from "./wallet/kid-staking";
import { accruedRewardLuna } from "./nimiq/staking";

const app = new Hono().route("/api", walletRoutes).route("/api", approvalsRoutes);

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

let fam: repo.Family;
let kidA: repo.Child;
let kidB: repo.Child;
let bearer: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kidA = repo.createChild(fam.id, "Ada", "🦖");
  kidB = repo.createChild(fam.id, "Ben", "🐧");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});

/** SIM opening balance, same shape the migrate/deposit paths write. */
function fund(childId: string, valueLuna: number) {
  wrepo.addWalletEvent({
    familyId: fam.id, childId, kind: "deposit", valueLuna,
    counterpartyLabel: "Test deposit", txHash: `sim:${crypto.randomUUID()}`,
  });
}

/** v0.43: family-mode staking queues for the parent — approve the newest pending
 *  approval so the ledger assertions below stay exactly what they were. */
async function approveNext() {
  const a = approvalsRepo.listApprovals(fam.id, "pending")[0]!;
  const res = await post(`/api/approvals/${a.id}/approve`, {}, { Authorization: `Bearer ${bearer}` });
  expect(res.status).toBe(200);
}

// ---- accounts + the wallet read ----

test("GET /kids/:id/wallet DOES NOT provision: reading a screen never mints an account", async () => {
  // This test used to assert the opposite, and the reversal is the point (#381). Both clients
  // call this endpoint just to draw a screen — the parent app on its roster refresh, the kid app
  // on its login screen — so provisioning here meant a kid's account, and therefore their
  // identicon, was decided by the act of looking at them. Measured in production: a household
  // created at 04:38 had both kids provisioned in the same minute, before either had touched a
  // tablet. The character picker cannot offer a choice a page load has already made.
  const a = await (await app.request(`/api/kids/${kidA.id}/wallet`)).json();
  expect(a.address).toBeNull();
  expect(repo.getChild(kidA.id)!.account_index).toBeNull();

  // The rest of the payload is unchanged, because a kid with no account yet is an ordinary
  // household in an ordinary state, not an error. The screens render and say so.
  expect(a).toHaveProperty("balanceLuna");
  expect(a).toHaveProperty("stakedLuna");
  expect(a).toHaveProperty("pendingUnstakeLuna");
  expect(a).toHaveProperty("serverTime");
  expect(Array.isArray(a.events)).toBe(true);
});

test("an account provisioned on a MONEY path is still unique per kid and stable", async () => {
  // What the old test was really protecting: two kids never share an address, and an account
  // never moves once assigned. Both still hold; they are just no longer a side effect of a GET.
  await ensureKidWallet(kidA.id);
  await ensureKidWallet(kidB.id);
  const a = await (await app.request(`/api/kids/${kidA.id}/wallet`)).json();
  const b = await (await app.request(`/api/kids/${kidB.id}/wallet`)).json();
  expect(a.address).toMatch(/^NQ/);
  expect(b.address).toMatch(/^NQ/);
  expect(a.address).not.toBe(b.address);
  const rows = [repo.getChild(kidA.id)!, repo.getChild(kidB.id)!];
  expect(new Set(rows.map((r) => r.account_index)).size).toBe(2);
  // Idempotent: provisioning again keeps the same assignment.
  await ensureKidWallet(kidA.id);
  const again = await (await app.request(`/api/kids/${kidA.id}/wallet`)).json();
  expect(again.address).toBe(a.address);
});

// ---- family transfers (double-entry) ----

test("kid -> sibling transfer: queued for the parent, then double-entry, shared tx hash", async () => {
  fund(kidA.id, 100_000);
  const res = await post(`/api/kids/${kidA.id}/send`, { toChildId: kidB.id, valueLuna: 30_000, message: "for you!" });
  // v0.43: a family transfer is still the kid's NIM leaving their account, so it waits.
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body.status).toBe("pending_approval");
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(100_000); // queued reserves nothing
  expect(wrepo.spendableFromLedger(kidB.id)).toBe(0);
  await approveNext();
  // Approving must land EXACTLY where the instant path used to.
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(70_000);
  expect(wrepo.spendableFromLedger(kidB.id)).toBe(30_000);
  const aEvents = wrepo.listWalletEvents(kidA.id);
  const bEvents = wrepo.listWalletEvents(kidB.id);
  expect(aEvents[0]!.kind).toBe("send");
  expect(aEvents[0]!.value_luna).toBe(-30_000);
  expect(bEvents[0]!.kind).toBe("deposit");
  expect(bEvents[0]!.value_luna).toBe(30_000);
  expect(aEvents[0]!.tx_hash).toBe(bEvents[0]!.tx_hash); // one transfer, one hash
  expect(bEvents[0]!.counterparty_label).toBe("Ada");
});

test("kid -> parent transfer: queued, then a single 'send' row, no phantom deposit", async () => {
  fund(kidA.id, 50_000);
  const res = await post(`/api/kids/${kidA.id}/send`, { toParent: true, valueLuna: 20_000 });
  expect(res.status).toBe(202);
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(50_000);
  await approveNext();
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(30_000);
  expect(wrepo.listWalletEvents(kidA.id)[0]!.counterparty_label).toBe("Family wallet");
});

test("a REJECTED family transfer moves nothing at all", async () => {
  fund(kidA.id, 50_000);
  const res = await post(`/api/kids/${kidA.id}/send`, { toParent: true, valueLuna: 20_000 });
  expect(res.status).toBe(202);
  const a = approvalsRepo.listApprovals(fam.id, "pending")[0]!;
  const rej = await post(`/api/approvals/${a.id}/reject`, {}, { Authorization: `Bearer ${bearer}` });
  expect(rej.status).toBe(200);
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(50_000);
  expect(wrepo.getSendRequest((await res.json()).sendRequestId)!.status).toBe("rejected");
});

test("transfer guards refuse BEFORE the queue: insufficient funds, self-send, missing target", async () => {
  fund(kidA.id, 10_000);
  expect((await post(`/api/kids/${kidA.id}/send`, { toChildId: kidB.id, valueLuna: 20_000 })).status).toBe(400);
  expect((await post(`/api/kids/${kidA.id}/send`, { toChildId: kidA.id, valueLuna: 1_000 })).status).toBe(400);
  expect((await post(`/api/kids/${kidA.id}/send`, { valueLuna: 1_000 })).status).toBe(400);
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(10_000); // nothing moved
  // and nothing was parked in front of the parent either
  expect(approvalsRepo.listApprovals(fam.id, "pending").length).toBe(0);
});

// ---- cashlink send: parent-gated ----

test("cashlink send requires parent approval; approve mints from the KID's account", async () => {
  fund(kidA.id, 200_000);
  const res = await post(`/api/kids/${kidA.id}/send`, { cashlink: { valueLuna: 50_000, message: "grandma" } });
  expect(res.status).toBe(202);
  const { approvalId, sendRequestId } = await res.json();
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(200_000); // funds NOT moved yet
  expect(approvalsRepo.getApproval(approvalId)!.subject_kind).toBe("send");

  const approve = await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" });
  expect(approve.status).toBe(200);
  const body = await approve.json();
  expect(body.cashlinkUrl).toContain("cashlink");
  const req = wrepo.getSendRequest(sendRequestId)!;
  expect(req.status).toBe("executed");
  const cl = repo.getCashlink(req.cashlink_id!)!;
  expect(cl.kind).toBe("peer");
  expect(cl.child_id).toBe(kidA.id);
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(150_000); // now it moved
  expect(wrepo.listWalletEvents(kidA.id)[0]!.kind).toBe("send");
});

test("cashlink send: reject leaves the money and marks the request rejected", async () => {
  fund(kidA.id, 100_000);
  const res = await post(`/api/kids/${kidA.id}/send`, { cashlink: { valueLuna: 40_000 } });
  const { approvalId, sendRequestId } = await res.json();
  const reject = await post(`/api/approvals/${approvalId}/reject`, { pin: "1234", note: "not this week" });
  expect(reject.status).toBe(200);
  expect(wrepo.getSendRequest(sendRequestId)!.status).toBe("rejected");
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(100_000);
  expect(repo.listCashlinksForChild(kidA.id).length).toBe(0);
});

test("cashlink send with insufficient balance 400s without opening an approval", async () => {
  fund(kidA.id, 10_000);
  const res = await post(`/api/kids/${kidA.id}/send`, { cashlink: { valueLuna: 50_000 } });
  expect(res.status).toBe(400);
  expect(approvalsRepo.listApprovals(fam.id, "pending").length).toBe(0);
});

// ---- scanned send: same gate as a cashlink, but it has a destination ----
// A kid pointing a camera at a code must NEVER be a straight-to-send path; the
// scan only ever opens the same approval a Cashlink opens.

const SCANNED = "NQ52 JS5K TUMA LFFV EQC1 UEP0 7H2A JEA2 76FB";

test("a scanned send moves no money until a parent approves, then lands at that address", async () => {
  fund(kidA.id, 200_000);
  const res = await post(`/api/kids/${kidA.id}/send`, {
    scanned: { toAddress: SCANNED, valueLuna: 50_000, message: "book club" },
  });
  expect(res.status).toBe(202);
  const { approvalId, sendRequestId } = await res.json();
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(200_000); // nothing moved on the scan

  const req = wrepo.getSendRequest(sendRequestId)!;
  expect(req.kind).toBe("address");
  expect(req.to_address).toBe(SCANNED);

  const approve = await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" });
  expect(approve.status).toBe(200);
  expect(wrepo.getSendRequest(sendRequestId)!.status).toBe("executed");
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(150_000);
  const ev = wrepo.listWalletEvents(kidA.id)[0]!;
  expect(ev.kind).toBe("send");
  expect(ev.counterparty_address).toBe(SCANNED);
  // a scanned send is a transfer, not a claimable link
  expect(repo.listCashlinksForChild(kidA.id).length).toBe(0);
});

test("rejecting a scanned send leaves every luna where it was", async () => {
  fund(kidA.id, 120_000);
  const res = await post(`/api/kids/${kidA.id}/send`, { scanned: { toAddress: SCANNED, valueLuna: 90_000 } });
  const { approvalId, sendRequestId } = await res.json();
  expect((await post(`/api/approvals/${approvalId}/reject`, { pin: "1234" })).status).toBe(200);
  expect(wrepo.getSendRequest(sendRequestId)!.status).toBe("rejected");
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(120_000);
});

test("a malformed scanned code is refused outright, never queued for a parent", async () => {
  fund(kidA.id, 200_000);
  for (const bad of ["", "hello world", "NQ52 JS5K", "0xdeadbeef", "NQ52JS5KTUMALFFVEQC1UEP07H2AJEA276FBEXTRA"]) {
    const res = await post(`/api/kids/${kidA.id}/send`, { scanned: { toAddress: bad, valueLuna: 10_000 } });
    expect(res.status, bad).toBe(400);
  }
  expect(approvalsRepo.listApprovals(fam.id, "pending").length).toBe(0);
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(200_000);
});

test("an address that is the right SHAPE but not a real address is refused too", async () => {
  // Regression, verified on testnet 2026-07-31: the shape regex alone let all three of
  // these queue and ping the parent; approving then threw "Invalid checksum" AFTER the
  // approval was decided, burning it (409 on retry) and stranding the send request in
  // 'pending' forever. The address is typed by hand now, so a one-key typo is the
  // common case, not the exotic one.
  fund(kidA.id, 200_000);
  const shapedButFake = [
    "NQ53 JS5K TUMA LFFV EQC1 UEP0 7H2A JEA2 76FB", // checksum digits off by one
    "NQ52 JS5K TUMA LFFV EQC1 UEP0 7H2A JEA2 76FC", // one-key typo in the body
    "NQ52 IOWZ TUMA LFFV EQC1 UEP0 7H2A JEA2 76FB", // I/O/W/Z: not in Nimiq's base32
  ];
  for (const bad of shapedButFake) {
    const res = await post(`/api/kids/${kidA.id}/send`, { scanned: { toAddress: bad, valueLuna: 10_000 } });
    expect(res.status, bad).toBe(400);
    expect((await res.json()).error, bad).toBe("invalid_address");
  }
  expect(approvalsRepo.listApprovals(fam.id, "pending").length).toBe(0);
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(200_000);
});

test("a scanned code is accepted spaced or bare, and stored in the wallet's spaced form", async () => {
  fund(kidA.id, 200_000);
  const bare = SCANNED.replace(/\s+/g, "");
  const res = await post(`/api/kids/${kidA.id}/send`, { scanned: { toAddress: `nimiq:${bare}`, valueLuna: 10_000 } });
  expect(res.status).toBe(202);
  const { sendRequestId } = await res.json();
  expect(wrepo.getSendRequest(sendRequestId)!.to_address).toBe(SCANNED);
});

// ---- staking ----

test("stake locks spendable NIM; unstake goes pending then releases after the cooldown", async () => {
  fund(kidA.id, 500_000);
  const stakeRes = await post(`/api/kids/${kidA.id}/stake`, { valueLuna: 200_000 });
  expect(stakeRes.status).toBe(202); // family mode: queued for the parent (v0.43)
  await approveNext();
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(300_000);
  expect(wrepo.stakedFromLedger(kidA.id)).toBe(200_000);

  const unstakeRes = await post(`/api/kids/${kidA.id}/unstake`, { valueLuna: 80_000 });
  expect(unstakeRes.status).toBe(202);
  await approveNext();
  expect(wrepo.stakedFromLedger(kidA.id)).toBe(120_000);        // leaves the stake immediately
  expect(wrepo.pendingUnstakeFromLedger(kidA.id)).toBe(80_000); // ...but is NOT spendable yet
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(300_000);

  // fake clock: past the SIM cooldown the pending unstake settles into spendable
  const child = repo.getChild(kidA.id)!;
  await settlePendingUnstakes(child, Date.now() + 120_000);
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(380_000);
  expect(wrepo.pendingUnstakeFromLedger(kidA.id)).toBe(0);
});

test("staking guards: cannot stake more than spendable or unstake more than staked", async () => {
  fund(kidA.id, 50_000);
  // The precheck runs at QUEUE time, so an unaffordable ask is refused before any parent sees it.
  expect((await post(`/api/kids/${kidA.id}/stake`, { valueLuna: 100_000 })).status).toBe(400);
  await post(`/api/kids/${kidA.id}/stake`, { valueLuna: 30_000 });
  await approveNext();
  expect((await post(`/api/kids/${kidA.id}/unstake`, { valueLuna: 40_000 })).status).toBe(400);
});

test("SIM accrual: 12% APY daily tick, auto-restaked, idempotent within the same day", async () => {
  fund(kidA.id, 500_000);
  await post(`/api/kids/${kidA.id}/stake`, { valueLuna: 200_000 });
  await approveNext(); // executing the stake sets the accrual clock
  const t0 = Number(wrepo.getWalletState(`sim_accrual:${kidA.id}`));
  const day = 24 * 60 * 60 * 1000;

  // pure math first: 2 NIM at 12%/365 for 1 day
  expect(accruedRewardLuna(200_000, day)).toBe(Math.round(200_000 * 0.12 / 365));
  expect(accruedRewardLuna(200_000, day - 1)).toBe(0); // sub-day: nothing

  const reward = accrueSimRewards(fam.id, kidA.id, t0 + day);
  expect(reward).toBe(66); // round(200000 * 0.12/365)
  expect(wrepo.stakedFromLedger(kidA.id)).toBe(200_066); // restaked, balance GROWS
  expect(wrepo.rewardsFromLedger(kidA.id)).toBe(66);
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(300_000); // rewards are staked, not spendable

  // same instant again -> no double accrual
  expect(accrueSimRewards(fam.id, kidA.id, t0 + day)).toBe(0);
  // three more days on the grown principal
  const r3 = accrueSimRewards(fam.id, kidA.id, t0 + 4 * day);
  expect(r3).toBe(Math.round(200_066 * 0.12 / 365 * 3));

  const view = await stakingView(fam, kidA.id, t0 + 4 * day);
  expect(view.estApyPct).toBe(12);
  expect(view.rewardsEarnedLuna).toBe(66 + r3);
});

// ---- deposits + rates ----

test("deposit-info is parent-gated and returns the hot wallet address + QR payload", async () => {
  expect((await app.request("/api/family/deposit-info")).status).toBe(401);
  const res = await app.request("/api/family/deposit-info", { headers: { Authorization: `Bearer ${bearer}` } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.address).toMatch(/^NQ/);
  expect(body.qr.startsWith("nimiq:NQ")).toBe(true);
  expect(body.sim).toBe(true);
});

test("deposit-check (SIM) snapshots without inventing deposits", async () => {
  const res = await post("/api/family/deposit-check", {}, { Authorization: `Bearer ${bearer}` });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.deltaLuna).toBe(0);
  expect(body.sim).toBe(true);
});

test("GET /rates returns nimUsd + the per-currency map (static in tests)", async () => {
  const res = await app.request("/api/rates");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.nimUsd).toBe(0.002);
  expect(body.nim).toEqual({ usd: 0.002 });
});

test("GET /wallet/balance is public (chain data), validates the address, and answers 0 in SIM", async () => {
  const addr = "NQ49 UB2X R3UJ RLDT GG80 KMGE 4K7V 0JSK 4QJK";
  const bad = await app.request("/api/wallet/balance?address=nope");
  expect(bad.status).toBe(400);
  const ok = await app.request(`/api/wallet/balance?address=${encodeURIComponent(addr)}`);
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ balanceLuna: 0, sim: true });
});

// ---- migration shape (script logic mirrored at the repo level) ----

test("stars-to-NIM conversion shape: deposit row + star ledger zeroed keeps both invariants", () => {
  approvalsRepo.addStarEvent(fam.id, kidA.id, 14, "adjust");
  const stars = repo.getChild(kidA.id)!.star_balance;
  const valueLuna = stars * fam.star_rate_luna;
  wrepo.addWalletEvent({ familyId: fam.id, childId: kidA.id, kind: "deposit", valueLuna, counterpartyLabel: "Star conversion" });
  approvalsRepo.addStarEvent(fam.id, kidA.id, -stars, "adjust");
  expect(repo.getChild(kidA.id)!.star_balance).toBe(0);
  expect(approvalsRepo.starBalanceFromLedger(kidA.id)).toBe(0);
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(14 * fam.star_rate_luna);
});
