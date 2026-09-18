// nimiq.kids kid app — the shell every screen of the kid's CLIMB stands in (2026-09-18).
//
// The climb is the kid's first minute on the tablet: Hi, the money face, the character, the
// place, then the goal path. Four of those are the same shape, a title, a grid of hexagon
// tiles that scrolls, and one lip button pinned under it, so the shape lives here once and
// the screens (character.js, hero.js, place.js, onboard.js) only say what goes in the tiles.
//
// Duolingo mechanics on Nimiq hexagons (duo-ui skill): a tile is the vendored duo-node, the
// button is the vendored duo-button, both read the --duo-* contract and nothing here writes
// a colour. Animation slots are placeholders; Andjroo builds the rivs.
//
// Its own module rather than more of util.js, which sits on the 800-line guard.

import { $, esc, t, setScreen } from "./util.js";
import { arrowIcon } from "./icons.js";

/**
 * THE CHARACTERS THAT MOVE (WP4, 2026-09-18). Andjroo approved three; the others are
 * mid-fix. Each is a .riv on riv.nimiq.kids with the contract in the motion-pipeline skill: state
 * machine `Main`, a looping idle, one verb trigger per character (the move it does on a tap),
 * a `sleep` boolean, 1024 square on a transparent ground. Never pinned to a hash: a rebuild lands
 * over the same URL within the hour. A hero not in this map stays its drawn PNG.
 */
export const RIV = {
  frog: { src: "https://riv.nimiq.kids/nimiq-kids-frog.riv", verb: "jump" },
  penguin: { src: "https://riv.nimiq.kids/nimiq-kids-penguin.riv", verb: "slide" },
  octopus: { src: "https://riv.nimiq.kids/nimiq-kids-octopus.riv", verb: "wave" },
};
/** The opener's trio, both apps, in Andjroo's order (2026-09-18: frog, penguin, octopus; the
 *  T-rex is out). The plan's "three characters, each doing something different". */
export const TRIO = ["frog", "penguin", "octopus"];

/**
 * An animation slot on the shared Rive contract (/js/lib/rive-mount.js, PR #515): a `.anim`
 * with `data-riv` (the file) and `data-verb` (the trigger a tap fires). Blank data-riv fetches
 * nothing and `.anim:empty` is hidden, so a slot costs nothing while it has no character.
 * `name` is the moment: hi, hero-pick, place, rung-one. `hero` fills the slot from RIV when
 * that hero moves, and leaves it blank otherwise.
 */
export function animSlot(name, { hero = null, riv = "", verb = "", cls = "" } = {}) {
  const r = hero ? RIV[hero] : null;
  return `<div class="anim ob-anim ${cls}" data-anim="${esc(name)}" data-riv="${esc(r ? r.src : riv)}" data-verb="${esc(r ? r.verb : verb)}"></div>`;
}

/** Fire a mount's verb once: the character greets on arrival, then answers taps (the loader
 *  wires the tap). `r` is the loader's Rive instance, `el` its mount. Nothing throws: a file
 *  whose Main has no such trigger just idles. */
function greet(m, r, el) {
  try {
    const rive = window.rive;
    const trigger = m.pickTrigger(r.stateMachineInputs("Main"), el.dataset.verb || "", rive.StateMachineInputType.Trigger);
    if (trigger) setTimeout(() => { try { trigger.fire(); } catch { /* torn down */ } }, 500);
  } catch { /* no state machine: the idle is the whole show */ }
}

/**
 * Mount whatever slots the screen just painted, then greet. A file that is unreachable (the
 * tablet is offline, the host is down) resolves null in the loader and the slot stays empty
 * and hidden; the still beside it keeps the screen. Nothing here throws into the screen.
 */
export function mountAnims(root = document) {
  return import("/js/lib/rive-mount.js").then(async (m) => {
    const mounts = [...root.querySelectorAll("[data-riv]")].filter((el) => el.dataset.riv);
    const instances = await m.mountAll(root);
    instances.forEach((r, i) => {
      if (!r || !mounts[i]) return;
      mounts[i]._rive = r; // so a re-pick can tear it down (remountAnim)
      greet(m, r, mounts[i]);
    });
    return instances;
  }).catch(() => []);
}

/** Point one slot at a hero and mount it, tearing down whatever moved there before (the
 *  character screen re-picks). A hero that does not move empties the slot. */
export function remountAnim(el, hero) {
  if (!el) return Promise.resolve(null);
  const r = RIV[hero];
  try { el._rive?.cleanup(); } catch { /* already gone */ }
  // A FRESH element, not a cleared one: the loader hangs its tap listener on the mount, and a
  // listener left from the last pick fires a trigger of a torn-down instance (it threw on the
  // confirm tap). A shallow clone carries the classes and data, none of the listeners or canvas.
  const fresh = el.cloneNode(false);
  fresh.dataset.riv = r ? r.src : "";
  fresh.dataset.verb = r ? r.verb : "";
  el.replaceWith(fresh);
  return r ? mountAnims(fresh.parentElement ?? document) : Promise.resolve(null);
}

/**
 * Paint one climb screen.
 *
 *   title  the one line a four-year-old reads (or has read to them)
 *   sub    the line under it, or ""
 *   body   the html of the grid, or of whatever the screen is about
 *   foot   the html of the button row, or ""
 *   cls    a screen class for the CSS (`ob-face`, `ob-hero`, ...)
 *   back   an onBack handler, which puts the floating back button on (re-pick from the me sheet)
 *   stage  html above the title (the Rive slot on the Hi screen), or ""
 */
export function climbScreen({ title, sub = "", body = "", foot = "", cls = "", back = null, stage = "" }) {
  setScreen(`
    <div class="ob ${cls}">
      ${back ? `<button class="back-btn" id="ob-back">${arrowIcon("left")}</button>` : ""}
      <div class="ob-card">
        ${stage}
        <header class="ob-head">
          <h1 class="ob-title">${esc(title)}</h1>
          ${sub ? `<p class="ob-sub">${esc(sub)}</p>` : ""}
        </header>
        <div class="ob-body" id="ob-body">${body}</div>
        ${foot ? `<footer class="ob-foot">${foot}</footer>` : ""}
      </div>
    </div>`, "k-screen k-climb");
  if (back) $("ob-back").onclick = back;
  mountAnims();
}

/** One hexagon tile: a duo-node whose face holds `inner` (an <img>, an identicon). The
 *  data attributes ride on the wrapper so a tap handler can read them off `closest`. */
export function hexTile(inner, { attrs = "", label = "", picked = false } = {}) {
  return `
    <div class="duo-node ob-tile${picked ? " is-picked" : ""}" ${attrs}>
      <button class="duo-node-face" type="button" aria-label="${esc(label)}"${picked ? ' aria-pressed="true"' : ""}>
        ${inner}
      </button>
    </div>`;
}

/** The lip button. `tone` is "" (action), "secondary" or "done"; `id` is what the screen wires. */
export function lipButton(id, text, { tone = "", disabled = false } = {}) {
  const cls = tone ? ` is-${tone}` : "";
  return `<button class="duo-button is-block${cls}" type="button" id="${esc(id)}"${disabled ? " disabled" : ""}>${esc(text)}</button>`;
}

/** Mark one tile picked and the rest not, and wake the confirm button. Shared by the hero
 *  and place pickers, which are the two screens with a tap-then-confirm contract. */
export function markPicked(tile, confirmId) {
  document.querySelectorAll(".ob-tile").forEach((x) => {
    const on = x === tile;
    x.classList.toggle("is-picked", on);
    x.querySelector(".duo-node-face")?.toggleAttribute("aria-pressed", on);
  });
  const btn = $(confirmId);
  if (btn) btn.disabled = false;
}

/** Copy the reader hears on every screen's confirm. Here so the four screens agree. */
export const thatOne = () => t("app.obThatOne");
