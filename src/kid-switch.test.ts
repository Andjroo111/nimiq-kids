// #123: a sibling on the shared family tablet could become any other kid and spend their
// real mainnet NIM. The test that matters is the last one in the first block — a device
// unlocked for Ada is REFUSED on Ben's Treasure Box — because that is the thing the issue
// says a household does weekly.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { sha256Hex, newToken } from "./auth";
import { children } from "./routes/children";
import { kidSwitchRoutes } from "./routes/kid-switch";
import { storeRoutes } from "./routes/store";
import { walletRoutes } from "./routes/wallet";
import { hasSwitchSecret, parseSecret, SWITCH_ART_SHIPPED, SWITCH_PICTURES, SWITCH_SECRET_TAPS, switchPictureGrid } from "./kid-switch";
import { existsSync } from "node:fs";
import { resetRateLimits } from "./rate-limit";

const app = new Hono()
  .route("/api", children)
  .route("/api", kidSwitchRoutes)
  .route("/api", storeRoutes)
  .route("/api", walletRoutes);

let fam: repo.Family;
let ada: repo.Child;
let ben: repo.Child;
let tablet: { device: lockRepo.Device; token: string };

const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (path: string, token: string, body: unknown = {}) =>
  app.request(path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });

async function pairTablet(label: string) {
  const token = newToken();
  const device = lockRepo.createDevice(fam.id, label, await sha256Hex(token), null);
  return { device, token };
}

// Strict multi-tenant behaviour: the relaxed default would let an un-tokened caller through
// the money gate entirely, which is not the surface this issue is about.
const savedBoot = { v: undefined as string | undefined };

beforeEach(async () => {
  savedBoot.v = process.env.HATCH_LEGACY_BOOT;
  process.env.HATCH_LEGACY_BOOT = "0";
  initTestDb();
  resetRateLimits();
  const created = repo.createFamily("Mom", "NQ00");
  repo.updateFamilySettings(created.id, { mode: "family" });
  fam = repo.getFamily(created.id)!;
  ada = repo.createChild(fam.id, "Ada", "🦖");
  ben = repo.createChild(fam.id, "Ben", "🦕");
  tablet = await pairTablet("Kitchen tablet");
});

afterEach(() => {
  if (savedBoot.v === undefined) delete process.env.HATCH_LEGACY_BOOT;
  else process.env.HATCH_LEGACY_BOOT = savedBoot.v;
});

// ---- the hole ----

test("a tablet unlocked for one kid cannot spend the other kid's money", async () => {
  // Both kids enrol, the way they would the first time each is opened on the tablet.
  expect((await post(`/api/kids/${ada.id}/switch-secret`, tablet.token, { secret: "1-4" })).status).toBe(201);
  expect((await post(`/api/kids/${ben.id}/switch-secret`, tablet.token, { secret: "7-2" })).status).toBe(201);

  // Ada opens her own app.
  const unlocked = await post(`/api/kids/${ada.id}/unlock`, tablet.token, { secret: "1-4" });
  expect(await unlocked.json()).toMatchObject({ ok: true, via: "secret" });

  // The tap this issue is about: Ada's tablet, Ben's wallet. This used to be allowed.
  const spend = await post(`/api/kids/${ben.id}/buy`, tablet.token, { itemId: "item-screen-15" });
  expect(spend.status).toBe(403);
  expect(await spend.json()).toEqual({ error: "switch_locked" });

  // And Ada is unaffected on her own account: the gate refuses the sibling, not the kid.
  const own = await app.request(`/api/kids/${ada.id}/wallet`, { headers: bearer(tablet.token) });
  expect(own.status).toBe(200);
});

test("passing the other kid's secret is what opens the other kid", async () => {
  await post(`/api/kids/${ben.id}/switch-secret`, tablet.token, { secret: "7-2" });
  await post(`/api/kids/${ada.id}/switch-secret`, tablet.token, { secret: "1-4" });
  await post(`/api/kids/${ada.id}/unlock`, tablet.token, { secret: "1-4" });

  expect((await post(`/api/kids/${ben.id}/unlock`, tablet.token, { secret: "9-9" })).status).toBe(401);
  expect((await post(`/api/kids/${ben.id}/unlock`, tablet.token, { secret: "7-2" })).status).toBe(200);

  const spend = await post(`/api/kids/${ben.id}/buy`, tablet.token, { itemId: "item-screen-15" });
  expect(spend.status).not.toBe(403);

  // One tablet acts as ONE kid: opening Ben closed Ada.
  const ada2 = await app.request(`/api/kids/${ada.id}/wallet`, { headers: bearer(tablet.token) });
  expect(ada2.status).toBe(403);
});

test("a second tablet keeps its own idea of who it is", async () => {
  const other = await pairTablet("Bedroom tablet");
  await post(`/api/kids/${ada.id}/switch-secret`, tablet.token, { secret: "1-4" });
  await post(`/api/kids/${ben.id}/switch-secret`, other.token, { secret: "7-2" });

  expect((await app.request(`/api/kids/${ada.id}/wallet`, { headers: bearer(tablet.token) })).status).toBe(200);
  expect((await app.request(`/api/kids/${ben.id}/wallet`, { headers: bearer(other.token) })).status).toBe(200);
  expect((await app.request(`/api/kids/${ben.id}/wallet`, { headers: bearer(tablet.token) })).status).toBe(403);
});

// ---- it must not lock anybody out ----

test("a kid with no secret is gated by nothing, which is the behaviour this replaces", async () => {
  expect(hasSwitchSecret(ada.id)).toBe(false);
  const r = await app.request(`/api/kids/${ada.id}/wallet`, { headers: bearer(tablet.token) });
  expect(r.status).toBe(200);
  // ...and so is the sibling, because neither is enrolled yet.
  expect((await app.request(`/api/kids/${ben.id}/wallet`, { headers: bearer(tablet.token) })).status).toBe(200);
});

test("unlocking an un-enrolled kid succeeds and says so, without charging a guess", async () => {
  const r = await post(`/api/kids/${ada.id}/unlock`, tablet.token, {});
  expect(await r.json()).toMatchObject({ ok: true, via: "no_secret", enrolled: false });
});

test("the family PIN opens a kid who forgot", async () => {
  await repo.setFamilyPin(fam.id, await Bun.password.hash("1234"));
  await post(`/api/kids/${ada.id}/switch-secret`, tablet.token, { secret: "1-4" });
  await post(`/api/kids/${ben.id}/switch-secret`, tablet.token, { secret: "7-2" });

  expect((await post(`/api/kids/${ada.id}/unlock`, tablet.token, { pin: "9999" })).status).toBe(401);
  const ok = await post(`/api/kids/${ada.id}/unlock`, tablet.token, { pin: "1234" });
  expect(await ok.json()).toMatchObject({ ok: true, via: "pin" });
  expect((await app.request(`/api/kids/${ada.id}/wallet`, { headers: bearer(tablet.token) })).status).toBe(200);
});

test("a parent bearer is never gated: they act for every kid, and they do the resetting", async () => {
  const parentToken = newToken();
  await lockRepo.createParentToken(fam.id, "Mom's phone", await sha256Hex(parentToken));
  await post(`/api/kids/${ada.id}/switch-secret`, tablet.token, { secret: "1-4" });
  for (const kid of [ada, ben]) {
    const r = await app.request(`/api/kids/${kid.id}/wallet`, { headers: bearer(parentToken) });
    expect({ kid: kid.label, status: r.status }).toEqual({ kid: kid.label, status: 200 });
  }
});

// ---- taking a secret over ----

test("changing a secret needs the old one, and closes the kid on every other tablet", async () => {
  const other = await pairTablet("Bedroom tablet");
  await post(`/api/kids/${ada.id}/switch-secret`, tablet.token, { secret: "1-4" });
  await post(`/api/kids/${ada.id}/unlock`, other.token, { secret: "1-4" });
  expect((await app.request(`/api/kids/${ada.id}/wallet`, { headers: bearer(other.token) })).status).toBe(200);

  // A sibling who does not know the old one cannot take the account over.
  expect((await post(`/api/kids/${ada.id}/switch-secret`, tablet.token,
    { secret: "5-5", oldSecret: "0-0" })).status).toBe(401);

  const changed = await post(`/api/kids/${ada.id}/switch-secret`, tablet.token,
    { secret: "5-5", oldSecret: "1-4" });
  expect(changed.status).toBe(201);
  // The reason to change one is that somebody else learned it, so their tablet closes.
  expect((await app.request(`/api/kids/${ada.id}/wallet`, { headers: bearer(other.token) })).status).toBe(403);
  // The tablet that made the change is open, so a kid is never locked out by their own act.
  expect((await app.request(`/api/kids/${ada.id}/wallet`, { headers: bearer(tablet.token) })).status).toBe(200);
});

test("only the family PIN can turn the gate back off", async () => {
  await repo.setFamilyPin(fam.id, await Bun.password.hash("1234"));
  await post(`/api/kids/${ada.id}/switch-secret`, tablet.token, { secret: "1-4" });

  const noPin = await app.request(`/api/kids/${ada.id}/switch-secret`, {
    method: "DELETE", headers: bearer(tablet.token), body: JSON.stringify({ pin: "0000" }),
  });
  expect(noPin.status).toBe(401);
  expect(hasSwitchSecret(ada.id)).toBe(true);

  const ok = await app.request(`/api/kids/${ada.id}/switch-secret`, {
    method: "DELETE", headers: bearer(tablet.token), body: JSON.stringify({ pin: "1234" }),
  });
  expect(ok.status).toBe(200);
  expect(hasSwitchSecret(ada.id)).toBe(false);
});

// ---- guessing ----

test("wrong guesses run out, and a malformed body is a guess and not a free probe", async () => {
  await post(`/api/kids/${ada.id}/switch-secret`, tablet.token, { secret: "1-4" });
  const codes = ["0-0", "0-1", "0-2", "0-3", "0-4", "0-5", "0-6", "0-7", "0-8", "0-9"];
  const seen = new Set<number>();
  for (const secret of codes) seen.add((await post(`/api/kids/${ada.id}/unlock`, tablet.token, { secret })).status);
  expect(seen.has(429)).toBe(true);

  // Junk does not get a cheaper answer than a real guess; otherwise the shape check is a
  // free oracle for which sequences are even worth trying.
  resetRateLimits();
  const junk = [{}, { secret: "" }, { secret: "99-1" }, { secret: "1" }, { secret: [1, 4] }];
  for (const body of junk) {
    expect((await post(`/api/kids/${ada.id}/unlock`, tablet.token, body)).status).toBe(401);
  }
});

// ---- what crosses the wire ----

test("the roster says WHICH kids are gated and never how", async () => {
  await post(`/api/kids/${ada.id}/switch-secret`, tablet.token, { secret: "1-4" });
  const body = await (await app.request("/api/children", { headers: bearer(tablet.token) })).json();
  const byId = Object.fromEntries(body.children.map((c: Record<string, unknown>) => [c.id, c]));
  expect(byId[ada.id].hasSecret).toBe(true);
  expect(byId[ben.id].hasSecret).toBe(false);
  const serialised = JSON.stringify(body);
  expect(serialised).not.toContain("secret_hash");
  expect(serialised).not.toContain("$argon2");
});

test("a tablet from another household gets 404, not 403", async () => {
  const other = repo.createFamily("Dad", "NQ00");
  const kid = repo.createChild(other.id, "Cal", "🐢");
  const r = await post(`/api/kids/${kid.id}/unlock`, tablet.token, { secret: "1-4" });
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: "child_not_found" });
});

// ---- the wire form ----

test("the secret is tap INDICES, so no emoji encoding can change what it means", () => {
  expect(parseSecret("1-4")).toEqual([1, 4]);
  expect(parseSecret("0-11")).toEqual([0, 11]);
  for (const bad of ["1", "1-2-3", "1-12", "-1-2", "a-b", "1-", "", "🚀-🐸", null, 14, ["1", "4"]]) {
    expect({ bad, parsed: parseSecret(bad) }).toEqual({ bad, parsed: null });
  }
  // The grid and the parser have to agree on how many pictures there are.
  expect(parseSecret(`${SWITCH_PICTURES.length - 1}-0`)).toEqual([SWITCH_PICTURES.length - 1, 0]);
  expect(parseSecret(`${SWITCH_PICTURES.length}-0`)).toBe(null);
  expect(SWITCH_SECRET_TAPS).toBe(2);
});

// ---- the pictures and their art ----

test("the picture order is frozen: reordering it invalidates every stored secret", () => {
  // Deliberately a golden list rather than a length check. The secret is an INDEX, so a
  // reorder does not throw and does not fail any other test in this file — it just quietly
  // means a different picture, and the kid who taps what they remember is told they are
  // wrong. Append-only: adding a 13th at the end is fine and this list grows by one.
  expect([...SWITCH_PICTURES]).toEqual([
    "🚀", "🏎️", "⚽", "🚂", "🦋", "🌼",
    "🧁", "⭐", "🎸", "🌙", "🦕", "🦄",
  ]);
});

test.skipIf(!SWITCH_ART_SHIPPED)("every picture is drawn, and the file it names is really on disk", () => {
  // The lesson from the task icons (42/42): an emoji is a plausible-looking fallback, not a
  // visibly missing one, so a picture with no art reads as "fine" to everyone reviewing it.
  const grid = switchPictureGrid();
  expect(grid.length).toBe(SWITCH_PICTURES.length);
  for (const [i, p] of grid.entries()) {
    expect({ i, emoji: p.emoji }).toEqual({ i, emoji: SWITCH_PICTURES[i]! });
    expect({ i, url: p.url!.startsWith("/assets/secret/") }).toEqual({ i, url: true });
    const file = `public${p.url}`;
    expect({ i, file, exists: existsSync(file) }).toEqual({ i, file, exists: true });
  }
});

test.skipIf(SWITCH_ART_SHIPPED)("while no picture art ships, the grid carries the emoji and a null url at every index", () => {
  // The SUBJECTS are what a kid remembers, so the order and the emoji at each index are pinned
  // exactly as before; only the drawing behind them is gone (2026-09-15).
  const grid = switchPictureGrid();
  expect(grid.length).toBe(SWITCH_PICTURES.length);
  for (const [i, p] of grid.entries()) {
    expect({ i, emoji: p.emoji, url: p.url }).toEqual({ i, emoji: SWITCH_PICTURES[i]!, url: null });
  }
  expect(existsSync("public/assets/secret")).toBe(false);
});
