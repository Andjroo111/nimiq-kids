// The approval-policy matrix (src/custody.ts). Pure: approvalPolicy(env) reads the env it
// is HANDED, so every case is a plain object — no subprocess, no process.env mutation.
// The one impure test pins the duplicated SIM formula to nimiq/client's, so the two can
// never drift (custody.ts must not import client.ts — that module has import-time throws).

import { test, expect } from "bun:test";
import { approvalPolicy } from "./custody";
import { NETWORK, SIM } from "./nimiq/client";

const KEY = "0".repeat(64); // any 64-hex — only presence matters for the SIM flag

test("mainnet for real (key, no sim) forces approval AND auth", () => {
  const p = approvalPolicy({ NIMIQ_NETWORK: "main", DEV_PARENT_PRIV: KEY });
  expect(p.simActive).toBe(false);
  expect(p.mainnetReal).toBe(true);
  expect(p.forced).toBe(true);
  expect(p.authRequired).toBe(true);
});

// The next two used to assert `forced: false`. That was the bug, written down as a test.
// `forced` is keyed on the NETWORK now, never on whether a signing key happens to exist,
// so neither simulating nor removing a key can open the gate on a mainnet instance.

test("main + NIMIQ_SIM=1 is still forced: simulating must not open the gate", () => {
  const p = approvalPolicy({ NIMIQ_NETWORK: "main", NIMIQ_SIM: "1", DEV_PARENT_PRIV: KEY });
  expect(p.simActive).toBe(true);
  expect(p.mainnetReal).toBe(false); // no real money reachable, and that stays true
  expect(p.forced).toBe(true); // but the policy does not relax
  expect(p.authRequired).toBe(true);
});

test("REMOVING THE KEY DOES NOT DISARM MAINNET — the non-custodial trap", () => {
  // Going non-custodial deletes DEV_PARENT_PRIV and HATCH_MASTER_SEED on purpose. Under the
  // old formula that made simActive true, which made mainnetReal false, which made forced
  // false, and every household fell back to its own mode with a demo row unlocked. The live
  // mainnet env sets no HATCH_REQUIRE_PARENT_APPROVAL, so nothing else held the door.
  const p = approvalPolicy({ NIMIQ_NETWORK: "main" });
  expect(p.simActive).toBe(true);
  expect(p.mainnetReal).toBe(false);
  expect(p.forced).toBe(true);
  expect(p.authRequired).toBe(true);
});

test("HATCH_REQUIRE_PARENT_APPROVAL=1 alone forces approval + auth (any network)", () => {
  const p = approvalPolicy({ HATCH_REQUIRE_PARENT_APPROVAL: "1" });
  expect(p.forced).toBe(true);
  expect(p.authRequired).toBe(true);
  expect(p.mainnetReal).toBe(false);
});

test("HATCH_LEGACY_BOOT=0 alone requires auth but does NOT force approval", () => {
  const p = approvalPolicy({ HATCH_LEGACY_BOOT: "0" });
  expect(p.authRequired).toBe(true);
  expect(p.forced).toBe(false);
});

test("empty env: neither forced nor auth-required (the friendly fresh clone)", () => {
  const p = approvalPolicy({});
  expect(p.forced).toBe(false);
  expect(p.authRequired).toBe(false);
  expect(p.simActive).toBe(true);
});

test("testnet with a key: real but not mainnet — nothing forced by network", () => {
  const p = approvalPolicy({ NIMIQ_NETWORK: "test", DEV_PARENT_PRIV: KEY });
  expect(p.simActive).toBe(false);
  expect(p.mainnetReal).toBe(false);
  expect(p.forced).toBe(false);
});

// Parity pin: in THIS process the duplicated formula must agree with nimiq/client.
test("approvalPolicy(process.env) mirrors nimiq/client's SIM and NETWORK exactly", () => {
  const p = approvalPolicy(process.env);
  expect(p.simActive).toBe(SIM);
  expect(p.mainnetReal).toBe(NETWORK === "main" && !SIM);
});
