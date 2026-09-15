// The switch gate (#123): what it costs to become a different kid on the family tablet.
//
// THE HOLE. The shared tablet on the kitchen counter is the target household, not an edge
// case. Tapping your own name opened the me-sheet, "Switch kid" dropped straight to the
// avatar roster, and tapping a sibling's face handed over their wallet screen, their Send
// button and their Treasure Box balance. The server agreed: childMoneyGate accepted any
// child in the bearer's household. Every other money control in this app — spend locks,
// approval gates, payout-exactly-once — was intact and simply not consulted, because the
// trust model said a device speaks for the whole family.
//
// WHY A PICTURE AND NOT A PIN. The app already has a family PIN with a working lockout, and
// gating on it would have been a tenth of this code. It is the wrong answer: a four-year-old
// cannot type four digits and would need a parent to get into their OWN app, every time. So
// the secret is a short SEQUENCE OF PICTURES the kid picks and can recognise before they can
// read. The family PIN stays as the override, for the kid who forgets.
//
// WHY IT DOES NOT LOCK ANYONE OUT. A kid with no secret is gated by nothing, which is exactly
// today's behaviour. The first time a kid is opened on a tablet they pick their pictures and
// are protected from then on. That means the enrolment tap itself is unguarded — a sibling
// could get there first — and that is deliberate: before enrolment the account is open to
// that sibling ANYWAY, so it is never worse than the state it replaces. CHANGING an existing
// secret is what needs proof, and that requires the old secret or the family PIN.
//
// GUESSING. 12 pictures and 2 taps is 144 combinations, which is not a lot, so the brake is
// doing real work here rather than decorating. It is the shared per-caller limiter, which
// is in-memory and resets on restart: sibling-proof, not attacker-proof, and matched to a
// threat model where the adversary is standing in the kitchen.

import * as repo from "./repo";
import { getDb } from "./db";
import { allow } from "./rate-limit";

/**
 * The pictures a kid chooses from. Twelve, because the grid has to stay tappable with a
 * four-year-old's finger on the narrowest phone the kid app supports, and every one has to
 * be nameable out loud by a child who cannot read ("the rocket, then the frog") — that is
 * how a parent helps without seeing the screen. No faces, no food that could be a reward,
 * nothing that collides with the sticker packs a kid already owns.
 *
 * ORDER IS THE STORED SECRET. Indices are what cross the wire and what gets hashed, so
 * reordering this array silently invalidates every kid's secret. Append only.
 *
 * ART. Each picture is a drawn PNG, from the same locked Higgsfield prompt as the chore
 * icons (see task-icons.ts) — objects on flat white, bold navy outline, readable at 40px.
 * The emoji stays as the label, the crash fallback and the thing a parent says out loud,
 * exactly as it does for a task icon; only the rendering changed.
 *
 * The emoji and its art are ONE ROW here rather than two parallel arrays. Drift between
 * them would not throw — it would quietly draw the wrong picture at an index, which for
 * this screen means a kid tapping what they remember and being told they are wrong.
 */
// ⚠️ THE SET CHANGED ON 2026-09-01, AND A CHANGE HERE LOCKS OUT EVERY ENROLLED KID. A secret
// is a pair of INDEXES, so swapping the subject at an index does not throw and does not fail a
// single test outside the golden list below — the kid simply taps the picture they remember,
// which is no longer there, and is told they are wrong. Both live kids' `kid_switch_secrets`
// rows were deleted in the same change so they re-enrol against the set they can actually see.
//
// The mix is deliberate (Andjroo: "we should have like a combination between more boy versus
// more girl stuff"): four that lean boy, four that lean girl, four that lean neither, and
// twelve silhouettes that stay apart from each other at 60px.
const PICTURES = [
  { emoji: "🚀", art: "rocket" },
  { emoji: "🏎️", art: "car" },
  { emoji: "⚽", art: "ball" },
  { emoji: "🚂", art: "train" },
  { emoji: "🦋", art: "butterfly" },
  { emoji: "🌼", art: "flower" },
  { emoji: "🧁", art: "cupcake" },
  { emoji: "⭐", art: "star" },
  { emoji: "🎸", art: "guitar" },
  { emoji: "🌙", art: "moon" },
  { emoji: "🦕", art: "dino" },
  { emoji: "🦄", art: "unicorn" },
] as const;

export const SWITCH_PICTURES: readonly string[] = PICTURES.map((p) => p.emoji);

/** Whether the drawn pictures are in the tree. False since 2026-09-15 (the art repass,
 *  sticker-catalog.ts has the story); the gate draws the emoji, the crash path it always had.
 *  ⚠️ This does NOT lock anyone out: the SUBJECT at each index is unchanged, so the rocket a
 *  kid remembers is still the rocket, drawn as its emoji. Only a change to PICTURES does. */
export const SWITCH_ART_SHIPPED = false;

/** The drawn picture at an index, paired with the emoji it replaces. `url` is null while no
 *  art ships; switch-gate.js draws the emoji for a null url. */
export const switchPictureArt = (i: number): { emoji: string; url: string | null } | null =>
  PICTURES[i]
    ? { emoji: PICTURES[i]!.emoji, url: SWITCH_ART_SHIPPED ? `/assets/secret/${PICTURES[i]!.art}.png` : null }
    : null;

/** The whole grid, in stored-secret order, for the route and for tests. */
export const switchPictureGrid = () => PICTURES.map((_, i) => switchPictureArt(i)!);

/** How many taps make a secret. Two of twelve is 144, which the brake below is sized for. */
export const SWITCH_SECRET_TAPS = 2;

/** Wrong guesses per caller per minute, across every kid on the instance. */
const GUESS_MAX_PER_MIN = Number(process.env.HATCH_SWITCH_GUESSES_PER_MIN ?? 8);
const GUESS_WINDOW_MS = 60 * 1000;

/**
 * The wire form of a secret: tap indices joined by `-`, e.g. `"3-7"`.
 *
 * Indices rather than the emoji themselves, and it is not a style choice. An emoji is a
 * grapheme cluster, not a character: 🇺🇸 is two codepoints, 👨‍👩‍👧‍👦 is seven, and any of
 * them can arrive normalised differently by a keyboard, a WebView or a JSON round trip. A
 * secret that compares equal on one device and not on another is a kid locked out of their
 * own tablet with nothing on screen to explain it. Integers do not have variants.
 */
export function parseSecret(raw: unknown): number[] | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split("-");
  if (parts.length !== SWITCH_SECRET_TAPS) return null;
  const idx: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,2}$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n >= SWITCH_PICTURES.length) return null;
    idx.push(n);
  }
  return idx;
}

const canonical = (idx: number[]) => idx.join("-");

// ---- storage ----

interface SecretRow { child_id: string; secret_hash: string; created_at: number; updated_at: number }

function secretRow(childId: string): SecretRow | null {
  return (getDb().query("SELECT * FROM kid_switch_secrets WHERE child_id=?").get(childId) as SecretRow) ?? null;
}

/** Whether this kid is gated at all. The ONLY thing about a secret that may be published. */
export function hasSwitchSecret(childId: string): boolean {
  return !!secretRow(childId);
}

/** Every gated kid in a household, for the roster's lock badges — ids only, never hashes. */
export function gatedChildIds(familyId: string): string[] {
  const rows = getDb().query(
    `SELECT s.child_id AS id FROM kid_switch_secrets s
       JOIN children c ON c.id = s.child_id
      WHERE c.family_id = ?`,
  ).all(familyId) as { id: string }[];
  return rows.map((r) => r.id);
}

export async function setSwitchSecret(childId: string, idx: number[]): Promise<void> {
  const hash = await Bun.password.hash(canonical(idx));
  const now = Date.now();
  getDb().run(
    `INSERT INTO kid_switch_secrets (child_id, secret_hash, created_at, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(child_id) DO UPDATE SET secret_hash=excluded.secret_hash, updated_at=excluded.updated_at`,
    [childId, hash, now, now],
  );
}

/** Forget a kid's secret, so the next open re-enrols them. The parent's reset path. */
export function clearSwitchSecret(childId: string): void {
  getDb().run("DELETE FROM kid_switch_secrets WHERE child_id=?", [childId]);
}

export type SecretCheck =
  | { ok: true }
  | { ok: false; error: "no_secret" | "wrong_secret" | "too_many_guesses" };

/**
 * Does `raw` open this kid?
 *
 * The brake is charged on a MISS only, after the comparison, so a household typing their
 * own pictures correctly never touches it — same shape as the pair-code budget. It is
 * keyed per caller rather than per kid: keying on the kid would let a sibling burn a
 * child's allowance and lock them out of their own tablet, which turns the gate into the
 * attack.
 */
export async function checkSwitchSecret(
  childId: string, raw: unknown, callerKey: string,
): Promise<SecretCheck> {
  const row = secretRow(childId);
  if (!row) return { ok: false, error: "no_secret" };
  const idx = parseSecret(raw);
  // A malformed body is a wrong guess, not a free one: otherwise the shape check is the
  // oracle and an attacker enumerates without ever paying the brake.
  if (!idx) {
    if (!allow(`switch:${callerKey}`, GUESS_MAX_PER_MIN, GUESS_WINDOW_MS)) {
      return { ok: false, error: "too_many_guesses" };
    }
    return { ok: false, error: "wrong_secret" };
  }
  const good = await Bun.password.verify(canonical(idx), row.secret_hash).catch(() => false);
  if (good) return { ok: true };
  if (!allow(`switch:${callerKey}`, GUESS_MAX_PER_MIN, GUESS_WINDOW_MS)) {
    return { ok: false, error: "too_many_guesses" };
  }
  return { ok: false, error: "wrong_secret" };
}

/**
 * Is this device allowed to act as this kid right now?
 *
 * The whole gate, in one predicate, so the money routes and the switch route cannot answer
 * it differently — the failure this repo has paid for twice is a question written down in
 * two places that agree until one of them is edited.
 *
 * An ungated kid passes: a household that has not enrolled anyone behaves exactly as it did
 * before this shipped.
 */
export function deviceMayActAs(device: { unlocked_child_id: string | null }, childId: string): boolean {
  if (!hasSwitchSecret(childId)) return true;
  return device.unlocked_child_id === childId;
}

/** Hand this device to a kid. Replaces whoever it was acting as; there is only ever one. */
export function unlockDeviceFor(deviceId: string, childId: string): void {
  getDb().run("UPDATE devices SET unlocked_child_id=? WHERE id=?", [childId, deviceId]);
}

/** Every device a kid is currently open on, so revoking a secret can close them. */
export function lockDevicesFor(childId: string): number {
  return getDb().run("UPDATE devices SET unlocked_child_id=NULL WHERE unlocked_child_id=?", [childId]).changes;
}

export type { SecretRow };
export const _forTests = { secretRow, canonical, repo };
