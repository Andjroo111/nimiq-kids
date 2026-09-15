// Registering a kid's address out of a parent's own wallet, end to end over HTTP.
//
// This is the money path's front door. Everything downstream — every payout, every gift,
// every balance a kid is shown — is addressed to whatever this endpoint wrote. So the tests
// that matter are the ones about what it must REFUSE:
//
//   a proof that does not verify                       (anyone could claim any address)
//   a proof for a different address than was picked    (a valid signature is not a binding)
//   a proof minted for a different child               (replay across siblings)
//   a challenge used twice, or after it expired        (replay in time)
//   another household's challenge                      (cross-family)
//   the family wallet, or an address another kid holds (silent self-pay, pooled money)
//   a move off an address that still holds NIM         (stranding it forever)
//
// Hermetic: in-memory DB + app.request(), mirroring src/fund-kid.test.ts. Balances are
// injected, so no chain is involved.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getDb, initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { kidAddressRoutes } from "./routes/kid-address";
import { bindingMessage, messageBindsChild, registerParentOwnedAddress, verifyStoredBinding } from "./kid-address";
import { SIGN_MESSAGE_PREFIX } from "./nimiq/address-proof";

const Nimiq = await import("@nimiq/core");
const app = new Hono().route("/api", kidAddressRoutes);

// A wallet, as far as this test is concerned: an address and the ability to sign the
// Keyguard's way (transcribed from nimiq/keyguard src/lib/Key.js signMessage).
function makeWallet() {
  const privateKey = Nimiq.KeyPair.generate().privateKey;
  const publicKey = Nimiq.PublicKey.derive(privateKey);
  return {
    address: publicKey.toAddress().toUserFriendlyAddress(),
    sign(message: string) {
      const enc = new TextEncoder();
      const body = enc.encode(message);
      const head = enc.encode(SIGN_MESSAGE_PREFIX + String(body.length));
      const data = new Uint8Array(head.length + body.length);
      data.set(head, 0);
      data.set(body, head.length);
      const h = new Bun.CryptoHasher("sha256");
      h.update(data);
      return {
        publicKeyHex: publicKey.toHex(),
        signatureHex: Nimiq.Signature.create(privateKey, publicKey, new Uint8Array(h.digest())).toHex(),
      };
    },
  };
}

type House = { fam: repo.Family; kid: repo.Child; bearer: string };

async function makeHouse(label: string, kidLabel: string, familyAddress: string): Promise<House> {
  const f = repo.createFamily(label, familyAddress);
  repo.updateFamilySettings(f.id, { mode: "family" });
  const fam = repo.getFamily(f.id)!;
  const kid = repo.createChild(fam.id, kidLabel, "🦖");
  const bearer = newToken();
  lockRepo.createParentToken(fam.id, `${label}'s phone`, await sha256Hex(bearer));
  return { fam, kid, bearer };
}

let A: House;
let B: House;
let famWalletA: ReturnType<typeof makeWallet>;

// `SIM` in nimiq/client.ts is a module-level const, so it is fixed the moment that module is
// imported and cannot be flipped per test. With no DEV_PARENT_PRIV in the environment it is
// true here, which means the ROUTE never reads a balance. The old-balance gate is therefore
// exercised at the service level below, where the reader is injected — which is also the
// only way to test the failure modes of a chain read at all.
beforeEach(async () => {
  initTestDb();
  famWalletA = makeWallet();
  A = await makeHouse("Mom A", "Ada", famWalletA.address);
  B = await makeHouse("Dad B", "Ben", makeWallet().address);
});

const post = (h: House, path: string, body: unknown) =>
  app.request(`http://hatch.test/api${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${h.bearer}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const challenge = (h: House, address: string, kidId?: string) =>
  post(h, `/kids/${kidId ?? h.kid.id}/address-challenge`, { address });

const register = (h: House, body: unknown, kidId?: string) =>
  post(h, `/kids/${kidId ?? h.kid.id}/address`, body);

/** The whole happy flow, returned so tests can assert on the pieces. */
async function registerAddress(h: House, wallet: ReturnType<typeof makeWallet>) {
  const ch = await challenge(h, wallet.address);
  const chBody = await ch.json();
  const proof = wallet.sign(chBody.message);
  const res = await register(h, { challengeId: chBody.challengeId, ...proof });
  return { challengeStatus: ch.status, challenge: chBody, res, body: await res.json() };
}

// ---- the happy path ----

test("a parent registers an address out of their own wallet", async () => {
  const w = makeWallet();
  const { challengeStatus, challenge: ch, res, body } = await registerAddress(A, w);

  expect(challengeStatus).toBe(201);
  expect(ch.address).toBe(w.address);          // canonical spaced form back
  expect(ch.message).toContain("nimiq.kids");
  expect(res.status).toBe(201);
  expect(body.child.address).toBe(w.address);
  expect(body.child.addressSource).toBe("parent");

  const row = repo.getChild(A.kid.id)!;
  expect(row.address).toBe(w.address);
  expect(row.address_source).toBe("parent");
  expect(row.address_registered_at).toBeGreaterThan(0);
  // The whole proof is on the row, so it can be re-checked later from the row alone.
  expect(await verifyStoredBinding(row)).toEqual({ ok: true, binding: "child" });
});

test("the message binds the child, the address and a nonce", async () => {
  const w = makeWallet();
  const ch = await (await challenge(A, w.address)).json();
  expect(messageBindsChild(ch.message, A.kid.id)).toBe(true);
  expect(ch.message).toContain(w.address.replace(/\s/g, ""));
  expect(ch.message).toMatch(/\nnonce [0-9a-f]{32}$/);
  // Two challenges for the same address must not produce the same message, or a proof
  // could be replayed against a fresh challenge.
  const again = await (await challenge(A, w.address)).json();
  expect(again.message).not.toBe(ch.message);
});

test("the message stays inside what a Keyguard will accept", async () => {
  // Utf8Tools.isValidUtf8 whitelists \t \n \r and REFUSES every other control character, so
  // a label carrying one would make the Hub throw before the parent ever saw the popup.
  const f = repo.createFamily("Mom", makeWallet().address);
  const kid = repo.createChild(f.id, "Ivy\u{1F984}", "🦖");
  const msg = bindingMessage({ childLabel: kid.label, childId: kid.id, address: "NQ11 AAAA", nonce: "ff" });
  // Every control character EXCEPT \n (0x0A), which the Keyguard whitelists and renders.
  // eslint-disable-next-line no-control-regex
  expect(msg).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u007F]/);
  expect(msg).toContain("Ivy");
});

// ---- proofs that must not be believed ----

test("a signature over something else is refused", async () => {
  const w = makeWallet();
  const ch = await (await challenge(A, w.address)).json();
  const res = await register(A, { challengeId: ch.challengeId, ...w.sign("a message of my own choosing") });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "proof_invalid", reason: "signature_mismatch" });
  expect(repo.getChild(A.kid.id)!.address).toBeNull();
});

test("signing the challenge with a DIFFERENT address is refused", async () => {
  const picked = makeWallet();
  const other = makeWallet();
  const ch = await (await challenge(A, picked.address)).json();
  // `other` genuinely signed our exact message. It is still not a proof about `picked`.
  const res = await register(A, { challengeId: ch.challengeId, ...other.sign(ch.message) });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "proof_invalid", reason: "address_mismatch" });
});

test("a proof minted for one sibling cannot register the other", async () => {
  const sister = repo.createChild(A.fam.id, "Bea", "🦕");
  const w = makeWallet();
  const chForKid = await (await challenge(A, w.address)).json();
  const proof = w.sign(chForKid.message);
  // Valid signature, valid address, wrong child: the challenge id is checked against the
  // child in the URL, so this cannot be pointed at the sibling.
  const res = await register(A, { challengeId: chForKid.challengeId, ...proof }, sister.id);
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("challenge_not_found");
  expect(repo.getChild(sister.id)!.address).toBeNull();
});

test("a challenge is single use", async () => {
  const w = makeWallet();
  const ch = await (await challenge(A, w.address)).json();
  const proof = w.sign(ch.message);
  expect((await register(A, { challengeId: ch.challengeId, ...proof })).status).toBe(201);
  const second = await register(A, { challengeId: ch.challengeId, ...proof });
  expect(second.status).toBe(400);
  expect((await second.json()).error).toBe("challenge_used");
});

test("an expired challenge is refused", async () => {
  const w = makeWallet();
  const ch = await (await challenge(A, w.address)).json();
  getDb().run("UPDATE kid_address_challenges SET expires_at=? WHERE id=?", [Date.now() - 1, ch.challengeId]);
  const res = await register(A, { challengeId: ch.challengeId, ...w.sign(ch.message) });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("challenge_expired");
});

test("another household's challenge is invisible", async () => {
  const w = makeWallet();
  const ch = await (await challenge(A, w.address)).json();
  // B holds a real bearer and a real challenge id. It still belongs to A's child.
  const res = await register(B, { challengeId: ch.challengeId, ...w.sign(ch.message) });
  expect(res.status).toBe(404);
  expect(repo.getChild(B.kid.id)!.address).toBeNull();
});

test("a kid in another family cannot be addressed at all", async () => {
  const res = await challenge(A, makeWallet().address, B.kid.id);
  expect(res.status).toBe(404);
});

test("no bearer, no registration", async () => {
  const res = await app.request(`http://hatch.test/api/kids/${A.kid.id}/address-challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: makeWallet().address }),
  });
  expect(res.status).toBe(401);
});

// ---- addresses that must not be accepted ----

test("a bad address never gets as far as a wallet popup", async () => {
  expect((await challenge(A, "NQ00 0000 0000 0000 0000 0000 0000 0000 0000")).status).toBe(400);
  expect((await challenge(A, "not an address")).status).toBe(400);
  expect((await challenge(A, "")).status).toBe(400);
});

test("the family wallet's own address is refused", async () => {
  // Payouts to self: the balance never moves, nothing errors, and the kid's screen shows
  // nothing arriving. Refused where it is still free to refuse.
  const res = await challenge(A, famWalletA.address);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("address_is_the_family_wallet");
});

test("an address another kid already holds is refused, and says who has it", async () => {
  const w = makeWallet();
  await registerAddress(A, w);
  const sister = repo.createChild(A.fam.id, "Bea", "🦕");
  const res = await challenge(A, w.address, sister.id);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "address_taken", byLabel: "Ada" });
});

test("the clash is caught across households too, not just within one", async () => {
  const w = makeWallet();
  await registerAddress(A, w);
  const res = await challenge(B, w.address);
  expect(res.status).toBe(409);
});

// ---- the account being left behind ----

test("moving off an address that still holds NIM is REFUSED", async () => {
  // The old address is derived from the server seed. Overwriting the column would erase the
  // app's own record of where that money is, while the money is still there.
  const kid = repo.createChild(A.fam.id, "Cal", "🐢");
  wrepo.assignKidAccount(kid.id);
  wrepo.setChildAddress(kid.id, "NQ11 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1");
  const w = makeWallet();
  const ch = await (await challenge(A, w.address, kid.id)).json();
  const proof = w.sign(ch.message);

  const res = await registerParentOwnedAddress(
    A.fam, repo.getChild(kid.id)!, { challengeId: ch.challengeId, ...proof },
    { readBalance: async () => 7_000 },
  );
  expect(res).toMatchObject({ ok: false, error: "funds_at_old_address", balanceLuna: 7_000 });
  expect(repo.getChild(kid.id)!.address_source).toBe("derived");
});

test("an UNREADABLE old balance is refused too, and does not consume the challenge", async () => {
  const kid = repo.createChild(A.fam.id, "Cal", "🐢");
  wrepo.assignKidAccount(kid.id);
  wrepo.setChildAddress(kid.id, "NQ11 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1");
  const w = makeWallet();
  const ch = await (await challenge(A, w.address, kid.id)).json();
  const proof = w.sign(ch.message);

  const failing = await registerParentOwnedAddress(
    A.fam, repo.getChild(kid.id)!, { challengeId: ch.challengeId, ...proof },
    { readBalance: async () => { throw new Error("ECONNREFUSED"); } },
  );
  expect(failing).toMatchObject({ ok: false, error: "balance_check_failed" });

  // A retry once the node is back must work: burning the challenge on an infrastructure
  // failure would make the parent redo the wallet popup for no reason.
  const ok = await registerParentOwnedAddress(
    A.fam, repo.getChild(kid.id)!, { challengeId: ch.challengeId, ...proof },
    { readBalance: async () => 0 },
  );
  expect(ok.ok).toBe(true);
});

test("an empty old address moves cleanly, and the derived address is remembered", async () => {
  const kid = repo.createChild(A.fam.id, "Cal", "🐢");
  wrepo.assignKidAccount(kid.id);
  const old = "NQ11 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1";
  wrepo.setChildAddress(kid.id, old);
  const w = makeWallet();
  const ch = await (await challenge(A, w.address, kid.id)).json();

  const res = await registerParentOwnedAddress(
    A.fam, repo.getChild(kid.id)!, { challengeId: ch.challengeId, ...w.sign(ch.message) },
    { readBalance: async () => 0 },
  );
  expect(res.ok).toBe(true);
  const row = repo.getChild(kid.id)!;
  expect(row.address).toBe(w.address);
  expect(row.address_source).toBe("parent");
  // Kept: it is the only remaining record of which account the server key controlled, and
  // the boot guard reads it.
  expect(row.derived_address).toBe(old);
  // NOT cleared here. The migration script owns that, after its own proved-empty read.
  expect(row.account_index).not.toBeNull();
});

// ---- re-verifying a stored binding ----

test("a stored binding whose address was tampered with stops verifying", async () => {
  const w = makeWallet();
  await registerAddress(A, w);
  getDb().run("UPDATE children SET address=? WHERE id=?", [makeWallet().address, A.kid.id]);
  const res = await verifyStoredBinding(repo.getChild(A.kid.id)!);
  expect(res).toEqual({ ok: false, reason: "address_mismatch" });
});

test("the database itself refuses to let two kids share one parent-owned address", async () => {
  // The partial unique index in src/db.ts migrate(). Two kids on one address pools their
  // money and shows both the same balance, so this is worth catching below the route as
  // well as in it.
  const w = makeWallet();
  await registerAddress(A, w);
  const src = repo.getChild(A.kid.id)!;
  const sister = repo.createChild(A.fam.id, "Bea", "🦕");
  expect(() => getDb().run(
    "UPDATE children SET address=?, address_source='parent' WHERE id=?",
    [src.address, sister.id],
  )).toThrow(/UNIQUE/);
});

test("a valid proof copied onto a different child stops verifying", async () => {
  // Checked against the ROW rather than through the database, because the index above is
  // not the only thing this defends. A database restored from an older backup, or one
  // built before that index existed, can carry a row like this — and the point of storing
  // the whole proof is that it can be re-judged from the cryptography at any later time.
  const w = makeWallet();
  await registerAddress(A, w);
  const src = repo.getChild(A.kid.id)!;
  const sister = repo.createChild(A.fam.id, "Bea", "🦕");
  const impostor: repo.Child = { ...src, id: sister.id, label: sister.label };
  // Cryptographically flawless, and still not a statement about this child.
  expect(await verifyStoredBinding(impostor)).toEqual({ ok: false, reason: "bound_to_another_child" });
  // The genuine row it was copied from still verifies, so the check is discriminating and
  // not just failing everything.
  expect(await verifyStoredBinding(src)).toEqual({ ok: true, binding: "child" });
});

test("a derived row is not treated as a binding", async () => {
  const kid = repo.createChild(A.fam.id, "Cal", "🐢");
  wrepo.assignKidAccount(kid.id);
  wrepo.setChildAddress(kid.id, "NQ11 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1 OLD1");
  expect(await verifyStoredBinding(repo.getChild(kid.id)!)).toEqual({ ok: false, reason: "not_parent_owned" });
});
