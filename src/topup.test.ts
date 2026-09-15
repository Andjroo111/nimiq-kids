// The top-up policy. Pure arithmetic, so it is tested without a faucet or a node — which is
// the point of keeping planTopUp separate from the script that performs it.

import { test, expect } from "bun:test";
import { planTopUp } from "./topup";

const L = 100_000;
const VISITOR = 72_000 * L;   // what a visitor costs as of 2026-08-01
const TAP = 110_000 * L;      // measured faucet tap
const opts = { floor: 5, target: 15, maxTaps: 4, tapLuna: TAP };

test("does nothing while runway is above the floor", () => {
  const p = planTopUp(6 * VISITOR, VISITOR, opts);
  expect(p.needed).toBe(false);
  expect(p.taps).toBe(0);
  expect(p.visitors).toBeCloseTo(6, 5);
});

test("the floor is a floor, not a rounding: 4.9 visitors tops up", () => {
  const p = planTopUp(Math.round(4.9 * VISITOR), VISITOR, opts);
  expect(p.needed).toBe(true);
  expect(p.taps).toBeGreaterThan(0);
});

test("exactly at the floor is still fine", () => {
  expect(planTopUp(5 * VISITOR, VISITOR, opts).needed).toBe(false);
});

test("taps are capped per run, so a shared faucet is never hammered", () => {
  // Empty wallet wants 15 visitors = 1,080,000 NIM = 10 taps. The cap says 4.
  const p = planTopUp(0, VISITOR, opts);
  expect(p.tapsWanted).toBe(10);
  expect(p.taps).toBe(4);
});

test("it refills to the TARGET, not merely back over the floor", () => {
  const p = planTopUp(1 * VISITOR, VISITOR, { ...opts, maxTaps: 99 });
  const refilled = 1 * VISITOR + p.taps * TAP;
  expect(refilled / VISITOR).toBeGreaterThanOrEqual(15);
});

// The whole reason the threshold is denominated in visitors: this number tripled twice in one
// day. A NIM-denominated floor written on either day would have been wrong by the evening.
test("the same balance is a different verdict as the visitor cost moves", () => {
  const balance = 300_000 * L;
  expect(planTopUp(balance, 24_000 * L, opts).needed).toBe(false); // 12.5 visitors
  expect(planTopUp(balance, 72_000 * L, opts).needed).toBe(true);  // 4.2 visitors
});

// A rate lookup that fails, or an empty catalogue, prices a visitor at 0. Dividing by it
// reports infinite runway and tops up never — the silent failure this file exists to prevent.
// Refusing to decide is correct; the script turns this into a distinct exit code.
test("an unpriceable visitor does not read as infinite runway", () => {
  const p = planTopUp(0, 0, opts);
  expect(p.needed).toBe(false);
  expect(p.taps).toBe(0);
  expect(Number.isFinite(p.visitors)).toBe(true);
});
