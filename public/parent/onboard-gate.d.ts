// Minimal ambient types for onboard-gate.js so src/onboard-wallet-step.test.ts type-checks
// without pulling public/ JS into the tsconfig compile scope (allowJs stays off). Keep in
// sync with the JSDoc in onboard-gate.js — that file is the implementation of record.

/** The `custody` block /health publishes, as much of it as this screen reads. */
export interface CustodyView {
  kidCustody?: string;
}

/** Which wallet block the first-run screen draws. "optional" is the only one that claims
 *  the wallet can wait, and it must never be reachable under parent custody. */
export type WalletBlock = "connected" | "required" | "optional";

export function walletRequired(custody: CustodyView | null | undefined): boolean;
export function walletBlock(
  custody: CustodyView | null | undefined,
  address: string | null | undefined,
): WalletBlock;
export function walletBlocksCreate(
  custody: CustodyView | null | undefined,
  address: string | null | undefined,
): boolean;
export function onboardErrorKey(data: { error?: string } | null | undefined): string;
