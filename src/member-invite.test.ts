// Joining a household as a grown-up: the code, the token it mints, and the ways it must fail.
//
// Hermetic — in-memory DB + app.request(), mirroring src/multifamily.test.ts.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as memberRepo from "./repo-members";
import { newToken, sha256Hex } from "./auth";
import { memberRoutes } from "./routes/members";
import { resetRateLimits } from "./rate-limit";

const app = new Hono().route("/api", memberRoutes);

const OWNER_WALLET = "NQ07 0000 0000 0000 0000 0000 0000 0000 0001";

type House = { fam: repo.Family; owner: memberRepo.Member; bearer: string };
let A: House;
let B: House;

async function makeHouse(label: string): Promise<House> {
  const f = repo.createFamily(label, OWNER_WALLET);
  repo.updateFamilySettings(f.id, { mode: "family" });
  const fam = repo.getFamily(f.id)!;
  const owner = memberRepo.ownerOf(fam.id)!;
  const bearer = newToken();
  lockRepo.createParentToken(fam.id, `${label}'s phone`, await sha256Hex(bearer), owner.id);
  return { fam, owner, bearer };
}

beforeEach(async () => {
  initTestDb();
  // The join route shares the pair-brake's per-caller allowance with /api/pair and
  // /api/devices/register (6 a minute), and those counters are process-wide. Without this the
  // seventh test in the file starts failing on the brake rather than on what it is testing.
  resetRateLimits();
  A = await makeHouse("Mom");
  B = await makeHouse("Other household");
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

async function invite(house: House, label: string, role = "supporter") {
  const res = await req(house.bearer, "POST", "/api/family/members/invite", { label, role });
  return { res, body: await res.json() as { code: string; inviteId: string } };
}

// ---- the happy path ----

test("a code joins the household, and the token that comes back knows who is holding it", async () => {
  const { res: minted, body: inv } = await invite(A, "Grandma Jo");
  expect(minted.status).toBe(201);
  expect(inv.code).toMatch(/^\d{6}$/);

  const res = await req(null, "POST", "/api/members/join", { code: inv.code });
  expect(res.status).toBe(201);
  const joined = await res.json() as { token: string; member: { id: string; label: string; role: string } };
  expect(joined.member).toMatchObject({ label: "Grandma Jo", role: "supporter" });

  // THE POINT OF ALL OF IT: the new bearer resolves to a PERSON, not just a household.
  const row = lockRepo.findParentByTokenHash(await sha256Hex(joined.token))!;
  expect(row.family_id).toBe(A.fam.id);
  expect(row.member_id).toBe(joined.member.id);
  // Labelled from the invite, so the household's session list can name the phone.
  expect(row.label).toBe("Grandma Jo's phone");
});

test("the label is the INVITER's word, not the redeemer's", async () => {
  const { body: inv } = await invite(A, "Grandma Jo");
  const res = await req(null, "POST", "/api/members/join", { code: inv.code, label: "The Owner" });
  const joined = await res.json() as { member: { label: string } };
  expect(joined.member.label).toBe("Grandma Jo");
});

test("the roster shows every grown-up, and marks which one is you", async () => {
  const { body: inv } = await invite(A, "Grandma Jo");
  await req(null, "POST", "/api/members/join", { code: inv.code });

  const roster = await (await req(A.bearer, "GET", "/api/family/members")).json() as {
    me: { role: string }; members: { label: string; role: string; isYou: boolean; canPay: boolean }[];
  };
  expect(roster.me.role).toBe("owner");
  expect(roster.members.map((m) => m.label)).toEqual(["Mom", "Grandma Jo"]);
  expect(roster.members.find((m) => m.isYou)!.label).toBe("Mom");
  // Grandma has joined but connected nothing, so the owner still covers her approvals.
  expect(roster.members.find((m) => m.label === "Grandma Jo")!.canPay).toBe(false);
});

// ---- the refusals ----

test("a code is single use", async () => {
  const { body: inv } = await invite(A, "Grandma Jo");
  expect((await req(null, "POST", "/api/members/join", { code: inv.code })).status).toBe(201);
  expect((await req(null, "POST", "/api/members/join", { code: inv.code })).status).toBe(404);
  expect(memberRepo.listMembers(A.fam.id)).toHaveLength(2); // not three
});

test("an expired code is refused, and the row is swept rather than left to rot", async () => {
  const code = "424242";
  memberRepo.createMemberInvite(A.fam.id, await sha256Hex(code), "supporter", "Late", -1);
  expect((await req(null, "POST", "/api/members/join", { code })).status).toBe(404);
  // Minting the next invite is what sweeps it: no cron, same as the app's other TTLs.
  await invite(A, "Someone");
  expect(memberRepo.listPendingInvites(A.fam.id).map((i) => i.label)).toEqual(["Someone"]);
});

test("a wrong-shaped code never reaches a lookup", async () => {
  for (const code of ["", "12345", "1234567", "abcdef", "12 34 56"]) {
    const res = await req(null, "POST", "/api/members/join", { code });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_code" });
  }
});

test("a code from household A does not admit anyone to household B", async () => {
  const { body: inv } = await invite(A, "Grandma Jo");
  await req(null, "POST", "/api/members/join", { code: inv.code });
  // It joined A, and B is untouched — a code carries its own household, and nothing about the
  // redeemer can steer it.
  expect(memberRepo.listMembers(A.fam.id)).toHaveLength(2);
  expect(memberRepo.listMembers(B.fam.id)).toHaveLength(1);
});

test("an invitation can be taken back before it is used", async () => {
  const { body: inv } = await invite(A, "Grandma Jo");
  expect((await req(A.bearer, "DELETE", `/api/family/members/invite/${inv.inviteId}`)).status).toBe(200);
  expect((await req(null, "POST", "/api/members/join", { code: inv.code })).status).toBe(404);
});

test("another household cannot revoke this one's invitation", async () => {
  const { body: inv } = await invite(A, "Grandma Jo");
  expect((await req(B.bearer, "DELETE", `/api/family/members/invite/${inv.inviteId}`)).status).toBe(404);
  expect((await req(null, "POST", "/api/members/join", { code: inv.code })).status).toBe(201);
});

test("a label is required and bounded — a roster is a screen, not a paste buffer", async () => {
  expect((await req(A.bearer, "POST", "/api/family/members/invite", { label: "  " })).status).toBe(400);
  const long = await req(A.bearer, "POST", "/api/family/members/invite", { label: "x".repeat(25) });
  expect(long.status).toBe(400);
  expect(await long.json()).toMatchObject({ error: "label_too_long", max: 24 });
});

test("nobody can be invited as an owner", async () => {
  const res = await req(A.bearer, "POST", "/api/family/members/invite", { label: "Usurper", role: "owner" });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "not_allowed" });
});

test("an unknown role is refused before anything is minted", async () => {
  const res = await req(A.bearer, "POST", "/api/family/members/invite", { label: "X", role: "boss" });
  expect(res.status).toBe(400);
  expect(memberRepo.listPendingInvites(A.fam.id)).toHaveLength(0);
});

// ---- minting an invite does not disturb a pairing in progress ----

test("inviting a grown-up leaves a live device pairing code alone", async () => {
  // The reason member_invites is its own table: createPairCode deletes the family's live code
  // every time one is minted, so sharing the table would have made inviting a grandparent
  // silently cancel a tablet pairing somebody was halfway through typing.
  const pair = lockRepo.createPairCode(A.fam.id, await sha256Hex("111111"), 5 * 60 * 1000);
  await invite(A, "Grandma Jo");
  expect(lockRepo.redeemPairCode(await sha256Hex("111111"))?.id).toBe(pair.id);
});

test("two live invitations coexist — a household invites more than one person at a time", async () => {
  const first = await invite(A, "Grandma Jo");
  const second = await invite(A, "Grandpa");
  expect(first.body.code).not.toBe(second.body.code);
  expect((await req(null, "POST", "/api/members/join", { code: first.body.code })).status).toBe(201);
  expect((await req(null, "POST", "/api/members/join", { code: second.body.code })).status).toBe(201);
  expect(memberRepo.listMembers(A.fam.id).map((m) => m.label)).toEqual(["Mom", "Grandma Jo", "Grandpa"]);
});
