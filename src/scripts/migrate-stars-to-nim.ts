// One-time migration for the family instance: convert each kid's star balance into an opening
// NIM balance (star_balance × families.star_rate_luna) as a wallet_events 'deposit' row, and
// zero the star ledger with a matching negative 'adjust' row (the star invariant stays intact).
//
// Run MANUALLY on the instance (server may be running — SQLite WAL handles a writer):
//   DB_PATH=~/data/hatch/kids.db bun run src/scripts/migrate-stars-to-nim.ts
// Idempotent: kids whose star balance is already 0 are skipped, so a re-run is a no-op.
// SIM note: these opening deposits are ledger rows (no tx) — exactly how SIM balances work.

import { initDb } from "../db";
import * as repo from "../repo";
import * as approvalsRepo from "../repo-approvals";
import * as wrepo from "../repo-wallet";
import { ensureKidWallet } from "../wallet/kid-wallet";

async function main() {
  initDb();
  const fam = repo.firstFamily();
  if (!fam) {
    console.error("No family found — nothing to migrate.");
    process.exit(1);
  }
  const kids = repo.listChildren(fam.id);
  let migrated = 0;
  for (const kid of kids) {
    const stars = kid.star_balance;
    if (stars <= 0) {
      console.log(`- ${kid.label}: no stars, skipped`);
      continue;
    }
    const valueLuna = stars * fam.star_rate_luna;
    const fresh = await ensureKidWallet(kid.id);
    wrepo.addWalletEvent({
      familyId: fam.id, childId: kid.id, kind: "deposit", valueLuna,
      counterpartyLabel: "Star conversion",
      message: `${stars} stars became ${(valueLuna / 1e5).toFixed(2)} NIM`,
    });
    approvalsRepo.addStarEvent(fam.id, kid.id, -stars, "adjust");
    console.log(`- ${kid.label}: ${stars} stars -> ${(valueLuna / 1e5).toFixed(2)} NIM (account ${fresh.address})`);
    migrated++;
  }
  console.log(`Done. ${migrated}/${kids.length} kids migrated (rate: ${fam.star_rate_luna} luna/star).`);
}

main();
