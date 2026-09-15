// Minimal ambient types for stale.js so src/stale-approval.test.ts type-checks without pulling
// public/ JS into the tsconfig compile scope (allowJs stays off). Same pattern as
// onboard-gate.d.ts. Keep in sync with stale.js — that file is the implementation of record.

/** As much of a pending approval as the staleness rule reads. */
export interface PendingApproval {
  id?: string;
  createdAt?: number;
  child?: { label?: string } | null;
}

/** How long a grown-up has before the queue starts saying so. Three days. */
export const STALE_APPROVAL_MS: number;

/** Has this approval been waiting long enough to start saying so? A missing or junk
 *  timestamp is never stale, so one bad row cannot redden the whole queue. */
export function approvalIsStale(createdAt: number | undefined, now?: number): boolean;

/** The oldest stale approval in a queue, or null when none of them is. */
export function oldestStaleApproval(
  pending: PendingApproval[] | undefined, now?: number,
): PendingApproval | null;

/** Whole days this approval has been waiting. A duration, not a relative phrase. */
export function approvalWaitingDays(createdAt: number, now?: number): number;
