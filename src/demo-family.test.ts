// The judge demo's one hard promise: what you do in it is invisible to the next
// visitor. These tests hold that promise from both ends — a minted family really is
// populated (Sam, Ava, a board, a pending approval), and two minted families cannot
// see each other through either bearer the demo hands out.
//
// Hermetic: in-memory DB, app.request(), SIM settlement (no DEV_PARENT_PRIV in the
// test env, so payKidEarn writes 'sim:' ledger rows and never touches a network).

import { test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { initTestDb, getDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as memberRepo from "./repo-members";
import { kidProgress } from "./repo-progress";
import * as wrepo from "./repo-wallet";
import * as approvalsRepo from "./repo-approvals";
import {
  DEMO_KIDS, DEMO_PIN, localAfternoonMs, mintDemoFamily, payDemoHistory, purgeFamily,
  seedHistoryLunaAt, seedHistoryUsd, staleDemoFamilies, sweepDemoFamilies,
} from "./demo-family";
import { nimUsd, usdToWholeNimLuna } from "./rates";
import * as stickersRepo from "./repo-stickers";
import { mondayOf, weekDays } from "./days";
import { packStoreItems, OTHER_STORE_ITEMS } from "./sticker-catalog";
import * as budget from "./repo-budget";
import { peerEnv } from "./client-ip";
import { demoRoutes, demoLanding, resetDemoRateLimits } from "./routes/demo";
import { children } from "./routes/children";
import { families } from "./routes/families";
import { approvalsRoutes } from "./routes/approvals";
import { ensureKidWallet } from "./wallet/kid-wallet";
import * as lockRepo from "./repo-lock";
import { parentRoutes } from "./routes/parent";
import { newToken, sha256Hex } from "./auth";

const HOT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0001";

const app = new Hono()
  .route("/api", demoRoutes)
  .route("/api", children)
  .route("/api", families)
  .route("/api", approvalsRoutes)
  .route("/", demoLanding);

// Every env key any test in this file writes, saved once and restored after each so a
// budget test cannot leak a grant into the isolation tests that follow it.
const ENV_KEYS = [
  "HATCH_DEMO_SEED", "HATCH_LEGACY_BOOT",
  "HATCH_DEMO_GRANT_LUNA", "HATCH_GRANDFATHER_FIRST",
] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  initTestDb();
  resetDemoRateLimits();
  process.env.HATCH_DEMO_SEED = "1";
  process.env.HATCH_LEGACY_BOOT = "0"; // the public-instance posture the demo ships with
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBefore[k] === undefined) delete process.env[k];
    else process.env[k] = envBefore[k];
  }
});

// Visitors arrive through the tunnel — peer 127.0.0.1, the one peer whose forwarded
// header is believed. Reached directly (any other peer) the header means nothing; see
// client-ip.ts and the spoofing test below.
const TUNNEL = peerEnv("127.0.0.1");

const get = (path: string, headers: Record<string, string> = {}) =>
  app.request(`http://hatch.test${path}`, { headers }, TUNNEL);

const post = (path: string, headers: Record<string, string> = {}, env: unknown = TUNNEL) =>
  app.request(`http://hatch.test${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}",
  }, env);

// ---- what a visitor wakes up to ----

test("a minted demo family has Sam and Ava, a stocked board, and one approval waiting per kid", async () => {
  const demo = await mintDemoFamily(HOT);

  const kids = repo.listChildren(demo.familyId);
  expect(kids.map((k) => k.label)).toEqual(["Sam", "Ava"]);
  expect(repo.getFamily(demo.familyId)!.mode).toBe("family");

  for (const kid of kids) {
    const board = repo.listActiveChores(demo.familyId, kid.id);
    expect(board.length).toBeGreaterThanOrEqual(4);
    expect(board.filter((c) => c.status === "submitted")).toHaveLength(1);
    expect(board.some((c) => c.kind === "lesson")).toBe(true);
    // A routine to run, but no lock window: a judge opening the demo at any hour
    // must never meet a locked tablet.
    const rs = routines.listRoutines(demo.familyId, kid.id);
    expect(rs).toHaveLength(1);
    expect(routines.listTasks(rs[0]!.id)).toHaveLength(3);
  }

  // The pending approvals the parent app queue renders — one per kid.
  expect(approvalsRepo.listApprovals(demo.familyId, "pending")).toHaveLength(2);
});

test("the seeded history is real money: a ledger row per past job, and the budget covers it", async () => {
  const demo = await mintDemoFamily(HOT);
  const paid = await payDemoHistory(demo.familyId, demo.children);

  const expected = DEMO_KIDS.reduce((n, k) => n + k.history.length, 0);
  expect(paid).toBe(expected);

  let total = 0;
  for (const kid of repo.listChildren(demo.familyId)) {
    const earns = wrepo.listWalletEvents(kid.id).filter((e) => e.kind === "earn");
    expect(earns.length).toBe(DEMO_KIDS.find((k) => k.label === kid.label)!.history.length);
    for (const e of earns) {
      expect(e.tx_hash).toBeTruthy(); // every earn carries a settlement hash, never null
      total += e.value_luna;
    }
    // The trail that produced the balance is on the board, not just in the feed.
    //
    // Still exact equality, and that is worth keeping deliberately. The past-weeks trail
    // (src/demo-past.ts) adds weeks of finished work to the calendar without paying for
    // it, so an earlier draft of it broke this line and the fix looked like relaxing the
    // assertion. Rebuilding the trail out of practices instead of chores put the invariant
    // back intact: every approved CHORE here is still a real on-chain payout.
    expect(repo.listChores(demo.familyId, kid.id).filter((c) => c.status === "approved").length)
      .toBe(earns.length);
  }
  expect(total).toBe(seedHistoryLunaAt(await nimUsd()));
});

// The bug that made the demo pointless (#29): the shelves are priced in real money, the
// seed used to be priced in flat NIM, and the two had drifted three orders of magnitude
// apart. A visitor met the Treasure Box as a wall of things they could not buy, so the
// spend-it-back half of the circle was unreachable for everyone.
//
// This asserts the PRODUCT promise, not the numbers: whatever the rate does, a seeded kid
// The parent's Progress tab reads `approvals`, not the chore's status, and for a month the
// seed wrote none: a judge opening Progress saw "0 jobs done" and an empty Jobs chart over
// a board with four finished jobs on it.
test("the seeded history is on the parent's Progress: one decided approval per past job, on its sticker's day", async () => {
  const demo = await mintDemoFamily(HOT);
  await payDemoHistory(demo.familyId, demo.children);
  const fam = repo.getFamily(demo.familyId)!;
  const today = routines.localDay(fam.tz);
  const monday = mondayOf(today);

  for (const kid of repo.listChildren(demo.familyId)) {
    const history = DEMO_KIDS.find((k) => k.label === kid.label)!.history;
    const decided = approvalsRepo.listApprovals(demo.familyId, "approved").filter((a) => a.child_id === kid.id);
    expect(decided.length).toBe(history.length);
    for (const a of decided) {
      expect(a.subject_kind).toBe("chore");
      expect(a.decided_by_member_id).toBe(memberRepo.ownerOf(demo.familyId)!.id);
      // On a day this week, never in the future, and on the day its sticker sits on.
      const day = routines.localDay(fam.tz, a.decided_at!);
      expect(day >= monday && day <= today).toBe(true);
      const sticker = stickersRepo.placementsForDays(kid.id, weekDays(monday)).find((p) => p.subject_id === a.subject_id);
      expect(sticker?.day).toBe(day);
    }
    // And the number a parent reads is the number of jobs the seed paid.
    const week = kidProgress(kid.id, fam.tz, 7);
    expect(week.approved.reduce((n, p) => n + p.value, 0)).toBe(history.length);
  }
});

test("half past five local is on the day asked for, in every zone, across a DST edge", () => {
  for (const tz of ["America/Chicago", "Europe/Berlin", "Pacific/Auckland", "Asia/Kolkata", "UTC"]) {
    for (const day of ["2026-03-08", "2026-03-09", "2026-09-01", "2026-11-01", "2026-04-05", "2026-09-27"]) {
      const ms = localAfternoonMs(tz, day);
      expect(routines.localDay(tz, ms)).toBe(day);
      const hour = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(ms));
      expect(hour).toBe("17");
    }
  }
});

// can afford something on the shelves the moment their history lands.
test("a seeded kid can afford the cheapest thing in the Treasure Box", async () => {
  const demo = await mintDemoFamily(HOT);
  await payDemoHistory(demo.familyId, demo.children);

  const cheapest = Math.min(
    ...packStoreItems().map((i) => i.priceLuna),
    ...Object.values(OTHER_STORE_ITEMS).filter((i) => !i.retired).map((i) => i.priceLuna),
  );

  for (const kid of repo.listChildren(demo.familyId)) {
    const earned = wrepo.listWalletEvents(kid.id)
      .filter((e) => e.kind === "earn")
      .reduce((sum, e) => sum + e.value_luna, 0);
    expect(earned).toBeGreaterThanOrEqual(cheapest);
  }
});

// The coupling that silently breaks the demo, from both sides.
//
// payKidEarn does not consult the budget, but its rows COUNT as spent. So a grant that no
// longer clears the seeded history leaves every minted family at zero available, and the
// first thing a judge tries to approve dies with budget_exhausted — while the mint itself
// still reports a cheerful paidHistory: 4. Pricing the seed in dollars moved its cost by
// three orders of magnitude, which is exactly the move that puts an unchanged grant
// underwater. server.ts warns at boot; this proves the failure is real and that a
// demo-sized grant fixes it.
test("a demo-sized grant leaves room to approve after the history is paid; the old one does not", async () => {
  process.env.HATCH_GRANDFATHER_FIRST = "0"; // public posture: no household is exempt
  const rate = await nimUsd();
  const history = seedHistoryLunaAt(rate);
  const priciest = Math.max(...DEMO_KIDS.flatMap((k) => k.chores.map((c) => usdToWholeNimLuna(c.usd, rate))));

  process.env.HATCH_DEMO_GRANT_LUNA = String(history + priciest * 2);
  const demo = await mintDemoFamily(HOT);
  expect(await payDemoHistory(demo.familyId, demo.children)).toBeGreaterThan(0);

  const fam = repo.getFamily(demo.familyId)!;
  expect(budget.isBudgetExempt(fam)).toBe(false);
  expect(budget.checkSpend(fam, priciest).ok).toBe(true);

  // The pre-#29 grant, against the post-#29 seed: underwater before the judge arrives.
  process.env.HATCH_DEMO_GRANT_LUNA = "500000"; // 5 NIM, the shipped default
  const refused = budget.checkSpend(fam, priciest);
  expect(refused.ok).toBe(false);
  expect(refused).toMatchObject({ reason: "budget" });
});

// ---- the promise: one visitor cannot see another ----

test("two visitors get different families, and neither bearer reaches into the other", async () => {
  const a = await mintDemoFamily(HOT);
  const b = await mintDemoFamily(HOT);
  expect(a.familyId).not.toBe(b.familyId);
  expect(a.parentToken).not.toBe(b.parentToken);
  expect(a.deviceToken).not.toBe(b.deviceToken);

  const kidsA = await get("/api/children", { Authorization: `Bearer ${a.parentToken}` });
  const kidsB = await get("/api/children", { Authorization: `Bearer ${b.parentToken}` });
  const idsA = ((await kidsA.json()) as { children: { id: string }[] }).children.map((k) => k.id);
  const idsB = ((await kidsB.json()) as { children: { id: string }[] }).children.map((k) => k.id);
  expect(idsA).toHaveLength(2);
  expect(idsB).toHaveLength(2);
  expect(idsA.some((id) => idsB.includes(id))).toBe(false);

  // The kid tablet's device bearer scopes the same way.
  const tabletA = await get("/api/children", { Authorization: `Bearer ${a.deviceToken}` });
  const tabletIds = ((await tabletA.json()) as { children: { id: string }[] }).children.map((k) => k.id);
  expect(tabletIds.sort()).toEqual(idsA.sort());
});

test("visitor A approving their pending chore leaves visitor B's board untouched", async () => {
  const a = await mintDemoFamily(HOT);
  const b = await mintDemoFamily(HOT);

  const pendingA = approvalsRepo.listApprovals(a.familyId, "pending");
  const res = await post(`/api/approvals/${pendingA[0]!.id}/approve`, { Authorization: `Bearer ${a.parentToken}` });
  expect(res.status).toBe(200);

  expect(approvalsRepo.listApprovals(a.familyId, "pending")).toHaveLength(1);
  expect(approvalsRepo.listApprovals(b.familyId, "pending")).toHaveLength(2); // untouched
});

test("visitor B's bearer cannot decide visitor A's approval", async () => {
  const a = await mintDemoFamily(HOT);
  const b = await mintDemoFamily(HOT);
  const pendingA = approvalsRepo.listApprovals(a.familyId, "pending")[0]!;

  const res = await post(`/api/approvals/${pendingA.id}/approve`, { Authorization: `Bearer ${b.parentToken}` });
  expect(res.status).toBe(404);
  expect(approvalsRepo.getApproval(pendingA.id)!.status).toBe("pending");
});

test("with no bearer at all, the demo instance's boot surfaces stay shut", async () => {
  await mintDemoFamily(HOT);
  const res = await get("/api/children");
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "pairing_required" });
});

// ---- the route ----

test("POST /api/demo/family mints a usable family; the landing page serves it", async () => {
  const res = await post("/api/demo/family");
  expect(res.status).toBe(201);
  const body = await res.json() as {
    parentToken: string; deviceToken: string;
    family: { id: string }; children: { label: string }[];
  };
  expect(body.children.map((k) => k.label)).toEqual(["Sam", "Ava"]);
  expect(body.parentToken).toMatch(/^[0-9a-f]{64}$/);
  expect(body.deviceToken).toMatch(/^[0-9a-f]{64}$/);
  expect(repo.getFamily(body.family.id)).not.toBeNull();

  const page = await get("/demo");
  expect(page.status).toBe(200);
  const html = await page.text();
  // The copy no longer names the kids: the page is deliberately short, and the names are
  // the mint's contract (asserted above) rather than the landing page's. What the page
  // does owe is the real brand lockup, the reset control, and the two storage keys the
  // kid and parent apps read.
  expect(html).toContain("/assets/brand/nimiq-kids-lockup-light.svg");
  expect(html).toContain(`id="fresh"`);
  expect(html).toContain("kidsParentToken");
  expect(html).toContain("kid.deviceToken");
  // There is no PIN anywhere on the demo: nothing asks for one, so nothing shows one.
  // Asserted against DEMO_PIN itself rather than a field of the response, because the
  // response no longer carries it — and the constant is the single source of truth, so
  // this keeps holding if the value ever changes (#15).
  expect(html).not.toContain(DEMO_PIN);
  expect(body).not.toHaveProperty("pin");
});

test("a demo household approves with no PIN; a real one still cannot", async () => {
  const minted = await mintDemoFamily(HOT);
  const kids = repo.listChildren(minted.familyId);
  const pending = approvalsRepo.listApprovals(minted.familyId, "pending")
    .find((a) => a.child_id === kids[0]!.id)!;
  expect(pending).toBeDefined();

  // The tablet sends no pin at all — only its own device bearer, exactly as
  // public/kid/js/api.js does. On a demo household that is enough: there is no second
  // person to fetch, so the pad that would ask never opens.
  const tablet = { Authorization: `Bearer ${minted.deviceToken}` };
  const ok = await post(`/api/approvals/${pending.id}/approve`, tablet);
  expect(ok.status).toBe(200);
  expect(approvalsRepo.getApproval(pending.id)!.status).toBe("approved");
  expect(approvalsRepo.getApproval(pending.id)!.method).toBe("demo");

  // A real household is untouched: no bearer, no PIN, no approval. On this public-shaped
  // instance (HATCH_LEGACY_BOOT=0) the approval id alone is not a capability either, so
  // the tablet of ANOTHER household never even reaches the auth question.
  const real = repo.createFamily("A real household", HOT);
  const kid = repo.createChild(real.id, "Kid", "");
  const chore = repo.createChore(real.id, kid.id, "Tidy up", 100_000);
  repo.setChoreStatus(chore.id, "submitted");
  const theirs = approvalsRepo.openApproval(real.id, kid.id, "chore", chore.id);
  for (const headers of [{}, tablet]) {
    const denied = await post(`/api/approvals/${theirs.id}/approve`, headers);
    expect(denied.status).toBe(404);
    expect(approvalsRepo.getApproval(theirs.id)!.status).toBe("pending");
  }
});

test("an instance with neither demo flag set grows neither route", async () => {
  delete process.env.HATCH_DEMO_SEED;
  delete process.env.HATCH_DEMO_ENABLED;
  expect((await post("/api/demo/family")).status).toBe(404);
  expect((await get("/demo")).status).toBe(404);
});

// Both spellings work, and they must keep working independently: the env files on the
// live instances are edited separately from a deploy, so if the code demanded the new
// name the moment it shipped, whichever landed second would switch the judge demo off.
test("HATCH_DEMO_ENABLED=1 opens the demo, with the legacy name absent", async () => {
  delete process.env.HATCH_DEMO_SEED;
  process.env.HATCH_DEMO_ENABLED = "1";
  expect((await post("/api/demo/family")).status).toBe(201);
  expect((await get("/demo")).status).toBe(200);
});

test("the legacy HATCH_DEMO_SEED=1 still opens the demo on its own", async () => {
  delete process.env.HATCH_DEMO_ENABLED;
  process.env.HATCH_DEMO_SEED = "1";
  expect((await post("/api/demo/family")).status).toBe(201);
  expect((await get("/demo")).status).toBe(200);
});

// The whole reason for the rename: a secret-rotation script that matches on SEED would
// write 64 hex characters over the `1`. That must read as "off", not as "on".
test("a seed-shaped value in the legacy var does not enable the demo", async () => {
  delete process.env.HATCH_DEMO_ENABLED;
  process.env.HATCH_DEMO_SEED = "a".repeat(64);
  expect((await post("/api/demo/family")).status).toBe(404);
  expect((await get("/demo")).status).toBe(404);
});

test("the mint is rate limited per IP", async () => {
  const ip = { "cf-connecting-ip": "203.0.113.9" };
  process.env.HATCH_DEMO_PER_IP_HOUR = "2";
  // The limit is read at import time, so assert against the shipped default instead of
  // the override: 12/hour, 13th refused.
  delete process.env.HATCH_DEMO_PER_IP_HOUR;
  for (let i = 0; i < 12; i++) expect((await post("/api/demo/family", ip)).status).toBe(201);
  const refused = await post("/api/demo/family", ip);
  expect(refused.status).toBe(429);
  expect(await refused.json()).toEqual({ error: "too_many_requests" });
  // A different visitor is unaffected by the noisy one.
  expect((await post("/api/demo/family", { "cf-connecting-ip": "198.51.100.4" })).status).toBe(201);
});

// The demo mint pays real history out of the hot wallet, so an unbounded mint is an open
// tap on a funded instance. It used to be unbounded: a header the caller picked chose the
// bucket, so twelve per hour meant twelve per header.
test("the mint's brake survives a caller who invents a new address per request", async () => {
  const direct = peerEnv("192.0.2.50"); // not the tunnel: nothing it forwards is believed
  for (let i = 0; i < 12; i++) expect((await post("/api/demo/family", {}, direct)).status).toBe(201);
  for (let i = 0; i < 5; i++) {
    const spoofed = await post("/api/demo/family", { "cf-connecting-ip": `198.51.100.${i}` }, direct);
    expect(spoofed.status).toBe(429);
  }
});

// ---- housekeeping ----

test("purging a demo family removes every trace of it and touches nothing else", async () => {
  const doomed = await mintDemoFamily(HOT);
  await payDemoHistory(doomed.familyId, doomed.children);
  const keeper = await mintDemoFamily(HOT);
  await payDemoHistory(keeper.familyId, keeper.children);

  await purgeFamily(doomed.familyId);

  const db = getDb();
  const countIn = (table: string, col: string, id: string) =>
    (db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col}=?`).get(id) as { n: number }).n;
  for (const table of ["children", "chores", "routines", "approvals", "wallet_events", "devices", "parent_tokens"]) {
    expect(countIn(table, "family_id", doomed.familyId)).toBe(0);
  }
  expect(repo.getFamily(doomed.familyId)).toBeNull();

  // The other visitor's household survived intact.
  expect(repo.listChildren(keeper.familyId)).toHaveLength(2);
  expect(countIn("wallet_events", "family_id", keeper.familyId)).toBeGreaterThan(0);
  // ...and their bearer still works.
  const res = await get("/api/children", { Authorization: `Bearer ${keeper.parentToken}` });
  expect(res.status).toBe(200);
});

test("the sweeper takes abandoned demo families and never a real one", async () => {
  const old = await mintDemoFamily(HOT);
  const fresh = await mintDemoFamily(HOT);
  const real = repo.createFamily("A real household", HOT); // demo_at stays NULL

  getDb().run("UPDATE families SET demo_at=? WHERE id=?", [Date.now() - 48 * 3600_000, old.familyId]);

  expect(staleDemoFamilies(Date.now() - 24 * 3600_000)).toEqual([old.familyId]);
  expect((await sweepDemoFamilies(24 * 3600_000)).purged).toBe(1);

  expect(repo.getFamily(old.familyId)).toBeNull();
  expect(repo.getFamily(fresh.familyId)).not.toBeNull();
  expect(repo.getFamily(real.id)).not.toBeNull();
});

test("a swept family never hands its funded address to the next family's kids", async () => {
  // The account index alone stopped carrying this promise once indices became per-family:
  // the next household legitimately starts at 0 again. What must never repeat is the derived
  // ADDRESS, and the household's own branch index is what guarantees it.
  const first = await mintDemoFamily(HOT);
  const before: string[] = [];
  for (const kid of first.children) before.push((await ensureKidWallet(kid.id)).address!);
  const firstBranch = repo.getFamily(first.familyId)!.hd_index!;
  expect(firstBranch).toBeGreaterThanOrEqual(0);

  await purgeFamily(first.familyId);

  const second = await mintDemoFamily(HOT);
  const after: string[] = [];
  for (const kid of second.children) after.push((await ensureKidWallet(kid.id)).address!);

  expect(repo.getFamily(second.familyId)!.hd_index!).toBeGreaterThan(firstBranch);
  for (const address of after) expect(before).not.toContain(address);
  expect(new Set(after).size).toBe(after.length);
});

// The floor used to be twice the cheapest shelf, which cleared a sticker pack (2 000) and
// left every coupon (6 000) locked. A visitor could buy one thing, find a whole category
// still out of reach, and reasonably conclude the demo was the same wall it had always
// been. Andjroo, 2026-08-01: "they should be able to purchase things and try everything."
//
// Asserted against the LIVE catalogue, not copied numbers: repricing a shelf without
// moving the seed is exactly the regression, and it should fail here rather than on a
// judge's phone.
// Raised again 2026-08-01 evening: a TESTER has to reach every OUTCOME the Box can produce
// (a pack that grants stickers, a screen-time unlock that opens a lock window, a coupon that
// queues a parent approval) and still see a balance that goes down without hitting zero. One
// of each KIND left them a single purchase deep -- buy the dinner coupon and the 6 000 was
// gone with the other coupon and two thirds of the packs still locked. So the floor is one of
// EVERYTHING now.
test("a seeded kid can afford one of EVERY item in the catalogue, with change left over", async () => {
  const demo = await mintDemoFamily(HOT);
  await payDemoHistory(demo.familyId, demo.children);

  const offered = [
    ...packStoreItems().map((i) => ({ shelf: i.categoryId, priceLuna: i.priceLuna })),
    ...Object.entries(OTHER_STORE_ITEMS).filter(([, d]) => !d.retired).map(([id, d]) => ({
      shelf: id.startsWith("item-screen") ? "cat-screen" : "cat-coupons", priceLuna: d.priceLuna,
    })),
  ];
  expect(new Set(offered.map((o) => o.shelf)).size).toBeGreaterThanOrEqual(3); // packs, screen, coupons
  const oneOfEverything = offered.reduce((a, b) => a + b.priceLuna, 0);
  const cheapest = Math.min(...offered.map((o) => o.priceLuna));

  for (const kid of repo.listChildren(demo.familyId)) {
    const earned = wrepo.listWalletEvents(kid.id)
      .filter((e) => e.kind === "earn")
      .reduce((sum, e) => sum + e.value_luna, 0);
    // Strictly greater: buying the whole catalogue must not land the kid on exactly zero,
    // which photographs as a kid who cannot afford anything.
    expect(earned).toBeGreaterThanOrEqual(oneOfEverything + cheapest);
  }
});

// The grant is a different mechanism from the floor and has gone underwater twice, silently
// both times: payKidEarn pays the seeded history WITHOUT consulting the budget, but its rows
// still count as spent, so a grant below the history leaves every family at zero available
// and the first approval a tester tries dies with `budget_exhausted` — while the mint still
// answers a cheerful `paidHistory: 4`. Raising the floor without raising the grant is the
// exact regression, so it fails here rather than on a tester's phone.
test("the documented demo grant still clears the seeded history it has to cover", async () => {
  const seeded = seedHistoryLunaAt(await nimUsd());
  const template = await Bun.file("deploy/testnet-demo/hatch-testnet.env.template").text();
  const grant = Number(/^HATCH_DEMO_GRANT_LUNA=(\d+)$/m.exec(template)?.[1] ?? 0);

  expect(grant).toBeGreaterThan(0);
  expect(grant).toBeGreaterThanOrEqual(seeded);
});

test("the seeded week grid is not blank, and never dates a sticker into the future", async () => {
  // The chart home IS the week's sticker grid -- the kid app's front door. Seeding
  // payouts without PLACEMENTS opened it on an empty chart every time.
  const demo = await mintDemoFamily(HOT);
  expect(await payDemoHistory(demo.familyId, demo.children))
    .toBe(DEMO_KIDS.reduce((n, k) => n + k.history.length, 0));

  const fam = repo.getFamily(demo.familyId)!;
  const today = routines.localDay(fam.tz);
  const thisWeek = weekDays(mondayOf(today));

  for (const kid of repo.listChildren(demo.familyId)) {
    const placed = stickersRepo.placementsForDays(kid.id, thisWeek);
    // The paid history is the CHORE placements, and there is one per past job however
    // `seedDays` spreads them over the elapsed week. Everything else in this week is the
    // past-weeks trail (src/demo-past.ts), which hangs off routine runs and practice
    // sessions instead. Counting every placement in the week against `history.length` was
    // only ever right on a Monday, when the trail stops before the week begins; it passed
    // all day and broke the moment the clock rolled into Tuesday.
    const paid = placed.filter((p) => p.subject_kind === "chore");
    expect(paid.length).toBe(DEMO_KIDS.find((k) => k.label === kid.label)!.history.length);
    expect(placed.length).toBeGreaterThanOrEqual(paid.length);
    for (const p of placed) {
      expect(p.state).toBe("shined");     // a parent already said yes
      expect(p.day <= today).toBe(true);   // never a day that has not happened
      expect(stickersRepo.ownsSticker(kid.id, p.sticker_id)).toBe(true);
    }
  }
});

test("every demo kid has exactly one CHORE the egg timer can be reached from", async () => {
  // A chore offers "use timer" only when it carries a duration (`done.js` renders that
  // button on durationS > 0), and until now no seeded chore did — so on the live demo a
  // judge could reach the timer from a routine task and never from a chore. Both routes
  // are the point: they run different code (a task's clock is the server's and resumable,
  // a chore's is local), and only one of them was ever visible here.
  const demo = await mintDemoFamily(HOT);

  for (const kid of repo.listChildren(demo.familyId)) {
    const board = repo.listActiveChores(demo.familyId, kid.id);
    const timed = board.filter((c) => (c.duration_s ?? 0) > 0);
    // Exactly one, not "at least one": a board where every card carries a clock says
    // chores are timed by nature, which is the opposite of what the app means.
    expect(timed).toHaveLength(1);
    // and it has to be one the kid can still start
    expect(timed[0]!.status).toBe("open");
  }
});

// purgeFamily's delete list has now fallen behind the schema THREE times: sticker_placements
// was caught during review, payout_attempts and kid_address_challenges were not. The last pair
// cost a live sweep — `DELETE FROM children` threw SQLITE_CONSTRAINT_FOREIGNKEY, and because
// the throw escaped the loop it took every household queued behind it down too. 82 stale
// families managed 33.
//
// So the list is derived from the SCHEMA here rather than trusted. Any future table with a
// children FK fails this test the moment it is added, which is the only place that scales.
test("purgeFamily deletes from every table that has a children foreign key", () => {
  initTestDb();
  const db = getDb();
  const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
    .map((r) => r.name)
    .filter((name) => (db.query(`PRAGMA foreign_key_list(${name})`).all() as { table: string }[])
      .some((fk) => fk.table === "children"));

  expect(tables.length).toBeGreaterThan(15); // sanity: the pragma really is returning FKs

  const src = readFileSync("src/demo-family.ts", "utf8");
  const body = /export (?:async )?function purgeFamily[\s\S]*?\n\}\n/.exec(src)?.[0] ?? "";
  expect(body).toContain("DELETE FROM children");

  const missing = tables.filter((t) => !new RegExp(`DELETE FROM ${t}\\b`).test(body));
  expect(missing).toEqual([]);
});

// A household that cannot be deleted is a bug to fix, never a reason to stop forgetting
// everyone else. Before this, one throw ended the cycle and every family behind it stayed.
test("one unpurgeable household does not end the sweep", async () => {
  const a = await mintDemoFamily(HOT);
  const b = await mintDemoFamily(HOT);
  const old = Date.now() - 48 * 3600_000;
  getDb().run("UPDATE families SET demo_at=? WHERE id IN (?,?)", [old, a.familyId, b.familyId]);

  // Wedge the FIRST one shut with a row purgeFamily does not clear, the exact shape of the
  // live failure. listChildren order follows insertion, so this is deterministic.
  const kid = repo.listChildren(a.familyId)[0]!;
  getDb().run(
    `INSERT INTO payout_attempts
       (payout_ref, family_id, child_id, value_luna, recipient, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    ["wedge-1", a.familyId, kid.id, 1, "NQ07 0000 0000 0000 0000 0000 0000 0000 0000",
     "pending", Date.now(), Date.now()],
  );
  const r = await sweepDemoFamilies(24 * 3600_000);
  expect(r.purged).toBe(2);
  expect(r.unpurgeable).toBe(0);
  expect(repo.getFamily(a.familyId)).toBeNull();
  expect(repo.getFamily(b.familyId)).toBeNull();
});
