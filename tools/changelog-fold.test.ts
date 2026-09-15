// The fold bot decides what version number ships, and #120 makes the deploy probe assert
// that number against the running instance. A wrong bump here therefore does not produce a
// cosmetic changelog error, it produces a deploy that reports success against the previous
// build. So the arithmetic and the merge are pinned.

import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error - plain ESM sibling, and tools/ is outside the tsc program on purpose
import { bumpVersion, strongerBump, parseFragment, renderSection, insertSection, fragmentFiles, fold } from "./changelog-fold.mjs";

test("bumpVersion moves one field and zeroes the ones below it", () => {
  expect(bumpVersion("0.99.10", "patch")).toBe("0.99.11");
  expect(bumpVersion("0.99.10", "minor")).toBe("0.100.0");
  expect(bumpVersion("0.99.10", "major")).toBe("1.0.0");
});

test("bumpVersion refuses a version it cannot parse rather than guessing", () => {
  // A pre-release or a `v` prefix would otherwise silently produce NaN and write
  // "NaN.NaN.NaN" into package.json, which boots and reports itself on /health.
  expect(() => bumpVersion("1.0.0-rc1", "patch")).toThrow();
  expect(() => bumpVersion("v1.0.0", "patch")).toThrow();
});

test("the strongest bump across fragments wins", () => {
  expect(["patch", "minor", "patch"].reduce(strongerBump, "patch")).toBe("minor");
  expect(["patch", "minor", "major"].reduce(strongerBump, "patch")).toBe("major");
  expect(["patch", "patch"].reduce(strongerBump, "patch")).toBe("patch");
});

test("a bump directive is an instruction, not changelog prose", () => {
  const { sections, bump } = parseFragment("<!-- bump: minor -->\n### Added\n- a thing\n");
  expect(bump).toBe("minor");
  expect(sections.get("Added")).toEqual(["- a thing"]);
  // The directive must not survive into the released changelog.
  expect(renderSection("1.0.0", "2026-01-01", [{ sections }])).not.toContain("bump:");
});

test("a fragment with no heading is kept, not dropped", () => {
  const { sections } = parseFragment("- an entry nobody gave a heading\n");
  expect(sections.get("Changed")).toEqual(["- an entry nobody gave a heading"]);
});

test("two fragments writing the same heading produce one heading", () => {
  const a = parseFragment("### Fixed\n- first\n");
  const b = parseFragment("### Fixed\n- second\n");
  const out = renderSection("0.1.0", "2026-01-01", [a, b]);
  expect(out.match(/^### Fixed$/gm)?.length).toBe(1);
  expect(out).toContain("- first");
  expect(out).toContain("- second");
});

test("headings render in release order, whatever order the fragments arrived in", () => {
  const out = renderSection("0.1.0", "2026-01-01", [
    parseFragment("### Fixed\n- f\n"),
    parseFragment("### Added\n- a\n"),
  ]);
  expect(out.indexOf("### Added")).toBeLessThan(out.indexOf("### Fixed"));
});

test("an unknown heading is kept verbatim rather than discarded", () => {
  const out = renderSection("0.1.0", "2026-01-01", [parseFragment("### Ops\n- moved a plist\n")]);
  expect(out).toContain("### Ops");
  expect(out).toContain("- moved a plist");
});

test("the new release lands above the newest existing one, not inside the preamble", () => {
  const existing = "# Changelog\n\nAll notable changes.\n\n## [0.9.0] - 2026-01-01\n### Added\n- old\n";
  const out = insertSection(existing, "## [0.9.1] - 2026-01-02\n### Fixed\n- new");
  expect(out.indexOf("## [0.9.1]")).toBeLessThan(out.indexOf("## [0.9.0]"));
  expect(out.indexOf("All notable changes.")).toBeLessThan(out.indexOf("## [0.9.1]"));
});

/** A checkout with the two files the fold rewrites, plus whatever fragments are asked for. */
function scratchRepo(fragments: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "fold-"));
  writeFileSync(join(root, "package.json"), '{\n  "name": "x",\n  "version": "0.99.10"\n}\n');
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## [0.99.10] - 2026-08-02\n### Added\n- old\n");
  for (const [path, body] of Object.entries(fragments)) {
    const full = join(root, "changelog.d", path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

test("fold finds a fragment nested under a slashed branch name", () => {
  // The protocol is changelog.d/<branch-name>.md and branch names contain slashes, so the
  // fragment for `feat/kid-balance` is a file one directory down. A flat scan finds nothing
  // and reports success, which loses the entry with no error anywhere.
  const root = scratchRepo({ "feat/kid-balance.md": "### Added\n- balance\n" });
  expect(fragmentFiles(join(root, "changelog.d")).length).toBe(1);
  expect(fold(root, "2026-08-03")!.version).toBe("0.99.11");
});

test("fold does nothing at all when there are no fragments", () => {
  expect(fold(scratchRepo({}), "2026-08-03")).toBeNull();
});

test("README.md in changelog.d is documentation, not a release note", () => {
  const root = scratchRepo({ "README.md": "### Added\n- how to use this directory\n" });
  expect(fold(root, "2026-08-03")).toBeNull();
});

test("write() bumps package.json, prepends the section, and clears the fragments", () => {
  const root = scratchRepo({
    "a.md": "### Fixed\n- one\n",
    "feat/b.md": "<!-- bump: minor -->\n### Added\n- two\n",
  });
  const result = fold(root, "2026-08-03")!;
  expect(result.version).toBe("0.100.0");   // the minor fragment wins
  result.write();

  const pkg = readFileSync(join(root, "package.json"), "utf8");
  expect(JSON.parse(pkg).version).toBe("0.100.0");
  // Rewritten by substitution, so the surrounding formatting is byte-identical.
  expect(pkg).toContain('  "name": "x",\n');

  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  expect(changelog.indexOf("## [0.100.0] - 2026-08-03")).toBeLessThan(changelog.indexOf("## [0.99.10]"));
  expect(changelog).toContain("- one");
  expect(changelog).toContain("- two");

  expect(existsSync(join(root, "changelog.d", "a.md"))).toBe(false);
  expect(existsSync(join(root, "changelog.d", "feat", "b.md"))).toBe(false);
});
