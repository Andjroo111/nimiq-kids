// public/js/lib/rive-mount.js: the one Rive mount for the homepage, the parent app and the kid
// app. The contract under test is the part a screen relies on without looking: a blank
// data-riv fetches nothing, a missing file leaves the element exactly as it was (no canvas, so
// the host's `:empty` rule keeps it collapsed), a loaded file gets its canvas only in onLoad,
// and a tap fires the verb named on the element, or the first trigger when none is named.
//
// No DOM here: the element, the canvas and the runtime are the smallest fakes that carry the
// surface the module touches. `stateMachine: "Main"` and `shouldDisableRiveListeners: true`
// are asserted because they ARE the contract (one state machine, one tap path).

import { test, expect } from "bun:test";
import { mountAll, mountRive, pickTrigger } from "../public/js/lib/rive-mount.js";

const TRIGGER = Symbol("trigger");
const NUMBER = Symbol("number");
const BOOLEAN = Symbol("boolean");

type Fake = ReturnType<typeof fakeEl>;
function fakeEl(riv: string, verb = "", props = "") {
  const el = {
    id: "anim-test", className: "anim",
    dataset: { riv, verb, props },
    children: [] as unknown[],
    handlers: {} as Record<string, () => void>,
    style: {} as Record<string, string>,
    appendChild(c: unknown) { el.children.push(c); },
    addEventListener(type: string, fn: () => void) { el.handlers[type] = fn; },
    querySelectorAll() { return [el]; },
  };
  return el;
}

/** A runtime whose Rive constructor loads, or fails, on the next tick. */
function fakeRive(outcome: "load" | "error", inputs: { name: string; type: symbol; fire?: () => void; value?: boolean }[] = []) {
  const made: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const rive = {
    Fit: { Contain: "contain" }, Alignment: { Center: "center" },
    StateMachineInputType: { Trigger: TRIGGER, Number: NUMBER, Boolean: BOOLEAN },
    Layout: class { constructor(public o: unknown) {} },
    Rive: class {
      constructor(o: Record<string, any>) {
        made.push(o);
        queueMicrotask(() => (outcome === "load" ? o.onLoad() : o.onLoadError(new Error("404"))));
      }
      resizeDrawingSurfaceToCanvas() { calls.push("resize"); }
      stateMachineInputs(name: string) { calls.push(`inputs:${name}`); return inputs; }
      pause() { calls.push("pause"); }
      cleanup() { calls.push("cleanup"); }
    },
  };
  return { rive, made, calls };
}

const opts = (extra = {}) => ({ createCanvas: () => ({ tag: "canvas" }), onResize: () => {}, still: false, ...extra });

test("a blank data-riv never loads the runtime and touches nothing", async () => {
  const el = fakeEl("");
  let loaded = 0;
  const out = await mountAll(el as never, opts({ load: async () => { loaded++; return {}; } }));
  expect(out).toEqual([]);
  expect(loaded).toBe(0);
  expect(el.children).toEqual([]);
});

test("a missing file attaches no canvas, cleans up, and resolves null", async () => {
  const el = fakeEl("/site/does-not-exist.riv");
  const { rive, calls } = fakeRive("error");
  const r = await mountRive(el as never, rive, opts());
  expect(r).toBeNull();
  expect(el.children).toEqual([]);
  expect(el.handlers.click).toBeUndefined();
  expect(calls).toEqual(["cleanup"]);
});

test("a loaded file gets its canvas in onLoad, plays Main, and a tap fires the named verb", async () => {
  const fired: string[] = [];
  const inputs = [
    { name: "count", type: NUMBER, fire: () => fired.push("count") },
    { name: "wave", type: TRIGGER, fire: () => fired.push("wave") },
    { name: "jump", type: TRIGGER, fire: () => fired.push("jump") },
  ];
  const el = fakeEl("/assets/rive/frog.riv", "jump");
  const { rive, made, calls } = fakeRive("load", inputs);
  const r = await mountRive(el as never, rive, opts());
  expect(r).not.toBeNull();
  expect(el.children).toEqual([{ tag: "canvas" }]);
  expect(made[0].stateMachine).toBe("Main");
  expect(made[0].shouldDisableRiveListeners).toBe(true);
  expect(made[0].autoplay).toBe(true);
  expect(calls).toContain("resize");
  expect(el.style.cursor).toBe("pointer");
  el.handlers.click();
  expect(fired).toEqual(["jump"]);
});

test("a blank verb fires the FIRST trigger, never a number input", () => {
  const inputs = [
    { name: "count", type: NUMBER, fire() {} },
    { name: "wave", type: TRIGGER, fire() {} },
    { name: "jump", type: TRIGGER, fire() {} },
  ];
  expect(pickTrigger(inputs, "", TRIGGER)?.name).toBe("wave");
  expect(pickTrigger(inputs, "jump", TRIGGER)?.name).toBe("jump");
  expect(pickTrigger(inputs, "nope", TRIGGER)).toBeNull();
  expect(pickTrigger(null, "", TRIGGER)).toBeNull();
});

test("a file with no trigger mounts but takes no tap", async () => {
  const el = fakeEl("/assets/rive/still.riv");
  const { rive } = fakeRive("load", [{ name: "count", type: NUMBER, fire() {} }]);
  const r = await mountRive(el as never, rive, opts());
  expect(r).not.toBeNull();
  expect(el.handlers.click).toBeUndefined();
  expect(el.style.cursor).toBeUndefined();
});

test("reduced motion holds the rest pose and takes no tap", async () => {
  const el = fakeEl("/assets/rive/frog.riv", "jump");
  const { rive, calls } = fakeRive("load", [{ name: "jump", type: TRIGGER, fire() {} }]);
  await mountRive(el as never, rive, opts({ still: true }));
  expect(el.children.length).toBe(1);
  expect(calls).toContain("pause");
  expect(el.handlers.click).toBeUndefined();
});

test("mountAll mounts every set data-riv once the runtime resolves, and survives a runtime that does not", async () => {
  const a = fakeEl("/a.riv"), b = fakeEl("/b.riv");
  const root = { querySelectorAll: () => [a, fakeEl(""), b] };
  const { rive } = fakeRive("load");
  const out = await mountAll(root as never, opts({ load: async () => rive }));
  expect(out.length).toBe(2);
  expect(a.children.length).toBe(1);
  expect(b.children.length).toBe(1);
  const c = fakeEl("/c.riv");
  const failed = await mountAll({ querySelectorAll: () => [c] } as never, opts({ load: async () => { throw new Error("rive.js did not load"); } }));
  expect(failed).toEqual([null]);
  expect(c.children).toEqual([]);
});

test("data-props=off sets the file's props boolean to false and leaves a file without one alone", async () => {
  const props = { name: "props", type: BOOLEAN, value: true };
  const el = fakeEl("/assets/rive/frog.riv", "jump", "off");
  const { rive } = fakeRive("load", [props, { name: "jump", type: TRIGGER, fire() {} }]);
  await mountRive(el as never, rive, opts());
  expect(props.value).toBe(false);
  expect(el.handlers.click).toBeDefined();
  const kept = { name: "props", type: BOOLEAN, value: true };
  const plain = fakeEl("/assets/rive/frog.riv", "jump");
  await mountRive(plain as never, fakeRive("load", [kept]).rive, opts());
  expect(kept.value).toBe(true);
  const other = { name: "sleep", type: BOOLEAN, value: true };
  const off = fakeEl("/assets/rive/frog.riv", "jump", "off");
  await mountRive(off as never, fakeRive("load", [other]).rive, opts());
  expect(other.value).toBe(true);
});
