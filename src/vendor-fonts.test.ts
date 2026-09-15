// The CSP no longer allows Google Fonts, so nothing an app page loads may ask for one.
//
// The stylesheets under `public/vendor/` are `nq add` output. Re-running that sync would
// restore the `@import url('https://fonts.googleapis.com/...')` these files used to open
// with, the parent app would start reporting a blocked stylesheet on every screen, and
// addresses would render in the fallback monospace. It would look like a font bug, not like
// a component sync, which is why this is a test rather than a comment.
//
// Scoped to CSS because that is what an app page pulls in. The `demo.html` exhibits beside
// them still link Google directly and are deliberately left alone: nobody navigates to them,
// and a blocked webfont there costs a fallback glyph.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const VENDOR = new URL("../public/vendor", import.meta.url).pathname;
const FORBIDDEN = /fonts\.googleapis\.com|fonts\.gstatic\.com/;

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

test("no vendored stylesheet pulls a font from Google", () => {
  const files = cssFiles(VENDOR);
  // Guard the guard: an empty sweep would pass this test while proving nothing, which is
  // exactly what a moved vendor directory would look like.
  expect(files.length).toBeGreaterThan(0);

  const offenders = files
    .filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(VENDOR.length + 1));

  expect(offenders).toEqual([]);
});

test("the Fira Mono files those stylesheets point at are really there", () => {
  // A @font-face pointing at a missing file fails silently: the browser falls back and the
  // page still renders, so the swap would look fine and be broken.
  for (const weight of ["400", "500"]) {
    const path = new URL(`../public/fonts/fira-mono-latin-${weight}.woff2`, import.meta.url).pathname;
    const bytes = readFileSync(path);
    expect(bytes.length).toBeGreaterThan(1000);
    // woff2 signature, so a truncated or wrong-format download is caught here too.
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
  }
});

test("the address-display stylesheets declare both weights locally", () => {
  for (const dir of ["nq", "nqp"]) {
    const css = readFileSync(join(VENDOR, dir, "address-display/address-display.css"), "utf8");
    expect(css).toContain("/fonts/fira-mono-latin-400.woff2");
    expect(css).toContain("/fonts/fira-mono-latin-500.woff2");
  }
});
