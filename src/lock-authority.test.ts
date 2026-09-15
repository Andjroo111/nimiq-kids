// Who is allowed to end a lock, and what a second purchase does to a clock the kid
// already paid for (#301, #302). Both bugs lived in the same place: `lock_overrides`
// had no author, so the only tiebreak was recency, and a row written later simply won
// no matter whose money or authority wrote it.
//
// Hermetic: in-memory DB + Hono app.request(), SIM ledger.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as stickersRepo from "./repo-stickers";
import * as wrepo from "./repo-wallet";
import * as routines from "./repo-routines";
import { computeLockState } from "./lock-machine";
import { hashPin } from "./auth";
import { storeRoutes } from "./routes/store";

const app = new Hono().route("/api", storeRoutes);
const post = (path: string, body: Record<string, unknown> = {}) =>
  app.request(path, {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });

const MIN = 60_000;

let fam: repo.Family;
let kid: repo.Child;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  // A household that can be sold screen time is one with a tablet to spend it on (#306).
  lockRepo.createDevice(fam.id, "Kid's tablet", "hash-lock-authority", null);
});

const priceOf = (itemId: string) => stickersRepo.getStoreItem(itemId)!.price_luna;
const fund = (luna: number) =>
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "deposit", valueLuna: luna });

/** The tablet's answer, given whatever override is in charge right now. */
function tabletState(nowMs: number) {
  const o = lockRepo.activeOverride(fam.id, kid.id, nowMs);
  return computeLockState({
    nowMs, tz: "America/Chicago", windows: [], runsToday: [],
    pendingApprovalRunIds: [],
    override: o ? { mode: o.mode, untilMs: o.until_ms } : null,
  });
}

// ---- #301: a grounding is not for sale ----

test("a kid cannot buy their way out of a parent's lock", () => {
  const now = Date.now();
  lockRepo.setOverride(fam.id, "lock", null, null);                 // parent grounds the household
  lockRepo.extendPurchasedUnlock(fam.id, kid.id, 15, now);          // kid buys 15 minutes

  const o = lockRepo.activeOverride(fam.id, kid.id, now)!;
  expect(o.mode).toBe("lock");
  expect(o.source).toBe("parent");
  expect(tabletState(now).state).toBe("LOCKED_ROUTINE");
});

test("author beats recency in BOTH orders — a lock written first still wins", () => {
  const now = Date.now();
  lockRepo.extendPurchasedUnlock(fam.id, kid.id, 15, now);          // kid buys first
  lockRepo.setOverride(fam.id, "lock", null, null);                 // parent grounds after
  expect(tabletState(now).state).toBe("LOCKED_ROUTINE");
});

test("a parent lock refuses the buy before any money moves", async () => {
  const price = priceOf("item-screen-15");
  fund(price + 100_000);
  lockRepo.setOverride(fam.id, "lock", null, null);

  const res = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("locked_by_parent");
  // No NIM spent, no receipt, no override written.
  expect(wrepo.spendableFromLedger(kid.id)).toBe(price + 100_000);
  expect(stickersRepo.listPurchases(kid.id).length).toBe(0);
  expect(lockRepo.activeOverride(fam.id, kid.id)!.mode).toBe("lock");
});

test("a kid-scoped parent lock refuses that kid's buy and no one else's", async () => {
  const other = repo.createChild(fam.id, "Kid 2", "🐙");
  const price = priceOf("item-screen-15");
  wrepo.addWalletEvent({ familyId: fam.id, childId: other.id, kind: "deposit", valueLuna: price + 100_000 });
  fund(price + 100_000);
  lockRepo.setOverride(fam.id, "lock", kid.id, null);

  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" })).status).toBe(409);
  expect((await post(`/api/kids/${other.id}/buy`, { itemId: "item-screen-15" })).status).toBe(200);
});

test("the shelf says why, so the tile is greyed before it is tapped", async () => {
  const shelf = async () => {
    const body = await (await app.request(`/api/kids/${kid.id}/store`)).json();
    return body.items.find((i: { id: string }) => i.id === "item-screen-15");
  };
  expect((await shelf()).unavailable).toBeUndefined();

  const lock = lockRepo.setOverride(fam.id, "lock", null, null);
  expect((await shelf()).unavailable).toBe("locked_by_parent");

  lockRepo.clearOverride(lock.id);
  expect((await shelf()).unavailable).toBeUndefined();
});

test("clearing the lock lets purchases work again", async () => {
  fund(priceOf("item-screen-15") + 100_000);
  const lock = lockRepo.setOverride(fam.id, "lock", null, null);
  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" })).status).toBe(409);

  lockRepo.clearOverride(lock.id);
  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" })).status).toBe(200);
  expect(tabletState(Date.now()).state).toBe("UNLOCKED");
});

test("a parent unlock still wins over a live purchase, and the purchase survives under it", () => {
  const now = Date.now();
  lockRepo.extendPurchasedUnlock(fam.id, kid.id, 60, now);
  const parentUnlock = lockRepo.setOverride(fam.id, "unlock", kid.id, null);
  const o = lockRepo.activeOverride(fam.id, kid.id, now)!;
  expect(o.id).toBe(parentUnlock.id);

  // A parent override never CLEARS a purchase — the paid minutes are still on the clock
  // underneath, and reappear the moment the parent's own row goes away.
  lockRepo.clearOverride(parentUnlock.id);
  const after = lockRepo.activeOverride(fam.id, kid.id, now + 30 * MIN)!;
  expect(after.source).toBe("purchase");
  expect(Math.round((after.until_ms! - (now + 30 * MIN)) / MIN)).toBe(30);
});

// ---- #302: a second buy adds minutes, it does not replace them ----

test("a second screen-time purchase must not shorten a live unlock", () => {
  const now = Date.now();
  lockRepo.extendPurchasedUnlock(fam.id, kid.id, 60, now);   // buys 60 min
  const later = now + 5 * MIN;                               // 55 min still left
  lockRepo.extendPurchasedUnlock(fam.id, kid.id, 15, later);  // buys 15 more

  const after = lockRepo.activeOverride(fam.id, kid.id, later)!;
  expect(Math.round((after.until_ms! - later) / MIN)).toBe(70);
});

test("buying with no live unlock gives exactly the minutes bought", () => {
  const now = Date.now();
  const o = lockRepo.extendPurchasedUnlock(fam.id, kid.id, 15, now);
  expect(Math.round((o.until_ms! - now) / MIN)).toBe(15);
});

test("an EXPIRED purchase is not extended — the clock restarts from now", () => {
  const now = Date.now();
  lockRepo.extendPurchasedUnlock(fam.id, kid.id, 15, now);
  const later = now + 60 * MIN;                              // long after it lapsed
  const o = lockRepo.extendPurchasedUnlock(fam.id, kid.id, 15, later);
  expect(Math.round((o.until_ms! - later) / MIN)).toBe(15);
});

test("one kid's purchase never extends another kid's clock", () => {
  const other = repo.createChild(fam.id, "Kid 2", "🐙");
  const now = Date.now();
  lockRepo.extendPurchasedUnlock(fam.id, kid.id, 60, now);
  const o = lockRepo.extendPurchasedUnlock(fam.id, other.id, 15, now);
  expect(Math.round((o.until_ms! - now) / MIN)).toBe(15);
  expect(Math.round((lockRepo.activeOverride(fam.id, kid.id, now)!.until_ms! - now) / MIN)).toBe(60);
});

test("stacked buys through the real route: 15 + 15 leaves 30 minutes and two receipts", async () => {
  fund(priceOf("item-screen-15") * 2 + 100_000);
  const before = Date.now();
  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" })).status).toBe(200);
  const second = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" });
  expect(second.status).toBe(200);
  expect((await second.json()).minutes).toBe(15);

  const o = lockRepo.activeOverride(fam.id, kid.id)!;
  expect(o.until_ms!).toBeGreaterThanOrEqual(before + 29 * MIN);
  expect(o.until_ms!).toBeLessThanOrEqual(Date.now() + 30 * MIN);
  // Each buy still gets its own receipt for what was actually bought.
  expect(stickersRepo.listPurchases(kid.id).filter((p) => p.kind === "screen_time").length).toBe(2);
});

// ---- #377: a METERED kid buys BUDGET, not an unlock ----
//
// The shape change these guard: under the old rule, bought minutes were an unlock override,
// and an unlock override outranks everything — including the curfew. So a kid with 2,000 NIM
// could buy their way past bedtime, which is the one thing the curfew exists to prevent.
// Added to today's allowance instead, the minutes are usable inside their hours and worth
// nothing outside them.

const today = () => routines.localDay(fam.tz);

test("a metered kid's purchase adds to today's allowance and mints NO override", async () => {
  repo.setScreenBudget(kid.id, 60, 30);
  fund(priceOf("item-screen-15") * 2);

  const res = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" });
  expect(res.status).toBe(200);
  expect((await res.json()).earnedSec).toBe(15 * 60);
  expect(lockRepo.usageFor(kid.id, today())!.earned_sec).toBe(15 * 60);
  // The old path would have left a live unlock row here. That row is what beat the curfew.
  expect(lockRepo.purchasedUnlock(fam.id, kid.id)).toBeNull();
});

test("bought minutes cannot lift a metered kid past their daily cap", async () => {
  repo.setScreenBudget(kid.id, 60, 30);
  fund(priceOf("item-screen-30") * 4);

  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-30" })).status).toBe(200);
  const second = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-30" });
  expect(second.status).toBe(409);
  expect((await second.json()).error).toBe("earned_cap_reached");
  expect(lockRepo.usageFor(kid.id, today())!.earned_sec).toBe(30 * 60);
});

test("the cap refuses BEFORE the charge — a refused buy costs nothing", async () => {
  repo.setScreenBudget(kid.id, 60, 15);
  fund(priceOf("item-screen-30") * 2);
  const before = repo.getChild(kid.id)!.balance_luna;

  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-30" })).status).toBe(409);
  expect(repo.getChild(kid.id)!.balance_luna).toBe(before);
});

test("an UNMETERED kid still gets the old unlock override (there is no budget to add to)", async () => {
  fund(priceOf("item-screen-15") * 2);
  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" })).status).toBe(200);
  expect(lockRepo.purchasedUnlock(fam.id, kid.id)).not.toBeNull();
  expect(lockRepo.usageFor(kid.id, today())).toBeNull();
});

test("a grounding still outranks a metered purchase (#301 survives the reshape)", async () => {
  repo.setScreenBudget(kid.id, 60, 30);
  lockRepo.setOverride(fam.id, "lock", null, null);
  fund(priceOf("item-screen-15") * 2);
  const res = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("locked_by_parent");
});

// ---- #377: the shelf stops offering what the cap will not allow ----

const shelf = async () => {
  const res = await app.request(`/api/kids/${kid.id}/store`);
  return (await res.json()).items as { id: string; kind: string; unavailable?: string }[];
};
const screenTile = (items: Awaited<ReturnType<typeof shelf>>, id: string) => items.find((i) => i.id === id);

test("an unmetered kid sees every screen-time tile, exactly as before", async () => {
  const items = await shelf();
  for (const id of ["item-screen-15", "item-screen-30", "item-screen-60"]) {
    expect(screenTile(items, id)?.unavailable, id).toBeUndefined();
  }
});

test("a tile bigger than the day's remaining cap is greyed, not hidden", async () => {
  // GREYED matters: the cap resets at midnight and a parent can raise it, so the tile has
  // to be able to come back. This is why the 60-minute item is still in the catalogue.
  repo.setScreenBudget(kid.id, 60, 30);
  const items = await shelf();
  expect(screenTile(items, "item-screen-30")?.unavailable).toBeUndefined();
  expect(screenTile(items, "item-screen-60")?.unavailable).toBe("over_daily_cap");
  expect(items.some((i) => i.id === "item-screen-60")).toBe(true); // still on the shelf
});

test("buying eats the remaining cap, and the shelf follows on the next read", async () => {
  repo.setScreenBudget(kid.id, 60, 30);
  fund(priceOf("item-screen-15") * 3);
  expect(screenTile(await shelf(), "item-screen-15")?.unavailable).toBeUndefined();

  await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-30" }); // 30 of 30 spent
  const after = await shelf();
  expect(screenTile(after, "item-screen-15")?.unavailable).toBe("over_daily_cap");
  expect(screenTile(after, "item-screen-30")?.unavailable).toBe("over_daily_cap");
});

test("a zero cap greys the whole shelf without unstocking it", async () => {
  repo.setScreenBudget(kid.id, 60, 0);
  const items = await shelf();
  for (const id of ["item-screen-15", "item-screen-30", "item-screen-60"]) {
    expect(screenTile(items, id)?.unavailable, id).toBe("over_daily_cap");
  }
});

test("a grounding still outranks the cap in what the tile says", async () => {
  // Both are true at once; the grounding is the one with a person behind it, and #301
  // settled that a kid should be told which grown-up said no.
  repo.setScreenBudget(kid.id, 60, 0);
  lockRepo.setOverride(fam.id, "lock", null, null);
  expect(screenTile(await shelf(), "item-screen-15")?.unavailable).toBe("locked_by_parent");
});
