// The progress tracker's aggregates (#379).
//
// The thing worth testing here is not that SUM adds up. It is that a day means the
// HOUSEHOLD'S day: every timestamp in this database is epoch ms in UTC, the family lives in
// America/Chicago, and a job approved at 8pm Central falls on tomorrow in UTC. A tracker
// that buckets by UTC tells a parent their kid did nothing on Tuesday evening and twice as
// much on Wednesday morning, forever, and looks entirely plausible while doing it.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb, getDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as routines from "./repo-routines";
import { newToken, sha256Hex } from "./auth";
import { progressRoutes } from "./routes/progress";
import { dayWindow, kidProgress } from "./repo-progress";

const app = new Hono().route("/api", progressRoutes);
const TZ = "America/Chicago";

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family", tz: TZ });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});

const asParent = () => ({ Authorization: `Bearer ${bearer}` });
const get = (path: string) => app.request(path, { headers: asParent() });

/** Wed 2026-07-15 20:00 CDT — 01:00 UTC on the 16th. The whole point of these tests. */
const WED_2000_CDT = Date.UTC(2026, 6, 16, 1, 0);

function approval(status: string, decidedAt: number, subjectKind = "chore") {
  getDb().run(
    `INSERT INTO approvals (id, family_id, child_id, subject_kind, subject_id, status, created_at, decided_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), fam.id, kid.id, subjectKind, "s1", status, decidedAt - 1000, decidedAt],
  );
}

// ---- the day boundary ----

test("an 8pm approval lands on TODAY, not tomorrow", () => {
  approval("approved", WED_2000_CDT);
  const p = kidProgress(kid.id, TZ, 3, WED_2000_CDT);
  const today = p.approved.at(-1)!;
  expect(today.day).toBe("2026-07-15");
  expect(today.value).toBe(1);
});

test("the window is dense: a quiet day is a zero, never a gap", () => {
  approval("approved", WED_2000_CDT);
  const p = kidProgress(kid.id, TZ, 5, WED_2000_CDT);
  // A chart that drops empty days draws a line through the hole and calls it a trend.
  expect(p.approved).toHaveLength(5);
  expect(p.approved.map((d) => d.value)).toEqual([0, 0, 0, 0, 1]);
});

test("the window ends on today and runs back `days`, oldest first", () => {
  const w = dayWindow(TZ, 3, WED_2000_CDT);
  expect(w).toEqual(["2026-07-13", "2026-07-14", "2026-07-15"]);
});

// ---- what the series say ----

test("approved and rejected are separate series, not one rate", () => {
  // Ten approvals and six rejections is a different week from ten and none, and a
  // completion rate alone hides which one it was.
  approval("approved", WED_2000_CDT);
  approval("approved", WED_2000_CDT);
  approval("rejected", WED_2000_CDT);
  const p = kidProgress(kid.id, TZ, 2, WED_2000_CDT);
  expect(p.approved.at(-1)!.value).toBe(2);
  expect(p.rejected.at(-1)!.value).toBe(1);
});

test("a pending approval counts on neither series", () => {
  approval("pending", WED_2000_CDT);
  getDb().run("UPDATE approvals SET decided_at=NULL WHERE status='pending'");
  const p = kidProgress(kid.id, TZ, 2, WED_2000_CDT);
  expect(p.approved.at(-1)!.value).toBe(0);
  expect(p.rejected.at(-1)!.value).toBe(0);
});

test("coupon approvals are not jobs and stay out of the chore series", () => {
  approval("approved", WED_2000_CDT, "coupon");
  const p = kidProgress(kid.id, TZ, 2, WED_2000_CDT);
  expect(p.approved.at(-1)!.value).toBe(0);
});

test("screen minutes come from the meter's OWN local day, not a re-derived one", () => {
  // screen_usage stores the family-local day, computed the same way the lock machine
  // computes it. Re-bucketing it here would be a second opinion about the day the rule
  // was actually enforced on.
  const day = routines.localDay(TZ, WED_2000_CDT);
  lockRepo.addUsageSec(kid.id, day, 1800, WED_2000_CDT);
  lockRepo.addEarnedSec(kid.id, day, 900, WED_2000_CDT);
  repo.setScreenBudget(kid.id, 60, 30);
  const p = kidProgress(kid.id, TZ, 2, WED_2000_CDT);
  expect(p.screenMin.at(-1)!.value).toBe(30);
  expect(p.screenEarnedMin.at(-1)!.value).toBe(15);
  expect(p.dailyScreenMin).toBe(60);
});

test("practice minutes are the learning trend, summed per day", () => {
  const day = routines.localDay(TZ, WED_2000_CDT);
  const pr = getDb();
  // practice_sessions is UNIQUE (practice_id, day) — one row per practice per day, with the
  // seconds accumulated into it. So the sum this asserts is a sum ACROSS practices, which
  // is the number a parent means by "how much did they practise today".
  for (const [id, title, secs] of [["p1", "Piano", 600], ["p2", "Reading", 300]] as const) {
    pr.run(`INSERT INTO practices (id, family_id, child_id, title, emoji, target_per_week, active, created_at)
            VALUES (?,?,?,?,'🎹',3,1,?)`, [id, fam.id, kid.id, title, WED_2000_CDT]);
    pr.run(`INSERT INTO practice_sessions (id, practice_id, child_id, day, seconds, created_at)
            VALUES (?,?,?,?,?,?)`, [crypto.randomUUID(), id, kid.id, day, secs, WED_2000_CDT]);
  }
  const p = kidProgress(kid.id, TZ, 2, WED_2000_CDT);
  expect(p.practiceMin.at(-1)!.value).toBe(15);
});

// This test used to insert a `reward` row and pass, which is how the bug it now guards
// against lived for weeks: `reward` is a STAKING reward, a job payout is `earn`, and the
// query read the wrong one. The card said 0 NIM over a kid whose feed listed every payout.
test("earnings are the kid's JOB payouts in whole NIM; a staking reward or a failed payout is not one", () => {
  const ins = (kind: string, status: string, luna: number) => getDb().run(
    `INSERT INTO wallet_events (id, family_id, child_id, kind, status, value_luna, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), fam.id, kid.id, kind, status, luna, WED_2000_CDT],
  );
  ins("earn", "done", 250 * 1e5);
  ins("earn", "pending", 10 * 1e5);   // on its way: the feed already shows it, so does this
  ins("earn", "failed", 1000 * 1e5);  // the chain proved it never executed
  ins("reward", "done", 5 * 1e5);     // staking, not a job
  const p = kidProgress(kid.id, TZ, 2, WED_2000_CDT);
  expect(p.earnedNim.at(-1)!.value).toBe(260);
});

test("spending is grouped by shelf, biggest first", () => {
  const db = getDb();
  // item_id is a real foreign key, so these are the seeded catalogue rows rather than
  // invented ids — which also keeps `kind` honest against the shelf it actually came from.
  const buy = (itemId: string, kind: string, luna: number) => db.run(
    `INSERT INTO kid_purchases (id, family_id, child_id, item_id, kind, title, price_luna, payload, status, created_at)
     VALUES (?,?,?,?,?,'x',?,'{}','done',?)`,
    [crypto.randomUUID(), fam.id, kid.id, itemId, kind, luna, WED_2000_CDT],
  );
  buy("item-pack-space", "pack", 200 * 1e5);
  buy("item-screen-60", "screen_time", 400 * 1e5);
  const p = kidProgress(kid.id, TZ, 7, WED_2000_CDT);
  expect(p.spendByKind).toEqual([{ kind: "screen_time", nim: 400 }, { kind: "pack", nim: 200 }]);
});

// ---- the route ----

test("one payload covers the whole household, on ONE `now`", async () => {
  // Two requests would render siblings against two different clocks — a fortnight that
  // starts on different days for two kids in the same house.
  repo.createChild(fam.id, "Kid 2", "🦄");
  const res = await get("/api/parent/progress");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.children).toHaveLength(2);
  expect(body.window).toHaveLength(14);
  expect(body.tz).toBe(TZ);
});

test("days is clamped, and garbage falls back to the default", async () => {
  expect((await (await get("/api/parent/progress?days=9999")).json()).days).toBe(90);
  expect((await (await get("/api/parent/progress?days=0")).json()).days).toBe(1);
  expect((await (await get("/api/parent/progress?days=banana")).json()).days).toBe(14);
});

test("a parent bearer is required, and another household is never visible", async () => {
  expect((await app.request("/api/parent/progress")).status).toBe(401);
  const other = repo.createFamily("Someone else", "NQ00");
  repo.createChild(other.id, "Their kid", "🐢");
  const body = await (await get("/api/parent/progress")).json();
  expect(body.children.map((k: { label: string }) => k.label)).toEqual(["Kid 1"]);
});
