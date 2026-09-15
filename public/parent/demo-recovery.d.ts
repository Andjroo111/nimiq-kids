// Minimal ambient types for demo-recovery.js so src/parent-demo-recovery.test.ts type-checks
// without pulling public/ JS into the tsconfig compile scope (allowJs stays off). Keep in
// sync with the JSDoc in demo-recovery.js — that file is the implementation of record.

/** What to do about a parent session this instance will not accept.
 *   "entrance"   go to DEMO_ENTRANCE; this instance mints households
 *   "signedOut"  render the shipped signed-out screen (family / competition)
 *   "wait"       /health has not answered, so which instance this is is still unknown */
export type DemoRecoveryAction = "entrance" | "signedOut" | "wait";

export const DEMO_ENTRANCE: string;

/** Synchronous by contract, not by accident: returning a promise here is what put the
 *  signed-out screen behind a hung /health. See the note in demo-recovery.js. */
export function demoRecoveryAction(
  demo: boolean | null | undefined,
  bounced: boolean,
): DemoRecoveryAction;
