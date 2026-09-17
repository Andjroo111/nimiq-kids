// The lock screen (#377). What a kid sees when the tablet has shut itself: bedtime,
// a spent screen-time budget, or a routine they still owe.
//
// This is a SCREENSAVER, not a screen. It has no dock, no back button and nothing to
// tap, because there is nothing here a child is allowed to do -- every control it could
// carry would be a control that does not work, and a button that does nothing is worse
// than no button. What it does have is a live countdown, because "you cannot use this"
// and "you cannot use this for another 11 hours" are different things to be told, and
// only the second one lets a seven-year-old stop asking.
//
// One deliberate exception: LOCKED_ROUTINE is NOT drawn here. A kid who owes their
// morning routine is looking at a lock they can open, and the thing that opens it is the
// chart -- so that state keeps the normal board, exactly as it did before this file
// existed. This screen is only for the two locks that no amount of doing can lift.

import { state, $, esc, t, setScreen, bgFor } from "./util.js";
import { ph } from "./icons.js";

// The four faces, from Phosphor (public/js/lib/phosphor.js) since 2026-09-15, named HERE
// rather than through the shared box-glyphs palette: that palette is what a parent picks a
// Treasure Box shelf icon from, and "the tablet is asleep" is not a thing anyone should be able
// to choose for a shelf. Regular weight: the lock screen's face is big.
const GLYPH = { moon: "moon", hourglass: "hourglass", rest: "couch", lock: "lock" };
// Deliberately NOT `class="k-icon"`. That class is the app's inline-icon idiom and it carries a
// size and a display mode from a stylesheet this file does not own; the lock screen's face is
// its own thing.
const glyph = (name) => `<span class="lk-glyph">${ph(GLYPH[name] ?? GLYPH.lock, "r")}</span>`;

/** The reasons that take the whole screen. `override_lock` (a grounding) is here too:
 *  a kid cannot work it off either, and being told "a grown-up locked this" is the
 *  honest version of a board that silently refuses every tap. */
const FULL_SCREEN = new Set(["outside_hours", "budget_spent", "break_time", "override_lock"]);

/** True when the wrapper's state should take over the whole screen. */
export function isLockedOut(lock = state.kioskLock) {
  return !!lock && lock.mode === "locked" && FULL_SCREEN.has(lock.reason ?? "");
}

/** 'in 3 hours 12 minutes' broken into the two units a kid actually reads. Seconds are
 *  shown ONLY under a minute, where they are the difference between "nearly" and "now";
 *  above that they are a number that changes too fast to mean anything. */
export function countdownText(msLeft) {
  const s = Math.max(0, Math.round(msLeft / 1000));
  if (s < 60) return t("app.kidLockedSeconds", { s });
  const mins = Math.floor(s / 60);
  if (mins < 60) return t("app.kidLockedMinutes", { m: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? t("app.kidLockedHours", { h }) : t("app.kidLockedHoursMins", { h, m });
}

/** The clock time the tablet comes back, in the reader's locale. Falls back to the
 *  countdown alone when there is no `until` -- an indefinite grounding has no time. */
function backAtText(until) {
  if (!until) return null;
  const d = new Date(until);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return t("app.kidLockedBackAt", { time });
}

const COPY = {
  outside_hours: { title: "app.kidLockedNightTitle", glyph: "moon" },
  budget_spent: { title: "app.kidLockedSpentTitle", glyph: "hourglass" },
  // A rest between sittings. Short, with a countdown: it is the one lock that ends soon.
  break_time: { title: "app.kidLockedRestTitle", glyph: "rest" },
  override_lock: { title: "app.kidLockedParentTitle", glyph: "lock" },
};

let tick = 0;
export function stopLockedTick() { clearInterval(tick); tick = 0; }

// ---- the peek: "Do my jobs" from the lock screen (Andjroo, 2026-09-02) ----
//
// A locked tablet used to be a locked CHART. Bedtime, a spent budget and a rest all took the
// whole screen, so a kid who owed "brush your teeth" at 8:05 could not tick it off, and the
// sticker they earn for it went unplaced. That is backwards: the lock exists to stop GAMES,
// and games are stopped natively (the wrapper's LockTask is self-only whenever the state is
// not UNLOCKED), so the screensaver is the only thing standing between the kid and the board.
//
// So the lock screen carries one button, and it steps the screensaver aside for PEEK_MS after
// the last touch. The lock has NOT lifted: the dock's games button stays dead and says why,
// and the same sentence rides onto the board as a banner with the countdown. When the kid
// walks away, the screensaver comes back on its own.

/** How long a peek lasts after the last touch. Three minutes is long enough to tick off a
 *  routine and place a sticker, and short enough that a board left face-up is a lock screen
 *  again before anyone wonders whether the tablet is open. */
export const PEEK_MS = 3 * 60 * 1000;
let peekUntil = 0;
let release = null; // what startLockWatch paints when the kid asks for the board

export function startPeek(nowMs = Date.now()) { peekUntil = nowMs + PEEK_MS; }
/** A touch while peeking pushes the screensaver back; a touch with no peek starts nothing. */
export function extendPeek(nowMs = Date.now()) { if (peekUntil) peekUntil = nowMs + PEEK_MS; }
export function endPeek() { peekUntil = 0; }
export function peeking(nowMs = Date.now()) { return nowMs < peekUntil; }

/** The lock-screen title for a takeover lock, or null: what the dead games button says when
 *  it is tapped, instead of "finish your jobs first" over a budget that is simply spent. */
export function lockTitleKey(lock = state.kioskLock) {
  return isLockedOut(lock) ? (COPY[lock.reason] ?? COPY.override_lock).title : null;
}

/** The lock, carried onto the board during a peek: the same sentence and countdown, small,
 *  so "why is the games button dead" and "when does it come back" are both still on screen.
 *  Tapping it hands the screen back to the lock screen. */
export function lockBanner(lock = state.kioskLock) {
  if (!isLockedOut(lock) || !peeking()) return "";
  const copy = COPY[lock.reason] ?? COPY.override_lock;
  return `<button class="lk-banner" id="lk-banner" data-reason="${esc(lock.reason ?? "")}">
    ${glyph(copy.glyph)}<span class="lk-banner-title">${esc(t(copy.title))}</span>
    ${lock.until ? `<span class="lk-banner-count" id="lk-banner-count"></span>` : ""}
  </button>`;
}

/** After the board paints: keep the banner's countdown live, drop it the moment the lock
 *  lifts, and let a tap on it bring the lock screen back. */
export function wireLockBanner() {
  const el = $("lk-banner");
  if (!el) return;
  el.addEventListener("click", () => { endPeek(); showLocked(); });
  const paint = () => {
    const lock = state.kioskLock;
    if (!isLockedOut(lock)) { el.remove(); stopLockedTick(); return; }
    const c = $("lk-banner-count");
    if (c && lock.until) c.textContent = countdownText(lock.until - Date.now());
  };
  paint();
  stopLockedTick();
  tick = setInterval(paint, 1000);
}

/**
 * Paint the lock screen for the wrapper's current state.
 *
 * The countdown is redrawn from `until` on a one-second interval rather than decremented,
 * so a tab that was backgrounded for an hour comes back showing the truth instead of an
 * hour-stale number it counted down from.
 */
export function showLocked() {
  const lock = state.kioskLock;
  if (!isLockedOut(lock)) return false;
  endPeek(); // a fresh takeover cancels any peek; the button below starts the next one
  const copy = COPY[lock.reason] ?? COPY.override_lock;
  const backAt = backAtText(lock.until);

  setScreen(`
    <div class="k-locked" data-reason="${esc(lock.reason ?? "")}">
      <div class="lk-art">${glyph(copy.glyph)}</div>
      <h1 class="lk-title">${esc(t(copy.title))}</h1>
      ${lock.until ? `<div class="lk-count" id="lk-count" aria-live="polite"></div>` : ""}
      ${backAt ? `<p class="lk-back">${esc(backAt)}</p>` : ""}
      <button class="lk-jobs" id="lk-jobs">${esc(t("app.kidLockedJobs"))}</button>
    </div>`, "k-screen locked-screen", bgFor());

  // The one control on this screen, and the only one that does something: the board, with
  // games still locked. `release` is the chart, handed in by startLockWatch.
  $("lk-jobs")?.addEventListener("click", () => { startPeek(); stopLockedTick(); release?.(); });

  const paint = () => {
    const el = $("lk-count");
    if (!el || !lock.until) return;
    el.textContent = countdownText(lock.until - Date.now());
  };
  paint();
  stopLockedTick();
  if (lock.until) tick = setInterval(paint, 1000);
  return true;
}

/**
 * The one watcher that owns the takeover (#377).
 *
 * Deliberately NOT hung off the chart's poll. A lock lands at a wall-clock moment nobody
 * asked for -- 20:00 arrives, or the last minute of the budget burns -- and it can land
 * while the kid is in the Treasure Box, on the money screen, or inside Minecraft with the
 * kiosk behind it. A watcher that only ran on the chart would leave every one of those
 * screens sitting there refusing taps with nothing on it to say why.
 *
 * The wrapper is the authority and has already re-pinned itself by the time we see this;
 * this is only the sentence a kid gets to read about it.
 *
 * @param {() => void} onRelease what to paint when the lock lifts (the chart)
 */
export function startLockWatch(onRelease) {
  let shown = false;
  release = onRelease;
  // Any touch while peeking keeps the board; the screensaver returns PEEK_MS after the last.
  document.addEventListener("pointerdown", () => extendPeek(), { passive: true });
  setInterval(() => {
    const lock = state.kiosk?.getNativeState?.() ?? null;
    // A plain browser has no wrapper and must be left completely alone: `getNativeState`
    // returns null there, and null is not "locked".
    if (!lock) return;
    state.kioskLock = lock;
    if (isLockedOut(lock)) {
      // The kid asked for the board and is still using it: leave it. `shown` drops so the
      // screensaver paints again the moment the peek runs out.
      if (peeking()) { shown = false; return; }
      // Repaint on a REASON change too, not just on the way in: bedtime arriving while a
      // spent budget was already showing is a different sentence, and the countdown it
      // draws points somewhere else.
      if (!shown || document.querySelector(".k-locked")?.dataset.reason !== lock.reason) {
        shown = true;
        showLocked();
      }
      return;
    }
    endPeek();
    if (shown) {
      shown = false;
      stopLockedTick();
      onRelease();
    }
  }, 5_000);
}
