// Minimal ambient types for util.js so src/fmt-nim-whole.test.ts and
// src/kid-lang-repaint.test.ts type-check without pulling public/ JS into the tsconfig
// compile scope (allowJs stays off). Same pattern and same caveat as timer.d.ts: this
// covers the PURE, testable exports only — the number formatters and the screen
// discriminator. util.js also exports app state, DOM helpers and sheet plumbing that no
// TypeScript file imports; add them here if one ever does. That file is the
// implementation of record.

/** Luna per NIM. */
export const LUNA: number;

/** The one mutable state bag the whole kid app renders from. Only the fields a
 *  TypeScript test drives are named here; util.js holds the full set. */
export interface KidAppState {
  child: { id: string; label: string; emoji: string } | null;
  /** GET /kids/:id/staking, verbatim. */
  staking: {
    stakedLuna: number;
    pendingLuna: number;
    pendingStakeLuna: number;
    estApyPct: number;
    rewardsEarnedLuna: number;
    minStakeLuna: number;
    available: boolean;
  } | null;
  /** GET /kids/:id/wallet, verbatim. */
  wallet: {
    balanceLuna: number;
    events: { kind: string; status: string; valueLuna: number; availableAt: number | null }[];
  } | null;
  rates: { nimUsd: number };
  skewMs: number;
}
export const state: KidAppState;

/** Plain NIM amount, up to 2 decimals, trailing zeros trimmed. */
export function fmtNim(luna: number): string;

/** Wallet-style NIM amount: U+202F digit grouping above four integer digits, up to
 *  `maxDecimals` decimals, trailing zeros trimmed. */
export function fmtNimLuna(luna: number, maxDecimals?: number): string;

/** A reward, as whole coins — except an amount that would round to zero, which is
 *  shown as the fraction it really is rather than as "0". */
export function fmtNimWhole(luna: number): string;

/** Which kid-app screen is painted, from the classes it carries. Order-sensitive by
 *  design: a screen that borrows another's composition must be tested first. See the
 *  JSDoc in util.js. */
export function currentScreen(
  has: (cls: string) => boolean,
): "chart" | "money" | "roster" | "pairing" | null;

/** Pixels of the layout viewport covered from the bottom by the iOS software keyboard,
 *  derived from the visual viewport. 0 when there is nothing to ask. See util.js. */
export function keyboardInset(w: {
  innerHeight: number;
  viewport?: { height: number; offsetTop?: number } | null;
}): number;

/**
 * A row's title, translated when WE named it and verbatim when a parent did.
 * Pure apart from `t()`, which reads the shell off `window` — the tests stub a
 * shell rather than a DOM, same as `currentScreen` above takes its input.
 */
export function rowTitle(row: {
  title?: string;
  titleKey?: string | null;
  title_key?: string | null;
} | null | undefined): string;
