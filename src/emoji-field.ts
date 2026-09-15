// What is allowed in an `emoji` field, in one place.
//
// Seven routes accepted `String(body.emoji ?? "").trim()` — any string, any length. The
// kid tablet drew several of them into HTML without escaping, so the field was a way to
// put markup on somebody else's screen. The escaping is fixed where it belongs, in the
// views; this closes the same hole at the source, so a future view that forgets is not
// a second exploit.
//
// It has to stay generous. A flag is two codepoints, a keycap is three, and a family
// with skin tones runs to eleven characters and seven codepoints joined by ZWJ — all of
// them one thing a parent picked on purpose. So the bound is GRAPHEME CLUSTERS, what a
// reader would call "characters", not codepoints and not `.length`.
//
// And it has to be strict about exactly one thing: an emoji field is never markup. No
// legitimate emoji contains `<`, `>`, `&`, a quote, a backslash or a control character.
// Keycap emoji do contain ASCII (`#️⃣`, `1️⃣`), which is why this is a deny-list of the
// characters that mean something to an HTML parser rather than an allow-list of scripts.

/**
 * Characters that can end an HTML text node or an attribute, plus C0/C1 controls.
 *
 * The control range is written as \u escapes, not as the characters themselves. The first
 * draft put raw bytes in the class; Bun parsed it here and rejected it in CI with
 * "range out of order in character class", which took 23 test files down at import.
 */
const MARKUP = /[<>&"'`\\]|[\u0000-\u001F\u007F-\u009F]/u;  // escapes, never literal control bytes

/** Two grapheme clusters: enough for an emoji plus a variation selector's worth of taste. */
const MAX_GRAPHEMES = 2;

/** A hard ceiling on raw length as well, so a pathological cluster cannot smuggle bulk in. */
const MAX_CHARS = 64;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemeCount(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n += 1;
  return n;
}

/** Is this something a parent could have picked out of an emoji keyboard? */
export function isValidEmoji(raw: string): boolean {
  if (raw.length === 0 || raw.length > MAX_CHARS) return false;
  if (MARKUP.test(raw)) return false;
  return graphemeCount(raw) <= MAX_GRAPHEMES;
}

/**
 * Read an `emoji` off a request body.
 *
 * Returns the trimmed value, `fallback` when the field is absent or empty, or `null`
 * when the caller sent something that is not an emoji — which the route turns into a
 * 400 rather than storing. Silently substituting the fallback would hide a client bug
 * and, worse, hide an attempt.
 */
export function readEmoji(raw: unknown, fallback: string): string | null {
  if (raw === undefined || raw === null) return fallback;
  const s = String(raw).trim();
  if (s === "") return fallback;
  return isValidEmoji(s) ? s : null;
}

/**
 * The same read for a field that is OPTIONAL — a create where the repo supplies the
 * default, or a patch where an absent field means "leave it alone".
 *
 *   undefined  the caller did not send one
 *   string     a real emoji
 *   null       the caller sent something that is not one -> the route answers 400
 *
 * It exists so no call site has to write `readEmoji(x, "") || undefined`, which turns
 * the `null` back into `undefined` BEFORE the check and silently stores nothing while
 * answering 200. That is not hypothetical: it is what the first draft of this change
 * did on `PATCH /api/routines/:id`, and the route test caught it.
 */
export function readOptionalEmoji(raw: unknown): string | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === "") return undefined;
  return isValidEmoji(s) ? s : null;
}

/** The 400 every route answers with, so the error string is written down once. */
export const INVALID_EMOJI = { error: "invalid_emoji" } as const;
