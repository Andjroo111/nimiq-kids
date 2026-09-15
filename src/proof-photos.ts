// Proof photos expire. This is the backstop that makes that true even when nobody decides.
//
// A "show your work" photo is the one picture of a child this server still keeps (sticker
// photos moved to the tablet's own IndexedDB in #282). Its purpose ends when the parent
// decides the approval, and `decideApproval` deletes it there — that is the primary path and
// it is immediate. This file covers the approval nobody ever actions: after 24 hours the
// photo goes anyway.
//
// LAZY, NOT CRON. The sweep runs at the top of the approvals read path and on every upload,
// per GatePass (nimiq-recon C1-192, `nimiq.sale#101`): a launchd job can die quietly and
// nothing on any screen would say so, whereas a sweep that rides the read path is exercised
// by ordinary use. The accepted cost is that a photo attached to an approval nobody opens
// can outlive its TTL until the next read or upload anywhere on the instance.

import * as media from "./repo-media";
import { unlinkMediaFiles } from "./media-files";

/** 24h. Overridable for tests and for an operator who wants a shorter leash. */
export const PROOF_TTL_MS = Number(process.env.HATCH_PROOF_TTL_MS ?? 24 * 60 * 60 * 1000);

/**
 * Delete every proof photo past its TTL. Returns how many went.
 *
 * Instance-wide rather than family-scoped, deliberately: it deletes nothing but expired
 * photos and returns no data, so there is no tenancy question, and any household's read
 * cleans up after a household that has stopped visiting — which is exactly the case a
 * family-scoped sweep would never reach.
 */
export async function sweepExpiredProofs(now = Date.now()): Promise<number> {
  const stale = media.expiredProofs(now - PROOF_TTL_MS);
  if (!stale.length) return 0;
  for (const row of stale) media.deleteMedia(row.id); // clears the approvals FK with it
  await unlinkMediaFiles(stale.map((r) => r.path)); // bytes after the rows, never inside
  return stale.length;
}
