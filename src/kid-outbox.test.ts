// THE QUEUE THAT CARRIES A KID'S TAP OUT OF THE CAR (public/kid/js/outbox.js).
//
// Two rules are worth pinning, and both were found by reading the server rather than by
// guessing at the client:
//
//  1. WHAT AN ANSWER MEANS. `POST /task-runs/:id/done` returns 409 `already_finished` on a
//     replay (src/routes/routines.ts), so 409 is SUCCESS here, not a failure to retry. Treat
//     it as a failure and a queued tap whose response was lost never leaves the queue; treat
//     a 500 as success and a tap the server never took is thrown away silently.
//
//  2. THE RUN MOVES WITH ITS LAST TASK. `cardState` (approved.js) reads a routine task whose
//     siblings are ALL finished, on a run still `in_progress`, as "retry", because on the
//     server `completeRunIfFinished` would have moved that run to `done_pending` the instant
//     the last task landed. Offline nothing moves it. Without the second pass in `applyTaps`
//     a kid finishing their morning routine with no Wi-Fi is shown every card asking them to
//     have another go at a job they just did.
//
// Both are pure functions of their inputs, so no board, no network and no localStorage.
import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kidIconsMock } from "./kid-icons-mock";

// outbox.js reaches util.js for `state`, and util.js imports icons.js, which imports the
// browser-absolute `/js/lib/box-glyphs.js`. The shared stub, for the reason spelled out in
// src/kid-icons-mock.ts: the LAST mock.module for a path wins for the whole run.
mock.module("../public/kid/js/icons.js", kidIconsMock);

const { verdict, applyTaps } = await import("../public/kid/js/outbox.js");
type OutboxCard = import("../public/kid/js/outbox.js").OutboxCard;

test("2xx and 409 both mean the server has it", () => {
  for (const s of [200, 201, 204, 299, 409]) expect(verdict(s)).toBe("done");
});

test("no answer, a rate limit and a server fault are all worth another go", () => {
  for (const s of [0, 408, 429, 500, 502, 503]) expect(verdict(s)).toBe("keep");
});

test("a refusal this tablet cannot argue with is dropped, not retried forever", () => {
  for (const s of [400, 401, 403, 404]) expect(verdict(s)).toBe("drop");
});

const step = (id: string, over: Partial<OutboxCard> = {}): OutboxCard => ({
  kind: "task", taskRunId: id, runId: "run-1", runStatus: "in_progress", status: "pending", ...over,
});

test("a queued task is marked done; the others are untouched", () => {
  const tasks = [step("a"), step("b")];
  applyTaps(tasks, ["a"]);
  expect(tasks[0]!.status).toBe("done");
  expect(tasks[1]!.status).toBe("pending");
  expect(tasks[0]!.runStatus).toBe("in_progress"); // the run is not over yet
});

test("the LAST task of a run carries the run to done_pending, for every card in it", () => {
  const tasks = [step("a", { status: "done" }), step("b")];
  applyTaps(tasks, ["b"]);
  expect(tasks.map((t) => t.runStatus)).toEqual(["done_pending", "done_pending"]);
});

test("an untaken side quest holds the run open, exactly as the server does", () => {
  // #341: the server stops auto-submitting while an optional step is unclaimed, so claiming
  // done_pending here would tell the kid a grown-up had been asked when nobody had.
  const tasks = [step("a"), step("bonus", { optional: true })];
  applyTaps(tasks, ["a"]);
  expect(tasks[0]!.status).toBe("done");
  expect(tasks[0]!.runStatus).toBe("in_progress");
});

test("a chore goes to submitted, and a rejected one is resubmittable", () => {
  const tasks: OutboxCard[] = [
    { kind: "chore", choreId: "c1", status: "open" },
    { kind: "lesson", choreId: "c2", status: "rejected" },
    { kind: "chore", choreId: "c3", status: "approved" },
  ];
  applyTaps(tasks, ["c1", "c2", "c3"]);
  expect(tasks.map((t) => t.status)).toEqual(["submitted", "submitted", "approved"]);
});

test("nothing queued changes nothing, and an empty board does not throw", () => {
  const tasks = [step("a")];
  applyTaps(tasks, []);
  expect(tasks[0]!.status).toBe("pending");
  expect(() => applyTaps(undefined, ["a"])).not.toThrow();
  expect(() => applyTaps([], ["a"])).not.toThrow();
});

test("importing the module does not need a real window", () => {
  // CI, 2026-09-11: `typeof window !== "undefined"` guarded these listeners, and under
  // `bun test` another suite installs a partial `window` stub, so the global existed while
  // `addEventListener` did not. Importing outbox.js threw at load and took every module that
  // imports it down with it, in a file that names neither. The import at the top of this file
  // is the assertion; this pins the reason so the guard is not simplified back.
  const src = readFileSync(join(import.meta.dir, "..", "public", "kid", "js", "outbox.js"), "utf8");
  expect(src).toMatch(/typeof target\.addEventListener === "function"/);
});
