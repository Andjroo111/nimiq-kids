// THE sticker catalog: which packs exist, what is in them, and what they cost.
// One source of truth — db.ts upserts this at boot, so adding a pack is a single
// edit here rather than three INSERT blocks in schema.sql that only ever apply
// to a fresh database.
//
// ART. NONE SHIPS RIGHT NOW. Andjroo, 2026-09-15: the backgrounds, the stickers, the
// characters and the chore icons are all being redrawn, so every generated file came out of
// the tree in one pass (`public/assets/{stickers,heroes,backgrounds,secret,store,icons}`,
// the timer's scenes and hero cut-outs). What stayed is the MECHANICS: the packs, the goal
// ladders, the wallpaper unlock, the Treasure Box, the switch gate and the egg. Each one
// already had a no-art path (a sticker draws its `emoji`, a job card its emoji, a wallpaper
// falls back to the built-in gradient, the egg hatches with nothing above the shells), and
// that path is what a kid sees until the new set lands.
//
// To bring art back: drop the files in, flip `STICKER_ART_SHIPPED`, restore `backgroundIds`
// on the themes below, and the boot upsert in db.ts rewrites every row on the next start.
// The tests that gate art on disk are `skipIf`'d on that flag and come back with it.
//
// The four sets before this one, for the record: hand-authored SVG (a triangle horn was the
// unicorn), emoji ("too basic"), generated art on a coloured plate (read as imported from
// another app), and the Higgsfield set that shared one style sentence with the 21 egg-timer
// heroes. That fourth set is what was pulled; its recipe lives in the kids-sticker-art skill.
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
  /** A GOAL-LADDER THEME: earned by climbing, never on the shelf at any price.
   *  `priceLuna` stays 0 on these and `packStoreItems()` skips them by that alone,
   *  but the flag is what says it is deliberate rather than an unpriced oversight. */
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

/** Whether generated sticker art is in the tree. False since 2026-09-15 (see ART above);
 *  the on-disk gates in sticker-art.test.ts, stickers.test.ts and goal-themes.test.ts read it. */
export const STICKER_ART_SHIPPED = false;

/** Generated art lives under /assets/stickers/<id>.png, keyed off the sticker id minus its
 *  `stk-` prefix, so adding a sticker means dropping in one file. Null while none ships: the
 *  row's `asset_url` goes null at boot and `stickerFace` draws the emoji instead. */
export const stickerAssetUrl = (id: string): string | null =>
  STICKER_ART_SHIPPED ? `/assets/stickers/${id.replace(/^stk-/, "")}.png` : null;

const NIM = 100_000;

export const STICKER_PACKS: PackDef[] = [
  { id: "pack-starter", title: "Starter stickers", priceLuna: 0, sort: 0, aboutUsd: 0 },
  { id: "pack-space", title: "Space pack", priceLuna: 2_000 * NIM, sort: 1, aboutUsd: 0.93 },
  { id: "pack-ocean", title: "Ocean pack", priceLuna: 2_000 * NIM, sort: 2, aboutUsd: 0.93 },
  { id: "pack-party", title: "Party pack", priceLuna: 3_000 * NIM, sort: 3, aboutUsd: 1.39 },
  { id: "pack-animals", title: "Animal pack", priceLuna: 3_000 * NIM, sort: 4, aboutUsd: 1.39 },

  // ---- goal-ladder themes (Andjroo, 2026-08-04) ----
  // Five to collect plus a boss, and NOT FOR SALE at any price. A kid gets one sticker per
  // rung climbed, across as many ladders as it takes; finishing the five lands the boss and
  // releases the whole set into the picker. `priceLuna: 0` and `theme: true` together are
  // what keep them off the Treasure Box shelf.
  // Two KINDS of theme, and the difference is deliberate (Andjroo, 2026-08-04: "we should have
  // the two styles"). Dragons is a GROWTH pack: one dragon growing up, and the order it is
  // collected in is the story. Dragon friends is a COMMUNITY pack: six different dragons of one
  // world, and no order at all. See the `kids-sticker-art` skill.
  //
  // ⚠️ The kind is GROWTH, not "family" -- Andjroo's own correction the same day, and worth
  // keeping: `family` in this codebase already means the HOUSEHOLD (`families`), and separately
  // the house art family every sticker is drawn into. A third meaning would have made the word
  // ungreppable.
  // The wallpapers each theme used to unlock (dragons, dragon-valley, unicorns, unicorn-glade,
  // robot-city + robot-scrapyard + robot-hangar) left with the art on 2026-09-15. A theme with
  // no `backgroundIds` unlocks nothing, a state this file always allowed.
  { id: "pack-dragons", title: "Dragons", priceLuna: 0, sort: 10, aboutUsd: 0, theme: true },
  { id: "pack-dragon-friends", title: "Dragon friends", priceLuna: 0, sort: 11, aboutUsd: 0,
    theme: true },
  { id: "pack-unicorns", title: "Unicorns", priceLuna: 0, sort: 12, aboutUsd: 0, theme: true },
  { id: "pack-unicorn-friends", title: "Unicorn friends", priceLuna: 0, sort: 13, aboutUsd: 0,
    theme: true },
  // ⚠️ ROBOTS IS A COMMUNITY PACK, NOT A GROWTH ONE. It was written here as a growth ladder
  // (bolt, rover, jet, digger, guard, titan as AGES) while it was still undrawn. Andjroo looked
  // at the first four drawings on 2026-08-05 and read them as a community, and chose COMMUNITY
  // when asked. Nobody here is older than anyone else: six machines of one world.
  //
  // The names survived the change of kind, and so did the rule above them -- Andjroo asked for
  // Transformers, that is Hasbro's, and this app ships publicly, so these are ORIGINAL robots.
  // The seed was regenerated once for exactly that reason: the build he picked came back in
  // red-and-white with helmet fins, a grille and a blue visor, which is Optimus Prime's face.
  // The build language stayed; the face became a brushed steel faceplate carrying the same
  // navy dot eyes, smile and pink cheeks every other sticker in the app has.
  //
  // A community pack varies by MATERIAL, never by hue. Here the material is the MACHINE each
  // one is built out of -- the exact analogue of a unicorn whose mane is made of water -- so
  // each member's colour means a vehicle and that vehicle's real parts are bolted onto it.
  { id: "pack-robots", title: "Robots", priceLuna: 0, sort: 14, aboutUsd: 0, theme: true },
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

  { id: "stk-rocket", packId: "pack-space", label: "Rocket", emoji: "🚀" },
  { id: "stk-planet", packId: "pack-space", label: "Planet", emoji: "🪐" },
  { id: "stk-moon", packId: "pack-space", label: "Moon", emoji: "🌙" },
  { id: "stk-alien", packId: "pack-space", label: "Alien", emoji: "👽" },
  { id: "stk-star2", packId: "pack-space", label: "Shooting star", emoji: "🌟" },

  { id: "stk-fish", packId: "pack-ocean", label: "Fish", emoji: "🐠" },
  { id: "stk-octopus", packId: "pack-ocean", label: "Octopus", emoji: "🐙" },
  { id: "stk-shell", packId: "pack-ocean", label: "Shell", emoji: "🐚" },
  { id: "stk-crab", packId: "pack-ocean", label: "Crab", emoji: "🦀" },
  { id: "stk-whale", packId: "pack-ocean", label: "Whale", emoji: "🐳" },

  { id: "stk-balloon", packId: "pack-party", label: "Balloon", emoji: "🎈" },
  { id: "stk-cupcake", packId: "pack-party", label: "Cupcake", emoji: "🧁" },
  { id: "stk-gift", packId: "pack-party", label: "Gift", emoji: "🎁" },
  { id: "stk-partyhat", packId: "pack-party", label: "Party face", emoji: "🥳" },
  { id: "stk-medal", packId: "pack-party", label: "Medal", emoji: "🏅" },

  { id: "stk-cat", packId: "pack-animals", label: "Cat", emoji: "🐱" },
  { id: "stk-dog", packId: "pack-animals", label: "Dog", emoji: "🐶" },
  { id: "stk-bunny", packId: "pack-animals", label: "Bunny", emoji: "🐰" },
  { id: "stk-bear", packId: "pack-animals", label: "Bear", emoji: "🐻" },
  { id: "stk-fox", packId: "pack-animals", label: "Fox", emoji: "🦊" },

  // ---- Dragons (goal-ladder theme) ----
  // ONE DRAGON GROWING UP, in order, and the order is the story: an egg, a hatchling, a young
  // one, horns, scales, and the great dragon breathing fire. Andjroo's shape (2026-08-04): "I
  // would have just done an entire green dragon row... the horns coulda got bigger, the wings
  // coulda got... and then the fire should be saved for the last dragon."
  //
  // Every stage adds a NOUN the eye can see -- horns, then scales, then fire -- and holds
  // everything else. A colour change alone is not a stage. See the `kids-sticker-art` skill.
  { id: "stk-dragon-egg", packId: "pack-dragons", label: "Dragon egg", emoji: "🥚" },
  { id: "stk-dragon-baby", packId: "pack-dragons", label: "Baby dragon", emoji: "🐣" },
  { id: "stk-dragon-young", packId: "pack-dragons", label: "Young dragon", emoji: "🦎" },
  { id: "stk-dragon-horns", packId: "pack-dragons", label: "Horned dragon", emoji: "🐲" },
  { id: "stk-dragon-scales", packId: "pack-dragons", label: "Scaled dragon", emoji: "🦎" },
  { id: "stk-dragon-great", packId: "pack-dragons", label: "The great dragon", emoji: "🐉", boss: true },

  // ---- Dragon friends (goal-ladder theme, COMMUNITY) ----
  // Six dragons of one world rather than one dragon six times: same species, same body, same
  // face, same hand -- each with its own colour and its own single feature. The order means
  // nothing here, which is the whole difference from the pack above.
  { id: "stk-df-ember", packId: "pack-dragon-friends", label: "Ember", emoji: "🔴" },
  { id: "stk-df-sunny", packId: "pack-dragon-friends", label: "Sunny", emoji: "🟡" },
  { id: "stk-df-splash", packId: "pack-dragon-friends", label: "Splash", emoji: "🔵" },
  { id: "stk-df-twist", packId: "pack-dragon-friends", label: "Twist", emoji: "🟣" },
  { id: "stk-df-fluff", packId: "pack-dragon-friends", label: "Fluff", emoji: "🩷" },
  { id: "stk-df-pearl", packId: "pack-dragon-friends", label: "Pearl", emoji: "🤍", boss: true },

  // ---- Unicorns (goal-ladder theme, GROWTH) ----
  // THE UNICORN THE APP ALREADY HAS, growing up. Every stage is anchored on the seed
  // `art-hero/regen/unicorn.png` -- which is the very drawing that ships above as `stk-unicorn`
  // and as an egg-timer hero.
  //
  // ⚠️ That is not a shortcut, it is the fix. The first attempt at this pack was drawn off
  // `anim-unicorn.png`, a DIFFERENT and older unicorn, and came back as six unrelated creatures
  // -- Andjroo, 2026-08-04: "we should have one single unicorn that's already... and she's not
  // even in this lineup." Anchoring on the shipped one also answers the never-draw-a-creature-
  // twice rule that `stk-unicorn` would otherwise break: a kid is not meeting a second unicorn,
  // she is meeting the one she has, at six ages.
  //
  // The arc adds one NOUN the eye can see per stage and never a hue: no horn at all, then a
  // blunt horn nub, then the spiral horn and full mane, then star markings and gold hooves,
  // then the wings. The wings are the one dramatic thing and they arrive on the boss alone.
  { id: "stk-unicorn-egg", packId: "pack-unicorns", label: "Unicorn egg", emoji: "🥚" },
  { id: "stk-unicorn-foal", packId: "pack-unicorns", label: "Unicorn foal", emoji: "🐴" },
  { id: "stk-unicorn-horn", packId: "pack-unicorns", label: "First horn", emoji: "🦄" },
  { id: "stk-unicorn-mane", packId: "pack-unicorns", label: "Rainbow mane", emoji: "🌈" },
  { id: "stk-unicorn-stars", packId: "pack-unicorns", label: "Starlit unicorn", emoji: "✨" },
  { id: "stk-unicorn-great", packId: "pack-unicorns", label: "The great unicorn", emoji: "🦄", boss: true },

  // ---- Unicorn friends (goal-ladder theme, COMMUNITY) ----
  // Six unicorns of one world, no order. Same seed as the growth pack above, so the two
  // collections are the same world -- the way dragons and dragon-friends are.
  //
  // ⚠️ EACH ONE'S COLOUR MEANS AN ELEMENT, AND HER MANE IS MADE OF IT. Colour alone was not
  // enough: a first pass gave all six the same flowing rainbow-shaped mane in six pastels and
  // Andjroo's note was "they are a little bit too similar... we need them to kind of be unique.
  // So green for grass, blue for water, white for cloud." Recolouring one drawing reads as one
  // drawing recoloured. The MATERIAL of the mane is what the eye catches in a 34px slot.
  //
  // NO WINGS anywhere in this pack -- "we are working on unicorns, not Pegasus, we will do that
  // in a different version." The winged one is the growth pack's boss and hers alone.
  //
  // The boss is the pure white one. She carried a gold rim and gold hooves to mark her as the
  // prize and they came off ("I wouldn't have the gold on the white cloud boss"); the gold
  // spiral horn stays only because all six share it. Her rarity is the white plus the gold well
  // the board already draws behind `.bd-set-boss`.
  { id: "stk-uf-petal", packId: "pack-unicorn-friends", label: "Petal", emoji: "🌸" },
  { id: "stk-uf-wave", packId: "pack-unicorn-friends", label: "Wave", emoji: "💧" },
  { id: "stk-uf-meadow", packId: "pack-unicorn-friends", label: "Meadow", emoji: "🌿" },
  { id: "stk-uf-blaze", packId: "pack-unicorn-friends", label: "Blaze", emoji: "🔥" },
  { id: "stk-uf-twilight", packId: "pack-unicorn-friends", label: "Twilight", emoji: "🌙" },
  { id: "stk-uf-cloud", packId: "pack-unicorn-friends", label: "Cloud", emoji: "☁️", boss: true },

  // Robots. Bolt IS the seed the other five were drawn from, the way stage 3 is the seed in a
  // growth pack, which is why the fire-engine red one has the plain grille chest and everyone
  // else replaced it with their own machine's hardware.
  //
  // The boss is Titan, and in a world where every member is painted steel the rare material is
  // a MIRROR FINISH. No gold: that came off the cloud unicorn boss for the same reason, and the
  // board already draws a gold well behind `.bd-set-boss`.
  { id: "stk-bot-bolt", packId: "pack-robots", label: "Bolt", emoji: "🚒" },
  { id: "stk-bot-rover", packId: "pack-robots", label: "Rover", emoji: "🚜" },
  { id: "stk-bot-jet", packId: "pack-robots", label: "Jet", emoji: "✈️" },
  { id: "stk-bot-digger", packId: "pack-robots", label: "Digger", emoji: "🏗️" },
  { id: "stk-bot-guard", packId: "pack-robots", label: "Guard", emoji: "🛡️" },
  { id: "stk-bot-titan", packId: "pack-robots", label: "Titan", emoji: "🤖", boss: true },
];

/** Store rows for the packs that are for sale — NOT the starter pack, and NOT a theme.
 *  A theme is earned by climbing a ladder and is deliberately absent from the shelf: the
 *  `priceLuna > 0` test already excludes it, and the `!p.theme` beside it is what stops a
 *  future edit putting a price on one and quietly making it buyable. */
export const packStoreItems = () =>
  STICKER_PACKS.filter((p) => p.priceLuna > 0 && !p.theme).map((p, i) => ({
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
