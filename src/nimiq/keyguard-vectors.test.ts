// Checking our digest against the KEYGUARD'S OWN committed test fixtures.
//
// `address-proof.test.ts` checks the verifier against a transcription of the Keyguard's
// algorithm, and says in its own header what that cannot prove: that the transcription is
// right. Two transcriptions by the same author agreeing is not evidence. This file closes
// that gap without a browser, by using values that were written down in the *upstream*
// project, by its authors, for their own tests:
//
//   nimiq/keyguard tests/lib/Key.spec.js  "can sign a message (BIP39)"
//     const data = new Nimiq.SerialBuffer([1, 2, 3, 4, 5, 6]);
//     const signedData = new Uint8Array(
//         Array.from(Nimiq.BufferUtils.fromUtf8('\x16Nimiq Signed Message:\n6')).concat([1,2,3,4,5,6]),
//     );
//     const hashedSignedData = Nimiq.Hash.computeSha256(signedData);
//     expect(proof.verify(hashedSignedData)).toBe(true);
//
//   nimiq/keyguard tests/lib/Key.spec.js  "can derive addresses (BIP39)"
//   nimiq/keyguard tests/DummyData.spec.js  mnemonics[0]
//
// The string literal, the byte array and the two addresses below are quoted from those files.
// If our prefix, our length field, our hash choice or our address encoding differed from the
// Keyguard's by so much as one byte, these would fail.
//
// STILL NOT PROVEN HERE, and it is a short list: that the deployed Hub passes the message to
// the Keyguard unaltered, and that `signMessage({signer})` resolves an address the user owns
// but did not just choose. Both are read from hub source (src/views/SignMessage.vue forwards
// `message: this.request.message` verbatim, and resolves `signer` with `findWalletByAddress`),
// and both are exercised by `spike/hub-q1`, which needs a human and a wallet.

import { test, expect } from "bun:test";
import { pbkdf2Sync } from "node:crypto";
import { derivePrivateKey } from "./hd";
import {
  CONNECT_CHALLENGE_PREFIX,
  SIGN_MESSAGE_PREFIX,
  signedMessageDigest,
  verifyAddressProof,
} from "./address-proof";

const Nimiq = await import("@nimiq/core");

const hex = (u: Uint8Array): string => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = (d: Uint8Array): Uint8Array => {
  const h = new Bun.CryptoHasher("sha256");
  h.update(d);
  return new Uint8Array(h.digest());
};

// ---- quoted from nimiq/keyguard ---------------------------------------------------------
/** tests/lib/Key.spec.js — the prefix literal, spelled out in their test, not in ours. */
const KG_PREFIX_LITERAL = "\x16Nimiq Signed Message:\n";
/** tests/lib/Key.spec.js — the message they sign, and the "6" they concatenate as its length. */
const KG_MESSAGE_BYTES = [1, 2, 3, 4, 5, 6];
/** tests/DummyData.spec.js — mnemonics[0], the BIP39 secret behind their signing test. */
const KG_MNEMONIC =
  "exotic discover sport hamster index puppy trip blood illness gadget mass hour tray catch color genre draft merit strong aim yellow system plug year";
/** tests/lib/Key.spec.js "can derive addresses (BIP39)" — what that mnemonic must produce. */
const KG_ADDRESS_M = "NQ46 2RM7 QE4T 82KR 61Q9 9B7E R38G LBVM N6KY";
const KG_ADDRESS_M0 = "NQ70 APBA 9GCC FL44 D82R UJCD DS4B Y824 3LYJ";

const HARDENED = 0x80000000;
/** Nimiq `Entropy.toExtendedPrivateKey` is BIP39 (PBKDF2-SHA512, 2048 rounds, "mnemonic"
 *  salt) into SLIP-0010 ed25519 — the scheme `hd.ts` implements. */
const kgSeed = () => pbkdf2Sync(KG_MNEMONIC.normalize("NFKD"), "mnemonic", 2048, 64, "sha512");

const kgKeyPair = (path: readonly number[]) =>
  Nimiq.KeyPair.derive(Nimiq.PrivateKey.deserialize(derivePrivateKey(kgSeed(), path)));

// ---- the digest -------------------------------------------------------------------------

test("our prefix is byte-identical to the Keyguard's own test literal", () => {
  expect(hex(new TextEncoder().encode(SIGN_MESSAGE_PREFIX)))
    .toBe(hex(new TextEncoder().encode(KG_PREFIX_LITERAL)));
});

test("our digest equals the Keyguard's `hashedSignedData` for their own vector", () => {
  // Their construction, reassembled from the literals in their test file.
  const signedData = new Uint8Array([
    ...new TextEncoder().encode(KG_PREFIX_LITERAL + String(KG_MESSAGE_BYTES.length)),
    ...KG_MESSAGE_BYTES,
  ]);
  const theirs = sha256(signedData);

  // Bytes 0x01..0x06 are all below 0x80, so this string's UTF-8 encoding IS their byte array.
  const ours = signedMessageDigest(String.fromCharCode(...KG_MESSAGE_BYTES));

  expect(hex(ours)).toBe(hex(theirs));
  // Pinned so a future refactor cannot quietly move both sides together.
  expect(hex(ours)).toBe("57a17bee490eaea9e052f2f85fd3a52570d4064776d4396b45586b5e315f2dbb");
});

test("the length field is the BYTE count, and a character count would be caught", () => {
  // Every fixture the Keyguard publishes is ASCII, where the two counts are equal, so their
  // vectors cannot discriminate. The source line can: `Key.js` opens with
  //     const msgLength = message.byteLength;
  // and `SignMessage.js` hands it `Utf8Tools.stringToUtf8ByteArray(request.message)`.
  //
  // The existing "BYTES, not characters" test in address-proof.test.ts only asserts that two
  // different messages hash differently, which stays true under the wrong implementation. This
  // one builds both candidate digests and demands ours be the byte-length one.
  const message = "café ☕";
  const body = new TextEncoder().encode(message);
  expect(body.length).not.toBe(message.length); // otherwise this test proves nothing

  const withCount = (n: number) =>
    hex(sha256(new Uint8Array([...new TextEncoder().encode(SIGN_MESSAGE_PREFIX + String(n)), ...body])));

  expect(hex(signedMessageDigest(message))).toBe(withCount(body.length));
  expect(hex(signedMessageDigest(message))).not.toBe(withCount(message.length));
});

// ---- the address ------------------------------------------------------------------------

test("we derive the exact addresses the Keyguard publishes for their BIP39 fixture", () => {
  // Not derivation for its own sake: this is the public-key-to-address encoding that
  // `verifyAddressProof` compares against, checked against a value they wrote down.
  expect(kgKeyPair([]).publicKey.toAddress().toUserFriendlyAddress()).toBe(KG_ADDRESS_M);
  expect(kgKeyPair([HARDENED]).publicKey.toAddress().toUserFriendlyAddress()).toBe(KG_ADDRESS_M0);
});

// ---- the two halves together ------------------------------------------------------------

test("a proof signed the Keyguard's way, by a Keyguard-derived key, verifies", async () => {
  const kp = kgKeyPair([HARDENED]);
  const address = kp.publicKey.toAddress().toUserFriendlyAddress();
  const message = [
    "nimiq.kids: give this address to Ivy",
    "",
    "address " + address.replace(/\s/g, ""),
    "nonce 0f1e2d3c4b5a69788796a5b4c3d2e1f0",
  ].join("\n");

  const signature = Nimiq.Signature.create(kp.privateKey, kp.publicKey, signedMessageDigest(message));
  const proof = {
    address,
    message,
    publicKeyHex: kp.publicKey.toHex(),
    signatureHex: signature.toHex(),
  };

  expect(await verifyAddressProof(proof)).toEqual({ ok: true });

  // A verifier that accepts everything would pass the line above, so: the three ways this
  // proof can be a lie, each rejected for its own reason.
  expect(await verifyAddressProof({ ...proof, message: message + " " }))
    .toEqual({ ok: false, reason: "signature_mismatch" });
  expect(await verifyAddressProof({ ...proof, signatureHex: proof.signatureHex.replace(/.$/, (c) => (c === "0" ? "1" : "0")) }))
    .toEqual({ ok: false, reason: "signature_mismatch" });
  expect(await verifyAddressProof({ ...proof, address: KG_ADDRESS_M }))
    .toEqual({ ok: false, reason: "address_mismatch" });
});

// ---- connectAccount ---------------------------------------------------------------------
//
// `connectAccount` is the only Hub call that hands a third-party origin an address it did not
// already have. The Keyguard derives a public key at each requested path and signs a challenge
// with it (src/request/connect/Connect.js):
//
//     for (const keyPath of request.requestedKeyPaths) {
//         const publicKey = key.derivePublicKey(keyPath);
//         const signature = key.signMessage(keyPath, messageBytes, SignMessagePrefix.CONNECT_CHALLENGE);
//
// Same `signMessage` recipe as above, one prefix apart. The Keyguard publishes no fixture for
// this prefix, so the vector below is built from the two upstream literals it does publish:
// the prefix constant in client/src/SignMessagePrefix.ts, and the algorithm in src/lib/Key.js.

/** client/src/SignMessagePrefix.ts — quoted, including the \x19 length byte. */
const KG_CONNECT_PREFIX_LITERAL = "\x19Nimiq Connect Challenge:\n";

test("our connect prefix is byte-identical to the Keyguard's constant", () => {
  expect(hex(new TextEncoder().encode(CONNECT_CHALLENGE_PREFIX)))
    .toBe(hex(new TextEncoder().encode(KG_CONNECT_PREFIX_LITERAL)));
});

test("the two prefixes give the same message two different digests", () => {
  // The reason the Keyguard has two prefixes at all: a connect challenge is signed blind, so
  // it must not be replayable as a message the parent actually read, and vice versa. If these
  // ever collided, one popup's signature would be valid in the other flow.
  const message = "nimiq.kids connect challenge, nonce 0f1e2d3c";
  expect(hex(signedMessageDigest(message, "connect_challenge")))
    .not.toBe(hex(signedMessageDigest(message, "signed_message")));
});

test("the connect digest counts BYTES too", () => {
  // Same trap as above, re-armed for the second prefix. A challenge is server-issued and
  // currently ASCII, which is exactly the condition that hides this until it does not.
  const message = "café ☕";
  const body = new TextEncoder().encode(message);
  expect(body.length).not.toBe(message.length);

  const withCount = (n: number) =>
    hex(sha256(new Uint8Array([...new TextEncoder().encode(KG_CONNECT_PREFIX_LITERAL + String(n)), ...body])));

  expect(hex(signedMessageDigest(message, "connect_challenge"))).toBe(withCount(body.length));
  expect(hex(signedMessageDigest(message, "connect_challenge"))).not.toBe(withCount(message.length));
});

test("a key path the wallet never added still yields a verifiable address proof", async () => {
  // The whole point of the connect route: `requestedKeyPaths` is validated for syntax only
  // (keyguard RequestParser.parsePathsArray -> Nimiq.ExtendedPrivateKey.isValidPath), so the
  // app can ask for m/44'/242'/0'/3' without the parent having tapped "Add address" three
  // times first. Nothing about the derivation is special — this pins that our verifier accepts
  // such an address on the same terms as any other.
  const kidPath = [44 + HARDENED, 242 + HARDENED, HARDENED, 3 + HARDENED];
  const kp = kgKeyPair(kidPath);
  const address = kp.publicKey.toAddress().toUserFriendlyAddress();
  const message = "nimiq.kids: connect Ivy\nnonce 9a8b7c6d5e4f30211203344556677889";

  const digest = signedMessageDigest(message, "connect_challenge");
  const signature = Nimiq.Signature.create(kp.privateKey, kp.publicKey, digest);
  const proof = {
    address,
    message,
    publicKeyHex: kp.publicKey.toHex(),
    signatureHex: signature.toHex(),
    kind: "connect_challenge" as const,
  };

  expect(await verifyAddressProof(proof)).toEqual({ ok: true });

  // Verified under the wrong flow it must FAIL, not quietly pass. `kind` defaults to
  // signed_message, so an endpoint that forgets to pass it rejects honest proofs rather than
  // accepting forged ones — the safe direction, and pinned here so it stays that way.
  expect(await verifyAddressProof({ ...proof, kind: "signed_message" }))
    .toEqual({ ok: false, reason: "signature_mismatch" });
  const { kind: _dropped, ...withoutKind } = proof;
  expect(await verifyAddressProof(withoutKind))
    .toEqual({ ok: false, reason: "signature_mismatch" });
  expect(await verifyAddressProof({ ...proof, address: KG_ADDRESS_M }))
    .toEqual({ ok: false, reason: "address_mismatch" });
});
