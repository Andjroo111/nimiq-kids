// Registering a kid's address out of a parent's OWN wallet.
//
// The end state (NONCUSTODIAL-PLAN): a kid's address is a branch of the parent's own
// 24-word recovery phrase, encrypted under their password inside the Nimiq Keyguard, on
// their device. This server never sees the key and could not derive it. What this module
// owns is the moment that address arrives — the one moment where a lie would be cheap and
// permanent, because every payout afterwards would go somewhere the family cannot reach and
// the chain would confirm each one as a success.
//
// Two round trips, and the reason for two is the Hub:
//
//   1. the parent picks an address (`chooseAddress`), then asks for a CHALLENGE. The
//      challenge is minted here, bound to this child and this address, and stored, because
//      the Hub is a full-page redirect on mobile and page memory does not survive it.
//   2. the wallet signs the challenge (`signMessage`) and the proof comes back. Everything
//      is re-checked against the STORED challenge, never against anything the client
//      re-sends.
//
// What a caller may influence: which address, and the signature over our text. Nothing
// else. The message is ours, the nonce is ours, the child it binds to is ours, and the
// checks below are in the order they are for a reason — the cheap refusals come first, and
// the two that cost a chain read come last.

import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import { getDb } from "./db";
import {
  bareAddress,
  canonicalAddress,
  verifyAddressProof,
  type ProofFailure,
  type ProofKind,
} from "./nimiq/address-proof";
import { messageBindsFamily } from "./kid-address-connect";
import { grownUpHolding } from "./members";
import { listMembers } from "./repo-members";

/** Long enough for a parent to find their wallet password, short enough that an old
 *  challenge left open in a tab is not a standing offer. */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export interface AddressChallenge {
  id: string;
  family_id: string;
  child_id: string;
  address: string;
  message: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

/**
 * What the wallet shows the parent and signs, byte for byte.
 *
 * Written to be read by a human on a phone-sized confirmation screen AND to be unforgeable
 * as a binding. Those pull in opposite directions, so both are served explicitly:
 *
 *  - the first two lines are for the person. They name the app and the child, which is the
 *    only thing a parent can actually check against their own intention.
 *  - `child` and `nonce` are for the machine. Without the child id a proof for one kid could
 *    be posted as the proof for another; without the nonce an old proof could be replayed.
 *    The address is in there too, so a proof cannot be moved to a different address either.
 *
 * Newlines are fine (Keyguard's Utf8Tools.isValidUtf8 whitelists 0x0A) and the Keyguard
 * renders the whole string in a textarea. Every other control character is REFUSED by the
 * Keyguard, so the child label is stripped down to printable ASCII before it goes in — a
 * label is parent-entered text, and a stray control character would make the Hub throw
 * "message cannot include control characters" with no way for anyone to tell why.
 *
 * ASCII-only also keeps the byte length equal to the character length, which is what the
 * Keyguard's digest is computed over. Correctness there does not depend on this (the
 * encoder is byte-correct), but a message that reads the same in every log is worth having.
 */
export function bindingMessage(opts: {
  childLabel: string;
  childId: string;
  address: string;
  nonce: string;
}): string {
  const label = opts.childLabel.replace(/[^\x20-\x7E]/g, "").trim().slice(0, 24) || "this kid";
  return [
    "nimiq.kids: give this address to " + label,
    "",
    "Money approved for " + label + " will be sent here, and only you can spend it.",
    "",
    "address " + bareAddress(opts.address),
    "child " + opts.childId,
    "nonce " + opts.nonce,
  ].join("\n");
}

/** Does this message bind THIS child? The `child <id>` line is the machine-readable half of
 *  `bindingMessage`, and checking it is what stops a perfectly valid proof for one kid from
 *  being accepted as the proof for another. */
export function messageBindsChild(message: string, childId: string): boolean {
  return message.split("\n").includes(`child ${childId}`);
}

const newNonce = (): string => {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
};

// ---- challenges ----

export type ChallengeRefusal =
  | { error: "invalid_address" }
  | { error: "address_is_the_family_wallet" }
  /** A grown-up in this household already holds it — see grownUpHolding. */
  | { error: "address_is_a_grownup_wallet"; byLabel: string }
  | { error: "address_taken"; byLabel: string };

/**
 * Mint a challenge for `address`, or say why not.
 *
 * The three refusals here are the ones that are free to make now and expensive to discover
 * later, so they are made BEFORE a parent is asked for their password rather than after:
 *
 *  - a bad checksum is a typo or a truncated paste. `NQ00 0000 …`, the onboarding
 *    placeholder, fails here too, which is deliberate.
 *  - the family wallet's own address would make every payout a transfer to self: the
 *    balance never moves, nothing errors, and the kid's screen shows nothing arriving.
 *  - an address already registered to another child pools two kids' money in one account
 *    and shows both of them the same balance.
 */
export async function issueChallenge(
  fam: repo.Family,
  child: repo.Child,
  rawAddress: string,
): Promise<AddressChallenge | ChallengeRefusal> {
  const address = await canonicalAddress(rawAddress);
  if (!address) return { error: "invalid_address" };
  if (bareAddress(address) === bareAddress(fam.parent_address)) {
    return { error: "address_is_the_family_wallet" };
  }
  // ...and not a GROWN-UP's wallet either. A household holds more than one now, and a payout
  // from a grandparent's wallet to a kid whose address IS that wallet moves nothing, errors
  // nowhere, and shows the kid an empty screen. Checked after the till so a one-grown-up
  // household — where the owner's wallet and the till are the same account — keeps its own
  // wording rather than being told it picked "Parent's wallet".
  const grownUp = grownUpHolding(listMembers(fam.id), address);
  if (grownUp) return { error: "address_is_a_grownup_wallet", byLabel: grownUp.label };
  const taken = wrepo.childHoldingAddress(address, child.id);
  if (taken) return { error: "address_taken", byLabel: taken.label };

  const row: AddressChallenge = {
    id: crypto.randomUUID(),
    family_id: fam.id,
    child_id: child.id,
    address,
    message: bindingMessage({ childLabel: child.label, childId: child.id, address, nonce: newNonce() }),
    expires_at: Date.now() + CHALLENGE_TTL_MS,
    used_at: null,
    created_at: Date.now(),
  };
  getDb().run(
    `INSERT INTO kid_address_challenges (id, family_id, child_id, address, message, expires_at, used_at, created_at)
     VALUES (?,?,?,?,?,?,NULL,?)`,
    [row.id, row.family_id, row.child_id, row.address, row.message, row.expires_at, row.created_at],
  );
  return row;
}

export function getChallenge(id: string): AddressChallenge | null {
  return (getDb().query("SELECT * FROM kid_address_challenges WHERE id=?").get(id) as AddressChallenge) ?? null;
}

/** Single use, and the claim IS the write: `used_at IS NULL` in the predicate plus RETURNING
 *  means two concurrent registrations race inside SQLite, and exactly one gets a row back.
 *  Reading first and then updating would let both pass the read. */
function claimChallenge(id: string): boolean {
  const claimed = getDb()
    .query("UPDATE kid_address_challenges SET used_at=? WHERE id=? AND used_at IS NULL RETURNING id")
    .get(Date.now(), id);
  return claimed !== null;
}

/** Housekeeping: an expired, unused challenge is dead weight. Called on issue, so the table
 *  cannot grow without bound on an instance nobody sweeps. */
export function pruneExpiredChallenges(olderThanMs = 24 * 60 * 60 * 1000): void {
  getDb().run("DELETE FROM kid_address_challenges WHERE expires_at < ?", [Date.now() - olderThanMs]);
}

// ---- registration ----

export type RegistrationRefusal =
  | { error: "challenge_not_found" }
  | { error: "challenge_expired" }
  | { error: "challenge_used" }
  | { error: "proof_invalid"; reason: ProofFailure }
  | { error: "address_taken"; byLabel: string }
  | { error: "funds_at_old_address"; address: string; balanceLuna: number }
  | { error: "balance_check_failed"; detail: string };

export type RegistrationResult = { ok: true; child: repo.Child } | ({ ok: false } & RegistrationRefusal);

export interface RegisterDeps {
  /** On-chain balance in luna. null disables the check (SIM: there is no chain to ask, and
   *  no real money to strand). Throwing is a FAILURE, never a zero. */
  readBalance: ((address: string) => Promise<number>) | null;
}

/**
 * Verify a proof and move the child onto a parent-owned address.
 *
 * ORDER MATTERS, and it is: identity of the challenge, then the signature, then the state of
 * the world. The first two are offline and instant. The third costs an RPC round trip and is
 * the one that must not be skipped:
 *
 * MOVING A KID OFF AN ADDRESS THAT STILL HOLDS NIM STRANDS IT. The old address is derived
 * from the server seed, so today we could still sweep it; after the seed is deleted nobody
 * can. Overwriting the column would erase the app's own knowledge of where that money is
 * while the money is still there. So a non-zero old balance REFUSES, and names the address
 * and the amount so a sweep can be run against it.
 *
 * An unreadable balance also refuses. A read that failed is not a zero, and the cost of
 * getting that wrong is unrecoverable while the cost of getting it right is one retry.
 */
export async function registerParentOwnedAddress(
  fam: repo.Family,
  child: repo.Child,
  input: { challengeId: string; publicKeyHex: string; signatureHex: string },
  deps: RegisterDeps,
): Promise<RegistrationResult> {
  const challenge = getChallenge(input.challengeId);
  // Not found, wrong family, wrong child: all the same answer on purpose. A caller poking at
  // challenge ids should not learn which of those it got.
  if (!challenge || challenge.family_id !== fam.id || challenge.child_id !== child.id) {
    return { ok: false, error: "challenge_not_found" };
  }
  if (challenge.used_at !== null) return { ok: false, error: "challenge_used" };
  if (challenge.expires_at <= Date.now()) return { ok: false, error: "challenge_expired" };

  const proof = await verifyAddressProof({
    address: challenge.address,
    message: challenge.message,
    publicKeyHex: String(input.publicKeyHex ?? ""),
    signatureHex: String(input.signatureHex ?? ""),
  });
  if (!proof.ok) return { ok: false, error: "proof_invalid", reason: proof.reason };

  // Re-checked here and not only at issue time: challenges live for ten minutes, and another
  // kid in the same household could have registered this address inside that window.
  const taken = wrepo.childHoldingAddress(challenge.address, child.id);
  if (taken) return { ok: false, error: "address_taken", byLabel: taken.label };

  // The account we are about to walk away from. `derived_address` first, because a re-
  // registration's `address` is already a parent-owned one and that is not the account at
  // risk. Nothing to check when the kid never had a server-derived account at all.
  const oldAddress = child.derived_address ?? (child.address_source === "derived" ? child.address : null);
  if (deps.readBalance && oldAddress && bareAddress(oldAddress) !== bareAddress(challenge.address)) {
    let balanceLuna: number;
    try {
      balanceLuna = await deps.readBalance(oldAddress);
    } catch (err) {
      return { ok: false, error: "balance_check_failed", detail: String((err as Error)?.message ?? err) };
    }
    if (balanceLuna > 0) return { ok: false, error: "funds_at_old_address", address: oldAddress, balanceLuna };
  }

  if (!claimChallenge(challenge.id)) return { ok: false, error: "challenge_used" };
  wrepo.setParentOwnedAddress(child.id, challenge.address, {
    message: challenge.message,
    publicKeyHex: input.publicKeyHex.trim(),
    signatureHex: input.signatureHex.trim(),
  });
  return { ok: true, child: repo.getChild(child.id)! };
}

/**
 * Re-verify a stored proof from the row alone.
 *
 * The reason the whole proof is on the row rather than a "verified" boolean: this can be run
 * at any time, by anything, against a database restored from a backup, and it answers from
 * the cryptography rather than from our own earlier say-so. Used by the migration script and
 * available to any audit.
 */
export async function verifyStoredBinding(child: repo.Child): Promise<ProofResultForRow> {
  if (child.address_source !== "parent") return { ok: false, reason: "not_parent_owned" };
  if (!child.address || !child.address_proof_message || !child.address_proof_pubkey || !child.address_proof_sig) {
    return { ok: false, reason: "proof_missing" };
  }
  // Rows written before `address_proof_kind` existed were all signMessage, and the migration
  // backfills them; the fallback is for a row hand-written by a test or a repair script.
  const kind: ProofKind = child.address_proof_kind ?? "signed_message";
  const res = await verifyAddressProof({
    address: child.address,
    message: child.address_proof_message,
    publicKeyHex: child.address_proof_pubkey,
    signatureHex: child.address_proof_sig,
    kind,
  });
  if (!res.ok) return { ok: false, reason: res.reason };

  // The signature is valid for SOME address. What it is valid ABOUT depends on which flow
  // wrote it, and the two are genuinely different strengths of evidence, so the answer says
  // which rather than flattening both to true.
  if (kind === "connect_challenge") {
    // A connect batch signs one message with every key, so it can only bind the family. Which
    // child got which address was the client's assertion. See src/kid-address-connect.ts.
    return messageBindsFamily(child.address_proof_message, child.family_id)
      ? { ok: true, binding: "family" }
      : { ok: false, reason: "bound_to_another_family" };
  }
  return messageBindsChild(child.address_proof_message, child.id)
    ? { ok: true, binding: "child" }
    : { ok: false, reason: "bound_to_another_child" };
}

export type ProofResultForRow =
  /** `binding` is how much the signature actually pins down: 'child' means the signed bytes
   *  name this child, 'family' means they name the household and the child mapping came from
   *  the client. Callers that care about the difference must read it. */
  | { ok: true; binding: "child" | "family" }
  | {
      ok: false;
      reason:
        | ProofFailure
        | "not_parent_owned"
        | "proof_missing"
        | "bound_to_another_child"
        | "bound_to_another_family";
    };
