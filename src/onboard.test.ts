// Self-serve onboarding + pairing codes (mini-app port slice 2). The judge path:
// one POST creates a working household with a usable bearer token; the pairing
// code rescues a Pay WebView that dropped the #t= fragment. Hermetic: in-memory
// DB + app.request().

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb, getDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as referrals from "./repo-referrals";
import { OTHER_STORE_ITEMS, STICKER_PACKS } from "./sticker-catalog";
import { newToken, sha256Hex } from "./auth";
import { onboardRoutes, resetRateLimits, PAIR_CODE_TTL_MS, ONBOARD_MAX_PER_DAY } from "./routes/onboard";
import { allow } from "./rate-limit";
import { lockRoutes } from "./routes/lock";
import { peerEnv } from "./client-ip";
import { parentRoutes } from "./routes/parent";
import { children } from "./routes/children";
import { families } from "./routes/families";

const app = new Hono()
  .route("/api", onboardRoutes)
  .route("/api", parentRoutes)
  .route("/api", children)
  .route("/api", families)
  .route("/api", lockRoutes); // the second route that redeems a pair code

beforeEach(() => {
  initTestDb();
  resetRateLimits();
});

// Requests arrive "through the tunnel" by default — peer 127.0.0.1, which is the one
// place a forwarded header is believed. `peerEnv` is what lets a test say where the
// socket came from; without it every caller is UNKNOWN_CALLER (see client-ip.ts).
const TUNNEL = peerEnv("127.0.0.1");

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}, env: unknown = TUNNEL) =>
  app.request(`http://hatch.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }, env);

const authed = (bearer: string, method: string, path: string, body?: Record<string, unknown>) =>
  app.request(`http://hatch.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

// ---- create your family ----

test("one POST creates a family-mode household with kid, sample chores, and a working token", async () => {
  const res = await post("/api/onboard", { parentLabel: "Mom", kidLabel: "Sam" });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.token).toMatch(/^[0-9a-f]{64}$/);
  expect(body.family.mode).toBe("family");
  expect(body.child.label).toBe("Sam");
  expect(body.chores).toHaveLength(3);
  for (const ch of body.chores) expect(ch.rewardLuna).toBeGreaterThan(0);

  // Issue #131: the FIRST board a family sees must be priced so doing it earns something the
  // shop actually sells. The old board paid 1/1/2 NIM against a 1,000 NIM shelf floor, so a
  // new family bounced off `insufficient_funds` on their first purchase. The rate here is the
  // static test rate (the app's WORST case for affording a NIM-priced shelf — real NIM is
  // cheaper per dollar, so production clears it by more), which makes this a conservative floor.
  const starterTotal = body.chores.reduce((s: number, ch: { rewardLuna: number }) => s + ch.rewardLuna, 0);
  const cheapestPaidItem = Math.min(
    ...Object.values(OTHER_STORE_ITEMS).filter((i) => !i.retired).map((i) => i.priceLuna),
    ...STICKER_PACKS.filter((p) => p.priceLuna > 0).map((p) => p.priceLuna),
  );
  expect(starterTotal).toBeGreaterThanOrEqual(cheapestPaidItem);

  // The minted token drives the parent app immediately (the under-60s promise).
  const ov = await authed(body.token, "GET", "/api/parent/overview");
  expect(ov.status).toBe(200);
  const overview = await ov.json();
  expect(overview.family.id).toBe(body.family.id);
  expect(overview.children.map((k: { id: string }) => k.id)).toEqual([body.child.id]);
});

test("onboarding a second family never disturbs the first household", async () => {
  const first = repo.createFamily("Andjroo", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  repo.updateFamilySettings(first.id, { mode: "family" });
  const firstKid = repo.createChild(first.id, "A-kid", "🦖");
  const firstBearer = newToken();
  lockRepo.createParentToken(first.id, "Andjroo's phone", await sha256Hex(firstBearer));

  const res = await post("/api/onboard", { parentLabel: "Judge", kidLabel: "Kid J" });
  expect(res.status).toBe(201);

  // The existing token still resolves the existing family, kids untouched.
  const ov = await (await authed(firstBearer, "GET", "/api/parent/overview")).json();
  expect(ov.family.id).toBe(first.id);
  expect(ov.children.map((k: { id: string }) => k.id)).toEqual([firstKid.id]);
  // The legacy no-auth tablet surface still serves the FIRST household.
  const fam = await (await app.request("http://hatch.test/api/family")).json();
  expect(fam.family.id).toBe(first.id);
});

test("labels are required, trimmed, and capped; the kid row carries zero PII columns", async () => {
  expect((await post("/api/onboard", { kidLabel: "Sam" })).status).toBe(400);
  expect((await post("/api/onboard", { parentLabel: "Mom" })).status).toBe(400);
  expect((await post("/api/onboard", { parentLabel: "M".repeat(25), kidLabel: "S" })).status).toBe(400);
  expect((await post("/api/onboard", { parentLabel: "Mom", kidLabel: "S".repeat(25) })).status).toBe(400);
  const res = await post("/api/onboard", { parentLabel: "  Mom  ", kidLabel: "  Sam  ", kidEmoji: "🐸" });
  const body = await res.json();
  expect(body.family.parentLabel).toBe("Mom");
  expect(body.child.emoji).toBe("🐸");
  const cols = getDb().query("SELECT * FROM children WHERE id=?").get(body.child.id) as Record<string, unknown>;
  // The address-provenance columns are all about WHOSE KEY the address is (a public
  // address, a public key, a signature over a server-issued string, and which Keyguard flow
  // signed it). None of them is a fact about the child, which is what this list is guarding.
  //
  // `daily_screen_min` / `max_earned_min` (#377) are two integers of HOUSE RULE — how long
  // this household lets this tablet run. They say nothing about who the child is, which is
  // the test this list applies, and they are the reason the meter keeps minutes here and
  // its per-day history in `screen_usage` keyed by id rather than anything nameable.
  //
  // `lang` (#432) is the same kind of thing and was weighed against this list rather than
  // appended to it. It is one of five ids a PARENT picked for a tablet, so it is a setting
  // for a device this child uses, not a fact about the child: it is not a nationality, it is
  // not where they live, and it is not self-reported. It is also NULL on this row and on
  // every row that existed before the column did, because null means follow the device — so
  // the default state of this field is that the household has told us nothing at all.
  //
  // `play_min` / `rest_min` are the sittings rule ("play 30, rest 30"): the same kind of
  // house rule as `daily_screen_min`, weighed the same way. Nothing about who the child is.
  expect(Object.keys(cols).sort()).toEqual([
    "account_index", "address", "address_proof_kind", "address_proof_message",
    "address_proof_pubkey", "address_proof_sig", "address_registered_at", "address_source",
    "balance_luna", "created_at", "daily_screen_min", "derived_address", "emoji", "family_id",
    "hd_family_index", "id", "label", "lang", "max_earned_min", "play_min", "rest_min",
    "star_balance", "streak_count",
  ]);
  // And it starts null, which is the whole basis of the paragraph above.
  expect(cols.lang).toBeNull();
});

test("a supplied address is validated; under server custody the family still uses the hot wallet", async () => {
  const good = await post("/api/onboard", {
    parentLabel: "Mom", kidLabel: "Sam", address: "NQ07 0000 0000 0000 0000 0000 0000 0000 0000",
  });
  expect(good.status).toBe(201);
  const fam = repo.getFamily((await good.json()).family.id)!;
  // Server custody (the default, every public instance): a caller-supplied address is IGNORED so
  // the family wallet is the instance hot wallet — otherwise the coupon-refund path drains the
  // shared float (see fix/onboard-address-server-custody).
  expect(fam.parent_address).not.toBe("NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  const bad = await post("/api/onboard", { parentLabel: "Mom", kidLabel: "Sam", address: "javascript:alert(1)" });
  expect(bad.status).toBe(400);
});

test("onboarding with NO connected wallet still stores a REAL family address", async () => {
  // Regression, verified on testnet 2026-07-31: the old placeholder failed its own
  // checksum, so kid -> parent sends answered 400 and every Treasure Box buy answered
  // 502 for any family that onboarded without connecting a wallet — the judge path.
  const r = await post("/api/onboard", { parentLabel: "Mom", kidLabel: "Sam" });
  expect(r.status).toBe(201);
  const fam = repo.getFamily((await r.json()).family.id)!;
  const Nimiq = await import("@nimiq/core");
  expect(() => Nimiq.Address.fromUserFriendlyAddress(fam.parent_address)).not.toThrow();
});

test("?ref marks the inviter's referral joined and stores nothing about the new household", async () => {
  const inviter = repo.createFamily("Inviter", "NQ00");
  const invite = referrals.getOrCreateInvite(inviter.id);
  referrals.recordAccept(invite.code, "landing-hash");

  const res = await post("/api/onboard", { parentLabel: "Newbie", kidLabel: "Kid", ref: invite.code.toLowerCase() });
  expect(res.status).toBe(201);
  const newFamilyId = (await res.json()).family.id;

  expect(referrals.countJoins(invite.code)).toBe(1);
  const row = getDb().query("SELECT * FROM referrals WHERE code=?").get(invite.code) as Record<string, unknown>;
  expect(row.status).toBe("joined");
  expect(row.joined_at).toBeGreaterThan(0);
  expect(JSON.stringify(row)).not.toContain(newFamilyId); // attribution only, never who joined
});

test("an unknown ref never blocks onboarding", async () => {
  const res = await post("/api/onboard", { parentLabel: "Mom", kidLabel: "Sam", ref: "NOPE2345" });
  expect(res.status).toBe(201);
});

/** Headers naming the caller, built per call: a shared object would let one test's mutation
 *  reach another's request. */
const fromIp = (ip: string) => ({ "cf-connecting-ip": ip });

test("onboarding is rate limited per IP", async () => {
  for (let i = 0; i < 3; i++) {
    expect((await post("/api/onboard", { parentLabel: "Mom", kidLabel: `Kid ${i}` }, fromIp("203.0.113.5"))).status).toBe(201);
  }
  const refused = await post("/api/onboard", { parentLabel: "Mom", kidLabel: "Kid 4" }, fromIp("203.0.113.5"));
  expect(refused.status).toBe(429);
  // The CODE, not just the status (#242). The first-run screen has nothing behind it, so a
  // refusal it cannot name renders as "That didn't go through. Try again" — the one
  // instruction that cannot work when the refusal IS that they tried again.
  expect(await refused.json()).toEqual({ error: "too_many_requests" });
  // A different IP is unaffected.
  const other = await post("/api/onboard", { parentLabel: "Mom", kidLabel: "Kid 5" }, fromIp("198.51.100.1"));
  expect(other.status).toBe(201);
});

test("the instance's day is a DIFFERENT refusal from the caller's hour", async () => {
  // The day budget is spent through the same shared store the route uses (see ../rate-limit),
  // rather than by minting 200 households, which is the only part of this that is a stand-in:
  // the key, the cap and the window are the route's own.
  for (let i = 0; i < ONBOARD_MAX_PER_DAY; i++) allow("onboard:all", ONBOARD_MAX_PER_DAY, 24 * 60 * 60 * 1000);
  const refused = await post("/api/onboard", { parentLabel: "Mom", kidLabel: "Sam" }, fromIp("203.0.113.77"));
  expect(refused.status).toBe(429);
  expect(await refused.json()).toEqual({ error: "too_many_families_today" });
  // A fresh caller gets the same answer: this brake is the instance's, not theirs.
  const elsewhere = await post("/api/onboard", { parentLabel: "Dad", kidLabel: "Kim" }, fromIp("198.51.100.9"));
  expect(await elsewhere.json()).toEqual({ error: "too_many_families_today" });
});

test("a caller who has spent their own hour does not also spend the instance's day", async () => {
  // The two brakes were one `||`, and the short-circuit it happened to have is now load
  // bearing: a single noisy IP must not be able to burn the whole day's budget for everybody
  // else four requests at a time.
  for (let i = 0; i < 3; i++) {
    expect((await post("/api/onboard", { parentLabel: "Mom", kidLabel: `Kid ${i}` }, fromIp("203.0.113.5"))).status).toBe(201);
  }
  for (let i = 0; i < 50; i++) {
    expect((await post("/api/onboard", { parentLabel: "Mom", kidLabel: "Kid" }, fromIp("203.0.113.5"))).status).toBe(429);
  }
  // 3 spent by the successes above and nothing since. One short of the cap still creates.
  for (let i = 0; i < ONBOARD_MAX_PER_DAY - 4; i++) allow("onboard:all", ONBOARD_MAX_PER_DAY, 24 * 60 * 60 * 1000);
  expect((await post("/api/onboard", { parentLabel: "Dad", kidLabel: "Kim" }, fromIp("198.51.100.9"))).status).toBe(201);
});

test("a caller who is not behind the proxy cannot buy a fresh bucket with a header", async () => {
  const lan = peerEnv("192.168.1.42"); // reached the port directly: nothing it sends is believed
  for (let i = 0; i < 3; i++) {
    expect((await post("/api/onboard", { parentLabel: "Mom", kidLabel: `Kid ${i}` }, {}, lan)).status).toBe(201);
  }
  // Measured before the fix: each of these answered 201, three families at a time, forever.
  for (const claim of ["203.0.113.6", "203.0.113.7", "203.0.113.8"]) {
    const spoofed = await post("/api/onboard", { parentLabel: "Mom", kidLabel: "Kid" }, { "x-forwarded-for": claim }, lan);
    expect(spoofed.status).toBe(429);
    const alsoSpoofed = await post("/api/onboard", { parentLabel: "Mom", kidLabel: "Kid" }, { "cf-connecting-ip": claim }, lan);
    expect(alsoSpoofed.status).toBe(429);
  }
});

// ---- pairing codes ----

async function makeHousehold() {
  const res = await post("/api/onboard", { parentLabel: "Mom", kidLabel: "Sam" });
  return (await res.json()) as { token: string; family: { id: string } };
}

test("a signed-in session mints a code; typing it on another device mints a working token", async () => {
  const house = await makeHousehold();
  const minted = await authed(house.token, "POST", "/api/parent/pair-code", {});
  expect(minted.status).toBe(201);
  const { code, expiresAt, ttlMs } = await minted.json();
  expect(code).toMatch(/^\d{6}$/);
  expect(ttlMs).toBe(PAIR_CODE_TTL_MS);
  expect(expiresAt).toBeGreaterThan(Date.now());

  const paired = await post("/api/pair", { code });
  expect(paired.status).toBe(200);
  const body = await paired.json();
  expect(body.family.id).toBe(house.family.id);
  const ov = await authed(body.token, "GET", "/api/parent/overview");
  expect(ov.status).toBe(200);
  expect((await ov.json()).family.id).toBe(house.family.id);
});

test("pair-code minting requires a parent bearer", async () => {
  expect((await post("/api/parent/pair-code", {})).status).toBe(401);
});

test("codes are single use and burn on redeem", async () => {
  const house = await makeHousehold();
  const { code } = await (await authed(house.token, "POST", "/api/parent/pair-code", {})).json();
  expect((await post("/api/pair", { code })).status).toBe(200);
  expect((await post("/api/pair", { code })).status).toBe(404);
});

test("a new code supersedes the previous live one", async () => {
  const house = await makeHousehold();
  const first = await (await authed(house.token, "POST", "/api/parent/pair-code", {})).json();
  const second = await (await authed(house.token, "POST", "/api/parent/pair-code", {})).json();
  expect((await post("/api/pair", { code: first.code })).status).toBe(404);
  expect((await post("/api/pair", { code: second.code })).status).toBe(200);
});

test("expired codes are refused", async () => {
  const house = await makeHousehold();
  const fam = repo.getFamily(house.family.id)!;
  const code = "123456";
  const row = lockRepo.createPairCode(fam.id, await sha256Hex(code), PAIR_CODE_TTL_MS);
  getDb().run("UPDATE pair_codes SET expires_at=? WHERE id=?", [Date.now() - 1, row.id]);
  expect((await post("/api/pair", { code })).status).toBe(404);
});

test("malformed codes are a 400 and never touch the store", async () => {
  expect((await post("/api/pair", { code: "12345" })).status).toBe(400);
  expect((await post("/api/pair", { code: "abcdef" })).status).toBe(400);
  expect((await post("/api/pair", {})).status).toBe(400);
});

test("pair attempts are rate limited per IP", async () => {
  const hdr = { "cf-connecting-ip": "203.0.113.9" };
  for (let i = 0; i < 6; i++) {
    expect((await post("/api/pair", { code: "000000" }, hdr)).status).toBe(404);
  }
  expect((await post("/api/pair", { code: "000000" }, hdr)).status).toBe(429);
});

// This is the one that mattered: /api/pair mints a PARENT token, and 30 guesses behind
// 30 invented headers used to answer 404 thirty times, with the brake never firing once.
test("guessing pair codes from one socket stays one bucket, however many IPs it claims", async () => {
  const lan = peerEnv("203.0.113.200");
  const seen: number[] = [];
  for (let i = 1; i <= 30; i++) {
    seen.push((await post("/api/pair", { code: "000000" }, { "x-forwarded-for": `198.51.100.${i}` }, lan)).status);
  }
  expect(seen.filter((s) => s === 404)).toHaveLength(6);
  expect(seen.filter((s) => s === 429)).toHaveLength(24);
});

test("the second redeem route spends the same allowance, so switching endpoints buys nothing", async () => {
  const lan = peerEnv("203.0.113.201");
  const reg = () => post("/api/devices/register", { label: "Tablet", pairCode: "000000" }, {}, lan);
  // Six attempts total across BOTH routes, not six each.
  for (let i = 0; i < 3; i++) expect((await post("/api/pair", { code: "000000" }, {}, lan)).status).toBe(404);
  for (let i = 0; i < 3; i++) expect((await reg()).status).toBe(403);
  expect((await reg()).status).toBe(429);
  expect((await post("/api/pair", { code: "000000" }, {}, lan)).status).toBe(429);
});

test("an instance-wide guess budget bounds an attack spread across many addresses", async () => {
  // The per-caller brake caps one socket at six a minute; a botnet just brings more
  // sockets. 30 misses/minute across the whole instance is where that stops.
  for (let i = 1; i <= 30; i++) {
    const attacker = peerEnv(`198.51.100.${i}`);
    for (let n = 0; n < 5; n++) await post("/api/pair", { code: "000000" }, {}, attacker);
  }
  const fresh = peerEnv("203.0.113.250"); // never seen, its own per-caller allowance intact
  expect((await post("/api/pair", { code: "000000" }, {}, fresh)).status).toBe(429);
  // And it covers the device route too, which redeems the same codes.
  expect((await post("/api/devices/register", { label: "T", pairCode: "000000" }, {}, fresh)).status).toBe(429);
});

test("only wrong guesses spend the instance budget, so ordinary pairing never touches it", async () => {
  const house = await makeHousehold();
  const parent = peerEnv("203.0.113.251");
  // Forty successful pairings — well past the 30/min miss budget — because none of them miss.
  for (let i = 0; i < 40; i++) {
    const { code } = await (await authed(house.token, "POST", "/api/parent/pair-code", {})).json();
    const paired = await post("/api/pair", { code }, { "cf-connecting-ip": `203.0.113.${i}` }, TUNNEL);
    expect(paired.status).toBe(200);
    expect((await paired.json()).token).toMatch(/^[0-9a-f]{64}$/);
  }
  expect((await post("/api/pair", { code: "000000" }, {}, parent)).status).toBe(404);
});

test("the pair-code store keeps only hashes, never the code itself", async () => {
  const house = await makeHousehold();
  const { code } = await (await authed(house.token, "POST", "/api/parent/pair-code", {})).json();
  const row = getDb().query("SELECT * FROM pair_codes").get() as Record<string, unknown>;
  expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(String(row.code_hash)).not.toBe(code);
});
