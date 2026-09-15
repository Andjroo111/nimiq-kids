import { Hono } from "hono";
import { mintCashlink } from "../nimiq/cashlink";
import * as repo from "../repo";
import * as approvalsRepo from "../repo-approvals";
import * as stickersRepo from "../repo-stickers";
import { bearerParent, parentAuth } from "../auth";
import { parentSignedPayouts, requiresApproval } from "../custody";
import { payoutSender } from "../members";
import type { Member } from "../repo-members";
import { mintRefusal, mintSubjectIntent } from "../wallet/payout-intent-mint";
import { settlePayoutSubject } from "../wallet/payout-subject";
import { notifyParent } from "../notify";
import { publishLockChange } from "../lock-events";
import { makeProvider } from "../wallet";
import {
  checkPayable, payKidEarn, payoutMayHaveLanded, payoutRefFor, payoutRetryIsSafe,
} from "../wallet/kid-wallet";
import { familySpendKey, withSpendLock } from "../wallet/spend-lock";
import { nimUsd, usdToWholeNimLuna } from "../rates";
import { familyForSubject, PAIRING_REQUIRED, requestFamily } from "./families";
import { resolveJob, jobKey, JOB_CATALOG, JOB_GROUPS } from "../title-catalog";
import { normalizeTitle, TITLE_MAX } from "../title-limits";
import { TASK_ICONS, taskIconUrl } from "../task-icons";
import { INVALID_EMOJI, readEmoji } from "../emoji-field";
import { refuseBoardWrite } from "./members";

export const chores = new Hono();

/** The drawn icons a kid can choose from when they add a job of their own. */
chores.get("/task-icons", (c) =>
  c.json({ icons: TASK_ICONS.map((i) => ({ ...i, url: taskIconUrl(i.id) })) }));

chores.get("/chores", async (c) => {
  const childId = c.req.query("childId");
  // With a childId the child row names the family (multi-family kid tablets);
  // without one this is an instance-level surface (demo page / legacy tablet).
  if (childId) {
    const child = repo.getChild(childId);
    const fam = child ? await familyForSubject(c, child.family_id) : null;
    if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
    return c.json({ chores: repo.listActiveChores(fam.id, childId) });
  }
  const fam = await requestFamily(c);
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  return c.json({ chores: repo.listChores(fam.id) });
});

chores.post("/chores", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const childId = String(body.childId ?? "");
  // A picker tile posts `catalogId` and nothing else about the words: the title,
  // the emoji and the translation key are all read from the catalog HERE. A
  // caller that sends its own title alongside is answered with the catalog's,
  // because a title and a key that disagree render as two different chores on
  // two devices in the same house.
  const picked = resolveJob(body.catalogId);
  // A catalog title is ours and is already within the cap; only typed input is judged.
  // The verdict is carried, not acted on, so the existing 404-before-400 ordering holds.
  const typed = picked ? null : normalizeTitle(body.title);
  const title = picked ? picked.en : (typed && typed.ok ? typed.title : "");
  // Rewards are agreed in DOLLARS and paid in WHOLE NIM: "this chore is worth $2"
  // becomes whatever whole number of coins that buys today, fixed at creation.
  // rewardLuna stays for callers that already know the exact coin amount.
  const rewardLuna = body.rewardUsd !== undefined
    ? usdToWholeNimLuna(Number(body.rewardUsd), await nimUsd())
    : Math.round(Number(body.rewardLuna ?? body.reward_luna ?? 0));
  const child = repo.getChild(childId);
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  // A SUPPORTER cannot put work on the board. They can pay for it — that is the whole role —
  // but what a job is and what it is worth stays with the parents. A kid adding a job to
  // their own board is untouched: they carry no member. See refuseGrownUp.
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  if (typed && !typed.ok) return c.json({ error: typed.error, max: TITLE_MAX }, 400);
  if (!title) return c.json({ error: "title_required" }, 400);
  // V2: family mode pays NIM directly (reward_luna), same as demo — kids are real account
  // holders now. reward_stars is still stored for old data/demo compat but no longer credited.
  const rewardStars = Math.round(Number(body.rewardStars ?? 0));
  const durationS = body.durationS !== undefined ? Math.round(Number(body.durationS)) : null;
  if (fam.mode === "family") {
    if (durationS !== null && (!Number.isFinite(durationS) || durationS <= 0)) return c.json({ error: "invalid_duration" }, 400);
  }
  // A kid may add a job to their own board, and it may be worth nothing at all —
  // the point is agency, not earning (Andjroo, 2026-07-30). Either side can name
  // an amount; nothing is ever paid without a parent approving it, so a kid
  // asking for too much is a conversation, not an exploit.
  const createdBy = body.createdBy === "kid" ? "kid" : "parent";
  if (!Number.isFinite(rewardLuna) || rewardLuna < 0) return c.json({ error: "invalid_reward" }, 400);
  if (rewardLuna === 0 && createdBy !== "kid") return c.json({ error: "reward_required" }, 400);

  // Learn-to-earn: kind 'lesson' = completing a learning task (e.g. a Brilliant math/coding
  // lesson). MVP completion is parent-attested — identical submit/approve/payout path.
  const kind = String(body.kind ?? "chore");
  if (kind !== "chore" && kind !== "lesson") return c.json({ error: "invalid_kind" }, 400);
  let subject: repo.LessonSubject | null = null;
  let rewardShape: repo.RewardShape | null = null;
  if (kind === "lesson") {
    subject = String(body.subject ?? "") as repo.LessonSubject;
    if (!repo.LESSON_SUBJECTS.includes(subject)) return c.json({ error: "invalid_subject" }, 400);
    rewardShape = String(body.rewardShape ?? "per-lesson") as repo.RewardShape;
    if (!repo.REWARD_SHAPES.includes(rewardShape)) return c.json({ error: "invalid_reward_shape" }, 400);
  }
  const defaultEmoji = kind === "lesson" ? (subject === "coding" ? "💻" : "📐") : "🧽";
  // A chore's emoji reaches the kid tablet's board. It is never markup: see src/emoji-field.ts.
  const emoji = picked ? picked.emoji : readEmoji(body.emoji, defaultEmoji);
  if (emoji === null) return c.json(INVALID_EMOJI, 400);

  const chore = repo.createChore(fam.id, childId, title, rewardLuna, emoji, {
    kind, subject, rewardShape, rewardStars, durationS, createdBy,
    titleKey: picked ? jobKey(picked.id) : null,
  });
  return c.json({ chore }, 201);
});

/**
 * Pending approval for a submitted chore (#117).
 *
 * A verbatim mirror of `GET /routine-runs/:id/approval`. A chore submit has always opened
 * exactly such a row (`openApproval(fam.id, chore.child_id, "chore", chore.id)`), but there
 * was no way to ask for its id — so the kid app's `waiting` branch had nowhere to go for a
 * chore and fell through to a toast. On the seeded demo, which plants one submitted chore
 * per kid precisely so a visitor can approve a payout and watch NIM land, that toast was
 * where a judge's first action died.
 *
 * READ ONLY. It hands back an id; approving still goes through POST /approvals/:id/approve
 * and its `parentAuth`, which is what actually decides whether a payout may happen.
 */
chores.get("/chores/:id/approval", async (c) => {
  const chore = repo.getChore(c.req.param("id"));
  if (!chore) return c.json({ error: "not_found" }, 404);
  if (!(await familyForSubject(c, chore.family_id))) return c.json({ error: "not_found" }, 404);
  const pending = approvalsRepo.pendingApprovalFor("chore", chore.id);
  if (!pending) return c.json({ error: "no_pending_approval" }, 404);
  return c.json({ approvalId: pending.id });
});

/**
 * Change a job that has not been done yet. Parent only.
 *
 * ONLY while the chore is still `open`, and that is a money rule rather than a
 * tidiness one: /chores/:id/approve pays `chore.reward_luna` as it reads it at
 * approval time, so editing the reward of a SUBMITTED chore would change what a
 * kid gets paid after they had already done the work for the old number. The
 * board is a set of promises; a promise stops being editable when it is claimed.
 *
 * A removed chore is not editable either. It is off the board, it can be put
 * back with /restore, and editing something invisible is how a parent ends up
 * surprised by what reappears.
 */
chores.patch("/chores/:id", async (c) => {
  const chore = repo.getChore(c.req.param("id"));
  const fam = chore ? await familyForSubject(c, chore.family_id) : null;
  if (!chore || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  if (chore.removed_at !== null) return c.json({ error: "chore_removed" }, 409);
  if (chore.status !== "open") return c.json({ error: "already_started" }, 409);

  // Same contract as POST /chores: a picker tile posts `catalogId` and the
  // words, the emoji and the key are all read from the catalog here, so a title
  // and a key can never disagree. Typed words carry no key and are shown exactly
  // as typed in every language.
  const picked = resolveJob(body.catalogId);
  let title: string | undefined;
  if (picked) title = picked.en;
  else if (body.title !== undefined) {
    const typed = normalizeTitle(body.title);
    if (!typed.ok) return c.json({ error: typed.error, max: TITLE_MAX }, 400);
    title = typed.title;
  }

  let rewardLuna: number | undefined;
  if (body.rewardUsd !== undefined) rewardLuna = usdToWholeNimLuna(Number(body.rewardUsd), await nimUsd());
  else if (body.rewardLuna !== undefined) rewardLuna = Math.round(Number(body.rewardLuna));
  if (rewardLuna !== undefined) {
    if (!Number.isFinite(rewardLuna) || rewardLuna < 0) return c.json({ error: "invalid_reward" }, 400);
    // A kid may put a job worth nothing on their own board (agency, not earning),
    // so a kid-created row keeps that right through an edit. One a parent owns
    // still has to be worth something, exactly as at creation.
    if (rewardLuna === 0 && chore.created_by !== "kid") return c.json({ error: "reward_required" }, 400);
  }

  const emoji = picked ? picked.emoji
    : body.emoji !== undefined ? (String(body.emoji).trim() || undefined) : undefined;

  const updated = repo.updateChore(chore.id, {
    title, emoji, rewardLuna,
    titleKey: picked ? jobKey(picked.id) : null,
  });
  return c.json({ chore: updated });
});

/**
 * Take a chore off the board. SOFT — the row survives so a parent can see what
 * was removed and put it back (Andjroo: "if a kid removes to do their laundry,
 * the parent should be able to see that they did that").
 *
 * A kid may remove by default; `kids_can_remove` is the parent's switch. A job
 * that has already been submitted or paid is the parent's to remove either way —
 * otherwise a kid could quietly erase a job the parent is mid-approval on.
 */
chores.post("/chores/:id/remove", async (c) => {
  const chore = repo.getChore(c.req.param("id"));
  const fam = chore ? await familyForSubject(c, chore.family_id) : null;
  if (!chore || !fam) return c.json({ error: "not_found" }, 404);
  if (chore.removed_at !== null) return c.json({ chore }); // already off the board
  const body = await c.req.json().catch(() => ({}));

  const asParent = await parentAuth(c, fam, body.pin);
  if (!asParent.ok) {
    if (!fam.kids_can_remove) return c.json({ error: "removal_not_allowed" }, 403);
    if (chore.status !== "open") return c.json({ error: "already_started" }, 403);
  }
  repo.removeChore(chore.id, asParent.ok ? "parent" : "kid");
  return c.json({ chore: repo.getChore(chore.id) });
});

/** Put it back. Parent only — the point of the trail is that they get the say. */
chores.post("/chores/:id/restore", async (c) => {
  const chore = repo.getChore(c.req.param("id"));
  const fam = chore ? await familyForSubject(c, chore.family_id) : null;
  if (!chore || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  repo.restoreChore(chore.id);
  return c.json({ chore: repo.getChore(chore.id) });
});

/** What a kid took off their board, for the parent to review. */
chores.get("/chores/removed", async (c) => {
  const childId = c.req.query("childId");
  const fam = childId
    ? await (async () => { const ch = repo.getChild(childId); return ch ? familyForSubject(c, ch.family_id) : null; })()
    : await requestFamily(c);
  if (!fam) return c.json(childId ? { error: "child_not_found" } : PAIRING_REQUIRED, childId ? 404 : 401);
  return c.json({ chores: repo.listRemovedChores(fam.id, childId ?? undefined) });
});

chores.post("/chores/:id/submit", async (c) => {
  const chore = repo.getChore(c.req.param("id"));
  const fam = chore ? await familyForSubject(c, chore.family_id) : null;
  if (!chore || !fam) return c.json({ error: "not_found" }, 404);
  // Handed in once. This route is kid-reachable and opens a fresh approval every time, so
  // without the guard a job the parent had already approved and paid could be put back in
  // the queue and approved a second time — the same line /chores/:id/approve holds two
  // routes down. Doing the job again is a NEW job (the "Again" sheet), never this one.
  // 'rejected' is deliberately still submittable: that is the kid redoing unpaid work.
  if (chore.status === "approved" || chore.status === "claimed") {
    return c.json({ error: "already_approved" }, 409);
  }
  repo.setChoreStatus(chore.id, "submitted");
  stickersRepo.resetRetryChorePlacement(chore.id); // V3: redo after reject, sticker hopeful again
  // Family mode: a submitted chore enters the parent approval queue + pings the phone.
  if (fam.mode === "family") {
    const approval = approvalsRepo.openApproval(fam.id, chore.child_id, "chore", chore.id);
    const child = repo.getChild(chore.child_id);
    notifyParent(fam, {
      title: `${child?.emoji ?? ""} ${child?.label ?? "Kid"} finished: ${chore.title}`,
      body: `${(chore.reward_luna / 1e5).toFixed(2)} NIM waiting for your OK`,
      clickUrl: process.env.PARENT_URL ? `${process.env.PARENT_URL}#approval=${approval.id}` : undefined,
      tags: "star",
    });
  }
  return c.json({ chore: repo.getChore(chore.id) });
});

chores.post("/chores/:id/reject", async (c) => {
  const chore = repo.getChore(c.req.param("id"));
  const fam = chore ? await familyForSubject(c, chore.family_id) : null;
  if (!chore || !fam) return c.json({ error: "not_found" }, 404);
  // Family mode: rejects flow through the approvals route (parent-authed, keeps the
  // queue consistent). Direct reject stays for the demo loop.
  if (fam.mode === "family") {
    const body = await c.req.json().catch(() => ({}));
    const auth = await parentAuth(c, fam, body.pin);
    if (!auth.ok) return c.json(auth.body, auth.status);
    const pending = approvalsRepo.pendingApprovalFor("chore", chore.id);
    // A chore whose payout already moved cannot be rejected: that would strip the chore
    // while the kid keeps the NIM. Keyed on the chore rather than on whichever approval row
    // happens to be open, for the same reason the payout itself is.
    if (payoutMayHaveLanded(payoutRefFor("chore", chore.id))) return c.json({ error: "already_paid" }, 409);
    if (pending) {
      approvalsRepo.decideApproval(
        pending.id, "rejected", auth.method, null,
        body.note ? String(body.note) : null, auth.member?.id ?? null,
      );
    }
    repo.setChoreStatus(chore.id, "rejected");
    stickersRepo.setChorePlacementState(chore.id, "retry"); // V3: grey "try again" wobble
    publishLockChange();
    return c.json({ chore: repo.getChore(chore.id) });
  }
  repo.setChoreStatus(chore.id, "rejected");
  repo.resetStreak(chore.child_id); // a rejected chore breaks the streak
  return c.json({ chore: repo.getChore(chore.id) });
});

/**
 * The core of the demo loop. Approve a chore -> mint a real Cashlink for the reward, funded from the
 * parent wallet -> return the shareable cashlink so the parent can hand the phone (or QR) to the kid.
 */
chores.post("/chores/:id/approve", async (c) => {
  const chore = repo.getChore(c.req.param("id"));
  const fam = chore ? await familyForSubject(c, chore.family_id) : null;
  if (!chore || !fam) return c.json({ error: "not_found" }, 404);
  if (chore.status === "approved" || chore.status === "claimed") {
    return c.json({ error: "already_approved" }, 409);
  }
  const body = await c.req.json().catch(() => ({}));
  // WHO may approve is the custody policy's call, not the family's mode. Both branches
  // below are a hot-wallet outflow (an 'earn' payout in family mode, a minted Cashlink in
  // demo mode), so keying the auth on `fam.mode` meant a demo-mode row walked straight
  // past HATCH_REQUIRE_PARENT_APPROVAL and handed the claim secret back to an anonymous
  // caller. `requiresApproval` is what makes that flag real (task item 3): it is true for
  // every family on a forced instance and for every family-mode household anywhere.
  let method: approvalsRepo.ApprovalMethod = "pin";
  // WHICH grown-up is approving, hoisted out of the branch below because it is needed twice
  // further down — to choose whose wallet pays, and to record who said yes.
  let actor: Member | null = null;
  if (requiresApproval(fam)) {
    const auth = await parentAuth(c, fam, body.pin);
    if (!auth.ok) return c.json(auth.body, auth.status);
    method = auth.method;
    actor = auth.member;
  } else {
    // An unforced demo household proves nothing to get here. But if the caller IS holding a
    // token for THIS household, the approval has a name on it and recording "nobody" would
    // be worse than reading one more row. A token for another household names nobody here.
    const holder = await bearerParent(c);
    actor = holder?.family.id === fam.id ? holder.member : null;
  }
  // Both branches below SPEND THE FAMILY HOT WALLET, so they serialize per family
  // (src/wallet/spend-lock.ts): two concurrent approvals must not both pass the
  // affordability check against the same balance. The chore's own status is re-read
  // under the lock for the same reason.
  return withSpendLock(familySpendKey(fam.id), async (): Promise<Response> => {
  const now = repo.getChore(chore.id);
  if (!now || now.status === "approved" || now.status === "claimed") {
    return c.json({ error: "already_approved" }, 409);
  }
  // V2 family mode: approval pays NIM to the kid's REAL account ('earn' ledger row; actual
  // tx off-SIM) — no per-chore cashlink mint, no stars. Races through the approvals row.
  if (fam.mode === "family") {
    // No ceiling on the reward — the parent set the price. Only affordability can refuse it,
    // and it is checked BEFORE deciding so a payout they cannot cover leaves the chore pending.
    //
    // A retry whose payout already moved is exempt: the budget derives spend from the ledger,
    // so this chore's own earn row would be counted against the family cap and refuse the
    // retry for money it itself spent — stranding the chore permanently. Nothing new is
    // funded on that path; payKidEarn short-circuits on the ref.
    //
    // The key is the CHORE, not the approval row opened below. This route opens a fresh
    // approval whenever none is pending — which is exactly the state a failed payout leaves
    // behind — so an approval-keyed payout would treat the retry as a brand new payment and
    // send a second one. (Verified: it did.)
    const ref = payoutRefFor("chore", chore.id);
    // PARENT-SIGNED PAYOUTS SKIP THE BUDGET, and that is not an oversight.
    //
    // `checkPayable` bounds spending out of the instance's SHARED hot wallet. Under
    // `HATCH_CUSTODY=parent` there is no shared hot wallet and no key here at all: the money
    // comes out of this parent's own account, so there is nothing of anyone else's to ration
    // and nothing this instance could refuse on someone else's behalf. Affordability becomes
    // the parent's wallet's problem, and it answers it at the confirmation screen.
    if (parentSignedPayouts() && chore.reward_luna > 0) {
      const child = repo.getChild(chore.child_id);
      if (!child) return c.json({ error: "not_found" }, 404);
      // THE APPROVAL IS OPENED AND LEFT PENDING, not decided here.
      //
      // It used to be decided up front and reopened on every refusal. That worked, but it
      // meant the one path that succeeds — 202, waiting on a signature — took the card OUT of
      // the parent's queue while nothing had moved. The parent app now reaches this branch
      // too (POST /api/approvals/:id/approve), and there the card IS the screen: a mobile
      // wallet is a full-page redirect away, and a card that vanishes before the redirect
      // returns leaves the kid's work with no way back onto anyone's screen.
      //
      // Nothing is lost by waiting. What stops a second wallet popup is the payout CLAIM, not
      // the approval row: a second tap re-mints, gets `already_claimed`, and is handed the
      // same bytes back. The approval is decided by `settlePayoutSubject` on the far side of
      // the broadcast, next to the chore it settles, so the two can never disagree.
      approvalsRepo.openApproval(fam.id, chore.child_id, "chore", chore.id);
      // WHOSE WALLET pays — the grown-up who tapped, falling back to the household's owner
      // when nobody is signed in (an on-tablet PIN) or they have no wallet connected yet.
      // Resolved through the SAME function the approval queue uses, because a chore approved
      // from the board and the same chore approved from the queue share one payout ref: two
      // answers to "who pays" would mint bytes for two different wallets under one claim.
      const payer = payoutSender(fam, actor);
      if (!payer) return c.json({ error: "no_parent_address" }, 400);
      const minted = await mintSubjectIntent({
        fam, sender: payer.address, child, valueLuna: chore.reward_luna, message: chore.title, ref,
      });
      if (!minted.ok) return mintRefusal(c, minted);
      if (minted.settledWhole) {
        // 200 and APPROVED, unlike the branch below: the reason that one waits is that a
        // wallet is a full-page redirect away and the board must not say paid before the
        // money moves. Here the settlement is already written and there is no second step to
        // wait for — leaving the chore pending would strand it against an event that is
        // never coming.
        settlePayoutSubject(ref, method, payer.memberId);
        publishLockChange();
        return c.json({
          chore: repo.getChore(chore.id),
          settled: { settleLuna: minted.settleLuna, grossLuna: chore.reward_luna },
        });
      }
      // 202, and the chore stays PENDING. It is not approved until money moves, and money
      // moves in the parent's wallet — which may be a full-page redirect away on mobile.
      // Marking it approved here would be the same "the board says paid, nothing moved"
      // bug the server-signed path already paid for once.
      return c.json({ chore: repo.getChore(chore.id), signingIntent: minted.intent }, 202);
    }
    if (chore.reward_luna > 0 && !payoutMayHaveLanded(ref)) {
      const b = await checkPayable(fam, chore.reward_luna);
      if (!b.ok) {
        return c.json({ error: "budget_exhausted", neededLuna: chore.reward_luna, availableLuna: b.availableLuna }, 400);
      }
    }
    const approval = approvalsRepo.openApproval(fam.id, chore.child_id, "chore", chore.id);
    if (!approvalsRepo.decideApproval(approval.id, "approved", method, null, null, actor?.id ?? null)) {
      return c.json({ error: "already_approved" }, 409);
    }
    // Pay FIRST, mark the chore done after — the order executeSendRequest uses, and the
    // reason a failure here has nothing half-applied to unwind. Marking the chore approved
    // up front stranded it: the money never moved, the board said it was paid, and the
    // retry answered 409. The payout is claimed under this approval's id BEFORE it can
    // reach a node, so a retry replays that one transaction rather than building a second.
    try {
      if (chore.reward_luna > 0) {
        await payKidEarn(fam, chore.child_id, chore.reward_luna, chore.title, { ref });
      }
      repo.setChoreStatus(chore.id, "approved");
      stickersRepo.setChorePlacementState(chore.id, "shined"); // V3: golden shine
    } catch (err) {
      // Back in the parent's queue, chore untouched: approving again is the retry, and it
      // is safe. Still inside the family spend lock — nothing else can spend between the
      // failure and the row going back to pending.
      //
      // Unless the payout is unresolvable — broadcast through a provider that will not hand
      // the bytes back, so whether the kid was paid is unknowable. That one is left decided:
      // inviting a retry there is how one chore gets paid twice.
      const msg = String((err as Error)?.message ?? err);
      const reopened = payoutRetryIsSafe(ref) && approvalsRepo.reopenApproval(approval.id);
      return c.json({
        error: "pay_failed", approvalDecided: !reopened, reopened, detail: msg,
      }, 502);
    }
    publishLockChange();
    return c.json({ chore: repo.getChore(chore.id), paidLuna: chore.reward_luna });
  }
  // Demo-mode mint is also a hot-wallet outflow — same affordability check. (In practice a
  // public instance only has family-mode households; this closes the leftover path.)
  {
    const b = await checkPayable(fam, chore.reward_luna);
    if (!b.ok) {
      return c.json({ error: "budget_exhausted", neededLuna: chore.reward_luna, availableLuna: b.availableLuna }, 400);
    }
  }
  try {
    const mint = await mintCashlink(makeProvider(), chore.reward_luna, `nimiq.kids: ${chore.title}`);
    repo.setChoreStatus(chore.id, "approved");
    const cashlink = repo.createCashlink({
      id: crypto.randomUUID(),
      family_id: chore.family_id,
      chore_id: chore.id,
      child_id: chore.child_id,
      kind: "payout",
      cashlink_address: mint.cashlinkAddress,
      value_luna: mint.valueLuna,
      message: chore.title,
      url: mint.url,
      funding_tx_hash: mint.fundingTxHash,
      status: "ready",
    });
    return c.json({
      chore: repo.getChore(chore.id),
      cashlink: {
        id: cashlink.id,
        url: cashlink.url,
        cashlinkAddress: cashlink.cashlink_address,
        fundingTxHash: cashlink.funding_tx_hash,
        valueLuna: cashlink.value_luna,
      },
    });
  } catch (err) {
    return c.json({ error: "mint_failed", detail: String((err as Error)?.message ?? err) }, 502);
  }
  }); // withSpendLock
});

/**
 * The picker's tiles: every job we have a translation for, grouped.
 *
 * Served rather than bundled so the parent app and the kid's own add-a-job sheet
 * draw the same list from the same place, and so adding a chore to
 * src/title-catalog.ts is the only edit a new tile needs.
 *
 * NO titles in the response, deliberately. Each tile carries its key and the
 * client renders `t(key)`, so the grid is in the reader's language without the
 * server having to know which one that is. `en` rides along only as the shell's
 * fallback for a locale that has not been merged yet — the same fallback every
 * other key gets.
 */
chores.get("/catalog/jobs", (c) =>
  c.json({
    groups: JOB_GROUPS.map((g) => ({
      id: g,
      labelKey: `cat.group.${g}`,
      jobs: JOB_CATALOG.filter((j) => j.group === g)
        .map((j) => ({ id: j.id, key: jobKey(j.id), emoji: j.emoji, en: j.en })),
    })),
  }));
