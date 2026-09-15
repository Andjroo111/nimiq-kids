// PARTIAL CREDIT (#351): approving a job for a FRACTION of what it promised.
//
// The tests #351 asked for, in its order, plus the two the parent-custody path adds. The
// reason this file is worth more than its assertions: the payout is not the only reader of
// the number. `approvalPayoutLuna` also prices the SIGNING INTENT a grown-up's own wallet
// signs on a `HATCH_CUSTODY=parent` instance, and that mint happens BEFORE the race-safe
// decide. A share committed by the decide — which is where the issue put it — would be
// invisible to the mint, and a parent would sign the full price against a card the queue
// says is a quarter. So the share is committed to the pending row first, and these tests
// pin that ordering rather than just the arithmetic.
//
// Hermetic: in-memory DB, stubbed head height, nothing is ever broadcast.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import * as approvalsRepo from "./repo-approvals";
import { applyShare } from "./repo-approvals";
import { newToken, sha256Hex } from "./auth";
import { _setChainClient, type ChainClient } from "./nimiq/client";
import { approvalsRoutes } from "./routes/approvals";

const app = new Hono().route("/api", approvalsRoutes);
const PARENT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const KID = "NQ02 SXUJ Y9D0 UDSK L1J8 N1U4 69NB 69X4 KU3T";
const HEAD = 7_680_000;

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

const chainStub = (): ChainClient => ({
  getHeadHeight: async () => HEAD,
  getNetworkId: async () => 5,
  sendTransaction: async () => { throw new Error("nothing in this file may broadcast"); },
  getBalance: async () => 0,
});

const auth = () => ({ Authorization: `Bearer ${bearer}`, "content-type": "application/json" });

beforeEach(async () => {
  initTestDb();
  // Parent custody: the approve route answers 202 with a signing intent and leaves the card
  // pending, which is exactly the ordering this feature has to survive. It also means no
  // hot wallet key is needed to assert what an approval is WORTH.
  process.env.HATCH_CUSTODY = "parent";
  _setChainClient(chainStub());
  const f = repo.createFamily("Mom", PARENT);
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Sam", "🦖");
  wrepo.setChildAddress(kid.id, KID);
  kid = repo.getChild(kid.id)!;
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "phone", await sha256Hex(bearer));
});

afterEach(() => {
  delete process.env.HATCH_CUSTODY;
  _setChainClient(null);
});

function submittedChore(rewardLuna = 100_000) {
  const chore = repo.createChore(fam.id, kid.id, "Tidy your room", rewardLuna, "🧹", {});
  const approval = approvalsRepo.openApproval(fam.id, kid.id, "chore", chore.id);
  return { chore, approval };
}

const approve = (id: string, body: Record<string, unknown> = {}) =>
  app.request(`http://hatch.test/api/approvals/${id}/approve`, {
    method: "POST", headers: auth(), body: JSON.stringify(body),
  });

/** What the grown-up is being asked to sign — the only place the amount is visible here. */
const signedValue = async (res: Response) =>
  ((await res.json()) as { signingIntent?: { valueLuna: number } }).signingIntent?.valueLuna;

// ---------------------------------------------------------------- the arithmetic, in isolation
test("a full share pays exactly what it pays today, and NULL means full", () => {
  expect(applyShare(100_000, null)).toBe(100_000);
  expect(applyShare(100_000, 10_000)).toBe(100_000);
});

test("a quarter share on a 100 NIM chore pays 25", () => {
  expect(applyShare(100_000, 2_500)).toBe(25_000);
});

test("floor DROPS the remainder rather than gaining it — a family never overpays", () => {
  // 3 luna at a third is 0.999...; rounding would pay 1 and invent a luna the job never
  // promised. Every one of these is strictly less than the true fraction.
  expect(applyShare(3, 3_333)).toBe(0);
  expect(applyShare(101, 5_000)).toBe(50);      // 50.5 -> 50
  expect(applyShare(99_999, 3_333)).toBe(33_329); // 33329.66... -> 33329
  // and it can never exceed the full price at any legal share
  for (const bps of [1, 2_500, 5_000, 9_999, 10_000]) {
    expect(applyShare(100_000, bps)).toBeLessThanOrEqual(100_000);
  }
});

// ------------------------------------------------------------------- the route, end to end
test("a quarter share prices the transaction the grown-up is asked to sign", async () => {
  const { approval } = submittedChore(100_000);
  const res = await approve(approval.id, { shareBps: 2_500, note: "bed's still messy" });
  expect(res.status).toBe(202);
  // THE ASSERTION THIS FILE EXISTS FOR: the mint runs before the decide, so this is what
  // proves the share reached the row before anything priced it.
  expect(await signedValue(res)).toBe(25_000);
  expect(approvalsRepo.getApproval(approval.id)!.share_bps).toBe(2_500);
});

test("no share at all is untouched — the full price, and share_bps stays NULL", async () => {
  const { approval } = submittedChore(100_000);
  const res = await approve(approval.id);
  expect(res.status).toBe(202);
  expect(await signedValue(res)).toBe(100_000);
  expect(approvalsRepo.getApproval(approval.id)!.share_bps).toBeNull();
});

test("a retry after a partial approve pays the SAME partial amount, never a second one", async () => {
  const { approval } = submittedChore(100_000);
  expect(await signedValue(await approve(approval.id, { shareBps: 5_000, note: "half done" }))).toBe(50_000);

  // The parent abandons the wallet redirect and taps again, this time at full. The card is
  // still pending, so nothing stops the tap — but the price was bound by the first one.
  const again = await approve(approval.id, { shareBps: 10_000, note: "changed my mind" });
  expect(again.status).toBe(409);
  const body = await again.json() as { error: string; shareBps: number };
  expect(body.error).toBe("share_already_set");
  expect(body.shareBps).toBe(5_000);
  expect(approvalsRepo.getApproval(approval.id)!.share_bps).toBe(5_000);
});

// ------------------------------------------------------------------------------- refusals
test("a share on a SEND is a 400, not a silently ignored field", async () => {
  const req = wrepo.createSendRequest(fam.id, kid.id, 5_000, null, PARENT);
  const approval = approvalsRepo.openApproval(fam.id, kid.id, "send", req.id);
  const res = await approve(approval.id, { shareBps: 5_000, note: "half" });
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe("share_not_allowed_for_subject");
  expect(approvalsRepo.getApproval(approval.id)!.share_bps).toBeNull();
});

test("a partial approve with no note is a 400 — a smaller number owes the kid a reason", async () => {
  const { approval } = submittedChore();
  const res = await approve(approval.id, { shareBps: 5_000 });
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe("share_needs_note");
  expect(approvalsRepo.getApproval(approval.id)!.share_bps).toBeNull();
  // ...but a FULL share needs no note, because it is not a judgement about the work.
  expect((await approve(approval.id, { shareBps: 10_000 })).status).toBe(202);
});

test("zero is refused: reject is the only way to say no", async () => {
  const { chore, approval } = submittedChore();
  const res = await approve(approval.id, { shareBps: 0, note: "nothing done" });
  expect(res.status).toBe(400);
  expect((await res.json() as { error: string }).error).toBe("share_zero_use_reject");
  // The point of the refusal: approving at zero would CLOSE the chore at no pay, where a
  // reject leaves it open for the kid to try again.
  expect(repo.getChore(chore.id)!.status).not.toBe("approved");
});

test("a non-integer or out-of-range share is a 400", async () => {
  const { approval } = submittedChore();
  // Deliberately mixed types: the route takes a parsed JSON body, so a string or a bool is a
  // shape a real client can send and the guard has to reject it rather than coerce it.
  const bad: unknown[] = [2_500.5, 10_001, "2500", true];
  for (const v of bad) {
    const res = await approve(approval.id, { shareBps: v, note: "x" });
    expect(res.status).toBe(400);
  }
  expect(approvalsRepo.getApproval(approval.id)!.share_bps).toBeNull();
});

// -------------------------------------------------------------------------------- reopen
test("a reopened approval comes back with NO share — it is a fresh decision, not a replay", () => {
  const { approval } = submittedChore();
  expect(approvalsRepo.setApprovalShare(approval.id, 2_500)).toBe(true);
  approvalsRepo.decideApproval(approval.id, "approved", "remote", null, "most of it");
  expect(approvalsRepo.getApproval(approval.id)!.share_bps).toBe(2_500);

  expect(approvalsRepo.reopenApproval(approval.id)).toBe(true);
  const back = approvalsRepo.getApproval(approval.id)!;
  expect(back.status).toBe("pending");
  // If this leaked, a reopened card would be re-priced at the abandoned share while the
  // parent believes they are approving it whole.
  expect(back.share_bps).toBeNull();
});

test("setApprovalShare refuses a second share, and refuses one on a decided row", () => {
  const { approval } = submittedChore();
  expect(approvalsRepo.setApprovalShare(approval.id, 2_500)).toBe(true);
  expect(approvalsRepo.setApprovalShare(approval.id, 10_000)).toBe(false);
  expect(approvalsRepo.getApproval(approval.id)!.share_bps).toBe(2_500);

  const other = submittedChore().approval;
  approvalsRepo.decideApproval(other.id, "approved", "remote", null, null);
  expect(approvalsRepo.setApprovalShare(other.id, 5_000)).toBe(false);
  expect(approvalsRepo.getApproval(other.id)!.share_bps).toBeNull();
});
