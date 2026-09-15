// The first-run screen under parent custody (public/parent/onboard-gate.js).
//
// `HATCH_CUSTODY=parent` went live on the mainnet apex and took the sign-up path with it:
// POST /api/onboard answers 400 `address_required` for a household that brings no address of
// its own, correctly — but the screen in front of it called the wallet "optional right now",
// left the primary button live, and rendered that refusal as "That didn't go through. Try
// again". Two names, one tap, no way forward.
//
// src/onboard-address-custody.test.ts owns the server half (the 400 itself, and that it does
// NOT happen under server custody). This file owns the client's decision: what the screen
// shows, whether the button can fire, and what a named refusal says.
//
// The gate is a pure module for exactly this reason — no DOM, no shell, no fetch — so the
// rule is exercised as a function with inputs rather than through the whole boot path.

import { test, expect } from "bun:test";
import {
  walletRequired, walletBlock, walletBlocksCreate, onboardErrorKey,
} from "../public/parent/onboard-gate.js";
import { parentLocales } from "./locales/parent";
import { readFileSync } from "node:fs";

const PARENT = { kidCustody: "parent" };
const SERVER = { kidCustody: "server" };
const ADDRESS = "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD";
/** Every way "no wallet is connected" reaches the gate from a real render. */
const NO_ADDRESS = ["", "   ", null, undefined];

// ---- which instance demands a wallet ----------------------------------------

test("only parent custody makes the wallet a step", () => {
  expect(walletRequired(PARENT)).toBe(true);
  expect(walletRequired(SERVER)).toBe(false);
});

test("custody nobody has answered yet is the SHIPPED screen, not a demand", () => {
  // /health resolves after the first paint. Treating unknown as parent would put the
  // required step in front of every demo visitor for the length of one fetch; the testnet
  // demo is the competition judge path and does not change while a request is in flight.
  for (const unknown of [null, undefined, {}]) expect(walletRequired(unknown)).toBe(false);
});

// ---- which block the screen draws -------------------------------------------

test("parent custody with nothing connected draws the required step", () => {
  for (const none of NO_ADDRESS) expect(walletBlock(PARENT, none)).toBe("required");
});

test("the OPTIONAL claim is unreachable under parent custody", () => {
  // "Optional right now. You can top up any time later." is `papp.onbConnectHint`, and it is
  // true only where a connect affects top-ups and nothing else. This is the invariant the
  // whole module exists to hold: there is no address, connected or not, that gets a parent
  // -custody instance to the block carrying that sentence.
  for (const addr of [...NO_ADDRESS, ADDRESS]) expect(walletBlock(PARENT, addr)).not.toBe("optional");
});

test("server custody is untouched: the ghost offer, then the same connected chip", () => {
  for (const none of NO_ADDRESS) expect(walletBlock(SERVER, none)).toBe("optional");
  expect(walletBlock(SERVER, ADDRESS)).toBe("connected");
  for (const none of NO_ADDRESS) expect(walletBlock(null, none)).toBe("optional");
});

test("a connected wallet reads the same in both custody modes", () => {
  expect(walletBlock(PARENT, ADDRESS)).toBe("connected");
  expect(walletBlock(SERVER, ADDRESS)).toBe("connected");
});

// ---- the primary button ------------------------------------------------------

test("the primary is dead EXACTLY while the step that explains it is on screen", () => {
  // Derived from walletBlock rather than re-deciding, so a disabled button and the step
  // above it can never disagree about why.
  for (const custody of [PARENT, SERVER, null]) {
    for (const addr of [...NO_ADDRESS, ADDRESS]) {
      expect(walletBlocksCreate(custody, addr)).toBe(walletBlock(custody, addr) === "required");
    }
  }
});

test("the button that would 400 cannot fire, and no other button is disabled", () => {
  for (const none of NO_ADDRESS) expect(walletBlocksCreate(PARENT, none)).toBe(true);
  expect(walletBlocksCreate(PARENT, ADDRESS)).toBe(false);
  for (const none of NO_ADDRESS) expect(walletBlocksCreate(SERVER, none)).toBe(false);
  for (const none of NO_ADDRESS) expect(walletBlocksCreate(null, none)).toBe(false);
});

// ---- what a refusal says -----------------------------------------------------

test("address_required is answered with the thing to do, never the generic", () => {
  expect(onboardErrorKey({ error: "address_required" })).toBe("papp.onbNeedWallet");
  expect(onboardErrorKey({ error: "address_required" })).not.toBe("papp.didntGoThrough");
});

test("a mistyped address is its own message", () => {
  expect(onboardErrorKey({ error: "invalid_address" })).toBe("papp.addrInvalid");
});

test("anything unnamed still falls back to the generic message", () => {
  // `too_many_requests` was in this list until #242, which is the bug: the fallback is for
  // failures nobody named, and a brake the server names on purpose was never one of them. The
  // whole set now lives in src/onboard-refusals.test.ts, where it is compared against the route.
  for (const d of [null, undefined, {}, { error: "boom" }]) {
    expect(onboardErrorKey(d)).toBe("papp.didntGoThrough");
  }
});

test("every key this maps to exists in all five languages", () => {
  // A key that does not resolve renders as `papp.onbNeedWallet` on the parent's phone, which
  // is worse than the generic sentence it replaced.
  const keys = [
    onboardErrorKey({ error: "address_required" }),
    onboardErrorKey({ error: "invalid_address" }),
    onboardErrorKey({}),
    "papp.onbWalletStep",
    "papp.onbWalletStepSub",
  ];
  for (const lang of ["en", "es", "de", "fr", "pt"] as const) {
    for (const key of keys) expect({ lang, key, has: key in parentLocales[lang] }).toEqual({ lang, key, has: true });
  }
});

// ---- custody is read, not inferred -------------------------------------------

test("the client learns custody from /health at boot, not from a failed create", () => {
  // The first-run screen holds no bearer token, so `state.overview.custody` (the family's own
  // view) does not exist yet and /health is the only source there is. Inferring it from the
  // 400 instead would mean the false copy is shown to every parent at least once, which is
  // the bug rather than the fix.
  const core = readFileSync(new URL("../public/parent/core.js", import.meta.url), "utf8");
  expect(core).toMatch(/state\.custody\s*=\s*h\.custody/);
});
