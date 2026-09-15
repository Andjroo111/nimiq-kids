// Every icon name the parent app asks for must exist in its own registry.
//
// `icon()` and `duotone()` in public/parent/icons.js answer an UNKNOWN name with an empty
// string, never an error. That is the right call at runtime (a missing glyph must not take a
// screen down the way a thrown import does), and it is also how two rows shipped blank:
// the Treasure Box tab (`duotone-medal` over a light tab, 2026-09-01) and the Progress row on
// a kid's page (`icon("speedmeter")`, a name the LINE table never had). Both were caught by
// looking at a phone. Nothing else could have caught them, because the string is a valid
// argument and the empty result is a valid render.
//
// This walks every literal call and checks the name against the tables, by reading the source
// as text: icons.js imports `/js/lib/box-glyphs.js` by absolute URL, which only a browser can
// resolve, so the module itself cannot be imported here. The regexes are deliberately narrow
// (a quoted literal as the first argument); a name built at runtime is not this test's problem.
import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", "public", "parent");
const REGISTRY = readFileSync(join(DIR, "icons.js"), "utf8");

/** The keys of LINE and DUO: every `"name": {` or `"name": \`` at two-space indent. */
export function definedIconNames(source: string): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(/^  "([a-z0-9-]+)": [{`]/gm)) out.add(m[1]!);
  return out;
}

/** Every `icon("name"` / `duotone("name"` literal in one module, with the line it is on. */
export function requestedIconNames(source: string): { fn: string; name: string; line: number }[] {
  const out: { fn: string; name: string; line: number }[] = [];
  const lines = source.split("\n");
  lines.forEach((text, i) => {
    for (const m of text.matchAll(/\b(icon|duotone)\("([a-z0-9-]+)"/g)) {
      out.push({ fn: m[1]!, name: m[2]!, line: i + 1 });
    }
  });
  return out;
}

const defined = definedIconNames(REGISTRY);

/** Every parent module that CONSUMES icons. The registry itself is excluded: it names glyphs
 *  in comments, and it is the thing being checked against, not a caller. */
const consumers = readdirSync(DIR).filter((f) => f.endsWith(".js") && f !== "icons.js");

test("the registry parsed into a real set of names", () => {
  expect(defined.size).toBeGreaterThan(15);
  expect(defined.has("chevron-right")).toBe(true);
  expect(defined.has("duotone-medal")).toBe(true);
});

test("every icon the parent app asks for by name exists", () => {
  const missing: string[] = [];
  for (const file of consumers) {
    for (const r of requestedIconNames(readFileSync(join(DIR, file), "utf8"))) {
      if (!defined.has(r.name)) missing.push(`${file}:${r.line} ${r.fn}("${r.name}")`);
    }
  }
  expect(missing).toEqual([]);
});

test("the check FAILS on the name that shipped blank", () => {
  const shipped = `<span class="hex-tile">\${icon("speedmeter", 22)}</span>`;
  const asked = requestedIconNames(shipped);
  expect(asked).toEqual([{ fn: "icon", name: "speedmeter", line: 1 }]);
  expect(defined.has("speedmeter")).toBe(false);
  expect(definedIconNames('  "chevron-right": { w: 12 },\n  "duotone-x": `<svg/>`,\n')).toEqual(
    new Set(["chevron-right", "duotone-x"]),
  );
});
