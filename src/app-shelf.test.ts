// The Treasure Box app shelf (#376): a kid buys an app, and the tablet may launch it.
//
// The thing worth guarding is that TWO OWNERS share one list. `devices.allowed_apps` is the
// parent's, replaced wholesale every time they save the picker. What a kid BOUGHT is theirs,
// permanently. Writing a purchase into the parent's column would mean a kid's real NIM
// evaporating the next time a grown-up ticked a box — silently, with a receipt in the ledger
// and nothing on the tablet. So ownership lives in `kid_unlocks` and the two are joined at
// the one read that answers "what may this tablet run".

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as stickersRepo from "./repo-stickers";
import * as wrepo from "./repo-wallet";
import { hashPin, newToken, sha256Hex } from "./auth";
import { storeRoutes } from "./routes/store";
import { lockRoutes } from "./routes/lock";

const app = new Hono().route("/api", storeRoutes).route("/api", lockRoutes);
const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });

const GAME = "com.mojang.minecraftpe";
const OTHER = "com.tocaboca.tocalifeworld";

let fam: repo.Family;
let kid: repo.Child;
let parentBearer: string;
let deviceToken: string;
let deviceId: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  parentBearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(parentBearer));
  deviceToken = newToken();
  const dev = lockRepo.createDevice(fam.id, "Kid's tablet", await sha256Hex(deviceToken), kid.id);
  deviceId = dev.id;
  // The wrapper's own installed-apps report (§5) — the only list a shelf row may name.
  lockRepo.setInstalledApps(deviceId, [
    { pkg: GAME, label: "Minecraft" },
    { pkg: OTHER, label: "Toca World" },
    { pkg: "com.android.settings", label: "Settings" },
  ]);
});

const asParent = () => ({ Authorization: `Bearer ${parentBearer}` });
const asDevice = () => ({ Authorization: `Bearer ${deviceToken}` });
const deviceAllowed = async () =>
  (await (await app.request("/api/device/state", { headers: asDevice() })).json()).allowedApps as string[];

async function shelveApp(pkg: string, priceNim = 4000, title = "Minecraft") {
  const cat = stickersRepo.createCategory("Apps", null, fam.id);
  return post("/api/parent/store/items",
    { categoryId: cat.id, kind: "app", title, priceNim, pkg }, asParent());
}
const fund = (luna: number) =>
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "deposit", valueLuna: luna });

// ---- what a parent may put on the shelf ----

test("a parent shelves an app their own tablet reported installed", async () => {
  const res = await shelveApp(GAME);
  expect(res.status).toBe(201);
  // The create route hands back the raw ROW, whose `payload` is the JSON string the column
  // holds. The kid-facing read (`/kids/:id/store`) is the one that parses it.
  expect(JSON.parse((await res.json()).item.payload).pkg).toBe(GAME);
});

test("a package the tablet never reported is refused", async () => {
  // `pkg` ends up in the LockTask allowlist, so a free-text field here names ANY package on
  // the device — including the ones the debloat deliberately put out of a kid's reach.
  const cat = stickersRepo.createCategory("Apps", null, fam.id);
  const res = await post("/api/parent/store/items",
    { categoryId: cat.id, kind: "app", title: "Sneaky", priceNim: 1, pkg: "com.example.notinstalled" }, asParent());
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("app_not_installed");
});

test("another household's installed list is not a source of packages", async () => {
  const other = repo.createFamily("Someone else", "NQ00");
  const theirKid = repo.createChild(other.id, "Their kid", "🐢");
  const theirDev = lockRepo.createDevice(other.id, "Their tablet", await sha256Hex(newToken()), theirKid.id);
  lockRepo.setInstalledApps(theirDev.id, [{ pkg: "com.example.theirs", label: "Theirs" }]);

  const cat = stickersRepo.createCategory("Apps", null, fam.id);
  const res = await post("/api/parent/store/items",
    { categoryId: cat.id, kind: "app", title: "Theirs", priceNim: 1, pkg: "com.example.theirs" }, asParent());
  expect(res.status).toBe(400);
});

test("an app may be FREE — that is how starter picks happen, with no second mechanism", async () => {
  expect((await shelveApp(GAME, 0)).status).toBe(201);
});

test("a free COUPON is still refused: that would be a button, not a purchase", async () => {
  const cat = stickersRepo.createCategory("Prizes", null, fam.id);
  const res = await post("/api/parent/store/items",
    { categoryId: cat.id, kind: "coupon", title: "Free thing", priceNim: 0 }, asParent());
  expect(res.status).toBe(400);
});

// ---- buying, and what the tablet is then allowed to run ----

test("buying an app puts it on the tablet's allowlist", async () => {
  await shelveApp(GAME, 10);
  fund(10 * 1e5 * 2);
  expect(await deviceAllowed()).not.toContain(GAME);

  const items = (await (await app.request(`/api/kids/${kid.id}/store`)).json()).items as { id: string; kind: string }[];
  const itemId = items.find((i) => i.kind === "app")!.id;
  const res = await post(`/api/kids/${kid.id}/buy`, { itemId });
  expect(res.status).toBe(200);
  expect((await res.json()).pkg).toBe(GAME);
  expect(await deviceAllowed()).toContain(GAME);
});

test("A PARENT REPLACING THE ALLOWLIST CANNOT ERASE WHAT A KID BOUGHT", async () => {
  // The bug this whole design exists to prevent: allowed_apps is replaced wholesale on every
  // save, so a purchase stored there vanishes the next time a grown-up ticks a box.
  stickersRepo.grantUnlock(kid.id, "app", GAME);
  lockRepo.setAllowedApps(deviceId, [OTHER]);
  const allowed = await deviceAllowed();
  expect(allowed).toContain(GAME);   // bought
  expect(allowed).toContain(OTHER);  // allowlisted
});

test("the union is de-duplicated", async () => {
  // A parent allowlisting something the kid already bought is a normal thing to happen, and
  // LockTask should not be handed the same package twice.
  stickersRepo.grantUnlock(kid.id, "app", GAME);
  lockRepo.setAllowedApps(deviceId, [GAME, OTHER]);
  const allowed = await deviceAllowed();
  expect(allowed.filter((p) => p === GAME)).toHaveLength(1);
});

test("one sibling's purchase does not unlock the other's tablet", async () => {
  const kid2 = repo.createChild(fam.id, "Kid 2", "🦄");
  const token2 = newToken();
  const dev2 = lockRepo.createDevice(fam.id, "Kid 2's tablet", await sha256Hex(token2), kid2.id);
  lockRepo.setInstalledApps(dev2.id, [{ pkg: GAME, label: "Minecraft" }]);
  stickersRepo.grantUnlock(kid.id, "app", GAME);

  const theirs = (await (await app.request("/api/device/state",
    { headers: { Authorization: `Bearer ${token2}` } })).json()).allowedApps as string[];
  expect(theirs).not.toContain(GAME);
});

test("buying the same app twice is refused, and costs nothing the second time", async () => {
  await shelveApp(GAME, 10);
  fund(10 * 1e5 * 4);
  const items = (await (await app.request(`/api/kids/${kid.id}/store`)).json()).items as { id: string; kind: string }[];
  const itemId = items.find((i) => i.kind === "app")!.id;
  expect((await post(`/api/kids/${kid.id}/buy`, { itemId })).status).toBe(200);
  const before = repo.getChild(kid.id)!.balance_luna;
  const second = await post(`/api/kids/${kid.id}/buy`, { itemId });
  expect(second.status).toBe(400);
  expect((await second.json()).error).toBe("already_owned");
  expect(repo.getChild(kid.id)!.balance_luna).toBe(before);
});

test("an app the kid already owns reads as owned on the shelf, not as a fresh buy", async () => {
  // Otherwise the tile invites a tap the server refuses — a "no" where the shelf could
  // simply have shown the truth.
  await shelveApp(GAME, 10);
  const before = (await (await app.request(`/api/kids/${kid.id}/store`)).json()).items
    .find((i: { kind: string }) => i.kind === "app");
  expect(before.owned).toBe(false);

  stickersRepo.grantUnlock(kid.id, "app", GAME);
  const after = (await (await app.request(`/api/kids/${kid.id}/store`)).json()).items
    .find((i: { kind: string }) => i.kind === "app");
  expect(after.owned).toBe(true);
});
