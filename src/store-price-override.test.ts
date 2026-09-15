// Per-family pricing of the SHARED catalogue (#288).
//
// Sticker packs, the seeded coupons and the screen-time tiles are one set of `store_items`
// rows with `family_id IS NULL` that every household on the instance shops. A parent could
// not change what any of them cost, because the only write path refuses a shared row — and
// rightly, since writing it would reprice the Space pack for strangers.
//
// So the price is filed per family in `store_item_overrides` and joined in on the read. What
// these tests hold down is the three places that price has to arrive identically: the kid's
// shelf, the buy sheet, and the charge itself. A ladder that displays one number and takes
// another is worse than no ladder.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb, reseedCatalog, getDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as stickersRepo from "./repo-stickers";
import * as wrepo from "./repo-wallet";
import { storeRoutes } from "./routes/store";
import { stickersRoutes } from "./routes/stickers";
import { sha256Hex } from "./auth";
import { STICKER_PACKS } from "./sticker-catalog";

const app = new Hono().route("/api", storeRoutes).route("/api", stickersRoutes);

let famA: repo.Family, famB: repo.Family, kidA: repo.Child, kidB: repo.Child;
let tokenA: string, tokenB: string;

const SPACE = "item-pack-space";
const CATALOGUE = STICKER_PACKS.find((p) => p.id === "pack-space")!.priceLuna;

const auth = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
const send = (t: string, method: string, path: string, body: Record<string, unknown> = {}) =>
  app.request(path, { method, body: JSON.stringify(body), headers: auth(t) });
const get = (t: string, path: string) => app.request(path, { headers: auth(t) });

/** The price as the kid's own Treasure Box renders it — the number on the tile. */
async function shelfPrice(token: string, kidId: string, itemId: string): Promise<number> {
  const body = await (await get(token, `/api/kids/${kidId}/store`)).json();
  return body.items.find((i: { id: string }) => i.id === itemId).priceLuna;
}

beforeEach(async () => {
  initTestDb();
  process.env.HATCH_LEGACY_BOOT = "0"; // strict / multi-tenant, which production is
  reseedCatalog();
  famA = repo.createFamily("A", "NQ0A"); repo.updateFamilySettings(famA.id, { mode: "family" });
  famB = repo.createFamily("B", "NQ0B"); repo.updateFamilySettings(famB.id, { mode: "family" });
  kidA = repo.createChild(famA.id, "Ann", "🦊");
  kidB = repo.createChild(famB.id, "Bo", "🐢");
  tokenA = "A-" + crypto.randomUUID(); tokenB = "B-" + crypto.randomUUID();
  lockRepo.createParentToken(famA.id, "A phone", await sha256Hex(tokenA));
  lockRepo.createParentToken(famB.id, "B phone", await sha256Hex(tokenB));
  // Both households own a tablet, so both see the screen-time tiles whose price this file is
  // about — the Box does not stock them otherwise (#306).
  lockRepo.createDevice(famA.id, "A tablet", "hash-store-price-a", null);
  lockRepo.createDevice(famB.id, "B tablet", "hash-store-price-b", null);
});

afterEach(() => { delete process.env.HATCH_LEGACY_BOOT; });

test("a repriced pack moves for that household and for nobody else", async () => {
  expect(await shelfPrice(tokenA, kidA.id, SPACE)).toBe(CATALOGUE);

  const res = await send(tokenA, "PATCH", `/api/parent/store/items/${SPACE}`, { priceNim: 40 });
  expect(res.status).toBe(200);
  expect((await res.json()).item.price_luna).toBe(40 * 100_000);

  expect(await shelfPrice(tokenA, kidA.id, SPACE)).toBe(40 * 100_000);
  expect(await shelfPrice(tokenB, kidB.id, SPACE)).toBe(CATALOGUE);
  // The parent's own manage screen has to agree, or the next edit starts from a stale number.
  const manageA = await (await get(tokenA, "/api/parent/store")).json();
  const manageB = await (await get(tokenB, "/api/parent/store")).json();
  expect(manageA.items.find((i: { id: string }) => i.id === SPACE).priceLuna).toBe(40 * 100_000);
  expect(manageB.items.find((i: { id: string }) => i.id === SPACE).priceLuna).toBe(CATALOGUE);
});

test("the BUY charges the household's price, and the receipt says the same number", async () => {
  await send(tokenA, "PATCH", `/api/parent/store/items/${SPACE}`, { priceNim: 40 });
  const price = 40 * 100_000;
  wrepo.addWalletEvent({ familyId: famA.id, childId: kidA.id, kind: "deposit", valueLuna: CATALOGUE });

  const res = await send(tokenA, "POST", `/api/kids/${kidA.id}/buy`, { itemId: SPACE });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.event.valueLuna).toBe(-price);            // the charge, not the catalogue price
  expect(body.balanceLuna).toBe(CATALOGUE - price);
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(CATALOGUE - price);
  // The receipt is a snapshot of what was agreed, so it must be the price actually taken.
  expect(stickersRepo.listPurchases(kidA.id)[0].price_luna).toBe(price);
});

test("a household priced OUT of a pack cannot buy it with the catalogue's price", async () => {
  // The inverse of the test above, and the one that would cost real NIM if the charge read a
  // different row from the tile: fund exactly the catalogue price against a dearer shelf.
  await send(tokenA, "PATCH", `/api/parent/store/items/${SPACE}`, { priceNim: CATALOGUE / 100_000 + 1 });
  wrepo.addWalletEvent({ familyId: famA.id, childId: kidA.id, kind: "deposit", valueLuna: CATALOGUE });

  const res = await send(tokenA, "POST", `/api/kids/${kidA.id}/buy`, { itemId: SPACE });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("insufficient_funds");
  expect(stickersRepo.packOwned(kidA.id, "pack-space")).toBe(false);
  expect(wrepo.spendableFromLedger(kidA.id)).toBe(CATALOGUE);
});

test("typing the catalogue price back in withdraws the override, and the catalogue owns it again", async () => {
  await send(tokenA, "PATCH", `/api/parent/store/items/${SPACE}`, { priceNim: 40 });
  expect(await shelfPrice(tokenA, kidA.id, SPACE)).toBe(40 * 100_000);

  const res = await send(tokenA, "PATCH", `/api/parent/store/items/${SPACE}`, { priceNim: CATALOGUE / 100_000 });
  expect(res.status).toBe(200);
  expect(await shelfPrice(tokenA, kidA.id, SPACE)).toBe(CATALOGUE);
  // Withdrawn, not deleted — the row survives with `active=0`, exactly as a hidden shelf does.
  const kept = getDb().query("SELECT price_luna, active FROM store_item_overrides WHERE family_id=? AND item_id=?")
    .get(famA.id, SPACE) as { price_luna: number; active: number };
  expect(kept).toEqual({ price_luna: 40 * 100_000, active: 0 });
  // ...and setting one again still works, so withdrawing is not a one-way door.
  await send(tokenA, "PATCH", `/api/parent/store/items/${SPACE}`, { priceNim: 12 });
  expect(await shelfPrice(tokenA, kidA.id, SPACE)).toBe(12 * 100_000);
});

test("an override survives the catalogue reseed a restart runs", async () => {
  // The seeded price is re-applied at every boot. A parent's ladder that a restart silently
  // flattens is worse than no ladder at all — this is the same promise `parent_edited` makes
  // for a row a family owns.
  await send(tokenA, "PATCH", `/api/parent/store/items/${SPACE}`, { priceNim: 40 });
  reseedCatalog(); // exactly what a restart does
  expect(await shelfPrice(tokenA, kidA.id, SPACE)).toBe(40 * 100_000);
  expect(await shelfPrice(tokenB, kidB.id, SPACE)).toBe(CATALOGUE);
});

test("the price ladder's guard rails hold on the override path too", async () => {
  for (const priceNim of [0, -5, 1_000_001]) {
    const res = await send(tokenA, "PATCH", `/api/parent/store/items/${SPACE}`, { priceNim });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_price");
  }
  expect(await shelfPrice(tokenA, kidA.id, SPACE)).toBe(CATALOGUE);
  // 1,000,000 NIM is the ceiling, not past it.
  expect((await send(tokenA, "PATCH", `/api/parent/store/items/${SPACE}`, { priceNim: 1_000_000 })).status).toBe(200);
});

test("the seeded coupon and screen-time tiles are repriceable by the same one mechanism", async () => {
  // These were the quieter half of the same bug: their rows look editable on the shelf
  // manager and the PATCH refused them for exactly the reason it refused a pack.
  for (const [id, nim] of [["item-coupon-dinner", 15], ["item-screen-60", 30]] as const) {
    expect((await send(tokenA, "PATCH", `/api/parent/store/items/${id}`, { priceNim: nim })).status).toBe(200);
    expect(await shelfPrice(tokenA, kidA.id, id)).toBe(nim * 100_000);
    expect(await shelfPrice(tokenB, kidB.id, id)).toBe(stickersRepo.getStoreItem(id)!.price_luna);
  }
});

test("the sticker book serves no price at all, so it cannot disagree with the till", async () => {
  // `sticker_packs.price_luna` is a second copy of a price the Box charges from
  // `store_items`. Once a family can set their own, the copy is simply wrong.
  await send(tokenA, "PATCH", `/api/parent/store/items/${SPACE}`, { priceNim: 40 });
  const inv = await (await get(tokenA, `/api/kids/${kidA.id}/stickers`)).json();
  const pack = inv.packs.find((p: { id: string }) => p.id === "pack-space");
  expect(pack.title).toBeTruthy();
  expect(pack.priceLuna).toBeUndefined();
});
