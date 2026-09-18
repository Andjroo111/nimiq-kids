// nimiq.kids parent — THE BOARD: the screen where a parent finally adds and changes
// the work itself (#84).
//
// Until this existed, `/parent/` could approve work, fund the wallet and stock the
// Treasure Box, and a parent could not put a single job on their own kid's board. The
// only surfaces that ever created one were the kid's own "Add a job" sheet, the seeder,
// and a raw API call. The server side was already complete; this is the missing half.
//
// Four decisions run through the whole screen, and each answers one of the issue's own
// open questions:
//
//  · PER KID, and reached from the kid, not from a tab. A board belongs to a child the
//    same way a balance does, so it hangs off the per-kid page exactly as the Treasure
//    Box hangs off Settings. The tab bar is chrome and stays four wide.
//  · ONE screen for all FOUR shapes. Jobs, routines, practices and goals are four different
//    rows in four different tables, but to the parent they are one question: what does
//    this kid do? Four navigation targets for one mental model is the split that would
//    have to be justified, not the join. It is also how the kid's own Today screen
//    groups them. (Goals' own section lives in views-board-goals.js -- the 800-line guard,
//    not a second screen.)
//  · A TILE BEATS TYPING. Every name field here sits under the shared job picker
//    (public/js/lib/job-picker.js), so the ordinary path posts `catalogId` and the row
//    is stored with a `title_key` that reads in the kid's language forever. Typed words
//    are first class and stay in the language they were typed in, on purpose
//    (src/title-catalog.ts). This is the same picker the kid's sheet uses; a second copy
//    would drift.
//  · NOTHING IS DELETED. A job comes off the board and can be put back; a routine or a
//    practice is retired and stays here, greyed, with a way back. The same rule the
//    Treasure Box manager runs on, and the reason the GET calls below ask for the
//    inactive rows the kid's tablet never sees.

import { rowTitle, state, t, views, call, render, toast, openSheet, closeSheet, go, $ } from "./core.js";
import { icon } from "./icons.js";
import { esc, fmtNim, LUNA } from "./fmt.js";
import { jobCatalog, jobPickerHtml, wireJobPicker } from "/js/lib/job-picker.js";
import { canManageBoard } from "./grownups.js";
import { goalsCards, wireGoals } from "./views-board-goals.js";
import { lockLines, wireLocks } from "./views-board-locks.js";
import { sheetPracticeStep } from "./views-board-practice-step.js";
import { probeDevices } from "./views-manage.js";

const SLOTS = [
  ["morning", "papp.boardMorning"],
  ["afternoon", "papp.boardAfternoon"],
  ["evening", "papp.boardEvening"],
  ["custom", "papp.boardAnytime"],
];
const slotLabel = (slot) => t(SLOTS.find(([s]) => s === slot)?.[1] ?? "papp.boardAnytime");

export const nimLabel = (luna) => `${fmtNim(luna)} NIM`;
const mins = (s) => Math.max(1, Math.round((s ?? 0) / 60));

/** The catalog, fetched once and reused by every sheet on this screen. */
let groups = [];
/** ...including the sheets in views-board-goals.js. A GETTER, not the binding: `groups` is
 *  filled by the first loadBoard(), and an importer holding the empty array it was at module
 *  load would render a picker with no tiles for the rest of the session. */
export const jobGroups = () => groups;

/* THE SAME FACE THE KID SEES.
   Every job on a kid's tablet wears drawn art (public/assets/icons/*.png, the locked
   Higgsfield house style in src/task-icons.ts); this screen was drawing the raw emoji,
   so one job looked like two different jobs on two screens in the same house. That is
   the exact bug the Treasure Box hit with pack art (#34), and the fix is the same: draw
   what the kid draws.
   The map is built from `GET /api/task-icons`, the server's OWN table, rather than a
   second copy of the emoji-to-id mapping over here. A second copy is a thing that
   drifts, and the kid's Add-a-job sheet already reads this endpoint. */
let iconByEmoji = new Map();
const bareEmoji = (e) => String(e ?? "").replace(/️/g, "");

/** The drawn icon's url for an emoji, or null when nobody has drawn that one. */
export const faceUrl = (emoji) => iconByEmoji.get(bareEmoji(emoji)) ?? null;

/** A row's face: the drawn icon when one exists, otherwise the emoji itself. Nobody has
 *  drawn every emoji a parent can type, and an emoji is a perfectly good fallback. */
export function face(row, fallback = "🧽") {
  const url = iconByEmoji.get(bareEmoji(row?.emoji));
  return url
    ? `<img class="bd-face" src="${esc(url)}" alt="" draggable="false" />`
    : `<span class="bd-emoji" aria-hidden="true">${esc(row?.emoji ?? fallback)}</span>`;
}

// ---- loading -----------------------------------------------------------------
//
// Four reads, one paint. `includeInactive=1` is what makes retiring reversible: the
// kid's tablet asks for neither retired routines nor hidden practices, and the server
// only honours the flag for a parent bearer token (routes/routines.ts).

export async function loadBoard(kidId) {
  const q = `childId=${encodeURIComponent(kidId)}`;
  const [ch, rm, ro, pr, gl, cat, art] = await Promise.all([
    call("GET", `/api/chores?${q}`).catch(() => null),
    call("GET", `/api/chores/removed?${q}`).catch(() => null),
    call("GET", `/api/routines?${q}&includeInactive=1`).catch(() => null),
    call("GET", `/api/practices?${q}&includeInactive=1`).catch(() => null),
    call("GET", `/api/goals?${q}&includeInactive=1`).catch(() => null),
    groups.length ? null : jobCatalog().catch(() => ({ groups: [] })),
    iconByEmoji.size ? null : fetch("/api/task-icons").then((r) => r.json()).catch(() => null),
  ]);
  if (cat) groups = cat.groups ?? [];
  // `faces` (2026-09-18) is the picker's list plus the routine headers and the goal, step and
  // savings defaults; an older server answers with `icons` alone and the map is just shorter.
  const faces = art?.faces ?? art?.icons;
  if (faces) iconByEmoji = new Map(faces.map((i) => [bareEmoji(i.emoji), i.url]));
  // Not awaited and not in the Promise.all above: the schedule section reads better with the
  // answer, and must not wait for it to draw the work this screen is actually for. It repaints
  // itself when the probe lands, and does nothing at all if it has already run this session.
  probeDevices();
  state.board = {
    kidId,
    // A failed read is an EMPTY section, never a missing one: a parent who cannot see
    // their jobs must still be able to see that jobs are a thing this screen has.
    chores: ch?.status === 200 ? ch.data.chores ?? [] : [],
    removed: rm?.status === 200 ? rm.data.chores ?? [] : [],
    routines: ro?.status === 200 ? ro.data.routines ?? [] : [],
    practices: pr?.status === 200 ? pr.data.practices ?? [] : [],
    goals: gl?.status === 200 ? gl.data.goals ?? [] : [],
    error: !ch || ch.status !== 200,
  };
  if (state.tab === "home" && state.boardOpen) render();
}

/** One outcome path for every write on this screen: close, say so, reload. */
export async function finish(r, okStatus, msg) {
  const ok = Array.isArray(okStatus) ? okStatus.includes(r?.status) : r?.status === okStatus;
  if (!ok) {
    document.querySelectorAll(".sheet .pill-btn").forEach((b) => { b.disabled = false; });
    toast(errorFor(r), "error");
    return false;
  }
  closeSheet();
  if (msg) toast(msg, "success");
  await loadBoard(state.board.kidId);
  return true;
}

/* Every refusal this screen can hear, in words a parent can act on. "That didn't go
   through" for `already_started` would be actively wrong: nothing failed, the kid
   already sent the job in and the reward is now what approval will pay. */
function errorFor(r) {
  const kid = state.overview?.children.find((k) => k.id === state.board?.kidId);
  switch (r?.data?.error) {
    case "already_started": return t("papp.boardStarted", { name: kid?.label ?? "" });
    case "reward_required": return t("papp.boardRewardNeeded");
    case "duration_required": return t("papp.boardMinutesNeeded");
    case "title_required": return t("papp.boxNameNeeded");
    case "invalid_video_url": return t("papp.boardVideoBad");
    case "budget_exhausted": return t("papp.boardNoBudget");
    case "day_awaiting_approval": return t("papp.boardPracticeFrozen");
    case "rung_awaiting_approval": return t("papp.boardGoalFrozen");
    // The tablet drew a rung as open that the server does not: a stale poll, or a sibling
    // got there first. Never a failed save, so it must not read as one.
    case "rung_not_open": return t("papp.boardRungNotOpen");
    // A lock window that already exists, and a routine with no room for another. Both are
    // 409s where nothing failed, so neither may read as a save that did not go through.
    case "duplicate_window": return t("papp.lockDuplicate");
    case "too_many_windows": return t("papp.lockTooMany");
    default: return t("papp.couldntSave");
  }
}

// ---- the screen ---------------------------------------------------------------

views.board = (el) => {
  const kid = state.overview.children.find((k) => k.id === state.kidId);
  if (!kid) { go("home"); return; }
  const b = state.board;
  if (!b || b.kidId !== kid.id) {
    el.innerHTML = `<div class="card pstate"><h3>${t("papp.loading")}</h3></div>`;
    loadBoard(kid.id);
    return;
  }

  el.innerHTML = `
    <div class="kid-top"><button class="back-btn" id="bd-back">${icon("chevron-left", 16)} ${esc(kid.label)}</button></div>
    <div class="set-hint bx-intro">${t("papp.boardIntro")}</div>
    ${jobsCard(b)}
    ${routinesCards(b)}
    ${practicesCard(b)}
    ${goalsCards(b)}`;

  $("bd-back").onclick = () => { state.boardOpen = false; go("home", kid.id); };

  el.querySelectorAll("[data-job]").forEach((n) => (n.onclick = () =>
    sheetJob(b.chores.find((c) => c.id === n.dataset.job))));
  el.querySelector("#bd-add-job")?.addEventListener("click", () => sheetJob(null));
  el.querySelectorAll("[data-again]").forEach((n) => (n.onclick = () =>
    sheetJob(null, b.chores.find((c) => c.id === n.dataset.again))));
  el.querySelectorAll("[data-restore]").forEach((n) => (n.onclick = () => restoreJob(n.dataset.restore)));

  el.querySelectorAll("[data-routine]").forEach((n) => (n.onclick = () =>
    sheetRoutine(b.routines.find((r) => r.id === n.dataset.routine))));
  el.querySelector("#bd-add-routine")?.addEventListener("click", () => sheetRoutine(null));
  el.querySelectorAll("[data-addstep]").forEach((n) => (n.onclick = () =>
    sheetStep(b.routines.find((r) => r.id === n.dataset.addstep), null)));
  el.querySelectorAll("[data-step]").forEach((n) => (n.onclick = () => {
    const routine = b.routines.find((r) => r.id === n.dataset.inroutine);
    sheetStep(routine, routine?.tasks.find((tk) => tk.id === n.dataset.step));
  }));

  el.querySelectorAll("[data-practice]").forEach((n) => (n.onclick = () =>
    sheetPractice(b.practices.find((p) => p.id === n.dataset.practice))));
  el.querySelector("#bd-add-practice")?.addEventListener("click", () => sheetPractice(null));
  el.querySelectorAll("[data-addpstep]").forEach((n) => (n.onclick = () =>
    sheetPracticeStep(b.practices.find((p) => p.id === n.dataset.addpstep), null)));
  el.querySelectorAll("[data-pstep]").forEach((n) => (n.onclick = () => {
    const practice = b.practices.find((p) => p.id === n.dataset.inpractice);
    sheetPracticeStep(practice, practice?.steps.find((s) => s.id === n.dataset.pstep));
  }));

  wireGoals(el, b);
  wireLocks(el, b);
};

// ---- jobs ---------------------------------------------------------------------

/* A job is editable only while it is still `open`, and that is a money rule rather than
   a UI one: approval pays `reward_luna` as it reads it at approval time, so a reward
   that could change after a kid submitted would change what they get paid for work they
   already did. The row still shows; it just stops offering the button. */
/** A job that is over: approved, claimed, or turned down. NOT `submitted`, which is still
 *  in flight and belongs to the approvals queue, and NOT `open`, which is still to do. */
const isFinished = (c) => c.status !== "open" && c.status !== "submitted";

function jobRow(c) {
  const open = c.status === "open";
  // Day 1 a family gets three sample jobs. The kid does them, the parent approves, and on
  // day 2 the board is a list of padlocks with nothing to do — and the only way to refill
  // it was opening this sheet and retyping each job. That is the loudest week-two failure
  // in the app. Offering the restart HERE, on the job that just finished, is what makes it
  // stick; an empty create screen the next morning is a different and much worse ask.
  const action = open
    ? `<button class="pill-btn ghost sm" data-job="${esc(c.id)}">${t("papp.boxEdit")}</button>`
    : isFinished(c)
      ? `<button class="pill-btn ghost sm" data-again="${esc(c.id)}">${t("papp.boardAgain")}</button>`
      : `<span class="bx-row-lock">${icon("locked-lock", 13)}</span>`;
  return `<div class="bx-row-p ${open ? "" : "is-off"}">
    ${face(c)}
    <div class="bx-row-main">
      <div class="bx-row-title">${esc(rowTitle(c))}</div>
      <div class="bx-row-sub">${nimLabel(c.reward_luna)}${
        c.status === "submitted" ? ` &middot; ${t("papp.boardWaiting")}` : ""}</div>
    </div>
    ${action}
  </div>`;
}

function jobsCard(b) {
  const rows = b.chores.length
    ? b.chores.map(jobRow).join("")
    : `<div class="set-hint bx-empty">${t("papp.boardNoJobs")}</div>`;
  // Removed jobs are the trail, not clutter: a kid taking their own laundry off the
  // board is something a parent is meant to see, and put back.
  const off = b.removed.length
    ? `<div class="bd-sub-hd">${t("papp.boardOff")}</div>${b.removed.map((c) => `
        <div class="bx-row-p is-off">
          ${face(c)}
          <div class="bx-row-main">
            <div class="bx-row-title">${esc(rowTitle(c))}</div>
            <div class="bx-row-sub">${t("papp.boardOffBy", {
              who: c.removed_by === "kid" ? t("papp.boardByKid") : t("papp.boardByParent"),
            })}</div>
          </div>
          <button class="pill-btn ghost sm" data-restore="${esc(c.id)}">${t("papp.boardRestore")}</button>
        </div>`).join("")}`
    : "";
  // A grey section label, the same one the routines and practices sections use. The
  // three sections are peers, so they get one heading treatment; an icon + h3 inside
  // the card for two of them and a label above the third read as three unrelated
  // screens stacked. (It also retires a `duotone-medal` that is the Treasure Box's
  // mark, and which degrades into a bar chart at 24px.)
  return `<div class="sec-label bd-sec">${t("papp.boardJobs")}</div>
  <div class="card set-card">
    ${rows}${off}
    <button class="pill-btn ghost wide" id="bd-add-job">${t("papp.boardAddJob")}</button>
  </div>`;
}

async function restoreJob(id) {
  const r = await call("POST", `/api/chores/${id}/restore`, {}).catch(() => null);
  if (r?.status !== 200) { toast(errorFor(r), "error"); return; }
  toast(t("papp.boardJobBack"), "success");
  await loadBoard(state.board.kidId);
}

/**
 * The job sheet, in three modes.
 *
 *   sheetJob(chore)        edit that job in place        PATCH
 *   sheetJob(null)         a job from scratch            POST
 *   sheetJob(null, done)   the SAME job again            POST, prefilled from `done`
 *
 * The third is "Add it again" (#128), and it is deliberately a prefilled sheet rather than
 * a one-tap create. Nothing is created without a parent tapping Save, which keeps this out
 * of the money question entirely: the new job lands `open` and still has to be submitted,
 * approved and paid exactly like one typed by hand. A recurrence that generated chores on
 * its own would need a fresh approval per instance and its own payout ref; this needs
 * neither, because it is one parent making one job.
 */
function sheetJob(chore, again = null) {
  const isNew = !chore;
  const src = chore ?? again;               // what fills the fields
  // A copied job keeps its catalog id, so the copy keeps its translation key. Without it a
  // re-added "Brush your teeth" is stored as English prose and comes back English on the
  // tablet while the phone is in Spanish. The picker owns the id from here, so a parent who
  // edits the prefilled title clears it by the rule that already exists.
  const fromCatalog = again?.title_key?.startsWith("cat.job.")
    ? again.title_key.slice("cat.job.".length) : null;
  openSheet(`
    <h2>${again ? t("papp.boardAgainTitle") : isNew ? t("papp.boardNewJob") : t("papp.boardEditJob")}</h2>
    ${jobPickerHtml({ t, groups })}
    <input class="nq-input" id="bd-title" maxlength="40" autocomplete="off"
      placeholder="${esc(t("papp.boardJobName"))}" value="${esc(src?.title ?? "")}" />
    ${rewardField(src?.reward_luna)}
    <div class="btn-row bd-actions">
      ${isNew ? "" : `<button class="pill-btn ghost" id="bd-remove">${t("papp.boardRemove")}</button>`}
      <button class="pill-btn blue" id="bd-save">${t("papp.save")}</button>
    </div>`);
  const picker = wireJobPicker({ titleInput: $("bd-title"), initialId: fromCatalog });
  wireReward();

  $("bd-save").onclick = async () => {
    const catalogId = picker.catalogId();
    const title = $("bd-title").value.trim();
    if (!title && !catalogId) { toast(t("papp.boxNameNeeded"), "error"); return; }
    const rewardLuna = rewardLunaValue();
    // The server refuses a parent's job worth nothing too; saying so before the round
    // trip is the difference between a hint and an error.
    if (!rewardLuna && (isNew || chore.created_by !== "kid")) {
      toast(t("papp.boardRewardNeeded"), "error"); return;
    }
    $("bd-save").disabled = true;
    // The REWARD is copied as the frozen NIM the parent already agreed to, not re-priced
    // from today's dollars. A kid who earned 18,001 NIM for walking the dog last week and
    // 16,400 this week has been given a reason to ask why, and the answer is a rate they
    // cannot see. The field shows what it is worth today as it sits there, so a parent who
    // wants to re-price can, in the same tap.
    //
    // Duration and kind ride along unedited. This sheet has never shown either, so a copy
    // that dropped them would quietly turn a 3-minute timed job into an untimed one and a
    // lesson into a chore.
    const carried = again
      ? {
          ...(again.duration_s ? { durationS: again.duration_s } : {}),
          ...(again.kind && again.kind !== "chore" ? { kind: again.kind } : {}),
          ...(again.subject ? { subject: again.subject } : {}),
          ...(again.reward_shape ? { rewardShape: again.reward_shape } : {}),
          ...(!catalogId && again.emoji ? { emoji: again.emoji } : {}),
        }
      : {};
    const body = { title, rewardLuna, ...carried, ...(catalogId ? { catalogId } : {}) };
    const r = isNew
      ? await call("POST", "/api/chores", { childId: state.board.kidId, ...body }).catch(() => null)
      : await call("PATCH", `/api/chores/${chore.id}`, body).catch(() => null);
    await finish(r, isNew ? 201 : 200, isNew ? t("papp.boardJobAdded") : t("papp.saved"));
  };

  $("bd-remove")?.addEventListener("click", async () => {
    $("bd-remove").disabled = true;
    const r = await call("POST", `/api/chores/${chore.id}/remove`, {}).catch(() => null);
    await finish(r, 200, t("papp.boardJobOff"));
  });
}

// ---- routines -----------------------------------------------------------------

/* A routine is a card of its own rather than a row in a list, because it CONTAINS
   things: the steps are the point, and a step that only appears after a tap would hide
   the one thing a parent came here to change. Same shape as a Treasure Box shelf. */
function routinesCards(b) {
  const cards = b.routines.map((r) => {
    const steps = r.tasks?.length
      ? r.tasks.map((tk) => `
        <div class="bx-row-p">
          ${face(tk, "🪥")}
          <div class="bx-row-main">
            <div class="bx-row-title">${esc(rowTitle(tk))}</div>
            <div class="bx-row-sub">${t("papp.boardMinShort", { min: mins(tk.duration_s) })}${
              tk.reward_luna > 0 ? ` &middot; ${nimLabel(tk.reward_luna)}` : ""}</div>
          </div>
          <button class="pill-btn ghost sm" data-step="${esc(tk.id)}" data-inroutine="${esc(r.id)}">${t("papp.boxEdit")}</button>
        </div>`).join("")
      : `<div class="set-hint bx-empty">${t("papp.boardNoSteps")}</div>`;
    return `<div class="card set-card ${r.active ? "" : "is-off"}">
      <div class="bx-shelf-hd-p">
        ${face(r, "🌅")}
        <h3>${esc(rowTitle(r))}</h3>
        <div class="bx-shelf-tools">
          <button class="pill-btn ghost sm" data-routine="${esc(r.id)}">${t("papp.boxEdit")}</button>
        </div>
      </div>
      <div class="set-hint">${slotLabel(r.slot)}${r.active ? "" : ` &middot; ${t("papp.boardRetired")}`}</div>
      ${steps}
      <button class="pill-btn ghost wide" data-addstep="${esc(r.id)}">${t("papp.boardAddStep")}</button>
      ${lockLines(r)}
    </div>`;
  }).join("");
  return `<div class="sec-label bd-sec">${t("papp.boardRoutines")}</div>
    ${cards || `<div class="card set-card"><div class="set-hint">${t("papp.boardNoRoutines")}</div></div>`}
    <button class="pill-btn ghost wide" id="bd-add-routine">${t("papp.boardAddRoutine")}</button>`;
}

function sheetRoutine(routine) {
  const isNew = !routine;
  const slot = routine?.slot ?? "morning";
  openSheet(`
    <h2>${isNew ? t("papp.boardNewRoutine") : t("papp.boardEditRoutine")}</h2>
    <input class="nq-input" id="bd-title" maxlength="40" autocomplete="off"
      placeholder="${esc(t("papp.boardRoutineName"))}" value="${esc(routine?.title ?? "")}" />
    <div class="set-hint">${t("papp.boardWhen")}</div>
    <div class="app-toggle bx-kind bd-slots">
      ${SLOTS.map(([s, key]) => `<button class="pill-btn ghost sm ${s === slot ? "on" : ""}"
        data-slot="${s}" aria-pressed="${s === slot}">${t(key)}</button>`).join("")}
    </div>
    <div class="btn-row bd-actions">
      ${isNew ? "" : `<button class="pill-btn ghost" id="bd-retire">${
        routine.active ? t("papp.boardRetire") : t("papp.boxShow")}</button>`}
      <button class="pill-btn blue" id="bd-save">${t("papp.save")}</button>
    </div>
    ${isNew ? "" : `<div class="set-hint">${t("papp.boardRetireNote")}</div>`}`);

  let picked = slot;
  document.querySelectorAll("[data-slot]").forEach((btn) => (btn.onclick = () => {
    picked = btn.dataset.slot;
    document.querySelectorAll("[data-slot]").forEach((o) => {
      o.classList.toggle("on", o === btn);
      o.setAttribute("aria-pressed", String(o === btn));
    });
  }));

  $("bd-save").onclick = async () => {
    const title = $("bd-title").value.trim();
    if (!title) { toast(t("papp.boxNameNeeded"), "error"); return; }
    $("bd-save").disabled = true;
    const r = isNew
      ? await call("POST", "/api/routines", { childId: state.board.kidId, title, slot: picked }).catch(() => null)
      : await call("PATCH", `/api/routines/${routine.id}`, { title, slot: picked }).catch(() => null);
    await finish(r, isNew ? 201 : 200, t("papp.saved"));
  };

  $("bd-retire")?.addEventListener("click", async () => {
    $("bd-retire").disabled = true;
    const r = await call("PATCH", `/api/routines/${routine.id}`, { active: !routine.active }).catch(() => null);
    await finish(r, 200, t("papp.saved"));
  });
}

/* A step always has a timer. `durationS` is required by the server and the egg timer is
   what a routine step IS on the kid's tablet, so minutes is a field here, not an option. */
function sheetStep(routine, task) {
  if (!routine) return;
  const isNew = !task;
  openSheet(`
    <h2>${isNew ? t("papp.boardNewStep") : t("papp.boardEditStep")}</h2>
    ${jobPickerHtml({ t, groups })}
    <input class="nq-input" id="bd-title" maxlength="40" autocomplete="off"
      placeholder="${esc(t("papp.boardStepName"))}" value="${esc(task?.title ?? "")}" />
    <div class="set-hint">${t("papp.boardMinutes")}</div>
    <input class="nq-input" id="bd-mins" type="number" inputmode="numeric" min="1" max="120" step="1"
      placeholder="5" value="${task ? mins(task.duration_s) : ""}" />
    ${rewardField(task?.reward_luna, true)}
    ${extraCreditField(task)}
    <div class="btn-row bd-actions">
      ${isNew ? "" : `<button class="pill-btn ghost" id="bd-remove">${t("papp.boardRemoveStep")}</button>`}
      <button class="pill-btn blue" id="bd-save">${t("papp.save")}</button>
    </div>`);
  const picker = wireJobPicker({ titleInput: $("bd-title") });
  wireReward();
  const extraCredit = wireExtraCredit();

  $("bd-save").onclick = async () => {
    const catalogId = picker.catalogId();
    const title = $("bd-title").value.trim();
    if (!title && !catalogId) { toast(t("papp.boxNameNeeded"), "error"); return; }
    const minutes = Math.round(Number($("bd-mins").value));
    if (!Number.isFinite(minutes) || minutes < 1) { toast(t("papp.boardMinutesNeeded"), "error"); return; }
    $("bd-save").disabled = true;
    const body = {
      title, durationS: minutes * 60, rewardLuna: rewardLunaValue(),
      optional: extraCredit.value(),
      ...(catalogId ? { catalogId } : {}),
    };
    const r = isNew
      ? await call("POST", `/api/routines/${routine.id}/tasks`, body).catch(() => null)
      : await call("PATCH", `/api/routines/${routine.id}/tasks/${task.id}`, body).catch(() => null);
    await finish(r, isNew ? 201 : 200, t("papp.saved"));
  };

  // A step is retired the way everything else here is: `active: false`, so the runs and
  // sticker placements pointing at it stay readable.
  $("bd-remove")?.addEventListener("click", async () => {
    $("bd-remove").disabled = true;
    const r = await call("PATCH", `/api/routines/${routine.id}/tasks/${task.id}`, { active: false }).catch(() => null);
    await finish(r, 200, t("papp.saved"));
  });
}

// ---- practices ----------------------------------------------------------------

/* A practice is a ROW until it has exercises, and a CARD once it does — the same split a
   routine already makes, for the same reason: a card is what holds things, and a list of
   exercises hidden behind a tap is the one thing a parent came to this screen to change.
   Most practices stay rows. "Read for 20 minutes" is not three exercises and should not be
   made to look like it is. */
/** Where the week stands, plus "retired" when it is. One definition, two layouts. */
const practiceWeek = (p) => `${t("papp.boardThisWeek", { done: p.weekDone, target: p.targetPerWeek })}${
  p.active ? "" : ` &middot; ${t("papp.boardRetired")}`}`;

/** What a whole day of it pays. `fullDayLuna`, never `rewardLuna` — this states a standing
 *  price, and rewardLuna is what TODAY pays once the kid has ticked their exercises. */
const practicePrice = (p) => t("papp.boardPracticeEachDay", {
  amount: `${Math.round(p.fullDayLuna / LUNA)} ${t("papp.boardRewardNim")}`,
});

function practiceLines(p) {
  // What it pays, on the row as well as in the sheet: a promise nobody opens the sheet to
  // read is still a promise that was made.
  return `<div class="bx-row-sub">${practiceWeek(p)}</div>${
    p.fullDayLuna > 0 ? `<div class="bx-row-sub">${practicePrice(p)}</div>` : ""}`;
}

function practiceRow(p) {
  return `<div class="bx-row-p ${p.active ? "" : "is-off"}">
    ${face(p, "🎹")}
    <div class="bx-row-main">
      <div class="bx-row-title">${esc(rowTitle(p))}</div>
      ${practiceLines(p)}
    </div>
    <button class="pill-btn ghost sm" data-practice="${esc(p.id)}">${t("papp.boxEdit")}</button>
  </div>`;
}

function practiceStepsCard(p) {
  const steps = p.steps.map((s) => `
    <div class="bx-row-p">
      ${face(s, "🎵")}
      <div class="bx-row-main">
        <div class="bx-row-title">${esc(rowTitle(s))}</div>
        <div class="bx-row-sub">${s.rewardLuna > 0 ? nimLabel(s.rewardLuna) : t("papp.boardPaysNothing")}</div>
        ${s.how ? `<div class="bx-row-sub">${esc(s.how)}</div>` : ""}
        ${/* Two different facts wear the same column. A same-origin path is a clip THIS
              instance serves, and the kid's own card plays it, so the parent is told that
              rather than offered a link they do not need. Anything with a host on it is on
              the open web, reachable from this phone and from nowhere on the tablet, so it
              stays a link. `rel` because that target is somebody else's site. */""}
        ${s.videoUrl
          ? (s.videoUrl.startsWith("/") && !s.videoUrl.startsWith("//")
            ? `<div class="bx-row-sub">${t("papp.boardClipOnCard")}</div>`
            : `<a class="bx-row-sub bd-video-link" href="${esc(s.videoUrl)}"
                 target="_blank" rel="noopener noreferrer">${t("papp.boardWatch")}</a>`)
          : ""}
      </div>
      <button class="pill-btn ghost sm" data-pstep="${esc(s.id)}" data-inpractice="${esc(p.id)}">${t("papp.boxEdit")}</button>
    </div>`).join("");
  return `<div class="card set-card ${p.active ? "" : "is-off"}">
    <div class="bx-shelf-hd-p">
      ${face(p, "🎹")}
      <h3>${esc(rowTitle(p))}</h3>
      <div class="bx-shelf-tools">
        <button class="pill-btn ghost sm" data-practice="${esc(p.id)}">${t("papp.boxEdit")}</button>
      </div>
    </div>
    <div class="set-hint">${practiceWeek(p)} &middot; ${practicePrice(p)}</div>
    ${steps}
    <button class="pill-btn ghost wide" data-addpstep="${esc(p.id)}">${t("papp.boardAddExercise")}</button>
  </div>`;
}

function practicesCard(b) {
  const stepped = b.practices.filter((p) => p.steps?.length);
  const plain = b.practices.filter((p) => !p.steps?.length);
  const rows = plain.length
    ? plain.map(practiceRow).join("")
    : (stepped.length ? "" : `<div class="set-hint bx-empty">${t("papp.boardNoPractices")}</div>`);
  return `<div class="sec-label bd-sec">${t("papp.boardPractices")}</div>
  ${stepped.map(practiceStepsCard).join("")}
  <div class="card set-card">
    ${rows}
    <button class="pill-btn ghost wide" id="bd-add-practice">${t("papp.boardAddPractice")}</button>
  </div>`;
}

function sheetPractice(practice) {
  const isNew = !practice;
  const target = practice?.targetPerWeek ?? 3;
  // ONE PRICE, ONE HOME. Once a practice has exercises the day is the sum of them, and the
  // practice's own reward is never read again — so the field goes, rather than sitting there
  // holding a number that decides nothing. (A price stored in two places is #288's bug, where
  // a pack displayed one figure and charged another for weeks without failing.)
  const stepped = !!practice?.steps?.length;
  openSheet(`
    <h2>${isNew ? t("papp.boardNewPractice") : t("papp.boardEditPractice")}</h2>
    ${jobPickerHtml({ t, groups })}
    <input class="nq-input" id="bd-title" maxlength="40" autocomplete="off"
      placeholder="${esc(t("papp.boardPracticeName"))}" value="${esc(practice?.title ?? "")}" />
    <div class="set-hint">${t("papp.boardTarget")}</div>
    <div class="bd-days">
      ${[1, 2, 3, 4, 5, 6, 7].map((n) => `<button class="bd-day ${n === target ? "on" : ""}"
        data-days="${n}" aria-pressed="${n === target}">${n}</button>`).join("")}
    </div>
    ${stepped
      ? `<div class="set-hint">${t("papp.boardReward")}</div>
         <div class="bd-row-static">${esc(practicePrice(practice))}</div>
         <div class="set-hint">${t("papp.boardPricedByExercises")}</div>`
      : `${rewardField(practice?.rewardLuna, true)}
         <div class="set-hint">${t("papp.boardPracticeEarns")}</div>`}
    <div class="btn-row bd-actions">
      ${isNew ? "" : `<button class="pill-btn ghost" id="bd-hide">${
        practice.active ? t("papp.boxHide") : t("papp.boxShow")}</button>`}
      <button class="pill-btn blue" id="bd-save">${t("papp.save")}</button>
    </div>
    ${isNew || stepped ? "" : `<button class="pill-btn ghost wide" id="bd-split">${
      t("papp.boardAddExercise")}</button>
      <div class="set-hint">${t("papp.boardSplitHint")}</div>`}`);
  const picker = wireJobPicker({ titleInput: $("bd-title") });
  if (!stepped) wireReward();
  // Breaking a practice into exercises starts here, on the practice it belongs to, so the
  // first one lands with a parent who is already looking at what the whole day pays.
  $("bd-split")?.addEventListener("click", () => sheetPracticeStep(practice, null));

  let days = target;
  document.querySelectorAll("[data-days]").forEach((btn) => (btn.onclick = () => {
    days = Number(btn.dataset.days);
    document.querySelectorAll("[data-days]").forEach((o) => {
      o.classList.toggle("on", o === btn);
      o.setAttribute("aria-pressed", String(o === btn));
    });
  }));

  $("bd-save").onclick = async () => {
    const catalogId = picker.catalogId();
    const title = $("bd-title").value.trim();
    if (!title && !catalogId) { toast(t("papp.boxNameNeeded"), "error"); return; }
    $("bd-save").disabled = true;
    // A practice pays per DAY it is done, and an empty field means it pays nothing —
    // deliberately allowed, because a habit worth keeping up is not always a habit worth
    // paying for. The server refuses a change to this number while a day of it is already
    // waiting in the queue; `errorFor` turns that into the sentence that says so.
    //
    // ⚠️ A STEPPED PRACTICE SENDS NO `rewardLuna` AT ALL. There is no field to read, so
    // `rewardLunaValue()` would answer 0 — a number the server would see as a real change,
    // demand the PIN for, and refuse outright while a day sat in the queue. Renaming a
    // practice would have started failing for a reason that had nothing to do with the name.
    const body = {
      title, targetPerWeek: days, ...(stepped ? {} : { rewardLuna: rewardLunaValue() }),
      ...(catalogId ? { catalogId } : {}),
    };
    const r = isNew
      ? await call("POST", "/api/practices", { childId: state.board.kidId, ...body }).catch(() => null)
      : await call("PUT", `/api/practices/${practice.id}`, body).catch(() => null);
    await finish(r, isNew ? 201 : 200, t("papp.saved"));
  };

  $("bd-hide")?.addEventListener("click", async () => {
    $("bd-hide").disabled = true;
    const r = await call("PUT", `/api/practices/${practice.id}`, { active: !practice.active }).catch(() => null);
    await finish(r, 200, t("papp.saved"));
  });
}

// ---- the reward field, shared by the job and routine-task sheets ----------------
//
// Whole NIM in, luna out, with what it is actually worth shown underneath as it is
// typed. "900 NIM" means nothing on its own to a parent deciding what a job is worth,
// which is the same reason the kid's own sheet prints the fiat under the number.

export function rewardField(rewardLuna, optional = false) {
  const nim = rewardLuna ? Math.round(rewardLuna / LUNA) : "";
  return `<div class="set-hint">${t("papp.boardReward")}</div>
    <div class="bd-amt-row">
      <input class="nq-input" id="bd-nim" type="number" inputmode="numeric" min="0" step="1"
        placeholder="${optional ? "0" : "100"}" value="${nim}" />
      <span class="bd-amt-unit">${t("papp.boardRewardNim")}</span>
    </div>
    <div class="set-hint" id="bd-worth"></div>`;
}

export const rewardLunaValue = () => {
  const nim = Math.round(Number($("bd-nim")?.value));
  return Number.isFinite(nim) && nim > 0 ? nim * LUNA : 0;
};

/**
 * EXTRA CREDIT (#342): the one control that says a step is a side quest.
 *
 * The word on it is deliberately not "optional". A parent reads that as "not required", which
 * is right, but the kid reads the same word on their own tablet as "does not matter", which is
 * the opposite of a bonus worth doing. "Extra credit" carries the reward in the name.
 *
 * The sub-line is the part that stops it being a mystery switch: what it actually changes is
 * that the day finishes without it, and that is a sentence, not a label.
 *
 * A pressed button rather than a checkbox, matching the day circles in views-board-locks.js.
 * This app has no checkbox anywhere and one control style beats two.
 */
export function extraCreditField(task) {
  const on = !!task?.optional;
  return `<button type="button" class="bd-toggle ${on ? "on" : ""}" id="bd-optional" aria-pressed="${on}">
      <span class="bd-toggle-main">
        <span class="bd-toggle-title">${t("papp.boardExtraCredit")}</span>
        <span class="bd-toggle-sub">${t("papp.boardExtraCreditSub")}</span>
      </span>
      <span class="bd-toggle-dot" aria-hidden="true"></span>
    </button>`;
}

/** Returns a reader rather than a value, because the sheet is read at SAVE, not at open. */
export function wireExtraCredit() {
  const btn = $("bd-optional");
  if (btn) {
    btn.onclick = () => {
      const next = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(next));
      btn.classList.toggle("on", next);
    };
  }
  return { value: () => btn?.getAttribute("aria-pressed") === "true" };
}

export function wireReward() {
  const show = () => {
    const nim = Math.round(Number($("bd-nim").value));
    $("bd-worth").textContent = Number.isFinite(nim) && nim > 0
      ? t("papp.boxWorth", { amount: `$${(nim * (state.rates?.nimUsd ?? 0)).toFixed(2)}` })
      : "";
  };
  $("bd-nim").oninput = show;
  show();
}

// ---- the entry point on the per-kid page ---------------------------------------

/* Built from the roster's own row vocabulary (hex-tile / row-main / chev), the same as
   the "Give ... some NIM" row it sits beside, so it reads as another thing you can tap
   here rather than a new kind of card. */
export function boardRow(kid) {
  // A SUPPORTER never sees this door. Everything behind it (create a job, price it, retire a
  // routine) answers 403 for them, and a row that opens a screen where every button fails is
  // worse than one that was never offered. The server gate is the real fence; this is manners.
  if (!canManageBoard()) return "";
  const label = t("papp.boardRow");
  const sub = t("papp.boardRowSub", { name: esc(kid.label) });
  return `<div class="group"><button class="row" id="go-board">
    <span class="hex-tile">${icon("balance", 22)}</span>
    <span class="row-main">
      <span class="row-label" title="${esc(label)}">${label}</span>
      <span class="row-sub" title="${esc(sub)}">${sub}</span>
    </span>
    <span class="chev">${icon("chevron-right", 14)}</span>
  </button></div>`;
}

export function wireBoardRow(el, kid) {
  el.querySelector("#go-board")?.addEventListener("click", () => {
    state.boardOpen = true;
    // A different kid's board must not paint with the last kid's rows for a frame.
    if (state.board?.kidId !== kid.id) state.board = null;
    go("home", kid.id);
  });
}
