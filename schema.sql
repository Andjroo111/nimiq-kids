-- nimiq.kids data model. D1-compatible (no SQLite-only pragmas here).
-- COPPA: children carry ZERO PII — label + emoji only.
--
-- Custody, stated plainly, and it is now TWO things depending on `children.address_source`:
--   'derived'  the kid's account is derived from a server-held master seed (src/nimiq/hd.ts),
--              so the server can sign for it. Server-custodied. This is the original model.
--   'parent'   the address was chosen by a parent out of their OWN Nimiq wallet and proved
--              with a signature (src/nimiq/address-proof.ts). No key for it exists on this
--              server and none can be derived. Nobody here can move that money.
-- Which one an instance hands to a NEW kid is HATCH_CUSTODY (src/custody-boot.ts); existing
-- rows keep whatever they already had until a parent re-registers them.
--
-- The chain is still the source of truth for balances under both; the `cashlinks` table only
-- records payouts. All timestamps are epoch-ms integers.

CREATE TABLE IF NOT EXISTS families (
  id             TEXT PRIMARY KEY,
  parent_label   TEXT NOT NULL,            -- "Mom" (display only, not legal identity)
  parent_address TEXT NOT NULL,            -- NQ.. funding address (public)
  mode           TEXT NOT NULL DEFAULT 'demo', -- 'demo' (competition) | 'family' (Hatch: approvals + stars)
  pin_hash       TEXT,                     -- parent PIN (Bun.password hash); family mode only
  pin_attempts   INTEGER NOT NULL DEFAULT 0,
  pin_locked_until INTEGER,                -- lockout after repeated failures
  star_rate_luna INTEGER NOT NULL DEFAULT 10000, -- luna per star on payout day (0.1 NIM)
  notify_url     TEXT,                     -- ntfy topic / webhook for parent notifications
  tz             TEXT NOT NULL DEFAULT 'America/Chicago',
  budget_exempt  INTEGER NOT NULL DEFAULT 0, -- 1 = no payout-budget cap (grandfathered/trusted household)
  -- The parent's switch on whether kids may take jobs off their own board.
  kids_can_remove INTEGER NOT NULL DEFAULT 1,
  -- Throwaway judge-demo household (src/demo-family.ts): when it was minted. NULL on
  -- every real family, and the sweeper only ever looks at non-NULL rows.
  demo_at        INTEGER,
  -- The household's own branch in the HD tree (m/44'/242'/7'/hd_index'/...). Assigned lazily,
  -- globally unique, never reused. NULL until this family's first kid account is provisioned.
  hd_index       INTEGER,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS children (
  id            TEXT PRIMARY KEY,
  family_id     TEXT NOT NULL REFERENCES families(id),
  label         TEXT NOT NULL,             -- parent-entered nickname; NOT a legal name
  emoji         TEXT NOT NULL DEFAULT '🦖',
  balance_luna  INTEGER NOT NULL DEFAULT 0,-- convenience tally for the kid screen (not custody)
  streak_count  INTEGER NOT NULL DEFAULT 0,
  star_balance  INTEGER NOT NULL DEFAULT 0,-- family mode: convenience tally; star_events is truth
  -- Screen-time budget, minutes per LOCAL day. 0 = no meter (the old behaviour), which is
  -- what every household that never sets one keeps: the meter is opt-in per kid, same as
  -- the curfew is opt-in per family.
  daily_screen_min INTEGER NOT NULL DEFAULT 0,
  -- Ceiling on Treasure Box minutes ON TOP of the base, per day. Not a wallet limit -- a
  -- kid with 40,000 NIM still cannot buy a fourth hour, because the cap is the rule and
  -- the price is only what makes it cost something.
  max_earned_min   INTEGER NOT NULL DEFAULT 0,
  -- Sittings: play for play_min in one go, then rest for rest_min. Either 0 = no rule,
  -- opt-in per kid exactly like the meter above.
  play_min         INTEGER NOT NULL DEFAULT 0,
  rest_min         INTEGER NOT NULL DEFAULT 0,
  account_index INTEGER,                   -- V2: HD index i of the kid's real account
  -- The family branch this kid's key hangs off: path is m/44'/242'/7'/hd_family_index'/i'.
  -- NULL means the LEGACY flat path m/44'/242'/7'/i' (indices were instance-global then).
  -- Permanent per row — changing it changes the address and strands the funds.
  hd_family_index INTEGER,
  address       TEXT,                      -- the kid's NQ address (public). Whose key it is: address_source.
  -- Where `address` came from. NULL = this kid has no address yet, which is a third state and
  -- not the same as either of the others.
  --   'derived'  from HATCH_MASTER_SEED via account_index/hd_family_index. Server can sign.
  --   'parent'   registered by a parent out of their own wallet, with a proof below. Server cannot.
  address_source TEXT,
  -- The server-custodied address this kid used to hold, kept when `address` moves to a
  -- parent-owned one. Without it the derivation coordinates still exist but nothing records
  -- WHICH address they produced, and the boot guard's "no server-held money is stranded"
  -- check would be reading the wrong account. Never cleared while account_index is set.
  derived_address TEXT,
  -- The binding proof, stored whole so it can be re-verified from the row alone, years later,
  -- by anything that can hash and check an ed25519 signature. Storing only "verified: yes"
  -- would make this table's word the evidence, which is precisely what a proof is for.
  address_proof_message TEXT,               -- the challenge, VERBATIM as it was signed
  address_proof_pubkey  TEXT,               -- signerPublicKey, hex
  address_proof_sig     TEXT,               -- signature, hex
  address_registered_at INTEGER,
  created_at    INTEGER NOT NULL
);
-- NOTE: the unique indexes on children.account_index live in src/db.ts migrate() —
-- schema.sql runs BEFORE migrations, so pre-V2 DBs don't have the columns yet here.

-- A pending "prove you hold this address" challenge.
--
-- Server-side and resumable by id ON PURPOSE. The Hub is a full-page REDIRECT on mobile, so
-- anything held in page memory between chooseAddress and signMessage is gone by the time the
-- proof comes back. Single-use (`used_at`) and short-lived, so a proof cannot be replayed, and
-- the message binds the child and the address so a proof for one kid cannot be posted for another.
CREATE TABLE IF NOT EXISTS kid_address_challenges (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL REFERENCES families(id),
  child_id    TEXT NOT NULL REFERENCES children(id),
  address     TEXT NOT NULL,                -- canonical spaced form, checksum already verified
  message     TEXT NOT NULL,                -- what the wallet must sign, byte for byte
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kid_addr_challenges_child ON kid_address_challenges(child_id, created_at);

-- One challenge, signed once per child, in a single wallet popup (`connectAccount`).
--
-- Deliberately NOT kid_address_challenges with a nullable address: there, the message names
-- one child and one address and the binding is IN the signed bytes. Here the Keyguard signs
-- one identical string with each requested key path, so the message cannot name anyone, and
-- which address belongs to which child is asserted by the client at registration instead.
-- Two different strengths of evidence should not share a table and look alike.
CREATE TABLE IF NOT EXISTS family_connect_challenges (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL REFERENCES families(id),
  message     TEXT NOT NULL,                -- what every key signs, byte for byte
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_connect_challenges_family
  ON family_connect_challenges(family_id, created_at);

CREATE TABLE IF NOT EXISTS chores (
  id            TEXT PRIMARY KEY,
  family_id     TEXT NOT NULL REFERENCES families(id),
  child_id      TEXT NOT NULL REFERENCES children(id),
  title         TEXT NOT NULL,
  title_key     TEXT,                      -- src/title-catalog.ts key; NULL = the parent's own words
  emoji         TEXT NOT NULL DEFAULT '🧽',
  kind          TEXT NOT NULL DEFAULT 'chore',
                -- 'chore' (household task) | 'lesson' (learn-to-earn, e.g. Brilliant math/coding)
  subject       TEXT,                      -- lesson only: 'math' | 'coding'
  reward_shape  TEXT,                      -- lesson only: 'per-lesson' | 'per-streak-day' | 'per-milestone'
  reward_luna   INTEGER NOT NULL,
  reward_stars  INTEGER NOT NULL DEFAULT 0,-- family mode: stars credited on approval
  duration_s    INTEGER,                   -- family mode: optional egg timer on the chore
  status        TEXT NOT NULL DEFAULT 'open',
                -- open -> submitted -> approved (paid via cashlink) -> claimed | rejected
  submitted_at  INTEGER,
  approved_at   INTEGER,
  -- Who put this job on the board. A kid may add their own (Andjroo, 2026-07-30);
  -- a parent-assigned chore is not the same thing and the two are told apart here.
  created_by    TEXT NOT NULL DEFAULT 'parent',   -- 'parent' | 'kid'
  -- Removal is SOFT. A parent has to be able to see that a kid took their laundry
  -- off the board, which a DELETE would erase completely.
  removed_at    INTEGER,
  removed_by    TEXT,                             -- 'parent' | 'kid'
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cashlinks (
  id               TEXT PRIMARY KEY,
  family_id        TEXT NOT NULL REFERENCES families(id),
  chore_id         TEXT REFERENCES chores(id),      -- null for peer-to-peer sends
  child_id         TEXT REFERENCES children(id),
  kind             TEXT NOT NULL DEFAULT 'payout',  -- 'payout' | 'peer'
  cashlink_address TEXT NOT NULL,                   -- the address we POLL for claim
  value_luna       INTEGER NOT NULL,
  message          TEXT,
  url              TEXT NOT NULL,                   -- shareable (#secret in fragment)
  url_secret       TEXT,                            -- the #fragment alone; looked up by EXACT equality
  funding_tx_hash  TEXT,
  status           TEXT NOT NULL DEFAULT 'funding', -- funding -> ready -> claimed | expired
  created_at       INTEGER NOT NULL,
  claimed_at       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_chores_family_status ON chores(family_id, status);
CREATE INDEX IF NOT EXISTS idx_cashlinks_status     ON cashlinks(status);
-- NOTE: the url_secret index is created in src/db.ts migrate(), NOT here. schema.sql runs
-- against databases that predate the url_secret column (CREATE TABLE IF NOT EXISTS is a no-op
-- on the existing cashlinks table, so it never adds the column); an index over url_secret here
-- throws "no such column" at boot before the migration's ALTER can add it.
CREATE INDEX IF NOT EXISTS idx_children_family       ON children(family_id);

-- ============================================================================
-- Family mode ("Hatch"): daily routines, parent approval, stars ledger.
-- The competition demo path is untouched; families.mode gates behavior.
-- Photos stay on the family's own server (self-hosted) — never a public deploy.
-- ============================================================================

CREATE TABLE IF NOT EXISTS routines (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  child_id   TEXT NOT NULL REFERENCES children(id),
  slot       TEXT NOT NULL DEFAULT 'morning',    -- 'morning' | 'afternoon' | 'evening' | 'custom'
  title      TEXT NOT NULL,                      -- "Morning routine"
  title_key  TEXT,                               -- catalog key; NULL = the parent's own words
  emoji      TEXT NOT NULL DEFAULT '🌅',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_tasks (
  id            TEXT PRIMARY KEY,
  routine_id    TEXT NOT NULL REFERENCES routines(id),
  position      INTEGER NOT NULL,                -- order within the routine
  title         TEXT NOT NULL,                   -- "Brush teeth"
  title_key     TEXT,                            -- catalog key; NULL = the parent's own words
  emoji         TEXT NOT NULL DEFAULT '🪥',
  icon_asset_id TEXT REFERENCES media_assets(id),-- kid-photo task icon (nullable)
  duration_s    INTEGER NOT NULL,                -- egg-timer length
  reward_stars  INTEGER NOT NULL DEFAULT 1,      -- demo-era stars (kept for compat; ignored in family mode V2)
  reward_luna   INTEGER NOT NULL DEFAULT 0,      -- V2 family mode: NIM paid on approval
  -- A SIDE QUEST (#341): the kid finishes the day without it, and doing it pays its own
  -- reward_luna on top. Deliberately a flag on the step and not a second table: it is the
  -- same step, ordered the same way, run through the same timer, and the only thing that
  -- differs is whether the run waits for it. The parent's word for it is "extra credit";
  -- "optional" reads to a kid as "does not matter".
  --
  -- NO PAYMENT CODE KNOWS ABOUT THIS COLUMN, and it must stay that way. runRewardLuna sums
  -- reward_luna over the task runs reading 'done', so a bonus that got done already pays and
  -- one that did not already pays nothing. What the flag changes is COMPLETION: see
  -- repo-routines.allTasksFinished, which now waits only on the required steps.
  optional      INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);

-- One run per routine per local day (family TZ). Server-side timestamps make
-- egg timers resumable across WebView/browser restarts.
CREATE TABLE IF NOT EXISTS routine_runs (
  id          TEXT PRIMARY KEY,
  routine_id  TEXT NOT NULL REFERENCES routines(id),
  child_id    TEXT NOT NULL REFERENCES children(id),
  day         TEXT NOT NULL,                     -- 'YYYY-MM-DD' in family TZ
  status      TEXT NOT NULL DEFAULT 'in_progress',
              -- in_progress -> done_pending (awaiting parent) -> approved | back to in_progress on reject
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE(routine_id, day)
);

CREATE TABLE IF NOT EXISTS task_runs (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES routine_runs(id),
  task_id     TEXT NOT NULL REFERENCES routine_tasks(id),
  -- pending -> running -> done | skipped | passed
  --
  -- 'skipped' and 'passed' are both terminal and both unpaid, and they are two states rather
  -- than one because they are two different sentences on the parent's card. 'skipped' is a
  -- PARENT excusing a step (the /skip route is parent authed); 'passed' is a KID leaving a
  -- side quest on the table when they tapped the chest. Overloading 'skipped' would have cost
  -- nothing in money and lost the household the only record of which of those happened.
  status      TEXT NOT NULL DEFAULT 'pending',
  started_at  INTEGER,                           -- server clock; client derives remaining
  finished_at INTEGER,
  UNIQUE(run_id, task_id)
);

-- Unified approval queue: routine runs AND one-off chores flow through here.
CREATE TABLE IF NOT EXISTS approvals (
  id             TEXT PRIMARY KEY,
  family_id      TEXT NOT NULL REFERENCES families(id),
  child_id       TEXT NOT NULL REFERENCES children(id),
  subject_kind   TEXT NOT NULL,                  -- 'routine_run' | 'chore'
  subject_id     TEXT NOT NULL,                  -- routine_runs.id or chores.id
  photo_asset_id TEXT REFERENCES media_assets(id), -- kid's proof photo (nullable). Cleared and
                                                   -- the asset deleted the moment the approval
                                                   -- is decided, or after 24h (#282).
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending -> approved | rejected
  method         TEXT,                           -- which path decided it: 'pin' | 'remote'
  -- WHICH GROWN-UP said yes (family_members.id). `method` says how they proved it; this says
  -- who they were, which only became a question worth asking once a household could hold more
  -- than one. NULL for an on-tablet PIN (nobody signed in) and for every approval decided
  -- before members existed.
  decided_by_member_id TEXT REFERENCES family_members(id),
  -- PARTIAL CREDIT (#351): what fraction of the subject's own price this approval pays, in
  -- basis points, 0..10000. NULL means full, which is what every row written before this
  -- existed is. Basis points and never a float: luna is an integer and the payout has to be
  -- reproducible from the row months later, which a stored 0.1+0.2 is not.
  -- The payout is floor(full * share_bps / 10000) — FLOOR, never round, so a family can pay
  -- less than the promise and never more than it.
  -- Cleared by reopenApproval: a reopened approval is a fresh decision, not a replay.
  -- STARS are deliberately NOT scaled by this. Nothing awards stars on an approval today
  -- (addStarEvent has one caller, the payout in routes/stars.ts), so there is no behaviour to
  -- pin yet; when something does, the rule is FULL stars on a partial share. Stars are praise
  -- and money is the wage, and a kid who did most of the job should not be docked twice.
  share_bps      INTEGER,
  note           TEXT,                           -- parent note on reject ("bed's still messy")
  stars_awarded  INTEGER,                        -- snapshot at decision time
  created_at     INTEGER NOT NULL,
  decided_at     INTEGER
);
-- at most ONE pending approval per subject
CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_pending
  ON approvals(subject_kind, subject_id) WHERE status = 'pending';

-- WHAT A KID IS SAVING FOR, and how close they are (#354, epic #350).
--
-- THIS IS A MIRROR, NOT A JAR. The meter is balance_luna / target_luna and nothing else. No NIM
-- is moved, nothing is reserved, and a kid who spends in the Treasure Box tomorrow watches the
-- meter drop. That is deliberate: a JAR that actually sets money aside needs a reservation where
-- kid_debits and the spend lock live, it can race a Treasure Box purchase, and it hands a kid a
-- second balance to understand. It is a real feature and it is not this one.
CREATE TABLE IF NOT EXISTS savings_targets (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL REFERENCES families(id),
  child_id    TEXT NOT NULL REFERENCES children(id),
  title       TEXT NOT NULL,
  title_key   TEXT,                            -- catalog key; NULL = a parent or kid typed it
  emoji       TEXT,
  target_luna INTEGER NOT NULL,
  -- The Treasure Box item this points at, when it points at one. Nullable because "a bike" is a
  -- perfectly good target and the shelf has no bike on it. A REAL FK, so a target cannot outlive
  -- the row it names -- store_items are retired (active=0) rather than deleted, so a target
  -- pointed at a retired item keeps reading its snapshot price.
  item_id     TEXT REFERENCES store_items(id),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  -- Stamped the FIRST time the balance touches the target, and never cleared. Getting there is a
  -- thing that HAPPENED: if the kid then spends the money the meter drops but the moment stays
  -- true. That is the whole difference between this and a progress bar.
  reached_at  INTEGER
);
-- ONE active target per kid. A kid saving for four things at once is saving for nothing, and it
-- keeps the money screen to one meter. Partial unique index, the same shape idx_approvals_pending
-- uses, so the rule is the database's rather than four call sites'.
CREATE UNIQUE INDEX IF NOT EXISTS idx_savings_target_active
  ON savings_targets(child_id) WHERE active = 1;

-- Stars ledger: the ledger is truth; children.star_balance is a convenience tally
-- (same philosophy as balance_luna vs the chain).
CREATE TABLE IF NOT EXISTS star_events (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL REFERENCES families(id),
  child_id    TEXT NOT NULL REFERENCES children(id),
  delta       INTEGER NOT NULL,                  -- + earn, - payout/adjust
  reason      TEXT NOT NULL,                     -- 'routine' | 'chore' | 'bonus' | 'payout' | 'adjust'
  approval_id TEXT REFERENCES approvals(id),
  cashlink_id TEXT REFERENCES cashlinks(id),     -- set on 'payout' rows
  created_at  INTEGER NOT NULL
);

-- Kid uploads: hatch photos, task icons, proof shots, recorded sounds.
-- Files live under MEDIA_DIR on the family server; rows are metadata only.
CREATE TABLE IF NOT EXISTS media_assets (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  child_id   TEXT REFERENCES children(id),       -- owner kid; null = family-wide
  kind       TEXT NOT NULL,                      -- 'image' | 'audio'
  role       TEXT NOT NULL,                      -- 'hatch' | 'task_icon' | 'proof' | 'sound'
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  path       TEXT NOT NULL,                      -- relative to MEDIA_DIR
  created_at INTEGER NOT NULL
);

-- Per-kid customization (the Little Timer trio: hatch / sounds / background).
CREATE TABLE IF NOT EXISTS kid_prefs (
  child_id       TEXT PRIMARY KEY REFERENCES children(id),
  background_id  TEXT NOT NULL DEFAULT 'meadow',
  music_id       TEXT NOT NULL DEFAULT 'sunny-day',
  timer_sound_id TEXT NOT NULL DEFAULT 'soft-tick',
  alarm_sound_id TEXT NOT NULL DEFAULT 'chick-chirp',
  hatch_mode     TEXT NOT NULL DEFAULT 'surprise', -- 'surprise' (random) | 'photo'
  hatch_asset_id TEXT REFERENCES media_assets(id),
  timer_style_id TEXT NOT NULL DEFAULT 'egg',      -- 'egg' (free) | owned Box style ('maker' | 'polaroid')
  -- The scene behind the RUNNING TIMER, kept apart from background_id (the app's
  -- scene) so a kid can have a calm timer on a loud app, or the reverse. NULL
  -- means "same as the app", which is what every kid had before the split and
  -- is what a kid gets until they deliberately choose otherwise -- so nothing
  -- changes appearance on the day this ships.
  timer_background_id TEXT,
  updated_at     INTEGER NOT NULL
);

-- Non-sticker ownership grants (timer styles today; any future Box kind reuses it).
CREATE TABLE IF NOT EXISTS kid_unlocks (
  child_id   TEXT NOT NULL REFERENCES children(id),
  kind       TEXT NOT NULL,                        -- 'timer_style' | future kinds
  ref_id     TEXT NOT NULL,                        -- e.g. the styleId ('maker', 'polaroid')
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, kind, ref_id)
);

-- Kiosk tablets (Phase B wiring; tables land with the rest of the family-mode schema).
CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  family_id    TEXT NOT NULL REFERENCES families(id),
  label        TEXT NOT NULL,                    -- "Sam's tablet"
  child_id     TEXT REFERENCES children(id),     -- bound kid; null = shared (avatar login)
  -- Which kid this device is CURRENTLY acting as, once that kid's secret picture was
  -- entered here (#123). Distinct from child_id above: that is a permanent binding set at
  -- pairing, this is the live session on a shared tablet and changes every time a kid
  -- passes the switch gate. Null = never unlocked, which reads as "gate everyone who has
  -- a secret". No expiry column on purpose: the gate is on SWITCHING, so a window that
  -- lapsed mid-session would refuse a kid's own Treasure Box for no reason a kid could
  -- understand.
  unlocked_child_id TEXT REFERENCES children(id),
  token_hash   TEXT NOT NULL,                    -- sha-256 of the device bearer token
  allowed_apps TEXT NOT NULL DEFAULT '[]',       -- JSON array of Android package names
  installed_apps TEXT NOT NULL DEFAULT '[]',     -- JSON [{pkg,label}] reported by the wrapper
  -- The charge as the tablet last reported it (KIOSK-CONTRACT §11). NULL = never reported.
  battery_pct      INTEGER,
  battery_charging INTEGER,
  battery_at       INTEGER,
  last_seen_at INTEGER,
  created_at   INTEGER NOT NULL
);

-- When each routine's lock window engages, per weekday (Mon..Sun mask).
CREATE TABLE IF NOT EXISTS lock_windows (
  id         TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES routines(id),
  start_hhmm TEXT NOT NULL,                      -- '06:30' lock engages
  end_hhmm   TEXT NOT NULL,                      -- '09:00' hard stop
  days       TEXT NOT NULL DEFAULT '1111100'
);

-- The hours the tablet may be used AT ALL, per weekday (Mon..Sun mask). Family-wide:
-- both kids in this house keep the same hours, and a per-child column would have to be
-- written twice to say one thing.
--
-- The POLARITY is the opposite of lock_windows above, and that is the whole point. A
-- lock_window is a chore deadline ("locked UNTIL the routine is done"), so outside every
-- window the machine falls through to UNLOCKED. An allow_window is a curfew ("usable ONLY
-- inside these hours"), so outside every window the machine LOCKS. A household with no
-- allow_windows rows keeps the old behaviour exactly -- the curfew is opt-in, and an empty
-- table cannot brick a tablet that was working yesterday.
CREATE TABLE IF NOT EXISTS allow_windows (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  start_hhmm TEXT NOT NULL,                      -- '07:00' the tablet becomes usable
  end_hhmm   TEXT NOT NULL,                      -- '20:00' curfew; [start, end) in family tz
  days       TEXT NOT NULL DEFAULT '1111111'
);
CREATE INDEX IF NOT EXISTS idx_allow_windows_family ON allow_windows(family_id);

-- One row per kid per LOCAL day: the screen-time meter. Written by the tablet (which is the
-- only thing that can see whether a game is in front) and read by the lock machine.
--
-- `used_sec` is seconds rather than minutes because the wrapper reports a partial tick when
-- it syncs, and rounding every report to a minute would let a kid farm free time by
-- toggling the screen. `earned_sec` is what Treasure Box minutes add to, kept separate from
-- the base budget so "how much did they buy today" survives a change to the base.
--
-- No row = nothing used yet today. Absence is the zero, so the meter needs no daily reset
-- job: a new local day simply has no row.
CREATE TABLE IF NOT EXISTS screen_usage (
  child_id   TEXT NOT NULL REFERENCES children(id),
  local_day  TEXT NOT NULL,                      -- 'YYYY-MM-DD' in the family tz
  used_sec   INTEGER NOT NULL DEFAULT 0,
  earned_sec INTEGER NOT NULL DEFAULT 0,
  -- The sitting the meter is inside of: seconds burned since the kid last rested, and
  -- when the tablet last reported burning at all (0 = not yet today). On the DAY row on
  -- purpose, so midnight clears a sitting the same way it clears the meter.
  sitting_sec  INTEGER NOT NULL DEFAULT 0,
  last_burn_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (child_id, local_day)
);

-- Battery log (§11): one row per accepted report, so a day's drain can be read back.
-- Pruned to 30 days on write; "are they dying fast" is a question about last week.
CREATE TABLE IF NOT EXISTS device_battery (
  device_id TEXT NOT NULL REFERENCES devices(id),
  at        INTEGER NOT NULL,
  pct       INTEGER NOT NULL,
  charging  INTEGER NOT NULL,
  PRIMARY KEY (device_id, at)
);

-- Manual override of the derived lock state. WHO wrote a row decides which one is in
-- charge; recency only breaks ties between rows by the same author (src/repo-lock.ts).
CREATE TABLE IF NOT EXISTS lock_overrides (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  child_id   TEXT REFERENCES children(id),       -- null = whole family
  mode       TEXT NOT NULL,                      -- 'lock' | 'unlock'
  -- 'parent' = a grown-up said so | 'purchase' = minutes a kid bought in the Treasure
  -- Box. Without this column the newest row won outright, so a kid could spend real NIM
  -- and end a grounding (#301).
  source     TEXT NOT NULL DEFAULT 'parent',
  until_ms   INTEGER,                            -- null = until cleared
  cleared_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Bearer tokens for the parent phone page (token shown once; only the hash stored).
CREATE TABLE IF NOT EXISTS parent_tokens (
  id           TEXT PRIMARY KEY,
  family_id    TEXT NOT NULL REFERENCES families(id),
  token_hash   TEXT NOT NULL,
  label        TEXT NOT NULL,                    -- "Andjroo's phone"
  -- WHICH grown-up this phone is signed in as (family_members.id). The token used to carry
  -- only a household, so every parent bearer was the same, anonymous authority; this is what
  -- makes "Grandma approved it, out of Grandma's wallet" a fact the server can state.
  -- NULL means a token minted before members existed, and reads as the household's owner.
  member_id    TEXT REFERENCES family_members(id),
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);

-- Short-lived 6-digit pairing codes: a signed-in parent session shows one, typing it
-- on another device (e.g. the Nimiq Pay WebView when the #t= fragment got dropped)
-- mints a parent token for the same family. Single use, ~5 min TTL, hash-only.
CREATE TABLE IF NOT EXISTS pair_codes (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  code_hash  TEXT NOT NULL,                      -- sha-256 of the 6-digit code, shown once
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pair_codes_hash ON pair_codes(code_hash);

-- ============================================================================
-- V2 wallet core: real kid accounts. Kids EARN NIM directly (family mode moves
-- off stars); each kid's derived on-chain account is the destination. The chain
-- is the source of truth for real balances; wallet_events is the instant-UX
-- kid-facing activity feed, reconciled by tx_hash when on-chain truth arrives.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_events (
  id                   TEXT PRIMARY KEY,
  family_id            TEXT NOT NULL REFERENCES families(id),
  child_id             TEXT REFERENCES children(id),  -- null = family-level (hot-wallet top-up)
  kind                 TEXT NOT NULL,  -- 'earn'|'send'|'deposit'|'stake'|'unstake'|'reward'|'spend'
  status               TEXT NOT NULL DEFAULT 'done',  -- 'done' | 'pending' (unstake cooldown)
  counterparty_address TEXT,           -- NQ.. on the other side (nullable, e.g. SIM ledger rows)
  counterparty_label   TEXT,           -- kid-friendly name: "Family wallet", sibling label, "Cashlink"
  value_luna           INTEGER NOT NULL, -- SIGNED, from the kid's spendable-balance perspective
  tx_hash              TEXT,           -- on-chain hash; 'sim:<uuid>' in SIM; null until broadcast
  message              TEXT,
  available_at         INTEGER,        -- pending unstake: epoch-ms when funds release
  -- Idempotency key for a payout that may be RETRIED (an earn paid by an approval that
  -- was put back in the queue after a failure). One payout, one row, however many times
  -- its approval is tried. NULL for everything that is not retriable in that sense.
  payout_ref           TEXT,
  created_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_events_child  ON wallet_events(child_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_events_family ON wallet_events(family_id, created_at);

-- A payout's WRITE-AHEAD claim. wallet_events records a payment that DID happen; this
-- table records one we are about to attempt, and it is written BEFORE anything reaches a
-- node. That ordering is the whole point: a row in wallet_events proves a payment landed,
-- but its ABSENCE proves nothing — a node can accept a transaction and still lose the
-- response on the way back (RPC timeout, socket hang-up, tunnel blip). Deciding to retry
-- on the absence of a wallet_events row therefore paid a kid twice.
--
-- The claim carries the exact signed bytes, recorded before they are broadcast. A retry
-- rebroadcasts THOSE bytes rather than building a new transaction: identical bytes hash
-- identically, and a chain cannot apply one transaction twice. Rebuilding is what made
-- the second payment possible at all — validityStartHeight has moved on, so the rebuilt
-- transaction is byte-different, hashes differently, and no node dedupes it.
--
--   status 'preparing'  claimed; nothing has been broadcast. A failure here is provably
--                       pre-broadcast, so the claim is released and a retry starts clean.
--   status 'in_flight'  bytes were handed to a node. Outcome unknown until settled.
--   status 'settled'    the matching wallet_events row exists; the payment is history.
CREATE TABLE IF NOT EXISTS payout_attempts (
  payout_ref  TEXT PRIMARY KEY,       -- same key as wallet_events.payout_ref (the approval id)
  family_id   TEXT NOT NULL REFERENCES families(id),
  child_id    TEXT NOT NULL REFERENCES children(id),
  value_luna  INTEGER NOT NULL,
  recipient   TEXT NOT NULL,
  message     TEXT,
  raw_tx_hex  TEXT,                   -- exact signed bytes; NULL = provider would not hand them over
  tx_hash     TEXT,                   -- hash of those bytes, known before the broadcast
  status      TEXT NOT NULL,          -- 'preparing' | 'in_flight' | 'settled'
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  -- Parent-signed payout (NONCUSTODIAL-PLAN Phase 3). All four are NULL on a
  -- server-signed attempt, and all four are set together on an intent: they are the
  -- fields a parent's wallet must reproduce EXACTLY, so they are stored as literals
  -- rather than re-derived at verification time.
  sender                TEXT,           -- the parent address that must sign; NULL = server-signed
  intent_data           TEXT,           -- the exact extraData string the signed tx must carry
  validity_start_height INTEGER,        -- pinned, so the bytes are deterministic
  expires_at            INTEGER,        -- after this the intent is dead and must be re-minted
  -- How much of this payout's GROSS value went to clearing deferred spending instead of
  -- moving (see src/kid-netting.ts). Pinned at mint, because the parent signs `value_luna`
  -- and recomputing at settlement time would settle a debt the signature never accounted
  -- for. Doubles as the RESERVATION that stops two concurrent approvals netting against the
  -- same debt. NULL on a server-signed attempt and on every row written before netting.
  netted_luna           INTEGER
);

-- Deferred spending: what a kid has spent but has NOT moved on chain.
--
-- Under HATCH_CUSTODY=parent this server holds no key for a kid's address, so a Treasure Box
-- purchase cannot be a transaction — it would need the parent's wallet, a second popup for a
-- purchase they pre-approved by pricing the shelf. It records a row here instead, and the
-- next payout the parent signs is minted for the difference. See src/kid-netting.ts for the
-- four rules; the load-bearing one is that outstanding debt may never exceed the kid's
-- on-chain balance, so every luna the app shows is genuinely sitting at their address.
--
-- Deliberately NOT wallet_events: that table is the record of what MOVED, and these rows are
-- exactly the things that did not. (In SIM the ledger is also the balance, so a row in both
-- places would be counted twice.)
CREATE TABLE IF NOT EXISTS kid_debits (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL REFERENCES families(id),
  child_id    TEXT NOT NULL REFERENCES children(id),
  value_luna  INTEGER NOT NULL,  -- SIGNED IN THE DIRECTION OF DEBT: +v spent, -v cleared
  kind        TEXT NOT NULL,     -- 'hold' | 'purchase' | 'settlement' | 'refund'
  source_id   TEXT,              -- kid_purchases.id (hold/purchase/refund) | payout ref (settlement)
  message     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kid_debits_child ON kid_debits(child_id, kind);
-- One settlement per payout, one refund per purchase — the idempotency a fully-netted payout
-- has instead of transaction bytes to dedupe against. Partial, because a purchase row is
-- written before the receipt it belongs to exists and carries NULL until it is linked.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kid_debits_settlement
  ON kid_debits(source_id) WHERE kind='settlement';
CREATE UNIQUE INDEX IF NOT EXISTS idx_kid_debits_refund
  ON kid_debits(source_id) WHERE kind='refund';

-- Kid-initiated sends that need parent sign-off (cashlink to outside the family).
-- The approvals queue references these via subject_kind 'send'.
CREATE TABLE IF NOT EXISTS send_requests (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL REFERENCES families(id),
  child_id    TEXT NOT NULL REFERENCES children(id),
  kind        TEXT NOT NULL DEFAULT 'cashlink',
  value_luna  INTEGER NOT NULL,
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending -> executed | rejected
  cashlink_id TEXT REFERENCES cashlinks(id),     -- set on execute
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_send_requests_child ON send_requests(child_id, status);

-- Tiny server-side key/value state (hot-wallet balance snapshot, SIM accrual ticks).
CREATE TABLE IF NOT EXISTS wallet_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Per-family payout budget credits (public-instance economics). One shared hot wallet
-- serves every household, so each family may only be paid out what it brought in:
-- an env demo grant (HATCH_DEMO_GRANT_LUNA, not stored here) plus these attributed
-- credits. Rows are written by the verified in-app top-up path ('topup') and by the
-- operator's manual reconciliation script ('manual'). See src/repo-budget.ts.
CREATE TABLE IF NOT EXISTS family_budget_credits (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  value_luna INTEGER NOT NULL,             -- always positive
  source     TEXT NOT NULL,                -- 'topup' (verified in-app tx) | 'manual' (operator credit)
  tx_hash    TEXT,                         -- on-chain funding tx; null for manual credits
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_credits_family ON family_budget_credits(family_id);
-- The same on-chain tx must never credit a budget twice (INSERT OR IGNORE relies on this).
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_credits_tx
  ON family_budget_credits(tx_hash) WHERE tx_hash IS NOT NULL;

-- ============================================================================
-- V3 sticker chore chart: the kid home IS the chart. Stickers are the reward
-- language (NIM keeps flowing underneath via the existing approval -> pay path).
-- Catalog rows below are seeded idempotently (INSERT OR IGNORE) — Andjroo drops
-- real NanoBanana art in later by updating asset_url only, zero code change.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sticker_packs (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  title_key  TEXT,                              -- catalog key; NULL = a parent-made pack
  price_luna INTEGER NOT NULL DEFAULT 0,      -- 0 = not sold (starter pack, photo pool)
  active     INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER NOT NULL DEFAULT 0,
  -- A GOAL-LADDER THEME (Andjroo, 2026-08-04). Dragons, unicorns, robots. A theme pack is
  -- EARNED, NEVER SOLD: it is not on the Treasure Box shelf at any price, which is the whole
  -- reason climbing is worth it -- a kid with a big balance cannot shortcut it.
  --
  -- Its stickers are collected one per rung, across as many ladders as it takes, and they
  -- stay UNUSABLE everywhere else until the set is complete. Completing it grants the boss
  -- (stickers.is_boss) and releases the whole pack into the picker at once.
  theme      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stickers (
  id         TEXT PRIMARY KEY,
  pack_id    TEXT REFERENCES sticker_packs(id), -- null = kid-made photo sticker
  child_id   TEXT REFERENCES children(id),      -- photo stickers: the kid who made it
  label      TEXT NOT NULL,
  emoji      TEXT,                              -- art stickers: the glyph IS the art
  asset_url  TEXT,                              -- photo stickers: `local:<uuid>`, a handle into
                                                -- the tablet's IndexedDB. The bytes are never
                                                -- uploaded (#282); other devices see a placeholder.
  kind       TEXT NOT NULL DEFAULT 'art',       -- 'art' | 'photo'
  -- The one sticker in a theme that is not collected a rung at a time: it lands when every
  -- OTHER sticker in the pack is owned. So `packComplete` counts non-boss rows only -- a set
  -- that included its own prize could never be finished.
  is_boss    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);

-- Ownership. The starter pack is auto-granted on first chart/inventory read.
CREATE TABLE IF NOT EXISTS kid_stickers (
  child_id   TEXT NOT NULL REFERENCES children(id),
  sticker_id TEXT NOT NULL REFERENCES stickers(id),
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, sticker_id)
);

-- Where the kid PUT the sticker (position + tilt persist — it's THEIR chart).
-- state: 'pending' (waiting for parent) -> 'shined' (approved, golden shine)
--        | 'retry' (rejected, grey wobble) -> back to 'pending' on resubmit.
CREATE TABLE IF NOT EXISTS sticker_placements (
  id           TEXT PRIMARY KEY,
  child_id     TEXT NOT NULL REFERENCES children(id),
  subject_kind TEXT NOT NULL,                  -- 'routine_task_run' | 'chore'
  subject_id   TEXT NOT NULL,                  -- task_runs.id or chores.id
  day          TEXT NOT NULL,                  -- 'YYYY-MM-DD' in family TZ (the chart column)
  sticker_id   TEXT NOT NULL REFERENCES stickers(id),
  x_pct        REAL NOT NULL DEFAULT 50,
  y_pct        REAL NOT NULL DEFAULT 50,
  tilt_deg     REAL NOT NULL DEFAULT 0,
  state        TEXT NOT NULL DEFAULT 'pending',
  created_at   INTEGER NOT NULL,
  UNIQUE(subject_kind, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_placements_child_day ON sticker_placements(child_id, day);

-- Treasure Box catalog. Categories are DATA so new shelves (backgrounds,
-- characters, sounds, seasonal) appear with zero UI code change.
CREATE TABLE IF NOT EXISTS store_categories (
  id     TEXT PRIMARY KEY,
  title  TEXT NOT NULL,
  title_key TEXT,                            -- catalog key; NULL = a parent-made shelf
  sort   INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  icon   TEXT,                              -- glyph name; the face items on this shelf fall back to
  parent_edited INTEGER NOT NULL DEFAULT 0, -- 1 = the parent owns this row, the catalogue stops re-applying
  family_id TEXT REFERENCES families(id),   -- NULL = shared seeded catalogue; set = one family's own shelf
  -- Which time budget this shelf's apps draw on: NULL | 'utility' | 'learning' | 'games'.
  -- DESCRIPTIVE ONLY today -- no runtime code reads it, and a shelf left NULL behaves exactly
  -- as every shelf does now. It exists so the per-category budget work (docs/CATEGORY-TIME-
  -- BUDGETS.md) has a package -> category mapping to stand on without that design having to
  -- be settled first. Set it wrong and nothing happens; that is the point of landing it early.
  budget_kind TEXT
);

CREATE TABLE IF NOT EXISTS store_items (
  id          TEXT PRIMARY KEY,
  category_id TEXT REFERENCES store_categories(id),
  kind        TEXT NOT NULL,                   -- 'pack' | 'screen_time' | 'coupon'
  title       TEXT NOT NULL,
  title_key   TEXT,                            -- catalog key; NULL = a parent-made item
  price_luna  INTEGER NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',      -- pack: {packId} · screen_time: {minutes} · coupon: {icon}
  active      INTEGER NOT NULL DEFAULT 1,      -- 0 = retired: off the shelves, row KEPT (kid_purchases FK)
  sort        INTEGER NOT NULL DEFAULT 0,
  parent_edited INTEGER NOT NULL DEFAULT 0,    -- 1 = the parent owns this row, the catalogue stops re-applying
  family_id   TEXT REFERENCES families(id)     -- NULL = shared seeded catalogue; set = one family's own item
);

-- One household's price for a catalogue row it does not own.
--
-- The seeded rows above are shared: `store_items.family_id IS NULL` is ONE row that every
-- household on the instance reads, so a parent who repriced it would reprice the Space pack
-- for strangers. That is why routes/store.ts refuses to write those rows on a multi-tenant
-- instance, and that refusal stays. This table is the other half: the row stays the
-- catalogue's, the PRICE becomes the family's, and every shelf read joins the two.
--
-- Nothing is deleted here either. Setting a price back to the catalogue's own retires the
-- override (`active=0`) rather than dropping the row, so the ladder a parent built is still
-- there to read, and the catalogue is free to move that price again.
CREATE TABLE IF NOT EXISTS store_item_overrides (
  family_id  TEXT NOT NULL REFERENCES families(id),
  item_id    TEXT NOT NULL REFERENCES store_items(id),
  price_luna INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,   -- 0 = withdrawn: this family is back on the catalogue price
  PRIMARY KEY (family_id, item_id)
);

-- Real 'spend' purchases (NIM went kid -> family hot wallet).
-- status: 'done' | 'pending_parent' (coupon awaiting fulfillment) | 'fulfilled' | 'refunded'
CREATE TABLE IF NOT EXISTS kid_purchases (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  child_id   TEXT NOT NULL REFERENCES children(id),
  item_id    TEXT NOT NULL REFERENCES store_items(id),
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,                    -- snapshot at purchase time
  price_luna INTEGER NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'done',
  ref_id     TEXT,                             -- lock_overrides.id / approvals.id
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_child ON kid_purchases(child_id, created_at);

-- ---- seed: starter set + placeholder packs (Andjroo swaps asset_url for real art later) ----
-- Sticker packs, stickers and their store rows are seeded from
-- src/sticker-catalog.ts at boot (db.ts), so there is one source of truth.

-- Categories: their ICON and whether they are still offered come from
-- src/sticker-catalog.ts (CATEGORY_ICONS / RETIRED_CATEGORIES), re-applied at
-- every boot, so 'cat-timers' lands retired on a fresh DB too.
INSERT OR IGNORE INTO store_categories (id, title, sort, active) VALUES
  ('cat-stickers', 'Sticker packs', 0, 1),
  ('cat-screen',   'Screen time',   1, 1),
  ('cat-coupons',  'Coupons',       2, 1),
  ('cat-timers',   'Timers',        3, 1);

INSERT OR IGNORE INTO store_items (id, category_id, kind, title, price_luna, payload, active, sort) VALUES
  ('item-screen-15',    'cat-screen',   'screen_time', '15 minutes',         100000, '{"minutes":15}',          1, 0),
  ('item-screen-30',    'cat-screen',   'screen_time', '30 minutes',         180000, '{"minutes":30}',          1, 1),
  ('item-screen-60',    'cat-screen',   'screen_time', '60 minutes',         300000, '{"minutes":60}',          1, 2),
  ('item-coupon-dinner','cat-coupons',  'coupon',      'Pick what''s for dinner', 500000, '{}',                 1, 0),
  ('item-coupon-stayup','cat-coupons',  'coupon',      'Stay up 30 minutes late', 500000, '{}',                 1, 1),
  ('item-timer-maker',  'cat-timers',   'timer_style', 'Sticker maker',          1000000, '{"styleId":"maker"}',    1, 0),
  ('item-timer-pola',   'cat-timers',   'timer_style', 'Instant photo',           800000, '{"styleId":"polaroid"}', 1, 1);

CREATE INDEX IF NOT EXISTS idx_runs_child_day    ON routine_runs(child_id, day);
CREATE INDEX IF NOT EXISTS idx_task_runs_run     ON task_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_approvals_family  ON approvals(family_id, status);
CREATE INDEX IF NOT EXISTS idx_stars_child       ON star_events(child_id, created_at);
CREATE INDEX IF NOT EXISTS idx_media_child_role  ON media_assets(child_id, role);
CREATE INDEX IF NOT EXISTS idx_routines_child    ON routines(child_id, active);

-- ---- invite-a-family referrals (competition build) ----
-- Attribution only: who invited, and that their link was accepted. The invited
-- household stays anonymous (no PII, no device data) until a future slice lets
-- their own instance claim the code; the automatic both-sides bonus is deferred
-- (docs/ROADMAP.md Phase 1).
CREATE TABLE IF NOT EXISTS family_invites (
  code       TEXT PRIMARY KEY,                        -- short shareable code, one per family
  family_id  TEXT NOT NULL REFERENCES families(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_family ON family_invites(family_id);

CREATE TABLE IF NOT EXISTS referrals (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL REFERENCES family_invites(code),
  inviter_family_id TEXT NOT NULL REFERENCES families(id),
  status            TEXT NOT NULL DEFAULT 'accepted',  -- accepted -> joined -> bonus_granted (future)
  ip_hash           TEXT,               -- truncated sha-256 of (code|ip), dedupe only — never a raw IP
  joined_at         INTEGER,            -- set when the invited household actually creates its family
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code, created_at);

-- ---- practices: the things a kid keeps up, rather than the things a kid does today ----
-- Piano, a workout, reading. A routine answers "when today"; a practice answers
-- "how often this week", which is a different axis and the one the calendar is
-- good at. So a practice carries no time of day at all -- it carries a WEEKLY
-- TARGET (days per week), and its history is a run of days, not a run of runs.
CREATE TABLE IF NOT EXISTS practices (
  id              TEXT PRIMARY KEY,
  family_id       TEXT NOT NULL REFERENCES families(id),
  child_id        TEXT NOT NULL REFERENCES children(id),  -- per kid: same practice, different targets
  title           TEXT NOT NULL,                          -- "Piano"
  title_key       TEXT,                                   -- catalog key; NULL = the parent's own words
  emoji           TEXT NOT NULL DEFAULT '🎹',
  target_per_week INTEGER NOT NULL DEFAULT 3,             -- DAYS per week, 1..7
  duration_s      INTEGER,                                -- optional egg timer on a session
  reward_luna     INTEGER NOT NULL DEFAULT 0,             -- paid per session
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_practices_child ON practices(child_id, active);

-- One row per DAY a practice happened. UNIQUE(practice_id, day) is the rule that
-- twice in a day counts once: the unit of a weekly target is the day, not the rep.
CREATE TABLE IF NOT EXISTS practice_sessions (
  id          TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id),
  child_id    TEXT NOT NULL REFERENCES children(id),
  day         TEXT NOT NULL,                              -- 'YYYY-MM-DD' in family TZ
  seconds     INTEGER,                                    -- actual time, when a timer ran
  created_at  INTEGER NOT NULL,
  UNIQUE(practice_id, day)
);
CREATE INDEX IF NOT EXISTS idx_practice_sessions ON practice_sessions(practice_id, day);

-- ---- practice steps: the exercises a day of a practice is made of ----
-- Piano is not one thing -- it is scales, then the song, then sight-reading. A practice
-- with steps is PRICED BY ITS STEPS: the day pays the sum of the ones the kid ticked,
-- which is the rule runRewardLuna() already runs on a routine's tasks, in the shape a
-- practice has. `practices.reward_luna` is then not read at all (a price with two homes
-- is the sticker_packs.price_luna bug, #288); a practice with no steps is unchanged.
CREATE TABLE IF NOT EXISTS practice_steps (
  id          TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id),
  position    INTEGER NOT NULL,                             -- ordered; appended, never reordered
  title       TEXT NOT NULL,                                -- "Scales"
  title_key   TEXT,                                         -- catalog key; NULL = the parent's own words
  emoji       TEXT NOT NULL DEFAULT '🎵',
  reward_luna INTEGER NOT NULL DEFAULT 0,                   -- this exercise's share of the day
  -- HOW TO DO IT, in the parent's own words. A step's title is a label a kid recognises AFTER
  -- someone has shown them once ("Five-finger walk"); it cannot teach the thing cold, and a
  -- tick-list with nothing behind it sends the kid to find a grown-up before every exercise.
  -- Plain text, never a catalog key: this is the parent's coaching, not our vocabulary.
  how         TEXT,
  -- A demonstration to watch. Held here but shown on the PARENT side only, deliberately: the
  -- tablet is a kiosk with no browser and its YouTube Kids carries approved channels only, so
  -- a link on the kid's card is a dead end. It opens on the phone of whoever is coaching.
  video_url   TEXT,
  active      INTEGER NOT NULL DEFAULT 1                    -- retired, never deleted (the board's rule)
);
CREATE INDEX IF NOT EXISTS idx_practice_steps ON practice_steps(practice_id, active, position);

-- A ROW IS THE TICK. Present = the kid did that exercise; absent = they did not. No
-- boolean that can disagree with itself, and nothing written on the days a step was
-- skipped. Written ONCE, when the day is logged: the ticks are what the parent was told
-- the day is worth, so they must not move between the push and the tap that pays it.
CREATE TABLE IF NOT EXISTS practice_step_ticks (
  session_id TEXT NOT NULL REFERENCES practice_sessions(id),
  step_id    TEXT NOT NULL REFERENCES practice_steps(id),
  PRIMARY KEY (session_id, step_id)
);

-- ---- goals: a ladder a kid climbs, one rung at a time ----
-- Single leg, then hold it for thirty seconds, then both legs. A job answers "what today",
-- a practice answers "how often this week", and a goal answers "HOW FAR HAVE I GOT" -- an
-- axis neither of the other two has. So it carries no day, no weekly target and no streak:
-- a rung is reached ONCE, ever, and the ladder is finished when the top one is.
--
-- `ordered` is the parent's call, per goal (Andjroo, 2026-08-04: "sometimes it could be any
-- of them, sometimes they don't need to go in order"). Holding a plank longer every week is
-- a sequence; five swimming badges are not.
-- A kid ASKING for a ladder (#389). The sets a kid can collect are visible to them now, so
-- the obvious next move -- "I want that one" -- needed somewhere to land that is not a goal.
--
-- A request is NOT a goal. It carries no title and no target, because those are the part the
-- grown-up and the kid settle together; all the kid supplies is WHICH SET they want and,
-- optionally, why. Approving one creates the goal with the real title, so a request can never
-- become a ladder nobody agreed the terms of.
--
-- Nothing is deleted: a decided request keeps its row so the kid can see it was answered, and
-- so a second ask for the same pack can be told apart from the first.
CREATE TABLE IF NOT EXISTS goal_requests (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  child_id   TEXT NOT NULL REFERENCES children(id),
  pack_id    TEXT NOT NULL REFERENCES sticker_packs(id),  -- must be a THEME pack
  note       TEXT,                                        -- the kid's own words, optional
  status     TEXT NOT NULL DEFAULT 'pending',             -- pending -> approved | declined
  goal_id    TEXT REFERENCES goals(id),                   -- set when approving created a ladder
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_goalreq_child ON goal_requests(child_id, status);

CREATE TABLE IF NOT EXISTS goals (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  child_id   TEXT NOT NULL REFERENCES children(id),
  title      TEXT NOT NULL,                             -- "Stand on one leg"
  title_key  TEXT,                                      -- catalog key; NULL = the parent's own words
  emoji      TEXT NOT NULL DEFAULT '🪜',
  ordered    INTEGER NOT NULL DEFAULT 1,                -- 1 = climb in order, 0 = any rung, any time
  -- Which THEME this ladder collects toward. NULL = a plain ladder that pays NIM and nothing
  -- else, which is what every goal built before 2026-08-04 is. Deliberately on the GOAL and
  -- not on the rung: a rung hands over whichever sticker of the theme the kid does not have
  -- yet, so the ladder's length and the set's size have nothing to do with each other. Five
  -- dragons can be collected over a three-rung ladder and then a two-rung one.
  pack_id    TEXT REFERENCES sticker_packs(id),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_child ON goals(child_id, active);

-- One rung. Its own price, and it pays ONCE: the approval's subject is the rung itself
-- (`goal_rung`), so `payoutRefFor` is unique per rung and a climbed rung cannot be sold
-- twice. There is no claims table for the same reason a practice day has nothing to settle
-- -- the approval beside it IS the record of what the parent said.
CREATE TABLE IF NOT EXISTS goal_rungs (
  id          TEXT PRIMARY KEY,
  goal_id     TEXT NOT NULL REFERENCES goals(id),
  position    INTEGER NOT NULL,                         -- the order they are climbed in
  title       TEXT NOT NULL,                            -- "Hold it for 30 seconds"
  title_key   TEXT,
  emoji       TEXT NOT NULL DEFAULT '🪜',
  reward_luna INTEGER NOT NULL DEFAULT 0,               -- paid when the parent says yes
  active      INTEGER NOT NULL DEFAULT 1                -- retired, never deleted
);
CREATE INDEX IF NOT EXISTS idx_goal_rungs ON goal_rungs(goal_id, active, position);

-- ---- the switch gate: a kid's secret picture (#123) ----
-- The shared family tablet is the target household, and tapping a sibling's face on the
-- roster used to hand over their wallet screen, their Send button and their Treasure Box
-- balance. This is the one place the money hardening (spend locks, approval gates,
-- payout-exactly-once) was bypassed by the trust model rather than by a bug.
--
-- Its OWN table, not a column on children, deliberately. `GET /children` and
-- `GET /children/:id` both return child rows verbatim to the kid app, so a hash living on
-- that row is one forgotten `...child` away from being published to the surface it is meant
-- to gate. A separate table cannot be leaked by a route that does not know it exists.
--
-- A sequence of picture taps, argon2-hashed like the family PIN, because it is the same
-- class of low-entropy secret. Absent row = this kid has no secret yet, which is exactly
-- today's behaviour and is why turning this on locks nobody out.
CREATE TABLE IF NOT EXISTS kid_switch_secrets (
  child_id    TEXT PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ---- the grown-ups of a household ----
--
-- A household used to have exactly ONE grown-up in the money sense: `families.parent_address`
-- was both the wallet that pays a kid and the till a Treasure Box spend returns to, and every
-- parent bearer token carried the same, undifferentiated authority. A second phone could join
-- (POST /api/pair) but it was the same grown-up as far as anything here could tell.
--
-- That is wrong for the household this app is actually built for. Two parents in two houses, a
-- grandparent who wants to put money in: each has their own wallet, and passing one tablet
-- around is not a design, it is the absence of one.
--
-- ONE DISTINCTION IS LOAD-BEARING AND MUST NOT BE COLLAPSED. `families.parent_address` is
-- still the TILL — where a kid's Treasure Box purchase returns to, and what a family transfer
-- targets. What moves to this table is the SENDER: whose wallet pays a kid for their work. If
-- a grandparent's approval also re-pointed the till, the kid's next purchase would leave the
-- household into her wallet, and the per-family budget — which nets a buy against a refund
-- only because they are the same account — would stop bounding anything.
CREATE TABLE IF NOT EXISTS family_members (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  label      TEXT NOT NULL,   -- "Dad", "Grandma Jo" -- display only, never a legal identity
  -- 'owner'     the household's own parent: everything, and the only one who can remove people
  -- 'coparent'  the other parent: the board, approvals, kids, the Treasure Box
  -- 'supporter' a grandparent: sees the queue, approves and pays from their own wallet, and
  --             nothing else. They put money in; they do not decide what a job is worth.
  role       TEXT NOT NULL,
  -- THEIR OWN wallet, and the sender of every payout they approve. NULL is a real state and
  -- not a missing default: a grown-up who has joined but not connected a wallet can still
  -- approve, and their approval pays out of the owner's wallet exactly as it did before they
  -- arrived. Never the till -- see the note above.
  address    TEXT,
  notify_url TEXT,            -- their own phone's ping; NULL falls back to families.notify_url
  created_at INTEGER NOT NULL,
  -- SOFT removal. An approval names the member who decided it, and a household that can no
  -- longer say who approved a payment has lost the trail at exactly the moment two households
  -- most need one. Removing revokes their tokens; the row stays so the past stays readable.
  removed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_family_members ON family_members(family_id, removed_at);

-- ---- joining a household as a grown-up ----
--
-- Its own table rather than a `kind` column on pair_codes, for a reason that bites: a pair
-- code mints a DEVICE bearer for a kid's tablet, and createPairCode deletes the family's live
-- code every time a new one is minted. Sharing the table would mean inviting a grandparent
-- silently cancelled a tablet pairing that was half done.
--
-- The code crosses by eyeball, never in a URL -- the same rule POST /api/pair states. A link
-- that admits someone to a household is a bearer secret, and it lands in message history.
CREATE TABLE IF NOT EXISTS member_invites (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  code_hash  TEXT NOT NULL,                      -- sha-256 of the 6-digit code, shown once
  role       TEXT NOT NULL,                      -- the role the invitee gets on redemption
  label      TEXT NOT NULL,                      -- what to call them, chosen by the inviter
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_invites_hash ON member_invites(code_hash);

-- A kid choosing their own character (#381). A Nimiq identicon is a pure function of the
-- address, and a server-custodied kid's address is a pure function of one small integer, so
-- offering a kid a set of unclaimed indices IS offering them a set of characters.
--
-- The set is SERVER-ISSUED and stored, and that is the whole security story. The parent
-- address routes are parent-authed because a kid's tablet must never be able to name where
-- their payouts go (src/routes/kid-address.ts). Choosing an index does not name anything: every
-- offered index is an address this server already derives inside this family's own branch. So
-- the device returns an index we minted, never an address, and an index we did not mint is
-- refused. Superseded sets are left in place rather than deleted, because which characters a
-- kid was shown before they settled is the only record of how the choice was made.
CREATE TABLE IF NOT EXISTS kid_character_sets (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL REFERENCES families(id),
  child_id    TEXT NOT NULL REFERENCES children(id),
  indices     TEXT NOT NULL,                -- JSON array of the offered account indices
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kid_character_sets_child ON kid_character_sets(child_id, created_at);
