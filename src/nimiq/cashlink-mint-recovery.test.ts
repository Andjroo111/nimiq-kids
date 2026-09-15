// A Cashlink mint must never destroy the only copy of its own key.
//
// The key lives in the URL fragment and nowhere else. It used to be derived AFTER the
// broadcast and the funding wait, so a throw in that window left real NIM at an address
// whose key existed only as a dead local variable. That happened on mainnet on 2026-08-01:
// the broadcast aborted client-side at the sender's 15 s timeout, the chain executed the
// transfer anyway, and 0.1 NIM is permanently unspendable.
//
// These pin the two properties that make that impossible: the key survives a failed
// broadcast, and it is reachable by the caller.

import { test, expect } from "bun:test";
import { CashlinkMintError, mintCashlink } from "./cashlink";
import { decodeCashlinkPayload, payloadFromUrl } from "./cashlink-codec";
import type { WalletProvider } from "../wallet";

const LUNA = 12_345;

/** A provider whose broadcast fails the way the real one did: it throws, and the caller
 *  cannot tell whether the chain took the transaction. */
function abortingProvider(): WalletProvider {
  return {
    getAddress: async () => "NQ07 0000 0000 0000 0000 0000 0000 0000 0000",
    sendTransaction: async () => { throw new Error("The operation was aborted."); },
  } as unknown as WalletProvider;
}

test("a broadcast that aborts still yields the cashlink key", async () => {
  let err: unknown;
  try {
    await mintCashlink(abortingProvider(), LUNA, "spike");
  } catch (e) { err = e; }

  expect(err).toBeInstanceOf(CashlinkMintError);
  const e = err as CashlinkMintError;

  // The whole point: the key is recoverable from the error.
  expect(e.url).toContain("#");
  expect(e.cashlinkAddress).toMatch(/^NQ/);
  expect(e.valueLuna).toBe(LUNA);
  // The broadcast call itself threw, so we have no hash and must NOT claim one.
  expect(e.fundingTxHash).toBeNull();
});

test("the recovered URL actually decodes to a usable key for that address", async () => {
  // A URL that cannot be decoded back into the spending key is worthless, so assert the
  // round trip rather than merely that a string exists.
  let e: CashlinkMintError | undefined;
  try {
    await mintCashlink(abortingProvider(), LUNA, "spike");
  } catch (x) { e = x as CashlinkMintError; }
  expect(e).toBeDefined();

  const decoded = decodeCashlinkPayload(payloadFromUrl(e!.url));
  expect(decoded.value).toBe(LUNA);

  const Nimiq = await import("@nimiq/core");
  const kp = Nimiq.KeyPair.derive(Nimiq.PrivateKey.deserialize(decoded.priv));
  // The key in the URL must control the address the money was sent to.
  expect(kp.toAddress().toUserFriendlyAddress()).toBe(e!.cashlinkAddress);
});

test("the error does NOT claim to know whether money moved", async () => {
  // Deliberately pinned. `provider.sendTransaction` bundles build, sign and broadcast, so a
  // transaction that was never built is indistinguishable from one whose broadcast response
  // was lost. A null fundingTxHash therefore means "unknown", NOT "nothing moved" — the real
  // mainnet incident had a null hash and the transfer executed.
  //
  // If this ever becomes decidable (splitting WalletProvider, or a write-ahead claim), the
  // peer-gift refund in routes/cashlinks.ts can finally be made correct. Until then, nothing
  // may branch a refund on this error.
  let e: CashlinkMintError | undefined;
  try {
    await mintCashlink(abortingProvider(), LUNA, "spike");
  } catch (x) { e = x as CashlinkMintError; }

  expect(e).toBeInstanceOf(CashlinkMintError);
  expect(e!.fundingTxHash).toBeNull();      // build failure AND lost response both land here
  expect(e!.url).toContain("#");            // ...and the key survives either way
});
