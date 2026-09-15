// GET /health, and specifically the `demo` flag the kid app boots against (#12).
//
// The kid app cannot tell a seeded DEMO instance from a family/competition instance on
// its own, and the difference decides what an unpaired boot should do: on the demo there
// is no parent app and no 6-digit code to mint, so the pairing screen is a dead end,
// while on the other instances it is exactly the right screen. /health already answers
// the first call boot makes, so the flag rides along at no cost.
//
// This is also the first test /health has ever had, which is why it moved out of
// server.ts: that file opens the DB and primes a chain snapshot at import, so the one
// endpoint every runbook here says to trust could not be exercised.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import { healthRoutes } from "./routes/health";

const app = new Hono().route("/", healthRoutes);
const health = async () => (await app.request("http://hatch.test/health")).json();

const ENV_KEYS = ["HATCH_DEMO_ENABLED", "HATCH_DEMO_SEED"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  initTestDb();
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBefore[k] === undefined) delete process.env[k];
    else process.env[k] = envBefore[k];
  }
});

test("a plain instance reports demo:false, so /kid/ still offers device pairing", () => {
  return health().then((b: Record<string, unknown>) => {
    expect(b.ok).toBe(true);
    expect(b.demo).toBe(false);
  });
});

test("HATCH_DEMO_ENABLED=1 reports demo:true", async () => {
  process.env.HATCH_DEMO_ENABLED = "1";
  expect((await health()).demo).toBe(true);
});

test("the legacy HATCH_DEMO_SEED=1 reports demo:true too", async () => {
  // Both names are accepted on purpose (see demoSeedEnabled): the live env files are
  // edited separately from a deploy, so requiring them to change together would mean a
  // flag day where whichever landed second switched the judge demo off.
  process.env.HATCH_DEMO_SEED = "1";
  expect((await health()).demo).toBe(true);
});

test("the flag is read per request, not frozen at import", async () => {
  expect((await health()).demo).toBe(false);
  process.env.HATCH_DEMO_ENABLED = "1";
  expect((await health()).demo).toBe(true);
  delete process.env.HATCH_DEMO_ENABLED;
  expect((await health()).demo).toBe(false);
});

test("`demo` is not custody.demoUnlocked — an instance can be one without the other", async () => {
  // Two different questions: `demo` is "does this box hand out seeded households",
  // custody.demoUnlocked is "are approvals enforced". Conflating them would send a
  // competition visitor to a /demo that does not exist there.
  const b = await health() as { demo: boolean; custody: { demoUnlocked: boolean } };
  expect(b.demo).toBe(false);
  expect(typeof b.custody.demoUnlocked).toBe("boolean");
});

test("still answers the liveness questions a deploy check reads", async () => {
  const b = await health() as Record<string, unknown>;
  // The runbooks compare `v` against package.json on main to decide what is live, so a
  // refactor that drops or stales any of these breaks the deploy story silently.
  expect(b.app).toBe("nimiq.kids");
  expect(b.v).toBe((await import("../package.json")).default.version);
  expect(typeof b.network).toBe("string");
  expect(typeof b.sim).toBe("boolean");
  expect(typeof b.explorerTx).toBe("string");
});

test("nothing about the chain endpoint is published", async () => {
  // /health is unauthenticated and an RPC URL can carry credentials in its userinfo or
  // path. This has always been deliberate; now it is enforced.
  const raw = JSON.stringify(await health());
  expect(raw).not.toMatch(/rpc/i);
  expect(raw).not.toMatch(/https?:\/\/[^"]*@/); // no basic-auth userinfo anywhere
});

// ---- `staking.available`: can this instance stake at all? ----
//
// Grow was dark on the live mainnet instance from the day it shipped, because
// HATCH_VALIDATOR_ADDRESS was never set there and nothing surfaced it. A kid found out by
// opening Grow and getting `staking_unavailable` back. /health is where a runbook asks.

test("/health publishes whether staking is possible on this instance", async () => {
  const h = await health() as { staking?: { available?: unknown } };
  expect(typeof h.staking?.available).toBe("boolean");
});

test("the published flag cannot drift from the one the money path enforces", async () => {
  // Asserted against stakingAvailable() itself rather than a literal, because the two
  // deciding differently is the whole failure mode: /health saying yes while stakePrecheck
  // throws staking_unavailable is worse than not publishing it at all.
  const { stakingAvailable } = await import("./wallet/kid-staking");
  const h = await health() as { staking: { available: boolean } };
  expect(h.staking.available).toBe(stakingAvailable());
});

test("/health NEVER publishes the validator address", async () => {
  // Same rule the RPC URL follows: whether this box can stake is operational truth worth
  // exposing; WHICH validator it delegates to is infrastructure detail and stays behind auth.
  process.env.HATCH_VALIDATOR_ADDRESS = "NQ05 U1RF QJNH JCS1 RDQX 4M3Y 60KR K6CN 5LKC";
  const body = JSON.stringify(await health());
  expect(body).not.toContain("NQ05");
  expect(body.toLowerCase()).not.toContain("validator");
  delete process.env.HATCH_VALIDATOR_ADDRESS;
});
