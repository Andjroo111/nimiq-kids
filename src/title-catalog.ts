/**
 * The titles WE author, as keys instead of prose.
 *
 * The language switch translates keys. Everything on a kid's board is a row in
 * SQLite with a `title` column, so for a long time the chrome around the board
 * changed language and the board itself did not: "MORNING" became "MAÑANA" and
 * "Brush your teeth" stayed in English underneath it. The seeded titles were
 * never the parent's words — we wrote them — so storing them as prose was the
 * mistake, not the renderer.
 *
 * Every title we seed now carries a `title_key` alongside the English, and the
 * render rule everywhere is the one `public/kid/js/box.js` already used for
 * Treasure Box shelves:
 *
 *     title_key ? t(title_key) : title
 *
 * A known row translates. An unknown row shows exactly what is stored. That
 * second half is the point, not a fallback: when a parent types "Feed Winston
 * his 5pm scoop" there is no key, and their words appear verbatim on every
 * device in every language. We do not machine-translate a household's own
 * phrasing (Andjroo, 2026-08-01) — a kid's name comes back as a noun and the
 * job stops being the one their parent set.
 *
 * The catalog is what closes the gap between those two cases. It is the list
 * the add-a-chore picker draws, so tapping a tile is both faster than typing
 * AND the thing that makes the chore translatable. Most real input lands on a
 * key without the parent being asked to do anything about language at all.
 *
 * IDs are stable forever. Renaming one orphans the rows already pointing at it,
 * which is the one way to make a board fall back to English after it worked.
 */

/** A job a kid does. Chores and routine tasks share this namespace on purpose:
 *  "Brush your teeth" is one string whether it sits on the board or inside the
 *  bedtime routine, and translating it twice is how the two drift apart. */
export interface CatalogJob {
  /** Key suffix AND the stable id. `cat.job.dishwasher`. */
  id: string;
  emoji: string;
  /** English, used as the stored fallback and as the locale-parity reference. */
  en: string;
  /** Which picker tab it sits under. Omitted = seeded only, not offered. */
  group?: JobGroup;
}

export type JobGroup = "kitchen" | "bedroom" | "cleaning" | "pets" | "outdoors" | "learning" | "selfcare";

/** Picker tabs, in the order a parent reads them. `cat.group.*` names them. */
export const JOB_GROUPS: readonly JobGroup[] = [
  "selfcare", "bedroom", "kitchen", "cleaning", "pets", "outdoors", "learning",
];

/**
 * Everything a kid can be asked to do, that we named.
 *
 * Sized to cover the ordinary household rather than to be exhaustive: a parent
 * who does not find their chore here types it, and that path stays first-class.
 * Roughly forty tiles is also the most that reads as a grid to scan instead of
 * a list to search.
 */
export const JOB_CATALOG: readonly CatalogJob[] = [
  // self care — the routine backbone, and what most sub-tasks actually are
  { id: "dressed", emoji: "👕", en: "Get dressed", group: "selfcare" },
  { id: "teeth", emoji: "🪥", en: "Brush your teeth", group: "selfcare" },
  { id: "hair", emoji: "💇", en: "Brush your hair", group: "selfcare" },
  { id: "shower", emoji: "🚿", en: "Take a shower", group: "selfcare" },
  { id: "pajamas", emoji: "🩳", en: "Put on your pajamas", group: "selfcare" },
  { id: "shoes", emoji: "👟", en: "Put your shoes away", group: "selfcare" },
  { id: "bag", emoji: "🎒", en: "Pack your bag", group: "selfcare" },

  // bedroom
  { id: "bed", emoji: "🛏️", en: "Make your bed", group: "bedroom" },
  { id: "room", emoji: "🧸", en: "Clean your room", group: "bedroom" },
  { id: "clothes", emoji: "👚", en: "Put your clothes away", group: "bedroom" },
  { id: "laundry", emoji: "🧺", en: "Fold the laundry", group: "bedroom" },
  { id: "laundrysort", emoji: "🧦", en: "Sort the laundry", group: "bedroom" },

  // kitchen
  { id: "dishwasher", emoji: "🧽", en: "Empty the dishwasher", group: "kitchen" },
  { id: "table", emoji: "🍽️", en: "Set the table", group: "kitchen" },
  { id: "cleartable", emoji: "🍴", en: "Clear the table", group: "kitchen" },
  { id: "dishes", emoji: "🫧", en: "Wash the dishes", group: "kitchen" },
  { id: "groceries", emoji: "🛒", en: "Put the groceries away", group: "kitchen" },
  { id: "lunch", emoji: "🥪", en: "Pack your lunch", group: "kitchen" },

  // cleaning
  { id: "trash", emoji: "🗑️", en: "Take out the trash", group: "cleaning" },
  { id: "recycling", emoji: "♻️", en: "Take out the recycling", group: "cleaning" },
  { id: "vacuum", emoji: "🧹", en: "Vacuum the floor", group: "cleaning" },
  { id: "sweep", emoji: "🪠", en: "Sweep the floor", group: "cleaning" },
  { id: "bathroom", emoji: "🚽", en: "Clean the bathroom", group: "cleaning" },
  { id: "mirror", emoji: "🪞", en: "Clean the mirror", group: "cleaning" },
  { id: "dust", emoji: "🪶", en: "Dust the shelves", group: "cleaning" },

  // pets
  { id: "dogfeed", emoji: "🐕", en: "Feed the dog", group: "pets" },
  { id: "dogwalk", emoji: "🦮", en: "Walk the dog", group: "pets" },
  { id: "catfeed", emoji: "🐈", en: "Feed the cat", group: "pets" },
  { id: "litter", emoji: "🧾", en: "Clean the litter box", group: "pets" },
  { id: "waterbowl", emoji: "🥣", en: "Fill the water bowl", group: "pets" },
  // Retired from the picker 2026-09-17, kept in the table so the boards already
  // carrying `cat.job.petfeed` still translate. "Feed the pet" sat next to "Feed the
  // dog" and "Feed the cat" and read as a placeholder beside them; a household with a
  // rabbit types its own words, which is the path this file already prefers. No group =
  // not offered (see CatalogJob.group); `/api/jobs` filters by group, so it simply stops
  // being drawn.
  { id: "petfeed", emoji: "🐾", en: "Feed the pet" },

  // outdoors
  { id: "plants", emoji: "🌱", en: "Water the plants", group: "outdoors" },
  { id: "leaves", emoji: "🍂", en: "Rake the leaves", group: "outdoors" },
  { id: "yard", emoji: "🌳", en: "Clean up the yard", group: "outdoors" },
  { id: "car", emoji: "🚗", en: "Wash the car", group: "outdoors" },
  { id: "mail", emoji: "📬", en: "Get the mail", group: "outdoors" },

  // learning
  { id: "homework", emoji: "✏️", en: "Do your homework", group: "learning" },
  { id: "read20", emoji: "📚", en: "Read for 20 minutes", group: "learning" },
  { id: "piano", emoji: "🎹", en: "Practice piano", group: "learning" },
  { id: "spelling", emoji: "🔤", en: "Practice spelling", group: "learning" },
  { id: "mathlesson", emoji: "📐", en: "Do a math lesson", group: "learning" },
  { id: "codinglesson", emoji: "💻", en: "Do a coding lesson", group: "learning" },
];

/** Routine names. Separate namespace: "Morning routine" is a container, not a job. */
export const ROUTINE_CATALOG: readonly { id: string; emoji: string; en: string }[] = [
  { id: "morning", emoji: "🌅", en: "Morning routine" },
  { id: "afternoon", emoji: "☀️", en: "Afternoon routine" },
  { id: "bedtime", emoji: "🌙", en: "Bedtime routine" },
];

/** Treasure Box shelves and the items we stock them with. Screen-time tiles and
 *  timer styles are NOT here: `box.js` already renders those from their payload
 *  ("{count} minutes", the timer's own name), which stays correct in any
 *  language without a row-level key. */
export const SHELF_CATALOG: readonly { id: string; en: string }[] = [
  { id: "cat-stickers", en: "Sticker packs" },
  { id: "cat-screen", en: "Screen time" },
  { id: "cat-coupons", en: "Coupons" },
  { id: "cat-timers", en: "Timers" },
];

export const ITEM_CATALOG: readonly { id: string; en: string }[] = [
  { id: "item-coupon-dinner", en: "Pick what's for dinner" },
  { id: "item-coupon-stayup", en: "Stay up 30 minutes late" },
];

export const PACK_CATALOG: readonly { id: string; en: string }[] = [
  { id: "pack-starter", en: "Starter stickers" },
  { id: "pack-space", en: "Space pack" },
  { id: "pack-ocean", en: "Ocean pack" },
  { id: "pack-party", en: "Party pack" },
  { id: "pack-animals", en: "Animal pack" },
  // Goal-ladder themes: earned, never sold. The lineless four (2026-09-17); the five lined-era
  // ids that were here keep their `cat.*` strings in locales/catalog.ts for the ladders that
  // still carry them.
  { id: "pack-ocean-theme", en: "Ocean" },
  { id: "pack-space-theme", en: "Space" },
  { id: "pack-dragons-theme", en: "Dragons" },
  { id: "pack-robots-theme", en: "Robots" },
];

// ---------- keys ----------

export const jobKey = (id: string) => `cat.job.${id}`;
export const routineKey = (id: string) => `cat.routine.${id}`;
/** Shelves, items and packs carry their table's own id, which is already
 *  namespaced (`cat-screen`, `item-coupon-dinner`, `pack-ocean`), so the key is
 *  that id verbatim under `cat.`. One less mapping to keep in step. */
export const rowKey = (id: string) => `cat.${id}`;

const JOB_BY_ID = new Map(JOB_CATALOG.map((j) => [j.id, j]));

/** A seeded job, by catalog id. Throws rather than seeding a silent typo: an id
 *  that does not resolve would write a key nothing translates, and the row would
 *  render its English fallback forever with no error anywhere. */
export function job(id: string): CatalogJob {
  const found = JOB_BY_ID.get(id);
  if (!found) throw new Error(`title-catalog: no job "${id}"`);
  return found;
}

/**
 * What a client's `catalogId` resolves to, or null if it names nothing.
 *
 * The picker sends an ID, never a title-and-key pair, so a caller cannot post
 * "Feed the dog" carrying `cat.job.trash` and have every other language on the
 * family's devices disagree with the one the parent is looking at. The title and
 * the emoji are read here, server-side, from the same table the tiles were drawn
 * from. `job()` throws for seeds (a typo there is our bug); this returns null,
 * because an unknown ID over HTTP is just a request to fall back to free text.
 */
export function resolveJob(id: unknown): CatalogJob | null {
  return typeof id === "string" ? (JOB_BY_ID.get(id) ?? null) : null;
}

/** Every key this catalog expects a locale to define. The locale parity test
 *  reads this, so adding a tile above fails the suite until all 5 languages
 *  carry it — the only thing standing between a new chore and a board that is
 *  half-translated in production. */
export function catalogKeys(): string[] {
  return [
    ...JOB_CATALOG.map((j) => jobKey(j.id)),
    ...ROUTINE_CATALOG.map((r) => routineKey(r.id)),
    ...SHELF_CATALOG.map((s) => rowKey(s.id)),
    ...ITEM_CATALOG.map((i) => rowKey(i.id)),
    ...PACK_CATALOG.map((p) => rowKey(p.id)),
  ];
}

/** English for a key, for the backfill and for tests. */
export function catalogEnglish(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const j of JOB_CATALOG) out[jobKey(j.id)] = j.en;
  for (const r of ROUTINE_CATALOG) out[routineKey(r.id)] = r.en;
  for (const s of SHELF_CATALOG) out[rowKey(s.id)] = s.en;
  for (const i of ITEM_CATALOG) out[rowKey(i.id)] = i.en;
  for (const p of PACK_CATALOG) out[rowKey(p.id)] = p.en;
  return out;
}
