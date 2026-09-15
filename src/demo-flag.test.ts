// The flag that decides whether an instance hands out demo households, and whether
// parentAuth will let the visitor approve their own payout.
//
// It was written down TWICE. `HATCH_DEMO_SEED` was renamed to `HATCH_DEMO_ENABLED`;
// routes/demo.ts was updated to accept both, auth.ts's private copy was not. So the live
// demo reported `demo: true`, minted households, showed the kid the tap — and every
// on-tablet approval answered 401, because the last call in the chain was reading a flag
// nobody sets any more. These tests exist so the two can never disagree again.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as approvalsRepo from "./repo-approvals";
import { getDb } from "./db";
import { parentAuth } from "./auth";
import { demoSeedEnabled } from "./demo-flag";
import { demoSeedEnabled as fromRoutes } from "./routes/demo";
import { healthRoutes } from "./routes/health";

const KEYS = ["HATCH_DEMO_ENABLED", "HATCH_DEMO_SEED"] as const;
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
beforeEach(() => { initTestDb(); for (const k of KEYS) delete process.env[k]; });
afterEach(() => {
  for (const k of KEYS) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

test("BOTH names arm the flag, and neither means off", () => {
  expect(demoSeedEnabled()).toBe(false);
  process.env.HATCH_DEMO_ENABLED = "1";
  expect(demoSeedEnabled()).toBe(true);
  delete process.env.HATCH_DEMO_ENABLED;
  // The legacy name stays accepted on purpose: the live env files are edited separately
  // from a deploy, so requiring both to move together means a flag day where whichever
  // landed second switched the judge demo off.
  process.env.HATCH_DEMO_SEED = "1";
  expect(demoSeedEnabled()).toBe(true);
});

test("routes/demo re-exports the same function, not a second copy of it", () => {
  // Identity, not equality of behaviour. Two implementations that agree today are exactly
  // what shipped the bug: they agreed until one of them was updated.
  expect(fromRoutes).toBe(demoSeedEnabled);
});

/**
 * Run parentAuth inside a REAL Hono handler, with no Authorization header, which is exactly
 * what a demo tablet sends. A hand-rolled context object would only prove that a stub
 * behaves the way I stubbed it: parentAuth reaches for `c.req.header(...)`, so the fake has
 * to be the real thing or the test is about the fake.
 */
async function authOf(fam: repo.Family, pin?: unknown) {
  let result: Awaited<ReturnType<typeof parentAuth>> | null = null;
  const app = new Hono().get("/probe", async (c) => {
    result = await parentAuth(c, fam, pin);
    return c.json({});
  });
  await app.request("http://hatch.test/probe");
  return result!;
}

/** The whole point: /health's answer and parentAuth's decision must come from one flag. */
const health = async () =>
  (await new Hono().route("/", healthRoutes).request("http://hatch.test/health")).json();

test("an instance that reports demo:true also lets a demo household approve", async () => {
  // This is the exact combination that was broken live: HATCH_DEMO_ENABLED set (the new
  // name), so /health said demo:true and the kid app offered the tap, while parentAuth
  // read the old name, saw nothing, and answered 401.
  process.env.HATCH_DEMO_ENABLED = "1";
  expect((await health()).demo).toBe(true);

  const f = repo.createFamily("Mom", "NQ00");
  getDb().run("UPDATE families SET demo_at=? WHERE id=?", [1_700_000_000_000, f.id]);
  const fam = repo.getFamily(f.id)!;
  expect(fam.demo_at).toBeTruthy();

  const auth = await authOf(fam);
  expect(auth.ok).toBe(true);
  expect(auth.ok && auth.method).toBe("demo");
});

test("the legacy name works the same way end to end", async () => {
  process.env.HATCH_DEMO_SEED = "1";
  expect((await health()).demo).toBe(true);
  const f = repo.createFamily("Mom", "NQ00");
  getDb().run("UPDATE families SET demo_at=? WHERE id=?", [1_700_000_000_000, f.id]);
  expect((await authOf(repo.getFamily(f.id)!)).ok).toBe(true);
});

test("a demo-stamped household on a NON-demo instance is still refused", async () => {
  // The other half of the guard, and the one that must not loosen: a stamped row that
  // somehow reached the mainnet competition instance (which sets neither flag) cannot buy
  // itself a PIN-free approval.
  const f = repo.createFamily("Mom", "NQ00");
  getDb().run("UPDATE families SET demo_at=? WHERE id=?", [1_700_000_000_000, f.id]);
  const auth = await authOf(repo.getFamily(f.id)!);
  expect(auth.ok).toBe(false);
  expect(auth.ok === false && auth.status).toBe(401);
});

test("a REAL household on a demo instance is refused without a PIN", async () => {
  // Both halves are required. An unstamped family sharing the demo box still needs auth.
  process.env.HATCH_DEMO_ENABLED = "1";
  const f = repo.createFamily("Mom", "NQ00");
  expect((await authOf(repo.getFamily(f.id)!)).ok).toBe(false);
});

test("the approve route's 401 is gone for a demo household", async () => {
  // The symptom as the browser saw it: POST /approvals/:id/approve -> 401 on the live demo.
  process.env.HATCH_DEMO_ENABLED = "1";
  const f = repo.createFamily("Mom", "NQ00");
  getDb().run("UPDATE families SET demo_at=? WHERE id=?", [1_700_000_000_000, f.id]);
  const kid = repo.createChild(f.id, "Sam", "🦖");
  const chore = repo.createChore(f.id, kid.id, "Empty the dishwasher", 5_000, "🧽", {});
  const opened = approvalsRepo.openApproval(f.id, kid.id, "chore", chore.id);
  const { approvalsRoutes } = await import("./routes/approvals");
  const res = await new Hono().route("/api", approvalsRoutes)
    .request(`http://hatch.test/api/approvals/${opened.id}/approve`, {
      method: "POST", body: "{}", headers: { "Content-Type": "application/json" },
    });
  expect(res.status).not.toBe(401);
});
