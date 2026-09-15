// The coupon-reject refund drain (ops #19): a kid's Treasure Box buy pays into the family's
// `parent_address` while the refund pays out of the instance hot wallet, and the per-family
// budget nets the two only because they are the SAME account. Under SERVER custody a self-serve
// caller must therefore NOT be able to choose `parent_address` — it is forced to the hot wallet,
// so the two legs net to zero and no shared float can be siphoned.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import { makeProvider } from "./wallet";
import { onboardRoutes, resetRateLimits } from "./routes/onboard";

const app = new Hono().route("/api", onboardRoutes);
const post = (body: Record<string, unknown>) =>
  app.request("http://hatch.test/api/onboard", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });

// A CHECKSUM-VALID address, deliberately. It used to be `NQ11 1111 …`, which the old shape
// regex accepted and the codec does not — so once onboarding started validating properly
// (#136) this test would have passed for the wrong reason: refused as malformed rather than
// ignored as somebody else's wallet. Derived from the fixed key 0x11*32.
const ATTACKER = "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD";

beforeEach(() => { initTestDb(); resetRateLimits(); delete process.env.HATCH_CUSTODY; });
afterEach(() => { delete process.env.HATCH_CUSTODY; });

test("server custody: a caller-supplied parent_address is ignored and the hot wallet is used", async () => {
  const hot = await makeProvider().getAddress();
  const res = await post({ parentLabel: "Mom", kidLabel: "Sam", address: ATTACKER });
  expect(res.status).toBe(201);
  const fam = repo.getFamily((await res.json()).family.id)!;
  expect(fam.parent_address).not.toBe(ATTACKER); // the attacker's wallet is never adopted
  expect(fam.parent_address).toBe(hot);          // the refund-symmetric hot wallet is
});

test("server custody with no address: still the hot wallet (unchanged judge path)", async () => {
  const hot = await makeProvider().getAddress();
  const res = await post({ parentLabel: "Mom", kidLabel: "Sam" });
  const fam = repo.getFamily((await res.json()).family.id)!;
  expect(fam.parent_address).toBe(hot);
});

test("parent custody: the caller's own address is required and honoured", async () => {
  process.env.HATCH_CUSTODY = "parent";
  // Checksum-valid, for the same reason as ATTACKER above. Derived from 0x22*32.
  const own = "NQ11 YJ68 JPX1 8J44 V64S 6AKU PXYL ED3A SE96";
  const res = await post({ parentLabel: "Mom", kidLabel: "Sam", address: own });
  expect(res.status).toBe(201);
  const fam = repo.getFamily((await res.json()).family.id)!;
  expect(fam.parent_address).toBe(own);

  const noAddr = await post({ parentLabel: "Mom", kidLabel: "Sam" });
  expect(noAddr.status).toBe(400);
  expect((await noAddr.json()).error).toBe("address_required");
});

// ---- #136: the codec decides what an address is, and a wrong one is correctable ----

test("onboarding refuses an address the CODEC rejects, not merely a wrong-shaped one", async () => {
  process.env.HATCH_CUSTODY = "parent";
  // Every one of these passed the old `/^NQ[0-9A-Z ]{2,42}$/`. None is an address.
  for (const bad of [
    "NQ11 1111 1111 1111 1111 1111 1111 1111 1111", // right shape, wrong checksum
    "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LE", // one character transposed
    "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6",      // too short
    "NQ99",
  ]) {
    const res = await post({ parentLabel: "Mom", kidLabel: "Sam", address: bad });
    expect(res.status, bad).toBe(400);
    expect((await res.json()).error, bad).toBe("invalid_address");
  }
});

test("a valid address is stored in ONE canonical form, however it was typed", async () => {
  process.env.HATCH_CUSTODY = "parent";
  const canonical = "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD";
  for (const typed of [canonical, canonical.replace(/\s/g, ""), canonical.toLowerCase(), `nimiq:${canonical}`]) {
    resetRateLimits(); // 3 families per IP per hour, and this walks four spellings of one
    const res = await post({ parentLabel: "Mom", kidLabel: "Sam", address: typed });
    expect(res.status, typed).toBe(201);
    expect(repo.getFamily((await res.json()).family.id)!.parent_address, typed).toBe(canonical);
  }
});
