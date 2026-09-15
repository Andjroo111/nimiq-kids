// What the parent app does with a session this instance will not accept
// (public/parent/demo-recovery.js).
//
// The bug this holds shut: on demo.nimiq.kids a swept household's 401 landed the visitor on
// the first-run "Create your family" screen, so tapping "open the parent app" from the demo
// entrance after the 4h TTL asked a judge to sign up instead of showing them the seeded
// household. The kid app has bounced a 401 to the entrance since #12; this is the same rule
// for the parent half.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoRecoveryAction, DEMO_ENTRANCE } from "../public/parent/demo-recovery.js";

test("a demo instance sends a dead session to the entrance", () => {
  expect(demoRecoveryAction(true, false)).toBe("entrance");
});

test("a family or competition instance keeps the signed-out screen", () => {
  // The whole point of reading the flag: on the instances holding real money, a 401 is a
  // parent who needs to sign in, and redirecting them into a demo mint would be absurd.
  expect(demoRecoveryAction(false, false)).toBe("signedOut");
});

test("an unanswered /health waits rather than guessing either way", () => {
  expect(demoRecoveryAction(null, false)).toBe("wait");
});

test("once it has bounced it stays bounced, so a second failing call cannot re-navigate", () => {
  // Several money-gated calls fan out per refresh (overview + one wallet read per kid), so
  // a 401 arrives more than once. Only the first may navigate.
  expect(demoRecoveryAction(true, true)).toBe("entrance");
  expect(demoRecoveryAction(false, true)).toBe("entrance");
  expect(demoRecoveryAction(null, true)).toBe("entrance");
});

test("the entrance is the RESET path, not plain /demo", () => {
  // Plain /demo reuses whatever is in storage, and what is in storage is exactly what just
  // failed — that is the loop this avoids. ?fresh=1 clears all four demo keys and mints.
  expect(DEMO_ENTRANCE).toBe("/demo?fresh=1");
});

// ⚠️ THE REGRESSION THIS FILE EXISTS FOR, and it is not the redirect.
//
// The first version awaited the /health read whenever the flag was unknown. That put the
// signed-out screen on the COMPETITION and FAMILY apps behind /health: measured at 8s against
// a hung one, where it had painted in 89ms. /health is the request most likely to BE the one
// hanging — surfaceAccessGate probes it precisely because a lapsed Cloudflare Access session
// hangs it — so it is the worst request in the app to gate a sign-in screen on.
test("the decision is synchronous: it can never hold up the first paint", () => {
  for (const demo of [true, false, null]) {
    const out = demoRecoveryAction(demo, false);
    expect(out).not.toBeInstanceOf(Promise);
    expect(typeof out).toBe("string");
  }
});

test("core.js consumes the decision without awaiting it", () => {
  // The invariant above only holds if the caller keeps it. An `await` here is how it would
  // come back, and it would come back silently: everything still works, the competition app
  // just gets slower in exactly the case nobody tests.
  const core = readFileSync(join(import.meta.dir, "..", "public", "parent", "core.js"), "utf8");
  expect(core).toContain("demoRecoveryAction");
  expect(core).not.toMatch(/await\s+recoverDemoSession/);
  expect(core).not.toMatch(/await\s+demoRecoveryAction/);
  expect(core).not.toMatch(/await\s+healthRead/);
});
