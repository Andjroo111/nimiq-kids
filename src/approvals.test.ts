// Route-level tests for the three approval paths (tablet PIN, remote bearer, photo proof)
// and the family-mode chore flow. Hermetic: in-memory DB + Hono app.request().

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as approvalsRepo from "./repo-approvals";
import * as media from "./repo-media";
import * as lockRepo from "./repo-lock";
import * as walletRepo from "./repo-wallet";
import { hashPin, newToken, sha256Hex, PIN_MAX_ATTEMPTS } from "./auth";
import { routinesRoutes } from "./routes/routines";
import { approvalsRoutes } from "./routes/approvals";
import { chores } from "./routes/chores";
import { parentRoutes } from "./routes/parent";

const app = new Hono()
  .route("/api", routinesRoutes)
  .route("/api", approvalsRoutes)
  .route("/api", chores)
  .route("/api", parentRoutes);

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});

async function finishRoutine(): Promise<string> {
  const routine = routines.createRoutine(fam.id, kid.id, "Morning", "morning");
  routines.addTask(routine.id, "Brush teeth", 120, { rewardLuna: 10_000 });
  routines.addTask(routine.id, "Get dressed", 300, { rewardLuna: 20_000 });
  const { run, taskRuns } = routines.todayRun(routine, routines.localDay(fam.tz));
  for (const tr of taskRuns) {
    const res = await post(`/api/task-runs/${tr.id}/done`);
    expect(res.status).toBe(200);
  }
  const approval = approvalsRepo.pendingApprovalFor("routine_run", run.id);
  expect(approval).not.toBeNull();
  return approval!.id;
}

test("finishing the last task opens ONE pending approval", async () => {
  const approvalId = await finishRoutine();
  expect(approvalsRepo.getApproval(approvalId)!.status).toBe("pending");
  expect(approvalsRepo.listApprovals(fam.id, "pending").length).toBe(1);
});

test("PIN approve pays NIM to the kid's ledger, records method 'pin' (V2: no stars)", async () => {
  const approvalId = await finishRoutine();
  const res = await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.paidLuna).toBe(30_000);
  expect(body.approval.method).toBe("pin");
  expect(walletRepo.spendableFromLedger(kid.id)).toBe(30_000);
  const events = walletRepo.listWalletEvents(kid.id);
  expect(events.length).toBe(1);
  expect(events[0]!.kind).toBe("earn");
  expect(events[0]!.tx_hash!.startsWith("sim:")).toBe(true); // SIM ledger row
  expect(repo.getChild(kid.id)!.star_balance).toBe(0); // family mode is OFF stars
});

test("bearer approve records method 'remote'; double-approve 409s", async () => {
  const approvalId = await finishRoutine();
  const res = await post(`/api/approvals/${approvalId}/approve`, {}, { Authorization: `Bearer ${bearer}` });
  expect(res.status).toBe(200);
  expect((await res.json()).approval.method).toBe("remote");
  const again = await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" });
  expect(again.status).toBe(409);
  expect(walletRepo.spendableFromLedger(kid.id)).toBe(30_000); // paid exactly once
});

// ---- no payout ceiling: the parent picks the price, the balance is the only bound ----
//
// Andjroo, 2026-07-31: "there should be no payout ceiling. The parent should be able to pick
// that." Every fixed cap we shipped refused somebody's legitimate reward, including the app's
// own seeded 100,000 luna sample chore on the deployed 50,000 luna cap.

async function bigRoutineApproval(rewardLuna: number): Promise<string> {
  const routine = routines.createRoutine(fam.id, kid.id, "Big", "morning");
  routines.addTask(routine.id, "Repaint the fence", 60, { rewardLuna });
  const { run, taskRuns } = routines.todayRun(routine, routines.localDay(fam.tz));
  for (const tr of taskRuns) await post(`/api/task-runs/${tr.id}/done`);
  return approvalsRepo.pendingApprovalFor("routine_run", run.id)!.id;
}

test("a payout far past every old ceiling is approved when the family can fund it", async () => {
  // 5,000 NIM: ~100x the deployed 50,000 luna cap and ~500x the original 10 NIM one.
  const huge = 500_000_000;
  walletRepo.setWalletState(walletRepo.HOT_BALANCE_KEY, String(huge * 2));
  const approval = await bigRoutineApproval(huge);
  const res = await post(`/api/approvals/${approval}/approve`, { pin: "1234" });
  expect(res.status).toBe(200);
  expect((await res.json()).paidLuna).toBe(huge);
  expect(walletRepo.spendableFromLedger(kid.id)).toBe(huge);
});

test("the seeded 'Tidy up your room' reward approves (judge's first-try regression)", async () => {
  // onboard.ts seeds this chore at 100,000 luna, which the live instance's 50,000 luna
  // HATCH_MAX_EARN_LUNA refused with a 400 on the very first approval a judge tried.
  const chore = repo.createChore(fam.id, kid.id, "Tidy up your room", 100_000, "🧸");
  await post(`/api/chores/${chore.id}/submit`);
  const res = await post(`/api/chores/${chore.id}/approve`, { pin: "1234" });
  expect(res.status).toBe(200);
  expect(walletRepo.spendableFromLedger(kid.id)).toBe(100_000);
});

test("a payout the family cannot fund 400s, stays pending, and works after a top up", async () => {
  walletRepo.setWalletState(walletRepo.HOT_BALANCE_KEY, "300000"); // 3 NIM in the wallet
  const approval = await bigRoutineApproval(1_000_000); // a 10 NIM reward
  const res = await post(`/api/approvals/${approval}/approve`, { pin: "1234" });
  expect(res.status).toBe(400);
  const body = await res.json();
  // A real reason with real numbers, not a generic failure.
  expect(body.error).toBe("budget_exhausted");
  expect(body.neededLuna).toBe(1_000_000);
  expect(body.availableLuna).toBe(300_000);
  // Nothing half-applied: not decided, not paid.
  expect(approvalsRepo.getApproval(approval)!.status).toBe("pending");
  expect(walletRepo.spendableFromLedger(kid.id)).toBe(0);

  // The parent tops up and approves the SAME chore again.
  walletRepo.setWalletState(walletRepo.HOT_BALANCE_KEY, "2000000");
  const retry = await post(`/api/approvals/${approval}/approve`, { pin: "1234" });
  expect(retry.status).toBe(200);
  expect(walletRepo.spendableFromLedger(kid.id)).toBe(1_000_000);
});

test("with no wallet snapshot at all, nothing is refused for lack of funds", async () => {
  // An un-snapshotted wallet means UNKNOWN, not zero. Reading it as zero would refuse
  // every payout on a perfectly funded wallet (SIM, a fresh dev DB, a first boot).
  expect(walletRepo.hotWalletSnapshotLuna()).toBeNull();
  const approval = await bigRoutineApproval(900_000_000);
  expect((await post(`/api/approvals/${approval}/approve`, { pin: "1234" })).status).toBe(200);
});

test("wrong PIN rate-limits into a lockout that also blocks the right PIN", async () => {
  const approvalId = await finishRoutine();
  for (let i = 0; i < PIN_MAX_ATTEMPTS - 1; i++) {
    const res = await post(`/api/approvals/${approvalId}/approve`, { pin: "9999" });
    expect(res.status).toBe(401);
  }
  const locking = await post(`/api/approvals/${approvalId}/approve`, { pin: "9999" });
  expect(locking.status).toBe(423);
  const evenRight = await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" });
  expect(evenRight.status).toBe(423);
  expect(walletRepo.spendableFromLedger(kid.id)).toBe(0);
});

test("reject sends the run back to in_progress; kid resubmits into a NEW approval", async () => {
  const approvalId = await finishRoutine();
  const res = await post(`/api/approvals/${approvalId}/reject`, { pin: "1234", note: "bed's still messy" });
  expect(res.status).toBe(200);
  const a = approvalsRepo.getApproval(approvalId)!;
  expect(a.status).toBe("rejected");
  expect(a.note).toBe("bed's still messy");
  const run = routines.getRun(a.subject_id)!;
  expect(run.status).toBe("in_progress");
  expect(walletRepo.spendableFromLedger(kid.id)).toBe(0);

  const resubmit = await post(`/api/routine-runs/${run.id}/submit`);
  expect(resubmit.status).toBe(200);
  const fresh = approvalsRepo.pendingApprovalFor("routine_run", run.id);
  expect(fresh).not.toBeNull();
  expect(fresh!.id).not.toBe(approvalId);
});

test("kid attaches a proof photo; parent overview shows it", async () => {
  const approvalId = await finishRoutine();
  const asset = media.createMedia(fam.id, kid.id, "image", "proof", "image/jpeg", 1234, "2026/07/x.jpg");
  const res = await post(`/api/approvals/${approvalId}/photo`, { mediaAssetId: asset.id });
  expect(res.status).toBe(200);
  expect((await res.json()).approval.photoUrl).toBe(`/api/media/${asset.id}/file`);

  const overview = await app.request("/api/parent/overview", { headers: { Authorization: `Bearer ${bearer}` } });
  expect(overview.status).toBe(200);
  const body = await overview.json();
  expect(body.pending.length).toBe(1);
  expect(body.pending[0].photoUrl).toBe(`/api/media/${asset.id}/file`);
  expect(body.family.hasPin).toBe(true);
});

test("family-mode chore: create with NIM reward, submit opens approval, approve pays luna (no mint)", async () => {
  const create = await post("/api/chores", { childId: kid.id, title: "Laundry", rewardLuna: 50_000 });
  expect(create.status).toBe(201);
  const chore = (await create.json()).chore as repo.Chore;
  expect(chore.reward_luna).toBe(50_000);

  const submit = await post(`/api/chores/${chore.id}/submit`);
  expect(submit.status).toBe(200);
  expect(approvalsRepo.pendingApprovalFor("chore", chore.id)).not.toBeNull();

  const approve = await post(`/api/chores/${chore.id}/approve`, { pin: "1234" });
  expect(approve.status).toBe(200);
  expect((await approve.json()).paidLuna).toBe(50_000);
  expect(walletRepo.spendableFromLedger(kid.id)).toBe(50_000);
  expect(repo.getChild(kid.id)!.star_balance).toBe(0); // V2: family mode is off stars
  expect(repo.getChore(chore.id)!.status).toBe("approved");
  expect(repo.listCashlinksForChild(kid.id).length).toBe(0); // no per-chore mint in family mode
  const kidRow = repo.getChild(kid.id)!;
  expect(kidRow.address).toMatch(/^NQ/); // approval provisioned the kid's real account
  expect(kidRow.account_index).toBe(0);
});

test("family-mode chore approve without parent auth is refused", async () => {
  const create = await post("/api/chores", { childId: kid.id, title: "Laundry", rewardLuna: 50_000 });
  const chore = (await create.json()).chore as repo.Chore;
  const approve = await post(`/api/chores/${chore.id}/approve`);
  expect(approve.status).toBe(401);
  expect(walletRepo.spendableFromLedger(kid.id)).toBe(0);
});

// ---- the approve response hands the receipt over (#122) ----
//
// The transaction hash is what makes the payout checkable by anyone: every chore payout writes
// the chore's own title into the transaction as on-chain data, so the receipt reads "Tidy your
// room". `payKidEarn` has always returned the row carrying it and `applyApprove` dropped it, so
// both the kid's celebration and the parent's success toast had nothing to link to and the
// artefact was reachable only from the money feed, after leaving the moment it belonged to.

test("approving a routine run answers with the payout's own transaction", async () => {
  const approvalId = await finishRoutine();
  const body = await (await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" })).json();
  const earn = walletRepo.listWalletEvents(kid.id).find((e) => e.kind === "earn")!;
  expect(body.txHash).toBe(earn.tx_hash);
  expect(body.txHash).toBeTruthy();
});

test("approving a chore answers with the payout's own transaction", async () => {
  const chore = (await (await post("/api/chores", { childId: kid.id, title: "Laundry", rewardLuna: 50_000 })).json()).chore as repo.Chore;
  await post(`/api/chores/${chore.id}/submit`);
  const approvalId = approvalsRepo.pendingApprovalFor("chore", chore.id)!.id;

  const body = await (await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" })).json();
  const earn = walletRepo.listWalletEvents(kid.id).find((e) => e.kind === "earn")!;
  expect(body.txHash).toBe(earn.tx_hash);
  expect(body.paidLuna).toBe(50_000);
});

test("an approval that pays nothing carries no receipt to offer", async () => {
  // A kid may add a job to their own board worth nothing at all — the point is agency, not
  // earning. No payout, no transaction, and the clients render no link rather than a dead one.
  const chore = (await (await post("/api/chores", {
    childId: kid.id, title: "Tidy up", rewardLuna: 0, createdBy: "kid",
  })).json()).chore as repo.Chore;
  await post(`/api/chores/${chore.id}/submit`);
  const approvalId = approvalsRepo.pendingApprovalFor("chore", chore.id)!.id;

  const body = await (await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" })).json();
  expect(body.paidLuna).toBe(0);
  expect(body.txHash).toBeUndefined();
  expect(walletRepo.listWalletEvents(kid.id).filter((e) => e.kind === "earn").length).toBe(0);
});
