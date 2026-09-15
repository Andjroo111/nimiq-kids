// HD kid-account derivation: determinism is the whole point — the DB stores only the path
// coordinates, so the same seed + same coordinates MUST always re-derive the same key/address.
//
// The second thing these tests protect is the LEGACY path. Accounts created before per-family
// scoping derive at m/44'/242'/7'/i' and hold real funds there. If anything here starts failing
// because the legacy shape "looks wrong", the addresses moved and the money is stranded.

import { test, expect } from "bun:test";
import {
  deriveKidKey, deriveKidPrivateKeyHex, derivePrivateKey, familySeed, kidPath, KID_PATH_PREFIX,
} from "./hd";

const seed = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex"); // SLIP-0010 test vector seed
const legacy = (index: number) => ({ index, familyIndex: null });

test("same seed + coordinates -> identical key and address, every time", async () => {
  const a = await deriveKidKey({ index: 3, familyIndex: 1 }, seed);
  const b = await deriveKidKey({ index: 3, familyIndex: 1 }, seed);
  expect(a.privHex).toBe(b.privHex);
  expect(a.address).toBe(b.address);
  expect(a.address.startsWith("NQ")).toBe(true);
});

test("different index -> different key and address", async () => {
  const a = await deriveKidKey(legacy(0), seed);
  const b = await deriveKidKey(legacy(1), seed);
  expect(a.privHex).not.toBe(b.privHex);
  expect(a.address).not.toBe(b.address);
});

test("different seed -> different key at the same coordinates", () => {
  const other = Buffer.from("fffcf9f6f3f0edeae7e4e1dedbd8d5d2", "hex");
  expect(deriveKidPrivateKeyHex(seed, legacy(0))).not.toBe(deriveKidPrivateKeyHex(other, legacy(0)));
});

test("kid path is the Hatch lane m/44'/242'/7' — distinct from nimiq.gift's 0' cashlink lane", () => {
  expect([...KID_PATH_PREFIX]).toEqual([44, 242, 7]);
  const giftLane = derivePrivateKey(seed, [44, 242, 0, 5]).toString("hex");
  const hatchLane = deriveKidPrivateKeyHex(seed, legacy(5));
  expect(hatchLane).not.toBe(giftLane); // same index, different purpose -> different key
});

// ---- per-family scoping ----

test("LEGACY path is frozen: familyIndex null derives at m/44'/242'/7'/i' exactly as before", () => {
  for (const index of [0, 1, 4, 17, 250]) {
    expect(kidPath(legacy(index))).toEqual([44, 242, 7, index]);
    // Independent oracle: the flat path spelled out, with no help from the production helper.
    expect(deriveKidPrivateKeyHex(seed, legacy(index)))
      .toBe(derivePrivateKey(seed, [44, 242, 7, index]).toString("hex"));
  }
});

test("a scoped account inserts the family branch: m/44'/242'/7'/f'/i'", () => {
  expect(kidPath({ index: 2, familyIndex: 9 })).toEqual([44, 242, 7, 9, 2]);
  expect(deriveKidPrivateKeyHex(seed, { index: 2, familyIndex: 9 }))
    .toBe(derivePrivateKey(seed, [44, 242, 7, 9, 2]).toString("hex"));
});

test("the same index in two different families is two different accounts", async () => {
  const famA = await deriveKidKey({ index: 0, familyIndex: 0 }, seed);
  const famB = await deriveKidKey({ index: 0, familyIndex: 1 }, seed);
  expect(famA.privHex).not.toBe(famB.privHex);
  expect(famA.address).not.toBe(famB.address);
});

test("a scoped account never lands on a legacy account's key, even at family index 0", () => {
  const flat = new Set<string>();
  for (let i = 0; i < 40; i++) flat.add(deriveKidPrivateKeyHex(seed, legacy(i)));
  for (let f = 0; f < 4; f++) {
    for (let i = 0; i < 10; i++) {
      expect(flat.has(deriveKidPrivateKeyHex(seed, { index: i, familyIndex: f }))).toBe(false);
    }
  }
});

test("path components are validated: negative / fractional / out-of-range throw", () => {
  expect(() => deriveKidPrivateKeyHex(seed, legacy(-1))).toThrow();
  expect(() => deriveKidPrivateKeyHex(seed, legacy(1.5))).toThrow();
  expect(() => deriveKidPrivateKeyHex(seed, { index: 0, familyIndex: -1 })).toThrow();
  expect(() => deriveKidPrivateKeyHex(seed, { index: 0, familyIndex: 1.5 })).toThrow();
  // 2^31 and up would collide with the hardening bit rather than being a distinct index.
  expect(() => deriveKidPrivateKeyHex(seed, legacy(0x80000000))).toThrow();
  expect(() => deriveKidPrivateKeyHex(seed, { index: 0, familyIndex: 0x80000000 })).toThrow();
});

test("SIM fallback seed is deterministic when HATCH_MASTER_SEED is unset", () => {
  const prev = process.env.HATCH_MASTER_SEED;
  delete process.env.HATCH_MASTER_SEED;
  try {
    // Tests run in SIM (no DEV_PARENT_PRIV) — the dev seed must be stable across calls.
    expect(familySeed().toString("hex")).toBe(familySeed().toString("hex"));
    expect(familySeed().length).toBeGreaterThanOrEqual(16);
  } finally {
    if (prev !== undefined) process.env.HATCH_MASTER_SEED = prev;
  }
});

test("on MAINNET a missing HATCH_MASTER_SEED is fatal, even in SIM — the public dev seed never backs a real account", () => {
  const prevSeed = process.env.HATCH_MASTER_SEED;
  const prevNet = process.env.NIMIQ_NETWORK;
  delete process.env.HATCH_MASTER_SEED;
  process.env.NIMIQ_NETWORK = "main";
  try {
    // SIM is on (no DEV_PARENT_PRIV in the test env), yet the fallback must NOT engage on main:
    // a rotation that drops the hot key would otherwise silently derive every kid from a seed
    // published in this repo.
    expect(() => familySeed()).toThrow(/HATCH_MASTER_SEED not set/);
  } finally {
    if (prevSeed !== undefined) process.env.HATCH_MASTER_SEED = prevSeed;
    if (prevNet !== undefined) process.env.NIMIQ_NETWORK = prevNet;
    else delete process.env.NIMIQ_NETWORK;
  }
});
