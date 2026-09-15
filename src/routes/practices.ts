// Practices: the things a kid keeps up rather than the things a kid does today.
// Piano, a workout, reading. A practice carries no time of day — it carries a
// weekly target in days, and the kid logs the days it happened.
//
// A PRACTICE PAYS NIM, LIKE A CHORE (Andjroo, 2026-08-03). Logging a day does not
// mint anything: it OPENS AN APPROVAL, exactly as handing in a chore does, and the
// parent's yes is what pays. That is the whole reason payment could be wired at all.
// A practice is self-reported by design — the point of a habit a kid owns — so
// paying on the tap would have been the one self-serve mint in the app. Routing it
// through the same queue every other payout crosses means it passes checkPayable,
// mints a signing intent under parent custody, and nets against deferred spending,
// all of it code this route does not have to know about.
//
// The subject is the SESSION, never the practice: the practice is a standing
// arrangement and a day is the thing that happened. That is what makes the payout
// ref unique per day, so a week of piano is a week of payments and tapping today a
// second time can never buy a second one.

import { Hono } from "hono";
import type { Context } from "hono";
import * as repo from "../repo";
import * as routines from "../repo-routines";
import * as practices from "../repo-practices";
import * as approvalsRepo from "../repo-approvals";
import { notifyParent } from "../notify";
import { familyForSubject, PAIRING_REQUIRED, requestFamily } from "./families";
import { hasParentToken, parentAuth } from "../auth";
import { nimUsd, usdToWholeNimLuna } from "../rates";
import { resolveJob, jobKey } from "../title-catalog";
import { INVALID_EMOJI, readOptionalEmoji } from "../emoji-field";
import { refuseBoardWrite } from "./members";

export const practicesRoutes = new Hono();

/** `?includeInactive=1` adds hidden practices for a parent holding this family's bearer
 *  token, so the parent board can offer one back. A kid's tablet gets the usual list. */
practicesRoutes.get("/practices", async (c) => {
  const childId = c.req.query("childId");
  const wantsInactive = c.req.query("includeInactive") === "1";
  if (childId) {
    const child = repo.getChild(childId);
    const fam = child ? await familyForSubject(c, child.family_id) : null;
    if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
    const today = routines.localDay(fam.tz);
    const all = wantsInactive && await hasParentToken(c, fam);
    return c.json({
      today,
      practices: practices.listPractices(fam.id, childId, all).map((p) => practices.practiceView(p, today)),
    });
  }
  const fam = await requestFamily(c);
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  const today = routines.localDay(fam.tz);
  const all = wantsInactive && await hasParentToken(c, fam);
  return c.json({
    today,
    practices: practices.listPractices(fam.id, undefined, all).map((p) => practices.practiceView(p, today)),
  });
});

practicesRoutes.post("/practices", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const childId = String(body.childId ?? "");
  // Same contract as POST /chores: a picker tile posts `catalogId` and the words
  // are read here. Piano, reading and spelling are all in the catalog, which is
  // most of what a weekly-target practice actually is.
  const picked = resolveJob(body.catalogId);
  const title = picked ? picked.en : String(body.title ?? "").trim();
  const child = repo.getChild(childId);
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  // A supporter pays for practice; they do not decide what it is or what it pays.
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  if (!title) return c.json({ error: "title_required" }, 400);

  const target = Number(body.targetPerWeek ?? 3);
  if (!Number.isFinite(target) || target < 1 || target > 7) return c.json({ error: "invalid_target" }, 400);
  const durationS = body.durationS === undefined || body.durationS === null ? null : Math.round(Number(body.durationS));
  if (durationS !== null && (!Number.isFinite(durationS) || durationS <= 0)) {
    return c.json({ error: "invalid_duration" }, 400);
  }

  const practiceEmoji = readOptionalEmoji(body.emoji);
  if (practiceEmoji === null) return c.json(INVALID_EMOJI, 400);
  const practice = practices.createPractice(fam.id, childId, picked ? picked.en : title, {
    emoji: picked ? picked.emoji : practiceEmoji,
    titleKey: picked ? jobKey(picked.id) : null,
    targetPerWeek: target,
    durationS,
    rewardLuna: body.rewardUsd !== undefined
      ? usdToWholeNimLuna(Number(body.rewardUsd), await nimUsd())
      : Math.round(Number(body.rewardLuna ?? 0)),
  });
  return c.json({ practice: practices.practiceView(practice, routines.localDay(fam.tz)) }, 201);
});

/**
 * Change a practice. What it PAYS is the one field a grown-up has to prove they are.
 *
 * Everything else here (the name, the target, the emoji, hiding it) has always been open to
 * anyone the family token reaches, which includes a kid's tablet. That was harmless while the
 * price was decoration. It is not any more: a field that decides money must be parent-authed,
 * and it must stop moving once a day has been practised against it.
 *
 * Both refusals are about the same promise. A kid practised today for the number that was on
 * the card; repricing while that day sits in the queue changes what they are paid for work
 * already done. It is the rule PATCH /chores/:id states as "a promise stops being editable
 * when it is claimed", in the shape a practice has: a chore freezes when it is handed in, and
 * a practice freezes while any of its days is waiting. Approving or declining today's clears it.
 */
practicesRoutes.put("/practices/:id", async (c) => {
  const practice = practices.getPractice(c.req.param("id"));
  const fam = practice ? await familyForSubject(c, practice.family_id) : null;
  if (!practice || !fam) return c.json({ error: "not_found" }, 404);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const body = await c.req.json().catch(() => ({}));
  if (body.rewardLuna !== undefined) {
    const next = Math.max(0, Math.round(Number(body.rewardLuna)));
    if (!Number.isFinite(next)) return c.json({ error: "invalid_reward" }, 400);
    if (next !== practice.reward_luna) {
      const auth = await parentAuth(c, fam, body.pin);
      if (!auth.ok) return c.json(auth.body, auth.status);
      if (practices.hasDayAwaitingApproval(practice.id)) {
        return c.json({ error: "day_awaiting_approval" }, 409);
      }
    }
  }
  if (body.targetPerWeek !== undefined) {
    const target = Number(body.targetPerWeek);
    if (!Number.isFinite(target) || target < 1 || target > 7) return c.json({ error: "invalid_target" }, 400);
  }
  if (body.active !== undefined) practices.setPracticeActive(practice.id, !!body.active);
  const patchedEmoji = readOptionalEmoji(body.emoji);
  if (patchedEmoji === null) return c.json(INVALID_EMOJI, 400);
  const updated = practices.updatePractice(practice.id, {
    title: body.title === undefined ? undefined : String(body.title),
    emoji: patchedEmoji,
    targetPerWeek: body.targetPerWeek === undefined ? undefined : Number(body.targetPerWeek),
    durationS: body.durationS === undefined ? undefined : (body.durationS === null ? null : Math.round(Number(body.durationS))),
    rewardLuna: body.rewardLuna === undefined ? undefined : Number(body.rewardLuna),
  });
  return c.json({ practice: practices.practiceView(updated!, routines.localDay(fam.tz)) });
});

/**
 * The exercises a day of this practice is made of (#294): scales, the song, sight-reading.
 *
 * EVERY WRITE HERE IS A WRITE TO A PRICE. A stepped practice is priced by its steps and its
 * own `reward_luna` is not read at all, so adding one, repricing one or retiring one all move
 * what a day pays — and all three take the parent auth and the same freeze `PUT /practices/:id`
 * takes on the practice's own reward. The freeze covers ADDING a step too, which looks
 * over-strict until you read it as the promise it is: the kid was shown a card worth 150 NIM
 * for three exercises, and a fourth appearing while their day sits in the queue changes what
 * they were told they had done.
 *
 * A supporter is refused by refuseBoardWrite: they pay for the practice, they do not price it.
 */
/** The how-to a kid reads on the tick sheet. Capped because it is coaching, not a lesson
 *  plan: a paragraph fits the sheet, a page pushes "I'm done" off the bottom of it. */
const HOW_MAX = 400;
function readHow(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return String(v).slice(0, HOW_MAX);
}

/**
 * A link a grown-up will tap on their phone. `http(s)` ONLY, and that is the whole point of
 * checking: this string is rendered into an anchor's href on the parent board, so `javascript:`
 * or `data:` here would be a script the next parent to open the sheet runs. A URL that does
 * not parse is refused rather than quietly dropped — the parent typed something and deserves
 * to be told it did not take.
 */
const INVALID = Symbol("invalid-video-url");
function readVideoUrl(v: unknown): string | null | undefined | typeof INVALID {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return INVALID; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return INVALID;
  return u.toString();
}

async function stepGuard(c: Context, practiceId: string, fam: repo.Family, pin?: unknown) {
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const auth = await parentAuth(c, fam, pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  if (practices.hasDayAwaitingApproval(practiceId)) return c.json({ error: "day_awaiting_approval" }, 409);
  return null;
}

practicesRoutes.post("/practices/:id/steps", async (c) => {
  const practice = practices.getPractice(c.req.param("id"));
  const fam = practice ? await familyForSubject(c, practice.family_id) : null;
  if (!practice || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const refused = await stepGuard(c, practice.id, fam, body.pin);
  if (refused) return refused;
  // Same contract as a routine's tasks: a tile posts `catalogId` and the words come from the
  // catalog, so the exercise reads in the kid's language forever.
  const picked = resolveJob(body.catalogId);
  const title = picked ? picked.en : String(body.title ?? "").trim();
  if (!title) return c.json({ error: "title_required" }, 400);
  const asked = body.rewardUsd !== undefined
    ? usdToWholeNimLuna(Number(body.rewardUsd), await nimUsd())
    : Math.round(Number(body.rewardLuna ?? 0));
  if (!Number.isFinite(asked) || asked < 0) return c.json({ error: "invalid_reward" }, 400);
  /**
   * THE FIRST EXERCISE INHERITS THE PRACTICE'S OWN PRICE.
   *
   * A stepped practice is priced by its steps and its own `reward_luna` stops being read, so
   * without this the first exercise added to a 400 NIM piano — named, priced at nothing,
   * saved — silently drops the day from 400 to 0. Nothing fails, nothing warns, and the card
   * on the kid's tablet quietly stops paying for a practice they still do every week.
   *
   * The parent app's own copy already promises this: "Break it into exercises and each one
   * carries its own share" (`papp.boardSplitHint`), on the very button that starts the split.
   * It was describing behaviour that did not exist.
   *
   * ONLY the first, and only when the parent named no price of their own. Once there are
   * steps the price genuinely lives in them, and a second exercise left at 0 is a parent
   * saying this one is worth nothing — which is allowed and must stay allowed. The rule this
   * keeps is narrow and worth stating: adding DETAIL never silently changes what a day pays.
   */
  const first = practices.listSteps(practice.id).length === 0;
  const rewardLuna = first && asked === 0 ? practice.reward_luna : asked;
  const stepEmoji = readOptionalEmoji(body.emoji);
  if (stepEmoji === null) return c.json(INVALID_EMOJI, 400);
  const video = readVideoUrl(body.videoUrl);
  if (video === INVALID) return c.json({ error: "invalid_video_url" }, 400);
  const step = practices.addStep(practice.id, title, {
    emoji: picked ? picked.emoji : (stepEmoji || "🎵"),
    titleKey: picked ? jobKey(picked.id) : null,
    rewardLuna,
    how: readHow(body.how),
    videoUrl: video,
  });
  return c.json({ step, practice: practices.practiceView(practice, routines.localDay(fam.tz)) }, 201);
});

practicesRoutes.patch("/practices/:id/steps/:stepId", async (c) => {
  const step = practices.getStep(c.req.param("stepId"));
  if (!step || step.practice_id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
  const practice = practices.getPractice(step.practice_id);
  const fam = practice ? await familyForSubject(c, practice.family_id) : null;
  if (!practice || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const refused = await stepGuard(c, practice.id, fam, body.pin);
  if (refused) return refused;
  if (body.rewardLuna !== undefined && !Number.isFinite(Number(body.rewardLuna))) {
    return c.json({ error: "invalid_reward" }, 400);
  }
  const patchedEmoji = readOptionalEmoji(body.emoji);
  if (patchedEmoji === null) return c.json(INVALID_EMOJI, 400);
  const video = readVideoUrl(body.videoUrl);
  if (video === INVALID) return c.json({ error: "invalid_video_url" }, 400);
  const updated = practices.updateStep(step.id, {
    title: body.title === undefined ? undefined : String(body.title).trim(),
    emoji: patchedEmoji,
    rewardLuna: body.rewardLuna === undefined ? undefined : Number(body.rewardLuna),
    active: body.active === undefined ? undefined : Boolean(body.active),
    how: readHow(body.how),
    videoUrl: video,
  });
  return c.json({ step: updated, practice: practices.practiceView(practice, routines.localDay(fam.tz)) });
});

/**
 * The kid logs that today's practice happened. Idempotent per day: tapping twice
 * on the same day is still one day toward the week, because the unit of a weekly
 * target is the day, not the rep.
 *
 * A practice worth something ALSO opens the parent's approval, which is where the
 * money is decided. Only on the FIRST log of the day, and that is what the phone
 * ping keys on: `openApproval` would hand back the same pending row on a second tap
 * (partial unique index), but the notification has no such memory, and a kid
 * fiddling with the card would otherwise buzz the parent's phone all afternoon.
 *
 * Family mode only, exactly like a chore submit. A demo household has no queue to
 * open one into; its practices log and pay nothing, as they always have.
 *
 * `stepIds` is what the kid TICKED on a practice that has exercises, and it is written here
 * and nowhere else. The day's price is the sum of those steps, so the ticks and the approval
 * are one event: they are recorded, the amount is computed from them, and the parent's phone
 * is told that number — all before this route answers. A later tap on the same day gets the
 * same session and the same ticks back (`tickSteps` refuses a second write), which is the
 * money half of the idempotence `logSession` already had.
 *
 * A day where nothing was ticked still LOGS — the week count and the streak are the kid's own
 * record and have never needed a grown-up. It simply owes nothing, so no approval opens, which
 * is the same branch a practice priced at zero has always taken.
 */
practicesRoutes.post("/practices/:id/session", async (c) => {
  const practice = practices.getPractice(c.req.param("id"));
  const fam = practice ? await familyForSubject(c, practice.family_id) : null;
  if (!practice || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const seconds = body.seconds === undefined ? null : Math.max(0, Math.round(Number(body.seconds) || 0));
  const today = routines.localDay(fam.tz);
  const firstToday = !practices.getSession(practice.id, today);
  const session = practices.logSession(practice.id, practice.child_id, today, seconds);
  if (Array.isArray(body.stepIds)) practices.tickSteps(session, body.stepIds.map(String));
  const owedLuna = practices.practiceDayLuna(practice, session.id);

  if (firstToday && fam.mode === "family" && owedLuna > 0) {
    const approval = approvalsRepo.openApproval(fam.id, practice.child_id, "practice_session", session.id);
    const child = repo.getChild(practice.child_id);
    notifyParent(fam, {
      title: `${child?.emoji ?? ""} ${child?.label ?? "Kid"} practised: ${practice.title}`,
      body: `${(owedLuna / 1e5).toFixed(2)} NIM waiting for your OK`,
      clickUrl: process.env.PARENT_URL ? `${process.env.PARENT_URL}#approval=${approval.id}` : undefined,
      tags: "star",
    });
  }
  return c.json({ session, practice: practices.practiceView(practice, today) }, 201);
});
