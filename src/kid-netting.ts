/**
 * Deferred spending, and how it settles: the kid's debit ledger.
 *
 * ## The problem this exists for
 *
 * Under `HATCH_CUSTODY=parent` this server holds no key for a kid's address, so nothing can
 * leave it without the parent's own wallet signing. A Treasure Box purchase is an outflow, so
 * on that instance the Box either stops working or every sticker pack opens a wallet popup —
 * a second signature, for a purchase the parent already pre-approved by stocking the shelf
 * and pricing it.
 *
 * Netting removes the second popup. A purchase records a DEBIT instead of a transaction; the
 * next payout the parent signs is minted for the difference. One signature, two movements of
 * money, and the arithmetic is identical to having sent both.
 *
 * ## Why deferring is defensible here and would not be elsewhere (Andjroo, 2026-08-03)
 *
 * A purchase pays the kid's address -> `families.parent_address`, and under parent custody
 * BOTH of those are addresses of the parent's own wallet. The deferred transaction changes
 * nothing about who controls the money; it only defers which pocket it sits in. This is not
 * an IOU against the parent, which is the route that was rejected.
 *
 * ## The four rules, and where each one lives
 *
 *  1. **Earnings always produce a real transaction; only SPENDS net.** Nothing in here ever
 *     writes a payout into a ledger and calls it paid. `netPayout` reduces what a parent
 *     signs, it never replaces the signing. The one edge is a payout the debt eats WHOLE —
 *     see the long note on `netPayout`.
 *  2. **A purchase is instant.** No signature, no queue: the shown balance drops the moment
 *     the debit lands, and the debit eats the next payout.
 *  3. **Outstanding debt may never exceed the kid's on-chain balance.** Every luna a kid has
 *     committed is genuinely sitting at their address, so this is deferred settlement rather
 *     than credit. Enforced twice on purpose — the caller checks affordability against the
 *     debt-adjusted balance (`availableKidLuna`), and `recordDeferredSpend` refuses outright
 *     against the raw chain balance, because a rule this load-bearing should not be
 *     enforceable only by remembering to call something else first.
 *  4. **Graduation and export settle debt first**, or a kid walks off holding NIM they have
 *     already spent. There is no export path in the tree yet; `outstandingDebtLuna` is the
 *     call it must make, and this sentence is the reason.
 *
 * ## The balance identity
 *
 * ONE rule in both worlds, which is why the debt is subtracted inside `kidBalanceLuna`
 * rather than at each screen:
 *
 *     what the kid has  =  (SIM ? ledger sum : on-chain balance)  −  outstanding debt
 *
 * A deferred purchase therefore writes NO `wallet_events` row. That table is the record of
 * what moved, and a deferred purchase is precisely the thing that has not moved; writing one
 * would also double-count in SIM, where the ledger IS the balance.
 */

import { getDb } from "./db";
import { parentSignedPayouts } from "./custody";

/**
 * 'hold'       +v  a deferred purchase the parent can still REFUSE (a coupon). Counts against
 *                  the balance immediately, and is deliberately NOT nettable — see
 *                  `committedDebtLuna`.
 * 'purchase'   +v  a deferred spend that is final. Nettable.
 * 'settlement' −v  debt a payout carried instead of moving.
 * 'refund'     −v  a held purchase the parent refused.
 */
export type KidDebitKind = "hold" | "purchase" | "settlement" | "refund";

export interface KidDebit {
  id: string;
  family_id: string;
  child_id: string;
  /** SIGNED IN THE DIRECTION OF DEBT: +v a deferred spend, −v a payout or refund clearing one. */
  value_luna: number;
  kind: KidDebitKind;
  /** `kid_purchases.id` for a hold, purchase or refund; the payout ref for a settlement. */
  source_id: string | null;
  message: string | null;
  created_at: number;
}

const uid = () => crypto.randomUUID();
const nowMs = () => Date.now();

/**
 * Does a kid's spend defer on this instance instead of going on chain?
 *
 * The SAME predicate that decides who signs a payout, deliberately, and not a per-child one.
 * A debit is only ever cleared by a payout the parent signs, so an instance where deferral
 * and parent-signed payouts could disagree is an instance where a kid can accrue a debt with
 * no path that settles it. `parentSignedPayouts` also already refuses to boot with a signing
 * key present, so on such an instance there is no kid whose spend COULD have gone on chain.
 */
export function deferKidSpends(env: Record<string, string | undefined> = process.env): boolean {
  return parentSignedPayouts(env);
}

// ---------------------------------------------------------------------------
// Reading the ledger
// ---------------------------------------------------------------------------

function insert(row: KidDebit): KidDebit {
  getDb().run(
    `INSERT INTO kid_debits (id, family_id, child_id, value_luna, kind, source_id, message, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [row.id, row.family_id, row.child_id, row.value_luna, row.kind, row.source_id, row.message, row.created_at],
  );
  return row;
}

function sumDebits(childId: string, kinds: KidDebitKind[]): number {
  const marks = kinds.map(() => "?").join(",");
  const row = getDb()
    .query(`SELECT COALESCE(SUM(value_luna), 0) AS v FROM kid_debits WHERE child_id=? AND kind IN (${marks})`)
    .get(childId, ...kinds) as { v: number };
  return row.v;
}

/** Everything the kid has spent and not yet settled, holds included. THIS is what comes off
 *  the balance: a held coupon has bought something even though the parent has not handed it
 *  over yet, and a kid must not be able to spend that money twice while they wait. */
export function outstandingDebtLuna(childId: string): number {
  return sumDebits(childId, ["hold", "purchase", "settlement", "refund"]);
}

/**
 * The debt a payout is allowed to absorb.
 *
 * HOLDS ARE EXCLUDED, AND THAT IS THE WHOLE REASON THE KIND EXISTS. A settlement is not
 * reversible: once a payout has been minted 30 NIM smaller, the kid received 30 NIM less real
 * money. If a held coupon's debt could be absorbed and the parent then rejected the coupon,
 * the refund would have to be a real transaction — which under parent custody is a second
 * signature, i.e. exactly the thing this module exists to avoid. Reversing the debit instead
 * would push the total debt negative and show the kid NIM that is not at their address.
 *
 * So a coupon's debt is nettable only once the parent has honoured it and it can no longer
 * come back. Nothing is lost by waiting: the balance already dropped at purchase.
 */
export function committedDebtLuna(childId: string): number {
  return sumDebits(childId, ["purchase", "settlement"]);
}

/** The kid-facing history of deferred spending, newest first. */
export function listKidDebits(childId: string, limit = 50): KidDebit[] {
  return getDb()
    .query("SELECT * FROM kid_debits WHERE child_id=? ORDER BY created_at DESC LIMIT ?")
    .all(childId, limit) as KidDebit[];
}

/** The debit a purchase created, if it was deferred rather than sent. Null for an on-chain
 *  buy — which is what tells a refund which of the two worlds it has to undo. */
export function debitForPurchase(purchaseId: string): KidDebit | null {
  return (getDb()
    .query("SELECT * FROM kid_debits WHERE kind IN ('hold','purchase') AND source_id=?")
    .get(purchaseId) as KidDebit) ?? null;
}

/** The settlement a payout wrote, if it wrote one. The unique index behind it is what makes a
 *  re-approve idempotent for a payout that had no bytes to dedupe against. */
export function debtSettledByPayout(ref: string): KidDebit | null {
  return (getDb()
    .query("SELECT * FROM kid_debits WHERE kind='settlement' AND source_id=?")
    .get(ref) as KidDebit) ?? null;
}

/**
 * Debt already promised to a payout that has not settled yet.
 *
 * WITHOUT THIS, TWO APPROVALS IN THE SAME MINUTE BOTH NET AGAINST THE SAME DEBT and the kid
 * is short the difference in real NIM. Debt 30, two 100-NIM chores approved back to back:
 * each intent is minted for 70, the parent signs both, 140 arrives, and 30 of genuinely
 * earned NIM was subtracted twice for one ice cream. Clamping at settlement time does not fix
 * it — by then the parent has already signed the smaller number.
 *
 * An intent's netting is pinned into `payout_attempts.netted_luna` at mint, so the reservation
 * is just the sum of the pins that have not become settlement rows yet.
 *
 * Two exclusions, both in the safe direction:
 *   - 'settled' attempts, because a settled attempt has already written its settlement row and
 *     is therefore inside `committedDebtLuna` already (the relay writes the settlement BEFORE
 *     it marks the attempt settled, so this ordering holds even if the process dies between).
 *   - an EXPIRED 'preparing' attempt, which no signature can ever redeem — `verifySignedPayout`
 *     refuses it — so holding its reservation would strand that debt against a payout that
 *     cannot happen. An 'in_flight' attempt keeps its reservation whatever the clock says:
 *     those bytes are already on the wire.
 *
 * Over-reserving is harmless and self-correcting: the parent signs the full amount and the
 * debt settles against a later payout. Under-reserving loses the kid money. So where the two
 * are in tension this counts the reservation.
 */
export function reservedNettingLuna(childId: string, at = nowMs()): number {
  const row = getDb().query(
    `SELECT COALESCE(SUM(netted_luna), 0) AS v FROM payout_attempts
      WHERE child_id=? AND netted_luna > 0 AND status <> 'settled'
        AND (status <> 'preparing' OR COALESCE(expires_at, 0) > ?)`,
  ).get(childId, at) as { v: number };
  return row.v;
}

/** The debt a payout being minted RIGHT NOW may net against. */
export function nettableDebtLuna(childId: string, at = nowMs()): number {
  return Math.max(0, committedDebtLuna(childId) - reservedNettingLuna(childId, at));
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

export interface Netting {
  /** What the parent actually signs, and what actually moves. */
  chainLuna: number;
  /** How much of the gross went to clearing what the kid already spent. */
  settleLuna: number;
}

/**
 * Split a gross payout into the part that moves and the part that clears a debt. Pure.
 *
 * ## When the debt eats the payout WHOLE
 *
 * `chainLuna` can be 0, and then nothing is signed and nothing moves. That is the one place
 * rule 1 ("earnings always produce a real on-chain transaction") and rule 2 ("the debit eats
 * the next payout") meet, and rule 2 wins, because at zero the two transactions rule 1 would
 * insist on are a parent paying a child N and the child paying the parent N straight back —
 * between two addresses of the same wallet, in the same second, for a net movement of nothing.
 *
 * What rule 1 protects is not the transaction count; it is that the app must never show a kid
 * NIM that is not really theirs. Rule 3 protects that instead, and completely: debt can never
 * exceed the on-chain balance, so `chain − debt` — every number the app shows — is backed by
 * NIM genuinely sitting at the kid's own address. A fully-netted payout leaves that identity
 * exactly as true as a partly-netted one.
 */
export function netPayout(grossLuna: number, debtLuna: number): Netting {
  const gross = Math.max(0, grossLuna);
  const settleLuna = Math.min(gross, Math.max(0, debtLuna));
  return { chainLuna: grossLuna - settleLuna, settleLuna };
}

// ---------------------------------------------------------------------------
// Writing to it
// ---------------------------------------------------------------------------

/**
 * Record a purchase the kid made without moving anything.
 *
 * Rule 3 is enforced HERE against the RAW chain balance, not against the caller's
 * already-adjusted one, so the invariant holds even if a future caller forgets to subtract the
 * debt first. Throws `insufficient_funds` — the same string the on-chain path throws for the
 * same condition, so `routes/store.ts` maps one error to one status code for both worlds.
 *
 * `refundable` decides the kind, and it is the caller's fact about the GOODS, not about money:
 * a coupon waits for a parent and can come back, a sticker pack is granted on the spot and
 * cannot.
 */
export function recordDeferredSpend(args: {
  familyId: string;
  childId: string;
  valueLuna: number;
  /** The kid's RAW balance (`kidChainBalanceLuna`), NOT the debt-adjusted one. */
  chainBalanceLuna: number;
  message: string;
  refundable: boolean;
}): KidDebit {
  const { familyId, childId, valueLuna, chainBalanceLuna, message } = args;
  if (!Number.isInteger(valueLuna) || valueLuna <= 0) throw new Error("invalid_value");
  if (outstandingDebtLuna(childId) + valueLuna > chainBalanceLuna) throw new Error("insufficient_funds");
  return insert({
    id: uid(), family_id: familyId, child_id: childId, value_luna: valueLuna,
    kind: args.refundable ? "hold" : "purchase", source_id: null,
    message: message.slice(0, 64), created_at: nowMs(),
  });
}

/** Link a purchase debit to the receipt it paid for, once that row exists. The purchase is
 *  written after the charge — a failed charge must not leave a receipt behind — so the debit
 *  is minted first and told what it bought a line later. */
export function attachDebitToPurchase(debitId: string, purchaseId: string): void {
  getDb().run(
    "UPDATE kid_debits SET source_id=? WHERE id=? AND kind IN ('hold','purchase')",
    [purchaseId, debitId],
  );
}

/** The parent honoured the coupon, so its debt can no longer come back and may now be netted
 *  against a payout. No money moves: this only moves a row from held to committed. */
export function commitHeldDebit(purchaseId: string): void {
  getDb().run("UPDATE kid_debits SET kind='purchase' WHERE kind='hold' AND source_id=?", [purchaseId]);
}

/**
 * Clear `settleLuna` of debt because a payout carried it. Idempotent on the payout ref: the
 * unique index refuses a second row, and the existing one is returned instead.
 *
 * Called AFTER the bytes are on the wire — or, for a fully-netted payout, at the moment the
 * approval is decided, because there are no bytes and nothing to wait for. NEVER at mint time:
 * an intent that expires unsigned must leave the debt exactly where it was, or a parent who
 * closed the tab has forgiven a debt for free.
 */
export function settleDebtForPayout(args: {
  familyId: string;
  childId: string;
  ref: string;
  settleLuna: number;
  message?: string | null;
}): KidDebit | null {
  const { familyId, childId, ref, settleLuna } = args;
  if (settleLuna <= 0) return null;
  const already = debtSettledByPayout(ref);
  if (already) return already;
  try {
    return insert({
      id: uid(), family_id: familyId, child_id: childId, value_luna: -settleLuna,
      kind: "settlement", source_id: ref, message: (args.message ?? "").slice(0, 64) || null,
      created_at: nowMs(),
    });
  } catch {
    // Lost the unique index to a concurrent writer. Its row is the record; ours would have
    // been a second forgiveness of one debt.
    return debtSettledByPayout(ref);
  }
}

/**
 * Undo a held purchase the parent refused (a rejected coupon). The mirror of the chain refund
 * in `refundKidSpend`, and the reason a refund has to ask `debitForPurchase` which world the
 * purchase happened in: paying a deferred purchase back out of the hot wallet would hand the
 * kid NIM for money that never left their address.
 *
 * Only ever reachable for a 'hold', which by construction no payout has absorbed, so the total
 * debt can never be driven negative by one. Idempotent on the purchase, so a double reject
 * cannot pay a kid back twice.
 */
export function reverseHeldDebit(args: {
  familyId: string;
  childId: string;
  purchaseId: string;
  valueLuna: number;
  message?: string | null;
}): KidDebit | null {
  const { familyId, childId, purchaseId, valueLuna } = args;
  if (valueLuna <= 0) return null;
  const already = (getDb()
    .query("SELECT * FROM kid_debits WHERE kind='refund' AND source_id=?")
    .get(purchaseId) as KidDebit) ?? null;
  if (already) return already;
  return insert({
    id: uid(), family_id: familyId, child_id: childId, value_luna: -valueLuna,
    kind: "refund", source_id: purchaseId, message: (args.message ?? "").slice(0, 64) || null,
    created_at: nowMs(),
  });
}
