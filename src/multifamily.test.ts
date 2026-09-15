// Multi-family isolation (mini-app port slice 2). Two households on one instance:
// every parent-facing surface must resolve the family from the BEARER TOKEN, and a
// token from household A must never read or act on household B's rows. Hermetic:
// in-memory DB + app.request(), mirroring src/invites.test.ts.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as approvalsRepo from "./repo-approvals";
import { newToken, sha256Hex } from "./auth";
import { families } from "./routes/families";
import { children } from "./routes/children";
import { chores } from "./routes/chores";
import { approvalsRoutes } from "./routes/approvals";
import { parentRoutes } from "./routes/parent";
import { walletRoutes } from "./routes/wallet";
import { starsRoutes } from "./routes/stars";
import { lockRoutes } from "./routes/lock";
import { invitesRoutes, inviteLanding } from "./routes/invites";

const app = new Hono()
  .route("/api", families)
  .route("/api", children)
  .route("/api", chores)
  .route("/api", approvalsRoutes)
  .route("/api", parentRoutes)
  .route("/api", walletRoutes)
  .route("/api", starsRoutes)
  .route("/api", lockRoutes)
  .route("/api", invitesRoutes)
  .route("/", inviteLanding);

type House = { fam: repo.Family; kid: repo.Child; bearer: string };
let A: House;
let B: House;

async function makeHouse(label: string, kidLabel: string): Promise<House> {
  const f = repo.createFamily(label, "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  const fam = repo.getFamily(f.id)!;
  const kid = repo.createChild(fam.id, kidLabel, "🦖");
  const bearer = newToken();
  lockRepo.createParentToken(fam.id, `${label}'s phone`, await sha256Hex(bearer));
  return { fam, kid, bearer };
}

beforeEach(async () => {
  initTestDb();
  A = await makeHouse("Mom A", "Ada");
  B = await makeHouse("Dad B", "Ben");
});

const req = (bearer: string, method: string, path: string, body?: Record<string, unknown>) =>
  app.request(`http://hatch.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

// ---- dashboard / overview ----

test("parent overview is scoped to the token's own family", async () => {
  for (const [house, other] of [[A, B], [B, A]] as const) {
    const res = await req(house.bearer, "GET", "/api/parent/overview");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.family.id).toBe(house.fam.id);
    expect(body.children.map((k: { id: string }) => k.id)).toEqual([house.kid.id]);
    expect(JSON.stringify(body)).not.toContain(other.kid.id);
  }
});

test("GET /family and /children follow the bearer, not the first family", async () => {
  const famB = await (await req(B.bearer, "GET", "/api/family")).json();
  expect(famB.family.id).toBe(B.fam.id);
  const kidsB = await (await req(B.bearer, "GET", "/api/children")).json();
  expect(kidsB.children.map((k: { id: string }) => k.id)).toEqual([B.kid.id]);
});

test("POST /children with B's bearer creates the kid in B's family", async () => {
  const res = await req(B.bearer, "POST", "/api/children", { label: "Bea" });
  expect(res.status).toBe(201);
  expect((await res.json()).child.family_id).toBe(B.fam.id);
  expect(repo.listChildren(A.fam.id)).toHaveLength(1);
});

// ---- chores ----

test("A's bearer cannot read or create chores for B's kid", async () => {
  expect((await req(A.bearer, "GET", `/api/chores?childId=${B.kid.id}`)).status).toBe(404);
  const res = await req(A.bearer, "POST", "/api/chores", { childId: B.kid.id, title: "Sneaky", rewardLuna: 1000 });
  expect(res.status).toBe(404);
  expect(repo.listChores(B.fam.id)).toHaveLength(0);
});

test("a chore lives in its kid's family and A's token cannot approve B's chore", async () => {
  const made = await req(B.bearer, "POST", "/api/chores", { childId: B.kid.id, title: "Dishes", rewardLuna: 50_000 });
  const chore = (await made.json()).chore as repo.Chore;
  expect(chore.family_id).toBe(B.fam.id);
  await app.request(`http://hatch.test/api/chores/${chore.id}/submit`, { method: "POST" });

  const cross = await req(A.bearer, "POST", `/api/chores/${chore.id}/approve`, {});
  expect(cross.status).toBe(404);
  expect(repo.getChore(chore.id)!.status).toBe("submitted");

  const own = await req(B.bearer, "POST", `/api/chores/${chore.id}/approve`, {});
  expect(own.status).toBe(200);
  expect((await own.json()).paidLuna).toBe(50_000);
});

// ---- approvals queue ----

test("approvals list and decide are family-scoped", async () => {
  const made = await req(B.bearer, "POST", "/api/chores", { childId: B.kid.id, title: "Bed", rewardLuna: 10_000 });
  const chore = (await made.json()).chore as repo.Chore;
  await app.request(`http://hatch.test/api/chores/${chore.id}/submit`, { method: "POST" });
  const approval = approvalsRepo.pendingApprovalFor("chore", chore.id)!;

  const listA = await (await req(A.bearer, "GET", "/api/approvals")).json();
  expect(listA.approvals).toHaveLength(0);
  const listB = await (await req(B.bearer, "GET", "/api/approvals")).json();
  expect(listB.approvals.map((a: { id: string }) => a.id)).toEqual([approval.id]);

  expect((await req(A.bearer, "POST", `/api/approvals/${approval.id}/approve`, {})).status).toBe(404);
  expect((await req(A.bearer, "POST", `/api/approvals/${approval.id}/reject`, {})).status).toBe(404);
  expect(approvalsRepo.getApproval(approval.id)!.status).toBe("pending");
  expect((await req(B.bearer, "POST", `/api/approvals/${approval.id}/approve`, {})).status).toBe(200);
});

// ---- invites ----

test("each family gets its own invite code and accept counts stay separate", async () => {
  const invA = await (await req(A.bearer, "GET", "/api/family/invite")).json();
  const invB = await (await req(B.bearer, "GET", "/api/family/invite")).json();
  expect(invA.code).not.toBe(invB.code);
  await app.request(`http://hatch.test/api/invites/${invA.code}/accept`, { method: "POST" });
  expect((await (await req(A.bearer, "GET", "/api/family/invite")).json()).accepted).toBe(1);
  expect((await (await req(B.bearer, "GET", "/api/family/invite")).json()).accepted).toBe(0);
});

// ---- wallet ----

test("kid wallets stay per-family: B's earn never shows in A, cross-family transfer fails", async () => {
  const made = await req(B.bearer, "POST", "/api/chores", { childId: B.kid.id, title: "Trash", rewardLuna: 30_000 });
  const chore = (await made.json()).chore as repo.Chore;
  await app.request(`http://hatch.test/api/chores/${chore.id}/submit`, { method: "POST" });
  await req(B.bearer, "POST", `/api/chores/${chore.id}/approve`, {});

  const wB = await (await app.request(`http://hatch.test/api/kids/${B.kid.id}/wallet`)).json();
  expect(wB.balanceLuna).toBe(30_000);
  const wA = await (await app.request(`http://hatch.test/api/kids/${A.kid.id}/wallet`)).json();
  expect(wA.balanceLuna).toBe(0);
  expect(wA.events).toHaveLength(0);

  // Sibling transfer must stay inside one family (kid ids are capabilities, families are walls).
  const cross = await app.request(`http://hatch.test/api/kids/${B.kid.id}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toChildId: A.kid.id, valueLuna: 1000 }),
  });
  expect(cross.status).toBe(404);
  expect((await cross.json()).error).toBe("not_family");
});

test("A's bearer cannot read B's kid wallet or child record", async () => {
  expect((await req(A.bearer, "GET", `/api/kids/${B.kid.id}/wallet`)).status).toBe(404);
  expect((await req(A.bearer, "GET", `/api/children/${B.kid.id}`)).status).toBe(404);
});

test("deposit-check snapshots record under the bearer's family", async () => {
  const res = await req(B.bearer, "POST", "/api/family/deposit-check", {});
  expect(res.status).toBe(200);
  expect((await res.json()).sim).toBe(true);
});

// ---- devices / overrides ----

test("devices and overrides never cross families", async () => {
  const device = lockRepo.createDevice(A.fam.id, "Ada's tablet", await sha256Hex(newToken()), A.kid.id);

  const listB = await (await req(B.bearer, "GET", "/api/devices")).json();
  expect(listB.devices).toHaveLength(0);
  expect((await req(B.bearer, "PATCH", `/api/devices/${device.id}/allowed-apps`, { packages: ["evil.app"] })).status).toBe(404);
  expect(JSON.parse(lockRepo.getDevice(device.id)!.allowed_apps)).toEqual([]);

  // B cannot lock A's kid, and B's override never reaches A's state.
  expect((await req(B.bearer, "POST", "/api/family/override", { mode: "lock", childId: A.kid.id })).status).toBe(404);
  const ownB = await req(B.bearer, "POST", "/api/family/override", { mode: "lock" });
  expect(ownB.status).toBe(201);
  const overrideB = (await ownB.json()).override;
  expect(lockRepo.activeOverride(A.fam.id, A.kid.id)).toBeNull();
  // ...and A cannot clear B's override.
  expect((await req(A.bearer, "DELETE", `/api/family/override/${overrideB.id}`)).status).toBe(404);
});

// ---- settings ----

test("family settings PATCH follows the bearer (PIN bootstrap included)", async () => {
  const res = await req(B.bearer, "PATCH", "/api/family/settings", { newPin: "4321" });
  expect(res.status).toBe(200);
  expect(repo.getFamily(B.fam.id)!.pin_hash).not.toBeNull();
  expect(repo.getFamily(A.fam.id)!.pin_hash).toBeNull();
});

// ---- legacy single-household compat ----

test("without any bearer, instance-level surfaces still serve the FIRST household only", async () => {
  const fam = await (await app.request("http://hatch.test/api/family")).json();
  expect(fam.family.id).toBe(A.fam.id);
  const kids = await (await app.request("http://hatch.test/api/children")).json();
  expect(kids.children.map((k: { id: string }) => k.id)).toEqual([A.kid.id]);
});
