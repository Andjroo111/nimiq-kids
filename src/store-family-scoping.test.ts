// Treasure Box catalogue is per-family: on a multi-tenant (strict) instance, a parent bearer
// for household A cannot see, edit, retire, price or shop household B's items, nor reprice the
// shared seeded catalogue. On a single-household (relaxed) instance the shared catalogue stays
// editable, which is what preserves the in-home parent-manage feature.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb, reseedCatalog } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as stickersRepo from "./repo-stickers";
import { storeRoutes } from "./routes/store";
import { sha256Hex } from "./auth";

const app = new Hono().route("/api", storeRoutes);

let famA: repo.Family, famB: repo.Family, kidA: repo.Child, kidB: repo.Child;
let tokenA: string, tokenB: string;

const auth = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });
const send = (t: string, method: string, path: string, body: Record<string, unknown> = {}) =>
  app.request(path, { method, body: JSON.stringify(body), headers: auth(t) });

beforeEach(async () => {
  initTestDb();
  process.env.HATCH_LEGACY_BOOT = "0"; // strict / multi-tenant
  famA = repo.createFamily("A", "NQ0A"); repo.updateFamilySettings(famA.id, { mode: "family" });
  famB = repo.createFamily("B", "NQ0B"); repo.updateFamilySettings(famB.id, { mode: "family" });
  kidA = repo.createChild(famA.id, "Ann", "🦊");
  kidB = repo.createChild(famB.id, "Bo", "🐢");
  tokenA = "A-" + crypto.randomUUID(); tokenB = "B-" + crypto.randomUUID();
  lockRepo.createParentToken(famA.id, "A phone", await sha256Hex(tokenA));
  lockRepo.createParentToken(famB.id, "B phone", await sha256Hex(tokenB));
});

afterEach(() => { delete process.env.HATCH_LEGACY_BOOT; });

test("a parent-created item is invisible to another household and to its kids", async () => {
  const cat = (await (await send(tokenA, "POST", "/api/parent/store/categories", { title: "A shelf" })).json()).category;
  const created = await send(tokenA, "POST", "/api/parent/store/items",
    { categoryId: cat.id, kind: "coupon", title: "Ice cream", priceNim: 5 });
  expect(created.status).toBe(201);
  const itemId = (await created.json()).item.id;

  // Family B's parent store does not list A's item...
  const bStore = await (await send(tokenB, "GET", "/api/parent/store")).json();
  expect(bStore.items.some((i: { id: string }) => i.id === itemId)).toBe(false);
  // ...nor does family B's kid store.
  const bKid = await (await send(tokenB, "GET", `/api/kids/${kidB.id}/store`)).json();
  expect(bKid.items.some((i: { id: string }) => i.id === itemId)).toBe(false);
  // Family A's own kid DOES see it.
  const aKid = await (await send(tokenA, "GET", `/api/kids/${kidA.id}/store`)).json();
  expect(aKid.items.some((i: { id: string }) => i.id === itemId)).toBe(true);
});

test("a parent cannot edit or retire another household's item", async () => {
  const cat = (await (await send(tokenA, "POST", "/api/parent/store/categories", { title: "A shelf" })).json()).category;
  const itemId = (await (await send(tokenA, "POST", "/api/parent/store/items",
    { categoryId: cat.id, kind: "coupon", title: "Ice cream", priceNim: 5 })).json()).item.id;

  const reprice = await send(tokenB, "PATCH", `/api/parent/store/items/${itemId}`, { priceNim: 1 });
  expect(reprice.status).toBe(404);
  const retire = await send(tokenB, "PATCH", `/api/parent/store/items/${itemId}`, { active: 0 });
  expect(retire.status).toBe(404);
  expect(stickersRepo.getStoreItem(itemId)!.price_luna).toBe(5 * 100_000); // unchanged
  expect(stickersRepo.getStoreItem(itemId)!.active).toBe(1);
});

test("on a strict instance pricing a SHARED seeded row never writes the row itself (#288)", async () => {
  // A parent CAN set what a catalogue item costs their household. What they cannot do is
  // move the row: one `family_id IS NULL` row is what every household on the instance
  // shops, so the price is filed per family and the shared row is left alone.
  reseedCatalog(); // populate the seeded (family_id NULL) rows
  const seeded = stickersRepo.getStoreItem("item-pack-space")!;
  expect(seeded.family_id).toBeNull();
  const res = await send(tokenA, "PATCH", "/api/parent/store/items/item-pack-space", { priceNim: 25 });
  expect(res.status).toBe(200);
  expect(stickersRepo.getStoreItem(seeded.id)!.price_luna).toBe(seeded.price_luna); // row untouched
  expect(stickersRepo.getStoreItem(seeded.id)!.parent_edited).toBe(0); // still the catalogue's
  // ...and household B, reading the same row, is still on the catalogue price.
  expect(stickersRepo.getStoreItem(seeded.id, famA.id)!.price_luna).toBe(25 * 100_000);
  expect(stickersRepo.getStoreItem(seeded.id, famB.id)!.price_luna).toBe(seeded.price_luna);
});

test("a shared catalogue row is PRICE only — its name and its art stay the catalogue's", async () => {
  reseedCatalog();
  const seeded = stickersRepo.getStoreItem("item-pack-space")!;
  for (const body of [{ title: "Mine now" }, { active: 0 }, { icon: "gamepad" }, { priceNim: 5, title: "Mine" }]) {
    const res = await send(tokenA, "PATCH", `/api/parent/store/items/${seeded.id}`, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("price_only");
  }
  const row = stickersRepo.getStoreItem(seeded.id)!;
  expect(row.title).toBe(seeded.title);
  expect(row.active).toBe(seeded.active);
});

test("a kid cannot buy another household's item by id", async () => {
  const cat = (await (await send(tokenA, "POST", "/api/parent/store/categories", { title: "A shelf" })).json()).category;
  const itemId = (await (await send(tokenA, "POST", "/api/parent/store/items",
    { categoryId: cat.id, kind: "coupon", title: "Ice cream", priceNim: 5 })).json()).item.id;
  // Family B's kid tries to buy family A's item directly.
  const buy = await send(tokenB, "POST", `/api/kids/${kidB.id}/buy`, { itemId });
  expect(buy.status).toBe(404);
  expect((await buy.json()).error).toBe("item_not_found");
});

test("relaxed single-household instance keeps the shared catalogue editable", async () => {
  delete process.env.HATCH_LEGACY_BOOT; // relaxed
  reseedCatalog();
  const seeded = stickersRepo.listAllStoreItems(famA.id).find((i) => i.family_id === null);
  const res = await send(tokenA, "PATCH", `/api/parent/store/items/${seeded!.id}`, { priceNim: 7 });
  expect(res.status).toBe(200);
  expect(stickersRepo.getStoreItem(seeded!.id)!.price_luna).toBe(7 * 100_000);
});
