import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STICKER_PACKS, STICKERS, packStoreItems, stickerAssetUrl,
  OTHER_STORE_ITEMS, CATEGORY_ICONS, RETIRED_CATEGORIES,
} from "./sticker-catalog";
import { catalogEnglish, jobKey, rowKey, ITEM_CATALOG, SHELF_CATALOG } from "./title-catalog";
import {
  OVERRIDE_ENV, seedFingerprint, stampVerdict, STAMP_NETWORK_KEY, STAMP_SEED_KEY,
} from "./db-stamp";
import { custodyMode } from "./custody-boot";

let _db: Database | null = null;

/** Open the SQLite database and apply schema.sql (idempotent). */
export function initDb(path = process.env.DB_PATH ?? "kids.db") {
  _db = new Database(path);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");
  const schema = readFileSync(join(import.meta.dir, "..", "schema.sql"), "utf8");
  _db.run(schema);
  migrate(_db);
  checkDbStamp(_db);
  return _db;
}

/**
 * Make the database say which chain and which seed it belongs to, and refuse to boot when
 * that disagrees with this process. See ./db-stamp for why silence here is worse than a
 * crash: nothing about a mismatch is visible on any screen.
 *
 * AFTER migrate(), so the wallet_state table certainly exists on an old database. It reads
 * and writes through plain SQL rather than repo-wallet's helpers because `_db` is only
 * assigned when initDb returns, and getDb() would throw.
 */
function checkDbStamp(db: Database): void {
  const read = (key: string): string | null =>
    ((db.query("SELECT value FROM wallet_state WHERE key=?").get(key) as { value: string } | null)
      ?.value) ?? null;

  const verdict = stampVerdict({
    stored: { network: read(STAMP_NETWORK_KEY) ?? undefined, seedFingerprint: read(STAMP_SEED_KEY) },
    current: {
      network: process.env.NIMIQ_NETWORK ?? "test",
      seedFingerprint: seedFingerprint(process.env.HATCH_MASTER_SEED),
    },
    // Read from the same place every other custody question reads it, so an instance cannot
    // be non-custodial to the approval gate and server-custodied to the stamp.
    custody: custodyMode(),
    override: process.env[OVERRIDE_ENV] === "1",
  });

  if (verdict.kind === "refuse") {
    console.error(verdict.message);
    process.exit(1);
  }
  const write = (key: string, value: string) => db.run(
    "INSERT INTO wallet_state (key, value) VALUES (?,?) ON CONFLICT(key) DO NOTHING", [key, value],
  );
  // DO NOTHING, not DO UPDATE. Belt and braces with `write` only ever naming absent keys:
  // a stamp that can be rewritten is a check that always passes.
  if (verdict.write.network) write(STAMP_NETWORK_KEY, verdict.write.network);
  if (verdict.write.seedFingerprint) write(STAMP_SEED_KEY, verdict.write.seedFingerprint);
}

/** Additive migrations for DBs created before a column existed (CREATE TABLE IF NOT EXISTS
 *  won't add new columns to an existing table). Each ALTER is a no-op error if already applied. */
function migrate(db: Database) {
  // Returns true only when the ALTER actually applied (i.e. this boot performed the
  // migration) — lets one-shot backfills run exactly once, never on later boots.
  const addColumn = (sql: string): boolean => {
    try {
      db.run(sql);
      return true;
    } catch {
      return false; /* duplicate column — already migrated */
    }
  };
  addColumn("ALTER TABLE chores ADD COLUMN kind TEXT NOT NULL DEFAULT 'chore'");
  addColumn("ALTER TABLE chores ADD COLUMN subject TEXT");
  addColumn("ALTER TABLE chores ADD COLUMN reward_shape TEXT");
  // Family mode
  addColumn("ALTER TABLE families ADD COLUMN mode TEXT NOT NULL DEFAULT 'demo'");
  addColumn("ALTER TABLE families ADD COLUMN pin_hash TEXT");
  addColumn("ALTER TABLE families ADD COLUMN pin_attempts INTEGER NOT NULL DEFAULT 0");
  addColumn("ALTER TABLE families ADD COLUMN pin_locked_until INTEGER");
  addColumn("ALTER TABLE families ADD COLUMN star_rate_luna INTEGER NOT NULL DEFAULT 10000");
  addColumn("ALTER TABLE families ADD COLUMN notify_url TEXT");
  addColumn("ALTER TABLE families ADD COLUMN tz TEXT NOT NULL DEFAULT 'America/Chicago'");
  addColumn("ALTER TABLE children ADD COLUMN star_balance INTEGER NOT NULL DEFAULT 0");
  addColumn("ALTER TABLE chores ADD COLUMN reward_stars INTEGER NOT NULL DEFAULT 0");
  addColumn("ALTER TABLE chores ADD COLUMN duration_s INTEGER");
  // A scanned send names its destination; a Cashlink send leaves it NULL and is
  // claimed by whoever holds the link. Both still queue for a parent's OK.
  addColumn("ALTER TABLE send_requests ADD COLUMN to_address TEXT");
  // #341 side quests. Default 0, so every step that already exists stays required and no
  // household's routine changes behaviour on the boot that adds the column.
  addColumn("ALTER TABLE routine_tasks ADD COLUMN optional INTEGER NOT NULL DEFAULT 0");
  // Phase B kiosk wiring
  addColumn("ALTER TABLE devices ADD COLUMN installed_apps TEXT NOT NULL DEFAULT '[]'");
  // Per-category time budgets, slice 1 (docs/CATEGORY-TIME-BUDGETS.md). Nullable with no
  // backfill: NULL means "this shelf is not tagged", which is what every existing shelf is,
  // and nothing reads the column yet. A default would have invented a taxonomy for shelves
  // their parent never classified.
  addColumn("ALTER TABLE store_categories ADD COLUMN budget_kind TEXT");
  // #123 switch gate: which kid this shared tablet is currently acting as. Nullable with no
  // backfill on purpose — null means "not unlocked", and every existing device SHOULD read
  // that way, because no kid has a secret picture yet either. The gate is a no-op until a
  // kid sets one, so this migration cannot lock anybody out of a tablet they were using.
  addColumn("ALTER TABLE devices ADD COLUMN unlocked_child_id TEXT REFERENCES children(id)");
  // The charge as the tablet last reported it (§11): the live number on the device row for
  // the parent screen, and a log behind it so a day's drain can be read back.
  addColumn("ALTER TABLE devices ADD COLUMN battery_pct INTEGER");
  addColumn("ALTER TABLE devices ADD COLUMN battery_charging INTEGER");
  addColumn("ALTER TABLE devices ADD COLUMN battery_at INTEGER");
  db.run(
    `CREATE TABLE IF NOT EXISTS device_battery (
       device_id TEXT NOT NULL REFERENCES devices(id), at INTEGER NOT NULL,
       pct INTEGER NOT NULL, charging INTEGER NOT NULL, PRIMARY KEY (device_id, at))`,
  );
  // NONCUSTODIAL-PLAN Phase 3: a payout the PARENT signs. Nullable with no backfill,
  // because every existing row is a server-signed attempt and must keep reading that way
  // — `sender IS NULL` is what tells the two apart, and a backfilled default would erase
  // the distinction on exactly the rows that prove the old behaviour still worked.
  addColumn("ALTER TABLE payout_attempts ADD COLUMN sender TEXT");
  addColumn("ALTER TABLE payout_attempts ADD COLUMN intent_data TEXT");
  addColumn("ALTER TABLE payout_attempts ADD COLUMN validity_start_height INTEGER");
  addColumn("ALTER TABLE payout_attempts ADD COLUMN expires_at INTEGER");
  // Netting (src/kid-netting.ts). Nullable with no backfill for the same reason as the four
  // above: every existing attempt was minted before deferred spending existed, so it netted
  // nothing, and `netted_luna IS NULL` and `= 0` mean the same thing to every reader here.
  // A DEFAULT 0 would have to be written over millions of rows to say what NULL already says.
  addColumn("ALTER TABLE payout_attempts ADD COLUMN netted_luna INTEGER");
  // V2 wallet core: real kid accounts (HD) + NIM-denominated routine rewards
  addColumn("ALTER TABLE children ADD COLUMN account_index INTEGER");
  addColumn("ALTER TABLE children ADD COLUMN address TEXT");
  addColumn("ALTER TABLE routine_tasks ADD COLUMN reward_luna INTEGER NOT NULL DEFAULT 0");
  // Timer styles (Treasure Box 'Timers' category): the equipped rig per kid
  addColumn("ALTER TABLE kid_prefs ADD COLUMN timer_style_id TEXT NOT NULL DEFAULT 'egg'");
  // Mini-app port slice 2: invite-accept dedupe + the accepted -> joined status flow
  addColumn("ALTER TABLE referrals ADD COLUMN ip_hash TEXT");
  addColumn("ALTER TABLE referrals ADD COLUMN joined_at INTEGER");
  // Slice 3 payout budgets: families that predate the budget system (the live
  // household) are grandfathered EXPLICITLY, exactly once, at migrate time. Fresh
  // DBs get the column from schema.sql (the ALTER no-ops), so families created
  // after this ships default to 0 and live under the budget.
  if (addColumn("ALTER TABLE families ADD COLUMN budget_exempt INTEGER NOT NULL DEFAULT 0")) {
    db.run("UPDATE families SET budget_exempt=1");
  }
  // Per-family HD scoping: each household owns its own branch (families.hd_index) and its own
  // account-index space, so a new kid's index is only unique WITHIN the family. Existing rows
  // keep hd_family_index NULL, which means the legacy flat path — their addresses do not move.
  addColumn("ALTER TABLE families ADD COLUMN hd_index INTEGER");
  addColumn("ALTER TABLE children ADD COLUMN hd_family_index INTEGER");
  // How to do an exercise, and something to watch. Both nullable with no backfill: every
  // step that predates this was written by a parent who explained it out loud, and NULL says
  // exactly that. An empty string would be a parent who deliberately left it blank, which is
  // a different thing, so the routes normalise "" back to NULL rather than storing it.
  addColumn("ALTER TABLE practice_steps ADD COLUMN how TEXT");
  addColumn("ALTER TABLE practice_steps ADD COLUMN video_url TEXT");
  // Lives here (not schema.sql) because schema.sql runs BEFORE the ALTERs above on old DBs.
  //
  // Three constraints, and each one is load-bearing:
  //  1. families.hd_index unique      — two households must never share a branch.
  //  2. legacy account_index unique   — the pre-scoping rows had NO family component in their
  //     path, so for THEM the index alone is the whole identity and must stay globally unique.
  //     Scoped rows are excluded because their paths already differ by family.
  //  3. (family_id, account_index)    — the new invariant, and what makes two children created
  //     concurrently in one family collide loudly instead of sharing an address.
  // The old global unique index is dropped: it would reject the second family's index 0.
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_families_hd_index ON families(hd_index) WHERE hd_index IS NOT NULL");
  db.run("DROP INDEX IF EXISTS idx_children_account_index");
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_children_legacy_account_index ON children(account_index)
       WHERE account_index IS NOT NULL AND hd_family_index IS NULL`,
  );
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_children_family_account_index ON children(family_id, account_index)
       WHERE account_index IS NOT NULL`,
  );
  // Screen-time meter (#377). Both default 0, and 0 means "no meter" rather than "no
  // minutes" -- a NOT NULL DEFAULT 60 here would have put every existing household on a
  // one-hour budget on the boot that upgraded them, with nothing on any screen to explain
  // why the tablet died at lunchtime. Opting a kid in is a parent write, never a migration.
  addColumn("ALTER TABLE children ADD COLUMN daily_screen_min INTEGER NOT NULL DEFAULT 0");
  addColumn("ALTER TABLE children ADD COLUMN max_earned_min INTEGER NOT NULL DEFAULT 0");
  // Sittings: play for N minutes in one go, then rest for M. Both 0 = no rule, and a kid
  // stays that way until a parent sets one, for the same reason the meter is opt-in.
  addColumn("ALTER TABLE children ADD COLUMN play_min INTEGER NOT NULL DEFAULT 0");
  addColumn("ALTER TABLE children ADD COLUMN rest_min INTEGER NOT NULL DEFAULT 0");
  // The language THIS kid's tablet reads in (#432). NULLABLE, and null is not "English":
  // it means FOLLOW THE DEVICE, which is what every household has today and what the shell
  // already resolves on its own. A `NOT NULL DEFAULT 'en'` here would flip every non-English
  // tablet in the database to English on the boot that upgraded it, with nothing on any
  // screen to say why -- the same trap the two lines above are written to avoid.
  addColumn("ALTER TABLE children ADD COLUMN lang TEXT");
  // The two new tables live here as well as in schema.sql: schema.sql only runs its
  // CREATEs against a database being built, and an existing one never re-reads it.
  db.run(
    `CREATE TABLE IF NOT EXISTS allow_windows (
       id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES families(id),
       start_hhmm TEXT NOT NULL, end_hhmm TEXT NOT NULL,
       days TEXT NOT NULL DEFAULT '1111111')`,
  );
  db.run("CREATE INDEX IF NOT EXISTS idx_allow_windows_family ON allow_windows(family_id)");
  // The character picker's offer set (#381). Same reason as the two tables above: schema.sql
  // only runs against a database being built, and an existing one never re-reads it.
  db.run(
    `CREATE TABLE IF NOT EXISTS kid_character_sets (
       id TEXT PRIMARY KEY,
       family_id TEXT NOT NULL REFERENCES families(id),
       child_id TEXT NOT NULL REFERENCES children(id),
       indices TEXT NOT NULL,
       expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL)`,
  );
  db.run("CREATE INDEX IF NOT EXISTS idx_kid_character_sets_child ON kid_character_sets(child_id, created_at)");
  db.run(
    `CREATE TABLE IF NOT EXISTS screen_usage (
       child_id TEXT NOT NULL REFERENCES children(id), local_day TEXT NOT NULL,
       used_sec INTEGER NOT NULL DEFAULT 0, earned_sec INTEGER NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL, PRIMARY KEY (child_id, local_day))`,
  );
  // The sitting the meter is inside of (see schema.sql). Day-row columns, so midnight
  // clears them with the meter.
  addColumn("ALTER TABLE screen_usage ADD COLUMN sitting_sec INTEGER NOT NULL DEFAULT 0");
  addColumn("ALTER TABLE screen_usage ADD COLUMN last_burn_at INTEGER NOT NULL DEFAULT 0");
  // Kid-added chores + soft removal with a parent-visible trail.
  addColumn("ALTER TABLE chores ADD COLUMN created_by TEXT NOT NULL DEFAULT 'parent'");
  addColumn("ALTER TABLE chores ADD COLUMN removed_at INTEGER");
  addColumn("ALTER TABLE chores ADD COLUMN removed_by TEXT");
  addColumn("ALTER TABLE families ADD COLUMN kids_can_remove INTEGER NOT NULL DEFAULT 1");
  // Art stickers carry the glyph itself; asset_url is now photo-stickers only.
  addColumn("ALTER TABLE stickers ADD COLUMN emoji TEXT");
  // The timer's scene, split from the app's. Nullable ON PURPOSE: NULL means
  // "same as the app", so every kid who already had one background keeps one
  // until they deliberately pick a different timer scene. A NOT NULL DEFAULT
  // would have frozen today's app scene onto the timer for everyone.
  addColumn("ALTER TABLE kid_prefs ADD COLUMN timer_background_id TEXT");
  // Throwaway judge-demo households (src/demo-family.ts): the timestamp is what the
  // sweeper selects on. NULL — every real family — is never swept.
  addColumn("ALTER TABLE families ADD COLUMN demo_at INTEGER");
  // A Treasure Box shelf carries its own face, so a PARENT-created shelf and
  // everything on it has a picture without a line of UI code.
  addColumn("ALTER TABLE store_categories ADD COLUMN icon TEXT");
  // Once a parent edits a seeded row it is theirs, and the catalogue below stops
  // re-applying its own price/payload/title over the top at every boot. Without
  // this the first thing the new parent screen did would be silently undone on
  // the next restart.
  addColumn("ALTER TABLE store_categories ADD COLUMN parent_edited INTEGER NOT NULL DEFAULT 0");
  addColumn("ALTER TABLE store_items ADD COLUMN parent_edited INTEGER NOT NULL DEFAULT 0");
  // Deposit detection is per-family now (src/repo-wallet.ts takeUnseenFamilyDepositLuna).
  // Family-level 'deposit' rows written before this shipped came from a raw balance
  // compare and carry no attribution, so the watermark keeps them out of every family's
  // first per-family delta — a first poll after the upgrade reports 0, never history.
  // One-shot by construction: once the key exists, INSERT OR IGNORE is a no-op forever.
  db.run(
    `INSERT OR IGNORE INTO wallet_state (key, value)
     SELECT 'family_deposit_seen_floor', COALESCE(MAX(created_at), 0)
       FROM wallet_events WHERE child_id IS NULL AND kind='deposit'`,
  );
  // A payout that can be retried needs a way to say "this one already happened". The
  // index is created HERE rather than in schema.sql because schema.sql runs against
  // databases that predate the column, where an index over it cannot be built yet.
  addColumn("ALTER TABLE wallet_events ADD COLUMN payout_ref TEXT");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_events_payout_ref ON wallet_events(payout_ref) WHERE payout_ref IS NOT NULL");
  // Cashlink claim lookup is by EXACT secret, not a LIKE pattern. A scanned link was
  // matched with `url LIKE '%' || secret`, and the caller controlled the `%`/`_` in
  // `secret`, so `#%%%%%%%%` matched every row and dumped bearer URLs (= private keys).
  // `url_secret` holds the #fragment ALONE so the lookup is `WHERE url_secret = ?`.
  // Backfill exactly once, on the boot that adds the column: substr from the '#'
  // reproduces `url.slice(url.indexOf('#'))`, which is what mint now stores.
  if (addColumn("ALTER TABLE cashlinks ADD COLUMN url_secret TEXT")) {
    db.run("UPDATE cashlinks SET url_secret = substr(url, instr(url, '#')) WHERE url_secret IS NULL AND instr(url, '#') > 0");
  }
  db.run("CREATE INDEX IF NOT EXISTS idx_cashlinks_url_secret ON cashlinks(url_secret) WHERE url_secret IS NOT NULL");
  // Treasure Box catalogue is per-family now. Rows created before this shipped are the shared
  // SEEDED catalogue, which is exactly what family_id NULL means, so no backfill: the column
  // adds cleanly and every existing row stays global. A parent-created row is stamped with its
  // family; reads filter `family_id IS NULL OR family_id = ?`. Indexes live HERE (after the
  // ALTER), never in schema.sql, which runs first and cannot reference a not-yet-added column.
  addColumn("ALTER TABLE store_items ADD COLUMN family_id TEXT");
  addColumn("ALTER TABLE store_categories ADD COLUMN family_id TEXT");
  db.run("CREATE INDEX IF NOT EXISTS idx_store_items_family ON store_items(family_id) WHERE family_id IS NOT NULL");
  db.run("CREATE INDEX IF NOT EXISTS idx_store_categories_family ON store_categories(family_id) WHERE family_id IS NOT NULL");
  // Address provenance. Every address on an existing database was derived from the master
  // seed, because until now there was no other way to get one — so the backfill is exact
  // rather than a guess, and it runs EXACTLY ONCE (only on the boot that adds the column).
  //
  // Deliberately NOT `NOT NULL DEFAULT 'derived'`: a child with no address at all is a real
  // third state, and stamping it 'derived' would tell the boot guard and the migration script
  // that a server-custodied account exists where none does. NULL means "no address yet".
  //
  // `derived_address` is added FIRST because the backfill below writes to it. Adding it
  // after would have thrown an uncaught "no such column" on the one boot that matters (the
  // upgrade of an existing database) while passing every test, because a fresh database
  // gets both columns from schema.sql and skips the branch entirely.
  addColumn("ALTER TABLE children ADD COLUMN derived_address TEXT");
  if (addColumn("ALTER TABLE children ADD COLUMN address_source TEXT")) {
    db.run("UPDATE children SET address_source='derived', derived_address=address WHERE address IS NOT NULL");
  }
  addColumn("ALTER TABLE children ADD COLUMN address_proof_message TEXT");
  addColumn("ALTER TABLE children ADD COLUMN address_proof_pubkey TEXT");
  addColumn("ALTER TABLE children ADD COLUMN address_proof_sig TEXT");
  addColumn("ALTER TABLE children ADD COLUMN address_registered_at INTEGER");
  // WHICH Keyguard flow signed the stored proof. `signMessage` and `connectAccount` hash the
  // same message under different prefixes, so re-verification needs to know which, and every
  // row that predates this column was written by the signMessage path.
  if (addColumn("ALTER TABLE children ADD COLUMN address_proof_kind TEXT")) {
    db.run("UPDATE children SET address_proof_kind='signed_message' WHERE address_proof_sig IS NOT NULL");
  }
  // A parent-owned address belongs to exactly one child on this instance. Two kids sharing
  // one means every payout to either lands in the same pot and the app shows both the same
  // balance; the registration route refuses it, and this makes the database refuse it too.
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_children_parent_address ON children(address)
       WHERE address IS NOT NULL AND address_source='parent'`,
  );
  // ---- localizable titles (src/title-catalog.ts) ----
  //
  // Nullable ON PURPOSE, and the null is load-bearing rather than a default we
  // have not got round to filling: NULL means "these are the parent's own words",
  // and the renderer prints them verbatim in every language. Only titles WE
  // authored get a key. A `NOT NULL DEFAULT ''` would erase that distinction and
  // there would be no way to tell a seeded chore from a typed one again.
  addColumn("ALTER TABLE routines ADD COLUMN title_key TEXT");
  addColumn("ALTER TABLE routine_tasks ADD COLUMN title_key TEXT");
  addColumn("ALTER TABLE store_items ADD COLUMN title_key TEXT");
  addColumn("ALTER TABLE store_categories ADD COLUMN title_key TEXT");
  addColumn("ALTER TABLE sticker_packs ADD COLUMN title_key TEXT");
  // Goal-ladder themes (2026-08-04). All three live in schema.sql's CREATE TABLEs for a fresh
  // DB and here for every DB that already exists — including `goals`, which shipped one
  // version ago at v0.109.0 without a theme.
  addColumn("ALTER TABLE sticker_packs ADD COLUMN theme INTEGER NOT NULL DEFAULT 0");
  addColumn("ALTER TABLE stickers ADD COLUMN is_boss INTEGER NOT NULL DEFAULT 0");
  addColumn("ALTER TABLE goals ADD COLUMN pack_id TEXT");
  addColumn("ALTER TABLE practices ADD COLUMN title_key TEXT");
  if (addColumn("ALTER TABLE chores ADD COLUMN title_key TEXT")) backfillTitleKeys(db);
  // ---- the grown-ups of a household (src/repo-members.ts) ----
  //
  // Two households, one kid: the other parent and the grandparents each pay out of their own
  // wallet now, so a parent token has to say WHICH grown-up is holding it. The ALTER is the
  // signal, exactly as it is for budget_exempt above: a fresh database gets both columns from
  // schema.sql and skips the backfill, an existing one runs it exactly once, on this boot.
  addColumn("ALTER TABLE approvals ADD COLUMN decided_by_member_id TEXT REFERENCES family_members(id)");
  // Partial credit (#351). NULL on every existing row and that is the correct read, not a
  // convenient one: every approval decided before this shipped paid the subject's full price,
  // which is exactly what NULL means here. No backfill.
  addColumn("ALTER TABLE approvals ADD COLUMN share_bps INTEGER");
  if (addColumn("ALTER TABLE parent_tokens ADD COLUMN member_id TEXT REFERENCES family_members(id)")) {
    backfillOwnerMembers(db);
  }
  // A household's grown-ups must not share a sender address. Two members pointing at one
  // wallet is not a second payer, it is one wallet being asked to sign under two names —
  // and it is how a member could quietly make every payout need somebody else's wallet.
  // Removed members are excluded: their row is kept for the audit trail, and a wallet has to
  // be reusable by whoever holds it next.
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_family_members_address ON family_members(family_id, address)
       WHERE address IS NOT NULL AND removed_at IS NULL`,
  );
  // ---- who wrote a lock override (#301) ----
  //
  // An override had no author, so the only tiebreak was recency and a kid's Treasure Box
  // unlock, written after a parent's grounding, simply won. Real NIM bought a way out of a
  // punishment.
  //
  // DEFAULT 'parent' is the correct read for a legacy row rather than a convenient one: a
  // parent row is what almost all of them are, and the handful that were purchases have
  // long since expired, at which point the two are indistinguishable. The backfill is
  // still EXACT for the ones that matter — a screen-time receipt names the override it
  // bought in `kid_purchases.ref_id`, so the rows a kid paid for can be identified rather
  // than guessed at, and any that are somehow still live come back as purchases.
  // #364: a pairing code can name the kid its tablet belongs to, so nobody types a UUID.
  // Nullable on purpose — a code minted from Settings still means "this household", and a
  // parent phone redeeming one at POST /api/pair ignores it entirely.
  addColumn("ALTER TABLE pair_codes ADD COLUMN child_id TEXT REFERENCES children(id)");

  if (addColumn("ALTER TABLE lock_overrides ADD COLUMN source TEXT NOT NULL DEFAULT 'parent'")) {
    db.run(
      `UPDATE lock_overrides SET source='purchase' WHERE id IN
         (SELECT ref_id FROM kid_purchases WHERE kind='screen_time' AND ref_id IS NOT NULL)`,
    );
  }
  syncStickerCatalog(db);
}

/**
 * Give every existing household the owner row it always implicitly had.
 *
 * Runs EXACTLY ONCE, on the boot that adds `parent_tokens.member_id`, and the backfill is
 * EXACT rather than a guess: until this shipped a household could hold only one grown-up, so
 * `families.parent_label` and `families.parent_address` are that grown-up's name and wallet,
 * and every parent token in existence is a phone in their hand.
 *
 * Contrast `payout_attempts.sender`, deliberately left NULL with no backfill: there the
 * pre-existing rows were server-signed and a stamped default would have erased the very
 * distinction the column exists to record. Here there is nothing to erase — the owner is the
 * only answer the old schema could have given.
 *
 * The address is copied, not shared. From here on `families.parent_address` means the TILL
 * (where a Treasure Box spend returns) and the member's own `address` means the SENDER (whose
 * wallet pays a kid). They start life equal for every existing household, which is exactly
 * today's behaviour, and they are free to diverge the moment a second grown-up arrives.
 */
function backfillOwnerMembers(db: Database) {
  const families = db.query("SELECT id, parent_label, parent_address FROM families")
    .all() as { id: string; parent_label: string; parent_address: string | null }[];
  for (const fam of families) {
    // Idempotent even so: a household that somehow already has an owner is left alone, so a
    // rerun (a restored database, a re-added column) cannot mint a second one.
    const existing = db.query("SELECT id FROM family_members WHERE family_id=? AND role='owner' AND removed_at IS NULL")
      .get(fam.id) as { id: string } | null;
    const id = existing?.id ?? crypto.randomUUID();
    if (!existing) {
      db.run(
        "INSERT INTO family_members (id, family_id, label, role, address, created_at) VALUES (?,?,?,'owner',?,?)",
        [id, fam.id, fam.parent_label || "Parent", fam.parent_address || null, Date.now()],
      );
    }
    db.run("UPDATE parent_tokens SET member_id=? WHERE family_id=? AND member_id IS NULL", [id, fam.id]);
  }
}

/**
 * Stamp keys onto rows that were seeded before there was anywhere to put one.
 *
 * Runs EXACTLY ONCE, on the boot that adds `chores.title_key`, because the demo
 * households and onboarding boards already on disk are the ones a judge opens.
 * Without this, localization would only reach families created after the deploy
 * and every existing demo would stay English under translated headings — the
 * exact bug, still visible on the exact instance it was reported on.
 *
 * Matched on the exact English we seeded, so it can only ever hit our own rows.
 * A parent who typed "Make your bed" themselves gets a key too, and that is the
 * correct outcome rather than a collision: it is the same job, it now translates,
 * and if they later edit the title the write path clears the key anyway.
 *
 * Two seeded strings are deliberately NOT matched here. "Tidy up your room"
 * (onboarding) and "Tidy your room" (demo) differ by one word and both mean
 * `cat.job.room`; the alias list carries them, because dropping either would
 * leave one of the two front doors untranslated.
 */
function backfillTitleKeys(db: Database) {
  const english = catalogEnglish();
  /** Seeded prose that predates the catalog and no longer matches it verbatim. */
  const ALIASES: Record<string, string> = { "Tidy up your room": jobKey("room") };

  const byText = new Map<string, string>();
  for (const [key, text] of Object.entries(english)) byText.set(text, key);
  for (const [text, key] of Object.entries(ALIASES)) byText.set(text, key);

  for (const [text, key] of byText) {
    db.run("UPDATE chores SET title_key=? WHERE title=? AND title_key IS NULL", [key, text]);
    db.run("UPDATE routine_tasks SET title_key=? WHERE title=? AND title_key IS NULL", [key, text]);
    db.run("UPDATE routines SET title_key=? WHERE title=? AND title_key IS NULL", [key, text]);
    db.run("UPDATE practices SET title_key=? WHERE title=? AND title_key IS NULL", [key, text]);
    db.run("UPDATE sticker_packs SET title_key=? WHERE title=? AND title_key IS NULL", [key, text]);
    db.run("UPDATE store_categories SET title_key=? WHERE title=? AND title_key IS NULL", [key, text]);
    // A parent who has edited a shelf row owns it, exactly as syncStickerCatalog
    // already respects. Stamping a key on it would put our words back over theirs
    // the moment the device language changed.
    db.run(
      "UPDATE store_items SET title_key=? WHERE title=? AND title_key IS NULL AND parent_edited=0",
      [key, text],
    );
  }
}

/**
 * Seed (and RE-seed) the sticker catalog from src/sticker-catalog.ts.
 *
 * Upsert, not INSERT OR IGNORE: this data changes — the art moved from
 * hand-drawn SVG to emoji, and the pack prices moved from a tenth of a cent to
 * something a kid has to save for. An ignore-on-conflict seed would have left
 * every existing database on the old set forever.
 */
function syncStickerCatalog(db: Database) {
  for (const p of STICKER_PACKS) {
    db.run(
      `INSERT INTO sticker_packs (id, title, title_key, price_luna, active, sort, theme)
       VALUES (?,?,?,?,1,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, title_key=excluded.title_key,
         price_luna=excluded.price_luna, sort=excluded.sort, theme=excluded.theme`,
      [p.id, p.title, rowKey(p.id), p.priceLuna, p.sort, p.theme ? 1 : 0],
    );
  }
  for (const s of STICKERS) {
    db.run(
      `INSERT INTO stickers (id, pack_id, label, emoji, asset_url, kind, is_boss, created_at)
       VALUES (?,?,?,?,?,'art',?,0)
       ON CONFLICT(id) DO UPDATE SET
         pack_id=excluded.pack_id, label=excluded.label,
         emoji=excluded.emoji, asset_url=excluded.asset_url, is_boss=excluded.is_boss`,
      [s.id, s.packId, s.label, s.emoji, stickerAssetUrl(s.id), s.boss ? 1 : 0],
    );
  }
  // Art stickers that are no longer in the catalog: keep the row (placements
  // reference it) but retire it from the packs so it can't be granted again.
  const keep = STICKERS.map((s) => `'${s.id}'`).join(",");
  db.run(`UPDATE stickers SET pack_id=NULL WHERE kind='art' AND id NOT IN (${keep})`);

  for (const item of packStoreItems()) {
    db.run(
      `INSERT INTO store_items (id, category_id, kind, title, title_key, price_luna, payload, active, sort)
       VALUES (?,?,?,?,?,?,?,1,?)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, title_key=excluded.title_key,
         price_luna=excluded.price_luna, payload=excluded.payload, sort=excluded.sort
       WHERE parent_edited=0`,
      [item.id, item.categoryId, item.kind, item.title, rowKey(item.packId), item.priceLuna, item.payload, item.sort],
    );
  }
  // The shelves schema.sql seeds (screen time, coupons, timers) keep their rows
  // there; the catalogue owns their price, their face and whether they are still
  // offered — until a parent edits the row, after which the row is theirs.
  for (const [id, def] of Object.entries(OTHER_STORE_ITEMS)) {
    db.run(
      "UPDATE store_items SET price_luna=?, payload=?, active=? WHERE id=? AND parent_edited=0",
      [def.priceLuna, JSON.stringify(def.payload), def.retired ? 0 : 1, id],
    );
  }
  // Titles the catalogue owns, re-applied like the prices above. Only the rows
  // named in ITEM_CATALOG / SHELF_CATALOG: screen-time tiles and timer styles
  // are rendered from their payload by box.js and would be double-named here.
  for (const { id } of ITEM_CATALOG) {
    db.run("UPDATE store_items SET title_key=? WHERE id=? AND parent_edited=0", [rowKey(id), id]);
  }
  for (const { id } of SHELF_CATALOG) {
    db.run("UPDATE store_categories SET title_key=? WHERE id=? AND parent_edited=0", [rowKey(id), id]);
  }
  for (const [id, icon] of Object.entries(CATEGORY_ICONS)) {
    db.run("UPDATE store_categories SET icon=? WHERE id=? AND parent_edited=0", [icon, id]);
  }
  for (const id of RETIRED_CATEGORIES) {
    db.run("UPDATE store_categories SET active=0 WHERE id=? AND parent_edited=0", [id]);
  }
}

export function getDb(): Database {
  if (!_db) throw new Error("DB not initialized: call initDb() first");
  return _db;
}

/** Reset for tests: in-memory DB with schema applied. */
export function initTestDb(): Database {
  return initDb(":memory:");
}

/** Re-run the catalogue seed over the CURRENT database, exactly as a restart
 *  does. Exported for tests: the `parent_edited` guard is only meaningful if
 *  something can prove a parent's edit survives the next boot. */
export function reseedCatalog(): void {
  syncStickerCatalog(getDb());
}
