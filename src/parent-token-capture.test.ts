// Session-fixation rule for the parent magic-link (public/parent/token-capture.js).
// A #t= link that DIFFERS from the current session must be held for confirmation, never
// silently written over an existing session.

import { test, expect } from "bun:test";
import { decideTokenCapture } from "../public/parent/token-capture.js";

const HEX = "a".repeat(40);
const OTHER = "b".repeat(40);

test("first sign-in (no current token) commits", () => {
  const d = decideTokenCapture(`#t=${HEX}`, null);
  expect(d.commit).toBe(HEX);
  expect(d.pendingSwitch).toBeNull();
  expect(d.wipe).toBe(true);
});

test("a link matching the current session commits (idempotent, no prompt)", () => {
  const d = decideTokenCapture(`#t=${HEX}`, HEX);
  expect(d.commit).toBe(HEX);
  expect(d.pendingSwitch).toBeNull();
});

test("a DIFFERENT token is held for confirmation, never committed", () => {
  const d = decideTokenCapture(`#t=${OTHER}`, HEX);
  expect(d.commit).toBeNull();          // the current session is NOT overwritten
  expect(d.pendingSwitch).toBe(OTHER);  // held aside for an explicit yes
  expect(d.wipe).toBe(true);            // fragment still scrubbed from the URL
});

test("an approval deep-link is captured and does not touch the token", () => {
  const d = decideTokenCapture("#approval=run-123", HEX);
  expect(d.approval).toBe("run-123");
  expect(d.commit).toBeNull();
  expect(d.pendingSwitch).toBeNull();
  expect(d.wipe).toBe(true);
});

test("an empty or unrelated hash does nothing", () => {
  for (const h of ["", "#", "#foo", "#t=xyz" /* non-hex */, "#t=abc" /* too short */]) {
    const d = decideTokenCapture(h, HEX);
    expect(d.commit).toBeNull();
    expect(d.pendingSwitch).toBeNull();
    expect(d.approval).toBeNull();
    expect(d.wipe).toBe(false);
  }
});
