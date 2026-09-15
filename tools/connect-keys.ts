// A stand-in Keyguard for the batch-connect browser proof.
//
//   bun run tools/connect-keys.ts "<challenge>" <count>
//
// Prints a JSON array of `{ signer, publicKeyHex, signatureHex }` — exactly the shape
// `window.hatchParentShell.hub.connectAccount` resolves with — one entry per requested key
// path, every one signing the SAME challenge, which is what makes the batch weaker evidence
// than the per-child route in the first place.
//
// It exists because the Nimiq Hub cannot open in headless Chromium and a made-up signature is
// refused by the server (correctly): without real bytes the proof would stop at the popup and
// never reach the endpoint it is meant to exercise. The keys here are fresh and thrown away;
// they are NOT derived from anyone's recovery phrase, which is the one thing the real Keyguard
// does that this does not. Everything downstream of the signature — the challenge, the
// verifier, the all-or-nothing write, the screens — is the real app.
//
// Never point this at anything but a throwaway instance.

import { CONNECT_CHALLENGE_PREFIX } from "../src/nimiq/address-proof";

const Nimiq = await import("@nimiq/core");

const message = process.argv[2] ?? "";
const count = Number(process.argv[3] ?? 1);
if (!message || !Number.isInteger(count) || count < 1) {
  console.error('usage: bun run tools/connect-keys.ts "<challenge>" <count>');
  process.exit(2);
}

const out = Array.from({ length: count }, () => {
  const privateKey = Nimiq.KeyPair.generate().privateKey;
  const publicKey = Nimiq.PublicKey.derive(privateKey);

  // The Keyguard's own framing: prefix + byte length + body, sha256, then Ed25519 over that.
  const enc = new TextEncoder();
  const body = enc.encode(message);
  const head = enc.encode(CONNECT_CHALLENGE_PREFIX + String(body.length));
  const data = new Uint8Array(head.length + body.length);
  data.set(head, 0);
  data.set(body, head.length);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);

  return {
    signer: publicKey.toAddress().toUserFriendlyAddress(),
    publicKeyHex: publicKey.toHex(),
    signatureHex: Nimiq.Signature.create(privateKey, publicKey, new Uint8Array(hasher.digest())).toHex(),
  };
});

console.log(JSON.stringify(out));
