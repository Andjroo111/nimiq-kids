// Side quests (#341): an OPTIONAL step in a routine, and the completion rule that has to
// change around it.
//
// The money is not the subject of this feature and these tests exist to prove that. The first
// two assert that `runRewardLuna` already does the right thing with an optional step, with no
// payment code touched: it sums `reward_luna` over the task runs reading 'done', so a bonus
// that got done adds its reward and one that did not adds nothing. If either of those ever
// fails, the change under test went somewhere it had no business going.
//
// What genuinely changes is COMPLETION. `allTasksFinished` counted every row still in
// ('pending','running'), so a bonus nobody chose held the run open forever, and auto-submitting
// the moment the last REQUIRED step landed would have been worse: `runSubmitted` answers
// 409 on any further write, so finishing your teeth would have silently closed the door on the
// dishes and the bonus would be a trap that costs the kid money. The rule below is the spec's:
// with an optional step still open the kid ends the run themselves (the chest), and with none
// open auto-submit is exactly what it has always been.

import { test, expect } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as approvals from "./repo-approvals";
import { routinesRoutes } from "./routes/routines";

const app = () => new Hono().route("/api", routinesRoutes);
const post = (a: Hono, url: string, body?: unknown) => a.request(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

/** Breakfast + teeth are required, dishes is the side quest that hangs off breakfast. */
function setup(opts: { withBonus?: boolean } = {}) {
  initTestDb();
  const fam = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(fam.id, { mode: "family" });
  const kid = repo.createChild(fam.id, "Kid 1", "🦖");
  const routine = routines.createRoutine(fam.id, kid.id, "Morning routine", "morning");
  const breakfast = routines.addTask(routine.id, "Eat breakfast", 300, { rewardLuna: 1000 });
  const teeth = routines.addTask(routine.id, "Brush teeth", 120, { rewardLuna: 1000 });
  const dishes = opts.withBonus === false ? null
    : routines.addTask(routine.id, "Put the dishes away", 120, { rewardLuna: 500, optional: true });
  return { fam: repo.getFamily(fam.id)!, kid, routine, breakfast, teeth, dishes };
}

/** The task runs of today's run, keyed by the task they belong to. */
function runToday(routine: routines.Routine) {
  const { run, taskRuns } = routines.todayRun(routine, "2026-08-11");
  const byTask = (t: routines.RoutineTask) => taskRuns.find((tr) => tr.task_id === t.id)!;
  return { run, taskRuns, byTask };
}

// ---- the money, which must not have moved ----

test("a done side quest pays required PLUS bonus, and runRewardLuna is untouched", () => {
  const { routine, breakfast, teeth, dishes } = setup();
  const { run, byTask } = runToday(routine);

  routines.finishTaskRun(byTask(breakfast).id, "done");
  routines.finishTaskRun(byTask(teeth).id, "done");
  expect(routines.runRewardLuna(run.id)).toBe(2000);

  routines.finishTaskRun(byTask(dishes!).id, "done");
  expect(routines.runRewardLuna(run.id)).toBe(2500);
});

test("a side quest left alone pays nothing, whether it is passed or still open", () => {
  const { routine, breakfast, teeth, dishes } = setup();
  const { run, byTask } = runToday(routine);

  routines.finishTaskRun(byTask(breakfast).id, "done");
  routines.finishTaskRun(byTask(teeth).id, "done");
  expect(routines.runRewardLuna(run.id)).toBe(2000); // still pending

  routines.finishTaskRun(byTask(dishes!).id, "passed");
  expect(routines.runRewardLuna(run.id)).toBe(2000); // terminal, and still unpaid
});

// ---- completion ----

test("allTasksFinished ignores an open OPTIONAL step, and still waits on every required one", () => {
  const { routine, breakfast, teeth, dishes } = setup();
  const { run, byTask } = runToday(routine);

  routines.finishTaskRun(byTask(breakfast).id, "done");
  expect(routines.allTasksFinished(run.id)).toBe(false); // teeth outstanding

  routines.finishTaskRun(byTask(teeth).id, "done");
  expect(routines.allTasksFinished(run.id)).toBe(true);  // dishes is optional, and open
  expect(routines.openOptionalTaskRuns(run.id).map((tr) => tr.task_id)).toEqual([dishes!.id]);
});

test("the last required step does NOT auto-submit while a side quest is open", async () => {
  const { routine, breakfast, teeth } = setup();
  const a = app();
  const { run, byTask } = runToday(routine);

  await post(a, `/api/task-runs/${byTask(breakfast).id}/done`);
  const res = await post(a, `/api/task-runs/${byTask(teeth).id}/done`);
  expect(res.status).toBe(200);
  expect((await res.json()).runCompleted).toBe(false);

  // The run is still the kid's, which is the whole point: the bonus is still reachable.
  expect(routines.getRun(run.id)!.status).toBe("in_progress");
  expect(approvals.pendingApprovalFor("routine_run", run.id)).toBe(null);
});

test("with no side quest, the last required step auto-submits exactly as it always did", async () => {
  const { routine, breakfast, teeth } = setup({ withBonus: false });
  const a = app();
  const { run, byTask } = runToday(routine);

  await post(a, `/api/task-runs/${byTask(breakfast).id}/done`);
  const res = await post(a, `/api/task-runs/${byTask(teeth).id}/done`);
  expect((await res.json()).runCompleted).toBe(true);
  expect(routines.getRun(run.id)!.status).toBe("done_pending");
  expect(approvals.pendingApprovalFor("routine_run", run.id)).not.toBe(null);
});

test("the bonus is not a trap: it can still be done after the last required step", async () => {
  const { routine, breakfast, teeth, dishes } = setup();
  const a = app();
  const { run, byTask } = runToday(routine);

  await post(a, `/api/task-runs/${byTask(breakfast).id}/done`);
  await post(a, `/api/task-runs/${byTask(teeth).id}/done`);

  // The write that used to answer 409 run_submitted.
  const res = await post(a, `/api/task-runs/${byTask(dishes!).id}/done`);
  expect(res.status).toBe(200);
  expect((await res.json()).runCompleted).toBe(true); // nothing optional left open
  expect(routines.runRewardLuna(run.id)).toBe(2500);
});

// ---- the chest ----

test("the chest submits the run and passes whatever side quest was left open", async () => {
  const { routine, breakfast, teeth, dishes } = setup();
  const a = app();
  const { run, byTask } = runToday(routine);

  await post(a, `/api/task-runs/${byTask(breakfast).id}/done`);
  await post(a, `/api/task-runs/${byTask(teeth).id}/done`);

  const res = await post(a, `/api/routine-runs/${run.id}/submit`);
  expect(res.status).toBe(200);
  expect(routines.getRun(run.id)!.status).toBe("done_pending");
  expect(routines.getTaskRun(byTask(dishes!).id)!.status).toBe("passed");
  expect(routines.runRewardLuna(run.id)).toBe(2000); // the bonus was left on the table
});

test("the chest refuses while a REQUIRED step is outstanding", async () => {
  const { routine, breakfast } = setup();
  const a = app();
  const { run, byTask } = runToday(routine);

  await post(a, `/api/task-runs/${byTask(breakfast).id}/done`);
  const res = await post(a, `/api/routine-runs/${run.id}/submit`);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("tasks_unfinished");
  expect(routines.getRun(run.id)!.status).toBe("in_progress");
});

// ---- passed is not skipped ----

test("passed and skipped stay tellable apart, because they mean different things", () => {
  const { routine, dishes } = setup();
  const { run, byTask } = runToday(routine);

  routines.finishTaskRun(byTask(dishes!).id, "passed");
  expect(routines.getTaskRun(byTask(dishes!).id)!.status).toBe("passed");
  expect(routines.runRewardLuna(run.id)).toBe(0);

  // A parent excusing a step is a different sentence on the parent's card ("I said they did
  // not have to") from a kid leaving a bonus alone ("they chose not to"). Collapsing the two
  // would have cost no money and lost the parent the only record of which one happened.
  const { routine: r2, dishes: d2 } = setup();
  const second = runToday(r2);
  routines.finishTaskRun(second.byTask(d2!).id, "skipped");
  expect(routines.getTaskRun(second.byTask(d2!).id)!.status).toBe("skipped");
});

test("a passed step is finished, so it can never be flipped back to done for its reward", async () => {
  const { routine, breakfast, teeth, dishes } = setup();
  const a = app();
  const { run, byTask } = runToday(routine);

  await post(a, `/api/task-runs/${byTask(breakfast).id}/done`);
  await post(a, `/api/task-runs/${byTask(teeth).id}/done`);
  await post(a, `/api/routine-runs/${run.id}/submit`);

  const res = await post(a, `/api/task-runs/${byTask(dishes!).id}/done`);
  expect(res.status).toBe(409); // run_submitted lands first, and already_finished behind it
  expect(routines.runRewardLuna(run.id)).toBe(2000);
});

// ---- the shape a parent authors ----

test("optional rides on the task, defaults to required, and survives a round trip", () => {
  const { routine, breakfast, dishes } = setup();
  expect(routines.getTask(breakfast.id)!.optional).toBe(0);
  expect(routines.getTask(dishes!.id)!.optional).toBe(1);

  routines.updateTask(breakfast.id, { optional: 1 });
  expect(routines.getTask(breakfast.id)!.optional).toBe(1);
  routines.updateTask(dishes!.id, { optional: 0 });
  expect(routines.getTask(dishes!.id)!.optional).toBe(0);

  // listTasks is what both the board and the tablet read, so the flag has to survive it.
  expect(routines.listTasks(routine.id).map((t) => t.optional)).toEqual([1, 0, 0]);
});
