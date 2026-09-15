// Regression tests for the holes a security review found in the v0.43 approval gate.
// Each block names the thing that used to work and asserts it no longer does.
//
// Hermetic: in-memory DB, SIM, Hono app.request(). approvalPolicy() reads env at CALL
// time, so a test sets the instance shape it needs and restores it — no subprocess.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { starsRoutes } from "./routes/stars";
import { chores } from "./routes/chores";
import { children } from "./routes/children";
import { cashlinks } from "./routes/cashlinks";
import { walletRoutes } from "./routes/wallet";

const app = new Hono()
  .route("/api", starsRoutes).route("/api", chores).route("/api", children)
  .route("/api", cashlinks).route("/api", walletRoutes);

const req = (method: string, path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const ENV_VARS = ["HATCH_LEGACY_BOOT", "HATCH_REQUIRE_PARENT_APPROVAL"] as const;
const saved: Record<string, string | undefined> = {};

let fam: repo.Family;
let kid: repo.Child;
let chore: repo.Chore;
let deviceToken: string;
let parentToken: string;
let otherDeviceToken: string;

beforeEach(async () => {
  for (const k of ENV_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
  initTestDb();
  const f = repo.createFamily("Honest", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  repo.updateFamilySettings(f.id, { mode: "family" }); // what POST /api/onboard creates
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid", "🦖");
  chore = repo.createChore(fam.id, kid.id, "Make your bed", 100_000);
  deviceToken = newToken();
  lockRepo.createDevice(fam.id, "tablet", await sha256Hex(deviceToken), null);
  parentToken = newToken();
  lockRepo.createParentToken(fam.id, "phone", await sha256Hex(parentToken));

  const other = repo.createFamily("Rival", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  otherDeviceToken = newToken();
  lockRepo.createDevice(other.id, "rival tablet", await sha256Hex(otherDeviceToken), null);
});

afterEach(() => {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ---- the kid tablet must never be able to mint the grown-up credential ----

test("a DEVICE bearer cannot set the family's first PIN (the bootstrap exception is not for tablets)", async () => {
  expect(fam.pin_hash).toBeNull(); // POST /api/onboard sets none: the permanent bootstrap state
  const res = await req("PATCH", "/api/family/settings", { newPin: "9999" }, auth(deviceToken));
  expect(res.status).toBe(401);
  expect((await res.json()).error).toBe("parent_auth_required");
  expect(repo.getFamily(fam.id)!.pin_hash).toBeNull();
});

test("a DEVICE bearer cannot flip the family to demo mode (which would switch the gate off)", async () => {
  const res = await req("PATCH", "/api/family/settings", { mode: "demo", newPin: "9999" }, auth(deviceToken));
  expect(res.status).toBe(401);
  expect(repo.getFamily(fam.id)!.mode).toBe("family");
  expect(repo.getFamily(fam.id)!.pin_hash).toBeNull();
});

test("the PARENT bearer still sets the PIN and the mode — the parent app is unbroken", async () => {
  const res = await req("PATCH", "/api/family/settings", { newPin: "4321" }, auth(parentToken));
  expect(res.status).toBe(200);
  expect(repo.getFamily(fam.id)!.pin_hash).not.toBeNull();
  expect((await req("PATCH", "/api/family/settings", { mode: "demo" }, auth(parentToken))).status).toBe(200);
  expect(repo.getFamily(fam.id)!.mode).toBe("demo");
});

test("a legacy in-house tablet keeps first-run PIN setup on a relaxed instance", async () => {
  // No bearer, no strictness env: the pre-existing single-household flow, unchanged.
  const res = await req("PATCH", "/api/family/settings", { newPin: "1111" });
  expect(res.status).toBe(200);
  expect(repo.firstFamily()!.pin_hash).not.toBeNull();
});

test("an instance that forces approval refuses BOTH the anonymous PATCH and demo mode", async () => {
  process.env.HATCH_REQUIRE_PARENT_APPROVAL = "1";
  // requestFamily no longer hands an anonymous caller the legacy household.
  const anon = await req("PATCH", "/api/family/settings", { newPin: "9999" });
  expect(anon.status).toBe(401);
  expect((await anon.json()).error).toBe("pairing_required");
  // And demo mode is not on the menu at all here, even for the real parent.
  const flip = await req("PATCH", "/api/family/settings", { mode: "demo" }, auth(parentToken));
  expect(flip.status).toBe(400);
  expect((await flip.json()).error).toBe("demo_mode_unavailable");
  expect(repo.getFamily(fam.id)!.mode).toBe("family");
});

// ---- HATCH_REQUIRE_PARENT_APPROVAL is real on the chore payout path ----

test("forced instance: the whole anonymous chore-drain chain is refused at every link", async () => {
  process.env.HATCH_REQUIRE_PARENT_APPROVAL = "1";
  expect((await req("POST", "/api/children", { label: "K", emoji: "D" })).status).toBe(401);
  expect((await req("POST", "/api/chores",
    { childId: kid.id, title: "drain", rewardLuna: 400_000, createdBy: "kid" })).status).toBe(404);
  const approve = await req("POST", `/api/chores/${chore.id}/approve`, {});
  expect(approve.status).toBe(404); // the chore id stopped being a capability
  expect(repo.getChore(chore.id)!.status).not.toBe("approved");
});

test("forced instance + a DEMO-mode family: approve still demands a parent (it used to mint)", async () => {
  process.env.HATCH_REQUIRE_PARENT_APPROVAL = "1";
  repo.updateFamilySettings(fam.id, { mode: "demo" }); // the ensureFamily/legacy default
  const res = await req("POST", `/api/chores/${chore.id}/approve`, {}, auth(deviceToken));
  expect(res.status).toBe(401);
  expect((await res.json()).error).toBe("parent_auth_required");
  const body = await (await req("POST", `/api/chores/${chore.id}/approve`, {}, auth(deviceToken))).json();
  expect(body.cashlink).toBeUndefined(); // no claim secret handed to the tablet
  expect(repo.getChore(chore.id)!.status).not.toBe("approved");
});

test("relaxed instance + demo family: the demo loop still mints, byte-for-byte as before", async () => {
  repo.updateFamilySettings(fam.id, { mode: "demo" });
  const res = await req("POST", `/api/chores/${chore.id}/approve`, {});
  expect(res.status).toBe(200);
  expect((await res.json()).cashlink.valueLuna).toBe(100_000);
  expect(repo.getChore(chore.id)!.status).toBe("approved");
});

// ---- the legacy peer-cashlink path is not an unqueued door into the hot wallet ----

test("POST /children/:id/send is closed where a parent has to approve", async () => {
  repo.adjustBalance(kid.id, 100_000); // the legacy demo tally
  const res = await req("POST", `/api/children/${kid.id}/send`, { valueLuna: 100_000 }, auth(deviceToken));
  expect(res.status).toBe(403);
  expect((await res.json()).error).toBe("parent_approval_required");
  expect(repo.getChild(kid.id)!.balance_luna).toBe(100_000); // nothing debited, nothing minted
});

test("POST /children/:id/send answers to the payout budget in demo mode", async () => {
  repo.updateFamilySettings(fam.id, { mode: "demo" });
  const grant = process.env.HATCH_DEMO_GRANT_LUNA;
  const grandfather = process.env.HATCH_GRANDFATHER_FIRST;
  process.env.HATCH_DEMO_GRANT_LUNA = "0";
  process.env.HATCH_GRANDFATHER_FIRST = "0";
  try {
    repo.adjustBalance(kid.id, 100_000);
    const res = await req("POST", `/api/children/${kid.id}/send`, { valueLuna: 100_000 }, auth(deviceToken));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("budget_exhausted");
    expect(repo.getChild(kid.id)!.balance_luna).toBe(100_000);
  } finally {
    if (grant === undefined) delete process.env.HATCH_DEMO_GRANT_LUNA; else process.env.HATCH_DEMO_GRANT_LUNA = grant;
    if (grandfather === undefined) delete process.env.HATCH_GRANDFATHER_FIRST; else process.env.HATCH_GRANDFATHER_FIRST = grandfather;
  }
});

// ---- read-only subject routes: the id stops being a capability where auth is demanded ----

test("public instance: GET /children/:id no longer leaks the kid's NQ address to anyone holding the id", async () => {
  process.env.HATCH_LEGACY_BOOT = "0";
  expect((await get(`/api/children/${kid.id}`)).status).toBe(404);
  expect((await get(`/api/children/${kid.id}/stars`)).status).toBe(404);
  expect((await get(`/api/chores?childId=${kid.id}`)).status).toBe(404);
  // Another household's tablet is refused the same way.
  expect((await get(`/api/children/${kid.id}`, auth(otherDeviceToken))).status).toBe(404);
  // The household's OWN tablet still reads everything it always did.
  expect((await get(`/api/children/${kid.id}`, auth(deviceToken))).status).toBe(200);
  expect((await get(`/api/children/${kid.id}/stars`, auth(deviceToken))).status).toBe(200);
  expect((await get(`/api/chores?childId=${kid.id}`, auth(deviceToken))).status).toBe(200);
  expect((await get(`/api/children/${kid.id}`, auth(parentToken))).status).toBe(200);
});

test("relaxed instance: the subject id is still the capability (kid-tablet trust model)", async () => {
  expect((await get(`/api/children/${kid.id}`)).status).toBe(200);
  expect((await get(`/api/chores?childId=${kid.id}`)).status).toBe(200);
});

// ---- a Cashlink URL is a bearer instrument ----

test("public instance: GET /cashlinks/:id/link is scoped to the owning household", async () => {
  const cl = repo.createCashlink({
    id: crypto.randomUUID(), family_id: fam.id, chore_id: null, child_id: kid.id, kind: "payout",
    cashlink_address: "NQ07 0000 0000 0000 0000 0000 0000 0000 0000", value_luna: 100_000,
    message: "m", url: "https://hub.nimiq-testnet.com/cashlink/#secret", funding_tx_hash: "sim:1",
    status: "ready",
  });
  process.env.HATCH_LEGACY_BOOT = "0";
  expect((await get(`/api/cashlinks/${cl.id}/link`)).status).toBe(404);
  expect((await get(`/api/cashlinks/${cl.id}/link`, auth(otherDeviceToken))).status).toBe(404);
  expect((await req("POST", `/api/cashlinks/${cl.id}/claim-sim`, {})).status).toBe(404);
  const own = await get(`/api/cashlinks/${cl.id}/link`, auth(deviceToken));
  expect(own.status).toBe(200);
  expect((await own.json()).url).toContain("#secret");
});

// ---- the parent app must not call the money-gated endpoints bare ----

test("public/parent/core.js sends a bearer on every /api/kids call", async () => {
  const src = await Bun.file(new URL("../public/parent/core.js", import.meta.url)).text();
  // A bare fetch() of a money-gated endpoint 401s on both public instances and silently
  // drops the app back to the legacy balance_luna column. Everything goes through call().
  expect(src).not.toMatch(/fetch\(\s*[`'"]\/api\/kids\//);
  expect(src).not.toMatch(/fetch\(\s*`\/api\/kids\/\$/);
  expect(src).toMatch(/call\("GET", `\/api\/kids\/\$\{[^}]+\}\/wallet`\)/);
  expect(src).toMatch(/call\("GET", `\/api\/kids\/\$\{[^}]+\}\/staking`\)/);
});
