// V3 sticker chore chart data layer: packs, stickers, ownership, placements
// (position + tilt persist — the chart is the kid's own artifact), and the
// Treasure Box catalog (categories + items + real-NIM purchases).
// Same conventions as repo.ts — pure functions over getDb(), no HTTP.

import { getDb } from "./db";
import { STICKER_PACKS } from "./sticker-catalog";

export type StickerKind = "art" | "photo";
export type PlacementState = "pending" | "shined" | "retry";
export type PlacementSubject = "routine_task_run" | "chore" | "practice_session";
export type StoreItemKind = "pack" | "screen_time" | "coupon" | "timer_style" | "app";
export type PurchaseStatus = "done" | "pending_parent" | "fulfilled" | "refunded";

export interface StickerPack {
  id: string; title: string; title_key: string | null; price_luna: number; active: number; sort: number;
  /** 1 = a goal-ladder theme: earned by climbing, never on the shelf at any price. */
  theme: number;
}
export interface Sticker {
  id: string; pack_id: string | null; child_id: string | null;
  label: string; emoji: string | null; asset_url: string | null; kind: StickerKind;
  /** 1 = the prize at the end of a theme, granted when every other sticker in it is owned. */
  is_boss: number;
  created_at: number;
}
export interface StickerPlacement {
  id: string; child_id: string; subject_kind: PlacementSubject; subject_id: string;
  day: string; sticker_id: string; x_pct: number; y_pct: number; tilt_deg: number;
  state: PlacementState; created_at: number;
}
export interface StoreCategory {
  id: string; title: string; title_key: string | null; sort: number; active: number;
  /** Glyph name (public/kid/js/icons.js GLYPHS) — the face every item on this
   *  shelf falls back to, so a parent-created shelf is never faceless. */
  icon: string | null;
  parent_edited: number;
  /** NULL = shared seeded catalogue; a family id = that one family's own shelf. */
  family_id: string | null;
  /** Which time budget this shelf's apps draw on: NULL | 'utility' | 'learning' | 'games'.
   *  Descriptive only — nothing reads it yet. See docs/CATEGORY-TIME-BUDGETS.md. */
  budget_kind: string | null;
}
export interface StoreItem {
  id: string; category_id: string | null; kind: StoreItemKind; title: string; title_key: string | null;
  price_luna: number; payload: string; active: number; sort: number;
  parent_edited: number;
  /** NULL = shared seeded catalogue; a family id = that one family's own item. */
  family_id: string | null;
}
export interface KidPurchase {
  id: string; family_id: string; child_id: string; item_id: string; kind: StoreItemKind;
  title: string; price_luna: number; payload: string; status: PurchaseStatus;
  ref_id: string | null; created_at: number;
}

const uid = () => crypto.randomUUID();
const now = () => Date.now();

// ---- packs + stickers ----
export function listPacks(): StickerPack[] {
  return getDb().query("SELECT * FROM sticker_packs WHERE active=1 ORDER BY sort").all() as StickerPack[];
}
export function getPack(id: string): StickerPack | null {
  return (getDb().query("SELECT * FROM sticker_packs WHERE id=?").get(id) as StickerPack) ?? null;
}
export function getSticker(id: string): Sticker | null {
  return (getDb().query("SELECT * FROM stickers WHERE id=?").get(id) as Sticker) ?? null;
}
export function packStickers(packId: string): Sticker[] {
  return getDb().query("SELECT * FROM stickers WHERE pack_id=? ORDER BY rowid").all(packId) as Sticker[];
}

// ---- ownership ----
export function grantSticker(childId: string, stickerId: string): void {
  getDb().run(
    "INSERT OR IGNORE INTO kid_stickers (child_id, sticker_id, created_at) VALUES (?,?,?)",
    [childId, stickerId, now()],
  );
}
/** Grant every sticker in a pack. Returns the pack's stickers (idempotent). */
export function grantPack(childId: string, packId: string): Sticker[] {
  const stickers = packStickers(packId);
  for (const s of stickers) grantSticker(childId, s.id);
  return stickers;
}
export function ownsSticker(childId: string, stickerId: string): boolean {
  return !!getDb().query("SELECT 1 FROM kid_stickers WHERE child_id=? AND sticker_id=?").get(childId, stickerId);
}
/** True when the kid owns EVERY sticker of a non-empty pack. */
export function packOwned(childId: string, packId: string): boolean {
  const row = getDb().query(
    `SELECT COUNT(*) AS total,
            SUM(EXISTS(SELECT 1 FROM kid_stickers k WHERE k.child_id=? AND k.sticker_id=s.id)) AS owned
       FROM stickers s WHERE s.pack_id=?`,
  ).get(childId, packId) as { total: number; owned: number | null };
  return row.total > 0 && row.owned === row.total;
}
/**
 * The kid's USABLE collection, newest grants last (stable picker order).
 *
 * ⚠️ A THEME'S STICKERS ARE COLLECTED LONG BEFORE THEY ARE USABLE. A dragon earned on rung
 * two sits in `kid_stickers` from that moment — it has to, or there would be nowhere to
 * record the collecting — but it may not be placed on a job until the whole set is finished
 * (Andjroo, 2026-08-04). That is the entire pull of the feature, so the rule lives HERE, in
 * the one function every picker and every inventory read goes through, rather than at the
 * call sites. A rule written at three call sites is a rule that holds at two of them.
 *
 * `collectedStickers()` below is the other half: what the ladder's own trophy row draws.
 */
export function ownedStickers(childId: string): Sticker[] {
  return getDb().query(
    `SELECT s.* FROM kid_stickers k JOIN stickers s ON s.id = k.sticker_id
      WHERE k.child_id=?
        AND (s.pack_id IS NULL
             OR NOT EXISTS (SELECT 1 FROM sticker_packs p WHERE p.id = s.pack_id AND p.theme = 1)
             OR NOT EXISTS (
               SELECT 1 FROM stickers t
                WHERE t.pack_id = s.pack_id AND t.is_boss = 0
                  AND NOT EXISTS (SELECT 1 FROM kid_stickers k2
                                   WHERE k2.child_id = k.child_id AND k2.sticker_id = t.id)))
      ORDER BY k.created_at, k.rowid`,
  ).all(childId) as Sticker[];
}

/** Every sticker of a pack the kid has actually earned, usable or not — the trophy row on a
 *  ladder card, which has to show the set filling up before it is finished. */
export function collectedStickers(childId: string, packId: string): Sticker[] {
  return getDb().query(
    `SELECT s.* FROM kid_stickers k JOIN stickers s ON s.id = k.sticker_id
      WHERE k.child_id=? AND s.pack_id=? ORDER BY s.is_boss, s.rowid`,
  ).all(childId, packId) as Sticker[];
}

// ---- goal-ladder themes (Andjroo, 2026-08-04) ----
//
// A theme is a set of five plus a boss, collected ONE PER RUNG across as many ladders as it
// takes. The collection is the unit, not the ladder: a three-rung ladder hands over three
// dragons and a two-rung one finishes them. Completing the five grants the boss and releases
// the whole pack into `ownedStickers` at once.

/** The packs a goal ladder can collect toward. */
export function listThemePacks(): StickerPack[] {
  return getDb().query("SELECT * FROM sticker_packs WHERE theme=1 AND active=1 ORDER BY sort")
    .all() as StickerPack[];
}
export function isThemePack(packId: string): boolean {
  return !!getDb().query("SELECT 1 FROM sticker_packs WHERE id=? AND theme=1 AND active=1").get(packId);
}

/** The stickers of a theme in collection order, boss last. */
export function packRungStickers(packId: string): Sticker[] {
  return getDb().query(
    "SELECT * FROM stickers WHERE pack_id=? AND is_boss=0 ORDER BY rowid",
  ).all(packId) as Sticker[];
}
export function packBoss(packId: string): Sticker | null {
  return (getDb().query("SELECT * FROM stickers WHERE pack_id=? AND is_boss=1 ORDER BY rowid LIMIT 1")
    .get(packId) as Sticker) ?? null;
}

/** Does the kid own every NON-BOSS sticker of this pack? The boss is excluded on purpose:
 *  a set that included its own prize could never be finished. */
export function packComplete(childId: string, packId: string): boolean {
  const row = getDb().query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(EXISTS(SELECT 1 FROM kid_stickers k
                                 WHERE k.child_id=? AND k.sticker_id=s.id)), 0) AS owned
       FROM stickers s WHERE s.pack_id=? AND s.is_boss=0`,
  ).get(childId, packId) as { total: number; owned: number };
  return row.total > 0 && row.owned === row.total;
}

/**
 * Hand over the next sticker of a theme the kid does not have yet, and the boss if that
 * finished the set.
 *
 * Deterministic and idempotent-ish by construction: it always takes the FIRST unowned row in
 * pack order, so the arc a set is authored in (egg, hatchling, young, firebreather, winged) is
 * the order a kid meets it in, whichever ladder they happen to be climbing.
 *
 * Returns what was granted so the caller can say so on screen. `{}` when the set was already
 * complete — a rung climbed after that still pays its NIM, it just has nothing left to give.
 */
export function grantNextThemeSticker(
  childId: string, packId: string,
): { sticker?: Sticker; boss?: Sticker; complete: boolean } {
  if (packComplete(childId, packId)) return { complete: true };
  const next = packRungStickers(packId).find((s) => !ownsSticker(childId, s.id));
  if (!next) return { complete: true };
  grantSticker(childId, next.id);
  if (!packComplete(childId, packId)) return { sticker: next, complete: false };
  // That was the last one. The boss lands with it, and the whole set becomes usable.
  const boss = packBoss(packId);
  if (boss) grantSticker(childId, boss.id);
  return { sticker: next, boss: boss ?? undefined, complete: true };
}

/**
 * The app WALLPAPERS this kid has unlocked: one per theme they have FINISHED.
 *
 * ⚠️ Finishing a set hands over TWO separate things (Andjroo, 2026-08-04) — the boss sticker,
 * and this. Read off `packComplete` rather than stored in `kid_unlocks`, for the reason
 * `rungState` reads its approval: the collection already knows whether the set is done, and a
 * second place to write "finished" is a second place for it to disagree.
 *
 * A pack with no `backgroundIds` in the catalogue simply unlocks nothing, so a theme can ship
 * its stickers before its wallpaper is drawn. A pack may name MORE THAN ONE, in which case
 * finishing it hands over all of them at once — robots ships three (Andjroo, 2026-08-06).
 */
export function unlockedBackgrounds(childId: string): { id: string; url: string }[] {
  return STICKER_PACKS
    .filter((p) => p.theme && p.backgroundIds?.length && packComplete(childId, p.id))
    .flatMap((p) => p.backgroundIds!.map((id) => ({ id, url: `/assets/backgrounds/${id}.jpg` })));
}

/** Is this wallpaper one the kid may actually choose? The PUT's own answer, never the client's. */
export function ownsBackground(childId: string, backgroundId: string): boolean {
  return unlockedBackgrounds(childId).some((b) => b.id === backgroundId);
}

/** How a theme is going for this kid: what the ladder card draws. */
export function themeProgress(childId: string, packId: string) {
  const rungStickers = packRungStickers(packId);
  const owned = rungStickers.filter((s) => ownsSticker(childId, s.id));
  const boss = packBoss(packId);
  return {
    packId,
    collected: owned.length,
    total: rungStickers.length,
    complete: rungStickers.length > 0 && owned.length === rungStickers.length,
    /** Every sticker of the set with whether it is earned yet — an empty slot is the point. */
    slots: rungStickers.map((s) => ({
      id: s.id, label: s.label, emoji: s.emoji, assetUrl: s.asset_url,
      owned: owned.some((o) => o.id === s.id),
    })),
    boss: boss
      ? { id: boss.id, label: boss.label, emoji: boss.emoji, assetUrl: boss.asset_url,
          owned: ownsSticker(childId, boss.id) }
      : null,
  };
}
/** Starter pack auto-grant (first chart/inventory read). Idempotent. */
export function ensureStarterGrant(childId: string): void {
  grantPack(childId, "pack-starter");
}

// ---- non-sticker ownership (kid_unlocks: timer styles today; future Box kinds reuse it) ----
/** Purchasable timer styles. 'egg' is the free default and is never sold. */
export const TIMER_STYLE_IDS = ["maker", "polaroid"];

export function grantUnlock(childId: string, kind: string, refId: string): void {
  getDb().run(
    "INSERT OR IGNORE INTO kid_unlocks (child_id, kind, ref_id, created_at) VALUES (?,?,?,?)",
    [childId, kind, refId, now()],
  );
}
export function ownsUnlock(childId: string, kind: string, refId: string): boolean {
  return !!getDb().query("SELECT 1 FROM kid_unlocks WHERE child_id=? AND kind=? AND ref_id=?")
    .get(childId, kind, refId);
}
/**
 * Every ref_id this kid owns of one kind. The list form of `ownsUnlock`, and what the app
 * shelf needs: an OWNED APP is a package name, and there is no fixed catalogue of those to
 * filter against the way `ownedTimerStyles` filters TIMER_STYLE_IDS -- the packages come
 * from whatever is installed on that household's tablet.
 */
export function listUnlocks(childId: string, kind: string): string[] {
  return (getDb().query(
    "SELECT ref_id FROM kid_unlocks WHERE child_id=? AND kind=? ORDER BY created_at, ref_id",
  ).all(childId, kind) as { ref_id: string }[]).map((r) => r.ref_id);
}

/** The kid's equippable timer styles: the free egg + every purchased style. */
export function ownedTimerStyles(childId: string): string[] {
  return ["egg", ...TIMER_STYLE_IDS.filter((s) => ownsUnlock(childId, "timer_style", s))];
}

// ---- photo stickers (camera tile in the picker) ----
export function createPhotoSticker(childId: string, assetUrl: string, label = "My photo"): Sticker {
  // A photo sticker IS its image — the only kind that still carries an asset_url. Since #282
  // that column holds a `local:<uuid>` HANDLE, not a URL: the picture is in the tablet's
  // IndexedDB and this row is the only part of it the server is allowed to know.
  const s: Sticker = {
    id: uid(), pack_id: null, child_id: childId, label, emoji: null, asset_url: assetUrl,
    // A kid's own photo is never a theme's prize, so it is never the boss.
    kind: "photo", is_boss: 0, created_at: now(),
  };
  getDb().run(
    "INSERT INTO stickers (id, pack_id, child_id, label, asset_url, kind, created_at) VALUES (?,?,?,?,?,?,?)",
    [s.id, s.pack_id, s.child_id, s.label, s.asset_url, s.kind, s.created_at],
  );
  grantSticker(childId, s.id);
  return s;
}

// ---- placements ----
export interface PlacementInput {
  childId: string; subjectKind: PlacementSubject; subjectId: string; day: string;
  stickerId: string; xPct: number; yPct: number; tiltDeg: number; state: PlacementState;
}
/** Upsert — re-placing moves the sticker (position/tilt/sticker refresh, id stable). */
export function placeSticker(p: PlacementInput): StickerPlacement {
  const db = getDb();
  const existing = getPlacement(p.subjectKind, p.subjectId);
  if (existing) {
    db.run(
      "UPDATE sticker_placements SET sticker_id=?, x_pct=?, y_pct=?, tilt_deg=?, state=?, day=? WHERE id=?",
      [p.stickerId, p.xPct, p.yPct, p.tiltDeg, p.state, p.day, existing.id],
    );
    return getPlacement(p.subjectKind, p.subjectId)!;
  }
  const row: StickerPlacement = {
    id: uid(), child_id: p.childId, subject_kind: p.subjectKind, subject_id: p.subjectId,
    day: p.day, sticker_id: p.stickerId, x_pct: p.xPct, y_pct: p.yPct, tilt_deg: p.tiltDeg,
    state: p.state, created_at: now(),
  };
  db.run(
    `INSERT INTO sticker_placements (id, child_id, subject_kind, subject_id, day, sticker_id, x_pct, y_pct, tilt_deg, state, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.child_id, row.subject_kind, row.subject_id, row.day, row.sticker_id,
     row.x_pct, row.y_pct, row.tilt_deg, row.state, row.created_at],
  );
  return row;
}
/**
 * The earliest day this child has ANYTHING the calendar can draw, or null if they have
 * nothing yet. It is what bounds the calendar's back arrow.
 *
 * The three tables are exactly the three `chartRows` reads a day out of — a routine run, a
 * practice session, and a sticker placement (which is also what carries a chore onto a date,
 * since a chore row has no day of its own). All three carry `child_id`, so this is one scan
 * and it cannot drift from the grid by being computed somewhere else.
 *
 * ⚠️ NOT the child's `created_at`. A demo family is minted today and seeded four weeks of
 * history behind it (`src/demo-past.ts`), so a created_at bound would grey out the back arrow
 * on exactly the trail the demo exists to show.
 */
export function firstActivityDay(childId: string): string | null {
  const row = getDb().query(
    `SELECT MIN(day) AS day FROM (
       SELECT day FROM sticker_placements WHERE child_id=?
       UNION ALL SELECT day FROM routine_runs      WHERE child_id=?
       UNION ALL SELECT day FROM practice_sessions WHERE child_id=?
     )`,
  ).get(childId, childId, childId) as { day: string | null } | null;
  return row?.day ?? null;
}

/**
 * Every day in [from, to] this child left ANY trace in the app.
 *
 * Same three tables as `firstActivityDay` above, and deliberately the same three, so the two
 * cannot drift into disagreeing about what counts as a day this child was here. A routine run
 * is the loosest of them and that is the point: a run exists the moment the board is OPENED,
 * so it answers "somebody picked up the tablet as this kid", which is exactly the question.
 *
 * Written for `weekStreak`, which needs to tell a week the kid fell short from a week the kid
 * was not in the house at all (see repo-practices).
 */
export function activeDays(childId: string, from: string, to: string): Set<string> {
  const rows = getDb().query(
    `SELECT DISTINCT day FROM (
       SELECT day FROM sticker_placements WHERE child_id=? AND day BETWEEN ? AND ?
       UNION ALL SELECT day FROM routine_runs      WHERE child_id=? AND day BETWEEN ? AND ?
       UNION ALL SELECT day FROM practice_sessions WHERE child_id=? AND day BETWEEN ? AND ?
     )`,
  ).all(childId, from, to, childId, from, to, childId, from, to) as { day: string }[];
  return new Set(rows.map((r) => r.day));
}

export function getPlacement(subjectKind: PlacementSubject, subjectId: string): StickerPlacement | null {
  return (getDb().query("SELECT * FROM sticker_placements WHERE subject_kind=? AND subject_id=?")
    .get(subjectKind, subjectId) as StickerPlacement) ?? null;
}
export function placementsForDays(childId: string, days: string[]): StickerPlacement[] {
  if (!days.length) return [];
  const qs = days.map(() => "?").join(",");
  return getDb().query(
    `SELECT * FROM sticker_placements WHERE child_id=? AND day IN (${qs}) ORDER BY created_at`,
  ).all(childId, ...days) as StickerPlacement[];
}

// ---- approval hooks: shine / retry / resubmit ----
/** All placements of a routine run's task_runs -> state (approve: shined, reject: retry). */
export function setRunPlacementsState(runId: string, state: PlacementState): void {
  getDb().run(
    `UPDATE sticker_placements SET state=? WHERE subject_kind='routine_task_run'
       AND subject_id IN (SELECT id FROM task_runs WHERE run_id=?)`,
    [state, runId],
  );
}
/** Resubmit after a reject: grey 'retry' stickers go back to hopeful 'pending'. */
export function resetRetryRunPlacements(runId: string): void {
  getDb().run(
    `UPDATE sticker_placements SET state='pending' WHERE state='retry' AND subject_kind='routine_task_run'
       AND subject_id IN (SELECT id FROM task_runs WHERE run_id=?)`,
    [runId],
  );
}
export function setChorePlacementState(choreId: string, state: PlacementState): void {
  getDb().run("UPDATE sticker_placements SET state=? WHERE subject_kind='chore' AND subject_id=?", [state, choreId]);
}
export function resetRetryChorePlacement(choreId: string): void {
  getDb().run(
    "UPDATE sticker_placements SET state='pending' WHERE state='retry' AND subject_kind='chore' AND subject_id=?",
    [choreId],
  );
}

// ---- Treasure Box catalog ----
// Every read is scoped: the shared seeded catalogue (family_id IS NULL) plus, when a family
// is given, that one family's own rows. A parent bearer for household A can therefore never
// see or shop household B's parent-created items.
export function listCategories(familyId: string): StoreCategory[] {
  return getDb().query("SELECT * FROM store_categories WHERE active=1 AND (family_id IS NULL OR family_id=?) ORDER BY sort")
    .all(familyId) as StoreCategory[];
}
/**
 * A shelf row wearing THIS family's price.
 *
 * The seeded catalogue is one shared set of rows (`family_id IS NULL`) that every household
 * reads, so a family's own price for one of them lives in `store_item_overrides` instead.
 * Joining it in here rather than at the call sites is the point: the Box, the buy sheet and
 * the charge itself all go through these reads, and a price that is corrected in only two of
 * the three is how a pack comes to display one number and charge another.
 *
 * The column list is spelled out rather than `SELECT *` because `COALESCE(...) AS price_luna`
 * next to a star would return the name twice and leave which one wins up to the driver.
 * `?` is the family id.
 */
const ITEM_SELECT = `SELECT s.id, s.category_id, s.kind, s.title, s.title_key,
    COALESCE(o.price_luna, s.price_luna) AS price_luna,
    s.payload, s.active, s.sort, s.parent_edited, s.family_id
  FROM store_items s
  LEFT JOIN store_item_overrides o ON o.item_id = s.id AND o.family_id = ? AND o.active = 1`;

export function listStoreItems(familyId: string): StoreItem[] {
  return getDb().query(`${ITEM_SELECT}
    WHERE s.active=1 AND (s.family_id IS NULL OR s.family_id=?) ORDER BY s.sort, s.rowid`)
    .all(familyId, familyId) as StoreItem[];
}
/** Without a family this is the catalogue's own row, which is what a write path wants: the
 *  price to compare an override against, and the row `updateStoreItem` is about to touch. */
export function getStoreItem(id: string, familyId?: string): StoreItem | null {
  const db = getDb();
  const row = familyId === undefined
    ? db.query("SELECT * FROM store_items WHERE id=?").get(id)
    : db.query(`${ITEM_SELECT} WHERE s.id=?`).get(familyId, id);
  return (row as StoreItem) ?? null;
}
export function getCategory(id: string): StoreCategory | null {
  return (getDb().query("SELECT * FROM store_categories WHERE id=?").get(id) as StoreCategory) ?? null;
}

// ---- parent-managed catalog (the manage screen shows RETIRED rows too) ----
export function listAllCategories(familyId: string): StoreCategory[] {
  return getDb().query("SELECT * FROM store_categories WHERE (family_id IS NULL OR family_id=?) ORDER BY sort, rowid")
    .all(familyId) as StoreCategory[];
}
export function listAllStoreItems(familyId: string): StoreItem[] {
  return getDb().query(`${ITEM_SELECT}
    WHERE (s.family_id IS NULL OR s.family_id=?) ORDER BY s.sort, s.rowid`)
    .all(familyId, familyId) as StoreItem[];
}

/**
 * This family's own price for a catalogue row they cannot write.
 *
 * `setStoreItemPrice` is an upsert on (family_id, item_id) — one price per household per
 * item, never a stack of them. `clearStoreItemPrice` withdraws it by flipping `active` off
 * rather than deleting: the same rule the shelves run on, and it leaves the catalogue free
 * to move that price again for a family that has stopped setting their own.
 */
export function setStoreItemPrice(familyId: string, itemId: string, priceLuna: number): void {
  getDb().run(
    `INSERT INTO store_item_overrides (family_id, item_id, price_luna, active) VALUES (?,?,?,1)
     ON CONFLICT(family_id, item_id) DO UPDATE SET price_luna=excluded.price_luna, active=1`,
    [familyId, itemId, priceLuna],
  );
}
export function clearStoreItemPrice(familyId: string, itemId: string): void {
  getDb().run("UPDATE store_item_overrides SET active=0 WHERE family_id=? AND item_id=?", [familyId, itemId]);
}

/** A parent-made shelf. `cat-` prefixed like the seeded ones, but with a uuid
 *  tail so it can never collide with a catalogue id and get overwritten at boot. */
export function createCategory(title: string, icon: string | null, familyId: string): StoreCategory {
  const db = getDb();
  const next = (db.query("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM store_categories")
    .get() as { n: number }).n;
  // `title_key: null` is the whole point of a parent-made shelf: they named it,
  // so it renders as they named it in every language.
  const row: StoreCategory = {
    id: `cat-${uid()}`, title, title_key: null, sort: next, active: 1, icon, parent_edited: 1, family_id: familyId,
    // A new shelf is untagged. The INSERT below leaves the column out entirely, so this
    // mirrors what the row actually is rather than claiming a taxonomy nobody chose.
    budget_kind: null,
  };
  db.run(
    "INSERT INTO store_categories (id, title, sort, active, icon, parent_edited, family_id) VALUES (?,?,?,1,?,1,?)",
    [row.id, row.title, row.sort, row.icon, row.family_id],
  );
  return row;
}

/** Every write marks the row `parent_edited`, which is what stops
 *  syncStickerCatalog() re-applying the catalogue over it at the next boot. */
export function updateCategory(
  id: string,
  patch: { title?: string; icon?: string | null; active?: number; sort?: number; budget_kind?: string | null },
): StoreCategory | null {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const k of ["title", "icon", "active", "sort", "budget_kind"] as const) {
    if (patch[k] !== undefined) { sets.push(`${k}=?`); vals.push(patch[k]); }
  }
  if (!sets.length) return getCategory(id);
  // Renaming a seeded shelf makes the name theirs, so our key goes with it —
  // otherwise the language switch would put "Coupons" back over their word.
  const keyReset = patch.title !== undefined ? ", title_key=NULL" : "";
  getDb().run(
    `UPDATE store_categories SET ${sets.join(", ")}${keyReset}, parent_edited=1 WHERE id=?`,
    [...vals, id],
  );
  return getCategory(id);
}

export function createStoreItem(input: {
  categoryId: string; kind: StoreItemKind; title: string; priceLuna: number;
  payload: Record<string, unknown>; familyId: string;
}): StoreItem {
  const db = getDb();
  const next = (db.query("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM store_items WHERE category_id=?")
    .get(input.categoryId) as { n: number }).n;
  const row: StoreItem = {
    id: `item-${uid()}`, category_id: input.categoryId, kind: input.kind, title: input.title,
    title_key: null, // theirs, so it is shown exactly as typed
    price_luna: input.priceLuna, payload: JSON.stringify(input.payload), active: 1,
    sort: next, parent_edited: 1, family_id: input.familyId,
  };
  db.run(
    `INSERT INTO store_items (id, category_id, kind, title, price_luna, payload, active, sort, parent_edited, family_id)
     VALUES (?,?,?,?,?,?,1,?,1,?)`,
    [row.id, row.category_id, row.kind, row.title, row.price_luna, row.payload, row.sort, row.family_id],
  );
  return row;
}

export function updateStoreItem(
  id: string,
  patch: { title?: string; price_luna?: number; active?: number; sort?: number; payload?: string },
): StoreItem | null {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const k of ["title", "price_luna", "active", "sort", "payload"] as const) {
    if (patch[k] !== undefined) { sets.push(`${k}=?`); vals.push(patch[k]); }
  }
  if (!sets.length) return getStoreItem(id);
  // Same rule as updateCategory: their words replace ours, key and all.
  const keyReset = patch.title !== undefined ? ", title_key=NULL" : "";
  getDb().run(
    `UPDATE store_items SET ${sets.join(", ")}${keyReset}, parent_edited=1 WHERE id=?`,
    [...vals, id],
  );
  return getStoreItem(id);
}

// ---- purchases ----
export function createPurchase(
  familyId: string, childId: string, item: StoreItem, status: PurchaseStatus, refId: string | null = null,
): KidPurchase {
  const p: KidPurchase = {
    id: uid(), family_id: familyId, child_id: childId, item_id: item.id, kind: item.kind,
    title: item.title, price_luna: item.price_luna, payload: item.payload, status,
    ref_id: refId, created_at: now(),
  };
  getDb().run(
    `INSERT INTO kid_purchases (id, family_id, child_id, item_id, kind, title, price_luna, payload, status, ref_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [p.id, p.family_id, p.child_id, p.item_id, p.kind, p.title, p.price_luna, p.payload, p.status, p.ref_id, p.created_at],
  );
  return p;
}
export function getPurchase(id: string): KidPurchase | null {
  return (getDb().query("SELECT * FROM kid_purchases WHERE id=?").get(id) as KidPurchase) ?? null;
}
/**
 * What a kid has bought, newest first (#121).
 *
 * There was no way to read this table back. A kid spent 500 NIM of their own money on an
 * ice cream trip, saw confetti and a two-second toast, and the app then behaved as though
 * it had never happened: the row went to `pending_parent`, the parent fulfilled it days
 * later, `setPurchaseStatus` flipped it to `fulfilled`, and NO SCREEN ANYWHERE read any of
 * it. Saving up for something is why a kid tolerates chores.
 *
 * `title` and `price_luna` are SNAPSHOTS taken at createPurchase and are read back as
 * stored, never re-joined to `store_items`. A parent who renames a shelf item or changes
 * its price must not rewrite what a kid already bought, and a retired item still has to
 * render — which is also why nothing in this table is ever deleted.
 */
export function listPurchases(childId: string, limit = 50): KidPurchase[] {
  return getDb()
    // rowid, not id, as the tie-break. `created_at` is second-resolution, so two buys in
    // the same second tie, and `id` is a uid rather than anything monotonic — the order
    // would then be arbitrary and the test that pins it would be flaky rather than wrong.
    .query("SELECT * FROM kid_purchases WHERE child_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(childId, limit) as KidPurchase[];
}

/** The same, for every kid in one household: the parent's side of the receipt. */
export function listFamilyPurchases(familyId: string, limit = 100): KidPurchase[] {
  return getDb()
    .query("SELECT * FROM kid_purchases WHERE family_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(familyId, limit) as KidPurchase[];
}

/** How many of THIS item this kid is still waiting on a parent for. Drives the "1 waiting"
 *  mark on the tile: a coupon is re-buyable on purpose (two ice cream trips is a real
 *  thing to want), so the fix for a silent second buy is to say one is already queued,
 *  not to refuse it. Nothing here touches the spend path. */
export function pendingPurchaseCount(childId: string, itemId: string): number {
  const row = getDb()
    .query("SELECT COUNT(*) AS n FROM kid_purchases WHERE child_id=? AND item_id=? AND status='pending_parent'")
    .get(childId, itemId) as { n: number };
  return row?.n ?? 0;
}

export function setPurchaseStatus(id: string, status: PurchaseStatus, refId?: string | null): void {
  if (refId !== undefined) {
    getDb().run("UPDATE kid_purchases SET status=?, ref_id=? WHERE id=?", [status, refId, id]);
  } else {
    getDb().run("UPDATE kid_purchases SET status=? WHERE id=?", [status, id]);
  }
}
