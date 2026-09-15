/**
 * Fill a database with a fortnight of plausible history so the progress tracker can be
 * LOOKED AT rather than reasoned about. Dev only.
 *
 * Refuses to run unless DB_PATH is set and points somewhere other than the live family
 * database: this writes invented approvals and invented practice into whatever it is
 * pointed at, and pointing it at the real one would put a fake history on a real child's
 * chart -- which is worse than no chart, because it looks entirely plausible.
 */
import { getDb, initDb } from "../db";
import * as repo from "../repo";
import * as lockRepo from "../repo-lock";
import { localDay } from "../repo-routines";

const path = process.env.DB_PATH;
if (!path || path.includes("data/hatch/hatch.db")) {
  console.error("Set DB_PATH to a COPY. Refusing to invent history in a real household.");
  process.exit(1);
}
initDb(path);
const db = getDb();
const fam = db.query("SELECT * FROM families WHERE mode='family'").get() as repo.Family | null;
if (!fam) { console.error("No family-mode household in that database."); process.exit(1); }
const kids = repo.listChildren(fam.id);
const DAY = 86_400_000;

// mulberry32, deterministic: the same shapes every run, so two screenshots taken either
// side of a CSS change differ only by the CSS. The obvious LCG (`seed * 1103515245`)
// overflows 2^53 on its SECOND call and returns values outside [0,1) from then on, which
// turns a loop bound into a few billion and hangs the script rather than failing it.
let seed = 42 >>> 0;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

for (const [k, kid] of kids.entries()) {
  db.run(
    `INSERT OR IGNORE INTO practices (id, family_id, child_id, title, emoji, target_per_week, active, created_at)
     VALUES (?,?,?,?,'🎹',3,1,?)`,
    [`demo-pr-${k}`, fam.id, kid.id, k === 0 ? "Piano" : "Reading", Date.now()],
  );

  for (let d = 13; d >= 0; d--) {
    const at = Date.now() - d * DAY - 4 * 3600_000; // late afternoon, local
    const day = localDay(fam.tz, at);
    const weekend = [0, 6].includes(new Date(at).getDay());

    for (let i = 0, n = pick(1, 4); i < n; i++) {
      db.run(
        `INSERT INTO approvals (id, family_id, child_id, subject_kind, subject_id, status, created_at, decided_at)
         VALUES (?,?,?,'chore','demo',?,?,?)`,
        [crypto.randomUUID(), fam.id, kid.id, rnd() < 0.15 ? "rejected" : "approved", at - 6e5, at],
      );
    }
    if (rnd() < 0.75) {
      db.run(
        `INSERT OR REPLACE INTO practice_sessions (id, practice_id, child_id, day, seconds, created_at)
         VALUES (?,?,?,?,?,?)`,
        [crypto.randomUUID(), `demo-pr-${k}`, kid.id, day, pick(5, 25) * 60, at],
      );
    }
    lockRepo.addUsageSec(kid.id, day, pick(weekend ? 40 : 15, weekend ? 88 : 62) * 60, at);
    if (rnd() < 0.2) lockRepo.addEarnedSec(kid.id, day, (rnd() < 0.5 ? 15 : 30) * 60, at);
    db.run(
      `INSERT INTO wallet_events (id, family_id, child_id, kind, status, value_luna, created_at)
       VALUES (?,?,?,'earn','done',?,?)`,
      [crypto.randomUUID(), fam.id, kid.id, pick(40, 260) * 1e5, at],
    );
  }

  for (const [item, kind, nim] of [
    ["item-pack-space", "pack", 2000],
    ["item-screen-30", "screen_time", 2000],
    ["item-coupon-dinner", "coupon", 6000],
  ] as const) {
    if (rnd() < 0.8) {
      db.run(
        `INSERT INTO kid_purchases (id, family_id, child_id, item_id, kind, title, price_luna, payload, status, created_at)
         VALUES (?,?,?,?,?,'demo',?,'{}','done',?)`,
        [crypto.randomUUID(), fam.id, kid.id, item, kind, nim * 1e5, Date.now() - pick(0, 12) * DAY],
      );
    }
  }
  repo.setScreenBudget(kid.id, 60, 30);
}

console.log(`Filled ${kids.length} kid(s) with 14 days of demo history in ${path}`);
process.exit(0);
