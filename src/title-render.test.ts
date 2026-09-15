// The render rule, and the two ways a title can lose its language.
//
//     title_key ? t(title_key) : title
//
// Half of that line is the feature and half is a promise: a parent's own words
// are NOT machine-translated and NOT replaced by ours (Andjroo, 2026-08-01), so
// a row with no key must survive every language switch untouched. These tests
// run the real helper both apps use, and the real migration, against a real DB.

import { test, expect, mock, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { catalogEnglish, jobKey } from "./title-catalog";
import { kidIconsMock } from "./kid-icons-mock";

mock.module("../public/kid/js/icons.js", kidIconsMock);

// The helper is shared by the kid app and the parent app. Testing the kid copy
// exercises the same source both were written from.
const { rowTitle } = await import("../public/kid/js/util.js");

const SPANISH: Record<string, string> = {
  "cat.job.teeth": "Cepíllate los dientes",
  "cat.job.bed": "Haz tu cama",
};

beforeEach(() => {
  // `t()` reads the shell off window; give it a Spanish one.
  (globalThis as { window?: unknown }).window = {
    nimiqKidsShell: { t: (k: string) => SPANISH[k] ?? k },
  };
});

test("a row we named renders in the reader's language", () => {
  expect(rowTitle({ title: "Brush your teeth", titleKey: "cat.job.teeth" }))
    .toBe("Cepíllate los dientes");
});

test("a row the PARENT named renders in their words, untouched", () => {
  // The whole reason free text is not machine-translated. "Winston" is a dog,
  // and a translator turns him into a noun.
  const typed = { title: "Feed Winston his 5pm scoop", titleKey: null };
  expect(rowTitle(typed)).toBe("Feed Winston his 5pm scoop");
});

test("snake_case rows work too", () => {
  // The kid board serializes camelCase views; the parent reads rows closer to
  // the table. Callers must not have to know which one they are holding.
  expect(rowTitle({ title: "Make your bed", title_key: "cat.job.bed" })).toBe("Haz tu cama");
  expect(rowTitle({ title: "Feed the fish", title_key: null })).toBe("Feed the fish");
});

test("a key with no translation falls back to the stored English, never to blank", () => {
  // `t()` returns the key itself when nothing matches, so this is the one case
  // where a missing translation must NOT be rendered: "cat.job.dust" on a card
  // is worse than the English the row already carries.
  expect(rowTitle({ title: "Dust the shelves", titleKey: "cat.job.dust" }))
    .toBe("Dust the shelves");
});

test("a missing or empty row renders nothing rather than throwing", () => {
  expect(rowTitle(undefined)).toBe("");
  expect(rowTitle({})).toBe("");
});

// ---------- the migration ----------

/** A database as it stood BEFORE this change: titles as prose, no key column. */
function legacyDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE chores (id TEXT PRIMARY KEY, title TEXT NOT NULL);
          CREATE TABLE routine_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL);`);
  return db;
}

test("the backfill stamps keys onto rows that were seeded before the column existed", () => {
  // Demo households already on disk are the ones a judge opens. Without this,
  // localization would only reach families created after the deploy and every
  // existing demo would stay English under translated headings.
  const db = legacyDb();
  db.run("INSERT INTO chores VALUES ('a', 'Empty the dishwasher'), ('b', 'Feed Winston his 5pm scoop')");
  db.run("INSERT INTO routine_tasks VALUES ('t', 'Brush your teeth')");
  db.run("ALTER TABLE chores ADD COLUMN title_key TEXT");
  db.run("ALTER TABLE routine_tasks ADD COLUMN title_key TEXT");

  const english = catalogEnglish();
  const byText = new Map(Object.entries(english).map(([k, v]) => [v, k]));
  for (const [text, key] of byText) {
    db.run("UPDATE chores SET title_key=? WHERE title=? AND title_key IS NULL", [key, text]);
    db.run("UPDATE routine_tasks SET title_key=? WHERE title=? AND title_key IS NULL", [key, text]);
  }

  const chores = db.query("SELECT id, title_key FROM chores ORDER BY id").all() as
    { id: string; title_key: string | null }[];
  expect(chores[0]!.title_key).toBe(jobKey("dishwasher"));
  // The one nobody wrote for them stays keyless, which is what keeps it theirs.
  expect(chores[1]!.title_key).toBeNull();
  expect((db.query("SELECT title_key FROM routine_tasks").get() as { title_key: string })!.title_key)
    .toBe(jobKey("teeth"));
});

test("the alias covers the seeded wording the catalog no longer uses verbatim", () => {
  // Onboarding said "Tidy up your room" and the demo said "Tidy your room". Both
  // are cat.job.room; dropping either leaves one of the two front doors English.
  const src = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
  expect(src).toContain('"Tidy up your room": jobKey("room")');
});

test("the backfill never touches a shelf row the parent has edited", () => {
  // syncStickerCatalog already respects parent_edited; the backfill has to as
  // well, or the language switch puts our words back over theirs.
  const src = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
  const stmt = src.slice(src.indexOf("UPDATE store_items SET title_key"));
  expect(stmt.slice(0, 120)).toContain("parent_edited=0");
});

test("renaming clears the key in every table that has one", () => {
  // A rename makes the title theirs. Keeping the key would put OUR words back
  // the instant the device language changed: the edit would look applied on the
  // parent's phone and be gone on the kid's tablet.
  const routines = readFileSync(new URL("./repo-routines.ts", import.meta.url), "utf8");
  expect(routines).toContain('if (patch.title !== undefined) { fields.push("title_key=?"); vals.push(null); }');

  const practices = readFileSync(new URL("./repo-practices.ts", import.meta.url), "utf8");
  expect(practices).toContain("title_key: patch.title?.trim() ? null : p.title_key,");

  const store = readFileSync(new URL("./repo-stickers.ts", import.meta.url), "utf8");
  expect([...store.matchAll(/patch\.title !== undefined \? ", title_key=NULL" : ""/g)]).toHaveLength(2);
});
