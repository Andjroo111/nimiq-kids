// Sweep the mainnet hot wallet back to a destination address.
//
//   bun run src/scripts/sweep-hot-wallet.ts "<NQ… destination>" --yes
//   bun run src/scripts/sweep-hot-wallet.ts "<NQ… destination>" --dry-run
//
// --dry-run does everything except broadcast: it reads the balance, builds and SIGNS the
// transaction, and prints the hash and hex. Use it to prove the key, the destination and
// the node are all good before moving anything.
//
// Emptying the hot wallet is a real operation, not a test fixture. The instance holds a
// funded key so it can pay chore rewards, and NIM should not sit on an internet-facing box
// for longer than it is needed — this is how it gets taken off, and how the wallet is
// drained before decommissioning or rotating the key.
//
// Two deliberate choices:
//
// 1. It builds its OWN RpcSender rather than reusing getClient(). Both now pass a real
//    timeout (v0.61.0 gave the shared sender HATCH_RPC_SENDER_TIMEOUT_MS, default 60s), but
//    a manual sweep is a one-shot operation with a human watching, so it gets its own
//    SWEEP_TIMEOUT_MS at 120s. Waiting longer costs nothing here and an abort costs a lot:
//    aborting never undoes a broadcast, it only destroys our knowledge of one.
//
// 2. It prints the signed hex BEFORE broadcasting, and confirms by RE-READING THE BALANCE
//    rather than trusting the call's return value. If the broadcast call fails, the chain
//    may still have accepted it — that exact case stranded 0.1 NIM on 2026-08-01. So the
//    hex is recoverable, and the check is the ledger, not the response.

import { createRpcSender } from "nimiq-settlement";

const DEST = process.argv[2];
const YES = process.argv.includes("--yes");
const DRY = process.argv.includes("--dry-run");
const TIMEOUT_MS = Number(process.env.SWEEP_TIMEOUT_MS ?? 120_000);

if (!DEST || !/^NQ/i.test(DEST.replace(/\s/g, ""))) {
  throw new Error("Usage: sweep-hot-wallet.ts <NQ… destination> --yes");
}
if (!YES && !DRY) throw new Error("Refusing without --yes (this sends real NIM).");

const priv = process.env.DEV_PARENT_PRIV;
if (!priv) throw new Error("DEV_PARENT_PRIV not set — source the instance env first.");
if ((process.env.NIMIQ_NETWORK ?? "test") !== "main") throw new Error("NIMIQ_NETWORK must be 'main'.");
if (process.env.NIMIQ_SIM === "1") throw new Error("NIMIQ_SIM is on — refusing.");

const url = process.env.NIMIQ_RPC_URL;
if (!url) throw new Error("NIMIQ_RPC_URL not set.");

const Nimiq = await import("@nimiq/core");
const sender = createRpcSender({ url, rpcTimeoutMs: TIMEOUT_MS });

const kp = Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(priv));
const from = kp.toAddress();
const to = Nimiq.Address.fromUserFriendlyAddress(DEST);

const balance = await sender.getBalance(from.toUserFriendlyAddress());
console.log(`from    ${from.toUserFriendlyAddress()}`);
console.log(`to      ${to.toUserFriendlyAddress()}`);
console.log(`balance ${balance} luna = ${balance / 100_000} NIM`);
if (balance <= 0) throw new Error("Nothing to sweep.");

const height = await sender.getHeadHeight();
// Fees are 0 on Albatross, so the whole balance moves.
const tx = Nimiq.TransactionBuilder.newBasic(
  from, to, BigInt(balance), BigInt(0), height, Number(process.env.NIMIQ_NETWORK_ID ?? 24),
);
tx.sign(kp, undefined);

const hex = tx.toHex();
console.log(`\nsigned tx hash ${tx.hash()}`);
console.log(`signed tx hex  ${hex}`);
console.log(`\n^ if the broadcast below aborts, the chain may still accept it. Re-check the`);
console.log(`  balance before re-broadcasting, or the same hex can be replayed safely.\n`);

if (DRY) {
  console.log("DRY RUN - everything above succeeded; stopping before broadcast.");
  process.exit(0);
}
console.log(`broadcasting (timeout ${TIMEOUT_MS}ms)...`);
try {
  const hash = await sender.sendRawTransaction(hex);
  console.log(`broadcast ok — ${hash}`);
} catch (e) {
  console.log(`broadcast call FAILED: ${String(e)}`);
  console.log(`This does NOT mean it failed on chain. Check the balance before retrying.`);
}

// Prove it by the balance, not by the call's return value.
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const b = await sender.getBalance(from.toUserFriendlyAddress()).catch(() => -1);
  if (b === 0) { console.log(`\nSWEPT — hot wallet is now 0. ${balance / 100_000} NIM sent to ${DEST}`); process.exit(0); }
  if (i % 5 === 0) console.log(`  waiting… hot wallet ${b} luna`);
}
console.log(`\nNot confirmed within 90s. Check the explorer before sending anything again.`);
