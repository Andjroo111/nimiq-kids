// The kid's lock screen (public/kid/js/locked.js), issue #377.
//
// Two things worth a test here, and neither is the markup. First: WHICH locks take the
// whole screen. LOCKED_ROUTINE deliberately does not, because a kid who owes their morning
// routine is looking at a lock they can open and the thing that opens it is the chart --
// covering that with a screensaver would hide the only way out of it. Second: the
// countdown's unit choice, which is the difference between a number a seven-year-old can
// act on and one that just moves.

import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kidIconsMock } from "./kid-icons-mock";

mock.module("../public/kid/js/icons.js", kidIconsMock);

// util.js's `t()` consults `window.nimiqKidsShell` first and falls back to its own en
// table. Under bun there is no window at all, so give it one WITHOUT a shell — the
// fallback table is exactly what these assertions want to read.
(globalThis as { window?: unknown }).window = {};

const { isLockedOut, countdownText, startPeek, extendPeek, endPeek, peeking, lockTitleKey, PEEK_MS } =
  await import("../public/kid/js/locked.js");

const root = join(import.meta.dir, "..");
type Lock = import("../public/kid/js/locked").NativeLockState;
const lock = (over: Partial<Lock> = {}): Lock =>
  ({ mode: "locked", reason: "outside_hours", until: null, remainingSec: null, allowedApps: [], ...over });

// ---- which locks take the screen ----

test("bedtime, a spent budget and a grounding all take the whole screen", () => {
  for (const reason of ["outside_hours", "budget_spent", "break_time", "override_lock"]) {
    expect(isLockedOut(lock({ reason })), reason).toBe(true);
  }
});

test("an owed routine does NOT — the chart is the way out of that one", () => {
  expect(isLockedOut(lock({ reason: "routine_due" }))).toBe(false);
  expect(isLockedOut(lock({ reason: "awaiting_approval" }))).toBe(false);
});

test("an unlocked tablet is never taken over, whatever the reason says", () => {
  expect(isLockedOut(lock({ mode: "unlocked", reason: "outside_hours" }))).toBe(false);
});

test("a plain browser (no wrapper, no state) is left completely alone", () => {
  expect(isLockedOut(null)).toBe(false);
  expect(isLockedOut(undefined)).toBe(false);
  // An OLD wrapper reports no reason at all. It must not paint a lock screen that
  // says nothing, over a board that at least still works.
  expect(isLockedOut(lock({ reason: null }))).toBe(false);
});

// ---- the countdown ----
//
// The keys resolve to en's fallback strings here (no shell), so these assert the UNIT
// CHOICE, which is the decision, rather than the wording, which is the locale files'.

test("seconds appear only under a minute, where they are the whole point", () => {
  expect(countdownText(45_000)).toContain("45");
  expect(countdownText(90_000)).not.toContain("90");
});

test("under an hour reads in whole minutes", () => {
  expect(countdownText(11 * 60_000)).toContain("11");
});

test("over an hour reads hours AND minutes, and drops a zero minute", () => {
  expect(countdownText((3 * 60 + 12) * 60_000)).toMatch(/3.*12/s);
  const exact = countdownText(3 * 3600_000);
  expect(exact).toContain("3");
  expect(exact).not.toMatch(/\b0\b/);
});

test("a countdown that has run out never goes negative", () => {
  expect(countdownText(-500_000)).toContain("0");
  expect(countdownText(-500_000)).not.toContain("-");
});

// ---- wiring a refactor could silently undo ----

test("the watcher is started at boot, not hung off the chart's poll", () => {
  // A lock lands at a wall-clock moment and can land on ANY screen. Hanging this off
  // chart.js would leave the Box and the money screen refusing taps with nothing on
  // them to say why.
  const main = readFileSync(join(root, "public/kid/js/main.js"), "utf8");
  expect(main).toContain("startLockWatch");
  const chart = readFileSync(join(root, "public/kid/js/chart.js"), "utf8");
  expect(chart).not.toContain("startLockWatch");
});

test("the bridge forwards the reason and the remainder the screen needs", () => {
  // The page cannot tell the three locks apart from `mode` alone, and the countdown has
  // nothing to count to without `until`.
  const bridge = readFileSync(join(root, "public/kid/js/bridge.js"), "utf8");
  for (const key of ["reason", "until", "remainingSec"]) {
    expect(bridge.match(new RegExp(`${key}:`, "g"))?.length ?? 0, key).toBeGreaterThanOrEqual(2);
  }
});

test("every lock-screen string is in the boot fallback, verbatim from en", async () => {
  // The lock screen can paint before the shell bundle is warm. Every other screen that
  // does that shows a raw key for a moment and recovers; this one is what a kid reads
  // while the tablet refuses to work, so a raw key here is the whole message lost.
  const { appLocales } = await import("./locales/index");
  const en = appLocales.en as Record<string, string>;
  const util = readFileSync(join(root, "public/kid/js/util.js"), "utf8");
  for (const key of Object.keys(en).filter((k) => k.startsWith("app.kidLocked"))) {
    expect(util, key).toContain(`"${key}": ${JSON.stringify(en[key])}`);
  }
});

// ---- the peek: "Do my jobs" from the lock screen (Andjroo, 2026-09-02) ----
//
// The lock exists to stop GAMES, and games are stopped natively. The screensaver was the only
// thing keeping a kid from ticking off "brush your teeth" at 8:05, so it now steps aside on
// request, for a while, and comes back on its own.

test("peek: lasts PEEK_MS after the last touch, and a touch with no peek starts nothing", () => {
  endPeek();
  expect(peeking(0)).toBe(false);
  extendPeek(9_000);
  expect(peeking(9_000)).toBe(false); // extend never starts one
  startPeek(1_000);
  expect(peeking(1_000 + PEEK_MS - 1)).toBe(true);
  expect(peeking(1_000 + PEEK_MS)).toBe(false);
  extendPeek(5_000);
  expect(peeking(5_000 + PEEK_MS - 1)).toBe(true);
  endPeek();
  expect(peeking(1_000)).toBe(false);
});

test("peek: the dead games button names the lock, and says nothing for a routine lock", () => {
  expect(lockTitleKey(lock({ reason: "budget_spent" }))).toBe("app.kidLockedSpentTitle");
  expect(lockTitleKey(lock({ reason: "break_time" }))).toBe("app.kidLockedRestTitle");
  expect(lockTitleKey(lock({ reason: "outside_hours" }))).toBe("app.kidLockedNightTitle");
  expect(lockTitleKey(lock({ reason: "routine_due" }))).toBeNull();
  expect(lockTitleKey(null)).toBeNull();
});

test("peek: the lock screen carries the button and the board carries the banner", () => {
  const locked = readFileSync(join(root, "public/kid/js/locked.js"), "utf8");
  expect(locked).toContain('id="lk-jobs"');
  expect(locked).toMatch(/if \(peeking\(\)\) \{ shown = false; return; \}/);
  const chart = readFileSync(join(root, "public/kid/js/chart.js"), "utf8");
  expect(chart).toContain("${lockBanner()}");
  expect(chart).toContain("wireLockBanner();");
  expect(chart).toContain('lockTitleKey() ?? "app.kidShelfDoJobs"');
});

