// The kid's character: one of the twenty-one heroes drawn for the egg timer, picked on the
// tablet during the onboarding climb (2026-09-18) and re-pickable from the me sheet.
//
// The list is written out rather than read off the disk because it is a CONTRACT with two
// other places: public/assets/heroes/hero-<id>.png is the art the tablet draws, and
// public/kid/timer/heroes.json is the roster the timer reads. A test holds all three together,
// so a hero added to the folder without a line here fails CI instead of failing on a kid.
//
// Unlike the identicon (src/kid-character.ts), this is art and nothing else: no address, no
// key, no money. Re-picking costs nothing, so the one-way door next door does not apply.

/** Every hero the app ships, by the id the art carries. Alphabetical, so a diff reads. */
export const HERO_IDS = [
  "axolotl", "bee", "bunny", "cat", "corgi", "duck", "frog", "giraffe", "hedgehog", "octopus",
  "owl", "panda", "penguin", "pig", "raccoon", "sloth", "snail", "tiger", "trex", "turtle",
  "whale",
] as const;

export type HeroId = (typeof HERO_IDS)[number];

export function isHeroId(id: unknown): id is HeroId {
  return typeof id === "string" && (HERO_IDS as readonly string[]).includes(id);
}

/** Where the tablet draws it from. One place, so the picker and the path agree. */
export const heroArtUrl = (id: HeroId) => `/assets/heroes/hero-${id}.png`;
