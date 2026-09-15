// The parent's manual override, from the phone's side (#304): what the overview tells a
// parent screen about a kid's tablet, and what Clear is allowed to touch.
//
// #303 gave a parent the SCHEDULE and #301/#302 settled who outranks whom, but the manual
// override still had no button and the two rules below are what a button needs before it
// can be honest. Both are about a purchase, because a purchase is the one row on this
// table that cost somebody real money.
//
// Hermetic: in-memory DB + app.request(), no RPC.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as memberRepo from "./repo-members";
import { newToken, sha256Hex } from "./auth";
import { parentRoutes } from "./routes/parent";
import { lockRoutes } from "./routes/lock";

const app = new Hono().route("/api", parentRoutes).route("/api", lockRoutes);

const MIN = 60_000;

let fam: repo.Family;
let kid: repo.Child;
let sibling: repo.Child;
let bearer: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  sibling = repo.createChild(fam.id, "Kid 2", "🐙");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});

/** Built per call, never hoisted to a module const: `bearer` is minted in beforeEach. */
const auth = () => ({ Authorization: `Bearer ${bearer}` });
const del = (path: string) => app.request(path, { method: "DELETE", headers: auth() });

interface KidRow {
  id: string;
  override: lockRepo.LockOverride | null;
  purchasedUnlock: lockRepo.LockOverride | null;
}
async function kidRow(id = kid.id): Promise<KidRow> {
  const res = await app.request("/api/parent/overview", { headers: auth() });
  expect(res.status).toBe(200);
  const body = await res.json() as { children: KidRow[] };
  return body.children.find((c) => c.id === id)!;
}

// ---- what the phone is told ----

test("bought minutes are reported even when a parent's row hides them", async () => {
  const bought = lockRepo.extendPurchasedUnlock(fam.id, kid.id, 30);

  // On their own, they are the row in charge, and both fields are the SAME row: a parent
  // screen must not draw the purchase twice.
  const alone = await kidRow();
  expect(alone.override!.id).toBe(bought.id);
  expect(alone.purchasedUnlock!.id).toBe(bought.id);

  // A grown-up grounds the kid. `override` is now the parent's word (author beats recency),
  // and the purchase is what the phone needs to keep saying — it is still ticking, and it
  // comes back the moment the lock is cleared.
  lockRepo.setOverride(fam.id, "lock", kid.id, null, "parent");
  const grounded = await kidRow();
  expect(grounded.override!.source).toBe("parent");
  expect(grounded.override!.mode).toBe("lock");
  expect(grounded.purchasedUnlock!.id).toBe(bought.id);
  expect(grounded.purchasedUnlock!.until_ms).toBe(bought.until_ms);
});

test("a kid with no purchase, and a sibling's minutes, both report null", async () => {
  expect((await kidRow()).purchasedUnlock).toBeNull();

  lockRepo.extendPurchasedUnlock(fam.id, sibling.id, 15);
  expect((await kidRow()).purchasedUnlock).toBeNull();
  expect((await kidRow(sibling.id)).purchasedUnlock).not.toBeNull();

  // A household-wide row is never one a kid bought, so it is not reported as one even
  // though it does reach them. (It is still the override in charge.)
  lockRepo.setOverride(fam.id, "unlock", null, Date.now() + 30 * MIN, "parent");
  const row = await kidRow();
  expect(row.override!.child_id).toBeNull();
  expect(row.purchasedUnlock).toBeNull();
});

test("an expired purchase is not reported as minutes waiting underneath", async () => {
  const stale = lockRepo.setOverride(fam.id, "unlock", kid.id, Date.now() - MIN, "purchase");
  expect(lockRepo.getOverride(stale.id)!.cleared_at).toBeNull();   // still an uncleared row
  const row = await kidRow();
  expect(row.override).toBeNull();
  expect(row.purchasedUnlock).toBeNull();
});

// ---- what Clear is allowed to touch ----

test("Clear refuses a purchase and leaves the minutes running", async () => {
  const bought = lockRepo.extendPurchasedUnlock(fam.id, kid.id, 30);

  const res = await del(`/api/family/override/${bought.id}`);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("purchased_minutes");

  // Not softened to a no-op that reports success: the row is untouched and still in charge.
  expect(lockRepo.getOverride(bought.id)!.cleared_at).toBeNull();
  expect(lockRepo.activeOverride(fam.id, kid.id)!.id).toBe(bought.id);
});

test("Clear takes back a grown-up's lock and hands the bought minutes back intact", async () => {
  const bought = lockRepo.extendPurchasedUnlock(fam.id, kid.id, 30);
  const grounding = lockRepo.setOverride(fam.id, "lock", kid.id, null, "parent");
  expect(lockRepo.activeOverride(fam.id, kid.id)!.id).toBe(grounding.id);

  expect((await del(`/api/family/override/${grounding.id}`)).status).toBe(200);

  // The exact promise the card makes when it says the minutes come back: same row, same
  // expiry, not a fresh 30 minutes and not nothing.
  const now = await kidRow();
  expect(now.override!.id).toBe(bought.id);
  expect(now.override!.until_ms).toBe(bought.until_ms);
});

test("a parent UNLOCK is clearable too, and does not shorten what is underneath", async () => {
  const bought = lockRepo.extendPurchasedUnlock(fam.id, kid.id, 30);
  const gift = lockRepo.setOverride(fam.id, "unlock", kid.id, Date.now() + 5 * MIN, "parent");

  expect((await del(`/api/family/override/${gift.id}`)).status).toBe(200);
  const row = await kidRow();
  expect(row.override!.id).toBe(bought.id);
  expect(row.override!.until_ms).toBe(bought.until_ms);
});

// ---- who may end a grounding ----

test("a supporter cannot lift a lock they were never allowed to write", async () => {
  const owner = memberRepo.ownerOf(fam.id)!;
  const gran = memberRepo.createMember(fam.id, "Grandma Jo", "supporter");
  const granBearer = newToken();
  lockRepo.createParentToken(fam.id, "Gran's phone", await sha256Hex(granBearer), gran.id);
  const granAuth = { Authorization: `Bearer ${granBearer}` };

  // The POST has always refused them. The DELETE did not, which is the same power by a
  // longer route: a grounding a supporter cannot write, they could still end.
  const write = await app.request("/api/family/override", {
    method: "POST", body: JSON.stringify({ mode: "unlock", childId: kid.id }),
    headers: { "Content-Type": "application/json", ...granAuth },
  });
  expect(write.status).toBe(403);

  const grounding = lockRepo.setOverride(fam.id, "lock", kid.id, null, "parent");
  const lift = await app.request(`/api/family/override/${grounding.id}`, {
    method: "DELETE", headers: granAuth,
  });
  // 403 and not 401: the token is perfectly good, so a 401 sends the app into a
  // re-authentication loop it can never win.
  expect(lift.status).toBe(403);
  expect(await lift.json()).toEqual({ error: "not_allowed" });
  expect(lockRepo.getOverride(grounding.id)!.cleared_at).toBeNull();

  // The grown-ups who run the board still can. (The owner is who every other test here is.)
  expect(owner.role).toBe("owner");
  expect((await del(`/api/family/override/${grounding.id}`)).status).toBe(200);
});
