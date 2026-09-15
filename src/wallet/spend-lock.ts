// Serialize every execution path that spends a balance, so two concurrent spends of the
// same money cannot both read the pre-spend balance and both proceed.
//
// Two concurrent approvals for the same child used to do exactly that: each read the
// confirmed balance, each passed the affordability check, and both executed — the loser's
// money did not exist. The affordability re-check at execution time (v0.27.1) closes the
// SEQUENTIAL case only; it does nothing for two executions interleaving across their await
// points. The fix is to make [read balance -> check -> move money -> record it] one
// critical section per balance owner.
//
// KEYS — one per balance that can be overspent:
//   childKey(id)   the kid's own derived account: cashlink mints, transfers, Treasure Box
//                  buys, stakes/unstakes — approval-queue execution AND the instant paths.
//   familyKey(id)  the family hot wallet + payout budget: chore/routine payouts, coupon
//                  refunds, allowance mints.
//
// WHY an in-process mutex is sound here: each instance is exactly one Bun process (a single
// `export default { port, fetch }` server — no cluster, no reusePort, no workers) with its
// own SQLite file. Nothing else writes these tables. If that ever changes, this must become
// a cross-process guard (e.g. BEGIN IMMEDIATE around claim + check); the row-claim in
// decideApproval/tryDebit already backstops double-execution of a SINGLE approval, but only
// this section serializes two DIFFERENT spends against one balance.
//
// USAGE RULE — the mutex is NOT reentrant, so each key is taken in exactly one layer:
//   child keys   inside the wallet services (kidTransfer/kidSpend/executeSendRequest/
//                stake/unstake), which is every door to a kid's money; nested calls go
//                through the private *Locked internals instead of re-locking.
//   family keys  at the route span that pairs the affordability check with the payout
//                (approvals, chore approve, allowance payout, streak bonus, legacy gift)
//                — the check is what must not race, and it lives in the routes.
// A family-locked span may call child-locked services only if they spend a DIFFERENT
// balance (they do: kid account vs hot wallet); never take two keys for one spend.
//
// HEAD-OF-LINE BLOCKING, measured and bounded. The critical section spans the payout's RPC
// round trip, so a degraded node serializes every other family-keyed spend behind it —
// chore and routine payouts, the direct chore approve, the allowance mint, the streak bonus
// and the legacy gift all take the same key. The bound is the RPC client's own
// AbortController (nimiq-settlement rpc-sender, 15s default), so a hung node costs ~15s per
// payout rather than wedging the household forever; a queue of N approvals against such a
// node drains at roughly that rate with no user-visible progress. Nothing here bounds the
// section itself. Shrinking it means moving the broadcast outside the lock, which the
// affordability check cannot currently survive — worth doing, deliberately, not in passing.

const tails = new Map<string, Promise<void>>();

/** Run `fn` exclusively for `key`: callers with the same key run strictly one after
 *  another, in arrival order; different keys never wait on each other. Rejections
 *  propagate to the caller and never poison the chain. */
export function withSpendLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn);
  const tail = run.then(() => undefined, () => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** The kid's own derived account (sends, buys, stakes). */
export const childSpendKey = (childId: string) => `child:${childId}`;

/** The family hot wallet + payout budget (earn payouts, refunds, allowance mints). */
export const familySpendKey = (familyId: string) => `family:${familyId}`;

/**
 * Run `fn` behind EVERY listed child's spend key at once.
 *
 * The one caller is the demo sweeper's purge, and it is the one operation that is not a spend
 * yet must not interleave with one: it deletes the child rows holding the derivation
 * coordinates, so a kid spend still in flight across its awaits would be left with nothing to
 * sign with. Wrapping it in the keys means it can only land BETWEEN spends.
 *
 * THE USAGE RULE ABOVE STILL HOLDS — this is not two keys for one spend, it moves no money at
 * all. It is nonetheless the only place that holds more than one key, so: pass the ids in a
 * stable order (sorted). Every other caller takes exactly one key and can therefore never be
 * half of a cycle, but two callers of THIS taking the same pair in opposite orders could be.
 */
export function withChildSpendLocks<T>(childIds: string[], fn: () => Promise<T>): Promise<T> {
  return childIds.reduce<() => Promise<T>>(
    (inner, id) => () => withSpendLock(childSpendKey(id), inner),
    fn,
  )();
}
