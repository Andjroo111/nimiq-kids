// Operator tool: credit (or inspect) a family's payout budget by hand. This is the
// manual-attribution fallback for deposits the server cannot verify itself — a parent
// sending from an exchange or another wallet app to the shared hot-wallet address.
// Match the deposit on the explorer (the parent was asked to put their family code in
// the tx message), then credit it here. Deduped by tx hash when one is given.
//
//   bun run src/scripts/credit-budget.ts list
//   bun run src/scripts/credit-budget.ts show   <familyId|inviteCode>
//   bun run src/scripts/credit-budget.ts credit <familyId|inviteCode> <NIM> [txHash] [note...]
//   bun run src/scripts/credit-budget.ts exempt <familyId|inviteCode> <0|1>
//
// Run on the instance host with the instance env sourced (DB_PATH must point at the
// live DB). Amounts are NIM (converted to luna here).

import { initDb } from "../db";
import * as repo from "../repo";
import * as budget from "../repo-budget";
import * as referrals from "../repo-referrals";
import { getDb } from "../db";

const LUNA = 100_000;

function resolveFamily(idOrCode: string): repo.Family | null {
  const direct = repo.getFamily(idOrCode);
  if (direct) return direct;
  const invite = referrals.getInvite(idOrCode.toUpperCase());
  return invite ? repo.getFamily(invite.family_id) : null;
}

function printBudget(fam: repo.Family): void {
  const v = budget.budgetView(fam);
  console.log(`family   ${fam.id}`);
  console.log(`label    ${fam.parent_label} (mode ${fam.mode})`);
  console.log(`exempt   ${v.exempt}`);
  console.log(`grant    ${(v.grantLuna / LUNA).toFixed(2)} NIM`);
  console.log(`credits  ${(v.creditsLuna / LUNA).toFixed(2)} NIM`);
  console.log(`spent    ${(v.spentLuna / LUNA).toFixed(2)} NIM`);
  console.log(`left     ${v.availableLuna === null ? "unlimited" : `${(v.availableLuna / LUNA).toFixed(2)} NIM`}`);
}

function main() {
  initDb();
  const [cmd, target, ...rest] = process.argv.slice(2);

  if (cmd === "list") {
    const fams = getDb().query("SELECT id FROM families ORDER BY created_at").all() as { id: string }[];
    for (const { id } of fams) {
      const fam = repo.getFamily(id)!;
      const v = budget.budgetView(fam);
      const left = v.availableLuna === null ? "unlimited" : `${(v.availableLuna / LUNA).toFixed(2)} NIM left`;
      console.log(`${fam.id}  ${fam.parent_label.padEnd(20)} ${left}`);
    }
    return;
  }

  if (!target) {
    console.error("Usage: credit-budget.ts list | show <fam> | credit <fam> <NIM> [txHash] [note] | exempt <fam> <0|1>");
    process.exit(1);
  }
  const fam = resolveFamily(target);
  if (!fam) {
    console.error(`No family matches "${target}" (tried family id and invite code).`);
    process.exit(1);
  }

  if (cmd === "show") {
    printBudget(fam);
    for (const cr of budget.listBudgetCredits(fam.id)) {
      console.log(`  credit ${(cr.value_luna / LUNA).toFixed(2)} NIM  ${cr.source}  ${cr.tx_hash ?? "-"}  ${cr.note ?? ""}`);
    }
    return;
  }

  if (cmd === "credit") {
    const nim = Number(rest[0]);
    if (!Number.isFinite(nim) || nim <= 0) {
      console.error("Amount must be a positive number of NIM.");
      process.exit(1);
    }
    const txHash = rest[1] && rest[1] !== "-" ? rest[1] : null;
    const note = rest.slice(2).join(" ") || "manual credit";
    const credit = budget.addBudgetCredit(fam.id, Math.round(nim * LUNA), "manual", txHash, note);
    if (!credit) {
      console.error(`NOT credited — tx hash ${txHash} was already credited before.`);
      process.exit(1);
    }
    console.log(`Credited ${nim} NIM to ${fam.parent_label}.`);
    printBudget(fam);
    return;
  }

  if (cmd === "exempt") {
    const flag = rest[0];
    if (flag !== "0" && flag !== "1") {
      console.error("Usage: exempt <fam> <0|1>");
      process.exit(1);
    }
    repo.setBudgetExempt(fam.id, flag === "1");
    console.log(`budget_exempt=${flag} for ${fam.parent_label}.`);
    printBudget(repo.getFamily(fam.id)!);
    return;
  }

  console.error(`Unknown command "${cmd}".`);
  process.exit(1);
}

main();
