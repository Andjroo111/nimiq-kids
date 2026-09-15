// EDITING A ROUTINE MUST NOT DELETE THE KID'S DAY (#381).
//
// A run snapshots its routine's task list once, as task_runs, and an edited task is RETIRED
// rather than deleted. So every one of these is what happens when a parent changes the morning
// routine at 9am — the ordinary path, not a corner.
//
// Found on the real family instance: both kids' Morning and Evening vanished off the tablet
// with no error anywhere. The second test below is the half that was NOT in the report and is
// worse: the run also becomes unfinishable, so the day can never be paid.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb } from "./db";
import * as routines from "./repo-routines";
import * as repo from "./repo";

let familyId = "";
let childId = "";

beforeEach(() => {
  initTestDb();
  familyId = repo.createFamily("Mom", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000").id;
  childId = repo.createChild(familyId, "Sam", "🦖").id;
});

function morningWith(titles: string[]) {
  const r = routines.createRoutine(familyId, childId, "Morning routine", "morning", "🌅");
  for (const t of titles) routines.addTask(r.id, t, 120, { rewardLuna: 100 });
  return r;
}

const titlesOn = (runId: string) =>
  routines.listTaskRuns(runId)
    .map((tr) => routines.getTask(tr.task_id)?.title)
    .filter(Boolean)
    .sort();

test("a task added mid-day appears on the run that is already open", () => {
  const r = morningWith(["Brush teeth"]);
  const { run } = routines.todayRun(r, "2026-08-27");
  expect(titlesOn(run.id)).toEqual(["Brush teeth"]);

  routines.addTask(r.id, "Eat breakfast", 600, { rewardLuna: 100 });

  expect(titlesOn(routines.todayRun(r, "2026-08-27").run.id)).toEqual(["Brush teeth", "Eat breakfast"]);
});

test("a routine whose tasks are REPLACED still has a day, and can still be finished", () => {
  // THE REPORTED BUG. Replacing the list retires every original task; before the fix the run
  // kept four pending rows pointing at them, the board rendered nothing, and...
  const r = morningWith(["Make your bed", "Get dressed"]);
  const { run } = routines.todayRun(r, "2026-08-27");
  for (const t of routines.listTasks(r.id)) routines.updateTask(t.id, { active: false });
  routines.addTask(r.id, "Eat breakfast", 600, { rewardLuna: 100 });

  const after = routines.todayRun(r, "2026-08-27");
  expect(after.run.id).toBe(run.id);                        // same day, not a second run
  expect(titlesOn(run.id)).toEqual(["Eat breakfast"]);

  // ...THIS is the half that never surfaced anywhere: `allTasksFinished` joins routine_tasks
  // with no active filter, so a retired task's pending row answers "still open" forever. The
  // run could never reach done_pending, no approval was ever opened, and the day could never
  // be paid. Doing the one job that is really being asked for has to finish the run.
  const only = routines.listTaskRuns(run.id)[0]!;
  routines.finishTaskRun(only.id, "done");
  expect(routines.allTasksFinished(run.id)).toBe(true);
});

test("work the kid already did is kept, still pays, and stays on the board", () => {
  // The kid brushed their teeth, THEN the parent retired that step. Dropping the row would
  // silently un-earn it; keeping it without rendering the card would pay for work the board
  // never showed, because runRewardLuna joins without an active filter on purpose.
  const r = morningWith(["Brush teeth", "Get dressed"]);
  const { run } = routines.todayRun(r, "2026-08-27");
  const brushed = routines.listTaskRuns(run.id)
    .find((tr) => routines.getTask(tr.task_id)?.title === "Brush teeth")!;
  routines.finishTaskRun(brushed.id, "done");

  const teeth = routines.listTasks(r.id).find((t) => t.title === "Brush teeth")!;
  routines.updateTask(teeth.id, { active: false });
  routines.todayRun(r, "2026-08-27");

  expect(titlesOn(run.id)).toEqual(["Brush teeth", "Get dressed"]);
  expect(routines.runRewardLuna(run.id)).toBe(100);
  // getTask ignores `active`, which is what lets the chart route render the card it is paying for.
  expect(routines.getTask(teeth.id)?.title).toBe("Brush teeth");
});

test("a run that is already handed in is history and is left alone", () => {
  // A parent tidying their routines next week must not reach back and rewrite what a kid was
  // paid for. demo-past.ts builds finished days through this same function.
  const r = morningWith(["Make your bed"]);
  const { run } = routines.todayRun(r, "2026-08-20");
  routines.setRunStatus(run.id, "done_pending");
  for (const t of routines.listTasks(r.id)) routines.updateTask(t.id, { active: false });
  routines.addTask(r.id, "Eat breakfast", 600, { rewardLuna: 100 });

  expect(titlesOn(routines.todayRun(r, "2026-08-20").run.id)).toEqual(["Make your bed"]);
});
