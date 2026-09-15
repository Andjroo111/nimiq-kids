// The Fly deploy target must not be able to boot as an ungated impostor.
//
// https://nimiq.kids is served by a Cloudflare tunnel to the Mac Mini's mainnet instance, not
// by Fly. So the Fly app is the one nobody looks at — and `approvalPolicy` keys `forced` off
// NIMIQ_NETWORK, which DEFAULTS TO "test" when unset. fly.toml never sets it. Without the two
// gate flags in its [env], a Fly boot comes up demo-unlocked with kid money endpoints open to
// anonymous callers.
//
// This pins the deploy config to the custody policy, in the same spirit as
// custody-policy.test.ts pinning the two SIM formulas together: the failure mode is the two
// drifting apart silently, so assert against the real file rather than a copy of its values.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { approvalPolicy } from "./custody";

/** Minimal reader for fly.toml's [env] table. Deliberately not a general TOML parser — it
 *  only has to understand `KEY = "value"` lines inside one table, and it must STOP at the
 *  next table header so a key from a later section can never be mistaken for an env var. */
function flyEnv(): Record<string, string | undefined> {
  const toml = readFileSync(new URL("../fly.toml", import.meta.url), "utf8");
  const out: Record<string, string> = {};
  let inEnv = false;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || line === "") continue;
    if (line.startsWith("[")) { inEnv = line === "[env]"; continue; }
    if (!inEnv) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*"(.*)"$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

test("the [env] reader actually found the block (guards against a silent empty parse)", () => {
  const env = flyEnv();
  expect(env.PORT).toBe("8080");
  expect(env.DB_PATH).toBe("/app/data/kids.db");
  // If fly.toml is restructured and the reader quietly returns {}, every assertion below
  // would pass vacuously against an all-undefined env. This is the canary for that.
  expect(Object.keys(env).length).toBeGreaterThanOrEqual(4);
});

test("a Fly boot forces parent approval and requires kid auth", () => {
  const p = approvalPolicy(flyEnv());
  expect(p.forced).toBe(true);
  expect(p.authRequired).toBe(true);
});

test("removing either gate flag would reopen the hole (proves the flags are load-bearing)", () => {
  const env = flyEnv();

  const withoutApproval = { ...env, HATCH_REQUIRE_PARENT_APPROVAL: undefined };
  expect(approvalPolicy(withoutApproval).forced).toBe(false);

  // authRequired falls out of `forced || HATCH_LEGACY_BOOT === "0"`, so dropping BOTH is
  // what actually opens the kid money endpoints.
  const withoutEither = { ...withoutApproval, HATCH_LEGACY_BOOT: undefined };
  expect(approvalPolicy(withoutEither).authRequired).toBe(false);
});

test("the Fly target does not pretend to be mainnet", () => {
  const env = flyEnv();
  // It runs SIM with no signing key. If someone ever sets NIMIQ_NETWORK=main here, they are
  // creating a SECOND mainnet instance with an empty database — make that a test failure
  // rather than a discovery.
  expect(env.NIMIQ_NETWORK).toBeUndefined();
  expect(env.NIMIQ_SIM).toBe("1");
  expect(env.DEV_PARENT_PRIV).toBeUndefined();
  expect(env.HATCH_MASTER_SEED).toBeUndefined();
  expect(approvalPolicy(env).mainnetReal).toBe(false);
});
