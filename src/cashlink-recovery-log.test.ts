// A Cashlink URL is a bearer instrument, and it must never be written to stdout.
//
// `logRecoverableMint` exists because a mint that throws AFTER the funding transfer leaves real
// NIM at an address nobody has the key to, unless the claim URL is kept — and the URL IS the
// key. Keeping it is correct and it is the sole copy. Printing it was not: on these deploys
// stdout is a plaintext file under ~/gdkc/logs that nothing redacts, so every failed mint left a
// spendable key in a file that gets backed up, shipped, screen-shared and attached to support
// bundles, forever. The trigger is ordinary — `waitForFunding` throws after 20s, which happened
// on mainnet on 2026-08-01.
//
// These drive the real streak-bonus path with a provider that fails exactly like that.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTestDb } from "./db";
import * as repo from "./repo";
import { maybeMintStreakBonus, recoveryLogPath, STREAK_MILESTONE_EVERY } from "./routes/cashlinks";
import type { WalletProvider } from "./wallet";

const ADDRESS = "NQ07 1111 1111 1111 1111 1111 1111 1111 1111";

let dir: string;
let logPath: string;
let saved: string | undefined;
let fam: repo.Family;
let kid: repo.Child;

/** A provider whose bytes reach the wire and whose broadcast then fails to come back — the
 *  shape that makes the URL the only way to reach the money. Deliberately NOT the `build`
 *  stage, which is provably harmless and carries no recovery material worth keeping. */
const failsAfterTransfer = {
  getAddress: async () => ADDRESS,
  prepareTransaction: async () => ({ rawTxHex: "raw-abc", txHash: "b".repeat(64) }),
  broadcastRaw: async () => { throw new Error("fetch failed: socket hang up"); },
  sendTransaction: async () => { throw new Error("fetch failed: socket hang up"); },
} as unknown as WalletProvider;

beforeEach(() => {
  saved = process.env.HATCH_RECOVERY_LOG;
  dir = mkdtempSync(join(tmpdir(), "kids-recovery-"));
  logPath = join(dir, "cashlink-recovery.jsonl");
  process.env.HATCH_RECOVERY_LOG = logPath;
  initTestDb();
  fam = repo.createFamily("Dad", ADDRESS);
  kid = repo.createChild(fam.id, "Ada", "🦖");
  // Land the streak exactly on a milestone so the bonus mint is attempted.
  repo.addBalanceAndStreak(kid.id, 0);
  for (let i = 1; i < STREAK_MILESTONE_EVERY; i++) repo.addBalanceAndStreak(kid.id, 0);
});

afterEach(() => {
  if (saved === undefined) delete process.env.HATCH_RECOVERY_LOG;
  else process.env.HATCH_RECOVERY_LOG = saved;
  rmSync(dir, { recursive: true, force: true });
});

/** Run `fn` with console.error captured, and hand back everything it printed. */
async function capturingStderr(fn: () => Promise<unknown>): Promise<string> {
  const real = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { await fn(); } finally { console.error = real; }
  return lines.join("\n");
}

test("the recovery path is reached at all — the streak lands on a milestone", () => {
  expect(repo.getChild(kid.id)!.streak_count % STREAK_MILESTONE_EVERY).toBe(0);
});

test("a failed mint's claim URL goes to the recovery file and NOT to stdout", async () => {
  const out = await capturingStderr(() => maybeMintStreakBonus(fam.id, kid.id, failsAfterTransfer));

  // THE POINT. The key is not in the process log.
  expect(out).not.toContain("cashlink/#");
  expect(out).toContain("MINT FAILED AFTER A POSSIBLE TRANSFER");
  expect(out).toContain(logPath); // ...and the operator is told where it went

  const written = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(written.length).toBe(1);
  expect(written[0]!.url).toContain("cashlink/#"); // the sole copy survives, in full
  expect(written[0]!.address).toMatch(/^NQ/);
  expect(typeof written[0]!.at).toBe("number");
  // The cashlink ADDRESS still rides on stdout, which is what an operator needs to check the
  // chain with, and is public information — unlike the key.
  expect(out).toContain(written[0]!.address);
});

test("the recovery file is 0600, and stays 0600 when it already exists", async () => {
  // The trap #139 is about: writeFileSync/appendFileSync only honour `mode` when they CREATE
  // the file, so a file an operator (or an earlier umask) already left readable stays readable.
  writeFileSync(logPath, "", { mode: 0o644 });
  await capturingStderr(() => maybeMintStreakBonus(fam.id, kid.id, failsAfterTransfer));
  expect(statSync(logPath).mode & 0o077).toBe(0);
});

test("two failures append rather than overwrite — an earlier key is never lost", async () => {
  await capturingStderr(() => maybeMintStreakBonus(fam.id, kid.id, failsAfterTransfer));
  await capturingStderr(() => maybeMintStreakBonus(fam.id, kid.id, failsAfterTransfer));
  expect(readFileSync(logPath, "utf8").trim().split("\n").length).toBe(2);
});

test("an unwritable recovery file prints the URL rather than losing the money", async () => {
  // Losing a child's NIM outright is worse than writing the key somewhere too readable, so the
  // fallback is loud and says exactly what happened, which is what an operator has to act on.
  process.env.HATCH_RECOVERY_LOG = join(dir, "no", "such", "dir", "recovery.jsonl");
  const out = await capturingStderr(() => maybeMintStreakBonus(fam.id, kid.id, failsAfterTransfer));

  expect(out).toContain("COULD NOT BE WRITTEN");
  expect(out).toContain("SPENDABLE KEY");
  expect(out).toContain("cashlink/#"); // the money stays reachable, loudly
});

test("recoveryLogPath sits beside the database when nothing overrides it", () => {
  delete process.env.HATCH_RECOVERY_LOG;
  const savedDb = process.env.DB_PATH;
  process.env.DB_PATH = "/var/data/instance/app.db";
  try {
    expect(recoveryLogPath()).toBe("/var/data/instance/cashlink-recovery.jsonl");
  } finally {
    if (savedDb === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = savedDb;
  }
  expect(existsSync(dir)).toBe(true);
});
