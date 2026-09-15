// Staking integrity — the ledger must never claim a lock the chain did not honour.
//
// Written against a failure reproduced end-to-end on the live Nimiq testnet on 2026-07-31:
// a create-staker transaction delegating to an address that is not a registered validator
// is accepted by the node, included in a block (7,499,820) and reported state "confirmed",
// yet never debits the account. The app recorded stakedLuna=10_000_000 off that broadcast,
// showed the kid "100 NIM growing", and then let the same NIM be spent — an unauthenticated
// send of 10,995,000,000 luna landed on chain against a balance that was supposed to be short.
//
// So: broadcast success is not execution success, and stakedFromLedger only counts proof.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import { stakeSettleDecision } from "./wallet/kid-staking";
import { MINIMUM_STAKE_LUNA } from "./nimiq/staking";

let fam: repo.Family;
let kid: repo.Child;

beforeEach(() => {
  initTestDb();
  fam = repo.createFamily("Dad", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  kid = repo.createChild(fam.id, "Ada", "🦖");
});

const stakeRow = (valueLuna: number, status: wrepo.WalletEventStatus) =>
  wrepo.addWalletEvent({
    familyId: fam.id, childId: kid.id, kind: "stake",
    valueLuna: -valueLuna, status, counterpartyLabel: "Staking",
  });

// ---- the ledger tells the truth about what is actually locked ----

test("a PENDING stake is not staked and is not spendable-locked — it is in flight", () => {
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 20_000_000 });
  stakeRow(10_000_000, "pending");

  expect(wrepo.stakedFromLedger(kid.id)).toBe(0);
  expect(wrepo.pendingStakeFromLedger(kid.id)).toBe(10_000_000);
  // The NIM has not left the account, so the ledger must still count it as spendable.
  expect(wrepo.spendableFromLedger(kid.id)).toBe(20_000_000);
});

test("a FAILED stake counts for nothing anywhere — this is the bug that shipped", () => {
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 20_000_000 });
  stakeRow(10_000_000, "failed");

  expect(wrepo.stakedFromLedger(kid.id)).toBe(0);
  expect(wrepo.pendingStakeFromLedger(kid.id)).toBe(0);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(20_000_000);
});

test("a CONFIRMED stake locks: staked up, spendable down", () => {
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 20_000_000 });
  stakeRow(10_000_000, "done");

  expect(wrepo.stakedFromLedger(kid.id)).toBe(10_000_000);
  expect(wrepo.pendingStakeFromLedger(kid.id)).toBe(0);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(10_000_000);
});

test("rewards restake on top of confirmed principal only", () => {
  stakeRow(10_000_000, "done");
  stakeRow(10_000_000, "pending");
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "reward", valueLuna: 3_287 });

  expect(wrepo.stakedFromLedger(kid.id)).toBe(10_003_287);
});

// ---- the reconcile rule ----

test("confirmed once the account balance drops by at least the staked amount", () => {
  expect(stakeSettleDecision({
    stakedLuna: 10_000_000, balanceBefore: 11_005_060_000,
    currentBalance: 10_995_060_000, ageMs: 30_000,
  })).toBe("confirmed");
});

test("an undebited balance stays pending until the timeout, then fails", () => {
  const undebited = { stakedLuna: 10_000_000, balanceBefore: 11_005_060_000, currentBalance: 11_005_060_000 };
  // This is exactly the observed testnet failure: mined, "confirmed", never debited.
  expect(stakeSettleDecision({ ...undebited, ageMs: 30_000, timeoutMs: 300_000 })).toBe("wait");
  expect(stakeSettleDecision({ ...undebited, ageMs: 300_001, timeoutMs: 300_000 })).toBe("failed");
});

test("a node outage never writes off a stake, however old", () => {
  expect(stakeSettleDecision({
    stakedLuna: 10_000_000, balanceBefore: 11_005_060_000,
    currentBalance: null, ageMs: 999_999_999,
  })).toBe("wait");
});

test("a bigger drop than expected still confirms (a send landed in the same window)", () => {
  expect(stakeSettleDecision({
    stakedLuna: 10_000_000, balanceBefore: 11_005_060_000,
    currentBalance: 5_060_000, ageMs: 10_000,
  })).toBe("confirmed");
});

test("no baseline is unprovable: it can only ever time out, never confirm", () => {
  expect(stakeSettleDecision({
    stakedLuna: 10_000_000, balanceBefore: null, currentBalance: 0, ageMs: 1_000, timeoutMs: 300_000,
  })).toBe("wait");
  expect(stakeSettleDecision({
    stakedLuna: 10_000_000, balanceBefore: null, currentBalance: 0, ageMs: 300_001, timeoutMs: 300_000,
  })).toBe("failed");
});

// ---- the chain floor ----

test("MINIMUM_STAKE_LUNA is the measured Albatross floor, 100 NIM", () => {
  // Bisected against the live testnet: 9_999_999 refused, 10_000_000 executed.
  expect(MINIMUM_STAKE_LUNA).toBe(10_000_000);
  expect(MINIMUM_STAKE_LUNA / 1e5).toBe(100);
});
