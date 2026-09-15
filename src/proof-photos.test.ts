// A kid's proof photo does not outlive the question it answers (#282).
//
// Two deletes: the decision (primary, immediate) and the 24h TTL (backstop, lazy). Both are
// tested here against real files on disk, because the row and the bytes are separate things
// and the whole point of the change is that NEITHER is kept.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTestDb, getDb } from "./db";
import * as repo from "./repo";
import * as approvalsRepo from "./repo-approvals";
import * as mediaRepo from "./repo-media";
import * as lockRepo from "./repo-lock";
import { hashPin, newToken, sha256Hex } from "./auth";
import { mediaRoutes, mediaDir } from "./routes/media";
import { approvalsRoutes } from "./routes/approvals";
import { PROOF_TTL_MS, sweepExpiredProofs } from "./proof-photos";

const app = new Hono().route("/api", mediaRoutes).route("/api", approvalsRoutes);

let fam: repo.Family;
let kid: repo.Child;
let token: string;

beforeEach(async () => {
  initTestDb();
  process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), "kids-proof-"));
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  token = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(token));
});

/** Upload a proof photo and attach it to a fresh pending approval. */
async function proofOnApproval(): Promise<{ approvalId: string; assetId: string; path: string }> {
  const chore = repo.createChore(fam.id, kid.id, "Feed the cat", 100);
  const approval = approvalsRepo.openApproval(fam.id, kid.id, "chore", chore.id);
  const form = new FormData();
  form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], "p.jpg", { type: "image/jpeg" }));
  form.set("role", "proof");
  form.set("childId", kid.id);
  const up = await app.request("/api/media", { method: "POST", body: form });
  const { media } = await up.json();
  const att = await app.request(`/api/approvals/${approval.id}/photo`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaAssetId: media.id }),
  });
  expect(att.status).toBe(200);
  const asset = mediaRepo.getMedia(media.id)!;
  expect(existsSync(join(mediaDir(), asset.path))).toBe(true);
  return { approvalId: approval.id, assetId: media.id, path: asset.path };
}

test("deciding an approval deletes the proof photo, its row, and its bytes", async () => {
  const { approvalId, assetId, path } = await proofOnApproval();

  expect(approvalsRepo.decideApproval(approvalId, "approved", "pin", null, null)).toBe(true);

  expect(mediaRepo.getMedia(assetId)).toBeNull();
  expect(approvalsRepo.getApproval(approvalId)!.photo_asset_id).toBeNull();
  // The unlink is fired without being awaited (the row is the boundary, the file is hygiene),
  // so give the microtask queue a turn before looking at the disk.
  await Bun.sleep(20);
  expect(existsSync(join(mediaDir(), path))).toBe(false);
});

test("rejecting deletes it too — the photo's question is over either way", async () => {
  const { approvalId, assetId } = await proofOnApproval();
  approvalsRepo.decideApproval(approvalId, "rejected", "pin", null, "not done");
  expect(mediaRepo.getMedia(assetId)).toBeNull();
});

// The FK is the reason this cannot be a bare DELETE: `approvals.photo_asset_id` really
// references `media_assets(id)` and the DB runs `PRAGMA foreign_keys = ON`, so forgetting to
// clear the pointer throws SQLITE_CONSTRAINT_FOREIGNKEY — the #277 bug, one table over.
test("deciding does not trip the foreign key, and the approval still decides", async () => {
  const { approvalId } = await proofOnApproval();
  expect(() => approvalsRepo.decideApproval(approvalId, "approved", "pin", null, null)).not.toThrow();
  expect(approvalsRepo.getApproval(approvalId)!.status).toBe("approved");
});

test("a second decide is a no-op and deletes nothing twice", async () => {
  const { approvalId } = await proofOnApproval();
  expect(approvalsRepo.decideApproval(approvalId, "approved", "pin", null, null)).toBe(true);
  expect(approvalsRepo.decideApproval(approvalId, "rejected", "pin", null, null)).toBe(false);
});

test("the TTL backstop takes an undecided photo, and leaves a fresh one", async () => {
  const stale = await proofOnApproval();
  const fresh = await proofOnApproval();
  getDb().run("UPDATE media_assets SET created_at=? WHERE id=?",
    [Date.now() - PROOF_TTL_MS - 1000, stale.assetId]);

  expect(await sweepExpiredProofs()).toBe(1);

  expect(mediaRepo.getMedia(stale.assetId)).toBeNull();
  expect(existsSync(join(mediaDir(), stale.path))).toBe(false);
  expect(approvalsRepo.getApproval(stale.approvalId)!.photo_asset_id).toBeNull();
  expect(approvalsRepo.getApproval(stale.approvalId)!.status).toBe("pending"); // only the photo went
  expect(mediaRepo.getMedia(fresh.assetId)).not.toBeNull();
});

test("the sweep rides the approvals read path — no cron", async () => {
  const { assetId } = await proofOnApproval();
  getDb().run("UPDATE media_assets SET created_at=? WHERE id=?",
    [Date.now() - PROOF_TTL_MS - 1000, assetId]);

  const res = await app.request("/api/approvals", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(mediaRepo.getMedia(assetId)).toBeNull();
});

test("the sweep rides the upload path — every new photo pays for the last", async () => {
  const { assetId } = await proofOnApproval();
  getDb().run("UPDATE media_assets SET created_at=? WHERE id=?",
    [Date.now() - PROOF_TTL_MS - 1000, assetId]);

  await proofOnApproval(); // a fresh upload
  expect(mediaRepo.getMedia(assetId)).toBeNull();
});
