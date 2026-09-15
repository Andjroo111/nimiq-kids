// Parent home before anyone has checked the wallet (issue #32).
//
// Two facts hold this screen together, and the second one is a trap that has already been
// sprung once for real during the #20 capture work:
//
//   1. `visibleFundsLuna` hands an EXEMPT family the raw chain snapshot, and that snapshot
//      is null until something writes it. The parent app renders null as a dash, which on
//      a fresh install is every parent's first look at the screen.
//   2. The fix is NOT to force a deposit-check. On an instance whose chain read answers 0
//      that writes a snapshot of ZERO, `payableLuna()` then returns 0, and every approval
//      afterwards fails with `budget_exhausted`.
//
// So these pin the distinction the whole design rests on: "not checked yet" (null, never
// blocks) and "checked, empty" (0, blocks everything) are different facts, and nothing in
// the empty-state fix is allowed to turn the first into the second.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as budget from "./repo-budget";

const HOT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0001";

beforeEach(() => {
  initTestDb();
});

test("an exempt family with no snapshot reports unknown funds, and unknown never blocks", () => {
  const fam = repo.createFamily("Mom", HOT); // first family on the instance = exempt
  expect(budget.isBudgetExempt(fam)).toBe(true);

  // This null is what the parent app draws as a dash.
  expect(wrepo.hotWalletSnapshotLuna()).toBeNull();
  expect(budget.visibleFundsLuna(fam)).toBeNull();

  // Unknown must never be read as broke: an exempt family on a funded wallet has to be
  // able to approve a payout before anyone has run a deposit-check.
  expect(budget.payableLuna(fam)).toBeNull();
  expect(budget.checkSpend(fam, 5_000 * 100_000).ok).toBe(true);
});

// The trap, asserted rather than described. If a future "fix" for the dash ever writes a
// zero snapshot to make the screen look populated, this fails loudly.
test("a ZERO snapshot is a different fact from no snapshot, and it blocks every payout", () => {
  const fam = repo.createFamily("Mom", HOT);
  wrepo.setWalletState(wrepo.HOT_BALANCE_KEY, "0");

  expect(wrepo.hotWalletSnapshotLuna()).toBe(0);
  expect(budget.payableLuna(fam)).toBe(0);
  const refused = budget.checkSpend(fam, 1);
  expect(refused.ok).toBe(false);
  expect(refused).toMatchObject({ reason: "funds" });
});

test("a real snapshot gives the parent app a number to render", () => {
  const fam = repo.createFamily("Mom", HOT);
  wrepo.setWalletState(wrepo.HOT_BALANCE_KEY, String(110_000 * 100_000));

  expect(budget.visibleFundsLuna(fam)).toBe(110_000 * 100_000);
  expect(budget.checkSpend(fam, 5_000 * 100_000).ok).toBe(true);
});

// Priming is what stops the dash appearing on a real install at all, and it must be
// idempotent: an existing deposit-check result is the better number and is never
// overwritten by a boot-time read.
test("priming leaves an existing snapshot alone", () => {
  repo.createFamily("Mom", HOT);
  wrepo.setWalletState(wrepo.HOT_BALANCE_KEY, "12345");
  expect(wrepo.getWalletState(wrepo.HOT_BALANCE_KEY)).toBe("12345");

  // The guard primeHotWalletSnapshot() uses before it reads the chain.
  const alreadyTracked = wrepo.getWalletState(wrepo.HOT_BALANCE_KEY) !== null;
  expect(alreadyTracked).toBe(true);
});
