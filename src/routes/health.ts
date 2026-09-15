// GET /health — the liveness probe, and the one thing every runbook in this repo tells
// you to trust over a green CI run or a merged PR when asking what is actually live.
//
// It lived inline in server.ts, which meant the endpoint the deploy story depends on had
// no test: server.ts calls initDb() and primes the hot-wallet snapshot at import, so a
// test cannot touch it without booting the app. As a route module it composes into a bare
// Hono the same way children/chores/families already do.

import { Hono } from "hono";
import * as repo from "../repo";
import * as wrepo from "../repo-wallet";
import { custodyView } from "../custody";
import { NETWORK, SIM, EXPLORER_TX } from "../nimiq/client";
import { stakingAvailable } from "../wallet/kid-staking";
import { shellBundleReport } from "../shell-bundle";
import { demoGrantLuna } from "../repo-budget";
import { hasLiveRate, nimUsdCached } from "../rates";
import { starterBoardLuna } from "../starter-board";
import { demoSeedEnabled } from "./demo";
// version from package.json — a hand-bumped literal here went stale in 0.13.0
// and made a successful deploy look like a no-op from /health
import pkg from "../../package.json";

export const healthRoutes = new Hono();

/** custodyView() with no family reports the INSTANCE FLOOR, which on a non-forced box reads
 *  "demo unlocked" even when every household there is in family mode and queues everything.
 *  `demoModeFamilies` is the missing half: 0 means nothing on this instance is unlocked.
 *  Best-effort — /health is a liveness probe and must never fail on a DB read. */
healthRoutes.get("/health", (c) => {
  let demoModeFamilies: number | null = null;
  try { demoModeFamilies = repo.demoModeFamilyCount(); } catch { /* keep null */ }
  // NOTHING about the chain endpoint is published here, deliberately. /health is
  // UNAUTHENTICATED, and an RPC URL can carry basic-auth credentials, an API key in its path,
  // or the hostname of a node that is not meant to be reachable from outside. Operational
  // detail about the node belongs somewhere that asks who is calling.
  //
  // `demo` is the SEEDED-DEMO flag (demoSeedEnabled), NOT custody.demoUnlocked — one says
  // this instance hands out demo households, the other says approvals are not enforced, and
  // an instance can be either without the other. Published because the kid app needs it at
  // boot to tell a demo visitor apart from a genuinely unpaired tablet (#12), and it costs
  // no extra request: /health is already the first call boot makes. Safe to publish — it is
  // a flag, not a secret, and GET /demo answering 200 rather than 404 already announces it.
  // `staking.available` answers the question that cost a production feature its whole life:
  // Grow was dark on the live mainnet instance from the day it shipped, because
  // HATCH_VALIDATOR_ADDRESS was never set there, and NOTHING said so. The only way to find
  // out was to be a kid, open Grow, and get `staking_unavailable` back.
  //
  // It is the same shape as `custody` and for the same reason: a runbook has to be able to
  // ask the running instance what it can actually do, without a kid token and without
  // reading an env file over someone's shoulder.
  //
  // The ADDRESS is deliberately not published, matching the RPC-URL rule above. Whether this
  // box can stake is operational truth worth exposing; which validator it delegates to is a
  // detail about infrastructure and stays behind auth.
  //
  // `bundle` is the one thing about a running instance that `v` CANNOT answer. public/dist
  // is gitignored and built at boot, so it is not in the commit: an instance can report the
  // right version while serving a bundle from two deploys ago, and a missing parent-shell.js
  // renders the whole parent money surface as raw `papp.*` keys with nothing to say why.
  // Size and mtime only — no path, same rule as the RPC URL (#119).
  // `economy` answers the question #194 was: can a family this instance creates actually
  // finish the board this instance gives them? The grant is a fixed ceiling and the starter
  // board is priced in dollars, so the two move against each other every time NIM does, and
  // when they cross NOTHING says so — the parent just gets `budget_exhausted` on chore two of
  // the sample board and reads it as the app being broken. That is the same failure shape as
  // `staking.available`: a feature dark on the live box with no way to ask but to be a kid
  // and hit it.
  //
  // Two totals and the comparison, no per-family figure and NOT the hot-wallet float —
  // /health is unauthenticated, and the float is the one money number repo-budget.ts
  // deliberately never publishes (visibleFundsLuna: it is every other household's balance).
  // A grant and a sample board are the same class of fact as the price on the shelf.
  //
  // `rate` is not decoration. The starter board is priced in dollars, so its luna cost is a
  // CONVERSION, and before this process has fetched a price that conversion silently uses
  // the static $0.002 fallback — about 4x the live price, so the board reads about a quarter
  // of what it really costs. That is how this block first went live saying `covers: true`
  // about a board the grant does not cover. `covers` is therefore null, not true, until a
  // real price has been seen: unknown is a third state, and the same rule the hot-wallet
  // snapshot already follows.
  //
  // `funded` is the OTHER half of "can this instance pay anyone", and it was missing when
  // the live mainnet hot wallet was found holding zero: every approval on the box was being
  // refused and nothing anywhere said so, because `payableLuna` is min(budget, funds) and a
  // zero float loses that minimum every time. An operator could read a perfectly healthy
  // `economy` block off an instance that could not move a single NIM.
  //
  // ONE BIT, and that is the entire design. The float itself is the one money number this
  // codebase deliberately never publishes on an unauthenticated surface (repo-budget.ts
  // `visibleFundsLuna`: the moment it is the tighter bound it IS every other household's
  // balance, and polling it reads their top-ups). "Holds something" leaks nothing of the
  // kind and would have caught this in one curl.
  //
  // Deliberately NOT "can afford a chore": that threshold is a dollar-priced amount and
  // would drag the rate caveat above into a question that does not need it. Empty and
  // not-empty is rate-independent, and empty is the state that stops everything.
  // null = never snapshotted, the same contract hotWalletSnapshotLuna itself uses.
  const grantLuna = demoGrantLuna();
  const live = hasLiveRate();
  const funds = wrepo.hotWalletSnapshotLuna();
  const boardLuna = starterBoardLuna(nimUsdCached());
  return c.json({
    ok: true, app: "nimiq.kids", v: pkg.version, network: NETWORK, sim: SIM,
    demo: demoSeedEnabled(),
    explorerTx: EXPLORER_TX, custody: { ...custodyView(), demoModeFamilies },
    staking: { available: stakingAvailable() },
    economy: {
      grantLuna, starterBoardLuna: boardLuna,
      rate: live ? "live" : "fallback",
      covers: live ? grantLuna >= boardLuna : null,
      funded: funds === null ? null : funds > 0,
    },
    bundle: shellBundleReport(),
  });
});
