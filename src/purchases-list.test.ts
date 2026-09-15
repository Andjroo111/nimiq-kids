// "My prizes" (#121): the Treasure Box's receipt.
//
// A kid bought a coupon, real NIM left their wallet, a `kid_purchases` row went to
// `pending_parent`, and they got a two-second toast. No screen anywhere, kid or parent,
// listed what was bought. When the parent handed it over days later the row flipped to
// `fulfilled` in a table no screen read. Saving up for something is why a kid tolerates
// chores, so the thing they saved for has to exist somewhere.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as stickersRepo from "./repo-stickers";
import { newToken, sha256Hex } from "./auth";
import { storeRoutes } from "./routes/store";

const app = new Hono().route("/api", storeRoutes);

let fam: repo.Family;
let kid: repo.Child;
let sibling: repo.Child;
let bearer: string;
let coupon: stickersRepo.StoreItem;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ivy", "🦖");
  sibling = repo.createChild(fam.id, "Sam", "🐙");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
  coupon = stickersRepo.listStoreItems(fam.id).find((i) => i.kind === "coupon")!;
});

const get = (path: string, token = bearer) =>
  app.request(`http://hatch.test${path}`, { headers: { Authorization: `Bearer ${token}` } });

const buy = (child: repo.Child, item = coupon, status: stickersRepo.PurchaseStatus = "pending_parent") =>
  stickersRepo.createPurchase(fam.id, child.id, item, status);

test("a kid with no purchases gets an empty list, not an error", async () => {
  const res = await get(`/api/kids/${kid.id}/purchases`);
  expect(res.status).toBe(200);
  expect((await res.json()).purchases).toEqual([]);
});

test("a bought coupon appears, with the state the kid is waiting on", async () => {
  const p = buy(kid);
  const { purchases } = await (await get(`/api/kids/${kid.id}/purchases`)).json();
  expect(purchases).toHaveLength(1);
  expect(purchases[0]).toMatchObject({
    id: p.id, itemId: coupon.id, kind: "coupon", status: "pending_parent", priceLuna: coupon.price_luna,
  });
});

test("fulfilment is visible, which is the half that used to disappear entirely", async () => {
  // The parent handing the prize over wrote `fulfilled` into a table no screen read, so
  // from the kid's side nothing ever happened at all.
  const p = buy(kid);
  stickersRepo.setPurchaseStatus(p.id, "fulfilled");
  const { purchases } = await (await get(`/api/kids/${kid.id}/purchases`)).json();
  expect(purchases[0].status).toBe("fulfilled");
});

test("the title and price are SNAPSHOTS, so renaming the shelf item cannot rewrite history", async () => {
  const p = buy(kid);
  stickersRepo.updateStoreItem(coupon.id, { title: "Something else entirely", price_luna: 99_999_999 });
  const { purchases } = await (await get(`/api/kids/${kid.id}/purchases`)).json();
  expect(purchases[0].title).toBe(p.title);
  expect(purchases[0].priceLuna).toBe(coupon.price_luna);
});

test("newest first", async () => {
  const first = buy(kid);
  const second = buy(kid);
  const { purchases } = await (await get(`/api/kids/${kid.id}/purchases`)).json();
  expect(purchases.map((x: { id: string }) => x.id)).toEqual([second.id, first.id]);
});

test("a sibling's purchases are not in this kid's list", async () => {
  buy(sibling);
  expect((await (await get(`/api/kids/${kid.id}/purchases`)).json()).purchases).toEqual([]);
});

test("the parent sees the whole household, tagged by kid", async () => {
  buy(kid);
  buy(sibling);
  const { purchases } = await (await get("/api/parent/purchases")).json();
  expect(purchases).toHaveLength(2);
  expect(new Set(purchases.map((p: { childId: string }) => p.childId))).toEqual(new Set([kid.id, sibling.id]));
});

test("the parent list needs a parent bearer", async () => {
  const res = await app.request("http://hatch.test/api/parent/purchases");
  expect(res.status).toBe(401);
});

// ---- the tile's "already waiting" mark ------------------------------------------

test("the store tile reports how many of an item are queued", async () => {
  // A coupon has no `owned` state and is re-buyable on purpose, so the tile stayed at full
  // price with nothing to say one was already waiting, and a second tap spent the money
  // again in silence.
  const before = (await (await get(`/api/kids/${kid.id}/store`)).json())
    .items.find((i: { id: string }) => i.id === coupon.id);
  expect(before.pendingCount).toBe(0);

  buy(kid); buy(kid);
  const after = (await (await get(`/api/kids/${kid.id}/store`)).json())
    .items.find((i: { id: string }) => i.id === coupon.id);
  expect(after.pendingCount).toBe(2);
});

test("a fulfilled purchase stops counting as waiting", async () => {
  const p = buy(kid);
  stickersRepo.setPurchaseStatus(p.id, "fulfilled");
  const item = (await (await get(`/api/kids/${kid.id}/store`)).json())
    .items.find((i: { id: string }) => i.id === coupon.id);
  expect(item.pendingCount).toBe(0);
});

test("a sibling's pending buy does not mark this kid's tile", async () => {
  buy(sibling);
  const item = (await (await get(`/api/kids/${kid.id}/store`)).json())
    .items.find((i: { id: string }) => i.id === coupon.id);
  expect(item.pendingCount).toBe(0);
});
