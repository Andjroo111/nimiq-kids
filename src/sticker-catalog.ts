// THE sticker catalog: which packs exist, what is in them, and what they cost.
// One source of truth — db.ts upserts this at boot, so adding a pack is a single
// edit here rather than three INSERT blocks in schema.sql that only ever apply
// to a fresh database.
//
// ART. THE LINELESS SET, since 2026-09-17. Andjroo and a Midjourney session (brand-voice-research
// on the Mini, branch mj-hunt-0915, `ART-VOICE.md`: pebbles, no ink) drew four THEME packs, each
// members + one boss + one pack egg, plus 21 egg-hatch characters and 15 scenes. What ships from
// it is listed in tools/art/lineless-list.json and cut by tools/art/cut-lineless.py into
// /assets/stickers/<id>.png (512 square, ink inside the inscribed circle, see
// tools/recut-stickers.py for why), /assets/heroes/, /assets/backgrounds/ and the timer's copies.
//
// The packs are goal-ladder THEMES (Andjroo, 2026-09-17: "goal-ladder themes"): members are
// earned a rung at a time, the boss lands when the set is complete, and the PACK EGG is the
// ladder's prize face until the boss is owned (`eggId` below, `themeProgress` hands it to the
// path). Ocean, space, forest and building-site wallpapers are earned by finishing the matching
// theme; the other eleven are free (`backgroundIds`).
//
// The 2026-09-15 strip (every generated file out, mechanics on their no-art faces) is what this
// replaced; that commit is the recipe for stripping again if the art is ever redrawn.
//
// PRICE. Whole NIM, like every reward (see ../rates). The old prices were 2-3
// NIM, which was about a tenth of a cent once rewards became dollar-sized — a
// kid would have owned every pack after one chore, and the Treasure Box would
// have meant nothing.

export interface PackDef {
  id: string; title: string; priceLuna: number; sort: number;
  /** Roughly what the pack costs in dollars at the rate it was priced at,
   *  for the record. NIM is what is charged; the dollar value floats. */
  aboutUsd: number;
  /** A GOAL-LADDER THEME: collected a rung at a time by a ladder set to it. Since 2026-09-17
   *  a theme is ALSO for sale (Andjroo: "buy the pack, or earn it rung by rung"): the shelf
   *  sells its MEMBERS for `priceLuna`, and the boss only ever comes from finishing the set
   *  on a ladder. A theme with `priceLuna: 0` is ladder-only. */
  theme?: boolean;
  /** The app WALLPAPERS finishing this theme unlocks, each `/assets/backgrounds/<id>.jpg`.
   *
   *  ⚠️ Andjroo, 2026-08-04, on where the background lives: "It's gonna be a background that the
   *  kid gets to have settings for their app, like with our other backgrounds. They'll just
   *  unlock it. So it should be two separate things." It is NOT painted behind the boss sticker
   *  — finishing a set hands over the boss AND these, as separate objects.
   *
   *  ⚠️ This was a single `backgroundId` until 2026-08-06, when four robot wallpapers were drawn
   *  to choose one from and Andjroo kept three: "we could actually keep three out of four." A
   *  theme is a WORLD, and a world can be worth more than one view of itself. It stayed one
   *  field rather than becoming `backgroundId` plus `backgroundIds`, because two fields naming
   *  the same thing is the ungreppable-word problem this file already avoided once with GROWTH.
   *  A pack with no entry here unlocks nothing, so a theme can still ship its stickers before
   *  its wallpaper is drawn. */
  backgroundIds?: string[];
  /** The PACK EGG (2026-09-17): the face of a theme's prize node before the boss is owned, at
   *  `/assets/stickers/<eggId>.png`. Not a sticker row: nothing collects it, nothing places it. */
  eggId?: string;
}
export interface StickerDef {
  id: string; packId: string; label: string;
  /** Fallback + accessible label only. The art is the PNG. */
  emoji: string;
  /** The one sticker in a theme that is not collected a rung at a time. It lands when every
   *  other sticker in its pack is owned, and `packComplete` counts non-boss rows only —
   *  a set that included its own prize could never be finished. */
  boss?: boolean;
}

/** Whether generated sticker art is in the tree. True since 2026-09-17 (see ART above);
 *  the on-disk gates in sticker-art.test.ts, stickers.test.ts and goal-themes.test.ts read it. */
export const STICKER_ART_SHIPPED = true;

/** Generated art lives under /assets/stickers/<id>.png, keyed off the sticker id minus its
 *  `stk-` prefix. Only the THEME stickers have a file (the lineless packs); the five emoji packs
 *  for sale keep drawing their emoji, so their rows carry a null `asset_url` and `stickerFace`
 *  falls through. Null for everything while the flag is off. */
export const stickerAssetUrl = (id: string): string | null =>
  STICKER_ART_SHIPPED && hasStickerArt(id) ? `/assets/stickers/${id.replace(/^stk-/, "")}.png` : null;
const hasStickerArt = (id: string): boolean => {
  const s = STICKERS.find((x) => x.id === id);
  return !!s && STICKER_PACKS.some((p) => p.id === s.packId && p.theme);
};

const NIM = 100_000;

export const STICKER_PACKS: PackDef[] = [
  { id: "pack-starter", title: "Starter stickers", priceLuna: 0, sort: 0, aboutUsd: 0 },
  // The five emoji packs for sale (space, ocean, party, animals) left the shelf 2026-09-17
  // (Andjroo: "the sticker packs use an old icon ... these should be the same ocean space
  // dragons and robot packs"). Their rows stay in `sticker_packs` inactive and their stickers
  // keep their `pack_id`-less rows, so a kid who bought one keeps every sticker they placed.

  // ---- goal-ladder themes (Andjroo, 2026-08-04) ----
  // Five to collect plus a boss. A kid gets one sticker per rung climbed, across as many
  // ladders as it takes; finishing the five lands the boss and releases the whole set into
  // the picker. Since 2026-09-17 the SAME four sets are the Treasure Box's sticker shelf
  // (Andjroo: "buy the pack, or earn it rung by rung"): `priceLuna` buys the five members at
  // once, and the boss is still only ever earned by finishing the set on a ladder.
  // Two KINDS of theme, and the difference is deliberate (Andjroo, 2026-08-04: "we should have
  // the two styles"). Dragons is a GROWTH pack: one dragon growing up, and the order it is
  // collected in is the story. Dragon friends is a COMMUNITY pack: six different dragons of one
  // world, and no order at all. See the `kids-sticker-art` skill.
  //
  // ⚠️ The kind is GROWTH, not "family" -- Andjroo's own correction the same day, and worth
  // keeping: `family` in this codebase already means the HOUSEHOLD (`families`), and separately
  // the house art family every sticker is drawn into. A third meaning would have made the word
  // ungreppable.
  // THE FOUR THEMES (2026-09-17). Ids carry `-theme` because `pack-ocean` and `pack-space` are
  // the purchasable emoji packs above and `sticker_packs.id` is a primary key the old rows keep.
  // Each unlocks the scene that matches it; robots get the building site.
  { id: "pack-ocean-theme", title: "Ocean", priceLuna: 2_000 * NIM, sort: 10, aboutUsd: 0.93, theme: true,
    backgroundIds: ["ocean"], eggId: "ocean-egg" },
  { id: "pack-space-theme", title: "Space", priceLuna: 2_000 * NIM, sort: 11, aboutUsd: 0.93, theme: true,
    backgroundIds: ["space"], eggId: "space-egg" },
  { id: "pack-dragons-theme", title: "Dragons", priceLuna: 3_000 * NIM, sort: 12, aboutUsd: 1.39, theme: true,
    backgroundIds: ["forest"], eggId: "dragons-egg" },
  { id: "pack-robots-theme", title: "Robots", priceLuna: 3_000 * NIM, sort: 13, aboutUsd: 1.39, theme: true,
    backgroundIds: ["construction"], eggId: "robots-egg" },
];

/** Every sticker is chosen to still READ at 24px, the size it appears on a
 *  calendar day. Emoji with a lot of internal detail (a party popper, a wave)
 *  turn to mush that small, so the set leans on strong silhouettes. */
export const STICKERS: StickerDef[] = [
  // Starter — free, granted to every kid on their first read.
  { id: "stk-star", packId: "pack-starter", label: "Star", emoji: "⭐" },
  { id: "stk-heart", packId: "pack-starter", label: "Heart", emoji: "❤️" },
  { id: "stk-rainbow", packId: "pack-starter", label: "Rainbow", emoji: "🌈" },
  { id: "stk-smiley", packId: "pack-starter", label: "Smiley", emoji: "😊" },
  { id: "stk-unicorn", packId: "pack-starter", label: "Unicorn", emoji: "🦄" },
  { id: "stk-dino", packId: "pack-starter", label: "Dino", emoji: "🦖" },
  { id: "stk-paw", packId: "pack-starter", label: "Paw", emoji: "🐾" },
  { id: "stk-lightning", packId: "pack-starter", label: "Lightning", emoji: "⚡" },
  { id: "stk-flower", packId: "pack-starter", label: "Flower", emoji: "🌸" },
  { id: "stk-trophy", packId: "pack-starter", label: "Trophy", emoji: "🏆" },

  // The twenty emoji stickers of the four emoji packs were here until 2026-09-17. Their rows
  // stay in `stickers` with `pack_id` NULL (db.ts), which is exactly what keeps them usable by
  // the kids who bought them and off every shelf for everyone else.

  // ---- Dragons (goal-ladder theme) ----
  // ONE DRAGON GROWING UP, in order, and the order is the story: an egg, a hatchling, a young
  // one, horns, scales, and the great dragon breathing fire. Andjroo's shape (2026-08-04): "I
  // would have just done an entire green dragon row... the horns coulda got bigger, the wings
  // coulda got... and then the fire should be saved for the last dragon."
  //
  // Every stage adds a NOUN the eye can see -- horns, then scales, then fire -- and holds
  // everything else. A colour change alone is not a stage. See the `kids-sticker-art` skill.
  { id: "stk-ocean-crab", packId: "pack-ocean-theme", label: "Crab", emoji: "✨" },
  { id: "stk-ocean-octopus", packId: "pack-ocean-theme", label: "Octopus", emoji: "✨" },
  { id: "stk-ocean-whale", packId: "pack-ocean-theme", label: "Whale", emoji: "✨" },
  { id: "stk-ocean-turtle", packId: "pack-ocean-theme", label: "Turtle", emoji: "✨" },
  { id: "stk-ocean-axolotl", packId: "pack-ocean-theme", label: "Axolotl", emoji: "✨" },
  { id: "stk-ocean-penguin", packId: "pack-ocean-theme", label: "Penguin", emoji: "✨" },
  { id: "stk-ocean-fish", packId: "pack-ocean-theme", label: "Fish", emoji: "✨" },
  { id: "stk-ocean-seahorse", packId: "pack-ocean-theme", label: "The pearl seahorse", emoji: "✨", boss: true },
  { id: "stk-space-rocket", packId: "pack-space-theme", label: "Rocket", emoji: "✨" },
  { id: "stk-space-alien", packId: "pack-space-theme", label: "Alien", emoji: "✨" },
  { id: "stk-space-robot", packId: "pack-space-theme", label: "Robot", emoji: "✨" },
  { id: "stk-space-comet", packId: "pack-space-theme", label: "Comet", emoji: "✨" },
  { id: "stk-space-ufo", packId: "pack-space-theme", label: "UFO", emoji: "✨" },
  { id: "stk-space-asteroid", packId: "pack-space-theme", label: "Asteroid", emoji: "✨" },
  { id: "stk-space-astro", packId: "pack-space-theme", label: "The astronaut", emoji: "✨", boss: true },
  { id: "stk-dragons-sky", packId: "pack-dragons-theme", label: "Sky dragon", emoji: "✨" },
  { id: "stk-dragons-mint", packId: "pack-dragons-theme", label: "Mint dragon", emoji: "✨" },
  { id: "stk-dragons-blurple", packId: "pack-dragons-theme", label: "Blurple dragon", emoji: "✨" },
  { id: "stk-dragons-yolk", packId: "pack-dragons-theme", label: "Yolk dragon", emoji: "✨" },
  { id: "stk-dragons-pink", packId: "pack-dragons-theme", label: "Pink dragon", emoji: "✨" },
  { id: "stk-dragons-coral", packId: "pack-dragons-theme", label: "Coral dragon", emoji: "✨" },
  { id: "stk-dragons-gold", packId: "pack-dragons-theme", label: "The gold dragon", emoji: "✨", boss: true },
  { id: "stk-robots-coral", packId: "pack-robots-theme", label: "Coral robot", emoji: "✨" },
  { id: "stk-robots-space", packId: "pack-robots-theme", label: "Blurple robot", emoji: "✨" },
  { id: "stk-robots-mint", packId: "pack-robots-theme", label: "Mint robot", emoji: "✨" },
  { id: "stk-robots-sky", packId: "pack-robots-theme", label: "Sky robot", emoji: "✨" },
  { id: "stk-robots-yolk", packId: "pack-robots-theme", label: "Yolk robot", emoji: "✨" },
  { id: "stk-robots-pink", packId: "pack-robots-theme", label: "Pink robot", emoji: "✨" },
  { id: "stk-robots-boss", packId: "pack-robots-theme", label: "The pearl robot", emoji: "✨", boss: true },
];

/** Store rows for the packs that are for sale: every priced pack, which since 2026-09-17 is
 *  the four themes and nothing else. The starter pack is `priceLuna: 0` and auto-granted.
 *  Buying a theme grants its MEMBERS (`grantPackMembers`); the boss is a ladder's to give. */
export const packStoreItems = () =>
  STICKER_PACKS.filter((p) => p.priceLuna > 0).map((p, i) => ({
    id: `item-${p.id}`, categoryId: "cat-stickers", kind: "pack",
    // A pack's store row IS the pack, so it borrows the pack's title and the
    // pack's translation key rather than owning a second copy of either.
    title: p.title, packId: p.id, priceLuna: p.priceLuna,
    payload: JSON.stringify({ packId: p.id }), sort: i,
  }));

/** A shelf's own face, for the shelves schema.sql seeds. A category's icon is
 *  what every item in it falls back to, so a shelf is never faceless — which is
 *  the whole point once a PARENT can create one. Names are glyph names from
 *  public/kid/js/icons.js (GLYPHS). Sticker packs draw their own fan of
 *  stickers and never reach the fallback, so `cat-stickers` needs none. */
export const CATEGORY_ICONS: Record<string, string> = {
  "cat-screen": "gamepad",
  "cat-coupons": "ticket",
};

export interface OtherItemDef {
  priceLuna: number;
  /** The item's whole payload. `icon` names its face; the rest is the kind's
   *  own data (screen_time: minutes, timer_style: styleId). */
  payload: Record<string, unknown>;
  /** Retired = off the shelves, row KEPT. `kid_purchases.item_id` is a real FK
   *  and a kid who already bought this still owns it — a timer rig is equipped
   *  out of `kid_unlocks` via ownedTimerStyles(), which never reads this table.
   *  Same treatment retired stickers get (pack_id=NULL, row intact). */
  retired?: boolean;
}

/**
 * The rest of the shelves, repriced for the same reason as the packs: every
 * price in here was set when a chore paid 0.1 NIM. Screen time at 1 NIM is a
 * twentieth of a cent — a kid clearing one morning routine could buy the entire
 * Treasure Box twice over, so nothing in it was worth saving for.
 *
 * Whole NIM, and the ladder is deliberate: a coupon costs more than screen time.
 *
 * RE-PRICED 2026-07-31 (Andjroo's call, off a rendered comparison at
 * $0.00046914/NIM). The old rungs were 800 / 1 400 / 2 500 / 4 000, which is
 * $0.38 / $0.66 / $1.17 / $1.88 — arbitrary amounts a parent never chose. The
 * ladder now doubles: an hour of screen time is exactly four fifteens, and a
 * coupon is an hour and a half of one. The dollar value floats and is SHOWN on
 * the tile rather than baked in, so nothing here goes stale when NIM moves.
 */
export const OTHER_STORE_ITEMS: Record<string, OtherItemDef> = {
  "item-screen-15": { priceLuna: 1_000 * NIM, payload: { minutes: 15 } },    // ~$0.47
  "item-screen-30": { priceLuna: 2_000 * NIM, payload: { minutes: 30 } },    // ~$0.94
  "item-screen-60": { priceLuna: 4_000 * NIM, payload: { minutes: 60 } },    // ~$1.88
  "item-coupon-dinner": { priceLuna: 6_000 * NIM, payload: { icon: "dinner" } }, // ~$2.81
  "item-coupon-stayup": { priceLuna: 6_000 * NIM, payload: { icon: "moon" } },
  // Timers: off the shelves for now (Andjroo, 2026-07-31). Priced and kept so
  // re-listing them is one flag, and so anyone who owns one is untouched.
  "item-timer-maker": { priceLuna: 8_000 * NIM, payload: { styleId: "maker" }, retired: true },
  "item-timer-pola": { priceLuna: 6_000 * NIM, payload: { styleId: "polaroid" }, retired: true },
};

/** Shelves that are no longer offered. Same rule as a retired item: the row
 *  stays, so the purchases that point into it stay valid. */
export const RETIRED_CATEGORIES = ["cat-timers"];
