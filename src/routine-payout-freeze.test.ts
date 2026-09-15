// A routine's payout is not a stored number — it is RECOMPUTED when the parent taps Approve,
// by summing reward_luna over the task runs that read 'done' at that moment. Every one of
// those rows is therefore money, and until this was pinned, two of them could still move
// after the parent had been told what they were approving:
//
//   - POST /task-runs/:id/done is reachable from the kid's tablet (familyForSubject accepts a
//     device bearer). POST /task-runs/:id/skip is parent-authed. Nothing stopped the kid
//     route from flipping a task the PARENT had excused back to 'done' — reversing a
//     parent-authenticated decision and adding that task's reward to the payout.
//   - Neither route cared that the run had left 'in_progress' for the approval queue, so the
//     number in the push notification ("2.00 NIM waiting for your OK") was still editable
//     right up to the tap that paid it.
//
// The rule these pin is the one PATCH /chores/:id already enforces on a chore's reward: the
// board is a set of promises, and a promise stops being editable when it is claimed.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as approvalsRepo from "./repo-approvals";
import * as lockRepo from "./repo-lock";
import { hashPin, newToken, sha256Hex } from "./auth";
import { routinesRoutes } from "./routes/routines";
import { approvalsRoutes } from "./routes/approvals";

const app = new Hono()
  .route("/api", routinesRoutes)
  .route("/api", approvalsRoutes);

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

const BRUSH = 200_000; // 2 NIM
const BED = 500_000;   // 5 NIM — the one the parent excuses

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;
let brushRun: routines.TaskRun;
let bedRun: routines.TaskRun;
let run: routines.RoutineRun;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ07 1111 1111 1111 1111 1111 1111 1111 1111");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ada", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));

  const routine = routines.createRoutine(fam.id, kid.id, "Morning", "morning");
  routines.addTask(routine.id, "Brush teeth", 120, { rewardLuna: BRUSH });
  routines.addTask(routine.id, "Make the bed", 120, { rewardLuna: BED });
  const today = routines.todayRun(routine, routines.localDay(fam.tz));
  run = today.run;
  [brushRun, bedRun] = today.taskRuns as [routines.TaskRun, routines.TaskRun];
});

const auth = () => ({ Authorization: `Bearer ${bearer}` });
const owed = () => routines.runRewardLuna(run.id);
const status = (id: string) => routines.getTaskRun(id)!.status;

/** The kid does one task, the parent excuses the other: the run finishes and goes in the
 *  queue owing only what the kid actually did. */
async function excusedAndSubmitted() {
  expect((await post(`/api/task-runs/${brushRun.id}/done`)).status).toBe(200);
  const skipped = await post(`/api/task-runs/${bedRun.id}/skip`, { pin: "1234" });
  expect(skipped.status).toBe(200);
  expect((await skipped.json()).runCompleted).toBe(true);
  expect(routines.getRun(run.id)!.status).toBe("done_pending");
  expect(owed()).toBe(BRUSH);
  return approvalsRepo.pendingApprovalFor("routine_run", run.id)!.id;
}

test("a kid cannot un-excuse the task their parent skipped while the run waits for approval", async () => {
  const approvalId = await excusedAndSubmitted();

  const attack = await post(`/api/task-runs/${bedRun.id}/done`);
  expect(attack.status).toBe(409);
  expect((await attack.json()).error).toBe("run_submitted"); // in the queue, so nothing moves
  expect(status(bedRun.id)).toBe("skipped");
  expect(owed()).toBe(BRUSH);

  // And the parent pays the number they were pinged about, not the inflated one.
  const approved = await post(`/api/approvals/${approvalId}/approve`, {}, auth());
  expect(approved.status).toBe(200);
  expect((await approved.json()).paidLuna).toBe(BRUSH);
});

test("a reject does not reopen the excused task to the kid — its states are preserved", async () => {
  const approvalId = await excusedAndSubmitted();
  expect((await post(`/api/approvals/${approvalId}/reject`, {}, auth())).status).toBe(200);
  expect(routines.getRun(run.id)!.status).toBe("in_progress");

  // The run is editable again — that is what a reject is for — but a parent's decision is
  // still a parent's decision, and this is where it used to be reversible one task at a time.
  const attack = await post(`/api/task-runs/${bedRun.id}/done`);
  expect(attack.status).toBe(409);
  expect((await attack.json()).error).toBe("already_finished"); // the excuse itself, not the queue
  expect(status(bedRun.id)).toBe("skipped");
  expect(owed()).toBe(BRUSH);
});

test("no task changes once the run is in the queue — including the parent's own skip", async () => {
  expect((await post(`/api/task-runs/${brushRun.id}/done`)).status).toBe(200);
  expect((await post(`/api/task-runs/${bedRun.id}/done`)).status).toBe(200);
  expect(routines.getRun(run.id)!.status).toBe("done_pending");
  expect(owed()).toBe(BRUSH + BED);

  // Lowering it after the fact is the same defect facing the other way: the amount the
  // parent is approving must be the amount they were shown. Excusing a task now is a
  // reject, then a skip.
  const late = await post(`/api/task-runs/${bedRun.id}/skip`, { pin: "1234" });
  expect(late.status).toBe(409);
  expect((await late.json()).error).toBe("run_submitted");
  expect(owed()).toBe(BRUSH + BED);

  // Restarting a task's timer is refused for the same reason.
  expect((await post(`/api/task-runs/${bedRun.id}/start`)).status).toBe(409);
});

test("a run still in progress freezes nothing — the ordinary morning is untouched", async () => {
  expect((await post(`/api/task-runs/${brushRun.id}/start`)).status).toBe(200);
  const first = await post(`/api/task-runs/${brushRun.id}/done`);
  expect(first.status).toBe(200);
  expect((await first.json()).runCompleted).toBe(false); // one task left
  expect(routines.getRun(run.id)!.status).toBe("in_progress");
  expect(owed()).toBe(BRUSH);

  const last = await post(`/api/task-runs/${bedRun.id}/done`);
  expect(last.status).toBe(200);
  expect((await last.json()).runCompleted).toBe(true);
  expect(owed()).toBe(BRUSH + BED);
});

test("the reject-then-excuse path parents are pointed at still works end to end", async () => {
  expect((await post(`/api/task-runs/${brushRun.id}/done`)).status).toBe(200);
  expect((await post(`/api/task-runs/${bedRun.id}/done`)).status).toBe(200);
  const approvalId = approvalsRepo.pendingApprovalFor("routine_run", run.id)!.id;
  expect((await post(`/api/approvals/${approvalId}/reject`, {}, auth())).status).toBe(200);
  expect(routines.getRun(run.id)!.status).toBe("in_progress");

  // THE FREEZE IS NOT SYMMETRIC, on purpose. A parent excusing a task the kid marked done is
  // this household's own money going down, decided by the person who pays it — the direction
  // the approval queue exists to allow. Only the reverse, a kid overruling a parent, is shut.
  const excuse = await post(`/api/task-runs/${bedRun.id}/skip`, { pin: "1234" });
  expect(excuse.status).toBe(200);
  expect((await excuse.json()).runCompleted).toBe(true);
  expect(status(bedRun.id)).toBe("skipped");
  expect(owed()).toBe(BRUSH);

  const approved = await post(
    `/api/approvals/${approvalsRepo.pendingApprovalFor("routine_run", run.id)!.id}/approve`, {}, auth(),
  );
  expect(approved.status).toBe(200);
  expect((await approved.json()).paidLuna).toBe(BRUSH);
});
