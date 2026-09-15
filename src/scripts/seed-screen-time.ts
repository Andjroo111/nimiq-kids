/**
 * Seed one household's curfew + screen-time budgets (#377).
 *
 * The parent app owns these settings; this exists because the FIRST household to get them
 * is the one running on this Mini tonight, and it needs the rows before there is a screen
 * to type them into. It is idempotent -- the curfew is replaced wholesale, the budgets are
 * set rather than added to -- so re-running it after an edit in the app simply puts the
 * defaults back, which is what you want from a script called "seed".
 *
 *   bun run src/scripts/seed-screen-time.ts [--daily 60] [--earned 30] [--dry]
 */
import { getDb, initDb } from "../db";
import * as repo from "../repo";
import * as lockRepo from "../repo-lock";

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const DRY = process.argv.includes("--dry");
const DAILY_MIN = arg("daily", 60);
const EARNED_MIN = arg("earned", 30);

// Andjroo's hours, 2026-08-26: Sun-Thu 07:00-20:00, Fri-Sat 07:00-21:00. Two rows, because
// one row cannot say "later on two days". Mask is Mon..Sun, Monday = index 0.
const CURFEW = [
  { startHhmm: "07:00", endHhmm: "20:00", days: "1111001" }, // Mon Tue Wed Thu + Sun
  { startHhmm: "07:00", endHhmm: "21:00", days: "0000110" }, // Fri + Sat
];

initDb(process.env.DB_PATH ?? "kids.db");

// No repo.listFamilies(): every read in repo.ts is family-SCOPED by design, which is the
// right shape for an app and the wrong one for a one-off script that has to find the
// household first. Reading the table directly here keeps that invariant where it belongs.
const families = (getDb().query("SELECT * FROM families WHERE mode='family'").all() as repo.Family[]);
if (families.length === 0) {
  console.error("No family-mode household in this database — nothing to seed.");
  process.exit(1);
}
if (families.length > 1) {
  // Refuse rather than guess: writing a curfew onto the wrong household locks a tablet
  // that was working, and there is no screen anywhere that would explain why.
  console.error(`${families.length} family-mode households found. Refusing to guess; seed by hand.`);
  process.exit(1);
}
const fam = families[0]!;
const kids = repo.listChildren(fam.id);

console.log(`Household: ${fam.parent_label} (${fam.id})  tz=${fam.tz}`);
console.log("Curfew:");
for (const w of CURFEW) console.log(`  ${w.days}  ${w.startHhmm}-${w.endHhmm}`);
console.log(`Budget: ${DAILY_MIN} min/day, up to ${EARNED_MIN} min earnable, for ${kids.length} kid(s)`);
if (DRY) { console.log("\n--dry: nothing written."); process.exit(0); }

lockRepo.replaceAllowWindows(fam.id, CURFEW);
for (const k of kids) repo.setScreenBudget(k.id, DAILY_MIN, EARNED_MIN);

console.log("\nWritten. Read back:");
for (const w of lockRepo.allowWindowsForFamily(fam.id)) {
  console.log(`  window ${w.days} ${w.start_hhmm}-${w.end_hhmm}`);
}
for (const k of repo.listChildren(fam.id)) {
  console.log(`  ${k.emoji} ${k.label}: ${k.daily_screen_min} min/day (+${k.max_earned_min} earnable)`);
}
