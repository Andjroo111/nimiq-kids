// The weeks BEHIND a demo family: the record of work a kid did before the visitor
// arrived, so the calendar opens on a household with a history instead of a wall of
// empty dates.
//
// Why this exists. `payDemoHistory` seeds the money, and it does that by paying every
// past job for real, on chain. That makes it honest and it makes it EXPENSIVE, one
// transaction per job, so it can only ever afford a handful, and `seedDays` drops all of
// them into the current week. Open the demo on a Monday and the whole month grid is one
// stickered square. That is the bug this file closes (Andjroo, 2026-08-03: "in the demo,
// previous weeks, we want our kid to look successful").
//
// THE TRAIL AND THE MONEY ARE DELIBERATELY DIFFERENT THINGS, and keeping them apart is
// the whole trick. The chart is a record of WORK DONE; the wallet is a CURRENT BALANCE.
// A real family's July chores were paid in July and spent in July, so a month of past
// stickers implies nothing at all about what is in the wallet today. Nothing seeded here
// writes a `wallet_events` row, so:
//
//   - it costs ZERO NIM and ZERO transactions, and mint stays as fast as it is now;
//   - `repo-budget.spentLuna` (which derives spend from `kind='earn'` rows) is untouched,
//     so this cannot eat into the grant the way a longer `history` array would;
//   - no screen can show money that never moved, because `reward_luna` is read in exactly
//     one place, `routes/approvals.ts` deciding what to pay at the moment of approval, and
//     is never summed into a balance or a feed anywhere.
//
// That last point is load-bearing, and it is the thing to re-check if this file ever
// seems to have gone wrong: if some future screen totals rewards off `chores` or
// `routine_tasks` instead of off the ledger, these rows become phantom earnings.
//
// This belongs to the pure-DB half of the seeder (`mintDemoFamily`), never the chain half.

import * as routines from "./repo-routines";
import * as practicesRepo from "./repo-practices";
import * as stickersRepo from "./repo-stickers";
import { addDays, mondayOf, weekDays } from "./days";
import { job, jobKey } from "./title-catalog";

/**
 * How many WHOLE weeks of history sit behind the current one.
 *
 * Four is chosen against the month grid rather than picked for roundness. The grid is
 * whole Monday weeks covering the 1st to the last, so on the 3rd of a month only the top
 * row has happened yet; filling the current month alone would leave the trail nearly
 * invisible on exactly the dates a visitor lands on.
 *
 * ⚠️ IT IS A FLOOR, NOT THE RULE. This comment used to claim four weeks "always reaches back
 * into the previous month". That is arithmetically false and it left an eight-day dead zone
 * every month: on Monday 2026-08-24, four weeks back is 2026-07-27, which is five days of
 * July — and on a month-ending Monday (2026-08-31 → 2026-08-03) it reaches the previous month
 * by ZERO days. The demo then showed a visitor an empty grid behind the back arrow on roughly
 * a quarter of the days they might arrive. `pastDays` computes the real rule now.
 */
export const PAST_WEEKS = 4;

/**
 * Every day the trail covers: back to whichever is EARLIER of `PAST_WEEKS` whole weeks and the
 * Monday on or before the 1st of the previous month, up to but not including today. Today
 * belongs to the paid history, see `payDemoHistory`.
 *
 * The second bound is what makes the promise true whatever day a visitor arrives on: the back
 * arrow reaches a month that is fully filled in, never a nearly empty one. The first stays as a
 * floor so that early in a month, when the previous month is short of the four-week window, the
 * trail is still long enough to read as a habit rather than a few marks.
 */
export function pastDays(today: string): string[] {
  const fourWeeks = addDays(mondayOf(today), -7 * PAST_WEEKS);
  // The 1st of the previous month, by stepping to the 1st of this one and back a day.
  const firstOfThis = `${today.slice(0, 7)}-01`;
  const coversPrevMonth = mondayOf(addDays(firstOfThis, -1).slice(0, 7) + "-01");
  const start = fourWeeks < coversPrevMonth ? fourWeeks : coversPrevMonth;
  const days: string[] = [];
  for (let d = start; d < today; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * What one past day looks like.
 *
 * 'full'    the routine done AND the practice logged.
 * 'jobs'    the routine, and the practice. Kept distinct from 'full' only in how often it
 *           comes up; both put a sticker on the date.
 * 'routine' the routine alone. A weekend, or a day the practice was skipped.
 * 'off'     nothing. A kid who never misses is not a kid, and a grid with no gaps in it
 *           reads as generated rather than lived.
 *
 * A PAST DAY DELIBERATELY CREATES NO CHORE. It was written that way first and the parent
 * app is what ruled it out: `/api/chores` returns every job that was never removed, and
 * the board renders all of them, so four weeks of one-a-day history turned Sam's board
 * into 34 rows of which 28 were greyed-out history wearing "Again" buttons. The four real
 * jobs a judge is meant to find were buried under a month of my own seed.
 *
 * A practice is the right shape for this and a chore never was. A chore is a ONE-SHOT ROW
 * that finishes; repeating it means making another one. A practice is ONE row with a
 * session per day, which is precisely what a history trail is, and it is the entity the
 * app already built for "a thing done again and again across a calendar". So the board
 * gains one row per kid and the calendar gains a month of days.
 *
 * The cost of the trade, and it is worth naming: `dayState()` marks a day finished only
 * when EVERY row on the chart is satisfied that day, and the chores and lessons rows have
 * a cell on every day whether or not anything happened. With no seeded chore, a past day
 * can only ever be partly done, so the trail is blue rather than gold. Gold would take a
 * chore row per gold day, which is the board again. The sticker is the mark a kid reads
 * anyway; the tint behind it is not what was asked for.
 */
type DayShape = "full" | "jobs" | "routine" | "off";

/**
 * The odds a given kind of day takes each shape, as cumulative cut points over `rand()`.
 *
 * Authored as WEIGHTS rather than as a fixed Mon-to-Sun rhythm on purpose: a repeating
 * weekly pattern tiles, and four identical rows stacked up a month grid is the most
 * obviously machine-made thing this could produce. Weights let each week land differently
 * while keeping the shape of a working household. Weekdays busy, weekends lighter, the odd
 * day missed.
 *
 * THE ODDS MOVE WITH RECENCY, from EARLY (the oldest week) to RECENT (the day before
 * today). A kid who is good at this got good at it, so the grid reads as a habit forming:
 * patchy four weeks ago, mostly kept by last week.
 *
 * MOST DAYS, NOT EVERY DAY (Andjroo, 2026-08-04: "make it where not every day they got a
 * sticker, but most days"). An earlier version drove `off` to zero at the recent end, so
 * the last four weeks came out as an unbroken block of stickers. That reads as generated,
 * and it also flattens the thing the trail is for — a run of days only looks like a run if
 * something breaks it. Weekdays land around 85% here and weekends around 70%, which puts
 * roughly one gap in a working week and two across a weekend, and the gaps fall in
 * different places for each kid and each week.
 */
type Weights = [DayShape, number][];
const EARLY_WEEKDAY: Weights = [["full", 0.20], ["jobs", 0.55], ["routine", 0.76], ["off", 1]];
const RECENT_WEEKDAY: Weights = [["full", 0.55], ["jobs", 0.80], ["routine", 0.88], ["off", 1]];
const EARLY_WEEKEND: Weights = [["full", 0.06], ["jobs", 0.28], ["routine", 0.58], ["off", 1]];
const RECENT_WEEKEND: Weights = [["full", 0.22], ["jobs", 0.52], ["routine", 0.74], ["off", 1]];

/** The two tables blended at `t`, 0 at the oldest day of the trail and 1 at yesterday. */
function weightsAt(day: string, t: number): Weights {
  const [early, recent] = isWeekend(day) ? [EARLY_WEEKEND, RECENT_WEEKEND] : [EARLY_WEEKDAY, RECENT_WEEKDAY];
  return early.map(([shape, cut], i) => [shape, cut + (recent[i]![1] - cut) * t]);
}

/** Starter-pack ids. Every kid owns these from `ensureStarterGrant`, so a placement here
 *  can never point at a sticker the kid does not have, which is the rule the real
 *  `POST /*​/sticker` routes enforce and which a seeded placement has to keep by hand. */
const STARTER = [
  "stk-star", "stk-heart", "stk-rainbow", "stk-smiley", "stk-unicorn",
  "stk-dino", "stk-paw", "stk-lightning", "stk-flower", "stk-trophy",
];

/**
 * The one thing each kid has been keeping up. Ids from `title-catalog`, so a German
 * visitor's history reads in German like the rest of the board.
 *
 * Seeding these also closes a hole that has nothing to do with the calendar: practices
 * ship, they pay NIM, and the demo created none, so a judge had no way to meet the
 * feature at all. One per kid, and different from each other so the two kids do not read
 * as copies.
 */
const PRACTICE: Record<string, { job: string; targetPerWeek: number }> = {
  Sam: { job: "read20", targetPerWeek: 5 },
  Ava: { job: "piano", targetPerWeek: 4 },
};
const DEFAULT_PRACTICE = { job: "read20", targetPerWeek: 4 };

/**
 * A stable 32-bit hash of a string (FNV-1a).
 *
 * The trail is DERIVED, never random: every visitor's demo is the same demo, which is
 * what lets a test pin it and what stops two judges comparing notes on two different
 * apps. `Math.random()` here would also make any screenshot proof unrepeatable.
 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A deterministic 0..1 for one (kid, day, purpose). */
const rand = (kid: string, day: string, salt: string) => hash(`${kid}|${day}|${salt}`) / 0x100000000;

/** One of `list`, chosen deterministically. */
const pick = <T>(list: readonly T[], kid: string, day: string, salt: string): T =>
  list[Math.floor(rand(kid, day, salt) * list.length) % list.length]!;

const isWeekend = (day: string) => {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
};

function shapeOf(kid: string, day: string, t: number): DayShape {
  const r = rand(kid, day, "shape");
  for (const [shape, cut] of weightsAt(day, t)) if (r < cut) return shape;
  return "off";
}

/**
 * The most gaps the ROW ABOVE TODAY may carry.
 *
 * That row is the last COMPLETE week the month grid shows, so it has to make the case on
 * its own. Left purely to the odds it usually does, and sometimes does not: Ava's week
 * before 2026-12-01 came out with four of seven missed, which is a visitor landing on a
 * demo that argues the opposite of what it is for. Two keeps it clearly a good week while
 * still leaving room for a gap or two, which is the whole point.
 */
export const MAX_LAST_WEEK_GAPS = 2;

/**
 * The seven dates of that row: Monday to Sunday of the calendar week before today's.
 *
 * ⚠️ NOT the last seven days of the trail, and that distinction is the whole of #295's
 * one real bug. The kid calendar is drawn in whole Monday weeks, so the row a visitor
 * reads as "last week" is a calendar week — while `trail.slice(-7)` is a window that
 * slides with the weekday and only lines up on a Monday. From Wednesday on the two stop
 * overlapping, the floor lands partly on days in the CURRENT week, and the row above Today
 * goes unfloored: measured at 3 and 4 gaps on 10 of 28 consecutive start dates.
 *
 * `pastDays` starts at `mondayOf(today) - 7 * PAST_WEEKS`, so this week is always inside
 * the trail for any `PAST_WEEKS >= 1`.
 */
export const rowAboveToday = (today: string): string[] => weekDays(addDays(mondayOf(today), -7));

/**
 * The shape of every day of one kid's trail, oldest first.
 *
 * The seeder and its test both come through here so the recency ramp cannot be written
 * down twice and drift. The ramp finishes at the START of the final week rather than on
 * its last day: `t` used to reach 1 only on the very last date, so a trail running past a
 * Monday (which is any visitor arriving mid-week) left the whole final week short of
 * RECENT and quietly less kept than intended. Finishing it a week early is what "by last
 * week the habit is formed" meant in the first place.
 *
 * The floor on the row above today is applied here for the same reason: a guarantee about
 * what a visitor sees should not be reconstructable from four probability tables. It is a
 * different window from the ramp's last-seven-days and deliberately so — see
 * `rowAboveToday`.
 */
export function dayShapes(kid: string, today: string): { day: string; shape: DayShape }[] {
  const trail = pastDays(today);
  const ramp = Math.max(1, trail.length - 7);
  const out = trail.map((day, i) => ({ day, shape: shapeOf(kid, day, Math.min(1, i / ramp)) }));

  // TWO windows, and the floor is applied to each. Their union is what a visitor reads
  // without paging: the whole calendar row above Today, and the freshest stretch of the
  // trail, which is where the elapsed part of Today's own row lives.
  //
  // The second was the only one here before, and on its own it does not reach the first
  // (see `rowAboveToday`). Adding the first and DROPPING the second would have been the
  // smaller diff and it is wrong: `slice(-7)` is what floors Monday and Tuesday of the
  // current week, and losing it took the whole-trail kept ratio to exactly 0.6 on
  // 2026-12-09, i.e. through the floor two assertions up. Fixing a window by unfloring a
  // different one is not a fix.
  //
  // Within each window the NEAR MISSES fill first: the gaps whose roll landed closest to
  // being kept are the ones that become kept. Deterministic, so the repaired week is still
  // the same week for every visitor. Order between the windows does not matter — a pass
  // only ever turns `off` into `routine`, so neither can undo the other's guarantee.
  for (const window of [rowAboveToday(today), trail.slice(-7)]) {
    const days = new Set(window);
    const gaps = out
      .filter((e) => days.has(e.day) && e.shape === "off")
      .sort((a, b) => rand(kid, a.day, "shape") - rand(kid, b.day, "shape"));
    for (const e of gaps.slice(0, Math.max(0, gaps.length - MAX_LAST_WEEK_GAPS))) e.shape = "routine";
  }
  return out;
}

/**
 * Where a sticker landed and how far over it leans.
 *
 * Hand-placed, not centred: a kid drops these with a finger and never squares them up,
 * and a grid of stickers all at 50/50 with no tilt is the clearest single tell that a
 * seeder wrote them. Same reasoning as the authored `x`/`y`/`tilt` on `SeedHistory`, and
 * the ranges are taken from those.
 */
function drop(kid: string, day: string, salt: string) {
  return {
    xPct: 40 + rand(kid, day, `${salt}x`) * 20,
    yPct: 38 + rand(kid, day, `${salt}y`) * 22,
    tiltDeg: -12 + rand(kid, day, `${salt}t`) * 24,
  };
}

/**
 * Seed one kid's past weeks. Returns how many days got something.
 *
 * Every placement is `shined`, the golden state a parent's approval puts on a sticker,
 * because all of this is settled history. A `pending` sticker back there would be a job
 * still waiting on a parent from three weeks ago, which is a household in trouble rather
 * than a successful one.
 */
function seedKidPast(
  familyId: string, childId: string, kidKey: string, today: string, practiceRewardLuna: number,
): number {
  const kidRoutines = routines.listRoutines(familyId, childId);
  const def = PRACTICE[kidKey] ?? DEFAULT_PRACTICE;
  const pj = job(def.job);
  const practice = practicesRepo.createPractice(familyId, childId, pj.en, {
    emoji: pj.emoji, titleKey: jobKey(pj.id), targetPerWeek: def.targetPerWeek,
    rewardLuna: practiceRewardLuna,
  });
  let days = 0;

  for (const { day, shape } of dayShapes(kidKey, today)) {
    if (shape === "off") continue;
    days++;

    // The routine: a finished run, every task done, one sticker on it. One rather than one
    // per task because the calendar draws a day's FIRST placement and no screen anywhere
    // reads a past day's others, see calendar.js stickerFor().
    for (const routine of kidRoutines) {
      const { run, taskRuns } = routines.todayRun(routine, day);
      for (const tr of taskRuns) routines.finishTaskRun(tr.id, "done");
      routines.setRunStatus(run.id, "approved", true);
      const first = taskRuns[0];
      if (first) {
        stickersRepo.placeSticker({
          childId, subjectKind: "routine_task_run", subjectId: first.id, day,
          stickerId: pick(STARTER, kidKey, day, "routine"), state: "shined",
          ...drop(kidKey, day, "routine"),
        });
      }
    }

    // The practice. A logged day IS its done state (routes/stickers.ts chartRows), so
    // there is no run to finish and no approval to settle, and the sticker is `shined`
    // for the same reason the real route places it that way.
    if (shape === "full" || shape === "jobs") {
      const session = practicesRepo.logSession(practice.id, childId, day, def.targetPerWeek * 60);
      stickersRepo.placeSticker({
        childId, subjectKind: "practice_session", subjectId: session.id, day,
        stickerId: pick(STARTER, kidKey, day, "practice"), state: "shined",
        ...drop(kidKey, day, "practice"),
      });
    }
  }
  return days;
}

/**
 * Give every kid in a freshly minted demo family their weeks of history.
 *
 * `kidKey` is the child's LABEL, not their id. Ids are uuids minted per visitor, so
 * seeding off one would give every visitor a differently-shaped month and make the trail
 * unpinnable by a test. Sam's four weeks look the same on every demo there is.
 */
export function seedPastWeeks(
  familyId: string, children: { id: string; label: string }[], today: string,
  practiceRewardLuna: number,
): number {
  let days = 0;
  for (const child of children) {
    days += seedKidPast(familyId, child.id, child.label, today, practiceRewardLuna);
  }
  return days;
}
