import { test, expect } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as approvals from "./repo-approvals";
import { settleClaim } from "./routes/cashlinks";

function setup() {
  initTestDb();
  const fam = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(fam.id, { mode: "family" });
  const kid = repo.createChild(fam.id, "Kid 1", "🦖");
  return { fam: repo.getFamily(fam.id)!, kid };
}

test("star ledger and tally stay in step (invariant)", () => {
  const { fam, kid } = setup();
  approvals.addStarEvent(fam.id, kid.id, 3, "routine");
  approvals.addStarEvent(fam.id, kid.id, 2, "chore");
  approvals.addStarEvent(fam.id, kid.id, -5, "payout");
  approvals.addStarEvent(fam.id, kid.id, 4, "routine");
  const child = repo.getChild(kid.id)!;
  expect(child.star_balance).toBe(4);
  expect(approvals.starBalanceFromLedger(kid.id)).toBe(child.star_balance);
});

test("settleClaim on a 'stars' cashlink credits NIM tally but NOT the streak", async () => {
  const { fam, kid } = setup();
  const cl = repo.createCashlink({
    id: crypto.randomUUID(), family_id: fam.id, chore_id: null, child_id: kid.id,
    kind: "stars", cashlink_address: "NQ_S", value_luna: 140_000, message: "⭐ 14 stars",
    url: "u", funding_tx_hash: "h", status: "ready",
  });
  await settleClaim(repo.getCashlink(cl.id)!);
  const child = repo.getChild(kid.id)!;
  expect(child.balance_luna).toBe(140_000);
  expect(child.streak_count).toBe(0); // stars payouts never touch the demo streak mechanic
  expect(repo.getCashlink(cl.id)!.status).toBe("claimed");
});

test("settleClaim on a 'payout' cashlink still advances the streak (demo regression)", async () => {
  const { fam, kid } = setup();
  const chore = repo.createChore(fam.id, kid.id, "Dishes", 500_000);
  const cl = repo.createCashlink({
    id: crypto.randomUUID(), family_id: fam.id, chore_id: chore.id, child_id: kid.id,
    kind: "payout", cashlink_address: "NQ_P", value_luna: 500_000, message: "x",
    url: "u", funding_tx_hash: "h", status: "ready",
  });
  await settleClaim(repo.getCashlink(cl.id)!);
  const child = repo.getChild(kid.id)!;
  expect(child.balance_luna).toBe(500_000);
  expect(child.streak_count).toBe(1);
});
