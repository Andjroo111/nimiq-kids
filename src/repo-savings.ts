// WHAT A KID IS SAVING FOR, and how close they are (#354, epic #350).
//
// THIS IS A MIRROR, NOT A JAR — see schema.sql. The meter is `balance / target` and nothing more:
// no NIM is moved and nothing is reserved, so this module has no contact at all with the spend
// serialization in repo-wallet.ts. Everything here is a row and some arithmetic, which is exactly
// why it is safe to put in front of a kid first.
//
// The READ MODEL is the point of the file. `targetView` is the one place that turns a row plus a
// balance into the numbers a screen draws, so the kid app, the parent board and anything later
// are one number rather than three roundings of it.

import { getDb } from "./db";

// Same two-liner repo-goals.ts and repo.ts carry: there is no ids module in this tree.
const uid = () => crypto.randomUUID();
const now = () => Date.now();

export interface SavingsTarget {
  id: string; family_id: string; child_id: string;
  title: string; title_key: string | null; emoji: string | null;
  target_luna: number;
  item_id: string | null;
  active: number;
  created_at: number;
  /** First time the balance touched the target. Never cleared. */
  reached_at: number | null;
}

/** What a screen draws. `pct` is clamped, `remainingLuna` floors at zero. */
export interface SavingsView {
  target: SavingsTarget;
  balanceLuna: number;
  remainingLuna: number;
  pct: number;
  reached: boolean;
}

/** The kid's one active target, or null. */
export function activeTarget(childId: string): SavingsTarget | null {
  return (getDb().query(
    "SELECT * FROM savings_targets WHERE child_id=? AND active=1",
  ).get(childId) as SavingsTarget) ?? null;
}

export function getTarget(id: string): SavingsTarget | null {
  return (getDb().query("SELECT * FROM savings_targets WHERE id=?").get(id) as SavingsTarget) ?? null;
}

/**
 * Start saving for something. Retires whatever the kid was saving for first.
 *
 * The retire-then-insert is not politeness, it is what keeps the partial unique index satisfiable:
 * `idx_savings_target_active` allows exactly one active row per child, so a second insert without
 * it throws a constraint error rather than quietly creating a second meter. Doing it here means
 * the rule is enforced in ONE place by the database and honoured in one place by the code.
 *
 * The old row is kept, not deleted. What a kid used to be saving for is a real thing that
 * happened, and `reached_at` on an abandoned target is a moment worth not destroying.
 */
export function setTarget(
  familyId: string, childId: string,
  fields: { title: string; targetLuna: number; emoji?: string | null; titleKey?: string | null; itemId?: string | null },
): SavingsTarget {
  const db = getDb();
  db.run("UPDATE savings_targets SET active=0 WHERE child_id=? AND active=1", [childId]);
  const t: SavingsTarget = {
    id: uid(), family_id: familyId, child_id: childId,
    title: fields.title, title_key: fields.titleKey ?? null, emoji: fields.emoji ?? null,
    target_luna: Math.max(1, Math.round(fields.targetLuna)),
    item_id: fields.itemId ?? null,
    active: 1, created_at: now(), reached_at: null,
  };
  db.run(
    `INSERT INTO savings_targets (id, family_id, child_id, title, title_key, emoji, target_luna, item_id, active, created_at, reached_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [t.id, t.family_id, t.child_id, t.title, t.title_key, t.emoji, t.target_luna, t.item_id, t.active, t.created_at, t.reached_at],
  );
  return t;
}

/** Stop saving for it without starting anything else. */
export function clearTarget(childId: string): boolean {
  return getDb().run(
    "UPDATE savings_targets SET active=0 WHERE child_id=? AND active=1", [childId],
  ).changes > 0;
}

/** Move the goalposts. Only the target's own fields; never the child or the family. */
export function updateTarget(
  id: string, patch: { title?: string; targetLuna?: number; emoji?: string | null; titleKey?: string | null },
): SavingsTarget | null {
  const fields: string[] = []; const vals: (string | number | null)[] = [];
  if (patch.title !== undefined) { fields.push("title=?"); vals.push(patch.title); }
  if (patch.emoji !== undefined) { fields.push("emoji=?"); vals.push(patch.emoji); }
  // Renaming CLEARS title_key, the same rule updateChore and updateRoutine follow: a row the
  // parent has retyped is no longer the catalogue's to translate.
  if (patch.title !== undefined && patch.titleKey === undefined) { fields.push("title_key=?"); vals.push(null); }
  if (patch.titleKey !== undefined) { fields.push("title_key=?"); vals.push(patch.titleKey); }
  if (patch.targetLuna !== undefined) { fields.push("target_luna=?"); vals.push(Math.max(1, Math.round(patch.targetLuna))); }
  if (!fields.length) return getTarget(id);
  getDb().run(`UPDATE savings_targets SET ${fields.join(", ")} WHERE id=?`, [...vals, id]);
  return getTarget(id);
}

/**
 * Stamp the moment the kid first got there. Idempotent: the first call wins and every later one
 * is a no-op, which is what `WHERE reached_at IS NULL` buys.
 *
 * ⚠️ NOT CLEARED WHEN THE BALANCE FALLS BACK. A mirror follows the balance down, so a kid who
 * reaches 100 NIM and then spends 40 is at 60% again — but they DID get there, and un-stamping it
 * would rewrite that. `reached` in the view reads this column, never the current percentage.
 */
export function markReached(id: string, at = now()): boolean {
  return getDb().run(
    "UPDATE savings_targets SET reached_at=? WHERE id=? AND reached_at IS NULL", [at, id],
  ).changes > 0;
}

/**
 * The ONE place a row plus a balance becomes the numbers a screen draws.
 *
 * `pct` is clamped at 100 so a meter cannot overflow its own track, and floored so it never
 * rounds 99.6% up to a full bar the kid has not earned. `remainingLuna` floors at zero for the
 * same reason in the other direction: "you need -12 NIM" is not a sentence.
 */
export function targetView(target: SavingsTarget, balanceLuna: number): SavingsView {
  const pct = target.target_luna > 0
    ? Math.min(100, Math.floor((balanceLuna / target.target_luna) * 100))
    : 0;
  return {
    target,
    balanceLuna,
    remainingLuna: Math.max(0, target.target_luna - balanceLuna),
    pct,
    reached: target.reached_at !== null,
  };
}

/**
 * Read the kid's meter, stamping `reached_at` if this is the moment they got there.
 *
 * The stamp lives on the READ deliberately. There is no event to hang it off: nothing "credits" a
 * mirror, the balance simply moves for a dozen reasons (a chore paid, a gift, a purchase refunded)
 * and hooking every one of them would be the same rule written a dozen times, missed on the
 * thirteenth. A read is the moment anybody could observe it, which makes it the honest place.
 */
export function readMeter(childId: string, balanceLuna: number): SavingsView | null {
  const t = activeTarget(childId);
  if (!t) return null;
  if (t.reached_at === null && balanceLuna >= t.target_luna) {
    const at = now();
    if (markReached(t.id, at)) t.reached_at = at;
  }
  return targetView(t, balanceLuna);
}
