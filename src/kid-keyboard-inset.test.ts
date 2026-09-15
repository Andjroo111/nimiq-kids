// How much of the kid app's screen the iOS software keyboard is covering
// (public/kid/js/util.js `keyboardInset`), which the connect screen reads as `--k-kbd`.
//
// The bug (#14): `.screen` is `position: fixed; inset: 0`, and iOS does not resize the
// LAYOUT viewport for the keyboard — so the screen kept its full 844px, the keyboard
// covered the bottom ~336px, and the Connect button sat at y=591 with
// `scrollHeight === clientHeight`. Nothing could scroll to it, so the screen read as
// having no submit button.
//
// The arithmetic takes the window shape as an argument rather than reading globals,
// because the one browser that reproduces this is a real iPhone: headless Chromium
// reflows on resize and never shows the overlap. This pins the maths; the on-device
// overlap is a separate, manual check.

import { test, expect, mock } from "bun:test";
import { kidIconsMock } from "./kid-icons-mock";

// Same icons.js stub as the other util.js tests (browser-absolute import).
mock.module("../public/kid/js/icons.js", kidIconsMock);

const { keyboardInset } = await import("../public/kid/js/util.js");

test("the measured iPhone case: 844 layout, 508 visible => 336 covered", () => {
  // The numbers from the issue: iPhone 13 at 390x844, numeric keyboard plus the
  // accessory bar leaves everything below y=508 covered.
  expect(keyboardInset({ innerHeight: 844, viewport: { height: 508, offsetTop: 0 } })).toBe(336);
});

test("no keyboard: nothing is covered", () => {
  expect(keyboardInset({ innerHeight: 844, viewport: { height: 844, offsetTop: 0 } })).toBe(0);
});

test("offsetTop counts: iOS scrolls the visual viewport to keep the field in sight", () => {
  // The page is pushed up 60px to reveal the focused input. That shift comes out of the
  // same budget, so ignoring it under-reports the cover by exactly 60 and the button
  // stays 60px under the keyboard — the bug, just smaller.
  expect(keyboardInset({ innerHeight: 844, viewport: { height: 508, offsetTop: 60 } })).toBe(276);
  expect(keyboardInset({ innerHeight: 844, viewport: { height: 508 } })).toBe(336); // absent => 0
});

test("never negative: a visual viewport taller than the layout reports 0, not a lift", () => {
  // Happens transiently on iOS during URL-bar collapse. A negative would push the
  // screen's bottom edge BELOW the viewport and hide the button for real.
  expect(keyboardInset({ innerHeight: 800, viewport: { height: 844, offsetTop: 0 } })).toBe(0);
  expect(keyboardInset({ innerHeight: 844, viewport: { height: 844, offsetTop: 40 } })).toBe(0);
});

test("no visual viewport at all: 0, so the layout is left exactly as it was", () => {
  // Older browsers and headless runs. The CSS default is 0px, so this is a no-op rather
  // than a different layout.
  expect(keyboardInset({ innerHeight: 844, viewport: null })).toBe(0);
  expect(keyboardInset({ innerHeight: 844 })).toBe(0);
  expect(keyboardInset({ innerHeight: 844, viewport: { height: NaN as unknown as number } })).toBe(0);
});

test("fractional viewport heights round rather than leaking sub-pixels into the layout", () => {
  expect(keyboardInset({ innerHeight: 844, viewport: { height: 507.6, offsetTop: 0 } })).toBe(336);
});
