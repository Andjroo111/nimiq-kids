// THE NO-MOVED-MONEY TEST.
//
// Per-family HD scoping changes where NEW kid accounts are derived. Accounts that already exist
// derive at the flat legacy path m/44'/242'/7'/i' and hold real NIM at those addresses. If the
// upgrade re-derived any of them, that money would be stranded at an address the server no
// longer computes — silently, with no error anywhere.
//
// So this file does the upgrade for real. It builds a database with the PRE-CHANGE schema (no
// hd_family_index, no families.hd_index, and the old instance-global unique index on
// account_index), fills it with kid rows whose addresses were derived on the legacy path, then
// boots the current code against that file so the migration actually runs — and asserts that
// every pre-existing kid still derives, byte for byte, the address it had before.
//
// It also runs against a real database snapshot when one is provided:
//
//     sqlite3 /path/to/live.db ".backup '/tmp/snap.db'"          # the safe way to take one
//     NIMIQ_SIM=1 LEGACY_DB_SNAPSHOT=/tmp/snap.db bun test src/wallet/legacy-account-invariance.test.ts
//
// Point it at a snapshot or at a copy — never at a live file. `adoptSnapshot` below takes its
// own copy either way and normalises it, so a plain `cp` of a running instance's database works
// too, sidecars and permissions included. No snapshot is committed here: production data has no
// business in this repo, and the synthetic case is the same shape and runs everywhere.
//
// The ingest path itself is covered by a test that runs on every CI run (no env var needed), so
// the one piece of evidence for the no-moved-money claim cannot rot into being unrunnable again.

import { test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb, initTestDb, getDb } from "../db";
import * as repo from "../repo";
import { deriveKidKey, kidPath } from "../nimiq/hd";
import { ensureKidWallet, kidHdAccount, kidKey } from "./kid-wallet";

const TEST_SEED = "5eed0000000000000000000000000000000000000000000000000000000000ff";
const workDir = mkdtempSync(join(tmpdir(), "nimiq-kids-legacy-"));

afterAll(() => {
  try { getDb().close(); } catch { /* already closed */ }
  initTestDb(); // leave the shared handle on a throwaway in-memory DB for other suites
});

/** Roll the current schema back to the pre-change shape, so the migration has real work to do. */
function makeLegacyDbFile(name: string): string {
  const path = join(workDir, name);
  const db = initDb(path);
  db.run("DROP INDEX IF EXISTS idx_children_legacy_account_index");
  db.run("DROP INDEX IF EXISTS idx_children_family_account_index");
  db.run("DROP INDEX IF EXISTS idx_families_hd_index");
  db.run("ALTER TABLE children DROP COLUMN hd_family_index");
  db.run("ALTER TABLE families DROP COLUMN hd_index");
  db.run("CREATE UNIQUE INDEX idx_children_account_index ON children(account_index) WHERE account_index IS NOT NULL");
  return path;
}

interface Snapshot { childId: string; familyId: string; accountIndex: number; address: string }

/** What every pre-existing kid must still be true of after the upgrade. */
async function expectAddressesUnmoved(before: Snapshot[]): Promise<void> {
  expect(before.length).toBeGreaterThan(0);
  for (const row of before) {
    const child = repo.getChild(row.childId)!;
    // 1. The stored coordinates and the cached address were not rewritten.
    expect(child.account_index).toBe(row.accountIndex);
    expect(child.address).toBe(row.address);
    // 2. The row still resolves to the LEGACY path — the family branch is not retrofitted.
    expect(child.hd_family_index).toBeNull();
    expect(kidPath(kidHdAccount(child)!)).toEqual([44, 242, 7, row.accountIndex]);
    // 3. Provisioning is a no-op for an account that already exists.
    expect((await ensureKidWallet(row.childId)).address).toBe(row.address);
  }
}

test("upgrading a pre-scoping database leaves every existing kid address exactly where it was", async () => {
  const prevSeed = process.env.HATCH_MASTER_SEED;
  process.env.HATCH_MASTER_SEED = TEST_SEED;
  try {
    const path = makeLegacyDbFile("legacy.db");
    const db = getDb();

    // Two households, indices handed out instance-globally the way the old code did it:
    // family A got 0 and 2, family B got 1 and 3. Addresses come from the legacy path.
    const layout = [
      { familyId: "fam-a", indices: [0, 2] },
      { familyId: "fam-b", indices: [1, 3] },
    ];
    const before: Snapshot[] = [];
    for (const { familyId, indices } of layout) {
      db.run(
        "INSERT INTO families (id, parent_label, parent_address, mode, created_at) VALUES (?,?,?,?,?)",
        [familyId, "Parent", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000", "family", Date.now()],
      );
      for (const index of indices) {
        const childId = `${familyId}-kid-${index}`;
        const derived = await deriveKidKey({ index, familyIndex: null }, Buffer.from(TEST_SEED, "hex"));
        db.run(
          "INSERT INTO children (id, family_id, label, emoji, account_index, address, created_at) VALUES (?,?,?,?,?,?,?)",
          [childId, familyId, `Kid ${index}`, "🦖", index, derived.address, Date.now()],
        );
        before.push({ childId, familyId, accountIndex: index, address: derived.address });
      }
    }
    db.close();

    // The upgrade itself: boot the current code against the pre-change file.
    initDb(path);
    await expectAddressesUnmoved(before);

    // Strongest form of the claim: re-derive each key from the seed through the production
    // signing path and compare the address to what it was before the migration.
    for (const row of before) {
      const child = repo.getChild(row.childId)!;
      expect((await kidKey(child)).address).toBe(row.address);
    }

    // And the upgraded database still works: a NEW sibling in an existing household gets a
    // scoped account, on its own branch, at an address none of the legacy kids hold.
    const fresh = repo.createChild("fam-a", "New Kid");
    const provisioned = await ensureKidWallet(fresh.id);
    expect(provisioned.hd_family_index).not.toBeNull();
    expect(repo.getFamily("fam-a")!.hd_index).toBe(provisioned.hd_family_index);
    expect(before.map((b) => b.address)).not.toContain(provisioned.address!);
  } finally {
    if (prevSeed === undefined) delete process.env.HATCH_MASTER_SEED;
    else process.env.HATCH_MASTER_SEED = prevSeed;
  }
});

/**
 * Take ownership of a snapshot: copy it, make the copy ours, and fold its WAL back in.
 *
 * Three things about a real nimiq.kids database file make the naive version of this wrong, and
 * each one was a way this test could not run at all:
 *
 *  1. Every instance runs `PRAGMA journal_mode = WAL` (src/db.ts). The newest rows live in the
 *     `-wal` sidecar, so copying the `.db` alone can hand you an EMPTY database that still looks
 *     like a plausible one. The sidecars come along.
 *  2. A WAL database cannot be opened read-only unless SQLite can also bring up the `-shm`
 *     wal-index, so `new Database(copy, { readonly: true })` on a freshly copied WAL file fails
 *     with SQLITE_CANTOPEN before a single assertion runs.
 *  3. `copyFileSync` preserves permissions. A snapshot handed over read-only (backups usually
 *     are) produces a copy the migration cannot write, and `initDb` then fails halfway through
 *     `migrate()` — which reads like a schema bug and is not one.
 *
 * Converting the copy to `journal_mode = DELETE` on a writable handle settles all three: the WAL
 * is checkpointed into the file, the sidecars go away, and what is left is an ordinary database
 * that opens any way we like. The copy is private to this test, so rewriting it costs nothing.
 */
function adoptSnapshot(source: string, name: string): string {
  const target = join(workDir, name);
  copyFileSync(source, target);
  chmodSync(target, 0o600);
  for (const sidecar of ["-wal", "-shm"]) {
    if (!existsSync(source + sidecar)) continue;
    copyFileSync(source + sidecar, target + sidecar);
    chmodSync(target + sidecar, 0o600);
  }
  const db = new Database(target);
  db.run("PRAGMA journal_mode = DELETE"); // folds the -wal in, drops the sidecars
  db.close();
  return target;
}

/** The pre-upgrade truth, read with a plain handle: no schema, no migrations, no writes. */
function readKidRows(path: string): Snapshot[] {
  const raw = new Database(path, { readonly: true });
  const rows = raw.query(
    "SELECT id AS childId, family_id AS familyId, account_index AS accountIndex, address FROM children WHERE account_index IS NOT NULL",
  ).all() as Snapshot[];
  raw.close();
  return rows;
}

/** Adopt a snapshot, record what it held, upgrade it, and assert nothing moved. */
async function upgradeSnapshotAndAssertUnmoved(source: string, name: string): Promise<void> {
  const target = adoptSnapshot(source, name);
  const before = readKidRows(target);
  initDb(target);
  await expectAddressesUnmoved(before);
}

test("the snapshot harness ingests a file shaped like a real one: WAL sidecars and read-only bits", async () => {
  // This is the harness's own regression test, and it runs everywhere — the real-snapshot test
  // below is skipped without an env var, so without this the ingest path would be exercised only
  // by whoever happened to have a snapshot to hand.
  const prevSeed = process.env.HATCH_MASTER_SEED;
  process.env.HATCH_MASTER_SEED = TEST_SEED;
  try {
    const source = makeLegacyDbFile("wal-source.db");
    const db = getDb();
    db.run(
      "INSERT INTO families (id, parent_label, parent_address, mode, created_at) VALUES (?,?,?,?,?)",
      ["fam-wal", "Parent", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000", "family", Date.now()],
    );
    for (const index of [0, 1]) {
      const derived = await deriveKidKey({ index, familyIndex: null }, Buffer.from(TEST_SEED, "hex"));
      db.run(
        "INSERT INTO children (id, family_id, label, emoji, account_index, address, created_at) VALUES (?,?,?,?,?,?,?)",
        [`wal-kid-${index}`, "fam-wal", `Kid ${index}`, "🦖", index, derived.address, Date.now()],
      );
    }

    // Copy with the handle STILL OPEN and nothing checkpointed: the rows are in the -wal, which
    // is exactly the state a `cp` of a running instance's database catches it in. Then take the
    // write bit away, the way a handed-over backup arrives.
    const staged = join(workDir, "wal-staged.db");
    copyFileSync(source, staged);
    copyFileSync(source + "-wal", staged + "-wal");
    chmodSync(staged, 0o444);
    chmodSync(staged + "-wal", 0o444);
    db.close();

    // If the sidecar were dropped, `before` would come back empty and expectAddressesUnmoved's
    // length assertion fails — a vacuous pass is not available to this test.
    await upgradeSnapshotAndAssertUnmoved(staged, "wal-adopted.db");
  } finally {
    if (prevSeed === undefined) delete process.env.HATCH_MASTER_SEED;
    else process.env.HATCH_MASTER_SEED = prevSeed;
  }
});

const snapshotPath = process.env.LEGACY_DB_SNAPSHOT;

test.skipIf(!snapshotPath)("a real pre-scoping snapshot upgrades with no address moved", async () => {
  await upgradeSnapshotAndAssertUnmoved(snapshotPath!, "snapshot.db");
});
