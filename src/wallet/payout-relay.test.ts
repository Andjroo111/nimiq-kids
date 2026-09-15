// Relaying a payout the parent signed.
//
// The relay is the one place a server that cannot forge a signature can still misbehave: by
// putting something other than what it published on the wire, or by putting the same work on
// the wire twice. Both are tested here against real signed bytes.
//
// Hermetic: in-memory DB, offline crypto, no network. `broadcast` is the seam, so the real
// decision path runs with a recording stub in place of a node — nothing is ever broadcast.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb } from "../db";
import * as repo from "../repo";
import * as wrepo from "../repo-wallet";
import { getNimiq } from "../nimiq/client";
import { mintPayoutIntent, type PayoutIntent } from "./payout-intent";
import { relayParentSignedPayout } from "./payout-relay";

const PARENT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const KID = "NQ02 SXUJ Y9D0 UDSK L1J8 N1U4 69NB 69X4 KU3T";
const NETWORK_ID = 5;

beforeEach(() => {
  initTestDb();
});

/** A household whose parent_address is a key we can actually sign with. */
async function household() {
  const Nimiq = await getNimiq();
  const kp = Nimiq.KeyPair.generate();
  const parentAddress = kp.toAddress().toUserFriendlyAddress();
  const fam = repo.createFamily("Parent", parentAddress);
  const child = repo.createChild(fam.id, "Ivy");
  wrepo.setChildAddress(child.id, KID);
  return { fam, child: repo.getChild(child.id)!, kp };
}

type KeyPair = Awaited<ReturnType<typeof getNimiq>>["KeyPair"]["prototype"];

async function signFor(intent: PayoutIntent, kp: KeyPair, over: {
  valueLuna?: number; recipient?: string; height?: number; data?: string;
} = {}) {
  const Nimiq = await getNimiq();
  const tx = Nimiq.TransactionBuilder.newBasicWithData(
    kp.toAddress(),
    Nimiq.Address.fromUserFriendlyAddress(over.recipient ?? intent.recipient),
    new TextEncoder().encode(over.data ?? intent.data),
    BigInt(over.valueLuna ?? intent.valueLuna),
    0n,
    over.height ?? intent.validityStartHeight,
    NETWORK_ID,
  );
  tx.sign(kp, undefined);
  return tx.toHex();
}

function recorder() {
  const sent: string[] = [];
  return { sent, broadcast: async (hex: string) => { sent.push(hex); return "hash"; } };
}

async function mint(ref = "chore:c1") {
  const { fam, child, kp } = await household();
  const res = mintPayoutIntent({
    ref, fam, sender: fam.parent_address, child, valueLuna: 500, message: "Take out the trash", headHeight: 900,
  });
  return { fam, child, kp, intent: (res as { ok: true; intent: PayoutIntent }).intent };
}

test("a matching signature is broadcast, and the earn row is PENDING with that hash", async () => {
  const { fam, kp, intent } = await mint();
  const hex = await signFor(intent, kp);
  const rec = recorder();

  const res = await relayParentSignedPayout({
    fam, intent, serializedTx: hex, broadcast: rec.broadcast, networkId: NETWORK_ID,
  });
  expect(res.ok).toBe(true);
  expect(rec.sent).toEqual([hex]);

  const event = (res as { event: wrepo.WalletEvent }).event;
  // PENDING, never done: a node accepting a transaction is not proof it executed, and the
  // proof is sweepPendingEarns reading the receipt for this exact hash.
  expect(event.status).toBe("pending");
  expect(event.kind).toBe("earn");
  expect(event.value_luna).toBe(500);
  expect(event.payout_ref).toBe("chore:c1");
  expect(event.tx_hash).toBe((res as { txHash: string }).txHash);
  // And it is visible to the sweep, which is what actually settles it.
  expect(wrepo.childIdsWithPendingEarns()).toContain(event.child_id!);
});

test("the bytes are durable BEFORE they reach the wire", async () => {
  const { fam, kp, intent } = await mint();
  const hex = await signFor(intent, kp);
  const armedAtBroadcast: (string | null)[] = [];

  await relayParentSignedPayout({
    fam, intent, serializedTx: hex, networkId: NETWORK_ID,
    broadcast: async (h) => {
      // Read the claim from INSIDE the broadcast: if the arm happened afterwards, a lost
      // response here would leave no record of what was sent, and the retry would have to
      // ask the parent to sign again at a fresh height. Two byte-different transactions for
      // one chore dedupe against nothing on chain.
      armedAtBroadcast.push(wrepo.getPayoutAttempt("chore:c1")?.raw_tx_hex ?? null);
      return h;
    },
  });
  expect(armedAtBroadcast).toEqual([hex]);
});

test("re-posting the same bytes replays them and never writes a second earn row", async () => {
  const { fam, kp, intent } = await mint();
  const hex = await signFor(intent, kp);
  const rec = recorder();

  const first = await relayParentSignedPayout({ fam, intent, serializedTx: hex, broadcast: rec.broadcast, networkId: NETWORK_ID });
  const second = await relayParentSignedPayout({ fam, intent, serializedTx: hex, broadcast: rec.broadcast, networkId: NETWORK_ID });
  expect(first.ok && second.ok).toBe(true);
  expect((first as { event: wrepo.WalletEvent }).event.id)
    .toBe((second as { event: wrepo.WalletEvent }).event.id);
  expect((second as { replayed: boolean }).replayed).toBe(true);
  // The ledger row for the ref short-circuits, so nothing goes back on the wire.
  expect(rec.sent).toEqual([hex]);
});

test("DIFFERENT bytes for a payout already in flight are refused, not broadcast", async () => {
  const { fam, kp, intent } = await mint();
  const rec = recorder();
  // Arm the claim as though a first relay had gone out and the ledger row had not landed.
  wrepo.armPayoutAttempt("chore:c1", "aa".repeat(20), "firsthash");

  const hex = await signFor(intent, kp);
  const res = await relayParentSignedPayout({ fam, intent, serializedTx: hex, broadcast: rec.broadcast, networkId: NETWORK_ID });
  expect(res).toEqual({ ok: false, error: "different_bytes_already_broadcast", txHash: "firsthash" });
  expect(rec.sent).toEqual([]);
  // And the first attempt's bytes are untouched, so they stay replayable.
  expect(wrepo.getPayoutAttempt("chore:c1")?.raw_tx_hex).toBe("aa".repeat(20));
});

test("a transaction that does not match the intent never reaches the wire", async () => {
  const { fam, kp, intent } = await mint();
  const rec = recorder();
  for (const [label, over] of [
    ["overpays", { valueLuna: 5_000_000 }],
    ["pays somewhere else", { recipient: PARENT }],
    ["a different height", { height: 901 }],
    ["a different message", { data: "something else entirely" }],
  ] as const) {
    const hex = await signFor(intent, kp, over);
    const res = await relayParentSignedPayout({ fam, intent, serializedTx: hex, broadcast: rec.broadcast, networkId: NETWORK_ID });
    expect({ label, ok: res.ok }).toEqual({ label, ok: false });
    expect({ label, error: (res as { error: string }).error }).toEqual({ label, error: "tx_mismatch" });
  }
  expect(rec.sent).toEqual([]);
  // Nothing was armed either: a refused relay must leave the claim retriable.
  expect(wrepo.getPayoutAttempt("chore:c1")?.status).toBe("preparing");
  expect(wrepo.walletEventForPayoutRef("chore:c1")).toBeNull();
});

test("another family's intent is refused even with a perfectly valid signature", async () => {
  const { kp, intent } = await mint();
  const other = repo.createFamily("Someone Else", PARENT);
  const rec = recorder();
  const hex = await signFor(intent, kp);

  const res = await relayParentSignedPayout({
    fam: other, intent, serializedTx: hex, broadcast: rec.broadcast, networkId: NETWORK_ID,
  });
  // Without this, a parent-authed caller could post a real signature for somebody else's
  // intent and have the earn row written into their OWN family's ledger.
  expect(res).toEqual({ ok: false, error: "not_your_intent" });
  expect(rec.sent).toEqual([]);
});

test("unparseable bytes are refused as invalid, distinctly from a mismatch", async () => {
  const { fam, intent } = await mint();
  const rec = recorder();
  const res = await relayParentSignedPayout({
    fam, intent, serializedTx: "00ff", broadcast: rec.broadcast, networkId: NETWORK_ID,
  });
  expect(res).toEqual({ ok: false, error: "invalid_tx" });
  expect(rec.sent).toEqual([]);
});

test("an expired intent is refused, and the refusal names the expiry", async () => {
  const { fam, kp, intent } = await mint();
  const rec = recorder();
  const hex = await signFor(intent, kp);
  const res = await relayParentSignedPayout({
    fam, intent, serializedTx: hex, broadcast: rec.broadcast, networkId: NETWORK_ID,
    now: intent.expiresAt + 1,
  });
  expect((res as { error: string }).error).toBe("tx_mismatch");
  expect((res as { reason: string }).reason).toBe("expired");
  expect(rec.sent).toEqual([]);
});

test("a broadcast that throws leaves the bytes recorded, so the retry replays them", async () => {
  const { fam, kp, intent } = await mint();
  const hex = await signFor(intent, kp);
  await expect(relayParentSignedPayout({
    fam, intent, serializedTx: hex, networkId: NETWORK_ID,
    broadcast: async () => { throw new Error("rpc_unreachable"); },
  })).rejects.toThrow("rpc_unreachable");

  // In flight with the exact bytes: whether they reached a node is unknowable, so the only
  // safe retry is putting THESE bytes back on the wire. A chain cannot apply one transaction
  // twice, so that is free; rebuilding would not be.
  const attempt = wrepo.getPayoutAttempt("chore:c1")!;
  expect(attempt.status).toBe("in_flight");
  expect(attempt.raw_tx_hex).toBe(hex);

  const rec = recorder();
  const retry = await relayParentSignedPayout({ fam, intent, serializedTx: hex, broadcast: rec.broadcast, networkId: NETWORK_ID });
  expect(retry.ok).toBe(true);
  expect(rec.sent).toEqual([hex]);
  expect((retry as { replayed: boolean }).replayed).toBe(true);
});
