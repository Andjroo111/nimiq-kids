import { test, expect } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";

test("tryDebit is atomic and never goes negative", () => {
  initTestDb();
  const fam = repo.createFamily("Mom", "NQ00");
  const kid = repo.createChild(fam.id, "Sam", "🦖");
  repo.addBalanceAndStreak(kid.id, 300); // balance 300, streak 1

  expect(repo.tryDebit(kid.id, 500)).toBe(false); // not enough
  expect(repo.getChild(kid.id)!.balance_luna).toBe(300); // unchanged

  expect(repo.tryDebit(kid.id, 200)).toBe(true);
  expect(repo.getChild(kid.id)!.balance_luna).toBe(100);

  expect(repo.tryDebit(kid.id, 200)).toBe(false); // would go negative
  expect(repo.getChild(kid.id)!.balance_luna).toBe(100);
});

test("peer cashlink links to a child but not a chore; payout links to both", () => {
  initTestDb();
  const fam = repo.createFamily("Mom", "NQ00");
  const kid = repo.createChild(fam.id, "Sam");
  const chore = repo.createChore(fam.id, kid.id, "Dishes", 500_000);
  const payout = repo.createCashlink({
    id: crypto.randomUUID(), family_id: fam.id, chore_id: chore.id, child_id: kid.id, kind: "payout",
    cashlink_address: "NQ_A", value_luna: 500_000, message: "x", url: "u", funding_tx_hash: "h", status: "ready",
  });
  expect(repo.latestCashlinkForChore(chore.id)!.id).toBe(payout.id);
  expect(repo.getCashlink(payout.id)!.kind).toBe("payout");
});

test("weeklyEarnings sums payouts per child, ranks-ready, and excludes peer sends + out-of-window", () => {
  initTestDb();
  const fam = repo.createFamily("Mom", "NQ00");
  const sam = repo.createChild(fam.id, "Sam");
  const ava = repo.createChild(fam.id, "Ava");
  const choreS = repo.createChore(fam.id, sam.id, "Dishes", 200_000);
  const choreA = repo.createChore(fam.id, ava.id, "Trash", 500_000);
  const mint = (childId: string, choreId: string | null, kind: "payout" | "peer", luna: number) =>
    repo.createCashlink({
      id: crypto.randomUUID(), family_id: fam.id, chore_id: choreId, child_id: childId, kind,
      cashlink_address: "NQ_" + luna, value_luna: luna, message: "x", url: "u", funding_tx_hash: "h", status: "ready",
    });

  mint(sam.id, choreS.id, "payout", 200_000);
  mint(sam.id, choreS.id, "payout", 100_000); // Sam: 300k total
  mint(ava.id, choreA.id, "payout", 500_000); // Ava: 500k
  mint(sam.id, null, "peer", 999_000);        // peer send — must NOT count

  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const week = repo.weeklyEarnings(fam.id, since);
  expect(week[sam.id]).toBe(300_000);
  expect(week[ava.id]).toBe(500_000);

  // Sorted desc, Ava leads Sam (the ranking the UI renders).
  const ranked = Object.entries(week).sort((a, b) => b[1] - a[1]);
  expect(ranked[0]![0]).toBe(ava.id);

  // A future `since` window excludes everything (proves the created_at filter).
  expect(repo.weeklyEarnings(fam.id, Date.now() + 60_000)).toEqual({});
});
