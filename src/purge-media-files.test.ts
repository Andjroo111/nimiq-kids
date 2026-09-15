// Purging a household has to take the BYTES, not only the rows.
//
// `purgeFamily` was careful about rows — it walks every table with a children FK, and a
// schema-derived test keeps that list from falling behind. It was silent about files.
// `DELETE FROM media_assets` drops `media_assets.path`, the only record of where each upload
// lives, while the JPEG stayed on disk: no row pointing at it, no owner, no expiry, and no
// query that could even tell an orphan from a real family's photo.
//
// That matters because of WHO uploads on the instance this runs on. Every visitor to /demo
// mints a household, the kid app hands them three rear-camera capture buttons, and the pitch
// is "try it with your kid" — so what a judge uploads to the public demo is plausibly a
// photograph of a child. The sweeper deleted the household a day later and kept the image
// for ever, with no erasure path a visitor could invoke even if they asked for one.
//
// The same data deleted through DELETE /api/media/:id has always unlinked correctly, so this
// was an inconsistency inside the codebase rather than a considered retention decision.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { initTestDb, getDb } from "./db";
import * as repo from "./repo";
import * as media from "./repo-media";
import { mintDemoFamily, purgeFamily, sweepDemoFamilies } from "./demo-family";

const HOT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
let dir: string;
let savedMediaDir: string | undefined;

beforeEach(() => {
  savedMediaDir = process.env.MEDIA_DIR;
  dir = mkdtempSync(join(tmpdir(), "kids-media-"));
  process.env.MEDIA_DIR = dir;
  initTestDb();
});

afterEach(() => {
  if (savedMediaDir === undefined) delete process.env.MEDIA_DIR;
  else process.env.MEDIA_DIR = savedMediaDir;
  rmSync(dir, { recursive: true, force: true });
});

/** An uploaded photo: the row AND the file on disk, the way POST /api/media leaves them. */
function upload(familyId: string, childId: string, rel: string): string {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, "not-really-a-jpeg");
  media.createMedia(familyId, childId, "image", "proof", "image/jpeg", 17, rel);
  return abs;
}

test("purging a household deletes its photo FILES, not only the index", async () => {
  const fam = await mintDemoFamily(HOT);
  const kid = repo.listChildren(fam.familyId)[0]!;
  const a = upload(fam.familyId, kid.id, "2026/08/one.jpg");
  const b = upload(fam.familyId, kid.id, "2026/08/two.jpg");
  expect(existsSync(a) && existsSync(b)).toBe(true);

  await purgeFamily(fam.familyId);

  expect(existsSync(a)).toBe(false);
  expect(existsSync(b)).toBe(false);
  expect(media.listMedia(kid.id).length).toBe(0);
});

test("another household's photos are untouched", async () => {
  const doomed = await mintDemoFamily(HOT);
  const keeper = await mintDemoFamily(HOT);
  const doomedKid = repo.listChildren(doomed.familyId)[0]!;
  const keeperKid = repo.listChildren(keeper.familyId)[0]!;
  const gone = upload(doomed.familyId, doomedKid.id, "2026/08/gone.jpg");
  const kept = upload(keeper.familyId, keeperKid.id, "2026/08/kept.jpg");

  await purgeFamily(doomed.familyId);

  expect(existsSync(gone)).toBe(false);
  expect(existsSync(kept)).toBe(true);
  expect(media.listMedia(keeperKid.id).length).toBe(1);
});

test("a file already missing does not strand the household", async () => {
  const fam = await mintDemoFamily(HOT);
  const kid = repo.listChildren(fam.familyId)[0]!;
  // Row with no file behind it: a half-finished upload, a restored DB, a hand-cleaned disk.
  media.createMedia(fam.familyId, kid.id, "image", "proof", "image/jpeg", 1, "2026/08/vanished.jpg");
  const real = upload(fam.familyId, kid.id, "2026/08/real.jpg");

  await purgeFamily(fam.familyId); // must not throw

  expect(existsSync(real)).toBe(false);
  expect(repo.getFamily(fam.familyId)).toBeNull();
});

test("the hourly sweeper takes the files with the households", async () => {
  const fam = await mintDemoFamily(HOT);
  const kid = repo.listChildren(fam.familyId)[0]!;
  const shot = upload(fam.familyId, kid.id, "2026/08/judge.jpg");
  const ttl = 24 * 3600_000;
  getDb().run("UPDATE families SET demo_at=? WHERE id=?", [Date.now() - 2 * ttl, fam.familyId]);

  const r = await sweepDemoFamilies(ttl, Date.now(), {
    hotAddress: async () => HOT, balanceOf: async () => 0, sweepTo: async () => "tx:none",
  });

  expect(r.purged).toBe(1);
  expect(existsSync(shot)).toBe(false);
  expect(repo.getFamily(fam.familyId)).toBeNull();
});
