// The Grow banner gate (public/kid/js/grow-gate.js), issue #108.
//
// The dead end this pins: HATCH_VALIDATOR_ADDRESS is commented out on the public competition
// instance, so `stakingView` reports available:false and `stakePrecheck` throws
// staking_unavailable — while the kid app painted the Grow banner, opened the Grow screen and
// offered a full amount keypad anyway. A judge walked into a wall, and /health was meanwhile
// advertising "sends and staking happen instantly".
//
// No imports to mock: the rule is its own module precisely so it can be exercised as a
// function with inputs rather than through money.js's whole screen graph.

import { test, expect } from "bun:test";
import { showsGrowBanner } from "../public/kid/js/grow-gate.js";

test("staking off and nothing staked: no door", () => {
  expect(showsGrowBanner({ stakingAvailable: false, stakedLuna: 0 })).toBe(false);
});

test("staking on: the door is there", () => {
  expect(showsGrowBanner({ stakingAvailable: true, stakedLuna: 0 })).toBe(true);
});

// The rule that protects real money, and the reason this is not just `if (!available) hide`.
test("STAKED NIM KEEPS THE DOOR even when staking is switched off", () => {
  // Unsetting the validator on an instance where a kid has already staked must not strand
  // that NIM behind a screen they can no longer reach — unstaking lives through this banner.
  expect(showsGrowBanner({ stakingAvailable: false, stakedLuna: 20_000_000 })).toBe(true);
});

test("an older server that omits the field is treated as available", () => {
  // A cached shell must not silently lose the banner against a working instance. Only an
  // explicit false closes it.
  expect(showsGrowBanner({ stakedLuna: 0 })).toBe(true);
  expect(showsGrowBanner({})).toBe(true);
});

test("no wallet at all does not throw", () => {
  expect(showsGrowBanner(undefined)).toBe(true);
  expect(showsGrowBanner(null)).toBe(true);
});

// ---- no address, no door (#236) ----

test("a kid with NO ADDRESS is not offered Grow, however available staking is", () => {
  // Same dead end as the missing validator, reached the other way: there is no account to
  // stake from, and the server refuses with kid_address_not_registered. Offering the door
  // would walk the kid through a keypad to a refusal, which is the bug #108 closed.
  expect(showsGrowBanner({ stakingAvailable: true, stakedLuna: 0, address: null })).toBe(false);
});

test("no address BEATS the staked-NIM rule, because that combination cannot exist", () => {
  // The staked-NIM rule keeps the door open so nobody's money is stranded. A kid with no
  // address has never staked, so there is nothing to strand and nothing to override.
  expect(showsGrowBanner({ stakingAvailable: false, stakedLuna: 20_000_000, address: null })).toBe(false);
});

test("an ADDRESS-carrying payload is unaffected, and so is one without the field", () => {
  // null is the server saying "none". Absent is an older payload that never said anything,
  // and it must keep the behaviour it had.
  expect(showsGrowBanner({ stakingAvailable: true, address: "NQ07 0000 0000 0000 0000 0000 0000 0000 0000" })).toBe(true);
  expect(showsGrowBanner({ stakingAvailable: true })).toBe(true);
});
