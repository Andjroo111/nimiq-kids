// The chain-read retry policy (src/nimiq/retry-read.ts).
//
// The bug this holds shut: the public RPC rate-limits, a 429 travelled straight out of
// getClient(), `GET /api/kids/:id/wallet` answered 500, and the kid's Treasure Box rendered
// 0 NIM for a child holding 42,000 — so every shelf read as unaffordable and the demo's whole
// spending half was dead. Measured on the live testnet demo 2026-08-04.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { retryRead, isRetryableRead, DEFAULT_ATTEMPTS } from "./retry-read";

/** No real waiting: the policy is being tested, not setTimeout. */
const noSleep = async () => {};

test("a rate-limited read is retried and its eventual success is returned", async () => {
  let calls = 0;
  const v = await retryRead(async () => {
    calls += 1;
    if (calls < 3) throw new Error("getAccountByAddress: HTTP 429");
    return 42_003;
  }, { sleep: noSleep });
  expect(v).toBe(42_003);
  expect(calls).toBe(3);
});

test("it gives up after the attempt budget and rethrows the LAST error", async () => {
  let calls = 0;
  const err = await retryRead(async () => {
    calls += 1;
    throw new Error(`getAccountByAddress: HTTP 429 (call ${calls})`);
  }, { sleep: noSleep }).catch((e) => e);
  expect(calls).toBe(DEFAULT_ATTEMPTS);
  // The LAST failure, so a stack trace shows the state it actually gave up in.
  expect(String(err.message)).toContain(`call ${DEFAULT_ATTEMPTS}`);
});

test("a NON-retryable error fails immediately, without burning the budget", async () => {
  // Asking four times cannot fix a bad address, and four spaced attempts is 2.8s spent to
  // arrive at the same refusal.
  let calls = 0;
  await retryRead(async () => { calls += 1; throw new Error("getAccountByAddress: invalid address"); },
    { sleep: noSleep }).catch(() => {});
  expect(calls).toBe(1);
});

test("backoff doubles, and the first attempt does not wait at all", async () => {
  const waited: number[] = [];
  await retryRead(async () => { throw new Error("HTTP 429"); },
    { sleep: async (ms) => { waited.push(ms); }, baseMs: 400 }).catch(() => {});
  expect(waited).toEqual([400, 800, 1600]); // 4 attempts = 3 backoffs
});

test("what counts as retryable", () => {
  for (const m of ["getAccountByAddress: HTTP 429", "HTTP 502", "HTTP 503",
                   "The operation was aborted.", "fetch failed", "ECONNRESET"]) {
    expect(isRetryableRead(new Error(m))).toBe(true);
  }
  // A 4xx that is not 429 is the server saying the request is wrong. Retrying is noise.
  for (const m of ["HTTP 400", "HTTP 404", "invalid address", "method not found"]) {
    expect(isRetryableRead(new Error(m))).toBe(false);
  }
});

// ⚠️ THE INVARIANT THIS FILE EXISTS FOR, and it is not the retry.
//
// A broadcast that throws MAY STILL HAVE BEEN ACCEPTED, so an automatic retry of a send is a
// possible double spend. Reads are safe to repeat; sends are not, and the difference is money.
test("getClient retries the two READS and never the send", () => {
  const src = readFileSync(join(import.meta.dir, "client.ts"), "utf8");
  const body = /export async function getClient[\s\S]*?\n\}\n/.exec(src)?.[0] ?? "";
  expect(body).toContain("retryRead(() => sender.getHeadHeight()");
  expect(body).toContain("retryRead(() => sender.getBalance(address)");
  // The send line must be bare. Written as a search for retryRead on the sendRawTransaction
  // line specifically, so wrapping it later fails here rather than in production.
  const sendLine = body.split("\n").find((l) => l.includes("sendRawTransaction")) ?? "";
  expect(sendLine).not.toContain("retryRead");
});

// Caching a balance would be the obvious next "optimisation" and it would break settlement:
// mainnet-selftest waits for a Cashlink to fund, sweep-hot-wallet and reclaim-demo check what
// actually moved. All three prove a movement BY re-reading, and would read their own stale
// answer and conclude nothing had landed.
test("no balance cache crept into the client", () => {
  const src = readFileSync(join(import.meta.dir, "client.ts"), "utf8");
  const body = /export async function getClient[\s\S]*?\n\}\n/.exec(src)?.[0] ?? "";
  expect(body).not.toMatch(/cache|memo|ttl/i);
});
