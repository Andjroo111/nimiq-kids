// THE PRECACHE LIST IS ONLY AS GOOD AS ITS LAST EDIT, so this checks it instead of a human.
//
// `public/sw.js` names its shell as a literal array. That is the right shape, the comments in
// it explain per entry WHY a file has to be there, which a glob cannot, but a hand-kept list
// of every module in an app drifts the moment somebody adds a file. It already had: nine of
// the kid app's stylesheets, twenty of its modules and the shared shell bundle were missing,
// so a first offline boot would have 404ed most of the app it had just precached.
//
// The rule is all-or-nothing on purpose. An ES module graph has no useful partial failure:
// one missing import is a ReferenceError out of boot, and the kid sees a white screen rather
// than a degraded board. So every .js and .css the app serves under these three directories
// must be in SHELL, and a new file fails this test until it is.
//
// ⚠️ NOT public/kid/timer. It is 10MB of vendored egg timer, it versions itself
// (src/timer-build.ts), and its own assets are content-addressed. Precaching it would cost
// every tablet ten megabytes to make one optional screen work offline.
import { test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(import.meta.dir, "..", "public");
const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");

/** The SHELL array's entries, minus any `?v=` a file carries for its own reasons.
 *
 *  APP_ENTRY and KID_ENTRY appear in the array as identifiers, not literals, so they are
 *  resolved from their own `const` first. A test that silently skipped them would be blind to
 *  the one entry the offline fallback cannot work without. */
export function shellEntries(source: string): string[] {
  const constant = (name: string) => source.match(new RegExp(`const ${name} = "([^"]+)"`))?.[1] ?? "";
  const start = source.indexOf("const SHELL = [");
  // ⚠️ COMMENT LINES ARE DROPPED FIRST. Half of SHELL is prose explaining why each group has
  // to be there, and that prose quotes things: `"Feed the dog"` and `"four glyphs"` both read
  // as precache entries to a bare quote match. Extra entries never fail the missing-file
  // assertions below, so this would have passed silently while the count it reports was wrong.
  const body = source.slice(start, source.indexOf("];", start))
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const idents = [...body.matchAll(/^\s*(APP_ENTRY|KID_ENTRY)\b/gm)].map((m) => constant(m[1]!));
  const literals = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  return [...idents, ...literals].map((u) => u.replace(/\?.*$/, "")).filter(Boolean);
}

/** Every file of the given extensions served from `dir`, as root-relative URLs.
 *  Underscore-prefixed entries are work in progress that nothing imports
 *  (public/kid/js/_eggtimer-port). */
function served(dir: string, exts: string[], out: string[] = []): string[] {
  // A directory that is not there serves nothing. Four of the art directories below left the
  // tree on 2026-09-15 (the art repass; src/sticker-catalog.ts) and come back with the art.
  if (!existsSync(join(PUBLIC, dir))) return out;
  for (const name of readdirSync(join(PUBLIC, dir))) {
    if (name.startsWith("_")) continue;
    const full = join(PUBLIC, dir, name);
    if (statSync(full).isDirectory()) continue;
    if (exts.some((e) => name.endsWith(e))) out.push(`/${dir}/${name}`);
  }
  return out;
}

const entries = new Set(shellEntries(sw));

test("SHELL is parsed, and is not trivially empty", () => {
  // 111 entries since the 122 art files left the list (2026-09-15); it was 233 with them. The
  // floor is the code shell alone: documents, every module and stylesheet, the vendored kit.
  expect(entries.size).toBeGreaterThan(100);
});

for (const dir of ["kid/js", "kid/css", "js/lib"]) {
  test(`every module under public/${dir} is precached`, () => {
    const missing = served(dir, [".js", ".css"]).filter((u) => !entries.has(u));
    expect(missing, `add these to SHELL in public/sw.js: ${missing.join(", ")}`).toEqual([]);
  });
}

// THE ART A BOARD DRAWS, and this half is not theoretical.
//
// On Leo's tablet with the Wi-Fi off, 2026-09-11, "Feed the dog" rendered a broken-image
// glyph between two cards that drew their icons correctly. Sixteen of the forty-five job icons
// were in SHELL; the paw bowl arrived in src/task-icons.ts batch 2 and this list did not move
// with it. The art a card wears is resolved SERVER-side from whatever emoji a parent chose
// (`iconUrlForEmoji`), so the client cannot know in advance which file it will be asked for
// and any list shorter than all of them has a hole in it somewhere.
//
// Same argument for the three other directories: the switch-gate pictures are the login on a
// shared tablet, the Treasure Box faces are five tiles that must not be four, and a sticker is
// the reward itself. (The dock was a fourth until 2026-09-15; it is inline SVG now.)
for (const dir of ["assets/icons", "assets/stickers", "assets/secret", "assets/store"]) {
  test(`every picture under public/${dir} is precached`, () => {
    const missing = served(dir, [".png", ".svg", ".webp"]).filter((u) => !entries.has(u));
    expect(missing, `add these to SHELL in public/sw.js: ${missing.join(", ")}`).toEqual([]);
  });
}

test("the kid entry, its document and the shared shell bundle are precached", () => {
  // /dist/app-shell.js is untracked build output, so it cannot be globbed from the tree the
  // way the three directories above are. It is also the only file on the page that carries
  // i18n: without it an offline board renders raw `app.*` keys where its labels should be.
  for (const u of ["/kid/", "/dist/app-shell.js", "/portal/"]) expect(entries).toContain(u);
});

test("the 10MB vendored timer is NOT precached", () => {
  expect([...entries].filter((u) => u.startsWith("/kid/timer/"))).toEqual([]);
});

test("art is precached into the UNSTAMPED cache, and activate never purges it", () => {
  // The cache name for code is rewritten with the boot stamp by src/serve-cache.ts, so every
  // deploy drops it and re-pulls. Eleven of the shell's twelve megabytes are pictures a code
  // deploy does not touch, so they live in a cache that is not stamped and is skipped by the
  // purge. Assert the two rules that make that safe, because getting either one wrong is
  // either a 12MB re-download per deploy or art that can never be updated.
  expect(sw).toContain('const ART = "nimiq-kids-art"');
  expect(sw).toMatch(/k !== CACHE && k !== ART/);
  expect(sw).toMatch(/isArt = \(p\) =>[\s\S]*?\/assets\//);
});
