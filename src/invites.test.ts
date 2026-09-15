// Invite-a-family (mini-app port slice 1): parent invite endpoint, public
// accept endpoint, and the public landing page. Hermetic: in-memory DB +
// app.request(), mirroring src/parent-overview.test.ts.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as referrals from "./repo-referrals";
import { newToken, sha256Hex } from "./auth";
import { invitesRoutes, inviteLanding, siteOrigin } from "./routes/invites";
import { peerEnv } from "./client-ip";

const app = new Hono().route("/api", invitesRoutes).route("/", inviteLanding);

let fam: repo.Family;
let bearer: string;
const savedParentUrl = process.env.PARENT_URL;

beforeEach(async () => {
  initTestDb();
  delete process.env.PARENT_URL;
  const f = repo.createFamily("Mom", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Mom's phone", await sha256Hex(bearer));
});

afterEach(() => {
  if (savedParentUrl === undefined) delete process.env.PARENT_URL;
  else process.env.PARENT_URL = savedParentUrl;
});

const get = (path: string) =>
  app.request(`http://hatch.test${path}`, { headers: { Authorization: `Bearer ${bearer}` } });

// ---- repo ----

test("invite codes use the unambiguous alphabet at the fixed length", () => {
  for (let i = 0; i < 20; i++) {
    expect(referrals.generateInviteCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  }
});

test("getOrCreateInvite is stable per family", () => {
  const a = referrals.getOrCreateInvite(fam.id);
  const b = referrals.getOrCreateInvite(fam.id);
  expect(b.code).toBe(a.code);
});

test("recordAccept on an unknown code returns null and stores nothing", () => {
  expect(referrals.recordAccept("NOPE2345")).toBeNull();
  expect(referrals.countAccepts("NOPE2345")).toBe(0);
});

// ---- /api/family/invite ----

test("GET /family/invite requires the parent bearer", async () => {
  const res = await app.request("http://hatch.test/api/family/invite");
  expect(res.status).toBe(401);
});

test("GET /family/invite returns a stable code + share URL + accepted count", async () => {
  const first = await (await get("/api/family/invite")).json();
  expect(first.code).toMatch(/^[A-Z2-9]{8}$/);
  expect(first.shareUrl).toBe(`http://hatch.test/invite/${first.code}`);
  expect(first.accepted).toBe(0);
  const second = await (await get("/api/family/invite")).json();
  expect(second.code).toBe(first.code);
});

test("share URL prefers the PARENT_URL origin when configured", async () => {
  process.env.PARENT_URL = "https://hatch.internal/parent/";
  const body = await (await get("/api/family/invite")).json();
  expect(body.shareUrl).toStartWith("https://hatch.internal/invite/");
});

test("siteOrigin falls back to the request origin on a malformed PARENT_URL", () => {
  process.env.PARENT_URL = "not a url";
  expect(siteOrigin("http://hatch.test/api/family/invite")).toBe("http://hatch.test");
});

// ---- /api/invites/:code/accept ----

test("accept records attribution (case-insensitive) and the count grows", async () => {
  const invite = referrals.getOrCreateInvite(fam.id);
  const res = await app.request(`http://hatch.test/api/invites/${invite.code.toLowerCase()}/accept`, { method: "POST" });
  expect(res.status).toBe(200);
  expect(referrals.countAccepts(invite.code)).toBe(1);
  const body = await (await get("/api/family/invite")).json();
  expect(body.accepted).toBe(1);
});

test("accept of an unknown code is a 404", async () => {
  const res = await app.request("http://hatch.test/api/invites/NOPE2345/accept", { method: "POST" });
  expect(res.status).toBe(404);
});

test("a referral row carries only attribution, nothing about the invited family", () => {
  const invite = referrals.getOrCreateInvite(fam.id);
  const ref = referrals.recordAccept(invite.code)!;
  expect(Object.keys(ref).sort()).toEqual(["code", "created_at", "id", "inviter_family_id", "ip_hash", "joined_at", "status"]);
  // ip_hash is a truncated MAC keyed on a per-instance secret, never a raw IP and not
  // invertible without it; joined_at is a timestamp only.
  expect(ref.ip_hash === null || /^[0-9a-f]{16}$/.test(ref.ip_hash)).toBe(true);
});

// ---- accept dedupe + bounds (slice 2 hardening) ----

// Through the tunnel (peer 127.0.0.1), which is where a forwarded header is read at all.
const acceptAs = (code: string, ip: string) =>
  app.request(`http://hatch.test/api/invites/${code}/accept`, {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
  }, peerEnv("127.0.0.1"));

/** The same tap, arriving straight at the port rather than via the tunnel. */
const acceptDirect = (code: string, claimedIp: string) =>
  app.request(`http://hatch.test/api/invites/${code}/accept`, {
    method: "POST",
    headers: { "cf-connecting-ip": claimedIp },
  }, peerEnv("192.0.2.77"));

test("repeat accepts from one IP within a day count once; a second IP counts again", async () => {
  const invite = referrals.getOrCreateInvite(fam.id);
  for (let i = 0; i < 5; i++) expect((await acceptAs(invite.code, "203.0.113.7")).status).toBe(200);
  expect(referrals.countAccepts(invite.code)).toBe(1);
  await acceptAs(invite.code, "198.51.100.9");
  expect(referrals.countAccepts(invite.code)).toBe(2);
});

test("dedupe cannot be defeated by inventing a forwarded header per tap", async () => {
  const invite = referrals.getOrCreateInvite(fam.id);
  for (let i = 0; i < 5; i++) expect((await acceptDirect(invite.code, `203.0.113.${i}`)).status).toBe(200);
  expect(referrals.countAccepts(invite.code)).toBe(1);
});

test("accepts are row-capped per code and dedupe/cap hits still answer ok", async () => {
  const invite = referrals.getOrCreateInvite(fam.id);
  for (let i = 0; i < referrals.MAX_ACCEPTS_PER_CODE; i++) {
    referrals.recordAccept(invite.code, `hash${i}`);
  }
  expect(referrals.countAccepts(invite.code)).toBe(referrals.MAX_ACCEPTS_PER_CODE);
  expect(referrals.recordAccept(invite.code, "one-more")).toBeNull();
  expect(referrals.countAccepts(invite.code)).toBe(referrals.MAX_ACCEPTS_PER_CODE);
  expect((await acceptAs(invite.code, "192.0.2.1")).status).toBe(200); // visitor did nothing wrong
});

test("a stored ip hash is a 16-hex digest, never the raw IP", async () => {
  const invite = referrals.getOrCreateInvite(fam.id);
  await acceptAs(invite.code, "203.0.113.7");
  const rows = referrals.countAccepts(invite.code);
  expect(rows).toBe(1);
  const { getDb } = await import("./db");
  const stored = getDb().query("SELECT ip_hash FROM referrals WHERE code=?").get(invite.code) as { ip_hash: string };
  expect(stored.ip_hash).toMatch(/^[0-9a-f]{16}$/);
  expect(stored.ip_hash).not.toContain("203.0.113.7");
});

// ---- accepted -> joined (self-serve onboarding attribution) ----

test("recordJoin flips the latest accepted row to joined with a timestamp", () => {
  const invite = referrals.getOrCreateInvite(fam.id);
  referrals.recordAccept(invite.code, "hash-a");
  const joined = referrals.recordJoin(invite.code)!;
  expect(joined.status).toBe("joined");
  expect(joined.joined_at).toBeGreaterThan(0);
  expect(referrals.countJoins(invite.code)).toBe(1);
  expect(referrals.countAccepts(invite.code)).toBe(1); // flipped in place, not duplicated
});

test("recordJoin without a prior accept records a fresh joined row (landing skipped)", () => {
  const invite = referrals.getOrCreateInvite(fam.id);
  const joined = referrals.recordJoin(invite.code)!;
  expect(joined.status).toBe("joined");
  expect(referrals.countJoins(invite.code)).toBe(1);
});

test("recordJoin on an unknown code is null and the invite payload carries joined", async () => {
  expect(referrals.recordJoin("NOPE2345")).toBeNull();
  const invite = referrals.getOrCreateInvite(fam.id);
  referrals.recordJoin(invite.code);
  const body = await (await get("/api/family/invite")).json();
  expect(body.joined).toBe(1);
});

// ---- the landing page ----

test("landing renders warm copy, the deeplink, and no secrets", async () => {
  const invite = referrals.getOrCreateInvite(fam.id);
  const res = await app.request(`http://hatch.test/invite/${invite.code}`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("Mom's family invited you");
  expect(html).toContain("nimiqpay://miniapp?url=");
  expect(html).toContain(encodeURIComponent(`http://hatch.test/parent/?ref=${invite.code}`));
  expect(html).toContain("No accounts for kids, no ads, no tracking");
  expect(html).not.toContain("#t="); // never a bearer token on a public page
  expect(html).not.toMatch(/[—–]/); // brand text rule: no em/en dashes in client copy
});

test("landing HTML-escapes the parent label", async () => {
  const f2 = repo.createFamily('<script>alert("x")</script>', "NQ01");
  const invite = referrals.getOrCreateInvite(f2.id);
  const html = await (await app.request(`http://hatch.test/invite/${invite.code}`)).text();
  expect(html).not.toContain('<script>alert("x")</script>');
});

test("landing 404s an unknown code without leaking anything", async () => {
  const res = await app.request("http://hatch.test/invite/NOPE2345");
  expect(res.status).toBe(404);
  expect(await res.text()).toContain("isn't right");
});

test("viewing the landing alone records NO attribution (only accept does)", async () => {
  const invite = referrals.getOrCreateInvite(fam.id);
  await app.request(`http://hatch.test/invite/${invite.code}`);
  expect(referrals.countAccepts(invite.code)).toBe(0);
});
