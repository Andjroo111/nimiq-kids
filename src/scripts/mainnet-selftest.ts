// Mainnet round-trip self-test — MUST pass before the family instance flips off SIM.
// Mints a tiny real Cashlink from the hot wallet, verifies it on-chain, then sweeps the
// funds straight back to the hot wallet (fees are 0 on Albatross → ~zero loss).
//
// Deliberately loud and multi-guarded: this moves real money.
//   NIMIQ_NETWORK=main NIMIQ_RPC_URL=... DEV_PARENT_PRIV=... NIMIQ_SIM unset \
//     bun run src/scripts/mainnet-selftest.ts --yes

import { getClient, getNimiq, NETWORK, SIM, EXPLORER_TX } from "../nimiq/client";
import { mintCashlink } from "../nimiq/cashlink";
import { DevProvider } from "../wallet/dev-provider";
import { decodeCashlinkPayload, payloadFromUrl } from "../nimiq/cashlink-codec";

const TEST_LUNA = 10_000; // 0.1 NIM

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!process.argv.includes("--yes")) throw new Error("Refusing without --yes (this sends real NIM).");
  if (NETWORK !== "main") throw new Error("NIMIQ_NETWORK must be 'main'.");
  if (SIM) throw new Error("SIM mode is on (NIMIQ_SIM set or DEV_PARENT_PRIV missing).");

  const provider = new DevProvider();
  const address = await provider.getAddress();
  const client = await getClient();
  const height = await client.getHeadHeight();
  console.log(`RPC ok · head=${height} · hot wallet ${address}`);

  const balance = await client.getBalance(address);
  console.log(`Hot wallet balance: ${balance / 100_000} NIM`);
  if (balance < TEST_LUNA * 2) throw new Error("Fund the hot wallet first (needs ≥ 0.2 NIM).");

  console.log(`Minting a ${TEST_LUNA / 100_000} NIM Cashlink...`);
  const mint = await mintCashlink(provider, TEST_LUNA, "hatch mainnet self-test");
  console.log(`  funded ${mint.cashlinkAddress}`);
  console.log(`  tx ${EXPLORER_TX}${mint.fundingTxHash}`);

  // Wait for the funding tx to land on the cashlink address.
  let clBalance = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    clBalance = await client.getBalance(mint.cashlinkAddress);
    if (clBalance >= TEST_LUNA) break;
  }
  if (clBalance < TEST_LUNA) throw new Error("Funding tx did not confirm within 60s — investigate before flipping SIM off.");
  console.log(`  confirmed on-chain (${clBalance / 100_000} NIM on the cashlink address)`);

  // Sweep back: rebuild the cashlink key from the URL payload and send everything home.
  const Nimiq = await getNimiq();
  const decoded = decodeCashlinkPayload(payloadFromUrl(mint.url));
  const clKey = Nimiq.KeyPair.derive(Nimiq.PrivateKey.deserialize(decoded.priv));
  const networkId = await client.getNetworkId();
  const sweep = Nimiq.TransactionBuilder.newBasic(
    clKey.toAddress(),
    Nimiq.Address.fromUserFriendlyAddress(address),
    BigInt(clBalance),
    BigInt(0),
    await client.getHeadHeight(),
    networkId,
  );
  sweep.sign(clKey, undefined);
  await client.sendTransaction(sweep);
  console.log(`  sweep tx ${EXPLORER_TX}${sweep.hash()}`);

  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    if ((await client.getBalance(mint.cashlinkAddress)) === 0) {
      console.log("ROUND TRIP COMPLETE — funds are back in the hot wallet. Safe to flip SIM off.");
      return;
    }
  }
  throw new Error("Sweep did not confirm within 60s — funds are still on the cashlink address (recoverable via the printed URL).");
}

main().catch((e) => {
  console.error("SELF-TEST FAILED:", e.message ?? e);
  process.exit(1);
});
