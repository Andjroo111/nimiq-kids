// Proving that whoever registered an address actually holds its key.
//
// Under parent custody a kid's address arrives from the client, and the client is the
// thing we are least able to trust: `chooseAddress` returns whatever the Hub says, and
// nothing about a bare NQ string tells us the person typing it can spend from it. An
// address registered by mistake (a typo, a screenshot of someone else's wallet, a page
// that was tampered with) would be a hole with no bottom — every payout afterwards goes
// somewhere the family cannot reach, and the app would report each one as a success
// because the chain really did move the money.
//
// So registration carries a signature over a server-issued challenge, and this module is
// the only place that signature is believed. Two facts have to hold together:
//
//   1. the signature verifies against the public key, over OUR message, and
//   2. that public key hashes to the address being registered.
//
// Either one alone proves nothing. (1) without (2) is a valid signature by some other
// account; (2) without (1) is just a public key, which is public.
//
// THE DIGEST IS NOT OURS TO CHOOSE. It has to be byte-identical to what the Nimiq
// Keyguard signs, or every honest proof fails and registration is dead on arrival.
// Read from source rather than remembered (nimiq/keyguard @ master):
//
//   client/src/SignMessagePrefix.ts
//     SIGNED_MESSAGE = '\x16Nimiq Signed Message:\n'   // first byte = length of the rest
//   src/lib/Key.js  signMessage(path, message, prefix)
//     data = utf8(prefix) || utf8(String(message.byteLength)) || message
//     hash = SHA256(data)
//     sig  = Nimiq.Signature.create(privateKey, publicKey, hash)   // signs the HASH
//   src/request/sign-message/SignMessage.js
//     a string request is turned into bytes with Utf8Tools.stringToUtf8ByteArray first
//
// The length is the length in BYTES of the UTF-8 encoding, written in decimal, not the
// number of characters — the two differ the moment a message carries anything non-ASCII.
// `bindingMessage` keeps its output ASCII for exactly that reason, but the encoder here
// is byte-correct either way.

import { getNimiq } from "./client";

/** Keyguard `SignMessagePrefix.SIGNED_MESSAGE`. The leading \x16 is the length (22) of
 *  the text that follows it, and is part of the signed bytes. */
export const SIGN_MESSAGE_PREFIX = "\x16Nimiq Signed Message:\n";

/**
 * Keyguard `SignMessagePrefix.CONNECT_CHALLENGE`, used by `connectAccount`.
 *
 * A separate prefix because a connect challenge is BLIND signed: the parent approves one
 * popup and the Keyguard signs a string it never renders, once per requested key path.
 * Keyguard's own comment says the prefixes exist so that a challenge can never be replayed
 * as a user message, and vice versa. Verifying one against the other's digest fails closed,
 * which is the behaviour we want and the reason this is a distinct constant rather than an
 * argument someone can forget.
 */
export const CONNECT_CHALLENGE_PREFIX = "\x19Nimiq Connect Challenge:\n";

/** Which Keyguard flow produced a signature. `signMessage` and `connectAccount` hash the
 *  same message to different digests, so a proof is meaningless without saying which. */
export type ProofKind = "signed_message" | "connect_challenge";

const PREFIX_FOR: Record<ProofKind, string> = {
  signed_message: SIGN_MESSAGE_PREFIX,
  connect_challenge: CONNECT_CHALLENGE_PREFIX,
};

/** The exact 32 bytes a Keyguard signs for `message` in the given flow. */
export function signedMessageDigest(message: string, kind: ProofKind = "signed_message"): Uint8Array {
  const enc = new TextEncoder();
  const body = enc.encode(message);
  const head = enc.encode(PREFIX_FOR[kind] + String(body.length));
  const data = new Uint8Array(head.length + body.length);
  data.set(head, 0);
  data.set(body, head.length);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return new Uint8Array(hasher.digest());
}

/** Letters only, upper case: the same address is written with and without the display
 *  spacing depending on where it came from, and spacing is not identity. */
export const bareAddress = (a: string | null | undefined): string =>
  (a ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * Is this a real Nimiq address, checksum and all?
 *
 * Shape is not validity. `NQ00 0000 …` (the onboarding placeholder) matches every regex
 * anyone would write and fails its checksum, and a hand-copied address is one keystroke
 * from doing the same. The codec gets the last word here for the same reason
 * `normalizeNqAddress` gives it the last word on a scanned send: it is the check the
 * signer would eventually apply, and applying it while refusing is still free.
 *
 * Returns the canonical spaced form, or null.
 */
export async function canonicalAddress(raw: string): Promise<string | null> {
  const bare = bareAddress(raw.replace(/^nimiq:/i, ""));
  if (!/^NQ[0-9A-Z]{34}$/.test(bare)) return null;
  try {
    const Nimiq = await getNimiq();
    return Nimiq.Address.fromUserFriendlyAddress(bare).toUserFriendlyAddress();
  } catch {
    return null;
  }
}

export type ProofFailure =
  /** publicKeyHex is not 32 bytes of hex */
  | "bad_public_key"
  /** signatureHex is not 64 bytes of hex */
  | "bad_signature"
  /** the signature does not verify against that key over our message */
  | "signature_mismatch"
  /** the key is genuine but belongs to a different address than the one claimed */
  | "address_mismatch";

export interface AddressProof {
  /** The address being claimed (any spacing). */
  address: string;
  /** The challenge string, verbatim as the server issued and stored it. */
  message: string;
  /** `SignedMessage.signerPublicKey`, hex. */
  publicKeyHex: string;
  /** `SignedMessage.signature`, hex. */
  signatureHex: string;
  /** Which Keyguard flow signed it. Defaults to `signMessage`, the original path. */
  kind?: ProofKind;
}

export type ProofResult = { ok: true } | { ok: false; reason: ProofFailure };

/**
 * Verify a wallet-ownership proof. Offline: no chain read, no network.
 *
 * Deliberately returns a reason rather than throwing, because the caller stores the
 * result of the attempt and the reason is the useful half — "you signed with the wrong
 * address" and "that signature is not valid" send a parent to two different places.
 */
export async function verifyAddressProof(proof: AddressProof): Promise<ProofResult> {
  const Nimiq = await getNimiq();

  // `Signature` has a private constructor, so InstanceType<> cannot name its type. The
  // return types of the two `fromHex` calls are the same thing and are inferred here.
  let publicKey: ReturnType<typeof Nimiq.PublicKey.fromHex>;
  try {
    publicKey = Nimiq.PublicKey.fromHex(proof.publicKeyHex.trim());
  } catch {
    return { ok: false, reason: "bad_public_key" };
  }

  let signature: ReturnType<typeof Nimiq.Signature.fromHex>;
  try {
    signature = Nimiq.Signature.fromHex(proof.signatureHex.trim());
  } catch {
    return { ok: false, reason: "bad_signature" };
  }

  if (!publicKey.verify(signature, signedMessageDigest(proof.message, proof.kind ?? "signed_message"))) {
    return { ok: false, reason: "signature_mismatch" };
  }
  // The key is real and it signed our challenge. It still has to be THIS address's key.
  if (bareAddress(publicKey.toAddress().toUserFriendlyAddress()) !== bareAddress(proof.address)) {
    return { ok: false, reason: "address_mismatch" };
  }
  return { ok: true };
}
