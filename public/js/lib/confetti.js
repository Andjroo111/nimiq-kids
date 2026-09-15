// nimiq.kids — shared canvas confetti burst. Imported by BOTH the parent PWA
// (public/js/app.js) and the kid tablet app (public/kid/js/*). Vanilla ES module.
// Draws on the page's fullscreen #confetti canvas (or any canvas passed in) and
// cleans up after itself; safe to call repeatedly.

// ---------- the sound the confetti makes ----------
//
// Andjroo, 2026-08-03: sound in the app, not only in the timer and not only in the film.
// Confetti fires at ten places in the kid app — a chore finished, NIM arriving, a treasure
// box opened, screen time bought, a sticker placed — and every one of them was silent.
//
// ⚠️ IT LIVES HERE, NOT AT THE TEN CALL SITES. One of them is in a `.then()` inside a
// retry, two are one line apart in the same function, and the next celebration anyone adds
// would be silent again by default. Putting it in `celebrate()` means the sound is a
// property of celebrating rather than something each site has to remember.
//
// ⚠️ AND IT NEVER THROWS. This module is shared with the PARENT PWA, which has its own
// synthesised juice layer and no /assets/sounds — a missing file has to be silence, not a
// broken celebration. Every failure path here ends in a caught promise.
//
// Two sounds, because two sizes of moment: `pop` for a sticker or a purchase, `cheer` —
// the film's real recording of the four children — for money actually arriving. A 2s cheer
// every time a sticker is placed would stop meaning anything by the third one.
const CHEER_URL = "/assets/sounds/cheer.mp3";
const POP_URL = "/assets/sounds/celebrate.mp3";
const SOUNDS = { pop: POP_URL, cheer: CHEER_URL };
const cache = {};

// ⚠️ SOUND IS BACK ON. Andjroo, 2026-08-27: "no sound at all right now, at least from my
// testing." It was switched off on 2026-08-03 ("lets remove all sound for now, it needs
// some work") and the pause was invisible from inside the app, so silence read as broken
// wiring rather than as a decision. The wiring, the two-sizes-of-moment split and the
// never-throws contract are exactly as built and proven — this only un-pauses the output.
// The egg timer has its own `SOUND_ON` and it went back on in the same change.
const SOUND_ON = true;

/** Fire-and-forget. `name` is a key of SOUNDS; anything else, or `null`, is silence. */
export function celebrateSound(name = "pop") {
  if (!SOUND_ON) return;
  const url = SOUNDS[name];
  if (!url) return;
  try {
    const a = (cache[url] ??= new Audio(url));
    a.currentTime = 0;
    a.play().catch(() => {});   // no gesture yet, or no decoder: stay silent
  } catch { /* no Audio at all (tests, odd webviews) */ }
}

/**
 * @param {HTMLCanvasElement} [canvas]
 * @param {{sound?: "pop"|"cheer"|null}} [opts] — `null` silences one call without
 *   silencing the burst, which is what the parent PWA and back-to-back bursts want.
 */
export function celebrate(canvas = document.getElementById("confetti"), opts = {}) {
  // ⚠️ Before the canvas guard on purpose: a screen that celebrates without a #confetti
  // element (an overlay mid-transition) should still be heard, and returning early here
  // was the difference between "the sound is flaky" and "the sound is missing".
  if (opts.sound !== null) celebrateSound(opts.sound ?? "pop");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = innerWidth; canvas.height = innerHeight;
  const colors = ["#21BCA5", "#0582CA", "#E9B213", "#EC991C", "#265DD7"];
  const parts = Array.from({ length: 130 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight / 3,
    vx: (Math.random() - .5) * 12, vy: Math.random() * -14 - 4,
    r: Math.random() * 7 + 3, c: colors[(Math.random() * colors.length) | 0],
    a: 1, rot: Math.random() * 6,
  }));
  let frames = 0;
  (function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts.forEach((p) => {
      p.vy += .35; p.x += p.vx; p.y += p.vy; p.rot += .2; p.a -= .008;
      ctx.globalAlpha = Math.max(p.a, 0); ctx.fillStyle = p.c;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6); ctx.restore();
    });
    if (frames++ < 150) requestAnimationFrame(loop);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })();
}
