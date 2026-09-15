// What `bun run build:shell` left behind, reported on /health.
//
// `public/dist/*.js` is gitignored and built at boot, so it is the one part of a running
// instance that a merged commit does NOT prove. Every other question about what is live can
// be answered by comparing /health's `v` against main; the bundles cannot, because they are
// not in the commit.
//
// That gap is not theoretical. The boot line used to be `build:shell …; exec server.ts` — a
// semicolon — so a build that failed still execed the server, which happily served the
// PREVIOUS bundle, or none at all on a fresh checkout. The parent app has no i18n fallback,
// so a missing parent-shell.js renders the entire money surface (approvals, top-ups, the
// board) as raw `papp.*` keys, and nothing anywhere said why. The boot line is `&&` now, but
// that only covers the launchd path: an instance started by hand, or one whose build
// predates the checkout it is serving, is still invisible without this.

import { statSync } from "node:fs";
import { join } from "node:path";

/** Both bundles are REQUIRED, not one of two. `app-shell.js` is the kid app and
 *  `parent-shell.js` is the parent app; losing either is a whole app in raw keys. */
export const SHELL_BUNDLES = ["app-shell.js", "parent-shell.js"] as const;

export type BundleFile = { bytes: number; builtAt: string };
export type BundleReport = { ok: boolean; files: Record<string, BundleFile | null> };

/** Resolved off this file, not off `process.cwd()`. The plists set WorkingDirectory to the
 *  checkout so cwd happens to be right in production, but a test runner, a script run from a
 *  subdirectory, or a hand-started process would all report "missing" for bundles that are
 *  sitting there — a false alarm on the one field whose whole job is to be trusted. */
const DIST_DIR = join(import.meta.dir, "..", "public", "dist");

/**
 * `{ ok, files }` — `ok` is false if ANY bundle is missing or unreadable, and that file
 * reads `null` so the answer names which one.
 *
 * Deliberately NOT cached. The question is "is what this process is serving current", and a
 * value computed once at import answers it for the moment of import instead. Two `stat`
 * calls per request is nothing next to being wrong.
 *
 * Size and mtime only. No path — /health is unauthenticated and a filesystem layout is
 * detail about the box, the same rule that keeps the RPC URL and the validator address off
 * this endpoint.
 */
export function shellBundleReport(dir: string = DIST_DIR): BundleReport {
  const files: Record<string, BundleFile | null> = {};
  let ok = true;
  for (const name of SHELL_BUNDLES) {
    try {
      const st = statSync(join(dir, name));
      // A zero-byte bundle is a build that was interrupted mid-write, and it fails exactly
      // like a missing one — the script tag loads, parses to nothing, and the app renders
      // keys. Treat it as absent rather than as a very small success.
      if (st.size === 0) { files[name] = null; ok = false; continue; }
      files[name] = { bytes: st.size, builtAt: st.mtime.toISOString() };
    } catch {
      files[name] = null;
      ok = false;
    }
  }
  return { ok, files };
}
