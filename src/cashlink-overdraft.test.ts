// A kid can never send more than they have, however the approvals are ordered.
//
// Reproduces the overdraft found by the wallet audit on 2026-07-31: a kid holding 75,000
// luna queued two 50,000 Cashlink sends. Each was affordable when it was made, so both were
// accepted (202). The parent then approved both — and both went through, minting two
// spendable Cashlinks worth 100,000 luna against a 75,000 balance and leaving the ledger at
// -25,000. executeSendRequest never re-checked the balance between queueing and minting.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as approvalsRepo from "./repo-approvals";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { walletRoutes } from "./routes/wallet";
import { approvalsRoutes } from "./routes/approvals";

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

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ada", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
  // Opening balance: 75,000 luna.
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 75_000 });
});

const auth = () => ({ Authorization: `Bearer ${bearer}` });

async function queueSend(valueLuna: number): Promise<string> {
  const res = await post(`/api/kids/${kid.id}/send`, { cashlink: { valueLuna } });
  expect(res.status).toBe(202);
  return (await res.json()).approvalId as string;
}

test("two individually-affordable Cashlink sends cannot both be approved", async () => {
  const first = await queueSend(50_000);
  const second = await queueSend(50_000);

  const a = await post(`/api/approvals/${first}/approve`, {}, auth());
  expect(a.status).toBe(200);

  // 25,000 left. The second was affordable when queued and is not any more.
  const b = await post(`/api/approvals/${second}/approve`, {}, auth());
  expect(b.status).toBe(400);
  expect((await b.json()).error).toBe("insufficient_funds");

  expect(wrepo.spendableFromLedger(kid.id)).toBe(25_000);
  expect(wrepo.spendableFromLedger(kid.id)).toBeGreaterThanOrEqual(0);
  // Exactly one Cashlink exists — the audit saw two, worth 100,000 against a 75,000 balance.
  expect(repo.listCashlinksForChild(kid.id).length).toBe(1);
});

test("a refused approval stays PENDING, so it works once the kid earns the rest", async () => {
  const first = await queueSend(50_000);
  const second = await queueSend(50_000);
  await post(`/api/approvals/${first}/approve`, {}, auth());

  const blocked = await post(`/api/approvals/${second}/approve`, {}, auth());
  expect(blocked.status).toBe(400);
  // Not consumed — nothing half-applied, same contract as the payout ceiling.
  expect(approvalsRepo.getApproval(second)!.status).toBe("pending");

  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 30_000 });
  const retry = await post(`/api/approvals/${second}/approve`, {}, auth());
  expect(retry.status).toBe(200);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(5_000);
});

test("the whole balance in one send is still allowed", async () => {
  const only = await queueSend(75_000);
  const res = await post(`/api/approvals/${only}/approve`, {}, auth());
  expect(res.status).toBe(200);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(0);
});

// A send whose funding broadcast failed must not be swallowed. Verified on the live
// testnet 2026-07-31: two concurrent approvals both passed the balance re-check, one
// funding tx never executed, and its approval was left 'approved' with the request
// still 'pending' — invisible to every screen and un-retryable (re-approve -> 409).
test("a send approval that failed to pay is put back in the queue", async () => {
  const only = await queueSend(75_000);
  await post(`/api/approvals/${only}/approve`, {}, auth());
  expect(approvalsRepo.getApproval(only)!.status).toBe("approved");
  expect(approvalsRepo.listApprovals(fam.id, "pending").length).toBe(0);

  expect(approvalsRepo.reopenApproval(only)).toBe(true);
  const back = approvalsRepo.getApproval(only)!;
  expect(back.status).toBe("pending");
  expect(back.decided_at).toBeNull();
  // The parent's queue shows it again, which is the whole point.
  expect(approvalsRepo.listApprovals(fam.id, "pending").map((a) => a.id)).toContain(only);
});

test("reopenApproval only touches an approved row", async () => {
  const only = await queueSend(75_000);
  expect(approvalsRepo.reopenApproval(only)).toBe(false); // still pending
  await post(`/api/approvals/${only}/approve`, {}, auth());
  expect(approvalsRepo.reopenApproval(only)).toBe(true);
  expect(approvalsRepo.reopenApproval(only)).toBe(false); // no double-reopen
});
