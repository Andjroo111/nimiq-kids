// The catalog contract, and the render rule it exists to serve.
//
// The bug (Andjroo, 2026-08-01): the language switch changed the headings on a
// kid's board and nothing under them. Headings were keys; the board was rows in
// SQLite holding English prose. These tests pin the two halves of the fix — that
// everything WE name carries a key in all 5 languages, and that everything a
// PARENT names is left in their words — and the seam where they meet.

import { test, expect } from "bun:test";
import {
  JOB_CATALOG, ROUTINE_CATALOG, SHELF_CATALOG, ITEM_CATALOG, PACK_CATALOG,
  JOB_GROUPS, job, resolveJob, jobKey, routineKey, rowKey, catalogKeys, catalogEnglish,
} from "./title-catalog";
import { appLocales } from "./locales/index";
import { parentLocales } from "./locales/parent";
import { DEMO_KIDS } from "./demo-family";
import { STICKER_PACKS } from "./sticker-catalog";
import { TASK_ICONS, TASK_ICON_ART_SHIPPED, iconUrlForEmoji } from "./task-icons";
import { existsSync } from "node:fs";
import { SAMPLE_CHORES } from "./starter-board";

const LANGS = ["en", "es", "de", "fr", "pt"] as const;

// ---------- the catalog is internally consistent ----------

test("ids are unique across the catalog", () => {
  const ids = JOB_CATALOG.map((j) => j.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("every job sits in a real picker group, and every group has tiles", () => {
  // A job MAY carry no group: that is how a tile is retired from the picker without
  // orphaning the boards already pointing at its key (`petfeed`, 2026-09-17). What is
  // still a bug is a group that names nothing, because `/api/jobs` builds the grid from
  // JOB_GROUPS and would draw an empty heading.
  for (const j of JOB_CATALOG) {
    if (j.group === undefined) continue;
    expect(JOB_GROUPS, `${j.id} group`).toContain(j.group);
  }
  // A group with no tiles renders as an empty heading in the picker.
  for (const g of JOB_GROUPS) {
    expect(JOB_CATALOG.filter((j) => j.group === g).length, `group ${g}`).toBeGreaterThan(0);
  }
});

// ---------- a retired tile still translates ----------
//
// `petfeed` ("Feed the pet") left the picker on 2026-09-17 because it read as a
// placeholder next to "Feed the dog" and "Feed the cat". It stays in the table: a board
// created before that date holds `cat.job.petfeed` in SQLite, and dropping the row is how
// those boards would fall back to English forever. Retirement is the ABSENCE of a group,
// and these two halves are what make that a real mechanism rather than a comment.
test("a job with no group keeps its key in all 5 languages", () => {
  const retired = JOB_CATALOG.filter((j) => j.group === undefined);
  expect(retired.map((j) => j.id)).toEqual(["petfeed"]);
  for (const j of retired) {
    for (const [lang, strings] of Object.entries(appLocales)) {
      expect(strings[jobKey(j.id)], `${lang} ${j.id}`).toBeTruthy();
    }
  }
});

test("a retired job is offered by no picker group", () => {
  const offered = new Set(
    JOB_GROUPS.flatMap((g) => JOB_CATALOG.filter((j) => j.group === g).map((j) => j.id)),
  );
  for (const j of JOB_CATALOG.filter((x) => x.group === undefined)) {
    expect(offered.has(j.id), `${j.id} offered`).toBe(false);
  }
});

// The starter board is the FIRST screen of a new family, so it is the one board that
// cannot seed a tile we have stopped standing behind. It seeded `petfeed` until
// 2026-09-17: the vaguest of the three jobs, on the first line a parent ever reads.
test("the starter board seeds only jobs the picker still offers", () => {
  for (const c of SAMPLE_CHORES) {
    expect(job(c.job).group, `starter ${c.job}`).toBeDefined();
  }
});

test("every job carries an emoji and English", () => {
  for (const j of JOB_CATALOG) {
    expect(j.emoji, j.id).toBeTruthy();
    expect(j.en, j.id).toBeTruthy();
  }
});

// ---------- all five languages, or it does not ship ----------
//
// This is the test that matters most. A tile added to the catalog with no
// translation would render its English fallback on a Spanish tablet — the exact
// bug, one chore at a time, and invisible until someone switched language.

test("every catalog key is translated in all 5 languages, in BOTH apps", () => {
  for (const key of catalogKeys()) {
    for (const lang of LANGS) {
      expect(appLocales[lang]?.[key], `kid app: ${lang}.${key}`).toBeTruthy();
      expect(parentLocales[lang]?.[key], `parent app: ${lang}.${key}`).toBeTruthy();
    }
  }
});

test("both apps agree on what a job is called", () => {
  // The kid's board and the parent's approval queue name the same chores. Two
  // copies of "Brush your teeth" is two things to keep in step, so catalog.ts is
  // merged into both — this fails if someone re-declares one locally.
  for (const key of catalogKeys()) {
    for (const lang of LANGS) {
      expect(parentLocales[lang]?.[key], `${lang}.${key}`).toBe(appLocales[lang]![key]!);
    }
  }
});

test("no language leaves a job in English by accident", () => {
  // Not every translation differs from English (German "Timer" is "Timer"), so
  // this asserts a RATE rather than each key: a locale where most jobs match the
  // English exactly has been stubbed out with the fallback rather than written.
  for (const lang of LANGS.filter((l) => l !== "en")) {
    const jobs = JOB_CATALOG.map((j) => jobKey(j.id));
    const same = jobs.filter((k) => appLocales[lang]![k] === appLocales.en![k]).length;
    expect(same / jobs.length, `${lang} untranslated share`).toBeLessThan(0.1);
  }
});

// ---------- the seeds only name things that exist ----------

test("every seeded demo title resolves to a catalog entry", () => {
  // `job()` throws on an unknown id. A typo here would otherwise seed a key that
  // nothing translates, and that board would render English forever with no error.
  for (const kid of DEMO_KIDS) {
    for (const ch of kid.chores) expect(() => job(ch.job)).not.toThrow();
    for (const h of kid.history) expect(() => job(h.job)).not.toThrow();
    for (const t of kid.routine.tasks) expect(() => job(t.job)).not.toThrow();
    expect(ROUTINE_CATALOG.map((r) => r.id)).toContain(kid.routine.routine);
  }
});

test("the sticker packs the catalogue seeds all have a title key", () => {
  // db.ts writes `rowKey(pack.id)` onto every pack row at boot, so a pack added
  // to sticker-catalog.ts without a PACK_CATALOG entry would key to nothing.
  for (const p of STICKER_PACKS) {
    expect(PACK_CATALOG.map((x) => x.id), `pack ${p.id}`).toContain(p.id);
  }
});

test("catalogEnglish covers every key the locales must define", () => {
  expect(Object.keys(catalogEnglish()).sort()).toEqual(catalogKeys().sort());
});

test("the English in the catalog IS the English locale", () => {
  // The stored `title` column is the fallback, and the locale is what renders.
  // If these drift, a row falls back to wording the app never shows anywhere else.
  const english = catalogEnglish();
  for (const [key, text] of Object.entries(english)) {
    expect(appLocales.en![key], key).toBe(text);
  }
});

// ---------- the HTTP boundary ----------

test("resolveJob accepts a known id and refuses everything else", () => {
  expect(resolveJob("dishwasher")?.id).toBe("dishwasher");
  // A client cannot invent a key: an unknown id falls back to free text rather
  // than writing a title and a key that disagree.
  expect(resolveJob("not-a-job")).toBeNull();
  expect(resolveJob(undefined)).toBeNull();
  expect(resolveJob(null)).toBeNull();
  expect(resolveJob(42)).toBeNull();
  expect(resolveJob({ id: "dishwasher" })).toBeNull();
});

test("key shapes are stable", () => {
  // Renaming a key orphans every row already pointing at it, which is the one
  // way to make a working board fall back to English.
  expect(jobKey("dishwasher")).toBe("cat.job.dishwasher");
  expect(routineKey("morning")).toBe("cat.routine.morning");
  expect(rowKey("cat-screen")).toBe("cat.cat-screen");
  expect(rowKey("pack-ocean")).toBe("cat.pack-ocean");
});

// ---------- every job in the catalog has a real face ----------
//
// Thirteen of the forty-two catalog jobs had drawn art and the other twenty-nine fell
// back to their raw emoji, on the kid's board as much as the parent's. That was invisible
// until the parent board started drawing the same faces (#84), because an emoji is a
// perfectly plausible-looking fallback. These two tests are what keep it closed: a tile
// added to title-catalog.ts without art now fails the suite instead of quietly shipping
// as an emoji next to forty-one drawings.

// The two on-disk gates skip while no icon art ships (2026-09-15, task-icons.ts); the table's
// own invariants below them do not depend on a file.
test.skipIf(!TASK_ICON_ART_SHIPPED)("every catalog job resolves to a drawn icon", () => {
  const missing = JOB_CATALOG.filter((j) => !iconUrlForEmoji(j.emoji)).map((j) => `${j.emoji} ${j.id}`);
  expect(missing).toEqual([]);
});

test.skipIf(TASK_ICON_ART_SHIPPED)("while no icon art ships, every job resolves to no url and keeps its emoji", () => {
  for (const j of JOB_CATALOG) expect(iconUrlForEmoji(j.emoji)).toBeNull();
  expect(existsSync("public/assets/icons")).toBe(false);
});

test.skipIf(!TASK_ICON_ART_SHIPPED)("every drawn icon's file is actually on disk", () => {
  for (const ic of TASK_ICONS) {
    expect(existsSync(`public/assets/icons/${ic.id}.png`), `${ic.id}.png`).toBe(true);
  }
});

test("no two icons share an emoji", () => {
  // Two icons on one emoji makes which art you get depend on table order.
  const bare = TASK_ICONS.map((i) => i.emoji.replace(/️/g, ""));
  expect(new Set(bare).size).toBe(bare.length);
});
