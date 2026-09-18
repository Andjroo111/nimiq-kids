// V3 sticker chart + Treasure Box tests: chart feed shape, placement persistence
// and state transitions (pending -> shined / retry -> pending), the buy flows
// (pack grant, insufficient balance, screen time override, coupon queue + refund),
// and photo stickers. Hermetic: in-memory DB + Hono app.request(), SIM ledger.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb, getDb as getDbForTest } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as approvalsRepo from "./repo-approvals";
import * as stickersRepo from "./repo-stickers";
import * as media from "./repo-media";
import * as lockRepo from "./repo-lock";
import * as wrepo from "./repo-wallet";
import { hashPin } from "./auth";
import { routinesRoutes } from "./routes/routines";
import { approvalsRoutes } from "./routes/approvals";
import { chores } from "./routes/chores";
import { stickersRoutes } from "./routes/stickers";
import { mondayOf, weekDays, monthDays, addDays } from "./days";
import { storeRoutes } from "./routes/store";
import { STICKER_ART_SHIPPED, STICKER_PACKS, STICKERS, packStoreItems, stickerAssetUrl } from "./sticker-catalog";
import { existsSync } from "node:fs";
import { join } from "node:path";

const app = new Hono()
  .route("/api", routinesRoutes)
  .route("/api", approvalsRoutes)
  .route("/api", chores)
  .route("/api", stickersRoutes)
  .route("/api", storeRoutes);

const get = (path: string) => app.request(path);
const post = (path: string, body: Record<string, unknown> = {}) =>
  app.request(path, {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });

let fam: repo.Family;
let kid: repo.Child;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  // The Box only stocks screen time for a household with a tablet to spend it on (#306).
  lockRepo.createDevice(fam.id, "Kid's tablet", "hash-stickers", null);
});

/** Store prices come from the catalog, not from literals: they were repriced
 *  when rewards became dollar-sized (see sticker-catalog.ts), and a test that
 *  hard-codes them just re-breaks on the next repricing. */
const priceOf = (itemId: string) => stickersRepo.getStoreItem(itemId)!.price_luna;

const fund = (luna: number) =>
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "deposit", valueLuna: luna });

function makeRoutine() {
  const routine = routines.createRoutine(fam.id, kid.id, "Morning", "morning");
  routines.addTask(routine.id, "Brush teeth", 120, { rewardLuna: 10_000 });
  routines.addTask(routine.id, "Get dressed", 300, { rewardLuna: 20_000 });
  return routine;
}

// ---- week math ----
test("mondayOf + weekDays: ISO week window", () => {
  expect(mondayOf("2026-07-19")).toBe("2026-07-13"); // a Sunday -> its week's Monday
  expect(mondayOf("2026-07-13")).toBe("2026-07-13"); // Monday is a fixed point
  expect(weekDays("2026-07-13")).toEqual([
    "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16",
    "2026-07-17", "2026-07-18", "2026-07-19",
  ]);
});

// ---- month math (the calendar's grid) ----
test("addDays crosses month and year ends", () => {
  expect(addDays("2026-07-30", 3)).toBe("2026-08-02");
  expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
});

test("monthDays: whole Mon-first weeks, never a ragged row", () => {
  // July 2026 starts on a Wednesday and ends on a Friday, so the grid runs from
  // the Monday before the 1st to the Sunday after the 31st: 5 clean weeks.
  const july = monthDays("2026-07");
  expect(july.length).toBe(35);
  expect(july[0]).toBe("2026-06-29");
  expect(july.at(-1)).toBe("2026-08-02");
  expect(july).toContain("2026-07-01");
  expect(july).toContain("2026-07-31");

  // Every month is a multiple of 7, starts on a Monday, ends on a Sunday, and
  // covers every day of its own month.
  for (const month of ["2026-01", "2026-02", "2026-08", "2027-02", "2028-02", "2026-11"]) {
    const days = monthDays(month);
    expect(days.length % 7).toBe(0);
    expect(mondayOf(days[0]!)).toBe(days[0]);
    expect(addDays(days.at(-1)!, 1)).toBe(mondayOf(addDays(days.at(-1)!, 1)));
    expect(days.filter((d: string) => d.startsWith(month)).length)
      .toBe(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate());
    expect(new Set(days).size).toBe(days.length); // no repeats
  }
});

// ---- month feed ----
test("month feed: same rows as the week, over the whole grid", async () => {
  const routine = makeRoutine();
  repo.createChore(fam.id, kid.id, "Laundry", 50_000, "🧺");

  const res = await get(`/api/kids/${kid.id}/month`);
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body.month).toBe(body.today.slice(0, 7));
  expect(body.days).toEqual(monthDays(body.month));
  expect(body.days).toContain(body.today);

  // Same row kinds as /chart, and one cell per day of the grid.
  const week = await (await get(`/api/kids/${kid.id}/chart`)).json();
  expect(body.rows.map((r: { kind: string }) => r.kind))
    .toEqual(week.rows.map((r: { kind: string }) => r.kind));
  for (const row of body.rows) expect(row.cells.length).toBe(body.days.length);

  // A day the two feeds share must read identically in both.
  const pick = (feed: { rows: { kind: string; cells: { day: string }[] }[] }, day: string) =>
    JSON.stringify(feed.rows.map((r) => r.cells.find((c) => c.day === day)));
  expect(pick(body, body.today)).toBe(pick(week, body.today));

  // Today's run is ensured by a month read too, so the calendar never shows an
  // empty today just because /month happened to be the first call.
  const todayCell = body.rows.find((r: { kind: string }) => r.kind === "routine")
    .cells.find((c: { day: string }) => c.day === body.today);
  expect(todayCell.total).toBe(2);
  expect(routines.findRun(routine.id, body.today)).toBeTruthy();
});

test("month feed: ?month= picks a month, garbage falls back to today's", async () => {
  makeRoutine();
  const jan = await (await get(`/api/kids/${kid.id}/month?month=2026-01`)).json();
  expect(jan.month).toBe("2026-01");
  expect(jan.days).toEqual(monthDays("2026-01"));

  for (const bad of ["2026-13", "not-a-month", "2026-1", ""]) {
    const body = await (await get(`/api/kids/${kid.id}/month?month=${bad}`)).json();
    expect(body.month).toBe(body.today.slice(0, 7));
  }
  expect((await get(`/api/kids/nope/month`)).status).toBe(404);
});

test("month feed: a placed sticker lands on its day", async () => {
  const routine = makeRoutine();
  const chart = await (await get(`/api/kids/${kid.id}/chart`)).json();
  const run = routines.findRun(routine.id, chart.today)!;
  const tr = routines.listTaskRuns(run.id)[0]!;
  routines.finishTaskRun(tr.id, "done");
  const sticker = stickersRepo.ownedStickers(kid.id)[0]!;
  await post(`/api/task-runs/${tr.id}/sticker`, { stickerId: sticker.id, xPct: 20, yPct: 80, tiltDeg: 7 });

  const body = await (await get(`/api/kids/${kid.id}/month`)).json();
  type Cell = { day: string; placements?: unknown[] };
  const cells: Cell[] = body.rows.flatMap((r: { cells: Cell[] }) => r.cells);
  const withSticker = cells.filter((c) => (c.placements ?? []).length);
  expect(withSticker.length).toBe(1);
  expect(withSticker[0]!.day).toBe(chart.today);
});

// ---- chart feed ----
test("chart feed: 7-day week, routine + chore rows, today's tasks, starter inventory", async () => {
  makeRoutine();
  repo.createChore(fam.id, kid.id, "Laundry", 50_000, "🧺");
  const res = await get(`/api/kids/${kid.id}/chart`);
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body.days.length).toBe(7);
  expect(body.weekStart).toBe(mondayOf(body.today));
  expect(body.days).toContain(body.today);

  const routineRow = body.rows.find((r: { kind: string }) => r.kind === "routine");
  expect(routineRow.cells.length).toBe(7);
  const todayCell = routineRow.cells.find((c: { day: string }) => c.day === body.today);
  expect(todayCell.total).toBe(2); // today's run was ensured by the chart read
  expect(todayCell.status).toBe("in_progress");

  expect(body.rows.find((r: { kind: string }) => r.kind === "chores")).toBeTruthy();
  expect(body.todayTasks.filter((t: { kind: string }) => t.kind === "task").length).toBe(2);
  expect(body.todayTasks.filter((t: { kind: string }) => t.kind === "chore").length).toBe(1);

  // Starter pack auto-granted on first read.
  expect(body.stickers.length).toBe(10);
  expect(stickersRepo.ownsSticker(kid.id, "stk-star")).toBe(true);
});

test("chart feed: an approved chore stays on Today until its sticker is collected", async () => {
  // Since 0.28 the sticker only becomes available AFTER the parent approves
  // (Andjroo, 2026-07-31), so the card has to survive the approval that used to
  // be the last thing that ever happened to it. Before this it left Today at the
  // exact moment it turned into the reward the kid was told to come back for.
  const chore = repo.createChore(fam.id, kid.id, "Water the plants", 50_000, "🪴");
  await post(`/api/chores/${chore.id}/submit`);
  const approval = approvalsRepo.pendingApprovalFor("chore", chore.id)!;
  expect(approval).toBeTruthy();
  await post(`/api/approvals/${approval.id}/approve`, { pin: "1234" });
  expect(repo.getChore(chore.id)!.status).toBe("approved");

  const onToday = async () => {
    const body = await (await get(`/api/kids/${kid.id}/chart`)).json();
    return body.todayTasks.find((t: { choreId?: string }) => t.choreId === chore.id) ?? null;
  };
  const card = await onToday();
  expect(card).toBeTruthy();
  expect(card.placement).toBeNull(); // approved, nothing collected yet

  // Collect it. The placement is born 'shined' because approval already happened
  // -- setChorePlacementState fired long before this row existed.
  const sticker = stickersRepo.ownedStickers(kid.id)[0]!;
  const placed = await (await post(`/api/chores/${chore.id}/sticker`, {
    stickerId: sticker.id, xPct: 50, yPct: 50, tiltDeg: 0,
  })).json();
  expect(placed.placement.state).toBe("shined");
  expect((await onToday()).placement.state).toBe("shined");

  // And an approval from an EARLIER day does not drag the card back onto Today.
  repo.setChoreStatus(chore.id, "approved");
  getDbForTest().run("UPDATE chores SET approved_at=? WHERE id=?",
    [Date.now() - 3 * 24 * 3600_000, chore.id]);
  getDbForTest().run("DELETE FROM sticker_placements WHERE subject_kind='chore' AND subject_id=?", [chore.id]);
  expect(await onToday()).toBeNull();
});

// ---- placement ----
test("placement: persists position + tilt, upserts on re-place, guards not-done/not-owned", async () => {
  const routine = makeRoutine();
  const { taskRuns } = routines.todayRun(routine, routines.localDay(fam.tz));
  const tr = taskRuns[0]!;

  // Not done yet -> no sticker.
  expect((await post(`/api/task-runs/${tr.id}/sticker`, { stickerId: "stk-star" })).status).toBe(400);

  await post(`/api/task-runs/${tr.id}/done`);
  stickersRepo.ensureStarterGrant(kid.id);

  // Unknown / unowned stickers rejected.
  expect((await post(`/api/task-runs/${tr.id}/sticker`, { stickerId: "nope" })).status).toBe(404);
  expect((await post(`/api/task-runs/${tr.id}/sticker`, { stickerId: "stk-space-rocket" })).status).toBe(403);

  const res = await post(`/api/task-runs/${tr.id}/sticker`, {
    stickerId: "stk-star", xPct: 31, yPct: 64, tiltDeg: 9,
  });
  expect(res.status).toBe(200);
  const { placement } = await res.json();
  expect(placement.state).toBe("pending");
  expect(placement.xPct).toBe(31);
  expect(placement.yPct).toBe(64);
  expect(placement.tiltDeg).toBe(9);

  // Re-place moves the same placement (id stable), coords update.
  const res2 = await post(`/api/task-runs/${tr.id}/sticker`, {
    stickerId: "stk-dino", xPct: 70, yPct: 20, tiltDeg: -5,
  });
  const { placement: p2 } = await res2.json();
  expect(p2.id).toBe(placement.id);
  expect(p2.stickerId).toBe("stk-dino");
  expect(p2.xPct).toBe(70);

  // The chart cell carries it.
  const chart = await (await get(`/api/kids/${kid.id}/chart`)).json();
  const row = chart.rows.find((r: { kind: string }) => r.kind === "routine");
  const cell = row.cells.find((c: { day: string }) => c.day === chart.today);
  expect(cell.placements.length).toBe(1);
  expect(cell.placements[0].xPct).toBe(70);
});

test("state transitions: approve shines, reject wobbles, resubmit goes hopeful again", async () => {
  const routine = makeRoutine();
  const { run, taskRuns } = routines.todayRun(routine, routines.localDay(fam.tz));
  stickersRepo.ensureStarterGrant(kid.id);
  for (const tr of taskRuns) {
    await post(`/api/task-runs/${tr.id}/done`);
    await post(`/api/task-runs/${tr.id}/sticker`, { stickerId: "stk-star" });
  }
  const approval = approvalsRepo.pendingApprovalFor("routine_run", run.id)!;

  // Reject -> retry.
  expect((await post(`/api/approvals/${approval.id}/reject`, { pin: "1234" })).status).toBe(200);
  expect(stickersRepo.getPlacement("routine_task_run", taskRuns[0]!.id)!.state).toBe("retry");

  // Resubmit -> pending again.
  expect((await post(`/api/routine-runs/${run.id}/submit`)).status).toBe(200);
  expect(stickersRepo.getPlacement("routine_task_run", taskRuns[0]!.id)!.state).toBe("pending");

  // Approve -> golden shine (and NIM pays as before).
  const approval2 = approvalsRepo.pendingApprovalFor("routine_run", run.id)!;
  const res = await post(`/api/approvals/${approval2.id}/approve`, { pin: "1234" });
  expect(res.status).toBe(200);
  expect((await res.json()).paidLuna).toBe(30_000);
  for (const tr of taskRuns) {
    expect(stickersRepo.getPlacement("routine_task_run", tr.id)!.state).toBe("shined");
  }
});

test("chore sticker: submitted -> pending, approve -> shined, reject -> retry -> resubmit -> pending", async () => {
  const chore = repo.createChore(fam.id, kid.id, "Laundry", 50_000, "🧺");
  stickersRepo.ensureStarterGrant(kid.id);
  expect((await post(`/api/chores/${chore.id}/sticker`, { stickerId: "stk-heart" })).status).toBe(400); // open

  await post(`/api/chores/${chore.id}/submit`);
  const res = await post(`/api/chores/${chore.id}/sticker`, { stickerId: "stk-heart", xPct: 40, yPct: 40, tiltDeg: 3 });
  expect(res.status).toBe(200);
  expect((await res.json()).placement.state).toBe("pending");

  const approval = approvalsRepo.pendingApprovalFor("chore", chore.id)!;
  await post(`/api/approvals/${approval.id}/reject`, { pin: "1234" });
  expect(stickersRepo.getPlacement("chore", chore.id)!.state).toBe("retry");

  await post(`/api/chores/${chore.id}/submit`);
  expect(stickersRepo.getPlacement("chore", chore.id)!.state).toBe("pending");

  const approval2 = approvalsRepo.pendingApprovalFor("chore", chore.id)!;
  expect((await post(`/api/approvals/${approval2.id}/approve`, { pin: "1234" })).status).toBe(200);
  expect(stickersRepo.getPlacement("chore", chore.id)!.state).toBe("shined");
});

// ---- Treasure Box ----
test("store list: data-driven categories + items with owned flags", async () => {
  const res = await get(`/api/kids/${kid.id}/store`);
  expect(res.status).toBe(200);
  const body = await res.json();
  // cat-timers is RETIRED (sticker-catalog.ts RETIRED_CATEGORIES), so the kid
  // side no longer offers it. The row is still there — see the retirement test
  // below; a purchase referencing it must stay readable forever.
  expect(body.categories.map((c: { id: string }) => c.id)).toEqual(["cat-stickers", "cat-screen", "cat-coupons"]);
  const pack = body.items.find((i: { id: string }) => i.id === "item-pack-space-theme");
  expect(pack.kind).toBe("pack");
  expect(pack.owned).toBe(false);
  // The six members and not the boss: the tile shows what the box holds.
  expect(pack.stickers.length).toBe(6);
  expect(pack.stickers.some((s: { id: string }) => s.id === "stk-space-astro")).toBe(false);
});

test("Timers are retired, not deleted: rows survive and a purchase stays readable", async () => {
  // The whole point of retiring rather than deleting. `kid_purchases.item_id`
  // is a real FK, and a kid who already owns the Sticker Maker keeps it — the
  // rig is equipped out of `kid_unlocks`, which never reads store_items.
  const cat = stickersRepo.getCategory("cat-timers");
  expect(cat).not.toBeNull();
  expect(cat!.active).toBe(0);
  for (const id of ["item-timer-maker", "item-timer-pola"]) {
    const item = stickersRepo.getStoreItem(id);
    expect(item).not.toBeNull();
    expect(item!.active).toBe(0);
  }
  // Off the shelves in both the kid's read AND the buy route.
  expect((await get(`/api/kids/${kid.id}/store`)).status).toBe(200);
  const body = await (await get(`/api/kids/${kid.id}/store`)).json();
  expect(body.items.some((i: { id: string }) => i.id.startsWith("item-timer-"))).toBe(false);
  fund(10_000 * 100_000);
  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-timer-maker" })).status).toBe(404);

  // A purchase made before the retirement still resolves to its row.
  const item = stickersRepo.getStoreItem("item-timer-maker")!;
  const purchase = stickersRepo.createPurchase(fam.id, kid.id, item, "done");
  expect(stickersRepo.getPurchase(purchase.id)!.item_id).toBe("item-timer-maker");
  stickersRepo.grantUnlock(kid.id, "timer_style", "maker");
  expect(stickersRepo.ownedTimerStyles(kid.id)).toContain("maker");
});

test("buy pack: spend event, balance drops, stickers granted, no double-buy", async () => {
  // Packs are priced in WHOLE NIM against dollar-sized rewards now (see
  // sticker-catalog.ts) — the old 2 NIM price was a tenth of a cent.
  const price = STICKER_PACKS.find((p) => p.id === "pack-space-theme")!.priceLuna;
  fund(price + 100_000);
  const res = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-pack-space-theme" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.kind).toBe("pack");
  expect(body.balanceLuna).toBe(100_000);
  expect(body.stickers.length).toBe(6);
  expect(body.event.kind).toBe("spend");
  expect(body.event.valueLuna).toBe(-price);
  expect(stickersRepo.ownsSticker(kid.id, "stk-space-rocket")).toBe(true);
  // Bought: the members, usable at once. NOT the boss, and NOT the scene (2026-09-17): those
  // are a ladder's to give, and a bought set is finished on the first rung climbed toward it.
  expect(stickersRepo.ownsSticker(kid.id, "stk-space-astro")).toBe(false);
  expect(stickersRepo.packOwned(kid.id, "pack-space-theme")).toBe(true);
  expect(stickersRepo.packComplete(kid.id, "pack-space-theme")).toBe(true);
  expect(stickersRepo.packFinished(kid.id, "pack-space-theme")).toBe(false);
  expect(stickersRepo.ownsBackground(kid.id, "space")).toBe(false);
  expect(stickersRepo.ownedStickers(kid.id).some((s) => s.id === "stk-space-rocket")).toBe(true);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(100_000);

  expect((await post(`/api/kids/${kid.id}/buy`, { itemId: "item-pack-space-theme" })).status).toBe(400);

  const rung = stickersRepo.grantNextThemeSticker(kid.id, "pack-space-theme");
  expect(rung.sticker).toBeUndefined();
  expect(rung.boss?.id).toBe("stk-space-astro");
  expect(rung.complete).toBe(true);
  expect(stickersRepo.packFinished(kid.id, "pack-space-theme")).toBe(true);
  expect(stickersRepo.ownsBackground(kid.id, "space")).toBe(true);
  expect(stickersRepo.grantNextThemeSticker(kid.id, "pack-space-theme")).toEqual({ complete: true });
});

test("buy: insufficient balance moves no money, grants nothing", async () => {
  const res = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-pack-space-theme" });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("insufficient_funds");
  expect(stickersRepo.ownsSticker(kid.id, "stk-space-rocket")).toBe(false);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(0);
});

test("buy screen time: kid-purchased unlock override is live", async () => {
  fund(priceOf("item-screen-15") + 100_000);
  const before = Date.now();
  const res = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-screen-15" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.kind).toBe("screen_time");
  expect(body.minutes).toBe(15);
  const o = lockRepo.activeOverride(fam.id, kid.id)!;
  expect(o.mode).toBe("unlock");
  expect(o.until_ms!).toBeGreaterThanOrEqual(before + 14 * 60_000);
  expect(o.until_ms!).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
});

test("buy coupon: queues a parent approval; approve fulfills, reject refunds", async () => {
  const dinner = priceOf("item-coupon-dinner");
  const stayup = priceOf("item-coupon-stayup");
  fund(dinner + stayup + 200_000);
  const res = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-coupon-dinner" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.kind).toBe("coupon");
  expect(body.balanceLuna).toBe(stayup + 200_000);

  // It sits in the parent feed with a coupon summary.
  const pending = approvalsRepo.listApprovals(fam.id, "pending");
  expect(pending.length).toBe(1);
  expect(pending[0]!.subject_kind).toBe("coupon");

  // Approve = fulfilled, no money moves.
  const ok = await post(`/api/approvals/${body.approvalId}/approve`, { pin: "1234" });
  expect(ok.status).toBe(200);
  const enriched = (await ok.json()).approval;
  expect(enriched.subjectKind).toBe("coupon");
  expect(enriched.summary.title).toBe("Pick what's for dinner");
  expect(enriched.summary.priceLuna).toBe(dinner);
  expect(stickersRepo.getPurchase(body.purchaseId)!.status).toBe("fulfilled");
  expect(wrepo.spendableFromLedger(kid.id)).toBe(stayup + 200_000);

  // Second coupon, rejected: the NIM comes back.
  const res2 = await post(`/api/kids/${kid.id}/buy`, { itemId: "item-coupon-stayup" });
  const body2 = await res2.json();
  expect(body2.balanceLuna).toBe(200_000);
  expect((await post(`/api/approvals/${body2.approvalId}/reject`, { pin: "1234" })).status).toBe(200);
  expect(stickersRepo.getPurchase(body2.purchaseId)!.status).toBe("refunded");
  expect(wrepo.spendableFromLedger(kid.id)).toBe(stayup + 200_000);
  const deposit = wrepo.listWalletEvents(kid.id)[0]!;
  expect(deposit.kind).toBe("deposit");
  expect(deposit.counterparty_label).toBe("Treasure Box");
});

// ---- photo stickers ----
//
// The bytes stay on the tablet (#282). This route takes a `local:<uuid>` handle it cannot
// resolve and never sees the picture, so what it owes is the sticker row — and a refusal for
// anything that is not that shape, so the column can never become free text.
test("photo sticker: a local handle becomes an owned die-cut sticker", async () => {
  const ref = `local:${crypto.randomUUID()}`;
  const res = await post(`/api/kids/${kid.id}/photo-sticker`, { localRef: ref });
  expect(res.status).toBe(201);
  const { sticker } = await res.json();
  expect(sticker.kind).toBe("photo");
  expect(sticker.assetUrl).toBe(ref);
  expect(stickersRepo.ownsSticker(kid.id, sticker.id)).toBe(true);
});

test("photo sticker: anything but a local handle is refused", async () => {
  for (const localRef of [
    "",
    "/api/media/abc/file",                       // the pre-#282 shape: no longer a thing
    "https://example.com/photo.jpg",             // never an off-device URL
    "local:not-a-uuid",
    `local:${crypto.randomUUID()} onerror=x`,
  ]) {
    expect((await post(`/api/kids/${kid.id}/photo-sticker`, { localRef })).status).toBe(400);
  }
  // The old field is not quietly still honoured.
  const asset = media.createMedia(fam.id, kid.id, "image", "sticker", "image/jpeg", 1234, "2026/07/x.jpg");
  expect((await post(`/api/kids/${kid.id}/photo-sticker`, { mediaAssetId: asset.id })).status).toBe(400);
});

// ---- the sticker catalog ----
test("catalog: every art sticker has art that actually exists on disk", () => {
  const packIds = new Set(STICKER_PACKS.map((p) => p.id));
  for (const s of STICKERS) {
    expect(s.emoji.length).toBeGreaterThan(0); // the fallback + a11y label
    expect(packIds.has(s.packId)).toBe(true);
  }
  expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length); // no dupe ids

  // The art IS a generated file. A sticker whose PNG is missing renders a broken
  // image on the kid's chart, which no other test would catch — the row would
  // look perfectly valid. While no art ships (2026-09-15) the URL is null on every row
  // and the emoji, checked above, is what draws.
  const rows = stickersRepo.listPacks().flatMap((p) => stickersRepo.packStickers(p.id));
  expect(rows.length).toBe(STICKERS.length);
  for (const row of rows) {
    expect(row.emoji).toBeTruthy();
    expect(row.asset_url).toBe(stickerAssetUrl(row.id));
    // Since 2026-09-17 the THEME stickers (the lineless packs) carry a file, and since
    // 2026-09-18 the starter pack does too (`art`); the retired emoji packs keep a null url
    // and draw their emoji.
    const drawn = STICKER_PACKS.some((p) => p.id === row.pack_id && (p.theme || p.art));
    if (STICKER_ART_SHIPPED && drawn) {
      expect(row.asset_url, row.id).not.toBeNull();
      expect(existsSync(join(import.meta.dir, "..", "public", row.asset_url!)), row.id).toBe(true);
    } else {
      expect(row.asset_url, row.id).toBeNull();
    }
  }
});

test("catalog: the starter pack is free and auto-granted, the rest cost real NIM", () => {
  const starter = STICKER_PACKS.find((p) => p.id === "pack-starter")!;
  expect(starter.priceLuna).toBe(0);
  // The shelf IS the four themes (2026-09-17: "buy the pack, or earn it rung by rung"), and
  // nothing else: the emoji packs left with the old icon.
  expect(packStoreItems().map((i) => i.packId).sort())
    .toEqual(STICKER_PACKS.filter((x) => x.theme).map((p) => p.id).sort());
  for (const p of STICKER_PACKS.filter((x) => x.id !== "pack-starter")) {
    // Whole NIM, and enough to be worth saving for: the old 2 NIM price was a
    // tenth of a cent once rewards became dollar-sized.
    expect(p.priceLuna % 100_000).toBe(0);
    expect(p.priceLuna).toBeGreaterThanOrEqual(1_000 * 100_000);
  }
  const kid2 = repo.createChild(fam.id, "Kid 2", "🐙");
  stickersRepo.ensureStarterGrant(kid2.id);
  const owned = stickersRepo.ownedStickers(kid2.id);
  expect(owned.length).toBe(STICKERS.filter((s) => s.packId === "pack-starter").length);
  expect(owned.every((s) => !!s.emoji)).toBe(true);
  expect(stickersRepo.ownsSticker(kid2.id, "stk-space-rocket")).toBe(false); // a paid pack
});
