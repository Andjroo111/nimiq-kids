// The invite dedupe key must not be an IP address in a thin disguise.
//
// It was `sha256(code|ip)` truncated to 16 hex, with no salt and no key, and the function's
// own comment claimed it was "never a raw IP ... and unlinkable across codes". Neither held.
// The only input an attacker does not already hold is the IP — the `code` half is stored in
// the very same row — and IPv4 is 2^32 candidates, a few minutes of hashing. Recover one
// row's IP and the same candidate set inverts every other row in the table. Under GDPR an IP
// is personal data and an unkeyed hash of it still is; combined with
// family_invites.family_id -> families.parent_label it read as "this address, at this time,
// accepted an invite from the <named> family".
//
// Two properties now: the digest is a MAC under a per-instance secret, and it is forgotten
// once the window it exists for has passed.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb, getDb } from "./db";
import * as repo from "./repo";
import * as referrals from "./repo-referrals";
import { ACCEPT_DEDUPE_WINDOW_MS, forgetStaleIpHashes } from "./repo-referrals";
import { invitesRoutes } from "./routes/invites";
import { sha256Hex } from "./auth";
import { UNKNOWN_CALLER } from "./client-ip";

const app = new Hono().route("/api", invitesRoutes);
const HOT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const IP = "203.0.113.7";

let code: string;
let savedPepper: string | undefined;
let savedTrusted: string | undefined;

beforeEach(() => {
  savedPepper = process.env.HATCH_IP_PEPPER;
  savedTrusted = process.env.HATCH_TRUSTED_PROXY;
  delete process.env.HATCH_IP_PEPPER;
  initTestDb();
  const fam = repo.createFamily("Dad", HOT);
  code = referrals.getOrCreateInvite(fam.id).code;
});

afterEach(() => {
  for (const [k, v] of [["HATCH_IP_PEPPER", savedPepper], ["HATCH_TRUSTED_PROXY", savedTrusted]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const accept = (ip = IP) => app.request(`/api/invites/${code}/accept`, {
  method: "POST",
  headers: { "cf-connecting-ip": ip, "Content-Type": "application/json" },
  body: "{}",
});

const hashes = () => (getDb().query("SELECT ip_hash FROM referrals").all() as { ip_hash: string | null }[])
  .map((r) => r.ip_hash);

test("the stored digest is NOT reproducible from the code and the IP alone", async () => {
  expect((await accept()).status).toBe(200);
  const stored = hashes()[0]!;
  expect(stored).toBeTruthy();

  // THE POINT. This is the exact computation the old code did, and it is what a brute-force
  // over the 2^32 IPv4 space would be checking against. It must not match.
  const unkeyed = (await sha256Hex(`${code}|${UNKNOWN_CALLER}`)).slice(0, 16);
  expect(stored).not.toBe(unkeyed);

  // Nor with the day folded in but no secret — the day is public.
  const day = Math.floor(Date.now() / ACCEPT_DEDUPE_WINDOW_MS);
  expect(stored).not.toBe((await sha256Hex(`${day}|${code}|${UNKNOWN_CALLER}`)).slice(0, 16));
});

test("holding the pepper reproduces it — so the dedupe still means something", async () => {
  process.env.HATCH_IP_PEPPER = "a-known-instance-secret";
  expect((await accept()).status).toBe(200);
  const day = Math.floor(Date.now() / ACCEPT_DEDUPE_WINDOW_MS);
  // The caller here is UNKNOWN_CALLER, not the header: `clientIp` keys on the socket peer,
  // which the test adapter cannot supply, and a forwarded header from an untrusted peer is
  // exactly what it refuses to believe. Reproducing the digest still proves the shape — the
  // pepper and the day bucket are both really in the input.
  const expected = (await sha256Hex(`a-known-instance-secret|${day}|${code}|${UNKNOWN_CALLER}`)).slice(0, 16);
  expect(hashes()[0]).toBe(expected);
});

test("two instances hash the same visitor differently", async () => {
  process.env.HATCH_IP_PEPPER = "instance-one";
  await accept();
  const first = hashes()[0]!;

  initTestDb(); // a second instance, same code, same visitor
  const fam2 = repo.createFamily("Mum", HOT);
  code = referrals.getOrCreateInvite(fam2.id).code;
  process.env.HATCH_IP_PEPPER = "instance-two";
  await accept();

  expect(hashes()[0]).not.toBe(first);
});

test("the minted pepper is stable, so dedupe survives across requests", async () => {
  // A pepper re-minted per request would give every tap a fresh bucket and silently turn
  // the dedupe off, which is the failure mode a stored secret has to avoid.
  await accept();
  await accept();
  await accept();
  expect(referrals.countAccepts(code)).toBe(1);
  expect(new Set(hashes()).size).toBe(1);
});

test("different visitors are still counted separately", () => {
  // Through the repo, not the route: `clientIp` keys on the SOCKET PEER, which the test
  // adapter cannot supply, so every request in this file is the same unidentifiable caller
  // sharing one bucket. That is deliberate (client-ip.ts: a shared bucket over-limits rather
  // than under-limits) and it is why the route cannot demonstrate two distinct visitors.
  expect(referrals.recordAccept(code, "aaaaaaaaaaaaaaaa")).not.toBeNull();
  expect(referrals.recordAccept(code, "bbbbbbbbbbbbbbbb")).not.toBeNull();
  expect(referrals.countAccepts(code)).toBe(2);
});

// ---- retention: the digest is forgotten once it has nothing left to do ----

test("a digest older than the dedupe window is nulled out", async () => {
  await accept();
  expect(hashes()[0]).toBeTruthy();

  // Age the row past the only window in which anything ever reads its hash.
  getDb().run("UPDATE referrals SET created_at=?", [Date.now() - ACCEPT_DEDUPE_WINDOW_MS - 1]);
  forgetStaleIpHashes();

  expect(hashes()).toEqual([null]);
  // The referral itself survives: status, code and the timestamps are what a later bonus
  // grant needs, and none of them says anything about who the visitor was.
  expect(referrals.countAccepts(code)).toBe(1);
});

test("recording an accept forgets the stale digests as it goes", async () => {
  await accept();
  getDb().run("UPDATE referrals SET created_at=?", [Date.now() - ACCEPT_DEDUPE_WINDOW_MS - 1]);

  await accept("198.51.100.9"); // any later accept does the sweeping
  const stored = hashes();
  expect(stored.filter((h) => h === null).length).toBe(1);
  expect(stored.filter((h) => h !== null).length).toBe(1);
});

test("a fresh digest is not swept while it is still doing its job", async () => {
  await accept();
  await accept("198.51.100.9");
  expect(hashes().every((h) => h !== null)).toBe(true);
});
