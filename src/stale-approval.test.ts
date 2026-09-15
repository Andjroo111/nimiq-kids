// A pending approval nobody ruled on (#272).
//
// Andjroo's call: it gets LOUDER, it never pays itself. So there is no state machine to test —
// the row stays pending forever — and the whole rule is this threshold plus "which one do we
// name". Both are pure functions of (createdAt, now), which is why they live in core.js
// instead of inside the two screens that draw them: a threshold written twice is a threshold
// that eventually disagrees with itself.
//
// The clock is passed in, never read, so these assertions cannot go green or red with the
// wall clock.

import { test, expect } from "bun:test";
import { STALE_APPROVAL_MS, approvalIsStale, approvalWaitingDays, oldestStaleApproval } from "../public/parent/stale.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;
const daysAgo = (d: number) => NOW - d * DAY;

test("three days, and the boundary is inclusive", () => {
  expect(STALE_APPROVAL_MS).toBe(3 * DAY);
  expect(approvalIsStale(daysAgo(2.99), NOW)).toBe(false);
  expect(approvalIsStale(daysAgo(3), NOW)).toBe(true);
  expect(approvalIsStale(daysAgo(3.01), NOW)).toBe(true);
});

test("a fresh queue is not stale, and neither is an empty one", () => {
  expect(oldestStaleApproval([], NOW)).toBeNull();
  expect(oldestStaleApproval(undefined, NOW)).toBeNull();
  expect(oldestStaleApproval([{ id: "a", createdAt: daysAgo(1) }], NOW)).toBeNull();
});

test("it names the OLDEST, not the first in the list", () => {
  // The sentence a parent needs is "Sam has been waiting five days", not "3 are late". If this
  // returned the first match the strip would name whichever one the server happened to sort
  // first, which on a busy queue is the newest.
  const oldest = oldestStaleApproval([
    { id: "new", createdAt: daysAgo(3.5) },
    { id: "oldest", createdAt: daysAgo(9) },
    { id: "mid", createdAt: daysAgo(4) },
  ], NOW);
  expect(oldest?.id).toBe("oldest");
});

test("a stale one is found even when fresh ones outnumber it", () => {
  const oldest = oldestStaleApproval([
    { id: "f1", createdAt: daysAgo(0) },
    { id: "f2", createdAt: daysAgo(1) },
    { id: "late", createdAt: daysAgo(5) },
    { id: "f3", createdAt: daysAgo(2) },
  ], NOW);
  expect(oldest?.id).toBe("late");
});

test("a missing or junk timestamp is never stale", () => {
  // A row with no createdAt must not paint the whole queue red on the strength of NaN.
  for (const bad of [undefined, null, NaN, "yesterday"]) {
    expect(approvalIsStale(bad as unknown as number, NOW)).toBe(false);
  }
  expect(oldestStaleApproval([{ id: "x", createdAt: undefined }], NOW)).toBeNull();
});

test("the sub-line counts whole DAYS, because timeAgo would say '4 days ago'", () => {
  // "Sam has been waiting 4 days ago" is not a sentence. It rendered exactly that way before
  // this existed, and only a screenshot caught it — every assertion was green.
  expect(approvalWaitingDays(daysAgo(4), NOW)).toBe(4);
  expect(approvalWaitingDays(daysAgo(3.9), NOW)).toBe(3);   // never claims an unfinished day
  expect(approvalWaitingDays(daysAgo(30), NOW)).toBe(30);
});
