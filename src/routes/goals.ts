// Goals: the ladder a kid climbs. Single leg, then hold it thirty seconds, then both legs.
//
// A rung pays exactly like a chore: it carries its own price, the kid claims it, and the
// parent's yes is what pays. Claiming does not mint — it OPENS AN APPROVAL, so a rung
// inherits checkPayable, mintSubjectIntent under parent custody, netting and
// settlePayoutSubject without this route knowing about any of them.
//
// THE SUBJECT IS THE RUNG. That is what makes `payoutRefFor` unique per rung, so a rung is
// paid once ever however many times it is tapped, and it is why there is no claims table:
// the approval beside a rung IS the record of what the parent said about it.
//
// Two things differ from a chore, and both are about which rungs may be claimed at all:
//
//   · On an ORDERED ladder a rung opens only once every rung below it has been CLIMBED. A
//     rung still waiting does not open the next one, or a kid could claim the whole ladder
//     in the minute before a parent looks at their phone.
//   · Whether a ladder is ordered is the PARENT's call, per goal (Andjroo, 2026-08-04).
//     Holding a plank longer every week is a sequence; five swimming badges are not.

import { Hono } from "hono";
import type { Context } from "hono";
import * as repo from "../repo";
import * as goals from "../repo-goals";
import * as approvalsRepo from "../repo-approvals";
import { notifyParent } from "../notify";
import { familyForSubject, PAIRING_REQUIRED, requestFamily } from "./families";
import { hasParentToken, parentAuth } from "../auth";
import { nimUsd, usdToWholeNimLuna } from "../rates";
import { resolveJob, jobKey } from "../title-catalog";
import { INVALID_EMOJI, readOptionalEmoji } from "../emoji-field";
import { refuseBoardWrite } from "./members";
import * as stickersRepo from "../repo-stickers";
import * as goalRequests from "../repo-goal-requests";

export const goalsRoutes = new Hono();

/**
 * The themes a ladder can collect toward: dragons, unicorns, robots.
 *
 * Open to anyone the family token reaches, kid tablet included — a theme is a catalogue of
 * art, not a household's data, and the kid's own sheet wants to draw the set it is chasing.
 * Read from `sticker_packs` rather than a second list over here, so a pack added to
 * src/sticker-catalog.ts is offered on the parent's sheet with no further edit.
 */
goalsRoutes.get("/goal-themes", (c) => c.json({
  themes: stickersRepo.listThemePacks().map((p) => ({
    packId: p.id, title: p.title, titleKey: p.title_key,
    stickers: stickersRepo.packRungStickers(p.id).map((s) => ({
      id: s.id, label: s.label, assetUrl: s.asset_url,
    })),
    boss: (() => {
      const b = stickersRepo.packBoss(p.id);
      return b ? { id: b.id, label: b.label, assetUrl: b.asset_url } : null;
    })(),
    eggUrl: stickersRepo.packEggUrl(p.id),
  })),
}));

/** `?includeInactive=1` adds retired ladders and retired rungs, and only for a parent holding
 *  this family's bearer token. A kid's tablet gets the ladders it can actually climb. */
goalsRoutes.get("/goals", async (c) => {
  const childId = c.req.query("childId");
  const wantsInactive = c.req.query("includeInactive") === "1";
  const child = childId ? repo.getChild(childId) : null;
  const fam = childId
    ? (child ? await familyForSubject(c, child.family_id) : null)
    : await requestFamily(c);
  if (childId && (!child || !fam)) return c.json({ error: "child_not_found" }, 404);
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  const all = wantsInactive && await hasParentToken(c, fam);
  return c.json({
    goals: goals.listGoals(fam.id, childId ?? undefined, all).map((g) => goals.goalView(g, all)),
  });
});

/**
 * THE KID ASKING FOR A LADDER (#389).
 *
 * A kid can see the sets they could collect; this is where "I want that one" lands. It
 * creates a REQUEST, never a goal: the title and the target are the part a grown-up and the
 * kid settle together, and a tap that minted a ladder would decide them alone.
 *
 * Open to the family token like the rest of this screen — the kid's tablet carries it. The
 * pack still has to be a real theme pack, for exactly the reason POST /goals checks it: a
 * request naming a pack that is FOR SALE would become a ladder handing out stickers the kid
 * could have bought, and `theme` is the only thing keeping those two economies apart.
 */
goalsRoutes.post("/kids/:id/goal-requests", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const packId = String(body.packId ?? "");
  if (!packId || !stickersRepo.isThemePack(packId)) return c.json({ error: "unknown_theme" }, 400);
  const raw = String(body.note ?? "").trim();
  const note = raw ? raw.slice(0, 200) : null;   // their words, bounded; it is a wish, not an essay
  const req = goalRequests.create(fam.id, child.id, packId, note);
  notifyParent(fam, {
    title: `${child.label} wants a new set`,
    body: "Tap to name the ladder together and set what it is worth.",
    tags: "ladder",
  });
  return c.json({ request: req }, 201);
});

/** What this kid has asked for. Drives the "asked" state on their own screen, so a set they
 *  already tapped reads as waiting rather than offering the same tap again. */
goalsRoutes.get("/kids/:id/goal-requests", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  return c.json({ requests: goalRequests.listForChild(child.id) });
});

/** The grown-up's queue. */
goalsRoutes.get("/parent/goal-requests", async (c) => {
  const fam = await requestFamily(c);
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  if (!(await hasParentToken(c, fam))) return c.json(PAIRING_REQUIRED, 401);
  return c.json({ requests: goalRequests.listPending(fam.id) });
});

/**
 * Decide one. Approving REQUIRES a title, because that is the half the request deliberately
 * does not carry — the ladder is named by the two of them, not by the tap that asked for it.
 */
goalsRoutes.post("/parent/goal-requests/:id/decide", async (c) => {
  const fam = await requestFamily(c);
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  if (!(await hasParentToken(c, fam))) return c.json(PAIRING_REQUIRED, 401);
  const req = goalRequests.get(c.req.param("id"));
  if (!req || req.family_id !== fam.id) return c.json({ error: "not_found" }, 404);
  if (req.status !== "pending") return c.json({ error: "already_decided", status: req.status }, 409);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;

  const body = await c.req.json().catch(() => ({}));
  if (body.approve === false) return c.json({ request: goalRequests.decide(req.id, "declined") });

  const title = String(body.title ?? "").trim();
  if (!title) return c.json({ error: "title_required" }, 400);
  const goal = goals.createGoal(fam.id, req.child_id, title, {
    emoji: readOptionalEmoji(body.emoji) || "\u{1FA9C}",
    ordered: body.ordered !== false,
    packId: req.pack_id,
  });
  return c.json({ request: goalRequests.decide(req.id, "approved", goal.id), goal: goals.goalView(goal) });
});

goalsRoutes.post("/goals", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const child = repo.getChild(String(body.childId ?? ""));
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  // A supporter pays for the climb; they do not decide what it is or what it pays.
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const picked = resolveJob(body.catalogId);
  const title = picked ? picked.en : String(body.title ?? "").trim();
  if (!title) return c.json({ error: "title_required" }, 400);
  const goalEmoji = readOptionalEmoji(body.emoji);
  if (goalEmoji === null) return c.json(INVALID_EMOJI, 400);
  // A theme has to be a REAL theme pack. An unknown id, or the id of a pack that is for sale,
  // would otherwise make a ladder that hands out stickers the kid could have bought — and
  // `theme` is the only thing keeping those two economies apart.
  const packId = body.packId === undefined || body.packId === null ? null : String(body.packId);
  if (packId && !stickersRepo.isThemePack(packId)) return c.json({ error: "unknown_theme" }, 400);
  const goal = goals.createGoal(fam.id, child.id, title, {
    emoji: picked ? picked.emoji : (goalEmoji || "🪜"),
    titleKey: picked ? jobKey(picked.id) : null,
    ordered: body.ordered !== false,
    packId,
  });
  return c.json({ goal: goals.goalView(goal) }, 201);
});

/**
 * Change a ladder. Its NAME and its face are open to whoever the family token reaches, the
 * same as a practice's; `ordered` is not, because it decides which rungs a kid may claim.
 *
 * And like every other write on this screen it stops while a rung is waiting: flipping an
 * ordered ladder loose while the parent has a claim in front of them would open every rung
 * above the one they are looking at.
 */
goalsRoutes.patch("/goals/:id", async (c) => {
  const goal = goals.getGoal(c.req.param("id"));
  const fam = goal ? await familyForSubject(c, goal.family_id) : null;
  if (!goal || !fam) return c.json({ error: "not_found" }, 404);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const body = await c.req.json().catch(() => ({}));
  if (body.ordered !== undefined && !!body.ordered !== (goal.ordered === 1)) {
    const auth = await parentAuth(c, fam, body.pin);
    if (!auth.ok) return c.json(auth.body, auth.status);
    if (goals.hasRungAwaitingApproval(goal.id)) return c.json({ error: "rung_awaiting_approval" }, 409);
  }
  // Changing the THEME is a money-adjacent edit in the way the order is: the collection a kid
  // is part-way through would stop being what this ladder feeds, so it takes the same auth and
  // the same freeze. Stickers already collected are KEPT: the kid earned them.
  if (body.packId !== undefined && (body.packId ?? null) !== goal.pack_id) {
    const auth = await parentAuth(c, fam, body.pin);
    if (!auth.ok) return c.json(auth.body, auth.status);
    if (goals.hasRungAwaitingApproval(goal.id)) return c.json({ error: "rung_awaiting_approval" }, 409);
    if (body.packId && !stickersRepo.isThemePack(String(body.packId))) {
      return c.json({ error: "unknown_theme" }, 400);
    }
  }
  const patchedEmoji = readOptionalEmoji(body.emoji);
  if (patchedEmoji === null) return c.json(INVALID_EMOJI, 400);
  const updated = goals.updateGoal(goal.id, {
    title: body.title === undefined ? undefined : String(body.title).trim(),
    emoji: patchedEmoji,
    ordered: body.ordered === undefined ? undefined : Boolean(body.ordered),
    packId: body.packId === undefined ? undefined : (body.packId ? String(body.packId) : null),
    active: body.active === undefined ? undefined : Boolean(body.active),
  });
  return c.json({ goal: goals.goalView(updated!) });
});

/**
 * Every write to a rung is a write to a PRICE, and to which rungs are reachable. So all of
 * them take the parent's PIN and all of them stop while a rung of that ladder is waiting —
 * the rule `PUT /practices/:id` states for a practice's reward, in the shape a ladder has.
 */
async function rungGuard(c: Context, goal: goals.Goal, fam: repo.Family, pin?: unknown) {
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const auth = await parentAuth(c, fam, pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  if (goals.hasRungAwaitingApproval(goal.id)) return c.json({ error: "rung_awaiting_approval" }, 409);
  return null;
}

goalsRoutes.post("/goals/:id/rungs", async (c) => {
  const goal = goals.getGoal(c.req.param("id"));
  const fam = goal ? await familyForSubject(c, goal.family_id) : null;
  if (!goal || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const refused = await rungGuard(c, goal, fam, body.pin);
  if (refused) return refused;
  const picked = resolveJob(body.catalogId);
  const title = picked ? picked.en : String(body.title ?? "").trim();
  if (!title) return c.json({ error: "title_required" }, 400);
  const rewardLuna = body.rewardUsd !== undefined
    ? usdToWholeNimLuna(Number(body.rewardUsd), await nimUsd())
    : Math.round(Number(body.rewardLuna ?? 0));
  if (!Number.isFinite(rewardLuna) || rewardLuna < 0) return c.json({ error: "invalid_reward" }, 400);
  const rungEmoji = readOptionalEmoji(body.emoji);
  if (rungEmoji === null) return c.json(INVALID_EMOJI, 400);
  const rung = goals.addRung(goal.id, title, {
    emoji: picked ? picked.emoji : (rungEmoji || goal.emoji),
    titleKey: picked ? jobKey(picked.id) : null,
    rewardLuna,
  });
  return c.json({ rung, goal: goals.goalView(goal) }, 201);
});

goalsRoutes.patch("/goals/:id/rungs/:rungId", async (c) => {
  const rung = goals.getRung(c.req.param("rungId"));
  if (!rung || rung.goal_id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
  const goal = goals.getGoal(rung.goal_id);
  const fam = goal ? await familyForSubject(c, goal.family_id) : null;
  if (!goal || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const refused = await rungGuard(c, goal, fam, body.pin);
  if (refused) return refused;
  if (body.rewardLuna !== undefined && !Number.isFinite(Number(body.rewardLuna))) {
    return c.json({ error: "invalid_reward" }, 400);
  }
  const patchedEmoji = readOptionalEmoji(body.emoji);
  if (patchedEmoji === null) return c.json(INVALID_EMOJI, 400);
  const updated = goals.updateRung(rung.id, {
    title: body.title === undefined ? undefined : String(body.title).trim(),
    emoji: patchedEmoji,
    rewardLuna: body.rewardLuna === undefined ? undefined : Number(body.rewardLuna),
    active: body.active === undefined ? undefined : Boolean(body.active),
  });
  return c.json({ rung: updated, goal: goals.goalView(goal) });
});

/**
 * The kid says they made it. Opens the parent's approval, exactly as handing in a chore does.
 *
 * ⚠️ THE ORDER IS ENFORCED HERE, not on the tablet. `rungClaimable` resolves the rung against
 * the whole ladder server-side, so a locked rung is refused whatever the client thinks it is
 * drawing — a kid app that lost its poll and a request typed by hand get the same answer.
 *
 * A second tap on a rung already waiting is the idempotent nothing `openApproval` has always
 * been (partial unique index on pending), and the phone ping is keyed on OPENING one rather
 * than on the tap, so a kid fiddling with the card cannot buzz a parent all afternoon.
 *
 * Family mode only, like a chore submit: a demo household has no queue to open one into.
 */
goalsRoutes.post("/goals/:id/rungs/:rungId/claim", async (c) => {
  const rung = goals.getRung(c.req.param("rungId"));
  if (!rung || rung.goal_id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
  const goal = goals.getGoal(rung.goal_id);
  const fam = goal ? await familyForSubject(c, goal.family_id) : null;
  if (!goal || !fam) return c.json({ error: "not_found" }, 404);
  if (!goals.rungClaimable(goal, rung.id)) return c.json({ error: "rung_not_open" }, 409);

  if (fam.mode === "family") {
    const approval = approvalsRepo.openApproval(fam.id, goal.child_id, "goal_rung", rung.id);
    const child = repo.getChild(goal.child_id);
    notifyParent(fam, {
      title: `${child?.emoji ?? ""} ${child?.label ?? "Kid"} got there: ${rung.title}`,
      body: rung.reward_luna > 0
        ? `${(rung.reward_luna / 1e5).toFixed(2)} NIM waiting for your OK`
        : `${goal.title}: waiting for your OK`,
      clickUrl: process.env.PARENT_URL ? `${process.env.PARENT_URL}#approval=${approval.id}` : undefined,
      tags: "star",
    });
  }
  return c.json({ goal: goals.goalView(goal) }, 201);
});
