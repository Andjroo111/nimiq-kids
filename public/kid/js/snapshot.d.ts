// Minimal ambient types for snapshot.js (see grow-gate.d.ts for the arrangement).

export function saveSnapshot(name: string, payload: unknown): number;
export function readSnapshot(name: string): unknown;
export function snapshotAt(name: string): number | null;
export function forgetChild(childId: string): void;

/** True when the board's own `today` is not the device's local day. */
export function isStaleDay(chartToday: string | null | undefined, now?: Date): boolean;
