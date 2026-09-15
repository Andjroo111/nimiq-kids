// V3 sticker chart routes: the ONE-call chart feed the kid home renders from,
// sticker placement (position + tilt persist), the kid's inventory, and photo
// stickers (camera tile -> media role 'sticker' -> a die-cut sticker they own).
// Kid endpoints are unauthenticated by design (it's their tablet, same trust
// model as routines/wallet).

import { Hono } from "hono";
import * as repo from "../repo";
import * as routines from "../repo-routines";
import * as stickersRepo from "../repo-stickers";
import * as practicesRepo from "../repo-practices";
import * as goalsRepo from "../repo-goals";
import * as approvalsRepo from "../repo-approvals";
import { mondayOf, weekDays, monthDays } from "../days";
import { iconUrlForEmoji } from "../task-icons";
import { familyForSubject } from "./families";

export const stickersRoutes = new Hono();

// ---- shared views ----
export function placementView(p: stickersRepo.StickerPlacement | null) {
  if (!p) return null;
  const s = stickersRepo.getSticker(p.sticker_id);
  return {
    id: p.id, stickerId: p.sticker_id, assetUrl: s?.asset_url ?? null,
    emoji: s?.emoji ?? null,
    label: s?.label ?? "", stickerKind: s?.kind ?? "art",
    xPct: p.x_pct, yPct: p.y_pct, tiltDeg: p.tilt_deg, state: p.state, day: p.day,
  };
}
const stickerView = (s: stickersRepo.Sticker) => ({
  id: s.id, packId: s.pack_id, label: s.label,
  emoji: s.emoji, assetUrl: s.asset_url, kind: s.kind,
});

/** Terminal, for the calendar's purposes. 'passed' (a side quest the kid left alone) belongs
 *  here for the same reason 'skipped' does: the day is over either way, and a chart that read
 *  a finished day as still open because of an untaken bonus would be lying about the day. */
const doneish = (s: string) => s === "done" || s === "skipped" || s === "passed";

/**
 * The chart's ROWS over an arbitrary run of days: one row per routine, plus an
 * aggregate chores row and lessons row. The week feed (/chart) and the month
 * feed (/month) both come through here, so a day can never read "done" in the
 * week strip and "open" in the month grid.
 */
/**
 * The month the calendar's back arrow stops at: the month of this child's earliest day, or
 * the month they are in when they have no history at all.
 *
 * Forward already stops at today's month because there are no chores in the future. Back had
 * no bound at all, so a kid could hold the arrow down and walk into 2019, one empty grid at a
 * time (Andjroo, 2026-08-04: "the kid could be able to go to years, but not like that").
 * This is the same rule pointing the other way: nothing before you started either.
 */
function firstMonthFor(childId: string, today: string): string {
  return (stickersRepo.firstActivityDay(childId) ?? today).slice(0, 7);
}

function chartRows(
  famId: string, childId: string, days: string[], today: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const routine of routines.listRoutines(famId, childId)) {
    if (days.includes(today)) routines.todayRun(routine, today); // kid's own device: today's run exists
    const cells = days.map((day) => {
      const run = routines.findRun(routine.id, day);
      if (!run) return { day, status: null, done: 0, total: 0, placements: [] };
      const trs = routines.listTaskRuns(run.id);
      return {
        day, status: run.status,
        done: trs.filter((tr) => doneish(tr.status)).length, total: trs.length,
        placements: trs.map((tr) => placementView(stickersRepo.getPlacement("routine_task_run", tr.id)))
          .filter(Boolean),
      };
    });
    rows.push({
      kind: "routine", id: routine.id,
      title: routine.title, titleKey: routine.title_key, emoji: routine.emoji, cells,
    });
  }

  // Chores + lessons: one aggregate row each (keeps the grid tight at 390px).
  const allChores = repo.listActiveChores(famId, childId);
  for (const rowKind of ["chore", "lesson"] as const) {
    const group = allChores.filter((ch) => (ch.kind ?? "chore") === rowKind);
    if (!group.length) continue;
    const cells = days.map((day) => ({
      day,
      placements: group
        .map((ch) => placementView(stickersRepo.getPlacement("chore", ch.id)))
        .filter((p) => p && p.day === day),
    }));
    rows.push({ kind: rowKind === "chore" ? "chores" : "lessons", id: `row-${rowKind}s`, cells });
  }

  // Practices: one row per practice, a cell per day it happened. This is what
  // makes a weekly target legible — "regularly" is a shape on the calendar, and
  // a daily list can never draw it because it forgets every night.
  // A practice row is SPARSE on purpose: a cell exists only for a day the
  // practice actually happened. A weekly target has no per-day due-ness, so a
  // rest day owes nothing — emitting an empty cell for it would count against
  // that day's completeness and make five days of every week read unfinished.
  // A practice can only ever add to a day, never subtract from it.
  for (const practice of practicesRepo.listPractices(famId, childId)) {
    const cells = practicesRepo.sessionDays(practice.id, days[0]!, days.at(-1)!).map((day) => {
      const session = practicesRepo.getSession(practice.id, day)!;
      return {
        day,
        status: "approved", // the logged day IS the done state
        done: 1, total: 1,
        placements: [placementView(stickersRepo.getPlacement("practice_session", session.id))].filter(Boolean),
      };
    });
    rows.push({
      kind: "practice", id: practice.id,
      title: practice.title, titleKey: practice.title_key, emoji: practice.emoji, cells,
    });
  }
  return rows;
}

/**
 * THE kid-home payload: week grid rows (routines + chores + lessons), each cell's
 * placements + pending states, today's task cards, and the sticker inventory.
 * ?week= any date inside the wanted week (defaults to today).
 */
stickersRoutes.get("/kids/:id/chart", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  stickersRepo.ensureStarterGrant(child.id);

/**
 * WHAT A DECIDED SUBJECT ACTUALLY PAID, for the kid's own screen (#369).
 *
 * The kid app used to price an approved job itself: a chore from its `reward_luna`, a routine
 * from the sum of its done tasks. That was correct right up until partial credit (#351) made
 * the server's rule `floor(reward_luna * share_bps / 10000)`, at which point a job approved at
 * a quarter still told the kid it paid full price. `public/kid/js/approved.js` even carries a
 * comment promising it is "computed the way the server computes it and not a second pricing
 * rule" — it had become exactly that.
 *
 * So the number is computed HERE, once, by `applyShare`, the same function the payout used,
 * and the kid app is handed the answer instead of a recipe. `note` rides with it because a
 * smaller number owes the kid a reason and the parent was REQUIRED to write one.
 *
 * ⚠️ A RUN IS ONE SUBJECT. The share is applied to the run's whole price, never per task: a
 * routine's approval subject is the run, and `floor()` per task then summed does not equal
 * `floor()` of the sum. Scaling four tasks separately can lose luna the kid was really paid,
 * which is why every task row of a run carries the SAME run-level object rather than a share
 * of its own.
 *
 * Null when there is no decided approval — an open or submitted job has not paid anything yet
 * and must not claim to have.
 */
function settledView(
  subjectKind: approvalsRepo.ApprovalSubject, subjectId: string, fullLuna: number,
): { paidLuna: number; shareBps: number | null; note: string | null } | null {
  const a = approvalsRepo.latestApprovalFor(subjectKind, subjectId);
  if (!a || a.status !== "approved") return null;
  return {
    paidLuna: approvalsRepo.applyShare(fullLuna, a.share_bps),
    shareBps: a.share_bps,
    note: a.share_bps !== null && a.share_bps < approvalsRepo.SHARE_BPS_FULL ? a.note : null,
  };
}

  const today = routines.localDay(fam.tz);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("week") ?? "") ? c.req.query("week")! : today;
  const weekStart = mondayOf(anchor);
  const days = weekDays(weekStart);

  const rows = chartRows(fam.id, child.id, days, today);
  const todayTasks: Record<string, unknown>[] = [];

  // Today's cards: the routine tasks scheduled for today, then chores, then lessons.
  for (const routine of routines.listRoutines(fam.id, child.id)) {
    const run = routines.findRun(routine.id, today);
    if (!run) continue;
    const tasks = routines.listTasks(routine.id);
    // Computed ONCE per run, not per task: the run is the approval's subject. See settledView.
    const runSettled = settledView("routine_run", run.id, routines.runRewardLuna(run.id));
    for (const tr of routines.listTaskRuns(run.id)) {
      // ⚠️ FALLS BACK TO THE RETIRED ROW, and that is the point (#381). `listTasks` is active-only,
      // so a task the parent edited mid-day used to make its card vanish off the board. After
      // `reconcileRun` the only retired rows left in a live run are ones the kid actually DID —
      // and `runRewardLuna` counts those, so dropping the card here paid for work it did not show.
      const task = tasks.find((t) => t.id === tr.task_id) ?? routines.getTask(tr.task_id);
      if (!task) continue;
      todayTasks.push({
        kind: "task", taskRunId: tr.id, taskId: task.id,
        routineId: routine.id, routineTitle: routine.title, routineTitleKey: routine.title_key,
        routineEmoji: routine.emoji,
        slot: routine.slot, // 'morning' | 'afternoon' | 'evening' | anything else = any time
        runId: run.id, runStatus: run.status,
        title: task.title, titleKey: task.title_key, emoji: task.emoji, iconUrl: iconUrlForEmoji(task.emoji),
        durationS: task.duration_s,
        // Extra credit (#342). The tablet needs it to tell a bonus apart from the work that
        // has to happen, and to know when the run has become the kid's to end (#341).
        optional: task.optional,
        rewardLuna: task.reward_luna, status: tr.status,
        settled: runSettled,
        placement: placementView(stickersRepo.getPlacement("routine_task_run", tr.id)),
      });
    }
  }
  // Kid-added jobs may be worth nothing, so the board is no longer filtered by
  // reward — but a removed job is off the board entirely.
  const allChores = repo.listActiveChores(fam.id, child.id);
  for (const rowKind of ["chore", "lesson"] as const) {
    for (const ch of allChores.filter((x) => (x.kind ?? "chore") === rowKind)) {
      const placement = placementView(stickersRepo.getPlacement("chore", ch.id));
      const active = ch.status === "open" || ch.status === "submitted" || ch.status === "rejected";
      // A chore approved TODAY whose sticker has not been collected yet is still
      // the kid's business. This row used to be impossible: the sticker was
      // placed before the parent ever saw the job, so an approved chore always
      // had a placement and the placement's day is what kept the card on Today.
      // Since 0.28 the sticker only becomes available AFTER approval (Andjroo,
      // 2026-07-31), so without this the card vanished at the exact moment it
      // turned into the reward the kid was meant to come back for.
      const uncollected = !placement
        && (ch.status === "approved" || ch.status === "claimed")
        && ch.approved_at !== null
        && routines.localDay(fam.tz, ch.approved_at) === today;
      if (!active && !uncollected && placement?.day !== today) continue; // old finished chores leave Today
      todayTasks.push({
        kind: rowKind, choreId: ch.id, title: ch.title, titleKey: ch.title_key, emoji: ch.emoji,
        iconUrl: iconUrlForEmoji(ch.emoji),
        createdBy: ch.created_by,
        durationS: ch.duration_s ?? null, rewardLuna: ch.reward_luna, status: ch.status,
        settled: settledView("chore", ch.id, ch.reward_luna),
        placement,
      });
    }
  }

  return c.json({
    today, weekStart, days, rows, todayTasks,
    // The calendar's back bound. It rides on /chart as well as /month because the header
    // draws its arrows from `state.chart` on the very first paint, before any month feed
    // has been asked for — without it here the back arrow is live for one frame.
    firstMonth: firstMonthFor(child.id, today),
    // Practices ride alongside todayTasks rather than inside it: they are not a
    // time of day and they are not done/not-done today, they are N of M this week.
    // The sticker is attached here, not in the repo: placements are this module's
    // job, and repo-practices has no business importing a route's view.
    practices: practicesRepo.listPractices(fam.id, child.id).map((p) => {
      const view = practicesRepo.practiceView(p, today);
      return {
        ...view,
        iconUrl: iconUrlForEmoji(p.emoji),
        placement: view.sessionId
          ? placementView(stickersRepo.getPlacement("practice_session", view.sessionId))
          : null,
      };
    }),
    // Ladders ride alongside practices for the same reason practices ride alongside
    // todayTasks: a goal is not a time of day and not a this-week count, it is how far the
    // kid has got. No sticker is attached — a rung is not a day, and there is nothing on the
    // week grid for it to be placed on.
    goals: goalsRepo.listGoals(fam.id, child.id).map((g) => ({
      ...goalsRepo.goalView(g),
      iconUrl: iconUrlForEmoji(g.emoji),
    })),
    stickers: stickersRepo.ownedStickers(child.id).map(stickerView),
    serverTime: Date.now(),
  });
});

/**
 * The MONTH feed for the kid's calendar: the same rows/cells as /chart, over the
 * whole 7xN month grid. Deliberately NOT folded into /chart -- that payload is on
 * a 10-second poll and drives the home screen, while the month is only on screen
 * once a kid taps the calendar open. Fetched lazily and cached per month client
 * side. ?month=YYYY-MM (defaults to the month containing today).
 */
stickersRoutes.get("/kids/:id/month", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);

  const today = routines.localDay(fam.tz);
  const q = c.req.query("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(q) ? q : today.slice(0, 7);
  const days = monthDays(month);

  return c.json({
    today, month, days,
    firstMonth: firstMonthFor(child.id, today),
    rows: chartRows(fam.id, child.id, days, today),
    serverTime: Date.now(),
  });
});

// ---- placement ----
function clamp(n: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}
function placementBody(body: Record<string, unknown>) {
  return {
    stickerId: String(body.stickerId ?? ""),
    xPct: clamp(Number(body.xPct), 0, 100, 50),
    yPct: clamp(Number(body.yPct), 0, 100, 50),
    tiltDeg: clamp(Number(body.tiltDeg), -20, 20, 0),
  };
}

/** The kid places (or moves) a sticker on a DONE routine task. */
stickersRoutes.post("/task-runs/:id/sticker", async (c) => {
  const tr = routines.getTaskRun(c.req.param("id"));
  if (!tr) return c.json({ error: "not_found" }, 404);
  if (tr.status !== "done") return c.json({ error: "not_done" }, 400);
  const run = routines.getRun(tr.run_id);
  if (!run) return c.json({ error: "not_found" }, 404);
  const routine = routines.getRoutine(run.routine_id);
  if (!routine || !(await familyForSubject(c, routine.family_id))) return c.json({ error: "not_found" }, 404);
  const b = placementBody(await c.req.json().catch(() => ({})));
  if (!stickersRepo.getSticker(b.stickerId)) return c.json({ error: "sticker_not_found" }, 404);
  if (!stickersRepo.ownsSticker(run.child_id, b.stickerId)) return c.json({ error: "not_owned" }, 403);
  const placement = stickersRepo.placeSticker({
    childId: run.child_id, subjectKind: "routine_task_run", subjectId: tr.id, day: run.day,
    stickerId: b.stickerId, xPct: b.xPct, yPct: b.yPct, tiltDeg: b.tiltDeg,
    state: run.status === "approved" ? "shined" : "pending",
  });
  return c.json({ placement: placementView(placement) });
});

/** Chore equivalent (submitted or approved chores can carry a sticker). */
stickersRoutes.post("/chores/:id/sticker", async (c) => {
  const chore = repo.getChore(c.req.param("id"));
  const fam = chore ? await familyForSubject(c, chore.family_id) : null;
  if (!chore || !fam) return c.json({ error: "not_found" }, 404);
  if (chore.status !== "submitted" && chore.status !== "approved") {
    return c.json({ error: "not_done" }, 400);
  }
  const b = placementBody(await c.req.json().catch(() => ({})));
  if (!stickersRepo.getSticker(b.stickerId)) return c.json({ error: "sticker_not_found" }, 404);
  if (!stickersRepo.ownsSticker(chore.child_id, b.stickerId)) return c.json({ error: "not_owned" }, 403);
  const placement = stickersRepo.placeSticker({
    childId: chore.child_id, subjectKind: "chore", subjectId: chore.id,
    day: routines.localDay(fam.tz),
    stickerId: b.stickerId, xPct: b.xPct, yPct: b.yPct, tiltDeg: b.tiltDeg,
    state: chore.status === "approved" ? "shined" : "pending",
  });
  return c.json({ placement: placementView(placement) });
});

/** A practice session carries its own sticker, so every day of a streak can wear
 *  a different one — the subject is the SESSION, not the practice. */
stickersRoutes.post("/practice-sessions/:id/sticker", async (c) => {
  const session = practicesRepo.getSessionById(c.req.param("id"));
  const practice = session ? practicesRepo.getPractice(session.practice_id) : null;
  const fam = practice ? await familyForSubject(c, practice.family_id) : null;
  if (!session || !practice || !fam) return c.json({ error: "not_found" }, 404);
  const b = placementBody(await c.req.json().catch(() => ({})));
  if (!stickersRepo.getSticker(b.stickerId)) return c.json({ error: "sticker_not_found" }, 404);
  if (!stickersRepo.ownsSticker(session.child_id, b.stickerId)) return c.json({ error: "not_owned" }, 403);
  const placement = stickersRepo.placeSticker({
    childId: session.child_id, subjectKind: "practice_session", subjectId: session.id,
    day: session.day, stickerId: b.stickerId, xPct: b.xPct, yPct: b.yPct, tiltDeg: b.tiltDeg,
    state: "shined", // a practice a kid logged needs no approval to count
  });
  return c.json({ placement: placementView(placement) });
});

// ---- inventory ----
stickersRoutes.get("/kids/:id/stickers", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  if (!child || !(await familyForSubject(c, child.family_id))) return c.json({ error: "child_not_found" }, 404);
  stickersRepo.ensureStarterGrant(child.id);
  return c.json({
    // NO PRICE HERE, deliberately (#288). `sticker_packs.price_luna` is a second copy of a
    // price the Treasure Box charges from `store_items`, and once a family can set their own
    // (`store_item_overrides`) the copy is simply wrong — it would have shown one number on
    // the sticker book and taken another at the till. This endpoint is INVENTORY: what the
    // kid owns, and which pack each sticker came out of. The shelf is `/kids/:id/store`.
    stickers: stickersRepo.ownedStickers(child.id).map(stickerView),
    packs: stickersRepo.listPacks().map((p) => ({
      id: p.id, title: p.title,
      owned: stickersRepo.packOwned(child.id, p.id),
    })),
  });
});

/**
 * Camera tile: the kid's own photo becomes a die-cut sticker.
 *
 * THE BYTES NEVER ARRIVE (#282). The picture is written to the tablet's own IndexedDB and
 * this route is told only the local handle it was filed under — `local:<uuid>`, opaque here,
 * resolvable only on the device that took it. What stays server-side is the sticker row and
 * its placement, because the calendar has to know a sticker sits on that day even from a
 * phone that cannot draw it (that device renders the placeholder face).
 *
 * The handle is validated for SHAPE, not for existence: nothing on this side can check a
 * store it cannot read, and a bad string would only ever render as a missing photo on the
 * one device that owns it. The regex is what keeps it from becoming a free-text field that
 * later gets interpolated somewhere as a URL.
 */
const LOCAL_REF = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

stickersRoutes.post("/kids/:id/photo-sticker", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  if (!child || !(await familyForSubject(c, child.family_id))) return c.json({ error: "child_not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const ref = String(body.localRef ?? "");
  if (!LOCAL_REF.test(ref)) return c.json({ error: "bad_local_ref" }, 400);
  const sticker = stickersRepo.createPhotoSticker(child.id, ref);
  return c.json({ sticker: stickerView(sticker) }, 201);
});
