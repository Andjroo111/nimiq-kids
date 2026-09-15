// WHAT A KID IS SAVING FOR (#354, epic #350). The tests the issue asked for, in its order.
//
// The distinction every one of these is really about: this is a MIRROR, not a JAR. Nothing is
// reserved, no NIM moves, and the meter follows the balance DOWN as happily as up. The only
// thing that does not follow it down is `reached_at`, and that asymmetry is the feature.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as savings from "./repo-savings";
import * as stickersRepo from "./repo-stickers";
import { newToken, sha256Hex } from "./auth";
import { savingsRoutes } from "./routes/savings";

const app = new Hono().route("/api", savingsRoutes);
const TARGET = 100_000; // luna

let fam: repo.Family; let kid: repo.Child; let bearer: string;
let other: repo.Family; let otherKid: repo.Child; let otherBearer: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Mom", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Sam", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "phone", await sha256Hex(bearer));

  const g = repo.createFamily("Dad", "NQ01");
  repo.updateFamilySettings(g.id, { mode: "family" });
  other = repo.getFamily(g.id)!;
  otherKid = repo.createChild(other.id, "Ben", "🐙");
  otherBearer = newToken();
  lockRepo.createParentToken(other.id, "phone", await sha256Hex(otherBearer));
});

const post = (childId: string, body: unknown, tok = bearer) =>
  app.request(`http://hatch.test/api/kids/${childId}/savings`, {
    method: "POST", headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const seed = (targetLuna = TARGET) =>
  savings.setTarget(fam.id, kid.id, { title: "A bike", targetLuna });

// ------------------------------------------------------------------ the meter's arithmetic
test("pct at zero, mid, exactly at target, and above", () => {
  const t = seed();
  expect(savings.targetView(t, 0).pct).toBe(0);
  expect(savings.targetView(t, 50_000).pct).toBe(50);
  expect(savings.targetView(t, TARGET).pct).toBe(100);
  // CLAMPED. A meter that reads 143% has stopped being a meter.
  expect(savings.targetView(t, 143_000).pct).toBe(100);
  // FLOORED, so 99.6% is never rounded up into a full bar the kid has not earned.
  expect(savings.targetView(t, 99_600).pct).toBe(99);
});

test("remaining floors at zero — 'you need -12 NIM' is not a sentence", () => {
  const t = seed();
  expect(savings.targetView(t, 40_000).remainingLuna).toBe(60_000);
  expect(savings.targetView(t, TARGET).remainingLuna).toBe(0);
  expect(savings.targetView(t, 143_000).remainingLuna).toBe(0);
});

// ---------------------------------------------------------------------- reached_at
test("reached_at is stamped once, and a second read does not re-stamp it", () => {
  const t = seed();
  const first = savings.readMeter(kid.id, TARGET)!;
  expect(first.reached).toBe(true);
  const stampedAt = savings.getTarget(t.id)!.reached_at;
  expect(stampedAt).not.toBeNull();

  savings.readMeter(kid.id, TARGET + 50_000);
  // Same instant, not a fresh one: the moment is when they FIRST got there.
  expect(savings.getTarget(t.id)!.reached_at).toBe(stampedAt);
});

test("spending it afterwards drops the meter but the moment stays true", () => {
  // The headline difference between this and a progress bar, and the reason reached_at exists.
  const t = seed();
  savings.readMeter(kid.id, TARGET);
  const after = savings.readMeter(kid.id, 20_000)!;
  expect(after.pct).toBe(20);          // the mirror follows the balance down
  expect(after.reached).toBe(true);    // getting there HAPPENED
  expect(savings.getTarget(t.id)!.reached_at).not.toBeNull();
});

test("a balance below the target never stamps it", () => {
  const t = seed();
  savings.readMeter(kid.id, TARGET - 1);
  expect(savings.getTarget(t.id)!.reached_at).toBeNull();
});

// ------------------------------------------------------------------ one target per kid
test("a second target retires the first — one meter, enforced by the index", async () => {
  const first = (await (await post(kid.id, { title: "A bike", targetLuna: TARGET })).json()) as { target: { id: string } };
  const second = (await (await post(kid.id, { title: "A scooter", targetLuna: 5_000 })).json()) as { target: { id: string } };
  expect(second.target.id).not.toBe(first.target.id);
  expect(savings.activeTarget(kid.id)!.id).toBe(second.target.id);
  // The old row is KEPT, not deleted: what a kid used to be saving for happened.
  expect(savings.getTarget(first.target.id)!.active).toBe(0);
});

test("the database itself refuses two active rows, not just the code path", () => {
  // The partial unique index is the rule; setTarget honouring it is a convenience. If this ever
  // stops throwing, one household can grow a second meter through some other write.
  seed();
  expect(() => {
    savings.getTarget("x"); // no-op, keeps the linter honest about the throw below
    (savings as unknown as { setTarget: never }); // not used
    require("./db").getDb().run(
      `INSERT INTO savings_targets (id, family_id, child_id, title, title_key, emoji, target_luna, item_id, active, created_at, reached_at)
       VALUES ('dup', ?, ?, 'Sneaky', NULL, NULL, 1, NULL, 1, 0, NULL)`,
      [fam.id, kid.id],
    );
  }).toThrow();
});

// ------------------------------------------------------------------ store items
test("a target pointed at a Treasure Box item takes ITS price", async () => {
  const item = stickersRepo.listStoreItems(fam.id)[0]!;
  const res = await post(kid.id, { itemId: item.id });
  expect(res.status).toBe(201);
  const { target } = await res.json() as { target: savings.SavingsTarget };
  expect(target.item_id).toBe(item.id);
  expect(target.target_luna).toBe(item.price_luna);
});

test("a retired item still reads its snapshot price, because the row is kept", () => {
  const item = stickersRepo.listStoreItems(fam.id)[0]!;
  const t = savings.setTarget(fam.id, kid.id, {
    title: item.title, targetLuna: item.price_luna, itemId: item.id,
  });
  require("./db").getDb().run("UPDATE store_items SET active=0 WHERE id=?", [item.id]);
  // The FK holds and the target is unchanged: retiring a shelf item must not silently move a
  // kid's goalposts, and must not orphan the row either.
  expect(savings.getTarget(t.id)!.target_luna).toBe(item.price_luna);
  expect(savings.getTarget(t.id)!.item_id).toBe(item.id);
});

test("an item from another household is a 404, indistinguishable from one that never existed", async () => {
  // Inserted directly rather than through the store's own create path: this test is about
  // whether a FOREIGN id leaks, and going through the API would only prove the API scopes.
  require("./db").getDb().run(
    `INSERT INTO store_items (id, category_id, kind, title, title_key, price_luna, payload, active, sort, parent_edited, family_id)
     VALUES ('mine-only', NULL, 'coupon', 'Mine', NULL, 500, '{}', 1, 0, 1, ?)`,
    [fam.id],
  );
  const res = await post(otherKid.id, { itemId: "mine-only" }, otherBearer);
  expect(res.status).toBe(404);
});

// ------------------------------------------------------------------ guards + tenancy
test("a target above the cap is refused, so a meter that never moves cannot be built", async () => {
  const res = await post(kid.id, { title: "A jet", targetLuna: 999_999 * 1e5 });
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe("target_too_large");
  expect(savings.activeTarget(kid.id)).toBeNull();
});

test("zero, negative and junk targets are refused", async () => {
  for (const targetLuna of [0, -5, Number.NaN]) {
    expect((await post(kid.id, { title: "x", targetLuna })).status).toBe(400);
  }
  expect((await post(kid.id, { targetLuna: 500 })).status).toBe(400); // no title
});

test("one household's target is unreachable from another", async () => {
  seed();
  const res = await app.request(`http://hatch.test/api/kids/${kid.id}/savings`, {
    headers: { Authorization: `Bearer ${otherBearer}` },
  });
  expect(res.status).toBe(404);
  // ...and they cannot set one either.
  expect((await post(kid.id, { title: "theirs", targetLuna: 100 }, otherBearer)).status).toBe(404);
});
