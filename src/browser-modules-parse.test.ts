// Every browser module this app serves must PARSE. Nothing else here checks that.
//
// 2026-09-01: the whole parent app rendered a blank white screen on the demo and on mainnet.
// `public/parent/views-store.js` had an HTML comment inside a template literal, and the
// comment quoted two field names in markdown backticks:
//
//   <!-- ... The picker writes `payload.icon`, and `storeArtUrl` reads ... -->
//
// The first of those backticks ended the template string mid-sentence, and everything after
// it was parsed as expressions. `SyntaxError: missing ) after argument list`, at load, on the
// first import — one dead module takes the entire app with it because every view is reached
// through the same static import graph.
//
// It shipped anyway, through a green CI run, because NOTHING IN THIS REPO LOOKS AT THESE
// FILES. `bun run check` type-checks `src/`, and `allowJs` is off precisely so `public/` stays
// out of that scope. `bun run build:shell` bundles `src/*-shell.ts` and never touches
// `public/parent/*.js` — those are served raw to the browser. The tests import a handful of
// pure modules (connect-batch.js, token-capture.js) and no view file at all, because a view
// file needs a DOM. So the first thing that ever read the broken syntax was a phone.
//
// This is the cheapest possible gate for that: not "does the view behave", which needs a DOM
// and is what the app's own tests are for, but "is this a JavaScript file at all". It costs
// milliseconds and it is the exact class of failure that reached production.
import { test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "public");

/** Every .js served to a browser, except the build's own output in dist/ (which is generated
 *  from src/ and is already covered by the type check and the bundle step). */
function browserModules(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "dist" || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) browserModules(full, out);
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

const transpiler = new Bun.Transpiler({ loader: "js" });

/** null when it parses, the parser's own message when it does not. */
export function parseError(source: string): string | null {
  try {
    transpiler.transformSync(source);
    return null;
  } catch (err) {
    return String((err as Error)?.message ?? err);
  }
}

const modules = browserModules(ROOT);

test("there are browser modules to check, so a broken walk cannot pass as a clean sweep", () => {
  expect(modules.length).toBeGreaterThan(20);
});

test("every browser module parses", () => {
  const broken = modules
    .map((f) => ({ file: f.slice(ROOT.length + 1), err: parseError(readFileSync(f, "utf8")) }))
    .filter((r) => r.err !== null);
  expect(broken).toEqual([]);
});

// The guard's own guard. A checker that cannot fail is not a checker, and this one is a
// try/catch around a call that is easy to render inert. The bug that prompted it, exactly.
test("the check FAILS on the syntax that shipped", () => {
  const shipped = "openSheet(`<div><!-- writes `payload.icon` and reads it back --></div>`);";
  expect(parseError(shipped)).not.toBeNull();
  expect(parseError("export const ok = (a) => `${a}`;")).toBeNull();
});
