// A payout the parent signs and the server can only relay.
//
// Two kinds of evidence here, and the split is deliberate.
//
//   1. A transaction a REAL Nimiq Keyguard actually signed, captured from the Q1 spike against
//      the deployed testnet Hub on 2026-08-02, is checked against a matching intent. Every
//      other test in this file builds its own transactions, and a verifier that only ever
//      agrees with our own builder has proven that our builder and our verifier share an
//      opinion, not that a parent's wallet can pay a child. This fixture is the only thing in
//      the suite that closes that gap.
//   2. Field-by-field mutations. `verifySignedPayout` is a conjunction, and a dropped clause
//      in a conjunction is invisible to any test that only ever feeds it correct input: it
//      still returns ok, and the suite still passes. So each field is mutated on its own and
//      the SPECIFIC refusal is asserted, which is what would fail if a clause went missing.
//
// Hermetic: in-memory DB, offline crypto, no network, no funds, nothing broadcast.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb } from "../db";
import * as repo from "../repo";
import * as wrepo from "../repo-wallet";
import { getNimiq } from "../nimiq/client";
import {
  PAYOUT_INTENT_TTL_MS,
  getPayoutIntent,
  mintPayoutIntent,
  parseSignedPayout,
  payoutDataHex,
  payoutExtraData,
  verifySignedPayout,
  type PayoutIntent,
} from "./payout-intent";

const PARENT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const KID = "NQ02 SXUJ Y9D0 UDSK L1J8 N1U4 69NB 69X4 KU3T";
const NETWORK_ID = 5; // testalbatross, pinned so the suite never depends on ambient env

beforeEach(() => {
  initTestDb();
});

function household(kidAddress = KID) {
  const fam = repo.createFamily("Parent", PARENT);
  const child = repo.createChild(fam.id, "Ivy");
  wrepo.setChildAddress(child.id, kidAddress);
  return { fam, child: repo.getChild(child.id)! };
}

/** Build and sign a real basic transfer offline, so a test can produce exact bytes. */
async function signTx(opts: {
  recipient: string;
  valueLuna: number;
  data: string;
  height: number;
  feeLuna?: number;
  networkId?: number;
}): Promise<{ hex: string; sender: string }> {
  const Nimiq = await getNimiq();
  const kp = Nimiq.KeyPair.generate();
  const tx = Nimiq.TransactionBuilder.newBasicWithData(
    kp.toAddress(),
    Nimiq.Address.fromUserFriendlyAddress(opts.recipient),
    new TextEncoder().encode(opts.data),
    BigInt(opts.valueLuna),
    BigInt(opts.feeLuna ?? 0),
    opts.height,
    opts.networkId ?? NETWORK_ID,
  );
  tx.sign(kp, undefined);
  return { hex: tx.toHex(), sender: kp.toAddress().toUserFriendlyAddress() };
}

// ---- the intent claim ----

test("minting an intent claims the ref and records every field the signer must reproduce", () => {
  const { fam, child } = household();
  const res = mintPayoutIntent({
    ref: "chore:c1", fam, sender: fam.parent_address, child, valueLuna: 500, message: "Take out the trash", headHeight: 900,
    now: 1_000_000,
  });
  expect(res.ok).toBe(true);
  const intent = (res as { ok: true; intent: PayoutIntent }).intent;
  expect(intent).toMatchObject({
    intentId: "chore:c1",
    familyId: fam.id,
    childId: child.id,
    sender: PARENT,
    recipient: KID,
    valueLuna: 500,
    feeLuna: 0,
    data: "Take out the trash",
    validityStartHeight: 900,
    expiresAt: 1_000_000 + PAYOUT_INTENT_TTL_MS,
  });
  // The claim and the intent are the same row: reading it back must not invent a second one.
  expect(getPayoutIntent("chore:c1")).toEqual(intent);
});

test("a second tap on the same payout is refused BEFORE a wallet opens, and hands back the first intent", () => {
  const { fam, child } = household();
  const first = mintPayoutIntent({ ref: "chore:c1", fam, sender: fam.parent_address, child, valueLuna: 500, message: "x", headHeight: 900 });
  const second = mintPayoutIntent({ ref: "chore:c1", fam, sender: fam.parent_address, child, valueLuna: 500, message: "x", headHeight: 901 });
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(false);
  expect((second as { error: string }).error).toBe("already_claimed");
  // Same row, so the SAME pinned height: a second popup would otherwise sign different bytes
  // for the same work, and two different transactions dedupe against nothing on chain.
  expect((second as { intent: PayoutIntent | null }).intent?.validityStartHeight).toBe(900);
});

test("an intent that expired without ever being signed can be re-minted", () => {
  const { fam, child } = household();
  const first = mintPayoutIntent({
    ref: "chore:c1", fam, sender: fam.parent_address, child, valueLuna: 500, message: "x", headHeight: 900, now: 1_000,
  });
  expect(first.ok).toBe(true);

  // Still inside the window: the same intent comes back, height and all. A fresh height here
  // would mean two signable transactions for one chore.
  const during = mintPayoutIntent({
    ref: "chore:c1", fam, sender: fam.parent_address, child, valueLuna: 500, message: "x", headHeight: 950,
    now: 1_000 + PAYOUT_INTENT_TTL_MS - 1,
  });
  expect((during as { error: string }).error).toBe("already_claimed");
  expect((during as { intent: PayoutIntent | null }).intent?.validityStartHeight).toBe(900);

  // Past it, with nothing ever armed, the work must not be stranded: the ref is claimed and
  // the claim would otherwise only ever hand back a dead intent no wallet would sign.
  const after = mintPayoutIntent({
    ref: "chore:c1", fam, sender: fam.parent_address, child, valueLuna: 500, message: "x", headHeight: 1_400,
    now: 1_000 + PAYOUT_INTENT_TTL_MS + 1,
  });
  expect(after.ok).toBe(true);
  expect((after as { ok: true; intent: PayoutIntent }).intent.validityStartHeight).toBe(1_400);
});

test("an expired intent whose bytes were already broadcast is NEVER re-minted", () => {
  const { fam, child } = household();
  mintPayoutIntent({ ref: "chore:c1", fam, sender: fam.parent_address, child, valueLuna: 500, message: "x", headHeight: 900, now: 1_000 });
  // Bytes recorded: this payout may already have paid, and re-minting would build a second,
  // byte-different transaction that dedupes against nothing on chain.
  wrepo.armPayoutAttempt("chore:c1", "deadbeef", "hash");

  const after = mintPayoutIntent({
    ref: "chore:c1", fam, sender: fam.parent_address, child, valueLuna: 500, message: "x", headHeight: 1_400,
    now: 1_000 + PAYOUT_INTENT_TTL_MS + 1,
  });
  expect(after.ok).toBe(false);
  expect((after as { error: string }).error).toBe("already_claimed");
  expect(wrepo.getPayoutAttempt("chore:c1")?.raw_tx_hex).toBe("deadbeef");
});

test("a payout to the family's own wallet is refused at mint, not discovered at broadcast", () => {
  const { fam, child } = household(PARENT);
  const res = mintPayoutIntent({ ref: "chore:c1", fam, sender: fam.parent_address, child, valueLuna: 500, message: "x", headHeight: 900 });
  expect(res).toEqual({ ok: false, error: "pays_self" });
  // Nothing claimed: the ref stays free for a retry once the address is fixed.
  expect(wrepo.getPayoutAttempt("chore:c1")).toBeNull();
});

test("a kid with no address, or a family with no wallet, refuses rather than minting a half-intent", () => {
  const fam = repo.createFamily("Parent", PARENT);
  const child = repo.getChild(repo.createChild(fam.id, "Ivy").id)!;
  expect(mintPayoutIntent({ ref: "r1", fam, sender: fam.parent_address, child, valueLuna: 1, message: "x", headHeight: 9 }))
    .toEqual({ ok: false, error: "no_kid_address" });

  const { child: kid } = household();
  const noWallet = { ...repo.createFamily("Parent", PARENT), parent_address: "" };
  expect(mintPayoutIntent({ ref: "r2", fam: noWallet, sender: noWallet.parent_address, child: kid, valueLuna: 1, message: "x", headHeight: 9 }))
    .toEqual({ ok: false, error: "no_parent_address" });
});

test("a server-signed attempt is not an intent, however hard you squint at the row", () => {
  const { fam, child } = household();
  wrepo.claimPayoutAttempt({
    ref: "chore:old", familyId: fam.id, childId: child.id, valueLuna: 5, recipient: KID, message: "x",
  });
  // The row exists and is a perfectly good claim; it just carries no signer, no pinned height
  // and no expiry, and reading it as an intent would invent all three.
  expect(wrepo.getPayoutAttempt("chore:old")).not.toBeNull();
  expect(getPayoutIntent("chore:old")).toBeNull();
});

// ---- verification against a transaction a real Keyguard signed ----

test("a transaction the REAL Nimiq Keyguard signed verifies against its intent", async () => {
  // Captured 2026-08-02 from the Q1 spike, deployed testnet Hub + Keyguard, never broadcast.
  // sender NQ02 SXUJ… -> recipient NQ69 7ADV…, 1 luna, fee 0, height 7683816, no data.
  const KEYGUARD_SIGNED =
    "00002e3ef5b00b58492fc3bd305d9a92e3dd160e8273d290113e7b4c622021c203dc3a9bd1844df1d8a242ec6eb"
    + "dffce9a4407f7b7060000000000000001000000000000000000753ee805681a7a1390d04964d063df3a1914f586"
    + "17aa40b920b7af8ba637b5b32456a3cb2638f09712a360b4cc903f78e637c074b800fc932c41f601bde1b162e27"
    + "1450f";
  const parsed = await parseSignedPayout(KEYGUARD_SIGNED);
  expect(parsed).not.toBeNull();
  // The accessors, pinned. `toPlain()` reports senderType as the STRING "basic" and omits
  // networkId on @nimiq/core 2.5.1, so a verifier reading the plain form would compare
  // Number("basic") and undefined, and fail open on the network while failing closed on
  // every valid transaction. This assertion is what would catch that swap.
  expect(parsed).toMatchObject({
    sender: "NQ02 SXUJ Y9D0 UDSK L1J8 N1U4 69NB 69X4 KU3T",
    recipient: "NQ69 7ADV 312D X7CA 4GPC DSXY YKLS 8G3Y FDQ6",
    senderType: 0, recipientType: 0, flags: 0,
    valueLuna: 1, feeLuna: 0, validityStartHeight: 7683816, networkId: 5, dataHex: "",
    txHash: "4e1bfb1f4d4f6f03a4a4c82fd4150e1fb9005eeebc75c58af675696b3d36c9d9",
  });

  const intent: PayoutIntent = {
    intentId: "chore:keyguard", familyId: "f", childId: "c",
    sender: "NQ02 SXUJ Y9D0 UDSK L1J8 N1U4 69NB 69X4 KU3T",
    recipient: "NQ69 7ADV 312D X7CA 4GPC DSXY YKLS 8G3Y FDQ6",
    valueLuna: 1, feeLuna: 0, data: "", validityStartHeight: 7683816, expiresAt: 2_000_000,
    nettedLuna: 0, grossLuna: 1,
  };
  expect(verifySignedPayout(intent, parsed!, { now: 1_000_000, networkId: 5 })).toEqual({ ok: true });
});

test("unparseable bytes are a parse failure, not a mismatch", async () => {
  expect(await parseSignedPayout("")).toBeNull();
  expect(await parseSignedPayout("not hex at all")).toBeNull();
  expect(await parseSignedPayout("00ff")).toBeNull();
});

// ---- verification, field by field ----

async function goodPair(over: Partial<PayoutIntent> = {}) {
  const height = 900;
  const data = "Take out the trash";
  const signed = await signTx({ recipient: KID, valueLuna: 500, data, height });
  const intent: PayoutIntent = {
    intentId: "chore:c1", familyId: "f", childId: "c",
    sender: signed.sender, recipient: KID, valueLuna: 500, feeLuna: 0,
    data, validityStartHeight: height, expiresAt: 2_000_000, nettedLuna: 0, grossLuna: 500, ...over,
  };
  return { intent, tx: (await parseSignedPayout(signed.hex))! };
}

test("a matching transaction passes", async () => {
  const { intent, tx } = await goodPair();
  expect(verifySignedPayout(intent, tx, { now: 1_000_000, networkId: NETWORK_ID })).toEqual({ ok: true });
});

test("every field the intent pins is actually checked", async () => {
  const cases: Array<[string, Partial<PayoutIntent>]> = [
    ["sender_mismatch", { sender: "NQ09 0000 0000 0000 0000 0000 0000 0000 0000" }],
    ["recipient_mismatch", { recipient: "NQ07 0000 0000 0000 0000 0000 0000 0000 0000" }],
    ["value_mismatch", { valueLuna: 499 }],
    ["fee_mismatch", { feeLuna: 1 }],
    ["validity_height_mismatch", { validityStartHeight: 901 }],
    ["data_mismatch", { data: "Take out the trash!" }],
  ];
  for (const [reason, over] of cases) {
    const { intent, tx } = await goodPair(over);
    const v = verifySignedPayout(intent, tx, { now: 1_000_000, networkId: NETWORK_ID });
    expect({ reason, v: v.ok }).toEqual({ reason, v: false });
    expect((v as { reason: string }).reason).toBe(reason);
  }
});

test("overpaying the child is refused as hard as underpaying", async () => {
  // The obvious wrong shape for a value check is `>=`, which reads as generous and lets a
  // client empty the parent's wallet into an address the parent did approve.
  const { intent, tx } = await goodPair({ valueLuna: 1 });
  const v = verifySignedPayout(intent, tx, { now: 1_000_000, networkId: NETWORK_ID });
  expect(v).toEqual({ ok: false, reason: "value_mismatch", expected: 1, got: 500 });
});

test("a transaction on the wrong network is refused", async () => {
  const { intent, tx } = await goodPair();
  const v = verifySignedPayout(intent, tx, { now: 1_000_000, networkId: 24 });
  expect(v).toEqual({ ok: false, reason: "network_mismatch", expected: 24, got: 5 });
});

test("an expired intent is refused before anything else is even compared", async () => {
  const { intent, tx } = await goodPair();
  const v = verifySignedPayout(intent, tx, { now: intent.expiresAt + 1, networkId: NETWORK_ID });
  expect(v.ok).toBe(false);
  expect((v as { reason: string }).reason).toBe("expired");
});

test("a transaction that matches every amount but is NOT a plain transfer is refused", async () => {
  // The dangerous substitution is the one where every number a parent could read off the
  // confirmation screen is correct and the account TYPE is not: same sender, same recipient,
  // same value, same fee, same height, same data, but the recipient is the staking contract
  // rather than a basic account, so the money goes somewhere the parent never agreed to and
  // only comes back through a 24-hour cooldown. Nothing in the amounts can catch that.
  //
  // Without this case the whole `not_a_basic_transfer` clause can be deleted and the rest of
  // this file still passes, which is exactly what a mutation run showed.
  const Nimiq = await getNimiq();
  const kp = Nimiq.KeyPair.generate();
  const stake = Nimiq.TransactionBuilder.newCreateStaker(
    kp.toAddress(),
    Nimiq.Address.fromUserFriendlyAddress(KID), // delegate target; irrelevant to this assertion
    500n, 0n, 900, NETWORK_ID,
  );
  stake.sign(kp, undefined);
  const tx = (await parseSignedPayout(stake.toHex()))!;
  expect(tx).not.toBeNull();
  expect(tx.recipientType).not.toBe(0); // it really is a staking transaction

  // Built FROM the parsed transaction, so every amount agrees by construction and the type is
  // the only thing left that can refuse it.
  const intent: PayoutIntent = {
    intentId: "chore:c1", familyId: "f", childId: "c",
    sender: tx.sender, recipient: tx.recipient, valueLuna: tx.valueLuna, feeLuna: tx.feeLuna,
    data: "", validityStartHeight: tx.validityStartHeight, expiresAt: 2_000_000,
    nettedLuna: 0, grossLuna: tx.valueLuna,
  };
  const v = verifySignedPayout(intent, tx, { now: 1_000_000, networkId: NETWORK_ID });
  expect(v.ok).toBe(false);
  expect((v as { reason: string }).reason).toBe("not_a_basic_transfer");
});

test("address spacing and case are not a mismatch", async () => {
  const { intent, tx } = await goodPair();
  const spaced = { ...intent, recipient: KID.replace(/\s/g, "").toLowerCase() };
  expect(verifySignedPayout(spaced, tx, { now: 1_000_000, networkId: NETWORK_ID })).toEqual({ ok: true });
});

// ---- the data field ----

test("the data comparison is over BYTES, not characters", () => {
  // Every message a chore can carry today is ASCII, where the two agree, so this is the one
  // place the difference is visible at all. A character-indexed comparison would call these
  // equal-length and let a payload through that the parent's wallet never signed.
  expect(payoutDataHex("é")).toBe("c3a9");
  expect(payoutDataHex("é").length / 2).toBe(2);
  expect("é".length).toBe(1);
});

test("extraData truncation has ONE definition, and it is the one the intent stores", () => {
  const long = "x".repeat(100);
  expect(payoutExtraData(long)).toHaveLength(64);
  const { fam, child } = household();
  const res = mintPayoutIntent({ ref: "chore:long", fam, sender: fam.parent_address, child, valueLuna: 1, message: long, headHeight: 9 });
  expect((res as { ok: true; intent: PayoutIntent }).intent.data).toBe(payoutExtraData(long));
});

test("a long chore title survives the round trip through a real signature", async () => {
  const message = "Sweep the whole garage and put the bikes away before dinner tonight please";
  const data = payoutExtraData(message);
  const signed = await signTx({ recipient: KID, valueLuna: 42, data, height: 77 });
  const tx = (await parseSignedPayout(signed.hex))!;
  const intent: PayoutIntent = {
    intentId: "chore:c1", familyId: "f", childId: "c", sender: signed.sender,
    recipient: KID, valueLuna: 42, feeLuna: 0, data, validityStartHeight: 77, expiresAt: 2_000_000,
    nettedLuna: 0, grossLuna: 42,
  };
  expect(verifySignedPayout(intent, tx, { now: 1, networkId: NETWORK_ID })).toEqual({ ok: true });
  // And the untruncated title must NOT verify, or the truncation is doing nothing.
  expect(verifySignedPayout({ ...intent, data: message }, tx, { now: 1, networkId: NETWORK_ID }).ok).toBe(false);
});
