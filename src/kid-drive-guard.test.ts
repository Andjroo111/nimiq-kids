// The kid driver's "did I actually get to the board" guard (tools/kid-drive.mjs).
//
// #408: chart.js used `stickerNode` without importing it, so a board carrying any placed
// sticker threw ReferenceError out of the whole render. The driver reported SUCCESS and
// screenshotted whatever screen was still standing, which was the picture-secret gate, and
// the picture on disk looked like a login screen doing its job.
//
// The guard could not have caught it. It read `if (/secret pictures|Who are you/i.test(body))
// throw` — a check that can only catch the two screens it happens to name, and the confirm
// step says "Tap the same 2 pictures again", which is neither.
//
// So the guard is a positive assertion now, and this file is what proves it. A guard nothing
// exercises is a guard nobody knows is inverted, and this one was shipped inverted-in-effect
// for as long as the bug lived.
import { test, expect } from "bun:test";
import { arrivalFailure, BOARD_SELECTOR } from "../tools/kid-drive.mjs";

/** The exact words on the confirm screen, which is where a tokenless drive actually stops. */
const CONFIRM_SCREEN = "Sam Tap the same 2 pictures again Not me";

test("the screen that used to pass as a board is rejected", () => {
  // The old check let this through: no "secret pictures", no "Who are you".
  expect(/secret pictures|Who are you/i.test(CONFIRM_SCREEN)).toBe(false);
  const msg = arrivalFailure({ hasBoard: false, bodyText: CONFIRM_SCREEN });
  expect(msg).toContain("never reached the board");
  // The screen is quoted, because "it failed" without the screen sends the next person
  // looking at the grid instead of at the token.
  expect(msg).toContain("Tap the same 2 pictures again");
});

test("a board with nothing thrown is an arrival", () => {
  expect(arrivalFailure({ hasBoard: true, bodyText: "Today Walk the dog" })).toBeNull();
});

test("a thrown error fails the drive even when the board painted", () => {
  // #408's own shape one step later: a module that throws AFTER painting leaves a board on
  // screen that no longer answers a tap, and a driver that only looked for `.k-chart` would
  // photograph it and call it a pass.
  const msg = arrivalFailure({
    hasBoard: true,
    bodyText: "Today",
    pageErrors: ["ReferenceError: stickerNode is not defined"],
  });
  expect(msg).toContain("stickerNode is not defined");
  expect(msg).toContain("threw 1 error");
});

test("the errors win over the missing board, because they say WHY it is missing", () => {
  const msg = arrivalFailure({
    hasBoard: false,
    bodyText: CONFIRM_SCREEN,
    pageErrors: ["ReferenceError: stickerNode is not defined"],
  });
  expect(msg).toContain("stickerNode");
  expect(msg).not.toContain("never reached the board");
});

test("the board is asserted by showChart's own root, not by a screen's words", () => {
  expect(BOARD_SELECTOR).toBe(".k-chart");
});
