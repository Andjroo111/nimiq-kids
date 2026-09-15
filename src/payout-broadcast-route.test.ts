// POST /api/payouts/broadcast — the HTTP shape of the relay.
//
// The relay's own decisions are covered in src/wallet/payout-relay.test.ts against real signed
// bytes. What is pinned here is the layer in front of it: who may call it, what a stranger can
// learn from it, and that a simulated instance refuses rather than pretending.
//
// The off-SIM happy path is deliberately NOT here. `SIM` is a module-level const read at import
// time, and the suite runs with no key and no `HATCH_CUSTODY`, so it is true for the whole
// process; forcing it false would mean re-importing the chain module mid-suite. The relay test
// drives that path end to end through the same function this route calls, with `broadcast` as
// the seam. Saying so out loud beats a green file that quietly covers four branches out of six.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { mintPayoutIntent, type PayoutIntent } from "./wallet/payout-intent";
import { payoutRoutes } from "./routes/payouts";

const app = new Hono().route("/api", payoutRoutes);
const PARENT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const KID = "NQ02 SXUJ Y9D0 UDSK L1J8 N1U4 69NB 69X4 KU3T";
const SOME_TX = "ab".repeat(40); // shaped like a serialized tx; never parsed in these paths

let fam: repo.Family;
let bearer: string;
let intent: PayoutIntent;

async function familyWithIntent(ref: string) {
  const f = repo.createFamily("Mom", PARENT);
  repo.updateFamilySettings(f.id, { mode: "family" });
  const family = repo.getFamily(f.id)!;
  const kid = repo.createChild(family.id, "Sam", "🦖");
  wrepo.setChildAddress(kid.id, KID);
  const res = mintPayoutIntent({
    ref, fam: family, sender: family.parent_address, child: repo.getChild(kid.id)!, valueLuna: 5_000,
    message: "Feed the cat", headHeight: 7_680_000,
  });
  return { family, intent: (res as { ok: true; intent: PayoutIntent }).intent };
}

beforeEach(async () => {
  initTestDb();
  const made = await familyWithIntent("chore:c1");
  fam = made.family;
  intent = made.intent;
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "phone", await sha256Hex(bearer));
});

const post = (body: unknown, token: string | null = bearer) =>
  app.request("http://hatch.test/api/payouts/broadcast", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

test("a kid tablet cannot push bytes into the family's payout ledger", async () => {
  // Device-authed, not parent-authed. Even correct bytes must not be relayable from a tablet:
  // a shared object in a house is not a parent.
  const deviceToken = newToken();
  lockRepo.createDevice(fam.id, "tablet", await sha256Hex(deviceToken), null);
  expect((await post({ intentId: intent.intentId, serializedTx: SOME_TX }, deviceToken)).status).toBe(401);
  expect((await post({ intentId: intent.intentId, serializedTx: SOME_TX }, null)).status).toBe(401);
});

test("another family's intent is a 404, not a 403 — this is not a probe for payout refs", async () => {
  const other = await familyWithIntent("chore:theirs");
  const res = await post({ intentId: other.intent.intentId, serializedTx: SOME_TX });
  expect(res.status).toBe(404);
  // Identical to an intent that does not exist at all, so the two cannot be told apart.
  const unknown = await post({ intentId: "chore:nope", serializedTx: SOME_TX });
  expect(unknown.status).toBe(404);
  expect(await res.json()).toEqual(await unknown.json());
});

test("a server-signed attempt is not addressable here", async () => {
  // It has a payout_ref and a row, but no signer, no pinned height and no expiry. Reading it
  // as an intent would invent all three.
  wrepo.claimPayoutAttempt({
    ref: "chore:old", familyId: fam.id, childId: repo.listChildren(fam.id)[0]!.id,
    valueLuna: 5_000, recipient: KID, message: "x",
  });
  expect((await post({ intentId: "chore:old", serializedTx: SOME_TX })).status).toBe(404);
});

test("a missing or malformed body is refused before anything is looked up", async () => {
  expect((await post({ serializedTx: SOME_TX })).status).toBe(400);
  expect((await post({ intentId: intent.intentId })).status).toBe(400);
  expect((await post({ intentId: intent.intentId, serializedTx: "not hex" })).status).toBe(400);
  expect((await post({ intentId: intent.intentId, serializedTx: "abcd" })).status).toBe(400);
});

test("a simulated instance refuses to relay rather than pretending it did", async () => {
  // The suite runs simulated, so this is the branch it can reach. A SIM instance has no chain
  // to broadcast to; answering 200 here would write a ledger row against a network that does
  // not exist.
  const res = await post({ intentId: intent.intentId, serializedTx: SOME_TX });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "sim_no_broadcast" });
  expect(wrepo.walletEventForPayoutRef(intent.intentId)).toBeNull();
});
