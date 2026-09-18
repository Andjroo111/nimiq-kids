// The job icons: the picture on a task or chore card.
//
// Same house style as the stickers (see sticker-catalog.ts) — one locked
// Higgsfield prompt, then auto-cropped — but objects rather than characters, on
// white, because they sit on a white card rather than inside a coloured disc.
//
// Every task already carries an EMOJI, and a parent can type any emoji they
// like, so the icon is resolved FROM the emoji rather than stored beside it.
// That means every routine and chore that already exists upgrades to real art
// with no migration, and an emoji nobody has drawn yet still renders as itself.
//
// THE ART IS THE LINELESS SET (2026-09-18): 42 of 42 rows drawn under the lineless lock in
// brand-voice-research lineless/packs/task-icons (picked by Andjroo 2026-09-17, one hue each,
// no face), cut to public/assets/icons/<id>.png by tools/art/cut-lineless.py --only taskicons
// from tools/art/lineless-list.json `taskIcons`. From 2026-09-15 to 09-18 no icon shipped and
// every card drew its emoji; that path is still the fallback for an emoji nobody has drawn.
// dogbowl (🐶), plant (🪴) and towel (🛁) were rows here until 2026-09-18 with no job pointing
// at them (the dog one, the seedling and the shower won); nothing was drawn for them and the
// kid's add-a-job picker lists every row WITH its url, so an undrawn row is a broken image.
// A parent typing one of those emoji still gets the emoji. broom serves Vacuum and dustpan
// serves Sweep, so draw what the job says, never the row's noun.

export interface TaskIcon {
  id: string;
  /** The emoji this icon replaces — also what a task stores when it is picked. */
  emoji: string;
  /** Kid-facing name in the picker. */
  label: string;
}

export const TASK_ICONS: TaskIcon[] = [
  { id: "bed", emoji: "🛏️", label: "Bed" },
  { id: "shirt", emoji: "👕", label: "Clothes" },
  { id: "toothbrush", emoji: "🪥", label: "Teeth" },
  { id: "book", emoji: "📚", label: "Books" },
  { id: "broom", emoji: "🧹", label: "Sweep" },
  { id: "teddy", emoji: "🧸", label: "Toys" },
  { id: "plate", emoji: "🍽️", label: "Dishes" },
  { id: "laundry", emoji: "🧺", label: "Laundry" },
  { id: "trash", emoji: "🗑️", label: "Bins" },
  { id: "pajamas", emoji: "🩳", label: "Pyjamas" },
  { id: "backpack", emoji: "🎒", label: "School bag" },
  { id: "piano", emoji: "🎹", label: "Piano" },
  { id: "shoes", emoji: "👟", label: "Shoes" },

  // Batch 2 (2026-08-01). The first sixteen covered thirteen of the forty-two jobs in
  // src/title-catalog.ts, so twenty-nine catalog tiles fell back to their raw emoji — on
  // the KID's board as much as the parent's, which is what made it visible when the
  // parent board started drawing the same faces (#84). These close that gap: same locked
  // prompt (icon-style.txt), same auto-crop, so they are siblings of the sixteen above
  // rather than a second set. `src/title-catalog.test.ts` now fails if a new catalog job
  // arrives without art, which is the only way this stays closed.
  { id: "hairbrush", emoji: "💇", label: "Hair" },
  { id: "shower", emoji: "🚿", label: "Shower" },
  { id: "clothesstack", emoji: "👚", label: "Clothes away" },
  { id: "socks", emoji: "🧦", label: "Sort the laundry" },
  { id: "sponge", emoji: "🧽", label: "Dishwasher" },
  { id: "cutlery", emoji: "🍴", label: "Clear the table" },
  { id: "washdishes", emoji: "🫧", label: "Wash the dishes" },
  { id: "groceries", emoji: "🛒", label: "Groceries" },
  { id: "lunchbox", emoji: "🥪", label: "Lunch" },
  { id: "recycling", emoji: "♻️", label: "Recycling" },
  { id: "dustpan", emoji: "🪠", label: "Sweep" },
  { id: "spray", emoji: "🚽", label: "Bathroom" },
  { id: "mirror", emoji: "🪞", label: "Mirror" },
  { id: "duster", emoji: "🪶", label: "Dusting" },
  { id: "dogfood", emoji: "🐕", label: "Feed the dog" },
  { id: "collar", emoji: "🦮", label: "Walk the dog" },
  { id: "catbowl", emoji: "🐈", label: "Feed the cat" },
  { id: "litterbox", emoji: "🧾", label: "Litter box" },
  { id: "waterbowl", emoji: "🥣", label: "Water bowl" },
  { id: "pawbowl", emoji: "🐾", label: "Feed the pet" },
  { id: "wateringcan", emoji: "🌱", label: "Water the plants" },
  { id: "rake", emoji: "🍂", label: "Rake the leaves" },
  { id: "tree", emoji: "🌳", label: "Yard" },
  { id: "carwash", emoji: "🚗", label: "Wash the car" },
  { id: "mailbox", emoji: "📬", label: "Mail" },
  { id: "pencilpaper", emoji: "✏️", label: "Homework" },
  { id: "blocks", emoji: "🔤", label: "Spelling" },
  { id: "calculator", emoji: "📐", label: "Maths" },
  { id: "laptop", emoji: "💻", label: "Coding" },
];

/**
 * THE FACES THAT ARE NOT JOB TILES (2026-09-18). A routine's own header (🌅 ☀️ 🌙), and the
 * defaults a goal (🪜), a practice step (🎵) and a savings target (🎯) are born with, all drew
 * their raw emoji on both apps because nothing had been drawn for them. Same lineless cut,
 * same folder, same resolver, and deliberately NOT in TASK_ICONS: the kid's add-a-job strip
 * lists every row there, and a sunrise is not a chore. `/api/task-icons` sends these under
 * `faces` so the parent board can draw them; `icons` stays the picker's list.
 */
export const FACE_ICONS: TaskIcon[] = [
  { id: "sunrise", emoji: "🌅", label: "Morning" },
  { id: "sun", emoji: "☀️", label: "Afternoon" },
  { id: "bedtime", emoji: "🌙", label: "Bedtime" },
  { id: "ladder", emoji: "🪜", label: "Goal" },
  { id: "note", emoji: "🎵", label: "Step" },
  { id: "target", emoji: "🎯", label: "Saving for" },
];

/** Whether the drawn icons are in the tree. title-catalog.test.ts gates on it. */
export const TASK_ICON_ART_SHIPPED = true;

export const taskIconUrl = (id: string): string | null =>
  TASK_ICON_ART_SHIPPED ? `/assets/icons/${id}.png` : null;

const BY_EMOJI = new Map([...TASK_ICONS, ...FACE_ICONS].map((i) => [i.emoji, i]));

/** The drawn icon for a task's emoji, or null when nobody has drawn that one —
 *  in which case the client keeps showing the emoji itself. */
export function iconUrlForEmoji(emoji: string | null | undefined): string | null {
  if (!emoji) return null;
  // Emoji vary by presentation selector (U+FE0F), so compare without it.
  const bare = emoji.replace(/️/g, "");
  for (const [key, icon] of BY_EMOJI) {
    if (key.replace(/️/g, "") === bare) return taskIconUrl(icon.id);
  }
  return null;
}
