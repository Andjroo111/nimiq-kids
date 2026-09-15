// A kid adding jobs to their own board, and taking them off again.
// The rules Andjroo set: either side can name an amount but nothing pays without
// a parent approving; a kid may remove by default, the parent has a switch, and
// removal is SOFT so the parent can see what went.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import { hashPin } from "./auth";
import { chores } from "./routes/chores";
import { starsRoutes } from "./routes/stars";
import { approvalsRoutes } from "./routes/approvals";

const app = new Hono()
  .route("/api", chores).route("/api", starsRoutes).route("/api", approvalsRoutes);
const get = (p: string) => app.request(p);
const post = (p: string, body: Record<string, unknown> = {}) =>
  app.request(p, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const patch = (p: string, body: Record<string, unknown> = {}) =>
  app.request(p, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

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

const addByKid = (body: Record<string, unknown> = {}) =>
  post("/api/chores", { childId: kid.id, title: "Water the plants", createdBy: "kid", ...body });

// ---- adding ----
test("a kid can add a job worth nothing at all", async () => {
  const res = await addByKid();
  expect(res.status).toBe(201);
  const chore = (await res.json()).chore;
  expect(chore.created_by).toBe("kid");
  expect(chore.reward_luna).toBe(0);
});

test("a kid can name an amount; a parent-added job still needs one", async () => {
  const withReward = (await (await addByKid({ rewardLuna: 500 * 100_000 })).json()).chore;
  expect(withReward.reward_luna).toBe(500 * 100_000);
  expect(withReward.created_by).toBe("kid");
  // A parent adding a chore with no reward is still a mistake, not a feature.
  const parentNoReward = await post("/api/chores", { childId: kid.id, title: "Dishes" });
  expect(parentNoReward.status).toBe(400);
  expect((await parentNoReward.json()).error).toBe("reward_required");
  // Negative is nonsense from either side.
  expect((await addByKid({ rewardLuna: -5 })).status).toBe(400);
});

test("a kid naming a big amount still cannot pay themselves", async () => {
  const chore = (await (await addByKid({ rewardLuna: 9_999 * 100_000 })).json()).chore;
  await post(`/api/chores/${chore.id}/submit`);
  // It lands in the parent's queue like any other job — no payout has happened.
  expect(repo.getChore(chore.id)!.status).toBe("submitted");
  expect(repo.getChore(chore.id)!.approved_at).toBeNull();
});

// ---- removing ----
test("a kid removes their own job; it leaves their board but not the record", async () => {
  const chore = (await (await addByKid()).json()).chore;
  const res = await post(`/api/chores/${chore.id}/remove`);
  expect(res.status).toBe(200);

  // Gone from the kid's board...
  const board = (await (await get(`/api/chores?childId=${kid.id}`)).json()).chores;
  expect(board.find((c: { id: string }) => c.id === chore.id)).toBeUndefined();
  // ...but the parent can see exactly what went, and who took it.
  const removed = (await (await get(`/api/chores/removed?childId=${kid.id}`)).json()).chores;
  expect(removed.length).toBe(1);
  expect(removed[0].id).toBe(chore.id);
  expect(removed[0].removed_by).toBe("kid");
  expect(removed[0].removed_at).toBeGreaterThan(0);
});

test("the parent's switch turns kid removal off", async () => {
  const chore = (await (await addByKid()).json()).chore;
  await patch("/api/family/settings", { pin: "1234", kidsCanRemove: false });
  expect(repo.getFamily(fam.id)!.kids_can_remove).toBe(0);

  const refused = await post(`/api/chores/${chore.id}/remove`);
  expect(refused.status).toBe(403);
  expect((await refused.json()).error).toBe("removal_not_allowed");
  expect(repo.getChore(chore.id)!.removed_at).toBeNull();

  // The parent can still remove it themselves.
  const byParent = await post(`/api/chores/${chore.id}/remove`, { pin: "1234" });
  expect(byParent.status).toBe(200);
  expect(repo.getChore(chore.id)!.removed_by).toBe("parent");
});

test("a kid cannot remove a job they already handed in", async () => {
  const chore = (await (await addByKid({ rewardLuna: 100_000 })).json()).chore;
  await post(`/api/chores/${chore.id}/submit`);
  const res = await post(`/api/chores/${chore.id}/remove`);
  expect(res.status).toBe(403);
  expect((await res.json()).error).toBe("already_started");
  // The parent still can — a submitted job is theirs to resolve.
  expect((await post(`/api/chores/${chore.id}/remove`, { pin: "1234" })).status).toBe(200);
});

test("the parent puts it back", async () => {
  const chore = (await (await addByKid()).json()).chore;
  await post(`/api/chores/${chore.id}/remove`);
  expect((await post(`/api/chores/${chore.id}/restore`)).status).toBe(401); // kid may not
  expect((await post(`/api/chores/${chore.id}/restore`, { pin: "1234" })).status).toBe(200);

  const back = repo.getChore(chore.id)!;
  expect(back.removed_at).toBeNull();
  expect(back.removed_by).toBeNull();
  const board = (await (await get(`/api/chores?childId=${kid.id}`)).json()).chores;
  expect(board.find((c: { id: string }) => c.id === chore.id)).toBeTruthy();
});

test("removing twice is harmless and keeps the first record", async () => {
  const chore = (await (await addByKid()).json()).chore;
  await post(`/api/chores/${chore.id}/remove`);
  const first = repo.getChore(chore.id)!.removed_at;
  await post(`/api/chores/${chore.id}/remove`, { pin: "1234" });
  expect(repo.getChore(chore.id)!.removed_at).toBe(first);
  expect(repo.getChore(chore.id)!.removed_by).toBe("kid"); // who actually took it off
});
