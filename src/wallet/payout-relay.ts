/**
 * Relay a payout the parent signed. NONCUSTODIAL-PLAN Phase 3, part two.
 *
 * The server holds no key for this transaction and cannot forge the signature. What it can
 * still do is relay something OTHER than what it published as the intent, and that is the one
 * lie a relay is capable of telling once the signing has moved into the parent's wallet. So
 * the bytes are decoded and checked against the claim before they touch the wire, and a
 * mismatch is refused rather than broadcast-and-reconciled.
 *
 * A compromised server can of course delete this check. It can never alter the signature, so
 * the worst it achieves by deleting it is relaying a transaction the parent's own wallet
 * already showed them and they confirmed. That is the whole point of the shape: the check is
 * a correctness guard for an honest server, not the thing standing between an attacker and
 * the money. The thing standing there is that there is no key here.
 *
 * ## Ordering, and why it is the same ordering as the server-signed path
 *
 * `broadcastPayoutExactlyOnce` learned this the expensive way and the reasoning transfers
 * unchanged: the bytes become durable BEFORE they are broadcast. A relay that broadcast first
 * and recorded afterwards would, on a lost response, have no way to tell "never sent" from
 * "sent and we did not hear", and the retry would ask the parent to sign again. Signing again
 * at a fresh height produces byte-different transactions that dedupe against nothing on chain,
 * which is how a chore gets paid twice.
 *
 * Because the height is pinned in the intent, a retry here is a REPLAY of identical bytes.
 * A chain cannot apply one transaction twice, so re-posting is free.
 */

import { settleDebtForPayout } from "../kid-netting";
import * as repo from "../repo";
import * as wrepo from "../repo-wallet";
import {
  type PayoutIntent,
  type PayoutMismatch,
  parseSignedPayout,
  verifySignedPayout,
} from "./payout-intent";

export type RelayRefusal =
  | { error: "invalid_tx" }
  | { error: "not_your_intent" }
  | { error: "tx_mismatch"; reason: PayoutMismatch; expected: string | number; got: string | number }
  | { error: "different_bytes_already_broadcast"; txHash: string | null };

export type RelayResult =
  | { ok: true; event: wrepo.WalletEvent; txHash: string; replayed: boolean }
  | ({ ok: false } & RelayRefusal);

/**
 * Put a parent-signed payout on the wire, once, and write the ledger row that says so.
 *
 * `broadcast` is the seam, exactly as `readBalance` is the seam in `depositCheckCore`: a test
 * drives the real decision path without a node, and the production caller passes the same
 * RPC every other transaction uses.
 */
export async function relayParentSignedPayout(args: {
  fam: repo.Family;
  intent: PayoutIntent;
  serializedTx: string;
  broadcast: (rawTxHex: string) => Promise<string>;
  now?: number;
  networkId?: number;
}): Promise<RelayResult> {
  const { fam, intent, serializedTx, broadcast } = args;
  const ref = intent.intentId;

  // An intent belongs to one household. Without this, a parent-authed caller could post a
  // valid signature for somebody else's intent and have this instance write the earn row
  // into their own family's ledger.
  if (intent.familyId !== fam.id) return { ok: false, error: "not_your_intent" };

  // Already paid: the ledger row for this ref is the record, and returning it is what makes
  // a re-post idempotent rather than a second payment.
  const settled = wrepo.walletEventForPayoutRef(ref);
  if (settled) {
    return { ok: true, event: settled, txHash: settled.tx_hash ?? "", replayed: true };
  }

  const parsed = await parseSignedPayout(serializedTx);
  if (!parsed) return { ok: false, error: "invalid_tx" };

  const verdict = verifySignedPayout(intent, parsed, { now: args.now, networkId: args.networkId });
  if (!verdict.ok) {
    return { ok: false, error: "tx_mismatch", reason: verdict.reason, expected: verdict.expected, got: verdict.got };
  }

  // Bytes are already in flight for this ref. Identical bytes are a retry and replaying them
  // is free; DIFFERENT bytes are a second transaction for one piece of work, and the first
  // one may already have paid. Refuse, and say which hash is the one that counts.
  const attempt = wrepo.getPayoutAttempt(ref);
  const inFlight = attempt?.status === "in_flight" ? attempt.raw_tx_hex : null;
  if (inFlight && inFlight.toLowerCase() !== serializedTx.toLowerCase()) {
    return { ok: false, error: "different_bytes_already_broadcast", txHash: attempt?.tx_hash ?? null };
  }

  // Durable first, wire second. Everything after this line is replayable; nothing before it
  // ever left.
  wrepo.armPayoutAttempt(ref, serializedTx, parsed.txHash);
  await broadcast(serializedTx);

  // The debt this payout carried is cleared only now, on the far side of the broadcast. At
  // mint it was pinned, not settled: an intent that expires unsigned must leave the debt
  // where it was, or a parent who closed the tab has forgiven it for free.
  //
  // BEFORE the ledger row, deliberately. `reservedNettingLuna` stops reserving once the
  // attempt reads 'settled', and `settlePayoutAttempt` below is what makes it read that way,
  // so a crash between the two must never leave a released reservation with no settlement
  // behind it. This ordering makes the only reachable in-between state the safe one — a
  // settlement recorded while the reservation still stands, which merely under-nets the next
  // payout. Idempotent on the ref either way, so the replay path above costs nothing.
  settleDebtForPayout({
    familyId: fam.id, childId: intent.childId, ref,
    settleLuna: intent.nettedLuna, message: intent.data,
  });

  // PENDING, not done. A node accepting a transaction into its mempool is not proof it
  // executed — that lesson is already paid for in topUpExecuted, and the proof here is the
  // same one every server-signed payout already gets: sweepPendingEarns reads the receipt for
  // this exact hash and flips the row. No new settlement code, deliberately.
  const event = wrepo.addWalletEvent({
    familyId: fam.id,
    childId: intent.childId,
    kind: "earn",
    status: "pending",
    valueLuna: intent.valueLuna,
    counterpartyAddress: intent.sender,
    counterpartyLabel: "Family wallet",
    message: intent.data,
    txHash: parsed.txHash,
    payoutRef: ref,
  });
  wrepo.settlePayoutAttempt(ref, parsed.txHash);
  return { ok: true, event, txHash: parsed.txHash, replayed: !!inFlight };
}
