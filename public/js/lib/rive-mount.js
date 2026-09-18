/* The one Rive mount for every surface (homepage, parent app, kid app).
 *
 * A mount is an element with data-riv and, optionally, data-verb:
 *
 *   <div class="anim" data-riv="/assets/rive/frog.riv" data-verb="jump"></div>
 *
 * mountAll() finds every `[data-riv]` whose value is set, loads the runtime the egg timer
 * already vendors (/kid/timer/rive-kit/, same origin, covered by the CSP's 'wasm-unsafe-eval')
 * exactly once, and mounts each file: play its `Main` state machine (Idle at rest), fire
 * data-verb on tap, or the first trigger Main declares when data-verb is blank. Every .riv
 * follows the contract in the motion-pipeline skill (Main, a looping Idle, verb triggers); the
 * file's own click listener is switched off here so a verb fires exactly once per tap.
 *
 * Nothing is drawn until the file has loaded: the canvas is attached in onLoad, so a blank
 * data-riv fetches nothing at all and a missing or broken file leaves the mount as it was. The
 * host styles the empty state (`.anim:empty { display: none }` on the homepage); this module
 * never touches display. Reduced motion holds the rest pose and takes no tap.
 *
 * data-props="off" turns the character's prop layer off: the hatch files show their catch
 * prop a few seconds into Idle by design (the kid taps it in the mini game), and carry a
 * boolean input `props` (default true) so a surface that wants the character alone can say
 * so. A file without that input is left as it is.
 *
 * The runtime and its wasm are NOT in the service worker's shell (src/sw-shell.test.ts keeps
 * /kid/timer/ out); they are fetched on first use and cached by the SW's static path.
 */

const KIT = "/kid/timer/rive-kit/";
const MAIN = "Main";

let runtime = null;

/** Load the vendored runtime once. Resolves to the global `rive` namespace. */
export function loadRuntime(kit = KIT) {
  if (!runtime) {
    runtime = new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = kit + "rive.js";
      s.onload = () => { window.rive.RuntimeLoader.setWasmUrl(kit + "rive.wasm"); ok(window.rive); };
      s.onerror = () => { runtime = null; no(new Error("rive.js did not load")); };
      document.head.appendChild(s);
    });
  }
  return runtime;
}

/** The trigger a tap fires: the one named `verb`, or the first trigger when verb is blank. */
export function pickTrigger(inputs, verb, triggerType) {
  for (const input of inputs || []) {
    if (input.type === triggerType && (!verb || input.name === verb)) return input;
  }
  return null;
}

/**
 * Mount one element. Resolves to the Rive instance, or null when the file did not load (the
 * element is left untouched). `opts.still` (default: prefers-reduced-motion) holds the rest
 * pose; `opts.createCanvas` and `opts.onResize` exist for tests.
 */
export function mountRive(el, rive, opts = {}) {
  const src = el.dataset && el.dataset.riv;
  if (!src) return Promise.resolve(null);
  const still = opts.still ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const canvas = (opts.createCanvas || (() => document.createElement("canvas")))();
  return new Promise((done) => {
    const r = new rive.Rive({
      canvas,
      src,
      stateMachine: MAIN,
      autoplay: true,
      shouldDisableRiveListeners: true,
      layout: new rive.Layout({ fit: rive.Fit.Contain, alignment: rive.Alignment.Center }),
      onLoad() {
        el.appendChild(canvas);
        r.resizeDrawingSurfaceToCanvas();
        (opts.onResize || ((fn) => addEventListener("resize", fn)))(() => r.resizeDrawingSurfaceToCanvas());
        const inputs = r.stateMachineInputs(MAIN) || [];
        if (el.dataset.props === "off") {
          const props = inputs.find((i) => i.name === "props" && i.type === rive.StateMachineInputType.Boolean);
          if (props) props.value = false;
        }
        if (still) { r.pause(); done(r); return; }
        const trigger = pickTrigger(inputs, el.dataset.verb || "", rive.StateMachineInputType.Trigger);
        if (trigger) {
          el.style.cursor = "pointer";
          el.addEventListener("click", () => trigger.fire());
        }
        done(r);
      },
      onLoadError(e) {
        console.warn("[rive-mount]", el.id || el.className, src, e);
        r.cleanup();
        done(null);
      },
    });
  });
}

/** Every set `[data-riv]` under `root`. Resolves to one entry per mount (instance or null). */
export function mountAll(root = document, opts = {}) {
  const mounts = [...root.querySelectorAll("[data-riv]")].filter((el) => el.dataset.riv);
  if (!mounts.length) return Promise.resolve([]);
  return (opts.load || loadRuntime)().then(
    (rive) => Promise.all(mounts.map((el) => mountRive(el, rive, opts))),
    (e) => { console.warn("[rive-mount]", e.message); return mounts.map(() => null); },
  );
}
