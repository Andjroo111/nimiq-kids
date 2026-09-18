// nimiq.kids kid app v3 — HOME IS THE CHART. "Today big + week behind": the
// current week's sticker grid (rows = routines/chores/lessons, columns Mon..Sun,
// cells = the stickers the kid placed) sits one glance above today's big task
// cards, each with its own sticker slot. Money recedes to a header chip; the
// Treasure Box, studio trio and money screen live in the dock.

import {
  state, $, esc, t, toast, setScreen, bgFor, fmtNimLuna, fmtFiat, parentName,
  identiconImg, paintIdenticons,
  rowTitle,
} from "./util.js";
import { api } from "./api.js";
import { queueTap, applyQueuedTaps, flushOutbox } from "./outbox.js";
import { offlineNote } from "./offline-note.js";
import { queuedCount } from "./outbox.js";
import { icon, arrowIcon, caretIcon, checkIcon, closeIcon, maskIcon, waitIcon, chevronIcon } from "./icons.js";
import { refreshChart, refreshGoalSets, refreshWallet, refreshStore, loadEntry } from "./data.js";
// ⚠️ `stickerNode` was MISSING here and it is a bare identifier, so a board carrying any
// placed sticker threw ReferenceError out of the whole of showChart (#408). Only visible
// once a kid had actually put a sticker on a job, which is why it survived on main.
import { stickerNode, openStickerPicker, explainRetry } from "./stickers.js";
import { calendarHtml, wireCalendar, toggleCalendar } from "./calendar.js";
import { openAddJob } from "./addjob.js";
import { openDoneSheet } from "./done.js";
// The job card's own two pieces, and the two axes that are NOT today. Both were carved out of
// this file at the 800-line guard; upkeep.js takes `repaint` rather than importing back.
import { jobIcon, nimPill } from "./card.js";
// `setGroup` is NOT imported here any more (#400): a set a kid can collect is a wish, not a
// thing to do today, and it lives on its own shelf in the Treasure Box now. See box.js.
import { practiceGroup, goalGroup, onPracticeTap, onGoalTap } from "./upkeep.js";
import { showLogin } from "./main.js";
import { enterTimer } from "./flow.js";
import { lockBanner, wireLockBanner, lockTitleKey } from "./locked.js";
import { openMeSheet } from "./me.js";
import { showSceneCoachIfArmed } from "./coach.js";
import { showWaiting, nimCelebration } from "./waiting.js";
import { showEggTimer } from "./eggtimer.js";
import { showGames } from "./games.js";
import { showMoney } from "./money.js";
import { showBox, boxBadgeCount } from "./box.js";
// `cardState` lives with the notice built on it: the notice is a fourth reader of the same
// rule the ring, the tap and the sticker read, and it must not be a second copy of it.
import { cardState, runFinishable, announceApprovals, markApprovalsSeen } from "./approved.js";

let pollTimer = 0;
export function stopChartPoll() { clearInterval(pollTimer); pollTimer = 0; }

const onChart = () => !!document.querySelector(".k-chart");

// ---------- today, grouped by time of day ----------
//
// Andjroo: separate into morning / afternoon / evening / any time, and let a kid
// tap a group open or closed. Collapsed groups are also what finally gives the
// scene room to show through -- four headers instead of seven cards.
//
// The slot comes from the routine (schema: routines.slot); chores and lessons
// have no time of day, so they land in "any time".
const SLOTS = [
  { key: "morning", label: "app.kidMorning" },
  { key: "afternoon", label: "app.kidAfternoon" },
  { key: "evening", label: "app.kidEvening" },
  { key: "anytime", label: "app.kidAnytime" },
];
const slotOf = (tk) => {
  const s = String(tk.slot ?? "").toLowerCase();
  return s === "morning" || s === "afternoon" || s === "evening" ? s : "anytime";
};

/** Which group opens by default: the one matching the time of day, so a kid
 *  lands on what they are meant to be doing now. */
function defaultOpenSlot() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
const OPEN_KEY = "kid.openSlots";
function openSlots(present) {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
    if (Array.isArray(saved)) return new Set(saved);
  } catch { /* first run */ }
  const want = defaultOpenSlot();
  return new Set([present.includes(want) ? want : present[0]].filter(Boolean));
}
function persistOpen(set) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...set])); } catch { /* private mode */ }
}

/** Off the kid's plate for the group's count. A job sent back is not. */
const isCounted = (st) => st === "waiting" || st === "reward" || st === "done";

/** Every group on Today: the parts of the day that have something in them, then
 *  Practice, then Goals last. Open state is resolved ONCE across the whole set,
 *  so the time-of-day default can't be beaten to it by either of the tail two.
 *
 *  The order is how time-bound each one is. A time of day is now, a practice is
 *  this week, and a ladder is however long it takes. */
function todayGroups(tasks, practices, goals) {
  const bySlot = new Map(SLOTS.map((s) => [s.key, []]));
  for (const tk of tasks) bySlot.get(slotOf(tk)).push(tk);
  const present = SLOTS.filter((s) => bySlot.get(s.key).length);
  const practice = practiceGroup(practices);
  const goalsGrp = goalGroup(goals);
  const open = openSlots([
    ...present.map((s) => s.key),
    ...(practice ? ["practice"] : []),
    ...(goalsGrp ? ["goals"] : []),
  ]);
  const groups = present.map((s) => {
    const items = bySlot.get(s.key);
    // States are resolved HERE, against the whole day, because a routine task's
    // state depends on its siblings (see cardState) and a card cannot see them.
    const states = items.map((tk) => cardState(tk, tasks));
    return {
      ...s, items, open: open.has(s.key), total: items.length,
      done: states.filter(isCounted).length,
      cards: items.map((tk, i) => taskCard(tk, states[i])),
      // The whole day, because `runFinishable` asks about a RUN and a run's steps can be
      // split across time-of-day groups, exactly as cardState's siblings are.
      allTasks: tasks,
    };
  });
  if (practice) groups.push({ ...practice, open: open.has("practice") });
  if (goalsGrp) groups.push({ ...goalsGrp, open: open.has("goals") });
  return groups;
}

function groupSection(g) {
  const allDone = g.done === g.total;
  // A time-of-day group counts what is left TODAY, so "1/3" is the whole story.
  // A practice group cannot: nothing is owed today, so a bare "0/2" would read
  // as two jobs missed on a day the kid may have done both. It shows the tick
  // when every practice has hit its target and stays quiet otherwise — the
  // cards' own "3 of 4 this week" is the real status.
  const count = g.quiet ? (allDone ? checkIcon() : "") : (allDone ? checkIcon() : `${g.done}/${g.total}`);
  return `
    <section class="ch-group ${g.open ? "is-open" : ""} ${allDone ? "is-alldone" : ""}">
      <button class="ch-group-hd" data-group="${g.key}" aria-expanded="${g.open}">
        <span class="ch-group-name">${esc(t(g.label))}</span>
        <span class="ch-group-count">${count}</span>
        <span class="ch-group-chev">${chevronIcon()}</span>
      </button>
      <div class="ch-tasks">${g.cards.join("")}${finishRunHtml(g)}</div>
    </section>`;
}

/**
 * THE WAY OUT OF A DAY WITH A BONUS LEFT IN IT (#341, #342).
 *
 * Once every required step is done the server deliberately stops submitting the run, so the
 * kid can still take the side quest. Which means that without this button a child who simply
 * does not want to put the dishes away has done every job they were asked to do and can never
 * be paid for any of them: the run sits in_progress, and no grown-up is ever asked.
 *
 * It is the chest of `docs/SPEC-quest-map.md`, drawn as a button because the trail it belongs
 * on does not exist yet (#343, #344). Those replace how this is DRAWN. The rule under it,
 * `runFinishable`, is the same one either way.
 */
function finishRunHtml(g) {
  const runIds = [...new Set((g.items ?? [])
    .filter((tk) => tk.kind === "task" && runFinishable(g.allTasks ?? [], tk.runId))
    .map((tk) => tk.runId))];
  return runIds.map((runId) => `<button class="ch-finish" data-finish="${esc(runId)}">
      <span class="ch-finish-main">
        <span class="ch-finish-title">${esc(t("app.questFinishDay"))}</span>
        <span class="ch-finish-sub">${esc(t("app.questBonusLeft"))}</span>
      </span>
      <span class="ch-finish-mark">${checkIcon()}</span>
    </button>`).join("");
}

// ---------- today ----------
// The card is the job's NAME and what it pays, and nothing else. The egg timer
// used to sit beside the reward; it said the same thing the timer screen says a
// second later, and next to a big title plus a coin figure it was the third
// thing competing on one line (Andjroo, 2026-07-30). The duration still drives
// the timer when the task starts — it just is not printed here.

/** The sticker circle, in the four looks cardState names.
 *
 *  It used to render ONLY once the job was done, on the reasoning that an empty
 *  dashed ring is an invitation and an invitation you cannot accept is just 16px
 *  of dead card. That held while the only way to finish a job was the timer
 *  screen. It is now the other way round (Andjroo, 2026-07-31): the ring IS the
 *  button, so it is there from the start, and the invitation is honest because
 *  pressing it opens the sheet that eventually fills it.
 *
 *  The `waiting` look is what pays for the rule that the sticker waits for the
 *  parent. Without it, "I handed it in" and "I have not started" would be the
 *  same empty ring, and the kid would keep re-answering a job already gone. */
function slotHtml(tk, st) {
  const key = tk.kind === "task" ? `task:${tk.taskRunId}` : `chore:${tk.choreId}`;
  // A placement that EXISTS always renders, whatever the card's state says. Two
  // of them are not "done": a sent-back job wears its sticker greyed and
  // wobbling (.stk-retry), and rows written before the sticker moved behind
  // approval are still sitting in the wild carrying state 'pending'. Keying the
  // sticker off the state instead of off the data hid both behind an hourglass.
  if (tk.placement) {
    return `<span class="ch-slot filled" data-slot="${key}">${stickerNode(tk.placement, "stk-slot")}</span>`;
  }
  const inner = st === "waiting" ? waitIcon("ch-slot-wait") : "";
  return `<span class="ch-slot is-${st}" data-slot="${key}">
    <span class="ch-slot-empty"></span>${inner}
  </span>`;
}

function taskCard(tk, st) {
  const key = tk.kind === "task" ? tk.taskRunId : tk.choreId;
  const rm = st === "open" ? removeBtn(tk) : "";
  // The X overlays the card, so the two need a positioned wrapper around them.
  return `
  <span class="ch-row ${rm ? "has-x" : ""}">
    <!-- data-state, not a class: .ch-practice already ships its own .is-done and
         a state class would inherit whatever that one grows. -->
    <button class="ch-task" data-state="${st}" data-tk="${esc(key)}">
      ${jobIcon(tk)}
      <span class="ch-task-main">
        <span class="ch-task-title">${esc(rowTitle(tk))}</span>
        <span class="ch-task-meta">${
  // Once a grown-up has ruled, the pill is what the job PAID, not what it advertised (#369).
  // Null until then, so an open job still shows its promise. See settledView, routes/stickers.
  nimPill(tk.settled?.paidLuna ?? tk.rewardLuna)}${
  // A side quest says so on the card (#342). Without this the kid has no way to tell the
  // step they have to do from the one that just pays extra, and the difference is the
  // entire feature.
  tk.optional ? `<span class="ch-bonus-tag">${t("app.questBonusTag")}</span>` : ""}</span>
      </span>
      ${slotHtml(tk, st)}
    </button>${rm}
  </span>`;
}

/** Take a job off the board. Only on an OPEN chore, and only while the family's
 *  switch allows it — a job already handed in is the parent's to resolve. */
function removeBtn(tk) {
  if (tk.kind === "task" || tk.status !== "open") return "";
  if (state.family && !state.family.kids_can_remove) return "";
  return `<button class="ch-task-x" data-rm="${esc(tk.choreId)}"
    aria-label="${esc(t("app.kidRemoveJob"))}">${closeIcon()}</button>`;
}

/* THE APP SHELF IS GONE FROM THE BOARD (2026-09-01, #398), AND SO IS THE CARD BEFORE IT.
 *
 * The shelf put five app icons plus a "more" tile on home. It cost ~190px of an 1116px tablet
 * column, and on a 6-week calendar that column was already over budget before Today got a pixel
 * (#401). Worse, it was the ONLY route to the games grid, which is the screen Andjroo's son
 * could not find.
 *
 * Games is a DOCK destination now. Same three facts the shelf carried, all of them on one
 * button: it is always there, it says how many minutes are left, and locked it greys and says
 * to finish the jobs first. What it stops doing is naming the individual apps on the board,
 * which is the games grid's job and is where a kid goes to pick one anyway.
 */
// ---------- dock ----------
// FIVE destinations, each a place a kid can name: the Box, their week, their
// timer, their games, their money. The four customization sheets that used to sit
// here (hatch / style / sounds / background) are all ways to dress up the timer, so
// they moved behind the Timer entry, which is the built timer's own bottom tray now.
//
// THE TIMER IS BACK IN THE DOCK (Andjroo, 2026-09-17: "move the timer that's in the
// games page ... back onto the main navigation bar"). #398 had folded it into the games
// grid as a Tools tile to make room for Games, and a kid hunting for the hourglass
// found a page of app icons instead. Games did not lose its slot: the bar is five wide
// when the wrapper has something to launch, four when it has not. Every route into a
// TIMED JOB (a job card, a routine step) still goes through flow.js and is untouched.
//
// All four glyphs come from ONE generated sheet (assets/icons/*.png, drawn as
// masks) rather than four separately-authored SVGs. That is the point: the old
// row mixed three hand-drawn outlines with one filled duotone, four drawing
// hands and two visual languages, and no kid could name any of them. Replacing
// any single one means regenerating the sheet, not drawing a fifth thing.
// Each glyph now carries its word. The dock was the last bare icon row in the
// app -- the money screen's own bar has labelled Receive and Send all along --
// and no kid could name the four pictures, which is the whole complaint a nicer
// drawing does not answer.
//
// The word replaces the discs rather than sitting under them: a 46px pill plus
// a line of type is 30px of bar, and the selected state does not need a filled
// circle once there is a word to colour. So `is-on` is blue type + blue glyph,
// the standard bar idiom, and the bar grows 74 -> 92px (18px off Today's scroll).
//
// The labels are their own short keys, not the aria names they replace:
// "Treasure box" and "My timer" title their screens, but four of those side by
// side at 320 is a row of ellipses. And with a visible word the aria-label goes
// -- an accessible name that differs from the label a kid reads out is the
// label-in-name failure, so the text IS the name now.
function dock() {
  const badge = boxBadgeCount();
  const games = gamesDockState();
  const btn = (id, glyph, key, cls = "", extra = "", pill = "") => `
      <button class="ch-dock-btn ${cls}" id="dock-${id}"${extra}>
        ${maskIcon(glyph)}${id === "box" && badge > 0 ? `<i class="ch-badge" aria-hidden="true">${badge}</i>` : ""}${pill}
        <span class="ch-dock-lbl">${esc(t(key))}</span>
      </button>`;
  return `
    <footer class="k-dock ch-dock">
      ${btn("box", "box", "app.kidDockBox", "ch-dock-box")}
      ${btn("chart", "week", "app.kidDockWeek", "is-on", ' aria-current="page"')}
      ${btn("timer", "timer", "app.kidDockTimer")}
      ${games.present
        ? btn("games", "games", "app.kidDockGames", `ch-dock-games ${games.locked ? "is-shut" : ""}`)
        : ""}
      ${btn("money", "money", "app.kidDockMoney", "ch-dock-money")}
    </footer>`;
}

/**
 * What the Games button knows, or that there is no such button.
 *
 * ⚠️ `present` is FALSE in a plain browser and on a household that has allowlisted nothing —
 * the same two gates the shelf bailed on (`!lock || !apps.length`). There is nothing to launch
 * there, and a dock button that opens an empty grid is worse than one that is not offered. The
 * Timer does not depend on it either way: `dock-timer` is drawn on every board, so a browser,
 * the judge demo and every existing test find it exactly where it has always been.
 *
 * ⚠️ The minutes pill only ever draws a number the wrapper actually gave us. An unmetered kid
 * has no budget, so there is no number, and inventing one would be a lie — the same rule
 * `statusText()` held on the shelf.
 */
function gamesDockState() {
  const lock = state.kioskLock;
  const installed = state.kiosk?.listInstalledApps?.() ?? [];
  const present = !!lock && Array.isArray(installed) && !!lock.allowedApps?.length;
  const locked = lock?.mode !== "unlocked";
  const mins = !locked && typeof lock?.remainingSec === "number"
    ? Math.floor(lock.remainingSec / 60) : null;
  // `mins` is still computed and still in chartFingerprint(): the shelf and the lock banner
  // print it. The dock button does NOT wear it any more (Andjroo, 2026-09-15: "remove the time
  // from games"); the "120m" pill was the one thing on the bar that was not a button.
  return { present, locked, mins };
}

// ---------- the screen ----------
/**
 * The kid's own NIM, on the first screen they see (#118).
 *
 * This is the one number that separates nimiq.kids from every chore-sticker app, and it had
 * no pixels anywhere on the home screen: a judge tapping the demo's primary button landed on
 * a name, a calendar and a to-do list. The value was already fetched and already drove
 * repaints — `chartFingerprint()` has read `state.wallet?.balanceLuna` all along — it was
 * simply never rendered.
 *
 * NOTHING when the wallet has not been read. Not "0 NIM": a kid holding 36,004 NIM being
 * told they have nothing is worse than a chip that arrives a moment late, and this is the
 * same rule the parent app's family wallet already follows. The chip is in the fingerprint,
 * so the paint that lands the wallet also lands the chip.
 *
 * A BUTTON, not a label. It is the shortest route to Money, which is where the number leads.
 *
 * A CARD, no longer a chip in the header row (Andjroo, 2026-08-02: "I like having it largely
 * displayed ... but we could do this a little bit better"). As a third pill between the kid's
 * name and the language flag it wore the same white pill as both of them, so the one number
 * that separates this app from every chore-sticker app read as chrome. Worse, it was boxed
 * in: the header keeps a lane clear for the corner control, which capped the chip at 46% of
 * the width, and a six-figure balance was ellipsing before it was ever big.
 *
 * Off the row it is only competing with itself, so the number can be the size it deserves and
 * the label can say whose money it is. The shape is the money screen's own account card,
 * which is where tapping this leads -- the two screens now open on the same object.
 */
function balanceCard() {
  const luna = state.wallet?.balanceLuna;
  if (typeof luna !== "number") return "";
  return `
    <button class="ch-money" id="ch-balance" aria-label="${esc(t("app.kidDockMoney"))}">
      <span class="ch-money-txt">
        <span class="ch-money-lbl">${esc(t("app.kidMoney"))}</span>
        <span class="ch-money-nim">${fmtNimLuna(luna)}<i>NIM</i></span>
        <span class="ch-money-fiat">${esc(fmtFiat(luna))}</span>
      </span>
      ${caretIcon()}
    </button>`;
}

export function showChart() {
  lastPaint = chartFingerprint();
  const kid = state.child;
  if (!kid) return showLogin();
  const chart = state.chart ?? { days: [], rows: [], todayTasks: [], today: "" };
  const bg = bgFor();
  const tasks = chart.todayTasks ?? [];
  const practices = chart.practices ?? [];
  const goals = chart.goals ?? [];
  const groups = todayGroups(tasks, practices, goals);

  setScreen(`
    <div class="k-chart">
      <!-- WHO I AM, on the corner control's line and OUTSIDE the slab. Sam is chrome that
           floats over the board (--lift-6, the one rung the slab does not override), and the
           top padding of .k-chart is what puts this pill on the same centre line as the fixed
           battery. Inside the slab it would ride the slab's top edge instead. -->
      <header class="ch-hd">
        <button class="ch-kid" id="switch-kid">
          ${identiconImg(state.wallet?.address ?? state.addresses[kid.id] ?? "")}
          <span class="ch-kid-name">${esc(kid.label)}</span>
        </button>
      </header>
      <!-- THE SLAB (Andjroo, 2026-09-10). ONE container behind the whole board carries the
           weight, and every card on it drops two rungs (scene.css). .ch-slab adds only what
           is the BOARD'S: its gap, and the two-column grid it takes over in landscape. -->
      <div class="k-slab ch-slab">
        <!-- WHAT I HAVE AND MY WEEK: the at-a-glance half of the board.
             display:contents in portrait, so all three sit in the slab's own column
             exactly as they always have — same order, same single gap between them.
             Turned sideways this becomes the narrow left column and Today takes the
             full height of the right one (css/landscape.css). -->
        <div class="ch-aside">
          ${offlineNote(chart)}
          ${lockBanner()}
          ${balanceCard()}
          ${calendarHtml(chart)}
        </div>
        <section class="ch-today">
          <h2 class="ch-sec-hd">${esc(t("app.kidToday"))}</h2>
          <div class="ch-groups">${groups.length
            ? groups.map(groupSection).join("")
            : `<div class="ch-empty">${icon("high-five", "ch-empty-ic")}<p>${esc(t("app.kidAllDoneToday"))}</p></div>`}
            <button class="ch-add" id="add-job">${esc(t("app.kidAddJob"))}</button></div>
        </section>
      </div>
      ${dock()}
    </div>`, "k-screen chart-screen", bg);

  paintIdenticons();
  wireCalendar();
  wireLockBanner();
  // The name pill is the ONE place that is about the kid: who they are, and
  // what their app looks like. Switching kid moved inside it rather than
  // being the whole button, because the scene needed a home that was not the
  // Timer and this is the only control on the screen that is already "me".
  $("switch-kid").onclick = () => openMeSheet(() => showChart());
  // The one-time pointer at that pill (#407). It only draws for a kid the character picker
  // armed, and it spends the flag on the draw, so a repaint two seconds later gets nothing.
  showSceneCoachIfArmed(kid.id, $("switch-kid"));
  $("dock-box").onclick = () => { stopChartPoll(); showBox(); };
  $("dock-chart").onclick = toggleCalendar;
  // Andjroo, 2026-07-31: this used to open three glyphs and no timer. It opens the
  // built timer now — the three pickers survive as that timer's own bottom tray.
  $("dock-timer").onclick = () => { stopChartPoll(); showEggTimer(showChart); };
  $("dock-money").onclick = () => { stopChartPoll(); showMoney(); };
  // The chip goes where the number leads, same as the dock button.
  $("ch-balance")?.addEventListener("click", () => { stopChartPoll(); showMoney(); });
  // A LOCKED GAMES BUTTON STILL ANSWERS THE TAP. The alternative, a dead control, is read by a
  // four-year-old as the tablet being broken rather than as a rule. The routine lock is also the
  // only locked state that still shows the board at all (locked.js sends bedtime, a spent budget
  // and a grounding to a full-screen lock), so this sentence is always about jobs and always true.
  $("dock-games")?.addEventListener("click", () => {
    // A spent budget, bedtime or a rest is not "finish your jobs first": say which lock it is.
    if (gamesDockState().locked) return toast(t(lockTitleKey() ?? "app.kidShelfDoJobs"));
    stopChartPoll();
    showGames(showChart, refreshChart);
  });
  document.querySelectorAll("[data-group]").forEach((b) => {
    b.onclick = () => {
      const sec = b.closest(".ch-group");
      const now = sec.classList.toggle("is-open");
      b.setAttribute("aria-expanded", String(now));
      const open = new Set([...document.querySelectorAll(".ch-group.is-open [data-group]")]
        .map((el) => el.dataset.group));
      persistOpen(open);
      lastPaint = chartFingerprint(); // a collapse is not a data change
    };
  });
  document.querySelectorAll("[data-tk]").forEach((b) => {
    b.onclick = () => onTaskTap(b.dataset.tk);
  });
  document.querySelectorAll("[data-finish]").forEach((b) => {
    b.onclick = () => endRun(b.dataset.finish);
  });
  document.querySelectorAll("[data-pr]").forEach((b) => {
    b.onclick = () => onPracticeTap(b.dataset.pr, repaintChart);
  });
  document.querySelectorAll("[data-goal]").forEach((b) => {
    b.onclick = () => onGoalTap(b.dataset.goal, repaintChart, showChart);
  });
  $("add-job") && ($("add-job").onclick = () => openAddJob(async () => {
    await refreshChart();
    if (onChart()) showChart();
  }));
  document.querySelectorAll("[data-rm]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const res = await api.removeChore(b.dataset.rm).catch(() => null);
      if (res?.error) return toast(t("app.errGeneric"));
      await refreshChart();
      if (onChart()) showChart();
      toast(t("app.kidJobRemoved"));
    };
  });
  startChartPoll();
  // LAST, and on every paint rather than only from the poll: a kid whose app was closed when
  // the yes arrived hears about it the moment they open it, and one whose app was open hears
  // about it on the repaint the poll already does. It says nothing when nothing is new.
  announceApprovals((target) => openStickerPicker(target, repaintChart));
}

/**
 * The kid ends their own day, leaving whatever bonus they did not want (#341).
 *
 * The SAME route a redo after a reject uses, because they are the same act: the kid saying
 * they are finished with this run. The server writes the untaken side quest to 'passed' and
 * opens the approval, so from here on it is the ordinary waiting screen, which is why this
 * lands there exactly like the last task of a routine does.
 */
async function endRun(runId) {
  const res = await api.resubmitRun(runId).catch(() => null);
  if (!res || res.error) return toast(t("app.errGeneric"));
  await refreshChart();
  const entry = state.chart?.todayTasks?.find((x) => x.kind === "task" && x.runId === runId);
  if (entry) {
    const day = await loadEntry(entry.routineId).catch(() => null);
    if (day) { stopChartPoll(); return showWaiting(day); }
  }
  if (onChart()) showChart();
}

/** One tap, one state, one answer — the same five cardState names the ring wears. */
async function onTaskTap(key) {
  const all = state.chart?.todayTasks ?? [];
  const tk = all.find((x) => (x.kind === "task" ? x.taskRunId : x.choreId) === key);
  if (!tk) return;
  const isTask = tk.kind === "task";
  const st = cardState(tk, all);

  // Sent back: explain in the parent's voice + resubmit (the kid fixed it).
  if (st === "retry") {
    explainRetry();
    // NOT QUEUED, and deliberately. A redo after a rejection is a conversation with the
    // parent that has already started; putting it in the outbox would hand the grown-up a
    // second ask hours later with no idea which of the two they are answering. So it is the
    // one tap that waits for a real connection, and says so.
    try {
      if (isTask) await api.resubmitRun(tk.runId);
      else await api.submitChore(tk.choreId);
    } catch {
      return toast(t("app.kidNeedsInternet"));
    }
    await refreshChart();
    if (onChart()) showChart();
    return;
  }

  // Still the kid's to do: ASK. This is the tap that used to launch the timer.
  if (st === "open") return askIfDone(tk);

  if (st === "waiting") {
    // A whole routine that has landed has a screen of its own — the photo proof
    // and the on-tablet PIN live there, so it still owns that moment.
    if (isTask && tk.runStatus === "done_pending") {
      // ⚠️ `loadEntry` is a live GET /routines/:id/today and it THROWS with no network, out of
      // an onclick, taking the tap with it. Offline the honest answer is the toast below.
      const entry = await loadEntry(tk.routineId).catch(() => null);
      if (!entry) return toast(t("app.kidWaiting", { name: parentName() }));
      stopChartPoll();
      return showWaiting(entry);
    }
    if (!isTask && await approveOwnChoreOnDemo(tk)) return;
    // ⚠️ A finished step in a run that is still FINISHABLE is not waiting on anybody: no
    // grown-up has been asked yet, because the run holds open for the side quest (#341).
    // Saying "Waiting for Mom" here would be a straight lie, and the kid would sit waiting
    // for an answer to a question nobody was sent. Tapping ends the day instead.
    if (isTask && runFinishable(all, tk.runId)) return endRun(tk.runId);
    return toast(t("app.kidWaiting", { name: parentName() }));
  }

  // Approved and no sticker yet: THIS is where the sticker moment happens now.
  if (st === "reward") {
    const target = isTask ? { kind: "task", id: tk.taskRunId } : { kind: "chore", id: tk.choreId };
    return openStickerPicker(target, repaintChart);
  }
  toast(t("app.allDone"));
}

/**
 * On a DEMO household only: tapping a submitted chore approves it and lands the NIM (#117).
 *
 * This is where a judge's first action used to die. The seed plants one submitted chore per
 * kid *precisely* so a visitor can approve a payout and watch NIM land, and the tap fell
 * through to "Waiting for Mom" — so the money, which is the entire pitch, never landed
 * unless the visitor went back to the landing page and opened the parent door instead.
 *
 * A routine that has landed already does exactly this (waiting.js): on a demo household
 * there is no PIN and no second person, the visitor is playing both parts, so a keypad
 * asking for a code nobody gave them is the dead end. Chores now take the same path.
 *
 * TWO GATES, and the client one is never the only one.
 *   1. `state.family?.demo_at` here, matching waiting.js line for line.
 *   2. `parentAuth` on the server, which clears only demo households and is the real lock.
 * On a real family this returns false, nothing is called, and the branch falls through to
 * the toast exactly as before. A child on a real household cannot approve their own payout
 * by reaching this code, because the server refuses it.
 *
 * Returns true if it handled the tap.
 */
async function approveOwnChoreOnDemo(tk) {
  if (!state.family?.demo_at || !tk.choreId) return false;
  const pending = await api.choreApproval(tk.choreId).catch(() => null);
  if (!pending?.approvalId) return false;      // already approved, or none open: fall through
  const res = await api.approve(pending.approvalId).catch(() => ({}));
  if (res?.paidLuna === undefined) return false;
  stopChartPoll();
  await Promise.all([refreshWallet(), refreshChart()]);
  // The kid caused this one and is about to watch it pay out (#323): bank it as told before
  // the celebration, or the notice fires on top of the moment it exists to replace.
  markApprovalsSeen();
  nimCelebration(res.paidLuna, res.txHash, openEarnedStickerOrChart);
  return true;
}

/**
 * Where a DEMO self-approval goes after the money lands: into the sticker it just earned.
 *
 * The approval and the sticker are two halves of one moment and the app used to hand back only
 * the first. A kid tapped "Mom is here", watched the NIM arrive, and was returned to the chart
 * with their sticker sitting behind a second tap on the same card that nothing had told them to
 * make. Andjroo hit exactly this on the live demo: "they don't actually get to use them because
 * it says waiting on a parent."
 *
 * It reads the state the ring already reads rather than remembering which chore was approved.
 * `cardState -> "reward"` IS "approved and no sticker yet", so this cannot disagree with the
 * card the kid is looking at, and it does the right thing for a routine, where one approval
 * turns several cards green at once and the first is as good a place to start as any. The rest
 * stay collectable by tapping them, exactly as before.
 *
 * Falls back to the chart when there is nothing to place, which is the shipped behaviour: a
 * household with the sticker moment already spent must not open an empty sheet.
 */
function openEarnedStickerOrChart() {
  const all = state.chart?.todayTasks ?? [];
  const earned = all.find((tk) => cardState(tk, all) === "reward");
  if (!earned) return showChart();
  showChart(); // the sheet opens OVER the chart, so the chart has to be the screen behind it
  openStickerPicker(
    earned.kind === "task" ? { kind: "task", id: earned.taskRunId } : { kind: "chore", id: earned.choreId },
    repaintChart,
  );
}
export { openEarnedStickerOrChart };

/** "Is it done?" — the sheet that replaced the straight-to-timer tap.
 *
 *  Yes hands the job to the parent through the route that already existed for
 *  it, and STOPS there. The sticker is not offered here (Andjroo, 2026-07-31:
 *  it lands only once the parent has said yes) — the ring goes to its waiting
 *  look, and the picker opens from that same ring when the card turns `reward`.
 *  "Not yet" closes and changes nothing, which is why the sheet needs no answer
 *  from this function at all. */
function askIfDone(tk) {
  const isTask = tk.kind === "task";
  openDoneSheet(tk, {
    async onYes() {
      // The SAME calls the timer's own finish makes — /done opens the routine_run
      // approval once the run's last task lands, /submit opens the chore's.
      //
      // ⚠️ THE CATCH IS THE OFFLINE BRANCH, and it used to be `.catch(() => ({}))`: the POST
      // threw, an empty object came back, the board repainted from unchanged state and the
      // ring went back to grey. The kid had done the job and told the tablet, and nothing
      // anywhere remembered it. A thrown fetch is now the signal to write the tap down.
      let res = {};
      try {
        res = isTask ? await api.doneTask(tk.taskRunId) : await api.submitChore(tk.choreId);
      } catch {
        queueTap(tk, state.child?.id);
        applyQueuedTaps();   // paint it now; refreshChart below re-applies it over the snapshot
        toast(t("app.kidSavedOffline", { name: parentName() }));
      }
      await refreshChart();
      // Last task of the routine: the waiting screen is where the photo proof
      // and the on-tablet PIN live, so it still owns that moment.
      if (res.runCompleted) { stopChartPoll(); return showWaiting(await loadEntry(tk.routineId)); }
      if (onChart()) showChart();
    },
    // ⚠️ The CARD goes through, not a routine. This used to load the routine entry
    // here and hand the flow a taskRunId, which a chore card has neither of — so a
    // timed chore offered the button and then threw on the way in. Which kind of job
    // it is, and what a clock means for that kind, is flow.js's to know.
    onTimer() {
      stopChartPoll();
      enterTimer(tk);
    },
  });
}

/** Pull the board again and redraw it, if the kid is still looking at it.
 *
 *  ONE function, passed to everything that can change what the board says: the sticker
 *  picker's onPlaced, and now the practice and goal taps in upkeep.js. Handing it out is
 *  what lets those move to their own file without importing showChart back from here. */
async function repaintChart() {
  await Promise.all([refreshChart(), refreshGoalSets()]);
  if (onChart()) showChart();
}

/** What the chart screen actually renders. A poll that repaints regardless
 *  tears down the DOM under a child who is mid-tap and (before setScreen was
 *  fixed) threw away their scroll position, on a 10-second timer, whether or
 *  not anything changed. Repaint only when this fingerprint moves. */
function chartFingerprint() {
  const c = state.chart ?? {};
  // NOT the whole chart object: it carries serverTime, which moves on every
  // fetch and would make the fingerprint differ forever. Only what renders.
  return JSON.stringify([
    c.today, c.days, c.rows, c.todayTasks, c.practices,
    // The goals too: a rung the parent approves while the board is open moves that ladder's
    // card (climbed count, the next rung's state) and nothing else in this list changes with
    // it, so the poll compared two equal strings and the card sat stale until something
    // unrelated repainted (2026-09-18).
    c.goals,
    state.wallet?.balanceLuna ?? 0, boxBadgeCount(),
    // The offline line is part of what the board says, so losing or regaining the network
    // has to repaint it. Without this the poll compares two identical payloads, decides
    // nothing moved, and leaves "no internet" on screen after the tablet is back on Wi-Fi.
    state.offline, queuedCount(state.child?.id),
    // The whole lock state, not just its mode: the shelf prints the minutes left, and a
    // budget ticking down from 18 to 4 while the board is open is a change the kid can see.
    state.kioskLock?.mode ?? null, state.kioskLock?.reason ?? null,
    Math.floor((state.kioskLock?.remainingSec ?? 0) / 60),
    (state.kioskLock?.allowedApps ?? []).join(","),
  ]);
}
let lastPaint = "";

/** True when it is safe AND worth repainting: still on the chart, no sheet or
 *  placement layer owning the screen, and the payload really moved. */
function shouldRepaintChart() {
  if (!onChart()) return false;
  if (document.querySelector(".place-layer") || document.querySelector(".kid-scrim.show")) return false;
  const fp = chartFingerprint();
  if (fp === lastPaint) return false;
  lastPaint = fp;
  return true;
}

function startChartPoll() {
  stopChartPoll();
  pollTimer = setInterval(async () => {
    // ⚠️ THE FLUSH RUNS BEFORE THE `document.hidden` GUARD, and that is deliberate.
    //
    // Measured on Leo's tablet 2026-09-11: after `KEYCODE_WAKEUP` the kiosk WebView still
    // reported `visibilityState: "hidden"`, because the screen comes back on a lock screen and
    // nothing is visible until somebody touches it. A queue that waits for visibility is a
    // queue that waits for a child to pick the tablet up, when the thing it is waiting for is
    // the house Wi-Fi coming back into range in a bag.
    //
    // It costs one localStorage read on every tick with nothing queued, which is the normal
    // case, so the battery guard below still does its job for the two network reads.
    if (queuedCount()) await flushOutbox();
    if (document.hidden || !onChart()) return;
    // FLUSH FIRST, THEN READ. The other order repaints the board from a server that has not
    // been told about the taps yet, so every queued card blinks back to open for ten seconds.
    await flushOutbox();
    await Promise.all([refreshChart(), refreshWallet(), refreshStore()]);
    if (shouldRepaintChart()) showChart();
  }, 10_000);
}

document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !onChart()) return;
  await flushOutbox();
  await Promise.all([refreshChart(), refreshWallet()]);
  if (shouldRepaintChart()) showChart();
});
