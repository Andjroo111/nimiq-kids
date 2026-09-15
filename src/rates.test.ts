// Dollar-denominated rewards. NIM trades far under a cent, so every number here is
// the kind that silently rounds to zero or overflows if the conversion is careless.

import { test, expect } from "bun:test";
import { NIM_USD, LUNA, usdToWholeNimLuna, lunaToUsd } from "./rates";

const REAL_RATE = 0.00046324; // a real CoinGecko quote, 2026-07-30

test("dollars become a WHOLE number of coins", () => {
  const luna = usdToWholeNimLuna(2, REAL_RATE);
  expect(luna % LUNA).toBe(0);                 // no fraction of a coin, ever
  expect(luna / LUNA).toBe(Math.round(2 / REAL_RATE)); // 4317 NIM for $2
  expect(luna / LUNA).toBe(4317);
});

test("a reward never rounds away to nothing", () => {
  // A cent is ~21 NIM at this rate; a tenth of a cent is ~2. Even an absurdly
  // small ask must still be at least one whole coin, never zero.
  expect(usdToWholeNimLuna(0.01, REAL_RATE)).toBe(22 * LUNA);
  expect(usdToWholeNimLuna(0.0000001, REAL_RATE)).toBe(1 * LUNA);
});

test("junk in gives zero out, not NaN luna", () => {
  for (const bad of [0, -5, NaN, Infinity]) {
    expect(usdToWholeNimLuna(bad, REAL_RATE)).toBe(0);
  }
});

test("a broken rate falls back instead of exploding the payout", () => {
  // A zero/negative/NaN rate would divide to Infinity, turning "$2" into an unbounded
  // reward. It must fall back to the static rate.
  const viaStatic = usdToWholeNimLuna(2, NIM_USD);
  for (const bad of [0, -1, NaN]) {
    expect(usdToWholeNimLuna(2, bad)).toBe(viaStatic);
    expect(Number.isFinite(lunaToUsd(100 * LUNA, bad))).toBe(true);
  }
});

test("lunaToUsd round-trips what usdToWholeNimLuna produced", () => {
  const usd = lunaToUsd(usdToWholeNimLuna(2, REAL_RATE), REAL_RATE);
  expect(Math.abs(usd - 2)).toBeLessThan(0.001); // whole-coin rounding only
});

test("a dollar reward converts at any size — nothing here imposes a ceiling", () => {
  // The per-payout ceiling this module used to price is gone (2026-07-31): a parent
  // names the price, and only the family's balance can refuse it. Conversion must
  // therefore stay honest at sizes no ceiling would ever have allowed.
  for (const usd of [0.25, 20, 5_000]) {
    const luna = usdToWholeNimLuna(usd, NIM_USD);
    expect(luna % LUNA).toBe(0);
    expect(luna).toBe(Math.round(usd / NIM_USD) * LUNA);
  }
});
