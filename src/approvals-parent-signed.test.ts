// Approving from the QUEUE on a parent-custody instance issues a signing intent.
//
// `src/chore-parent-signed-payout.test.ts` pins the same behaviour on /api/chores/:id/approve,
// the route a parent hits by tapping a job on the board. This file is the other one, and it is
// the one the parent app actually calls: the approvals feed, POST /api/approvals/:id/approve,
// which is also where a kid's tablet submits its PIN. Until this branch existed that route had
// no parent-signed path at all, so on a flipped instance every approval in the queue reached
// `payKidEarn` and asked a server with no key to sign.
//
// The assertion that matters most is that the APPROVAL IS STILL PENDING after a 202. The card
// is the parent's only way back to a signature a mobile wallet redirect interrupted, and a
// queue that empties on tap takes it away.
//
// Hermetic: in-memory DB, stubbed head height, no network. Nothing is ever broadcast.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import * as approvalsRepo from "./repo-approvals";
import * as stickersRepo from "./repo-stickers";
import { newToken, sha256Hex } from "./auth";
import { _setChainClient, type ChainClient } from "./nimiq/client";
import { recordDeferredSpend } from "./kid-netting";
import { approvalsRoutes } from "./routes/approvals";
import { chores as choresRoutes } from "./routes/chores";

const app = new Hono().route("/api", approvalsRoutes).route("/api", choresRoutes);
const PARENT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const KID = "NQ02 SXUJ Y9D0 UDSK L1J8 N1U4 69NB 69X4 KU3T";
const HEAD = 7_680_000;

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

const chainStub = (headHeight = HEAD): ChainClient => ({
  getHeadHeight: async () => headHeight,
  getNetworkId: async () => 5,
  sendTransaction: async () => { throw new Error("nothing in this file may broadcast"); },
  getBalance: async () => 0,
});

// A FUNCTION, not a module-level const. Built at module scope this would carry
// "Bearer undefined" — beforeEach has not run when the module is evaluated — and every
// parent-authed request would 401 while the unauthed ones passed, which reads exactly like
// an auth bug in the route.
const auth = () => ({ Authorization: `Bearer ${bearer}`, "content-type": "application/json" });

beforeEach(async () => {
  initTestDb();
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
  _setChainClient(null); // never leak the stub into another file's chain client
});

/** A chore the kid has submitted: a real pending approval, exactly as the queue holds one. */
function submittedChore(rewardLuna = 5_000) {
  const chore = repo.createChore(fam.id, kid.id, "Feed the cat", rewardLuna, "🐈", {});
  const approval = approvalsRepo.openApproval(fam.id, kid.id, "chore", chore.id);
  return { chore, approval };
}

const approve = (approvalId: string) =>
  app.request(`http://hatch.test/api/approvals/${approvalId}/approve`, {
    method: "POST", headers: auth(), body: "{}",
  });

test("approving from the queue hands back a signing intent and leaves the card in it", async () => {
  const { chore, approval } = submittedChore();
  const res = await approve(approval.id);
  expect(res.status).toBe(202);
  const body = await res.json() as { signingIntent: Record<string, unknown> };
  expect(body.signingIntent).toMatchObject({
    intentId: `chore:${chore.id}`,
    sender: PARENT,
    recipient: KID,
    valueLuna: 5_000,
    grossLuna: 5_000,
    nettedLuna: 0,
    data: "Feed the cat",
    validityStartHeight: HEAD,
  });
  // THE CARD STAYS. A mobile wallet is a full-page redirect away and the Hub's result does not
  // survive the trip, so the queue is the only way back to a signature that was interrupted.
  expect(approvalsRepo.getApproval(approval.id)!.status).toBe("pending");
  // And nothing else moved: no chore, no money.
  expect(repo.getChore(chore.id)!.status).not.toBe("approved");
  expect(wrepo.walletEventForPayoutRef(`chore:${chore.id}`)).toBeNull();
});

test("a second tap resumes the SAME bytes rather than opening a second popup", async () => {
  const { approval } = submittedChore();
  expect((await approve(approval.id)).status).toBe(202);

  // A different head height on the retry, so a re-mint would be visible.
  _setChainClient(chainStub(HEAD + 500));
  const again = await approve(approval.id);
  expect(again.status).toBe(409);
  const body = await again.json() as { error: string; signingIntent: { validityStartHeight: number } };
  expect(body.error).toBe("already_claimed");
  // Same pinned height: two signable transactions for one chore dedupe against nothing on
  // chain, which is how a kid gets paid twice.
  expect(body.signingIntent.validityStartHeight).toBe(HEAD);
});

test("a kid with no address is refused by name, and the card stays in the queue", async () => {
  const bare = repo.createChild(fam.id, "Noa", "🐙");
  const chore = repo.createChore(fam.id, bare.id, "Wash up", 1_000, "🧼", {});
  const approval = approvalsRepo.openApproval(fam.id, bare.id, "chore", chore.id);
  const res = await approve(approval.id);
  expect(res.status).toBe(400);
  // Named, so the parent app can offer the address-registration flow instead of a shrug.
  expect(await res.json()).toEqual({ error: "no_kid_address" });
  expect(approvalsRepo.getApproval(approval.id)!.status).toBe("pending");
});

test("an unreachable node refuses before anything is claimed", async () => {
  const { chore, approval } = submittedChore();
  _setChainClient({
    ...chainStub(),
    getHeadHeight: async () => { throw new Error("rpc_unreachable"); },
  });
  const res = await approve(approval.id);
  expect(res.status).toBe(502);
  expect((await res.json() as { error: string }).error).toBe("chain_unreachable");
  expect(wrepo.getPayoutAttempt(`chore:${chore.id}`)).toBeNull();
  expect(approvalsRepo.getApproval(approval.id)!.status).toBe("pending");
});

test("a reward the kid's debt eats WHOLE settles at once, with nothing to sign", async () => {
  // Rule 2 beats rule 1 at chainLuna == 0 (docs/NEXT-SESSION.md). No wallet is involved, the
  // debt it cleared IS the payment, and leaving the card pending would strand it against a
  // signature that is never coming.
  recordDeferredSpend({
    familyId: fam.id, childId: kid.id, valueLuna: 9_000,
    chainBalanceLuna: 1_000_000, message: "Ice cream", refundable: false,
  });
  const { chore, approval } = submittedChore(5_000);
  const res = await approve(approval.id);
  expect(res.status).toBe(200);
  const body = await res.json() as { settled: { settleLuna: number; grossLuna: number }; signingIntent?: unknown };
  expect(body.signingIntent).toBeUndefined();
  expect(body.settled).toEqual({ settleLuna: 5_000, grossLuna: 5_000 });
  expect(repo.getChore(chore.id)!.status).toBe("approved");
  expect(approvalsRepo.getApproval(approval.id)!.status).toBe("approved");
  // No transaction, and that is the point: two addresses of the same wallet paying each other
  // 5,000 in the same second, for a net movement of nothing.
  expect(wrepo.walletEventForPayoutRef(`chore:${chore.id}`)).toBeNull();
});

test("a zero-reward chore settles the old way — there is nothing to sign", async () => {
  const { chore, approval } = submittedChore(0);
  const res = await approve(approval.id);
  expect(res.status).toBe(200);
  expect(repo.getChore(chore.id)!.status).toBe("approved");
  expect(approvalsRepo.getApproval(approval.id)!.status).toBe("approved");
});

test("a coupon is untouched by this branch: it moves the kid's own money, not the family's", async () => {
  // The subject filter is not a convenience. `send`, `stake`, `unstake` and `coupon` are signed
  // by the kid's key or move nothing at all, so routing them through a parent's wallet would be
  // asking the wrong person for the wrong signature.
  const cat = stickersRepo.createCategory("Prizes", null, fam.id);
  const item = stickersRepo.createStoreItem({
    categoryId: cat.id, kind: "coupon", title: "Ice cream", priceLuna: 1_000,
    payload: {}, familyId: fam.id,
  });
  const purchase = stickersRepo.createPurchase(fam.id, kid.id, item, "pending_parent");
  const approval = approvalsRepo.openApproval(fam.id, kid.id, "coupon", purchase.id);
  const res = await approve(approval.id);
  expect(res.status).toBe(200);
  expect((await res.json() as { signingIntent?: unknown }).signingIntent).toBeUndefined();
  expect(stickersRepo.getPurchase(purchase.id)!.status).toBe("fulfilled");
});

test("with HATCH_CUSTODY unset the old path runs, untouched", async () => {
  // The regression guard that matters most: every live instance is in this state, and this
  // branch must be completely invisible to them.
  delete process.env.HATCH_CUSTODY;
  const { chore, approval } = submittedChore();
  const res = await approve(approval.id);
  expect(res.status).toBe(200);
  const body = await res.json() as { paidLuna: number; signingIntent?: unknown };
  expect(body.signingIntent).toBeUndefined();
  expect(body.paidLuna).toBe(5_000);
  expect(repo.getChore(chore.id)!.status).toBe("approved");
  // SIM pays out of the instance's own ledger, so the row is written straight away.
  expect(wrepo.walletEventForPayoutRef(`chore:${chore.id}`)).not.toBeNull();
});
