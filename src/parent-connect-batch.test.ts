// The arithmetic behind ONE wallet popup for a whole family (public/parent/connect-batch.js).
//
// The server's own rules are tested in src/kid-address-connect.test.ts. This file is about the
// half the server cannot check, because it is what the client ASSERTS: which kid gets which
// derivation path, and whether the batch that came back can honestly be posted at all.
//
// The three that would actually lose money if they regressed:
//
//   slot 0 is never handed to a kid            (it is the family wallet on most households)
//   a slot follows the ROSTER, not the queue   (or a later kid re-derives a sibling's address)
//   order is the mapping, so a count that      (posting anyway files one kid's money under
//   disagrees or a repeated address refuses     another's name, with a valid signature on it)

import { test, expect } from "bun:test";
import {
  assignmentsFrom, connectRefusal, kidKeyPath, offersParentCustody, planConnectBatch,
} from "../public/parent/connect-batch.js";

const kid = (id: string, label: string, addressSource: string | null = "derived") =>
  ({ id, label, addressSource });

// ---- may this instance offer the flow at all --------------------------------

// #415. Under server custody the instance holds every kid's key and signs their sends. Moving
// a kid onto a parent-owned address there answers 409 `parent_signature_required` for every
// kid-initiated outflow from then on (src/wallet/kid-wallet.ts kidOutflowRefusal) and no route
// moves them back. The offer therefore does not exist on such an instance, and this is the
// only thing standing between a demo parent and a one-tap, permanent loss of kid spending.

test("only a parent-custody instance may offer a parent their kids' keys", () => {
  expect(offersParentCustody({ kidCustody: "parent" })).toBe(true);
  expect(offersParentCustody({ kidCustody: "server" })).toBe(false);
});

test("an instance that has not answered is not one to hand keys around on", () => {
  expect(offersParentCustody(null)).toBe(false);
  expect(offersParentCustody(undefined)).toBe(false);
  expect(offersParentCustody({})).toBe(false);
  // Not a boolean, not a truthiness check: an older server sending something else still
  // resolves to no.
  expect(offersParentCustody({ kidCustody: "Parent" })).toBe(false);
  expect(offersParentCustody({ kidCustody: "1" })).toBe(false);
});

// ---- which path each kid is asked for --------------------------------------

test("kids start at slot 1: slot 0 is the family wallet on most households", () => {
  const plan = planConnectBatch([kid("a", "Ivy"), kid("b", "Sam")]);
  expect(plan.map((p) => p.keyPath)).toEqual(["m/44'/242'/0'/1'", "m/44'/242'/0'/2'"]);
  expect(plan.map((p) => p.childId)).toEqual(["a", "b"]);
  expect(kidKeyPath(0)).toBe("m/44'/242'/0'/0'"); // reachable, never planned
});

test("a kid already on a parent-owned address is left out but still SPENDS their slot", () => {
  // Ivy registered months ago through the per-child flow. Sam and Max are new. If the slots
  // packed down to 1 and 2, Sam would be handed the address Ivy already holds and the server
  // would refuse the whole batch for a duplicate nobody can see.
  const plan = planConnectBatch([
    kid("a", "Ivy", "parent"), kid("b", "Sam"), kid("c", "Max"),
  ]);
  expect(plan.map((p) => p.childId)).toEqual(["b", "c"]);
  expect(plan.map((p) => p.keyPath)).toEqual(["m/44'/242'/0'/2'", "m/44'/242'/0'/3'"]);
});

test("a family already fully registered plans nothing", () => {
  expect(planConnectBatch([kid("a", "Ivy", "parent"), kid("b", "Sam", "parent")])).toEqual([]);
});

test("a child row with no id is skipped rather than planned onto a path", () => {
  const plan = planConnectBatch([{ label: "ghost", addressSource: "derived" }, kid("b", "Sam")]);
  expect(plan.map((p) => p.childId)).toEqual(["b"]);
  // Sam keeps roster slot 2 even though the row in front of him was unusable.
  expect(plan[0]!.keyPath).toBe("m/44'/242'/0'/2'");
});

test("labels ride along, because the sheet names the kids the popup is about", () => {
  expect(planConnectBatch([kid("a", "Ivy"), kid("b", "Sam")]).map((p) => p.label))
    .toEqual(["Ivy", "Sam"]);
});

// ---- turning the wallet's answer into a post -------------------------------

const sig = (signer: string) => ({ signer, publicKeyHex: "aa", signatureHex: "bb" });

test("signatures map to children BY ORDER, which is the whole assertion", () => {
  const plan = planConnectBatch([kid("a", "Ivy"), kid("b", "Sam")]);
  const built = assignmentsFrom(plan, [sig("NQ11 AAAA"), sig("NQ22 BBBB")]);
  if (!built.ok) throw new Error(`refused: ${built.error}`);
  expect(built.assignments).toEqual([
    { childId: "a", keyPath: "m/44'/242'/0'/1'", address: "NQ11 AAAA", publicKeyHex: "aa", signatureHex: "bb" },
    { childId: "b", keyPath: "m/44'/242'/0'/2'", address: "NQ22 BBBB", publicKeyHex: "aa", signatureHex: "bb" },
  ]);
});

test("fewer signatures than paths refuses, and says both numbers", () => {
  const plan = planConnectBatch([kid("a", "Ivy"), kid("b", "Sam"), kid("c", "Max")]);
  const built = assignmentsFrom(plan, [sig("NQ11 AAAA"), sig("NQ22 BBBB")]);
  expect(built).toEqual({ ok: false, error: "signature_count", want: 3, got: 2 });
});

test("more signatures than paths refuses too: the index no longer means what we think", () => {
  const plan = planConnectBatch([kid("a", "Ivy")]);
  expect(assignmentsFrom(plan, [sig("NQ11 AAAA"), sig("NQ22 BBBB")]))
    .toEqual({ ok: false, error: "signature_count", want: 1, got: 2 });
});

test("two paths that came back as the SAME address refuses", () => {
  // Two kids on one address pools their money and shows both the same balance. The server
  // refuses it as well, but only after a popup the parent has already paid for.
  const plan = planConnectBatch([kid("a", "Ivy"), kid("b", "Sam")]);
  expect(assignmentsFrom(plan, [sig("NQ11 AAAA"), sig("NQ11 AAAA")]))
    .toEqual({ ok: false, error: "signature_repeat", childId: "b" });
});

test("the same address in a different spacing or case is still the same address", () => {
  const plan = planConnectBatch([kid("a", "Ivy"), kid("b", "Sam")]);
  expect(assignmentsFrom(plan, [sig("NQ11 AAAA"), sig("nq11aaaa")]))
    .toEqual({ ok: false, error: "signature_repeat", childId: "b" });
});

test("a signature missing any of its three parts refuses and names the child", () => {
  const plan = planConnectBatch([kid("a", "Ivy"), kid("b", "Sam")]);
  for (const broken of [
    { signer: "", publicKeyHex: "aa", signatureHex: "bb" },
    { signer: "NQ22 BBBB", publicKeyHex: "", signatureHex: "bb" },
    { signer: "NQ22 BBBB", publicKeyHex: "aa", signatureHex: "" },
    {},
  ]) {
    expect(assignmentsFrom(plan, [sig("NQ11 AAAA"), broken]))
      .toEqual({ ok: false, error: "signature_missing", childId: "b" });
  }
});

test("no signatures at all is a count refusal, not an empty post", () => {
  const plan = planConnectBatch([kid("a", "Ivy"), kid("b", "Sam")]);
  expect(assignmentsFrom(plan, [])).toEqual({ ok: false, error: "signature_count", want: 2, got: 0 });
  expect(assignmentsFrom(plan, null)).toEqual({ ok: false, error: "signature_count", want: 2, got: 0 });
});

// ---- what the parent is told when it does not go through -------------------

const NAMES: Record<string, string> = { a: "Ivy", b: "Sam" };
const say = (data: unknown) =>
  connectRefusal(data, { nameOf: (id: string) => NAMES[id] ?? "", nim: (l: number) => String(l / 1e5) });

test("every server refusal has its own sentence, never a bare fallback", () => {
  const errors = [
    "address_is_the_family_wallet", "duplicate_address", "address_taken", "proof_invalid",
    "funds_at_old_address", "challenge_expired", "challenge_used", "balance_check_failed",
  ];
  for (const error of errors) {
    expect(`${error}:${say({ error }).key}`).not.toBe(`${error}:papp.cbNothingSetUp`);
  }
});

test("a refusal that names a child is rendered with that child's own name", () => {
  expect(say({ error: "address_taken", childId: "a", byLabel: "Sam" }))
    .toEqual({ key: "papp.cbTaken", params: { name: "Ivy", other: "Sam" } });
});

test("an amount is formatted by the app's own NIM formatter, never printed as luna", () => {
  expect(say({ error: "funds_at_old_address", childId: "b", balanceLuna: 250_000 }))
    .toEqual({ key: "papp.cbOldHasFunds", params: { name: "Sam", amount: "2.5" } });
});

test("an expired or reused challenge reuses the per-child wording rather than a second one", () => {
  expect(say({ error: "challenge_expired" }).key).toBe("papp.addrExpired");
  expect(say({ error: "challenge_used" }).key).toBe("papp.addrExpired");
});

test("the client's own refusals carry the numbers the wallet disagreed by", () => {
  expect(say({ error: "signature_count", want: 3, got: 2 }))
    .toEqual({ key: "papp.cbCountMismatch", params: { got: 2, want: 3 } });
  expect(say({ error: "signature_repeat", childId: "b" }).key).toBe("papp.cbSameAddress");
  expect(say({ error: "signature_missing", childId: "b" }).key).toBe("papp.cbIncomplete");
});

test("an unknown or absent error still says nothing was set up", () => {
  expect(say({ error: "something_new" }).key).toBe("papp.cbNothingSetUp");
  expect(say(undefined).key).toBe("papp.cbNothingSetUp");
  expect(say({}).key).toBe("papp.cbNothingSetUp");
});

test("connectRefusal works with no options at all (no DOM, no i18n, no formatter)", () => {
  expect(connectRefusal({ error: "address_taken", childId: "a", byLabel: "Sam" }))
    .toEqual({ key: "papp.cbTaken", params: { name: "", other: "Sam" } });
});

// ---- the copy the flow reaches for actually exists -------------------------

test("every key connectRefusal can return is a real parent string in all five locales", async () => {
  const { parentLocales } = await import("./locales/parent");
  const keys = [
    "signature_count", "signature_repeat", "signature_missing", "address_is_the_family_wallet",
    "duplicate_address", "address_taken", "proof_invalid", "funds_at_old_address",
    "challenge_expired", "challenge_used", "balance_check_failed", "anything_else",
  ].map((error) => say({ error }).key);
  // The screen's own strings too: a missing one renders the raw key at the parent.
  keys.push("papp.cbRow", "papp.cbRowSub", "papp.cbTitle", "papp.cbSub",
    "papp.cbGo", "papp.cbWorking", "papp.cbDone");
  for (const lang of ["en", "es", "de", "fr", "pt"] as const) {
    for (const key of keys) expect(`${lang}:${key}`).toBe(`${lang}:${parentLocales[lang]![key] ? key : "MISSING"}`);
  }
});

test("the count is in the copy, because the Keyguard's consent screen names it", () => {
  // "nimiq.kids is requesting access to N addresses" is the very next screen. Any language
  // whose button or sub drops {count} leaves the parent reconciling our number with theirs.
  const { parentLocales } = require("./locales/parent") as typeof import("./locales/parent");
  for (const lang of ["en", "es", "de", "fr", "pt"] as const) {
    for (const key of ["papp.cbGo", "papp.cbSub", "papp.cbRowSub", "papp.cbWorking", "papp.cbDone"]) {
      expect(`${lang}:${key}:${parentLocales[lang]![key]}`).toContain("{count}");
    }
  }
});
