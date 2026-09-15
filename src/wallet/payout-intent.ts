/**
 * A payout the PARENT signs, and the server can only relay.
 *
 * NONCUSTODIAL-PLAN Phase 3. Today a chore approval is a boolean the server checks before
 * signing for itself, which a compromised server just sets to true. After this, "parent
 * approval" and "parent signature" are the same event: the server plans a transaction and
 * proves what happened to it, the parent's own wallet signs it, and there is no code path
 * here that can produce that signature.
 *
 * The shape is deliberately the one already in production for family top-ups
 * (`public/parent/views-manage.js` -> `POST /api/family/topup-broadcast` -> `topUpExecuted`):
 * client signs, server relays, server proves. What is new is the direction and the
 * verification. A top-up pays the hot wallet and the server is content to broadcast whatever
 * it is handed; a payout pays a CHILD, so the server decodes the bytes and refuses to relay
 * anything that does not match a claim it made first.
 *
 * ## Why the intent is stored as literals
 *
 * Every field below is written down at mint time and compared as a stored value, never
 * re-derived at verification time. Re-deriving would make the verifier a second transcription
 * of the minter, and two transcriptions agreeing is not evidence — it is the same mistake
 * twice. The one thing that is derived is the hex of `data`, and that derivation is a
 * TextEncoder call whose whole job is to be byte-exact.
 *
 * ## Why the height is pinned
 *
 * `validityStartHeight` is baked into the intent rather than chosen by the client. Two
 * reasons, and the second is the important one:
 *
 *   1. it makes the bytes deterministic, so a re-signed intent hashes identically, and
 *   2. the transaction hash covers content and NOT the proof (`SerializeContent` omits it),
 *      so a pinned height means the CHAIN itself refuses the second copy with
 *      `AlreadyIncluded` for the whole validity window. The `payout_attempts` claim is still
 *      the primary guard, because it is what stops a second wallet popup from ever opening,
 *      but the chain is a real backstop underneath it rather than a hoped-for one.
 *
 * Albatross accepts a pinned height from `height - blocks_per_batch` (60) to
 * `height + transaction_validity_window` (7200 blocks, about 117 minutes at the 1s block
 * separation time). The TTL below sits well inside that, so a parent who takes twenty
 * minutes is nowhere near the edge, and an expired intent is re-minted rather than rejected
 * by a node.
 */

import { getNimiq, NETWORK_ID } from "../nimiq/client";
import { debtSettledByPayout, netPayout, nettableDebtLuna, settleDebtForPayout } from "../kid-netting";
import * as repo from "../repo";
import * as wrepo from "../repo-wallet";

/**
 * How long a parent has to sign before the intent must be re-minted.
 *
 * Bounded far below the chain's own 7200-block window on purpose: expiring here is a
 * re-mint and a fresh popup, while expiring at a node is a rejected transaction the parent
 * has already entered their password for.
 */
export const PAYOUT_INTENT_TTL_MS = Number(process.env.HATCH_PAYOUT_INTENT_TTL_MS ?? 45 * 60_000);

/**
 * The extraData a payout carries, from the human message.
 *
 * ONE definition, used by both the server-signed path (`earnTx` in kid-wallet.ts) and the
 * parent-signed one. Written twice it would be a predicate that silently disagrees with
 * itself: the minter would promise 64 characters and the signer produce 63, and the
 * verification below would refuse a transaction that was correct by the other rule.
 */
export const payoutExtraData = (message: string): string => message.slice(0, 64);

/** What the parent app is asked to sign. Everything here is compared byte for byte later. */
export interface PayoutIntent {
  /** Same value as the payout ref: the claim and the intent are one row, not two. */
  intentId: string;
  familyId: string;
  childId: string;
  /** The parent address that must sign. A tx from any other sender is refused. */
  sender: string;
  /** The kid's address. */
  recipient: string;
  /** WHAT THE PARENT SIGNS, which is the gross MINUS `nettedLuna` — not the chore's price.
   *  Every comparison in `verifySignedPayout` is against this number. */
  valueLuna: number;
  /** Always 0 today. Stated rather than assumed, because the verifier compares it. */
  feeLuna: number;
  data: string;
  validityStartHeight: number;
  expiresAt: number;
  /** Deferred spending this payout clears instead of moving (src/kid-netting.ts). 0 for the
   *  ordinary case. Published so the parent app can say "300 for the chore, 80 already spent,
   *  220 to send" rather than showing a number that disagrees with the board. */
  nettedLuna: number;
  /** `valueLuna + nettedLuna`. Carried explicitly so no client has to re-add them. */
  grossLuna: number;
}

export const PAYOUT_INTENT_FEE_LUNA = 0;

const normalizeAddr = (a: string): string => a.replace(/\s/g, "").toUpperCase();

const toHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** The exact bytes `data` becomes on the wire. Byte length, never character length. */
export const payoutDataHex = (data: string): string => toHex(new TextEncoder().encode(data));

function intentFromRow(row: wrepo.PayoutAttempt): PayoutIntent | null {
  // All four move together at mint time, so a row missing any of them is a server-signed
  // attempt and must never be read as a half-built intent.
  if (row.sender === null || row.intent_data === null
    || row.validity_start_height === null || row.expires_at === null) return null;
  // NULL netting is an attempt minted before deferred spending existed. It netted nothing,
  // which is what 0 says, so it is read as 0 rather than treated as a fifth half-built field.
  const nettedLuna = row.netted_luna ?? 0;
  return {
    intentId: row.payout_ref,
    familyId: row.family_id,
    childId: row.child_id,
    sender: row.sender,
    recipient: row.recipient,
    valueLuna: row.value_luna,
    feeLuna: PAYOUT_INTENT_FEE_LUNA,
    data: row.intent_data,
    validityStartHeight: row.validity_start_height,
    expiresAt: row.expires_at,
    nettedLuna,
    grossLuna: row.value_luna + nettedLuna,
  };
}

export type MintRefusal =
  | { error: "no_parent_address" }
  | { error: "no_kid_address" }
  | { error: "pays_self" }
  | { error: "already_claimed"; intent: PayoutIntent | null }
  /** This payout already settled a debt whole and had no bytes. See MintResult.settled. */
  | { error: "already_settled"; settleLuna: number };

/**
 * There was nothing to sign because the kid's deferred spending ate the whole payout.
 *
 * NOT a refusal: the work is paid for, and the caller must complete the approval exactly as
 * it would for a signed one. What is different is that nothing goes to a wallet and the debt
 * has ALREADY been cleared by the time this is returned — there are no bytes to wait for, so
 * deferring the settlement would only invent a window in which it could be lost.
 */
export interface SettledWhole {
  ok: true;
  settledWhole: true;
  settleLuna: number;
  grossLuna: number;
}

export type MintResult =
  | { ok: true; settledWhole?: false; intent: PayoutIntent }
  | SettledWhole
  | ({ ok: false } & MintRefusal);

/**
 * Claim the payout and issue the intent in one step, because they are one row.
 *
 * The primary key on `payout_attempts` is what makes this a claim rather than a request: two
 * parents tapping Approve on two phones do not both get a popup, the second gets
 * `already_claimed` before a wallet ever opens. That is the guard that matters — a duplicate
 * refused at the chain would still have cost a parent their password and their confusion.
 *
 * `pays_self` is refused here rather than at broadcast for the same reason `kidOutflowRefusal`
 * refuses at request time: a payout to the family's own wallet moves no money, errors nowhere,
 * and shows the kid nothing arriving. A parent must never be asked to sign one.
 */
export function mintPayoutIntent(args: {
  ref: string;
  fam: repo.Family;
  /**
   * WHOSE WALLET PAYS — the acting grown-up's own address, resolved by the route through
   * `payoutSender` (src/members.ts).
   *
   * This used to read `fam.parent_address` here, which was the same thing back when a
   * household could hold only one grown-up. It is not the same thing any more, and the
   * difference is the whole point: `families.parent_address` is the household's TILL (where a
   * Treasure Box spend returns to, what a family transfer targets) and must not move when a
   * grandparent approves a chore. If it did, the kid's next purchase would leave the household
   * into her wallet, and the per-family budget — which nets a buy against a refund only because
   * they are the same account — would stop bounding anything.
   *
   * Passed in rather than looked up so this module never has to know which grown-up is asking,
   * and so the one decision lives at the one place that can see the request.
   */
  sender: string;
  child: repo.Child;
  /** The GROSS — what the work is worth. What the parent signs is this minus the kid's
   *  deferred spending; see src/kid-netting.ts. */
  valueLuna: number;
  message: string;
  headHeight: number;
  now?: number;
}): MintResult {
  const { ref, fam, child, valueLuna, message, headHeight } = args;
  const at = args.now ?? Date.now();

  const sender = (args.sender ?? "").trim();
  // Still `no_parent_address`, and the name is still right: the route only reaches here with an
  // empty sender when neither the acting grown-up NOR the household's owner has a wallet
  // connected, which is the same "this household cannot pay anybody" state it always named.
  if (!sender) return { ok: false, error: "no_parent_address" };
  const recipient = (child.address ?? "").trim();
  if (!recipient) return { ok: false, error: "no_kid_address" };
  if (normalizeAddr(sender) === normalizeAddr(recipient)) return { ok: false, error: "pays_self" };

  const existing = wrepo.getPayoutAttempt(ref);
  if (existing) {
    // An intent that expired without ever being signed would otherwise strand the work
    // forever: the ref is claimed, the claim hands back a dead intent, and no later tap can
    // ever produce a signable one. Re-minting is safe in exactly one state, and it is the
    // same state `releasePayoutAttempt` already trusts — 'preparing' means no bytes were
    // ever recorded, so nothing can be in flight and nothing can have paid.
    //
    // The status test is doubled on purpose: `releasePayoutAttempt` carries the same
    // predicate in its own WHERE clause, so deleting the check here does not change what
    // happens (a mutation run confirms it — the row survives and the stale intent still
    // comes back). Keeping it makes the precondition legible at the decision rather than
    // only enforceable one layer down, where a future rewrite of the repo call could quietly
    // drop it.
    const stale = intentFromRow(existing);
    const reusable = existing.status === "preparing" && stale !== null && at > stale.expiresAt;
    if (!reusable) return { ok: false, error: "already_claimed", intent: stale };
    wrepo.releasePayoutAttempt(ref);
  }

  // A payout the debt ate whole leaves a settlement row and NO attempt row, so the check
  // above cannot see it. Without this, re-approving that chore would clear the debt a second
  // time. It sits AFTER the attempt check so a partly-netted payout — which has both rows —
  // still answers `already_claimed` and hands its intent back to be resumed.
  const settled = debtSettledByPayout(ref);
  if (settled && !existing) {
    return { ok: false, error: "already_settled", settleLuna: -settled.value_luna };
  }

  // NETTED HERE, AT THE CLAIM. The split is pinned into the row rather than recomputed at
  // broadcast: the parent signs `chainLuna`, so a debt that grew in between must not be
  // settled by a signature that never accounted for it. `nettableDebtLuna` also subtracts
  // what other unsettled intents have already promised, which is what stops two approvals in
  // the same minute netting twice against one ice cream.
  const { chainLuna, settleLuna } = netPayout(valueLuna, nettableDebtLuna(child.id, at));
  if (chainLuna <= 0) {
    // Nothing to sign, and nothing to wait for — so the debt is cleared now rather than left
    // hanging on an event that will never arrive. Idempotent on the ref.
    settleDebtForPayout({ familyId: fam.id, childId: child.id, ref, settleLuna, message });
    return { ok: true, settledWhole: true, settleLuna, grossLuna: valueLuna };
  }

  const data = payoutExtraData(message);
  const row = wrepo.claimPayoutAttempt({
    ref, familyId: fam.id, childId: child.id, valueLuna: chainLuna, recipient, message,
    nettedLuna: settleLuna,
    intent: { sender, data, validityStartHeight: headHeight, expiresAt: at + PAYOUT_INTENT_TTL_MS },
  });
  const intent = intentFromRow(row);
  // INSERT OR IGNORE plus the read above is not atomic under concurrency: a racing caller
  // can land its row between them. It owns the ref either way, and its row is the one that
  // comes back, so the honest answer is the same refusal the slow path gives.
  if (!intent) return { ok: false, error: "already_claimed", intent: null };
  // `valueLuna` is in the comparison because netting made it derived rather than given: two
  // callers racing here can compute different splits from the same debt, and a row whose
  // value is not the one this call netted is not this call's row.
  if (intent.validityStartHeight !== headHeight || intent.sender !== sender
    || intent.valueLuna !== chainLuna) {
    return { ok: false, error: "already_claimed", intent };
  }
  return { ok: true, intent };
}

/** Read an intent back by its id. Null for an unknown ref OR a server-signed attempt. */
export function getPayoutIntent(ref: string): PayoutIntent | null {
  const row = wrepo.getPayoutAttempt(ref);
  return row ? intentFromRow(row) : null;
}

/** Every field of a signed transaction that the intent has an opinion about. */
export interface ParsedPayoutTx {
  sender: string;
  senderType: number;
  recipient: string;
  recipientType: number;
  valueLuna: number;
  feeLuna: number;
  validityStartHeight: number;
  dataHex: string;
  flags: number;
  networkId: number;
  txHash: string;
}

/**
 * Decode signed bytes offline. Null when the hex is not a parseable transaction.
 *
 * Nothing here judges the transaction; it only reports what it says. The judging is
 * `verifySignedPayout`, so a parse failure and a mismatch stay distinguishable.
 *
 * READ THE TRANSACTION OBJECT, NOT `toPlain()`. Verified against a real Keyguard-signed
 * transaction on @nimiq/core 2.5.1: `toPlain()` reports `senderType: "basic"` as a STRING
 * and omits `networkId` entirely, while the object reports `senderType: 0` and
 * `networkId: 5` as numbers. A numeric comparison against the plain form therefore fails
 * on every valid transaction — `Number("basic")` is NaN — and a network check against it
 * compares against undefined and passes everything. Both are silent, and both point the
 * wrong way. (The Hub's own bundled core does return numbers there, which is exactly how
 * a spike's output talks you into the wrong accessor.)
 */
export async function parseSignedPayout(serializedTx: string): Promise<ParsedPayoutTx | null> {
  try {
    const Nimiq = await getNimiq();
    const tx = Nimiq.Transaction.fromAny(serializedTx);
    return {
      sender: tx.sender.toUserFriendlyAddress(),
      senderType: Number(tx.senderType),
      recipient: tx.recipient.toUserFriendlyAddress(),
      recipientType: Number(tx.recipientType),
      valueLuna: Number(tx.value),
      feeLuna: Number(tx.fee),
      validityStartHeight: Number(tx.validityStartHeight),
      dataHex: toHex(new Uint8Array(tx.data ?? [])),
      flags: Number(tx.flags),
      networkId: Number(tx.networkId),
      txHash: tx.hash(),
    };
  } catch {
    return null;
  }
}

export type PayoutMismatch =
  | "expired"
  | "sender_mismatch"
  | "recipient_mismatch"
  | "value_mismatch"
  | "fee_mismatch"
  | "validity_height_mismatch"
  | "data_mismatch"
  | "network_mismatch"
  | "not_a_basic_transfer";

export type PayoutVerdict =
  | { ok: true }
  | { ok: false; reason: PayoutMismatch; expected: string | number; got: string | number };

/**
 * Does this signed transaction do EXACTLY what the intent said, and nothing else?
 *
 * The server cannot forge this signature, so this check is not what stops the server from
 * paying an attacker. What it stops is the server relaying a transaction that does not match
 * the claim it published — which is the only lie a relay is still capable of telling, and the
 * one thing a parent cannot check for themselves once they have tapped Confirm.
 *
 * Comparisons are whole-field equality, never ranges. "At least the right value" would let a
 * client overpay a child out of the parent's wallet, and "the right recipient, any data" would
 * let it attach an arbitrary 64-byte payload to a transaction the parent authorised for a
 * chore. Flags and both account types are pinned to a plain basic transfer for the same
 * reason: a contract-creating flag on a transaction a parent believed was pocket money is
 * exactly the substitution this whole design exists to make impossible.
 */
export function verifySignedPayout(
  intent: PayoutIntent,
  tx: ParsedPayoutTx,
  opts: { now?: number; networkId?: number } = {},
): PayoutVerdict {
  const at = opts.now ?? Date.now();
  const wantNetwork = opts.networkId ?? NETWORK_ID;

  if (at > intent.expiresAt) {
    return { ok: false, reason: "expired", expected: intent.expiresAt, got: at };
  }
  // SHAPE BEFORE FIELDS. A staking transaction carries its own recipient payload, so field
  // order matters to what the refusal says: checked later, "you sent me a staking transaction"
  // comes back as `data_mismatch`, which points a reader at the chore title. The structural
  // complaint is both the truer one and the more alarming one, so it wins.
  if (tx.flags !== 0 || tx.senderType !== 0 || tx.recipientType !== 0) {
    return {
      ok: false, reason: "not_a_basic_transfer",
      expected: "flags=0 senderType=0 recipientType=0",
      got: `flags=${tx.flags} senderType=${tx.senderType} recipientType=${tx.recipientType}`,
    };
  }
  if (normalizeAddr(tx.sender) !== normalizeAddr(intent.sender)) {
    return { ok: false, reason: "sender_mismatch", expected: intent.sender, got: tx.sender };
  }
  if (normalizeAddr(tx.recipient) !== normalizeAddr(intent.recipient)) {
    return { ok: false, reason: "recipient_mismatch", expected: intent.recipient, got: tx.recipient };
  }
  if (tx.valueLuna !== intent.valueLuna) {
    return { ok: false, reason: "value_mismatch", expected: intent.valueLuna, got: tx.valueLuna };
  }
  if (tx.feeLuna !== intent.feeLuna) {
    return { ok: false, reason: "fee_mismatch", expected: intent.feeLuna, got: tx.feeLuna };
  }
  if (tx.validityStartHeight !== intent.validityStartHeight) {
    return {
      ok: false, reason: "validity_height_mismatch",
      expected: intent.validityStartHeight, got: tx.validityStartHeight,
    };
  }
  const wantData = payoutDataHex(intent.data);
  if (tx.dataHex.toLowerCase() !== wantData.toLowerCase()) {
    return { ok: false, reason: "data_mismatch", expected: wantData, got: tx.dataHex };
  }
  if (tx.networkId !== wantNetwork) {
    return { ok: false, reason: "network_mismatch", expected: wantNetwork, got: tx.networkId };
  }
  return { ok: true };
}
