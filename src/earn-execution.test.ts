// A chore payout is only "paid" when the chain says THAT transaction executed.
//
// payKidEarn used to write its 'earn' row straight after sendTransaction returned. A REJECTED
// transaction throws out of the sender and writes no row, so that case was always safe — but a
// node answering with a tx hash means "accepted into the mempool", not "executed". An
// accepted-then-failed-at-execution payout therefore credited a kid for NIM that never arrived,
// and spent the family's payout budget on it.
//
// The proof is the payout's own transaction hash, never a balance. A balance rises whoever
// sent the money: one arriving transfer confirmed every payout broadcast in the same window,
// and an unrelated gift confirmed a payout that had died in the mempool. PR #22 made the same
// correction for deposit detection.
//
// And nothing is ever written off on a timer — 'failed' is reachable only from the node
// stating the transaction was included and execution failed. A wrongly-written-off payout
// deletes money a kid really received from their history AND refunds the family's budget for
// NIM that really left the shared hot wallet.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as budget from "./repo-budget";
import {
  earnSettleDecision, payKidEarnVia, reconcilePendingEarns, repayFailedEarn, earnRepayKey,
  EARN_CONFIRM_TIMEOUT_MS, type EarnChain, type EarnReceipt,
} from "./wallet/kid-wallet";

const PAYOUT = 50_000; // 0.5 NIM

let fam: repo.Family;
let kid: repo.Child;

beforeEach(() => {
  initTestDb();
  fam = repo.createFamily("Dad", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  kid = repo.createChild(fam.id, "Ada", "🦖");
});

/** A stand-in chain: every broadcast is ACCEPTED and handed a unique hash, and the test
 *  decides afterwards what the node reports about each hash. */
function fakeChain() {
  const receipts = new Map<string, EarnReceipt>();
  const state = { sent: 0 };
  const chain: EarnChain = {
    send: async () => {
      state.sent++;
      const hash = `0x${String(state.sent).padStart(64, "0")}`;
      receipts.set(hash, "unknown"); // accepted into the mempool, nothing more
      return hash;
    },
  };
  const receiptFor = async (hash: string): Promise<EarnReceipt> => receipts.get(hash) ?? "unknown";
  const say = (hash: string, r: EarnReceipt) => receipts.set(hash, r);
  return { chain, state, receiptFor, say };
}

const creditedLuna = () => wrepo.spendableFromLedger(kid.id);
const feedIds = () => wrepo.listWalletEvents(kid.id).map((e) => e.id);
const LATE = (ev: wrepo.WalletEvent) => ev.created_at + EARN_CONFIRM_TIMEOUT_MS + 1;

// ---- the ledger tells the truth about what was actually paid ----

test("a PENDING payout is not credited — it is in flight", async () => {
  const { chain } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);

  expect(ev.status).toBe("pending");
  expect(creditedLuna()).toBe(0);
  expect(wrepo.pendingEarnFromLedger(kid.id)).toBe(PAYOUT);
  // The row still EXISTS, so the chore visibly paid the moment the parent approved it.
  expect(feedIds()).toContain(ev.id);
});

test("accepted-then-CONFIRMED credits exactly once", async () => {
  const { chain, receiptFor, say } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  say(ev.tx_hash!, "executed");

  expect(await reconcilePendingEarns(kid.id, receiptFor)).toBe(PAYOUT);
  expect(wrepo.getWalletEvent(ev.id)!.status).toBe("done");
  expect(creditedLuna()).toBe(PAYOUT);
  expect(budget.spentLuna(fam.id)).toBe(PAYOUT);
  expect(wrepo.listWalletEvents(kid.id).filter((e) => e.kind === "earn").length).toBe(1);
});

test("accepted-then-FAILED-at-execution credits nothing and refunds the budget", async () => {
  const { chain, state, receiptFor, say } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  expect(state.sent).toBe(1); // the node accepted it and answered with a hash
  say(ev.tx_hash!, "rejected"); // …then reported it included and failed at execution

  expect(await reconcilePendingEarns(kid.id, receiptFor)).toBe(0);
  expect(wrepo.getWalletEvent(ev.id)!.status).toBe("failed");
  expect(creditedLuna()).toBe(0);
  expect(feedIds()).not.toContain(ev.id);
  // Proven not to have executed, so the NIM really is still in the hot wallet.
  expect(budget.spentLuna(fam.id)).toBe(0);
});

test("reconciliation is idempotent — running it again cannot double-credit", async () => {
  const { chain, receiptFor, say } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  say(ev.tx_hash!, "executed");

  expect(await reconcilePendingEarns(kid.id, receiptFor)).toBe(PAYOUT);
  expect(await reconcilePendingEarns(kid.id, receiptFor)).toBe(0);
  expect(await reconcilePendingEarns(kid.id, receiptFor)).toBe(0);

  expect(creditedLuna()).toBe(PAYOUT);
  expect(budget.spentLuna(fam.id)).toBe(PAYOUT);
  expect(wrepo.listWalletEvents(kid.id).filter((e) => e.kind === "earn").length).toBe(1);
});

// ---- ATTRIBUTION: the finding that killed the balance rule ----

test("one arriving payout does NOT confirm the others broadcast beside it", async () => {
  const { chain, receiptFor, say } = fakeChain();
  const a = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  const b = await payKidEarnVia(fam, kid.id, PAYOUT, "Beds", chain);
  const c = await payKidEarnVia(fam, kid.id, PAYOUT, "Bins", chain);
  // A parent clearing a morning's chore queue: three broadcasts, milliseconds apart, and
  // exactly ONE of them executes.
  say(a.tx_hash!, "executed");

  expect(await reconcilePendingEarns(kid.id, receiptFor, LATE(a))).toBe(PAYOUT);
  expect(wrepo.getWalletEvent(a.id)!.status).toBe("done");
  expect(wrepo.getWalletEvent(b.id)!.status).toBe("pending");
  expect(wrepo.getWalletEvent(c.id)!.status).toBe("pending");
  expect(creditedLuna()).toBe(PAYOUT); // not 3 × PAYOUT
});

test("unrelated inbound NIM confirms nothing — a balance cannot attribute", async () => {
  const { chain, receiptFor } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  // Grandma's cashlink, a sibling gift, a parent deposit: the kid's balance jumps, and the
  // dead payout is entirely unaffected because its own transaction still is not on chain.
  wrepo.addWalletEvent({
    familyId: fam.id, childId: kid.id, kind: "deposit", valueLuna: PAYOUT * 4,
    counterpartyLabel: "Grandma",
  });

  expect(await reconcilePendingEarns(kid.id, receiptFor, LATE(ev))).toBe(0);
  expect(wrepo.getWalletEvent(ev.id)!.status).toBe("pending");
});

test("a payout that DID execute is never written off because the balance moved on", async () => {
  const { chain, receiptFor, say } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  say(ev.tx_hash!, "executed");
  // The kid spends it immediately (Treasure Box, sibling send): the net balance never shows
  // a rise. The receipt does not care.
  wrepo.addWalletEvent({
    familyId: fam.id, childId: kid.id, kind: "spend", valueLuna: -PAYOUT,
    counterpartyLabel: "Treasure Box",
  });

  expect(await reconcilePendingEarns(kid.id, receiptFor, LATE(ev))).toBe(PAYOUT);
  expect(wrepo.getWalletEvent(ev.id)!.status).toBe("done");
  expect(feedIds()).toContain(ev.id);
  expect(budget.spentLuna(fam.id)).toBe(PAYOUT); // the hot wallet really paid
});

test("an unproven payout ages into unresolved: still pending, still counted, never written off", async () => {
  const { chain, receiptFor } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);

  expect(await reconcilePendingEarns(kid.id, receiptFor, LATE(ev))).toBe(0);
  const after = wrepo.getWalletEvent(ev.id)!;
  expect(after.status).toBe("pending");
  expect(feedIds()).toContain(after.id); // not erased from the kid's history
  expect(budget.spentLuna(fam.id)).toBe(PAYOUT); // budget NOT refunded on a guess
  // …and it stays that way however many times the reconcile runs.
  await reconcilePendingEarns(kid.id, receiptFor, LATE(ev) + 1);
  expect(wrepo.getWalletEvent(ev.id)!.status).toBe("pending");
});

test("a node that cannot answer by-hash never moves any money, however old the row", async () => {
  const { chain } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  const blind = async (): Promise<EarnReceipt> => "unavailable";

  expect(await reconcilePendingEarns(kid.id, blind, ev.created_at + 10 * EARN_CONFIRM_TIMEOUT_MS)).toBe(0);
  expect(wrepo.getWalletEvent(ev.id)!.status).toBe("pending");
  expect(budget.spentLuna(fam.id)).toBe(PAYOUT);
  // Blindness reaches an ALERT and stops there — see src/rpc-receipts.test.ts. It can never
  // reach 'failed' or 'confirmed', because it is not a fact about the payout.
});

test("a receipt lookup that THROWS is treated as blindness, not as a verdict", async () => {
  const { chain } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  const boom = async (): Promise<EarnReceipt> => { throw new Error("ECONNREFUSED"); };

  expect(await reconcilePendingEarns(kid.id, boom, LATE(ev))).toBe(0);
  expect(wrepo.getWalletEvent(ev.id)!.status).toBe("pending");
});

test("a failed payout stays failed and can never be resurrected into a credit", async () => {
  const { chain, receiptFor, say } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  say(ev.tx_hash!, "rejected");
  await reconcilePendingEarns(kid.id, receiptFor);

  say(ev.tx_hash!, "executed"); // even if the node changes its mind
  expect(await reconcilePendingEarns(kid.id, receiptFor)).toBe(0);
  expect(wrepo.getWalletEvent(ev.id)!.status).toBe("failed");
  expect(creditedLuna()).toBe(0);
});

test("a REJECTED broadcast writes no row at all", async () => {
  const chain: EarnChain = { send: async () => { throw new Error("Rejected transaction"); } };
  await expect(payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain)).rejects.toThrow();
  expect(wrepo.listWalletEvents(kid.id).length).toBe(0);
  expect(creditedLuna()).toBe(0);
});

test("SIM writes the row done — no chain, nothing to fail, demo flow unchanged", async () => {
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", null);
  expect(ev.status).toBe("done");
  expect(ev.tx_hash!.startsWith("sim:")).toBe(true);
  expect(creditedLuna()).toBe(PAYOUT);
  expect(wrepo.listPendingEarns(kid.id).length).toBe(0);
});

test("no chain read happens before the broadcast — an RPC hiccup cannot cost a payout", async () => {
  // The old body read the kid's balance first for a baseline and, when that read failed,
  // deterministically wrote the payout off no matter what the chain did. EarnChain no longer
  // has anything to read, so that failure mode is gone by construction.
  const { chain, receiptFor, say } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  say(ev.tx_hash!, "executed");
  expect(await reconcilePendingEarns(kid.id, receiptFor, LATE(ev))).toBe(PAYOUT);
  expect(wrepo.getWalletEvent(ev.id)!.status).toBe("done");
});

// ---- a written-off payout is recoverable ----

test("a proven-failed payout can be paid again, exactly once", async () => {
  const { chain, receiptFor, say } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  say(ev.tx_hash!, "rejected");
  await reconcilePendingEarns(kid.id, receiptFor);

  const again = await repayFailedEarn(fam, wrepo.getWalletEvent(ev.id)!);
  expect(again.id).not.toBe(ev.id);
  expect(again.value_luna).toBe(PAYOUT);
  expect(again.message).toBe("Dishes");
  expect(wrepo.getWalletState(earnRepayKey(ev.id))).toBe(again.id);

  await expect(repayFailedEarn(fam, wrepo.getWalletEvent(ev.id)!)).rejects.toThrow("already_repaid");
});

test("a PENDING payout is not repayable — it may yet land, and paying twice is worse", async () => {
  const { chain } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  await expect(repayFailedEarn(fam, wrepo.getWalletEvent(ev.id)!)).rejects.toThrow("not_repayable");
});

// ---- the sweeper's work list ----

test("children holding an in-flight payout are discoverable without a kid-app read", async () => {
  const { chain, receiptFor, say } = fakeChain();
  expect(wrepo.childIdsWithPendingEarns()).toEqual([]);
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  expect(wrepo.childIdsWithPendingEarns()).toEqual([kid.id]);

  say(ev.tx_hash!, "executed");
  await reconcilePendingEarns(kid.id, receiptFor);
  expect(wrepo.childIdsWithPendingEarns()).toEqual([]);
});

// ---- wallet_state does not accumulate dead rows ----

test("a settled payout leaves no wallet_state row behind", async () => {
  const { chain, receiptFor, say } = fakeChain();
  const ev = await payKidEarnVia(fam, kid.id, PAYOUT, "Dishes", chain);
  await reconcilePendingEarns(kid.id, receiptFor, LATE(ev)); // flags it, writes the alert marker
  expect(wrepo.getWalletState(`earn_alert:${ev.id}`)).not.toBeNull();

  say(ev.tx_hash!, "executed");
  await reconcilePendingEarns(kid.id, receiptFor, LATE(ev) + 1);
  // Deleted, not blanked: "" reads back indistinguishably from a key never written.
  expect(wrepo.getWalletState(`earn_alert:${ev.id}`)).toBeNull();
});

// ---- the reconcile rule ----

test("only the payout's OWN receipt can confirm it", () => {
  expect(earnSettleDecision({ receipt: "executed", ageMs: 1 })).toBe("confirmed");
  expect(earnSettleDecision({ receipt: "executed", ageMs: 999_999_999 })).toBe("confirmed");
});

test("'failed' is reachable only from proof of non-execution", () => {
  expect(earnSettleDecision({ receipt: "rejected", ageMs: 1 })).toBe("failed");
  // No amount of waiting turns not-knowing into a write-off.
  expect(earnSettleDecision({ receipt: "unknown", ageMs: 999_999_999, timeoutMs: 300_000 })).toBe("unresolved");
  // Blindness ages into an ALERT, never a write-off, however long it lasts.
  expect(earnSettleDecision({ receipt: "unavailable", ageMs: 999_999_999, timeoutMs: 300_000 })).toBe("unresolved");
  expect(earnSettleDecision({ receipt: "unavailable", ageMs: 60_000, blindTimeoutMs: 1_800_000 })).toBe("wait");
});

test("an unmined payout waits, then is flagged to the parent rather than written off", () => {
  expect(earnSettleDecision({ receipt: "unknown", ageMs: 30_000, timeoutMs: 300_000 })).toBe("wait");
  expect(earnSettleDecision({ receipt: "unknown", ageMs: 300_001, timeoutMs: 300_000 })).toBe("unresolved");
});

test("a node outage never decides the MONEY, however old the payout", () => {
  for (const ageMs of [1, 999_999_999]) {
    const d = earnSettleDecision({ receipt: "unavailable", ageMs });
    expect(d === "wait" || d === "unresolved").toBe(true);
    expect(d).not.toBe("failed");
    expect(d).not.toBe("confirmed");
  }
});

test("the alert window is generous by default — a slow block must not alarm a parent", () => {
  expect(EARN_CONFIRM_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
});
