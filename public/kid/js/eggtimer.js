// nimiq.kids — the egg timer screen.
//
// Andjroo, 2026-07-31: the Timer button opened three round glyphs (hatch / sounds /
// background) and no way to set or start anything. It opens the built timer now.
//
// ⚠️ THE TIMER IS HOSTED WHOLE, IN A FRAME, AND THAT IS DELIBERATE FOR NOW.
// `/kid/timer/index.html` is the page Andjroo signed off over several sessions — the
// dial, Start, the run screen, the hatch, the four sheets — sitting on top of
// `wiggle.html?embed=1`, which is ~3000 lines of canvas owning the locked faces, the
// locked break, the drawn outline and the character landing. Hosting it as it stands
// puts the real thing in his hands today; re-implementing its chrome natively is a
// refinement (app i18n, server-side prefs, the app's own sheets) and it is staged in
// `js/_eggtimer-port/` with the steps written down in `/kid/timer/README.md`.
//
// What that trade costs, said plainly rather than discovered later:
//   · the timer's own choices live in ITS localStorage, not in kid_prefs, so they do
//     not follow the kid to another device yet;
//   · its strings are English, not the app's 5 locales;
//   · its four sheets are its own, so the app briefly has two sheet styles.
// None of those are visible as breakage; all of them are on the list.

import { setScreen, $, t, esc } from "./util.js";
import { arrowIcon } from "./icons.js";

// ⚠️ THE SRC CARRIES A VERSION, AND IT IS NOT OPTIONAL.
// Nothing under /kid/timer/ could be cached without it: every .html here is served
// `no-cache` with etag and last-modified stripped (src/serve-cache.ts), so an
// unversioned iframe re-fetched the whole timer and the whole rig on every open —
// 5.05MB and 5.4s a tap, measured. With a version on the URL they are immutable, and
// the second open costs nothing.
// The token comes from the meta the server stamps off the vendored files' own mtimes
// (src/timer-build.ts), so it changes when the timer actually changes and nobody has
// to remember to bump anything. The timer passes it on to the rig and to every asset.
// ⚠️ NO BUILD STAMP ON THE SCREEN. There was one, briefly, and Andjroo killed it:
// "the numbers just need to be gone." The version lives in the URL, where it does its
// real job — a stale copy can no longer be SERVED, which beats being able to spot one.
const V = document.querySelector('meta[name="timer-build"]')?.content;
// Un-substituted means the middleware did not run. Fall back to something that is
// always fresh rather than something that is silently stale — stale is the bug.
const VER = V && !V.startsWith("__") ? V : String(Date.now());
const SRC = `/kid/timer/index.html?clean=1&v=${encodeURIComponent(VER)}`;

/** Tell the timer to stop whatever it is playing.
 *
 *  ⚠️ THE FRAME IS NEVER RE-CREATED, WHICH IS WHY THIS HAS TO EXIST. Re-creating it would
 *  restart the rig mid-countdown (see the warning above), so the back chevron leaves the
 *  timer document alive inside a hidden screen. Its during-timer bed is a LOOP: without
 *  this, a kid who picks Lullaby and taps back is listening to it over the chore chart,
 *  the store and every screen after, with no visible cause and nothing to tap to stop it.
 *  Fire-and-forget by design — a timer that never loaded has nothing to hush. */
function hush() {
  try { $("eggtimer-frame")?.contentWindow?.postMessage({ job: "hush" }, "*"); }
  catch { /* frame gone or cross-origin: there is nothing playing either way */ }
}

/** Open the timer. `onBack` is what the back chevron returns to (the chart). */
export function showEggTimer(onBack) {
  setScreen(`
    <div class="eggtimer-screen">
      <button class="eggtimer-back" id="eggtimer-back" aria-label="${esc(t("app.kidBack") || "Back")}">
        ${arrowIcon("left")}
      </button>
      <iframe id="eggtimer-frame" title="${esc(t("app.kidTimerTitle"))}"
              src="${SRC}" scrolling="no"></iframe>
    </div>`, "k-screen eggtimer-host");

  // ⚠️ The frame is never re-created while the kid is in here. Reloading it would
  // restart the rig mid-countdown, which is the same trap the timer's own host
  // documents about its rig iframe — one level up.
  $("eggtimer-back").onclick = () => { hush(); onBack && onBack(); };
}

/** Open the SAME timer against one of the kid's jobs.
 *
 *  Andjroo, 2026-08-01: tapping "use timer" on a job card showed a different, older
 *  egg from the one the dock opens. It was not a stale deploy — `flow.js` drove
 *  `js/egg.js`, a placeholder SVG that predates the rig and was never swapped, because
 *  the two disagree about who owns the clock. This is the screen half of settling that:
 *  one egg everywhere, and the app's clock stays in charge.
 *
 *  ⚠️ THIS MODULE KNOWS NOTHING ABOUT THE SERVER, and that is the line worth keeping.
 *  It owns the frame, the labels and the channel; `flow.js` owns what a job IS, when it
 *  starts, and what finishing one costs. Everything server-shaped arrives as a callback.
 *
 *  @param job      { title, emoji, secs, running, left }
 *  @param handlers { onBack, onStart, onFinish, onDone }
 *  @returns        { go(secs), sync(left), destroy() }
 */
export function showJobTimer(job, handlers = {}) {
  setScreen(`
    <div class="eggtimer-screen">
      <button class="eggtimer-back" id="eggtimer-back" aria-label="${esc(t("app.kidBack") || "Back")}">
        ${arrowIcon("left")}
      </button>
      <iframe id="eggtimer-frame" title="${esc(job.title || t("app.kidTimerTitle"))}"
              src="${SRC}&job=1" scrolling="no"></iframe>
    </div>`, "k-screen eggtimer-host");

  const frame = $("eggtimer-frame");
  let dead = false;
  const post = (k, d) => {
    if (!dead && frame.contentWindow) frame.contentWindow.postMessage({ job: k, ...d }, "*");
  };

  // ⚠️ REMOVED ON THE WAY OUT, not left to the next setScreen. Replacing #kid-app's
  // innerHTML takes the iframe away but a window listener outlives it, so without
  // destroy() every visit to a job would leave another one behind, each still holding
  // this closure's handlers. `dead` covers the gap between teardown and removal.
  const onMsg = (e) => {
    if (dead || !frame.contentWindow || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || typeof m.job !== "string") return;
    // The timer says when it is listening — the alternative is guessing off the
    // iframe's load event, which fires before its module has run.
    if (m.job === "ready") {
      post("init", {
        title: job.title, emoji: job.emoji, iconUrl: job.iconUrl, secs: job.secs,
        running: !!job.running, left: job.left,
        // ⚠️ The timer is vendored and has no i18n; the app has five locales. Labels
        // cross the channel so a kid reading Spanish is not handed English here.
        strings: { start: t("app.kidStart"), done: t("app.kidImDone") },
      });
    } else if (m.job === "start") handlers.onStart && handlers.onStart();
    else if (m.job === "finish") handlers.onFinish && handlers.onFinish();
    else if (m.job === "done") handlers.onDone && handlers.onDone();
  };
  window.addEventListener("message", onMsg);

  const destroy = () => { dead = true; window.removeEventListener("message", onMsg); };
  $("eggtimer-back").onclick = () => { hush(); destroy(); handlers.onBack && handlers.onBack(); };

  return { go: (secs) => post("go", { secs }), sync: (left) => post("sync", { left }), destroy };
}
