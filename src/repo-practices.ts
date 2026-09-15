// Practices domain: the things a kid keeps up (piano, a workout, reading), as
// opposed to the things a kid does today. Same conventions as repo.ts — pure
// functions over getDb(), no HTTP.
//
// A practice has no time of day. It has a WEEKLY TARGET in days, and its history
// is a set of days it happened. Everything below follows from that: a session is
// unique per day (twice on Sunday is still one day toward the target), and the
// streak is counted in WEEKS, not days — a day-streak would punish exactly the
// rest days a weekly target exists to allow.

import { getDb } from "./db";
import { latestApprovalFor } from "./repo-approvals";
import { mondayOf, addDays } from "./days";
// The one reader of "was this child here at all", shared with firstActivityDay so the two
// cannot drift about what counts as a day (see the note on activeDays).
import { activeDays } from "./repo-stickers";

export interface Practice {
  id: string; family_id: string; child_id: string;
  title: string; title_key: string | null; emoji: string; target_per_week: number;
  duration_s: number | null; reward_luna: number; active: number; created_at: number;
}
export interface PracticeSession {
  id: string; practice_id: string; child_id: string;
  day: string; seconds: number | null; created_at: number;
}
/** One exercise inside a practice. Ordered, individually priced, ticked by the kid. */
export interface PracticeStep {
  id: string; practice_id: string; position: number;
  title: string; title_key: string | null; emoji: string;
  reward_luna: number; how: string | null; video_url: string | null; active: number;
}

const uid = () => crypto.randomUUID();
const now = () => Date.now();
const clampTarget = (n: number) => Math.min(7, Math.max(1, Math.round(Number(n) || 1)));

// ---- practices ----
export function createPractice(
  familyId: string, childId: string, title: string,
  opts: { emoji?: string; targetPerWeek?: number; durationS?: number | null; rewardLuna?: number; titleKey?: string | null } = {},
): Practice {
  const p: Practice = {
    id: uid(), family_id: familyId, child_id: childId, title, title_key: opts.titleKey ?? null,
    emoji: opts.emoji || "🎹",
    target_per_week: clampTarget(opts.targetPerWeek ?? 3),
    duration_s: opts.durationS ?? null,
    reward_luna: Math.max(0, Math.round(opts.rewardLuna ?? 0)),
    active: 1, created_at: now(),
  };
  getDb().run(
    `INSERT INTO practices (id, family_id, child_id, title, title_key, emoji, target_per_week, duration_s, reward_luna, active, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [p.id, p.family_id, p.child_id, p.title, p.title_key, p.emoji, p.target_per_week,
      p.duration_s, p.reward_luna, p.active, p.created_at],
  );
  return p;
}

export function getPractice(id: string): Practice | null {
  return (getDb().query("SELECT * FROM practices WHERE id=?").get(id) as Practice) ?? null;
}

/** `includeInactive` is the parent board's view only, for the same reason it is on
 *  listRoutines: a hidden practice must stay reachable by whoever hid it. */
export function listPractices(familyId: string, childId?: string, includeInactive = false): Practice[] {
  const db = getDb();
  const active = includeInactive ? "" : "AND active=1 ";
  return (childId
    ? db.query(`SELECT * FROM practices WHERE family_id=? AND child_id=? ${active}ORDER BY created_at`)
      .all(familyId, childId)
    : db.query(`SELECT * FROM practices WHERE family_id=? ${active}ORDER BY created_at`)
      .all(familyId)) as Practice[];
}

export function updatePractice(
  id: string, patch: { title?: string; emoji?: string; targetPerWeek?: number; durationS?: number | null; rewardLuna?: number },
): Practice | null {
  const p = getPractice(id);
  if (!p) return null;
  const next = {
    title: patch.title?.trim() || p.title,
    // Their words now, so our key goes. Same rule as updateTask().
    title_key: patch.title?.trim() ? null : p.title_key,
    emoji: patch.emoji || p.emoji,
    target: patch.targetPerWeek === undefined ? p.target_per_week : clampTarget(patch.targetPerWeek),
    duration: patch.durationS === undefined ? p.duration_s : patch.durationS,
    reward: patch.rewardLuna === undefined ? p.reward_luna : Math.max(0, Math.round(patch.rewardLuna)),
  };
  getDb().run(
    "UPDATE practices SET title=?, title_key=?, emoji=?, target_per_week=?, duration_s=?, reward_luna=? WHERE id=?",
    [next.title, next.title_key, next.emoji, next.target, next.duration, next.reward, id],
  );
  return getPractice(id);
}

/**
 * Is a day of this practice sitting in the parent's queue, waiting to be paid?
 *
 * Joins the approvals table because the question is about the practice, not about approvals:
 * a day carries no price, so what a waiting day will pay is read off the practice AT APPROVAL
 * TIME (src/routes/approvals.ts). Moving the price out from under a day the kid has already
 * practised is the thing this exists to refuse.
 */
export function hasDayAwaitingApproval(practiceId: string): boolean {
  const row = getDb().query(
    `SELECT 1 AS hit FROM approvals a
       JOIN practice_sessions s ON s.id = a.subject_id
      WHERE a.subject_kind='practice_session' AND a.status='pending' AND s.practice_id=?
      LIMIT 1`,
  ).get(practiceId) as { hit: number } | null;
  return !!row;
}

export function setPracticeActive(id: string, active: boolean): void {
  getDb().run("UPDATE practices SET active=? WHERE id=?", [active ? 1 : 0, id]);
}

// ---- steps: the exercises a day is made of ----
//
// Deliberately the same shape as a routine's tasks (repo-routines.ts): ordered by
// `position`, each carrying its own `reward_luna`, retired rather than deleted. A day of a
// stepped practice pays the sum of the ticked ones, which is `runRewardLuna` — the rule the
// app already has for "pay the parts they actually did", not a second one invented here.

/** Blank is not an answer. "" and "   " both mean the parent wrote nothing, and NULL is how
 *  the column says that; storing the empty string would make a deliberate blank and an
 *  unanswered field look different to every reader downstream when they are the same. */
const orNull = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

export function addStep(
  practiceId: string, title: string,
  opts: {
    emoji?: string; rewardLuna?: number; titleKey?: string | null; position?: number;
    how?: string | null; videoUrl?: string | null;
  } = {},
): PracticeStep {
  const db = getDb();
  const position = opts.position
    ?? ((db.query("SELECT MAX(position) AS m FROM practice_steps WHERE practice_id=?")
      .get(practiceId) as { m: number | null }).m ?? -1) + 1;
  const s: PracticeStep = {
    id: uid(), practice_id: practiceId, position, title, title_key: opts.titleKey ?? null,
    emoji: opts.emoji || "🎵", reward_luna: Math.max(0, Math.round(opts.rewardLuna ?? 0)),
    how: orNull(opts.how), video_url: orNull(opts.videoUrl), active: 1,
  };
  db.run(
    `INSERT INTO practice_steps
       (id, practice_id, position, title, title_key, emoji, reward_luna, how, video_url, active)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [s.id, s.practice_id, s.position, s.title, s.title_key, s.emoji, s.reward_luna,
      s.how, s.video_url, s.active],
  );
  return s;
}

export function getStep(id: string): PracticeStep | null {
  return (getDb().query("SELECT * FROM practice_steps WHERE id=?").get(id) as PracticeStep) ?? null;
}

/** The exercises on the card today. Retired ones are gone from every board, and from the
 *  price of a day that has not happened yet — but never from a day that already ticked one
 *  (see `sessionPayoutLuna`). */
export function listSteps(practiceId: string, includeInactive = false): PracticeStep[] {
  const active = includeInactive ? "" : "AND active=1 ";
  return getDb().query(`SELECT * FROM practice_steps WHERE practice_id=? ${active}ORDER BY position`)
    .all(practiceId) as PracticeStep[];
}

export function updateStep(
  id: string,
  patch: {
    title?: string; emoji?: string; rewardLuna?: number; active?: boolean;
    how?: string | null; videoUrl?: string | null;
  },
): PracticeStep | null {
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    // Their words now, so our key goes — the same rule updateTask() and updatePractice() run.
    fields.push("title=?", "title_key=?");
    vals.push(patch.title, null);
  }
  if (patch.emoji !== undefined) { fields.push("emoji=?"); vals.push(patch.emoji); }
  if (patch.rewardLuna !== undefined) {
    fields.push("reward_luna=?"); vals.push(Math.max(0, Math.round(patch.rewardLuna)));
  }
  if (patch.active !== undefined) { fields.push("active=?"); vals.push(patch.active ? 1 : 0); }
  // Clearing is a real edit: a parent who empties the box wants the how-to GONE, so `""`
  // has to reach the column as NULL rather than being dropped as "nothing was sent".
  if (patch.how !== undefined) { fields.push("how=?"); vals.push(orNull(patch.how)); }
  if (patch.videoUrl !== undefined) { fields.push("video_url=?"); vals.push(orNull(patch.videoUrl)); }
  if (!fields.length) return getStep(id);
  vals.push(id);
  getDb().run(`UPDATE practice_steps SET ${fields.join(", ")} WHERE id=?`, vals as never[]);
  return getStep(id);
}

/**
 * Record what the kid ticked, ONCE.
 *
 * The ticks are the day's price, and the parent's phone is told that price the moment the
 * day is logged. A second call cannot move it — the same reason `logSession` hands back the
 * first session rather than starting a new one, applied to the money. Ids that are not this
 * practice's own live steps are dropped rather than trusted.
 *
 * Returns the ids actually written.
 */
export function tickSteps(session: PracticeSession, stepIds: string[]): string[] {
  const db = getDb();
  if (tickedStepIds(session.id).length) return [];
  const live = new Set(listSteps(session.practice_id).map((s) => s.id));
  const write = [...new Set(stepIds)].filter((id) => live.has(id));
  for (const id of write) {
    db.run("INSERT OR IGNORE INTO practice_step_ticks (session_id, step_id) VALUES (?,?)", [session.id, id]);
  }
  return write;
}

export function tickedStepIds(sessionId: string): string[] {
  return (getDb().query("SELECT step_id FROM practice_step_ticks WHERE session_id=?")
    .all(sessionId) as { step_id: string }[]).map((r) => r.step_id);
}

/**
 * What a logged day is worth: the sum of `reward_luna` over the steps the kid TICKED.
 *
 * A transcription of `runRewardLuna` (repo-routines.ts), and the join deliberately does NOT
 * filter on `active`: a step the kid ticked was a promise at the moment they did it, and
 * retiring it afterwards must not take the money back.
 */
export function sessionPayoutLuna(sessionId: string): number {
  const row = getDb().query(
    `SELECT COALESCE(SUM(s.reward_luna), 0) AS luna
       FROM practice_step_ticks tk JOIN practice_steps s ON s.id = tk.step_id
      WHERE tk.session_id=?`,
  ).get(sessionId) as { luna: number };
  return row.luna;
}

/**
 * THE ONE PLACE A DAY'S PRICE IS ANSWERED. Every caller — the kid's pill, the parent's card,
 * the payout itself — reads this, so a practice cannot show one number and pay another.
 *
 *   no steps            -> the practice's own reward, exactly as before steps existed
 *   steps, no day yet   -> everything on offer today (nothing is ticked, so nothing is owed
 *                          yet; this is what the card promises a kid who does all of it)
 *   steps, day logged   -> the ticked sum, frozen when the day was logged
 */
export function practiceDayLuna(practice: Practice, sessionId: string | null): number {
  const steps = listSteps(practice.id);
  if (!steps.length) return practice.reward_luna;
  if (!sessionId) return steps.reduce((n, s) => n + s.reward_luna, 0);
  return sessionPayoutLuna(sessionId);
}

// ---- sessions ----
/** Log that the practice happened on `day`. Idempotent: the second call on the
 *  same day returns the first session rather than adding to the week's count. */
export function logSession(practiceId: string, childId: string, day: string, seconds?: number | null): PracticeSession {
  const existing = getSession(practiceId, day);
  if (existing) {
    // Keep the longest recorded sitting rather than overwriting with a shorter one.
    if (seconds != null && seconds > (existing.seconds ?? 0)) {
      getDb().run("UPDATE practice_sessions SET seconds=? WHERE id=?", [seconds, existing.id]);
      return getSession(practiceId, day)!;
    }
    return existing;
  }
  const s: PracticeSession = {
    id: uid(), practice_id: practiceId, child_id: childId, day,
    seconds: seconds ?? null, created_at: now(),
  };
  getDb().run(
    "INSERT INTO practice_sessions (id, practice_id, child_id, day, seconds, created_at) VALUES (?,?,?,?,?,?)",
    [s.id, s.practice_id, s.child_id, s.day, s.seconds, s.created_at],
  );
  return s;
}

export function getSession(practiceId: string, day: string): PracticeSession | null {
  return (getDb().query("SELECT * FROM practice_sessions WHERE practice_id=? AND day=?")
    .get(practiceId, day) as PracticeSession) ?? null;
}

export function getSessionById(id: string): PracticeSession | null {
  return (getDb().query("SELECT * FROM practice_sessions WHERE id=?").get(id) as PracticeSession) ?? null;
}

/** Every day the practice happened in [from, to] inclusive. */
export function sessionDays(practiceId: string, from: string, to: string): string[] {
  return (getDb().query("SELECT day FROM practice_sessions WHERE practice_id=? AND day>=? AND day<=? ORDER BY day")
    .all(practiceId, from, to) as { day: string }[]).map((r) => r.day);
}

/** How many DAYS of the week starting `weekStart` (a Monday) it happened. */
export function weekCount(practiceId: string, weekStart: string): number {
  return sessionDays(practiceId, weekStart, addDays(weekStart, 6)).length;
}

/**
 * Consecutive weeks that met the target, counted backwards from `today`'s week.
 *
 * The current week only COUNTS once it has already met the target, but it never
 * BREAKS the streak while it is still in progress — a kid looking at a fresh
 * Monday should see the streak they earned, not a zero. So: if this week is
 * already met, start counting here; otherwise start from last week and leave
 * this week's chance open.
 *
 * ⚠️ A WEEK THE KID WAS NOT HERE IS SKIPPED, NOT FAILED (Andjroo, 2026-08-27).
 *
 * His two are with their mother half the time — "every other Wednesday, Thursday, Friday and
 * Sunday" — so on the off week nobody so much as picks up the tablet. Counting that as a week
 * under target made the streak reset every fortnight FOREVER: neither child could ever hold a
 * streak longer than 1, no matter what they did, and nothing about the app would have explained
 * why. A number that can only ever say 0 or 1 is worse than no number.
 *
 * The app has no idea which days a kid is in the house, and Andjroo chose to INFER it rather
 * than declare a schedule: a schedule needs upkeep, and a stale one silently hides real days,
 * which is worse than the bug. So a week with no trace of this child at all — no routine run,
 * no practice session, no sticker — is stepped over. It neither counts toward the streak nor
 * ends it.
 *
 * The trade he accepted: a week they WERE home and did nothing is also stepped over. That is
 * the generous direction to be wrong in, and `activeDays` is deliberately loose enough that
 * merely opening the board makes the week real again — so the ordinary lazy week still breaks
 * the streak, because opening the board is what a kid does.
 */
export function weekStreak(practiceId: string, today: string, target: number, childId: string): number {
  const thisWeek = mondayOf(today);
  let week = weekCount(practiceId, thisWeek) >= target ? thisWeek : addDays(thisWeek, -7);
  // The floor. Without it a run of empty weeks is no longer a stopping condition and the loop
  // walks backwards forever — skipping a dead week is exactly what removed the old bound.
  const floor = firstActivityDay(practiceId, childId);
  let streak = 0;
  while (week >= floor) {
    if (weekCount(practiceId, week) >= target) streak++;
    else if (activeDays(childId, week, addDays(week, 6)).size > 0) break; // here, and fell short
    week = addDays(week, -7);
  }
  return streak;
}

/** The Monday of the first week worth looking at: this child's earliest trace, or this
 *  practice's first session, whichever is further back. Purely the loop's bound. */
function firstActivityDay(practiceId: string, childId: string): string {
  const row = getDb().query(
    `SELECT MIN(day) AS day FROM (
       SELECT MIN(day) AS day FROM practice_sessions WHERE practice_id=?
       UNION ALL SELECT MIN(day) FROM routine_runs      WHERE child_id=?
       UNION ALL SELECT MIN(day) FROM sticker_placements WHERE child_id=?
     )`,
  ).get(practiceId, childId, childId) as { day: string | null } | null;
  return mondayOf(row?.day ?? "9999-12-31");
}

/**
 * Where today's session stands with the grown-up.
 *
 * `null` covers two cases deliberately: a practice that pays nothing, where there is nobody to
 * wait for, and a day logged before payment was wired. Both mean nothing is owed, which is the
 * same thing to draw.
 *
 * Read off the approval rather than off a column on the session, because the approval IS the
 * record of what the parent decided — and under parent custody it is not decided until the
 * signed bytes are on the wire (src/wallet/payout-subject.ts). A second place to write "paid"
 * is a second place for it to disagree with whether money actually moved.
 */
export type PracticePayState = "waiting" | "paid" | "declined" | null;

function payState(sessionId: string | null): PracticePayState {
  if (!sessionId) return null;
  const a = latestApprovalFor("practice_session", sessionId);
  if (!a) return null;
  return a.status === "pending" ? "waiting" : a.status === "approved" ? "paid" : "declined";
}

/** Everything the kid app needs to draw one practice card. */
export function practiceView(p: Practice, today: string) {
  const weekStart = mondayOf(today);
  const session = getSession(p.id, today);
  // Today's steps, each carrying whether the kid ticked it. Before the day is logged
  // nothing is ticked, so this is the offer; afterwards it is the record.
  const ticked = new Set(session ? tickedStepIds(session.id) : []);
  const steps = listSteps(p.id).map((s) => ({
    id: s.id, title: s.title, titleKey: s.title_key, emoji: s.emoji,
    rewardLuna: s.reward_luna, how: s.how, videoUrl: s.video_url, done: ticked.has(s.id),
  }));
  return {
    id: p.id, title: p.title, titleKey: p.title_key, emoji: p.emoji,
    // The parent board asks for hidden practices too and has to draw them as hidden;
    // every kid-facing caller only ever gets active ones, so this is always 1 there.
    active: !!p.active,
    targetPerWeek: p.target_per_week,
    durationS: p.duration_s,
    // What THIS DAY pays, not what the practice's own column says: a stepped practice is
    // priced by its steps and its own reward_luna is never read (schema.sql, #288's rule).
    rewardLuna: practiceDayLuna(p, session?.id ?? null),
    // What a WHOLE day is worth, which is a different question and the one the parent's board
    // row asks: that row states a standing promise ("40 NIM a day"), and it must not start
    // reading as today's tally the moment the kid ticks two exercises out of three.
    fullDayLuna: practiceDayLuna(p, null),
    steps,
    stepsDone: steps.filter((s) => s.done).length,
    weekDone: weekCount(p.id, weekStart),
    weekStreak: weekStreak(p.id, today, p.target_per_week, p.child_id),
    doneToday: !!session,
    sessionId: session?.id ?? null,
    payState: payState(session?.id ?? null),
  };
}
