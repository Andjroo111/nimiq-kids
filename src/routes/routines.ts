// Family-mode routines: daily task sequences with per-task egg timers.
// Kids drive start/done with no auth (it's their tablet); structure edits and
// skips are parent actions (PIN or bearer token).

import { Hono } from "hono";
import type { Context } from "hono";
import * as repo from "../repo";
import * as routines from "../repo-routines";
import * as approvals from "../repo-approvals";
import * as lockRepo from "../repo-lock";
import * as stickersRepo from "../repo-stickers";
import { parentAuth, hasParentToken } from "../auth";
import { notifyParent } from "../notify";
import { publishLockChange } from "../lock-events";
import { familyForSubject, PAIRING_REQUIRED, requestFamily } from "./families";
import { resolveJob, jobKey, ROUTINE_CATALOG, routineKey } from "../title-catalog";
import { nimUsd, usdToWholeNimLuna } from "../rates";
import { INVALID_EMOJI, readEmoji, readOptionalEmoji } from "../emoji-field";
import { refuseBoardWrite } from "./members";

export const routinesRoutes = new Hono();

/** A routine and everything it owns: its steps, and the times of day it locks the tablet.
 *  The windows ride ALONG with the routine rather than on a list of their own, because a
 *  window without its routine is unreadable — it locks the screen until THAT routine is
 *  approved, and the parent screen that draws one is the routine's own card. */
function withTasks(r: routines.Routine) {
  return { ...r, tasks: routines.listTasks(r.id), windows: lockRepo.listWindows(r.id) };
}

/** All-done → done_pending + open an approval + ping the parent. Shared by the last
 *  task's /done and by /routine-runs/:id/submit (the chest, and redo after a reject).
 *
 *  `endRun` is what separates the two callers, and it is the whole of the side-quest rule
 *  (#341). Submitting freezes the run (`runSubmitted` answers 409 on any further write), so
 *  auto-submitting the instant the last REQUIRED step lands would silently close the door on
 *  a side quest the kid was still free to do, and the bonus would be a trap that costs them
 *  money. So: with a side quest still open, finishing a required step does nothing and the
 *  kid ends the day themselves by tapping the chest. With none open, this is exactly the
 *  behaviour it has always been, which is why a routine without side quests cannot notice
 *  that this feature was built. */
function completeRunIfFinished(
  fam: repo.Family, run: routines.RoutineRun, endRun = false,
): boolean {
  if (!routines.allTasksFinished(run.id)) return false;
  if (routines.openOptionalTaskRuns(run.id).length) {
    if (!endRun) return false;
    routines.passOpenOptionalTaskRuns(run.id);
  }
  routines.setRunStatus(run.id, "done_pending", true);
  stickersRepo.resetRetryRunPlacements(run.id); // V3: redo after reject, stickers hopeful again
  const approval = approvals.openApproval(fam.id, run.child_id, "routine_run", run.id);
  const child = repo.getChild(run.child_id);
  const routine = routines.getRoutine(run.routine_id);
  // V2: routines pay NIM (reward_luna); the stars line remains only for legacy star-era tasks.
  const luna = routines.runRewardLuna(run.id);
  notifyParent(fam, {
    title: `${child?.emoji ?? ""} ${child?.label ?? "Kid"} finished ${routine?.title ?? "their routine"}!`,
    body: luna > 0
      ? `${(luna / 1e5).toFixed(2)} NIM waiting for your OK`
      : `${routines.runStars(run.id)} ⭐ waiting for your OK`,
    clickUrl: process.env.PARENT_URL ? `${process.env.PARENT_URL}#approval=${approval.id}` : undefined,
    tags: "star",
  });
  return true;
}

/** `?includeInactive=1` adds retired routines, and only ever for a parent holding this
 *  family's bearer token. It is what the parent board needs to offer a retired routine
 *  back; a kid's tablet asking for it gets the same list it always got. */
routinesRoutes.get("/routines", async (c) => {
  const childId = c.req.query("childId");
  const wantsInactive = c.req.query("includeInactive") === "1";
  // With a childId the child row names the family (multi-family kid tablets);
  // without one this is an instance-level surface (legacy tablet boot).
  if (childId) {
    const child = repo.getChild(childId);
    const fam = child ? await familyForSubject(c, child.family_id) : null;
    if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
    const all = wantsInactive && await hasParentToken(c, fam);
    return c.json({ routines: routines.listRoutines(fam.id, childId, all).map(withTasks) });
  }
  const fam = await requestFamily(c);
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  const all = wantsInactive && await hasParentToken(c, fam);
  return c.json({ routines: routines.listRoutines(fam.id, undefined, all).map(withTasks) });
});

/**
 * A routine has NO reward of its own. What it pays is the sum of its tasks'
 * `reward_luna` (`repo-routines.runRewardLuna`), and the `routines` table has no reward
 * column at all.
 *
 * This route used to accept a `rewardLuna` in the body and drop it without a word, so a
 * client that set the reward in the obvious place got a routine that paid nothing and no
 * error saying why. It cost the mainnet E2E run a cycle (#132). `POST /chores` validates
 * the same field, so the shape was inconsistent as well as silent.
 *
 * Refused rather than honoured: honouring it means either a column nothing reads or a
 * second, competing definition of what a routine pays. The reward goes on the tasks.
 */
function rewardOnRoutine(body: Record<string, unknown>): boolean {
  return body.rewardLuna !== undefined || body.reward_luna !== undefined
    || body.rewardUsd !== undefined || body.rewardStars !== undefined;
}
const REWARD_ON_ROUTINE = {
  error: "reward_not_on_routine",
  hint: "A routine pays the sum of its tasks. Set rewardLuna (or rewardUsd) on each task via POST /api/routines/:id/tasks.",
} as const;

routinesRoutes.post("/routines", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const childId = String(body.childId ?? "");
  const title = String(body.title ?? "").trim();
  const slot = String(body.slot ?? "morning") as routines.RoutineSlot;
  const child = repo.getChild(childId);
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  if (rewardOnRoutine(body)) return c.json(REWARD_ON_ROUTINE, 400);
  if (!title) return c.json({ error: "title_required" }, 400);
  // 'afternoon' has been a group on the kid's Today screen since the walkthrough,
  // but this allowlist rejected it — so the middle of the day was unreachable: no
  // parent could create a routine that landed there (Andjroo, 2026-07-30).
  if (!routines.ROUTINE_SLOTS.includes(slot as routines.RoutineSlot)) {
    return c.json({ error: "invalid_slot" }, 400);
  }
  const slotEmoji: Record<routines.RoutineSlot, string> =
    { morning: "🌅", afternoon: "☀️", evening: "🌙", custom: "🌅" };
  const emoji = readEmoji(body.emoji, slotEmoji[slot]);
  if (emoji === null) return c.json(INVALID_EMOJI, 400);
  // "Morning routine" is a name we wrote, so when the parent kept the one the
  // slot suggested it carries the slot's key and translates. The moment they
  // type something else it is theirs, keyless, and shown exactly as typed.
  // `evening` is the slot; `bedtime` is what the catalog calls the routine.
  const SLOT_CATALOG: Partial<Record<routines.RoutineSlot, string>> =
    { morning: "morning", afternoon: "afternoon", evening: "bedtime" };
  const suggested = ROUTINE_CATALOG.find((r) => r.id === SLOT_CATALOG[slot]);
  const titleKey = suggested && suggested.en === title ? routineKey(suggested.id) : null;
  const routine = routines.createRoutine(fam.id, childId, title, slot, emoji, titleKey);
  return c.json({ routine: withTasks(routine) }, 201);
});

/** Rename a routine, move it to another part of the day, or retire it.
 *
 *  `active: false` is the only "delete" there is, and it is the right one: a
 *  routine owns runs, task runs and sticker placements that all have to stay
 *  readable, so retiring hides it from every board while the history it produced
 *  survives. listRoutines already filters on active=1, so nothing else changes. */
routinesRoutes.patch("/routines/:id", async (c) => {
  const routine = routines.getRoutine(c.req.param("id"));
  const fam = routine ? await familyForSubject(c, routine.family_id) : null;
  if (!routine || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  // Same silent drop as POST, same refusal. A parent editing a routine to "make it worth
  // more" is exactly the caller this catches.
  if (rewardOnRoutine(body)) return c.json(REWARD_ON_ROUTINE, 400);

  let title: string | undefined;
  if (body.title !== undefined) {
    title = String(body.title).trim();
    if (!title) return c.json({ error: "title_required" }, 400);
  }
  let slot: routines.RoutineSlot | undefined;
  if (body.slot !== undefined) {
    slot = String(body.slot) as routines.RoutineSlot;
    if (!routines.ROUTINE_SLOTS.includes(slot)) return c.json({ error: "invalid_slot" }, 400);
  }
  const emoji = readOptionalEmoji(body.emoji);
  if (emoji === null) return c.json(INVALID_EMOJI, 400);

  if (body.active !== undefined) routines.setRoutineActive(routine.id, Boolean(body.active));
  const updated = routines.updateRoutine(routine.id, { title, slot, emoji });
  return c.json({ routine: updated ? withTasks(updated) : null });
});

routinesRoutes.post("/routines/:id/tasks", async (c) => {
  const routine = routines.getRoutine(c.req.param("id"));
  const fam = routine ? await familyForSubject(c, routine.family_id) : null;
  if (!routine || !fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  // Same contract as POST /chores: a tile posts `catalogId`, the words come
  // from the catalog. Sub-tasks are where the untranslated board was most
  // obvious — "MAÑANA" over "Brush your teeth" (Andjroo, 2026-08-01).
  const picked = resolveJob(body.catalogId);
  const title = picked ? picked.en : String(body.title ?? "").trim();
  const durationS = Math.round(Number(body.durationS ?? 0));
  if (!title) return c.json({ error: "title_required" }, 400);
  if (!Number.isFinite(durationS) || durationS <= 0) return c.json({ error: "duration_required" }, 400);
  const rewardStars = Math.round(Number(body.rewardStars ?? 1));
  if (!Number.isFinite(rewardStars) || rewardStars < 0) return c.json({ error: "invalid_reward" }, 400);
  // V2: tasks pay NIM (luna) on approval; stars are legacy/demo compat.
  // rewardUsd authors in dollars and stores a WHOLE number of NIM (see ../rates).
  const rewardLuna = body.rewardUsd !== undefined
    ? usdToWholeNimLuna(Number(body.rewardUsd), await nimUsd())
    : Math.round(Number(body.rewardLuna ?? 0));
  if (!Number.isFinite(rewardLuna) || rewardLuna < 0) return c.json({ error: "invalid_reward" }, 400);
  // A routine task's emoji renders on the kid tablet exactly like a chore's.
  const taskEmoji = readOptionalEmoji(body.emoji);
  if (taskEmoji === null) return c.json(INVALID_EMOJI, 400);
  const task = routines.addTask(routine.id, title, durationS, {
    emoji: picked ? picked.emoji : taskEmoji,
    titleKey: picked ? jobKey(picked.id) : null,
    rewardStars,
    rewardLuna,
    position: body.position !== undefined ? Number(body.position) : undefined,
    iconAssetId: body.iconAssetId ? String(body.iconAssetId) : null,
    // Extra credit (#342). Absent means required, which is what every step has always been.
    optional: Boolean(body.optional),
  });
  return c.json({ task }, 201);
});

routinesRoutes.patch("/routines/:id/tasks/:taskId", async (c) => {
  const task = routines.getTask(c.req.param("taskId"));
  if (!task || task.routine_id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
  const routine = routines.getRoutine(task.routine_id);
  const fam = routine ? await familyForSubject(c, routine.family_id) : null;
  if (!fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const patchedEmoji = readOptionalEmoji(body.emoji);
  if (patchedEmoji === null) return c.json(INVALID_EMOJI, 400);
  routines.updateTask(task.id, {
    title: body.title !== undefined ? String(body.title).trim() : undefined,
    emoji: patchedEmoji,
    duration_s: body.durationS !== undefined ? Math.round(Number(body.durationS)) : undefined,
    reward_stars: body.rewardStars !== undefined ? Math.round(Number(body.rewardStars)) : undefined,
    reward_luna: body.rewardLuna !== undefined ? Math.round(Number(body.rewardLuna)) : undefined,
    position: body.position !== undefined ? Number(body.position) : undefined,
    icon_asset_id: body.iconAssetId !== undefined ? (body.iconAssetId ? String(body.iconAssetId) : null) : undefined,
    // `undefined` when unsent, so a rename cannot quietly un-bonus the step. The board posts
    // the whole sheet on every save, which is exactly the shape that hides this kind of reset.
    optional: body.optional !== undefined ? (body.optional ? 1 : 0) : undefined,
    active: body.active !== undefined ? Boolean(body.active) : undefined,
  });
  return c.json({ task: routines.getTask(task.id) });
});

// ---- lock windows ---------------------------------------------------------------
//
// WHEN the tablet locks until this routine is done and approved. The state machine
// (src/lock-machine.ts) has handled weekday masks, midnight-crossing windows, DST and
// most-restrictive-wins since Phase B, and until these three routes there was no steering
// wheel bolted to it: `addLockWindow` had exactly one non-test caller in the whole tree,
// `src/scripts/seed.ts`. Every household that ever installed this was stuck with the two
// windows the seeder happened to write, forever (#303).
//
// Hung off the routine that owns it, and parent-authed the same way its steps are: a
// window is a piece of a routine's structure, not a household setting. Every mutation
// publishes a lock change, because the tablet is holding a stream open waiting to be told.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MASK = /^[01]{7}$/;
/** Enough for "before school", "after school" and "bedtime" twice over. A cap only a
 *  runaway client reaches, but a routine with two hundred windows is one nobody can read
 *  and a state computation that walks them all on every device poll. */
const MAX_WINDOWS = 8;

interface WindowFields { startHhmm: string; endHhmm: string; days: string }

/**
 * Read a window off a request body, falling back to what the row already says so PATCH can
 * send one field. Returns the refusal instead of the fields when it cannot.
 *
 * `end <= start` is NOT an error: the machine reads it as crossing midnight (`[start, 24:00)`
 * on the masked day, `[00:00, end)` on the next), which is exactly how a bedtime window is
 * written. `end: "00:00"` is midnight sharp and lands in the same branch with an empty tail.
 * A mask of all zeros IS refused — it is a window that can never fire, and saving one silently
 * is how a parent comes to believe they set a schedule they did not.
 */
function readWindowFields(
  body: Record<string, unknown>, base: WindowFields,
): WindowFields | { error: string } {
  const startHhmm = body.startHhmm === undefined ? base.startHhmm : String(body.startHhmm).trim();
  const endHhmm = body.endHhmm === undefined ? base.endHhmm : String(body.endHhmm).trim();
  const days = body.days === undefined ? base.days : String(body.days).trim();
  if (!HHMM.test(startHhmm) || !HHMM.test(endHhmm)) return { error: "invalid_time" };
  if (!DAY_MASK.test(days)) return { error: "invalid_days" };
  if (!days.includes("1")) return { error: "no_days" };
  return { startHhmm, endHhmm, days };
}

const sameWindow = (w: lockRepo.LockWindow, f: WindowFields) =>
  w.start_hhmm === f.startHhmm && w.end_hhmm === f.endHhmm && w.days === f.days;

/**
 * The routine, its household, and this parent's right to edit it — the same three checks in
 * the same order as every other structural edit on this file, written once because all three
 * window routes need all three and the shape of #303's "another family's routine cannot be
 * targeted" is `familyForSubject` returning null.
 */
type WindowGate = { res: Response; routine: null } | { res: null; routine: routines.Routine };
async function windowGate(c: Context, routineId: string, body: Record<string, unknown>): Promise<WindowGate> {
  const routine = routines.getRoutine(routineId);
  const fam = routine ? await familyForSubject(c, routine.family_id) : null;
  if (!routine || !fam) return { res: c.json({ error: "not_found" }, 404), routine: null };
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return { res: c.json(auth.body, auth.status), routine: null };
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return { res: notAllowed, routine: null };
  return { res: null, routine };
}

routinesRoutes.post("/routines/:id/windows", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const gate = await windowGate(c, c.req.param("id"), body);
  if (gate.res) return gate.res;
  const existing = lockRepo.listWindows(gate.routine.id);
  if (existing.length >= MAX_WINDOWS) return c.json({ error: "too_many_windows" }, 409);
  const fields = readWindowFields(body, { startHhmm: "", endHhmm: "", days: "1111100" });
  if ("error" in fields) return c.json(fields, 400);
  // Live databases already carry duplicate seeded windows (the seed script ran twice), and
  // duplicates are invisible to the machine — most-restrictive-wins reads two identical rows
  // as one. They are only ever confusing, so the parent screen lists every row (a dupe can be
  // deleted) and this refuses to make another.
  if (existing.some((w) => sameWindow(w, fields))) return c.json({ error: "duplicate_window" }, 409);
  const window = lockRepo.addLockWindow(gate.routine.id, fields.startHhmm, fields.endHhmm, fields.days);
  publishLockChange();
  return c.json({ window }, 201);
});

routinesRoutes.patch("/routines/:id/windows/:wid", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const gate = await windowGate(c, c.req.param("id"), body);
  if (gate.res) return gate.res;
  const window = lockRepo.getLockWindow(c.req.param("wid") ?? "");
  if (!window || window.routine_id !== gate.routine.id) return c.json({ error: "not_found" }, 404);
  const fields = readWindowFields(body, {
    startHhmm: window.start_hhmm, endHhmm: window.end_hhmm, days: window.days,
  });
  if ("error" in fields) return c.json(fields, 400);
  const siblings = lockRepo.listWindows(gate.routine.id).filter((w) => w.id !== window.id);
  if (siblings.some((w) => sameWindow(w, fields))) return c.json({ error: "duplicate_window" }, 409);
  lockRepo.updateLockWindow(window.id, fields.startHhmm, fields.endHhmm, fields.days);
  publishLockChange();
  return c.json({ window: lockRepo.getLockWindow(window.id) });
});

routinesRoutes.delete("/routines/:id/windows/:wid", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const gate = await windowGate(c, c.req.param("id"), body);
  if (gate.res) return gate.res;
  const window = lockRepo.getLockWindow(c.req.param("wid") ?? "");
  if (!window || window.routine_id !== gate.routine.id) return c.json({ error: "not_found" }, 404);
  lockRepo.deleteLockWindow(window.id);
  publishLockChange();
  return c.json({ ok: true });
});

/** Get-or-create today's run. The kid app polls this to render the checklist. */
routinesRoutes.get("/routines/:id/today", async (c) => {
  const routine = routines.getRoutine(c.req.param("id"));
  const fam = routine ? await familyForSubject(c, routine.family_id) : null;
  if (!routine || !fam) return c.json({ error: "not_found" }, 404);
  const day = routines.localDay(fam.tz);
  const { run, taskRuns } = routines.todayRun(routine, day);
  return c.json({ run, taskRuns, tasks: routines.listTasks(routine.id), serverTime: Date.now() });
});

/**
 * A ROUTINE'S PAYOUT IS NOT A STORED NUMBER. `approvalPayoutLuna` recomputes it when the
 * parent taps Approve, by summing `reward_luna` over the task runs that read 'done' at that
 * moment (repo-routines.runRewardLuna). Every one of those rows is therefore money, and the
 * two predicates below are what stop it moving after the fact. Both are written once,
 * because the version of this that only SOME of the three routes knew about is the bug.
 *
 * The run has left the kid's hands: it is in the approval queue, the parent has been pinged
 * "2.00 NIM waiting for your OK", and until this guard the number was still editable right
 * up to the tap that paid it. Same money rule PATCH /chores/:id enforces by freezing a
 * chore's reward once it leaves 'open' — a promise stops being editable when it is claimed.
 * Changing anything now is a REJECT, which puts the run back to 'in_progress' with its task
 * states intact, and then the edit.
 */
const runSubmitted = (run: routines.RoutineRun) => run.status !== "in_progress";

/** Finished is finished. This is the line /task-runs/:id/start has always held and
 *  /task-runs/:id/done did not — which is what let a kid tablet flip a task the PARENT had
 *  excused via the parent-authed /skip back to 'done', adding its reward to the payout. The
 *  guard is deliberately NOT symmetric: /skip may still excuse a task the kid marked done,
 *  because that is a parent lowering their own household's payout, and a parent overruling a
 *  kid is the direction this whole queue exists to allow. */
const taskFinished = (tr: routines.TaskRun) =>
  tr.status === "done" || tr.status === "skipped" || tr.status === "passed";

routinesRoutes.post("/task-runs/:id/start", async (c) => {
  const tr = routines.getTaskRun(c.req.param("id"));
  if (!tr) return c.json({ error: "not_found" }, 404);
  const run = routines.getRun(tr.run_id);
  const routine = run ? routines.getRoutine(run.routine_id) : null;
  if (!routine || !run || !(await familyForSubject(c, routine.family_id))) return c.json({ error: "not_found" }, 404);
  if (runSubmitted(run)) return c.json({ error: "run_submitted" }, 409);
  if (taskFinished(tr)) return c.json({ error: "already_finished" }, 409);
  if (tr.status !== "running") routines.startTaskRun(tr.id);
  return c.json({ taskRun: routines.getTaskRun(tr.id), serverTime: Date.now() });
});

routinesRoutes.post("/task-runs/:id/done", async (c) => {
  const tr = routines.getTaskRun(c.req.param("id"));
  if (!tr) return c.json({ error: "not_found" }, 404);
  const run = routines.getRun(tr.run_id);
  if (!run) return c.json({ error: "not_found" }, 404);
  const routine = routines.getRoutine(run.routine_id);
  const fam = routine ? await familyForSubject(c, routine.family_id) : null;
  if (!fam) return c.json({ error: "not_found" }, 404);
  if (runSubmitted(run)) return c.json({ error: "run_submitted" }, 409);
  if (taskFinished(tr)) return c.json({ error: "already_finished" }, 409);
  routines.finishTaskRun(tr.id, "done");
  const completed = completeRunIfFinished(fam, run);
  if (completed) publishLockChange();
  return c.json({ taskRun: routines.getTaskRun(tr.id), run: routines.getRun(run.id), runCompleted: completed });
});

/** Parent-excused skip (kid is sick, task doesn't apply today). */
routinesRoutes.post("/task-runs/:id/skip", async (c) => {
  const tr = routines.getTaskRun(c.req.param("id"));
  if (!tr) return c.json({ error: "not_found" }, 404);
  const run = routines.getRun(tr.run_id);
  if (!run) return c.json({ error: "not_found" }, 404);
  const routine = routines.getRoutine(run.routine_id);
  const fam = routine ? await familyForSubject(c, routine.family_id) : null;
  if (!fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  if (runSubmitted(run)) return c.json({ error: "run_submitted" }, 409);
  if (tr.status !== "skipped") routines.finishTaskRun(tr.id, "skipped");
  const completed = completeRunIfFinished(fam, run);
  if (completed) publishLockChange();
  return c.json({ taskRun: routines.getTaskRun(tr.id), run: routines.getRun(run.id), runCompleted: completed });
});

/** Pending approval for a run — the kid app needs its id to attach a photo proof
 *  ("Show your work") and to drive the on-tablet PIN approve after all tasks finish. */
routinesRoutes.get("/routine-runs/:id/approval", async (c) => {
  const run = routines.getRun(c.req.param("id"));
  if (!run) return c.json({ error: "not_found" }, 404);
  const routine = routines.getRoutine(run.routine_id);
  if (!routine || !(await familyForSubject(c, routine.family_id))) return c.json({ error: "not_found" }, 404);
  const pending = approvals.pendingApprovalFor("routine_run", run.id);
  if (!pending) return c.json({ error: "no_pending_approval" }, 404);
  return c.json({ approvalId: pending.id });
});

/**
 * THE CHEST, and the redo after a reject. One route, because they are the same act: the kid
 * saying they are done with this run.
 *
 * It is the only caller that ends a run with a side quest still open, and doing so writes
 * those steps to 'passed' (#341). That is the deliberate half of the rule: the bonus was
 * theirs to take right up until they tapped, and nothing about tapping is accidental.
 *
 * Required steps are still required. `completeRunIfFinished` answers false with one
 * outstanding, so the chest refuses with `tasks_unfinished` exactly as a redo always has.
 */
routinesRoutes.post("/routine-runs/:id/submit", async (c) => {
  const run = routines.getRun(c.req.param("id"));
  if (!run) return c.json({ error: "not_found" }, 404);
  const routine = routines.getRoutine(run.routine_id);
  const fam = routine ? await familyForSubject(c, routine.family_id) : null;
  if (!fam) return c.json({ error: "not_found" }, 404);
  if (run.status !== "in_progress") return c.json({ error: "not_resubmittable" }, 409);
  if (!completeRunIfFinished(fam, run, true)) return c.json({ error: "tasks_unfinished" }, 400);
  publishLockChange();
  return c.json({ run: routines.getRun(run.id) });
});
