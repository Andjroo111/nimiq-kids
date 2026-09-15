// Giving a kid their character choice back, and refusing to when it would cost money.
//
// This module's whole job is deciding whether it is safe to FORGET a key. Getting that wrong
// in the permissive direction is unrecoverable: the coordinates are the only way to derive the
// key that can move whatever sits at that address, so a reset over a funded account strands it
// forever. Every test here is therefore about a refusal, except the two that prove the happy
// path actually reopens the picker.
//
// The chain is injected, so the failure modes a real node produces (a stake the basic balance
// does not show, a node that will not answer the staking question, a read that throws) are
// exercised directly rather than hoped about.

import { test, expect, beforeEach } from "bun:test";
import { getDb, initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import { applyRepick, classifyForRepick, repickReport, type ChainDeps } from "./kid-repick";
import { issueCharacterSet } from "./kid-character";

/** A chain that says everything is empty, which is the only state that allows a reset. */
const emptyChain: ChainDeps = {
  getBalance: async () => 0,
  getStakeLuna: async () => 0,
  getTxCount: async () => 0,
};

let fam: repo.Family;
let kid: repo.Child;

beforeEach(() => {
  initTestDb();
  const f = repo.createFamily("Parent", "NQ34 248D M0C9 PFU1 2QM4 PLBG ABCD 7E2F 0001");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid", "🦖");
});

/** Put the kid in the state every pre-picker child is in: coordinates and an address they
 *  never chose. */
function provisioned(address = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000"): repo.Child {
  wrepo.assignKidAccount(kid.id);
  wrepo.setChildAddress(kid.id, address);
  return repo.getChild(kid.id)!;
}

// ---- the happy path ----

test("a kid with an empty derived account is resettable, and the reset reopens the picker", async () => {
  const before = provisioned();
  expect(before.account_index).not.toBeNull();
  // The picker refuses while the account stands. That is the state this module exists to fix.
  expect(await issueCharacterSet(fam, before)).toEqual({ ok: false, error: "already_chosen" });

  const report = await repickReport([before], emptyChain);
  expect(report[0].state).toBe("resettable");
  expect(applyRepick(report)).toEqual([kid.id]);

  const after = repo.getChild(kid.id)!;
  expect(after.account_index).toBeNull();
  expect(after.hd_family_index).toBeNull();
  expect(after.address).toBeNull();
  expect(after.address_source).toBeNull();

  const offer = await issueCharacterSet(fam, after);
  expect(offer.ok).toBe(true);
});

test("the old address is kept as history", async () => {
  const before = provisioned("NQ22 KIDA DDRE SS00 0000 0000 0000 0000 0000");
  applyRepick(await repickReport([before], emptyChain));
  // derived_address is the only record of which account this kid used to be.
  expect(repo.getChild(kid.id)!.derived_address).toBe("NQ22 KIDA DDRE SS00 0000 0000 0000 0000 0000");
});

test("a kid who never had an account is already open, and nothing is written", async () => {
  const report = await repickReport([kid], emptyChain);
  expect(report[0].state).toBe("already_open");
  expect(applyRepick(report)).toEqual([]);
});

// ---- what it must refuse ----

test("a balance blocks the reset", async () => {
  const before = provisioned();
  const chain: ChainDeps = { ...emptyChain, getBalance: async () => 500_000 };
  const v = await classifyForRepick(before, chain);
  expect(v.state).toBe("blocked");
  expect(v.state === "blocked" && v.reason).toEqual({ kind: "funds", balanceLuna: 500_000 });
  expect(applyRepick([v])).toEqual([]);
  expect(repo.getChild(kid.id)!.account_index).not.toBeNull();
});

test("a STAKE blocks the reset even though the basic balance reads zero", async () => {
  // The trap this exists for: in Albatross a stake sits in the staking contract, so a kid who
  // staked everything reads balance 0 and would sail through a balance-only check.
  const before = provisioned();
  const chain: ChainDeps = { ...emptyChain, getStakeLuna: async () => 900_000 };
  const v = await classifyForRepick(before, chain);
  expect(v.state === "blocked" && v.reason).toEqual({ kind: "stake", stakeLuna: 900_000 });
});

test("a node that will not answer the staking question blocks an address WITH history", async () => {
  const before = provisioned();
  const chain: ChainDeps = { ...emptyChain, getStakeLuna: async () => null, getTxCount: async () => 3 };
  const v = await classifyForRepick(before, chain);
  expect(v.state === "blocked" && v.reason).toEqual({ kind: "stake_unverifiable", txCount: 3 });
});

test("a node that will not answer still allows an address with NO history", async () => {
  // Staking IS a transaction, so no history is a real proof of absence rather than a guess.
  const before = provisioned();
  const chain: ChainDeps = { ...emptyChain, getStakeLuna: async () => null, getTxCount: async () => 0 };
  expect((await classifyForRepick(before, chain)).state).toBe("resettable");
});

test("an unreadable balance is not a zero", async () => {
  const before = provisioned();
  const chain: ChainDeps = {
    ...emptyChain,
    getBalance: async () => { throw new Error("rpc_unreachable"); },
  };
  const v = await classifyForRepick(before, chain);
  expect(v.state).toBe("blocked");
  expect(v.state === "blocked" && v.reason.kind).toBe("unreadable");
  expect(applyRepick([v])).toEqual([]);
});

test("a parent-registered address is never reset, even when it is empty", async () => {
  wrepo.setParentOwnedAddress(kid.id, "NQ22 KIDA DDRE SS00 0000 0000 0000 0000 0000", {
    message: "proof", publicKeyHex: "aa", signatureHex: "bb",
  });
  const v = await classifyForRepick(repo.getChild(kid.id)!, emptyChain);
  expect(v.state).toBe("parent_owned");
  expect(applyRepick([v])).toEqual([]);
  expect(repo.getChild(kid.id)!.address_source).toBe("parent");
});

test("coordinates with no recorded address block, because nothing can be checked", async () => {
  wrepo.assignKidAccount(kid.id); // coordinates, deliberately no setChildAddress
  const v = await classifyForRepick(repo.getChild(kid.id)!, emptyChain);
  expect(v.state === "blocked" && v.reason.kind).toBe("no_address");
});

// ---- the reset is not a free re-roll ----

test("a reset kid who picks again is settled again, and cannot be reset twice for free", async () => {
  const before = provisioned();
  applyRepick(await repickReport([before], emptyChain));

  const offer = await issueCharacterSet(fam, repo.getChild(kid.id)!);
  expect(offer.ok).toBe(true);
  // Simulate the pick landing.
  const chosen = offer.ok ? offer.choices[3] : null;
  expect(chosen).not.toBeNull();
  const account = wrepo.claimKidAccountIndex(kid.id, chosen!.index)!;
  wrepo.setChildAddress(kid.id, chosen!.address);

  const after = repo.getChild(kid.id)!;
  expect(after.account_index).toBe(account.index);
  expect(await issueCharacterSet(fam, after)).toEqual({ ok: false, error: "already_chosen" });
});

test("the report is what the apply acts on, so a kid cannot be reset by a later chain read", async () => {
  // The operator approves what they saw. Re-reading the chain inside apply could produce a
  // different answer than the one on screen.
  const before = provisioned();
  const blocked = await repickReport([before], { ...emptyChain, getBalance: async () => 1 });
  expect(applyRepick(blocked)).toEqual([]);
  expect(repo.getChild(kid.id)!.address).not.toBeNull();
});

test("a mixed household resets only the kids that are safe", async () => {
  const sibling = repo.createChild(fam.id, "Sibling", "🐢");
  const a = provisioned("NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  wrepo.assignKidAccount(sibling.id);
  wrepo.setChildAddress(sibling.id, "NQ22 RICH KIDD 0000 0000 0000 0000 0000 0000");

  const chain: ChainDeps = {
    ...emptyChain,
    getBalance: async (address) => (address.startsWith("NQ22 RICH") ? 250_000 : 0),
  };
  const report = await repickReport([a, repo.getChild(sibling.id)!], chain);
  expect(report.map((r) => r.state)).toEqual(["resettable", "blocked"]);
  expect(applyRepick(report)).toEqual([kid.id]);
  expect(repo.getChild(sibling.id)!.account_index).not.toBeNull();
});

test("the reset leaves everything that is not the address alone", async () => {
  const before = provisioned();
  const label = before.label;
  applyRepick(await repickReport([before], emptyChain));
  const after = repo.getChild(kid.id)!;
  expect(after.label).toBe(label);
  expect(after.emoji).toBe("🦖");
  expect(after.family_id).toBe(fam.id);
  // The row still exists and is still the same child; only its account was forgotten.
  expect(getDb().query("SELECT COUNT(*) AS n FROM children WHERE id=?").get(kid.id)).toEqual({ n: 1 });
});
