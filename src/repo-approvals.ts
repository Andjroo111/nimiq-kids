// Approvals + stars ledger (family mode). An approval is the parent's sign-off on a
// routine run or a one-off chore; approving credits stars. star_events is the source
// of truth; children.star_balance is the convenience tally (repo.addStars).

import { getDb } from "./db";
import * as repo from "./repo";
import * as media from "./repo-media";
import { unlinkMediaFiles } from "./media-files";

export type ApprovalStatus = "pending" | "approved" | "rejected";
/** V2 adds 'send' — a kid's cashlink-to-outside request (subject_id = send_requests.id).
 *  V3 adds 'coupon' — a Treasure Box coupon the parent fulfills (subject_id = kid_purchases.id).
 *  v0.43 adds 'stake' | 'unstake' — kid staking intents that now wait for a parent where
 *  approval is required (subject_id = send_requests.id; the request rides that table).
 *  Practices add 'practice_session' — ONE DAY of a practice (subject_id = practice_sessions.id),
 *  never the practice itself. The practice is a standing arrangement; the day is the thing that
 *  happened. Keying on the day is what makes the payout ref unique per day, so a week of piano
 *  is a week of payments and re-tapping today can never buy a second one. */
export type ApprovalSubject =
  | "routine_run" | "chore" | "send" | "coupon" | "stake" | "unstake" | "practice_session"
  /** One RUNG of a goal ladder. The rung is the subject, so `payoutRefFor` is unique per
   *  rung and a rung that has been climbed can never be sold a second time. */
  | "goal_rung";
/** How the approval was authorized. "demo" is a seeded demo household, which has
 *  no PIN gate (see parentAuth). */
export type ApprovalMethod = "pin" | "remote" | "demo";
export type StarReason = "routine" | "chore" | "bonus" | "payout" | "adjust";

export interface Approval {
  id: string; family_id: string; child_id: string;
  subject_kind: ApprovalSubject; subject_id: string;
  photo_asset_id: string | null; status: ApprovalStatus;
  method: ApprovalMethod | null;
  /** Which grown-up said yes (family_members.id). Null for an on-tablet PIN, and for every
   *  approval decided before a household could hold more than one grown-up. */
  decided_by_member_id: string | null;
  note: string | null; stars_awarded: number | null;
  /** Partial credit: fraction of the subject's own price this approval pays, in basis points
   *  (1..10000). NULL means full. See schema.sql for why bps and not a float, and why stars
   *  are not scaled by it. */
  share_bps: number | null;
  created_at: number; decided_at: number | null;
}
export interface StarEvent {
  id: string; family_id: string; child_id: string; delta: number; reason: StarReason;
  approval_id: string | null; cashlink_id: string | null; created_at: number;
}

const uid = () => crypto.randomUUID();
const now = () => Date.now();

// ---- approvals ----
/** Create a pending approval. Returns the existing pending row instead of throwing when
 *  one is already open for this subject (partial unique index). */
export function openApproval(
  familyId: string, childId: string, subjectKind: ApprovalSubject, subjectId: string,
): Approval {
  const existing = pendingApprovalFor(subjectKind, subjectId);
  if (existing) return existing;
  const a: Approval = {
    id: uid(), family_id: familyId, child_id: childId,
    subject_kind: subjectKind, subject_id: subjectId,
    photo_asset_id: null, status: "pending", method: null, decided_by_member_id: null, note: null,
    stars_awarded: null, share_bps: null, created_at: now(), decided_at: null,
  };
  getDb().run(
    "INSERT INTO approvals (id, family_id, child_id, subject_kind, subject_id, status, created_at) VALUES (?,?,?,?,?,?,?)",
    [a.id, a.family_id, a.child_id, a.subject_kind, a.subject_id, a.status, a.created_at],
  );
  return a;
}
export function getApproval(id: string): Approval | null {
  return (getDb().query("SELECT * FROM approvals WHERE id=?").get(id) as Approval) ?? null;
}
export function pendingApprovalFor(subjectKind: ApprovalSubject, subjectId: string): Approval | null {
  return (getDb().query("SELECT * FROM approvals WHERE subject_kind=? AND subject_id=? AND status='pending'")
    .get(subjectKind, subjectId) as Approval) ?? null;
}
/**
 * The latest approval for a subject, decided or not.
 *
 * `pendingApprovalFor` answers the question the money path asks ("is one open?"). This one
 * answers "what became of it", which is what a screen telling a kid where their work stands
 * needs — a decided row is exactly the case the pending lookup returns null for, and null
 * there is indistinguishable from never having been submitted at all.
 */
export function latestApprovalFor(subjectKind: ApprovalSubject, subjectId: string): Approval | null {
  return (getDb().query(
    "SELECT * FROM approvals WHERE subject_kind=? AND subject_id=? ORDER BY created_at DESC LIMIT 1",
  ).get(subjectKind, subjectId) as Approval) ?? null;
}
export function listApprovals(familyId: string, status?: ApprovalStatus): Approval[] {
  if (status) {
    return getDb().query("SELECT * FROM approvals WHERE family_id=? AND status=? ORDER BY created_at DESC")
      .all(familyId, status) as Approval[];
  }
  return getDb().query("SELECT * FROM approvals WHERE family_id=? ORDER BY created_at DESC")
    .all(familyId) as Approval[];
}
export function attachApprovalPhoto(id: string, mediaAssetId: string): void {
  getDb().run("UPDATE approvals SET photo_asset_id=? WHERE id=?", [mediaAssetId, id]);
}
/**
 * Race-safe decide: only flips a still-pending row. Returns false if already decided.
 *
 * THE PROOF PHOTO GOES WITH THE DECISION (#282). It is deleted here rather than in the
 * route handlers because there are four call sites — two in this app's approve/reject
 * routes, one in the chore route, one in `settlePayoutSubject` on the far side of a parent
 * -custody broadcast — and a retention rule that has to be remembered at four places is a
 * rule that will be missed at the fifth. This is the one function every terminal decision
 * passes through, and it only runs on the transition, so a re-decide deletes nothing twice.
 *
 * It is also why the delete hangs off the DECISION and not off `POST /approvals/:id/approve`:
 * under parent custody that route answers 202 and leaves the approval PENDING until the
 * money actually moves, and deleting the photo there would take it while the parent is still
 * looking at the card.
 *
 * `reopenApproval` (a payout that failed to broadcast) cannot bring the photo back. Accepted:
 * the kid's work still stands in the row, and the alternative is keeping a child's photograph
 * against a failure that has never happened outside a testnet.
 */
export function decideApproval(
  id: string, status: "approved" | "rejected", method: ApprovalMethod,
  starsAwarded: number | null, note: string | null,
  /** WHICH grown-up decided it (family_members.id). Null for an on-tablet PIN — nobody was
   *  signed in — which is a real answer and not a missing one. `method` already records how
   *  they proved themselves; this records who they were, a question that only started having
   *  more than one answer when a household could hold more than one grown-up. */
  memberId: string | null = null,
): boolean {
  const res = getDb().run(
    `UPDATE approvals SET status=?, method=?, decided_by_member_id=?, stars_awarded=?, note=?, decided_at=?
      WHERE id=? AND status='pending'`,
    [status, method, memberId, starsAwarded, note, now(), id],
  );
  if (res.changes === 0) return false;
  const path = media.dropApprovalProof(id);
  if (path) void unlinkMediaFiles([path]); // bytes are best-effort; the row is the boundary
  return true;
}

/** Basis points are the whole numerator: 10000 = the subject's full price. */
export const SHARE_BPS_FULL = 10_000;

/**
 * PARTIAL CREDIT (#351): the subject's full price scaled by the approval's committed share.
 *
 * FLOOR, never round. A family can pay less than the promise and never more than it — and
 * the rounding direction is the difference between "you did three quarters" and a payout
 * that quietly exceeds what the job was advertised at. NULL share means full, which is what
 * every approval decided before this shipped was.
 */
export function applyShare(fullLuna: number, shareBps: number | null): number {
  if (shareBps === null || shareBps >= SHARE_BPS_FULL) return fullLuna;
  if (shareBps <= 0) return 0;
  return Math.floor((fullLuna * shareBps) / SHARE_BPS_FULL);
}

/**
 * Commit this approval's partial-credit share while it is still PENDING.
 *
 * WHY IT IS NOT WRITTEN INSIDE decideApproval, which is where #351 put it. On a
 * `HATCH_CUSTODY=parent` instance the approval does not pay — it mints a transaction for a
 * grown-up's own wallet to sign — and that minting happens BEFORE the race-safe decide and
 * leaves the approval pending afterwards. A share written by the decide would therefore be
 * invisible to the one thing that fixes the amount, and the parent would sign the full price
 * on a card the queue says is a quarter. The share has to be on the row before anything reads
 * it, so `approvalPayoutLuna` can stay a pure function of the row and the mint, the budget
 * check and the payout are one number rather than three re-derivations.
 *
 * `share_bps IS NULL` in the WHERE is the race rule, and it is the same rule the signing
 * intent already follows: the FIRST share to land binds. Two grown-ups approving at once
 * cannot produce a card minted at one amount and paid at another, and a parent who abandons a
 * signature and comes back cannot quietly re-price work the first tap already claimed an
 * intent for. Returns false when a share is already committed, so a caller can tell the
 * difference between "written" and "someone got here first".
 */
export function setApprovalShare(id: string, shareBps: number): boolean {
  return getDb().run(
    "UPDATE approvals SET share_bps=? WHERE id=? AND status='pending' AND share_bps IS NULL",
    [shareBps, id],
  ).changes > 0;
}

/**
 * Put a decided approval back in the queue. For the one case where the parent said yes
 * but nothing happened: the payout broadcast failed, so the money never moved and the
 * subject was never settled. Without this the approval reads 'approved' forever, the
 * send request sits 'pending' where no screen shows it, and re-approving answers 409 —
 * the kid's request is silently lost (verified on testnet 2026-07-31).
 */
export function reopenApproval(id: string): boolean {
  const res = getDb().run(
    `UPDATE approvals SET status='pending', decided_at=NULL, method=NULL, decided_by_member_id=NULL,
       share_bps=NULL
      WHERE id=? AND status='approved'`,
    [id],
  );
  return res.changes > 0;
}

// ---- stars ledger ----
export function addStarEvent(
  familyId: string, childId: string, delta: number, reason: StarReason,
  refs: { approvalId?: string | null; cashlinkId?: string | null } = {},
): StarEvent {
  const e: StarEvent = {
    id: uid(), family_id: familyId, child_id: childId, delta, reason,
    approval_id: refs.approvalId ?? null, cashlink_id: refs.cashlinkId ?? null, created_at: now(),
  };
  getDb().run(
    "INSERT INTO star_events (id, family_id, child_id, delta, reason, approval_id, cashlink_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [e.id, e.family_id, e.child_id, e.delta, e.reason, e.approval_id, e.cashlink_id, e.created_at],
  );
  repo.addStars(childId, delta); // keep the tally in step with the ledger
  return e;
}
export function listStarEvents(childId: string, limit = 50): StarEvent[] {
  return getDb().query("SELECT * FROM star_events WHERE child_id=? ORDER BY created_at DESC LIMIT ?")
    .all(childId, limit) as StarEvent[];
}
/** Ledger-derived balance — must always equal children.star_balance (invariant test). */
export function starBalanceFromLedger(childId: string): number {
  const row = getDb().query("SELECT COALESCE(SUM(delta), 0) AS bal FROM star_events WHERE child_id=?")
    .get(childId) as { bal: number };
  return row.bal;
}
