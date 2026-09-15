// Routines domain: daily task sequences with per-task egg timers (family mode).
// Same conventions as repo.ts — pure functions over getDb(), no HTTP.

import { getDb } from "./db";

/** The parts of the day a routine can sit in. 'custom' has no time of day and
 *  lands in the kid app's "Any time" group. */
export const ROUTINE_SLOTS = ["morning", "afternoon", "evening", "custom"] as const;
export type RoutineSlot = (typeof ROUTINE_SLOTS)[number];
export type RunStatus = "in_progress" | "done_pending" | "approved";
/** 'skipped' is a PARENT excusing a step; 'passed' is a KID leaving a side quest on the
 *  table when they tapped the chest. Both terminal, both unpaid, and kept apart because the
 *  parent's card is the one place a household can still tell which of the two happened. */
export type TaskRunStatus = "pending" | "running" | "done" | "skipped" | "passed";

export interface Routine {
  id: string; family_id: string; child_id: string; slot: RoutineSlot;
  /** `title_key` wins when set (src/title-catalog.ts); NULL = the parent's words. */
  title: string; title_key: string | null; emoji: string; active: number; created_at: number;
}
export interface RoutineTask {
  id: string; routine_id: string; position: number; title: string;
  title_key: string | null; emoji: string;
  icon_asset_id: string | null; duration_s: number; reward_stars: number;
  /** V2 family mode: NIM (luna) paid on approval; reward_stars is legacy/demo compat */
  reward_luna: number;
  /** 1 = a SIDE QUEST: the run finishes without it, and doing it pays its own reward on top.
   *  No payment code reads this. It changes only what `allTasksFinished` waits for. */
  optional: number;
  active: number;
}
export interface RoutineRun {
  id: string; routine_id: string; child_id: string; day: string;
  status: RunStatus; started_at: number; finished_at: number | null;
}
export interface TaskRun {
  id: string; run_id: string; task_id: string; status: TaskRunStatus;
  started_at: number | null; finished_at: number | null;
}

const uid = () => crypto.randomUUID();
const now = () => Date.now();

/** 'YYYY-MM-DD' for a wall-clock instant in the family's timezone (en-CA gives ISO order). */
export function localDay(tz: string, nowMs = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(nowMs));
}

// ---- routines ----
export function createRoutine(
  familyId: string, childId: string, title: string, slot: RoutineSlot = "morning", emoji = "🌅",
  titleKey: string | null = null,
): Routine {
  const r: Routine = {
    id: uid(), family_id: familyId, child_id: childId, slot, title, title_key: titleKey,
    emoji, active: 1, created_at: now(),
  };
  getDb().run(
    "INSERT INTO routines (id, family_id, child_id, slot, title, title_key, emoji, active, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [r.id, r.family_id, r.child_id, r.slot, r.title, r.title_key, r.emoji, r.active, r.created_at],
  );
  return r;
}
export function getRoutine(id: string): Routine | null {
  return (getDb().query("SELECT * FROM routines WHERE id=?").get(id) as Routine) ?? null;
}
/**
 * Routines for a board. `includeInactive` is the PARENT's view and nothing else:
 * a retired routine has to stay reachable by whoever retired it, or the button
 * that hides it is a one-way door. Every kid-facing caller leaves it false, so
 * a retired routine is still gone from every board that matters.
 */
export function listRoutines(familyId: string, childId?: string, includeInactive = false): Routine[] {
  const active = includeInactive ? "" : "AND active=1 ";
  if (childId) {
    return getDb().query(`SELECT * FROM routines WHERE family_id=? AND child_id=? ${active}ORDER BY created_at`)
      .all(familyId, childId) as Routine[];
  }
  return getDb().query(`SELECT * FROM routines WHERE family_id=? ${active}ORDER BY created_at`)
    .all(familyId) as Routine[];
}
export function setRoutineActive(id: string, active: boolean): void {
  getDb().run("UPDATE routines SET active=? WHERE id=?", [active ? 1 : 0, id]);
}

/** Rename a routine, move it to another part of the day, or give it a new face.
 *  Renaming clears `title_key` for the same reason it does on a task or a
 *  practice: once the words are the parent's, ours must not come back over them
 *  at the next language change. */
export function updateRoutine(
  id: string,
  patch: { title?: string; slot?: RoutineSlot; emoji?: string },
): Routine | null {
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    fields.push("title=?", "title_key=?");
    vals.push(patch.title, null);
  }
  if (patch.slot !== undefined) { fields.push("slot=?"); vals.push(patch.slot); }
  if (patch.emoji !== undefined) { fields.push("emoji=?"); vals.push(patch.emoji); }
  if (!fields.length) return getRoutine(id);
  vals.push(id);
  getDb().run(`UPDATE routines SET ${fields.join(", ")} WHERE id=?`, vals as never[]);
  return getRoutine(id);
}

// ---- routine tasks ----
export function addTask(
  routineId: string, title: string, durationS: number,
  opts: { emoji?: string; rewardStars?: number; rewardLuna?: number; position?: number; iconAssetId?: string | null; titleKey?: string | null; optional?: boolean } = {},
): RoutineTask {
  const db = getDb();
  const position = opts.position
    ?? ((db.query("SELECT MAX(position) AS m FROM routine_tasks WHERE routine_id=?").get(routineId) as { m: number | null }).m ?? -1) + 1;
  const t: RoutineTask = {
    id: uid(), routine_id: routineId, position, title, title_key: opts.titleKey ?? null,
    emoji: opts.emoji ?? "🪥", icon_asset_id: opts.iconAssetId ?? null,
    duration_s: durationS, reward_stars: opts.rewardStars ?? 1, reward_luna: opts.rewardLuna ?? 0,
    optional: opts.optional ? 1 : 0, active: 1,
  };
  db.run(
    "INSERT INTO routine_tasks (id, routine_id, position, title, title_key, emoji, icon_asset_id, duration_s, reward_stars, reward_luna, optional, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [t.id, t.routine_id, t.position, t.title, t.title_key, t.emoji, t.icon_asset_id, t.duration_s, t.reward_stars, t.reward_luna, t.optional, t.active],
  );
  return t;
}
export function getTask(id: string): RoutineTask | null {
  return (getDb().query("SELECT * FROM routine_tasks WHERE id=?").get(id) as RoutineTask) ?? null;
}
export function listTasks(routineId: string): RoutineTask[] {
  return getDb().query("SELECT * FROM routine_tasks WHERE routine_id=? AND active=1 ORDER BY position")
    .all(routineId) as RoutineTask[];
}
export function updateTask(
  id: string,
  patch: Partial<Pick<RoutineTask, "title" | "emoji" | "duration_s" | "reward_stars" | "reward_luna" | "position" | "icon_asset_id" | "optional">> & { active?: boolean },
): void {
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [col, v] of [
    ["title", patch.title], ["emoji", patch.emoji], ["duration_s", patch.duration_s],
    ["reward_stars", patch.reward_stars], ["reward_luna", patch.reward_luna],
    ["position", patch.position], ["icon_asset_id", patch.icon_asset_id],
    ["optional", patch.optional],
  ] as const) {
    if (v !== undefined) { fields.push(`${col}=?`); vals.push(v); }
  }
  if (patch.active !== undefined) { fields.push("active=?"); vals.push(patch.active ? 1 : 0); }
  // Renaming makes the title theirs. Keeping the key would put OUR words back
  // over their edit the instant the device language changed — the edit would
  // look applied on the parent's phone and be gone on the kid's tablet.
  if (patch.title !== undefined) { fields.push("title_key=?"); vals.push(null); }
  if (!fields.length) return;
  vals.push(id);
  getDb().run(`UPDATE routine_tasks SET ${fields.join(", ")} WHERE id=?`, vals as never[]);
}

// ---- runs ----
/**
 * A RUN THAT HAS ALREADY STARTED, BROUGHT BACK INTO LINE WITH ITS ROUTINE (#381).
 *
 * A run snapshots its routine's task list once, as task_runs. Editing the routine after that
 * leaves the snapshot pointing at rows that are now retired, and the board's own rule is that
 * an edited task is RETIRED (`active = 0`), never deleted — so this is what an ordinary parent
 * does at 9am, not an exotic state.
 *
 * It cost two things, and the second is much worse than the first:
 *
 *   1. INVISIBLE. The chart skips any task_run whose task it cannot find among the ACTIVE
 *      ones, so the whole routine silently disappears off the tablet. Found on the real
 *      family instance: both kids' Morning and Evening vanished, no error anywhere.
 *
 *   2. UNFINISHABLE, AND THEREFORE UNPAID. `allTasksFinished` joins routine_tasks with no
 *      active filter and asks whether any required task_run is still pending. A retired
 *      task's pending row answers yes forever, so the run can never reach done_pending, no
 *      approval is ever opened, and the day can never be paid. Nothing surfaces that either.
 *
 * The rule: a run contains exactly what is still being asked for, PLUS whatever the kid has
 * already done. So —
 *
 *   ADD     a pending row for every active task with none, so a step added mid-morning shows up
 *   DROP    rows for retired tasks that were never started; they are the ones that jam the run
 *   KEEP    rows for retired tasks the kid DID. They earned it. `runRewardLuna` and `runStars`
 *           deliberately join without an active filter for exactly this reason, so the money is
 *           already right; what was missing is that the card stayed on the board to explain it
 *           (see the getTask fallback in routes/stickers.ts).
 *
 * ⚠️ ONLY WHILE THE RUN IS `in_progress`. A run that has been handed in or approved is history,
 * and a parent tidying up their routines next week must not reach back and rewrite what a kid
 * was paid for. `demo-past.ts` builds finished days through this same function.
 */
function reconcileRun(run: RoutineRun): void {
  if (run.status !== "in_progress") return;
  const db = getDb();
  db.run(
    `DELETE FROM task_runs
      WHERE run_id = ? AND status IN ('pending','running')
        AND task_id IN (SELECT id FROM routine_tasks WHERE active = 0)`,
    [run.id],
  );
  const seen = new Set(listTaskRuns(run.id).map((tr) => tr.task_id));
  for (const t of listTasks(run.routine_id)) {
    if (seen.has(t.id)) continue;
    db.run("INSERT INTO task_runs (id, run_id, task_id, status) VALUES (?,?,?,'pending')", [uid(), run.id, t.id]);
  }
}

/** Get-or-create today's run (+ its task_runs). Idempotent via UNIQUE(routine_id, day).
 *  An EXISTING run is reconciled against the routine first — see reconcileRun. */
export function todayRun(routine: Routine, day: string): { run: RoutineRun; taskRuns: TaskRun[] } {
  const db = getDb();
  let run = db.query("SELECT * FROM routine_runs WHERE routine_id=? AND day=?").get(routine.id, day) as RoutineRun | null;
  if (!run) {
    run = {
      id: uid(), routine_id: routine.id, child_id: routine.child_id, day,
      status: "in_progress", started_at: now(), finished_at: null,
    };
    db.run(
      "INSERT INTO routine_runs (id, routine_id, child_id, day, status, started_at) VALUES (?,?,?,?,?,?)",
      [run.id, run.routine_id, run.child_id, run.day, run.status, run.started_at],
    );
    for (const t of listTasks(routine.id)) {
      db.run("INSERT INTO task_runs (id, run_id, task_id, status) VALUES (?,?,?,'pending')", [uid(), run.id, t.id]);
    }
  } else {
    reconcileRun(run);
  }
  return { run, taskRuns: listTaskRuns(run.id) };
}
export function getRun(id: string): RoutineRun | null {
  return (getDb().query("SELECT * FROM routine_runs WHERE id=?").get(id) as RoutineRun) ?? null;
}
/** Read-only lookup (todayRun get-or-CREATES — kiosk state checks must not create runs). */
export function findRun(routineId: string, day: string): RoutineRun | null {
  return (getDb().query("SELECT * FROM routine_runs WHERE routine_id=? AND day=?").get(routineId, day) as RoutineRun) ?? null;
}
export function setRunStatus(id: string, status: RunStatus, finished = false): void {
  if (finished) getDb().run("UPDATE routine_runs SET status=?, finished_at=? WHERE id=?", [status, now(), id]);
  else getDb().run("UPDATE routine_runs SET status=? WHERE id=?", [status, id]);
}
export function listTaskRuns(runId: string): TaskRun[] {
  return getDb().query(
    `SELECT tr.* FROM task_runs tr JOIN routine_tasks t ON tr.task_id = t.id
      WHERE tr.run_id=? ORDER BY t.position`,
  ).all(runId) as TaskRun[];
}
export function getTaskRun(id: string): TaskRun | null {
  return (getDb().query("SELECT * FROM task_runs WHERE id=?").get(id) as TaskRun) ?? null;
}
export function startTaskRun(id: string): void {
  getDb().run("UPDATE task_runs SET status='running', started_at=? WHERE id=?", [now(), id]);
}
export function finishTaskRun(id: string, status: "done" | "skipped" | "passed"): void {
  getDb().run("UPDATE task_runs SET status=?, finished_at=? WHERE id=?", [status, now(), id]);
}
/**
 * True when every REQUIRED task in the run has reached a terminal state.
 *
 * This used to count every open row, which is exactly right until a step exists that the kid
 * does not have to do: a side quest nobody chose sits at 'pending' forever, the run never
 * submits, and the chest at the end of the trail never opens (#341).
 *
 * It deliberately answers only "are the required steps done", and NOT "should the run submit
 * now". Those separated the moment optional steps existed, because auto-submitting on the last
 * required step would freeze the run (`runSubmitted`) and turn the bonus into a trap that costs
 * the kid money. `openOptionalTaskRuns` is the other half, and `completeRunIfFinished` is where
 * the two are read together.
 */
export function allTasksFinished(runId: string): boolean {
  const row = getDb().query(
    `SELECT COUNT(*) AS open
       FROM task_runs tr JOIN routine_tasks t ON tr.task_id = t.id
      WHERE tr.run_id=? AND t.optional=0 AND tr.status IN ('pending','running')`,
  ).get(runId) as { open: number };
  return row.open === 0;
}
/** Side quests the kid could still choose to do. Empty for every routine without one, which
 *  is why a routine that has no bonus behaves exactly as it did before #341. */
export function openOptionalTaskRuns(runId: string): TaskRun[] {
  return getDb().query(
    `SELECT tr.* FROM task_runs tr JOIN routine_tasks t ON tr.task_id = t.id
      WHERE tr.run_id=? AND t.optional=1 AND tr.status IN ('pending','running')
      ORDER BY t.position`,
  ).all(runId) as TaskRun[];
}
/** Close the side quests the kid left alone, at the moment they end the run themselves.
 *  Terminal and unpaid: `runRewardLuna` only ever sums 'done', so this moves no money. */
export function passOpenOptionalTaskRuns(runId: string): number {
  const open = openOptionalTaskRuns(runId);
  for (const tr of open) finishTaskRun(tr.id, "passed");
  return open.length;
}
/** Stars earned by a run = sum of reward_stars over its DONE tasks (skips earn nothing). */
export function runStars(runId: string): number {
  const row = getDb().query(
    `SELECT COALESCE(SUM(t.reward_stars), 0) AS stars
       FROM task_runs tr JOIN routine_tasks t ON tr.task_id = t.id
      WHERE tr.run_id=? AND tr.status='done'`,
  ).get(runId) as { stars: number };
  return row.stars;
}
/** V2 family mode: NIM (luna) earned by a run = sum of reward_luna over its DONE tasks. */
export function runRewardLuna(runId: string): number {
  const row = getDb().query(
    `SELECT COALESCE(SUM(t.reward_luna), 0) AS luna
       FROM task_runs tr JOIN routine_tasks t ON tr.task_id = t.id
      WHERE tr.run_id=? AND tr.status='done'`,
  ).get(runId) as { luna: number };
  return row.luna;
}
