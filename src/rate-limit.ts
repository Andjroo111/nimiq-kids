// Tiny in-memory fixed-window counters — the abuse brake, not the real bound (the DB
// caps are that). Per process, reset on restart, which is fine for what it guards.
//
// ONE store, because the buckets have to be shared to be worth anything: onboarding and
// the demo mint kept separate maps, and the two routes that redeem a pair code live in
// different files. A budget an attacker can double by switching endpoints is not a budget.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Count one hit against `key`; false once the window's `max` is spent. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const nowMs = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= nowMs) {
    buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}

/** Is `key` already spent? Reads the bucket without counting against it. */
export function overLimit(key: string, max: number): boolean {
  const b = buckets.get(key);
  return b !== undefined && b.resetAt > Date.now() && b.count >= max;
}

/** Tests only: forget all rate-limit state. */
export function resetRateLimits(): void {
  buckets.clear();
}
