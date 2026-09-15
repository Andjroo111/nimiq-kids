// Role gates at the HTTP layer, and the one thing they must NOT do.
//
// The gate is `refuseGrownUp` (src/routes/members.ts), and its whole difficulty is that most
// board routes are not behind `requireParent`: they resolve their household through
// `familyForSubject`, which also accepts a KID TABLET's device bearer and, on a relaxed
// instance, no bearer at all. A role test written the obvious way answers 403 to every child in
// the house. The last three tests here are that regression, and they are the reason this file
// exists as well as src/members.test.ts.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as wrepo from "./repo-wallet";
import * as memberRepo from "./repo-members";
import { newToken, sha256Hex } from "./auth";
import { chores } from "./routes/chores";
import { children } from "./routes/children";
import { routinesRoutes } from "./routes/routines";
import { practicesRoutes } from "./routes/practices";
import { storeRoutes } from "./routes/store";
import { starsRoutes } from "./routes/stars";
import { lockRoutes } from "./routes/lock";
import { memberRoutes } from "./routes/members";
import { parentRoutes } from "./routes/parent";
import { onboardRoutes } from "./routes/onboard";

const app = new Hono()
  .route("/api", chores)
  .route("/api", children)
  .route("/api", routinesRoutes)
  .route("/api", practicesRoutes)
  .route("/api", storeRoutes)
  .route("/api", starsRoutes)
  .route("/api", lockRoutes)
  .route("/api", memberRoutes)
  .route("/api", parentRoutes)
  .route("/api", onboardRoutes);

// Real addresses, not plausible-looking ones: `PUT /family/members/me/address` runs them
// through the CODEC (routes/wallet normalizeNqAddress), so a wrong checksum is a 400 and the
// test would be asserting on the wrong refusal.
const WALLET = "NQ43 040G 2081 040G 2081 040G 2081 040G 2081";      // the owner's
const GRAN_WALLET = "NQ23 0810 40G2 0810 40G2 0810 40G2 0810 40G2"; // a supporter's
const KID_WALLET = "NQ44 0C1G 60Q3 0C1G 60Q3 0C1G 60Q3 0C1G 60Q3";

let fam: repo.Family;
let kid: repo.Child;
let owner: string;      // bearer
let coparent: string;   // bearer
let supporter: string;  // bearer
let supporterId: string;
let device: string;     // a kid tablet's bearer

async function phoneFor(label: string, role: memberRepo.MemberRole) {
  const m = memberRepo.createMember(fam.id, label, role);
  const bearer = newToken();
  lockRepo.createParentToken(fam.id, `${label}'s phone`, await sha256Hex(bearer), m.id);
  return { bearer, id: m.id };
}

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Mom", WALLET);
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ada", "🦖");

  owner = newToken();
  lockRepo.createParentToken(fam.id, "Mom's phone", await sha256Hex(owner), memberRepo.ownerOf(fam.id)!.id);
  coparent = (await phoneFor("Dad", "coparent")).bearer;
  const gran = await phoneFor("Grandma Jo", "supporter");
  supporter = gran.bearer;
  supporterId = gran.id;

  device = newToken();
  lockRepo.createDevice(fam.id, "Ada's tablet", await sha256Hex(device), kid.id);
});

const req = (bearer: string | null, method: string, path: string, body?: Record<string, unknown>) =>
  app.request(`http://hatch.test${path}`, {
    method,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const status = async (bearer: string | null, method: string, path: string, body?: Record<string, unknown>) =>
  (await req(bearer, method, path, body)).status;

// ---- the board: a supporter pays for work, and does not price it ----

const BOARD_WRITES: [string, string, Record<string, unknown>][] = [
  ["POST", "/api/chores", { childId: "", title: "Feed the cat", rewardLuna: 500 }],
  ["POST", "/api/routines", { childId: "", title: "Morning" }],
  ["POST", "/api/practices", { childId: "", title: "Piano", rewardLuna: 300 }],
  ["POST", "/api/children", { label: "Ben", emoji: "🦕" }],
  ["POST", "/api/parent/store/categories", { title: "Treats", icon: "medal" }],
];

test("a supporter is refused on every board write, and told it is them and not their token", async () => {
  for (const [method, path, body] of BOARD_WRITES) {
    const res = await req(supporter, method, path, { ...body, childId: kid.id });
    // 403, never 401: the token is perfectly good, so a 401 would send the app into a
    // re-authentication loop it can never win.
    expect([path, res.status]).toEqual([path, 403]);
    expect(await res.json()).toEqual({ error: "not_allowed" });
  }
});

test("a co-parent runs the board — the same five writes all land", async () => {
  for (const [method, path, body] of BOARD_WRITES) {
    const res = await req(coparent, method, path, { ...body, childId: kid.id });
    expect([path, res.status]).toEqual([path, 201]);
  }
});

test("editing a job's price is a board write too, not just creating one", async () => {
  const made = await (await req(owner, "POST", "/api/chores", {
    childId: kid.id, title: "Feed the cat", rewardLuna: 500,
  })).json() as { chore: { id: string } };
  expect(await status(supporter, "PATCH", `/api/chores/${made.chore.id}`, { rewardLuna: 900 })).toBe(403);
  expect(await status(coparent, "PATCH", `/api/chores/${made.chore.id}`, { rewardLuna: 900 })).toBe(200);
  // What it pays is the field the whole role split is about, so prove it did not move.
  expect(repo.getChore(made.chore.id)!.reward_luna).toBe(900);
});

// ---- the household: one person's, and it is the person whose household it is ----

test("a co-parent runs the board but not the house", async () => {
  expect(await status(coparent, "PATCH", "/api/family/settings", { tz: "America/Denver" })).toBe(403);
  expect(await status(coparent, "POST", "/api/parent/pair-code")).toBe(403);
  expect(await status(coparent, "POST", "/api/parent/sign-out-everywhere")).toBe(403);
  expect(await status(coparent, "PATCH", "/api/family/address", { address: WALLET })).toBe(403);
  expect(await status(supporter, "PATCH", "/api/family/settings", { tz: "America/Denver" })).toBe(403);

  expect(await status(owner, "PATCH", "/api/family/settings", { tz: "America/Denver" })).toBe(200);
  expect(repo.getFamily(fam.id)!.tz).toBe("America/Denver");
});

test("only the owner changes the roster, and never their own row", async () => {
  expect(await status(coparent, "DELETE", `/api/family/members/${supporterId}`)).toBe(403);
  expect(await status(supporter, "PATCH", `/api/family/members/${supporterId}`, { role: "coparent" })).toBe(403);

  expect(await status(owner, "PATCH", `/api/family/members/${supporterId}`, { role: "coparent" })).toBe(200);
  expect(memberRepo.getMember(supporterId)!.role).toBe("coparent");

  const ownerId = memberRepo.ownerOf(fam.id)!.id;
  expect(await status(owner, "PATCH", `/api/family/members/${ownerId}`, { role: "supporter" })).toBe(409);
  expect(await status(owner, "DELETE", `/api/family/members/${ownerId}`)).toBe(409);
});

test("removing a grown-up cuts their phone off immediately", async () => {
  expect(await status(supporter, "GET", "/api/family/members")).toBe(200);
  expect(await status(owner, "DELETE", `/api/family/members/${supporterId}`)).toBe(200);
  // Their token row is gone, so the bearer resolves to nothing at all — 401, not 403.
  expect(await status(supporter, "GET", "/api/family/members")).toBe(401);
});

// ---- everyone's own wallet ----

test("a supporter needs no role to point their approvals at their own wallet", async () => {
  const res = await req(supporter, "PUT", "/api/family/members/me/address", { address: GRAN_WALLET });
  expect(res.status).toBe(200);
  expect(memberRepo.getMember(supporterId)!.address).toBe(GRAN_WALLET);
});

test("you cannot claim a wallet somebody in this household already holds", async () => {
  // Claiming another grown-up's address would mint every one of your approvals against THEIR
  // wallet, so only they could finish paying for work you approved.
  const res = await req(supporter, "PUT", "/api/family/members/me/address", { address: WALLET });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: "address_taken", byLabel: "Mom" });
  expect(memberRepo.getMember(supporterId)!.address).toBeNull();
});

test("you cannot claim a KID's wallet either — that payout would pay itself", async () => {
  wrepo.setChildAddress(kid.id, KID_WALLET);
  const res = await req(supporter, "PUT", "/api/family/members/me/address", { address: KID_WALLET });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: "address_is_a_kid_wallet", byLabel: "Ada" });
});

test("clearing your wallet is allowed, and hands you back to the owner rather than breaking", async () => {
  await req(supporter, "PUT", "/api/family/members/me/address", { address: GRAN_WALLET });
  expect(await status(supporter, "PUT", "/api/family/members/me/address", { address: "" })).toBe(200);
  expect(memberRepo.getMember(supporterId)!.address).toBeNull();
});

// ---- THE REGRESSION: roles must be invisible to a kid's tablet ----

test("a kid tablet can still add a job to its own board", async () => {
  // No member behind a device bearer, so the gate must not fire. Getting this wrong locks
  // every child in the household out of a screen they use daily, and it would look like a
  // permission bug in the parent app rather than in the kid app.
  const res = await req(device, "POST", "/api/chores", {
    childId: kid.id, title: "Tidy my room", rewardLuna: 0, createdBy: "kid",
  });
  expect(res.status).toBe(201);
});

test("a kid tablet can still submit and read", async () => {
  const made = await (await req(owner, "POST", "/api/chores", {
    childId: kid.id, title: "Feed the cat", rewardLuna: 500,
  })).json() as { chore: { id: string } };
  expect(await status(device, "POST", `/api/chores/${made.chore.id}/submit`)).toBe(200);
  expect(await status(device, "GET", `/api/chores?childId=${kid.id}`)).toBe(200);
});

test("a kid tablet can still log a practice day", async () => {
  const made = await (await req(owner, "POST", "/api/practices", {
    childId: kid.id, title: "Piano", rewardLuna: 300,
  })).json() as { practice: { id: string } };
  expect(await status(device, "POST", `/api/practices/${made.practice.id}/session`)).toBe(201);
});

// ---- a token from another household is not a role question at all ----

test("another household's grown-up is a 404 on this household's rows, not a 403", async () => {
  const other = repo.getFamily(repo.createFamily("Someone else", WALLET).id)!;
  const bearer = newToken();
  lockRepo.createParentToken(other.id, "Their phone", await sha256Hex(bearer), memberRepo.ownerOf(other.id)!.id);
  const made = await (await req(owner, "POST", "/api/chores", {
    childId: kid.id, title: "Feed the cat", rewardLuna: 500,
  })).json() as { chore: { id: string } };
  // Whether the row exists is not their business, so the answer must not distinguish
  // "not yours" from "no such thing" — the role gate never gets a look in.
  expect(await status(bearer, "PATCH", `/api/chores/${made.chore.id}`, { rewardLuna: 1 })).toBe(404);
});

// ---- their own phone's pings ----

test("every grown-up mints their OWN notification topic, not the household's", async () => {
  // The household topic is the OWNER's and only they may mint it. A supporter tapping "turn
  // on pings" used to hit that route and get a 403 for the one thing this whole feature rests
  // on — that she hears about a job without anyone handing her a tablet.
  expect(await status(supporter, "POST", "/api/parent/notify-topic")).toBe(403);

  const res = await req(supporter, "POST", "/api/family/members/me/notify-topic");
  expect(res.status).toBe(201);
  const { notifyUrl } = await res.json() as { notifyUrl: string };
  expect(memberRepo.getMember(supporterId)!.notify_url).toBe(notifyUrl);
  // Idempotent, for the same reason the household one is: rotating a working topic silently
  // unsubscribes the phone that was working, and quiet cessation is the failure being avoided.
  const again = await req(supporter, "POST", "/api/family/members/me/notify-topic");
  expect(await again.json()).toEqual({ notifyUrl, created: false });
});

test("the overview hands a grown-up their own topic, and nobody else's", async () => {
  const url = (await (await req(supporter, "POST", "/api/family/members/me/notify-topic")).json() as { notifyUrl: string }).notifyUrl;
  const mine = await (await req(supporter, "GET", "/api/parent/overview")).json() as { member: { notifyUrl: string | null } };
  expect(mine.member.notifyUrl).toBe(url);
  // The owner's overview shows THEIR topic (none yet), never the supporter's.
  const theirs = await (await req(owner, "GET", "/api/parent/overview")).json() as { member: { notifyUrl: string | null } };
  expect(theirs.member.notifyUrl).toBeNull();
  // And the roster of everyone else never carries it at all.
  const roster = await (await req(owner, "GET", "/api/family/members")).json() as { members: Record<string, unknown>[] };
  for (const m of roster.members) expect(m).not.toHaveProperty("notifyUrl");
});
