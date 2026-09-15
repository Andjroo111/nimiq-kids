// Minimal ambient types for locked.js so src/kid-locked-screen.test.ts type-checks without
// pulling public/ JS into the tsconfig compile scope (allowJs stays off). Same pattern and
// same caveat as approved.d.ts: this covers the PURE, testable exports only. `showLocked`
// and `startLockWatch` paint and hold an interval, and are pinned against source instead.
// locked.js is the implementation of record.

/** The wrapper's lock state as `bridge.getNativeState()` reports it. `reason` is the
 *  server's `LockResult.reason`; null from a wrapper old enough to predate it. */
export interface NativeLockState {
  mode: "locked" | "unlocked";
  reason: string | null;
  until: number | null;
  remainingSec: number | null;
  allowedApps: string[];
}

/** True when the lock is one a kid cannot lift, and the screen should be taken over.
 *  False for LOCKED_ROUTINE, which the chart is the way out of, and false for anything
 *  falsy — a plain browser has no wrapper and must be left alone. */
export function isLockedOut(lock?: NativeLockState | null): boolean;

/** The countdown, in the two units a kid reads. Seconds only under a minute; never
 *  negative. */
export function countdownText(msLeft: number): string;

/** Paint the lock screen for the wrapper's current state. False when it does not apply. */
export function showLocked(): boolean;

/** Stop the one-second countdown repaint. */
export function stopLockedTick(): void;
export const PEEK_MS: number;
export function startPeek(nowMs?: number): void;
export function extendPeek(nowMs?: number): void;
export function endPeek(): void;
export function peeking(nowMs?: number): boolean;
export function lockTitleKey(lock?: NativeLockState | null): string | null;
export function lockBanner(lock?: NativeLockState | null): string;
export function wireLockBanner(): void;

/** Watch the wrapper and take the screen over from ANY screen when a lock lands.
 *  `onRelease` paints whatever should follow when the lock lifts. */
export function startLockWatch(onRelease: () => void): void;
