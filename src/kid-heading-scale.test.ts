// ONE HEADING SCALE, AND NOTHING ELSE ALLOWED TO SET ONE.
//
// Andjroo, 2026-09-10: "Look at the part that says pick a game and see how that looks like
// nothing else in the whole site ... we need to do a pass on everything. Tools looks small."
//
// He was right, and the cause was not taste. Nothing OWNED the sizes: each screen scaled its
// own title in its own tablet block, so the app shipped three page titles (44/700 Grow,
// 38/800 Box, 24/900 Games) and three section headings (22/900, 22/700, 20/700) that each
// looked deliberate on its own screen. That is the failure this file exists to stop coming
// back, and it comes back the moment one screen sets its own font-size again.
//
// Two roles, two tokens, one tablet bump, one selector each.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const KID = read("public/kid/kid.css");
const SCENE = read("public/kid/css/scene.css");

/** Every sheet a screen could smuggle a heading size into. */
const SHEETS = ["public/kid/kid.css", "public/kid/css/scene.css", "public/kid/css/chart.css",
  "public/kid/css/box.css", "public/kid/css/games.css", "public/kid/css/wallet.css",
  "public/kid/css/phone.css", "public/kid/css/landscape.css"];

/** The heading selectors, by role. */
const TITLES = [".k-page-title", ".bx-title", ".games-title"];
const SECTIONS = [".ch-sec-hd", ".bx-shelf-hd", ".games-row-hd"];

test("the tokens exist, and the tablet bump is in ONE place", () => {
  for (const t of ["--fs-page-title", "--fw-page-title", "--fs-section-hd", "--fw-section-hd"]) {
    expect({ token: t, declared: KID.includes(`${t}:`) }).toEqual({ token: t, declared: true });
  }
  // Every sheet that redefines a size token, and why. kid.css bumps for the tablet; landscape
  // steps the section heading back down for a narrow column. A third would be the drift
  // starting again.
  const setters = SHEETS.filter((f) => /--fs-(page-title|section-hd):/.test(read(f)));
  expect(setters).toEqual(["public/kid/kid.css", "public/kid/css/landscape.css"]);
});

test("one selector dresses all three section headings, and all three titles", () => {
  // ⚠️ ONE selector, not three rules that happen to agree. Three agreeing rules is exactly
  // what the app had, and they drifted apart three times.
  const sectionRule = SCENE.match(/\.ch-sec-hd,\s*\.bx-shelf-hd,\s*\.games-row-hd\s*\{([^}]*)\}/);
  expect(sectionRule).not.toBeNull();
  expect(sectionRule![1]).toMatch(/font-size:\s*var\(--fs-section-hd\)/);
  expect(sectionRule![1]).toMatch(/font-weight:\s*var\(--fw-section-hd\)/);
  // Solid white, not the 0.92 the games rows used: 0.92 is what vanished into the artwork.
  expect(sectionRule![1]).toMatch(/background:\s*var\(--card\)/);

  const titleRule = SCENE.match(/\.k-page-title,\s*\.bx-title,\s*\.games-title\s*\{([^}]*)\}/);
  expect(titleRule).not.toBeNull();
  expect(titleRule![1]).toMatch(/font-size:\s*var\(--fs-page-title\)/);
  expect(titleRule![1]).toMatch(/font-weight:\s*var\(--fw-page-title\)/);
});

test("NO screen sets its own heading size", () => {
  // The regression is always the same shape: a screen adds `font-size: 38px` to its own title
  // in its own media block, it looks right on that screen, and the app has two scales again.
  const offenders: string[] = [];
  for (const file of SHEETS) {
    // ⚠️ COMMENTS OUT FIRST. Every one of these selectors is discussed by name in a comment
    // somewhere, and a comment followed by the next rule's braces matches as if it were that
    // rule -- which reads as `.ch-sec-hd` setting `.ch-group-hd`'s 20px.
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const sel of [...TITLES, ...SECTIONS]) {
      const esc = sel.replace(".", "\\.");
      for (const m of css.matchAll(new RegExp(`${esc}[^{}]*\\{([^}]*)\\}`, "g"))) {
        const size = m[1]!.match(/font-size:[^;]*/)?.[0];
        if (size && !/var\(--fs-(page-title|section-hd)\)/.test(size)) {
          offenders.push(`${file} ${sel}: ${size.trim()}`);
        }
      }
    }
  }
  expect(offenders).toEqual([]);
});

test("the games screen is called Games, and the old string is gone", () => {
  // Every other title names its screen with a noun (Treasure box, Grow). "Pick a game!" was
  // the only imperative, and the word it should use already existed on the dock button that
  // gets the kid here -- in all five locales, so this needed no new translation.
  expect(read("public/kid/js/games.js")).toContain('t("app.kidDockGames")');
  for (const f of ["src/locales/en.ts", "src/locales/es.ts", "src/locales/fr.ts",
                   "src/locales/de.ts", "src/locales/pt.ts", "public/kid/js/util.js"]) {
    expect({ file: f, stale: read(f).includes("kidGamesPick") }).toEqual({ file: f, stale: false });
  }
  // And it is a page title on a pill now, not chrome-line text: a bare word on the kid's own
  // artwork is the thing this app keeps relearning.
  expect(KID).toMatch(/\.games-hd\s*\{[^}]*align-self:\s*flex-start/);
  expect(KID).not.toMatch(/\.games-hd\s*\{[^}]*position:\s*absolute/);
});
