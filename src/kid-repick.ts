// Giving a kid their character choice back.
//
// The picker (src/kid-character.ts) refuses any kid who already holds an account, and that
// refusal is not negotiable: re-deriving a funded kid produces a different address and leaves
// their NIM at the old one. But it also catches a kid who never CHOSE anything. Every kid
// provisioned before the picker shipped was handed `MAX(account_index) + 1` the first time a
// money path touched them, so their character is birth order, and the picker has nothing to
// say to them. This module is the one supported way out of that.
//
// It is an operator path, not an app path. No route calls it and none should: a kid asking to
// re-roll their own character is a kid asking to abandon an account, and on a funded instance
// that is a request to lose money. The decision belongs to a human with the chain in front of
// them, which is what the script wrapper provides.
//
// THE ONE RULE. A kid is only reset when the chain PROVES the old account holds nothing, via
// `derivedAccountEmptiness` — the same check the parent-custody boot guard runs before it
// deletes the seed. Both are asking whether it is safe to forget a key, so they ask it the
// same way. An unreadable balance, a node that will not answer the staking question on an
// address with history, a kid with coordinates and no address: all refuse. Only a proof of
// emptiness lets a row be reset.

import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import { derivedAccountEmptiness, type BootGuardDeps, type DerivedAccountVerdict } from "./custody-boot";

export type RepickVerdict =
  /** Nothing to do: the picker will already offer to this kid. */
  | { state: "already_open"; kid: repo.Child }
  /** A parent registered this address out of their own wallet. Not ours to clear. */
  | { state: "parent_owned"; kid: repo.Child }
  /** Safe: the old derived account is provably empty. */
  | { state: "resettable"; kid: repo.Child; oldAddress: string | null }
  /** Refused, with the chain's reason. `empty` is excluded because it is the one verdict that
   *  is not a refusal: a proof of emptiness produces `resettable` above, never this. */
  | { state: "blocked"; kid: repo.Child; reason: Exclude<DerivedAccountVerdict, { kind: "empty" }> };

export type ChainDeps = Pick<BootGuardDeps, "getBalance" | "getStakeLuna" | "getTxCount">;

/**
 * What should happen to this kid, without doing any of it.
 *
 * `already_open` covers a kid who genuinely has nothing yet, which is the ordinary state of a
 * brand-new child and is not a problem to fix. Reporting it rather than silently skipping it
 * is what makes the dry run readable: a run that lists every kid tells you it looked at all of
 * them.
 *
 * A PARENT-OWNED ADDRESS IS NEVER RESET, even when it is empty. The parent went through a
 * wallet popup and signed a binding proof to put it there; clearing it would throw that away
 * and silently hand the kid back to server custody. That is a custody change, and a custody
 * change is not a side effect of a character reset.
 */
export async function classifyForRepick(kid: repo.Child, deps: ChainDeps): Promise<RepickVerdict> {
  if (kid.account_index === null && !kid.address) return { state: "already_open", kid };
  if (kid.address_source === "parent") return { state: "parent_owned", kid };

  // The address to ask the chain about is the one the coordinates actually produced.
  // `derived_address` is preferred over `address` for the same reason `listDerivedKidAccounts`
  // prefers it: on a row that has been re-registered they are two different accounts, and the
  // one that could be holding server-custodied money is this one.
  const oldAddress = kid.derived_address ?? kid.address;
  const verdict = await derivedAccountEmptiness(oldAddress, deps);
  if (verdict.kind === "empty") return { state: "resettable", kid, oldAddress };
  return { state: "blocked", kid, reason: verdict };
}

/** Classify every child on the instance, in row order so two runs can be diffed. */
export async function repickReport(kids: repo.Child[], deps: ChainDeps): Promise<RepickVerdict[]> {
  return Promise.all(kids.map((kid) => classifyForRepick(kid, deps)));
}

/**
 * Apply the resets in a report. Returns the ids actually written.
 *
 * Takes the REPORT rather than the kids, so the thing that decides and the thing that writes
 * cannot disagree about which kids were cleared. A separate re-classification inside the apply
 * step would be a second chain read whose answer might differ from the one the operator read
 * on screen and approved.
 */
export function applyRepick(report: RepickVerdict[]): string[] {
  const done: string[] = [];
  for (const v of report) {
    if (v.state !== "resettable") continue;
    wrepo.resetKidForCharacterPick(v.kid.id);
    done.push(v.kid.id);
  }
  return done;
}

/** One line per kid, for the operator. */
export function formatVerdict(v: RepickVerdict): string {
  const who = `${v.kid.label} (${v.kid.id})`;
  switch (v.state) {
    case "already_open":
      return `  open      ${who} has no account yet; the picker already offers to them`;
    case "parent_owned":
      return `  parent    ${who} holds a parent-registered address; not ours to clear`;
    case "resettable":
      return `  RESET     ${who} was on ${v.oldAddress}, proved empty`;
    case "blocked": {
      const r = v.reason;
      const why = r.kind === "funds" ? `still holds ${r.balanceLuna} luna`
        : r.kind === "stake" ? `still has ${r.stakeLuna} luna staked`
        : r.kind === "stake_unverifiable" ? `has ${r.txCount} transactions and the node will not answer the staking question`
        : r.kind === "no_address" ? "has coordinates but no recorded address, so nothing can be checked"
        : `balance unreadable: ${r.detail}`;
      return `  BLOCKED   ${who} ${why}`;
    }
  }
}
