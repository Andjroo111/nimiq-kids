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
// NO ICON ART SHIPS RIGHT NOW (2026-09-15, with the stickers: sticker-catalog.ts has the
// story). The table below stays because it is what the picker offers and what a job STORES
// (its emoji); only the picture behind each row is gone, so every card draws its emoji, the
// same path a parent's own emoji always took. Flip `TASK_ICON_ART_SHIPPED` when the files
// are back under public/assets/icons/<id>.png.

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
  { id: "dogbowl", emoji: "🐶", label: "Feed the pet" },
  { id: "laundry", emoji: "🧺", label: "Laundry" },
  { id: "plant", emoji: "🪴", label: "Plants" },
  { id: "trash", emoji: "🗑️", label: "Bins" },
  { id: "pajamas", emoji: "🩳", label: "Pyjamas" },
  { id: "backpack", emoji: "🎒", label: "School bag" },
  { id: "piano", emoji: "🎹", label: "Piano" },
  { id: "shoes", emoji: "👟", label: "Shoes" },
  { id: "towel", emoji: "🛁", label: "Bath" },

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

/** Whether the drawn icons are in the tree. title-catalog.test.ts gates on it. */
export const TASK_ICON_ART_SHIPPED = false;

export const taskIconUrl = (id: string): string | null =>
  TASK_ICON_ART_SHIPPED ? `/assets/icons/${id}.png` : null;

const BY_EMOJI = new Map(TASK_ICONS.map((i) => [i.emoji, i]));

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
