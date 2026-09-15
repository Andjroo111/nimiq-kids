// An unstake is only "returned" when the chain has actually given the NIM back.
//
// settlePendingUnstakes used to mark the event done the moment retire+remove BROADCAST.
// The node accepts both from an account with no retired stake and fails them at execution
// (verified on the live testnet 2026-07-31), so a successful broadcast proves nothing.
//
// The consequence was worse than for a stake. stakedFromLedger already subtracts a pending
// unstake, and off-SIM spendable comes from the chain — so on a failed retire+remove the
// amount left the staked total, never arrived in spendable, and disappeared from the kid's
// screen entirely. Money that is neither staked nor spendable.
//
// A failed unstake is therefore RETRIED, never written off: the NIM is still sitting in the
// staking contract, so "still staked, try again" is the only honest state.
//
// THE SECOND CORRECTION (#135): the replacement check asked whether the kid's BALANCE had
// risen by at least the unstaked amount, which is not a question about the unstake at all.
// Chore payouts land in that same account, the unstake amount is kid-chosen and can be tiny,
// and the earlier version of this file ASSERTED THE MASKED CASE AS CORRECT — "a larger rise
// than expected still counts (an earn landed in the same window)" is precisely the case where
// the earn, not the unstake, moved the balance. That test is deleted rather than adapted.
// Only the remove transaction's own receipt belongs to this unstake and to nothing else.

import { test, expect } from "bun:test";
import type { EarnReceipt } from "./wallet/earn-settlement";
import { unstakeSettleDecision, UNSTAKE_RETRY_AFTER_MS } from "./wallet/kid-staking";

const AGED = { attemptAgeMs: 999_999_999 };
const FRESH = { attemptAgeMs: 1_000 };

// ---- the rule ----

test("only the remove transaction's own receipt says returned", () => {
  expect(unstakeSettleDecision({ receipt: "executed", ...FRESH })).toBe("returned");
  expect(unstakeSettleDecision({ receipt: "executed", ...AGED })).toBe("returned");
});

test("no attempt recorded yet means broadcast one", () => {
  expect(unstakeSettleDecision({ receipt: null, attemptAgeMs: 0 })).toBe("retry");
});

test("included-and-FAILED is the documented shape, and it retries — it is never written off", () => {
  // The node accepts retire+remove from an account with no retired stake and fails them at
  // execution. This is the case the whole check exists to catch.
  expect(unstakeSettleDecision({ receipt: "rejected", ...FRESH, retryAfterMs: 600_000 })).toBe("wait");
  expect(unstakeSettleDecision({ receipt: "rejected", ...AGED, retryAfterMs: 600_000 })).toBe("retry");
});

test("a broadcast that never lands waits, then retries", () => {
  expect(unstakeSettleDecision({ receipt: "unknown", ...FRESH, retryAfterMs: 600_000 })).toBe("wait");
  expect(unstakeSettleDecision({ receipt: "unknown", ...AGED, retryAfterMs: 600_000 })).toBe("retry");
});

test("a node outage decides nothing — not returned, and not a blind re-sign either", () => {
  for (const attemptAgeMs of [1_000, 999_999_999]) {
    expect(unstakeSettleDecision({ receipt: "unavailable", attemptAgeMs })).toBe("wait");
  }
});

test("'executed' is the only door to returned — every other answer keeps the NIM staked", () => {
  const answers: EarnReceipt[] = ["rejected", "unknown", "unavailable"];
  for (const receipt of answers) {
    for (const attemptAgeMs of [1_000, 999_999_999]) {
      expect(unstakeSettleDecision({ receipt, attemptAgeMs })).not.toBe("returned");
    }
  }
});

test("the retry window is generous by default — duplicate retire/remove is free at 0 fees", () => {
  expect(UNSTAKE_RETRY_AFTER_MS).toBeGreaterThanOrEqual(60_000);
});

// ---- the settle loop, driven through the receipt seam ----
//
// It has to run in a subprocess: SIM is a module-level constant computed at import
// (`!process.env.DEV_PARENT_PRIV`), and settlePendingUnstakes short-circuits to "done" under
// SIM because there is no chain to fail. The same reason src/mainnet-guards.test.ts spawns.
// No node is needed — _setUnstakeReceiptReader intercepts the only chain read these cases
// reach, and none of them decides "retry", which is the branch that would sign and broadcast.

/** Run one settle scenario off-SIM and return what it observed. */
async function settleScenario(receipt: EarnReceipt, nowMs: number): Promise<{
  settled: number; status: string; pendingUnstake: number; attemptKept: boolean; reads: number;
  settledAgain: number;
}> {
  const program = `
const { initTestDb } = await import("./src/db.ts");
const repo = await import("./src/repo.ts");
const wrepo = await import("./src/repo-wallet.ts");
const staking = await import("./src/wallet/kid-staking.ts");

initTestDb();
const fam = repo.createFamily("Dad", "NQ07 1111 1111 1111 1111 1111 1111 1111 1111");
const kid = repo.createChild(fam.id, "Ada", "K");
const ev = wrepo.addWalletEvent({
  familyId: fam.id, childId: kid.id, kind: "unstake", valueLuna: 10000000,
  txHash: "a".repeat(64), status: "pending", availableAt: 1,
});
// The attempt record the retry branch writes once retire+remove is on the wire.
wrepo.setWalletState("unstake_check:" + ev.id, JSON.stringify({ at: 1 }));
// An unrelated 2 NIM chore payout lands in the SAME account. Under the balance rule this was
// more than enough to satisfy "the balance rose by the unstaked amount", and it confirmed the
// wrong thing — irreversibly, because settling wipes the attempt record.
wrepo.addWalletEvent({
  familyId: fam.id, childId: kid.id, kind: "earn",
  valueLuna: 200000, txHash: "b".repeat(64), status: "done",
});

let reads = 0;
staking._setUnstakeReceiptReader(async (h) => { if (h) reads++; return ${JSON.stringify(receipt)}; });
const settled = await staking.settlePendingUnstakes(repo.getChild(kid.id), ${nowMs});
const settledAgain = await staking.settlePendingUnstakes(repo.getChild(kid.id), ${nowMs});
console.log("OUT:" + JSON.stringify({
  settled, settledAgain, reads,
  status: wrepo.getWalletEvent(ev.id).status,
  pendingUnstake: wrepo.pendingUnstakeFromLedger(kid.id),
  attemptKept: wrepo.getWalletState("unstake_check:" + ev.id) !== null,
}));
`;
  const proc = Bun.spawn({
    cmd: [process.execPath, "-e", program],
    // A hot-wallet key is all SIM looks at; nothing here signs or reaches a node.
    env: { ...process.env, NIMIQ_SIM: "", DEV_PARENT_PRIV: "0".repeat(64), NIMIQ_RPC_URL: "" },
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const line = out.split("\n").find((l) => l.startsWith("OUT:"));
  if (!line) throw new Error(`scenario produced no output: ${err}`);
  return JSON.parse(line.slice(4));
}

test("an unrelated chore payout landing in the same account does NOT confirm the unstake", async () => {
  // The remove itself was included and failed at execution. Nothing else may overrule that,
  // and the 2 NIM earn sitting in the same account is not evidence about this unstake at all.
  const r = await settleScenario("rejected", 2);
  expect(r.settled).toBe(0);
  expect(r.status).toBe("pending");
  expect(r.pendingUnstake).toBe(10_000_000);
  // The attempt record survives, so a later pass still retries. The old code cleared it.
  expect(r.attemptKept).toBe(true);
});

test("the remove executing is what settles it, keyed on that transaction's own hash", async () => {
  const r = await settleScenario("executed", 2);
  expect(r.settled).toBe(10_000_000);
  expect(r.status).toBe("done");
  expect(r.pendingUnstake).toBe(0);
  // Deleted, not blanked: "" reads back indistinguishably from a key never written.
  expect(r.attemptKept).toBe(false);
  expect(r.settledAgain).toBe(0); // exactly once
  expect(r.reads).toBe(1); // the hash was read, and only for the one pass that needed it
});

test("a node that cannot answer settles nothing, however long it has been", async () => {
  const r = await settleScenario("unavailable", 999_999_999);
  expect(r.settled).toBe(0);
  expect(r.status).toBe("pending");
  expect(r.attemptKept).toBe(true);
});

test("a cooldown that has not passed is not looked up at all", async () => {
  const r = await settleScenario("executed", 0); // available_at is 1
  expect(r.settled).toBe(0);
  expect(r.reads).toBe(0);
  expect(r.status).toBe("pending");
});
