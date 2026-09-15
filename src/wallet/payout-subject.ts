/**
 * What a relayed payout FINISHES, once the bytes are on the wire.
 *
 * The server-signed path does two things in one request: it moves the money and it settles the
 * work (`applyApprove` pays, then flips the chore and shines the sticker). A parent-signed
 * payout splits that across two requests with a wallet in between, and only the money half was
 * ever written. So a parent could approve a chore, sign it in their wallet, watch the NIM land
 * at their kid's address, and the board would still read "waiting for a grown-up" forever.
 *
 * This module is the second half, keyed off the payout ref rather than off an approval id,
 * for the same reason `payoutRefFor` is: the ref is derived from the SUBJECT, so every
 * approval row that ever authorised this piece of work names the same key. A relay that
 * looked up "the approval that started this" would have to guess which one, and on the resume
 * path there is more than one candidate.
 *
 * ## Everything here is idempotent, because the relay is
 *
 * `relayParentSignedPayout` answers a re-post of identical bytes with `replayed: true` and the
 * original ledger row, and the route calls this either way. Setting an already-approved chore
 * to approved is a no-op; `decideApproval` only flips a still-pending row and reports whether
 * it did. Nothing here counts, sums, or appends.
 *
 * ## Why it is safe to settle from a request the parent did not have to make
 *
 * Nothing in here decides anything. The parent's decision was the signature, and the bytes
 * carrying it have already been verified against the intent this instance published and put
 * on the wire. Marking the chore approved afterwards is bookkeeping catching up with a
 * payment that has happened — the same order `applyApprove` uses, which is why the failure
 * mode it protects against ("the board says paid, nothing moved") cannot occur here: the
 * money is provably in flight before this file runs at all.
 */

import * as approvalsRepo from "../repo-approvals";
import * as repo from "../repo";
import * as routines from "../repo-routines";
import * as practicesRepo from "../repo-practices";
import * as stickersRepo from "../repo-stickers";

/** What a settlement actually changed, so the route can say something true. */
export interface SubjectSettlement {
  kind: approvalsRepo.ApprovalSubject | null;
  /** The subject moved to its approved state (or was already there). */
  settled: boolean;
  /** A still-pending approval for this subject was decided by this call. */
  approvalDecided: boolean;
}

/**
 * Split a payout ref into its subject.
 *
 * The id half is a UUID and carries no colon, so splitting on the FIRST one is exact. Only
 * the subjects that can mint an intent are recognised — a `repay:` or `topup:` ref settles
 * nothing here and must not be forced into a chore lookup.
 */
type SettleableSubject = "chore" | "routine_run" | "practice_session";
const SETTLEABLE = new Set<string>(["chore", "routine_run", "practice_session"]);

function subjectFromRef(ref: string): { kind: SettleableSubject; id: string } | null {
  const at = ref.indexOf(":");
  if (at < 0) return null;
  const kind = ref.slice(0, at);
  const id = ref.slice(at + 1);
  if (!id) return null;
  return SETTLEABLE.has(kind) ? { kind: kind as SettleableSubject, id } : null;
}

/**
 * Finish the work a relayed payout paid for.
 *
 * `method` is how the parent authenticated to the BROADCAST, not to the original approve —
 * they are two requests and the second one is the one that completed the payment. Both are
 * parent-authed, so it is 'remote' on every path that reaches here today.
 */
export function settlePayoutSubject(
  ref: string, method: approvalsRepo.ApprovalMethod = "remote",
  /** The grown-up whose wallet paid. On the relay path that is whoever posted the signed
   *  bytes, and the relay has already refused anything whose sender is not the one this
   *  instance named — so crediting them is a fact, not an attribution. */
  memberId: string | null = null,
): SubjectSettlement {
  const subject = subjectFromRef(ref);
  if (!subject) return { kind: null, settled: false, approvalDecided: false };

  // Decided BEFORE the subject flips, so the two cannot disagree in the window between them.
  // A card left in the queue beside a chore already reading 'approved' is the state a parent
  // would tap again, and the tap would mint against a ref that has already paid.
  const pending = approvalsRepo.pendingApprovalFor(subject.kind, subject.id);
  const approvalDecided = pending
    ? approvalsRepo.decideApproval(pending.id, "approved", method, null, null, memberId)
    : false;

  if (subject.kind === "chore") {
    if (!repo.getChore(subject.id)) return { kind: subject.kind, settled: false, approvalDecided };
    repo.setChoreStatus(subject.id, "approved");
    stickersRepo.setChorePlacementState(subject.id, "shined");
    return { kind: subject.kind, settled: true, approvalDecided };
  }
  if (subject.kind === "practice_session") {
    // A logged day has no status to flip: it is already the record that it happened, and the
    // approval decided above is the record that it was paid for. `settled` still reports the
    // day EXISTS, so a ref naming a session this instance never wrote is answered honestly
    // rather than with a cheerful true.
    return {
      kind: subject.kind,
      settled: !!practicesRepo.getSessionById(subject.id),
      approvalDecided,
    };
  }
  if (!routines.getRun(subject.id)) return { kind: subject.kind, settled: false, approvalDecided };
  routines.setRunStatus(subject.id, "approved");
  stickersRepo.setRunPlacementsState(subject.id, "shined");
  return { kind: subject.kind, settled: true, approvalDecided };
}
