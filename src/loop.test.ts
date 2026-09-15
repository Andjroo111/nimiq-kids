// Backend integration test for the core demo loop, no network: create -> approve(mint) -> settle.
// Exercises the REAL @nimiq/core keypair generation + the cashlink codec + repo settlement.
import { test, expect } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import { mintCashlink } from "./nimiq/cashlink";
import { decodeCashlinkPayload, payloadFromUrl } from "./nimiq/cashlink-codec";
import { CASHLINK_BASE, getNimiq } from "./nimiq/client";
import { SimProvider } from "./wallet/sim-provider";

test("approve mints a real-format cashlink whose key rebuilds the funded address; settle credits the kid", async () => {
  initTestDb();
  const provider = new SimProvider();

  const fam = repo.createFamily("Mom", await provider.getAddress());
  const sam = repo.createChild(fam.id, "Sam", "🦖");
  const chore = repo.createChore(fam.id, sam.id, "Empty the dishwasher", 500_000, "🧽");

  // approve -> mint
  const mint = await mintCashlink(provider, chore.reward_luna, `nimiq.kids: ${chore.title}`);
  expect(mint.url.startsWith(CASHLINK_BASE)).toBe(true);
  expect(mint.valueLuna).toBe(500_000);

  // the embedded secret must rebuild EXACTLY the address we will poll (what the wallet does)
  const decoded = decodeCashlinkPayload(payloadFromUrl(mint.url));
  expect(decoded.value).toBe(500_000);
  const Nimiq = await getNimiq();
  const rebuilt = Nimiq.KeyPair.derive(Nimiq.PrivateKey.deserialize(decoded.priv))
    .toAddress().toUserFriendlyAddress();
  expect(rebuilt).toBe(mint.cashlinkAddress);

  // persist + settle (simulates the kid claiming)
  repo.setChoreStatus(chore.id, "approved");
  const cl = repo.createCashlink({
    id: crypto.randomUUID(), family_id: fam.id, chore_id: chore.id, child_id: sam.id,
    kind: "payout", cashlink_address: mint.cashlinkAddress, value_luna: mint.valueLuna,
    message: chore.title, url: mint.url, funding_tx_hash: mint.fundingTxHash, status: "ready",
  });

  repo.markCashlinkClaimed(cl.id);
  repo.addBalanceAndStreak(sam.id, cl.value_luna);
  repo.setChoreStatus(chore.id, "claimed");

  const after = repo.getChild(sam.id)!;
  expect(after.balance_luna).toBe(500_000);
  expect(after.streak_count).toBe(1);
  expect(repo.getChore(chore.id)!.status).toBe("claimed");
  expect(repo.getCashlink(cl.id)!.status).toBe("claimed");
});

test("rejects insufficient-precision and bad inputs in codec", async () => {
  expect(() => decodeCashlinkPayload("AAAA")).toThrow();
});
