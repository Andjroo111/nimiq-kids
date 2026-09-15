// REAL ART FOR A TREASURE BOX TILE (#404).
//
// Andjroo, 2026-09-01: "we also need to generate images for the fifteen minutes, thirty minutes,
// sixty minutes, pick what's for dinner, stay up late." Those five rows drew vector glyphs while
// a sticker pack on the shelf beside them drew a fan of real art, which is what made them read
// as placeholders.
//
// ⚠️ THE ART IS RESOLVED FROM DATA THE ROW ALREADY CARRIES. This is `src/task-icons.ts`'s shape,
// and it is a deliberate choice over the two obvious alternatives:
//
//   a column on store_items    a migration, for a fact the catalogue already knows
//   a path in payload.icon     `cleanIcon` (routes/store.ts) validates that field to
//                              /^[a-z0-9-]{1,32}$/ because a PARENT can write it, and the
//                              catalogue re-applies the seeded payload at every boot
//                              (db.ts, gated on parent_edited) — so art committed there dies
//                              the moment a grown-up edits the row
//
// `item-screen-15` already carries `{minutes: 15}` and `item-coupon-dinner` already carries
// `{icon: "dinner"}`. Nothing new has to be stored for the picture to be found.
//
// ⚠️ A MISS RETURNS NULL, NEVER A GUESSED PATH. Both renderers fall back to the glyph they drew
// before this file existed, so a parent-created coupon with a face we have not drawn shows its
// glyph rather than a broken image. `src/store-art.test.ts` is what stops the opposite failure:
// a name in this map with no file behind it.
//
// NO STORE ART SHIPS RIGHT NOW (2026-09-15, pulled with the stickers; sticker-catalog.ts has
// the story). The maps stay so the slugs are on record; `storeArtUrl` answers null for every
// row while `STORE_ART_SHIPPED` is false, and both renderers draw their glyph.

/** Screen-time minutes to the file drawn for them. */
const BY_MINUTES: Record<number, string> = {
  15: "screen-15",
  30: "screen-30",
  60: "screen-60",
};

/** A coupon's `payload.icon` (the glyph name) to the file drawn for it. Only the two seeded
 *  coupons are drawn; every other glyph in the palette is still a glyph. */
const BY_ICON: Record<string, string> = {
  dinner: "dinner",
  moon: "moon",
};

/** Whether the five drawn tiles are in the tree. store-art.test.ts gates on it. */
export const STORE_ART_SHIPPED = false;

/** Every file this module can name, for the on-disk gate. */
export const STORE_ART_SLUGS: string[] = [
  ...new Set([...Object.values(BY_MINUTES), ...Object.values(BY_ICON)]),
];

export const storeArtPath = (slug: string) => `public/assets/store/${slug}.png`;

/**
 * The drawn face for a store row, or null when nothing has been drawn for it.
 *
 * `kind` decides which key is asked, because the two kinds carry different data and a coupon
 * with a stray `minutes` must not pick up a clock.
 */
export function storeArtUrl(kind: string, payload: unknown): string | null {
  if (!STORE_ART_SHIPPED) return null;
  const p = (payload ?? {}) as { minutes?: unknown; icon?: unknown };
  let slug: string | undefined;
  if (kind === "screen_time" && typeof p.minutes === "number") slug = BY_MINUTES[p.minutes];
  else if (kind === "coupon" && typeof p.icon === "string") slug = BY_ICON[p.icon];
  return slug ? `/assets/store/${slug}.png` : null;
}
