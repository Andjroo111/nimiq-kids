// Retry-with-backoff for chain READS, as a pure function of its inputs so the policy can be
// exercised without a node, a clock or a network.
//
// WHY THIS IS AT THE CLIENT LAYER AND NOT IN ONE CALLER. The public Nimiq RPC
// (`rpc.testnet.nimiqwatch.com`) rate-limits, and the failure is quiet and DIRECTIONAL: a
// rate-limited read looks like an unreachable or empty account, so a screen built on one does
// not show an error, it shows a smaller number. Measured on the live testnet demo
// (2026-08-04): 22 × `getAccountByAddress: HTTP 429` in one log, `GET /api/kids/:id/wallet`
// answering 500, and the kid's Treasure Box rendering **0 NIM** for a child holding 42,000 —
// so every shelf read as unaffordable and nothing could be bought.
//
// `src/demo-reclaim.ts` already carried this exact loop, for exactly this reason, but only the
// hourly reclaim sweep was protected. Every screen read went bare. Promoting it to
// `getClient()` is what makes the rule true everywhere instead of in one job.
//
// ⚠️ READS ONLY, AND THAT IS NOT A STYLE CHOICE. A broadcast that throws may still have been
// accepted, so an automatic retry of a send is a possible DOUBLE SPEND. `sendTransaction` is
// deliberately left bare in getClient(); the next cycle re-reads the balance and decides from
// the chain, which is the only safe way to learn what really happened. See
// [rpc rate-limit rules] and the same note in demo-reclaim.ts.
//
// ⚠️ NO CACHING HERE, EITHER. Several callers prove a money movement BY re-reading a balance
// (`scripts/mainnet-selftest.ts` waits for a Cashlink to fund, `sweep-hot-wallet.ts` and
// `reclaim-demo.ts` check what actually moved). A cached balance would make those read their
// own stale answer and conclude a transfer had not landed. Retrying is safe for every caller;
// caching is not safe for any of them without knowing which one is asking.

/** Attempts, including the first. 4 attempts = up to 3 backoffs = ~2.8s of waiting. */
export const DEFAULT_ATTEMPTS = 4;
/** First backoff; each subsequent one doubles (400 / 800 / 1600 ms). */
export const DEFAULT_BASE_MS = 400;

/**
 * Is this error worth asking again about?
 *
 * The quota is a ROLLING WINDOW, not a per-second cap — a burst of 12 reads can all succeed
 * while a paced 250ms loop immediately after takes four 429s. So pacing alone is not the fix
 * and retrying is not merely a politeness knob; it is the thing that works.
 *
 * Transport failures (abort, timeout, reset) are included because the observed 429 sometimes
 * arrives as a dropped connection rather than a status line. A malformed-request error is NOT
 * retryable and must surface immediately: asking four times cannot fix a bad address.
 */
export function isRetryableRead(err: unknown): boolean {
  const m = String((err as { message?: string })?.message ?? err);
  if (/HTTP 429|HTTP 5\d\d/.test(m)) return true;
  return /abort|timeout|timed out|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket/i.test(m);
}

export interface RetryReadOptions {
  attempts?: number;
  baseMs?: number;
  /** Test seam: swap the clock rather than making the suite wait 2.8 real seconds. */
  sleep?: (ms: number) => Promise<void>;
  /** Called once per retry, for the operator-facing log. */
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run a read, retrying a retryable failure with exponential backoff.
 *
 * The LAST error is rethrown, not the first, so an operator reading a stack trace sees the
 * state the call actually gave up in. A non-retryable error is rethrown immediately with no
 * delay at all — four spaced attempts at an invalid address is 2.8 seconds spent to arrive at
 * the same refusal.
 */
export async function retryRead<T>(fn: () => Promise<T>, opts: RetryReadOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
  const baseMs = opts.baseMs ?? DEFAULT_BASE_MS;
  const sleep = opts.sleep ?? wait;
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryableRead(err) || i === attempts - 1) throw err;
      const delay = baseMs * 2 ** i;
      opts.onRetry?.(i + 1, delay, err);
      await sleep(delay);
    }
  }
  throw last; // unreachable: the loop either returns or throws
}
