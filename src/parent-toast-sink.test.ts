// `toast()` was the parent app's last unescaped innerHTML sink, and every caller feeds it
// `t(key, params)` — which substitutes `{name}` raw. So a child's nickname arrived as
// parsed HTML inside the app that holds the parent bearer token.
//
// The fix is at the sink, not at the twelve call sites: the frame is our markup, the
// message is somebody's data and goes in as `textContent`. These pin that shape by
// reading the source, because the alternative — a caller-by-caller esc() audit — is what
// left the sink unescaped for a year while views-approvals.js:139 escaped the identical
// value nine lines below a call that did not.

import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { kidIconsMock } from "./kid-icons-mock";

// util.js pulls icons.js, which imports a browser-absolute path. Same stub as
// fmt-nim-whole.test.ts and kid-lang-repaint.test.ts.
mock.module("../public/kid/js/icons.js", kidIconsMock);

const read = (p: string) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");

const CORE = read("parent/core.js");

test("toast() never interpolates its message into innerHTML", () => {
  const body = CORE.slice(CORE.indexOf("export function toast("));
  const fn = body.slice(0, body.indexOf("\n}\n") + 3);

  // The message reaches the DOM as text, and the only innerHTML in there is our own frame.
  expect(fn).toContain("textContent = msg");
  expect(fn).not.toMatch(/innerHTML\s*=\s*`[^`]*\$\{msg\}/);
  // And `msg` appears exactly once, on the textContent line.
  expect(fn.match(/\bmsg\b/g)!.filter((_, i) => i > 0)).toHaveLength(1);
});

test("there is ONE escaper, and it covers the single quote", async () => {
  const { esc } = await import("../public/js/lib/esc.js");
  expect(esc(`<img src=x onerror="alert(1)">`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  expect(esc("it's")).toBe("it&#39;s");
  expect(esc("a & b")).toBe("a &amp; b");
  expect(esc(null)).toBe("");
  expect(esc(undefined)).toBe("");
});

// Four copies of this existed, two of them missing `'`, so whether a string was safe
// inside a single-quoted attribute depended on which file you were in. Nobody spots that
// by reading; they spot it the day one of the four is used where the others were safe.
test("no module defines its own escaper any more", () => {
  const files = [
    "parent/fmt.js", "parent/core.js",
    "kid/js/util.js", "kid/js/fmt.js",
    "js/lib/job-picker.js", "js/lib/box-glyphs.js",
  ];
  for (const f of files) {
    let src: string;
    try { src = read(f); } catch { continue; } // not every one of these exists
    const ownDefinition = /(?:const|let|var|function)\s+esc\w*\s*=?[^\n]*replace\(\s*\/\[&/;
    expect({ file: f, defines: ownDefinition.test(src) }).toEqual({ file: f, defines: false });
  }
});

// The regression this shipped with and the real app caught: `export { esc } from "..."`
// re-exports WITHOUT binding the name locally, and both files call esc() themselves. The
// parent app booted to a blank screen on a ReferenceError.
test("a module that re-exports esc also imports it, because it calls esc() itself", () => {
  for (const f of ["parent/fmt.js", "kid/js/util.js"]) {
    const src = read(f);
    if (!/\bexport\s*\{\s*esc\s*\}/.test(src)) continue;
    expect({ file: f, imports: /^import\s*\{\s*esc\s*\}\s*from/m.test(src) }).toEqual({ file: f, imports: true });
    expect({ file: f, bareReExport: /export\s*\{\s*esc\s*\}\s*from/.test(src) }).toEqual({ file: f, bareReExport: false });
  }
});
