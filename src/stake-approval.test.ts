// Stake/unstake through the parent approval queue (v0.43). Hermetic: in-memory DB, SIM,
// Hono app.request(). The queued intent rides send_requests (kind 'stake' | 'unstake');
// NO wallet_event exists until the parent approves — the ledger must never claim money
// moved that a parent has not said yes to.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as approvalsRepo from "./repo-approvals";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import { hashPin, newToken, sha256Hex } from "./auth";
import { walletRoutes } from "./routes/wallet";
import { approvalsRoutes, enrichApproval } from "./routes/approvals";
import { stake } from "./wallet/kid-staking";

const app = new Hono().route("/api", walletRoutes).route("/api", approvalsRoutes);

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

const FLAG = "HATCH_REQUIRE_PARENT_APPROVAL";
let savedFlag: string | undefined;

beforeEach(async () => {
  savedFlag = process.env[FLAG];
  delete process.env[FLAG];
  initTestDb();
  const f = repo.createFamily("Dad", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ada", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
});

function fund(valueLuna: number, childId = kid.id) {
  wrepo.addWalletEvent({
    familyId: fam.id, childId, kind: "deposit", valueLuna,
    counterpartyLabel: "Test deposit", txHash: `sim:${crypto.randomUUID()}`,
  });
}

async function queueStake(valueLuna: number): Promise<{ approvalId: string; requestId: string }> {
  const res = await post(`/api/kids/${kid.id}/stake`, { valueLuna });
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body.status).toBe("pending_approval");
  return body;
}

test("family mode: POST /stake queues — approval + request rows, NO ledger row, nothing staked", async () => {
  fund(500_000);
  const { approvalId, requestId } = await queueStake(200_000);
  const a = approvalsRepo.getApproval(approvalId)!;
  expect(a.subject_kind).toBe("stake");
  expect(a.status).toBe("pending");
  const req = wrepo.getSendRequest(requestId)!;
  expect(req.kind).toBe("stake");
  expect(req.value_luna).toBe(200_000);
  expect(req.status).toBe("pending");
  // The money has NOT moved: no stake event, full spendable, zero staked.
  expect(wrepo.listWalletEvents(kid.id).filter((e) => e.kind === "stake").length).toBe(0);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(500_000);
  expect(wrepo.stakedFromLedger(kid.id)).toBe(0);
});

test("approve (parent bearer) executes the stake; re-approve is 409", async () => {
  fund(500_000);
  const { approvalId, requestId } = await queueStake(200_000);
  const approve = await post(`/api/approvals/${approvalId}/approve`, {}, { Authorization: `Bearer ${bearer}` });
  expect(approve.status).toBe(200);
  expect((await approve.json()).paidLuna).toBe(0);
  expect(wrepo.stakedFromLedger(kid.id)).toBe(200_000);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(300_000);
  expect(wrepo.getSendRequest(requestId)!.status).toBe("executed");
  const again = await post(`/api/approvals/${approvalId}/approve`, {}, { Authorization: `Bearer ${bearer}` });
  expect(again.status).toBe(409);
  expect(wrepo.stakedFromLedger(kid.id)).toBe(200_000); // no double-stake
});

test("reject leaves every luna where it was", async () => {
  fund(500_000);
  const { approvalId, requestId } = await queueStake(200_000);
  const reject = await post(`/api/approvals/${approvalId}/reject`, { pin: "1234" });
  expect(reject.status).toBe(200);
  expect(wrepo.getSendRequest(requestId)!.status).toBe("rejected");
  expect(wrepo.stakedFromLedger(kid.id)).toBe(0);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(500_000);
});

test("approve after the balance drained: 400 insufficient_funds, approval STAYS pending", async () => {
  fund(500_000);
  const { approvalId } = await queueStake(400_000);
  // The kid spent it while the approval sat in the queue.
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "send", valueLuna: -300_000 });
  const approve = await post(`/api/approvals/${approvalId}/approve`, {}, { Authorization: `Bearer ${bearer}` });
  expect(approve.status).toBe(400);
  expect((await approve.json()).error).toBe("insufficient_funds");
  expect(approvalsRepo.getApproval(approvalId)!.status).toBe("pending"); // retryable after a top-up
  // Top the kid back up and the SAME approval goes through.
  fund(300_000);
  const retry = await post(`/api/approvals/${approvalId}/approve`, {}, { Authorization: `Bearer ${bearer}` });
  expect(retry.status).toBe(200);
  expect(wrepo.stakedFromLedger(kid.id)).toBe(400_000);
});

test("unstake mirror: queue, approve, and the money enters the pending cooldown", async () => {
  fund(500_000);
  await stake(fam, kid.id, 300_000); // staked state set up at the service level
  const res = await post(`/api/kids/${kid.id}/unstake`, { valueLuna: 100_000 });
  expect(res.status).toBe(202);
  const { approvalId, requestId } = await res.json();
  const a = approvalsRepo.getApproval(approvalId)!;
  expect(a.subject_kind).toBe("unstake");
  expect(wrepo.getSendRequest(requestId)!.kind).toBe("unstake");
  expect(wrepo.stakedFromLedger(kid.id)).toBe(300_000); // untouched while queued
  const approve = await post(`/api/approvals/${approvalId}/approve`, {}, { Authorization: `Bearer ${bearer}` });
  expect(approve.status).toBe(200);
  expect(wrepo.stakedFromLedger(kid.id)).toBe(200_000);
  expect(wrepo.pendingUnstakeFromLedger(kid.id)).toBe(100_000); // cooldown, not spendable yet
});

test("unstake precheck refuses more than is staked, at queue time and approve time", async () => {
  fund(500_000);
  await stake(fam, kid.id, 100_000);
  // Queue time: nothing staged, no approval opened.
  const res = await post(`/api/kids/${kid.id}/unstake`, { valueLuna: 200_000 });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("insufficient_stake");
  expect(approvalsRepo.listApprovals(fam.id, "pending").length).toBe(0);
  // Approve time: a queued unstake whose stake has since shrunk stays pending.
  const ok = await post(`/api/kids/${kid.id}/unstake`, { valueLuna: 100_000 });
  expect(ok.status).toBe(202);
  const { approvalId } = await ok.json();
  const drain = await post(`/api/kids/${kid.id}/unstake`, { valueLuna: 100_000 });
  expect(drain.status).toBe(202);
  const { approvalId: drainId } = await drain.json();
  await post(`/api/approvals/${drainId}/approve`, {}, { Authorization: `Bearer ${bearer}` });
  const late = await post(`/api/approvals/${approvalId}/approve`, {}, { Authorization: `Bearer ${bearer}` });
  expect(late.status).toBe(400);
  expect((await late.json()).error).toBe("insufficient_stake");
  expect(approvalsRepo.getApproval(approvalId)!.status).toBe("pending");
});

test("PIN-path approve works (the on-tablet pad)", async () => {
  fund(500_000);
  const { approvalId } = await queueStake(150_000);
  const approve = await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" });
  expect(approve.status).toBe(200);
  expect(wrepo.stakedFromLedger(kid.id)).toBe(150_000);
});

test("mode 'demo' without the flag: stake is instant with the old response shape", async () => {
  repo.updateFamilySettings(fam.id, { mode: "demo" });
  fund(500_000);
  const res = await post(`/api/kids/${kid.id}/stake`, { valueLuna: 200_000 });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.event.kind).toBe("stake");
  expect(body.stakedLuna).toBe(200_000);
  expect(wrepo.stakedFromLedger(kid.id)).toBe(200_000);
  expect(approvalsRepo.listApprovals(fam.id, "pending").length).toBe(0);
});

test("mode 'demo' + HATCH_REQUIRE_PARENT_APPROVAL=1: forced — stake queues anyway", async () => {
  process.env[FLAG] = "1";
  repo.updateFamilySettings(fam.id, { mode: "demo" });
  fund(500_000);
  // The flag also demands a bearer on money endpoints (wallet-auth.test.ts covers the
  // 401); with the household's own credential the demo family still queues.
  const res = await post(`/api/kids/${kid.id}/stake`, { valueLuna: 200_000 }, { Authorization: `Bearer ${bearer}` });
  expect(res.status).toBe(202);
  expect(wrepo.stakedFromLedger(kid.id)).toBe(0);
});

test("stake precheck runs at queue time: an unaffordable ask never reaches the parent", async () => {
  fund(50_000);
  const res = await post(`/api/kids/${kid.id}/stake`, { valueLuna: 100_000 });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("insufficient_funds");
  expect(approvalsRepo.listApprovals(fam.id, "pending").length).toBe(0);
});

test("enrichApproval carries summary.valueLuna for both staking kinds", async () => {
  fund(500_000);
  const { approvalId } = await queueStake(200_000);
  const enriched = enrichApproval(approvalsRepo.getApproval(approvalId)!);
  expect(enriched.subjectKind).toBe("stake");
  expect(enriched.rewardLuna).toBe(0);
  expect((enriched.summary as { valueLuna: number }).valueLuna).toBe(200_000);

  await stake(fam, kid.id, 100_000);
  const un = await post(`/api/kids/${kid.id}/unstake`, { valueLuna: 100_000 });
  const { approvalId: unId } = await un.json();
  const unEnriched = enrichApproval(approvalsRepo.getApproval(unId)!);
  expect(unEnriched.subjectKind).toBe("unstake");
  expect((unEnriched.summary as { valueLuna: number }).valueLuna).toBe(100_000);
});
