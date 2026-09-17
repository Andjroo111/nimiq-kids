// Generate the family allowance hot wallet and append it to the instance env file.
// The private key goes ONLY into the env file, which this ENFORCES at 0600 (see ./secret-env —
// the old writeFileSync `mode` was a no-op on an existing file); stdout gets the address.
// Run once: bun run src/scripts/generate-hot-wallet.ts [path-to-env]
// Refuses to overwrite an existing key.

import { existsSync } from "node:fs";
import { appendSecretLines, readEnv } from "./secret-env";
import { getNimiq } from "../nimiq/client";

async function main() {
  const envPath = process.argv[2] ?? `${process.env.HOME}/gdkc/secrets/hatch.env`;
  if (!existsSync(envPath)) {
    console.error(`Env file not found: ${envPath}`);
    process.exit(1);
  }
  const env = readEnv(envPath);
  if (env.includes("DEV_PARENT_PRIV=")) {
    console.error("DEV_PARENT_PRIV already present — refusing to overwrite. Remove it first if you really mean to rotate.");
    process.exit(1);
  }
  const Nimiq = await getNimiq();
  const kp = Nimiq.KeyPair.generate();
  const addr = kp.toAddress().toUserFriendlyAddress();
  appendSecretLines(envPath, [
    "",
    "# Allowance hot wallet (payouts sign with this key). Keep the balance pocket-money-sized.",
    `DEV_PARENT_PRIV=${kp.privateKey.toHex()}`,
    // Quoted: the user-friendly address has spaces, and an unquoted value breaks
    // `set -a; . env` (the shell tries to run the second group as a command).
    `HATCH_HOT_WALLET_ADDRESS="${addr}"`,
    "# Mainnet flip — ONLY after src/scripts/mainnet-selftest.ts passes:",
    "#   remove NIMIQ_SIM, set NIMIQ_NETWORK=main and NIMIQ_RPC_URL=https://rpc.nimiqwatch.com",
    "",
  ]);
  console.log("Hot wallet written to", envPath);
  console.log("FUND THIS ADDRESS (small amount — it's the kids' allowance float):");
  console.log(`\n  ${addr}\n`);
}

main();
