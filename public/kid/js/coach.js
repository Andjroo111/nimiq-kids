// THE ONE-TIME POINTER AT THE NAME PILL (#407).
//
// Andjroo, 2026-09-01, having gone looking for where a kid changes their background: "I guess I
// actually do like it where it is, I forgot that it was in the name field." He built it and he
// could not find it. A four-year-old will not.
//
// ⚠️ THIS IS A COACH MARK, NOT A MOVE. The scene stays behind the name (`me.js`). It was offered
// a dock slot and a home-screen tile and Andjroo kept it where it is.
//
// The near miss is what makes the hint worth drawing at all: the Timer has its OWN background
// picker (`kid_prefs.timer_background_id`), so a kid who goes hunting finds a picker that
// changes only the timer and concludes the feature is broken.
//
// ⚠️ ARMED BY THE CHARACTER PICK, DRAWN ON THE BOARD. Andjroo's call, and it is the only shape
// available: the pick is the first-login moment, and the pill it points at does not exist on
// the picker screen. So the pick writes a flag and the next board paint spends it.
//
// ⚠️ AN ABSENT FLAG MEANS SAY NOTHING — the opposite of `kid.approvedSeen`, where missing means
// "tell them". Inverted here, every kid who already owns a character would meet this hint on
// every device forever, which is exactly the obstacle the issue rules out.

import { esc, t } from "./util.js";

const KEY = (childId) => `kid.sceneCoach.${childId}`;

/** localStorage is unavailable in a private window and on an opaque origin. A hint is never
 *  worth throwing out of a board paint over, so both directions swallow. */
function read(childId) {
  try { return localStorage.getItem(KEY(childId)); } catch { return null; }
}
function clear(childId) {
  try { localStorage.removeItem(KEY(childId)); } catch { /* nothing to undo */ }
}

/** Called when the server has agreed this kid's character is theirs. */
export function armSceneCoach(childId) {
  if (!childId) return;
  try { localStorage.setItem(KEY(childId), "1"); } catch { /* the hint is optional */ }
}

let node = null;
let reposition = null;

/** Take the bubble down and unhook everything it installed. Safe to call twice. */
export function dismissSceneCoach() {
  if (reposition) {
    window.removeEventListener("resize", reposition);
    window.removeEventListener("orientationchange", reposition);
    reposition = null;
  }
  node?.remove();
  node = null;
}

/**
 * Draw the pointer at `anchor` if this kid is armed, and spend the flag.
 *
 * ⚠️ THE FLAG IS SPENT ON THE DRAW, NOT ON THE DISMISSAL. "Once per kid" is the rule; a flag
 * that survived until the kid engaged would put the bubble back on every board paint until they
 * did, which is the reappearing hint the issue forbids.
 *
 * Fixed-position and parented to `body` on purpose. The pill sits in `.ch-aside`, which is a
 * narrow left column in landscape, and a bubble inside it is one `overflow` rule away from being
 * clipped to nothing by an ancestor that has no idea it is there.
 */
export function showSceneCoachIfArmed(childId, anchor) {
  dismissSceneCoach();
  if (!childId || !anchor || !read(childId)) return false;
  clear(childId);

  node = document.createElement("div");
  node.className = "kid-coach";
  node.setAttribute("role", "note");
  node.innerHTML = `<span class="kid-coach-arrow" aria-hidden="true"></span>
    <span class="kid-coach-text">${esc(t("app.kidSceneCoach"))}</span>`;
  document.body.appendChild(node);

  reposition = () => {
    // The board can repaint under us (the chart polls), and a repaint replaces the pill. An
    // anchor that has left the document is a kid who has left the board, so the bubble goes too.
    if (!anchor.isConnected) return dismissSceneCoach();
    const r = anchor.getBoundingClientRect();
    node.style.top = `${r.bottom + 10}px`;
    node.style.left = `${r.left}px`;
    node.style.maxWidth = `${Math.max(160, window.innerWidth - r.left - 16)}px`;
    return r;
  };

  reposition();   // place it before the first paint, or it flashes at 0,0

  // ⚠️ THE PILL IS STILL MOVING WHEN THIS RUNS. `setScreen` marks the new screen `is-entering`
  // and `screen-in` scales the WHOLE board from 0.985 over 260ms, so a rect read on the first
  // frame is a rect of a shrunken board: measured 2026-09-01, the bubble landed 3px off the
  // pill's left edge and stayed there, because nothing re-read it. Settle by re-anchoring each
  // frame until the rect stops changing, which also costs nothing under prefers-reduced-motion
  // where there is no animation and the second frame already matches the first.
  let last = null;
  let stable = 0;
  const deadline = performance.now() + 700;
  const settle = () => {
    if (!node) return;
    const r = reposition();
    if (!r) return;                                   // dismissed itself: anchor is gone
    const key = `${r.top}|${r.left}|${r.width}`;
    stable = key === last ? stable + 1 : 0;
    last = key;
    if (stable < 2 && performance.now() < deadline) requestAnimationFrame(settle);
  };
  requestAnimationFrame(settle);
  window.addEventListener("resize", reposition);
  window.addEventListener("orientationchange", reposition);

  // Both ways out the issue names: tap it away, or take the action. The anchor keeps its own
  // click handler — this listener only clears the bubble and never swallows the tap.
  node.onclick = dismissSceneCoach;
  anchor.addEventListener("click", dismissSceneCoach, { once: true });
  return true;
}
