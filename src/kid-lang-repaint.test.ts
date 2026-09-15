// Which screen a language or currency change repaints (public/kid/js/util.js
// `currentScreen`, driven by `onLangReady` in main.js).
//
// The bug this pins (#13): the roster reuses the pairing screen's page composition and
// so renders as `class="k-connect k-roster"`. The old decision chain tested `.k-connect`
// BEFORE `.k-roster`, so changing language on the kid app's first screen repainted it as
// "Connect your device" — a 6-digit code prompt a demo visitor cannot answer — and the
// `.k-roster` branch under it could never run. The coupling is invisible at the call
// site: nothing about `showLogin` hints that its own class list picks the repaint.
//
// The discriminator takes a class predicate rather than reading the DOM, so the ordering
// is exercised for real here with no document (same reason the tests in this repo make a
// function take its inputs rather than resolve module constants).

import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { kidIconsMock } from "./kid-icons-mock";

// util.js pulls icons.js for the sheet close button, and icons.js imports a
// browser-absolute path. Same stub as fmt-nim-whole.test.ts.
mock.module("../public/kid/js/icons.js", kidIconsMock);

const { currentScreen } = await import("../public/kid/js/util.js");

/** A screen's class attribute, as the predicate `onLangReady` builds from the DOM. */
const wearing = (classAttr: string) => {
  const worn = new Set(classAttr.split(/\s+/).filter(Boolean));
  return (cls: string) => worn.has(cls);
};

const MAIN_JS = readFileSync(new URL("../public/kid/js/main.js", import.meta.url), "utf8");

test("the roster repaints as the roster, not as device pairing", () => {
  // Exactly what showLogin renders. This is the whole issue: both classes are present.
  expect(currentScreen(wearing("k-connect k-roster"))).toBe("roster");
});

test("a genuinely unpaired tablet still repaints as device pairing", () => {
  expect(currentScreen(wearing("k-connect"))).toBe("pairing");
});

test("the home chart and the money screen are unaffected", () => {
  expect(currentScreen(wearing("k-chart"))).toBe("chart");
  expect(currentScreen(wearing("k-money"))).toBe("money");
});

test("an unrecognised screen repaints nothing rather than guessing", () => {
  expect(currentScreen(wearing(""))).toBeNull();
  expect(currentScreen(wearing("k-payout"))).toBeNull();
});

test("no branch is unreachable: every screen name is reachable from some class list", () => {
  // The old chain's failure mode was a branch that could never run. Assert each name is
  // actually produced by something, so a future reorder that shadows one fails here.
  const reached = new Set(
    ["k-chart", "k-money", "k-connect k-roster", "k-connect"].map((c) => currentScreen(wearing(c))),
  );
  expect(reached).toEqual(new Set(["chart", "money", "roster", "pairing"]));
});

test("the premise still holds: the roster borrows the pairing screen's composition", () => {
  // If showLogin ever stops carrying `k-connect`, the ordering above is guarding nothing
  // and this test says so, rather than passing quietly for a reason that has gone away.
  expect(MAIN_JS).toContain(`<div class="k-connect k-roster">`);
});

test("the repaint call site carries no ordering of its own", () => {
  // The chain of `if`s WAS the bug. Ordering belongs to currentScreen, in one place with
  // the reason attached; the call site is a flat lookup.
  expect(MAIN_JS).toContain("REPAINT[currentScreen(");
  expect(MAIN_JS).not.toMatch(/else if \(document\.querySelector\("\.k-/);
});
