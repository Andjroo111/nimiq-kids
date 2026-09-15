// Per-category time budgets, slice 1 (docs/CATEGORY-TIME-BUDGETS.md).
//
// The whole slice is one nullable column plus a flagged parent control. That makes it very
// easy to ship something that LOOKS wired and is not, so these tests guard the three claims
// the design actually rests on:
//   1. The tag is refused, not ignored, while the flag is off. A silently-dropped field is
//      how a parent comes to believe a shelf is tagged when nothing was written.
//   2. Only the settled taxonomy is storable. A typo'd kind would read as "untagged" later
//      and drop a shelf out of its budget with no error anywhere.
//   3. Tagging changes NOTHING else today. That is the promise that makes landing the column
//      early safe, and it is the one a later refactor is most likely to break.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as stickersRepo from "./repo-stickers";
import { storeRoutes } from "./routes/store";
import { sha256Hex } from "./auth";

const app = new Hono().route("/api", storeRoutes);

let fam: repo.Family;
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const send = (method: string, path: string, body: Record<string, unknown> = {}) =>
  app.request(path, { method, body: JSON.stringify(body), headers: auth() });

const flagOn = () => { process.env.FEATURE_CATEGORY_BUDGETS = "1"; };
const flagOff = () => { delete process.env.FEATURE_CATEGORY_BUDGETS; };

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  repo.createChild(fam.id, "Kid 1", "🦖");
  token = "catbudget-parent-bearer";
  lockRepo.createParentToken(fam.id, "Test phone", await sha256Hex(token));
  flagOff();
});
afterEach(flagOff);

const newShelf = async (title = "Games") =>
  (await (await send("POST", "/api/parent/store/categories", { title })).json()).category;

test("a new shelf starts untagged — no taxonomy is invented for it", async () => {
  const cat = await newShelf();
  expect(cat.budget_kind ?? null).toBeNull();
  expect(stickersRepo.getCategory(cat.id)!.budget_kind).toBeNull();
});

test("with the flag OFF the tag is REFUSED, not silently dropped", async () => {
  const cat = await newShelf();
  const res = await send("PATCH", `/api/parent/store/categories/${cat.id}`, { budgetKind: "games" });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("feature_disabled");
  // and nothing was written
  expect(stickersRepo.getCategory(cat.id)!.budget_kind).toBeNull();
});

test("with the flag OFF an ordinary edit still works — the gate is scoped to the tag", async () => {
  const cat = await newShelf();
  const res = await send("PATCH", `/api/parent/store/categories/${cat.id}`, { title: "Learning" });
  expect(res.status).toBe(200);
  expect(stickersRepo.getCategory(cat.id)!.title).toBe("Learning");
});

test("with the flag ON each settled kind round-trips", async () => {
  flagOn();
  for (const kind of ["utility", "learning", "games"]) {
    const cat = await newShelf(`Shelf ${kind}`);
    const res = await send("PATCH", `/api/parent/store/categories/${cat.id}`, { budgetKind: kind });
    expect(res.status).toBe(200);
    expect(stickersRepo.getCategory(cat.id)!.budget_kind).toBe(kind);
  }
});

test("a kind outside the taxonomy is refused, so a typo cannot read as untagged later", async () => {
  flagOn();
  const cat = await newShelf();
  const res = await send("PATCH", `/api/parent/store/categories/${cat.id}`, { budgetKind: "learnign" });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("budget_kind_invalid");
  expect(stickersRepo.getCategory(cat.id)!.budget_kind).toBeNull();
});

test("null clears the tag back to untagged", async () => {
  flagOn();
  const cat = await newShelf();
  await send("PATCH", `/api/parent/store/categories/${cat.id}`, { budgetKind: "games" });
  expect(stickersRepo.getCategory(cat.id)!.budget_kind).toBe("games");
  const res = await send("PATCH", `/api/parent/store/categories/${cat.id}`, { budgetKind: null });
  expect(res.status).toBe(200);
  expect(stickersRepo.getCategory(cat.id)!.budget_kind).toBeNull();
});

test("tagging a shelf changes NOTHING the kid or the shelf reads today", async () => {
  flagOn();
  const cat = await newShelf();
  const before = await (await app.request("/api/parent/store", { headers: auth() })).json();
  await send("PATCH", `/api/parent/store/categories/${cat.id}`, { budgetKind: "games" });
  const after = await (await app.request("/api/parent/store", { headers: auth() })).json();
  // The shelf is still listed, still in the same place, and the payload the UI renders from
  // is byte-identical — the tag is descriptive until something is built to read it.
  expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  expect(stickersRepo.listCategories(fam.id).some((k) => k.id === cat.id)).toBe(true);
});
