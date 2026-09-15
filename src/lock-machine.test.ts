// Table-driven tests for the PURE kiosk lock-state machine. All instants are fixed
// epoch-ms values in America/Chicago (CDT = UTC-5 in summer, CST = UTC-6 in winter),
// so results are identical no matter where/when the suite runs.
//
// Weekday anchors (verified): 2026-07-13 Mon · 2026-07-15 Wed · 2026-07-17 Fri ·
// 2026-07-19 Sun · 2026-03-08 Sun (DST begins) · 2026-11-01 Sun (DST ends).

import { test, expect } from "bun:test";
import {
  computeLockState,
  type AllowWindowInput,
  type LockInput,
  type LockResult,
  type WindowInput,
} from "./lock-machine";

const TZ = "America/Chicago";
const morning = (days = "1111100"): WindowInput => ({ routineId: "r1", startHhmm: "06:30", endHhmm: "08:30", days });
const allDay = (routineId: string): WindowInput => ({ routineId, startHhmm: "00:00", endHhmm: "23:59", days: "1111111" });

/** The house curfew as Andjroo set it: Sun-Thu 07:00-20:00, Fri-Sat 07:00-21:00. Two rows,
 *  because one row cannot say "later on two days". */
const CURFEW: AllowWindowInput[] = [
  { startHhmm: "07:00", endHhmm: "20:00", days: "1111001" }, // Mon-Thu + Sun
  { startHhmm: "07:00", endHhmm: "21:00", days: "0000110" }, // Fri + Sat
];
const MIN = 60_000;

const WED_0700 = Date.UTC(2026, 6, 15, 12, 0);  // Wed 2026-07-15 07:00 CDT — inside 06:30-08:30
const WED_1000 = Date.UTC(2026, 6, 15, 15, 0);  // Wed 10:00 CDT — outside
const THU_0630 = Date.UTC(2026, 6, 16, 11, 30); // Thu 06:30 CDT — next morning start
const MON_0630 = Date.UTC(2026, 6, 20, 11, 30); // Mon 2026-07-20 06:30 CDT
const WED_2000 = Date.UTC(2026, 6, 16, 1, 0);   // Wed 2026-07-15 20:00 CDT — weeknight curfew
const THU_0700 = Date.UTC(2026, 6, 16, 12, 0);  // Thu 2026-07-16 07:00 CDT — curfew reopens
const FRI_2100 = Date.UTC(2026, 6, 18, 2, 0);   // Fri 2026-07-17 21:00 CDT — weekend curfew

function input(partial: Partial<LockInput>): LockInput {
  return { nowMs: WED_0700, tz: TZ, windows: [morning()], runsToday: [], pendingApprovalRunIds: [], override: null, ...partial };
}

// `expect` may pin any subset of the result; keys present with value undefined must be absent.
const CASES: { name: string; input: LockInput; expected: Partial<LockResult> }[] = [
  // ---- window demands work ----
  { name: "inside window, no run yet -> LOCKED_ROUTINE",
    input: input({}),
    expected: { state: "LOCKED_ROUTINE", reason: "routine_due", routineId: "r1" } },
  { name: "inside window, run in_progress -> LOCKED_ROUTINE",
    input: input({ runsToday: [{ routineId: "r1", status: "in_progress" }] }),
    expected: { state: "LOCKED_ROUTINE", routineId: "r1" } },
  { name: "inside window, done_pending -> PENDING_APPROVAL",
    input: input({ runsToday: [{ routineId: "r1", status: "done_pending", runId: "run1" }], pendingApprovalRunIds: ["run1"] }),
    expected: { state: "PENDING_APPROVAL", reason: "awaiting_approval", routineId: "r1" } },
  { name: "done_pending without corroborating approval id still pends (status is authoritative)",
    input: input({ runsToday: [{ routineId: "r1", status: "done_pending" }] }),
    expected: { state: "PENDING_APPROVAL", routineId: "r1" } },
  { name: "inside window, approved -> UNLOCKED until tomorrow's start",
    input: input({ runsToday: [{ routineId: "r1", status: "approved" }] }),
    expected: { state: "UNLOCKED", reason: "routine_approved", until: THU_0630 } },

  // ---- boundaries: [start, end) ----
  { name: "exactly at start_hhmm -> locked (inclusive)",
    input: input({ nowMs: Date.UTC(2026, 6, 15, 11, 30) }), // Wed 06:30 CDT
    expected: { state: "LOCKED_ROUTINE" } },
  { name: "exactly at end_hhmm -> unlocked (exclusive)",
    input: input({ nowMs: Date.UTC(2026, 6, 15, 13, 30) }), // Wed 08:30 CDT
    expected: { state: "UNLOCKED", reason: "outside_windows", until: THU_0630 } },

  // ---- outside windows ----
  { name: "outside all windows -> UNLOCKED until next start",
    input: input({ nowMs: WED_1000 }),
    expected: { state: "UNLOCKED", reason: "outside_windows", until: THU_0630 } },
  { name: "no windows at all -> UNLOCKED with no until",
    input: input({ windows: [] }),
    expected: { state: "UNLOCKED", reason: "no_windows", until: undefined } },
  { name: "Friday evening: next start skips the weekend (until across days)",
    input: input({ nowMs: Date.UTC(2026, 6, 18, 1, 0) }), // Fri 2026-07-17 20:00 CDT
    expected: { state: "UNLOCKED", until: MON_0630 } },

  // ---- override precedence + expiry ----
  { name: "override unlock beats an unmet window",
    input: input({ override: { mode: "unlock", untilMs: WED_0700 + 3_600_000 } }),
    expected: { state: "UNLOCKED", reason: "override_unlock", until: WED_0700 + 3_600_000 } },
  { name: "override unlock with untilMs null -> indefinite (no until)",
    input: input({ override: { mode: "unlock", untilMs: null } }),
    expected: { state: "UNLOCKED", reason: "override_unlock", until: undefined } },
  { name: "override lock beats outside-window unlocked",
    input: input({ nowMs: WED_1000, override: { mode: "lock", untilMs: null } }),
    expected: { state: "LOCKED_ROUTINE", reason: "override_lock" } },
  { name: "expired override falls through to window evaluation",
    input: input({ override: { mode: "unlock", untilMs: WED_0700 - 1 } }),
    expected: { state: "LOCKED_ROUTINE", reason: "routine_due" } },

  // ---- day-mask edges (Monday = index 0, Sunday = index 6) ----
  { name: "Mon-Fri mask is off on Sunday; until points at Monday",
    input: input({ nowMs: Date.UTC(2026, 6, 19, 12, 0) }), // Sun 2026-07-19 07:00 CDT
    expected: { state: "UNLOCKED", reason: "outside_windows", until: MON_0630 } },
  { name: "Sunday-only mask (index 6) locks on Sunday",
    input: input({ nowMs: Date.UTC(2026, 6, 19, 12, 0), windows: [morning("0000001")] }),
    expected: { state: "LOCKED_ROUTINE", routineId: "r1" } },

  // ---- midnight-crossing windows (mask belongs to the START day) ----
  { name: "Mon 21:00-06:00 window is active Monday 23:00",
    input: input({ nowMs: Date.UTC(2026, 6, 14, 4, 0), // Mon 2026-07-13 23:00 CDT
      windows: [{ routineId: "r1", startHhmm: "21:00", endHhmm: "06:00", days: "1000000" }] }),
    expected: { state: "LOCKED_ROUTINE", routineId: "r1" } },
  { name: "Mon 21:00-06:00 window is still active early Tuesday (the tail)",
    input: input({ nowMs: Date.UTC(2026, 6, 14, 6, 0), // Tue 2026-07-14 01:00 CDT
      windows: [{ routineId: "r1", startHhmm: "21:00", endHhmm: "06:00", days: "1000000" }] }),
    expected: { state: "LOCKED_ROUTINE", routineId: "r1" } },
  { name: "Mon 21:00-06:00 window is NOT active Tuesday night; until = next Monday 21:00",
    input: input({ nowMs: Date.UTC(2026, 6, 15, 4, 0), // Tue 2026-07-14 23:00 CDT
      windows: [{ routineId: "r1", startHhmm: "21:00", endHhmm: "06:00", days: "1000000" }] }),
    expected: { state: "UNLOCKED", until: Date.UTC(2026, 6, 21, 2, 0) } }, // Mon 2026-07-20 21:00 CDT

  // ---- DST transition days (America/Chicago) ----
  { name: "spring forward 2026-03-08: until lands on 06:30 CDT (UTC-5), not naive UTC-6",
    input: input({ nowMs: Date.UTC(2026, 2, 8, 7, 30), windows: [morning("1111111")] }), // 01:30 CST
    expected: { state: "UNLOCKED", until: Date.UTC(2026, 2, 8, 11, 30) } },
  { name: "spring forward: window evaluates correctly at 07:00 CDT on the transition morning",
    input: input({ nowMs: Date.UTC(2026, 2, 8, 12, 0), windows: [morning("1111111")] }),
    expected: { state: "LOCKED_ROUTINE" } },
  { name: "fall back 2026-11-01: until lands on 06:30 CST (UTC-6), not naive UTC-5",
    input: input({ nowMs: Date.UTC(2026, 10, 1, 5, 30), windows: [morning("1111111")] }), // 00:30 CDT
    expected: { state: "UNLOCKED", until: Date.UTC(2026, 10, 1, 12, 30) } },

  // ---- multiple windows/routines: most restrictive wins ----
  { name: "approved + absent -> LOCKED (the unmet routine wins)",
    input: input({ windows: [allDay("r1"), allDay("r2")], runsToday: [{ routineId: "r1", status: "approved" }] }),
    expected: { state: "LOCKED_ROUTINE", routineId: "r2" } },
  { name: "approved + done_pending -> PENDING_APPROVAL",
    input: input({ windows: [allDay("r1"), allDay("r2")],
      runsToday: [{ routineId: "r1", status: "approved" }, { routineId: "r2", status: "done_pending", runId: "run2" }],
      pendingApprovalRunIds: ["run2"] }),
    expected: { state: "PENDING_APPROVAL", routineId: "r2" } },
  { name: "in_progress + done_pending -> LOCKED (locked-most-restrictive)",
    input: input({ windows: [allDay("r1"), allDay("r2")],
      runsToday: [{ routineId: "r1", status: "done_pending", runId: "run1" }, { routineId: "r2", status: "in_progress" }],
      pendingApprovalRunIds: ["run1"] }),
    expected: { state: "LOCKED_ROUTINE", routineId: "r2" } },
  { name: "approved inside the EVENING window: until crosses midnight to the morning window",
    input: input({ nowMs: Date.UTC(2026, 6, 16, 0, 30), // Wed 2026-07-15 19:30 CDT
      windows: [morning("1111111"), { routineId: "r2", startHhmm: "19:00", endHhmm: "20:30", days: "1111111" }],
      runsToday: [{ routineId: "r2", status: "approved" }] }),
    expected: { state: "UNLOCKED", reason: "routine_approved", until: THU_0630 } },

  // ---- curfew (allow_windows): the rule nothing below it can undo ----
  { name: "inside the curfew, routine approved -> UNLOCKED until the curfew closes",
    input: input({ nowMs: WED_1000, allowWindows: CURFEW }),
    expected: { state: "UNLOCKED", until: WED_2000 } },
  { name: "after the weeknight curfew -> LOCKED_HOURS until it reopens",
    input: input({ nowMs: WED_2000, allowWindows: CURFEW }),
    expected: { state: "LOCKED_HOURS", reason: "outside_hours", until: THU_0700 } },
  { name: "before the curfew opens (06:00) -> LOCKED_HOURS, not the morning routine",
    input: input({ nowMs: Date.UTC(2026, 6, 15, 11, 0), allowWindows: CURFEW }), // Wed 06:00 CDT
    expected: { state: "LOCKED_HOURS", reason: "outside_hours" } },
  { name: "Friday runs an hour later than a weeknight (20:30 is still open)",
    input: input({ nowMs: Date.UTC(2026, 6, 18, 1, 30), allowWindows: CURFEW }), // Fri 20:30 CDT
    expected: { state: "UNLOCKED", until: FRI_2100 } },
  { name: "Friday 21:00 closes; Saturday's own 07:00 is the next opening",
    input: input({ nowMs: FRI_2100, allowWindows: CURFEW }),
    expected: { state: "LOCKED_HOURS", until: Date.UTC(2026, 6, 18, 12, 0) } },
  { name: "curfew OUTRANKS the routine: 06:00 inside the morning window is still LOCKED_HOURS",
    input: input({ nowMs: Date.UTC(2026, 6, 15, 11, 0), allowWindows: CURFEW,
      windows: [{ routineId: "r1", startHhmm: "05:00", endHhmm: "08:30", days: "1111111" }] }),
    expected: { state: "LOCKED_HOURS" } },
  { name: "a parent unlock override still beats the curfew (the whole point of the control)",
    input: input({ nowMs: WED_2000, allowWindows: CURFEW, override: { mode: "unlock", untilMs: null } }),
    expected: { state: "UNLOCKED", reason: "override_unlock", remainingSec: undefined } },
  { name: "no curfew rows -> the old behaviour, unchanged",
    input: input({ nowMs: WED_2000, allowWindows: [] }),
    expected: { state: "UNLOCKED", reason: "outside_windows" } },

  // ---- the meter ----
  { name: "budget part-spent -> UNLOCKED, until = when it runs out",
    input: input({ nowMs: WED_1000, budget: { budgetSec: 3600, usedSec: 600 } }),
    expected: { state: "UNLOCKED", until: WED_1000 + 3000 * 1000, remainingSec: 3000 } },
  { name: "budget exhausted -> LOCKED_BUDGET",
    input: input({ nowMs: WED_1000, allowWindows: CURFEW, budget: { budgetSec: 3600, usedSec: 3600 } }),
    expected: { state: "LOCKED_BUDGET", reason: "budget_spent", until: THU_0700 } },
  { name: "over-spent (a late report lands after the lock) still reads as spent, never negative",
    input: input({ nowMs: WED_1000, budget: { budgetSec: 3600, usedSec: 5000 } }),
    expected: { state: "LOCKED_BUDGET", reason: "budget_spent" } },
  { name: "budgetSec 0 means UNMETERED, not out of time",
    input: input({ nowMs: WED_1000, budget: { budgetSec: 0, usedSec: 900 } }),
    expected: { state: "UNLOCKED", remainingSec: undefined } },
  { name: "curfew beats the meter: outside hours is LOCKED_HOURS even with budget to spare",
    input: input({ nowMs: WED_2000, allowWindows: CURFEW, budget: { budgetSec: 3600, usedSec: 0 } }),
    expected: { state: "LOCKED_HOURS" } },
  { name: "an owed routine beats the meter: the kid is told the thing they can still act on",
    input: input({ nowMs: WED_0700, allowWindows: CURFEW, budget: { budgetSec: 3600, usedSec: 3600 } }),
    expected: { state: "LOCKED_ROUTINE", reason: "routine_due", routineId: "r1" } },
  { name: "a parent unlock override beats a spent budget and reports no remainder",
    input: input({ nowMs: WED_1000, budget: { budgetSec: 3600, usedSec: 3600 },
      override: { mode: "unlock", untilMs: null } }),
    expected: { state: "UNLOCKED", reason: "override_unlock", remainingSec: undefined } },

  { name: "budget spent with NO curfew -> until is local midnight (when the meter resets)",
    input: input({ nowMs: WED_1000, allowWindows: [], budget: { budgetSec: 3600, usedSec: 3600 } }),
    expected: { state: "LOCKED_BUDGET", until: Date.UTC(2026, 6, 16, 5, 0) } }, // Thu 00:00 CDT
  { name: "budget spent late Friday -> until is SATURDAY 07:00, not Friday's own opening",
    input: input({ nowMs: Date.UTC(2026, 6, 18, 1, 30), allowWindows: CURFEW, // Fri 20:30 CDT
      budget: { budgetSec: 3600, usedSec: 3600 } }),
    expected: { state: "LOCKED_BUDGET", until: Date.UTC(2026, 6, 18, 12, 0) } }, // Sat 07:00 CDT

  // ---- sittings: play for N in one go, then rest for M ----
  // "Rested" is settled from lastBurnAtMs, never from a column: the rest is served by the
  // tablet staying quiet, and nothing writes while it is quiet.
  { name: "sitting full, rest not served -> LOCKED_BREAK until the rest is up",
    input: input({ nowMs: WED_1000, sitting: { playSec: 1800, restSec: 1800, usedSec: 1800, lastBurnAtMs: WED_1000 - 5 * MIN } }),
    expected: { state: "LOCKED_BREAK", reason: "break_time", until: WED_1000 + 25 * MIN } },
  { name: "sitting full but the rest has been served -> UNLOCKED, a fresh sitting",
    input: input({ nowMs: WED_1000, sitting: { playSec: 1800, restSec: 1800, usedSec: 1800, lastBurnAtMs: WED_1000 - 30 * MIN } }),
    expected: { state: "UNLOCKED", until: WED_1000 + 30 * MIN } },
  { name: "mid-sitting -> UNLOCKED, until = when the sitting fills, remainder is still the DAY's",
    input: input({ nowMs: WED_1000, budget: { budgetSec: 3600, usedSec: 0 },
      sitting: { playSec: 1800, restSec: 1800, usedSec: 600, lastBurnAtMs: WED_1000 - MIN } }),
    expected: { state: "UNLOCKED", until: WED_1000 + 20 * MIN, remainingSec: 3600 } },
  { name: "a pause shorter than the rest keeps the sitting: 20 min in, 10 away -> 10 left",
    input: input({ nowMs: WED_1000, sitting: { playSec: 1800, restSec: 1800, usedSec: 1200, lastBurnAtMs: WED_1000 - 10 * MIN } }),
    expected: { state: "UNLOCKED", until: WED_1000 + 10 * MIN } },
  { name: "nothing burned yet today -> the whole sitting is ahead",
    input: input({ nowMs: WED_1000, sitting: { playSec: 1800, restSec: 1800, usedSec: 0, lastBurnAtMs: 0 } }),
    expected: { state: "UNLOCKED", until: WED_1000 + 30 * MIN } },
  { name: "a spent day beats a rest: LOCKED_BUDGET, never 'back in 25 minutes'",
    input: input({ nowMs: WED_1000, allowWindows: CURFEW, budget: { budgetSec: 3600, usedSec: 3600 },
      sitting: { playSec: 1800, restSec: 1800, usedSec: 1800, lastBurnAtMs: WED_1000 - 5 * MIN } }),
    expected: { state: "LOCKED_BUDGET", reason: "budget_spent", until: THU_0700 } },
  { name: "a rest never outranks the routine",
    input: input({ sitting: { playSec: 1800, restSec: 1800, usedSec: 1800, lastBurnAtMs: WED_0700 - MIN } }),
    expected: { state: "LOCKED_ROUTINE", reason: "routine_due" } },
  { name: "a parent unlock beats a rest",
    input: input({ nowMs: WED_1000, sitting: { playSec: 1800, restSec: 1800, usedSec: 1800, lastBurnAtMs: WED_1000 - MIN },
      override: { mode: "unlock", untilMs: WED_1000 + 15 * MIN } }),
    expected: { state: "UNLOCKED", reason: "override_unlock", until: WED_1000 + 15 * MIN } },
  { name: "a rule with either half at 0 is no rule",
    input: input({ nowMs: WED_1000, sitting: { playSec: 1800, restSec: 0, usedSec: 9999, lastBurnAtMs: WED_1000 } }),
    expected: { state: "UNLOCKED", until: THU_0630 } },
  { name: "a curfew still open at midnight gives the time back AT midnight",
    input: input({ nowMs: Date.UTC(2026, 6, 15, 23, 0), windows: [], // Wed 18:00 CDT
      allowWindows: [{ startHhmm: "07:00", endHhmm: "01:00", days: "1111111" }],
      budget: { budgetSec: 3600, usedSec: 3600 } }),
    expected: { state: "LOCKED_BUDGET", until: Date.UTC(2026, 6, 16, 5, 0) } }, // Thu 00:00 CDT

  // ---- `until` is the SOONEST bound, which is the whole reason it is computed ----
  { name: "budget runs out before the curfew closes -> until is the budget",
    input: input({ nowMs: Date.UTC(2026, 6, 15, 23, 0), allowWindows: CURFEW, // Wed 18:00 CDT
      budget: { budgetSec: 1800, usedSec: 0 } }),                             // 30 min left, curfew 2h
    expected: { state: "UNLOCKED", until: Date.UTC(2026, 6, 15, 23, 0) + 30 * MIN, remainingSec: 1800 } },
  { name: "curfew closes before the budget runs out -> until is the curfew",
    input: input({ nowMs: Date.UTC(2026, 6, 16, 0, 30), allowWindows: CURFEW, // Wed 19:30 CDT
      windows: [], budget: { budgetSec: 3600, usedSec: 0 } }),                // 60 min left, curfew 30m
    expected: { state: "UNLOCKED", until: WED_2000, remainingSec: 3600 } },
  { name: "a lock window opening first beats both",
    input: input({ nowMs: Date.UTC(2026, 6, 15, 22, 0), allowWindows: CURFEW, // Wed 17:00 CDT
      windows: [{ routineId: "r2", startHhmm: "18:00", endHhmm: "19:00", days: "1111111" }],
      budget: { budgetSec: 7200, usedSec: 0 } }),
    expected: { state: "UNLOCKED", until: Date.UTC(2026, 6, 15, 23, 0) } },
];

for (const { name, input: inp, expected } of CASES) {
  test(name, () => {
    const got = computeLockState(inp);
    expect(got.state).toBe(expected.state!);
    for (const key of ["reason", "routineId", "until", "remainingSec"] as const) {
      if (key in expected) expect(got[key]).toBe(expected[key] as never);
    }
  });
}

// The minute a whole test file fell into. A window is [start, end), so one written 00:00 to
// 23:59 is NOT active for the last minute of the day, and a suite on the real clock that
// leans on it fails once a day. "All day" is 00:00 to 00:00: end <= start crosses midnight,
// and the tail it crosses into is empty.
test("00:00 to 23:59 has a hole at 23:59; 00:00 to 00:00 does not", () => {
  const WED_2359 = Date.UTC(2026, 6, 16, 4, 59, 30); // Wed 2026-07-15 23:59:30 CDT
  const holed = computeLockState(input({ nowMs: WED_2359, windows: [allDay("r1")] }));
  expect(holed.state).toBe("UNLOCKED");
  const whole = computeLockState(input({
    nowMs: WED_2359, windows: [{ routineId: "r1", startHhmm: "00:00", endHhmm: "00:00", days: "1111111" }],
  }));
  expect(whole.state).toBe("LOCKED_ROUTINE");
});
