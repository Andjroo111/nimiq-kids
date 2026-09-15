// The parent-managed Treasure Box catalogue: a parent creates and reorders
// shelves, adds things to them, and hides what they no longer want. The kid app
// has always read its shelves from data; these routes are the write side.
//
// What this file is really guarding is the two rules that make it safe:
//  1. Nothing is deleted. Hiding is active=0 and the row stays, because
//     kid_purchases.item_id is a real FK.
//  2. A parent edit takes OWNERSHIP of a row, so the catalogue's boot-time
//     re-seed stops overwriting it. Without that, the first thing this screen
//     did would be silently undone on the next restart.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb, reseedCatalog } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as stickersRepo from "./repo-stickers";
import { storeRoutes } from "./routes/store";
import { sha256Hex } from "./auth";

const app = new Hono().route("/api", storeRoutes);

let fam: repo.Family;
let kid: repo.Child;
let token: string;

const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const get = (path: string) => app.request(path, { headers: auth() });
const send = (method: string, path: string, body: Record<string, unknown> = {}) =>
  app.request(path, { method, body: JSON.stringify(body), headers: auth() });

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  // The parent page always carries its bearer; requireParent resolves the
  // token's OWN family, so this is the whole auth story for these routes.
  token = "uxtest-parent-bearer";
  lockRepo.createParentToken(fam.id, "Test phone", await sha256Hex(token));
});

test("parent read shows RETIRED rows the kid read hides", async () => {
  const parent = await (await get("/api/parent/store")).json();
  const kidView = await (await app.request(`/api/kids/${kid.id}/store`)).json();

  const timers = parent.categories.find((c: { id: string }) => c.id === "cat-timers");
  expect(timers.active).toBe(false);
  expect(kidView.categories.some((c: { id: string }) => c.id === "cat-timers")).toBe(false);
  // A parent who hid a shelf has to be able to find it again to bring it back.
  expect(parent.items.some((i: { id: string }) => i.id === "item-timer-maker")).toBe(true);
});

test("a parent-made shelf and its coupon reach the kid, face and all", async () => {
  const made = await send("POST", "/api/parent/store/categories", { title: "Treats", icon: "medal" });
  expect(made.status).toBe(201);
  const cat = (await made.json()).category;

  const item = await send("POST", "/api/parent/store/items", {
    categoryId: cat.id, kind: "coupon", title: "Ice cream after dinner", priceNim: 2_500, icon: "dinner",
  });
  expect(item.status).toBe(201);

  const kidView = await (await app.request(`/api/kids/${kid.id}/store`)).json();
  const shelf = kidView.categories.find((c: { id: string }) => c.id === cat.id);
  expect(shelf.title).toBe("Treats");
  expect(shelf.icon).toBe("medal");
  const bought = kidView.items.find((i: { categoryId: string }) => i.categoryId === cat.id);
  expect(bought.title).toBe("Ice cream after dinner");
  expect(bought.priceLuna).toBe(2_500 * 100_000); // whole NIM in, luna out
  expect(bought.payload.icon).toBe("dinner");
});

test("screen time needs real minutes, and they survive an icon edit", async () => {
  const cat = (await (await send("POST", "/api/parent/store/categories", { title: "Screens" })).json()).category;
  expect((await send("POST", "/api/parent/store/items",
    { categoryId: cat.id, kind: "screen_time", title: "Ten", priceNim: 500 })).status).toBe(400);
  expect((await send("POST", "/api/parent/store/items",
    { categoryId: cat.id, kind: "screen_time", title: "Ten", priceNim: 500, minutes: 999 })).status).toBe(400);

  const made = await send("POST", "/api/parent/store/items",
    { categoryId: cat.id, kind: "screen_time", title: "Ten minutes", priceNim: 500, minutes: 10 });
  expect(made.status).toBe(201);
  const id = (await made.json()).item.id;

  // Merge, never replace: dropping `minutes` would sell an unlock of nothing.
  expect((await send("PATCH", `/api/parent/store/items/${id}`, { icon: "gamepad" })).status).toBe(200);
  expect(JSON.parse(stickersRepo.getStoreItem(id)!.payload)).toEqual({ icon: "gamepad", minutes: 10 });
});

test("hiding is not deleting: the row stays and can come back", async () => {
  const cat = (await (await send("POST", "/api/parent/store/categories", { title: "Prizes" })).json()).category;
  const id = (await (await send("POST", "/api/parent/store/items",
    { categoryId: cat.id, kind: "coupon", title: "Movie night", priceNim: 3_000 })).json()).item.id;

  await send("PATCH", `/api/parent/store/items/${id}`, { active: false });
  expect(stickersRepo.getStoreItem(id)).not.toBeNull();
  let kidView = await (await app.request(`/api/kids/${kid.id}/store`)).json();
  expect(kidView.items.some((i: { id: string }) => i.id === id)).toBe(false);

  await send("PATCH", `/api/parent/store/items/${id}`, { active: true });
  kidView = await (await app.request(`/api/kids/${kid.id}/store`)).json();
  expect(kidView.items.some((i: { id: string }) => i.id === id)).toBe(true);
});

test("a parent edit takes the row, so the catalogue stops re-applying it", async () => {
  // The seeded price is re-applied at every boot. Once a parent sets their own
  // it has to survive the next restart, or this whole screen is a lie.
  const seeded = stickersRepo.getStoreItem("item-screen-60")!;
  expect(seeded.parent_edited).toBe(0);
  expect(seeded.price_luna).toBe(4_000 * 100_000);

  await send("PATCH", "/api/parent/store/items/item-screen-60", { priceNim: 123 });
  expect(stickersRepo.getStoreItem("item-screen-60")!.parent_edited).toBe(1);

  reseedCatalog(); // exactly what a restart does
  expect(stickersRepo.getStoreItem("item-screen-60")!.price_luna).toBe(123 * 100_000);
  // ...and an untouched row is still the catalogue's to own.
  expect(stickersRepo.getStoreItem("item-screen-30")!.price_luna).toBe(2_000 * 100_000);
});

test("bad input is refused before it reaches a shelf", async () => {
  const cat = (await (await send("POST", "/api/parent/store/categories", { title: "X" })).json()).category;
  expect((await send("POST", "/api/parent/store/categories", { title: "   " })).status).toBe(400);
  expect((await send("POST", "/api/parent/store/items",
    { categoryId: cat.id, kind: "pack", title: "Sneaky", priceNim: 10 })).status).toBe(400);
  expect((await send("POST", "/api/parent/store/items",
    { categoryId: "nope", kind: "coupon", title: "Ghost", priceNim: 10 })).status).toBe(404);
  expect((await send("POST", "/api/parent/store/items",
    { categoryId: cat.id, kind: "coupon", title: "Free", priceNim: 0 })).status).toBe(400);
  // No bearer at all.
  expect((await app.request("/api/parent/store")).status).toBe(401);
});

// ---- pack art reaches BOTH sides of the shelf (#34) ----
//
// The parent's manager drew a generic ticket on every sticker-pack row while the kid saw
// the real fanned pack art for the same item. Neither half of the client's fallback chain
// could ever have found the art: a pack's payload carries `packId`, never `icon`, and
// `cat-stickers` has `icon: null` on purpose because packs draw their own. The parent
// endpoint simply never sent the stickers, so this is the contract that broke.

test("the parent store sends each pack's own stickers, not just a payload", async () => {
  const parent = await (await get("/api/parent/store")).json();
  const packs = parent.items.filter((i: { kind: string }) => i.kind === "pack");
  expect(packs.length).toBeGreaterThan(0);

  for (const pack of packs) {
    expect(pack.packId).toBeTruthy();
    expect(Array.isArray(pack.stickers)).toBe(true);
    expect(pack.stickers.length).toBeGreaterThan(0);
    // The fan draws the first three; each needs a face. `emoji` IS the art on a sticker
    // whose PNG has not been generated, so without it the fan is lettered dots.
    for (const s of pack.stickers.slice(0, 3)) {
      expect(s.id).toBeTruthy();
      expect(s.assetUrl || s.emoji).toBeTruthy();
    }
  }
});

test("parent and kid are handed the SAME art for the same pack", async () => {
  const parent = await (await get("/api/parent/store")).json();
  const kidView = await (await app.request(`/api/kids/${kid.id}/store`)).json();

  const face = (items: { kind: string; packId?: string; stickers?: { id: string }[] }[]) =>
    Object.fromEntries(items.filter((i) => i.kind === "pack")
      .map((i) => [i.packId, (i.stickers ?? []).map((s) => s.id)]));

  const kidFaces = face(kidView.items);
  const parentFaces = face(parent.items);
  // Every pack the kid can see is drawn from the same stickers on the parent side.
  for (const [packId, stickers] of Object.entries(kidFaces)) {
    expect(parentFaces[packId]).toEqual(stickers);
  }
  expect(Object.keys(kidFaces).length).toBeGreaterThan(0);
});

test("ownership stays a fact about a child and never leaks into the parent catalogue", async () => {
  const parent = await (await get("/api/parent/store")).json();
  // This endpoint has no child in scope, so an `owned` flag here would be a guess.
  for (const item of parent.items) expect(item.owned).toBeUndefined();
});
