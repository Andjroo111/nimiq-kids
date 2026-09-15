// Parity + hygiene checks for the parent app locales (mirrors src/locales/locales.test.ts
// for the `papp.*` set): every locale carries exactly the English keys, keys stay in the
// `papp.` namespace, and copy follows the brand text rules (no em/en dashes, nimiq-ui rule 18).

import { test, expect } from "bun:test";
import { parentLocales } from "./locales/parent";

const LANGS = ["en", "es", "de", "fr", "pt"] as const;
const enKeys = Object.keys(parentLocales.en).sort();

test("all five parent locales exist", () => {
  for (const lang of LANGS) expect(parentLocales[lang]).toBeDefined();
});

test("every locale mirrors the English key set exactly", () => {
  for (const lang of LANGS) {
    expect(Object.keys(parentLocales[lang]).sort()).toEqual(enKeys);
  }
});

test("all keys live in papp.* (the parent's own) or cat.* (the shared catalog)", () => {
  // `papp.*` is this app's namespace and must never shadow the shell's `shell.*`
  // or the kid app's `app.*`. `cat.*` is the exception and is deliberate: it is
  // src/locales/catalog.ts, the titles WE author, merged into BOTH apps so the
  // kid's board and the parent's approval queue name the same chore identically.
  for (const key of enKeys) expect(key.startsWith("papp.") || key.startsWith("cat.")).toBe(true);
});

test("no em or en dashes in any string (brand text rule)", () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(parentLocales[lang])) {
      expect(`${lang}:${key}:${value}`).not.toMatch(/[—–]/);
    }
  }
});

test("placeholder tokens match English per key", () => {
  const tokens = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
  for (const key of enKeys) {
    const want = tokens(parentLocales.en[key]!);
    for (const lang of LANGS) {
      expect(tokens(parentLocales[lang][key]!)).toEqual(want);
    }
  }
});
