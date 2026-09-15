// Registering a whole family's addresses from one `connectAccount` popup, over HTTP.
//
// The per-child route's tests (src/kid-address.test.ts) are about a message that names one
// child and one address. This route's message names neither, on purpose, so the refusals it
// owns are different and this file is about those:
//
//   a signature made the signMessage way            (wrong prefix; the flows must not mix)
//   one bad proof anywhere in the batch             (all or nothing, nothing written)
//   two children handed the same address            (pooled money, one balance shown twice)
//   the family wallet handed to a child             (payouts to self, silently)
//   a child from another household                  (cross-family)
//   a challenge reused, expired, or another family's (replay)
//   a move off an address that still holds NIM      (stranding it forever)
//
// Hermetic: in-memory DB and app.request(), same shape as the per-child file. The balance
// reader is injected at the service level, because `SIM` is fixed at import time.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getDb, initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { kidAddressRoutes } from "./routes/kid-address";
import { verifyStoredBinding } from "./kid-address";
import {
  connectBindingMessage, issueConnectChallenge, messageBindsFamily, registerConnectedAddresses,
} from "./kid-address-connect";
import { CONNECT_CHALLENGE_PREFIX, SIGN_MESSAGE_PREFIX } from "./nimiq/address-proof";

const Nimiq = await import("@nimiq/core");
const app = new Hono().route("/api", kidAddressRoutes);

/** A key at some derivation path, as far as this test cares: an address plus the ability to
 *  sign the way the Keyguard does, under either prefix. The prefix is a parameter precisely
 *  because using the wrong one has to be a test case rather than an accident. */
function makeKey() {
  const privateKey = Nimiq.KeyPair.generate().privateKey;
  const publicKey = Nimiq.PublicKey.derive(privateKey);
  const sign = (message: string, prefix: string) => {
    const enc = new TextEncoder();
    const body = enc.encode(message);
    const head = enc.encode(prefix + String(body.length));
    const data = new Uint8Array(head.length + body.length);
    data.set(head, 0);
    data.set(body, head.length);
    const h = new Bun.CryptoHasher("sha256");
    h.update(data);
    return {
      publicKeyHex: publicKey.toHex(),
      signatureHex: Nimiq.Signature.create(privateKey, publicKey, new Uint8Array(h.digest())).toHex(),
    };
  };
  return {
    address: publicKey.toAddress().toUserFriendlyAddress(),
    connect: (m: string) => sign(m, CONNECT_CHALLENGE_PREFIX),
    asMessage: (m: string) => sign(m, SIGN_MESSAGE_PREFIX),
  };
}

type House = { fam: repo.Family; kids: repo.Child[]; bearer: string };

async function makeHouse(label: string, kidLabels: string[], familyAddress: string): Promise<House> {
  const f = repo.createFamily(label, familyAddress);
  repo.updateFamilySettings(f.id, { mode: "family" });
  const fam = repo.getFamily(f.id)!;
  const kids = kidLabels.map((l) => repo.createChild(fam.id, l, "🦖"));
  const bearer = newToken();
  lockRepo.createParentToken(fam.id, `${label}'s phone`, await sha256Hex(bearer));
  return { fam, kids, bearer };
}

let A: House;
let B: House;

beforeEach(async () => {
  initTestDb();
  A = await makeHouse("Mom A", ["Ada", "Ivy"], makeKey().address);
  B = await makeHouse("Dad B", ["Ben"], makeKey().address);
});

const post = (h: House, path: string, body: unknown) =>
  app.request(`http://hatch.test/api${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${h.bearer}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const openChallenge = async (h: House) => (await (await post(h, "/family/connect-challenge", {})).json());

/** The happy flow: one challenge, one key per kid, every key signs the same string. */
async function connectAll(h: House, keys = h.kids.map(() => makeKey())) {
  const ch = await openChallenge(h);
  const res = await post(h, "/family/connect-addresses", {
    challengeId: ch.challengeId,
    assignments: h.kids.map((kid, i) => ({
      childId: kid.id,
      keyPath: `m/44'/242'/0'/${i + 1}'`,
      address: keys[i]!.address,
      ...keys[i]!.connect(ch.message),
    })),
  });
  return { ch, keys, res, body: await res.json() };
}

test("one popup registers every child, and each address is the parent's", async () => {
  const { keys, res, body } = await connectAll(A);
  expect(res.status).toBe(201);
  expect(body.children.map((c: { address: string }) => c.address)).toEqual(keys.map((k) => k.address));

  for (const kid of A.kids) {
    const row = repo.getChild(kid.id)!;
    expect(row.address_source).toBe("parent");
    expect(row.address_proof_kind).toBe("connect_challenge");
    // Re-checked from the row alone, under the prefix the row says it was signed with. The
    // binding it reports is `family`, not `child`, and that difference is the whole point of
    // storing the kind: a connect batch cannot prove which kid an address is for.
    expect(await verifyStoredBinding(row)).toEqual({ ok: true, binding: "family" });
  }
});

test("a signature made the signMessage way is refused", async () => {
  // The two Keyguard prefixes exist so a blind-signed challenge cannot be replayed as a
  // message the user actually read. If this passed, that separation would be decorative.
  const ch = await openChallenge(A);
  const key = makeKey();
  const res = await post(A, "/family/connect-addresses", {
    challengeId: ch.challengeId,
    assignments: [{ childId: A.kids[0]!.id, address: key.address, ...key.asMessage(ch.message) }],
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "proof_invalid", reason: "signature_mismatch" });
});

test("one bad proof in the batch writes nothing at all", async () => {
  // All or nothing. A half-written batch leaves some kids parent-owned and some derived,
  // which is the one state where "is this instance custodial?" has no answer.
  const ch = await openChallenge(A);
  const good = makeKey();
  const bad = makeKey();
  const res = await post(A, "/family/connect-addresses", {
    challengeId: ch.challengeId,
    assignments: [
      { childId: A.kids[0]!.id, address: good.address, ...good.connect(ch.message) },
      { childId: A.kids[1]!.id, address: bad.address, ...bad.connect("some other string") },
    ],
  });
  expect(res.status).toBe(400);
  expect((await res.json()).childId).toBe(A.kids[1]!.id);
  for (const kid of A.kids) expect(repo.getChild(kid.id)!.address_source).toBeNull();

  // And the challenge was not burned, so the parent can retry rather than start over.
  const retry = await connectAll(A);
  expect(retry.res.status).toBe(201);
});

test("two children cannot be handed the same address", async () => {
  const ch = await openChallenge(A);
  const key = makeKey();
  const res = await post(A, "/family/connect-addresses", {
    challengeId: ch.challengeId,
    assignments: A.kids.map((kid) => ({ childId: kid.id, address: key.address, ...key.connect(ch.message) })),
  });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: "duplicate_address", childId: A.kids[1]!.id });
});

test("the family wallet cannot be handed to a child", async () => {
  // Payouts to self: the balance never moves, nothing throws, and the kid's screen stays
  // empty. There is no signature to make here, so the refusal must come from the address.
  const ch = await openChallenge(A);
  const res = await post(A, "/family/connect-addresses", {
    challengeId: ch.challengeId,
    assignments: [{ childId: A.kids[0]!.id, address: A.fam.parent_address, publicKeyHex: "00", signatureHex: "00" }],
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "address_is_the_family_wallet" });
});

test("another household's child is not found, and neither is their challenge", async () => {
  const chA = await openChallenge(A);
  const key = makeKey();
  const crossChild = await post(A, "/family/connect-addresses", {
    challengeId: chA.challengeId,
    assignments: [{ childId: B.kids[0]!.id, address: key.address, ...key.connect(chA.message) }],
  });
  expect(crossChild.status).toBe(404);
  expect(await crossChild.json()).toMatchObject({ error: "unknown_child" });

  // B's own, valid, unused challenge is still nothing to A. Same answer as a made-up id, so
  // the endpoint is not a probe for which ids exist.
  const chB = await openChallenge(B);
  const crossChallenge = await post(A, "/family/connect-addresses", {
    challengeId: chB.challengeId,
    assignments: [{ childId: A.kids[0]!.id, address: key.address, ...key.connect(chB.message) }],
  });
  expect(crossChallenge.status).toBe(404);
  expect(await crossChallenge.json()).toEqual({ error: "challenge_not_found" });
});

test("a challenge is good once", async () => {
  const { ch, keys } = await connectAll(A);
  const again = await post(A, "/family/connect-addresses", {
    challengeId: ch.challengeId,
    assignments: [{ childId: A.kids[0]!.id, address: keys[0]!.address, ...keys[0]!.connect(ch.message) }],
  });
  expect(again.status).toBe(400);
  expect(await again.json()).toEqual({ error: "challenge_used" });
});

test("an expired challenge is refused even though the signature is perfect", async () => {
  const ch = await openChallenge(A);
  getDb().run("UPDATE family_connect_challenges SET expires_at=? WHERE id=?", [Date.now() - 1, ch.challengeId]);
  const key = makeKey();
  const res = await post(A, "/family/connect-addresses", {
    challengeId: ch.challengeId,
    assignments: [{ childId: A.kids[0]!.id, address: key.address, ...key.connect(ch.message) }],
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "challenge_expired" });
});

test("the message binds the family and nobody else", () => {
  const m = connectBindingMessage({ familyId: A.fam.id, nonce: "0f1e" });
  expect(messageBindsFamily(m, A.fam.id)).toBe(true);
  expect(messageBindsFamily(m, B.fam.id)).toBe(false);
  // A family id appearing anywhere in the text is not a binding: it has to be the whole
  // line, or a household whose label contained another id would match.
  expect(messageBindsFamily(`nimiq.kids\nfamily ${A.fam.id} and more`, A.fam.id)).toBe(false);
  // Two challenges for the same family differ, so one cannot be replayed as the other.
  expect(issueConnectChallenge(A.fam).message).not.toBe(issueConnectChallenge(A.fam).message);
});

// ---- the chain read, at the service level where the reader can be injected ----------------

test("a kid still holding NIM at their old address is not moved, and nor is anyone else", async () => {
  const kid = A.kids[0]!;
  // Give this kid a server-derived account with money in it, the state the migration exists
  // to protect: once the seed is deleted, nothing can ever sign for that address again.
  const derived = makeKey().address;
  getDb().run("UPDATE children SET address=?, address_source='derived', derived_address=? WHERE id=?",
    [derived, derived, kid.id]);

  const ch = issueConnectChallenge(A.fam);
  const keys = A.kids.map(() => makeKey());
  const assignments = A.kids.map((k, i) => ({
    childId: k.id, address: keys[i]!.address, ...keys[i]!.connect(ch.message),
  }));

  const res = await registerConnectedAddresses(A.fam, { challengeId: ch.id, assignments }, {
    readBalance: async (a) => (a === derived ? 5_000 : 0),
  });
  expect(res).toMatchObject({ ok: false, error: "funds_at_old_address", childId: kid.id, balanceLuna: 5_000 });
  // The sibling with nothing at stake is not moved either. Partial success here would be the
  // silent half-migration the all-or-nothing rule exists to prevent.
  for (const k of A.kids) expect(repo.getChild(k.id)!.address_source).not.toBe("parent");
});

test("a balance that cannot be read refuses, because a failed read is not a zero", async () => {
  const kid = A.kids[0]!;
  const derived = makeKey().address;
  getDb().run("UPDATE children SET address=?, address_source='derived', derived_address=? WHERE id=?",
    [derived, derived, kid.id]);

  const ch = issueConnectChallenge(A.fam);
  const keys = A.kids.map(() => makeKey());
  const res = await registerConnectedAddresses(A.fam, {
    challengeId: ch.id,
    assignments: A.kids.map((k, i) => ({ childId: k.id, address: keys[i]!.address, ...keys[i]!.connect(ch.message) })),
  }, {
    readBalance: async () => { throw new Error("rpc_unreachable"); },
  });
  expect(res).toMatchObject({ ok: false, error: "balance_check_failed", childId: kid.id });
  expect(repo.getChild(kid.id)!.address_source).toBe("derived");
});
