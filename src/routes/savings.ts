// WHAT A KID IS SAVING FOR (#354, epic #350). The parent's side of the meter.
//
// The kid does not need a route here: the meter rides on GET /kids/:id/wallet, because it is a
// MIRROR of that endpoint's own `balanceLuna` and reading it anywhere else would mean reading the
// balance twice and getting two chances to disagree.
//
// So this file is only the three writes a grown-up makes: start saving for something, move the
// goalposts, stop. Same shape as the ladder routes next door — `familyForSubject` for tenancy,
// `refuseBoardWrite` because a supporter pays for things without deciding what they are.

import { Hono } from "hono";
import * as repo from "../repo";
import * as savings from "../repo-savings";
import * as stickersRepo from "../repo-stickers";
import { familyForSubject } from "./families";
import { refuseBoardWrite } from "./members";
import { INVALID_EMOJI, readOptionalEmoji } from "../emoji-field";
import { nimUsd, usdToWholeNimLuna } from "../rates";

export const savingsRoutes = new Hono();

/**
 * A target the parent has capped. #354: "a kid who sets a 1,000,000 NIM target has built a meter
 * that never moves, which is the opposite of the point."
 *
 * The ceiling is deliberately generous rather than clever — it exists to catch a fat finger and a
 * kid testing the limits, not to price anybody's bike. A grown-up who genuinely wants a bigger
 * number is the one setting it, and they can.
 */
const MAX_TARGET_LUNA = 100_000 * 1e5; // 100,000 NIM

savingsRoutes.get("/kids/:id/savings", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  const target = savings.activeTarget(child.id);
  // No balance here on purpose: this is the parent's board reading what the target IS, not what
  // the meter says. The meter belongs to the wallet read, which owns the balance.
  return c.json({ target });
});

savingsRoutes.post("/kids/:id/savings", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;

  const body = await c.req.json().catch(() => ({}));
  const emoji = readOptionalEmoji(body.emoji);
  if (emoji === null) return c.json(INVALID_EMOJI, 400);

  // A target can name a Treasure Box item, and then the item's price IS the target: two numbers
  // for one thing is how they end up disagreeing after a parent re-prices the shelf.
  let itemId: string | null = null;
  let title = String(body.title ?? "").trim();
  let targetLuna: number;
  if (body.itemId !== undefined && body.itemId !== null) {
    // WITH the family id, so the price is the one THIS household pays: getStoreItem applies the
    // per-family override at the read, and the catalogue's own row is a different number. A
    // target priced off the shared row would drift from the shelf the moment a parent re-priced
    // it.
    //
    // ⚠️ IT IS NOT A TENANCY CHECK, and I assumed it was until a test said otherwise.
    // `ITEM_SELECT` joins the override ON the family id but its WHERE is only `s.id=?`, so
    // passing a family id buys the right PRICE and no scoping at all — another household's own
    // item comes back happily. `listStoreItems` adds `(s.family_id IS NULL OR s.family_id=?)`
    // itself, which is exactly the clause missing here. Written out rather than pushed into
    // getStoreItem, because its other callers are write paths that WANT the catalogue's row.
    //
    // 404 rather than 403: a foreign id must stay indistinguishable from one that never existed.
    const item = stickersRepo.getStoreItem(String(body.itemId), fam.id);
    if (!item || (item.family_id !== null && item.family_id !== fam.id)) {
      return c.json({ error: "item_not_found" }, 404);
    }
    itemId = item.id;
    title = title || item.title;
    targetLuna = item.price_luna;
  } else if (body.targetUsd !== undefined) {
    targetLuna = usdToWholeNimLuna(Number(body.targetUsd), await nimUsd());
  } else {
    targetLuna = Math.round(Number(body.targetLuna ?? 0));
  }

  if (!title) return c.json({ error: "title_required" }, 400);
  if (!Number.isFinite(targetLuna) || targetLuna <= 0) return c.json({ error: "invalid_target" }, 400);
  if (targetLuna > MAX_TARGET_LUNA) {
    return c.json({ error: "target_too_large", maxLuna: MAX_TARGET_LUNA }, 400);
  }

  const target = savings.setTarget(fam.id, child.id, {
    title, targetLuna, emoji: emoji || "🎯", itemId,
    titleKey: itemId ? (stickersRepo.getStoreItem(itemId, fam.id)?.title_key ?? null) : null,
  });
  return c.json({ target }, 201);
});

savingsRoutes.patch("/savings/:id", async (c) => {
  const target = savings.getTarget(c.req.param("id"));
  const fam = target ? await familyForSubject(c, target.family_id) : null;
  if (!target || !fam) return c.json({ error: "not_found" }, 404);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;

  const body = await c.req.json().catch(() => ({}));
  const patch: { title?: string; targetLuna?: number; emoji?: string | null } = {};
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (!t) return c.json({ error: "title_required" }, 400);
    patch.title = t;
  }
  if (body.emoji !== undefined) {
    const emoji = readOptionalEmoji(body.emoji);
    if (emoji === null) return c.json(INVALID_EMOJI, 400);
    patch.emoji = emoji;
  }
  if (body.targetLuna !== undefined || body.targetUsd !== undefined) {
    const next = body.targetUsd !== undefined
      ? usdToWholeNimLuna(Number(body.targetUsd), await nimUsd())
      : Math.round(Number(body.targetLuna));
    if (!Number.isFinite(next) || next <= 0) return c.json({ error: "invalid_target" }, 400);
    if (next > MAX_TARGET_LUNA) return c.json({ error: "target_too_large", maxLuna: MAX_TARGET_LUNA }, 400);
    patch.targetLuna = next;
  }
  // ⚠️ `reached_at` is NOT touched here, and raising the target does not un-reach it. The kid
  // got to the old number; that happened. A meter that could retroactively un-happen a moment
  // is the thing #354 says this must never be.
  return c.json({ target: savings.updateTarget(target.id, patch) });
});

savingsRoutes.delete("/kids/:id/savings", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  // Retired, not deleted: what a kid used to be saving for is a real thing that happened, and a
  // reached_at on an abandoned target is a moment worth not destroying.
  return c.json({ cleared: savings.clearTarget(child.id) });
});
