// nimiq.kids kid app — what "approved" MEANS to a kid's card, and the notice built on it.
//
// Issue #323: a kid finishes their jobs, the app says "Waiting for Mom", and then a parent
// approves from their own phone. Nothing told the kid. The chart re-rendered on its next
// 10-second poll, the ring went from an hourglass to a green dashed circle, and the sticker
// they earned sat behind a tap nobody had given them a reason to make. That is the single
// most motivating moment in the product arriving in silence.
//
// Two things live here together on purpose. `cardState` is the ONE rule the ring's look, what
// a tap does and whether a sticker is available all read off; the notice is the FOURTH reader
// of that same rule ("a subject of mine turned `reward` and nobody said so"). Deriving
// "approved" a second way from the raw fields is how those readers drifted apart the last
// time, so the notice reads the same function the ring does.
//
// It also had to leave chart.js: that file was at 766 of the 800-line CI guard.
//
// **util.js is the ONLY import**, so the rule can be exercised as a function with inputs
// (src/kid-approval-notice.test.ts) the way grow-gate.js is, rather than through chart.js's
// whole screen graph. Opening the sticker sheet is the caller's to do and arrives as an
// argument — pulling stickers.js in here would drag confetti, the photo store and the API
// client behind it, and would put chart.js on both ends of an import cycle.

import { state, t, toast, parentName, rowTitle, fmtNimLuna } from "./util.js";

/** What a card IS, from the kid's side. The ring's look, what a tap does and
 *  whether a sticker is available all read off this ONE function, because those
 *  three questions used to be answered by three separate reads of the same
 *  fields and they had drifted apart.
 *
 *  Andjroo, 2026-07-31: **the sticker lands only once the parent has said yes.**
 *  So "handed in" and "earned it" are two different states of the same ring, and
 *  the ring is the only thing on a card that says which one this is.
 *
 *    open     the kid's to do          dashed grey ring, press to answer
 *    waiting  with the parent          solid ring + hourglass, nothing to do
 *    retry    the parent sent it back  press to say it is fixed (unchanged)
 *    reward   approved, no sticker yet dashed GREEN ring, press to place one
 *    done     approved and placed      the sticker itself
 */
export function cardState(tk, all) {
  // A placement carrying 'retry' still means retry: rows written before the
  // sticker moved behind approval still exist, and so does the reject path.
  if (tk.placement?.state === "retry") return "retry";
  if (tk.kind !== "task") {
    if (tk.status === "rejected") return "retry";
    if (tk.status === "open") return "open";
    if (tk.status === "submitted") return "waiting";
    return tk.placement ? "done" : "reward"; // approved / claimed
  }
  if (tk.runStatus === "approved") return tk.placement ? "done" : "reward";
  if (tk.runStatus === "done_pending") return "waiting";
  // in_progress. A run whose tasks are ALL finished and which is STILL
  // in_progress is a run the parent sent back — completeRunIfFinished() would
  // have moved it to done_pending otherwise (src/routes/routines.ts), and
  // applyReject() is what puts it back (src/routes/approvals.ts). This used to
  // be read off placement.state, which no longer exists before approval.
  // 'passed' is a side quest the kid left alone when they ended the run (#341). It counts as
  // finished here or a rejected run containing one would read as still open, and the kid would
  // never be told to have another go.
  const finished = (x) => x.status === "done" || x.status === "skipped" || x.status === "passed";
  const siblings = all.filter((x) => x.kind === "task" && x.runId === tk.runId);
  if (siblings.length && siblings.every(finished)) return "retry";
  return finished(tk) ? "waiting" : "open";
}

/** Terminal for a step: it is over, whoever ended it and whether or not it paid. */
const stepFinished = (x) => x.status === "done" || x.status === "skipped" || x.status === "passed";

/**
 * Has this run become the kid's to END?
 *
 * True in exactly one situation, and it is the situation side quests created (#341): every
 * REQUIRED step is finished, the run has not been submitted, and a bonus is still sitting
 * there unclaimed. The server deliberately stops auto-submitting here, because submitting
 * freezes the run and would slam the door on a bonus the kid was still free to take.
 *
 * Which means the kid needs a way OUT, or a child who simply does not want to put the dishes
 * away has done every job they were asked to do and can never be paid for any of them. That
 * is the whole reason this function exists. `POST /routine-runs/:id/submit` is the way out,
 * and it writes the untaken bonus to 'passed'.
 *
 * ⚠️ **This mirrors the server's `allTasksFinished` + `openOptionalTaskRuns` and must keep
 * mirroring them.** It lives here beside `cardState` rather than inside chart.js's screen
 * graph so it can be exercised as a function with inputs, which is the same reason
 * `approvedSubjects` does.
 *
 * The trail (#343) and the chest (#344) will replace how this is DRAWN. They do not replace
 * this rule, exactly as the quest map replaces the drawing of a routine and not its flow.
 */
export function runFinishable(all, runId) {
  const steps = all.filter((x) => x.kind === "task" && x.runId === runId);
  if (!steps.length) return false;
  // Only while the run is still the kid's. Once it is with a grown-up, or paid, there is
  // nothing left to end and the button would be an invitation to a 409.
  if (steps[0].runStatus !== "in_progress") return false;
  const required = steps.filter((x) => !x.optional);
  if (!required.every(stepFinished)) return false;
  return steps.some((x) => x.optional && !stepFinished(x));
}

/**
 * Every approval of this kid's that is landed but uncollected, ONE entry each.
 *
 * ⚠️ **THE APPROVAL IS THE UNIT, NOT THE CARD.** One "yes" on a morning routine turns four
 * task cards green at once, and four toasts for one parent tap is worse than none. Routine
 * tasks therefore collapse to their run; a chore or lesson is its own subject already.
 *
 * `luna` is what the server paid, TAKEN FROM THE SERVER rather than recomputed here (#369).
 * This comment used to promise the amount was "computed the way the server computes it and not
 * a second pricing rule", and then re-derived it: a run from the sum of `reward_luna` over its
 * done task runs, a chore from its own `reward_luna`. Both were right until partial credit
 * (#351) made the server's rule `floor(reward_luna * share_bps / 10000)`, at which point a job
 * approved at a quarter told the kid it had paid full price. The recipe was the bug; the row
 * now carries the answer (`settled.paidLuna`, src/routes/stickers.ts).
 *
 * The fallback to the old sum is for a `reward` card with no decided approval behind it, which
 * should not exist — but a notice that says nothing is better than one that invents a number.
 * The old sum
 * (`runRewardLuna`, src/repo-routines.ts) and a chore pays its own `reward_luna`
 * (`approvalPayoutLuna`, src/routes/approvals.ts). Both fields ride on the card. waiting.js
 * already sums a run the same way for its "+N NIM today" line.
 *
 * Titles come back RAW (`title` + `titleKey`) for `rowTitle()` to resolve — a parent-typed
 * "Feed Winston his 5pm scoop" is printed as typed, a seeded one translates.
 *
 * `target` is the first still-uncollected card of the subject, which is where a tap on the
 * notice opens the picker. The rest of a run's stickers stay collectable by tapping them,
 * exactly as they are after a demo self-approval.
 *
 * Practices and ladders are deliberately absent. A practice's sticker is offered the moment
 * the kid logs the day (chart.js `logPractice`), so it is never waiting behind an untold tap,
 * and a rung is not a card with a ring. A rung's theme sticker arriving silently is a real
 * gap and it is a different one.
 */
export function approvedSubjects(chart) {
  const all = chart?.todayTasks ?? [];
  const subjects = new Map();
  for (const tk of all) {
    if (cardState(tk, all) !== "reward") continue;
    if (tk.kind === "task") {
      const key = `run:${tk.runId}`;
      if (subjects.has(key)) continue; // first uncollected card of the run wins the target
      const siblings = all.filter((x) => x.kind === "task" && x.runId === tk.runId);
      subjects.set(key, {
        key,
        title: tk.routineTitle, titleKey: tk.routineTitleKey,
        // A RUN IS ONE SUBJECT, so its settled figure is the run's, carried identically on
        // every task row. Never a per-task share: floor() per task then summed does not equal
        // floor() of the sum, and the difference is luna the kid really was paid.
        luna: tk.settled?.paidLuna ?? siblings
          .filter((x) => x.status === "done")
          .reduce((sum, x) => sum + (x.rewardLuna ?? 0), 0),
        note: tk.settled?.note ?? null,
        target: { kind: "task", id: tk.taskRunId },
      });
    } else {
      const key = `chore:${tk.choreId}`;
      subjects.set(key, {
        key,
        title: tk.title, titleKey: tk.titleKey,
        luna: tk.settled?.paidLuna ?? tk.rewardLuna ?? 0,
        note: tk.settled?.note ?? null,
        target: { kind: "chore", id: tk.choreId },
      });
    }
  }
  return [...subjects.values()];
}

/** The subjects in `chart` that `seen` has not been told about yet. */
export function freshSubjects(chart, seen) {
  const known = new Set(seen ?? []);
  return approvedSubjects(chart).filter((s) => !known.has(s.key));
}

/**
 * What the kid is told, in one line, for `fresh` approvals worth `luna` in total.
 *
 * Four sentences rather than one composed from fragments: word order is not ours to assume
 * across five languages, and a zero-NIM job is real (a kid-added job may be worth nothing),
 * so "+0 NIM" has to be sayable as nothing at all.
 */
export function noticeText(fresh, name) {
  const luna = fresh.reduce((sum, s) => sum + s.luna, 0);
  const amount = fmtNimLuna(luna);
  // THE REASON, when a grown-up paid part of it (#349, #369). A partial yes arriving as a
  // smaller number with no sentence attached is worse than a reject — and the app REQUIRES the
  // parent to write that sentence, so eating it makes the requirement theatre. Only ever
  // appended for a single subject: two notes in one line is not a sentence, and a kid reading
  // "Mom said yes to 3 jobs" does not know which one the reason belongs to.
  const note = fresh.length === 1 ? (fresh[0].note ?? "").trim() : "";
  const base = (() => {
    if (fresh.length === 1) {
      const job = rowTitle(fresh[0]);
      return luna > 0
        ? t("app.kidApprovedOne", { name, job, amount })
        : t("app.kidApprovedOneFree", { name, job });
    }
    return luna > 0
      ? t("app.kidApprovedMany", { name, count: fresh.length, amount })
      : t("app.kidApprovedManyFree", { name, count: fresh.length });
  })();
  return note ? t("app.kidApprovedWhy", { base, note }) : base;
}

// ---------- "since I last looked" ----------
//
// The marker is the SET of subjects that were collectable when the kid was last told, not a
// timestamp: an approval that landed with the app closed still has to be announced on next
// open, and a subject drops out of the set the moment its sticker is placed, so the set stays
// bounded by what is on Today. Per kid, because a tablet switches between them.
const SEEN_KEY = (childId) => `kid.approvedSeen.${childId}`;

function readSeen(childId) {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY(childId)) ?? "null");
    if (Array.isArray(raw)) return raw;
  } catch { /* private mode, or a value from an older shape */ }
  return []; // never told on this device = tell them, which is the closed-app case
}
function writeSeen(childId, keys) {
  try { localStorage.setItem(SEEN_KEY(childId), JSON.stringify(keys)); } catch { /* private mode */ }
}

/**
 * Record what is collectable right now WITHOUT saying anything.
 *
 * ⚠️ **EVERY PATH THAT ALREADY CELEBRATES MUST CALL THIS**, straight after its `refreshChart()`
 * and before the celebration, or the notice fires on top of it. Four of them exist: the demo
 * self-approve on a chore (chart.js), the demo self-approve on a routine, the on-tablet PIN,
 * and the waiting screen's own poll catching a remote approval (all waiting.js). A routine is
 * the one that bites — its FIRST sticker opens automatically and the other three cards stay
 * `reward`, so without this the poll would announce a routine the kid just watched pay out.
 */
export function markApprovalsSeen() {
  const childId = state.child?.id;
  if (childId) writeSeen(childId, approvedSubjects(state.chart).map((s) => s.key));
}

/**
 * Tell the kid an approval landed while they were not looking, and point at the sticker.
 *
 * Called on every chart paint rather than only from the poll, so a kid whose app was closed
 * when the yes arrived hears about it the moment they open it.
 *
 * The toast is tappable and stays up longer than the usual 2.4s: it is four beats long (who
 * said yes, to what, what it paid, what to do now) and a six-year-old reads it once.
 *
 * @param openSticker called with the subject's `target` when the kid taps the notice. The
 *   caller's, because opening a sheet is chart.js's job and importing stickers.js here would
 *   put chart.js on both ends of a cycle.
 */
export function announceApprovals(openSticker) {
  const childId = state.child?.id;
  if (!childId) return;
  const subjects = approvedSubjects(state.chart);
  const fresh = freshSubjects(state.chart, readSeen(childId));
  writeSeen(childId, subjects.map((s) => s.key));
  if (!fresh.length) return;
  toast(noticeText(fresh, parentName()), {
    ms: 6500,
    onTap: () => openSticker(fresh[0].target),
  });
}
