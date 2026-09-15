// The boot guard is the thing that turns "every kid balance is zero" from an assumption into
// a checked fact, so the interesting tests are all about the ways it could WRONGLY pass.

import { test, expect } from "bun:test";
import {
  custodyMode, formatBootReport, parentCustodyBootReport, type DerivedKidRow,
} from "./custody-boot";

const kid = (over: Partial<DerivedKidRow> = {}): DerivedKidRow => ({
  id: "c1", label: "Ivy", familyId: "f1", address: "NQ11 AAAA", accountIndex: 0, ...over,
});

const run = (opts: {
  env?: Record<string, string | undefined>;
  kids?: DerivedKidRow[];
  getBalance?: (a: string) => Promise<number>;
  getStakeLuna?: (a: string) => Promise<number | null>;
  getTxCount?: (a: string) => Promise<number>;
  hotWalletSnapshotLuna?: () => number | null;
}) => parentCustodyBootReport({
  // Default: a swept (or never-funded) hot wallet, so the other cases stay readable.
  hotWalletSnapshotLuna: opts.hotWalletSnapshotLuna ?? (() => 0),
  env: opts.env ?? {},
  listDerivedKids: () => opts.kids ?? [],
  getBalance: opts.getBalance ?? (async () => 0),
  // Default: a node that ANSWERS and reports no staker. The interesting cases override it.
  getStakeLuna: opts.getStakeLuna ?? (async () => 0),
  getTxCount: opts.getTxCount ?? (async () => 0),
});

// ---- the mode switch ----

test("custody mode defaults to server, and only the exact value flips it", () => {
  expect(custodyMode({})).toBe("server");
  expect(custodyMode({ HATCH_CUSTODY: "parent" })).toBe("parent");
  expect(custodyMode({ HATCH_CUSTODY: "server" })).toBe("server");
  // Near misses stay on the old behaviour rather than half-applying a custody change.
  expect(custodyMode({ HATCH_CUSTODY: "Parent" })).toBe("server");
  expect(custodyMode({ HATCH_CUSTODY: "1" })).toBe("server");
  expect(custodyMode({ HATCH_CUSTODY: "" })).toBe("server");
});

// ---- keys ----

test("a live signing key blocks the boot, and names which one", async () => {
  const seed = await run({ env: { HATCH_MASTER_SEED: "abc" } });
  expect(seed.ok).toBe(false);
  expect(seed.problems).toEqual([{ kind: "key_present", name: "HATCH_MASTER_SEED" }]);

  const priv = await run({ env: { DEV_PARENT_PRIV: "abc" } });
  expect(priv.problems).toEqual([{ kind: "key_present", name: "DEV_PARENT_PRIV" }]);

  const both = await run({ env: { HATCH_MASTER_SEED: "a", DEV_PARENT_PRIV: "b" } });
  expect(both.problems).toHaveLength(2);
});

test("an empty or whitespace key is treated as unset, not as a live key", async () => {
  // Blanking a variable is how people unset one in a deploy config. Refusing that boot
  // would be a refusal with nothing behind it.
  const report = await run({ env: { HATCH_MASTER_SEED: "", DEV_PARENT_PRIV: "   " } });
  expect(report.ok).toBe(true);
});

// ---- balances ----

test("a clean instance with empty derived accounts passes and counts them", async () => {
  const report = await run({ kids: [kid(), kid({ id: "c2", label: "Max", address: "NQ22 BBBB" })] });
  expect(report.ok).toBe(true);
  expect(report.checkedEmpty).toBe(2);
});

test("NIM still sitting at a derived address blocks the boot", async () => {
  const report = await run({ kids: [kid()], getBalance: async () => 5_000 });
  expect(report.ok).toBe(false);
  expect(report.problems[0]).toMatchObject({ kind: "funds_at_derived_address", balanceLuna: 5_000 });
});

test("A BALANCE THAT COULD NOT BE READ IS NOT A ZERO", async () => {
  // The whole guard is worthless if a flaky RPC reads as an empty account. The safe
  // direction here is the opposite of topUpExecuted's: there a failed read must not look
  // like a confirmation, here it must not look like an all-clear.
  const report = await run({ kids: [kid()], getBalance: async () => { throw new Error("ECONNREFUSED"); } });
  expect(report.ok).toBe(false);
  expect(report.problems[0]).toMatchObject({ kind: "balance_unreadable", detail: "ECONNREFUSED" });
  expect(report.checkedEmpty).toBe(0);
});

test("a derived kid with no recorded address blocks rather than passing unchecked", async () => {
  const report = await run({ kids: [kid({ address: null })] });
  expect(report.ok).toBe(false);
  expect(report.problems[0]).toMatchObject({ kind: "derived_kid_without_address" });
});

test("one bad kid among many still reports the good ones as checked", async () => {
  const report = await run({
    kids: [kid(), kid({ id: "c2", address: "NQ22 BBBB" }), kid({ id: "c3", address: "NQ33 CCCC" })],
    getBalance: async (a) => (a === "NQ22 BBBB" ? 1 : 0),
  });
  expect(report.ok).toBe(false);
  expect(report.problems).toHaveLength(1);
  expect(report.checkedEmpty).toBe(2);
});

test("problems come back in row order, so the worklist can be diffed between runs", async () => {
  const kids = [kid({ id: "a" }), kid({ id: "b" }), kid({ id: "c" })];
  const report = await run({ kids, getBalance: async () => 1 });
  expect(report.problems.map((p) => (p.kind === "funds_at_derived_address" ? p.kid.id : ""))).toEqual(["a", "b", "c"]);
});

// ---- stakes: the money a zero balance does not rule out ----

test("A ZERO BALANCE WITH A LIVE STAKE BLOCKS THE BOOT", async () => {
  // The bug this guard shipped with. A stake lives in the staking contract, not in the basic
  // account, so the kid reads `balance: 0` while really holding NIM that only the seed-derived
  // key can ever move. Passing here means deleting the seed strands it permanently.
  const report = await run({ kids: [kid()], getBalance: async () => 0, getStakeLuna: async () => 7_000 });
  expect(report.ok).toBe(false);
  expect(report.problems[0]).toMatchObject({ kind: "stake_at_derived_address", stakeLuna: 7_000 });
  expect(report.checkedEmpty).toBe(0);
});

test("a stake counts active, inactive and retired luna as one total", async () => {
  // Retired and cooling-down stake is just as unreachable without the key as active stake.
  const report = await run({ kids: [kid()], getStakeLuna: async () => 1 });
  expect(report.ok).toBe(false);
});

test("no staker RPC and no transaction history passes, because that is a real proof", async () => {
  // The live mainnet endpoint answers `method not supported: getStakerByAddress`, so this is
  // the ORDINARY path, not an edge case. Staking requires sending a transaction, so an address
  // with no history has provably never staked and the guard can honestly clear it.
  const report = await run({ kids: [kid()], getStakeLuna: async () => null, getTxCount: async () => 0 });
  expect(report.ok).toBe(true);
  expect(report.checkedEmpty).toBe(1);
});

test("NO STAKER RPC PLUS ANY HISTORY REFUSES RATHER THAN GUESSING", async () => {
  // Nothing here proves absence: the node will not discuss stakers and the address has done
  // something. "Probably nothing" is exactly the assumption that strands the money.
  const report = await run({ kids: [kid()], getStakeLuna: async () => null, getTxCount: async () => 3 });
  expect(report.ok).toBe(false);
  expect(report.problems[0]).toMatchObject({ kind: "stake_unverifiable", txCount: 3 });
});

test("a stake read that throws is not a zero either", async () => {
  const report = await run({
    kids: [kid()],
    getStakeLuna: async () => { throw new Error("ECONNREFUSED"); },
  });
  expect(report.ok).toBe(false);
  expect(report.problems[0]).toMatchObject({ kind: "balance_unreadable" });
});

test("history is only consulted when the node refused the staker question", async () => {
  // A node that answered "no staker" has settled it. Going on to refuse a kid for merely
  // having transacted would block every instance that has ever paid a chore.
  let asked = 0;
  const report = await run({
    kids: [kid()],
    getStakeLuna: async () => 0,
    getTxCount: async () => { asked++; return 99; },
  });
  expect(report.ok).toBe(true);
  expect(asked).toBe(0);
});

// ---- the hot wallet, whose only key parent custody deletes ----

test("A FUNDED HOT WALLET BLOCKS THE FLIP, BECAUSE DEV_PARENT_PRIV IS ITS ONLY KEY", async () => {
  // The kid checks cover the kid side. This is the other pot: removing DEV_PARENT_PRIV is
  // also a demolition order for whatever the shared wallet still holds.
  const report = await run({ hotWalletSnapshotLuna: () => 100_000 });
  expect(report.ok).toBe(false);
  expect(report.problems[0]).toMatchObject({ kind: "hot_wallet_last_seen_funded", snapshotLuna: 100_000 });
});

test("a never-taken snapshot is unknown, not empty, and does not block a clean boot", async () => {
  // SIM instances, fresh databases and tests have no snapshot and no hot wallet to lose.
  // Refusing on null would block every one of them.
  const report = await run({ hotWalletSnapshotLuna: () => null });
  expect(report.ok).toBe(true);
});

test("the hot wallet is checked whether or not the key is still there", async () => {
  // Both orderings matter, and they are different situations rather than one being moot.
  const before = await run({ env: { DEV_PARENT_PRIV: "abc" }, hotWalletSnapshotLuna: () => 5 });
  expect(before.problems).toContainEqual(
    { kind: "hot_wallet_last_seen_funded", snapshotLuna: 5, keyStillPresent: true },
  );

  const after = await run({ hotWalletSnapshotLuna: () => 5 });
  expect(after.problems).toContainEqual(
    { kind: "hot_wallet_last_seen_funded", snapshotLuna: 5, keyStillPresent: false },
  );
});

test("the two orderings are worded differently, because one is still fixable cheaply", async () => {
  const stillTime = formatBootReport(
    await run({ env: { DEV_PARENT_PRIV: "abc" }, hotWalletSnapshotLuna: () => 5 }),
  );
  expect(stillTime).toContain("while the key still exists");

  const tooLate = formatBootReport(await run({ hotWalletSnapshotLuna: () => 5 }));
  expect(tooLate).toContain("ALREADY GONE");
  // The way out is a key restore, and the message has to say so or the operator concludes
  // the money is simply gone and stops looking.
  expect(tooLate).toContain("Restore the key");
});

// ---- the message ----

test("the refusal names the address, the amount and what to do", async () => {
  const report = await run({
    env: { HATCH_MASTER_SEED: "x" },
    kids: [kid({ label: "Ivy", address: "NQ11 AAAA" })],
    getBalance: async () => 42,
  });
  const text = formatBootReport(report);
  expect(text).toContain("HATCH_MASTER_SEED");
  expect(text).toContain("NQ11 AAAA");
  expect(text).toContain("42 luna");
  expect(text).toContain("Ivy");
  // The way out has to be in the message: someone reading a crashed boot at night should
  // not have to find a runbook to get the instance back up.
  expect(text).toContain("Unset HATCH_CUSTODY");
});

test("the stake refusals say what to do about a stake specifically", async () => {
  const staked = formatBootReport(await run({ kids: [kid()], getStakeLuna: async () => 7_000 }));
  expect(staked).toContain("7000 luna STAKED");
  // Sweeping a basic balance is one transaction; a stake is a three-step unwind, and the
  // message has to say so or the operator will try the wrong thing.
  expect(staked).toContain("retire");
  expect(staked).toContain("NQ11 AAAA");

  const unsure = formatBootReport(
    await run({ kids: [kid()], getStakeLuna: async () => null, getTxCount: async () => 2 }),
  );
  expect(unsure).toContain("does not implement staker reads");
  expect(unsure).toContain("getStakerByAddress");
});
