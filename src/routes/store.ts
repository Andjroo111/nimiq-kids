// V3 Treasure Box routes. The Box is its own full-screen world in the kid app;
// categories come from DATA (store_categories) so new shelves (backgrounds,
// characters, sounds, seasonal) appear with zero UI code change. Buying spends
// the kid's REAL NIM back to the family hot wallet ('spend' ledger event,
// reserved since W1 — SIM parity via the provider seam).

import { Hono, type Context } from "hono";
import { requireParent, parentFamilyFrom } from "../auth";
import { approvalPolicy } from "../custody";
import * as repo from "../repo";
import * as approvalsRepo from "../repo-approvals";
import * as lockRepo from "../repo-lock";
import * as routines from "../repo-routines";
import * as stickersRepo from "../repo-stickers";
import { notifyParent } from "../notify";
import { publishLockChange } from "../lock-events";
import {
  availableKidLuna, kidBalanceLuna, kidChainBalanceLuna, kidOutflowRefusal, kidSpendHeld,
} from "../wallet/kid-wallet";
import { attachDebitToPurchase, deferKidSpends, recordDeferredSpend, type KidDebit } from "../kid-netting";
import { childSpendKey, withSpendLock } from "../wallet/spend-lock";
import { eventView } from "./wallet";
import { childMoneyGate, familyForSubject } from "./families";
import { refuseBoardWrite } from "./members";
import { BUDGET_KINDS, CATEGORY_BUDGETS_ENABLED, cleanBudgetKind } from "../category-budget-flag";
import { storeArtUrl } from "../store-art";

export const storeRoutes = new Hono();

/** May this parent bearer write this catalogue row? Their own family's rows, always. A shared
 *  seeded row (family_id NULL) only on a single-household (relaxed) instance — never on a
 *  multi-tenant one, where editing it would reprice or retire it for every other household. */
function canParentEditRow(rowFamilyId: string | null, familyId: string): boolean {
  if (rowFamilyId === familyId) return true;
  if (rowFamilyId === null) return !approvalPolicy().authRequired;
  return false;
}

function parsePayload(item: stickersRepo.StoreItem): Record<string, unknown> {
  try { return JSON.parse(item.payload) as Record<string, unknown>; } catch { return {}; }
}

/**
 * A pack row's ART, for whichever side of the shelf is asking.
 *
 * BOTH the kid's Treasure Box and the parent's shelf manager draw a pack as the fan of
 * its own stickers, so both endpoints have to send them. The parent one did not, and its
 * rows fell all the way through to the generic `ticket` default — a pack's payload
 * carries `packId`, never `icon`, and `cat-stickers` deliberately has `icon: null`
 * because packs draw their own art and were never meant to reach the fallback. The two
 * sides of the same shelf therefore did not look like the same product (#34).
 *
 * `emoji` rides along because it IS the art on a sticker whose PNG has not been
 * generated; without it the fan renders as lettered fallback dots ("M", "S", "G").
 */
function packArt(packId: string) {
  return stickersRepo.packStickers(packId)
    .map((s) => ({ id: s.id, label: s.label, emoji: s.emoji, assetUrl: s.asset_url }));
}

/** The packId a pack item carries in its payload, or null for every other kind. */
function packIdOf(item: stickersRepo.StoreItem, payload: Record<string, unknown>): string | null {
  return item.kind === "pack" ? String(payload.packId ?? "") || null : null;
}

/** Why this tile cannot be bought right now, or null if it can. Not a price and not
 *  ownership — a reason that belongs to the world outside the Box and can change while the
 *  kid is looking at it, which is why it is computed per request rather than per row. */
function unavailableReason(
  item: stickersRepo.StoreItem,
  parentLocked: boolean,
  /** Minutes this kid may still buy TODAY, or null when they have no meter and no cap. */
  earnableLeftMin: number | null,
): string | null {
  // Selling minutes during a grounding is selling nothing: the buy is refused (#301), so the
  // shelf says so first rather than letting a kid tap and be told no.
  if (item.kind === "screen_time" && parentLocked) return "locked_by_parent";
  // Same rule, one day long instead of one grounding long (#377). The buy route refuses over
  // the cap, so the shelf greys it rather than letting a kid save up for something the rule
  // will not let them have.
  //
  // GREYED, not unstocked: this is a fact about the MOMENT, exactly like the grounding above.
  // The cap resets at midnight and a parent can raise it, so the tile has to be able to come
  // back — which is also why the unbuyable 60-minute item is still in the catalogue rather
  // than deleted. Under a 30/day cap it simply never draws; raise the cap and it returns,
  // with no row written and no UI code changed.
  if (item.kind === "screen_time" && earnableLeftMin !== null) {
    const minutes = Math.round(Number(parsePayload(item).minutes ?? 0));
    if (minutes > earnableLeftMin) return "over_daily_cap";
  }
  return null;
}

/**
 * Why this item is not on this household's shelf AT ALL, or null.
 *
 * Distinct from `unavailableReason` above, and the difference is the whole shape of #306: that
 * one greys a tile the kid can still see, because a grounding is a fact about the MOMENT and
 * ends. This one is a fact about the HOUSEHOLD — the goods do not exist here — so the tile is
 * not drawn at all, and the buy route refuses on the same answer rather than a second one.
 */
function unstockedReason(item: stickersRepo.StoreItem, hasTablet: boolean): "no_tablet" | null {
  // Selling minutes to a family with no tablet sells NOTHING. The unlock override a purchase
  // writes is read by exactly one thing in the world — a paired device asking what its screen
  // should do — so with none paired the kid's real NIM bought a minute that cannot exist
  // anywhere. Three of these ship on a shelf visible by default, so it is every family's
  // out-of-the-box state until the day the tablet arrives.
  if (item.kind === "screen_time" && !hasTablet) return "no_tablet";
  return null;
}

function itemView(
  item: stickersRepo.StoreItem, childId: string, parentLocked = false,
  earnableLeftMin: number | null = null,
) {
  const payload = parsePayload(item);
  const packId = packIdOf(item, payload);
  const unavailable = unavailableReason(item, parentLocked, earnableLeftMin);
  return {
    ...(unavailable ? { unavailable } : {}),
    id: item.id, categoryId: item.category_id, kind: item.kind,
    title: item.title, titleKey: item.title_key,
    priceLuna: item.price_luna, payload,
    // The drawn face, or null (#404). Emitted from ONE place so the kid's shelf and the
    // parent's manager cannot disagree about what an item looks like — that drift is #34,
    // and it is written up at the top of this file and in views-store.js.
    artUrl: storeArtUrl(item.kind, payload),
    ...(packId
      ? { packId, owned: stickersRepo.packOwned(childId, packId), stickers: packArt(packId) }
      : {}),
    // #376. An app is owned FOREVER once bought, so the tile has to say so or a kid taps a
    // thing they already have and is told "already_owned" by a toast — a refusal where the
    // shelf should simply have shown the truth. Same shape as the timer styles below.
    ...(item.kind === "app"
      ? { owned: stickersRepo.ownsUnlock(childId, "app", String(payload.pkg ?? "")) }
      : {}),
    ...(item.kind === "timer_style"
      ? { owned: stickersRepo.ownsUnlock(childId, "timer_style", String(payload.styleId ?? "")) }
      : {}),
    // How many of this item the kid is already waiting on a parent for (#121). `owned` is
    // only ever set for `pack` and `timer_style`, so a coupon tile stayed at full price with
    // no sign one was queued and a second buy spent the money again in silence.
    //
    // A count, NOT a block. Two ice cream trips is a real thing for a kid to want, so the
    // fix for a silent second buy is to SAY one is already waiting, not to refuse it. This
    // is a read; the spend path in POST /buy is untouched.
    pendingCount: stickersRepo.pendingPurchaseCount(childId, item.id),
  };
}

/** One bought thing, as both apps render it. `title` and `priceLuna` come from the purchase
 *  row, never from `store_items`: they are snapshots of what was agreed at the moment the
 *  kid spent, and re-joining would let a later rename or repricing rewrite a receipt. */
function purchaseView(p: stickersRepo.KidPurchase) {
  return {
    id: p.id, itemId: p.item_id, kind: p.kind, title: p.title,
    priceLuna: p.price_luna, status: p.status, at: p.created_at,
  };
}

/** The whole Box in one call: ordered categories + items (+ owned flags for packs).
 *  Deliberately NOT money-gated: the catalogue moves no NIM and exposes no balances. */
storeRoutes.get("/kids/:id/store", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  if (!child || !(await familyForSubject(c, child.family_id))) return c.json({ error: "child_not_found" }, 404);
  const parentLocked = lockRepo.parentLockActive(child.family_id, child.id);
  const hasTablet = lockRepo.familyHasDevice(child.family_id);
  // null for an unmetered kid: no budget means no cap, and the shelf behaves as it always did.
  const fam = repo.getFamily(child.family_id);
  const earnableLeftMin = child.daily_screen_min > 0 && fam
    ? Math.max(0, child.max_earned_min
      - Math.round((lockRepo.usageFor(child.id, routines.localDay(fam.tz))?.earned_sec ?? 0) / 60))
    : null;
  return c.json({
    // Every category is still sent. A shelf left with no items renders as nothing at all
    // (`box.js`: `if (!items.length) return ""`), so the screen-time shelf disappears and
    // comes back the day a tablet is paired with no row written and no UI code changed.
    // Retiring the category itself would have been `store_categories.active` — a SHARED
    // seeded row, so that switch reaches every other household on the instance (#288).
    categories: stickersRepo.listCategories(child.family_id)
      .map((cat) => ({
        id: cat.id, title: cat.title, titleKey: cat.title_key, sort: cat.sort, icon: cat.icon,
      })),
    items: stickersRepo.listStoreItems(child.family_id)
      .filter((item) => unstockedReason(item, hasTablet) === null)
      .map((item) => itemView(item, child.id, parentLocked, earnableLeftMin)),
    serverTime: Date.now(),
  });
});

// ---------------------------------------------------------------------------
// Parent-managed catalogue.
//
// The kid side has always read its shelves from data; what was missing was any
// way for a parent to WRITE that data. These five routes are it.
//
// Two rules run through all of them:
//  · Nothing is ever deleted. `kid_purchases.item_id` is a real FK and a
//    purchase must stay readable forever, so hiding is `active=0` — the same
//    treatment a retired sticker or the retired Timers shelf gets.
//  · A parent can only create the two kinds a parent can honour: a `coupon`
//    (which queues in their own approval feed) and `screen_time` (which rides
//    the existing lock-override path). `pack` and `timer_style` belong to the
//    catalogue — they need art and an unlock id that only the code can supply.
// ---------------------------------------------------------------------------

const PARENT_KINDS = ["coupon", "screen_time", "app"] as const;
const MAX_TITLE = 40;
/** Whole NIM in, luna out. A price is a positive integer number of NIM: below 1
 *  the tile shows "0 NIM" and above this a kid could never save for it. */
const NIM = 100_000;
const MAX_NIM = 1_000_000;

const cleanTitle = (v: unknown) => String(v ?? "").trim().slice(0, MAX_TITLE);
const cleanIcon = (v: unknown) => {
  const s = String(v ?? "").trim();
  return /^[a-z0-9-]{1,32}$/.test(s) ? s : null;
};

/**
 * What this kid has bought (#121). The Treasure Box's whole payoff had no receipt.
 *
 * Money-gated like the rest of `/kids/:id/*`: a purchase list is a spending history, and a
 * device that cannot see a kid's balance should not be able to read what they bought either.
 */
storeRoutes.get("/kids/:id/purchases", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  if (!child || !(await familyForSubject(c, child.family_id))) return c.json({ error: "child_not_found" }, 404);
  return c.json({ purchases: stickersRepo.listPurchases(child.id).map(purchaseView) });
});

/** The same history, every kid, for the parent who has to actually hand the prize over. */
storeRoutes.get("/parent/purchases", requireParent, (c) => {
  const fam = parentFamilyFrom(c)!;
  return c.json({
    purchases: stickersRepo.listFamilyPurchases(fam.id).map((p) => ({
      ...purchaseView(p),
      childId: p.child_id,
    })),
  });
});

storeRoutes.get("/parent/store", requireParent, (c) => {
  const fam = parentFamilyFrom(c)!;
  return c.json({
    // RETIRED rows included, deliberately: a parent who hid a shelf needs to
    // see it to bring it back, and it is the only place the retirement shows.
    categories: stickersRepo.listAllCategories(fam.id).map((cat) => ({
      id: cat.id, title: cat.title, titleKey: cat.title_key, sort: cat.sort, icon: cat.icon, active: !!cat.active,
    })),
    items: stickersRepo.listAllStoreItems(fam.id).map((i) => {
      const payload = parsePayload(i);
      const packId = packIdOf(i, payload);
      return {
        id: i.id, categoryId: i.category_id, kind: i.kind, title: i.title, titleKey: i.title_key,
        priceLuna: i.price_luna, active: !!i.active, payload,
        artUrl: storeArtUrl(i.kind, payload),
        // No `owned` here: ownership is a fact about a CHILD, and this endpoint has none.
        ...(packId ? { packId, stickers: packArt(packId) } : {}),
      };
    }),
  });
});

storeRoutes.post("/parent/store/categories", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const body = await c.req.json().catch(() => ({}));
  const title = cleanTitle(body.title);
  if (!title) return c.json({ error: "title_required" }, 400);
  return c.json({ category: stickersRepo.createCategory(title, cleanIcon(body.icon), fam.id) }, 201);
});

storeRoutes.patch("/parent/store/categories/:id", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const cat = stickersRepo.getCategory(String(c.req.param("id") ?? ""));
  if (!cat) return c.json({ error: "not_found" }, 404);
  if (!canParentEditRow(cat.family_id, fam.id)) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const patch: {
    title?: string; icon?: string | null; active?: number; sort?: number; budget_kind?: string | null;
  } = {};
  if (body.title !== undefined) {
    const title = cleanTitle(body.title);
    if (!title) return c.json({ error: "title_required" }, 400);
    patch.title = title;
  }
  if (body.icon !== undefined) patch.icon = cleanIcon(body.icon);
  if (body.active !== undefined) patch.active = body.active ? 1 : 0;
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.round(Number(body.sort));
  // Per-category budgets, slice 1. Refused outright while the flag is off rather than
  // ignored: a silently-dropped field is how a parent comes to believe a shelf is tagged.
  if (body.budgetKind !== undefined) {
    if (!CATEGORY_BUDGETS_ENABLED()) return c.json({ error: "feature_disabled" }, 400);
    const kind = cleanBudgetKind(body.budgetKind);
    if (!kind.ok) return c.json({ error: "budget_kind_invalid", allowed: BUDGET_KINDS }, 400);
    patch.budget_kind = kind.value;
  }
  return c.json({ category: stickersRepo.updateCategory(cat.id, patch) });
});

storeRoutes.post("/parent/store/items", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const body = await c.req.json().catch(() => ({}));
  const kind = String(body.kind ?? "");
  if (!PARENT_KINDS.includes(kind as (typeof PARENT_KINDS)[number])) {
    return c.json({ error: "kind_not_allowed" }, 400);
  }
  const cat = stickersRepo.getCategory(String(body.categoryId ?? ""));
  // The shelf must be one this family can put an item on: the shared catalogue or their own.
  if (!cat || (cat.family_id !== null && cat.family_id !== fam.id)) {
    return c.json({ error: "category_not_found" }, 404);
  }
  const title = cleanTitle(body.title);
  if (!title) return c.json({ error: "title_required" }, 400);
  const nim = Math.round(Number(body.priceNim));
  // FREE IS LEGAL for an app, and it is how "a few free starter picks" happens without a
  // second mechanism: a parent puts three apps on the shelf at 0 and the kid takes them.
  // Everything else still costs at least 1 -- a free coupon or free minutes would be a
  // button, not a purchase, and the Box is not a button rack.
  const minNim = kind === "app" ? 0 : 1;
  if (!Number.isFinite(nim) || nim < minNim || nim > MAX_NIM) return c.json({ error: "bad_price" }, 400);

  const payload: Record<string, unknown> = {};
  const icon = cleanIcon(body.icon);
  if (icon) payload.icon = icon;
  if (kind === "screen_time") {
    const minutes = Math.round(Number(body.minutes));
    // The dial fills to minutes/60 and the lock override runs for exactly this
    // long, so a nonsense value is a nonsense unlock, not just a nonsense icon.
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) return c.json({ error: "bad_minutes" }, 400);
    payload.minutes = minutes;
  }
  if (kind === "app") {
    // #376. The package must be one this household's own tablet has REPORTED INSTALLED.
    //
    // Not politeness about typos: `pkg` ends up in the LockTask allowlist, so a free-text
    // field here is a parent (or anything holding a parent bearer) naming any package on
    // the device — including ones the debloat deliberately removed from the kid's reach,
    // and Settings. The wrapper's own installed-apps report (§5) is the only list that
    // describes what is actually launchable there, so it is the only list this accepts.
    const pkg = String(body.pkg ?? "").trim();
    const installed = new Set(
      lockRepo.listDevices(fam.id).flatMap((d) => {
        try {
          return (JSON.parse(d.installed_apps) as { pkg?: unknown }[])
            .map((entry) => String(entry?.pkg ?? "")).filter(Boolean);
        } catch { return []; }
      }),
    );
    if (!pkg || !installed.has(pkg)) return c.json({ error: "app_not_installed" }, 400);
    payload.pkg = pkg;
  }
  const item = stickersRepo.createStoreItem({
    categoryId: String(body.categoryId), kind: kind as stickersRepo.StoreItemKind,
    title, priceLuna: nim * NIM, payload, familyId: fam.id,
  });
  return c.json({ item }, 201);
});

/**
 * A parent's own price for a shared catalogue row (#288).
 *
 * The row is not theirs to write and must not become theirs: one `store_items` row with
 * `family_id NULL` is what every household on the instance shops, so repricing it there
 * would move the Space pack for strangers. The price goes to `store_item_overrides`
 * instead, and the shelf reads join the two.
 *
 * PRICE ONLY, and loudly so. A catalogue row's name and its art are the catalogue's — a
 * pack's title keys its translations and its `packId` points at the stickers it grants — so
 * a body carrying anything else is a client that thinks it is editing the row it can see.
 *
 * Setting the catalogue's own price WITHDRAWS the override rather than storing a copy of
 * it. That is what "put it back" means, and it hands the row back to the catalogue so a
 * later repricing there reaches this family again.
 */
async function repriceCatalogueItem(c: Context, item: stickersRepo.StoreItem, familyId: string) {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const extra = Object.keys(body).filter((k) => k !== "priceNim" && body[k] !== undefined);
  if (extra.length || body.priceNim === undefined) return c.json({ error: "price_only" }, 400);
  const nim = Math.round(Number(body.priceNim));
  if (!Number.isFinite(nim) || nim < 1 || nim > MAX_NIM) return c.json({ error: "bad_price" }, 400);
  // `item` came from the unscoped read, so this compares against the CATALOGUE's price and
  // not against whatever this family last set.
  if (nim * NIM === item.price_luna) stickersRepo.clearStoreItemPrice(familyId, item.id);
  else stickersRepo.setStoreItemPrice(familyId, item.id, nim * NIM);
  return c.json({ item: stickersRepo.getStoreItem(item.id, familyId) });
}

storeRoutes.patch("/parent/store/items/:id", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const item = stickersRepo.getStoreItem(String(c.req.param("id") ?? ""));
  if (!item) return c.json({ error: "not_found" }, 404);
  if (!canParentEditRow(item.family_id, fam.id)) {
    // Another household's row stays invisible; a SHARED one is on this family's own shelf,
    // so hiding it would be a lie — they can price it, and only price it.
    if (item.family_id !== null) return c.json({ error: "not_found" }, 404);
    return repriceCatalogueItem(c, item, fam.id);
  }
  const body = await c.req.json().catch(() => ({}));
  const patch: Parameters<typeof stickersRepo.updateStoreItem>[1] = {};
  if (body.title !== undefined) {
    const title = cleanTitle(body.title);
    if (!title) return c.json({ error: "title_required" }, 400);
    patch.title = title;
  }
  if (body.priceNim !== undefined) {
    const nim = Math.round(Number(body.priceNim));
    if (!Number.isFinite(nim) || nim < 1 || nim > MAX_NIM) return c.json({ error: "bad_price" }, 400);
    patch.price_luna = nim * NIM;
  }
  if (body.active !== undefined) patch.active = body.active ? 1 : 0;
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) patch.sort = Math.round(Number(body.sort));
  if (body.icon !== undefined) {
    // Merge, never replace: the payload also carries `minutes`, which is the
    // unlock's duration — dropping it would sell an unlock of zero minutes.
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(item.payload) as Record<string, unknown>; } catch { /* {} */ }
    const icon = cleanIcon(body.icon);
    if (icon) payload.icon = icon; else delete payload.icon;
    patch.payload = JSON.stringify(payload);
  }
  return c.json({ item: stickersRepo.updateStoreItem(item.id, patch) });
});

/**
 * Buy: real 'spend' tx kid -> hot wallet, then the goods:
 *  pack        -> stickers granted instantly
 *  screen_time -> today's earned budget for a METERED kid (#377), else the old unlock override
 *  app         -> a permanent kid_unlocks row; the tablet's allowlist is parent-list UNION owned (#376)
 *  coupon      -> a 'coupon' approval-queue row the parent fulfills (reject refunds)
 */
storeRoutes.post("/kids/:id/buy", async (c) => {
  // Money-gated (a buy spends the kid's real NIM). The spend itself stays instant —
  // the coupon kind already queues its fulfilment in the parent approvals feed.
  const gate = await childMoneyGate(c, c.req.param("id"));
  if (!gate.ok) return c.json(gate.body, gate.status);
  const { child, fam } = gate;
  // The Treasure Box is the UNQUEUED outflow (kidSpendLocked), so there is no approval to
  // fail late here — it would simply have spent from an address this server cannot sign for.
  //
  // Unless the instance DEFERS spending, which is the answer to that same problem rather than
  // an exception to it: no key here means no transaction, so the buy records a debit and the
  // next payout the parent signs is minted smaller. See src/kid-netting.ts.
  //
  // HALF of that exemption, though. Deferral answers "there is no KEY here", never "there is
  // no ACCOUNT here": a debit is only ever cleared by a payout to the kid's OWN address, so
  // recording one for a kid whose parent has not registered an address yet writes a debt with
  // nothing in the world that can settle it. That kid is refused either way.
  const deferred = deferKidSpends();
  const refusal = kidOutflowRefusal(child);
  if (refusal && (!deferred || !child.address)) return c.json({ error: refusal }, 409);
  const body = await c.req.json().catch(() => ({}));
  // Family-scoped, so the charge is the price this household set (#288) and not the
  // catalogue's. `createPurchase` snapshots it off the same object, so the receipt agrees
  // with what was actually spent.
  const item = stickersRepo.getStoreItem(String(body.itemId ?? ""), fam.id);
  // The item must be on THIS kid's shelf: the shared catalogue or their own family's — never
  // another household's, whose price a stranger could have set.
  if (!item || !item.active || (item.family_id !== null && item.family_id !== fam.id)) {
    return c.json({ error: "item_not_found" }, 404);
  }
  const payload = parsePayload(item);

  // Shape of the goods — cheap, decided before anything is held.
  const packId = item.kind === "pack" ? String(payload.packId ?? "") : "";
  const styleId = item.kind === "timer_style" ? String(payload.styleId ?? "") : "";
  const minutes = item.kind === "screen_time" ? Math.round(Number(payload.minutes ?? 0)) : 0;
  const appPkg = item.kind === "app" ? String(payload.pkg ?? "").trim() : "";
  // A shelf row with no package buys a permission to launch nothing. Refused before the
  // charge rather than after: an "app" the kid owns and cannot open is worse than a 400.
  if (item.kind === "app" && !appPkg) return c.json({ error: "bad_item" }, 400);
  if (item.kind === "pack" && !stickersRepo.getPack(packId)) return c.json({ error: "item_not_found" }, 404);
  if (item.kind === "timer_style" && !stickersRepo.TIMER_STYLE_IDS.includes(styleId)) {
    return c.json({ error: "item_not_found" }, 404);
  }
  if (item.kind === "screen_time" && (!Number.isFinite(minutes) || minutes <= 0)) {
    return c.json({ error: "item_not_found" }, 404);
  }

  /**
   * ONE HOLD OF THE CHILD'S SPEND LOCK COVERS THE OWNERSHIP TEST, THE CHARGE AND THE GRANT.
   *
   * Reproduced on mainnet with real NIM (#129): three simultaneous buys of the same 2,000 NIM
   * sticker pack answered 200/200/400, moved 4,000 NIM in two separate on-chain transactions,
   * and left the kid owning exactly one pack. 2,000 NIM of a child's real money, gone, and the
   * second payment bought nothing.
   *
   * The lock was not broken. `kidSpend` took it and serialised the two debits perfectly — but
   * the ownership test sat OUTSIDE it, so both callers had already passed "do you own this?"
   * before either had charged, and each debit was individually affordable. A lock only
   * protects the invariant it is wrapped around, and this one was wrapped around the balance
   * while the invariant that mattered was "at most one of these exists".
   *
   * Same fix, same reason as the chore approve path re-reading chore status under its lock
   * (routes/chores.ts). Note `kidSpendHeld`, not `kidSpend`: withSpendLock is not re-entrant.
   *
   * `screen_time` and `coupon` are unaffected in kind — buying two of those genuinely gives
   * you two — but they ride the same span, which costs nothing and keeps one shape here.
   */
  return withSpendLock(childSpendKey(child.id), async (): Promise<Response> => {
    if (item.kind === "pack" && stickersRepo.packOwned(child.id, packId)) {
      return c.json({ error: "already_owned" }, 400);
    }
    if (item.kind === "timer_style" && stickersRepo.ownsUnlock(child.id, "timer_style", styleId)) {
      return c.json({ error: "already_owned" }, 400);
    }
    if (item.kind === "app" && stickersRepo.ownsUnlock(child.id, "app", appPkg)) {
      return c.json({ error: "already_owned" }, 400);
    }
    // A grounding is not for sale (#301). Refused BEFORE the charge, never refunded after:
    // a buy that succeeds and is then unwound has already told the kid the punishment is
    // over, and no amount of money coming back takes that back. Read under the spend lock
    // with the other invariants a second actor can flip, so the window between "is the
    // parent still holding this shut" and the debit is as narrow as the ownership test's.
    if (item.kind === "screen_time" && lockRepo.parentLockActive(fam.id, child.id)) {
      return c.json({ error: "locked_by_parent" }, 409);
    }
    // Belt and braces for the shelf filter above (#306): the tile is not drawn, but a client
    // holding a store read from before the tablet was unpaired can still ask. Refused here,
    // under the same lock and before the charge, for the same reason the grounding is — an
    // unlock nothing can obey is not a thing to take a child's money for and refund later.
    if (unstockedReason(item, lockRepo.familyHasDevice(fam.id))) {
      return c.json({ error: "no_tablet" }, 409);
    }

    let event = null;
    let debit: KidDebit | null = null;
    try {
      if (deferred) {
        // Same affordability question the on-chain path asks inside `kidSpendHeld`, and it has
        // to be asked here too: `recordDeferredSpend` knows about debt but not about value
        // that is merely in flight (a pending stake, an approved-but-unsettled send), and a
        // kid must not be able to buy with NIM that is already on its way out.
        const fresh = repo.getChild(child.id)!;
        if (await availableKidLuna(fresh) < item.price_luna) {
          return c.json({ error: "insufficient_funds" }, 400);
        }
        // Rule 3 is checked against the RAW balance inside recordDeferredSpend, which is why
        // the raw read is the one passed in. A coupon is `refundable` because the parent can
        // still refuse it, and that keeps its debt out of reach of a payout until they don't.
        debit = recordDeferredSpend({
          familyId: fam.id, childId: child.id, valueLuna: item.price_luna,
          chainBalanceLuna: await kidChainBalanceLuna(fresh),
          message: item.title, refundable: item.kind === "coupon",
        });
      } else {
        event = await kidSpendHeld(fam, child.id, item.price_luna, item.title);
      }
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      return c.json({ error: msg }, msg === "insufficient_funds" || msg === "invalid_value" ? 400 : 502);
    }

    const balanceLuna = await kidBalanceLuna(repo.getChild(child.id)!);
    // `event` is null for a deferred buy, because nothing moved and wallet_events records only
    // what did. The kid app reads neither field (it refetches the wallet), so this stays the
    // same response shape rather than a second one.
    const base = { event: event ? eventView(event) : null, balanceLuna, deferred };

    /** The receipt, plus the link back from the debit that paid for it. Written after the
     *  charge — a failed charge must leave no receipt — so the debit learns what it bought
     *  one line later. That link is what tells a later refund which world to undo. */
    const receipt = (status: stickersRepo.KidPurchase["status"], overrideId: string | null = null) => {
      const p = stickersRepo.createPurchase(fam.id, child.id, item, status, overrideId);
      if (debit) attachDebitToPurchase(debit.id, p.id);
      return p;
    };

    if (item.kind === "pack") {
      const stickers = stickersRepo.grantPack(child.id, packId);
      receipt("done");
      return c.json({
        ...base, kind: "pack",
        stickers: stickers.map((s) => ({ id: s.id, packId: s.pack_id, label: s.label, assetUrl: s.asset_url, kind: s.kind })),
      });
    }

    if (item.kind === "timer_style") {
      // Earned, not free: the unlock is what the studio Timer sheet + prefs gate check.
      stickersRepo.grantUnlock(child.id, "timer_style", styleId);
      receipt("done");
      return c.json({ ...base, kind: "timer_style", styleId });
    }

    if (item.kind === "app") {
      // #376. An app a kid bought is OWNED, permanently, and that ownership lives in
      // `kid_unlocks` rather than in the tablet's `allowed_apps` column.
      //
      // The difference is the whole design. `allowed_apps` is the PARENT'S list, edited from
      // their phone, replaced wholesale on every save -- so writing a purchase into it means
      // the next time a grown-up ticks a box, a kid's real NIM quietly evaporates. Ownership
      // is the kid's, the allowlist is the parent's, and the tablet is handed the UNION of
      // the two (see deviceStateCore). Neither side can erase the other.
      stickersRepo.grantUnlock(child.id, "app", appPkg);
      receipt("done");
      publishLockChange(); // the grid is allowlist-driven: this makes the icon appear now
      return c.json({ ...base, kind: "app", pkg: appPkg });
    }

    if (item.kind === "screen_time") {
      // A METERED kid buys BUDGET, not an unlock (#377). The difference matters: an unlock
      // override outranks the curfew, so under the old shape a kid could buy their way past
      // bedtime, and minutes bought at 19:55 were mostly spent on being asleep. Added to
      // today's `earned_sec` instead, they are minutes of ALLOWANCE — usable inside their
      // hours, worthless outside them, and gone at midnight like the rest of the day's.
      //
      // An UNMETERED kid keeps the old override exactly. There is no budget to add to, so
      // the shelf would otherwise take their money and hand back nothing at all.
      const child2 = repo.getChild(child.id)!;
      if (child2.daily_screen_min > 0) {
        const day = routines.localDay(fam.tz);
        const before = lockRepo.usageFor(child.id, day);
        const earnedMin = Math.round((before?.earned_sec ?? 0) / 60);
        // The cap is the rule; the price is only what makes it cost something. Refused
        // BEFORE the charge, never refunded after — the same reason a grounding is.
        if (earnedMin + minutes > child2.max_earned_min) {
          return c.json({ error: "earned_cap_reached", maxEarnedMin: child2.max_earned_min, earnedMin }, 409);
        }
        const usage = lockRepo.addEarnedSec(child.id, day, minutes * 60);
        receipt("done");
        publishLockChange();
        return c.json({ ...base, kind: "screen_time", minutes, earnedSec: usage.earned_sec });
      }
      // Bought minutes STACK onto whatever is already running (#302) and are stamped as the
      // kid's own, so they can never outrank a parent (#301). Both live in repo-lock.
      const override = lockRepo.extendPurchasedUnlock(fam.id, child.id, minutes);
      receipt("done", override.id);
      publishLockChange();
      return c.json({ ...base, kind: "screen_time", minutes, override });
    }

    // coupon: the parent makes it real — queue it in the approvals feed.
    const purchase = receipt("pending_parent");
    const approval = approvalsRepo.openApproval(fam.id, child.id, "coupon", purchase.id);
    stickersRepo.setPurchaseStatus(purchase.id, "pending_parent", approval.id);
    notifyParent(fam, {
      title: `${child.emoji} ${child.label} bought a prize: ${item.title}`,
      body: `${(item.price_luna / 1e5).toFixed(2)} NIM paid from their wallet. Make it happen!`,
      clickUrl: process.env.PARENT_URL ? `${process.env.PARENT_URL}#approval=${approval.id}` : undefined,
      tags: "gift",
    });
    publishLockChange();
    return c.json({ ...base, kind: "coupon", approvalId: approval.id, purchaseId: purchase.id });
  });
});
