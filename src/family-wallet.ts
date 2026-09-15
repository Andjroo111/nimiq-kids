// What a HOUSEHOLD's wallet holds, as opposed to what the instance's does.
//
// Under `HATCH_CUSTODY=parent` there is no shared hot wallet at all: the instance holds no
// key, and each household's wallet is `families.parent_address`, an account nobody else can
// spend from. Two facts follow, and they are why this module exists rather than another pair
// of helpers in repo-wallet.ts:
//
//   1. the balance snapshot is keyed BY FAMILY. Written to the instance-global key instead,
//      the last household to open its Home tab would decide what every other household
//      believed the instance was holding.
//   2. `depositCheckCore` is not route logic. It is the one place a balance read becomes a
//      snapshot, and both the route and the tests drive it, so it belongs beside the key it
//      writes rather than inside routes/wallet.ts.
//
// Both files it came out of were within a dozen lines of the 800-line CI guard, which is the
// point at which the repo's own rule says to split rather than to shave comments to fit.

import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as budget from "./repo-budget";
import { HOT_BALANCE_KEY } from "./repo-wallet";

/** Where one household's last known balance lives. Namespaced by family id, never shared. */
export const familyWalletKey = (familyId: string) => `family_wallet_last_balance:${familyId}`;

/** That household's last known on-chain balance, or null when never taken. Same contract as
 *  `hotWalletSnapshotLuna`: null is UNKNOWN, never zero. A caller must not read "no snapshot"
 *  as "no money" — the parent app renders null as "tap to check". */
export function familyWalletSnapshotLuna(familyId: string): number | null {
  const raw = wrepo.getWalletState(familyWalletKey(familyId));
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Manual refresh — three separate jobs, deliberately decoupled:
 *
 *   snapshot  re-read the wallet's on-chain balance. WHICH wallet depends on custody, and
 *             getting that wrong is what this module was extracted to fix: under parent
 *             custody the instance has no hot wallet, so reading it threw, the check answered
 *             502, and the snapshot behind the parent app's Home tab was never written.
 *             `scopeFamilyId` says whose account was read, and therefore which key to write.
 *
 *   delta     report the deposits attributed to THIS family that it has not seen yet.
 *             Attribution happens at broadcast time (topup-broadcast knows the bearer's
 *             family and verifies THAT TX executed). A raw balance delta on a SHARED
 *             wallet carries no attribution, so it is never turned into a family
 *             'deposit' event here: whichever household happens to poll first must see
 *             nothing of anyone else's money.
 *
 *   disclose  what comes back is `familyWalletLuna` — `visibleFundsLuna`, a fact about the
 *             caller and nobody else. The raw shared balance used to be returned verbatim to
 *             every parent-authed caller, which made the per-family delta beside it
 *             pointless: two polls around someone else's top-up differenced to their exact
 *             amount, timed to the poll interval.
 *
 * v1 stays a server-side compare on demand — no chain webhooks. SIM: snapshot-only.
 * `readBalance` (null = SIM, no chain read) is the seam the tests drive.
 */
export async function depositCheckCore(
  fam: repo.Family,
  readBalance: (() => Promise<number>) | null,
  /** Non-null under parent custody: write the snapshot against THIS household instead of the
   *  instance-global float, because the account read is that household's own. */
  scopeFamilyId: string | null = null,
): Promise<{ familyWalletLuna: number | null; deltaLuna: number } | { error: "balance_check_failed"; detail: string }> {
  if (readBalance) {
    let balanceLuna: number;
    try {
      balanceLuna = await readBalance();
    } catch (err) {
      return { error: "balance_check_failed", detail: String((err as Error)?.message ?? err) };
    }
    wrepo.setWalletState(
      scopeFamilyId ? familyWalletKey(scopeFamilyId) : HOT_BALANCE_KEY,
      String(balanceLuna),
    );
  }
  const deltaLuna = wrepo.takeUnseenFamilyDepositLuna(fam.id);
  // Read AFTER the delta is taken: a just-credited top-up should be reflected.
  return { familyWalletLuna: budget.visibleFundsLuna(fam), deltaLuna };
}
