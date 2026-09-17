// Generate the family HD master seed (HATCH_MASTER_SEED) and append it to the instance env file.
// The seed goes ONLY into the env file, which this ENFORCES at 0600 (see ./secret-env — the old
// writeFileSync `mode` was a no-op on an existing file); stdout gets the kid-0 address as verification
// — address-only stdout discipline, same as generate-hot-wallet.ts. Refuses to overwrite.
// Run once: bun run src/scripts/generate-family-seed.ts [path-to-env]
//
// Every kid account on the instance derives from this ONE secret (m/44'/242'/7'/family'/kid')
// — back it up like a wallet seed; losing it means losing signing access to every kid's on-chain
// account, and it is the single secret behind every household on the instance.

import { existsSync } from "node:fs";
import { appendSecretLines, readEnv } from "./secret-env";
import { deriveKidKey } from "../nimiq/hd";

async function main() {
  const envPath = process.argv[2] ?? `${process.env.HOME}/gdkc/secrets/hatch.env`;
  if (!existsSync(envPath)) {
    console.error(`Env file not found: ${envPath}`);
    process.exit(1);
  }
  const env = readEnv(envPath);
  if (env.includes("HATCH_MASTER_SEED=")) {
    console.error("HATCH_MASTER_SEED already present — refusing to overwrite. Kids' accounts derive from it; rotating orphans them.");
    process.exit(1);
  }
  const seed = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  appendSecretLines(envPath, [
    "",
    "# HD master seed — every kid account on this instance derives from this",
    "# (m/44'/242'/7'/family'/kid').",
    "# BACK THIS UP. Rotating it orphans the kids' on-chain accounts.",
    `HATCH_MASTER_SEED=${seed.toString("hex")}`,
    "# Andjroo's validator (the Beelink) — required off-SIM for kid staking:",
    "# HATCH_VALIDATOR_ADDRESS=NQ__ ____ ____ ____ ____ ____ ____ ____ ____",
    "",
  ]);
  const kid0 = await deriveKidKey({ familyIndex: 0, index: 0 }, seed);
  console.log("Family seed written to", envPath);
  console.log("Verification — the first kid of the first household derives to (fund nothing yet;");
  console.log("accounts get their coordinates on first use):");
  console.log(`\n  ${kid0.address}\n`);
}

main();
