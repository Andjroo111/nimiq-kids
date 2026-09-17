// A kid asking for a goal ladder (#389).
//
// The three claims worth guarding, because each one fails SILENTLY if it regresses:
//   1. A request is not a goal. Approving is what creates the ladder, and approving without
//      a title is refused — the title is the half the kid and the grown-up settle together.
//   2. Only THEME packs can be asked for. A request naming a for-sale pack would become a
//      ladder handing out stickers the kid could have bought.
//   3. Asking twice for the same set is ONE ask, not two cards in a grown-up's queue.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as goals from "./repo-goals";
import { goalsRoutes } from "./routes/goals";
import { sha256Hex } from "./auth";

const app = new Hono().route("/api", goalsRoutes);

let fam: repo.Family;
let kid: repo.Child;
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const send = (m: string, p: string, b: Record<string, unknown> = {}) =>
  app.request(p, { method: m, body: JSON.stringify(b), headers: auth() });
const get = (p: string) => app.request(p, { headers: auth() });

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Mia", "🦄");
  token = "goalreq-parent-bearer";
  lockRepo.createParentToken(fam.id, "Test phone", await sha256Hex(token));
});

test("a kid can ask for a theme set, and it does NOT create a ladder", async () => {
  const res = await send("POST", `/api/kids/${kid.id}/goal-requests`, { packId: "pack-robots-theme" });
  expect(res.status).toBe(201);
  expect((await res.json()).request.status).toBe("pending");
  // the ask alone must not have minted anything
  expect(goals.listGoals(fam.id, kid.id).length).toBe(0);
});

test("a pack that is not a theme cannot be asked for", async () => {
  const res = await send("POST", `/api/kids/${kid.id}/goal-requests`, { packId: "pack-starter" });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("unknown_theme");
});

test("asking twice for the same set is one ask, not two", async () => {
  const a = await (await send("POST", `/api/kids/${kid.id}/goal-requests`, { packId: "pack-robots-theme" })).json();
  const b = await (await send("POST", `/api/kids/${kid.id}/goal-requests`, { packId: "pack-robots-theme" })).json();
  expect(b.request.id).toBe(a.request.id);
  expect((await (await get("/api/parent/goal-requests")).json()).requests.length).toBe(1);
});

test("approving REQUIRES a title — the ladder is named together, not by the tap", async () => {
  const r = (await (await send("POST", `/api/kids/${kid.id}/goal-requests`, { packId: "pack-robots-theme" })).json()).request;
  const res = await send("POST", `/api/parent/goal-requests/${r.id}/decide`, { approve: true });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("title_required");
  expect(goals.listGoals(fam.id, kid.id).length).toBe(0);  // still nothing minted
});

test("approving with a title creates the ladder carrying that theme", async () => {
  const r = (await (await send("POST", `/api/kids/${kid.id}/goal-requests`, { packId: "pack-robots-theme" })).json()).request;
  const res = await send("POST", `/api/parent/goal-requests/${r.id}/decide`,
    { approve: true, title: "Practise piano twice a week" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.request.status).toBe("approved");
  const made = goals.listGoals(fam.id, kid.id);
  expect(made.length).toBe(1);
  expect(made[0].pack_id).toBe("pack-robots-theme");
  expect(made[0].title).toBe("Practise piano twice a week");
  expect(body.request.goal_id).toBe(made[0].id);
});

test("declining answers the ask and mints nothing", async () => {
  const r = (await (await send("POST", `/api/kids/${kid.id}/goal-requests`, { packId: "pack-robots-theme" })).json()).request;
  const res = await send("POST", `/api/parent/goal-requests/${r.id}/decide`, { approve: false });
  expect((await res.json()).request.status).toBe("declined");
  expect(goals.listGoals(fam.id, kid.id).length).toBe(0);
});

test("a decided request cannot be decided again", async () => {
  const r = (await (await send("POST", `/api/kids/${kid.id}/goal-requests`, { packId: "pack-robots-theme" })).json()).request;
  await send("POST", `/api/parent/goal-requests/${r.id}/decide`, { approve: true, title: "Read every night" });
  const again = await send("POST", `/api/parent/goal-requests/${r.id}/decide`, { approve: true, title: "Again" });
  expect(again.status).toBe(409);
  expect(goals.listGoals(fam.id, kid.id).length).toBe(1);   // not a second ladder
});
