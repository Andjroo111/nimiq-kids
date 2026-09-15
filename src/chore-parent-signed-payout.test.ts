// Approving a chore on a parent-custody instance issues a signing intent instead of paying.
//
// This is the behaviour change at the heart of NONCUSTODIAL-PLAN Phase 3: the approval stops
// being a boolean the server checks before signing for itself and becomes a transaction
// waiting for a human to sign in their own wallet. The two things worth pinning are that the
// chore is NOT marked approved before money moves, and that the whole branch is invisible
// unless `HATCH_CUSTODY=parent` — which is unset on every instance today.
//
// Hermetic: in-memory DB, stubbed head height, no network. Nothing is ever broadcast.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import * as approvalsRepo from "./repo-approvals";
import { newToken, sha256Hex } from "./auth";
import { _setChainClient, type ChainClient } from "./nimiq/client";
import { getPayoutIntent } from "./wallet/payout-intent";
import { chores as choresRoutes } from "./routes/chores";

const app = new Hono().route("/api", choresRoutes);
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

const newChore = () => repo.createChore(fam.id, kid.id, "Feed the cat", 5_000, "🐈", {});

const approve = (choreId: string) =>
  app.request(`http://hatch.test/api/chores/${choreId}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: "{}",
  });

test("approving hands back a signing intent, and the chore is NOT marked approved", async () => {
  const chore = newChore();
  const res = await approve(chore.id);
  // 202, not 200: accepted, not done. Nothing has moved yet and the parent's wallet may be a
  // full-page redirect away.
  expect(res.status).toBe(202);
  const body = await res.json() as { chore: repo.Chore; signingIntent: Record<string, unknown> };

  expect(body.signingIntent).toMatchObject({
    intentId: `chore:${chore.id}`,
    sender: PARENT,
    recipient: KID,
    valueLuna: 5_000,
    feeLuna: 0,
    data: "Feed the cat",
    validityStartHeight: HEAD,
  });
  // The board must not say paid while nothing has moved. That exact bug was already paid for
  // once on the server-signed path.
  expect(body.chore.status).not.toBe("approved");
  expect(repo.getChore(chore.id)!.status).not.toBe("approved");
  // And no money row exists, because no money moved.
  expect(wrepo.walletEventForPayoutRef(`chore:${chore.id}`)).toBeNull();
});

test("a second tap resumes the SAME intent rather than opening a second popup", async () => {
  const chore = newChore();
  const first = await approve(chore.id);
  expect(first.status).toBe(202);

  // A different head height on the retry, so a re-mint would be visible.
  _setChainClient(chainStub(HEAD + 500));
  const again = await approve(chore.id);
  expect(again.status).toBe(409);
  const body = await again.json() as { error: string; signingIntent: { validityStartHeight: number } };
  expect(body.error).toBe("already_claimed");
  // Same pinned height: two signable transactions for one chore would dedupe against nothing
  // on chain, which is how a kid gets paid twice.
  expect(body.signingIntent.validityStartHeight).toBe(HEAD);
});

test("a kid with no address is refused by name, and the approval goes back in the queue", async () => {
  const bare = repo.createChild(fam.id, "Noa", "🐙");
  const chore = repo.createChore(fam.id, bare.id, "Wash up", 1_000, "🧼", {});
  const res = await approve(chore.id);
  expect(res.status).toBe(400);
  // Named, so the parent app can offer the address-registration flow instead of a shrug.
  expect(await res.json()).toEqual({ error: "no_kid_address" });
  // Left decided, the parent could never approve it again and the chore would be stranded.
  const pending = approvalsRepo.pendingApprovalFor("chore", chore.id);
  expect(pending).not.toBeNull();
});

test("an unreachable node refuses BEFORE the approval is committed to", async () => {
  const chore = newChore();
  _setChainClient({
    ...chainStub(),
    getHeadHeight: async () => { throw new Error("rpc_unreachable"); },
  });
  const res = await approve(chore.id);
  expect(res.status).toBe(502);
  expect((await res.json() as { error: string }).error).toBe("chain_unreachable");
  // Nothing claimed and nothing decided: the retry starts completely clean.
  expect(getPayoutIntent(`chore:${chore.id}`)).toBeNull();
  expect(repo.getChore(chore.id)!.status).not.toBe("approved");
});

test("with HATCH_CUSTODY unset the old path runs, untouched", async () => {
  // The regression guard that matters most: every live instance is in this state, and this
  // branch must be completely invisible to them.
  delete process.env.HATCH_CUSTODY;
  const chore = newChore();
  const res = await approve(chore.id);
  expect(res.status).toBe(200);
  const body = await res.json() as { chore: repo.Chore; paidLuna: number; signingIntent?: unknown };
  expect(body.signingIntent).toBeUndefined();
  expect(body.paidLuna).toBe(5_000);
  expect(body.chore.status).toBe("approved");
  // SIM pays out of the instance's own ledger, so the row is written straight away.
  expect(wrepo.walletEventForPayoutRef(`chore:${chore.id}`)).not.toBeNull();
});

test("a zero-reward chore still just gets approved — there is nothing to sign", async () => {
  const chore = repo.createChore(fam.id, kid.id, "Say thank you", 0, "🙏", {});
  const res = await approve(chore.id);
  expect(res.status).toBe(200);
  expect(repo.getChore(chore.id)!.status).toBe("approved");
});
