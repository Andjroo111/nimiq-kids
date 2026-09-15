// Kid-surface routes that resolve a subject by id must run it through the tenancy resolver,
// so that on a strict instance (HATCH_LEGACY_BOOT=0) the id stops being a capability. Before
// this fix, an anonymous caller could read and REWRITE another child's app state cross-tenant
// (the headline: PUT /children/:id/prefs succeeded with no Authorization header).

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as media from "./repo-media";
import * as routines from "./repo-routines";
import * as approvals from "./repo-approvals";
import * as lockRepo from "./repo-lock";
import { sha256Hex } from "./auth";
import { prefsRoutes } from "./routes/prefs";
import { stickersRoutes } from "./routes/stickers";
import { storeRoutes } from "./routes/store";
import { routinesRoutes } from "./routes/routines";

const app = new Hono()
  .route("/api", prefsRoutes)
  .route("/api", stickersRoutes)
  .route("/api", storeRoutes)
  .route("/api", routinesRoutes);

let famA: repo.Family, famB: repo.Family, kidA: repo.Child;
let tokenA: string, tokenB: string;

beforeEach(async () => {
  initTestDb();
  process.env.HATCH_LEGACY_BOOT = "0"; // strict: the public-instance posture
  famA = repo.createFamily("A", "NQ0A"); repo.updateFamilySettings(famA.id, { mode: "family" });
  famB = repo.createFamily("B", "NQ0B"); repo.updateFamilySettings(famB.id, { mode: "family" });
  kidA = repo.createChild(famA.id, "Ann", "🦊");
  tokenA = "tokA-" + crypto.randomUUID();
  tokenB = "tokB-" + crypto.randomUUID();
  lockRepo.createParentToken(famA.id, "A phone", await sha256Hex(tokenA));
  lockRepo.createParentToken(famB.id, "B phone", await sha256Hex(tokenB));
});

afterEach(() => { delete process.env.HATCH_LEGACY_BOOT; });

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const get = (p: string, h = {}) => app.request(p, { headers: h });
const putJson = (p: string, body: unknown, h = {}) =>
  app.request(p, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json", ...h } });
const postJson = (p: string, body: unknown, h = {}) =>
  app.request(p, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...h } });

test("GET/PUT /children/:id/prefs: anon + cross-family are 404; owner works", async () => {
  expect((await get(`/api/children/${kidA.id}/prefs`)).status).toBe(404); // anon
  expect((await get(`/api/children/${kidA.id}/prefs`, auth(tokenB))).status).toBe(404); // family B
  expect((await get(`/api/children/${kidA.id}/prefs`, auth(tokenA))).status).toBe(200); // owner

  // The headline: an anonymous write must NOT persist.
  const anonWrite = await putJson(`/api/children/${kidA.id}/prefs`, { backgroundId: "hacked" });
  expect(anonWrite.status).toBe(404);
  expect(media.getPrefs(kidA.id).background_id).not.toBe("hacked");

  // Owner write persists. A REAL scene id, not an invented one: since the theme wallpapers
  // landed, PUT prefs also refuses a background nobody has earned (403), so "sunset" would
  // now fail for a reason that has nothing to do with tenancy.
  const ownerWrite = await putJson(`/api/children/${kidA.id}/prefs`, { backgroundId: "space" }, auth(tokenA));
  expect(ownerWrite.status).toBe(200);
  expect(media.getPrefs(kidA.id).background_id).toBe("space");
});

test("PUT prefs cannot graft another household's photo as the egg image", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const foreign = media.createMedia(famB.id, null, "image", "hatch", "image/jpeg", bytes.length, "b.jpg");
  const res = await putJson(`/api/children/${kidA.id}/prefs`, { hatchAssetId: foreign.id }, auth(tokenA));
  expect(res.status).toBe(404); // media_not_found — asset belongs to family B
  expect(media.getPrefs(kidA.id).hatch_asset_id).toBeNull();
});

test("GET /kids/:id/stickers and /kids/:id/store: anon 404, owner 200", async () => {
  for (const p of [`/api/kids/${kidA.id}/stickers`, `/api/kids/${kidA.id}/store`]) {
    expect((await get(p)).status).toBe(404);
    expect((await get(p, auth(tokenB))).status).toBe(404);
    expect((await get(p, auth(tokenA))).status).toBe(200);
  }
});

test("POST /task-runs/:id/start: anon + cross-family 404; owner runs", async () => {
  const routine = routines.createRoutine(famA.id, kidA.id, "Morning", "morning");
  routines.addTask(routine.id, "Brush", 60, { rewardStars: 1 });
  const { taskRuns } = routines.todayRun(routine, "2026-08-02");
  const trId = taskRuns[0]!.id;

  expect((await postJson(`/api/task-runs/${trId}/start`, {})).status).toBe(404); // anon
  expect((await postJson(`/api/task-runs/${trId}/start`, {}, auth(tokenB))).status).toBe(404); // family B
  expect((await postJson(`/api/task-runs/${trId}/start`, {}, auth(tokenA))).status).toBe(200); // owner
});

test("GET /routine-runs/:id/approval no longer leaks another family's approval id", async () => {
  const routine = routines.createRoutine(famA.id, kidA.id, "Morning", "morning");
  routines.addTask(routine.id, "Brush", 60, { rewardStars: 1 });
  const { run } = routines.todayRun(routine, "2026-08-02");
  const pending = approvals.openApproval(famA.id, kidA.id, "routine_run", run.id);

  expect((await get(`/api/routine-runs/${run.id}/approval`)).status).toBe(404); // anon
  expect((await get(`/api/routine-runs/${run.id}/approval`, auth(tokenB))).status).toBe(404); // family B
  const ok = await get(`/api/routine-runs/${run.id}/approval`, auth(tokenA));
  expect(ok.status).toBe(200);
  expect((await ok.json()).approvalId).toBe(pending.id);
});
