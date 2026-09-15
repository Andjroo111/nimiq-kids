// GET /api/media and GET /api/media/:id/file must not expose one household's photos to
// another. On a strict instance (HATCH_LEGACY_BOOT=0, or mainnet) an anonymous or
// cross-family caller gets 404; the owning family reads via its bearer, and a bare <img>
// (no Authorization header) reads via the short-lived media cookie the listing/upload set.
// On a relaxed instance the open kid-tablet model is unchanged.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as media from "./repo-media";
import * as lockRepo from "./repo-lock";
import { sha256Hex } from "./auth";
import { mediaRoutes } from "./routes/media";

const app = new Hono().route("/api", mediaRoutes);

let famA: repo.Family, famB: repo.Family, kidA: repo.Child, kidB: repo.Child;
let tokenA: string, tokenB: string;

beforeEach(async () => {
  initTestDb();
  process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), "kids-media-authz-"));
  famA = repo.createFamily("A", "NQ0A"); repo.updateFamilySettings(famA.id, { mode: "family" });
  famB = repo.createFamily("B", "NQ0B"); repo.updateFamilySettings(famB.id, { mode: "family" });
  kidA = repo.createChild(famA.id, "Ann", "🦊");
  kidB = repo.createChild(famB.id, "Bo", "🐢");
  tokenA = "tokA-" + crypto.randomUUID();
  tokenB = "tokB-" + crypto.randomUUID();
  lockRepo.createParentToken(famA.id, "A phone", await sha256Hex(tokenA));
  lockRepo.createParentToken(famB.id, "B phone", await sha256Hex(tokenB));
});

afterEach(() => { delete process.env.HATCH_LEGACY_BOOT; });

async function seedAsset(familyId: string, childId: string) {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const rel = `${childId}.jpg`;
  await Bun.write(join(process.env.MEDIA_DIR!, rel), bytes);
  return media.createMedia(familyId, childId, "image", "proof", "image/jpeg", bytes.length, rel);
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const setCookieValue = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

test("strict: anonymous and cross-family listing are refused; owner works and primes a cookie", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  await seedAsset(famA.id, kidA.id);

  expect((await app.request(`/api/media?childId=${kidA.id}`)).status).toBe(404); // anonymous
  expect((await app.request(`/api/media?childId=${kidA.id}`, { headers: bearer(tokenB) })).status).toBe(404); // family B

  const owner = await app.request(`/api/media?childId=${kidA.id}`, { headers: bearer(tokenA) });
  expect(owner.status).toBe(200);
  expect((await owner.json()).media.length).toBe(1);
  expect(owner.headers.get("set-cookie")).toContain("kms=");
});

test("strict: file bytes require ownership — anon 404, owner bearer 200, owner cookie 200, cross-family 404", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  const assetA = await seedAsset(famA.id, kidA.id);

  expect((await app.request(`/api/media/${assetA.id}/file`)).status).toBe(404); // anonymous <img>
  expect((await app.request(`/api/media/${assetA.id}/file`, { headers: bearer(tokenB) })).status).toBe(404); // family B
  expect((await app.request(`/api/media/${assetA.id}/file`, { headers: bearer(tokenA) })).status).toBe(200); // owner bearer

  // The cookie family A gets from its own listing loads the bare <img>...
  const listA = await app.request(`/api/media?childId=${kidA.id}`, { headers: bearer(tokenA) });
  const cookieA = setCookieValue(listA);
  expect((await app.request(`/api/media/${assetA.id}/file`, { headers: { Cookie: cookieA } })).status).toBe(200);

  // ...but family B's cookie cannot fetch family A's asset.
  const listB = await app.request(`/api/media?childId=${kidB.id}`, { headers: bearer(tokenB) });
  const cookieB = setCookieValue(listB);
  expect(cookieB).toContain("kms=");
  expect((await app.request(`/api/media/${assetA.id}/file`, { headers: { Cookie: cookieB } })).status).toBe(404);
});

test("strict: a forged/garbage media cookie is rejected", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  const assetA = await seedAsset(famA.id, kidA.id);
  // Right family id, wrong signature.
  expect((await app.request(`/api/media/${assetA.id}/file`, { headers: { Cookie: `kms=${famA.id}.deadbeef` } })).status).toBe(404);
  expect((await app.request(`/api/media/${assetA.id}/file`, { headers: { Cookie: "kms=garbage" } })).status).toBe(404);
});

test("relaxed instance keeps the open kid-tablet model (list + file with no auth)", async () => {
  const assetA = await seedAsset(famA.id, kidA.id);
  expect((await app.request(`/api/media?childId=${kidA.id}`)).status).toBe(200);
  expect((await app.request(`/api/media/${assetA.id}/file`)).status).toBe(200);
});
