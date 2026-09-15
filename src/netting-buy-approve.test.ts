// The netting loop end to end, through the real routes: a kid buys on a parent-custody
// instance, and the next chore approval is minted for the difference.
//
// This is the behaviour the engine exists for, and none of it is reachable unless
// `HATCH_CUSTODY=parent` — which is unset on every instance today.
//
// Hermetic: in-memory DB, stubbed chain (head height + balance), nothing is ever broadcast.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import * as stickersRepo from "./repo-stickers";
import { newToken, sha256Hex } from "./auth";
import { _setChainClient, type ChainClient } from "./nimiq/client";
import { outstandingDebtLuna, committedDebtLuna } from "./kid-netting";
import { chores as choresRoutes } from "./routes/chores";
import { storeRoutes } from "./routes/store";
import { walletRoutes } from "./routes/wallet";
import { approvalsRoutes } from "./routes/approvals";

const app = new Hono()
  .route("/api", choresRoutes)
  .route("/api", storeRoutes)
  .route("/api", walletRoutes)
  .route("/api", approvalsRoutes);

const PARENT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const KID = "NQ02 SXUJ Y9D0 UDSK L1J8 N1U4 69NB 69X4 KU3T";
const HEAD = 7_680_000;
/**
 * What the kid holds, for the whole file — asserted through BOTH balance sources.
 *
 * `SIM` is decided when `nimiq/client` is first imported, so a test file cannot choose which
 * of the two `kidChainBalanceLuna` will read. Rather than fight that, the stubbed chain and
 * the seeded ledger are given the same number, and every assertion below is then true in
 * either world. The netting arithmetic is identical on both sides of that branch, which is
 * the point of subtracting the debt inside `kidBalanceLuna` rather than per screen.
 */
const ON_CHAIN = 500_000;

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

const chainStub = (): ChainClient => ({
  getHeadHeight: async () => HEAD,
  getNetworkId: async () => 5,
  sendTransaction: async () => { throw new Error("nothing in this file may broadcast"); },
  getBalance: async () => ON_CHAIN,
});

beforeEach(async () => {
  initTestDb();
  process.env.HATCH_CUSTODY = "parent";
  _setChainClient(chainStub());
  const f = repo.createFamily("Mom", PARENT);
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Sam", "🦖");
  // The household a parent-custody instance actually has: the address came out of the
  // parent's own wallet, so no key for it exists here and nothing can be signed for it.
  wrepo.setParentOwnedAddress(kid.id, KID, { message: "m", publicKeyHex: "00", signatureHex: "00" });
  kid = repo.getChild(kid.id)!;
  // The ledger half of the balance (see ON_CHAIN). A gift, not an earn: an earn would be a
  // payout with a ref and this file is about what happens to the NEXT one.
  wrepo.addWalletEvent({
    familyId: fam.id, childId: kid.id, kind: "deposit", valueLuna: ON_CHAIN,
    txHash: "seed", message: "Birthday",
  });
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "phone", await sha256Hex(bearer));
  // The debt in this file is run up on screen time, which is only stocked for a household
  // with a tablet to spend the minutes on (#306).
  lockRepo.createDevice(fam.id, "Sam's tablet", "hash-netting-buy", null);
});

afterEach(() => {
  delete process.env.HATCH_CUSTODY;
  _setChainClient(null);
});

/** Built per call, never hoisted: `bearer` is assigned in beforeEach, so a module-level
 *  header object would carry "Bearer undefined" into every request. */
const auth = () => ({ Authorization: `Bearer ${bearer}`, "content-type": "application/json" });

const buy = (itemId: string) =>
  app.request(`http://hatch.test/api/kids/${kid.id}/buy`, {
    method: "POST", headers: auth(), body: JSON.stringify({ itemId }),
  });

const approve = (choreId: string) =>
  app.request(`http://hatch.test/api/chores/${choreId}/approve`, {
    method: "POST", headers: auth(), body: "{}",
  });

/** Every ledger row except the seeded gift: what this file asserts did NOT get written. */
const moneyMoved = () => wrepo.listWalletEvents(kid.id, 50).filter((e) => e.tx_hash !== "seed");

const walletRead = async () => {
  const res = await app.request(`http://hatch.test/api/kids/${kid.id}/wallet`, { headers: auth() });
  return await res.json() as { balanceLuna: number; deferredSpentLuna: number };
};

/** A shelf item this family owns, priced in luna. `pack` and `timer_style` need catalogue
 *  art, so the two kinds a parent can actually create are the ones used here. */
function shelfItem(kind: "coupon" | "screen_time", priceLuna: number) {
  const cat = stickersRepo.createCategory("Prizes", null, fam.id);
  return stickersRepo.createStoreItem({
    categoryId: cat.id, kind, title: "Ice cream", priceLuna,
    payload: kind === "screen_time" ? { minutes: 30 } : {}, familyId: fam.id,
  });
}

test("a buy on a parent-custody instance defers instead of being refused", async () => {
  const item = shelfItem("screen_time", 80_000);
  const res = await buy(item.id);
  expect(res.status).toBe(200);
  const body = await res.json() as { deferred: boolean; event: unknown; balanceLuna: number };

  // Instant, unsigned, and nothing moved: there is no event because there is no transaction.
  expect(body.deferred).toBe(true);
  expect(body.event).toBeNull();
  expect(moneyMoved()).toHaveLength(0);

  // Rule 2: the shown balance drops anyway.
  expect(body.balanceLuna).toBe(ON_CHAIN - 80_000);
  const w = await walletRead();
  expect(w).toMatchObject({ balanceLuna: ON_CHAIN - 80_000, deferredSpentLuna: 80_000 });
});

test("the next approval is minted for the difference, and one signature covers both", async () => {
  const item = shelfItem("screen_time", 80_000);
  expect((await buy(item.id)).status).toBe(200);

  const chore = repo.createChore(fam.id, kid.id, "Made bed", 200_000, "🛏️", {});
  const res = await approve(chore.id);
  expect(res.status).toBe(202);
  const body = await res.json() as { signingIntent: Record<string, number | string> };

  // ONE popup, for 200,000 earned minus 80,000 already spent. The gross rides along so the
  // parent's screen can explain the number rather than contradict the board.
  expect(body.signingIntent).toMatchObject({
    valueLuna: 120_000, nettedLuna: 80_000, grossLuna: 200_000, recipient: KID, sender: PARENT,
  });
  // Pinned, not recomputed: the parent signs this split and no later purchase may change it.
  expect(wrepo.getPayoutAttempt(`chore:${chore.id}`)).toMatchObject({
    value_luna: 120_000, netted_luna: 80_000,
  });
  // And the debt is NOT cleared yet — an intent that expires unsigned must leave it standing.
  expect(outstandingDebtLuna(kid.id)).toBe(80_000);
});

test("two approvals in a row do not both eat the same debt", async () => {
  const item = shelfItem("screen_time", 80_000);
  expect((await buy(item.id)).status).toBe(200);

  const a = repo.createChore(fam.id, kid.id, "Made bed", 200_000, "🛏️", {});
  const b = repo.createChore(fam.id, kid.id, "Fed cat", 200_000, "🐈", {});
  const first = await (await approve(a.id)).json() as { signingIntent: { valueLuna: number } };
  const second = await (await approve(b.id)).json() as { signingIntent: { valueLuna: number } };

  expect(first.signingIntent.valueLuna).toBe(120_000);
  // The second one nets nothing: the first intent has that debt reserved. Netting it twice
  // would be 160,000 subtracted for one 80,000 purchase.
  expect(second.signingIntent.valueLuna).toBe(200_000);
});

test("a debt bigger than the reward eats the payout whole: no signature, chore approved", async () => {
  const item = shelfItem("screen_time", 300_000);
  expect((await buy(item.id)).status).toBe(200);

  const chore = repo.createChore(fam.id, kid.id, "Made bed", 200_000, "🛏️", {});
  const res = await approve(chore.id);

  // 200, not 202: there is nothing for a wallet to do, so leaving the chore pending would
  // strand it waiting on an event that is never coming.
  expect(res.status).toBe(200);
  const body = await res.json() as { chore: repo.Chore; settled: { settleLuna: number; grossLuna: number } };
  expect(body.settled).toEqual({ settleLuna: 200_000, grossLuna: 200_000 });
  expect(body.chore.status).toBe("approved");
  expect(repo.getChore(chore.id)!.status).toBe("approved");

  // The kid is 200,000 better off, and it shows: 300,000 owed became 100,000.
  expect(outstandingDebtLuna(kid.id)).toBe(100_000);
  expect((await walletRead()).balanceLuna).toBe(ON_CHAIN - 100_000);

  // Re-approving must not clear that debt a second time. There is no ledger row to dedupe
  // against here — the settlement row is the record.
  const again = await approve(chore.id);
  expect(again.status).toBe(409);
  expect(outstandingDebtLuna(kid.id)).toBe(100_000);
});

test("a kid cannot commit more than is at their address", async () => {
  const item = shelfItem("screen_time", 300_000);
  expect((await buy(item.id)).status).toBe(200);
  const dear = shelfItem("screen_time", 300_000);
  const res = await buy(dear.id);
  // Rule 3. 500,000 on chain, 300,000 already committed: the second one is refused rather
  // than carried, so every luna the app shows is genuinely sitting at the kid's address.
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "insufficient_funds" });
  expect(outstandingDebtLuna(kid.id)).toBe(300_000);
});

test("a coupon's debt is held out of netting until the parent honours it", async () => {
  const item = shelfItem("coupon", 80_000);
  const res = await buy(item.id);
  const bought = await res.json() as { approvalId: string; purchaseId: string };

  // It costs the kid immediately (rule 2)...
  expect(outstandingDebtLuna(kid.id)).toBe(80_000);
  // ...but a payout must not absorb it while the parent can still refuse it: a settlement is
  // not reversible, and undoing one would show the kid NIM that is not at their address.
  expect(committedDebtLuna(kid.id)).toBe(0);

  const chore = repo.createChore(fam.id, kid.id, "Made bed", 200_000, "🛏️", {});
  const approved = await (await approve(chore.id)).json() as { signingIntent: { valueLuna: number } };
  expect(approved.signingIntent.valueLuna).toBe(200_000);

  // The parent hands the ice cream over. Now it can never come back, so it can be netted.
  const decide = await app.request(`http://hatch.test/api/approvals/${bought.approvalId}/approve`, {
    method: "POST", headers: auth(), body: "{}",
  });
  expect(decide.status).toBe(200);
  expect(committedDebtLuna(kid.id)).toBe(80_000);
});

test("a refused coupon gives the money back by reversing the debit, not by sending NIM", async () => {
  const item = shelfItem("coupon", 80_000);
  const bought = await (await buy(item.id)).json() as { approvalId: string; purchaseId: string };
  expect((await walletRead()).balanceLuna).toBe(ON_CHAIN - 80_000);

  const decide = await app.request(`http://hatch.test/api/approvals/${bought.approvalId}/reject`, {
    method: "POST", headers: auth(), body: "{}",
  });
  expect(decide.status).toBe(200);

  // The debt is gone and the balance is whole again — with NO transaction, which is the only
  // possible answer on an instance holding no key. The old path would have tried to pay the
  // kid out of a hot wallet that does not exist here.
  expect(outstandingDebtLuna(kid.id)).toBe(0);
  expect(moneyMoved()).toHaveLength(0);
  expect((await walletRead()).balanceLuna).toBe(ON_CHAIN);
  expect(stickersRepo.getPurchase(bought.purchaseId)!.status).toBe("refunded");
});
