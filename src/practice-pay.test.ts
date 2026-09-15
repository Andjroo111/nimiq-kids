// A practice pays NIM, through the parent's queue like everything else that pays.
//
// The behaviour worth pinning is all about WHICH THING is the subject. A practice is a
// standing arrangement; a DAY of it is the thing that happened. Every guarantee below falls
// out of that choice: one approval per day, one payout ref per day, a week of piano paid a
// week's worth, and a second tap on today buying nothing.
//
// Hermetic: in-memory DB, Hono app.request(), nothing broadcast. The parent-custody half
// stubs the chain, because minting an intent reads the head height.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as practices from "./repo-practices";
import * as approvalsRepo from "./repo-approvals";
import * as lockRepo from "./repo-lock";
import * as wrepo from "./repo-wallet";
import * as routines from "./repo-routines";
import { mondayOf } from "./days";
import { hashPin, newToken, sha256Hex } from "./auth";
import { _setChainClient, type ChainClient } from "./nimiq/client";
import { settlePayoutSubject } from "./wallet/payout-subject";
import { practicesRoutes } from "./routes/practices";
import { approvalsRoutes } from "./routes/approvals";

const app = new Hono()
  .route("/api", practicesRoutes)
  .route("/api", approvalsRoutes);

const PARENT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const KID = "NQ02 SXUJ Y9D0 UDSK L1J8 N1U4 69NB 69X4 KU3T";
const HEAD = 7_680_000;
const REWARD = 100_000; // 1 NIM a day

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

/** Built per call, never hoisted: `bearer` is assigned in beforeEach, so a module-level
 *  header object would carry "Bearer undefined" into every request. */
const auth = () => ({ Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" });

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(`http://hatch.test${path}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

const put = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(`http://hatch.test${path}`, {
    method: "PUT", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", PARENT);
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ivy", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});

afterEach(() => {
  delete process.env.HATCH_CUSTODY;
  _setChainClient(null);
});

const today = () => routines.localDay(fam.tz);
const makePractice = (rewardLuna: number) =>
  practices.createPractice(fam.id, kid.id, "Piano", { targetPerWeek: 4, rewardLuna });
const logToday = (practiceId: string) => post(`/api/practices/${practiceId}/session`);
const pendingFor = (sessionId: string) => approvalsRepo.pendingApprovalFor("practice_session", sessionId);
const earns = () => wrepo.listWalletEvents(kid.id, 50).filter((e) => e.kind === "earn");

// ---- the day is the subject ----------------------------------------------------

test("logging a paid practice opens ONE approval, for the day", async () => {
  const p = makePractice(REWARD);
  const res = await logToday(p.id);
  expect(res.status).toBe(201);
  const body = await res.json() as { session: { id: string }; practice: { payState: string } };

  const approval = pendingFor(body.session.id)!;
  expect(approval).not.toBeNull();
  expect(approval.subject_kind).toBe("practice_session");
  expect(approval.child_id).toBe(kid.id);
  expect(approvalsRepo.listApprovals(fam.id, "pending")).toHaveLength(1);
  // The card the kid is looking at says so without a second request.
  expect(body.practice.payState).toBe("waiting");
});

test("tapping today again neither logs a second day nor opens a second approval", async () => {
  const p = makePractice(REWARD);
  const first = await (await logToday(p.id)).json() as { session: { id: string } };
  const second = await (await logToday(p.id)).json() as { session: { id: string } };

  expect(second.session.id).toBe(first.session.id);
  expect(approvalsRepo.listApprovals(fam.id)).toHaveLength(1);
  expect(practices.weekCount(p.id, mondayOf(today()))).toBe(1);
});

test("a practice worth nothing opens nothing, exactly as before", async () => {
  const p = makePractice(0);
  const body = await (await logToday(p.id)).json() as {
    session: { id: string }; practice: { payState: string | null };
  };
  expect(pendingFor(body.session.id)).toBeNull();
  expect(approvalsRepo.listApprovals(fam.id)).toHaveLength(0);
  // null, not "waiting": there is nobody to wait for, and the card must not draw one.
  expect(body.practice.payState).toBeNull();
});

test("a demo household logs the day and pays nothing", async () => {
  repo.updateFamilySettings(fam.id, { mode: "demo" });
  const p = makePractice(REWARD);
  const body = await (await logToday(p.id)).json() as { session: { id: string } };
  expect(pendingFor(body.session.id)).toBeNull();
});

// ---- the parent's yes is what pays ---------------------------------------------

test("approving pays the practice's reward once, with the practice's own words on it", async () => {
  const p = makePractice(REWARD);
  const { session } = await (await logToday(p.id)).json() as { session: { id: string } };
  const approvalId = pendingFor(session.id)!.id;

  const res = await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" });
  expect(res.status).toBe(200);
  expect((await res.json() as { paidLuna: number }).paidLuna).toBe(REWARD);

  expect(earns()).toHaveLength(1);
  expect(earns()[0]!.value_luna).toBe(REWARD);
  expect(earns()[0]!.message).toBe("Piano");
  expect(approvalsRepo.getApproval(approvalId)!.status).toBe("approved");

  // And the kid's card says so.
  const view = practices.practiceView(practices.getPractice(p.id)!, today());
  expect(view.payState).toBe("paid");
});

test("approving twice pays once", async () => {
  const p = makePractice(REWARD);
  const { session } = await (await logToday(p.id)).json() as { session: { id: string } };
  const approvalId = pendingFor(session.id)!.id;

  expect((await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" })).status).toBe(200);
  expect((await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" })).status).toBe(409);
  expect(earns()).toHaveLength(1);
});

test("each DAY is paid separately, and yesterday's payment does not cover today", async () => {
  const p = makePractice(REWARD);
  const yesterday = practices.logSession(p.id, kid.id, "2026-01-01");
  const a1 = approvalsRepo.openApproval(fam.id, kid.id, "practice_session", yesterday.id);
  expect((await post(`/api/approvals/${a1.id}/approve`, { pin: "1234" })).status).toBe(200);

  const { session } = await (await logToday(p.id)).json() as { session: { id: string } };
  const a2 = pendingFor(session.id)!;
  expect(a2.id).not.toBe(a1.id);
  expect((await post(`/api/approvals/${a2.id}/approve`, { pin: "1234" })).status).toBe(200);

  expect(earns()).toHaveLength(2);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(2 * REWARD);
});

// ---- declining ------------------------------------------------------------------

test("declining pays nothing and leaves the day counted", async () => {
  const p = makePractice(REWARD);
  const { session } = await (await logToday(p.id)).json() as { session: { id: string } };
  const approvalId = pendingFor(session.id)!.id;

  const res = await post(`/api/approvals/${approvalId}/reject`, { pin: "1234", note: "not today" });
  expect(res.status).toBe(200);

  expect(earns()).toHaveLength(0);
  // The day is the kid's own record of a habit they own; the parent decided the MONEY.
  expect(practices.getSession(p.id, today())).not.toBeNull();
  const view = practices.practiceView(practices.getPractice(p.id)!, today());
  expect(view.weekDone).toBe(1);
  expect(view.payState).toBe("declined");
});

test("a day already paid cannot then be declined", async () => {
  const p = makePractice(REWARD);
  const { session } = await (await logToday(p.id)).json() as { session: { id: string } };
  const approvalId = pendingFor(session.id)!.id;
  expect((await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" })).status).toBe(200);

  // Decided rows answer 409 anyway, so the guard is tested where it can actually bite: a
  // payout that landed and put its approval back in the queue.
  approvalsRepo.reopenApproval(approvalId);
  const res = await post(`/api/approvals/${approvalId}/reject`, { pin: "1234" });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: "already_paid" });
});

// ---- the price stops moving while a day waits on it -----------------------------

test("the reward cannot be changed while a day of it is waiting", async () => {
  const p = makePractice(REWARD);
  await logToday(p.id);

  const res = await put(`/api/practices/${p.id}`, { rewardLuna: 500_000 }, auth());
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: "day_awaiting_approval" });
  expect(practices.getPractice(p.id)!.reward_luna).toBe(REWARD);
});

test("everything else about the practice still saves while a day waits", async () => {
  const p = makePractice(REWARD);
  await logToday(p.id);
  const res = await put(`/api/practices/${p.id}`, { targetPerWeek: 6, rewardLuna: REWARD }, auth());
  expect(res.status).toBe(200);
  expect(practices.getPractice(p.id)!.target_per_week).toBe(6);
});

test("once the day is answered the price moves again", async () => {
  const p = makePractice(REWARD);
  const { session } = await (await logToday(p.id)).json() as { session: { id: string } };
  await post(`/api/approvals/${pendingFor(session.id)!.id}/reject`, { pin: "1234" });

  expect((await put(`/api/practices/${p.id}`, { rewardLuna: 500_000 }, auth())).status).toBe(200);
  expect(practices.getPractice(p.id)!.reward_luna).toBe(500_000);
});

test("a tablet with no parent proof cannot reprice a practice", async () => {
  const p = makePractice(REWARD);
  const res = await put(`/api/practices/${p.id}`, { rewardLuna: 900_000 });
  expect(res.status).toBe(401);
  expect(practices.getPractice(p.id)!.reward_luna).toBe(REWARD);
});

test("saving the same number back is not a change, so it needs neither", async () => {
  const p = makePractice(REWARD);
  await logToday(p.id);
  const res = await put(`/api/practices/${p.id}`, { title: "Piano scales", rewardLuna: REWARD });
  expect(res.status).toBe(200);
  expect(practices.getPractice(p.id)!.title).toBe("Piano scales");
});

// ---- parent custody: the same day, signed in the parent's own wallet -------------

function parentCustody() {
  process.env.HATCH_CUSTODY = "parent";
  _setChainClient({
    getHeadHeight: async () => HEAD,
    getNetworkId: async () => 5,
    sendTransaction: async () => { throw new Error("nothing in this file may broadcast"); },
    getBalance: async () => 5_000_000,
  } satisfies ChainClient);
  wrepo.setParentOwnedAddress(kid.id, KID, { message: "m", publicKeyHex: "00", signatureHex: "00" });
  kid = repo.getChild(kid.id)!;
}

test("under parent custody a practice day mints an intent and STAYS in the queue", async () => {
  parentCustody();
  const p = makePractice(REWARD);
  const { session } = await (await logToday(p.id)).json() as { session: { id: string } };
  const approvalId = pendingFor(session.id)!.id;

  const res = await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" });
  expect(res.status).toBe(202);
  const body = await res.json() as { signingIntent: { intentId: string; valueLuna: number; data: string } };

  // The bytes are for THIS day, at the practice's price, carrying the practice's words.
  expect(body.signingIntent.intentId).toBe(`practice_session:${session.id}`);
  expect(body.signingIntent.valueLuna).toBe(REWARD);
  expect(body.signingIntent.data).toBe("Piano");
  // Nothing moved, so nothing is decided. The card is still there to finish paying.
  expect(approvalsRepo.getApproval(approvalId)!.status).toBe("pending");
  expect(earns()).toHaveLength(0);
});

test("a second tap is handed the SAME bytes rather than a second payout", async () => {
  parentCustody();
  const p = makePractice(REWARD);
  const { session } = await (await logToday(p.id)).json() as { session: { id: string } };
  const approvalId = pendingFor(session.id)!.id;

  const first = await (await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" }))
    .json() as { signingIntent: { serializedTx?: string; intentId: string } };
  const again = await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" });
  expect(again.status).toBe(409);
  const body = await again.json() as { error: string; signingIntent: { intentId: string } };
  expect(body.error).toBe("already_claimed");
  expect(body.signingIntent.intentId).toBe(first.signingIntent.intentId);
});

test("settling the payout ref decides the day's approval", async () => {
  parentCustody();
  const p = makePractice(REWARD);
  const { session } = await (await logToday(p.id)).json() as { session: { id: string } };
  const approvalId = pendingFor(session.id)!.id;
  expect((await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" })).status).toBe(202);

  // What POST /api/payouts/broadcast calls once the signed bytes are on the wire.
  const settled = settlePayoutSubject(`practice_session:${session.id}`);
  expect(settled).toMatchObject({ kind: "practice_session", settled: true, approvalDecided: true });
  expect(approvalsRepo.getApproval(approvalId)!.status).toBe("approved");

  // Idempotent, because the relay is: a lost response must not double-decide anything.
  expect(settlePayoutSubject(`practice_session:${session.id}`).approvalDecided).toBe(false);
});

test("a ref naming a session this instance never wrote settles nothing", () => {
  expect(settlePayoutSubject("practice_session:not-a-session")).toMatchObject({
    kind: "practice_session", settled: false, approvalDecided: false,
  });
});
