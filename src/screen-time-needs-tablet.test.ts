// A minute of screen time is only worth anything to a family that owns a tablet (#306).
//
// The Box sold them regardless: real NIM left the kid's wallet, an unlock override was
// written, and NOTHING in the world was listening to it — an override is read by exactly one
// thing, a paired device asking what its screen should do. The live family database had 4
// lock windows, 3 overrides and 0 devices, so every screen-time purchase it had ever taken
// bought nothing at all. Three of these items ship on a shelf that is visible by default, so
// it was the out-of-the-box state of every new household until the day its tablet arrived.
//
// Hermetic: in-memory DB + Hono app.request(), SIM ledger.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as stickersRepo from "./repo-stickers";
import * as wrepo from "./repo-wallet";
import { hashPin } from "./auth";
import { storeRoutes } from "./routes/store";

const app = new Hono().route("/api", storeRoutes);
const post = (path: string, body: Record<string, unknown> = {}) =>
  app.request(path, {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });

let fam: repo.Family;
let kid: repo.Child;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
});

const priceOf = (itemId: string) => stickersRepo.getStoreItem(itemId)!.price_luna;
const fund = (luna: number) =>
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "deposit", valueLuna: luna });
const pairTablet = () => lockRepo.createDevice(fam.id, "Sam's tablet", "hash-1", null);

async function shelf() {
  const body = await (await app.request(`/api/kids/${kid.id}/store`)).json();
  return body as {
    categories: { id: string }[];
    items: { id: string; kind: string }[];
  };
}
const kinds = (s: { items: { kind: string }[] }) => s.items.map((i) => i.kind);

// ---- the shelf ----

test("with no tablet paired, no screen-time tile is on the shelf", async () => {
  const s = await shelf();
  expect(kinds(s)).not.toContain("screen_time");
  // Only that kind. A pack is a picture on this device and needs nothing paired.
  expect(kinds(s)).toContain("pack");
});

test("pairing a tablet brings the shelf back with no row written", async () => {
  const before = stickersRepo.listAllCategories(fam.id).map((c) => `${c.id}:${c.active}`);
  expect(kinds(await shelf())).not.toContain("screen_time");

  pairTablet();

  const after = await shelf();
  expect(after.items.filter((i) => i.kind === "screen_time").map((i) => i.id).sort())
    .toEqual(["item-screen-15", "item-screen-30", "item-screen-60"]);
  // The category was never retired to hide it: `store_categories.active` on `cat-screen` is a
  // SHARED seeded row, so that switch would have reached every other household on the
  // instance (#288). The shelf is empty because its items are, and `box.js` draws no shelf
  // with no items in it.
  expect(stickersRepo.listAllCategories(fam.id).map((c) => `${c.id}:${c.active}`)).toEqual(before);
});

test("the category is still sent while its items are hidden", async () => {
  const s = await shelf();
  expect(s.categories.map((c) => c.id)).toContain("cat-screen");
  expect(s.items.filter((i) => i.id.startsWith("item-screen")).length).toBe(0);
});

test("a parent's OWN screen-time item is hidden too — the rule is the kind, not the id", async () => {
  const mine = stickersRepo.createStoreItem({
    categoryId: "cat-screen", kind: "screen_time", title: "20 minutes",
    priceLuna: 150_000, payload: { minutes: 20 }, familyId: fam.id,
  });
  expect((await shelf()).items.map((i) => i.id)).not.toContain(mine.id);
  pairTablet();
  expect((await shelf()).items.map((i) => i.id)).toContain(mine.id);
});

// ---- the buy ----

test("with no tablet paired, the buy is refused and no NIM moves", async () => {
  const price = priceOf("item-screen-15");
  fund(price + 100_000);

  const res = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("no_tablet");

  // Refused BEFORE the charge, never refunded after: the money never left, no receipt was
  // written, and no override was created for nothing to obey.
  expect(wrepo.spendableFromLedger(kid.id)).toBe(price + 100_000);
  expect(stickersRepo.listPurchases(kid.id).length).toBe(0);
  expect(lockRepo.activeOverride(fam.id, kid.id)).toBeNull();
});

test("the same buy succeeds the moment a tablet is paired", async () => {
  fund(priceOf("item-screen-15") + 100_000);
  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" })).status).toBe(409);

  pairTablet();

  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" })).status).toBe(200);
  const o = lockRepo.activeOverride(fam.id, kid.id)!;
  expect(o.mode).toBe("unlock");
  expect(o.source).toBe("purchase");
});

test("everything else in the Box still sells with no tablet", async () => {
  fund(priceOf("item-pack-space-theme") + 100_000);
  const res = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-pack-space-theme" });
  expect(res.status).toBe(200);
  expect(lockRepo.familyHasDevice(fam.id)).toBe(false);
});

test("unpairing the tablet leaves an existing purchase and its minutes alone", async () => {
  fund(priceOf("item-screen-15") + 100_000);
  const device = pairTablet();
  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" })).status).toBe(200);

  lockRepo.deleteDevice(device.id);

  // The receipt is a record of what was agreed and the override is the kid's paid clock.
  // Neither is the shelf's business, and unwinding either would be taking back money that
  // was honestly spent while the tablet was there.
  expect(stickersRepo.listPurchases(kid.id).filter((p) => p.kind === "screen_time").length).toBe(1);
  expect(lockRepo.activeOverride(fam.id, kid.id)!.source).toBe("purchase");
  // But nothing more can be sold until it comes back.
  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" })).status).toBe(409);
});

// ---- the repo predicate ----

test("familyHasDevice is scoped to the household", () => {
  const other = repo.createFamily("Mum", "NQ01");
  expect(lockRepo.familyHasDevice(fam.id)).toBe(false);
  lockRepo.createDevice(other.id, "Their tablet", "hash-2", null);
  expect(lockRepo.familyHasDevice(other.id)).toBe(true);
  expect(lockRepo.familyHasDevice(fam.id)).toBe(false);
});
