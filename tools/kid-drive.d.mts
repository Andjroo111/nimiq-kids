// Ambient types for kid-drive.mjs so src/kid-drive-guard.test.ts type-checks without pulling
// tools/ JS into the compile scope (allowJs stays off, same arrangement as
// public/parent/connect-batch.d.ts). Only the pure half is declared: the Playwright half
// takes a BrowserContext this repo has no types for, and does not need any.

/** `showChart`'s own root element. Its presence IS the board. */
export const BOARD_SELECTOR: string;

/** Null when the drive reached the board with nothing thrown; the sentence to throw when
 *  it did not. */
export function arrivalFailure(input: {
  hasBoard: boolean;
  bodyText?: string;
  pageErrors?: readonly string[];
}): string | null;
