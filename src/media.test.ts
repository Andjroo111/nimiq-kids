// Media upload validation + payout endpoint (SIM provider). Hermetic app.request tests.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as approvalsRepo from "./repo-approvals";
import * as mediaRepo from "./repo-media";
import * as wrepo from "./repo-wallet";
import { hashPin } from "./auth";
import { mediaRoutes, MEDIA_MAX_BYTES } from "./routes/media";
import { starsRoutes } from "./routes/stars";
import { cashlinks } from "./routes/cashlinks";

const app = new Hono()
  .route("/api", mediaRoutes)
  .route("/api", starsRoutes)
  .route("/api", cashlinks);

let fam: repo.Family;
let kid: repo.Child;

beforeEach(async () => {
  initTestDb();
  process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), "kids-media-"));
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
});

function upload(file: File, role = "proof", childId?: string) {
  const form = new FormData();
  form.set("file", file);
  form.set("role", role);
  form.set("childId", childId ?? kid.id);
  return app.request("/api/media", { method: "POST", body: form });
}

test("upload accepts a jpeg, serves it back, and lists it for the kid", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const res = await upload(new File([bytes], "proof.jpg", { type: "image/jpeg" }));
  expect(res.status).toBe(201);
  const { media } = await res.json();
  expect(media.kind).toBe("image");

  const file = await app.request(media.url);
  expect(file.status).toBe(200);
  expect(file.headers.get("Content-Type")).toBe("image/jpeg");
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);

  const list = await app.request(`/api/media?childId=${kid.id}&role=proof`);
  expect((await list.json()).media.length).toBe(1);
});

test("upload rejects unsupported mime and oversize files", async () => {
  const bad = await upload(new File([new Uint8Array(4)], "x.gif", { type: "image/gif" }));
  expect(bad.status).toBe(415);
  const big = await upload(new File([new Uint8Array(MEDIA_MAX_BYTES + 1)], "big.jpg", { type: "image/jpeg" }));
  expect(big.status).toBe(413);
});

// A kid's photograph is not something this server takes any more (#282): sticker photos live
// in the tablet's IndexedDB and hatch photos have been device-local since the timer rig was
// vendored in. Neither role has a writer left, so neither is accepted — a route that still
// took the bytes would quietly keep being the custodian this change exists to stop being.
test("upload refuses the roles whose photos went local", async () => {
  for (const role of ["sticker", "hatch"]) {
    const res = await upload(new File([new Uint8Array(4)], "x.jpg", { type: "image/jpeg" }), role);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_role");
  }
});

test("media delete requires parent auth", async () => {
  const res = await upload(new File([new Uint8Array(4)], "x.jpg", { type: "image/jpeg" }));
  const { media } = await res.json();
  const id = media.url.split("/")[3];
  const denied = await app.request(`/api/media/${id}`, {
    method: "DELETE", body: JSON.stringify({}), headers: { "Content-Type": "application/json" },
  });
  expect(denied.status).toBe(401);
  const ok = await app.request(`/api/media/${id}`, {
    method: "DELETE", body: JSON.stringify({ pin: "1234" }), headers: { "Content-Type": "application/json" },
  });
  expect(ok.status).toBe(200);
});

// The bug this pins: kid_prefs.hatch_asset_id is a real FK under `PRAGMA foreign_keys = ON`,
// so the bare DELETE this route used to run threw SQLITE_CONSTRAINT_FOREIGNKEY on the single
// most likely photo to be deleted — the one currently selected — and the route answered 500.
// purgeFamily has always cleared kid_prefs before media_assets; the single-asset path did not.
// The row is seeded through the repo rather than uploaded: `hatch` stopped being an
// uploadable role in #282 (its only writer was studio.js, which is deleted), but rows like
// this one exist on live instances and the delete path still has to survive them.
test("deleting the SELECTED hatch photo works and drops the kid back to surprise", async () => {
  const id = mediaRepo.createMedia(fam.id, kid.id, "image", "hatch", "image/jpeg", 4, "2026/07/x.jpg").id;
  mediaRepo.updatePrefs(kid.id, { hatch_mode: "photo", hatch_asset_id: id });
  expect(mediaRepo.getPrefs(kid.id).hatch_asset_id).toBe(id);

  const del = await app.request(`/api/media/${id}`, {
    method: "DELETE", body: JSON.stringify({ pin: "1234" }), headers: { "Content-Type": "application/json" },
  });
  expect(del.status).toBe(200);

  const prefs = mediaRepo.getPrefs(kid.id);
  expect(prefs.hatch_asset_id).toBeNull();
  // Not just nulled: the mode has to follow, or a picker reading the mode alone lights up
  // photo mode with no photo behind it.
  expect(prefs.hatch_mode).toBe("surprise");
});

test("allowance-day payout: stars -> one 'stars' cashlink -> claim credits NIM, no streak", async () => {
  approvalsRepo.addStarEvent(fam.id, kid.id, 14, "routine");
  const res = await app.request(`/api/children/${kid.id}/payout`, {
    method: "POST", body: JSON.stringify({ pin: "1234" }), headers: { "Content-Type": "application/json" },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.stars).toBe(14);
  expect(body.cashlink.valueLuna).toBe(14 * fam.star_rate_luna);
  expect(repo.getChild(kid.id)!.star_balance).toBe(0);
  expect(approvalsRepo.starBalanceFromLedger(kid.id)).toBe(0);

  // kid claims (SIM) -> NIM tally credited, streak untouched
  const claim = await app.request(`/api/cashlinks/${body.cashlink.id}/claim-sim`, { method: "POST" });
  expect(claim.status).toBe(200);
  const child = repo.getChild(kid.id)!;
  expect(child.balance_luna).toBe(14 * fam.star_rate_luna);
  expect(child.streak_count).toBe(0);
});

test("payout with zero stars 400s; payout without parent auth 401s", async () => {
  const noAuth = await app.request(`/api/children/${kid.id}/payout`, {
    method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" },
  });
  expect(noAuth.status).toBe(401);
  const noStars = await app.request(`/api/children/${kid.id}/payout`, {
    method: "POST", body: JSON.stringify({ pin: "1234" }), headers: { "Content-Type": "application/json" },
  });
  expect(noStars.status).toBe(400);
});

test("a big allowance day is refused ONLY when the wallet cannot fund it", async () => {
  // There is no ceiling on a star payout any more (2026-07-31) — the parent sets the star
  // rate, so the parent sets what allowance day is worth. Funding is the only bound.
  const stars = 400;
  const valueLuna = stars * fam.star_rate_luna;
  approvalsRepo.addStarEvent(fam.id, kid.id, stars, "adjust");
  const payout = () => app.request(`/api/children/${kid.id}/payout`, {
    method: "POST", body: JSON.stringify({ pin: "1234" }), headers: { "Content-Type": "application/json" },
  });

  wrepo.setWalletState(wrepo.HOT_BALANCE_KEY, String(valueLuna - 1));
  const short = await payout();
  expect(short.status).toBe(400);
  expect((await short.json()).error).toBe("budget_exhausted");
  expect(repo.getChild(kid.id)!.star_balance).toBe(stars); // nothing debited, nothing minted

  // Funded, the very same payout goes through — however large it is.
  wrepo.setWalletState(wrepo.HOT_BALANCE_KEY, String(valueLuna));
  const ok = await payout();
  expect(ok.status).toBe(200);
  expect((await ok.json()).cashlink.valueLuna).toBe(valueLuna);
  expect(repo.getChild(kid.id)!.star_balance).toBe(0);
});
