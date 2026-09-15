// nimiq.kids — drift-free countdown engine for the kid egg timer.
// Vanilla ES module, no framework. Pairs with /kid/js/egg.js (the rig) but has no DOM
// dependency of its own, so bun can unit-test the math directly (src/egg-timer.test.ts).
//
// Design rule: NEVER accumulate elapsed time across ticks. Every tick re-derives
// remaining/progress from the wall clock (Date.now) against a fixed start timestamp,
// so throttled tabs, long GC pauses and rAF gaps can never drift the countdown.

/**
 * Pure countdown math. Everything derives from wall-clock timestamps.
 *
 * @param {object} args
 * @param {number} args.durationS     total countdown length in seconds
 * @param {number} args.startedAtMs   wall-clock ms when the countdown started
 * @param {number} args.nowMs         current wall-clock ms (Date.now())
 * @param {number} [args.serverSkewMs] add to local clock to approximate server time
 *   (serverNowMs - localNowMs at sync). 0 when the countdown is purely local.
 * @returns {{ remainingMs: number, remainingS: number, progress: number, done: boolean }}
 *   remaining is clamped to [0, durationMs]; progress is clamped to [0, 1].
 */
export function computeRemaining({ durationS, startedAtMs, nowMs, serverSkewMs = 0 }) {
  const durationMs = durationS * 1000;
  if (!(durationMs > 0)) {
    // Zero, negative or NaN duration: already over.
    return { remainingMs: 0, remainingS: 0, progress: 1, done: true };
  }
  const elapsedMs = (nowMs + serverSkewMs) - startedAtMs;
  const remainingMs = Math.min(durationMs, Math.max(0, durationMs - elapsedMs));
  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return { remainingMs, remainingS: remainingMs / 1000, progress, done: remainingMs <= 0 };
}

/**
 * Live countdown driver. Starts immediately.
 *
 * Visible tab: requestAnimationFrame (smooth progress for the egg rig).
 * Hidden tab: rAF stops firing, so we fall back to a 1s interval — the countdown
 * keeps counting and onDone still fires while backgrounded. Because every tick
 * re-derives from the wall clock, flipping between drivers can't drift anything.
 *
 * @param {object} args
 * @param {number} args.durationS
 * @param {number} [args.startedAtMs]  defaults to Date.now()
 * @param {number} [args.serverSkewMs]
 * @param {(remainingS: number, progress01: number) => void} [args.onTick]
 * @param {() => void} [args.onDone]  fired exactly once, after the final onTick(0, 1)
 * @returns {{ pause: () => void, resume: () => void, stop: () => void }}
 */
export function createCountdown({ durationS, startedAtMs = Date.now(), serverSkewMs = 0, onTick, onDone }) {
  const doc = typeof document !== "undefined" ? document : null;
  const hasRaf = typeof requestAnimationFrame === "function";
  let startMs = startedAtMs; // shifted forward on resume so pauses don't count as elapsed
  let pausedAtMs = 0;
  let state = "running"; // running | paused | done | stopped
  let rafId = 0;
  let intervalId = 0;

  function tick() {
    if (state !== "running") return;
    const r = computeRemaining({ durationS, startedAtMs: startMs, nowMs: Date.now(), serverSkewMs });
    if (onTick) onTick(r.remainingS, r.progress);
    if (r.done) {
      state = "done";
      teardown();
      if (onDone) onDone();
    }
  }

  function stopDriver() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (intervalId) { clearInterval(intervalId); intervalId = 0; }
  }

  function startDriver() {
    stopDriver();
    if (hasRaf && (!doc || !doc.hidden)) {
      const step = () => { tick(); if (state === "running") rafId = requestAnimationFrame(step); };
      rafId = requestAnimationFrame(step);
    } else {
      // Hidden tab (or no rAF, e.g. tests): coarse 1s driver is plenty.
      intervalId = setInterval(tick, 1000);
    }
  }

  function onVisibility() {
    if (state !== "running") return;
    tick(); // catch up instantly on return to the tab
    if (state === "running") startDriver(); // swap driver for the new visibility mode
  }

  function teardown() {
    stopDriver();
    if (doc) doc.removeEventListener("visibilitychange", onVisibility);
  }

  if (doc) doc.addEventListener("visibilitychange", onVisibility);
  tick(); // immediate first paint (also finishes instantly if already elapsed)
  if (state === "running") startDriver();

  return {
    pause() {
      if (state !== "running") return;
      state = "paused";
      pausedAtMs = Date.now();
      stopDriver();
    },
    resume() {
      if (state !== "paused") return;
      startMs += Date.now() - pausedAtMs; // paused time never counts as elapsed
      state = "running";
      tick();
      if (state === "running") startDriver();
    },
    stop() {
      if (state === "done" || state === "stopped") return;
      state = "stopped";
      teardown();
    },
  };
}
