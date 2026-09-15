// Mint a parent bearer token and print the magic URL for the phone.
// Run once per phone: bun run src/scripts/parent-token.ts "Andjroo's phone"
import { initDb } from "../db";
import * as repo from "../repo";
import * as lockRepo from "../repo-lock";
import { newToken, sha256Hex } from "../auth";
import * as memberRepo from "../repo-members";

async function main() {
  initDb();
  const fam = repo.firstFamily();
  if (!fam) {
    console.error("No family yet — run the seed first.");
    process.exit(1);
  }
  const label = process.argv[2] ?? "Parent phone";
  const token = newToken();
  lockRepo.createParentToken(fam.id, label, await sha256Hex(token), memberRepo.ownerOf(fam.id)?.id);
  const base = process.env.PARENT_URL ?? "http://localhost:3000/parent/";
  console.log(`Parent token minted for "${label}" (shown ONCE — the DB stores only a hash):`);
  console.log(`\n  ${base}#t=${token}\n`);
  console.log("Open that URL on the phone; the page stores the token locally.");
}

main();
