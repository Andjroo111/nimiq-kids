// Give a kid their character choice back.
//
//   bun run src/scripts/reset-kid-character.ts                  # report only, writes nothing
//   bun run src/scripts/reset-kid-character.ts --apply          # do it
//   bun run src/scripts/reset-kid-character.ts --kid <id>       # one child instead of all
//
// DRY RUN IS THE DEFAULT and --apply is the only way to write, same as
// migrate-to-parent-custody.ts and for the same reason: this edits the rows that decide where
// a child's money lives, and the report is what you want almost every time.
//
// WHY IT EXISTS. The character picker refuses any kid who already holds an account, because
// re-deriving a funded kid produces a different address and leaves their NIM at the old one.
// That refusal also catches every kid provisioned BEFORE the picker shipped, who was handed
// MAX(account_index)+1 by birth order and never chose anything. This is the supported way to
// hand those kids the choice.
//
// WHAT IT WILL NOT DO. It never sweeps, never signs, never sends. A kid whose old account
// holds a balance or a stake is REPORTED and left exactly as it is, because those coordinates
// are the only remaining way to derive the key that can move that money. An unreadable balance
// is not a zero and refuses too.
//
// After a reset the kid's next login shows the picker. Nothing else about them changes: their
// chores, stickers, chart and history are all keyed on the child row, not the address.

import { initDb, getDb } from "../db";
import * as repo from "../repo";
import { applyRepick, formatVerdict, repickReport, type ChainDeps } from "../kid-repick";
import { SIM } from "../nimiq/client";

const APPLY = process.argv.includes("--apply");
const kidFlag = process.argv.indexOf("--kid");
const ONLY_KID = kidFlag >= 0 ? process.argv[kidFlag + 1] : null;

/**
 * In SIM nothing has ever touched a chain, so every derived address is empty by construction
 * and there is no node to ask. Reading zero here is a fact about the instance, not a guess.
 * Off SIM every read is real and a failure propagates as `unreadable`, which blocks.
 */
function chainDeps(): ChainDeps {
  if (SIM) {
    return {
      getBalance: async () => 0,
      getStakeLuna: async () => 0,
      getTxCount: async () => 0,
    };
  }
  return {
    getBalance: async (address) => {
      const { getClient } = await import("../nimiq/client");
      return (await getClient()).getBalance(address);
    },
    getStakeLuna: async (address) => {
      const { getStakeLuna } = await import("../nimiq/chain-probe");
      return getStakeLuna(address);
    },
    getTxCount: async (address) => {
      const { getTxCount } = await import("../nimiq/chain-probe");
      return getTxCount(address);
    },
  };
}

async function main() {
  initDb();
  // Same query as migrate-to-parent-custody.ts: ordered by created_at so two runs list the
  // households in the same order and can be diffed.
  const families = getDb()
    .query("SELECT id, parent_label FROM families ORDER BY created_at")
    .all() as { id: string; parent_label: string }[];
  const deps = chainDeps();

  console.log(SIM ? "SIM: no chain is read; derived accounts are empty by construction." : "Reading the chain for every derived account.");
  console.log("");

  let resettable = 0;
  let blocked = 0;
  const applied: string[] = [];

  for (const fam of families) {
    const kids = repo.listChildren(fam.id).filter((k) => !ONLY_KID || k.id === ONLY_KID);
    if (!kids.length) continue;
    console.log(`${fam.parent_label} (${fam.id})`);

    const report = await repickReport(kids, deps);
    for (const v of report) {
      console.log(formatVerdict(v));
      if (v.state === "resettable") resettable += 1;
      if (v.state === "blocked") blocked += 1;
    }
    if (APPLY) applied.push(...applyRepick(report));
    console.log("");
  }

  console.log("---");
  if (APPLY) {
    console.log(`${applied.length} kid(s) reset; they will be offered a character on their next login.`);
  } else {
    console.log(`${resettable} kid(s) would be reset, ${blocked} blocked.`);
    console.log("Dry run. Nothing was written. Re-run with --apply.");
  }
  if (blocked > 0) {
    console.log("");
    console.log("A blocked kid keeps working exactly as they do today. Their coordinates are kept,");
    console.log("which is what keeps their key derivable and their money reachable.");
  }
}

main();
