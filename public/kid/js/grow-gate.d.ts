// Minimal ambient types for grow-gate.js so src/grow-gate.test.ts type-checks without
// pulling public/ JS into the tsconfig compile scope (allowJs stays off). Keep in sync
// with the JSDoc in grow-gate.js — that file is the implementation of record.

/** The wallet read's three fields that decide whether Grow is offered. All optional: an
 *  older server omits `stakingAvailable`, and the gate treats that as available. `address`
 *  distinguishes null (the server saying this kid has none) from absent (an old payload). */
export interface GrowGateWallet {
  stakingAvailable?: boolean;
  stakedLuna?: number;
  address?: string | null;
}

export function showsGrowBanner(wallet?: GrowGateWallet | null): boolean;
