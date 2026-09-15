// Move a database from server custody to parent custody.
//
//   bun run src/scripts/migrate-to-parent-custody.ts            # report only, writes nothing
//   bun run src/scripts/migrate-to-parent-custody.ts --apply    # do it
//
// DRY RUN IS THE DEFAULT and --apply is the only way to write. This edits the rows that
// decide where a child's money lives; a script whose bare invocation mutates them is one
// tab-complete away from an accident, and the report is the thing you want 95% of the time.
//
// What it does, per child:
//
//   registered   address_source='parent' and the stored proof re-verifies      -> if a server
//                account also exists for this kid, read it, and when it is EMPTY forget the
//                derivation coordinates. That is NONCUSTODIAL-PLAN's Step 2, and doing it only
//                after a proved-empty read is what keeps it from stranding anything.
//   pending      still on a derived address                                    -> reported, not
//                touched. The parent re-registers it from the app; the app is where the wallet
//                popup lives and a script cannot do it for them.
//
// WHAT IT WILL NOT DO. It never sweeps, never signs, never sends. A kid account with a
// balance is REPORTED, with its address and amount, and the run refuses to clear that kid's
// coordinates — because those coordinates are the only remaining way to derive the key that
// can move it. Clearing them while the money is there would turn a sweep into a loss.
//
// Safe to run repeatedly. Every step is idempotent and the report is the same each time
// until something actually changes.

import { initDb, getDb } from "../db";
import * as repo from "../repo";
import * as wrepo from "../repo-wallet";
import { verifyStoredBinding } from "../kid-address";
import { getClient, SIM } from "../nimiq/client";

const APPLY = process.argv.includes("--apply");

type Verdict =
  | { state: "registered_clean"; kid: repo.Child; derived: string | null; balanceLuna: number }
  | { state: "registered_funds"; kid: repo.Child; derived: string; balanceLuna: number }
  | { state: "registered_unreadable"; kid: repo.Child; derived: string; detail: string }
  | { state: "registered_bad_proof"; kid: repo.Child; reason: string }
  | { state: "pending"; kid: repo.Child }
  | { state: "no_address"; kid: repo.Child };

async function classify(kid: repo.Child, readBalance: ((a: string) => Promise<number>) | null): Promise<Verdict> {
  if (kid.address_source !== "parent") {
    return kid.address ? { state: "pending", kid } : { state: "no_address", kid };
  }
  // A stored proof is only worth what it verifies to. Re-check it from the row rather than
  // trusting that it was checked once, because this may be a database restored from a
  // backup, or one that has been through a hand edit.
  const proof = await verifyStoredBinding(kid);
  if (!proof.ok) return { state: "registered_bad_proof", kid, reason: proof.reason };

  const derived = kid.account_index !== null ? kid.derived_address : null;
  if (!derived) return { state: "registered_clean", kid, derived: null, balanceLuna: 0 };
  if (!readBalance) return { state: "registered_clean", kid, derived, balanceLuna: 0 };
  try {
    const balanceLuna = await readBalance(derived);
    return balanceLuna > 0
      ? { state: "registered_funds", kid, derived, balanceLuna }
      : { state: "registered_clean", kid, derived, balanceLuna };
  } catch (err) {
    return { state: "registered_unreadable", kid, derived, detail: String((err as Error)?.message ?? err) };
  }
}

async function main(): Promise<void> {
  initDb();
  const db = getDb();
  const families = db.query("SELECT id, parent_label FROM families ORDER BY created_at").all() as
    { id: string; parent_label: string }[];

  // SIM has no chain to read. Say so out loud rather than reporting unverified zeros as if
  // they were checked — an unread balance and a balance read as zero are different facts.
  const readBalance = SIM ? null : async (address: string) => (await getClient()).getBalance(address);
  if (!readBalance) console.log("SIM: no chain reads. Derived balances are NOT verified in this run.\n");

  let cleared = 0;
  let blocked = 0;
  let pending = 0;

  for (const fam of families) {
    const kids = repo.listChildren(fam.id);
    if (!kids.length) continue;
    console.log(`family ${fam.parent_label} (${fam.id})`);
    for (const kid of kids) {
      const v = await classify(kid, readBalance);
      switch (v.state) {
        case "registered_clean": {
          if (!v.derived) { console.log(`  ok       ${kid.label}: parent-owned, no server account ever existed`); break; }
          const verified = readBalance ? "verified empty" : "NOT verified (SIM)";
          if (APPLY && readBalance) {
            wrepo.clearDerivationCoordinates(kid.id);
            cleared += 1;
            console.log(`  cleared  ${kid.label}: derived ${v.derived} ${verified}, coordinates dropped`);
          } else {
            console.log(`  would    ${kid.label}: derived ${v.derived} ${verified}, would drop coordinates`);
          }
          break;
        }
        case "registered_funds":
          blocked += 1;
          console.log(`  BLOCKED  ${kid.label}: ${v.balanceLuna} luna still at derived ${v.derived}`);
          console.log(`           sweep it to ${kid.address} first. Coordinates kept so the key can still be derived.`);
          break;
        case "registered_unreadable":
          blocked += 1;
          console.log(`  BLOCKED  ${kid.label}: could not read ${v.derived}: ${v.detail}`);
          console.log("           an unreadable balance is not a zero. Fix the RPC and run again.");
          break;
        case "registered_bad_proof":
          blocked += 1;
          console.log(`  BLOCKED  ${kid.label}: stored binding proof does not verify (${v.reason})`);
          console.log("           this row claims a parent-owned address it cannot prove. Re-register it.");
          break;
        case "pending":
          pending += 1;
          console.log(`  pending  ${kid.label}: still on a server-derived address (${kid.address})`);
          break;
        case "no_address":
          console.log(`  pending  ${kid.label}: no address at all yet`);
          pending += 1;
          break;
      }
    }
    console.log("");
  }

  console.log("---");
  console.log(`${cleared} kid(s) cleared, ${blocked} blocked, ${pending} still to be registered by a parent.`);
  if (!APPLY) console.log("Dry run. Nothing was written. Re-run with --apply.");
  if (pending > 0) {
    console.log("");
    console.log("Kids still on a derived address keep working exactly as they do today. They move");
    console.log("when their parent registers an address in the app. HATCH_CUSTODY=parent will refuse");
    console.log("to boot while any of their accounts still holds NIM.");
  }
  // A blocked row is a job for a human, and the exit status is what a wrapper script reads.
  if (blocked > 0) process.exit(2);
}

await main();
