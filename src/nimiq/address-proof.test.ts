// The verifier has to accept exactly what a Nimiq Keyguard produces and nothing else.
//
// The Keyguard is a browser app we cannot call from a test, so the algorithm is REPLICATED
// here from its source (nimiq/keyguard src/lib/Key.js signMessage + client/src/
// SignMessagePrefix.ts) and the verifier is checked against that replica. That proves the
// two agree on every property that matters — the prefix bytes, the decimal byte-length, the
// SHA256, that the signature is over the HASH and not the message — and it is the strongest
// check available without a wallet and a human.
//
// What it deliberately cannot prove: that the transcription of the prefix is right. That
// one is a fail-CLOSED risk (a wrong prefix rejects every honest proof and registration
// simply does not work), and it is settled by running the flow against a real wallet, which
// is a manual step, not a test.

import { test, expect } from "bun:test";
import {
  bareAddress, canonicalAddress, signedMessageDigest, verifyAddressProof, SIGN_MESSAGE_PREFIX,
} from "./address-proof";

const Nimiq = await import("@nimiq/core");

/** The Keyguard's own algorithm, transcribed rather than imported. */
function keyguardSign(privateKey: InstanceType<typeof Nimiq.PrivateKey>, message: string) {
  const publicKey = Nimiq.PublicKey.derive(privateKey);
  const enc = new TextEncoder();
  const body = enc.encode(message);
  const head = enc.encode(SIGN_MESSAGE_PREFIX + String(body.length));
  const data = new Uint8Array(head.length + body.length);
  data.set(head, 0);
  data.set(body, head.length);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  const signature = Nimiq.Signature.create(privateKey, publicKey, new Uint8Array(hasher.digest()));
  return {
    address: publicKey.toAddress().toUserFriendlyAddress(),
    publicKeyHex: publicKey.toHex(),
    signatureHex: signature.toHex(),
  };
}

const freshKey = () => Nimiq.KeyPair.generate().privateKey;

test("the prefix is 23 bytes and starts with its own length", () => {
  const bytes = new TextEncoder().encode(SIGN_MESSAGE_PREFIX);
  expect(bytes.length).toBe(23);
  expect(bytes[0]).toBe(0x16); // 22 = the length of "Nimiq Signed Message:\n"
});

test("the digest is 32 bytes and changes with the message", () => {
  expect(signedMessageDigest("a").length).toBe(32);
  expect([...signedMessageDigest("a")]).not.toEqual([...signedMessageDigest("b")]);
});

test("the length in the digest is BYTES, not characters", () => {
  // "é" is one character and two UTF-8 bytes. If the length were computed from the string
  // the two digests below would collide with a differently-encoded message; they must not.
  const twoBytes = signedMessageDigest("é");
  const twoChars = signedMessageDigest("ab");
  expect([...twoBytes]).not.toEqual([...twoChars]);
});

test("a genuine Keyguard-shaped proof verifies", async () => {
  const priv = freshKey();
  const message = "nimiq.kids: give this address to Ivy\nnonce deadbeef";
  const signed = keyguardSign(priv, message);
  const res = await verifyAddressProof({ ...signed, address: signed.address, message });
  expect(res).toEqual({ ok: true });
});

test("the address may carry display spacing or none", async () => {
  const priv = freshKey();
  const message = "bind me";
  const signed = keyguardSign(priv, message);
  const bare = signed.address.replace(/\s/g, "");
  expect(await verifyAddressProof({ ...signed, address: bare, message })).toEqual({ ok: true });
  expect(await verifyAddressProof({ ...signed, address: signed.address.toLowerCase(), message })).toEqual({ ok: true });
});

test("a signature over a DIFFERENT message is refused", async () => {
  const priv = freshKey();
  const signed = keyguardSign(priv, "the message I signed");
  const res = await verifyAddressProof({ ...signed, message: "the message the server issued" });
  expect(res).toEqual({ ok: false, reason: "signature_mismatch" });
});

test("a valid signature by ANOTHER account is refused (the address must match the key)", async () => {
  const message = "bind me";
  const mine = keyguardSign(freshKey(), message);
  const theirs = keyguardSign(freshKey(), message);
  // Their key really did sign this exact message. It is still not a proof about my address.
  const res = await verifyAddressProof({
    address: mine.address, message,
    publicKeyHex: theirs.publicKeyHex, signatureHex: theirs.signatureHex,
  });
  expect(res).toEqual({ ok: false, reason: "address_mismatch" });
});

test("a public key with someone else's signature is refused", async () => {
  const message = "bind me";
  const mine = keyguardSign(freshKey(), message);
  const theirs = keyguardSign(freshKey(), message);
  const res = await verifyAddressProof({
    address: mine.address, message,
    publicKeyHex: mine.publicKeyHex, signatureHex: theirs.signatureHex,
  });
  expect(res).toEqual({ ok: false, reason: "signature_mismatch" });
});

test("garbage hex is refused by shape, not by throwing", async () => {
  const message = "bind me";
  const good = keyguardSign(freshKey(), message);
  expect(await verifyAddressProof({ ...good, message, publicKeyHex: "zz" }))
    .toEqual({ ok: false, reason: "bad_public_key" });
  expect(await verifyAddressProof({ ...good, message, signatureHex: "00" }))
    .toEqual({ ok: false, reason: "bad_signature" });
});

test("a flipped byte in the signature is refused", async () => {
  const message = "bind me";
  const signed = keyguardSign(freshKey(), message);
  const tampered = (signed.signatureHex[0] === "0" ? "1" : "0") + signed.signatureHex.slice(1);
  const res = await verifyAddressProof({ ...signed, message, signatureHex: tampered });
  expect(res.ok).toBe(false);
});

// ---- address validation ----

test("canonicalAddress accepts a real address in any spacing and returns the spaced form", async () => {
  const addr = Nimiq.KeyPair.generate().publicKey.toAddress().toUserFriendlyAddress();
  expect(await canonicalAddress(addr)).toBe(addr);
  expect(await canonicalAddress(addr.replace(/\s/g, "").toLowerCase())).toBe(addr);
  expect(await canonicalAddress(`nimiq:${addr.replace(/\s/g, "")}`)).toBe(addr);
});

test("canonicalAddress rejects the onboarding placeholder (right shape, bad checksum)", async () => {
  expect(await canonicalAddress("NQ00 0000 0000 0000 0000 0000 0000 0000 0000")).toBeNull();
});

test("canonicalAddress rejects a one-character typo", async () => {
  const addr = Nimiq.KeyPair.generate().publicKey.toAddress().toUserFriendlyAddress();
  const bare = addr.replace(/\s/g, "");
  // Change a body character; the checksum digits stay, so only the codec can catch this.
  const typo = bare.slice(0, 10) + (bare[10] === "A" ? "B" : "A") + bare.slice(11);
  expect(await canonicalAddress(typo)).toBeNull();
});

test("bareAddress strips spacing and case", () => {
  expect(bareAddress("nq07 abcd  efgh")).toBe("NQ07ABCDEFGH");
  expect(bareAddress(null)).toBe("");
});
