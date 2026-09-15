// The parent approval queue (family mode). V2: approving PAYS NIM — a routine run or chore
// pays its reward_luna to the kid's real account ('earn' ledger row; REAL tx off-SIM), and a
// 'send' approval funds the kid's cashlink from the kid's own key. All three approval paths
// land here: on-tablet PIN, remote bearer, and the kid's photo-proof attach.

import { Hono } from "hono";
import type { Context } from "hono";
import * as repo from "../repo";
import * as routines from "../repo-routines";
import * as practicesRepo from "../repo-practices";
import * as goalsRepo from "../repo-goals";
import * as approvalsRepo from "../repo-approvals";
import * as media from "../repo-media";
import * as wrepo from "../repo-wallet";
import * as stickersRepo from "../repo-stickers";
import * as memberRepo from "../repo-members";
import { parentAuth, parentFamilyFrom, requireParent } from "../auth";
import { payoutSender } from "../members";
import type { Member } from "../repo-members";
import { publishLockChange } from "../lock-events";
import {
  availableKidLuna, checkPayable, executeSendRequest, familyTransferTarget, payKidEarn,
  payoutMayHaveLanded, payoutRefFor, payoutRetryIsSafe, refundKidSpend,
} from "../wallet/kid-wallet";
import { commitHeldDebit, debitForPurchase, reverseHeldDebit } from "../kid-netting";
import { parentSignedPayouts } from "../custody";
import { mintRefusal, mintSubjectIntent } from "../wallet/payout-intent-mint";
import { settlePayoutSubject } from "../wallet/payout-subject";
import { stake, stakePrecheck, unstake, unstakePrecheck } from "../wallet/kid-staking";
import { familySpendKey, withSpendLock } from "../wallet/spend-lock";
import { familyForSubject } from "./families";
import { sweepExpiredProofs } from "../proof-photos";

export const approvalsRoutes = new Hono();

/** Parent-page payload: approval + kid + a human summary of what's being approved. */
export function enrichApproval(a: approvalsRepo.Approval) {
  const child = repo.getChild(a.child_id);
  let summary: Record<string, unknown> = {};
  let rewardLuna = 0;
  if (a.subject_kind === "routine_run") {
    const run = routines.getRun(a.subject_id);
    const routine = run ? routines.getRoutine(run.routine_id) : null;
    const taskRuns = run ? routines.listTaskRuns(run.id) : [];
    const tasks = routine ? routines.listTasks(routine.id) : [];
    rewardLuna = run ? routines.runRewardLuna(run.id) : 0;
    // Every `titleKey` below is what the parent app renders when set, falling back
    // to `title`. The fallbacks themselves ("Routine", "Chore") are keyed too: they
    // are our words for a row that has gone missing, so they were English on a
    // Spanish phone exactly like the seeded titles were.
    summary = {
      title: routine?.title ?? "Routine",
      titleKey: routine ? routine.title_key : "papp.subjRoutine",
      emoji: routine?.emoji ?? "🌅",
      tasks: taskRuns.map((tr) => {
        const t = tasks.find((x) => x.id === tr.task_id);
        return {
          title: t?.title ?? "?", titleKey: t ? t.title_key : "papp.subjUnknown",
          emoji: t?.emoji ?? "", status: tr.status,
          elapsedS: tr.started_at && tr.finished_at ? Math.round((tr.finished_at - tr.started_at) / 1000) : null,
        };
      }),
    };
  } else if (a.subject_kind === "chore") {
    const chore = repo.getChore(a.subject_id);
    rewardLuna = chore?.reward_luna ?? 0;
    summary = {
      title: chore?.title ?? "Chore", titleKey: chore ? chore.title_key : "papp.subjChore",
      emoji: chore?.emoji ?? "🧽",
    };
  } else if (a.subject_kind === "practice_session") {
    // One DAY of a practice. The reward lives on the practice, not on the day, so it is read
    // through the session — the same indirection `approvalPayoutLuna` makes, in one place.
    const practice = practiceFor(a.subject_id);
    rewardLuna = practice ? practicesRepo.practiceDayLuna(practice, a.subject_id) : 0;
    // A stepped practice fills the SAME `tasks` array a routine fills, so the parent's card
    // draws the exercises with the renderer it already has — ticked ones with a check, the
    // rest struck through — and a card cannot come to disagree with the number above it.
    // `elapsedS: null` renders as nothing: an exercise is ticked, not timed.
    const ticked = new Set(practice ? practicesRepo.tickedStepIds(a.subject_id) : []);
    const steps = practice ? practicesRepo.listSteps(practice.id, true)
      .filter((s) => s.active || ticked.has(s.id)) : [];
    summary = {
      title: practice?.title ?? "Practice",
      titleKey: practice ? practice.title_key : "papp.subjPractice",
      emoji: practice?.emoji ?? "🎹",
      ...(steps.length
        ? {
            tasks: steps.map((s) => ({
              title: s.title, titleKey: s.title_key, emoji: s.emoji,
              status: ticked.has(s.id) ? "done" : "skipped", elapsedS: null,
            })),
          }
        : {}),
    };
  } else if (a.subject_kind === "goal_rung") {
    // One RUNG of a ladder. It carries its own price, so this reads like a chore; what the
    // card adds is WHICH ladder it is a rung of, because "Hold it for 30 seconds" on its own
    // does not tell a parent what they are looking at.
    const rung = goalsRepo.getRung(a.subject_id);
    const goal = rung ? goalsRepo.getGoal(rung.goal_id) : null;
    rewardLuna = rung?.reward_luna ?? 0;
    summary = {
      title: rung?.title ?? "Goal",
      titleKey: rung ? rung.title_key : "papp.subjRung",
      emoji: rung?.emoji ?? "🪜",
      goalTitle: goal?.title ?? null,
      goalTitleKey: goal?.title_key ?? null,
    };
  } else if (a.subject_kind === "coupon") {
    // V3 Treasure Box coupon: the kid ALREADY paid (spend tx) — the parent makes it real.
    const purchase = stickersRepo.getPurchase(a.subject_id);
    rewardLuna = 0; // nothing pays out on approve; reject refunds priceLuna
    // A purchase title is a SNAPSHOT taken at buy time, so it is whatever the shelf
    // said then. Keyed off the item it came from so it still translates.
    const item = purchase ? stickersRepo.getStoreItem(purchase.item_id) : null;
    summary = {
      title: purchase?.title ?? "Prize", titleKey: item?.title_key ?? (purchase ? null : "papp.subjPrize"),
      emoji: "🎁", priceLuna: purchase?.price_luna ?? 0,
    };
  } else if (a.subject_kind === "stake" || a.subject_kind === "unstake") {
    // Queued staking intent — rides the send_requests table (see repo-wallet).
    const req = wrepo.getSendRequest(a.subject_id);
    rewardLuna = 0; // the kid's own money
    summary = {
      title: a.subject_kind === "stake" ? "Grow NIM" : "Take back NIM",
      titleKey: a.subject_kind === "stake" ? "papp.subjStake" : "papp.subjUnstake",
      emoji: "🌱", valueLuna: req?.value_luna ?? 0,
    };
  } else {
    const req = wrepo.getSendRequest(a.subject_id);
    rewardLuna = 0; // a send is the kid's own money, not an earn
    // A queued FAMILY transfer (v0.43) rides the same 'send' subject, so name the recipient
    // when the destination is inside the household: the card must not call a hand-over to a
    // sibling "a Cashlink". `toLabel` absent = the outbound case, rendered exactly as before.
    const fam = req ? repo.getFamily(req.family_id) : null;
    const inFamily = fam && req?.to_address ? familyTransferTarget(fam, req.to_address) : null;
    const toLabel = !inFamily ? null
      : "toChildId" in inFamily ? repo.getChild(inFamily.toChildId)?.label ?? null
        : fam!.parent_label;
    summary = {
      title: toLabel ? `Give NIM to ${toLabel}` : "Send a Cashlink",
      // `toLabel` is a kid's nickname, so the key interpolates it rather than
      // baking it into a sentence the parent app would have to re-parse.
      titleKey: toLabel ? "papp.subjGiveTo" : "papp.subjCashlink",
      emoji: "💸",
      valueLuna: req?.value_luna ?? 0, message: req?.message ?? null,
      toLabel,
    };
  }
  // WHOSE WALLET is already committed to this one, when somebody has tapped it. The intent
  // pinned a sender when it was minted and the relay refuses anything else, so a second
  // grown-up tapping the same card cannot pay it — their wallet would decline the bytes with
  // nothing they could act on. The card says so instead ("Mom started paying this one").
  //
  // Read off the payout ATTEMPT, not off the approval: the ref is derived from the subject, so
  // it is the same key whichever approval row is open, and it is the row the money is under.
  const claim = SUBJECT_PAYS_KID.has(a.subject_kind)
    ? wrepo.getPayoutAttempt(payoutRefFor(a.subject_kind, a.subject_id))
    : null;
  const payer = claim?.sender ? memberRepo.memberWithAddress(a.family_id, claim.sender) : null;
  return {
    id: a.id, status: a.status, subjectKind: a.subject_kind, createdAt: a.created_at,
    decidedAt: a.decided_at, method: a.method, note: a.note,
    payerMemberId: payer?.id ?? null,
    payerLabel: payer?.label ?? null,
    decidedByMemberId: a.decided_by_member_id,
    rewardLuna,
    child: child ? { id: child.id, label: child.label, emoji: child.emoji } : null,
    photoUrl: a.photo_asset_id ? `/api/media/${a.photo_asset_id}/file` : null,
    summary,
  };
}

/** This approval's payout key. Derived from the SUBJECT, so every approval row that ever
 *  authorises the same chore or run shares one key — see payoutRefFor. */
function subjectPayoutRef(a: approvalsRepo.Approval): string {
  return payoutRefFor(a.subject_kind, a.subject_id);
}

/**
 * The subjects whose approval PAYS THE KID out of the family's money.
 *
 * One set rather than three transcriptions of the same list, because the three places that ask
 * (mint a signing intent, refuse a reject of money already sent, reopen a failed payout) must
 * agree exactly. A kind present in one and missing from another is not a cosmetic difference:
 * miss it in the reject guard and a paid day can be taken back while the kid keeps the NIM;
 * miss it in the reopen and a failed broadcast strands the work with nobody able to retry.
 *
 * `send` / `stake` / `unstake` / `coupon` are outside it — they move the KID's own money, or
 * none at all, and are signed by the kid's key. NONCUSTODIAL-PLAN Phase 4 is where those go.
 */
const SUBJECT_PAYS_KID = new Set<approvalsRepo.ApprovalSubject>(
  ["chore", "routine_run", "practice_session", "goal_rung"],
);

/** The practice a logged day belongs to. A day's own row carries no title and no price. */
function practiceFor(sessionId: string): practicesRepo.Practice | null {
  const session = practicesRepo.getSessionById(sessionId);
  return session ? practicesRepo.getPractice(session.practice_id) : null;
}

/**
 * NIM this approval pays on approve (no side effects — decide first, then apply).
 *
 * A practice day is priced by its PRACTICE, read here at approval time. A day carries no price
 * of its own, so `PUT /practices/:id` refuses to move the reward while a day of that practice
 * is waiting — the same promise-stops-being-editable rule `PATCH /chores/:id` states, applied
 * to the shape a practice has.
 */
function approvalPayoutLuna(a: approvalsRepo.Approval): number {
  return approvalsRepo.applyShare(fullPriceLuna(a), a.share_bps);
}

/** What the SUBJECT itself is worth, before any share is applied. */
function fullPriceLuna(a: approvalsRepo.Approval): number {
  if (a.subject_kind === "routine_run") return routines.runRewardLuna(a.subject_id);
  if (a.subject_kind === "chore") return repo.getChore(a.subject_id)?.reward_luna ?? 0;
  if (a.subject_kind === "practice_session") {
    // A stepped practice is priced by the steps the kid ticked, exactly as a routine run is
    // priced by the tasks that read 'done'. practiceDayLuna is the ONE place that decides,
    // so the pill on the tablet, the card in the queue and this payout are one number.
    const practice = practiceFor(a.subject_id);
    return practice ? practicesRepo.practiceDayLuna(practice, a.subject_id) : 0;
  }
  // A rung's price is its own, read at approval time exactly like a chore's. It cannot have
  // moved: every write to a rung is refused while a rung of that ladder is waiting.
  if (a.subject_kind === "goal_rung") return goalsRepo.getRung(a.subject_id)?.reward_luna ?? 0;
  return 0;
}

/** Subject transitions + NIM payment — called only AFTER winning the race-safe decide.
 *  Returns what was paid/minted so the route can answer the parent app.
 *
 *  MONEY MOVES FIRST, THE SUBJECT SETTLES AFTER — the same order executeSendRequest uses
 *  (mint, then settleSendRequest). A payout that throws therefore leaves the run/chore
 *  exactly as the kid submitted it, with nothing to compensate for: the only thing the
 *  caller has to undo is its own decision, which is what reopenApproval is for. Settling
 *  the subject first is what made a failed chore payout unrecoverable — the chore read
 *  'approved' with no money behind it and every retry answered 409. */
async function applyApprove(
  fam: repo.Family, a: approvalsRepo.Approval, payoutLuna: number,
): Promise<{
  paidLuna: number; cashlinkUrl?: string; txHash?: string;
  /** A goal rung's theme sticker, and the boss when that rung finished the set. The parent
   *  app says so on the card it just cleared — otherwise the only sign a kid earned a dragon
   *  is that one silently appears on their tablet. */
  stickerId?: string; bossStickerId?: string;
}> {
  if (a.subject_kind === "routine_run") {
    const routine = routines.getRoutine(routines.getRun(a.subject_id)?.routine_id ?? "");
    const paid = payoutLuna > 0
      ? await payKidEarn(fam, a.child_id, payoutLuna, routine?.title ?? "Routine done", { ref: subjectPayoutRef(a) })
      : null;
    routines.setRunStatus(a.subject_id, "approved");
    stickersRepo.setRunPlacementsState(a.subject_id, "shined"); // V3: placed stickers gain the golden shine
    return { paidLuna: payoutLuna, txHash: paid?.tx_hash ?? undefined };
  }
  if (a.subject_kind === "chore") {
    const chore = repo.getChore(a.subject_id);
    // THE HASH IS THE RECEIPT, and this is the only place it can be handed over at the moment
    // it happens. `payKidEarn` has always returned the ledger row carrying it; both branches
    // used to drop it on the floor, so the transaction whose on-chain memo reads "Tidy your
    // room" was reachable only by leaving the celebration, opening Money and finding the row.
    const paid = payoutLuna > 0
      ? await payKidEarn(fam, a.child_id, payoutLuna, chore?.title ?? "Chore done", { ref: subjectPayoutRef(a) })
      : null;
    repo.setChoreStatus(a.subject_id, "approved");
    stickersRepo.setChorePlacementState(a.subject_id, "shined");
    return { paidLuna: payoutLuna, txHash: paid?.tx_hash ?? undefined };
  }
  if (a.subject_kind === "practice_session") {
    // A practice day has NOTHING TO SETTLE, and that is the shape rather than an omission. A
    // chore and a run each carry a status this flips; a logged day is already the whole record
    // of what happened, and the approval row beside it is the record of what the parent said.
    // Adding a second one would be a second place for them to disagree.
    const practice = practiceFor(a.subject_id);
    const paid = payoutLuna > 0
      ? await payKidEarn(fam, a.child_id, payoutLuna, practice?.title ?? "Practice", { ref: subjectPayoutRef(a) })
      : null;
    return { paidLuna: payoutLuna, txHash: paid?.tx_hash ?? undefined };
  }
  if (a.subject_kind === "goal_rung") {
    // A CLIMBED RUNG HAS NOTHING TO SETTLE, for the reason a practice day has nothing: the
    // approval beside it IS the record that the kid got there. `rungState` reads it, so a
    // status column here would be a second place for "climbed" to disagree with whether the
    // money moved. It is also what opens the next rung on an ordered ladder, in one step.
    const rung = goalsRepo.getRung(a.subject_id);
    const paid = payoutLuna > 0
      ? await payKidEarn(fam, a.child_id, payoutLuna, rung?.title ?? "Goal", { ref: subjectPayoutRef(a) })
      : null;
    // THE STICKER LANDS AFTER THE MONEY, and only once. `grantNextThemeSticker` takes the
    // first sticker of the theme the kid does not have, so the set's own arc (egg, hatchling,
    // young...) is the order they meet it in whichever ladder they happen to be on — and it
    // is a no-op once the set is complete, so a later rung still pays and simply has nothing
    // left to give. Finishing the five hands over the boss in the same call.
    const goal = rung ? goalsRepo.getGoal(rung.goal_id) : null;
    const earned = goal?.pack_id
      ? stickersRepo.grantNextThemeSticker(a.child_id, goal.pack_id)
      : null;
    return {
      paidLuna: payoutLuna, txHash: paid?.tx_hash ?? undefined,
      ...(earned?.sticker ? { stickerId: earned.sticker.id } : {}),
      ...(earned?.boss ? { bossStickerId: earned.boss.id } : {}),
    };
  }
  if (a.subject_kind === "coupon") {
    // The parent says "done" — the purchase is fulfilled, no money moves (already paid).
    stickersRepo.setPurchaseStatus(a.subject_id, "fulfilled");
    // If it was paid by deferring, its debt has been held out of reach of every payout in
    // case this went the other way. It cannot come back now, so it becomes settleable.
    commitHeldDebit(a.subject_id);
    return { paidLuna: 0 };
  }
  if (a.subject_kind === "stake" || a.subject_kind === "unstake") {
    // The queued intent executes NOW, through the same hardened stake/unstake services the
    // instant path uses (pending-settlement machinery included). The first ledger row for
    // this money appears here, at execution — a queued intent wrote none. The request's own
    // id rides along so its approved-but-unsettled reservation never blocks itself.
    const req = wrepo.getSendRequest(a.subject_id);
    if (!req || req.status !== "pending") return { paidLuna: 0 };
    if (a.subject_kind === "stake") await stake(fam, req.child_id, req.value_luna, req.id);
    else await unstake(fam, req.child_id, req.value_luna);
    wrepo.settleSendRequest(req.id, "executed", null);
    return { paidLuna: 0 };
  }
  const req = wrepo.getSendRequest(a.subject_id);
  if (!req || req.status !== "pending") return { paidLuna: 0 };
  const { cashlink } = await executeSendRequest(fam, req);
  // a scanned send settles as a transfer and has no link to hand back
  return { paidLuna: 0, cashlinkUrl: cashlink?.url };
}

async function applyReject(fam: repo.Family, a: approvalsRepo.Approval): Promise<void> {
  if (a.subject_kind === "routine_run") {
    // Back to in_progress: task states are preserved; the kid fixes it and re-submits.
    routines.setRunStatus(a.subject_id, "in_progress");
    stickersRepo.setRunPlacementsState(a.subject_id, "retry"); // V3: grey "try again" wobble
  } else if (a.subject_kind === "chore") {
    repo.setChoreStatus(a.subject_id, "rejected");
    stickersRepo.setChorePlacementState(a.subject_id, "retry");
  } else if (a.subject_kind === "practice_session") {
    // NOTHING. A declined practice day is a refusal to PAY, not a deletion of the day.
    //
    // Rejecting a chore sends work back to be redone. A day cannot be redone; it is over. And
    // the week count and the streak have never needed a parent — they are the kid's own record
    // of a habit they own, which is the entire premise of a practice. Wiring payment must not
    // quietly make the parent the referee of the streak as well, so the day stays counted, the
    // sticker stays placed, and no NIM moves. The declined approval is the record of the no.
  } else if (a.subject_kind === "goal_rung") {
    // NOTHING, and the rung goes back to OPEN on its own — `rungState` reads the latest
    // approval, and a rejected one is not `climbed`.
    //
    // Which is the opposite of a practice day, deliberately. A day is over and cannot be
    // redone, so declining refuses the payment only. A rung is a thing the kid could not do
    // YET: "not this time" is the parent saying try again, which is what rejecting a chore
    // has always meant. On an ordered ladder the rungs above it stay locked meanwhile,
    // because locking is computed from what has been CLIMBED.
  } else if (a.subject_kind === "coupon") {
    // The kid already paid — a rejected coupon gives the NIM back.
    const purchase = stickersRepo.getPurchase(a.subject_id);
    if (purchase && purchase.status === "pending_parent") {
      // WHICH WORLD THE PURCHASE HAPPENED IN, read off the purchase itself rather than off
      // today's custody setting: a deferred buy never moved anything, so paying it back out
      // of the hot wallet would hand the kid NIM for money that never left their address.
      const held = debitForPurchase(purchase.id);
      if (held) {
        reverseHeldDebit({
          familyId: fam.id, childId: purchase.child_id, purchaseId: purchase.id,
          valueLuna: purchase.price_luna, message: `${purchase.title} (given back)`,
        });
      } else {
        await refundKidSpend(fam, purchase.child_id, purchase.price_luna, `${purchase.title} (given back)`);
      }
      stickersRepo.setPurchaseStatus(purchase.id, "refunded");
    }
  } else {
    wrepo.settleSendRequest(a.subject_id, "rejected", null);
  }
}

approvalsRoutes.get("/approvals", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  // The proof-photo TTL, swept lazily at the top of the read path (#282). No cron: a parent
  // opening their queue is the most reliable clock this app has.
  await sweepExpiredProofs();
  const status = c.req.query("status") as approvalsRepo.ApprovalStatus | undefined;
  return c.json({ approvals: approvalsRepo.listApprovals(fam.id, status).map(enrichApproval) });
});

/** Kid attaches a proof photo (already uploaded via /api/media) to a pending approval. */
approvalsRoutes.post("/approvals/:id/photo", async (c) => {
  const a = approvalsRepo.getApproval(c.req.param("id"));
  if (!a || !(await familyForSubject(c, a.family_id))) return c.json({ error: "not_found" }, 404);
  if (a.status !== "pending") return c.json({ error: "already_decided" }, 409);
  const body = await c.req.json().catch(() => ({}));
  const asset = media.getMedia(String(body.mediaAssetId ?? ""));
  // The proof photo must belong to the SAME family as the approval it attaches to.
  if (!asset || asset.role !== "proof" || asset.family_id !== a.family_id) return c.json({ error: "media_not_found" }, 404);
  approvalsRepo.attachApprovalPhoto(a.id, asset.id);
  return c.json({ approval: enrichApproval(approvalsRepo.getApproval(a.id)!) });
});

/**
 * The on-chain memo this approval's payout carries. Same expressions `applyApprove` writes
 * into the ledger row, so a chore reads "Feed the cat" whichever world paid for it.
 */
function payoutMessage(a: approvalsRepo.Approval): string {
  if (a.subject_kind === "routine_run") {
    const run = routines.getRun(a.subject_id);
    return routines.getRoutine(run?.routine_id ?? "")?.title ?? "Routine done";
  }
  if (a.subject_kind === "practice_session") return practiceFor(a.subject_id)?.title ?? "Practice";
  if (a.subject_kind === "goal_rung") return goalsRepo.getRung(a.subject_id)?.title ?? "Goal";
  return repo.getChore(a.subject_id)?.title ?? "Chore done";
}

/**
 * Under parent custody, hand back something to sign instead of paying.
 *
 * Returns null when this is not that world — no custody flip, no payout, or a subject whose
 * money is not the family's to send (see SUBJECT_PAYS_KID) — and the caller falls through to
 * the path every live instance runs today.
 *
 * THE APPROVAL IS LEFT PENDING on the 202 path, and that is the whole reason this branch is
 * shaped differently from `decideAndApply` below. The card in the parent app IS the screen
 * here. A mobile wallet is a full-page redirect away, the Hub's result does not survive it,
 * and a card that left the queue the moment it was tapped would strand the kid's work behind
 * a signature nobody can reach any more. So the tap mints, the card stays, and a second tap
 * is handed the SAME bytes back (`already_claimed`). What settles the approval is
 * `settlePayoutSubject`, on the far side of the broadcast, beside the chore it settles.
 */
async function parentSignedApprove(
  c: Context, fam: repo.Family, a: approvalsRepo.Approval, method: approvalsRepo.ApprovalMethod,
  actor: Member | null,
): Promise<Response | null> {
  if (!parentSignedPayouts()) return null;
  if (!SUBJECT_PAYS_KID.has(a.subject_kind)) return null;
  const payoutLuna = approvalPayoutLuna(a);
  // A zero-reward job has nothing to sign and never did. It settles exactly as it always has.
  if (payoutLuna <= 0) return null;
  const child = repo.getChild(a.child_id);
  if (!child) return c.json({ error: "not_found" }, 404);

  // WHOSE WALLET. Whoever taps approve pays out of their own account, so the other parent and
  // the grandparents can each put real money in without the tablet — or the one funded wallet
  // — travelling between houses. `payoutSender` falls back to the owner for the two cases that
  // have no acting grown-up: an on-tablet PIN, and a member who has not connected a wallet yet.
  const payer = payoutSender(fam, actor);
  if (!payer) return mintRefusal(c, { ok: false, status: 400, body: { error: "no_parent_address" } });

  const ref = subjectPayoutRef(a);
  const minted = await mintSubjectIntent({
    fam, sender: payer.address, child, valueLuna: payoutLuna, message: payoutMessage(a), ref,
  });
  if (!minted.ok) return mintRefusal(c, minted);
  if (minted.settledWhole) {
    // The kid's deferred spending ate the reward whole, so no wallet is involved and there is
    // no second step to wait for. 200 and settled, for the same reason the signed branch
    // waits: leaving this pending would strand it against an event that is never coming.
    settlePayoutSubject(ref, method, payer.memberId);
    publishLockChange();
    return c.json({
      approval: enrichApproval(approvalsRepo.getApproval(a.id)!),
      settled: { settleLuna: minted.settleLuna, grossLuna: payoutLuna },
    });
  }
  // 202: accepted, not done. Nothing has moved and the approval is still in the queue.
  return c.json({
    approval: enrichApproval(approvalsRepo.getApproval(a.id)!),
    signingIntent: minted.intent,
  }, 202);
}

approvalsRoutes.post("/approvals/:id/approve", async (c) => {
  const opened = approvalsRepo.getApproval(c.req.param("id"));
  const fam = opened ? await familyForSubject(c, opened.family_id) : null;
  if (!opened || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  if (opened.status !== "pending") return c.json({ error: "already_decided" }, 409);

  const decideAndApply = async (): Promise<Response> => {
    // Re-read: a concurrent decide may have won while this caller waited its turn.
    let a = approvalsRepo.getApproval(opened.id);
    if (!a || a.status !== "pending") return c.json({ error: "already_decided" }, 409);

    // ---- PARTIAL CREDIT (#351) ----
    // Committed to the row FIRST, before the mint, the budget check or the payout read it,
    // so all three see one number. See repo-approvals.setApprovalShare for why it is not
    // written inside the race-safe decide the way the issue proposed.
    const shareRaw = (body as { shareBps?: unknown }).shareBps;
    if (shareRaw !== undefined && shareRaw !== null) {
      if (typeof shareRaw !== "number" || !Number.isInteger(shareRaw)) {
        return c.json({ error: "share_bps_invalid" }, 400);
      }
      // REFUSED, not ignored, on the kinds that move the KID's own money. A share on a send
      // or a stake has no meaning — the amount is the kid's request, not a price a grown-up
      // set — and silently dropping it would let a parent app ship a slider on a card that
      // pays the full amount anyway.
      if (!SUBJECT_PAYS_KID.has(a.subject_kind)) {
        return c.json({ error: "share_not_allowed_for_subject", subjectKind: a.subject_kind }, 400);
      }
      // ZERO IS NOT A SHARE, it is a rejection wearing a friendlier control. Rejecting a chore
      // or a rung means "not this time, try again" and leaves the subject open; approving at
      // zero would close it for good at no pay — a harsher outcome reached through a gentler
      // looking slider. Reject stays the only way to say no.
      if (shareRaw <= 0) return c.json({ error: "share_zero_use_reject" }, 400);
      if (shareRaw > approvalsRepo.SHARE_BPS_FULL) return c.json({ error: "share_bps_invalid" }, 400);
      // A partial share is a judgement about the kid's work, so it owes the kid a reason.
      // The note is what turns "you got 12 NIM instead of 24" into something answerable.
      const note = typeof (body as { note?: unknown }).note === "string"
        ? (body as { note: string }).note.trim() : "";
      if (shareRaw < approvalsRepo.SHARE_BPS_FULL && !note) {
        return c.json({ error: "share_needs_note" }, 400);
      }
      if (!approvalsRepo.setApprovalShare(a.id, shareRaw)) {
        // Someone already bound this card's price — see setApprovalShare. Answering 409 keeps
        // the parent app from believing its number won.
        const already = approvalsRepo.getApproval(a.id);
        return c.json({ error: "share_already_set", shareBps: already?.share_bps ?? null }, 409);
      }
      a = approvalsRepo.getApproval(a.id)!; // re-read so every amount below sees the share
    }
    // PARENT CUSTODY: this approval does not pay, it mints something to sign.
    //
    // First, before the budget check below, because that check bounds spending out of the
    // instance's SHARED hot wallet and under `HATCH_CUSTODY=parent` there is no shared hot
    // wallet and no key here at all. The money leaves this parent's own account, so there is
    // nothing of anyone else's to ration; affordability becomes their wallet's question and
    // it is answered at the confirmation screen. Same reasoning, same placement, as the
    // matching branch in /api/chores/:id/approve.
    const signed = await parentSignedApprove(c, fam, a, auth.method, auth.member);
    if (signed) return signed;
    // No ceiling on the amount — the parent priced the chore. The one question is whether the
    // family can fund it: its budget on the shared instance, the hot wallet's real balance
    // always. Checked BEFORE deciding, so a payout they cannot cover leaves the approval
    // pending and works on the next try after a top up, with nothing half-applied.
    //
    // A RETRY of a payout that already moved is exempt, and must be: the budget counts
    // spend from the ledger, so once this approval's own earn row exists it is charged
    // against the family's cap and the retry is refused for the money it itself spent.
    // The approval could then never be cleared — approve answered 400 forever and reject
    // would strip a chore the kid was already paid for. Nothing new is being funded here;
    // payKidEarn short-circuits on the ref and sends nothing.
    const payoutLuna = approvalPayoutLuna(a);
    if (payoutLuna > 0 && !payoutMayHaveLanded(subjectPayoutRef(a))) {
      const b = await checkPayable(fam, payoutLuna);
      if (!b.ok) {
        return c.json({ error: "budget_exhausted", neededLuna: payoutLuna, availableLuna: b.availableLuna }, 400);
      }
    }
    // A send spends the KID's own money, so it misses both checks above (payout is 0) — and
    // affordability was last tested when the kid queued the request, which may have been
    // several approvals ago. Same placement as the funding check: refused here leaves the
    // approval PENDING, so a parent can approve it again once the kid has earned enough,
    // instead of burning the request on a send that cannot be funded. In-flight value counts
    // as spent (availableKidLuna), and this request's own row never counts against itself.
    if (a.subject_kind === "send") {
      const req = wrepo.getSendRequest(a.subject_id);
      const kid = req ? repo.getChild(req.child_id) : null;
      if (req && kid) {
        const available = await availableKidLuna(kid, req.id);
        if (available < req.value_luna) {
          return c.json({ error: "insufficient_funds", neededLuna: req.value_luna, availableLuna: Math.max(0, available) }, 400);
        }
      }
    }
    // Same placement, same reasoning, for a queued stake/unstake: the kid's balance (or
    // staked total) may have moved since they asked. Refused here leaves the approval
    // PENDING, so it works on a later try instead of burning.
    if (a.subject_kind === "stake" || a.subject_kind === "unstake") {
      const req = wrepo.getSendRequest(a.subject_id);
      if (req && req.status === "pending") {
        try {
          if (a.subject_kind === "stake") await stakePrecheck(fam, req.child_id, req.value_luna, req.id);
          else await unstakePrecheck(fam, req.child_id, req.value_luna);
        } catch (err) {
          const msg = String((err as Error)?.message ?? err);
          return c.json({ error: msg, neededLuna: req.value_luna }, msg === "staking_unavailable" ? 503 : 400);
        }
      }
    }
    // The note goes onto the row for a PARTIAL approve for the same reason reject carries one:
    // it is the only place the kid's screen can read why the number is not the whole number.
    const decidedNote = a.share_bps !== null && a.share_bps < approvalsRepo.SHARE_BPS_FULL
      ? String((body as { note?: unknown }).note ?? "").trim() || null
      : null;
    if (!approvalsRepo.decideApproval(a.id, "approved", auth.method, null, decidedNote, auth.member?.id ?? null)) {
      return c.json({ error: "already_decided" }, 409);
    }
    try {
      const applied = await applyApprove(fam, a, payoutLuna);
      publishLockChange();
      return c.json({ approval: enrichApproval(approvalsRepo.getApproval(a.id)!), ...applied });
    } catch (err) {
      // The approval is decided but the payment failed (real-mode RPC error). Surface it —
      // the wallet feed has no row, so nothing double-pays on retry via parent tools.
      //
      // A SEND that failed is put back in the queue. Its request is still 'pending' (the
      // mint threw before settleSendRequest), so nothing moved and nothing settled — but a
      // decided approval is unreachable: no screen lists it and re-approving answers 409,
      // so the kid's request disappears. Only reopened when the request really is untouched,
      // so a partially-applied approval can never be replayed. Queued stake/unstake get the
      // same treatment: a failed broadcast leaves their request pending too.
      //
      // A CHORE or ROUTINE payout is put back the same way, with ONE exception. applyApprove
      // pays before it settles, so a throw leaves the run or chore where it was, and the
      // payout is claimed under this approval's id before it can reach a node — so a retry
      // replays that one transaction and can never make a second, different payment.
      //
      // The exception is a payout whose bytes crossed the wire through a provider that will
      // not hand them back: nobody can say whether the kid was paid, so putting it in front
      // of a parent as "try again" is precisely how one chore gets paid twice. It stays
      // decided instead — owed at most once, and legible rather than silently doubled.
      // payoutRetryIsSafe reads the recorded attempt rather than the error, because a lost
      // response and a flat refusal arrive as the same exception.
      const msg = String((err as Error)?.message ?? err);
      let reopened = false;
      if (SUBJECT_PAYS_KID.has(a.subject_kind) && payoutRetryIsSafe(subjectPayoutRef(a))) {
        reopened = approvalsRepo.reopenApproval(a.id);
      } else if (
        (a.subject_kind === "send" || a.subject_kind === "stake" || a.subject_kind === "unstake")
        && wrepo.getSendRequest(a.subject_id)?.status === "pending"
      ) {
        reopened = approvalsRepo.reopenApproval(a.id);
      }
      // The one loser of a serialized race gets the SAME answer a sequential refusal gets:
      // 400, nothing spent, approval pending again — not a scary 502. The execution-side
      // check inside the spend lock is what threw; the reopen above already restored the row.
      // A missing request row still answers 400: the parent app keys its race handling on
      // this shape, and falling through to 502 would surface a scary error for a refusal.
      if (reopened && msg === "insufficient_funds") {
        const req = wrepo.getSendRequest(a.subject_id);
        return c.json({ error: "insufficient_funds", neededLuna: req?.value_luna ?? 0 }, 400);
      }
      return c.json({ error: "pay_failed", approvalDecided: !reopened, reopened, detail: msg }, 502);
    }
  };

  // Chore/routine payouts (and a coupon's refund on reject) spend the FAMILY hot wallet, so
  // they serialize per family; a send/stake/unstake spends the KID's own account and is
  // serialized per child inside the wallet services themselves (src/wallet/spend-lock.ts).
  const kidMoney = opened.subject_kind === "send" || opened.subject_kind === "stake" || opened.subject_kind === "unstake";
  return kidMoney ? decideAndApply() : withSpendLock(familySpendKey(fam.id), decideAndApply);
});

approvalsRoutes.post("/approvals/:id/reject", async (c) => {
  const a = approvalsRepo.getApproval(c.req.param("id"));
  const fam = a ? await familyForSubject(c, a.family_id) : null;
  if (!a || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  if (a.status !== "pending") return c.json({ error: "already_decided" }, 409);
  // 'Pending' no longer implies 'unpaid'. A payout that landed and then hit trouble further
  // on puts its approval BACK in the queue, so a parent can meet a chore they already paid
  // for and reach for Reject — the natural reaction to "why is this back?". Rejecting it
  // strips the chore while the kid keeps the NIM, and for a routine it also returns the run
  // to in_progress, where re-submitting mints a NEW approval id, hence a NEW payout key,
  // hence a second payment for the same work through nothing but ordinary taps. Money
  // already out is not something a reject can take back, so it is refused outright. A practice
  // day is in that list for the first half of the reason and not the second: its day is never
  // un-logged (see applyReject), but a reject that answered OK after the NIM had landed would
  // still write "no" beside a payment that happened.
  if (SUBJECT_PAYS_KID.has(a.subject_kind) && payoutMayHaveLanded(subjectPayoutRef(a))) {
    return c.json({ error: "already_paid" }, 409);
  }
  const note = body.note ? String(body.note).slice(0, 300) : null;
  if (!approvalsRepo.decideApproval(a.id, "rejected", auth.method, null, note, auth.member?.id ?? null)) {
    return c.json({ error: "already_decided" }, 409);
  }
  try {
    await applyReject(fam, a);
  } catch (err) {
    // Decided but the coupon refund tx failed (real-mode RPC error) — surface it;
    // the purchase stays 'pending_parent' so a retry via parent tools can't double-refund.
    return c.json({
      error: "refund_failed", approvalDecided: true,
      detail: String((err as Error)?.message ?? err),
    }, 502);
  }
  publishLockChange();
  return c.json({ approval: enrichApproval(approvalsRepo.getApproval(a.id)!) });
});
