// Locale-parity guard (mirrors nimiq.life test/locales.test.ts). The `: typeof en`
// typing already makes tsc fail on a missing/extra key; these runtime tests catch
// empty strings, dropped {placeholders}, and the brand no-dash rule.

import { test, expect } from "bun:test";
import { appLocales } from "./index";

const langs = Object.keys(appLocales);
const enKeys = Object.keys(appLocales.en!).sort();

test("ships the 5 shell languages", () => {
  expect(langs.sort()).toEqual(["de", "en", "es", "fr", "pt"]);
});

test("every locale mirrors en's keys exactly", () => {
  for (const lang of langs) {
    expect(Object.keys(appLocales[lang]!).sort()).toEqual(enKeys);
  }
});

test("no message is empty", () => {
  for (const lang of langs) {
    for (const [key, value] of Object.entries(appLocales[lang]!)) {
      expect(value, `${lang}.${key}`).toBeTruthy();
    }
  }
});

test("every {placeholder} in en survives translation in every locale", () => {
  const en = appLocales.en!;
  const placeholderRe = /\{(\w+)\}/g;
  for (const [key, enValue] of Object.entries(en)) {
    const tokens = [...enValue.matchAll(placeholderRe)].map((m) => m[0]).sort();
    if (tokens.length === 0) continue;
    for (const lang of langs) {
      const translated = appLocales[lang]![key]!;
      const got = [...translated.matchAll(placeholderRe)].map((m) => m[0]).sort();
      expect(got, `${lang}.${key} placeholders`).toEqual(tokens);
    }
  }
});

test("no em or en dashes in UI copy (brand rule 18)", () => {
  for (const lang of langs) {
    for (const value of Object.values(appLocales[lang]!)) {
      expect(value).not.toMatch(/[—–]/);
    }
  }
});
