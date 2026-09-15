// Minimal ambient types for token-capture.js so src/parent-token-capture.test.ts type-checks
// without pulling public/ JS into the tsconfig compile scope (allowJs stays off). Keep in sync
// with the JSDoc in token-capture.js — that file is the implementation of record.

/** The decision for one magic-link hash capture. `commit` is a token safe to write now;
 *  `pendingSwitch` is an incoming token that would REPLACE an existing session and must be
 *  confirmed first; `approval` is a captured deep-link id; `wipe` says to scrub the fragment. */
export interface TokenCaptureDecision {
  commit: string | null;
  pendingSwitch: string | null;
  approval: string | null;
  wipe: boolean;
}

export function decideTokenCapture(hash: string | null | undefined, currentToken: string | null): TokenCaptureDecision;
