import { test, expect } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as approvals from "./repo-approvals";
import { routinesRoutes } from "./routes/routines";

function setup() {
  initTestDb();
  const fam = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(fam.id, { mode: "family" });
  const kid = repo.createChild(fam.id, "Kid 1", "🦖");
  const routine = routines.createRoutine(fam.id, kid.id, "Morning routine", "morning");
  const t1 = routines.addTask(routine.id, "Brush teeth", 120, { rewardStars: 1 });
  const t2 = routines.addTask(routine.id, "Get dressed", 300, { rewardStars: 2 });
  return { fam: repo.getFamily(fam.id)!, kid, routine, t1, t2 };
}

test("todayRun is idempotent per routine per day", () => {
  const { routine } = setup();
  const a = routines.todayRun(routine, "2026-07-18");
  const b = routines.todayRun(routine, "2026-07-18");
  expect(b.run.id).toBe(a.run.id);
  expect(a.taskRuns.length).toBe(2);
  const c = routines.todayRun(routine, "2026-07-19"); // next day = fresh run
  expect(c.run.id).not.toBe(a.run.id);
});

test("task order follows position and runStars counts only DONE tasks", () => {
  const { routine, t1, t2 } = setup();
  const { run, taskRuns } = routines.todayRun(routine, "2026-07-18");
  expect(taskRuns.map((tr) => tr.task_id)).toEqual([t1.id, t2.id]);

  routines.startTaskRun(taskRuns[0]!.id);
  routines.finishTaskRun(taskRuns[0]!.id, "done");
  expect(routines.allTasksFinished(run.id)).toBe(false);
  expect(routines.runStars(run.id)).toBe(1); // only t1 done

  routines.finishTaskRun(taskRuns[1]!.id, "skipped"); // skips finish the run but earn nothing
  expect(routines.allTasksFinished(run.id)).toBe(true);
  expect(routines.runStars(run.id)).toBe(1);
});

test("openApproval is idempotent while pending (partial unique index)", () => {
  const { fam, kid, routine } = setup();
  const { run } = routines.todayRun(routine, "2026-07-18");
  const a1 = approvals.openApproval(fam.id, kid.id, "routine_run", run.id);
  const a2 = approvals.openApproval(fam.id, kid.id, "routine_run", run.id);
  expect(a2.id).toBe(a1.id);
  // decided -> a NEW approval can open (redo after reject)
  expect(approvals.decideApproval(a1.id, "rejected", "pin", null, "messy bed")).toBe(true);
  const a3 = approvals.openApproval(fam.id, kid.id, "routine_run", run.id);
  expect(a3.id).not.toBe(a1.id);
});

test("decideApproval is race-safe: second decide loses", () => {
  const { fam, kid, routine } = setup();
  const { run } = routines.todayRun(routine, "2026-07-18");
  const a = approvals.openApproval(fam.id, kid.id, "routine_run", run.id);
  expect(approvals.decideApproval(a.id, "approved", "remote", 3, null)).toBe(true);
  expect(approvals.decideApproval(a.id, "rejected", "pin", null, null)).toBe(false);
  expect(approvals.getApproval(a.id)!.status).toBe("approved");
});

test("GET /routine-runs/:id/approval surfaces the pending approval id for the kid app", async () => {
  const { fam, routine } = setup();
  const app = new Hono().route("/api", routinesRoutes);

  const today = await app.request(`/api/routines/${routine.id}/today`);
  const { run, taskRuns } = await today.json();

  // Unknown run -> 404; in-progress run (no approval opened yet) -> 404.
  expect((await app.request("/api/routine-runs/nope/approval")).status).toBe(404);
  expect((await app.request(`/api/routine-runs/${run.id}/approval`)).status).toBe(404);

  // Kid finishes every task through the public routes -> run flips done_pending + approval opens.
  for (const tr of taskRuns) {
    await app.request(`/api/task-runs/${tr.id}/start`, { method: "POST" });
    await app.request(`/api/task-runs/${tr.id}/done`, { method: "POST" });
  }
  const res = await app.request(`/api/routine-runs/${run.id}/approval`);
  expect(res.status).toBe(200);
  const { approvalId } = await res.json();
  expect(approvalId).toBe(approvals.pendingApprovalFor("routine_run", run.id)!.id);
  expect(approvals.getApproval(approvalId)!.child_id).toBe(routines.getRun(run.id)!.child_id);
  expect(fam.mode).toBe("family");

  // Decided -> no pending approval -> back to 404 (kid app stops offering PIN/photo).
  approvals.decideApproval(approvalId, "approved", "pin", 3, null);
  expect((await app.request(`/api/routine-runs/${run.id}/approval`)).status).toBe(404);
});

test("localDay renders the family timezone", () => {
  // 2026-07-18 03:00 UTC = 2026-07-17 22:00 in Chicago (UTC-5, DST)
  const utcMs = Date.UTC(2026, 6, 18, 3, 0, 0);
  expect(routines.localDay("America/Chicago", utcMs)).toBe("2026-07-17");
  expect(routines.localDay("UTC", utcMs)).toBe("2026-07-18");
});
