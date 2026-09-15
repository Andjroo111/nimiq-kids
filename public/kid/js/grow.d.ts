// Minimal ambient types for grow.js so src/kid-grow-pending.test.ts type-checks without
// pulling public/ JS into the tsconfig compile scope (allowJs stays off). Keep in sync
// with grow.js — that file is the implementation of record.

/** Paint the Grow screen for `state.child`, refreshing `state.staking` first. */
export function showGrow(): Promise<void>;
