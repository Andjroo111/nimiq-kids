// nimiq.kids parent — WHEN A PENDING APPROVAL HAS WAITED TOO LONG (#272).
//
// Its own module, and it imports NOTHING. core.js pulls in icons.js, which imports
// `/js/lib/box-glyphs.js` — a browser-absolute path a test runner cannot resolve — so a rule
// living there can only be tested by reading core.js as source TEXT, which is what the two
// existing parent-side tests do. A regex over source cannot tell you that the boundary is
// inclusive or that the oldest row wins; it can only tell you somebody typed the words. With
// no imports, src/stale-approval.test.ts exercises the real functions.

/* ---- A PENDING APPROVAL THAT NOBODY RULED ON (#272) --------------------------------------
   Andjroo's call: it gets LOUDER. It never pays itself.

   Auto-approving after a timeout was rejected, and the reason is the whole product: no money
   moves in this app without a grown-up saying yes, and an expiry that pays out is that promise
   with a timer bolted on. The other direction is no better — expiring to a rejection would
   take away work the kid really did, and reject already means "try again", which nobody asked
   for on their behalf.

   So nothing about the row's STATE changes. A stale approval stays pending forever. The only
   thing that changes is how loudly the queue says so, which is the actual gap: today a kid can
   do the job, see "Waiting for a grown-up" on their tablet, and have that be the end of the
   story with nothing anywhere surfacing it.

   THREE DAYS. Two would fire over an ordinary busy weekend, which trains a parent to ignore
   the colour — the failure mode that makes a nag worthless. A week is long enough that the kid
   has stopped expecting it. Three clears a weekend and still lands while the job is remembered.

   Pure functions of (createdAt, now): the clock is passed in, never read, so the tests cannot
   go green or red with the wall clock. One home rather than one per screen, because a
   threshold written twice is a threshold that eventually disagrees with itself. */
export const STALE_APPROVAL_MS = 3 * 24 * 60 * 60 * 1000;

/** Has this approval been waiting long enough to start saying so? */
export function approvalIsStale(createdAt, now = Date.now()) {
  return Number.isFinite(createdAt) && now - createdAt >= STALE_APPROVAL_MS;
}

/** The oldest stale approval in a queue, or null when none of them is. The OLDEST rather than
 *  the count, because the sentence a parent needs is "this one has been sitting for five
 *  days", not "three of these are late". */
export function oldestStaleApproval(pending, now = Date.now()) {
  const stale = (pending ?? []).filter((a) => approvalIsStale(a.createdAt, now));
  if (!stale.length) return null;
  return stale.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
}

/** Whole days this approval has been waiting. A DURATION, not a relative phrase: `timeAgo`
 *  returns "4 days ago", and "has been waiting 4 days ago" is not a sentence. Floored, so it
 *  never claims a day that has not finished. Only ever called on a row already known stale,
 *  so it is always 3 or more and no singular case exists. */
export function approvalWaitingDays(createdAt, now = Date.now()) {
  return Math.floor((now - createdAt) / (24 * 60 * 60 * 1000));
}
