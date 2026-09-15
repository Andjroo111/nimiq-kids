import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDb } from "./db";
import * as repo from "./repo";

// Boot must survive a database that PREDATES the url_secret column. schema.sql runs first
// and `CREATE TABLE IF NOT EXISTS cashlinks` is a no-op on the existing table, so it never
// adds the column — the url_secret index therefore has to be created in migrate() AFTER the
// ALTER, never in schema.sql. A url_secret index in schema.sql threw "no such column" at
// boot on every real (non-fresh) database, which the fresh-DB test harness could not catch.
test("initDb upgrades a pre-url_secret cashlinks table without throwing, and backfills the secret", () => {
  const dir = mkdtempSync(join(tmpdir(), "kids-mig-"));
  const path = join(dir, "legacy.db");

  // Stand up a legacy cashlinks table WITHOUT url_secret and seed one row, the way a real
  // pre-upgrade database looks. FKs off during setup so we need no other tables.
  const seed = new Database(path);
  seed.run("PRAGMA foreign_keys = OFF");
  seed.run(`CREATE TABLE cashlinks (
    id TEXT PRIMARY KEY, family_id TEXT NOT NULL, chore_id TEXT, child_id TEXT,
    kind TEXT NOT NULL DEFAULT 'payout', cashlink_address TEXT NOT NULL, value_luna INTEGER NOT NULL,
    message TEXT, url TEXT NOT NULL, funding_tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'ready', created_at INTEGER NOT NULL, claimed_at INTEGER)`);
  const secret = "#LEGACY0secret0bytes0here0000000000000000000";
  seed.run(
    "INSERT INTO cashlinks (id, family_id, cashlink_address, value_luna, url, created_at) VALUES (?,?,?,?,?,?)",
    ["cl-legacy", "fam-x", "NQ_ADDR", 100_000, `https://hub.nimiq.com/cashlink/${secret}`, 1],
  );
  seed.close();

  // The upgrade boot: schema.sql + migrate(). This must NOT throw.
  expect(() => initDb(path)).not.toThrow();

  // The legacy row's fragment is backfilled and now resolvable by exact match.
  expect(repo.getCashlinkByUrl(`https://hub.nimiq-testnet.com/cashlink/${secret}`)?.id).toBe("cl-legacy");
  // The wildcard probe still finds nothing.
  expect(repo.getCashlinkByUrl("#%%%%%%%%")).toBeNull();
});
