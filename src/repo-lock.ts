// Devices, lock windows, overrides, parent tokens (family mode). The lock STATE
// MACHINE itself lands in Phase B (src/lock-machine.ts); these are its inputs.

import { getDb } from "./db";

export interface Device {
  id: string; family_id: string; label: string; child_id: string | null;
  token_hash: string; allowed_apps: string; installed_apps: string;
  /** Which kid this shared tablet is currently acting as (#123). NOT `child_id`: that is
   *  the permanent binding set at pairing, this is the live session and changes whenever a
   *  kid passes the switch gate. Null = not unlocked. */
  unlocked_child_id: string | null;
  /** The charge as the tablet last reported it (§11). All null until it ever has. */
  battery_pct: number | null;
  battery_charging: number | null;
  battery_at: number | null;
  last_seen_at: number | null; created_at: number;
}
export interface LockWindow {
  id: string; routine_id: string; start_hhmm: string; end_hhmm: string; days: string;
}
/** The curfew. Same three columns as LockWindow and the OPPOSITE meaning: a lock window is
 *  a chore deadline, an allow window is the hours the tablet works at all (schema.sql). */
export interface AllowWindow {
  id: string; family_id: string; start_hhmm: string; end_hhmm: string; days: string;
}
/** One kid's meter for one local day. Absent = nothing used yet; see schema.sql on why
 *  there is no daily reset job. */
export interface ScreenUsage {
  child_id: string; local_day: string; used_sec: number; earned_sec: number; updated_at: number;
  /** Seconds burned in the current sitting, as of the last tick. See `sittingAfterRest`. */
  sitting_sec: number;
  /** When the tablet last reported burning today. 0 = not yet. */
  last_burn_at: number;
}
/** Who wrote an override. See `activeOverride` for what the difference buys. */
export type OverrideSource = "parent" | "purchase";
export interface LockOverride {
  id: string; family_id: string; child_id: string | null; mode: "lock" | "unlock";
  source: OverrideSource;
  until_ms: number | null; cleared_at: number | null; created_at: number;
}
export interface ParentToken {
  id: string; family_id: string; token_hash: string; label: string;
  /** The grown-up holding this phone (family_members.id). NULL = minted before members
   *  existed, and reads as the household's owner. */
  member_id: string | null;
  created_at: number; last_used_at: number | null;
}

const uid = () => crypto.randomUUID();
const now = () => Date.now();

// ---- devices ----
export function createDevice(familyId: string, label: string, tokenHash: string, childId: string | null): Device {
  const d: Device = {
    id: uid(), family_id: familyId, label, child_id: childId,
    token_hash: tokenHash, allowed_apps: "[]", installed_apps: "[]",
    unlocked_child_id: null, last_seen_at: null, created_at: now(),
    battery_pct: null, battery_charging: null, battery_at: null,
  };
  getDb().run(
    "INSERT INTO devices (id, family_id, label, child_id, token_hash, allowed_apps, installed_apps, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [d.id, d.family_id, d.label, d.child_id, d.token_hash, d.allowed_apps, d.installed_apps, d.created_at],
  );
  return d;
}
export function getDevice(id: string): Device | null {
  return (getDb().query("SELECT * FROM devices WHERE id=?").get(id) as Device) ?? null;
}
export function listDevices(familyId: string): Device[] {
  return getDb().query("SELECT * FROM devices WHERE family_id=? ORDER BY created_at").all(familyId) as Device[];
}
export function findDeviceByTokenHash(tokenHash: string): Device | null {
  const d = (getDb().query("SELECT * FROM devices WHERE token_hash=?").get(tokenHash) as Device) ?? null;
  if (d) getDb().run("UPDATE devices SET last_seen_at=? WHERE id=?", [now(), d.id]);
  return d;
}
/**
 * Does this household have a tablet at all?
 *
 * An unlock override is only ever obeyed by a paired device — nothing else in the world
 * reads one — so this is what stands between the Treasure Box and selling minutes that
 * cannot exist (#306). A COUNT rather than `listDevices().length`, because the shelf asks
 * it on every read of every kid's Box and the rows are never needed.
 */
export function familyHasDevice(familyId: string): boolean {
  const row = getDb().query("SELECT 1 FROM devices WHERE family_id=? LIMIT 1").get(familyId);
  return row !== null && row !== undefined;
}

export function setAllowedApps(deviceId: string, packages: string[]): void {
  getDb().run("UPDATE devices SET allowed_apps=? WHERE id=?", [JSON.stringify(packages), deviceId]);
}
/** The wrapper's installed-app report: [{ pkg, label }]. Stored verbatim as JSON. */
/** The charge as the tablet reads it (§11). The device row carries the latest for the parent
 *  screen; `device_battery` keeps every accepted report for 30 days, pruned here, because
 *  "are they dying fast" is answered by a day's curve and not by one number. */
export function noteBattery(deviceId: string, pct: number, charging: boolean, nowMs = Date.now()): void {
  const db = getDb();
  const on = charging ? 1 : 0;
  db.run("UPDATE devices SET battery_pct=?, battery_charging=?, battery_at=? WHERE id=?", [pct, on, nowMs, deviceId]);
  db.run("INSERT OR REPLACE INTO device_battery (device_id, at, pct, charging) VALUES (?,?,?,?)", [deviceId, nowMs, pct, on]);
  db.run("DELETE FROM device_battery WHERE device_id=? AND at < ?", [deviceId, nowMs - 30 * 86_400_000]);
}
export interface BatteryPoint { at: number; pct: number; charging: number }
export function batteryHistory(deviceId: string, sinceMs: number): BatteryPoint[] {
  return getDb().query("SELECT at, pct, charging FROM device_battery WHERE device_id=? AND at>=? ORDER BY at")
    .all(deviceId, sinceMs) as BatteryPoint[];
}

export function setInstalledApps(deviceId: string, apps: { pkg: string; label: string }[]): void {
  getDb().run("UPDATE devices SET installed_apps=? WHERE id=?", [JSON.stringify(apps), deviceId]);
}

/**
 * Cut a tablet off. The row IS the credential — `findDeviceByTokenHash` is the only
 * thing that turns a bearer into a device — so deleting it revokes the token on the
 * very next call, with no flag for a lookup to forget to check.
 *
 * Hard delete rather than a `revoked_at` column on purpose: a revoked device has
 * nothing left worth keeping (a label and an app allowlist), and a nullable column
 * would mean a migration, which is the one change in this tree with a history of
 * killing boot on real databases while the fresh-DB tests stay green.
 */
export function deleteDevice(id: string): boolean {
  return getDb().run("DELETE FROM devices WHERE id=?", [id]).changes > 0;
}

/** Every tablet in the household, gone. Returns how many. */
export function deleteDevicesForFamily(familyId: string): number {
  return getDb().run("DELETE FROM devices WHERE family_id=?", [familyId]).changes;
}

// ---- lock windows ----
export function addLockWindow(routineId: string, startHhmm: string, endHhmm: string, days = "1111100"): LockWindow {
  const w: LockWindow = { id: uid(), routine_id: routineId, start_hhmm: startHhmm, end_hhmm: endHhmm, days };
  getDb().run(
    "INSERT INTO lock_windows (id, routine_id, start_hhmm, end_hhmm, days) VALUES (?,?,?,?,?)",
    [w.id, w.routine_id, w.start_hhmm, w.end_hhmm, w.days],
  );
  return w;
}
export function windowsForChild(childId: string): (LockWindow & { child_id: string })[] {
  return getDb().query(
    `SELECT w.*, r.child_id AS child_id FROM lock_windows w JOIN routines r ON w.routine_id = r.id
      WHERE r.child_id=? AND r.active=1`,
  ).all(childId) as (LockWindow & { child_id: string })[];
}

// ---- the curfew (allow_windows) ----

export function addAllowWindow(familyId: string, startHhmm: string, endHhmm: string, days = "1111111"): AllowWindow {
  const w: AllowWindow = { id: uid(), family_id: familyId, start_hhmm: startHhmm, end_hhmm: endHhmm, days };
  getDb().run(
    "INSERT INTO allow_windows (id, family_id, start_hhmm, end_hhmm, days) VALUES (?,?,?,?,?)",
    [w.id, w.family_id, w.start_hhmm, w.end_hhmm, w.days],
  );
  return w;
}
export function allowWindowsForFamily(familyId: string): AllowWindow[] {
  return getDb().query(
    "SELECT * FROM allow_windows WHERE family_id=? ORDER BY start_hhmm, end_hhmm, rowid",
  ).all(familyId) as AllowWindow[];
}
export function deleteAllowWindow(id: string, familyId: string): boolean {
  // family_id in the WHERE, not checked by the caller: this is the only thing standing
  // between one household's parent and another household's curfew.
  return getDb().run("DELETE FROM allow_windows WHERE id=? AND family_id=?", [id, familyId]).changes > 0;
}
export function replaceAllowWindows(
  familyId: string, windows: { startHhmm: string; endHhmm: string; days: string }[],
): AllowWindow[] {
  const db = getDb();
  // One transaction: a half-applied curfew is a tablet with the wrong hours, and the
  // parent screen edits the whole schedule at once anyway.
  db.run("BEGIN");
  try {
    db.run("DELETE FROM allow_windows WHERE family_id=?", [familyId]);
    for (const w of windows) addAllowWindow(familyId, w.startHhmm, w.endHhmm, w.days);
    db.run("COMMIT");
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
  return allowWindowsForFamily(familyId);
}

// ---- the screen-time meter (screen_usage) ----

export function usageFor(childId: string, localDay: string): ScreenUsage | null {
  return (getDb().query("SELECT * FROM screen_usage WHERE child_id=? AND local_day=?")
    .get(childId, localDay) as ScreenUsage) ?? null;
}

/**
 * Add seconds the tablet says it burned. Returns the row after the add.
 *
 * ACCUMULATES rather than sets, and that is the whole contract: the wrapper reports a
 * DELTA since its last successful sync, because a tablet that went offline for an hour
 * and came back with an absolute total would either lose the offline time (if the server
 * had also been counting) or double it. A delta is idempotent-ish in the only direction
 * that matters -- a dropped report under-counts by one tick, a retried one over-counts by
 * one tick, and neither can rewrite a whole day.
 *
 * Negative deltas are floored at 0 so a buggy or hostile client cannot mint time.
 */
export function addUsageSec(
  childId: string, localDay: string, deltaSec: number, nowMs = Date.now(),
  rest: { restSec: number } | null = null,
): ScreenUsage {
  const add = Math.max(0, Math.round(deltaSec));
  getDb().run(
    `INSERT INTO screen_usage (child_id, local_day, used_sec, earned_sec, updated_at)
     VALUES (?,?,?,0,?)
     ON CONFLICT(child_id, local_day) DO UPDATE SET used_sec = used_sec + ?, updated_at = ?`,
    [childId, localDay, add, nowMs, add, nowMs],
  );
  if (add > 0) noteSitting(childId, localDay, add, nowMs, rest);
  return usageFor(childId, localDay)!;
}

/**
 * Seconds of the current sitting still standing at `nowMs`.
 *
 * A sitting is what a kid burned since they last RESTED, and a rest is SILENCE: the wrapper
 * reports only while burning, so "nothing reported for a whole rest" is the rest, whether it
 * began with a lock or with the kid wandering off. A pause shorter than the rest does not
 * reset anything -- five minutes away is still the same sitting -- which is the rule that
 * keeps "thirty minutes, then a break" from being gamed by walking away for one.
 *
 * Both readers use this: the tick (to know whether to start a fresh sitting) and the state
 * (to know whether the one on the row still counts), so they cannot disagree.
 */
export function sittingAfterRest(row: ScreenUsage | null, restSec: number, nowMs: number): number {
  if (!row || row.last_burn_at === 0) return 0;
  return nowMs - row.last_burn_at >= restSec * 1000 ? 0 : row.sitting_sec;
}

/** Extend or restart the sitting with the seconds a tick just added. With no rule the sitting
 *  is kept at 0 but `last_burn_at` still moves, so a rule switched on mid-day measures from
 *  the truth rather than from a sitting that began at midnight. */
function noteSitting(childId: string, localDay: string, add: number, nowMs: number, rest: { restSec: number } | null): void {
  const on = !!rest && rest.restSec > 0;
  const sitting = on ? sittingAfterRest(usageFor(childId, localDay), rest!.restSec, nowMs) + add : 0;
  getDb().run(
    "UPDATE screen_usage SET sitting_sec=?, last_burn_at=? WHERE child_id=? AND local_day=?",
    [sitting, nowMs, childId, localDay],
  );
}

/** Minutes a kid bought in the Treasure Box, added to TODAY only. Same accumulate shape as
 *  usage; the per-day cap is enforced by the caller, which is the only place that knows
 *  what the kid's `max_earned_min` is. */
export function addEarnedSec(childId: string, localDay: string, deltaSec: number, nowMs = Date.now()): ScreenUsage {
  const add = Math.max(0, Math.round(deltaSec));
  getDb().run(
    `INSERT INTO screen_usage (child_id, local_day, used_sec, earned_sec, updated_at)
     VALUES (?,?,0,?,?)
     ON CONFLICT(child_id, local_day) DO UPDATE SET earned_sec = earned_sec + ?, updated_at = ?`,
    [childId, localDay, add, nowMs, add, nowMs],
  );
  return usageFor(childId, localDay)!;
}

/** One routine's schedule, in the order a parent reads a day: earliest start first.
 *  `windowsForChild` above is what the LOCK MACHINE asks; this is what the parent's
 *  routine card draws, so it is by routine and it does not care whether the routine is
 *  active — a retired routine still shows the schedule it would resume with. */
export function listWindows(routineId: string): LockWindow[] {
  return getDb().query(
    "SELECT * FROM lock_windows WHERE routine_id=? ORDER BY start_hhmm, end_hhmm, rowid",
  ).all(routineId) as LockWindow[];
}
export function getLockWindow(id: string): LockWindow | null {
  return (getDb().query("SELECT * FROM lock_windows WHERE id=?").get(id) as LockWindow) ?? null;
}
export function updateLockWindow(id: string, startHhmm: string, endHhmm: string, days: string): void {
  getDb().run(
    "UPDATE lock_windows SET start_hhmm=?, end_hhmm=?, days=? WHERE id=?",
    [startHhmm, endHhmm, days, id],
  );
}

/**
 * A real delete, and the exception to this repo's "nothing is deleted" rule.
 *
 * Everything else a parent takes away — a job, a routine, a rung — is retired rather than
 * dropped, because runs, approvals and sticker placements point at it and have to stay
 * readable. Nothing points at a window: it is a rule about the FUTURE that the machine
 * re-reads on every state computation, and a retired one would be a row that has to be
 * filtered out of `windowsForChild` forever to mean nothing.
 */
export function deleteLockWindow(id: string): boolean {
  return getDb().run("DELETE FROM lock_windows WHERE id=?", [id]).changes > 0;
}

// ---- overrides ----

/**
 * Write an override, superseding any live one BY THE SAME AUTHOR in the same scope.
 *
 * "By the same author" is the whole fix for #301. This used to clear every active row in
 * the scope regardless of who wrote it, so the Treasure Box — which writes an unlock the
 * kid paid for — cleared the parent's grounding on its way past. A kid must not be able to
 * retire a parent's row, and a parent must not silently destroy minutes a kid bought; each
 * author therefore owns exactly one live row per scope, and `activeOverride` decides
 * between them.
 */
export function setOverride(
  familyId: string, mode: "lock" | "unlock", childId: string | null, untilMs: number | null,
  source: OverrideSource = "parent",
): LockOverride {
  getDb().run(
    `UPDATE lock_overrides SET cleared_at=? WHERE family_id=? AND cleared_at IS NULL
       AND source=? AND (child_id IS ? OR child_id=?)`,
    [now(), familyId, source, childId, childId],
  );
  const o: LockOverride = {
    id: uid(), family_id: familyId, child_id: childId, mode, source, until_ms: untilMs,
    cleared_at: null, created_at: now(),
  };
  getDb().run(
    "INSERT INTO lock_overrides (id, family_id, child_id, mode, source, until_ms, created_at) VALUES (?,?,?,?,?,?,?)",
    [o.id, o.family_id, o.child_id, o.mode, o.source, o.until_ms, o.created_at],
  );
  return o;
}

/** Every live override that reaches this kid — their own and the household's — newest first. */
function liveOverrides(familyId: string, childId: string | null, nowMs: number): LockOverride[] {
  const rows = getDb().query(
    `SELECT * FROM lock_overrides WHERE family_id=? AND cleared_at IS NULL
       AND (child_id IS NULL OR child_id=?) ORDER BY created_at DESC, rowid DESC`,
  ).all(familyId, childId) as LockOverride[];
  return rows.filter((o) => o.until_ms === null || o.until_ms >= nowMs);
}

/**
 * The override actually in charge. AUTHOR first, then recency:
 *
 *   1. the newest live PARENT row — a grown-up's word, and the last one they said
 *   2. otherwise the live PURCHASE row — minutes the kid bought
 *   3. otherwise null, and the derived window state stands (src/lock-machine.ts)
 *
 * Recency alone was the bug (#301): a kid opened the Treasure Box during a grounding,
 * spent real NIM on 15 minutes, and their row — being newer — ended the punishment.
 * Authority is not a race, so the tiebreak cannot be one.
 *
 * Rule 1 covers a parent UNLOCK too, which looks like it could truncate purchased minutes
 * but cannot: `setOverride` never clears another author's row, so the purchase is still
 * sitting underneath and reappears intact the moment the parent's row is cleared. The kid
 * loses nothing they would not have lost to the clock anyway.
 */
export function activeOverride(familyId: string, childId: string | null, nowMs = Date.now()): LockOverride | null {
  const live = liveOverrides(familyId, childId, nowMs);
  return live.find((o) => o.source === "parent") ?? live.find((o) => o.source === "purchase") ?? null;
}

/** Is a grown-up holding this kid's screen shut right now? What the Treasure Box asks
 *  before it sells a minute, and what the shelf asks before it draws one. */
export function parentLockActive(familyId: string, childId: string | null, nowMs = Date.now()): boolean {
  const o = activeOverride(familyId, childId, nowMs);
  return o !== null && o.source === "parent" && o.mode === "lock";
}

/**
 * Minutes bought in the Treasure Box, ADDED to the clock the kid already paid for.
 *
 * The second buy used to compute its expiry from `now` and `setOverride` cleared the first
 * row, so buying 15 more minutes with 55 still running left 15 (#302) — fifty-five paid-for
 * minutes destroyed by spending more money. Stacking from the live expiry is what makes a
 * purchase additive, and it belongs here rather than in the route because "a purchase never
 * shortens a purchase" is a property of the row, not of one caller's arithmetic.
 *
 * Only THIS kid's own live purchase extends: a household-wide row is never one a kid bought,
 * and another kid's minutes are not theirs to inherit. An expired purchase is not extended
 * either — the clock restarts from now, which is the same thing the kid would have got had
 * the old row been swept.
 *
 * `nowMs` is injectable so a test can say "five minutes later" without sleeping.
 */
export function extendPurchasedUnlock(
  familyId: string, childId: string, minutes: number, nowMs = Date.now(),
): LockOverride {
  const live = purchasedUnlock(familyId, childId, nowMs);
  const base = live?.until_ms != null && live.until_ms > nowMs ? live.until_ms : nowMs;
  return setOverride(familyId, "unlock", childId, base + minutes * 60_000, "purchase");
}

/**
 * The minutes THIS kid bought and has not used up — whether or not they are the override
 * currently in charge.
 *
 * `activeOverride` answers "what does the tablet do", and a parent's row hides a purchase
 * from that answer completely (author beats recency). The purchase is still sitting
 * underneath, still ticking, and comes back the moment the parent's row is cleared — so a
 * parent screen that shows only the winner tells a grown-up their Clear returns the kid to
 * the schedule when it actually hands back paid minutes. This is the row that makes that
 * sentence sayable, and it is the ONLY extra thing a parent surface needs: which row wins
 * stays a single server-side ruling and is never re-derived on a client.
 *
 * Household-wide rows are excluded on purpose, same as in `extendPurchasedUnlock`: a
 * `child_id IS NULL` row is never one a kid bought.
 */
export function purchasedUnlock(familyId: string, childId: string, nowMs = Date.now()): LockOverride | null {
  return liveOverrides(familyId, childId, nowMs)
    .find((o) => o.source === "purchase" && o.child_id === childId && o.mode === "unlock") ?? null;
}
export function getOverride(id: string): LockOverride | null {
  return (getDb().query("SELECT * FROM lock_overrides WHERE id=?").get(id) as LockOverride) ?? null;
}
export function clearOverride(id: string): void {
  getDb().run("UPDATE lock_overrides SET cleared_at=? WHERE id=?", [now(), id]);
}

// ---- pairing codes (token-handoff fallback) ----
export interface PairCode {
  id: string; family_id: string; code_hash: string;
  expires_at: number; used_at: number | null; created_at: number;
  /** #364: the kid this code binds its tablet to. Null = the household, unbound. */
  child_id: string | null;
}

/** Issue a pairing code for the family. A new code supersedes any live one (at most
 *  one active code per family), and stale rows are swept so the table stays tiny. */
export function createPairCode(
  familyId: string, codeHash: string, ttlMs: number, childId: string | null = null,
): PairCode {
  const nowMs = now();
  getDb().run("DELETE FROM pair_codes WHERE family_id=? OR expires_at<?", [familyId, nowMs]);
  const p: PairCode = {
    id: uid(), family_id: familyId, code_hash: codeHash,
    expires_at: nowMs + ttlMs, used_at: null, created_at: nowMs, child_id: childId,
  };
  getDb().run(
    "INSERT INTO pair_codes (id, family_id, code_hash, expires_at, created_at, child_id) VALUES (?,?,?,?,?,?)",
    [p.id, p.family_id, p.code_hash, p.expires_at, p.created_at, p.child_id],
  );
  return p;
}

/** Race-safe redeem: burns the code (single use) only if it is live, and returns the
 *  row it belonged to. Null on unknown, expired, or already-used codes. */
export function redeemPairCode(codeHash: string, nowMs = Date.now()): PairCode | null {
  const p = (getDb().query(
    "SELECT * FROM pair_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>=?",
  ).get(codeHash, nowMs) as PairCode) ?? null;
  if (!p) return null;
  const res = getDb().run("UPDATE pair_codes SET used_at=? WHERE id=? AND used_at IS NULL", [nowMs, p.id]);
  return res.changes > 0 ? { ...p, used_at: nowMs } : null;
}

// ---- parent tokens ----
/** `memberId` is WHICH grown-up this phone is signed in as (src/repo-members.ts). Optional
 *  because a token minted without one still resolves to the household's owner — see
 *  src/auth.ts bearerParent — which is what every token in existence meant before there was
 *  more than one grown-up to be. */
export function createParentToken(
  familyId: string, label: string, tokenHash: string, memberId?: string | null,
): ParentToken {
  const t: ParentToken = {
    id: uid(), family_id: familyId, token_hash: tokenHash, label,
    member_id: memberId ?? null, created_at: now(), last_used_at: null,
  };
  getDb().run(
    "INSERT INTO parent_tokens (id, family_id, token_hash, label, member_id, created_at) VALUES (?,?,?,?,?,?)",
    [t.id, t.family_id, t.token_hash, t.label, t.member_id, t.created_at],
  );
  return t;
}
export function findParentByTokenHash(tokenHash: string): ParentToken | null {
  const t = (getDb().query("SELECT * FROM parent_tokens WHERE token_hash=?").get(tokenHash) as ParentToken) ?? null;
  if (t) getDb().run("UPDATE parent_tokens SET last_used_at=? WHERE id=?", [now(), t.id]);
  return t;
}
export function listParentTokens(familyId: string): ParentToken[] {
  return getDb().query("SELECT * FROM parent_tokens WHERE family_id=? ORDER BY created_at").all(familyId) as ParentToken[];
}
export function countParentTokens(familyId: string): number {
  const r = getDb().query("SELECT COUNT(*) AS n FROM parent_tokens WHERE family_id=?").get(familyId) as { n: number };
  return r.n;
}
/** Sign a parent phone out. Same reasoning as deleteDevice: the row is the credential. */
export function deleteParentToken(id: string): boolean {
  return getDb().run("DELETE FROM parent_tokens WHERE id=?", [id]).changes > 0;
}
/** Every parent session in the household except `keepId` — the one making the request. */
export function deleteOtherParentTokens(familyId: string, keepId: string): number {
  return getDb().run("DELETE FROM parent_tokens WHERE family_id=? AND id<>?", [familyId, keepId]).changes;
}
