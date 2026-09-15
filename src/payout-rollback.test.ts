// A failed chore or routine payout must return the approval to a RETRIABLE state.
//
// The send path already worked this way: decide, apply, and on failure put the approval back
// in the queue. The EARN path (chore + routine reward) did not. It settled the subject first,
// then paid, so an RPC that threw left the approval reading 'approved', the chore reading
// 'approved', and no NIM anywhere — invisible to every screen, and 409 on every retry. The
// parent's only recovery was to pay the kid by hand.
//
// What the fix has to hold, and what these tests pin:
//   1. a payout that fails leaves the approval pending and the chore/run untouched
//   2. the retry SUCCEEDS (200, not 409) and pays exactly once
//   3. a payment that already landed is never made twice, however often it is retried
//   4. rollback happens INSIDE the family spend lock, and leaves nothing reserved behind
//
// Pre-fix, (1) (2) and (3) all fail: the approval stays 'approved', the retry answers 409,
// and there is no idempotency key on the payout at all.

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
import { starsRoutes } from "./routes/stars";
import { cashlinks, maybeMintStreakBonus } from "./routes/cashlinks";
import { _setProvider, type PreparedTx, type WalletProvider } from "./wallet";
import { _setEarnChain, availableKidLuna, reservedOutflowLuna, type EarnChain } from "./wallet/kid-wallet";
import { familySpendKey, withSpendLock } from "./wallet/spend-lock";

const app = new Hono()
  .route("/api", approvalsRoutes)
  .route("/api", choreRoutes)
  .route("/api", routinesRoutes)
  .route("/api", starsRoutes)
  .route("/api", cashlinks);

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

/**
 * The node is down, then it is not. Counts only the broadcasts that actually went out, so
 * "was this paid twice?" is answerable without reading the ledger.
 *
 * It splits build-and-sign from broadcast exactly as DevProvider does, and fails at the
 * BUILD — which is where an unreachable node really fails, since reading the head height is
 * the first thing a build does. That distinction is load-bearing: a failure there is
 * provably pre-broadcast, so the payout is retriable with a fresh transaction. A failure
 * during the broadcast is a different animal (the money may have moved) and is exercised in
 * payout-exactly-once.test.ts.
 */
class FlakyChain implements EarnChain {
  broadcasts = 0;
  failures = 0;
  private seq = 0;
  constructor(public failNext = 0) {}
  async prepare(): Promise<PreparedTx | null> {
    if (this.failNext > 0) {
      this.failNext--;
      this.failures++;
      throw new Error("rpc_unreachable"); // nothing built, nothing signed, nothing sent
    }
    const txHash = String(++this.seq).padStart(64, "b");
    return { rawTxHex: `raw-${txHash}`, txHash };
  }
  async broadcast(rawTxHex: string): Promise<string> {
    this.broadcasts++;
    return rawTxHex.replace("raw-", "");
  }
  async send(): Promise<string> {
    const p = (await this.prepare())!;
    await this.broadcast(p.rawTxHex);
    return p.txHash;
  }
}

/** The Cashlink-minting routes (allowance, streak bonus, legacy gift) still go through the
 *  WalletProvider, so those tests keep a provider double.
 *
 *  It implements prepareTransaction/broadcastRaw because ALL THREE real providers do (dev,
 *  sim, nimiq-pay). A double that only offered `sendTransaction` would exercise a code path
 *  no production provider takes, and would have hidden the refund bug this file now pins:
 *  without the pair, a build failure and a lost broadcast response are indistinguishable.
 *
 *  `failNext` fails at PREPARE — provably pre-broadcast, the common real failure (an
 *  unreachable node dies at the head-height read). `failBroadcastNext` fails AFTER the bytes
 *  are on the wire, which is the ambiguous case that must NOT be refunded. */
class FlakyProvider implements WalletProvider {
  readonly kind = "dev" as const;
  broadcasts = 0;
  failures = 0;
  constructor(public failNext = 0, public failBroadcastNext = 0) {}
  async getAddress(): Promise<string> {
    return "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
  }
  async prepareTransaction(): Promise<{ rawTxHex: string; txHash: string }> {
    if (this.failNext > 0) {
      this.failNext--;
      this.failures++;
      throw new Error("rpc_unreachable"); // nothing built, nothing signed, nothing sent
    }
    return { rawTxHex: "raw-" + "b".repeat(64), txHash: "b".repeat(64) };
  }
  async broadcastRaw(rawTxHex: string): Promise<string> {
    if (this.failBroadcastNext > 0) {
      this.failBroadcastNext--;
      this.failures++;
      // The bytes went out. Whether the node took them is unknowable from here.
      throw new Error("The operation was aborted.");
    }
    this.broadcasts++;
    return rawTxHex.replace("raw-", "");
  }
  async sendTransaction(): Promise<string> {
    const p = await this.prepareTransaction();
    await this.broadcastRaw(p.rawTxHex);
    return p.txHash;
  }
}

const REWARD = 30_000;

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;
let provider: FlakyProvider;
let chain: FlakyChain;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ07 1111 1111 1111 1111 1111 1111 1111 1111");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ada", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
  provider = new FlakyProvider();
  chain = new FlakyChain();
  _setProvider(provider);
  _setEarnChain(chain);
});

afterEach(() => {
  _setProvider(null); // never leak the stub into another file's provider
  _setEarnChain(null);
});

const auth = () => ({ Authorization: `Bearer ${bearer}` });
const approve = (id: string) => post(`/api/approvals/${id}/approve`, {}, auth());
const earnRows = () => wrepo.listWalletEvents(kid.id).filter((e) => e.kind === "earn");
/** Off-SIM an earn row is written PENDING until the chain proves that transaction executed
 *  (v0.47.0), so spendable balance is not what these tests are asking. The question here is
 *  "was the payout made, exactly once?" — which is the earn rows themselves. */
const paidLuna = () => earnRows().reduce((n, e) => n + e.value_luna, 0);

/** A submitted chore and the approval waiting on it. */
async function submittedChore(rewardLuna = REWARD): Promise<{ choreId: string; approvalId: string }> {
  const chore = repo.createChore(fam.id, kid.id, "Dishes", rewardLuna);
  const res = await post(`/api/chores/${chore.id}/submit`);
  expect(res.status).toBe(200);
  return { choreId: chore.id, approvalId: approvalsRepo.pendingApprovalFor("chore", chore.id)!.id };
}

/** A finished routine run and the approval waiting on it. */
async function finishedRoutine(rewardLuna = REWARD): Promise<{ runId: string; approvalId: string }> {
  const routine = routines.createRoutine(fam.id, kid.id, "Morning", "morning");
  routines.addTask(routine.id, "Brush teeth", 120, { rewardLuna });
  const { run, taskRuns } = routines.todayRun(routine, routines.localDay(fam.tz));
  for (const tr of taskRuns) expect((await post(`/api/task-runs/${tr.id}/done`)).status).toBe(200);
  return { runId: run.id, approvalId: approvalsRepo.pendingApprovalFor("routine_run", run.id)!.id };
}

// ---- 1 + 2: the failure is retriable, and the retry works ----

test("a chore payout that fails puts the approval back in the queue, and the retry pays", async () => {
  const { choreId, approvalId } = await submittedChore();
  chain.failNext = 1;

  const failed = await approve(approvalId);
  expect(failed.status).toBe(502);
  const body = await failed.json();
  expect(body.error).toBe("pay_failed");
  expect(body.reopened).toBe(true);
  expect(body.approvalDecided).toBe(false);

  // Nothing half-applied: approval pending, chore still submitted, no money anywhere.
  const back = approvalsRepo.getApproval(approvalId)!;
  expect(back.status).toBe("pending");
  expect(back.decided_at).toBeNull();
  expect(repo.getChore(choreId)!.status).toBe("submitted");
  expect(earnRows().length).toBe(0);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(0);
  // And it is VISIBLE again — the whole point. Pre-fix this list was empty.
  expect(approvalsRepo.listApprovals(fam.id, "pending").map((a) => a.id)).toContain(approvalId);

  // The retry is a 200, not a 409.
  const retry = await approve(approvalId);
  expect(retry.status).toBe(200);
  expect((await retry.json()).paidLuna).toBe(REWARD);
  expect(repo.getChore(choreId)!.status).toBe("approved");
  expect(paidLuna()).toBe(REWARD);
  expect(earnRows().length).toBe(1);
  expect(chain.broadcasts).toBe(1); // exactly one payment left the hot wallet
});

test("a routine payout that fails is retriable too, and the run stays as the kid left it", async () => {
  const { runId, approvalId } = await finishedRoutine();
  chain.failNext = 1;

  const failed = await approve(approvalId);
  expect(failed.status).toBe(502);
  expect((await failed.json()).reopened).toBe(true);
  expect(approvalsRepo.getApproval(approvalId)!.status).toBe("pending");
  expect(routines.getRun(runId)!.status).not.toBe("approved");
  expect(earnRows().length).toBe(0);

  const retry = await approve(approvalId);
  expect(retry.status).toBe(200);
  expect(routines.getRun(runId)!.status).toBe("approved");
  expect(paidLuna()).toBe(REWARD);
  expect(chain.broadcasts).toBe(1);
});

test("the direct chore-approve route rolls back the same way", async () => {
  const { choreId } = await submittedChore();
  chain.failNext = 1;

  const failed = await post(`/api/chores/${choreId}/approve`, { pin: "1234" });
  expect(failed.status).toBe(502);
  const body = await failed.json();
  expect(body.error).toBe("pay_failed");
  expect(body.reopened).toBe(true);
  // Pre-fix the chore read 'approved' here with no NIM behind it, and every retry 409'd.
  expect(repo.getChore(choreId)!.status).toBe("submitted");
  expect(approvalsRepo.pendingApprovalFor("chore", choreId)).not.toBeNull();

  const retry = await post(`/api/chores/${choreId}/approve`, { pin: "1234" });
  expect(retry.status).toBe(200);
  expect((await retry.json()).paidLuna).toBe(REWARD);
  expect(repo.getChore(choreId)!.status).toBe("approved");
  expect(earnRows().length).toBe(1);
  expect(chain.broadcasts).toBe(1);
});

// ---- 3: a payment that landed is never made twice ----

test("a retry after the payment already landed pays nothing more", async () => {
  const { choreId, approvalId } = await submittedChore();
  expect((await approve(approvalId)).status).toBe(200);
  expect(earnRows().length).toBe(1);
  expect(chain.broadcasts).toBe(1);

  // The money moved and was recorded; something AFTER it threw and the approval went back
  // in the queue. Approving it again must complete the approval without paying again.
  expect(approvalsRepo.reopenApproval(approvalId)).toBe(true);
  const retry = await approve(approvalId);
  expect(retry.status).toBe(200);

  expect(earnRows().length).toBe(1);
  expect(chain.broadcasts).toBe(1); // no second transaction
  expect(paidLuna()).toBe(REWARD);
  expect(repo.getChore(choreId)!.status).toBe("approved");
  expect(approvalsRepo.getApproval(approvalId)!.status).toBe("approved");
});

test("the payout key is the CHORE, and it is unique in the database", async () => {
  const { choreId, approvalId } = await submittedChore();
  await approve(approvalId);
  const paid = earnRows()[0]!;
  // Keyed on the work, not on the approval row that authorised it: a chore collects several
  // approval rows over its life (reopen, re-submit, the direct route opening its own), and
  // an approval-keyed payout would let each of them pay for the same chore again.
  expect(paid.payout_ref).toBe(`chore:${choreId}`);
  expect(paid.payout_ref).not.toBe(approvalId);
  expect(wrepo.walletEventForPayoutRef(`chore:${choreId}`)!.id).toBe(paid.id);
  expect(() =>
    wrepo.addWalletEvent({
      familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: REWARD,
      payoutRef: `chore:${choreId}`,
    })).toThrow();
});

// ---- 4: the rollback and the per-family spend lock (PR #23) ----

test("a rolled-back payout frees the family lock and reserves nothing", async () => {
  const { approvalId } = await submittedChore();
  chain.failNext = 1;
  expect((await approve(approvalId)).status).toBe(502);

  // The lock is released, not held by the failed span: this resolves immediately.
  const ran = await Promise.race([
    withSpendLock(familySpendKey(fam.id), async () => "free" as const),
    new Promise((r) => setTimeout(() => r("deadlocked"), 500)),
  ]);
  expect(ran).toBe("free");

  // An earn adds money, so it never reserves any — and a rolled-back one must not leave a
  // phantom outflow behind either. The kid's spendable money is exactly what it was.
  expect(reservedOutflowLuna(kid.id)).toBe(0);
  expect(await availableKidLuna(repo.getChild(kid.id)!)).toBe(0);
});

test("a failing payout does not wedge the queue for the rest of the family", async () => {
  const first = await submittedChore();
  const second = await submittedChore(11_000);
  chain.failNext = 1;

  // Fired together: they serialize on the family key, the first fails and rolls back, the
  // second still gets its turn. No re-entrancy, no lost lock.
  const [a, b] = await Promise.all([approve(first.approvalId), approve(second.approvalId)]);
  const statuses = [a.status, b.status].sort();
  expect(statuses).toEqual([200, 502]);
  expect(approvalsRepo.listApprovals(fam.id, "pending").length).toBe(1);

  const retry = await approve(first.approvalId);
  expect(retry.status).toBe(200);
  expect(paidLuna()).toBe(REWARD + 11_000);
  expect(chain.broadcasts).toBe(2);
});

// ---- the neighbouring payout paths, checked for the same shape ----
//
// Allowance mints, streak bonuses and the legacy gift route all spend the hot wallet too.
// None of them settles anything before the money moves — the allowance debits stars only
// after the mint returns, the bonus is best-effort, and the gift route already refunds its
// reserve — so none had the stranding bug. These pin that, so it cannot creep back.

test("an allowance mint that fails debits no stars and stays retriable", async () => {
  approvalsRepo.addStarEvent(fam.id, kid.id, 12, "chore");
  provider.failNext = 1;

  const failed = await post(`/api/children/${kid.id}/payout`, { pin: "1234" });
  expect(failed.status).toBe(502);
  expect((await failed.json()).error).toBe("mint_failed");
  expect(repo.getChild(kid.id)!.star_balance).toBe(12); // not spent
  expect(repo.listCashlinksForChild(kid.id).length).toBe(0);

  const retry = await post(`/api/children/${kid.id}/payout`, { pin: "1234" });
  expect(retry.status).toBe(200);
  expect(repo.getChild(kid.id)!.star_balance).toBe(0);
  expect(repo.listCashlinksForChild(kid.id).length).toBe(1);
});

test("a streak bonus that fails to mint changes nothing", async () => {
  repo.addBalanceAndStreak(kid.id, 0);
  const streaky = repo.getChild(kid.id)!.streak_count;
  const failing = new FlakyProvider(1);
  const minted = await maybeMintStreakBonus(fam.id, kid.id, failing);
  expect(minted).toBeNull();
  expect(repo.listCashlinksForChild(kid.id).length).toBe(0);
  expect(repo.getChild(kid.id)!.streak_count).toBe(streaky);
});

test("the legacy gift route refunds its reserve when the mint fails", async () => {
  const demo = repo.createFamily("Mum", "NQ07 2222 2222 2222 2222 2222 2222 2222 2222");
  const demoKid = repo.createChild(demo.id, "Bo", "🐙");
  repo.adjustBalance(demoKid.id, 50_000);
  provider.failNext = 1;

  const failed = await post(`/api/children/${demoKid.id}/send`, { valueLuna: 20_000 });
  expect(failed.status).toBe(502);
  expect((await failed.json()).error).toBe("mint_failed");
  expect(repo.getChild(demoKid.id)!.balance_luna).toBe(50_000); // reserve given back

  const retry = await post(`/api/children/${demoKid.id}/send`, { valueLuna: 20_000 });
  expect(retry.status).toBe(200);
  expect(repo.getChild(demoKid.id)!.balance_luna).toBe(30_000);
});

test("the legacy gift route does NOT refund when the funding may already be on chain", async () => {
  // The counterpart to the test above, and the one that costs real money.
  //
  // A broadcast that throws can still have been accepted — proven on mainnet 2026-08-01,
  // where the call aborted and the transfer executed anyway. Refunding there pays the kid
  // twice: they keep their balance AND the Cashlink is live and claimable, with the hot
  // wallet short the difference.
  //
  // Before mintCashlink split build from broadcast, this case was indistinguishable from
  // the one above and was refunded blindly.
  const demo = repo.createFamily("Mum", "NQ07 3333 3333 3333 3333 3333 3333 3333 3333");
  const demoKid = repo.createChild(demo.id, "Fi", "🦊");
  repo.adjustBalance(demoKid.id, 50_000);
  provider.failBroadcastNext = 1;

  const failed = await post(`/api/children/${demoKid.id}/send`, { valueLuna: 20_000 });
  expect(failed.status).toBe(502);
  expect((await failed.json()).error).toBe("mint_unconfirmed");

  // The reservation STAYS. A stuck balance is recoverable by hand; a double payout is not.
  expect(repo.getChild(demoKid.id)!.balance_luna).toBe(30_000);

  // And it must not have been handed out as a spendable link.
  expect(repo.listCashlinksForChild(demoKid.id).length).toBe(0);
});

test("a build failure is provably unsent; anything later is not", async () => {
  // Pins the predicate the refund branches on, so a later refactor cannot quietly widen it.
  const { CashlinkMintError } = await import("./nimiq/cashlink");
  const mk = (stage: "build" | "send" | "broadcast" | "confirm") =>
    new CashlinkMintError("NQ07 0000", "url#k", 1, null, new Error("x"), stage);

  expect(mk("build").provablyUnsent).toBe(true);
  // "send" means the provider could not separate build from broadcast — never treat that
  // as safe just because no hash came back.
  expect(mk("send").provablyUnsent).toBe(false);
  expect(mk("broadcast").provablyUnsent).toBe(false);
  expect(mk("confirm").provablyUnsent).toBe(false);
});
