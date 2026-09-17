// The switch from server custody to parent custody, and the check that stands in front of it.
//
// `HATCH_CUSTODY=parent` says: nobody on this machine can sign for a kid. That is a claim
// about the world, not a feature flag, and a claim is worth exactly as much as what verifies
// it. Two things can make it false:
//
//   1. a signing key is still in the environment, so the old code paths still work, or
//   2. a kid's SERVER-DERIVED address still holds NIM, so real money is sitting in an account
//      whose key we are about to throw away.
//
// "HOLDS NIM" IS NOT "HAS A BASIC BALANCE". This guard originally proved only the second, and
// they are different claims. In Albatross a stake does not sit in the basic account, it sits in
// the staking contract, so a kid who staked everything reads `balance: 0` and sailed through
// here as "verified empty". Deleting the seed then strands that stake forever, because only the
// kid's derived key can sign retire/remove_stake. The check that exists to prevent exactly that
// loss was the thing waving it past.
//
// Both are checked here, at boot, before the server listens. NONCUSTODIAL-PLAN calls this
// "what turns 'balances are zero' from an assumption into a checked precondition", and that
// is the whole job: the migration is cheap ONLY while every kid balance is zero, and the one
// way to know it is zero is to go and look.
//
// A failure prints a worklist and refuses to start. Refusing is the point. A boot that
// prints a warning and serves anyway is a boot nobody reads, and the thing it was warning
// about is money that can no longer be reached.
//
// This module does no I/O of its own — the database read and the balance read are both
// injected — so the guard can be tested without a chain and without a live database.

/** Which custody model this instance hands to a NEW kid. */
export type CustodyMode = "server" | "parent";

/**
 * `HATCH_CUSTODY=parent` opts an instance into parent custody. Anything else, including
 * unset, is the existing server-custody behaviour.
 *
 * DEFAULTS TO THE OLD BEHAVIOUR ON PURPOSE, and it is the opposite of how the approval gate
 * defaults. The approval gate protects money and so fails safe by being ON; this one CHANGES
 * how kid accounts are created, and a flag that silently rewrote custody because a variable
 * was missing would be a far worse accident than one that left it alone.
 */
export function custodyMode(env: Record<string, string | undefined> = process.env): CustodyMode {
  return env.HATCH_CUSTODY === "parent" ? "parent" : "server";
}

/** A kid whose account was derived from the server seed, and where its money lives. */
export interface DerivedKidRow {
  id: string;
  label: string;
  familyId: string;
  /** The derived address to check. `derived_address` when the row has moved to a
   *  parent-owned `address`, otherwise `address` itself. */
  address: string | null;
  accountIndex: number;
}

export interface BootGuardDeps {
  env?: Record<string, string | undefined>;
  /** Every child with a non-null `account_index` — i.e. every kid a server key exists for. */
  listDerivedKids: () => DerivedKidRow[];
  /** On-chain balance in luna. Throwing is a FAILURE, never a zero. */
  getBalance: (address: string) => Promise<number>;
  /**
   * Total luna this address holds in the staking contract, active or retired.
   *
   * `null` means THE NODE WOULD NOT ANSWER, which is not the same as zero and must never be
   * rounded down to one. The mainnet RPC this instance is pointed at answers
   * `method not supported: getStakerByAddress`, so null is the ordinary case here, not an
   * edge case. See `getTxCount` for what stands in when that happens.
   */
  getStakeLuna: (address: string) => Promise<number | null>;
  /**
   * The last on-chain balance this instance recorded for its shared hot wallet, or null if it
   * has never taken one (SIM, a fresh DB, tests). Null is UNKNOWN and never zero.
   *
   * `DEV_PARENT_PRIV` IS THE HOT WALLET KEY, so the key check above is also, silently, a
   * demolition order for whatever that wallet holds. The kid checks read the chain; this one
   * cannot, because by the time parent custody is armed the key is gone and the address is
   * derivable from nothing. `wallet_state` keeps the balance but never the address it belongs
   * to. The last figure we wrote down is the whole of what is left to reason from.
   */
  hotWalletSnapshotLuna: () => number | null;
  /**
   * How many transactions this address has ever appeared in.
   *
   * The fallback when the node cannot read stakers. Staking requires sending a transaction, so
   * an address with NO history has provably never staked, whatever the node is willing to tell
   * us about stakers. It is a proof of absence built out of a question the node will answer.
   */
  getTxCount: (address: string) => Promise<number>;
}

export type BootProblem =
  | { kind: "key_present"; name: "HATCH_MASTER_SEED" | "DEV_PARENT_PRIV" }
  | { kind: "funds_at_derived_address"; kid: DerivedKidRow; balanceLuna: number }
  | { kind: "stake_at_derived_address"; kid: DerivedKidRow; stakeLuna: number }
  | { kind: "stake_unverifiable"; kid: DerivedKidRow; txCount: number }
  /** The shared hot wallet was last seen holding money, and its only key is being deleted.
   *  `keyStillPresent` decides whether this is a warning or an autopsy. */
  | { kind: "hot_wallet_last_seen_funded"; snapshotLuna: number; keyStillPresent: boolean }
  | { kind: "balance_unreadable"; kid: DerivedKidRow; detail: string }
  | { kind: "derived_kid_without_address"; kid: DerivedKidRow };

export interface BootReport {
  ok: boolean;
  problems: BootProblem[];
  /** How many derived accounts were read and proved empty. */
  checkedEmpty: number;
}

/** Present means present. An empty string is a variable someone tried to unset by blanking
 *  it, which is the same intent, and treating "" as a live key would refuse a boot that is
 *  actually fine. Whitespace-only is the same case. */
const keyPresent = (v: string | undefined): boolean => !!v && v.trim() !== "";

/** What a chain read can prove about one server-derived account. Only `empty` is a proof;
 *  every other answer is a reason to stop. */
export type DerivedAccountVerdict =
  | { kind: "empty" }
  | { kind: "no_address" }
  | { kind: "funds"; balanceLuna: number }
  | { kind: "stake"; stakeLuna: number }
  | { kind: "stake_unverifiable"; txCount: number }
  | { kind: "unreadable"; detail: string };

/**
 * Is this server-derived account provably holding nothing?
 *
 * ONE DEFINITION, IN ONE PLACE. Two callers now ask it: the parent-custody boot guard, which
 * is about to delete the seed, and the character re-pick reset (src/kid-repick.ts), which is
 * about to forget the coordinates. Both are asking the same question for the same reason, and
 * "is this account empty" written twice is the shape of bug where one of them says yes.
 *
 * Every branch here is load-bearing:
 *
 *   NO ADDRESS is not proof. Coordinates alone say a key exists; without the address there is
 *   nothing to ask the chain about, and "we could not check" must never read as "it is empty".
 *
 *   A READ THAT CAME BACK is the only thing that proves a zero. A throw is a FAILURE, never a
 *   zero. Note the asymmetry with `topUpExecuted`, where a failed read reports the unchanged
 *   baseline so a flake cannot look like a confirmation. Here a flake must not look like an
 *   empty account either, and the safe direction is the other one: refuse.
 *
 *   AN EMPTY BASIC ACCOUNT IS HALF THE MONEY. In Albatross a stake sits in the staking
 *   contract, not the basic account, so a kid who staked everything reads `balance: 0`.
 *
 *   A NODE THAT REFUSES `getStakerByAddress` (the ordinary case on the mainnet RPC this
 *   instance uses) falls back to the question it will answer: an address that has never
 *   appeared in a transaction cannot have staked, because staking IS a transaction. That is a
 *   real proof of absence. With history and no staker read there is nothing to prove absence
 *   with, so refuse and hand it to a human. Guessing "probably nothing" is how a stake gets
 *   stranded forever, because only the derived key can sign it back out.
 */
export async function derivedAccountEmptiness(
  address: string | null,
  deps: Pick<BootGuardDeps, "getBalance" | "getStakeLuna" | "getTxCount">,
): Promise<DerivedAccountVerdict> {
  if (!address) return { kind: "no_address" };
  try {
    const balanceLuna = await deps.getBalance(address);
    if (balanceLuna > 0) return { kind: "funds", balanceLuna };

    const stakeLuna = await deps.getStakeLuna(address);
    if (stakeLuna !== null) return stakeLuna > 0 ? { kind: "stake", stakeLuna } : { kind: "empty" };

    const txCount = await deps.getTxCount(address);
    return txCount > 0 ? { kind: "stake_unverifiable", txCount } : { kind: "empty" };
  } catch (err) {
    return { kind: "unreadable", detail: String((err as Error)?.message ?? err) };
  }
}

/**
 * Run the parent-custody preconditions. Returns a report; the caller decides what to do
 * with it (server.ts refuses to start, the migration script prints it).
 *
 * Reads every derived kid's balance CONCURRENTLY but reports them in row order, so the
 * worklist is stable between runs and can be diffed.
 */
export async function parentCustodyBootReport(deps: BootGuardDeps): Promise<BootReport> {
  const env = deps.env ?? process.env;
  const problems: BootProblem[] = [];

  if (keyPresent(env.HATCH_MASTER_SEED)) problems.push({ kind: "key_present", name: "HATCH_MASTER_SEED" });
  const hotKeyPresent = keyPresent(env.DEV_PARENT_PRIV);
  if (hotKeyPresent) problems.push({ kind: "key_present", name: "DEV_PARENT_PRIV" });

  // Deliberately checked whether or not the key is still here, because the two orderings need
  // very different words. Key still present is the lucky one: the money is reachable and the
  // operator is being told to sweep it before the door shuts. Key already gone is the autopsy,
  // and it is still worth refusing over, since an env var deleted an hour ago comes back out of
  // ~/gdkc/secrets/resolved/ while the NIM does not come back out of anywhere.
  const snapshotLuna = deps.hotWalletSnapshotLuna();
  // null is "never snapshotted", which is UNKNOWN, not empty. Refusing every un-primed boot
  // would block SIM instances and fresh databases that have no hot wallet to lose.
  if (snapshotLuna !== null && snapshotLuna > 0) {
    problems.push({ kind: "hot_wallet_last_seen_funded", snapshotLuna, keyStillPresent: hotKeyPresent });
  }

  const kids = deps.listDerivedKids();
  const results = await Promise.all(kids.map(async (kid): Promise<BootProblem | null> => {
    const verdict = await derivedAccountEmptiness(kid.address, deps);
    switch (verdict.kind) {
      case "empty": return null;
      case "no_address": return { kind: "derived_kid_without_address", kid };
      case "funds": return { kind: "funds_at_derived_address", kid, balanceLuna: verdict.balanceLuna };
      case "stake": return { kind: "stake_at_derived_address", kid, stakeLuna: verdict.stakeLuna };
      case "stake_unverifiable": return { kind: "stake_unverifiable", kid, txCount: verdict.txCount };
      case "unreadable": return { kind: "balance_unreadable", kid, detail: verdict.detail };
    }
  }));

  for (const r of results) if (r) problems.push(r);
  const checkedEmpty = results.filter((r) => r === null).length;
  return { ok: problems.length === 0, problems, checkedEmpty };
}

/** The refusal, in the words someone reading a crashed boot log needs. */
export function formatBootReport(report: BootReport): string {
  const lines: string[] = [];
  lines.push("HATCH_CUSTODY=parent, but this instance is not ready for it:");
  lines.push("");
  for (const p of report.problems) {
    switch (p.kind) {
      case "key_present":
        lines.push(`  ${p.name} is still set. Parent custody means no kid-signing key exists here.`);
        lines.push("    Remove it from the environment, from ~/gdkc/secrets/resolved/, and from fly secrets.");
        break;
      case "funds_at_derived_address":
        lines.push(`  ${p.kid.label} (${p.kid.id}) still holds ${p.balanceLuna} luna at ${p.kid.address}`);
        lines.push(`    That address is derived from HATCH_MASTER_SEED. Sweep it to the kid's new`);
        lines.push(`    parent-owned address BEFORE the seed goes away, or that money is unreachable.`);
        break;
      case "hot_wallet_last_seen_funded":
        lines.push(`  The shared hot wallet was last seen holding ${p.snapshotLuna} luna.`);
        if (p.keyStillPresent) {
          lines.push("    DEV_PARENT_PRIV is that wallet's only key, and parent custody deletes it.");
          lines.push("    Sweep the wallet to an address you control NOW, while the key still exists,");
          lines.push("    then let the deposit-check re-snapshot it before booting again.");
        } else {
          lines.push("    DEV_PARENT_PRIV is ALREADY GONE, so nothing here can reach that balance.");
          lines.push("    Restore the key from ~/gdkc/secrets/resolved/ or 1Password, sweep the wallet,");
          lines.push("    and only then remove it again. The key is recoverable; the NIM is not.");
        }
        lines.push("    This is the last figure this instance recorded, so it may be stale. Stale and");
        lines.push("    non-zero is exactly the case worth stopping for: check the address on chain.");
        break;
      case "stake_at_derived_address":
        lines.push(`  ${p.kid.label} (${p.kid.id}) has ${p.stakeLuna} luna STAKED from ${p.kid.address}`);
        lines.push("    Its basic balance is zero, so this is money the old check could not see.");
        lines.push("    Deactivate, retire and remove the stake BEFORE the seed goes away. Only the");
        lines.push("    key derived from HATCH_MASTER_SEED can sign those, so afterwards nobody can.");
        break;
      case "stake_unverifiable":
        lines.push(`  ${p.kid.label} (${p.kid.id}) at ${p.kid.address} has ${p.txCount} transaction(s),`);
        lines.push("    and this node does not implement staker reads, so whether it holds a stake");
        lines.push("    cannot be established from here. An unanswered question is not a zero.");
        lines.push("    Check the address on the explorer, or point HATCH_RPC/NIMIQ_RPC_URL at a node");
        lines.push("    that implements getStakerByAddress, and boot again.");
        break;
      case "balance_unreadable":
        lines.push(`  Could not read ${p.kid.label} (${p.kid.id}) at ${p.kid.address}: ${p.detail}`);
        lines.push("    An unreadable balance is not a proven zero. Fix the RPC and boot again.");
        break;
      case "derived_kid_without_address":
        lines.push(`  ${p.kid.label} (${p.kid.id}) has derivation coordinates (account_index=${p.kid.accountIndex})`);
        lines.push("    but no recorded address, so its balance cannot be checked at all.");
        break;
    }
  }
  lines.push("");
  lines.push(`  ${report.checkedEmpty} derived kid account(s) were read and hold neither balance nor stake.`);
  lines.push("  Unset HATCH_CUSTODY to boot on server custody while this is sorted out.");
  return lines.join("\n");
}
