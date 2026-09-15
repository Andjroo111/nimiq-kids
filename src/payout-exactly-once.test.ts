// A payout must be EXACTLY-ONCE, not merely idempotent-on-success.
//
// Making a failed payout retriable introduced a way to pay a kid twice, and the hole is in
// the gap between "the node took the transaction" and "we heard that it did". The ledger row
// is written after the broadcast returns, so a node that accepts a transaction and then loses
// the response on the way back (RPC timeout, socket hang-up, tunnel blip) leaves NO row. Read
// that absence as "nothing was sent" and the retry builds a second transaction — and because
// validityStartHeight has advanced it is byte-different, hashes differently, and no node
// dedupes it. Two payments, one chore, one ledger row: invisible to every screen and to the
// budget that is supposed to cap the shared hot wallet.
//
// What the design has to hold, and what these tests pin:
//   1. at most ONE transaction is ever put on the wire per payout, whatever fails and
//      however many times a parent taps approve
//   2. a failure that provably predates the broadcast still retries cleanly, building fresh
//   3. a failure AFTER the broadcast replays the same bytes rather than rebuilding
//   4. a provider that will not surrender its bytes fails CLOSED — no retry is offered
//   5. neither the budget nor the reject button can be used against a payout that moved

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as approvalsRepo from "./repo-approvals";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import { hashPin, newToken, sha256Hex } from "./auth";
import { approvalsRoutes } from "./routes/approvals";
import { chores as choreRoutes } from "./routes/chores";
import { routinesRoutes } from "./routes/routines";
import { walletRoutes } from "./routes/wallet";
import { type PreparedTx } from "./wallet";
import {
  _setEarnChain, payoutMayHaveLanded, payoutRefFor, payoutRetryIsSafe, type EarnChain,
} from "./wallet/kid-wallet";

const app = new Hono()
  .route("/api", approvalsRoutes)
  .route("/api", choreRoutes)
  .route("/api", routinesRoutes)
  .route("/api", walletRoutes);

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

/**
 * A node that ACCEPTS the transaction and then loses the response — the case the ledger row
 * cannot see. `landed` counts what the chain actually took, so "was this paid twice?" is
 * answerable without believing anything the app wrote down.
 *
 * It implements the prepare/broadcast pair, like the real DevProvider, so `prepared` is a
 * frozen transaction: replaying it is replaying ONE payment, and a fresh `prepareTransaction`
 * call is the thing that would create a second.
 */
class LosesTheResponse implements EarnChain {
  landed = 0;
  prepares = 0;
  loseNext = 0;
  failPrepareNext = 0;
  private seq = 0;
  private seen = new Set<string>();

  async prepare(): Promise<PreparedTx | null> {
    if (this.failPrepareNext > 0) {
      this.failPrepareNext--;
      throw new Error("rpc_unreachable"); // head-height read failed: nothing was built
    }
    this.prepares++;
    // A distinct transaction per build — exactly like a real rebuild at a new head height.
    const txHash = String(++this.seq).padStart(64, "0");
    return { rawTxHex: `raw-${txHash}`, txHash };
  }

  async broadcast(rawTxHex: string): Promise<string> {
    // The chain only ever holds DISTINCT transactions. Replaying identical bytes is the
    // same transaction arriving again, which a chain cannot apply twice — so it is not
    // counted, and that is precisely the property the retry path relies on.
    if (!this.seen.has(rawTxHex)) {
      this.seen.add(rawTxHex);
      this.landed++;
    }
    if (this.loseNext > 0) {
      this.loseNext--;
      throw new Error("fetch failed: socket hang up"); // ...but the money HAS moved
    }
    return rawTxHex.replace("raw-", "");
  }

  async send(): Promise<string> {
    const p = (await this.prepare())!;
    await this.broadcast(p.rawTxHex);
    return p.txHash;
  }
}

/** An injected wallet that signs and broadcasts in one opaque step and never surrenders the
 *  bytes. Nothing can be replayed, so a failure is unresolvable by construction. */
class OpaqueWallet implements EarnChain {
  landed = 0;
  loseNext = 0;
  async send(): Promise<string> {
    this.landed++; // the node took it
    if (this.loseNext > 0) {
      this.loseNext--;
      throw new Error("fetch failed: socket hang up");
    }
    return "d".repeat(64);
  }
}

const REWARD = 30_000;
let fam: repo.Family;
let kid: repo.Child;
let bearer: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  savedEnv.grant = process.env.HATCH_DEMO_GRANT_LUNA;
  savedEnv.gf = process.env.HATCH_GRANDFATHER_FIRST;
  initTestDb();
  const f = repo.createFamily("Dad", "NQ07 1111 1111 1111 1111 1111 1111 1111 1111");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ada", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});

afterEach(() => {
  _setEarnChain(null);
  for (const [k, v] of [["HATCH_DEMO_GRANT_LUNA", savedEnv.grant], ["HATCH_GRANDFATHER_FIRST", savedEnv.gf]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const auth = () => ({ Authorization: `Bearer ${bearer}` });
const approve = (id: string) => post(`/api/approvals/${id}/approve`, {}, auth());
const earnRowsFor = (id: string) => wrepo.listWalletEvents(id).filter((e) => e.kind === "earn");
const earnRows = () => earnRowsFor(kid.id);
/** Off-SIM an earn row is written PENDING until the chain proves it executed (v0.47.0), so
 *  the ledger's spendable total is not the question here — "was the kid paid, once?" is. */
const paidLuna = () => earnRows().reduce((n, e) => n + e.value_luna, 0);

async function submittedChore(rewardLuna = REWARD) {
  const chore = repo.createChore(fam.id, kid.id, "Dishes", rewardLuna);
  expect((await post(`/api/chores/${chore.id}/submit`)).status).toBe(200);
  return {
    choreId: chore.id,
    approvalId: approvalsRepo.pendingApprovalFor("chore", chore.id)!.id,
    ref: payoutRefFor("chore", chore.id),
  };
}

// ============================================================================
// 1. The lost response — the case that paid twice.
// ============================================================================

test("a payout whose response was lost is never broadcast as a second transaction", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const { choreId, approvalId, ref } = await submittedChore();
  provider.loseNext = 1;

  const failed = await approve(approvalId);
  expect(failed.status).toBe(502);
  expect(provider.landed).toBe(1);   // the chain already holds the kid's 30_000
  expect(earnRows().length).toBe(0); // and the ledger cannot see it

  // The claim written BEFORE the broadcast is what survives to say so.
  expect(payoutMayHaveLanded(ref)).toBe(true);
  expect(wrepo.getPayoutAttempt(ref)!.status).toBe("in_flight");

  const retry = await approve(approvalId);
  expect(retry.status).toBe(200);
  expect(repo.getChore(choreId)!.status).toBe("approved");

  // THE POINT: one chore, one payment. The retry replayed the same transaction.
  expect(provider.landed).toBe(1);
  expect(provider.prepares).toBe(1); // nothing was ever rebuilt
  expect(earnRows().length).toBe(1);
  expect(paidLuna()).toBe(REWARD);
});

test("the direct chore-approve route holds the same line", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const { choreId } = await submittedChore();
  provider.loseNext = 1;
  expect((await post(`/api/chores/${choreId}/approve`, { pin: "1234" })).status).toBe(502);
  expect(provider.landed).toBe(1);
  expect((await post(`/api/chores/${choreId}/approve`, { pin: "1234" })).status).toBe(200);
  expect(provider.landed).toBe(1);
  expect(provider.prepares).toBe(1);
});

test("repeated lost responses do not compound", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const { approvalId } = await submittedChore();
  provider.loseNext = 3;
  for (let i = 0; i < 3; i++) expect((await approve(approvalId)).status).toBe(502);
  expect((await approve(approvalId)).status).toBe(200);
  expect(provider.landed).toBe(1);   // four attempts, one payment
  expect(provider.prepares).toBe(1);
  expect(earnRows().length).toBe(1);
});

test("two parents approving at once cannot land two payments", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const { approvalId } = await submittedChore();
  provider.loseNext = 1;
  const [a, b] = await Promise.all([approve(approvalId), approve(approvalId)]);
  // Whatever the pair of statuses, the money is what matters: the second caller found the
  // claim rather than an absent ledger row, and replayed instead of building.
  expect([a.status, b.status].every((s) => s === 200 || s === 502)).toBe(true);
  expect(provider.landed).toBe(1);
  expect(provider.prepares).toBe(1);
  expect(earnRows().length).toBeLessThanOrEqual(1);
});

// ============================================================================
// 2. A failure that provably predates the broadcast is still cleanly retriable —
//    the whole point of the rollback, kept intact.
// ============================================================================

test("a payout that fails before anything is built retries clean, and builds fresh", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const { choreId, approvalId, ref } = await submittedChore();
  provider.failPrepareNext = 1;

  const failed = await approve(approvalId);
  expect(failed.status).toBe(502);
  expect((await failed.json()).reopened).toBe(true);
  expect(provider.landed).toBe(0);
  // Nothing crossed the wire, so the claim is released rather than left blocking.
  expect(wrepo.getPayoutAttempt(ref)).toBe(null);
  expect(payoutMayHaveLanded(ref)).toBe(false);
  expect(approvalsRepo.getApproval(approvalId)!.status).toBe("pending");
  expect(repo.getChore(choreId)!.status).toBe("submitted");

  expect((await approve(approvalId)).status).toBe(200);
  expect(provider.landed).toBe(1);
  expect(earnRows().length).toBe(1);
});

// ============================================================================
// 3. Fail closed when the outcome is genuinely unknowable.
// ============================================================================

test("an opaque provider's lost response is never retried into a second payment", async () => {
  const provider = new OpaqueWallet();
  _setEarnChain(provider);
  const { choreId, approvalId, ref } = await submittedChore();
  provider.loseNext = 1;

  const failed = await approve(approvalId);
  expect(failed.status).toBe(502);
  expect(provider.landed).toBe(1);
  // There are no bytes to replay, so retrying is NOT offered: the approval stays decided
  // rather than going back in front of a parent as something to tap again.
  expect((await failed.json()).reopened).toBe(false);
  expect(payoutRetryIsSafe(ref)).toBe(false);
  expect(approvalsRepo.getApproval(approvalId)!.status).toBe("approved");

  // And the door really is shut: re-approving cannot send anything.
  expect((await approve(approvalId)).status).toBe(409);
  expect(provider.landed).toBe(1);
  expect(repo.getChore(choreId)!.status).toBe("submitted");
});

// ============================================================================
// 4. The states a landed payout must make unreachable.
// ============================================================================

test("a reopened approval whose payout landed is not re-charged to the family budget", async () => {
  process.env.HATCH_GRANDFATHER_FIRST = "0";
  process.env.HATCH_DEMO_GRANT_LUNA = "40000"; // room for one 30_000 payout, not two
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const f2 = repo.createFamily("Mum", "NQ07 2222 2222 2222 2222 2222 2222 2222 2222");
  repo.updateFamilySettings(f2.id, { mode: "family" });
  const fam2 = repo.getFamily(f2.id)!;
  const kid2 = repo.createChild(fam2.id, "Bo", "🐙");
  const tok = newToken();
  lockRepo.createParentToken(fam2.id, "phone", await sha256Hex(tok));
  const chore = repo.createChore(fam2.id, kid2.id, "Bins", REWARD);
  await post(`/api/chores/${chore.id}/submit`);
  const apId = approvalsRepo.pendingApprovalFor("chore", chore.id)!.id;
  const hdr = { Authorization: `Bearer ${tok}` };

  expect((await post(`/api/approvals/${apId}/approve`, {}, hdr)).status).toBe(200);
  expect(provider.landed).toBe(1);

  // The money moved and was recorded; something after it threw, so the approval went back
  // in the queue. The budget must not now refuse the retry for the money it itself spent.
  expect(approvalsRepo.reopenApproval(apId)).toBe(true);
  const retry = await post(`/api/approvals/${apId}/approve`, {}, hdr);
  expect(retry.status).toBe(200);
  expect(approvalsRepo.getApproval(apId)!.status).toBe("approved");
  expect(approvalsRepo.listApprovals(fam2.id, "pending")).toHaveLength(0);
  expect(provider.landed).toBe(1); // still exactly one payment
  expect(earnRowsFor(kid2.id).length).toBe(1);
});

test("a chore whose payout landed cannot be rejected", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const { choreId, approvalId } = await submittedChore();
  expect((await approve(approvalId)).status).toBe(200);
  expect(approvalsRepo.reopenApproval(approvalId)).toBe(true);

  const rejected = await post(`/api/approvals/${approvalId}/reject`, {}, auth());
  expect(rejected.status).toBe(409);
  expect((await rejected.json()).error).toBe("already_paid");
  expect(repo.getChore(choreId)!.status).toBe("approved");
  expect(paidLuna()).toBe(REWARD);

  // The direct chore-reject route is the same door and is shut too.
  const direct = await post(`/api/chores/${choreId}/reject`, { pin: "1234" });
  expect(direct.status).toBe(409);
  expect(repo.getChore(choreId)!.status).toBe("approved");
});

test("a routine whose payout landed cannot be rejected back into a re-submittable run", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const routine = routines.createRoutine(fam.id, kid.id, "Morning", "morning");
  routines.addTask(routine.id, "Brush teeth", 120, { rewardLuna: REWARD });
  const { run, taskRuns } = routines.todayRun(routine, routines.localDay(fam.tz));
  for (const tr of taskRuns) await post(`/api/task-runs/${tr.id}/done`);
  const apId = approvalsRepo.pendingApprovalFor("routine_run", run.id)!.id;
  expect((await approve(apId)).status).toBe(200);
  approvalsRepo.reopenApproval(apId);

  // Reject would set the run back to in_progress, where re-submitting mints a NEW approval
  // id — a new payout key — and pays the same work a second time with no failure involved.
  expect((await post(`/api/approvals/${apId}/reject`, {}, auth())).status).toBe(409);
  expect(routines.getRun(run.id)!.status).toBe("approved");
  expect(provider.landed).toBe(1);
  expect(paidLuna()).toBe(REWARD);
});

// ============================================================================
// 5. THE REPAY — the one route whose whole job is sending money a second time.
//    It used to send it outside every guarantee above: no key, so no claim, no
//    arming, no replay, and nothing telling the CHORE it had been paid.
// ============================================================================

/** Prove the payout did not execute, the way the sweeper does once the node says so. */
const writeOff = (eventId: string) => wrepo.markWalletEventFailed(eventId);
const repay = (eventId: string) => post(`/api/family/earns/${eventId}/repay`, {}, auth());

test("a repay whose response is lost replays that transaction rather than sending a second", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const { approvalId } = await submittedChore();
  expect((await approve(approvalId)).status).toBe(200);
  const first = earnRows()[0]!;
  writeOff(first.id); // the chain reported it included and failed: the kid has nothing
  expect(earnRows().length).toBe(0);

  provider.loseNext = 1;
  expect((await repay(first.id)).status).toBe(502);
  expect(provider.landed).toBe(2); // the chain now holds the replacement transaction...
  expect(earnRows().length).toBe(0); // ...and the ledger cannot see it at all

  // The parent taps Pay again. Before the key, this rebuilt at a new validityStartHeight
  // and the kid was paid twice out of the hot wallet.
  expect((await repay(first.id)).status).toBe(200);
  expect(provider.landed).toBe(2);
  expect(provider.prepares).toBe(2); // one build per payout, never a third
  expect(paidLuna()).toBe(REWARD);
});

test("repeated lost responses on a repay do not compound", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const { approvalId } = await submittedChore();
  expect((await approve(approvalId)).status).toBe(200);
  const first = earnRows()[0]!;
  writeOff(first.id);

  provider.loseNext = 3;
  for (let i = 0; i < 3; i++) expect((await repay(first.id)).status).toBe(502);
  expect((await repay(first.id)).status).toBe(200);
  expect(provider.landed).toBe(2); // four taps after the write-off, one replacement payment
  expect(provider.prepares).toBe(2);
});

test("a repaid chore is paid, so handing it in again cannot pay it a second time", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const { choreId, approvalId, ref } = await submittedChore();
  expect((await approve(approvalId)).status).toBe(200);
  const first = earnRows()[0]!;
  writeOff(first.id);
  // The write-off retires the key on purpose — that is what makes the work payable again.
  expect(payoutMayHaveLanded(ref)).toBe(false);

  expect((await repay(first.id)).status).toBe(200);
  expect(provider.landed).toBe(2);

  // THE POINT: the replacement took the retired key back, so the CHORE knows it was paid.
  expect(payoutMayHaveLanded(ref)).toBe(true);
  expect(wrepo.walletEventForPayoutRef(ref)!.status).toBe("pending");

  // A kid tablet re-handing in an approved job is refused outright...
  const resubmit = await post(`/api/chores/${choreId}/submit`);
  expect(resubmit.status).toBe(409);
  expect(approvalsRepo.pendingApprovalFor("chore", choreId)).toBe(null);

  // ...and even reaching the approve route by another door cannot move money again.
  expect((await post(`/api/chores/${choreId}/approve`, { pin: "1234" })).status).toBe(409);
  expect(provider.landed).toBe(2);
  expect(paidLuna()).toBe(REWARD);
});

test("a repaid chore cannot be rejected out from under the kid who now holds the NIM", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  const { choreId, approvalId } = await submittedChore();
  expect((await approve(approvalId)).status).toBe(200);
  const first = earnRows()[0]!;
  writeOff(first.id);
  expect((await repay(first.id)).status).toBe(200);

  const direct = await post(`/api/chores/${choreId}/reject`, { pin: "1234" });
  expect(direct.status).toBe(409);
  expect((await direct.json()).error).toBe("already_paid");
  expect(repo.getChore(choreId)!.status).toBe("approved");
});

test("an opaque provider's lost repay fails closed, exactly like the first payment", async () => {
  const provider = new OpaqueWallet();
  _setEarnChain(provider);
  const { approvalId } = await submittedChore();
  expect((await approve(approvalId)).status).toBe(200);
  const first = earnRows()[0]!;
  writeOff(first.id);

  provider.loseNext = 1;
  expect((await repay(first.id)).status).toBe(502);
  expect(provider.landed).toBe(2);
  // No bytes to replay, so the outcome is unknowable and nothing else is ever sent for it.
  const again = await repay(first.id);
  expect(again.status).toBe(502);
  expect((await again.json()).detail).toContain("payout_unresolved");
  expect(provider.landed).toBe(2);
});

test("a payout that never had a key still gets one for its repay", async () => {
  const provider = new LosesTheResponse();
  _setEarnChain(provider);
  // A direct gift carries the 'fund' key; a legacy row carries none at all. Either way the
  // repay must not fall back to the keyless path the claim exists to replace.
  const ev = wrepo.addWalletEvent({
    familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: REWARD,
    message: "Pocket money", txHash: "a".repeat(64), status: "pending",
  });
  writeOff(ev.id);
  expect(wrepo.getWalletState(wrepo.retiredPayoutRefKey(ev.id))).toBe(null);

  provider.loseNext = 1;
  expect((await repay(ev.id)).status).toBe(502);
  expect((await repay(ev.id)).status).toBe(200);
  expect(provider.landed).toBe(1);
  expect(provider.prepares).toBe(1);
  expect(payoutMayHaveLanded(payoutRefFor("repay", ev.id))).toBe(true);
});

// ============================================================================
// 6. The claim is a database guarantee, not a convention.
// ============================================================================

test("one payout ref can only ever own one attempt row", async () => {
  const { ref } = await submittedChore();
  const mk = () => wrepo.claimPayoutAttempt({
    ref, familyId: fam.id, childId: kid.id,
    valueLuna: REWARD, recipient: "NQ07 3333 3333 3333 3333 3333 3333 3333 3333",
  });
  const first = mk();
  wrepo.armPayoutAttempt(ref, "raw-abc", "abc");
  const second = mk(); // a concurrent caller finds the claim, it does not open a new one
  expect(second.created_at).toBe(first.created_at);
  expect(second.status).toBe("in_flight");
  expect(second.raw_tx_hex).toBe("raw-abc");
  // ...and an in-flight claim is never released by the pre-broadcast cleanup.
  wrepo.releasePayoutAttempt(ref);
  expect(wrepo.getPayoutAttempt(ref)!.status).toBe("in_flight");
});
