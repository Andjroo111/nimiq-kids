// Data-access layer over bun:sqlite. Pure functions, no HTTP. The chain is the source of truth for
// money; `children.balance_luna` is a convenience tally only.

import type { ProofKind } from "./nimiq/address-proof";
import { getDb } from "./db";
import * as members from "./repo-members";

export type ChoreStatus = "open" | "submitted" | "approved" | "claimed" | "rejected";
export type CashlinkStatus = "funding" | "ready" | "claimed" | "expired";

// Learn-to-Earn (PRD "Offshoot — Brilliant.org"): a lesson is just a chore whose completion
// condition is finishing a learning task. Same parent-attested approval, same Cashlink payout.
export type ChoreKind = "chore" | "lesson";
export type LessonSubject = "math" | "coding";
export type RewardShape = "per-lesson" | "per-streak-day" | "per-milestone";
export const LESSON_SUBJECTS: readonly LessonSubject[] = ["math", "coding"];
export const REWARD_SHAPES: readonly RewardShape[] = ["per-lesson", "per-streak-day", "per-milestone"];

export type FamilyMode = "demo" | "family";
/** Where a kid's address came from, and therefore who can sign for it. */
export type AddressSource = "derived" | "parent";
export interface Family {
  id: string; parent_label: string; parent_address: string; mode: FamilyMode;
  pin_hash: string | null; pin_attempts: number; pin_locked_until: number | null;
  star_rate_luna: number; notify_url: string | null; tz: string;
  /** 1 = no payout-budget cap (grandfathered live household / operator-trusted) */
  budget_exempt: number;
  /** 1 = kids may remove chores from their own board (parent's switch) */
  kids_can_remove: number;
  /** Set when this household was minted by the judge demo; null for a real family.
   *  Also what sweepDemoFamilies() purges on. */
  demo_at: number | null;
  /** This household's branch in the HD tree. NULL until its first kid account is provisioned. */
  hd_index: number | null;
  created_at: number;
}
export interface Child {
  id: string; family_id: string; label: string; emoji: string;
  balance_luna: number; streak_count: number; star_balance: number;
  /** Screen-time budget in minutes per LOCAL day. 0 = unmetered, which is what every kid
   *  reads as until a parent sets one -- see the migration note in src/db.ts. */
  daily_screen_min: number;
  /** Ceiling on Treasure Box minutes on top of the base, per day. 0 = cannot buy any. */
  max_earned_min: number;
  /** Sittings: play this many minutes in one go, then rest `rest_min`. Either 0 = no rule. */
  play_min: number;
  /** The rest after a sitting, and how long a pause must be to count as one. */
  rest_min: number;
  /** The language this kid's tablet reads in, one of the five this app translates.
   *  NULL = follow the device, which is every household until a parent picks one, and is
   *  NOT the same as 'en'. See the migration note in src/db.ts. */
  lang: string | null;
  /** V2: HD index of the kid's real on-chain account (null until first derivation). Unique
   *  within the family, NOT across the instance — pair it with hd_family_index. */
  account_index: number | null;
  /** The family branch this kid's key hangs off. NULL = the legacy instance-global path.
   *  Permanent per row: see src/nimiq/hd.ts. */
  hd_family_index: number | null;
  /** The kid's NQ address (public). WHOSE KEY it is, is `address_source` — never assume. */
  address: string | null;
  /** null = no address yet | 'derived' = server-custodied (HD) | 'parent' = parent-owned,
   *  registered with a signature proof. See schema.sql and src/kid-address.ts. */
  address_source: AddressSource | null;
  /** The server-custodied address this kid used to hold, preserved when `address` moves to a
   *  parent-owned one so the boot guard still knows where to look. */
  derived_address: string | null;
  /** The binding proof, whole, so it can be re-checked from the row alone. */
  address_proof_message: string | null;
  address_proof_pubkey: string | null;
  address_proof_sig: string | null;
  /** Which Keyguard flow produced it, so it can be re-checked under the right prefix.
   *  null on rows written before the column existed, which were all signMessage. */
  address_proof_kind: ProofKind | null;
  address_registered_at: number | null;
  /** The character picked on the tablet, one id out of public/assets/heroes (src/kid-hero.ts).
   *  NULL = never picked, which is what sends the kid up the onboarding climb. */
  hero: string | null;
  created_at: number;
}
export interface Chore {
  id: string; family_id: string; child_id: string; title: string; emoji: string;
  /** src/title-catalog.ts key when WE named this job. NULL means the parent
   *  typed it, and their words render verbatim in every language. */
  title_key: string | null;
  kind: ChoreKind; subject: LessonSubject | null; reward_shape: RewardShape | null;
  reward_luna: number; reward_stars: number; duration_s: number | null;
  status: ChoreStatus; submitted_at: number | null;
  approved_at: number | null;
  /** who put the job on the board — a kid may add their own */
  created_by: "parent" | "kid";
  /** soft removal: the row stays so a parent can see what was taken off */
  removed_at: number | null; removed_by: "parent" | "kid" | null;
  created_at: number;
}
export interface Cashlink {
  id: string; family_id: string; chore_id: string | null; child_id: string | null;
  kind: "payout" | "peer" | "bonus" | "stars"; cashlink_address: string; value_luna: number; message: string | null;
  url: string; funding_tx_hash: string | null; status: CashlinkStatus;
  created_at: number; claimed_at: number | null;
}

const uid = () => crypto.randomUUID();
const now = () => Date.now();

// ---- families ----
export function createFamily(parentLabel: string, parentAddress: string): Family {
  const f: Family = {
    id: uid(), parent_label: parentLabel, parent_address: parentAddress,
    mode: "demo", pin_hash: null, pin_attempts: 0, pin_locked_until: null,
    star_rate_luna: 10000, notify_url: null, tz: "America/Chicago",
    budget_exempt: 0, kids_can_remove: 1, demo_at: null, hd_index: null, created_at: now(),
  };
  getDb().run(
    "INSERT INTO families (id, parent_label, parent_address, created_at) VALUES (?,?,?,?)",
    [f.id, f.parent_label, f.parent_address, f.created_at],
  );
  // The household's first grown-up, minted HERE so "every family has an owner" is an invariant
  // of creation rather than something four callers each have to remember. The address is
  // COPIED, not shared: `families.parent_address` is the till a Treasure Box spend returns to,
  // `family_members.address` is the wallet that pays a kid, and they only start out equal.
  // src/db.ts backfillOwnerMembers does the same for households created before members existed.
  members.createMember(f.id, f.parent_label, "owner", { address: f.parent_address || null });
  return f;
}
export function getFamily(id: string): Family | null {
  return (getDb().query("SELECT * FROM families WHERE id=?").get(id) as Family) ?? null;
}
export function firstFamily(): Family | null {
  return (getDb().query("SELECT * FROM families ORDER BY created_at LIMIT 1").get() as Family) ?? null;
}
/** How many households on this instance are actually in the unlocked demo mode.
 *  /health reports it so "demo unlocked" cannot read as true on an instance where every
 *  real household queues everything (the instance floor alone said exactly that). */
export function demoModeFamilyCount(): number {
  const row = getDb().query("SELECT COUNT(*) AS n FROM families WHERE mode='demo'").get() as { n: number };
  return row.n;
}
/** Family-mode settings (nimiq.kids). Only whitelisted fields; PIN goes through setFamilyPin. */
/**
 * Correct the household's own wallet address. Deliberately NOT part of updateFamilySettings:
 * this is where a kid's Treasure Box spend lands and, under parent custody, the account that
 * will sign every payout, so it is money rather than a setting and the caller has to mean it.
 *
 * `createFamily` was the only writer, which made a wrong address uncorrectable without direct
 * database access — see the route in routes/parent.ts for who is allowed to call this and why
 * a server-custody instance is not.
 */
export function setFamilyParentAddress(id: string, address: string): void {
  getDb().run("UPDATE families SET parent_address=? WHERE id=?", [address, id]);
}

export function updateFamilySettings(
  id: string,
  s: Partial<Pick<Family, "mode" | "star_rate_luna" | "notify_url" | "tz" | "kids_can_remove">>,
): void {
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  if (s.mode !== undefined) { fields.push("mode=?"); vals.push(s.mode); }
  if (s.star_rate_luna !== undefined) { fields.push("star_rate_luna=?"); vals.push(s.star_rate_luna); }
  if (s.notify_url !== undefined) { fields.push("notify_url=?"); vals.push(s.notify_url); }
  if (s.tz !== undefined) { fields.push("tz=?"); vals.push(s.tz); }
  if (s.kids_can_remove !== undefined) { fields.push("kids_can_remove=?"); vals.push(s.kids_can_remove ? 1 : 0); }
  if (!fields.length) return;
  vals.push(id);
  getDb().run(`UPDATE families SET ${fields.join(", ")} WHERE id=?`, vals as never[]);
}
export function setFamilyPin(id: string, pinHash: string): void {
  getDb().run("UPDATE families SET pin_hash=?, pin_attempts=0, pin_locked_until=NULL WHERE id=?", [pinHash, id]);
}
export function setPinAttempts(id: string, attempts: number, lockedUntil: number | null): void {
  getDb().run("UPDATE families SET pin_attempts=?, pin_locked_until=? WHERE id=?", [attempts, lockedUntil, id]);
}
/** Operator-only (migration backfill / admin script): lift or apply the payout-budget cap. */
export function setBudgetExempt(id: string, exempt: boolean): void {
  getDb().run("UPDATE families SET budget_exempt=? WHERE id=?", [exempt ? 1 : 0, id]);
}

// ---- children ----
export function createChild(familyId: string, label: string, emoji = "🦖"): Child {
  const c: Child = {
    id: uid(), family_id: familyId, label, emoji, balance_luna: 0, streak_count: 0, star_balance: 0,
    // A new kid is unmetered. The meter is something a parent turns ON for a tablet that
    // exists, and most children in this database have never had one.
    daily_screen_min: 0, max_earned_min: 0, play_min: 0, rest_min: 0, lang: null,
    account_index: null, hd_family_index: null, address: null,
    address_source: null, derived_address: null,
    address_proof_message: null, address_proof_pubkey: null, address_proof_sig: null,
    address_proof_kind: null,
    address_registered_at: null,
    hero: null,
    created_at: now(),
  };
  getDb().run(
    "INSERT INTO children (id, family_id, label, emoji, balance_luna, streak_count, created_at) VALUES (?,?,?,?,?,?,?)",
    [c.id, c.family_id, c.label, c.emoji, c.balance_luna, c.streak_count, c.created_at],
  );
  return c;
}
export function listChildren(familyId: string): Child[] {
  return getDb().query("SELECT * FROM children WHERE family_id=? ORDER BY created_at").all(familyId) as Child[];
}
export function getChild(id: string): Child | null {
  return (getDb().query("SELECT * FROM children WHERE id=?").get(id) as Child) ?? null;
}
export function addBalanceAndStreak(childId: string, deltaLuna: number): void {
  getDb().run(
    "UPDATE children SET balance_luna = balance_luna + ?, streak_count = streak_count + 1 WHERE id=?",
    [deltaLuna, childId],
  );
}
/** Adjust the tally without touching the streak (e.g. an outgoing peer gift). */
export function adjustBalance(childId: string, deltaLuna: number): void {
  getDb().run("UPDATE children SET balance_luna = balance_luna + ? WHERE id=?", [deltaLuna, childId]);
}
/** Break a child's streak back to zero (e.g. a rejected chore). */
export function resetStreak(childId: string): void {
  getDb().run("UPDATE children SET streak_count = 0 WHERE id=?", [childId]);
}

/** Turn the screen-time meter on (minutes > 0) or off (0) for one kid. Both numbers are
 *  clamped here rather than at the route, because this is the only door to the column and
 *  a 10,000-minute "day" would read as unmetered to every screen that draws a meter. */
export function setScreenBudget(childId: string, dailyMin: number, maxEarnedMin: number): void {
  const clamp = (n: number) => Math.max(0, Math.min(1440, Math.round(Number(n) || 0)));
  getDb().run(
    "UPDATE children SET daily_screen_min=?, max_earned_min=? WHERE id=?",
    [clamp(dailyMin), clamp(maxEarnedMin), childId],
  );
}
/** The sittings rule for one kid: play `playMin` in one go, then rest `restMin`. Either 0
 *  turns the rule off, because "play 30 then rest 0" and "play 0 then rest 30" both say
 *  nothing a tablet can act on. Same clamp as the meter, same reason. */
export function setScreenBreaks(childId: string, playMin: number, restMin: number): void {
  const clamp = (n: number) => Math.max(0, Math.min(1440, Math.round(Number(n) || 0)));
  getDb().run(
    "UPDATE children SET play_min=?, rest_min=? WHERE id=?",
    [clamp(playMin), clamp(restMin), childId],
  );
}
/** The five this app actually translates. A sixth would fall back to English for every
 *  `app.*` string, so the shell is pinned to these and so is this column. */
export const KID_LANGS = ["en", "es", "de", "fr", "pt"] as const;

/**
 * Set, or CLEAR, the language one kid's tablet reads in (#432).
 *
 * `null` clears it, and clearing is not the same as choosing English: a cleared row goes back
 * to following the device, which is what every household did before this column existed. The
 * validation lives here rather than at the route because this is the only door to the column,
 * and an unknown id stored on a row would read as a language the app cannot draw.
 */
export function setChildLang(childId: string, lang: string | null): void {
  const value = lang === null ? null
    : (KID_LANGS as readonly string[]).includes(lang) ? lang
      : undefined;
  if (value === undefined) throw new Error(`setChildLang: unknown language ${lang}`);
  getDb().run("UPDATE children SET lang=? WHERE id=?", [value, childId]);
}

/**
 * Set, or CLEAR, the character one kid picked (the onboarding climb, 2026-09-18).
 *
 * The id is checked in src/kid-hero.ts, the only list of what ships; this is the only door to
 * the column, so an id stored here is one the tablet can draw. `null` clears it, which puts the
 * kid back at the top of the climb on their next login.
 */
export function setChildHero(childId: string, hero: string | null): void {
  getDb().run("UPDATE children SET hero=? WHERE id=?", [hero, childId]);
}

/** Family mode: adjust the star tally (ledger rows live in star_events — see repo-approvals). */
export function addStars(childId: string, delta: number): void {
  getDb().run("UPDATE children SET star_balance = star_balance + ? WHERE id=?", [delta, childId]);
}
/** Atomic, race-safe debit. Returns true only if the child had enough; never goes negative. */
export function tryDebit(childId: string, amountLuna: number): boolean {
  const res = getDb().run(
    "UPDATE children SET balance_luna = balance_luna - ? WHERE id=? AND balance_luna >= ?",
    [amountLuna, childId, amountLuna],
  );
  return res.changes > 0;
}

// ---- chores ----
export interface ChoreOpts {
  kind?: ChoreKind;
  subject?: LessonSubject | null;       // lesson only
  rewardShape?: RewardShape | null;     // lesson only
  rewardStars?: number;                 // family mode
  durationS?: number | null;            // family mode: optional egg timer
  /** 'kid' when a child added the job to their own board */
  createdBy?: "parent" | "kid";
  /** Catalog key, when the title came from a picker tile rather than a keyboard. */
  titleKey?: string | null;
}
export function createChore(
  familyId: string, childId: string, title: string, rewardLuna: number, emoji = "🧽",
  opts: ChoreOpts = {},
): Chore {
  const kind = opts.kind ?? "chore";
  const ch: Chore = {
    id: uid(), family_id: familyId, child_id: childId, title, emoji,
    title_key: opts.titleKey ?? null,
    kind,
    subject: kind === "lesson" ? (opts.subject ?? null) : null,
    reward_shape: kind === "lesson" ? (opts.rewardShape ?? "per-lesson") : null,
    reward_luna: rewardLuna,
    reward_stars: opts.rewardStars ?? 0,
    duration_s: opts.durationS ?? null,
    status: "open", submitted_at: null, approved_at: null,
    created_by: opts.createdBy ?? "parent", removed_at: null, removed_by: null,
    created_at: now(),
  };
  getDb().run(
    "INSERT INTO chores (id, family_id, child_id, title, title_key, emoji, kind, subject, reward_shape, reward_luna, reward_stars, duration_s, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [ch.id, ch.family_id, ch.child_id, ch.title, ch.title_key, ch.emoji, ch.kind, ch.subject, ch.reward_shape, ch.reward_luna, ch.reward_stars, ch.duration_s, ch.status, ch.created_by, ch.created_at],
  );
  return ch;
}

/**
 * Take a chore off the board WITHOUT losing it. A hard delete would erase the
 * fact that it ever existed, and a parent has to be able to see that a kid took
 * their laundry off their own list (Andjroo, 2026-07-30).
 */
export function removeChore(id: string, by: "parent" | "kid"): void {
  getDb().run("UPDATE chores SET removed_at=?, removed_by=? WHERE id=? AND removed_at IS NULL",
    [now(), by, id]);
}
export function restoreChore(id: string): void {
  getDb().run("UPDATE chores SET removed_at=NULL, removed_by=NULL WHERE id=?", [id]);
}

/**
 * Change a job that is still waiting to be done.
 *
 * Only the three things a parent argues about: what it is called, what face it
 * wears, and what it pays. Not `status`, not `child_id`, not `kind` — moving a
 * job between kids or between chore and lesson mid-flight would strand the
 * approval rows and sticker placements that already point at it, and none of
 * that is what "edit" means to the person tapping it.
 *
 * The caller is responsible for refusing a chore that has left `open`; see the
 * PATCH route, where the reason it matters (the reward IS the payout) is
 * spelled out.
 */
export function updateChore(
  id: string,
  patch: { title?: string; emoji?: string; rewardLuna?: number; titleKey?: string | null },
): Chore | null {
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    fields.push("title=?");
    vals.push(patch.title);
    // Their words now, so our key goes. Same rule as updateTask/updatePractice:
    // keeping it would put OUR words back over the edit the instant the device
    // language changed. A picker tile re-sets the key explicitly below.
    fields.push("title_key=?");
    vals.push(patch.titleKey ?? null);
  }
  if (patch.emoji !== undefined) { fields.push("emoji=?"); vals.push(patch.emoji); }
  if (patch.rewardLuna !== undefined) { fields.push("reward_luna=?"); vals.push(patch.rewardLuna); }
  if (!fields.length) return getChore(id);
  vals.push(id);
  getDb().run(`UPDATE chores SET ${fields.join(", ")} WHERE id=?`, vals as never[]);
  return getChore(id);
}
/** What a KID sees: everything still on their board. */
export function listActiveChores(familyId: string, childId?: string): Chore[] {
  return listChores(familyId, childId).filter((c) => c.removed_at === null);
}
/** What a PARENT can review: what was taken off, newest first. */
export function listRemovedChores(familyId: string, childId?: string): Chore[] {
  return listChores(familyId, childId)
    .filter((c) => c.removed_at !== null)
    .sort((a, b) => (b.removed_at ?? 0) - (a.removed_at ?? 0));
}
export function listChores(familyId: string, childId?: string): Chore[] {
  if (childId) {
    return getDb().query("SELECT * FROM chores WHERE family_id=? AND child_id=? ORDER BY created_at")
      .all(familyId, childId) as Chore[];
  }
  return getDb().query("SELECT * FROM chores WHERE family_id=? ORDER BY created_at").all(familyId) as Chore[];
}
export function getChore(id: string): Chore | null {
  return (getDb().query("SELECT * FROM chores WHERE id=?").get(id) as Chore) ?? null;
}
export function setChoreStatus(id: string, status: ChoreStatus): void {
  const ts = now();
  if (status === "submitted") getDb().run("UPDATE chores SET status=?, submitted_at=? WHERE id=?", [status, ts, id]);
  else if (status === "approved") getDb().run("UPDATE chores SET status=?, approved_at=? WHERE id=?", [status, ts, id]);
  else getDb().run("UPDATE chores SET status=? WHERE id=?", [status, id]);
}

// ---- cashlinks ----
/** The claim secret is the URL's #fragment (private key + value + message). Origin is
 *  dropped so a QR minted on the parent's phone still resolves when opened on the tablet.
 *  Stored and matched as-is, verbatim — never spliced into a SQL pattern. */
function cashlinkSecret(url: string): string {
  return url.includes("#") ? url.slice(url.indexOf("#")) : url;
}
export function createCashlink(row: Omit<Cashlink, "created_at" | "claimed_at" | "status"> & {
  status?: CashlinkStatus;
}): Cashlink {
  const cl: Cashlink = { ...row, status: row.status ?? "ready", created_at: now(), claimed_at: null };
  getDb().run(
    `INSERT INTO cashlinks (id, family_id, chore_id, child_id, kind, cashlink_address, value_luna, message, url, url_secret, funding_tx_hash, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [cl.id, cl.family_id, cl.chore_id, cl.child_id, cl.kind, cl.cashlink_address, cl.value_luna,
     cl.message, cl.url, cashlinkSecret(cl.url), cl.funding_tx_hash, cl.status, cl.created_at],
  );
  return cl;
}
export function getCashlink(id: string): Cashlink | null {
  return (getDb().query("SELECT * FROM cashlinks WHERE id=?").get(id) as Cashlink) ?? null;
}
/** Find a cashlink by the URL a kid scanned. Matched on the claim secret (the URL
 *  fragment) so a differing origin -- a QR minted on the parent's phone, opened on
 *  the tablet -- still resolves to the same link.
 *
 *  EXACT equality, never a LIKE pattern. The old `url LIKE '%'||secret` let a caller
 *  put `%`/`_` in `secret`; `#%%%%%%%%` then matched every row and handed back other
 *  families' bearer URLs, i.e. spendable private keys. Presenting the exact fragment is
 *  the only way to match now, and presenting it already proves possession of the key. */
export function getCashlinkByUrl(url: string): Cashlink | null {
  const secret = cashlinkSecret(url);
  if (secret.length < 8) return null;
  return (getDb().query("SELECT * FROM cashlinks WHERE url_secret = ?").get(secret) as Cashlink) ?? null;
}
export function markCashlinkClaimed(id: string): void {
  getDb().run("UPDATE cashlinks SET status='claimed', claimed_at=? WHERE id=?", [now(), id]);
}
export function listCashlinksForChild(childId: string): Cashlink[] {
  return getDb().query("SELECT * FROM cashlinks WHERE child_id=? ORDER BY created_at DESC").all(childId) as Cashlink[];
}
/** Latest cashlink for a chore — for the parent's on-chain "Receipt" (no secret url needed). */
export function latestCashlinkForChore(choreId: string): Cashlink | null {
  return (getDb().query("SELECT * FROM cashlinks WHERE chore_id=? ORDER BY created_at DESC LIMIT 1").get(choreId) as Cashlink) ?? null;
}

// ---- earnings history ----
/** Claimed payout totals for a child, split chores vs learning (learn-to-earn history).
 *  Peer gifts are excluded — only chore-linked payouts count as "earned". */
export function earningsByKind(childId: string): { choreLuna: number; learningLuna: number } {
  const rows = getDb().query(
    `SELECT ch.kind AS kind, SUM(cl.value_luna) AS total
       FROM cashlinks cl JOIN chores ch ON cl.chore_id = ch.id
      WHERE cl.child_id = ? AND cl.kind = 'payout' AND cl.status = 'claimed'
      GROUP BY ch.kind`,
  ).all(childId) as { kind: ChoreKind; total: number }[];
  const out = { choreLuna: 0, learningLuna: 0 };
  for (const r of rows) {
    if (r.kind === "lesson") out.learningLuna += r.total ?? 0;
    else out.choreLuna += r.total ?? 0;
  }
  return out;
}

/** NIM minted to each child since `sinceMs` (chore/lesson payouts + streak bonuses; peer sends
 *  excluded). Powers the weekly leaderboard: counts what each kid *earned* this week — i.e. payouts
 *  the parent approved and paid (and any milestone bonuses), whether or not the kid has swept the
 *  cashlink yet. Returns a { childId: totalLuna } map; children who earned nothing are simply absent. */
export function weeklyEarnings(familyId: string, sinceMs: number): Record<string, number> {
  const rows = getDb().query(
    `SELECT cl.child_id AS childId, SUM(cl.value_luna) AS total
       FROM cashlinks cl
      WHERE cl.family_id = ? AND cl.kind IN ('payout', 'bonus')
        AND cl.child_id IS NOT NULL AND cl.created_at >= ?
      GROUP BY cl.child_id`,
  ).all(familyId, sinceMs) as { childId: string; total: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.childId] = r.total ?? 0;
  return out;
}
