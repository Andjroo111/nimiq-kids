// Minimal ambient types for data.js so src/kid-grow-pending.test.ts type-checks without
// pulling public/ JS into the tsconfig compile scope (allowJs stays off). Covers the two
// refreshers a TypeScript test drives; add the rest here if one ever imports them.
// data.js is the implementation of record.

/** GET /kids/:id/wallet -> state.wallet. Leaves the last good wallet in place on failure. */
export function refreshWallet(): Promise<void>;

/** GET /kids/:id/staking -> state.staking (the Grow screen's whole truth). */
export function refreshStaking(): Promise<void>;
