// Reclaiming an abandoned demo family's NIM (issue #44).
//
// The suite runs in SIM, where the real chain seam is deliberately a no-op, so every test here
// injects its own `ReclaimChain`. That is the seam's whole purpose: the decisions worth pinning
// (whose money may be moved, what counts as a failure, when the sweeper gives up) are ordinary
// logic and should not need a node to exercise.
//
// The one test that does NOT inject is the most important one: reclaim must refuse a household
// that is not a demo family, and it must refuse BEFORE it looks at any chain.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb, getDb } from "./db";
import * as repo from "./repo";
import { mintDemoFamily, sweepDemoFamilies, RECLAIM_GRACE_TTLS } from "./demo-family";
import { reclaimDemoFamily, isDemoFamily, type ReclaimChain } from "./demo-reclaim";
import { childSpendKey, withSpendLock } from "./wallet/spend-lock";

const HOT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const TTL = 24 * 3600_000;

beforeEach(() => { initTestDb(); });

/** A chain where every account holds `balance` and every send succeeds. */
function fakeChain(balance = 10_000_00000, over: Partial<ReclaimChain> = {}): ReclaimChain & {
  sent: { to: string; valueLuna: number }[];
} {
  const sent: { to: string; valueLuna: number }[] = [];
  return {
    sent,
    hotAddress: async () => HOT,
    balanceOf: async () => balance,
    sweepTo: async (_child, to, valueLuna) => { sent.push({ to, valueLuna }); return "tx:fake"; },
    ...over,
  };
}

/** Give every kid in the family a server-derived address, as a real mint does. */
function giveKidsAddresses(familyId: string): repo.Child[] {
  const kids = repo.listChildren(familyId);
  kids.forEach((k, i) => {
    getDb().run(
      "UPDATE children SET address=?, address_source='derived', account_index=? WHERE id=?",
      [`NQ0${i} TEST TEST TEST TEST TEST TEST TEST TES${i}`, i, k.id],
    );
  });
  return repo.listChildren(familyId);
}

test("every kid's balance goes home to the hot wallet", async () => {
  const fam = await mintDemoFamily(HOT);
  const kids = giveKidsAddresses(fam.familyId);
  const chain = fakeChain(7_500_00000);

  const r = await reclaimDemoFamily(fam.familyId, chain);

  expect(r.swept).toBe(kids.length);
  expect(r.failed).toBe(0);
  expect(r.reclaimedLuna).toBe(7_500_00000 * kids.length);
  expect(chain.sent.every((s) => s.to === HOT)).toBe(true);
});

test("it REFUSES a household that is not a demo family, before touching any chain", async () => {
  const real = repo.createFamily("A real household", HOT);
  giveKidsAddresses(real.id);
  expect(isDemoFamily(real.id)).toBe(false);

  const chain = fakeChain();
  // No injected-chain escape hatch: the refusal must come first, so the fake records nothing.
  await expect(reclaimDemoFamily(real.id, chain)).rejects.toThrow("not_a_demo_family");
  expect(chain.sent).toEqual([]);
});

test("a parent-owned address is skipped, never signed for", async () => {
  const fam = await mintDemoFamily(HOT);
  const kids = giveKidsAddresses(fam.familyId);
  // v0.77.0: a kid may hold an address registered from a grown-up's wallet. No key here.
  getDb().run("UPDATE children SET address_source='parent' WHERE id=?", [kids[0]!.id]);

  const chain = fakeChain();
  const r = await reclaimDemoFamily(fam.familyId, chain);

  expect(r.skipped).toBe(1);
  expect(r.swept).toBe(kids.length - 1);
  expect(chain.sent.length).toBe(kids.length - 1);
});

test("an empty account is skipped rather than counted as a failure", async () => {
  const fam = await mintDemoFamily(HOT);
  giveKidsAddresses(fam.familyId);

  const r = await reclaimDemoFamily(fam.familyId, fakeChain(0));

  expect(r.swept).toBe(0);
  expect(r.failed).toBe(0);
  expect(r.skipped).toBeGreaterThan(0);
});

test("one kid failing does not cost the other kid's balance", async () => {
  const fam = await mintDemoFamily(HOT);
  const kids = giveKidsAddresses(fam.familyId);
  expect(kids.length).toBeGreaterThan(1);

  let n = 0;
  const chain = fakeChain(1_000_00000, {
    sweepTo: async (_c, _to, v) => {
      if (n++ === 0) throw new Error("rpc_unreachable");
      return `tx:${v}`;
    },
  });

  const r = await reclaimDemoFamily(fam.familyId, chain);
  expect(r.failed).toBe(1);
  expect(r.swept).toBe(kids.length - 1);
  expect(r.reclaimedLuna).toBe(1_000_00000 * (kids.length - 1));
});

test("no hot address means nothing is swept and everyone counts as failed", async () => {
  const fam = await mintDemoFamily(HOT);
  const kids = giveKidsAddresses(fam.familyId);
  const chain = fakeChain(500_00000, { hotAddress: async () => { throw new Error("down"); } });

  const r = await reclaimDemoFamily(fam.familyId, chain);
  expect(r.swept).toBe(0);
  expect(r.failed).toBe(kids.length);
  expect(chain.sent).toEqual([]);
});

// ---- the sweeper's side of the contract ----

test("the sweeper reclaims BEFORE it purges, and reports the total", async () => {
  const fam = await mintDemoFamily(HOT);
  giveKidsAddresses(fam.familyId);
  getDb().run("UPDATE families SET demo_at=? WHERE id=?", [Date.now() - 48 * 3600_000, fam.familyId]);

  // Proves the ordering: if purge ran first the child rows would be gone and the chain would
  // never be asked for a balance at all.
  let sawLiveFamily = false;
  const chain = fakeChain(2_000_00000, {
    balanceOf: async () => { sawLiveFamily = repo.listChildren(fam.familyId).length > 0; return 2_000_00000; },
  });

  const r = await sweepDemoFamilies(TTL, Date.now(), chain);

  expect(sawLiveFamily).toBe(true);
  expect(r.purged).toBe(1);
  expect(r.reclaimedLuna).toBe(2_000_00000 * 2);
  expect(repo.getFamily(fam.familyId)).toBeNull();
});

test("a failed reclaim HOLDS the household for a retry instead of stranding its NIM", async () => {
  const fam = await mintDemoFamily(HOT);
  giveKidsAddresses(fam.familyId);
  getDb().run("UPDATE families SET demo_at=? WHERE id=?", [Date.now() - 30 * 3600_000, fam.familyId]);

  const broken = fakeChain(900_00000, {
    sweepTo: async () => { throw new Error("rpc_unreachable"); },
  });

  const r = await sweepDemoFamilies(TTL, Date.now(), broken);

  expect(r.held).toBe(1);
  expect(r.purged).toBe(0);
  expect(r.abandoned).toBe(0);
  // Still there, so the next cycle can try again — which is the whole point.
  expect(repo.getFamily(fam.familyId)).not.toBeNull();
});

test("past the grace window it gives up and purges, so the sweeper can never wedge", async () => {
  const fam = await mintDemoFamily(HOT);
  giveKidsAddresses(fam.familyId);
  const wayPast = Date.now() - (RECLAIM_GRACE_TTLS + 1) * TTL;
  getDb().run("UPDATE families SET demo_at=? WHERE id=?", [wayPast, fam.familyId]);

  const broken = fakeChain(900_00000, {
    sweepTo: async () => { throw new Error("rpc_unreachable"); },
  });

  const r = await sweepDemoFamilies(TTL, Date.now(), broken);

  expect(r.held).toBe(0);
  expect(r.purged).toBe(1);
  expect(r.abandoned).toBe(1); // money left behind, and the log says so
  expect(repo.getFamily(fam.familyId)).toBeNull();
});

test("a real household is never reclaimed even when it is old", async () => {
  const real = repo.createFamily("A real household", HOT);
  giveKidsAddresses(real.id);
  // demo_at stays NULL, so it is not a candidate at all.
  const chain = fakeChain();

  const r = await sweepDemoFamilies(TTL, Date.now(), chain);

  expect(r.purged).toBe(0);
  expect(chain.sent).toEqual([]);
  expect(repo.getFamily(real.id)).not.toBeNull();
});

// ---- the sweeper is a door to a kid's money, and takes the same key as every other ----
//
// #126: `reclaimDemoFamily` read a child's balance and swept the whole thing without ever
// taking `childSpendKey(child.id)`, and `purgeFamily` then deleted the rows holding the
// derivation coordinates, also unlocked. spend-lock.ts's own contract names "every door to a
// kid's money"; this was the one outside it. Concretely on the judge demo: a visitor leaves the
// tab open past the TTL and taps Buy in the Treasure Box (which takes the lock via kidSpend)
// while the hourly sweeper reads the pre-spend balance and broadcasts a full sweep. Both read
// the same balance, one broadcast is refused — and the purge follows immediately, so a spend
// still in flight across its awaits has nothing left to sign with.

test("a Treasure Box buy and a reclaim of the same kid cannot interleave", async () => {
  const fam = await mintDemoFamily(HOT);
  const kid = giveKidsAddresses(fam.familyId)[0]!;

  // What the two paths did to each other: `order` records who was inside their own critical
  // section when. Overlapping brackets are the bug.
  // A demo household has two kids; only THIS kid's pair is the race, so the other is filtered
  // out by address rather than by hoping it does not appear.
  const order: string[] = [];
  const chain = fakeChain(5_000_00000, {
    balanceOf: async (address) => {
      if (address === kid.address) {
        order.push("reclaim:read");
        await new Promise((r) => setTimeout(r, 20)); // the RPC round trip the buy raced
      }
      return 5_000_00000;
    },
    sweepTo: async (c, to, valueLuna) => {
      if (c.id === kid.id) order.push("reclaim:send");
      return `tx:${to}:${valueLuna}`;
    },
  });

  const buy = withSpendLock(childSpendKey(kid.id), async () => {
    order.push("buy:read");
    await new Promise((r) => setTimeout(r, 5));
    order.push("buy:send");
  });

  await Promise.all([reclaimDemoFamily(fam.familyId, chain), buy]);

  // Whichever went first, it FINISHED first. Under the old code this read
  // ["reclaim:read", "buy:read", "buy:send", "reclaim:send"] — both against one balance.
  const reclaimFirst = order[0] === "reclaim:read";
  expect(order).toEqual(reclaimFirst
    ? ["reclaim:read", "reclaim:send", "buy:read", "buy:send"]
    : ["buy:read", "buy:send", "reclaim:read", "reclaim:send"]);
});

test("the purge cannot delete a kid's derivation coordinates mid-spend", async () => {
  const fam = await mintDemoFamily(HOT);
  const kid = giveKidsAddresses(fam.familyId)[0]!;
  getDb().run("UPDATE families SET demo_at=? WHERE id=?", [Date.now() - 2 * TTL, fam.familyId]);

  let sawChildDuringSpend: repo.Child | null = null;
  const spend = withSpendLock(childSpendKey(kid.id), async () => {
    await new Promise((r) => setTimeout(r, 30)); // in flight across its awaits
    sawChildDuringSpend = repo.getChild(kid.id); // the row it would sign with
  });

  await Promise.all([sweepDemoFamilies(TTL, Date.now(), fakeChain(0)), spend]);

  // The spend still had its account_index. The purge waited for it, then took the household.
  expect(sawChildDuringSpend).not.toBeNull();
  expect(sawChildDuringSpend!.account_index).not.toBeNull();
  expect(repo.getFamily(fam.familyId)).toBeNull();
});
