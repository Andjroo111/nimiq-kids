// Settling a chore payout that has already been broadcast.
//
// Split out of kid-wallet.ts, which owns the other half of the story: provisioning a kid's
// account, deciding whether a payout is affordable, and putting exactly one transaction on the
// wire. Once those bytes are gone, everything left is a different question with a different
// failure mode — did it land, can we even tell, and who do we say so to — and it is the whole
// subject of v0.50.0.
//
// The one rule that governs all of it: a payout is credited only from proof that it executed,
// and written off only from proof that it did not. Everything else waits, stays counted as
// spent, and eventually tells the parent.

import { envMs, getTransactionByHash } from "../nimiq/client";
import { notifyParent } from "../notify";
import * as repo from "../repo";
import * as wrepo from "../repo-wallet";

/**
 * How long an unresolved payout may stay unresolved before the PARENT is told about it.
 * This is a notification clock only. It never changes a row's status: see
 * earnSettleDecision for why nothing is ever written off on a timer.
 */
export const EARN_CONFIRM_TIMEOUT_MS = envMs("HATCH_EARN_CONFIRM_TIMEOUT_MS", 5 * 60 * 1000);

/**
 * How long the app may stay BLIND about one payout before it says so out loud.
 *
 * Much longer than EARN_CONFIRM_TIMEOUT_MS, because the two silences are not the same thing.
 * "The node says it has never seen this transaction" is information after five minutes. "The
 * node did not answer" is not information at all, and a node bouncing for a few minutes is
 * ordinary. But it must not stay unsaid indefinitely: an unanswerable node is precisely the
 * case where the money is most likely to be in a state nobody is watching.
 */
export const EARN_BLIND_TIMEOUT_MS = envMs("HATCH_EARN_BLIND_TIMEOUT_MS", 30 * 60 * 1000);

/** wallet_state key marking "the parent has already been told this payout is unresolved". */
const earnAlertKey = (eventId: string) => `earn_alert:${eventId}`;

/**
 * What the chain says about ONE payout, keyed by ITS transaction hash.
 *
 *   executed     included in a block and it executed — the money moved
 *   rejected     included and FAILED at execution — the money provably did NOT move
 *   unknown      the node answered and has no such transaction (not mined, or dropped)
 *   unavailable  the node could not answer: unreachable, or it does not serve by-hash
 *                lookups at all (a light-client sidecar and a non-history node both refuse)
 */
export type EarnReceipt = "executed" | "rejected" | "unknown" | "unavailable";

export type EarnSettleDecision = "confirmed" | "failed" | "unresolved" | "wait";

/**
 * Promote, write off, flag, or leave alone. Pure, so the rule can be tested without a chain
 * — the I/O lives in sweepPendingEarns.
 *
 * ATTRIBUTION, NOT ARITHMETIC. The rule this replaced asked "has the kid's balance risen by
 * at least the payout?", which is not a question about the payout at all: a balance rises
 * whoever sent the money. One arriving transfer satisfied it for EVERY payout broadcast in
 * the same window (a parent clearing a morning's chore queue is the normal case), and an
 * unrelated cashlink claim or sibling gift confirmed a payout that had died in the mempool.
 * PR #22 made exactly this correction for deposit detection. A transaction hash is the only
 * chain fact that belongs to one payout and nothing else, so it is the only honest proof.
 *
 * NOTHING IS EVER WRITTEN OFF ON A TIMER. 'failed' is reachable only from `rejected` — the
 * node stating that it included the transaction and execution failed. That asymmetry is
 * deliberate, because the two mistakes are not symmetric:
 *   - a payout wrongly left pending costs a row that renders as on-its-way. Off-SIM the
 *     kid's balance is read from the chain, so the NIM they actually hold is unaffected,
 *     and the family's budget keeps counting NIM that may really have left the hot wallet.
 *   - a payout wrongly written off deletes a payment the kid genuinely received from their
 *     history AND refunds the family's payout budget for NIM that really left the shared
 *     hot wallet — a repeatable grind on a public multi-family instance.
 * So an unproven payout ages into `unresolved`, which keeps it pending and tells the parent.
 */
export function earnSettleDecision(opts: {
  receipt: EarnReceipt;
  ageMs: number;
  timeoutMs?: number;
  blindTimeoutMs?: number;
}): EarnSettleDecision {
  if (opts.receipt === "executed") return "confirmed";
  if (opts.receipt === "rejected") return "failed";
  // "unavailable" is OUR blindness, not a fact about the payout, so it can still never write
  // anything off — `failed` is unreachable from here, exactly as before. What it must not do
  // is stay quiet forever. A node that cannot answer at all was leaving the row pending, the
  // kid's screen saying "on its way", and the family's budget counting the NIM as spent, with
  // nobody ever told. Prolonged blindness ages into `unresolved`: pending, counted, and SAID.
  if (opts.receipt === "unavailable") {
    return opts.ageMs > (opts.blindTimeoutMs ?? EARN_BLIND_TIMEOUT_MS) ? "unresolved" : "wait";
  }
  return opts.ageMs > (opts.timeoutMs ?? EARN_CONFIRM_TIMEOUT_MS) ? "unresolved" : "wait";
}

/**
 * Classify one broadcast payout from the chain. The seam every reconcile is driven through.
 *
 * Runs on the background sweep ONLY. It is allowed to be slow — a node that takes most of a
 * minute to say "I have never seen this transaction" is still telling us the one thing we
 * need — because nothing a child or parent is looking at is waiting on it.
 */
export async function readEarnReceipt(txHash: string): Promise<EarnReceipt> {
  if (!txHash) return "unknown";
  try {
    const tx = await getTransactionByHash(txHash);
    if (!tx) return "unknown";
    if (tx.executionResult === false) return "rejected";
    // Sitting in a mempool is not execution — a block number is what makes it a fact.
    return tx.blockNumber === null ? "unknown" : "executed";
  } catch {
    return "unavailable";
  }
}

/**
 * Reconcile payouts that were broadcast but not yet resolved. `receiptFor` is the seam (the
 * chain read off-SIM; a stub in tests). Returns the luna proven to have landed this pass.
 *
 * IDEMPOTENT BY CONSTRUCTION: this never writes a wallet event, it only flips the status of
 * the ONE row payKidEarn already wrote. A settled row leaves listPendingEarns, so a second
 * pass over the same payout is a no-op and a kid can never be credited twice for one chore.
 */
export async function reconcilePendingEarns(
  childId: string, receiptFor: (txHash: string) => Promise<EarnReceipt>, nowMs = Date.now(),
): Promise<number> {
  let confirmed = 0;
  for (const ev of wrepo.listPendingEarns(childId)) {
    let receipt: EarnReceipt;
    try {
      receipt = await receiptFor(ev.tx_hash ?? "");
    } catch {
      receipt = "unavailable"; // node unreachable — retried on the next pass
    }
    const decision = earnSettleDecision({ receipt, ageMs: nowMs - ev.created_at });
    if (decision === "confirmed") {
      wrepo.markWalletEventDone(ev.id);
      wrepo.deleteWalletState(earnAlertKey(ev.id));
      confirmed += ev.value_luna;
    } else if (decision === "failed") {
      wrepo.markWalletEventFailed(ev.id);
      wrepo.deleteWalletState(earnAlertKey(ev.id));
      alertParent(ev, "failed");
    } else if (decision === "unresolved") {
      // Stays PENDING. The row is not proven either way, so the only honest action is to
      // stop the silence: tell the parent once, and leave the money accounted for.
      if (!wrepo.getWalletState(earnAlertKey(ev.id))) {
        wrepo.setWalletState(earnAlertKey(ev.id), String(nowMs));
        // Say which silence it is. "The network has not seen it" and "we cannot ask the
        // network" call for different things from a parent, and telling them apart is the
        // difference between a useful message and an alarming one.
        alertParent(ev, receipt === "unavailable" ? "blind" : "unresolved");
      }
    }
  }
  return confirmed;
}

/** Tell the parent a payout needs a human. Fire-and-forget; never breaks the read it rides on. */
function alertParent(ev: wrepo.WalletEvent, why: "failed" | "unresolved" | "blind"): void {
  const fam = repo.getFamily(ev.family_id);
  if (!fam) return;
  const nim = (ev.value_luna / 100_000).toString();
  const chore = ev.message ?? "a chore";
  const message = why === "failed"
    ? {
      title: "A payout did not go through",
      body: `${nim} NIM for "${chore}" was refused by the network. Nothing left the family wallet. You can pay it again from the activity list.`,
      tags: "warning",
    }
    : why === "blind"
    ? {
      title: "A payout cannot be checked right now",
      body: `${nim} NIM for "${chore}" was sent, but the network connection has not been able to confirm it. Nothing has been undone and nothing has been paid twice. It is still counted as spent until the network can answer.`,
      tags: "satellite",
    }
    : {
      title: "A payout is still unconfirmed",
      body: `${nim} NIM for "${chore}" has not shown up on chain yet. It is still counted as spent until the network says otherwise.`,
      tags: "hourglass",
    };
  notifyParent(fam, message);
}

/**
 * Reconcile EVERY household's in-flight payouts, on a tick of its own.
 *
 * THE ONLY PLACE A CHAIN READ MAY HAPPEN FOR SETTLEMENT. This used to also run inline on
 * GET /kids/:id/wallet, "lazily, on the read the kid app already makes". That was a bug with
 * a floor, not a ceiling: reconciling is a serial by-hash lookup per pending payout, and each
 * one of those costs a full read budget when the payout has not landed. Three unlanded
 * payouts held the kid's home screen for 45 seconds — measured — which past any proxy is not
 * a slow screen, it is a broken app. And it was worst exactly when something had gone wrong.
 *
 * A kid's screen must never wait on a question about the chain. It renders from the ledger,
 * which is local; this tick is what keeps the ledger honest, and it may take as long as it
 * needs to. Returns the number of children still holding an unsettled payout.
 *
 * `receiptFor` is the seam (the chain read in production, a stub in tests). SIM is gated at
 * the caller in server.ts, and in SIM there is nothing here to do regardless: SIM writes earn
 * rows 'done', so no household ever holds a pending payout to reconcile.
 */
let sweepInFlight = false;

export async function sweepPendingEarns(
  nowMs = Date.now(), receiptFor: (txHash: string) => Promise<EarnReceipt> = readEarnReceipt,
): Promise<number> {
  // One sweep at a time. A single unlanded payout can cost a full read budget to ask about,
  // so a household with a few of them outruns the tick — and overlapping sweeps would stack
  // without bound, each holding its own sockets open, all re-asking the question the running
  // sweep is already asking. Skipping is free: whatever is left is still there next tick.
  if (sweepInFlight) return wrepo.childIdsWithPendingEarns().length;
  sweepInFlight = true;
  try {
    for (const childId of wrepo.childIdsWithPendingEarns()) {
      const child = repo.getChild(childId);
      if (child) await reconcilePendingEarns(child.id, receiptFor, nowMs);
    }
  } finally {
    sweepInFlight = false;
  }
  return wrepo.childIdsWithPendingEarns().length;
}
