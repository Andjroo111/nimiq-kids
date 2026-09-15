// Progress tracker aggregates (#379): what a parent sees when they ask "how are they doing".
//
// Every read here is DAILY and BOUNDED, keyed on the family's local day, and every one of
// them answers exactly one question a parent asked out loud: are they doing their jobs, is
// the learning going anywhere, how much screen time is actually being used, what are they
// earning, and where does it go.
//
// WHY THE DAY IS COMPUTED IN SQL FROM A PRE-BUILT DAY LIST rather than grouped with SQLite's
// own date functions: every timestamp in this database is epoch ms in UTC, and the household
// lives in a timezone with daylight saving. `date(created_at/1000,'unixepoch')` would bucket
// by UTC day, which is right for nobody and quietly wrong by an hour twice a year and by a
// whole evening every single day -- a job approved at 8pm Central lands on tomorrow. So the
// day boundaries are computed ONCE in JS against the family tz (repo-routines.localDay is the
// same function the lock machine and the meter use) and the queries bucket against those.
//
// The series are returned DENSE: a day with nothing in it is a zero, not a gap. A parent
// reading a fortnight of chores needs to see the empty Saturdays, and a chart that silently
// drops them draws a line through a hole and calls it a trend.

import { getDb } from "./db";
import { localDay } from "./repo-routines";

export interface DayPoint { day: string; value: number }

/** Every local day in the window, oldest first, INCLUSIVE of today. */
export function dayWindow(tz: string, days: number, nowMs = Date.now()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(localDay(tz, nowMs - i * 86_400_000));
  return out;
}

/** Fill a sparse {day: value} map onto the window, so a quiet day reads as 0, never a gap. */
function dense(window: string[], rows: { day: string; value: number }[]): DayPoint[] {
  const by = new Map(rows.map((r) => [r.day, r.value]));
  return window.map((day) => ({ day, value: by.get(day) ?? 0 }));
}

/**
 * The day an epoch-ms timestamp falls on, as a SQL expression, in the family's timezone.
 *
 * Implemented as a fixed OFFSET rather than a timezone conversion, and that is a real
 * compromise worth naming: a window that spans a DST change buckets one day's worth of
 * evening rows an hour off. Getting it exactly right would mean either a per-row Intl call
 * in JS (fine at this size, ugly in SQL) or storing the local day on every row.
 *
 * It is bounded and it is the right trade at this scale: the error is one hour, twice a
 * year, on a chart whose job is "are they trending up". The two places where an hour
 * actually decides something -- the lock machine and the meter's own local_day -- both do
 * the exact Intl arithmetic instead, and neither of them reads this file.
 */
function offsetMsFor(tz: string, nowMs: number): number {
  const local = new Date(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(nowMs)).replace(/(\d+)\/(\d+)\/(\d+), /, "$3-$1-$2T") + "Z");
  return local.getTime() - nowMs;
}

const dayExpr = (col: string, offsetMs: number) =>
  `strftime('%Y-%m-%d', (${col} + ${offsetMs}) / 1000, 'unixepoch')`;

export interface KidProgress {
  childId: string;
  /** Jobs a grown-up said yes to, per day. The thing that actually pays. */
  approved: DayPoint[];
  /** Jobs a grown-up said no to, per day. Shown beside `approved` rather than folded into
   *  it: a week of ten approvals and six rejections is a different week from ten and none,
   *  and a completion rate alone hides which one it was. */
  rejected: DayPoint[];
  /** Minutes of deliberate practice, per day — the learning trend. */
  practiceMin: DayPoint[];
  /** Screen minutes used, per day (#377). */
  screenMin: DayPoint[];
  /** Screen minutes BOUGHT with NIM on top of the base, per day. */
  screenEarnedMin: DayPoint[];
  /** Today's allowance in minutes, so the chart can draw the line they are spending against. */
  dailyScreenMin: number;
  /** NIM earned per day, in whole NIM (luna/1e5). */
  earnedNim: DayPoint[];
  /** What they spent NIM on, by Treasure Box shelf kind, over the window. */
  spendByKind: { kind: string; nim: number }[];
}

export function kidProgress(childId: string, tz: string, days: number, nowMs = Date.now()): KidProgress {
  const db = getDb();
  const window = dayWindow(tz, days, nowMs);
  const from = window[0]!;
  const off = offsetMsFor(tz, nowMs);
  const D = (col: string) => dayExpr(col, off);

  const approvals = db.query(
    `SELECT ${D("decided_at")} AS day, status, COUNT(*) AS value
       FROM approvals
      WHERE child_id=? AND decided_at IS NOT NULL AND ${D("decided_at")} >= ?
        AND subject_kind IN ('routine_run','chore')
      GROUP BY day, status`,
  ).all(childId, from) as { day: string; status: string; value: number }[];

  const practice = db.query(
    `SELECT day, CAST(SUM(seconds) / 60 AS INTEGER) AS value
       FROM practice_sessions WHERE child_id=? AND day >= ? GROUP BY day`,
  ).all(childId, from) as { day: string; value: number }[];

  // screen_usage already stores the family-local day (the meter computes it the exact way),
  // so this one needs no offset arithmetic at all — it is the only series here that is
  // bucketed by the same clock the rule was enforced on.
  const screen = db.query(
    `SELECT local_day AS day, used_sec, earned_sec FROM screen_usage
      WHERE child_id=? AND local_day >= ?`,
  ).all(childId, from) as { day: string; used_sec: number; earned_sec: number }[];

  // A JOB PAYOUT IS `kind='earn'`, and only that. `reward` is a STAKING reward
  // (wallet/kid-staking.ts), and this read `reward` for its first weeks, so the Earned card
  // drew a flat zero over a kid whose own feed listed every payout. A row the chain PROVED
  // never executed is out, the same exclusion repo-budget.spentLuna makes; a pending one is
  // in, because it is on its way and the kid's feed already shows it as such.
  const earned = db.query(
    `SELECT ${D("created_at")} AS day, SUM(value_luna) AS luna
       FROM wallet_events
      WHERE child_id=? AND kind='earn' AND status<>'failed' AND ${D("created_at")} >= ?
      GROUP BY day`,
  ).all(childId, from) as { day: string; luna: number }[];

  const spend = db.query(
    `SELECT kind, SUM(price_luna) AS luna FROM kid_purchases
      WHERE child_id=? AND status != 'refunded' AND ${D("created_at")} >= ?
      GROUP BY kind ORDER BY luna DESC`,
  ).all(childId, from) as { kind: string; luna: number }[];

  const child = db.query("SELECT daily_screen_min FROM children WHERE id=?")
    .get(childId) as { daily_screen_min: number } | null;

  return {
    childId,
    approved: dense(window, approvals.filter((r) => r.status === "approved")),
    rejected: dense(window, approvals.filter((r) => r.status === "rejected")),
    practiceMin: dense(window, practice),
    screenMin: dense(window, screen.map((r) => ({ day: r.day, value: Math.round(r.used_sec / 60) }))),
    screenEarnedMin: dense(window, screen.map((r) => ({ day: r.day, value: Math.round(r.earned_sec / 60) }))),
    dailyScreenMin: child?.daily_screen_min ?? 0,
    // Whole NIM: a parent reading a fortnight of chores does not want five decimal places,
    // and luna is a unit no one in this household thinks in.
    earnedNim: dense(window, earned.map((r) => ({ day: r.day, value: Math.round((r.luna ?? 0) / 1e5) }))),
    spendByKind: spend.map((r) => ({ kind: r.kind, nim: Math.round((r.luna ?? 0) / 1e5) })),
  };
}
