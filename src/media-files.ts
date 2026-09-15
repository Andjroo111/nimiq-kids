// Where uploaded media BYTES live, and how they are forgotten.
//
// This is a leaf module on purpose. `mediaDir()` used to live in routes/media.ts, which is
// fine for a route to import and wrong for a repo to: `repo-approvals` now unlinks a proof
// photo the moment an approval is decided, and a repo reaching into routes/ to learn where
// the disk is would invert the layering. The default path is written here ONCE — a second
// copy of `process.env.MEDIA_DIR ?? "data/media"` in another file is a predicate that can
// drift, and routes/media.ts re-exports this one rather than restating it.

import { unlink } from "node:fs/promises";
import { join } from "node:path";

export function mediaDir(): string {
  return process.env.MEDIA_DIR ?? "data/media";
}

/**
 * Best-effort unlink of media files, by path relative to MEDIA_DIR.
 *
 * Best-effort because a file that is already gone must never fail the deletion of the row
 * that named it — the same rule DELETE /api/media/:id and purgeFamily have always followed.
 * Always call this AFTER the row transaction commits: a file unlinked inside a transaction
 * that then rolls back is gone while its row survives, which is worse than an orphan.
 */
export async function unlinkMediaFiles(paths: readonly (string | null | undefined)[]): Promise<void> {
  const dir = mediaDir();
  await Promise.all(paths.filter(Boolean).map((p) => unlink(join(dir, p as string)).catch(() => {})));
}
