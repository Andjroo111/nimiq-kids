// The goal templates the parent climb offers (src/goal-templates.ts): a ladder built from one
// is in the kid's language on the tablet only if every step's key is in all five locales, and
// a goal is never a chore.

import { test, expect } from "bun:test";
import { GOAL_TEMPLATES, DEFAULT_GOAL_TEMPLATE, goalTemplate, goalTemplateKeys } from "./goal-templates";
import { catEn, catEs, catDe, catFr, catPt } from "./locales/catalog";
import { SAMPLE_CHORES } from "./starter-board";
import { jobKey } from "./title-catalog";
import { existsSync } from "node:fs";

test("every template key is in all five languages", () => {
  const sets = { en: catEn, es: catEs, de: catDe, fr: catFr, pt: catPt } as Record<string, Record<string, string>>;
  for (const key of goalTemplateKeys()) {
    for (const [lang, set] of Object.entries(sets)) {
      expect({ lang, key, has: key in set }).toEqual({ lang, key, has: true });
    }
  }
});

test("the default template exists and every template has at least three steps", () => {
  expect(goalTemplate(DEFAULT_GOAL_TEMPLATE)).not.toBeNull();
  for (const t of GOAL_TEMPLATES) expect(t.steps).toBeGreaterThanOrEqual(3);
  expect(goalTemplate("bed")).toBeNull();
  expect(goalTemplate(undefined)).toBeNull();
});

test("a goal step is never a chore: no template key is a job key", () => {
  const jobs = new Set(SAMPLE_CHORES.map((c) => jobKey(c.job)));
  for (const key of goalTemplateKeys()) expect(jobs.has(key)).toBe(false);
  for (const key of goalTemplateKeys()) expect(key.startsWith("cat.goal.")).toBe(true);
});

test("every template has a drawn icon on disk: an emoji on the picker is old art", () => {
  for (const t of GOAL_TEMPLATES) expect(existsSync(`public/assets/icons/${t.icon}.png`), t.icon).toBe(true);
});
