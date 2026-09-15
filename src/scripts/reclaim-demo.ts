// Reclaim abandoned demo families' NIM to the hot wallet, on demand (issue #44).
//
// The running server already does this on its hourly sweep. This script exists for the two
// things a sweep cannot give you: a DRY RUN that prices the backlog before anything moves, and
// a way to drain a backlog that built up before reclaim shipped without waiting hours for the
// timer to walk it.
//
//   bun run src/scripts/reclaim-demo.ts --dry-run     # read balances, send nothing
//   bun run src/scripts/reclaim-demo.ts --yes         # reclaim families past the TTL
//   bun run src/scripts/reclaim-demo.ts --yes --include-active
//
// Source the instance's env first, so DB_PATH, HATCH_MASTER_SEED and NIMIQ_RPC_URL are the
// ones that actually own these accounts:
//
//   set -a; . ~/secrets/hatch-testnet.env; set +a
//
// --include-active is the dangerous flag and is deliberately awkward. Without it this only
// touches households past HATCH_DEMO_TTL_MS, which are abandoned by definition. WITH it, every
// demo family is drained — including the ones judges are looking at RIGHT NOW, whose kids would
// watch their balance go to zero mid-demo. Use it only when the demo is not being used.

import { initDb } from "../db";
import * as repo from "../repo";
import { getClient, SIM, NETWORK } from "../nimiq/client";
import { makeProvider } from "../wallet";
import { DEMO_TTL_MS, staleDemoFamilyRows } from "../demo-family";
import { reclaimDemoFamily } from "../demo-reclaim";
import { getDb } from "../db";

const DRY = process.argv.includes("--dry-run");
const YES = process.argv.includes("--yes");
const ACTIVE = process.argv.includes("--include-active");

if (!YES && !DRY) throw new Error("Refusing without --yes (this sends real NIM). Use --dry-run to price it first.");
if (YES && DRY) throw new Error("--yes and --dry-run are contradictory; pick one.");

initDb();

const rows = ACTIVE
  ? (getDb().query("SELECT id, demo_at FROM families WHERE demo_at IS NOT NULL ORDER BY demo_at")
      .all() as { id: string; demo_at: number }[])
  : staleDemoFamilyRows(Date.now() - DEMO_TTL_MS);

console.log(`network=${NETWORK}  sim=${SIM}  ttl=${Math.round(DEMO_TTL_MS / 3_600_000)}h`);
console.log(`${rows.length} demo ${rows.length === 1 ? "family" : "families"} in scope` +
  (ACTIVE ? "  (--include-active: ACTIVE HOUSEHOLDS INCLUDED)" : "  (past TTL only)"));
if (!rows.length) process.exit(0);

if (DRY) {
  // Read-only pricing. Deliberately does NOT go through reclaimDemoFamily: that function's job
  // is to move money, and a "dry" mode inside it would be a branch where the money path is not
  // the path under test. Reading balances here keeps the two honest.
  const client = await getClient();
  let total = 0, accounts = 0, unreachable = 0;
  for (const row of rows) {
    for (const kid of repo.listChildren(row.id)) {
      if (!kid.address || kid.address_source === "parent" || kid.account_index === null) continue;
      // Same backoff the real path uses. The public RPC answers 429 well before a sweep of any
      // size finishes, and a dry run that under-reports because it got rate-limited is worse
      // than no dry run: it prices the backlog too low and nobody notices.
      let b = -1;
      for (let i = 0; i < 4 && b < 0; i += 1) {
        if (i) await new Promise((r) => setTimeout(r, 400 * 2 ** (i - 1)));
        try { b = await client.getBalance(kid.address); } catch { /* retry */ }
      }
      if (b < 0) { unreachable += 1; continue; }
      if (b > 0) { total += b; accounts += 1; }
    }
  }
  console.log(`\nWOULD RECLAIM ${(total / 100_000).toLocaleString()} NIM from ${accounts} accounts`);
  if (unreachable) console.log(`${unreachable} account(s) could not be read`);
  console.log(`\nNothing was sent. Re-run with --yes to do it.`);
  process.exit(0);
}

const hot = await makeProvider().getAddress();
console.log(`sweeping to hot wallet ${hot}\n`);

let total = 0, swept = 0, failed = 0;
for (const [i, row] of rows.entries()) {
  const r = await reclaimDemoFamily(row.id);
  total += r.reclaimedLuna; swept += r.swept; failed += r.failed;
  if (r.swept || r.failed) {
    console.log(`[${i + 1}/${rows.length}] ${row.id}  +${(r.reclaimedLuna / 100_000).toLocaleString()} NIM` +
      `  swept=${r.swept} failed=${r.failed} skipped=${r.skipped}`);
  }
}

// Prove it by the destination balance, not by the calls' return values — the same rule
// sweep-hot-wallet.ts follows, and for the same reason: a broadcast that throws may still
// have been accepted.
console.log(`\nRECLAIMED ${(total / 100_000).toLocaleString()} NIM from ${swept} accounts` +
  (failed ? `  (${failed} failed, the sweeper will retry them)` : ""));
try {
  const after = await (await getClient()).getBalance(hot);
  console.log(`hot wallet now holds ${(after / 100_000).toLocaleString()} NIM`);
} catch {
  console.log(`could not re-read the hot wallet; check it before assuming this failed`);
}
