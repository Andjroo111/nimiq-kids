// Streak-bonus mechanics (#17), no network — exercises the real SimProvider + cashlink mint +
// repo settlement. Surfacing is Andjroo's call; this covers the money-path mechanic only.
import { test, expect } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import { SimProvider } from "./wallet/sim-provider";
import {
  isStreakMilestone,
  maybeMintStreakBonus,
  settleClaim,
  STREAK_MILESTONE_EVERY,
  STREAK_BONUS_LUNA,
} from "./routes/cashlinks";

test("isStreakMilestone lands only on exact multiples (never on zero)", () => {
  expect(isStreakMilestone(0)).toBe(false);
  expect(isStreakMilestone(STREAK_MILESTONE_EVERY - 1)).toBe(false);
  expect(isStreakMilestone(STREAK_MILESTONE_EVERY)).toBe(true);
  expect(isStreakMilestone(STREAK_MILESTONE_EVERY * 2)).toBe(true);
  expect(isStreakMilestone(5, 0)).toBe(false); // disabled when interval <= 0
});

test("maybeMintStreakBonus mints a bonus cashlink exactly at a milestone, not before", async () => {
  initTestDb();
  const provider = new SimProvider();
  const fam = repo.createFamily("Mom", await provider.getAddress());
  const kid = repo.createChild(fam.id, "Sam", "🦖");

  // Walk the streak up to one short of a milestone.
  for (let i = 0; i < STREAK_MILESTONE_EVERY - 1; i++) repo.addBalanceAndStreak(kid.id, 10_000);
  expect(await maybeMintStreakBonus(fam.id, kid.id, provider)).toBeNull(); // not a milestone yet
  expect(repo.listCashlinksForChild(kid.id).some((cl) => cl.kind === "bonus")).toBe(false);

  // The completion that lands on the milestone.
  repo.addBalanceAndStreak(kid.id, 10_000);
  const bonusId = await maybeMintStreakBonus(fam.id, kid.id, provider);
  expect(bonusId).not.toBeNull();
  const bonus = repo.getCashlink(bonusId!)!;
  expect(bonus.kind).toBe("bonus");
  expect(bonus.value_luna).toBe(STREAK_BONUS_LUNA);
  expect(bonus.chore_id).toBeNull();
  expect(bonus.child_id).toBe(kid.id);
});

test("claiming a bonus credits the tally but does NOT advance the streak (no cascade)", async () => {
  initTestDb();
  const provider = new SimProvider();
  const fam = repo.createFamily("Mom", await provider.getAddress());
  const kid = repo.createChild(fam.id, "Sam");
  for (let i = 0; i < STREAK_MILESTONE_EVERY; i++) repo.addBalanceAndStreak(kid.id, 10_000);
  const bonusId = (await maybeMintStreakBonus(fam.id, kid.id, provider))!;

  const before = repo.getChild(kid.id)!;
  await settleClaim(repo.getCashlink(bonusId)!);
  const after = repo.getChild(kid.id)!;

  expect(after.balance_luna).toBe(before.balance_luna + STREAK_BONUS_LUNA); // credited
  expect(after.streak_count).toBe(before.streak_count); // streak untouched
  expect(repo.getCashlink(bonusId)!.status).toBe("claimed");
});

test("weeklyEarnings counts bonuses alongside chore/lesson payouts", async () => {
  initTestDb();
  const provider = new SimProvider();
  const fam = repo.createFamily("Mom", await provider.getAddress());
  const kid = repo.createChild(fam.id, "Sam");
  const chore = repo.createChore(fam.id, kid.id, "Dishes", 200_000);
  repo.createCashlink({
    id: crypto.randomUUID(), family_id: fam.id, chore_id: chore.id, child_id: kid.id, kind: "payout",
    cashlink_address: "NQ_P", value_luna: 200_000, message: "x", url: "u", funding_tx_hash: "h", status: "ready",
  });
  for (let i = 0; i < STREAK_MILESTONE_EVERY; i++) repo.addBalanceAndStreak(kid.id, 10_000);
  await maybeMintStreakBonus(fam.id, kid.id, provider);

  const week = repo.weeklyEarnings(fam.id, Date.now() - 7 * 24 * 60 * 60 * 1000);
  expect(week[kid.id]).toBe(200_000 + STREAK_BONUS_LUNA); // payout + bonus
});

test("resetStreak breaks the streak back to zero", () => {
  initTestDb();
  const fam = repo.createFamily("Mom", "NQ00");
  const kid = repo.createChild(fam.id, "Sam");
  repo.addBalanceAndStreak(kid.id, 10_000);
  repo.addBalanceAndStreak(kid.id, 10_000);
  expect(repo.getChild(kid.id)!.streak_count).toBe(2);
  repo.resetStreak(kid.id);
  expect(repo.getChild(kid.id)!.streak_count).toBe(0);
  expect(repo.getChild(kid.id)!.balance_luna).toBe(20_000); // balance preserved
});
