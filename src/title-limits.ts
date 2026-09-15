// What a human-typed job title is allowed to be.
//
// `POST /api/chores` accepted a 5,000 character title, a `<script>` tag, null bytes and a
// 50 emoji flood, all 201 (#132, found on the funded mainnet E2E run). Nothing was
// injected — titles render escaped, and that was verified against the real parent page —
// so this is storage bloat and a rendering question rather than a hole. Kid and parent
// labels have been capped at 24 characters since children.ts was written; a chore title
// was capped at nothing, for no reason anyone recorded.

/** The longest job in the catalog is "Finish a Brilliant algebra lesson", 33 characters.
 *  60 leaves a parent room to write their own without leaving room for a paragraph. */
export const TITLE_MAX = 60;

export type TitleResult =
  | { ok: true; title: string }
  | { ok: false; error: "title_required" | "title_too_long" };

/**
 * Normalize then judge. Returns the cleaned title or the error code to answer 400 with.
 *
 * REJECTS rather than truncating, matching `label_too_long` on children.ts:20. A silently
 * truncated title is worse than a refused one: the parent's phone shows what they typed,
 * the kid's tablet shows the stump, and neither device is wrong about what it was told.
 *
 * Control characters are STRIPPED rather than rejected, because they are invisible — a
 * parent who pasted a title out of a notes app cannot see what is being complained about.
 * Newlines go with them: a title is one line by definition and a second line does not
 * wrap in the card, it pushes the reward off it.
 */
export function normalizeTitle(raw: unknown): TitleResult {
  const cleaned = String(raw ?? "")
    // C0, DEL and C1. Includes NUL, which SQLite stores happily and which truncates the
    // string in anything that later reads it as C.
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { ok: false, error: "title_required" };
  // Code POINTS, not UTF-16 units: an emoji is two units, so a length check would let
  // exactly half as many of them through as it lets ASCII, which is arbitrary rather
  // than a rule anyone could predict.
  if ([...cleaned].length > TITLE_MAX) return { ok: false, error: "title_too_long" };
  return { ok: true, title: cleaned };
}
