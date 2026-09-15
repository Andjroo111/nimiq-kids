// Authoring a side quest (#342), and the way out of the run that has to come with it.
//
// #341 shipped the server rule: with a side quest still open, finishing the last REQUIRED
// step no longer submits the run, because submitting freezes it and would have turned the
// bonus into a trap. That was safe to ship alone only because no parent could create an
// optional step yet.
//
// This is the issue that hands them the toggle, so it is also the issue where the other half
// of the trap becomes reachable: a kid who does every required step and does NOT want the
// bonus needs a way to end their day, or the run sits `in_progress` forever, the parent is
// never asked, and the kid is never paid for the work they DID do. The route exists
// (`POST /routine-runs/:id/submit`); what was missing is anything on the tablet that knows to
// call it. `runFinishable` is that rule, and it is a function with inputs for the same reason
// `cardState` is.

import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as lockRepo from "./repo-lock";
import { sha256Hex } from "./auth";
import { routinesRoutes } from "./routes/routines";
import { stickersRoutes } from "./routes/stickers";
import { kidIconsMock } from "./kid-icons-mock";

mock.module("../public/kid/js/icons.js", kidIconsMock);
const { runFinishable } = await import("../public/kid/js/approved.js");

const root = join(import.meta.dir, "..");

/** The board is parent-authed, so these go through a bearer the way the parent app does. */
const BEARER = "side-quest-test-bearer";

async function setup() {
  initTestDb();
  const fam = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(fam.id, { mode: "family" });
  const kid = repo.createChild(fam.id, "Kid 1", "🦖");
  const routine = routines.createRoutine(fam.id, kid.id, "Morning routine", "morning");
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(BEARER));
  return { fam: repo.getFamily(fam.id)!, kid, routine };
}
const app = () => new Hono().route("/api", routinesRoutes).route("/api", stickersRoutes);
const send = (a: Hono, method: string, url: string, body: unknown = {}) => a.request(url, {
  method,
  headers: { "content-type": "application/json", Authorization: `Bearer ${BEARER}` },
  body: JSON.stringify(body),
});

// ---- the parent's toggle, over the wire ----

test("POST /routines/:id/tasks carries optional, and defaults to required", async () => {
  const { routine } = await setup();
  const a = app();

  const plain = await send(a, "POST", `/api/routines/${routine.id}/tasks`,
    { title: "Brush teeth", durationS: 120, rewardLuna: 1000 });
  expect(plain.status).toBe(201);
  expect((await plain.json()).task.optional).toBe(0);

  const bonus = await send(a, "POST", `/api/routines/${routine.id}/tasks`,
    { title: "Put the dishes away", durationS: 120, rewardLuna: 500, optional: true });
  expect(bonus.status).toBe(201);
  expect((await bonus.json()).task.optional).toBe(1);
});

test("PATCH /routines/:id/tasks/:taskId flips a step either way and leaves it alone when unsent", async () => {
  const { routine } = await setup();
  const a = app();
  const task = routines.addTask(routine.id, "Put the dishes away", 120, { rewardLuna: 500 });
  const url = `/api/routines/${routine.id}/tasks/${task.id}`;

  expect((await (await send(a, "PATCH", url, { optional: true })).json()).task.optional).toBe(1);
  // A patch that says nothing about it must not quietly reset it: the board sends the whole
  // step sheet on every save, and a rename would otherwise un-bonus the step.
  expect((await (await send(a, "PATCH", url, { title: "Dishes" })).json()).task.optional).toBe(1);
  expect((await (await send(a, "PATCH", url, { optional: false })).json()).task.optional).toBe(0);
});

// ---- the tablet has to be able to SEE which one is the bonus ----

test("the kid's chart carries optional on every task card", async () => {
  const { fam, kid, routine } = await setup();
  const a = app();
  routines.addTask(routine.id, "Brush teeth", 120, { rewardLuna: 1000 });
  routines.addTask(routine.id, "Put the dishes away", 120, { rewardLuna: 500, optional: true });
  routines.todayRun(routine, routines.localDay(fam.tz));

  const res = await a.request(`/api/kids/${kid.id}/chart`);
  expect(res.status).toBe(200);
  const cards = (await res.json()).todayTasks.filter((x: { kind: string }) => x.kind === "task");
  expect(cards.map((c: { title: string; optional: number }) => [c.title, c.optional]))
    .toEqual([["Brush teeth", 0], ["Put the dishes away", 1]]);
});

// ---- runFinishable: the rule behind the way out ----

const card = (over: Record<string, unknown> = {}) => ({
  kind: "task", runId: "run1", runStatus: "in_progress", optional: 0, status: "pending", ...over,
});

test("runFinishable is false while a required step is outstanding", () => {
  const all = [card({ status: "done" }), card({ status: "pending" }), card({ optional: 1 })];
  expect(runFinishable(all, "run1")).toBe(false);
});

test("runFinishable is true once every required step is done and a side quest is still open", () => {
  const all = [card({ status: "done" }), card({ status: "done" }), card({ optional: 1 })];
  expect(runFinishable(all, "run1")).toBe(true);
});

test("runFinishable is false with no side quest, because the run auto-submits on its own", () => {
  const all = [card({ status: "done" }), card({ status: "done" })];
  expect(runFinishable(all, "run1")).toBe(false);
});

test("runFinishable is false once the run has left the kid's hands", () => {
  const all = [
    card({ status: "done", runStatus: "done_pending" }),
    card({ optional: 1, runStatus: "done_pending" }),
  ];
  expect(runFinishable(all, "run1")).toBe(false);
  const approved = all.map((c) => ({ ...c, runStatus: "approved" }));
  expect(runFinishable(approved, "run1")).toBe(false);
});

test("runFinishable is scoped to ONE run, so a second routine cannot unlock the first", () => {
  const all = [
    card({ runId: "run1", status: "pending" }),
    card({ runId: "run2", status: "done" }),
    card({ runId: "run2", optional: 1 }),
  ];
  expect(runFinishable(all, "run1")).toBe(false);
  expect(runFinishable(all, "run2")).toBe(true);
});

test("a skipped or passed required step counts as finished, the same way cardState reads it", () => {
  expect(runFinishable([card({ status: "skipped" }), card({ optional: 1 })], "run1")).toBe(true);
  expect(runFinishable([card({ status: "passed" }), card({ optional: 1 })], "run1")).toBe(true);
  // An optional step already dealt with is not "still open", so there is nothing to end.
  expect(runFinishable([card({ status: "done" }), card({ optional: 1, status: "passed" })], "run1"))
    .toBe(false);
});

// ---- the end to end shape of the trap this closes ----

test("a kid who leaves the bonus can still end their day and get paid for the rest", async () => {
  const { fam, routine } = await setup();
  const a = app();
  routines.addTask(routine.id, "Eat breakfast", 300, { rewardLuna: 1000 });
  routines.addTask(routine.id, "Put the dishes away", 120, { rewardLuna: 500, optional: true });
  const { run, taskRuns } = routines.todayRun(routine, routines.localDay(fam.tz));

  await send(a, "POST", `/api/task-runs/${taskRuns[0]!.id}/done`);
  expect(routines.getRun(run.id)!.status).toBe("in_progress"); // the trap, before the way out

  const res = await send(a, "POST", `/api/routine-runs/${run.id}/submit`);
  expect(res.status).toBe(200);
  expect(routines.getRun(run.id)!.status).toBe("done_pending");
  expect(routines.runRewardLuna(run.id)).toBe(1000);
});

// ---- wiring a refactor could silently undo ----

test("the tablet actually calls the submit route from the finishable state", () => {
  const chart = readFileSync(join(root, "public/kid/js/chart.js"), "utf8");
  expect(chart).toContain("runFinishable");
  expect(chart).toContain("resubmitRun");
  const api = readFileSync(join(root, "public/kid/js/api.js"), "utf8");
  expect(api).toContain("/submit");
});

test("the parent's step sheet offers the toggle and sends it", () => {
  const board = readFileSync(join(root, "public/parent/views-board.js"), "utf8");
  expect(board).toContain("bd-optional");
  expect(board).toContain("papp.boardExtraCredit");
  expect(board).toMatch(/optional:/);
});
