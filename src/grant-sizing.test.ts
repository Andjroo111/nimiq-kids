// #194: the demo grant and the starter board are two halves of one promise — "here is a
// board, go finish it" — and they were denominated in different units, so they drifted
// until a brand-new family was refused on chore two of the sample board.
//
// What is pinned here is the RELATIONSHIP, not either number. Raise a starter chore and
// `starterBoardGrantUsd()` moves with it, so these stay true or fail in the same commit.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { demoGrantLuna } from "./repo-budget";
import { hasLiveRate, usdToWholeNimLuna, LUNA, NIM_USD } from "./rates";
import { starterBoardGrantUsd, starterBoardLuna, starterBoardUsd } from "./starter-board";
import { healthRoutes } from "./routes/health";
import { initTestDb } from "./db";
import { setWalletState } from "./repo-wallet";
import { HOT_BALANCE_KEY } from "./routes/wallet";

const ENV_KEYS = ["HATCH_DEMO_GRANT_LUNA", "HATCH_DEMO_GRANT_USD"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

// ---- the invariant #194 was about ----

// A band either side of anything NIM has traded at, three orders of magnitude wide. Not
// "every rate": each reward is floored at one whole coin, so far above ~$0.5/NIM a
// three-chore board costs 3 NIM whatever it is priced at and no dollar grant can track it.
// That is a rate at which this app has other problems.
const RATE_BAND = [0.0001, 0.00025, 0.00047159, 0.001, 0.002, 0.005, 0.01, 0.05];

test("the recommended grant covers the whole starter board at every plausible rate", () => {
  for (const rate of RATE_BAND) {
    const grant = usdToWholeNimLuna(starterBoardGrantUsd(), rate);
    const board = starterBoardLuna(rate);
    expect({ rate, covers: grant >= board }).toEqual({ rate, covers: true });
  }
});

test("a family can finish the board one chore at a time, not just in aggregate", () => {
  // The failure in #194 was sequential: the grant is a cumulative ceiling, so what matters
  // is that the LAST approval still fits, not that the totals compare.
  for (const rate of RATE_BAND) {
    let spent = 0;
    const grant = usdToWholeNimLuna(starterBoardGrantUsd(), rate);
    for (const usd of [0.5, 0.5, 1.0]) {
      const reward = usdToWholeNimLuna(usd, rate);
      expect({ rate, affordable: spent + reward <= grant }).toEqual({ rate, affordable: true });
      spent += reward;
    }
  }
});

test("the shipped starter board is the one these figures were computed for", () => {
  // A canary: if someone adds a fourth starter chore, the numbers above still hold (they
  // are derived) but the DOLLAR cost per family moves, and that is an operator decision.
  expect(starterBoardUsd()).toBe(2);
  expect(starterBoardGrantUsd()).toBe(2.1);
});

// ---- the two knobs ----

test("HATCH_DEMO_GRANT_USD resolves against the rate, in whole NIM", () => {
  process.env.HATCH_DEMO_GRANT_USD = "2.10";
  // Tests never reach the network, so nimUsdCached() is the static rate.
  expect(demoGrantLuna()).toBe(usdToWholeNimLuna(2.1, NIM_USD));
  expect(demoGrantLuna()).toBe(1050 * LUNA); // $2.10 at $0.002/NIM
});

test("an explicit luna ceiling still wins over the dollar policy", () => {
  process.env.HATCH_DEMO_GRANT_USD = "2.10";
  process.env.HATCH_DEMO_GRANT_LUNA = "40000";
  expect(demoGrantLuna()).toBe(40_000);
});

test("HATCH_DEMO_GRANT_LUNA=0 still disables payouts, and is not read as unset", () => {
  // `0` is the kill switch, and `Number("") === 0` — so an empty string must fall through
  // to the policy rather than silently disabling every payout on the instance.
  process.env.HATCH_DEMO_GRANT_LUNA = "0";
  expect(demoGrantLuna()).toBe(0);
  process.env.HATCH_DEMO_GRANT_LUNA = "";
  process.env.HATCH_DEMO_GRANT_USD = "2.10";
  expect(demoGrantLuna()).toBe(1050 * LUNA);
});

test("neither knob set keeps the shipped 5 NIM default", () => {
  expect(demoGrantLuna()).toBe(500_000);
});

test("a junk dollar value falls back to the default rather than to zero", () => {
  for (const junk of ["", "abc", "-1", "0", "NaN"]) {
    process.env.HATCH_DEMO_GRANT_USD = junk;
    expect({ junk, grant: demoGrantLuna() }).toEqual({ junk, grant: 500_000 });
  }
});

// ---- the live signal ----

test("/health reports whether this instance's grant covers its own starter board", async () => {
  initTestDb();
  const app = new Hono().route("/", healthRoutes);
  process.env.HATCH_DEMO_GRANT_USD = String(starterBoardGrantUsd());
  const ok = await (await app.request("/health")).json();
  expect(ok.economy).toEqual({
    grantLuna: usdToWholeNimLuna(starterBoardGrantUsd(), NIM_USD),
    starterBoardLuna: starterBoardLuna(NIM_USD),
    // Tests never reach the network, so this is the honest answer: the figures above were
    // computed at the static rate and the comparison is therefore not knowledge.
    rate: "fallback",
    covers: null,
    funded: null, // no snapshot in a fresh test DB, and unknown is not "fine"
  });
  expect(ok.ok).toBe(true); // a sizing problem is not a liveness problem
});

test("/health refuses to claim `covers` from the fallback rate", async () => {
  // The bug this test exists for: `economy` shipped without this distinction and went live
  // reporting covers:true, because the static $0.002 fallback prices the board at a quarter
  // of what it really costs. An optimistic wrong answer is worse here than no answer, since
  // the entire point of the block is to make a silent crossing visible.
  initTestDb();
  const app = new Hono().route("/", healthRoutes);
  process.env.HATCH_DEMO_GRANT_LUNA = "500000"; // 5 NIM against a 1,000 NIM board
  const body = await (await app.request("/health")).json();
  expect(body.economy.rate).toBe("fallback");
  expect(body.economy.covers).toBe(null);
  expect(hasLiveRate()).toBe(false);
});

test("the board costs about 4x more at the live rate than at the fallback", () => {
  // Why `covers` cannot be reported from the fallback, as a number rather than a claim.
  const atFallback = starterBoardLuna(NIM_USD);          // $0.002/NIM
  const atLive = starterBoardLuna(0.00047159);           // the rate on the day #194 was filed
  expect(atLive).toBeGreaterThan(atFallback * 4);
  // ...and a 2,000 NIM grant covers one and not the other, which is the whole bug.
  expect(2000 * LUNA >= atFallback).toBe(true);
  expect(2000 * LUNA >= atLive).toBe(false);
});

test("/health publishes no per-family figure and no hot-wallet float", async () => {
  initTestDb();
  const app = new Hono().route("/", healthRoutes);
  const body = await (await app.request("/health")).json();
  // repo-budget.ts deliberately never publishes the float; /health is unauthenticated.
  expect(Object.keys(body.economy).sort())
    .toEqual(["covers", "funded", "grantLuna", "rate", "starterBoardLuna"]);
  // The float is a NUMBER this surface must never carry. `funded` is one bit about it.
  expect(typeof body.economy.funded === "boolean" || body.economy.funded === null).toBe(true);
});

// ---- can this instance pay anyone at all ----

test("/health says when the hot wallet is empty, without saying how full it is", async () => {
  // The state the live mainnet box was actually in: a wallet holding zero, every approval
  // refused by `payableLuna = min(budget, funds)`, and nothing anywhere saying so.
  initTestDb();
  const app = new Hono().route("/", healthRoutes);

  const read = async () => (await (await app.request("/health")).json()).economy;
  expect((await read()).funded).toBe(null); // never snapshotted: unknown, not false

  setWalletState(HOT_BALANCE_KEY, "0");
  expect((await read()).funded).toBe(false);

  // A distinctive figure, so "the balance is absent" is about the balance and not about a
  // digit sequence that happens to occur inside grantLuna.
  const float = "873219460037";
  setWalletState(HOT_BALANCE_KEY, float);
  const full = await read();
  expect(full.funded).toBe(true);
  // One bit and no more: the balance itself is every other household's business.
  expect(JSON.stringify(full)).not.toContain(float);
});

test("`funded` does not move with the price, unlike `covers`", async () => {
  // Empty is empty at every rate, which is why this is not gated on hasLiveRate().
  initTestDb();
  const app = new Hono().route("/", healthRoutes);
  setWalletState(HOT_BALANCE_KEY, "1");
  const body = (await (await app.request("/health")).json()).economy;
  expect(body).toMatchObject({ rate: "fallback", covers: null, funded: true });
});
