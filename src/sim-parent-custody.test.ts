// SIM means "there is no chain", not "there is no key here".
//
// The two were the same thing until parent custody, and then they stopped being. A
// `HATCH_CUSTODY=parent` instance is REQUIRED by its own boot guard to have no
// `DEV_PARENT_PRIV`, so the old formula made the non-custodial instance simulated by
// definition: `kidBalanceLuna` would have returned a ledger sum instead of reading the chain,
// which is the one promise the plan makes about a kid's money — that it cannot lie.
//
// `approvalPolicy` carries a deliberate copy of the formula (see the note in custody.ts), and
// a copy is only safe while something holds the two together. custody-policy.test.ts pins the
// copy to the live `SIM` for the CURRENT process env; this file walks the combinations that
// process cannot be in.

import { test, expect } from "bun:test";
import { approvalPolicy } from "./custody";

const KEY = "0".repeat(64); // any 64-hex — only presence matters to the formula

// `approvalPolicy(env)` is the copy of the SIM formula, and the only one that can be asked
// about an env other than this process's own. custody-policy.test.ts is what stops it drifting
// from `nimiq/client`'s.
const sim = (env: Record<string, string | undefined>) => approvalPolicy(env).simActive;

test("no key and no parent custody is still SIM — the default a fresh clone gets", () => {
  expect(sim({})).toBe(true);
  expect(sim({ HATCH_CUSTODY: "server" })).toBe(true);
});

test("a key means a real instance, as it always did", () => {
  expect(sim({ DEV_PARENT_PRIV: KEY })).toBe(false);
});

test("parent custody with NO key is a REAL instance, not a simulated one", () => {
  // The regression this file exists for. `HATCH_CUSTODY=parent` plus no key is not a
  // misconfiguration, it is the destination: the server reads the chain and relays bytes it
  // did not sign. Reading it as SIM turns every kid's on-chain balance into a database
  // number on exactly the instance that has nothing else to fall back on.
  expect(sim({ HATCH_CUSTODY: "parent" })).toBe(false);
});

test("NIMIQ_SIM=1 still wins over everything, including parent custody", () => {
  // The explicit switch has to stay absolute: it is what a demo box and the test suite use,
  // and a flag that quietly stopped working under one custody mode would be worse than no
  // flag at all.
  expect(sim({ NIMIQ_SIM: "1" })).toBe(true);
  expect(sim({ NIMIQ_SIM: "1", HATCH_CUSTODY: "parent" })).toBe(true);
  expect(sim({ NIMIQ_SIM: "1", HATCH_CUSTODY: "parent", DEV_PARENT_PRIV: KEY })).toBe(true);
});

test("only the exact string 'parent' flips it", () => {
  // Same rule custodyMode() already states: anything else, including unset, is the old
  // behaviour. A flag that silently rewrote custody on a typo would be the worse accident.
  for (const v of ["Parent", "PARENT", "parents", "true", "1", ""]) {
    expect({ v, sim: sim({ HATCH_CUSTODY: v }) }).toEqual({ v, sim: true });
  }
});

test("mainnet under parent custody reads as real money reachable, and approval stays forced", () => {
  const p = approvalPolicy({ NIMIQ_NETWORK: "main", HATCH_CUSTODY: "parent" });
  expect(p.simActive).toBe(false);
  expect(p.mainnetReal).toBe(true);
  // `forced` keys off the network alone and never off simActive, so this is unchanged either
  // way — asserted here because THIS is the combination the old formula got wrong.
  expect(p.forced).toBe(true);
  expect(p.authRequired).toBe(true);
});
