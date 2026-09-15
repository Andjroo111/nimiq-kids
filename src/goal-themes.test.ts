// A goal ladder can collect toward a STICKER THEME: dragons, unicorns, robots.
//
// The load-bearing idea, and the one Andjroo arrived at (2026-08-04): THE COLLECTION IS THE
// UNIT, NOT THE LADDER. A theme is five stickers plus a boss; a three-rung ladder hands over
// three of them and a two-rung ladder finishes the set. The ladders do not have to know about
// each other, and the set does not have to know how it was earned.
//
// Two rules make it worth climbing, and both are tested here:
//   · a theme is NOT FOR SALE at any price, so a big balance cannot shortcut it
//   · its stickers are COLLECTED long before they are USABLE — nothing can be placed on a job
//     until the set is finished, and finishing hands over the boss and releases the lot
//
// Hermetic: in-memory DB, Hono app.request(), no chain.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb, getDb } from "./db";
import * as repo from "./repo";
import * as goals from "./repo-goals";
import * as stickers from "./repo-stickers";
import * as approvalsRepo from "./repo-approvals";
import * as lockRepo from "./repo-lock";
import * as media from "./repo-media";
import { hashPin, newToken, sha256Hex } from "./auth";
import { STICKER_ART_SHIPPED, STICKER_PACKS, packStoreItems } from "./sticker-catalog";
import { goalsRoutes } from "./routes/goals";
import { prefsRoutes } from "./routes/prefs";
import { approvalsRoutes } from "./routes/approvals";

const app = new Hono()
  .route("/api", goalsRoutes)
  .route("/api", approvalsRoutes)
  .route("/api", prefsRoutes);

const PARENT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const DRAGONS = "pack-dragons";
const RUNG = 20_000;

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

const auth = () => ({ Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" });
const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(`http://hatch.test${path}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
const patch = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(`http://hatch.test${path}`, {
    method: "PATCH", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", PARENT);
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ivy", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});

/** A ladder of `rungs` steps collecting toward the dragons, climbed all the way. */
async function climb(rungs: number, packId: string | null = DRAGONS) {
  const goal = goals.createGoal(fam.id, kid.id, `Ladder ${rungs}`, { packId, ordered: true });
  for (let i = 0; i < rungs; i++) goals.addRung(goal.id, `Step ${i + 1}`, { rewardLuna: RUNG });
  for (const r of goals.listRungs(goal.id)) {
    await post(`/api/goals/${goal.id}/rungs/${r.id}/claim`);
    const a = approvalsRepo.pendingApprovalFor("goal_rung", r.id)!;
    const res = await post(`/api/approvals/${a.id}/approve`, { pin: "1234" });
    expect(res.status).toBe(200);
  }
  return goal;
}

const dragonSet = () => stickers.packRungStickers(DRAGONS);
const owns = (id: string) => stickers.ownsSticker(kid.id, id);
const usable = () => stickers.ownedStickers(kid.id).map((s) => s.id);

// ---- the collection is the unit, not the ladder --------------------------------

test("every theme the catalogue ships is five plus a boss", () => {
  const themes = STICKER_PACKS.filter((p) => p.theme);
  // Unicorns and robots are designed and not drawn — see sticker-catalog.ts. What is asserted
  // is the SHAPE every theme has to have, not which ones happen to ship, so the next pack
  // landing does not edit this test. Only that at least one does.
  expect(themes.length).toBeGreaterThan(0);
  for (const t of themes) {
    expect(stickers.packRungStickers(t.id), `${t.id} rung stickers`).toHaveLength(5);
    expect(stickers.packBoss(t.id), `${t.id} boss`).not.toBeNull();
  }
});

test("one sticker per rung, in the set's own order", async () => {
  await climb(3);
  const set = dragonSet();
  expect(set.slice(0, 3).every((s) => owns(s.id))).toBe(true);
  expect(set.slice(3).some((s) => owns(s.id))).toBe(false);
});

test("a SECOND ladder finishes the set the first one started", async () => {
  await climb(3);
  expect(stickers.packComplete(kid.id, DRAGONS)).toBe(false);
  await climb(2);
  expect(stickers.packComplete(kid.id, DRAGONS)).toBe(true);
  expect(dragonSet().every((s) => owns(s.id))).toBe(true);
});

test("a rung climbed after the set is finished still pays, and grants nothing", async () => {
  await climb(5);
  const before = stickers.collectedStickers(kid.id, DRAGONS).length;
  await climb(1);
  expect(stickers.collectedStickers(kid.id, DRAGONS)).toHaveLength(before);
});

test("a ladder with no theme collects nothing at all", async () => {
  await climb(3, null);
  expect(stickers.collectedStickers(kid.id, DRAGONS)).toHaveLength(0);
});

// ---- collected is not the same as usable ---------------------------------------

test("a collected dragon cannot be placed on anything until the set is done", async () => {
  await climb(3);
  const set = dragonSet();
  // Earned, and in the collection...
  expect(owns(set[0]!.id)).toBe(true);
  expect(stickers.collectedStickers(kid.id, DRAGONS)).toHaveLength(3);
  // ...and absent from the pool every picker reads.
  expect(usable()).not.toContain(set[0]!.id);
  // The starter pack is unaffected: it is not a theme.
  stickers.ensureStarterGrant(kid.id);
  expect(usable().length).toBeGreaterThan(0);
});

test("finishing the set grants the boss and releases the whole pack at once", async () => {
  await climb(5);
  const boss = stickers.packBoss(DRAGONS)!;
  expect(owns(boss.id)).toBe(true);
  for (const s of [...dragonSet(), boss]) expect(usable(), s.label).toContain(s.id);
});

test("the boss is never handed out a rung at a time", async () => {
  await climb(4);
  expect(owns(stickers.packBoss(DRAGONS)!.id)).toBe(false);
  // And it is not one of the five: a set that included its own prize could never finish.
  expect(dragonSet().map((s) => s.id)).not.toContain(stickers.packBoss(DRAGONS)!.id);
});

test("one theme finishing does not release another", async () => {
  // The second theme is INSERTED here rather than taken from the catalogue: dragons is the
  // only theme whose art is drawn (unicorns and robots are designed and pulled, see
  // sticker-catalog.ts), and this rule is about the SQL in ownedStickers, not about which
  // packs happen to ship. Written this way it also survives the next pack landing.
  const db = getDb();
  db.run("INSERT INTO sticker_packs (id, title, price_luna, sort) VALUES (?,?,0,99)",
    ["pack-other", "Other"]);
  db.run("UPDATE sticker_packs SET theme=1 WHERE id='pack-other'");
  // TWO of them, and only one is granted: a one-sticker theme would be COMPLETE the moment the
  // kid owned it, and would release itself — proving nothing about the other theme.
  db.run("INSERT INTO stickers (id, pack_id, label, emoji) VALUES (?,?,?,?)",
    ["stk-other-1", "pack-other", "Other one", "❓"]);
  db.run("INSERT INTO stickers (id, pack_id, label, emoji) VALUES (?,?,?,?)",
    ["stk-other-2", "pack-other", "Other two", "❓"]);

  await climb(5);
  expect(usable()).toContain(stickers.packBoss(DRAGONS)!.id);
  stickers.grantSticker(kid.id, "stk-other-1");
  expect(usable()).not.toContain("stk-other-1");
});

// ---- the OTHER half of the prize: the app wallpaper ------------------------------
//
// Finishing a theme hands over TWO separate things (Andjroo, 2026-08-04): the boss sticker, and
// a full-screen background for the kid's app. The background is never painted behind the boss.

test("an unfinished theme has unlocked no wallpaper", async () => {
  await climb(4);
  expect(stickers.unlockedBackgrounds(kid.id)).toHaveLength(0);
});

// ---- wallpapers ----------------------------------------------------------------------
// The unlock is data-driven off `backgroundIds`, and since 2026-09-15 no theme names one (the
// wallpapers left with the rest of the generated art). The four tests that need a theme WITH a
// wallpaper skip until one is back; the one after them pins what the mechanic does meanwhile.
const WALLED = STICKER_PACKS.some((p) => p.theme && p.backgroundIds?.length);

test.skipIf(WALLED)("while no theme names a wallpaper, finishing one unlocks nothing and the built-ins stay free", async () => {
  await climb(5);
  expect(stickers.unlockedBackgrounds(kid.id)).toEqual([]);
  const res = await app.request(`http://hatch.test/api/children/${kid.id}/prefs`, {
    method: "PUT", body: JSON.stringify({ backgroundId: "space" }),
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status).toBe(200);
  expect(media.getPrefs(kid.id).background_id).toBe("space");
});

test.skipIf(!WALLED)("finishing the set unlocks its wallpapers, and only its own", async () => {
  await climb(5);
  const bgs = stickers.unlockedBackgrounds(kid.id);
  const pack = STICKER_PACKS.find((p) => p.id === DRAGONS)!;
  expect(bgs.map((b) => b.id)).toEqual(pack.backgroundIds!);
  expect(bgs[0]!.url).toBe(`/assets/backgrounds/${pack.backgroundIds![0]}.jpg`);
  // The other theme ships wallpapers too, and this kid has not earned them.
  const other = STICKER_PACKS.find((p) => p.theme && p.id !== DRAGONS && p.backgroundIds?.length);
  if (other) for (const id of other.backgroundIds!) expect(bgs.map((b) => b.id)).not.toContain(id);
});

// A pack may name more than one wallpaper, and finishing it hands over ALL of them. Robots is
// the first to do it: four were drawn to pick one from and Andjroo kept three (2026-08-06).
test.skipIf(!WALLED)("a pack naming several wallpapers unlocks every one of them", () => {
  const many = STICKER_PACKS.filter((p) => p.theme && (p.backgroundIds?.length ?? 0) > 1);
  expect(many.length).toBeGreaterThan(0);
  for (const p of many) expect(new Set(p.backgroundIds).size).toBe(p.backgroundIds!.length);
  // No two themes may claim the same wallpaper, or finishing one would light up another's.
  const all = STICKER_PACKS.flatMap((p) => p.backgroundIds ?? []);
  expect(new Set(all).size).toBe(all.length);
});

test.skipIf(!WALLED)("the kid's prefs carry the wallpapers they earned", async () => {
  const before = await (await app.request(`http://hatch.test/api/children/${kid.id}/prefs`))
    .json() as { backgrounds: { id: string }[] };
  expect(before.backgrounds).toHaveLength(0);
  await climb(5);
  const after = await (await app.request(`http://hatch.test/api/children/${kid.id}/prefs`))
    .json() as { backgrounds: { id: string }[] };
  expect(after.backgrounds).toHaveLength(1);
});

test.skipIf(!WALLED)("a wallpaper cannot be worn until it is earned, and the built-ins stay free", async () => {
  const wall = STICKER_PACKS.find((p) => p.id === DRAGONS)!.backgroundIds![0]!;
  const put = (body: Record<string, unknown>) =>
    app.request(`http://hatch.test/api/children/${kid.id}/prefs`, {
      method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
    });

  expect((await put({ backgroundId: wall })).status).toBe(403);
  // ...and the four scenes every kid has always had are not caught by that guard.
  expect((await put({ backgroundId: "space" })).status).toBe(200);

  await climb(5);
  expect((await put({ backgroundId: wall })).status).toBe(200);
  expect(media.getPrefs(kid.id).background_id).toBe(wall);
});

test.skipIf(!WALLED)("every theme wallpaper the catalogue names has art on disk", async () => {
  for (const p of STICKER_PACKS.filter((x) => x.theme && x.backgroundIds?.length)) {
    for (const id of p.backgroundIds!) {
      const f = Bun.file(`public/assets/backgrounds/${id}.jpg`);
      expect(await f.exists(), `${p.id} wallpaper ${id}.jpg`).toBe(true);
    }
  }
});

// ---- earned, never sold ---------------------------------------------------------

test("no theme is on the Treasure Box shelf at any price", () => {
  const shelved = new Set(packStoreItems().map((i) => i.packId));
  for (const t of STICKER_PACKS.filter((p) => p.theme)) {
    expect(shelved, `${t.id} must not be buyable`).not.toContain(t.id);
    expect(t.priceLuna, `${t.id} must be unpriced`).toBe(0);
  }
});

// ---- the ladder says where the collection has got to ----------------------------

test("the ladder reports the set filling up, empty slots and all", async () => {
  const goal = await climb(2);
  const view = goals.goalView(goals.getGoal(goal.id)!);
  expect(view.packId).toBe(DRAGONS);
  expect(view.theme!.collected).toBe(2);
  expect(view.theme!.total).toBe(5);
  expect(view.theme!.complete).toBe(false);
  expect(view.theme!.slots.map((s) => s.owned)).toEqual([true, true, false, false, false]);
  expect(view.theme!.boss!.owned).toBe(false);
});

test("a plain ladder reports no theme rather than an empty one", () => {
  const goal = goals.createGoal(fam.id, kid.id, "Plain", { packId: null });
  expect(goals.goalView(goal).theme).toBeNull();
});

// ---- the routes ------------------------------------------------------------------

test("GET /goal-themes offers every set with its art", async () => {
  const res = await app.request("http://hatch.test/api/goal-themes", { headers: auth() });
  const { themes } = await res.json() as {
    themes: { packId: string; stickers: { assetUrl: string | null }[]; boss: { id: string } }[];
  };
  expect(themes.length).toBeGreaterThan(0);
  expect(themes[0]!.stickers).toHaveLength(5);
  // The art rides the row while it ships; while it does not (2026-09-15) the URL is null and
  // the client draws the emoji, so the shape is pinned either way.
  if (STICKER_ART_SHIPPED) expect(themes[0]!.stickers[0]!.assetUrl).toMatch(/^\/assets\/stickers\//);
  else expect(themes[0]!.stickers[0]!.assetUrl).toBeNull();
  expect(themes[0]!.boss).not.toBeNull();
});

test("a goal can be created with a theme, and a bogus one is refused", async () => {
  const ok = await post("/api/goals", { childId: kid.id, title: "Ladder", packId: DRAGONS }, auth());
  expect(ok.status).toBe(201);
  expect((await ok.json() as { goal: { packId: string } }).goal.packId).toBe(DRAGONS);

  const bad = await post("/api/goals", { childId: kid.id, title: "X", packId: "pack-nope" }, auth());
  expect(bad.status).toBe(400);
  // A pack that EXISTS but is for sale is refused too: it would hand out stickers the kid
  // could have bought, which is the one thing keeping the two economies apart.
  const buyable = await post("/api/goals", { childId: kid.id, title: "Y", packId: "pack-space" }, auth());
  expect(buyable.status).toBe(400);
});

test("changing a ladder's theme takes the PIN and freezes while a rung waits", async () => {
  // Starts with NO theme and tries to add one, so the 409 can only be the freeze. Patching to
  // a bogus pack would 400 on validation and prove nothing about the rung waiting.
  const goal = goals.createGoal(fam.id, kid.id, "Ladder", { packId: null });
  const rung = goals.addRung(goal.id, "Step", { rewardLuna: RUNG });
  await post(`/api/goals/${goal.id}/rungs/${rung.id}/claim`);

  const res = await patch(`/api/goals/${goal.id}`, { packId: DRAGONS, pin: "1234" }, auth());
  expect(res.status).toBe(409);
  expect(goals.getGoal(goal.id)!.pack_id).toBeNull();
});

test("approving a rung tells the parent which sticker the kid just earned", async () => {
  const goal = goals.createGoal(fam.id, kid.id, "Ladder", { packId: DRAGONS });
  const rung = goals.addRung(goal.id, "Step", { rewardLuna: RUNG });
  await post(`/api/goals/${goal.id}/rungs/${rung.id}/claim`);
  const a = approvalsRepo.pendingApprovalFor("goal_rung", rung.id)!;
  const res = await post(`/api/approvals/${a.id}/approve`, { pin: "1234" });
  const body = await res.json() as { stickerId?: string; bossStickerId?: string };
  expect(body.stickerId).toBe(dragonSet()[0]!.id);
  expect(body.bossStickerId).toBeUndefined();
});

test("the rung that finishes the set reports the boss as well", async () => {
  await climb(4);
  const goal = goals.createGoal(fam.id, kid.id, "Last", { packId: DRAGONS });
  const rung = goals.addRung(goal.id, "Step", { rewardLuna: RUNG });
  await post(`/api/goals/${goal.id}/rungs/${rung.id}/claim`);
  const a = approvalsRepo.pendingApprovalFor("goal_rung", rung.id)!;
  const body = await (await post(`/api/approvals/${a.id}/approve`, { pin: "1234" })).json() as
    { stickerId?: string; bossStickerId?: string };
  expect(body.stickerId).toBe(dragonSet()[4]!.id);
  expect(body.bossStickerId).toBe(stickers.packBoss(DRAGONS)!.id);
});
