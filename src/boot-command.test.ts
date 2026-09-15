// The launchd boot line, and the /health field that makes its outcome observable (#119).
//
// public/dist is gitignored and built at boot, so the browser bundles are the one part of a
// running instance that a merged commit cannot prove. The boot line used to be
// `build:shell …; exec server.ts` — a semicolon — so a failed build still execed the server
// and it served the PREVIOUS bundle, or none at all on a fresh checkout. The parent app has
// no i18n fallback, so a missing parent-shell.js renders approvals, top-ups and the board as
// raw `papp.*` keys, and the only signal anywhere was a line in a log nobody was reading.
//
// A one-character change is exactly the kind that gets undone by a copy-paste from an older
// template, and it would fail the same silent way, so it is pinned here.

import { test, expect } from "bun:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellBundleReport, SHELL_BUNDLES } from "./shell-bundle";

const TEMPLATES = [
  "deploy/competition/com.hatch.competition.plist.template",
  "deploy/testnet-demo/com.hatch.testnet.plist.template",
];

const repoRoot = join(import.meta.dir, "..");
const bootLine = (tpl: string) => {
  const xml = readFileSync(join(repoRoot, tpl), "utf8");
  // The boot command is the last <string> in ProgramArguments; match the one that runs bun.
  const line = xml.split("\n").find((l) => l.includes("bun run src/server.ts"));
  if (!line) throw new Error(`${tpl}: no boot line`);
  return line;
};

for (const tpl of TEMPLATES) {
  test(`${tpl} gates the server exec on a successful build:shell`, () => {
    const line = bootLine(tpl);
    // &amp;&amp; is `&&` — a bare & is not legal XML, so the escaped form is the one to assert.
    expect(line).toContain("build:shell");
    expect(line).toMatch(/build:shell[^<]*2>&amp;1 &amp;&amp; exec/);
    // And specifically NOT the semicolon that made a failed build invisible.
    expect(line).not.toMatch(/build:shell[^<]*2>&amp;1; exec/);
  });
}

test("both templates still boot the same way as each other", () => {
  // They differ only by instance name and paths. A fix applied to one and not the other is
  // the failure mode that took the competition instance out for three versions in 2026-08.
  const shapes = TEMPLATES.map((t) =>
    bootLine(t).replace(/hatch-\w+|hatch/g, "ENV").replace(/\s+/g, " ").trim(),
  );
  expect(shapes[0]).toBe(shapes[1]);
});

/** A dist dir containing exactly the named files, at the given sizes. */
function fakeDist(sizes: Partial<Record<(typeof SHELL_BUNDLES)[number], number>>) {
  const dir = mkdtempSync(join(tmpdir(), "dist-"));
  for (const [name, bytes] of Object.entries(sizes)) {
    writeFileSync(join(dir, name), "x".repeat(bytes as number));
  }
  return dir;
}

test("both bundles present reports ok with a size and a build time", () => {
  const report = shellBundleReport(fakeDist({ "app-shell.js": 10, "parent-shell.js": 20 }));
  expect(report.ok).toBe(true);
  expect(report.files["app-shell.js"]).toMatchObject({ bytes: 10 });
  expect(report.files["parent-shell.js"]!.builtAt).toMatch(/^\d{4}-\d\d-\d\dT/);
});

test("a missing bundle is not ok, and the report names WHICH one", () => {
  // The half-failure is the dangerous one: the kid app looks perfect while the parent's
  // money surface is in raw keys, so "ok:false" alone would send anyone to the wrong app.
  const report = shellBundleReport(fakeDist({ "app-shell.js": 10 }));
  expect(report.ok).toBe(false);
  expect(report.files["app-shell.js"]).not.toBeNull();
  expect(report.files["parent-shell.js"]).toBeNull();
});

test("a zero-byte bundle counts as missing, not as a very small success", () => {
  // An interrupted write leaves the file there. The script tag loads it, it parses to
  // nothing, and the app renders keys — identical to absent, so it must report identically.
  const report = shellBundleReport(fakeDist({ "app-shell.js": 0, "parent-shell.js": 20 }));
  expect(report.ok).toBe(false);
  expect(report.files["app-shell.js"]).toBeNull();
});

test("a dist directory that does not exist at all is not ok", () => {
  const report = shellBundleReport(join(tmpdir(), "definitely-not-a-dist-dir-xyz"));
  expect(report.ok).toBe(false);
  expect(Object.values(report.files).every((f) => f === null)).toBe(true);
});

test("the report publishes no filesystem path", () => {
  // /health is unauthenticated. Same rule that keeps the RPC URL and the validator
  // address off it: whether the bundle is there is operational truth, where it lives is
  // detail about the box.
  const dir = fakeDist({ "app-shell.js": 10, "parent-shell.js": 20 });
  expect(JSON.stringify(shellBundleReport(dir))).not.toContain(dir);
});
