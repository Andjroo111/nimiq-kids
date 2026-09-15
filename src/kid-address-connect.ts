// Registering every kid's address in ONE wallet popup, via `connectAccount`.
//
// `src/kid-address.ts` is the per-child route: the parent picks an address, we mint a
// challenge naming that child and that address, the wallet signs it. It is the stronger
// evidence and it costs a popup and a manual "Add address" per child.
//
// `connectAccount` costs one popup for the whole family and needs no manual step, because the
// Keyguard derives each requested path on the spot (nimiq/keyguard src/request/connect/
// Connect.js). The price is precisely stated:
//
//   THE SIGNED MESSAGE CANNOT NAME A CHILD. The Keyguard signs one identical challenge
//   string with each requested key, so every signature in the batch is over the same bytes.
//   Which address is Ivy's and which is Sam's is asserted by the CLIENT here, not proved.
//
// What the signatures still prove, and it is the part that matters: every address in the
// batch is one the parent holds the key to. The failure a swapped assignment produces is
// therefore Ivy's allowance landing in Sam's jar, both of them inside the parent's own
// wallet, recoverable by the parent. It is not a route to an outsider's address, because an
// outsider cannot produce a signature over our nonce.
//
// So the two paths are not interchangeable and are deliberately not stored as though they
// were: `children.address_proof_kind` records which one wrote the row, and
// `verifyStoredBinding` re-checks under the right prefix and reports which binding it found.

import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import { getDb } from "./db";
import { bareAddress, canonicalAddress, verifyAddressProof, type ProofFailure } from "./nimiq/address-proof";
import type { RegisterDeps } from "./kid-address";
import { grownUpHolding } from "./members";
import { listMembers } from "./repo-members";

/** Same window as a per-child challenge: long enough to find a wallet password, short enough
 *  that a challenge left open in a tab is not a standing offer. */
export const CONNECT_CHALLENGE_TTL_MS = 10 * 60 * 1000;

export interface ConnectChallenge {
  id: string;
  family_id: string;
  message: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

const newNonce = (): string =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The one string every key in the batch signs.
 *
 * It names the family and a nonce and nothing else, because naming a child would be a
 * promise the format cannot keep: all N signatures are over these same bytes, so a line
 * saying "Ivy" would be signed by Sam's key too and would read as evidence it is not.
 *
 * The parent does not see this text. `connectAccount` is blind signed by design, which is
 * why the Keyguard gives it its own prefix, so this is written for the server that checks it
 * rather than for a confirmation screen.
 */
export function connectBindingMessage(opts: { familyId: string; nonce: string }): string {
  return ["nimiq.kids: connect this family", `family ${opts.familyId}`, `nonce ${opts.nonce}`].join("\n");
}

/** Does this message belong to this family? The nonce makes a message unguessable; this
 *  makes one family's challenge unusable as another's. */
export function messageBindsFamily(message: string, familyId: string): boolean {
  return message.split("\n").includes(`family ${familyId}`);
}

export function issueConnectChallenge(fam: repo.Family): ConnectChallenge {
  const row: ConnectChallenge = {
    id: crypto.randomUUID(),
    family_id: fam.id,
    message: connectBindingMessage({ familyId: fam.id, nonce: newNonce() }),
    expires_at: Date.now() + CONNECT_CHALLENGE_TTL_MS,
    used_at: null,
    created_at: Date.now(),
  };
  getDb().run(
    `INSERT INTO family_connect_challenges (id, family_id, message, expires_at, used_at, created_at)
     VALUES (?,?,?,?,NULL,?)`,
    [row.id, row.family_id, row.message, row.expires_at, row.created_at],
  );
  getDb().run("DELETE FROM family_connect_challenges WHERE expires_at < ?", [Date.now() - 24 * 60 * 60 * 1000]);
  return row;
}

export function getConnectChallenge(id: string): ConnectChallenge | null {
  return (getDb().query("SELECT * FROM family_connect_challenges WHERE id=?").get(id) as ConnectChallenge) ?? null;
}

/** Single use, and the claim IS the write, for the same reason the per-child one is: reading
 *  first and updating after would let two concurrent batches both pass the read. */
function claimConnectChallenge(id: string): boolean {
  return (
    getDb()
      .query("UPDATE family_connect_challenges SET used_at=? WHERE id=? AND used_at IS NULL RETURNING id")
      .get(Date.now(), id) !== null
  );
}

export interface ConnectAssignment {
  childId: string;
  /** The derivation path this address came back on. Stored nowhere and trusted for nothing;
   *  carried so a refusal can name the entry a parent's app asked for. */
  keyPath?: string;
  address: string;
  publicKeyHex: string;
  signatureHex: string;
}

export type ConnectRefusal =
  | { error: "challenge_not_found" }
  | { error: "challenge_expired" }
  | { error: "challenge_used" }
  | { error: "no_assignments" }
  | { error: "duplicate_child"; childId: string }
  | { error: "unknown_child"; childId: string }
  | { error: "invalid_address"; childId: string }
  | { error: "address_is_the_family_wallet"; childId: string }
  /** A grown-up in this household already holds it — see grownUpHolding (src/members.ts). */
  | { error: "address_is_a_grownup_wallet"; childId: string; byLabel: string }
  | { error: "duplicate_address"; childId: string }
  | { error: "address_taken"; childId: string; byLabel: string }
  | { error: "proof_invalid"; childId: string; reason: ProofFailure }
  | { error: "funds_at_old_address"; childId: string; address: string; balanceLuna: number }
  | { error: "balance_check_failed"; childId: string; detail: string };

export type ConnectResult = { ok: true; children: repo.Child[] } | ({ ok: false } & ConnectRefusal);

/**
 * Move a whole family onto parent-owned addresses from one signed challenge.
 *
 * ALL OR NOTHING, on purpose. A partial batch leaves some kids parent-owned and some still
 * server-derived, which is the one state where "is this instance custodial?" has no answer,
 * and the custody boot guard would then refuse to arm for a reason nobody could see from the
 * parent app. Every check runs against every assignment before anything is written.
 *
 * Order is the same as the per-child path and for the same reason: identity of the challenge,
 * then shape, then signatures, then the one check that costs a chain read.
 *
 * MOVING A KID OFF AN ADDRESS THAT STILL HOLDS NIM STRANDS IT once the seed is gone, so a
 * non-zero old balance refuses and names the address, and an unreadable balance refuses too.
 * A read that failed is not a zero.
 */
export async function registerConnectedAddresses(
  fam: repo.Family,
  input: { challengeId: string; assignments: ConnectAssignment[] },
  deps: RegisterDeps,
): Promise<ConnectResult> {
  const challenge = getConnectChallenge(input.challengeId);
  // Not found and wrong family are one answer: an id being poked at should not confirm itself.
  if (!challenge || challenge.family_id !== fam.id) return { ok: false, error: "challenge_not_found" };
  if (challenge.used_at !== null) return { ok: false, error: "challenge_used" };
  if (challenge.expires_at <= Date.now()) return { ok: false, error: "challenge_expired" };

  const assignments = input.assignments ?? [];
  if (assignments.length === 0) return { ok: false, error: "no_assignments" };

  const seenChildren = new Set<string>();
  const seenAddresses = new Set<string>();
  // Read ONCE for the whole batch: every assignment asks the same question of the same roster.
  const grownUps = listMembers(fam.id);
  const resolved: { child: repo.Child; address: string; publicKeyHex: string; signatureHex: string }[] = [];

  for (const a of assignments) {
    if (seenChildren.has(a.childId)) return { ok: false, error: "duplicate_child", childId: a.childId };
    seenChildren.add(a.childId);

    const child = repo.getChild(a.childId);
    if (!child || child.family_id !== fam.id) return { ok: false, error: "unknown_child", childId: a.childId };

    const address = await canonicalAddress(String(a.address ?? ""));
    if (!address) return { ok: false, error: "invalid_address", childId: a.childId };
    if (bareAddress(address) === bareAddress(fam.parent_address)) {
      // Payouts to self: the balance never moves, nothing errors, and the kid's screen stays
      // empty. Cheap to refuse now, invisible later.
      return { ok: false, error: "address_is_the_family_wallet", childId: a.childId };
    }
    // Same silent nothing, one household member further out. A household holds more than one
    // grown-up wallet now, so this failure has more than one way to happen. After the till, so
    // a one-grown-up household keeps the wording it has always had.
    const grownUp = grownUpHolding(grownUps, address);
    if (grownUp) {
      return { ok: false, error: "address_is_a_grownup_wallet", childId: a.childId, byLabel: grownUp.label };
    }
    if (seenAddresses.has(bareAddress(address))) {
      // Two kids on one address pools their money and shows both the same balance. The unique
      // index would also refuse it, but not until half the batch was written.
      return { ok: false, error: "duplicate_address", childId: a.childId };
    }
    seenAddresses.add(bareAddress(address));

    const taken = wrepo.childHoldingAddress(address, child.id);
    if (taken) return { ok: false, error: "address_taken", childId: a.childId, byLabel: taken.label };

    const proof = await verifyAddressProof({
      address,
      message: challenge.message,
      publicKeyHex: String(a.publicKeyHex ?? ""),
      signatureHex: String(a.signatureHex ?? ""),
      kind: "connect_challenge",
    });
    if (!proof.ok) return { ok: false, error: "proof_invalid", childId: a.childId, reason: proof.reason };

    resolved.push({ child, address, publicKeyHex: String(a.publicKeyHex).trim(), signatureHex: String(a.signatureHex).trim() });
  }

  // The chain reads, after everything free has already passed. Batched here rather than
  // inside the loop above so a refusal on assignment four does not leave three RPC calls
  // spent on a batch that was never going to be written.
  for (const r of resolved) {
    const oldAddress = r.child.derived_address ?? (r.child.address_source === "derived" ? r.child.address : null);
    if (!deps.readBalance || !oldAddress || bareAddress(oldAddress) === bareAddress(r.address)) continue;
    let balanceLuna: number;
    try {
      balanceLuna = await deps.readBalance(oldAddress);
    } catch (err) {
      return { ok: false, error: "balance_check_failed", childId: r.child.id, detail: String((err as Error)?.message ?? err) };
    }
    if (balanceLuna > 0) {
      return { ok: false, error: "funds_at_old_address", childId: r.child.id, address: oldAddress, balanceLuna };
    }
  }

  if (!claimConnectChallenge(challenge.id)) return { ok: false, error: "challenge_used" };

  const write = getDb().transaction(() => {
    for (const r of resolved) {
      wrepo.setParentOwnedAddress(r.child.id, r.address, {
        message: challenge.message,
        publicKeyHex: r.publicKeyHex,
        signatureHex: r.signatureHex,
        kind: "connect_challenge",
      });
    }
  });
  write();

  return { ok: true, children: resolved.map((r) => repo.getChild(r.child.id)!) };
}
