// Minimal ambient types for the parts of box-glyphs.js that src/ tests import (allowJs stays
// off — same pattern as public/js/lib/esc.d.ts). box-glyphs.js is the implementation of
// record; this declares only the sticker-art surface, not the glyph palette.

export interface StickerLike {
  /** A server URL for art, or a `local:<uuid>` handle for a kid's own photo (#282). */
  assetUrl?: string | null;
  emoji?: string | null;
  label?: string | null;
}

/** One sticker's face as markup: the photo when this device holds it, the camera stand-in
 *  when it does not, then emoji, then a lettered dot. */
export function stickerFace(s?: StickerLike | null): string;

/** A pack drawn as the fan of its own first three stickers; "" when it has none. */
export function packFan(stickers?: StickerLike[] | null, cls?: string): string;
