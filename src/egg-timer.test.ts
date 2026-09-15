// Countdown math for the kid egg timer (public/kid/js/timer.js). Pure wall-clock
// derivation — these tests pin the clamp/skew/progress contract the egg rig relies on.
import { test, expect } from "bun:test";
import { computeRemaining } from "../public/kid/js/timer.js";

const MIN2 = 120; // the demo's Start-2min duration

test("halfway through: remaining and progress derive from wall clock", () => {
  const r = computeRemaining({ durationS: MIN2, startedAtMs: 1_000_000, nowMs: 1_000_000 + 60_000 });
  expect(r.remainingS).toBe(60);
  expect(r.remainingMs).toBe(60_000);
  expect(r.progress).toBe(0.5);
  expect(r.done).toBe(false);
});

test("fresh start: full remaining, zero progress", () => {
  const r = computeRemaining({ durationS: MIN2, startedAtMs: 5_000, nowMs: 5_000 });
  expect(r.remainingS).toBe(MIN2);
  expect(r.progress).toBe(0);
  expect(r.done).toBe(false);
});

test("elapsed past the end clamps to zero and reports done (progress capped at 1)", () => {
  const r = computeRemaining({ durationS: MIN2, startedAtMs: 0, nowMs: 999_999_999 });
  expect(r.remainingMs).toBe(0);
  expect(r.remainingS).toBe(0);
  expect(r.progress).toBe(1);
  expect(r.done).toBe(true);
});

test("exactly at the end is done", () => {
  const r = computeRemaining({ durationS: MIN2, startedAtMs: 0, nowMs: MIN2 * 1000 });
  expect(r.remainingMs).toBe(0);
  expect(r.progress).toBe(1);
  expect(r.done).toBe(true);
});

test("startedAt in the future (negative elapsed): remaining clamps to full duration, progress to 0", () => {
  const r = computeRemaining({ durationS: MIN2, startedAtMs: 100_000, nowMs: 40_000 });
  expect(r.remainingMs).toBe(MIN2 * 1000); // never MORE than the duration
  expect(r.progress).toBe(0);              // never negative
  expect(r.done).toBe(false);
});

test("server skew shifts the effective clock forward", () => {
  // Local clock is 30s behind the server; skew corrects it.
  const r = computeRemaining({ durationS: MIN2, startedAtMs: 0, nowMs: 30_000, serverSkewMs: 30_000 });
  expect(r.remainingS).toBe(60);
  expect(r.progress).toBe(0.5);
});

test("negative server skew shifts the effective clock backward", () => {
  const r = computeRemaining({ durationS: MIN2, startedAtMs: 0, nowMs: 90_000, serverSkewMs: -30_000 });
  expect(r.remainingS).toBe(60);
  expect(r.progress).toBe(0.5);
});

test("skew defaults to 0 when omitted", () => {
  const withDefault = computeRemaining({ durationS: MIN2, startedAtMs: 0, nowMs: 45_000 });
  const explicit = computeRemaining({ durationS: MIN2, startedAtMs: 0, nowMs: 45_000, serverSkewMs: 0 });
  expect(withDefault).toEqual(explicit);
});

test("zero duration is immediately done", () => {
  const r = computeRemaining({ durationS: 0, startedAtMs: 0, nowMs: 0 });
  expect(r.remainingMs).toBe(0);
  expect(r.progress).toBe(1);
  expect(r.done).toBe(true);
});

test("negative duration is immediately done (never a negative remaining)", () => {
  const r = computeRemaining({ durationS: -60, startedAtMs: 0, nowMs: 1_000 });
  expect(r.remainingMs).toBe(0);
  expect(r.remainingS).toBe(0);
  expect(r.progress).toBe(1);
  expect(r.done).toBe(true);
});

test("fractional seconds survive (no premature rounding)", () => {
  const r = computeRemaining({ durationS: 10, startedAtMs: 0, nowMs: 2_500 });
  expect(r.remainingS).toBe(7.5);
  expect(r.progress).toBe(0.25);
});

test("progress hits the rig's crack thresholds exactly (0.25 / 0.5 / 0.75 / 0.9)", () => {
  for (const t of [0.25, 0.5, 0.75, 0.9]) {
    const r = computeRemaining({ durationS: 100, startedAtMs: 0, nowMs: t * 100_000 });
    expect(r.progress).toBe(t);
  }
});
