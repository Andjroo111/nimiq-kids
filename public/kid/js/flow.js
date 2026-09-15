// nimiq.kids kid app — the timed-task flow, v3: a TOOL inside tasks, not the
// app's face. Entered from a chart today-card where the task has a duration.
// One task at a time: title up top, the kid's TIMER RIG center-stage (egg by
// default; Sticker Maker / Polaroid once bought in the Treasure Box and equipped
// in the studio), m:ss + shrinking bar, one giant Start button. On completion the
// rig's payoff fires, the task is marked done, and the flow hands back to the
// chart. The STICKER no longer follows from here: it waits for the parent's yes
// and is collected from the card's own ring (chart.js cardState -> "reward").

import { createCountdown, computeRemaining } from "./timer.js";
import { celebrate } from "/js/lib/confetti.js";
import { api } from "./api.js";
import {
  state, $, esc, t, setScreen, bgFor, fmtClock, pickSurprise, emojiSurprise,
  unlockAudio, playAlarm, startMusic, stopMusic,
  rowTitle,
} from "./util.js";
import { arrowIcon, checkIcon, playIcon } from "./icons.js";
import { refreshChart, loadEntry } from "./data.js";
import { showChart, stopChartPoll } from "./chart.js";
import { openStickerPrePick } from "./stickers.js";
import { isLocalPhotoRef, localPhotoUrls, resolveLocalPhoto } from "/js/lib/local-photos.js";
import { showWaiting } from "./waiting.js";
import { showJobTimer } from "./eggtimer.js";

// ---------- timer-style rigs ----------
// One row per style: kid_prefs.timer_style_id -> lazy rig module (only the
// equipped rig ever loads). All rigs expose the SAME API:
//   { setProgress(0..1), hatch({imageUrl,onDone}), reset(), wobble(), destroy() }
// Future styles arrive as Treasure Box items: seed a 'timer_style' store item
// whose payload.styleId matches a new row here — no other flow changes.
// NO `egg` ENTRY, and its absence is the point. The egg a kid actually meets is
// `/kid/timer/` — the rig signed off over several sessions, with the locked faces, the
// locked break and the character standing ABOVE the shells — hosted whole by
// `showJobTimer` (./eggtimer.js). `js/egg.js` was an older in-app rig whose character
// peeked out from INSIDE the shell, a composition that was rejected twice; it stopped
// being reachable when chores and routine tasks both moved onto the real timer, and it
// is deleted now rather than left as a second answer to "what does the egg look like".
//
// `timerStyle()` still returns "egg" as the default, and that string now means the real
// timer: `enterTimer` sends it to `runJobTimer` and only a bought rig ever comes here.
const RIGS = {
  maker: () => import("./sticker-maker.js").then((m) => m.createMakerRig),
  polaroid: () => import("./polaroid.js").then((m) => m.createPolaroidRig),
};
const timerStyle = () => (RIGS[state.prefs?.timer_style_id] ? state.prefs.timer_style_id : "egg");

let rig = null, countdown = null, finishing = false, jobCtl = null;

function teardown() {
  countdown?.stop(); countdown = null;
  rig = null; // the rig's DOM goes away with the next setScreen
  // ⚠️ The job timer's does NOT. Its channel is a listener on `window`, which outlives
  // the setScreen that takes its iframe away, so it has to be let go by name.
  jobCtl?.destroy(); jobCtl = null;
  stopMusic();
  finishing = false;
}

/** First pending/running task in position order = the task the kid is on. */
function currentTask(entry) {
  const tr = entry.taskRuns.find((x) => x.status === "pending" || x.status === "running");
  if (!tr) return null;
  return { taskRun: tr, task: entry.tasks.find((tk) => tk.id === tr.task_id) };
}

/** The named task, if it is still the kid's to do. */
function namedTask(entry, taskRunId) {
  const tr = entry.taskRuns.find((x) => x.id === taskRunId);
  if (!tr || (tr.status !== "pending" && tr.status !== "running")) return null;
  return { taskRun: tr, task: entry.tasks.find((tk) => tk.id === tr.task_id) };
}

/** THE way into a timer from a job card, for both kinds of job.
 *
 *  taskRunId names the ONE task to run. Without it the flow falls back to the first
 *  unfinished task, which is all it could ever do while the timer was the only way in.
 *  Now the kid picks a card and asks for the timer on THAT card (chart.js askIfDone),
 *  so "the timer" has to mean the job they pressed rather than whichever one happens
 *  to be first in the routine.
 *
 *  ⚠️ Chores used to land here and throw. `chart.js askIfDone` called
 *  `enterRoutine(await loadEntry(tk.routineId), tk.taskRunId)` unconditionally, and a
 *  chore card carries neither field — so it fetched `/api/routines/undefined/today`,
 *  got an error body back, and `currentTask` read `.find` off an undefined
 *  `taskRuns`. The button rendered (chores do carry `durationS`, see
 *  `src/routes/stickers.ts`) and did nothing at all. Two kinds of job, one entrance.
 */
export async function enterTimer(tk) {
  if (tk.kind !== "task") return runJobTimer(choreJob(tk));

  const entry = await loadEntry(tk.routineId);
  const cur = (tk.taskRunId ? namedTask(entry, tk.taskRunId) : null) ?? currentTask(entry);
  if (!cur || !cur.task) {
    return entry.run?.status === "done_pending" ? showWaiting(entry) : showChart();
  }
  // The bought rigs keep the screen they were built for. Both are retired
  // (`src/sticker-catalog.ts`: `retired: true`), so this is the path nobody reachable
  // takes — it exists so a kid who bought one before retirement keeps what they paid
  // for, not as a live branch.
  if (timerStyle() !== "egg") return renderTask({ entry, ...cur });
  return runJobTimer(taskJob(entry, cur, tk));
}

// ---------- what a job is, once the difference stops mattering ----------
// { title, emoji, secs, running, left, start(), finish() }
//   start()  -> { durationS, startedAtMs, skewMs } | null on failure
//   finish() -> whatever the server says; `runCompleted` decides where the kid lands

/** A routine task: the server owns the clock, so it is resumable across a reload. */
function taskJob(entry, cur, tk) {
  const { task, taskRun } = cur;
  const running = taskRun.status === "running" && !!taskRun.started_at;
  const left = running
    ? computeRemaining({
        durationS: task.duration_s, startedAtMs: taskRun.started_at,
        nowMs: Date.now(), serverSkewMs: state.skewMs,
      }).remainingS
    : task.duration_s;
  return {
    entry, title: rowTitle(task), emoji: task.emoji,
    // ⚠️ The icon comes from the CARD, not the routine entry: `iconUrl` is
    // resolved from the emoji server-side (src/task-icons) and rides on
    // todayTasks, which is what the chart and the done sheet both draw.
    iconUrl: tk?.iconUrl ?? null,
    secs: task.duration_s,
    running, left,
    startedAtMs: running ? taskRun.started_at : 0,
    async start() {
      const res = await api.startTask(taskRun.id);
      if (res.error) return null;
      state.skewMs = res.serverTime - Date.now();
      return { durationS: task.duration_s, startedAtMs: res.taskRun.started_at, skewMs: state.skewMs };
    },
    finish: () => api.doneTask(taskRun.id).catch(() => ({})),
  };
}

/** A chore: LOCAL, because there is nothing on the server to be resumable against.
 *  `chores` carries `duration_s` (src/db.ts) and nothing else about a run — no
 *  `started_at` column and no `/start` verb to set one (api.js has `startTask` for
 *  task runs and only `submitChore` for these). So the clock begins when the kid taps
 *  Start, it lives as long as the screen does, and the server hears about it once. */
function choreJob(tk) {
  const secs = Number(tk.durationS) || 0;
  return {
    entry: null, title: rowTitle(tk), emoji: tk.emoji, iconUrl: tk.iconUrl ?? null,
    secs, running: false, left: secs,
    startedAtMs: 0,
    async start() { return { durationS: secs, startedAtMs: Date.now(), skewMs: 0 } },
    finish: () => api.submitChore(tk.choreId).catch(() => ({})),
  };
}

/** The job on the real rig.
 *
 *  ⚠️ THE APP KEEPS THE CLOCK. The rig runs `run.left -= dt`, accumulated per frame,
 *  which is what lets its wobble and jolts be keyed to real time — and which stops
 *  dead when the tab is hidden, because rAF stops. `createCountdown` re-derives from
 *  Date.now() against a fixed start every tick precisely so it cannot drift, and a
 *  task's start is the SERVER's. So the countdown here stays authoritative and
 *  corrects the rig through `sync` (RIG.setLeft); the rig is never asked to be the
 *  clock, only to be the egg.
 */
function runJobTimer(job) {
  stopChartPoll();
  teardown();
  if (!(job.secs > 0)) return showChart(); // nothing to count; the card should not have offered

  let ctl = null, doneRes = null, lastSync = -1;

  const leave = async () => {
    teardown();
    await refreshChart();
    showChart();
  };

  /** Marked done exactly once, whichever of the three routes got here: the kid tapped
   *  "I'm done!", the egg broke on its own, or the wall clock ran out while the rig
   *  was busy. `finishing` is the same guard `finishTask` uses. */
  const finishJob = async () => {
    if (finishing) return;
    finishing = true;
    countdown?.stop(); countdown = null;
    doneRes = await job.finish();
    await refreshChart();
  };

  /** @param tellRig false when the timer is already starting the run itself. */
  const begin = ({ durationS, startedAtMs, skewMs }, tellRig = true) => {
    countdown = createCountdown({
      durationS, startedAtMs, serverSkewMs: skewMs || 0,
      onTick(remainingS) {
        // ⚠️ Once a second, not once a frame. The two clocks tick at the same rate;
        // this is a correction for the gap a hidden tab opens, and posting one
        // message per rAF to say "still fine" would be 60x the traffic for it.
        const whole = Math.ceil(remainingS);
        if (whole !== lastSync) { lastSync = whole; ctl?.sync(remainingS) }
      },
      // Fallback only. The rig normally breaks itself the moment sync pushes it to
      // zero, and reports the finish from there — but if the frame never came up,
      // the job still has to land.
      onDone: finishJob,
    });
    // ⚠️ The rig is given what is LEFT, not the full duration, so a resumed job
    // cracks over the stretch the kid actually watches. It opens intact either way:
    // they were not here for the earlier cracking, and an egg that jumps to
    // half-broken on arrival reads as a glitch rather than as progress.
    if (!tellRig) return;
    const rem = computeRemaining({ durationS, startedAtMs, nowMs: Date.now(), serverSkewMs: skewMs || 0 });
    ctl.go(Math.max(1, Math.round(rem.remainingS)));
  };

  ctl = jobCtl = showJobTimer(job, {
    onBack: leave, // a running task keeps running server-side; the chart shows it live
    async onStart() {
      const res = await job.start();
      if (!res) return leave(); // the server refused: the same answer renderTask gives
      begin(res);
    },
    onFinish: finishJob,
    async onDone() {
      // The kid tapped Done on the hatch. finishJob has normally already landed; await
      // it here for the race where they beat the round trip.
      await finishJob();
      teardown();
      if (doneRes?.runCompleted && job.entry) {
        return showWaiting(await loadEntry(job.entry.routine.id));
      }
      showChart();
    },
  });

  // Already running when they opened it: no Start, no second server call — the timer
  // boots straight into the run off `running` in its own init, so we only pick the
  // clock back up. ⚠️ tellRig is false for exactly that reason: posting `go` as well
  // would race its own start, and whichever landed second would rewind the egg.
  if (job.running) {
    begin({ durationS: job.secs, startedAtMs: job.startedAtMs, skewMs: state.skewMs }, false);
  }
}

/** Polaroid mystery: a RANDOM photo from the kid's own media, else the task
 *  icon / surprise art. Which photo it'll be IS the fun.
 *
 *  The pool is LOCAL now (#282). It used to ask the server for roles `sticker`, `hatch` and
 *  `proof`; the first two no longer have server rows at all and the third is deleted the
 *  moment a parent decides, so that call would have gone on succeeding while quietly always
 *  returning an empty pool — the feature would have died without anything failing. These are
 *  the same photographs, read from the device that holds them. */
/** A sticker's assetUrl as something an <img>/<image> can load: local handles resolved off
 *  this device, anything else passed through, an unheld photo returned as null. */
function localPhotoSrc(assetUrl) {
  if (!assetUrl) return null;
  return isLocalPhotoRef(assetUrl) ? resolveLocalPhoto(assetUrl) : assetUrl;
}

function polaroidPhoto(ctx) {
  const pool = localPhotoUrls();
  if (pool.length) return pool[(Math.random() * pool.length) | 0];
  return ctx.task.emoji ? emojiSurprise(ctx.task.emoji) : pickSurprise();
}

/** ctx: { entry, task, taskRun } */
async function renderTask(ctx) {
  stopChartPoll(); teardown();
  // The ONE screen on the timer's own scene rather than the app's. Everything
  // else in the app calls bgFor() bare.
  const bg = bgFor("timer");

  setScreen(`
    <div class="task">
      <button class="back-btn" id="task-back">${arrowIcon("left")}</button>
      <div class="task-head">
        <span class="task-emoji">${esc(ctx.task.emoji ?? "⭐")}</span>
        <h2 class="task-title">${esc(ctx.task.title)}</h2>
      </div>
      <div class="egg-stage"><div id="egg-host"></div></div>
      <div class="task-clock" id="clock">${fmtClock(ctx.task.duration_s)}</div>
      <div class="time-bar"><i id="time-fill" style="width:100%"></i></div>
      <div class="task-actions" id="task-actions"></div>
    </div>`, "k-screen task-screen", bg);

  $("task-back").onclick = async () => {
    // A running server task keeps running (resumable) — the chart shows it live.
    teardown();
    await refreshChart(); showChart();
  };

  const style = timerStyle();
  const resuming = ctx.taskRun.status === "running" && !!ctx.taskRun.started_at;

  // Sticker Maker pre-pick delight: "What are you making?" before the timer
  // starts. Skippable -> the machine makes a mystery "?" sticker. The pick now
  // feeds the MACHINE only: it used to be carried through to placement so the
  // kid never re-picked what the machine had just made, and placement no longer
  // happens here at all. What the kid places is chosen when the parent's yes
  // turns the card's ring green.
  ctx.preSticker = null;
  if (style === "maker" && !resuming) {
    ctx.preSticker = await new Promise((res) => openStickerPrePick(res));
  }

  const opts = {};
  if (style === "maker") {
    // The machine paints the sticker it is making into an SVG <image>, so it needs a real
    // src: a `local:` handle has to be resolved here, and a photo this device does not hold
    // falls back to null — the mystery "?" tile, which is a face the rig already has.
    opts.stickerUrl = localPhotoSrc(ctx.preSticker?.assetUrl ?? null);
    opts.stickerLabel = ctx.preSticker?.label ?? null;
  } else if (style === "polaroid") {
    opts.photoUrl = polaroidPhoto(ctx);
    opts.ariaLabel = t("app.kidPolaMystery");
  }
  const createRig = await RIGS[style]();
  const host = $("egg-host");
  if (!host) return; // the kid navigated away while picking
  rig = createRig(host, opts);

  const showDone = () => {
    $("task-actions").innerHTML = `<button class="mega-btn green" id="btn-done">${checkIcon()} ${esc(t("app.kidImDone"))}</button>`;
    $("btn-done").onclick = () => finishTask(ctx);
  };
  const begin = (startedAtMs, skewMs) => {
    showDone();
    startMusic();
    countdown = createCountdown({
      durationS: ctx.task.duration_s, startedAtMs, serverSkewMs: skewMs,
      onTick(remainingS, p) {
        const clock = $("clock"), fill = $("time-fill");
        if (clock) clock.textContent = fmtClock(remainingS);
        if (fill) fill.style.width = `${Math.max(0, 100 - p * 100)}%`;
        rig?.setProgress(p);
      },
      onDone() { finishTask(ctx); },
    });
  };

  if (resuming) {
    // Resumability: reload mid-task picks up from the server timestamps.
    begin(ctx.taskRun.started_at, state.skewMs);
    return;
  }
  $("task-actions").innerHTML = `<button class="mega-btn" id="btn-start">${playIcon()} ${esc(t("app.kidStart"))}</button>`;
  $("btn-start").onclick = async () => {
    unlockAudio(); // user gesture: lets the hatch alarm play later
    $("btn-start").disabled = true;
    const res = await api.startTask(ctx.taskRun.id);
    if (res.error) { await refreshChart(); return showChart(); }
    state.skewMs = res.serverTime - Date.now();
    begin(res.taskRun.started_at, state.skewMs);
  };
}

/** Timer ran out OR the kid tapped "I'm done!": the rig's payoff fires and the
 *  task is marked done. It STOPS there.
 *
 *  The sticker used to follow immediately from here. It cannot any more: the
 *  sticker lands only once the parent has said yes (Andjroo, 2026-07-31), and the
 *  timer is now just one of two ways to say a job is finished — the sheet is the
 *  other. If the timer still handed out a sticker on the spot it would be the
 *  only way to get one, which is the exact thing that was taken out.
 *  So the payoff here is the rig's own hatch, and the sticker is collected from
 *  the card's ring once it turns green (chart.js cardState -> "reward"). */
async function finishTask(ctx) {
  if (finishing) return;
  finishing = true;
  countdown?.stop(); countdown = null;
  stopMusic();
  $("clock") && ($("clock").textContent = "0:00");
  $("time-fill") && ($("time-fill").style.width = "0%");
  $("task-actions") && ($("task-actions").innerHTML = "");
  playAlarm();
  celebrate();

  const style = timerStyle();
  const hatched = new Promise((res) => {
    // Maker/polaroid rigs own their art (pre-pick / photo); the egg gets a surprise.
    if (rig) rig.hatch({ imageUrl: style === "egg" ? pickSurprise() : undefined, onDone: res });
    else res();
  });
  const posted = api.doneTask(ctx.taskRun.id).catch(() => ({}));
  const [, doneRes] = await Promise.all([hatched, posted]);
  await new Promise((res) => setTimeout(res, 500)); // let the payoff land

  finishing = false;
  await refreshChart();
  // The whole routine has landed: that has a screen of its own. Otherwise back to
  // the chart, never straight into the next task's timer — auto-advance was right
  // while the timer WAS the routine, and running the next one unasked is the
  // exact thing that was taken out.
  if (doneRes.runCompleted) return showWaiting(await loadEntry(ctx.entry.routine.id));
  showChart();
}
