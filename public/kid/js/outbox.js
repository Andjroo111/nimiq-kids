// THE TAP THAT SURVIVES THE CAR. Layer 3 of three (sw.js caches the shell, snapshot.js the data).
//
// Offline, "Yes, it's done" used to do nothing at all: `api.doneTask()` rejected, chart.js
// caught it into `{}`, the board repainted from the same unchanged state and the ring went
// back to grey. The kid did the job, told the tablet, and the tablet forgot.
//
// So the tap is written down first and posted later. Two things make that safe to do with a
// child's money, and neither is a guess:
//
//   • `POST /api/task-runs/:id/done` is REPLAY-SAFE. `src/routes/routines.ts` answers 409
//     `already_finished` on a second call, so a queued tap that really did land, and whose
//     response was lost, cannot finish the task twice. 409 is counted as success here.
//   • THE PAYOUT IS NOT ON THIS PATH. Money moves when a parent approves, through an
//     exactly-once route with its own proof (src/payout-exactly-once.test.ts). Everything
//     queued here only ever ASKS a grown-up. A double send is impossible by construction,
//     not by this file being careful.
//
// `POST /api/chores/:id/submit` is the same shape: `openApproval` returns the approval that is
// already pending rather than opening a second one, and an approved chore answers 409. The one
// cost of a replay there is a duplicate push to the parent's phone, in the narrow window where
// the POST landed and the answer did not.

import { api } from "./api.js";
import { state } from "./util.js";

const KEY = "kid.outbox";
// A queued tap is about a job on a particular day. After a week the task run it names is
// ancient history on the server and the kid has long since moved on, so it is dropped rather
// than posted into a board nobody is looking at.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function save(entries) {
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* private mode */ }
}

/**
 * WHAT AN ANSWER MEANS FOR A QUEUED TAP. Pure, so src/kid-outbox.test.ts can exercise every
 * branch without a network.
 *
 *   done  the server has it. 2xx, and 409, which is the server saying it already had it.
 *   keep  worth trying again: 5xx, or a rate limit, or no answer at all (status 0).
 *   drop  it can never succeed. A 404 is a task run that no longer exists; a 401 or 403 is
 *         this tablet not being allowed to touch it. Retrying either forever would mean a
 *         queue that never empties and a board that lies about a job being handed in.
 */
export function verdict(status) {
  if (status >= 200 && status < 300) return "done";
  if (status === 409) return "done";
  if (status === 0 || status === 408 || status === 429 || status >= 500) return "keep";
  return "drop";
}

/** Is this job already waiting to be sent? One tap per job, however many times it is pressed. */
export function isQueued(targetId) {
  return load().some((e) => e.targetId === targetId);
}

export function queuedCount(childId) {
  return load().filter((e) => !childId || e.childId === childId).length;
}

/**
 * Write a tap down. `tk` is the card's row out of `state.chart.todayTasks`.
 *
 * Returns false when the job is already queued, so a kid pressing twice on a dead network
 * cannot stack two of the same POST.
 */
export function queueTap(tk, childId) {
  const targetId = tk.kind === "task" ? tk.taskRunId : tk.choreId;
  if (!targetId || isQueued(targetId)) return false;
  const entries = load();
  entries.push({
    targetId, childId,
    kind: tk.kind === "task" ? "task" : "chore",
    runId: tk.kind === "task" ? tk.runId : null,
    at: Date.now(),
  });
  save(entries);
  return true;
}

/**
 * PAINT THE QUEUE ONTO THE BOARD, so a kid sees the answer they gave.
 *
 * Called at the end of every `refreshChart`, which is the only place `state.chart` is
 * replaced, a fresh board from the server, or one read off disk, is the SERVER'S answer, and
 * this device's unsent taps go on top of it. Put anywhere else it would be forgotten by the
 * next ten-second poll.
 *
 * ⚠️ THE RUN HAS TO MOVE WITH ITS LAST TASK. `cardState` reads a routine task whose siblings
 * are all finished, on a run still `in_progress`, as "retry", the parent sent it back. That
 * is true on the server, where a finished run is moved to `done_pending` by
 * `completeRunIfFinished` the moment the last task lands. Offline nothing moves it, so a kid
 * finishing their morning routine in the car would be shown every card asking them to have
 * another go. Mirroring that one server rule here is what stops it.
 */
export function applyQueuedTaps() {
  applyTaps(state.chart?.todayTasks, load().map((e) => e.targetId));
}

/**
 * The rule above, as a function of its inputs, so src/kid-outbox.test.ts can exercise the
 * run-completion case without a board, a network or a localStorage. Mutates `tasks` in place,
 * which is what the caller wants: `state.chart` is the object every screen is already reading.
 */
export function applyTaps(tasks, queuedIds) {
  if (!Array.isArray(tasks) || !tasks.length) return;
  const queued = new Set(queuedIds ?? []);
  if (!queued.size) return;

  for (const tk of tasks) {
    const id = tk.kind === "task" ? tk.taskRunId : tk.choreId;
    if (!queued.has(id)) continue;
    if (tk.kind === "task") { if (tk.status === "pending" || tk.status === "running") tk.status = "done"; }
    else if (tk.status === "open" || tk.status === "rejected") tk.status = "submitted";
  }
  // Second pass, because a run is only finished once every one of its tasks is.
  const finished = (x) => x.status === "done" || x.status === "skipped" || x.status === "passed";
  const runs = new Set(tasks.filter((x) => x.kind === "task" && queued.has(x.taskRunId)).map((x) => x.runId));
  for (const runId of runs) {
    const steps = tasks.filter((x) => x.kind === "task" && x.runId === runId);
    if (!steps.length || !steps.every(finished)) continue;
    // Optional steps are a side quest the kid may leave (#341); the server holds the run open
    // for them, so a run with an untaken bonus is NOT done_pending and must not claim to be.
    if (steps.some((x) => x.optional && x.status === "pending")) continue;
    for (const x of steps) if (x.runStatus === "in_progress") x.runStatus = "done_pending";
  }
}

// The in-flight flush, not a boolean. A second caller AWAITS the first rather than being told
// "0 sent" and carrying on: chart.js flushes and then re-reads the board, and a caller that
// skipped ahead would repaint from a server that had not been told yet, blinking every queued
// card back to open for a poll.
let inFlight = null;

/**
 * Send everything that is waiting, oldest first.
 *
 * Stops on the first entry that gets no answer at all: that is the network still being down,
 * and walking the rest of the queue only produces the same failure N more times. Everything
 * else is decided per entry by `verdict` above.
 *
 * Returns how many taps reached the server, so a caller can repaint only when it matters.
 */
export function flushOutbox() {
  if (!inFlight) inFlight = runFlush().finally(() => { inFlight = null; });
  return inFlight;
}

async function runFlush() {
  const entries = load();
  if (!entries.length) return 0;
  const now = Date.now();
  const kept = [];
  let sent = 0;
  let stopped = false;
  for (const e of entries) {
    if (stopped) { kept.push(e); continue; }
    if (now - (e.at ?? 0) > MAX_AGE_MS) continue; // too old to mean anything
    const path = e.kind === "task"
      ? `/api/task-runs/${encodeURIComponent(e.targetId)}/done`
      : `/api/chores/${encodeURIComponent(e.targetId)}/submit`;
    const status = await api.postStatus(path);
    const call = verdict(status);
    if (call === "done") { sent += 1; continue; }
    if (call === "drop") continue;
    kept.push(e);
    if (status === 0) stopped = true; // still offline: the rest will fail the same way
  }
  save(kept);
  return sent;
}

// TWO HINTS THAT THE NETWORK MIGHT BE BACK, and neither is trusted as an answer.
//
// `online` fires on a Wi-Fi that may still have no route to the Mini; a flush then simply
// fails and keeps the queue, which costs nothing. `visibilitychange` is the one that actually
// carries this app: the tablet sleeps in a bag on the way home and wakes up at the kitchen
// table, and the ten-second chart poll is guarded by `document.hidden` precisely so it does
// not burn battery asleep. Without this listener a queued tap waits for the kid to reopen the
// app. It is HERE rather than on the chart because a tablet can just as easily wake up on the
// Money screen or inside the Treasure Box.
// ⚠️ FEATURE-DETECT THE METHOD, NOT THE OBJECT. `typeof window !== "undefined"` was not enough:
// under `bun test` another suite installs a partial `window` stub, so the global EXISTS while
// `addEventListener` on it does not, and importing this module threw at load. Everything that
// imports it, which is most of the kid app, went down with it. `on()` is the whole guard.
const on = (target, event, fn) => {
  if (target && typeof target.addEventListener === "function") target.addEventListener(event, fn);
};
on(typeof window === "undefined" ? null : window, "online", () => { void flushOutbox(); });
on(typeof document === "undefined" ? null : document, "visibilitychange", () => {
  if (document.visibilityState === "visible") void flushOutbox();
});
