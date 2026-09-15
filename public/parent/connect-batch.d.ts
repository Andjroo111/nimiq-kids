// Minimal ambient types for connect-batch.js so src/parent-connect-batch.test.ts type-checks
// without pulling public/ JS into the tsconfig compile scope (allowJs stays off). Keep in sync
// with the JSDoc in connect-batch.js — that file is the implementation of record.

/** One child in the batch and the derivation path their address will be asked for on. */
export interface ConnectBatchEntry {
  childId: string;
  label: string;
  keyPath: string;
}

/** What `POST /api/family/connect-addresses` takes, one per child. */
export interface ConnectAssignment {
  childId: string;
  keyPath: string;
  address: string;
  publicKeyHex: string;
  signatureHex: string;
}

export type ConnectBuild =
  | { ok: true; assignments: ConnectAssignment[] }
  | { ok: false; error: "signature_count"; want: number; got: number }
  | { ok: false; error: "signature_repeat" | "signature_missing"; childId: string };

/** A sentence to say, as an i18n key plus its interpolation parameters. */
export interface ConnectRefusalText {
  key: string;
  params: Record<string, string | number>;
}

/** Nimiq's standard account path at `slot`. Slot 0 is the family wallet on most households
 *  and is never planned for a kid. */
export function kidKeyPath(slot: number): string;

/** May this instance offer a parent their kids' keys at all? True only under parent custody,
 *  where the server holds no key; false under server custody, where moving a kid off the
 *  derived address takes their spending away and nothing gives it back. */
export function offersParentCustody(
  custody: { kidCustody?: string | null } | null | undefined,
): boolean;

/** Which kids are still waiting, and on which path. A registered kid is skipped but still
 *  spends their roster slot. */
export function planConnectBatch(
  children: ReadonlyArray<{ id?: string; label?: string; addressSource?: string | null } | null | undefined> | null | undefined,
): ConnectBatchEntry[];

/** Map the wallet's signatures onto the planned children BY ORDER, or refuse. */
export function assignmentsFrom(
  entries: ReadonlyArray<ConnectBatchEntry>,
  signatures: unknown,
): ConnectBuild;

/** Why the batch did not go through, in a form a caller can hand to `t()`. */
export function connectRefusal(
  data: unknown,
  opts?: { nameOf?: (childId: string) => string; nim?: (luna: number) => string },
): ConnectRefusalText;
