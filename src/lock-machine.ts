// PURE kiosk lock-state computation (no DB, no HTTP imports — fully table-testable).
// Phase B of Hatch: the Android wrapper keeps the tablet in LockTask unless this says
// UNLOCKED. All wall-clock math happens in the FAMILY timezone via Intl (same approach
// as repo-routines.localDay), so the server's own TZ never matters.
//
// Precedence (most-authoritative first):
//   1. Active override — unlock → UNLOCKED (until = untilMs), lock → LOCKED_ROUTINE.
//      WHICH override that is, when a parent and a kid's purchase both have one live, is
//      decided by AUTHOR in repo-lock.activeOverride and not here: this module takes the
//      winner as an input, and its job is what the tablet does with it.
//   2. Outside every allow window (the curfew) → LOCKED_HOURS. Ranks ABOVE the routine and
//      the budget because it is the only rule a kid cannot work off or buy out of: there is
//      no chore that makes it 7am and no price that does either. A household with no allow
//      windows skips this rule entirely and behaves exactly as it did before they existed.
//   3. Inside a lock window: the window's routine must be done AND approved.
//      run absent / in_progress → LOCKED_ROUTINE · done_pending → PENDING_APPROVAL ·
//      approved → falls through (the routine is satisfied, the budget still applies).
//      Across multiple active windows the MOST RESTRICTIVE state wins.
//   4. Budget spent for the local day → LOCKED_BUDGET. Below the routine on purpose: a kid
//      who has burned their hour AND owes the morning routine should be told about the
//      routine, because that is the one they can still do something about.
//   4b. A sitting is full and its rest not yet served → LOCKED_BREAK. Below the budget: a
//      spent day is the more permanent fact, and "back at 7 tomorrow" must never be told
//      as "back in twelve minutes".
//   5. Otherwise UNLOCKED, `until` = the soonest thing that will change the answer —
//      curfew end, budget exhaustion, the sitting filling, or the next lock window's start.
//
// `until` is not decoration. It is what the tablet counts down to on its lock screen and
// what RelockAlarmReceiver sets an exact alarm for, so a wrong value here is a tablet that
// stays open past bedtime. Every branch that returns UNLOCKED must therefore return the
// EARLIEST bound, never just the one its own rule knows about.

export type LockState =
  | "LOCKED_ROUTINE"
  | "LOCKED_HOURS"
  | "LOCKED_BUDGET"
  | "LOCKED_BREAK"
  | "PENDING_APPROVAL"
  | "UNLOCKED";

// The four LOCKED_* states are ONE thing to the wrapper (pin the kiosk, because every
// caller keys off `!== "UNLOCKED"`) and three different sentences to the kid. That is why
// they are separate states rather than one state carrying a reason string: the lock screen
// picks its copy off WHICH lock, and a reason string would have made that a parse.

export interface WindowInput {
  routineId: string;
  startHhmm: string; // '06:30' — lock engages
  endHhmm: string;   // '08:30' — hard stop; [start, end) in the family tz
  days: string;      // Mon..Sun mask, Monday = index 0, e.g. '1111100'
}
export interface RunInput {
  routineId: string;
  status: "in_progress" | "done_pending" | "approved";
  runId?: string; // lets pendingApprovalRunIds corroborate done_pending
}
/** The curfew: hours the tablet is usable at all. Same weekday-mask shape as WindowInput,
 *  opposite meaning — see the polarity note in schema.sql. */
export interface AllowWindowInput {
  startHhmm: string; // '07:00' the tablet becomes usable
  endHhmm: string;   // '20:00' curfew; [start, end) in the family tz
  days: string;      // Mon..Sun mask, Monday = index 0
}

/** The screen-time meter for TODAY. `budgetSec` is 0 when the kid has no meter, and the
 *  budget rule is then skipped entirely — 0 means "unmetered", never "no time left". */
export interface BudgetInput {
  budgetSec: number; // (daily_screen_min + earned minutes) * 60
  usedSec: number;   // what the tablet has reported burning today
}

/** Sittings: play for `playSec` in one go, then rest for `restSec`. A rest is served by
 *  SILENCE -- the wrapper reports only while burning -- so the machine needs when the tablet
 *  last burned, not a "rest until" anyone wrote down. `usedSec` is the sitting as of the
 *  last tick and may already be stale by a served rest; the machine settles that itself. */
export interface SittingInput {
  playSec: number;
  restSec: number;
  usedSec: number;      // seconds burned in the current sitting, as of the last tick
  lastBurnAtMs: number; // when the tablet last reported burning today; 0 = not yet
}

export interface LockInput {
  nowMs: number;
  tz: string;
  windows: WindowInput[];
  allowWindows?: AllowWindowInput[];  // empty/absent = no curfew (rule 2 is skipped)
  budget?: BudgetInput | null;        // null/absent = no meter (rule 4 is skipped)
  sitting?: SittingInput | null;      // null/absent = no sittings rule (rule 4b is skipped)
  runsToday: RunInput[];              // today's run per routine (may be absent = not started)
  pendingApprovalRunIds: string[];    // routine_run ids with a pending approval
  override: { mode: "lock" | "unlock"; untilMs: number | null } | null;
}
export interface LockResult {
  state: LockState;
  reason: string;
  routineId?: string; // the routine demanding work / awaiting approval
  until?: number;     // epoch ms: what the tablet counts down to (see the `until` note above)
  /** Seconds of budget left when the answer is UNLOCKED and a meter is running. Absent when
   *  the kid is unmetered or a parent override is in charge — both are genuinely "no number
   *  to show", and 0 would have read as "none left" on the very screens that must not say so. */
  remainingSec?: number;
}

// ---- wall-clock helpers (Intl-backed, DST-correct) ----

const DAY_IDX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

interface WallClock { y: number; mo: number; d: number; hh: number; mm: number; dayIdx: number }

/** The wall clock (date, time, weekday) an instant reads as in tz. */
function wallClock(tz: string, atMs: number): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(atMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    y: Number(get("year")), mo: Number(get("month")), d: Number(get("day")),
    hh: Number(get("hour")), mm: Number(get("minute")), dayIdx: DAY_IDX[get("weekday")] ?? 0,
  };
}

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m || 0);
}

/** Pure calendar day-add (no tz involved — Date.UTC handles month/year rollover). */
function addDays(y: number, mo: number, d: number, n: number): { y: number; mo: number; d: number } {
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Epoch ms for a wall-clock time in tz. Guess-and-correct (3 rounds) makes it DST-exact;
 *  a nonexistent spring-forward time resolves one hour late — acceptable for lock windows. */
function zonedEpoch(tz: string, y: number, mo: number, d: number, minutes: number): number {
  const want = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  let ts = want;
  for (let i = 0; i < 3; i++) {
    const w = wallClock(tz, ts);
    const got = Date.UTC(w.y, w.mo - 1, w.d, w.hh, w.mm);
    if (got === want) break;
    ts += want - got;
  }
  return ts;
}

/** Is the window active at this wall clock? A window with end <= start crosses midnight:
 *  it covers [start, 24:00) on its masked day and [00:00, end) on the FOLLOWING day. */
function windowActive(w: { startHhmm: string; endHhmm: string; days: string }, at: WallClock): boolean {
  const m = at.hh * 60 + at.mm;
  const start = hhmmToMin(w.startHhmm);
  const end = hhmmToMin(w.endHhmm);
  if (start < end) return w.days[at.dayIdx] === "1" && m >= start && m < end;
  const prevDay = (at.dayIdx + 6) % 7; // early-morning tail belongs to yesterday's mask
  return (w.days[at.dayIdx] === "1" && m >= start) || (w.days[prevDay] === "1" && m < end);
}

/** Earliest FUTURE boundary (epoch ms) at `edge` across all windows, or undefined if none.
 *  `edge` picks which side: 'start' is when a window opens, 'end' when it closes. Both are
 *  needed now — a curfew's END is the moment an unlocked tablet must die, and its START is
 *  what a locked one counts down to. */
function nextBoundary(
  tz: string,
  nowMs: number,
  windows: { startHhmm: string; endHhmm: string; days: string }[],
  edge: "start" | "end",
): number | undefined {
  const today = wallClock(tz, nowMs);
  let best: number | undefined;
  for (const w of windows) {
    const startMin = hhmmToMin(w.startHhmm);
    const endMin = hhmmToMin(w.endHhmm);
    const mins = edge === "start" ? startMin : endMin;
    // A window that crosses midnight ends on the day AFTER the one its mask names, so its
    // end boundary is offset by one. Without this a 21:00-07:00 curfew would report an end
    // of 07:00 THIS morning -- a time in the past -- and never bound anything.
    const dayShift = edge === "end" && endMin <= startMin ? 1 : 0;
    for (let off = 0; off <= 7; off++) {
      if (w.days[(today.dayIdx + off) % 7] !== "1") continue;
      const date = addDays(today.y, today.mo, today.d, off + dayShift);
      const ts = zonedEpoch(tz, date.y, date.mo, date.d, mins);
      if (ts > nowMs) {
        if (best === undefined || ts < best) best = ts;
        break; // windows recur weekly — the first future hit is this window's earliest
      }
    }
  }
  return best;
}

/** Earliest FUTURE window start (epoch ms) across all windows, or undefined if none. */
export function nextWindowStart(tz: string, nowMs: number, windows: WindowInput[]): number | undefined {
  return nextBoundary(tz, nowMs, windows, "start");
}

/** Local midnight AFTER `nowMs` in tz — when the day rolls and the meter starts over.
 *  screen_usage is keyed by local day, so this is literally when `used_sec` becomes 0. */
function nextLocalMidnight(tz: string, nowMs: number): number {
  const at = wallClock(tz, nowMs);
  const d = addDays(at.y, at.mo, at.d, 1);
  return zonedEpoch(tz, d.y, d.mo, d.d, 0);
}

/** When a kid who has spent their budget can next actually USE the tablet.
 *
 *  Not simply "the next curfew opening" and not simply "midnight": it is the first instant
 *  that is BOTH past the meter's reset AND inside the household's hours. Getting this wrong
 *  is a lock screen that counts down to a moment when nothing happens — which was the first
 *  version of this function, pointing a spent kid at 06:30 while the curfew held until 07:00. */
function budgetReliefAt(tz: string, nowMs: number, allowWindows: AllowWindowInput[]): number | undefined {
  const reset = nextLocalMidnight(tz, nowMs);
  if (!allowWindows.length) return reset; // unmetered hours: the reset IS the relief
  if (allowWindows.some((w) => windowActive(w, wallClock(tz, reset)))) return reset;
  return nextBoundary(tz, reset - 1, allowWindows, "start");
}

/** The smallest defined bound. `until` must be the SOONEST thing that changes the answer,
 *  and every UNLOCKED branch has more than one candidate, so picking is not optional. */
function soonest(...times: (number | undefined)[]): number | undefined {
  let best: number | undefined;
  for (const t of times) if (t !== undefined && (best === undefined || t < best)) best = t;
  return best;
}

// ---- the state machine ----

export function computeLockState(input: LockInput): LockResult {
  const { nowMs, tz, windows, runsToday, pendingApprovalRunIds, override } = input;
  // Absent reads as "this household has no curfew / no meter", so every caller written
  // before these rules existed keeps its exact old answer without being touched.
  const allowWindows = input.allowWindows ?? [];
  const budget = input.budget ?? null;

  // 1. Active override wins (expired untilMs = inactive, belt-and-braces with the repo filter).
  //
  // A parent unlock deliberately outranks the curfew AND the meter, and carries no
  // `remainingSec`: "keep them busy while I do something" is the whole reason the control
  // exists, and it would be useless if bedtime or a spent hour could veto it. The matching
  // half of that promise lives in the wrapper, which does not burn budget while an override
  // is in charge -- an unlock that quietly ate the next day's hour would be a worse trap
  // than no unlock at all.
  if (override && (override.untilMs === null || override.untilMs > nowMs)) {
    const until = override.untilMs !== null ? { until: override.untilMs } : {};
    if (override.mode === "unlock") return { state: "UNLOCKED", reason: "override_unlock", ...until };
    return { state: "LOCKED_ROUTINE", reason: "override_lock", ...until };
  }

  const at = wallClock(tz, nowMs);

  // 2. Curfew. Nothing below this can unlock a tablet outside its hours.
  const curfewEnd = allowWindows.length ? nextBoundary(tz, nowMs, allowWindows, "end") : undefined;
  if (allowWindows.length && !allowWindows.some((w) => windowActive(w, at))) {
    const opensAt = nextBoundary(tz, nowMs, allowWindows, "start");
    return { state: "LOCKED_HOURS", reason: "outside_hours", ...(opensAt !== undefined ? { until: opensAt } : {}) };
  }

  // 3. Evaluate every active lock window; the most restrictive demand wins.
  const pending = new Set(pendingApprovalRunIds);
  const runByRoutine = new Map(runsToday.map((r) => [r.routineId, r]));
  let pendingRoutine: string | undefined;
  let anyActive = false;
  for (const w of windows) {
    if (!windowActive(w, at)) continue;
    anyActive = true;
    const run = runByRoutine.get(w.routineId);
    if (run?.status === "approved") continue; // satisfied
    if (run && (run.status === "done_pending" || (run.runId !== undefined && pending.has(run.runId)))) {
      pendingRoutine = pendingRoutine ?? w.routineId;
      continue;
    }
    // absent or in_progress → the kid still owes this routine
    return { state: "LOCKED_ROUTINE", reason: "routine_due", routineId: w.routineId };
  }
  if (pendingRoutine !== undefined) {
    return { state: "PENDING_APPROVAL", reason: "awaiting_approval", routineId: pendingRoutine };
  }

  // 4. The meter. `budgetSec` 0 means unmetered, so an unset budget can never lock anyone
  //    out — the same opt-in shape as the curfew above.
  const remainingSec = budget && budget.budgetSec > 0
    ? Math.max(0, budget.budgetSec - budget.usedSec)
    : undefined;
  if (remainingSec === 0) {
    const until = budgetReliefAt(tz, nowMs, allowWindows);
    return { state: "LOCKED_BUDGET", reason: "budget_spent", ...(until !== undefined ? { until } : {}) };
  }

  // 4b. Sittings. "Rested" is decided HERE from `lastBurnAtMs`, not read off a column: the
  //     rest ends by the tablet staying quiet, and nothing writes while it is quiet. A rule
  //     with either half at 0 is no rule, same as a 0 budget is no meter.
  const sitting = input.sitting ?? null;
  let sittingFullAt: number | undefined;
  if (sitting && sitting.playSec > 0 && sitting.restSec > 0) {
    const restEndsAt = sitting.lastBurnAtMs + sitting.restSec * 1000;
    const rested = sitting.lastBurnAtMs === 0 || restEndsAt <= nowMs;
    const used = rested ? 0 : sitting.usedSec;
    if (used >= sitting.playSec) return { state: "LOCKED_BREAK", reason: "break_time", until: restEndsAt };
    sittingFullAt = nowMs + (sitting.playSec - used) * 1000;
  }

  // 5. Unlocked. `until` is the soonest of: the budget running out, the sitting filling, the
  //    curfew closing, and the next lock window opening. Returning only one of them is the
  //    bug this whole branch exists to avoid — whichever lands first is the one the tablet
  //    must act on.
  const budgetOutAt = remainingSec !== undefined ? nowMs + remainingSec * 1000 : undefined;
  const until = soonest(budgetOutAt, sittingFullAt, curfewEnd, nextWindowStart(tz, nowMs, windows));
  const reason = windows.length === 0 ? "no_windows" : anyActive ? "routine_approved" : "outside_windows";
  return {
    state: "UNLOCKED",
    reason,
    ...(until !== undefined ? { until } : {}),
    ...(remainingSec !== undefined ? { remainingSec } : {}),
  };
}
