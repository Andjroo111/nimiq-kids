// Fold changelog.d/*.md fragments into CHANGELOG.md and bump package.json.
//
// WHY THIS EXISTS. Three sessions work this repo in parallel. Every one of them used to edit
// `package.json` version and `CHANGELOG.md` directly, and every one of them collided there:
// the 2026-08-02 handoff records two PRs colliding on exactly those two files in one evening,
// and the fix each time was a rebase that had nothing to do with the change being shipped.
// Those are the only two files in the tree that EVERY pull request touches, so they are the
// only two that are guaranteed to conflict.
//
// A PR now writes `changelog.d/<branch-name>.md` instead — a path no other branch can be
// using, because a branch name is unique — and this script folds the fragments in on `main`,
// once, where there is nobody to race.
//
// Exported as functions so `changelog-fold.test.ts` can exercise the version arithmetic and
// the section merge without a git repo. The CLI at the bottom is the thin part.

import { readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Headings we know how to order. Anything else is appended in first-seen order, so an
 *  unfamiliar heading is kept verbatim rather than dropped on the floor. */
const KNOWN_HEADINGS = ["Added", "Changed", "Fixed", "Removed", "Security", "Deprecated"];

/** A fragment with no `###` heading at all lands here. Deliberately the vaguest of the
 *  known headings: guessing "Fixed" for prose that never said so is worse than vague. */
const DEFAULT_HEADING = "Changed";

/**
 * Every `.md` under `dir`, recursively, EXCEPT `README.md`.
 *
 * Recursive because the protocol is `changelog.d/<branch-name>.md` and a branch name
 * contains slashes (`feat/kid-balance` -> `changelog.d/feat/kid-balance.md`). A flat
 * readdir finds the directory `feat` and none of the fragments inside it, which fails
 * SILENTLY: the fold reports nothing to do and the entry never ships.
 *
 * Returned sorted by path so the output is identical whatever order the filesystem
 * hands them back in — otherwise the same inputs produce a different CHANGELOG on
 * macOS and on the runner, and a diff review cannot tell that from a real change.
 */
export function fragmentFiles(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return []; }  // no changelog.d yet
  const out = [];
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { out.push(...fragmentFiles(full)); continue; }
    if (!name.endsWith(".md")) continue;
    if (name === "README.md") continue;
    out.push(full);
  }
  return out.sort();
}

/**
 * Split one fragment into `{ heading: [lines] }`.
 *
 * `<!-- bump: minor -->` (or `major`/`patch`) anywhere in a fragment is stripped from the
 * body and reported separately — it is an instruction to this script, not changelog prose.
 */
export function parseFragment(text) {
  const sections = new Map();
  let bump = "patch";
  let heading = null;
  for (const raw of text.split("\n")) {
    const bumpMatch = raw.match(/^\s*<!--\s*bump:\s*(major|minor|patch)\s*-->\s*$/i);
    if (bumpMatch) { bump = bumpMatch[1].toLowerCase(); continue; }
    // `## [x.y.z]` is a version heading — a fragment must never carry one, so if someone
    // pastes a whole release block in, drop the heading and keep the content.
    if (/^##\s/.test(raw) && !/^###\s/.test(raw)) continue;
    const h = raw.match(/^###\s+(.+?)\s*$/);
    if (h) { heading = h[1]; if (!sections.has(heading)) sections.set(heading, []); continue; }
    if (heading === null) {
      if (raw.trim() === "") continue;               // leading blank lines are not content
      heading = DEFAULT_HEADING;
      if (!sections.has(heading)) sections.set(heading, []);
    }
    sections.get(heading).push(raw);
  }
  // Trim trailing blank lines per section so joining fragments cannot stack empty lines.
  for (const [k, lines] of sections) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    if (lines.length === 0) sections.delete(k);
  }
  return { sections, bump };
}

/** patch < minor < major. Two fragments asking for different bumps get the larger one:
 *  a release that contains a feature is a minor release even if it also fixes a typo. */
export function strongerBump(a, b) {
  const rank = { patch: 0, minor: 1, major: 2 };
  return rank[b] > rank[a] ? b : a;
}

export function bumpVersion(version, level) {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`version "${version}" is not x.y.z — refusing to guess`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Merge parsed fragments into one release body, `### Heading` blocks in KNOWN_HEADINGS
 *  order. Two fragments that both wrote `### Fixed` produce ONE `### Fixed`. */
export function renderSection(version, date, parsed) {
  const merged = new Map();
  for (const { sections } of parsed) {
    for (const [heading, lines] of sections) {
      if (!merged.has(heading)) merged.set(heading, []);
      merged.get(heading).push(...lines);
    }
  }
  const order = [
    ...KNOWN_HEADINGS.filter((h) => merged.has(h)),
    ...[...merged.keys()].filter((h) => !KNOWN_HEADINGS.includes(h)),
  ];
  const parts = [`## [${version}] - ${date}`];
  for (const heading of order) parts.push(`### ${heading}`, ...merged.get(heading));
  return parts.join("\n");
}

/**
 * Put the new release directly above the newest existing one.
 *
 * Anchored on the first `## [` line rather than on a line count, because the preamble has
 * been edited before and an offset would have silently buried the newest release inside it.
 */
export function insertSection(changelog, section) {
  const lines = changelog.split("\n");
  const at = lines.findIndex((l) => /^##\s+\[/.test(l));
  if (at === -1) return `${changelog.replace(/\n*$/, "")}\n\n${section}\n`;
  return [...lines.slice(0, at), section, "", ...lines.slice(at)].join("\n");
}

/** The whole fold as one pure-ish step over a checkout. Returns null when there is
 *  nothing to do, so the caller can exit 0 without committing an empty change. */
export function fold(root, today) {
  const files = fragmentFiles(join(root, "changelog.d"));
  if (files.length === 0) return null;

  const parsed = files.map((f) => parseFragment(readFileSync(f, "utf8")));
  const bump = parsed.map((p) => p.bump).reduce(strongerBump, "patch");

  const pkgPath = join(root, "package.json");
  const pkgRaw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(pkgRaw);
  const version = bumpVersion(pkg.version, bump);

  // Rewrite the version by TEXT SUBSTITUTION on the first "version" line, not by
  // JSON.stringify of the parsed object: re-serializing reorders nothing but does
  // reformat, and a package.json that reflows on every release makes every future
  // dependency diff unreadable.
  const nextPkg = pkgRaw.replace(
    /("version"\s*:\s*")[^"]+(")/,
    (_, a, b) => `${a}${version}${b}`,
  );
  if (nextPkg === pkgRaw) throw new Error("package.json version line not found");

  const changelogPath = join(root, "CHANGELOG.md");
  const changelog = insertSection(
    readFileSync(changelogPath, "utf8"),
    renderSection(version, today, parsed),
  );

  return {
    version,
    bump,
    fragments: files.map((f) => relative(root, f).split(sep).join("/")),
    write() {
      writeFileSync(pkgPath, nextPkg);
      writeFileSync(changelogPath, changelog);
      for (const f of files) rmSync(f);
    },
  };
}

// --- CLI -------------------------------------------------------------------------------
// Guarded so the test file can import the functions above without the fold running.
if (process.argv[1] && process.argv[1].endsWith("changelog-fold.mjs")) {
  const dryRun = process.argv.includes("--dry-run");
  const root = process.cwd();
  // UTC, and passed in rather than read inside fold(), so the test is not a clock test.
  const today = new Date().toISOString().slice(0, 10);
  const result = fold(root, today);
  if (!result) {
    console.log("changelog-fold: no fragments in changelog.d, nothing to do");
    process.exit(0);
  }
  console.log(`changelog-fold: ${result.bump} bump -> ${result.version}`);
  for (const f of result.fragments) console.log(`  folded ${f}`);
  if (dryRun) { console.log("changelog-fold: --dry-run, wrote nothing"); process.exit(0); }
  result.write();
  // The workflow reads these to decide whether to commit and what to call the commit.
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `folded=true\nversion=${result.version}\n`, { flag: "a" });
  }
}
