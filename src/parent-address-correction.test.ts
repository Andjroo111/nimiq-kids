// A wrong `families.parent_address` used to be permanent.
//
// `createFamily` was its only writer, so a parent who onboarded with the wrong address could
// not fix it without direct database access — and until #136's other half it was validated by
// a shape regex, so "wrong" included strings that are not addresses at all. This is where a
// kid's Treasure Box spend lands, and under parent custody it is the account that will sign
// every payout, so it is money rather than a setting.
//
// The refusal under SERVER custody is the load-bearing part of the route, not a technicality:
// a kid's buy pays INTO parent_address while a coupon-reject refund pays OUT of the hot
// wallet, and the per-family budget nets those to zero only because they are the same
// account. Pointing it elsewhere is the hole PR #166 closed on the onboarding side.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { parentRoutes } from "./routes/parent";

const app = new Hono().route("/api", parentRoutes);
const HOT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
/** Checksum-valid, derived from the fixed keys 0x11*32 and 0x22*32. */
const GOOD = "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD";
const ALSO_GOOD = "NQ11 YJ68 JPX1 8J44 V64S 6AKU PXYL ED3A SE96";

let fam: repo.Family;
let bearer: string;

beforeEach(async () => {
  delete process.env.HATCH_CUSTODY;
  initTestDb();
  const f = repo.createFamily("Dad", HOT);
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});
afterEach(() => { delete process.env.HATCH_CUSTODY; });

const patch = (body: Record<string, unknown>, token = bearer) =>
  app.request("/api/family/address", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

const stored = () => repo.getFamily(fam.id)!.parent_address;

test("under PARENT custody a parent can correct their own address", async () => {
  process.env.HATCH_CUSTODY = "parent";
  const res = await patch({ address: GOOD });
  expect(res.status).toBe(200);
  expect((await res.json()).address).toBe(GOOD);
  expect(stored()).toBe(GOOD);

  // And again — correcting is not a one-shot.
  expect((await patch({ address: ALSO_GOOD })).status).toBe(200);
  expect(stored()).toBe(ALSO_GOOD);
});

test("it is stored canonically, however the parent typed it", async () => {
  process.env.HATCH_CUSTODY = "parent";
  expect((await patch({ address: GOOD.replace(/\s/g, "").toLowerCase() })).status).toBe(200);
  expect(stored()).toBe(GOOD);
});

test("the codec decides, so a typo is refused while refusing is still free", async () => {
  process.env.HATCH_CUSTODY = "parent";
  for (const bad of [
    "NQ11 1111 1111 1111 1111 1111 1111 1111 1111", // right shape, wrong checksum
    "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LE", // one character off
    "", "not an address",
  ]) {
    const res = await patch({ address: bad });
    expect(res.status, bad).toBe(400);
    expect((await res.json()).error, bad).toBe("invalid_address");
    expect(stored(), bad).toBe(HOT); // nothing moved
  }
});

test("under SERVER custody it is refused — the family wallet MUST be the hot wallet", async () => {
  // Every public instance runs this way. Allowing it would let a parent point the address at
  // a wallet they own: the kid's spend enriches it while the coupon refund drains the shared
  // float, unbounded, because the per-family budget nets the pair to zero.
  const res = await patch({ address: GOOD });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("server_custody_wallet_fixed");
  expect(stored()).toBe(HOT);
});

test("a caller with no parent token cannot touch it", async () => {
  process.env.HATCH_CUSTODY = "parent";
  expect((await patch({ address: GOOD }, "")).status).toBe(401);
  expect((await patch({ address: GOOD }, newToken())).status).toBe(401);
  expect(stored()).toBe(HOT);
});

test("one household's correction cannot reach another's", async () => {
  process.env.HATCH_CUSTODY = "parent";
  const other = repo.createFamily("Mum", HOT);
  const otherBearer = newToken();
  lockRepo.createParentToken(other.id, "Mum's phone", await sha256Hex(otherBearer));

  expect((await patch({ address: GOOD }, otherBearer)).status).toBe(200);
  expect(repo.getFamily(other.id)!.parent_address).toBe(GOOD);
  expect(stored()).toBe(HOT); // ours is untouched — the token names the household
});
