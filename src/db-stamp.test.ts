// A database that belongs to the other chain must not boot quietly.
//
// Three live instances run off one repo and NIMIQ_NETWORK is a plain env var. Point a mainnet
// DB at testnet, or restore the wrong backup, and nothing visibly breaks: kid addresses are
// identical across networks because they derive from the same seed, so every screen renders
// while every tx_hash links to the wrong chain and every balance is read from a chain that
// never saw those transactions. There is no symptom to notice. That is what makes it worth a
// refusal rather than a warning.
//
// The last two tests boot the REAL initDb in a subprocess against a REAL stamped database,
// because a guard that only exists as a pure function is a guard nobody has run.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  OVERRIDE_ENV, seedFingerprint, stampVerdict, STAMP_NETWORK_KEY, STAMP_SEED_KEY,
} from "./db-stamp";

const SEED_A = "a".repeat(64);
const SEED_B = "b".repeat(64);
const fpA = seedFingerprint(SEED_A)!;
const fpB = seedFingerprint(SEED_B)!;

// ---- the rule ----

test("an unstamped database is stamped with whatever it is currently running as", () => {
  // Every existing database predates this check, so the first boot after it ships adopts the
  // instance's current configuration — which is correct, because that IS what it is running as.
  const v = stampVerdict({ stored: {}, current: { network: "main", seedFingerprint: fpA } });
  expect(v.kind).toBe("ok");
  expect(v.kind === "ok" && v.write).toEqual({ network: "main", seedFingerprint: fpA });
});

test("a stamp that agrees writes nothing", () => {
  const v = stampVerdict({
    stored: { network: "main", seedFingerprint: fpA },
    current: { network: "main", seedFingerprint: fpA },
  });
  expect(v.kind === "ok" && v.write).toEqual({});
});

test("the wrong NETWORK refuses, and the message says what to do", () => {
  const v = stampVerdict({
    stored: { network: "main", seedFingerprint: fpA },
    current: { network: "test", seedFingerprint: fpA },
  });
  expect(v.kind).toBe("refuse");
  const msg = v.kind === "refuse" ? v.message : "";
  expect(msg).toContain("REFUSING TO BOOT");
  expect(msg).toContain("'main'");
  expect(msg).toContain("'test'");
  expect(msg).toContain("DB_PATH");
  expect(msg).toContain(OVERRIDE_ENV);
});

test("a different SEED refuses — the rows name accounts this process cannot sign for", () => {
  const v = stampVerdict({
    stored: { network: "main", seedFingerprint: fpA },
    current: { network: "main", seedFingerprint: fpB },
  });
  expect(v.kind).toBe("refuse");
  expect(v.kind === "refuse" && v.message).toContain("SEED");
});

test("losing the seed entirely refuses too", () => {
  const v = stampVerdict({
    stored: { network: "test", seedFingerprint: fpA },
    current: { network: "test", seedFingerprint: null },
  });
  expect(v.kind).toBe("refuse");
});

test("losing the seed under HATCH_CUSTODY=parent is the flip, not a mismatch", () => {
  // The custody flip IS "delete the seed". Refusing here made the stamp the last thing
  // standing in front of the migration, reachable only through an override that by design
  // never stamps and so comes back every boot.
  const v = stampVerdict({
    stored: { network: "main", seedFingerprint: fpA },
    current: { network: "main", seedFingerprint: null },
    custody: "parent",
  });
  expect(v.kind).toBe("ok");
  // Nothing is recorded. Custody is a setting an operator can turn back off within the hour,
  // and a stamp is written once and never rewritten, so stamping it would start lying on the
  // first rollback.
  expect(v.kind === "ok" && v.write).toEqual({});
});

test("the custody exemption covers the SEED clause and nothing else", () => {
  // Mutation guard. If the exemption is ever widened to an early return, both of these flip
  // to ok and the stamp stops catching the wrong database on a non-custodial instance.
  const wrongChain = stampVerdict({
    stored: { network: "main", seedFingerprint: fpA },
    current: { network: "test", seedFingerprint: null },
    custody: "parent",
  });
  expect(wrongChain.kind).toBe("refuse");
  expect(wrongChain.kind === "refuse" && wrongChain.message).toContain("NETWORK");

  // A parent-custody instance that still has a seed is a contradiction custody-boot refuses
  // outright, but the stamp must not be the thing that lets a CHANGED one past on the way.
  const changedSeed = stampVerdict({
    stored: { network: "main", seedFingerprint: fpA },
    current: { network: "main", seedFingerprint: fpB },
    custody: "parent",
  });
  expect(changedSeed.kind).toBe("refuse");
  expect(changedSeed.kind === "refuse" && changedSeed.message).toContain("SEED");
});

test("the seed-went-away refusal names the supported way to run without one", () => {
  const v = stampVerdict({
    stored: { network: "test", seedFingerprint: fpA },
    current: { network: "test", seedFingerprint: null },
  });
  expect(v.kind === "refuse" && v.message).toContain("HATCH_CUSTODY=parent");
});

test("a SIM database acquiring a seed is not a mismatch — it fills the gap", () => {
  // Nothing was ever derived from the absent seed, so there is nothing to disagree with.
  const v = stampVerdict({
    stored: { network: "test", seedFingerprint: null },
    current: { network: "test", seedFingerprint: fpA },
  });
  expect(v.kind).toBe("ok");
  expect(v.kind === "ok" && v.write).toEqual({ seedFingerprint: fpA });
});

test("the override lets a boot through and deliberately does NOT rewrite the stamp", () => {
  const v = stampVerdict({
    stored: { network: "main", seedFingerprint: fpA },
    current: { network: "test", seedFingerprint: fpA },
    override: true,
  });
  expect(v.kind).toBe("ok");
  // The refusal comes back next boot. An operator cannot silently convert a mistake into
  // the new truth by setting a variable once.
  expect(v.kind === "ok" && v.write).toEqual({});
});

test("the fingerprint is not the seed, and it is stable", () => {
  expect(fpA).not.toContain("aaaa");
  expect(fpA).not.toBe(fpB);
  expect(seedFingerprint(SEED_A)).toBe(fpA);
  expect(seedFingerprint(undefined)).toBeNull();
  expect(fpA.length).toBe(16);
});

// ---- the real boot ----

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kids-stamp-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Run `initDb` in a subprocess under the given env, and report how it went. */
async function boot(env: Record<string, string>): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "-e", 'const m = await import("./src/db.ts"); m.initDb(); console.log("BOOTED")'],
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      NIMIQ_SIM: "1", HATCH_MASTER_SEED: "", NIMIQ_NETWORK: "", [OVERRIDE_ENV]: "",
      DB_PATH: join(dir, "app.db"), ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out: out + err };
}

const stampOf = (key: string): string | null => {
  const db = new Database(join(dir, "app.db"), { readonly: true });
  const row = db.query("SELECT value FROM wallet_state WHERE key=?").get(key) as { value: string } | null;
  db.close();
  return row?.value ?? null;
};

test("a first boot stamps the database, and booting again is fine", async () => {
  const first = await boot({ NIMIQ_NETWORK: "main", HATCH_MASTER_SEED: SEED_A });
  expect(first.code, first.out).toBe(0);
  expect(stampOf(STAMP_NETWORK_KEY)).toBe("main");
  expect(stampOf(STAMP_SEED_KEY)).toBe(fpA);

  const again = await boot({ NIMIQ_NETWORK: "main", HATCH_MASTER_SEED: SEED_A });
  expect(again.code, again.out).toBe(0);
});

test("a seed-stamped database boots seedless under parent custody, and only under it", async () => {
  // This is the custody flip, run against the thing it actually runs against: a database
  // already stamped by a seed-holding instance. Booted for real, because the whole reason
  // this test exists is that the pure function passing told nobody the boot would.
  expect((await boot({ NIMIQ_NETWORK: "main", HATCH_MASTER_SEED: SEED_A })).code).toBe(0);
  expect(stampOf(STAMP_SEED_KEY)).toBe(fpA);

  const seedless = await boot({ NIMIQ_NETWORK: "main", HATCH_MASTER_SEED: "" });
  expect(seedless.code).toBe(1);
  expect(seedless.out).toContain("HATCH_CUSTODY=parent");

  const flipped = await boot({ NIMIQ_NETWORK: "main", HATCH_MASTER_SEED: "", HATCH_CUSTODY: "parent" });
  expect(flipped.code, flipped.out).toBe(0);
  expect(flipped.out).toContain("BOOTED");

  // The seed fingerprint is still there afterwards. It is the record of which seed derived
  // the kid rows that already exist, and that is exactly what anyone doing a later sweep or
  // recovery needs; the flip does not get to erase its own history.
  expect(stampOf(STAMP_SEED_KEY)).toBe(fpA);

  // And rolling back is not blocked. Restoring the env file is the whole rollback, and a
  // stamp that refused the way home would make the flip a one-way door.
  expect((await boot({ NIMIQ_NETWORK: "main", HATCH_MASTER_SEED: SEED_A })).code).toBe(0);
});

test("pointing a mainnet database at testnet refuses to boot, and the stamp survives", async () => {
  expect((await boot({ NIMIQ_NETWORK: "main", HATCH_MASTER_SEED: SEED_A })).code).toBe(0);

  const wrong = await boot({ NIMIQ_NETWORK: "test", HATCH_MASTER_SEED: SEED_A });
  expect(wrong.code).toBe(1);
  expect(wrong.out).toContain("REFUSING TO BOOT");
  expect(wrong.out).not.toContain("BOOTED");
  // Untouched, so the refusal is repeatable rather than a one-off.
  expect(stampOf(STAMP_NETWORK_KEY)).toBe("main");

  // The override gets an operator through it, once, without changing the record.
  const forced = await boot({ NIMIQ_NETWORK: "test", HATCH_MASTER_SEED: SEED_A, [OVERRIDE_ENV]: "1" });
  expect(forced.code, forced.out).toBe(0);
  expect(stampOf(STAMP_NETWORK_KEY)).toBe("main");
  expect((await boot({ NIMIQ_NETWORK: "test", HATCH_MASTER_SEED: SEED_A })).code).toBe(1);
});
