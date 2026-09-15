// The netting engine: what a deferred purchase does to the balance, what a payout does to a
// debt, and the four rules the design is not allowed to break.
//
// Hermetic: in-memory DB, no chain, no network.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import {
  attachDebitToPurchase, committedDebtLuna, commitHeldDebit, debitForPurchase, deferKidSpends,
  debtSettledByPayout,
  listKidDebits, netPayout, nettableDebtLuna, outstandingDebtLuna, recordDeferredSpend,
  reservedNettingLuna, reverseHeldDebit, settleDebtForPayout,
} from "./kid-netting";

const PARENT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const KID = "NQ02 SXUJ Y9D0 UDSK L1J8 N1U4 69NB 69X4 KU3T";

let fam: repo.Family;
let kid: repo.Child;

beforeEach(() => {
  initTestDb();
  const f = repo.createFamily("Mom", PARENT);
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Sam", "🦖");
  wrepo.setChildAddress(kid.id, KID);
  kid = repo.getChild(kid.id)!;
});

afterEach(() => {
  delete process.env.HATCH_CUSTODY;
});

const spend = (valueLuna: number, chainBalanceLuna = 1_000_000, refundable = false) =>
  recordDeferredSpend({
    familyId: fam.id, childId: kid.id, valueLuna, chainBalanceLuna,
    message: "Ice cream", refundable,
  });

// ---- the rule ----

test("netPayout splits a payout into what moves and what clears", () => {
  expect(netPayout(100, 30)).toEqual({ chainLuna: 70, settleLuna: 30 });
  expect(netPayout(100, 0)).toEqual({ chainLuna: 100, settleLuna: 0 });
});

test("a debt bigger than the payout eats it whole, and never more than it", () => {
  // Rule 2: "the debit eats the next payout". The settlement can never exceed the payout, or
  // the parent would be asked to sign a NEGATIVE transaction and the extra would be forgiven
  // out of nowhere.
  expect(netPayout(40, 100)).toEqual({ chainLuna: 0, settleLuna: 40 });
  expect(netPayout(0, 100)).toEqual({ chainLuna: 0, settleLuna: 0 });
});

// ---- rule 2: the purchase is instant, and the balance drops ----

test("a deferred purchase moves nothing and writes no wallet event", () => {
  spend(30_000);
  expect(outstandingDebtLuna(kid.id)).toBe(30_000);
  // The ledger is the record of what MOVED. Nothing did — and in SIM that ledger is also the
  // balance, so a row here would subtract the purchase a second time.
  expect(wrepo.listWalletEvents(kid.id, 50)).toHaveLength(0);
});

// ---- rule 3: debt may never exceed the on-chain balance ----

test("a purchase past the raw chain balance is refused, not carried", () => {
  spend(60_000, 100_000);
  expect(() => spend(50_000, 100_000)).toThrow("insufficient_funds");
  expect(outstandingDebtLuna(kid.id)).toBe(60_000);
});

test("the ceiling is the RAW balance, so it holds even for a caller that forgot to subtract", () => {
  // The whole point of enforcing it in here as well: 100,000 on chain, 60,000 already
  // committed, and a caller that checked affordability against 100,000 by mistake.
  spend(60_000, 100_000);
  expect(() => spend(40_001, 100_000)).toThrow("insufficient_funds");
  expect(spend(40_000, 100_000).value_luna).toBe(40_000);
  expect(outstandingDebtLuna(kid.id)).toBe(100_000);
});

test("a zero or fractional purchase is refused outright", () => {
  expect(() => spend(0)).toThrow("invalid_value");
  expect(() => spend(-5)).toThrow("invalid_value");
  expect(() => spend(1.5)).toThrow("invalid_value");
});

// ---- settlement ----

test("a settlement clears the debt exactly once per payout", () => {
  spend(30_000);
  const first = settleDebtForPayout({ familyId: fam.id, childId: kid.id, ref: "chore:a", settleLuna: 30_000 });
  const second = settleDebtForPayout({ familyId: fam.id, childId: kid.id, ref: "chore:a", settleLuna: 30_000 });
  expect(first!.id).toBe(second!.id); // the same row, not a second forgiveness
  expect(outstandingDebtLuna(kid.id)).toBe(0);
  expect(debtSettledByPayout("chore:a")!.value_luna).toBe(-30_000);
});

test("settling nothing writes nothing", () => {
  expect(settleDebtForPayout({ familyId: fam.id, childId: kid.id, ref: "chore:a", settleLuna: 0 })).toBeNull();
  expect(listKidDebits(kid.id)).toHaveLength(0);
});

// ---- the reservation: two approvals must not eat one debt twice ----

test("an unsettled intent reserves the debt it pinned", () => {
  spend(30_000);
  expect(nettableDebtLuna(kid.id)).toBe(30_000);

  // A minted-but-unsigned intent for chore A, netting the whole 30,000.
  wrepo.claimPayoutAttempt({
    ref: "chore:a", familyId: fam.id, childId: kid.id, valueLuna: 70_000, recipient: KID,
    message: "Made bed", nettedLuna: 30_000,
    intent: { sender: PARENT, data: "Made bed", validityStartHeight: 9, expiresAt: Date.now() + 60_000 },
  });

  // Chore B, approved a moment later, must find nothing left to net. Without this the parent
  // signs two payouts 30,000 short and the kid is 30,000 down on one ice cream.
  expect(reservedNettingLuna(kid.id)).toBe(30_000);
  expect(nettableDebtLuna(kid.id)).toBe(0);
  expect(netPayout(100_000, nettableDebtLuna(kid.id))).toEqual({ chainLuna: 100_000, settleLuna: 0 });
});

test("an EXPIRED unsigned intent stops reserving, so the debt is not stranded", () => {
  spend(30_000);
  const expired = Date.now() - 1;
  wrepo.claimPayoutAttempt({
    ref: "chore:a", familyId: fam.id, childId: kid.id, valueLuna: 70_000, recipient: KID,
    message: "Made bed", nettedLuna: 30_000,
    intent: { sender: PARENT, data: "Made bed", validityStartHeight: 9, expiresAt: expired },
  });
  // Nothing can ever redeem it — verifySignedPayout refuses an expired intent — so holding
  // the reservation would park that debt against a payout that cannot happen.
  expect(nettableDebtLuna(kid.id)).toBe(30_000);
});

test("bytes already on the wire keep their reservation whatever the clock says", () => {
  spend(30_000);
  wrepo.claimPayoutAttempt({
    ref: "chore:a", familyId: fam.id, childId: kid.id, valueLuna: 70_000, recipient: KID,
    message: "Made bed", nettedLuna: 30_000,
    intent: { sender: PARENT, data: "Made bed", validityStartHeight: 9, expiresAt: Date.now() - 1 },
  });
  wrepo.armPayoutAttempt("chore:a", "deadbeef", "hash");
  expect(nettableDebtLuna(kid.id)).toBe(0);
});

test("a settled attempt stops reserving, because its settlement row is already in the debt", () => {
  spend(30_000);
  wrepo.claimPayoutAttempt({
    ref: "chore:a", familyId: fam.id, childId: kid.id, valueLuna: 70_000, recipient: KID,
    message: "Made bed", nettedLuna: 30_000,
    intent: { sender: PARENT, data: "Made bed", validityStartHeight: 9, expiresAt: Date.now() + 60_000 },
  });
  settleDebtForPayout({ familyId: fam.id, childId: kid.id, ref: "chore:a", settleLuna: 30_000 });
  wrepo.settlePayoutAttempt("chore:a", "hash");
  expect(reservedNettingLuna(kid.id)).toBe(0);
  expect(outstandingDebtLuna(kid.id)).toBe(0);
  expect(nettableDebtLuna(kid.id)).toBe(0); // and not -30,000 by counting it twice
});

// ---- holds: a coupon can still come back ----

test("a refundable purchase costs the balance but is not nettable until it is honoured", () => {
  const debit = spend(30_000, 1_000_000, true);
  expect(debit.kind).toBe("hold");
  // Rule 2 still applies: the kid cannot spend that money again while they wait.
  expect(outstandingDebtLuna(kid.id)).toBe(30_000);
  // But a payout must not absorb it, because a settlement cannot be undone and the parent
  // can still say no.
  expect(committedDebtLuna(kid.id)).toBe(0);
  expect(nettableDebtLuna(kid.id)).toBe(0);

});

test("honouring a coupon makes its debt settleable; refusing it gives the money back", () => {
  const held = spend(30_000, 1_000_000, true);
  // Linking the receipt is what the store route does a line after the charge.
  const purchaseId = "purchase-1";
  attachDebitToPurchase(held.id, purchaseId);
  expect(debitForPurchase(purchaseId)!.id).toBe(held.id);

  commitHeldDebit(purchaseId);
  expect(committedDebtLuna(kid.id)).toBe(30_000);
  expect(nettableDebtLuna(kid.id)).toBe(30_000);
});

test("a refused coupon reverses its hold, exactly once", () => {
  const held = spend(30_000, 1_000_000, true);
  attachDebitToPurchase(held.id, "purchase-1");

  const args = { familyId: fam.id, childId: kid.id, purchaseId: "purchase-1", valueLuna: 30_000 };
  const first = reverseHeldDebit(args);
  const second = reverseHeldDebit(args);
  expect(first!.id).toBe(second!.id);
  expect(outstandingDebtLuna(kid.id)).toBe(0);
});

test("a refund can never drive the debt negative, because a held debit is never absorbed", () => {
  // The failure this shape exists to prevent: buy a coupon, let a payout net it away, then
  // have the parent reject it. Reversing an absorbed debit would show the kid NIM that is
  // not at their address. A hold is invisible to netting, so the sequence cannot occur.
  const held = spend(30_000, 1_000_000, true);
  attachDebitToPurchase(held.id, "purchase-1");

  const { settleLuna } = netPayout(100_000, nettableDebtLuna(kid.id));
  expect(settleLuna).toBe(0);
  settleDebtForPayout({ familyId: fam.id, childId: kid.id, ref: "chore:a", settleLuna });
  reverseHeldDebit({ familyId: fam.id, childId: kid.id, purchaseId: "purchase-1", valueLuna: 30_000 });
  expect(outstandingDebtLuna(kid.id)).toBe(0);
});

// ---- the predicate ----

test("deferral is on exactly where payouts are parent-signed", () => {
  delete process.env.HATCH_CUSTODY;
  expect(deferKidSpends({})).toBe(false);
  expect(deferKidSpends({ HATCH_CUSTODY: "parent" })).toBe(true);
  expect(deferKidSpends({ HATCH_CUSTODY: "server" })).toBe(false);
});
