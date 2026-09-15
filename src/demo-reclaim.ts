// Return an abandoned demo family's NIM to the hot wallet before the household is forgotten.
//
// WHY THIS EXISTS. Every visitor to the public demo is paid a real seeded history on chain
// (see payDemoHistory in ./demo-family), and `purgeFamily` then deletes the household without
// touching the money: "this only forgets the household, it cannot claw money back." So each
// visitor permanently scattered their whole seed into two accounts nobody would ever open
// again. Measured on the live testnet instance 2026-08-01: 375,497 NIM parked in 85 live demo
// families against 808,643 NIM left in the hot wallet — about a THIRD of the supply sitting in
// accounts queued for deletion. That is issue #44, and it is the difference between the demo
// being a budget that drains and a float that recycles.
//
// The money is recoverable because demo kid accounts are SERVER-CUSTODIED: they are derived
// from HATCH_MASTER_SEED and `kidKey(child)` returns a usable private key. This file is the
// only place that spends that fact for anything other than the kid's own action, so the
// guards below are the whole safety argument. Read them before changing anything here.

import { SIM } from "./nimiq/client";
import { getClient } from "./nimiq/client";
import { retryRead } from "./nimiq/retry-read";
import { makeProvider, providerForKey } from "./wallet";
import { kidKey } from "./wallet/kid-wallet";
import { childSpendKey, withSpendLock } from "./wallet/spend-lock";
import * as repo from "./repo";
import { getDb } from "./db";

/**
 * Reclaim is ON wherever demo families are minted, and off with `HATCH_DEMO_RECLAIM=0`.
 *
 * Defaulting ON is deliberate. The alternative — a flag someone must remember to set — leaves
 * the leak running on exactly the instance that has it, which is how it went unnoticed for a
 * fortnight. There is nothing to lose by reclaiming: the household is being deleted in the
 * same breath, so the NIM has no owner left to surprise.
 */
export const reclaimEnabled = (): boolean => process.env.HATCH_DEMO_RECLAIM !== "0";

/** What one family's reclaim did. `failed` drives whether the sweeper purges it yet. */
export interface Reclaimed {
  familyId: string;
  reclaimedLuna: number;
  /** Accounts actually swept. */
  swept: number;
  /** Accounts that threw. A non-zero count keeps the household alive for a retry. */
  failed: number;
  /** Accounts deliberately left alone (empty, or no key on this server). Not a failure. */
  skipped: number;
}

/**
 * The chain-touching seam, injectable so the decision logic above it is testable without a
 * node. The real implementation is the same pair of calls the kid's own spend path uses
 * (`getClient().getBalance` + `providerForKey(...).sendTransaction`), so a reclaim is not a
 * second, differently-behaved way to move a kid's money.
 */
export interface ReclaimChain {
  hotAddress(): Promise<string>;
  balanceOf(address: string): Promise<number>;
  sweepTo(child: repo.Child, recipient: string, valueLuna: number): Promise<string>;
}

// The retry policy this file used to define privately now lives in src/nimiq/retry-read.ts and
// is applied by getClient() to EVERY chain read, not just this sweep's. That was the bug it was
// half-fixing: the hourly reclaim was protected while the kid's own home screen read bare, so a
// 429 that this job would have shrugged off turned the Treasure Box into 0 NIM.
//
// `balanceOf` therefore no longer wraps: getClient().getBalance already retries, and wrapping a
// retry in a retry would make one rate-limited read cost sixteen attempts and ~45s of backoff.

const realChain: ReclaimChain = {
  // Still wrapped: makeProvider().getAddress() is not a getClient() call, so nothing else
  // covers it. Under the dev provider this is local key derivation and cannot fail
  // transiently, which the shared helper handles by rethrowing at once.
  hotAddress: () => retryRead(() => makeProvider().getAddress()),
  balanceOf: async (address) => (await getClient()).getBalance(address),
  sweepTo: async (child, recipient, valueLuna) => {
    // kidKey throws for a parent-owned address rather than deriving one. That refusal is the
    // backstop behind `spendableByServer` below, not a duplicate of it: the check states the
    // intent, the throw guarantees it even if the check is ever loosened.
    const key = await kidKey(child);
    return providerForKey(key.privHex).sendTransaction({
      recipient, valueLuna, extraData: "demo reclaim",
    });
  },
};

/**
 * Can this server move money out of the child's account at all?
 *
 * Both conditions are about custody, not about convenience. A `parent` address was registered
 * from a grown-up's own wallet (v0.77.0) and no key for it exists here; a NULL account_index
 * means the account was never derived, so there is nothing to sign with and asking would make
 * `assignKidAccount` mint coordinates as a side effect.
 */
function spendableByServer(child: repo.Child): boolean {
  return child.address !== null && child.address_source !== "parent" && child.account_index !== null;
}

/** True only for a household `demo_at` has stamped as throwaway. */
export function isDemoFamily(familyId: string): boolean {
  const row = getDb()
    .query("SELECT demo_at FROM families WHERE id=?")
    .get(familyId) as { demo_at: number | null } | null;
  return !!row && row.demo_at !== null;
}

/**
 * Send every reclaimable balance in one demo family home to the hot wallet.
 *
 * Refuses outright on a household that is not a demo family. That check is the reason this is
 * safe to call from a sweeper: the ONLY way to reach a real family's kid money through this
 * file is to have already stamped that family `demo_at`, which only `mintDemoFamily` does.
 *
 * Never throws for a single account. One kid failing (an unreachable node, a key mismatch on a
 * restored row) must not cost the other kid's balance or the rest of the sweep, so failures are
 * counted and returned. The caller decides what a non-zero `failed` means.
 */
export async function reclaimDemoFamily(
  familyId: string, chain?: ReclaimChain,
): Promise<Reclaimed> {
  const out: Reclaimed = { familyId, reclaimedLuna: 0, swept: 0, failed: 0, skipped: 0 };
  if (!isDemoFamily(familyId)) {
    throw new Error(`not_a_demo_family: refusing to reclaim balances for ${familyId}`);
  }
  // SIM never put anything on chain, so there is nothing to bring back and a "reclaim" would
  // be a fabricated transaction against a real-looking address. An INJECTED chain is a test's
  // own fake, which is exercised on purpose — that distinction is what lets the decision logic
  // below have tests at all, since the whole suite runs in SIM.
  if (!chain && SIM) return out;
  const c = chain ?? realChain;

  const kids = repo.listChildren(familyId);
  if (!kids.length) return out;

  let hot: string;
  try {
    hot = await c.hotAddress();
  } catch {
    // No destination means nothing can be swept. Report every kid as failed rather than as
    // skipped, so the caller holds the household back for a retry instead of deleting it.
    out.failed = kids.filter(spendableByServer).length;
    return out;
  }

  for (const child of kids) {
    if (!spendableByServer(child)) { out.skipped += 1; continue; }
    try {
      // THE SWEEP IS A DOOR TO A KID'S MONEY, so it takes the same key every other door
      // takes. spend-lock.ts names "every door to a kid's money" in its own contract and
      // this was the one outside it: [read the balance -> move ALL of it] across an await,
      // beside a Treasure Box buy doing [read the balance -> move some of it] across its
      // own. Both read the pre-spend balance, both broadcast, and the chain refuses the
      // second — on the judge demo, at the worst possible moment, as a chain fault rather
      // than as our own scheduling.
      //
      // Deliberately per-kid and tight: the section spans two RPC round trips, and
      // spend-lock.ts documents that head-of-line blocking is real. A visitor's buy waits
      // for THEIR kid's sweep, never for another household's.
      const moved = await withSpendLock(childSpendKey(child.id), async () => {
        const balance = await c.balanceOf(child.address!);
        // Fees are 0 on Albatross, so the whole balance moves and there is no dust threshold
        // to pick. A zero balance is the normal case for a kid who spent their seed in the Box.
        if (balance <= 0) return 0;
        await c.sweepTo(child, hot, balance);
        return balance;
      });
      if (moved <= 0) { out.skipped += 1; continue; }
      out.reclaimedLuna += moved;
      out.swept += 1;
    } catch {
      out.failed += 1;
    }
  }
  return out;
}
