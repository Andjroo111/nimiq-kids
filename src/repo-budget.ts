// Per-family payout budget (mini-app port slice 3). One shared hot wallet serves every
// household on a public instance, so a hostile self-serve family must never be able to
// grind it down by creating chores and self-approving. The rule:
//
//   cumulative hot-wallet payouts to a family  <=  demo grant + attributed credits
//
// SPENT side (derived from the existing ledgers; nothing is double-tracked):
//   earns   wallet_events kind='earn'            hot wallet -> kid (chore/routine payout);
//           status<>'failed'                     the ONLY excluded rows are ones the chain
//                                                PROVED did not execute (the node reports the
//                                                transaction included with executionResult
//                                                false), whose NIM is therefore still sitting
//                                                in the hot wallet. An unproven payout stays
//                                                counted: refunding budget for NIM that may
//                                                really have left the shared wallet would be a
//                                                repeatable grind (pay out, move the balance,
//                                                get the budget back). See earnSettleDecision
//                                                — nothing is ever written off on a timer.
//   refunds wallet_events kind='deposit' rows    hot wallet -> kid (rejected Treasure Box
//           with counterparty 'Treasure Box'     coupon gives the kid's NIM back)
//   mints   cashlinks kind payout/bonus/stars    hot-wallet-funded cashlinks (demo chore
//                                                approve, streak bonus, star allowance)
// Refunds are netted against the kid's own 'spend' rows (a refund always follows a
// spend of the same amount into the family wallet), so a spend->reject->refund loop
// costs the budget nothing: spent = earns + mints + max(0, refunds - spends).
// Kid-funded moves (peer cashlinks, sibling transfers, staking) never touch the hot
// wallet and are excluded. Refunds are NEVER blocked (the kid's money must come back);
// the netting keeps them budget-neutral.
//
// BUDGET side:
//   grant   HATCH_DEMO_GRANT_USD, resolved at the live rate (or HATCH_DEMO_GRANT_LUNA to pin
//           an exact luna ceiling; default 5 NIM; 0 disables un-funded self-serve payouts)
//   credits family_budget_credits rows: verified in-app top-ups + operator manual credits
//
// EXEMPTION: families.budget_exempt=1 (set by the migration for every household that
// existed before this shipped, or by the operator script) skips the check entirely.
// Additionally the instance's FIRST household is grandfathered by default — that is the
// pre-multi-family live install and every dev clone's demo family. A public instance
// sets HATCH_GRANDFATHER_FIRST=0 so the first onboarder gets no free ride.

import { getDb } from "./db";
import { nimUsdCached, usdToWholeNimLuna } from "./rates";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import { parentSignedPayouts } from "./custody";
import { familyWalletSnapshotLuna } from "./family-wallet";

/**
 * Starting budget for a self-serve family, in luna. Read at call time (tests + ops
 * can flip it without a restart-order dance). 0 = self-serve payouts disabled until
 * the family tops up.
 *
 * TWO KNOBS, AND THE DOLLAR ONE IS THE POLICY. A grant is "what I am willing to lose per
 * family", and that sentence is denominated in dollars, not in NIM — a fixed luna figure
 * silently means something different every time the price moves. That is not theoretical:
 * the starter board is priced in dollars (routes/onboard.ts, #131), so pinning the grant in
 * luna let the two drift until the board resolved to 4,240 NIM against a 2,000 NIM grant and
 * a brand-new family was refused on chore two of the sample board (#194). Anchoring both
 * sides to dollars makes `grant >= starter board` hold at EVERY rate rather than at the rate
 * someone last checked.
 *
 * `HATCH_DEMO_GRANT_LUNA` still wins when it is set, because an operator pinning an exact
 * luna ceiling is asking a narrower question than the policy and should get it. Neither set
 * keeps the shipped 5 NIM default, so nothing changes for an instance that configures
 * neither.
 */
export function demoGrantLuna(): number {
  const raw = process.env.HATCH_DEMO_GRANT_LUNA;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
    return 500_000;
  }
  const usd = Number(process.env.HATCH_DEMO_GRANT_USD ?? NaN);
  if (Number.isFinite(usd) && usd > 0) return usdToWholeNimLuna(usd, nimUsdCached());
  return 500_000;
}

export function isBudgetExempt(fam: repo.Family): boolean {
  if (fam.budget_exempt === 1) return true;
  if (process.env.HATCH_GRANDFATHER_FIRST === "0") return false;
  return repo.firstFamily()?.id === fam.id;
}

// ---- credits ----

export interface BudgetCredit {
  id: string; family_id: string; value_luna: number;
  source: "topup" | "manual"; tx_hash: string | null; note: string | null;
  created_at: number;
}

/** Credit a family's payout budget. `txHash` dedupes: the same on-chain tx can never
 *  credit twice (unique index + INSERT OR IGNORE) — returns null on a duplicate. */
export function addBudgetCredit(
  familyId: string, valueLuna: number, source: "topup" | "manual",
  txHash: string | null = null, note: string | null = null,
): BudgetCredit | null {
  if (!Number.isInteger(valueLuna) || valueLuna <= 0) throw new Error("invalid_credit_value");
  const row: BudgetCredit = {
    id: crypto.randomUUID(), family_id: familyId, value_luna: valueLuna,
    source, tx_hash: txHash, note, created_at: Date.now(),
  };
  const res = getDb().run(
    "INSERT OR IGNORE INTO family_budget_credits (id, family_id, value_luna, source, tx_hash, note, created_at) VALUES (?,?,?,?,?,?,?)",
    [row.id, row.family_id, row.value_luna, row.source, row.tx_hash, row.note, row.created_at],
  );
  return res.changes > 0 ? row : null;
}

/** Has this on-chain tx already credited SOMEONE's budget? The unique index is what
 *  actually prevents a double credit; this is the cheap pre-check that lets a replayed
 *  top-up skip the confirmation wait instead of sitting through it for nothing. */
export function hasBudgetCreditTx(txHash: string): boolean {
  if (!txHash) return false;
  return !!getDb().query("SELECT 1 FROM family_budget_credits WHERE tx_hash=? LIMIT 1").get(txHash);
}

export function creditsLuna(familyId: string): number {
  const row = getDb().query(
    "SELECT COALESCE(SUM(value_luna), 0) AS v FROM family_budget_credits WHERE family_id=?",
  ).get(familyId) as { v: number };
  return row.v;
}

export function listBudgetCredits(familyId: string): BudgetCredit[] {
  return getDb().query(
    "SELECT * FROM family_budget_credits WHERE family_id=? ORDER BY created_at DESC",
  ).all(familyId) as BudgetCredit[];
}

// ---- spent (derived) ----

/** Cumulative hot-wallet payouts to this family (see header for the formula). */
export function spentLuna(familyId: string): number {
  const db = getDb();
  const we = db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN kind='earn' AND status<>'failed' THEN value_luna ELSE 0 END), 0) AS earns,
       COALESCE(SUM(CASE WHEN kind='deposit' AND child_id IS NOT NULL
                          AND counterparty_label='Treasure Box' THEN value_luna ELSE 0 END), 0) AS refunds,
       COALESCE(SUM(CASE WHEN kind='spend' THEN -value_luna ELSE 0 END), 0) AS spends
     FROM wallet_events WHERE family_id=?`,
  ).get(familyId) as { earns: number; refunds: number; spends: number };
  const mints = (db.query(
    "SELECT COALESCE(SUM(value_luna), 0) AS v FROM cashlinks WHERE family_id=? AND kind IN ('payout','bonus','stars')",
  ).get(familyId) as { v: number }).v;
  return we.earns + mints + Math.max(0, we.refunds - we.spends);
}

// ---- the view + the gate ----

export interface BudgetView {
  exempt: boolean;
  grantLuna: number;
  creditsLuna: number;
  spentLuna: number;
  /** null when exempt (no cap) */
  availableLuna: number | null;
}

export function budgetView(fam: repo.Family): BudgetView {
  const exempt = isBudgetExempt(fam);
  const grant = demoGrantLuna();
  const credits = creditsLuna(fam.id);
  const spent = spentLuna(fam.id);
  return {
    exempt, grantLuna: grant, creditsLuna: credits, spentLuna: spent,
    availableLuna: exempt ? null : Math.max(0, grant + credits - spent),
  };
}

/**
 * What this family can actually pay out right now, in luna — the ONLY bound on a payout
 * since the per-payout ceiling was removed (Andjroo, 2026-07-31: "there should be no payout
 * ceiling, the parent should be able to pick that"). A parent prices a chore at whatever
 * they like; the single question at approval time is whether the money is there.
 *
 * Two bounds, whichever is tighter:
 *   budget   grant + attributed credits - spent, for a self-serve family on the shared
 *            public instance. Exempt families (the single-household install, the operator's
 *            own) have no budget bound.
 *   funds    the hot wallet's real balance. It bounds EVERY family, exempt or not: a budget
 *            cannot conjure NIM the wallet does not hold.
 *
 * Returns null for UNKNOWN, which never blocks: no snapshot has been taken (SIM, a fresh
 * dev DB, tests) and an exempt family has no budget either. Guessing zero there would
 * refuse every payout on a perfectly funded wallet.
 *
 * This is deliberately the same number GET /parent/overview shows as "Family wallet", so a
 * parent is never refused a payout their own screen says they can afford.
 */
export function payableLuna(fam: repo.Family): number | null {
  const budgetAvailable = budgetView(fam).availableLuna; // null when exempt
  const funds = wrepo.hotWalletSnapshotLuna();           // null when never snapshotted
  if (budgetAvailable === null) return funds;
  if (funds === null) return budgetAvailable;
  return Math.min(budgetAvailable, funds);
}

/**
 * The ONE money figure a household may be TOLD — everything client-facing goes through
 * here, and `payableLuna` above never leaves the server.
 *
 * `payableLuna` is min(budget, shared wallet). That minimum is the right GATE and the
 * wrong DISCLOSURE: the moment the shared wallet is the tighter of the two, the minimum
 * IS the instance float, and handing it to a caller publishes every other household's
 * balance — and, poll over poll, the amount and timing of their top-ups. That is the
 * steady state, not an edge case: the grant is deliberately "what you are willing to
 * lose per family", so several funded households will exceed the float between top-ups.
 *
 * A budgeted family is therefore only ever shown its OWN remaining budget — a fact about
 * itself, derived entirely from its own grant, its own attributed credits and its own
 * spending, and which no other household can move. An exempt family (the single-household
 * install, the operator's own) is shown the raw snapshot, because that wallet IS its own.
 *
 * The cost is that a budgeted family's screen can promise more than the instance can pay
 * at this instant. That was always true — the wallet moves between render and spend — and
 * the payout path re-reads the chain and refuses cleanly, leaving the approval pending.
 * An optimistic number is a smaller bug than a confidentiality leak.
 *
 * null = unknown (never snapshotted), same contract as `payableLuna`.
 */
export function visibleFundsLuna(fam: repo.Family): number | null {
  // UNDER PARENT CUSTODY THE ALLOWANCE IS NOT A WALLET, and showing it as one is why a
  // household holding 16,442 NIM read "Family wallet 0 NIM" on its own Home tab.
  //
  // The grant bounds spending out of the instance's SHARED float. There is no such float
  // here: the money leaves the parent's own account and `parentSignedApprove` decides before
  // the budget check is ever reached (routes/approvals.ts). So the remaining grant bounds
  // nothing, goes to zero after a few ordinary payouts, and the screen reports that as an
  // empty wallet. The household's wallet is `families.parent_address`, so its balance is the
  // honest number and the snapshot is per family (see repo-wallet.familyWalletSnapshotLuna).
  //
  // null when the snapshot has never been taken, which the parent app already renders as
  // "tap to check" rather than as zero — the same contract the shared snapshot has always had.
  if (parentSignedPayouts()) return familyWalletSnapshotLuna(fam.id);
  const budgetAvailable = budgetView(fam).availableLuna; // null when exempt
  return budgetAvailable === null ? wrepo.hotWalletSnapshotLuna() : budgetAvailable;
}

export type SpendCheck =
  | { ok: true }
  | { ok: false; availableLuna: number; reason: "budget" | "funds" };

/** Can this family fund `valueLuna` from the hot wallet? Callers gate BEFORE deciding an
 *  approval, so a blocked payout leaves the approval PENDING — nothing half-applied, and
 *  the parent can approve it again after a top up. Sync and snapshot-based; the wallet
 *  layer's `checkPayable` re-reads the chain before it ever refuses on a stale number.
 *
 *  A refusal reports `visibleFundsLuna`, never the bound that caused it: when the shared
 *  wallet is what refused, that bound is the instance float, and a caller who can trigger
 *  a refusal on demand could otherwise read it straight out of the error body. `reason`
 *  carries the truth about which bound bit, without carrying its value. */
export function checkSpend(fam: repo.Family, valueLuna: number): SpendCheck {
  const available = payableLuna(fam);
  if (available === null) return { ok: true };
  if (valueLuna <= available) return { ok: true };
  const budgetAvailable = budgetView(fam).availableLuna;
  const reason = budgetAvailable !== null && valueLuna > budgetAvailable ? "budget" : "funds";
  return { ok: false, availableLuna: Math.max(0, visibleFundsLuna(fam) ?? available), reason };
}
