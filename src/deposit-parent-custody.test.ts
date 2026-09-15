// A parent-custody household could never see its own wallet balance.
//
// `POST /api/family/deposit-check` read the balance of `makeProvider().getAddress()` — the
// INSTANCE hot wallet. Under `HATCH_CUSTODY=parent` that wallet does not exist by design
// (the instance holds no key at all), so the provider threw, the check answered 502
// `balance_check_failed`, and the snapshot behind the parent app's Home tab was never
// written. Observed on the live mainnet instance 2026-09-01: a household whose
// `parent_address` held 16,442 NIM read "Family wallet 0 NIM".
//
// The zero came from the OTHER half of the same bug. With no snapshot, `visibleFundsLuna`
// fell through to the family's remaining grant — a bound that means nothing under parent
// custody, because the money leaves the parent's own account and `parentSignedApprove`
// decides before the budget check is reached. Six ordinary payouts exhaust a 2,000 NIM
// grant, and the screen renders that as an empty wallet.
//
// So both halves are pinned here: which ACCOUNT is read, and which NUMBER is shown. Plus
// the isolation the fix must not cost — one household's balance may not be written to the
// instance-global key, where it would stand in for the float for every other household.
//
// Hermetic: in-memory DB, injected `readBalance`, no chain and no provider.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import { familyWalletSnapshotLuna } from "./family-wallet";
import * as budget from "./repo-budget";
import { depositCheckCore, HOT_BALANCE_KEY } from "./routes/wallet";

const L = 100_000;
const PARENT_WALLET = "NQ29 53LY BTQU T07K C8D4 XE6D GCG4 AL35 6MKD";

const ENV_KEYS = ["HATCH_CUSTODY", "HATCH_DEMO_GRANT_LUNA", "HATCH_GRANDFATHER_FIRST"] as const;
const saved: Record<string, string | undefined> = {};

let fam: repo.Family;

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // A public instance: nobody grandfathered, so the grant actually binds and the old
  // fall-through to `budgetView` is reachable rather than exempted away.
  process.env.HATCH_GRANDFATHER_FIRST = "0";
  process.env.HATCH_DEMO_GRANT_LUNA = String(2_000 * L);
  initTestDb();
  const f = repo.createFamily("Dad", PARENT_WALLET);
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

test("parent custody: the check reads the HOUSEHOLD's wallet, not the instance's", async () => {
  process.env.HATCH_CUSTODY = "parent";
  const asked: string[] = [];
  // Exactly what the route now passes: the family row's address, never the provider's.
  const readBalance = async () => { asked.push(fam.parent_address); return 16_442 * L; };

  const res = await depositCheckCore(fam, readBalance, fam.id);

  expect("error" in res).toBe(false);
  expect(asked).toEqual([PARENT_WALLET]);
});

test("parent custody: the snapshot lands on the family, never the shared key", async () => {
  process.env.HATCH_CUSTODY = "parent";
  await depositCheckCore(fam, async () => 16_442 * L, fam.id);

  expect(familyWalletSnapshotLuna(fam.id)).toBe(16_442 * L);
  // The instance float is a different fact and must stay untouched: one household's
  // balance standing in for it would be read by every other household as the instance's.
  expect(wrepo.getWalletState(HOT_BALANCE_KEY)).toBeNull();
  expect(wrepo.hotWalletSnapshotLuna()).toBeNull();
});

test("parent custody: the Home tab shows the balance, not the spent grant", async () => {
  process.env.HATCH_CUSTODY = "parent";
  // The regression, made concrete: payouts past the grant drive `budgetView` to zero.
  // Spend is derived from the 'earn' wallet events (repo-budget.spentLuna), so six real
  // chore payouts are written the way the payout path writes them.
  const kid = repo.createChild(fam.id, "Sam", "\u{1F996}");
  for (const luna of [1_564, 1_564, 2_346, 3_128, 3_128, 2_128]) {
    wrepo.addWalletEvent({
      familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: luna * L,
      counterpartyLabel: "Family wallet", message: "chore",
    });
  }
  expect(budget.budgetView(fam).availableLuna).toBe(0);

  await depositCheckCore(fam, async () => 16_442 * L, fam.id);

  expect(budget.visibleFundsLuna(fam)).toBe(16_442 * L);
});

test("parent custody: never snapshotted reads as UNKNOWN, never as zero", () => {
  process.env.HATCH_CUSTODY = "parent";
  expect(budget.visibleFundsLuna(fam)).toBeNull();
});

test("server custody is untouched: shared key, and the grant is still the disclosure", async () => {
  delete process.env.HATCH_CUSTODY;
  await depositCheckCore(fam, async () => 16_442 * L, null);

  expect(wrepo.hotWalletSnapshotLuna()).toBe(16_442 * L);
  expect(familyWalletSnapshotLuna(fam.id)).toBeNull();
  // A budgeted family is shown its own remaining grant, which is the whole point of
  // `visibleFundsLuna` on a shared instance. That behaviour must not move.
  expect(budget.visibleFundsLuna(fam)).toBe(budget.budgetView(fam).availableLuna);
});

test("a failed read still refuses, and writes nothing", async () => {
  process.env.HATCH_CUSTODY = "parent";
  const res = await depositCheckCore(fam, async () => { throw new Error("node unreachable"); }, fam.id);

  expect(res).toMatchObject({ error: "balance_check_failed" });
  expect(familyWalletSnapshotLuna(fam.id)).toBeNull();
});
