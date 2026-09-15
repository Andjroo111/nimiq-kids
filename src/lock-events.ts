// Tiny in-process pub/sub for kiosk lock-state changes. Mutation points (approval
// decide, task done/skip, run submit, override set/clear, allowlist change) call
// publishLockChange(); each SSE subscriber then re-computes its device's state and
// pushes it down the stream. Single-process by design — matches the family-server
// deployment (one Bun process, one SQLite file).

type Listener = () => void;

const listeners = new Set<Listener>();

/** Register a listener; returns its unsubscribe function. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Something that can affect a kiosk lock state changed — wake every subscriber. */
export function publishLockChange(): void {
  for (const fn of [...listeners]) {
    try { fn(); } catch { /* a broken subscriber must never break the mutation */ }
  }
}

/** Test seam. */
export function subscriberCount(): number {
  return listeners.size;
}
