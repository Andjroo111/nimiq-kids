// Route-level tests for the Phase-B kiosk wiring: device pairing, /device/state
// transitions driven through the REAL repos + routes, overrides, the allowed-apps
// roundtrip, the lock-events pub/sub, and an SSE integration pass. Hermetic:
// in-memory DB + app.request(). Route tests use an always-on window (00:00-23:59,
// all days) so they hold at any wall-clock time; timing edges live in
// lock-machine.test.ts against fixed instants.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb, getDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as lockRepo from "./repo-lock";
import { hashPin, newToken, sha256Hex } from "./auth";
import { lockRoutes } from "./routes/lock";
import { walletRoutes } from "./routes/wallet";
import { routinesRoutes } from "./routes/routines";
import { approvalsRoutes } from "./routes/approvals";
import { onboardRoutes } from "./routes/onboard";
import { publishLockChange, subscribe, subscriberCount } from "./lock-events";

const SETUP_CODE = "hatch-4242";

const app = new Hono()
  .route("/api", lockRoutes)
  .route("/api", routinesRoutes)
  .route("/api", approvalsRoutes)
  .route("/api", onboardRoutes); // #364: pair codes are minted here

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
const patch = (path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.request(path, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });

let fam: repo.Family;
let kid: repo.Child;
let parentBearer: string;

beforeEach(async () => {
  initTestDb();
  process.env.KIOSK_SETUP_CODE = SETUP_CODE;
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  parentBearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(parentBearer));
});

afterEach(() => {
  delete process.env.KIOSK_SETUP_CODE;
});

const asParent = () => ({ Authorization: `Bearer ${parentBearer}` });
const asDevice = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registerDevice(childId?: string): Promise<{ deviceId: string; token: string }> {
  const res = await post("/api/devices/register", { label: "Test tablet", setupCode: SETUP_CODE, ...(childId ? { childId } : {}) });
  expect(res.status).toBe(201);
  return res.json();
}

/** Routine + 2 tasks + an always-active lock window; returns today's task runs.
 *
 *  00:00 to 00:00, NOT 00:00 to 23:59. A window is [start, end), so 23:59 leaves the last
 *  minute of the day outside it, and this file runs on the real clock: on 2026-09-02 CI ran
 *  at 23:59 Chicago and nine tests here failed at once, expecting LOCKED_ROUTINE from a
 *  window that had just closed. end <= start crosses midnight (lock-machine.ts), so 00:00 to
 *  00:00 covers the whole day with an empty tail. */
function seedRoutineWithWindow() {
  const routine = routines.createRoutine(fam.id, kid.id, "Morning", "morning");
  routines.addTask(routine.id, "Brush teeth", 120, { rewardStars: 1 });
  routines.addTask(routine.id, "Get dressed", 300, { rewardStars: 2 });
  lockRepo.addLockWindow(routine.id, "00:00", "00:00", "1111111");
  const { run, taskRuns } = routines.todayRun(routine, routines.localDay(fam.tz));
  return { routine, run, taskRuns };
}

async function deviceState(token: string) {
  const res = await app.request("/api/device/state", { headers: asDevice(token) });
  expect(res.status).toBe(200);
  return res.json();
}

// ---- pairing ----

test("register: happy path mints a one-time token; only the hash is stored", async () => {
  const { deviceId, token } = await registerDevice(kid.id);
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  const device = lockRepo.getDevice(deviceId)!;
  expect(device.child_id).toBe(kid.id);
  expect(device.token_hash).toBe(await sha256Hex(token));
  expect(device.token_hash).not.toBe(token);
});

test("register: wrong setup code 403, missing code 400, missing label 400, bad child 404", async () => {
  expect((await post("/api/devices/register", { label: "T", setupCode: "nope" })).status).toBe(403);
  expect((await post("/api/devices/register", { label: "T" })).status).toBe(400);
  expect((await post("/api/devices/register", { setupCode: SETUP_CODE })).status).toBe(400);
  expect((await post("/api/devices/register", { label: "T", setupCode: SETUP_CODE, childId: "ghost" })).status).toBe(404);
});

test("register: disabled entirely when KIOSK_SETUP_CODE is unset", async () => {
  delete process.env.KIOSK_SETUP_CODE;
  const res = await post("/api/devices/register", { label: "T", setupCode: "anything" });
  expect(res.status).toBe(403);
  expect((await res.json()).error).toBe("registration_disabled");
});

// ---- device state ----

test("device routes require a valid device token", async () => {
  expect((await app.request("/api/device/state")).status).toBe(401);
  expect((await app.request("/api/device/state", { headers: asDevice("junk") })).status).toBe(401);
});

test("state walks LOCKED_ROUTINE -> PENDING_APPROVAL -> UNLOCKED as the routine is done and approved", async () => {
  seedRoutineWithWindow();
  const { token } = await registerDevice(kid.id);

  const locked = await deviceState(token);
  expect(locked.state).toBe("LOCKED_ROUTINE");
  expect(locked.childId).toBe(kid.id);
  expect(locked.routineId).toBeDefined();
  expect(locked.allowedApps).toEqual([]);
  expect(typeof locked.serverTime).toBe("number");

  // Kid finishes every task -> run goes done_pending + an approval opens.
  const { taskRuns } = seedTaskRunsOf(locked.routineId as string);
  for (const tr of taskRuns) expect((await post(`/api/task-runs/${tr.id}/done`)).status).toBe(200);
  const pending = await deviceState(token);
  expect(pending.state).toBe("PENDING_APPROVAL");
  expect(pending.approvalId).toBeDefined();

  // Parent approves (on-tablet PIN path) -> unlocked until the next window start.
  expect((await post(`/api/approvals/${pending.approvalId}/approve`, { pin: "1234" })).status).toBe(200);
  const unlocked = await deviceState(token);
  expect(unlocked.state).toBe("UNLOCKED");
  expect(typeof unlocked.until).toBe("number");
  expect(unlocked.until).toBeGreaterThan(Date.now());
});

/** Today's task runs for a routine (created by seedRoutineWithWindow). */
function seedTaskRunsOf(routineId: string) {
  const routine = routines.getRoutine(routineId)!;
  return routines.todayRun(routine, routines.localDay(fam.tz));
}

test("a device with no bound child follows the family's first kid", async () => {
  seedRoutineWithWindow();
  const { token } = await registerDevice(); // unbound
  const state = await deviceState(token);
  expect(state.childId).toBe(kid.id);
  expect(state.state).toBe("LOCKED_ROUTINE");
});

// ---- overrides ----

test("parent override wins over the derived state and clears back", async () => {
  seedRoutineWithWindow();
  const { token } = await registerDevice(kid.id);
  expect((await deviceState(token)).state).toBe("LOCKED_ROUTINE");

  const res = await post("/api/family/override", { mode: "unlock", childId: kid.id }, asParent());
  expect(res.status).toBe(201);
  const { override } = await res.json();
  const unlocked = await deviceState(token);
  expect(unlocked.state).toBe("UNLOCKED");
  expect(unlocked.reason).toBe("override_unlock");

  // A newer family-wide lock override supersedes the kid-scoped unlock (newest active wins).
  const lockRes = await post("/api/family/override", { mode: "lock" }, asParent());
  expect(lockRes.status).toBe(201);
  const familyLock = lockRepo.activeOverride(fam.id, kid.id)!;
  expect(familyLock.mode).toBe("lock");
  expect((await deviceState(token)).reason).toBe("override_lock");

  // Clearing the family lock reveals the still-active older unlock (different scope)...
  const del1 = await app.request(`/api/family/override/${familyLock.id}`, { method: "DELETE", headers: asParent() });
  expect(del1.status).toBe(200);
  expect((await deviceState(token)).reason).toBe("override_unlock");

  // ...and clearing that too returns to the derived state.
  const del2 = await app.request(`/api/family/override/${(override as { id: string }).id}`, { method: "DELETE", headers: asParent() });
  expect(del2.status).toBe(200);
  expect((await deviceState(token)).state).toBe("LOCKED_ROUTINE");
});

test("override endpoints are parent-only and validate input", async () => {
  expect((await post("/api/family/override", { mode: "unlock" })).status).toBe(401);
  expect((await post("/api/family/override", { mode: "nope" }, asParent())).status).toBe(400);
  expect((await post("/api/family/override", { mode: "unlock", untilMs: Date.now() - 1000 }, asParent())).status).toBe(400);
  expect((await post("/api/family/override", { mode: "unlock", childId: "ghost" }, asParent())).status).toBe(404);
  expect((await app.request("/api/family/override/ghost", { method: "DELETE", headers: asParent() })).status).toBe(404);
});

// ---- installed apps / allowlist roundtrip ----

test("apps roundtrip: wrapper reports installed -> parent allowlists -> state delivers it", async () => {
  const { deviceId, token } = await registerDevice(kid.id);

  const report = await post("/api/device/apps", {
    apps: [{ pkg: "org.example.blocks", label: "Blocks" }, { pkg: "", label: "dropped" }, { pkg: "org.example.paint" }],
  }, asDevice(token));
  expect(report.status).toBe(200);
  expect((await report.json()).count).toBe(2); // empty pkg dropped, missing label defaults to pkg

  const list = await app.request("/api/devices", { headers: asParent() });
  expect(list.status).toBe(200);
  const { devices } = await list.json();
  expect(devices.length).toBe(1);
  expect(devices[0].id).toBe(deviceId);
  expect(devices[0].installedApps).toEqual([
    { pkg: "org.example.blocks", label: "Blocks" }, { pkg: "org.example.paint", label: "org.example.paint" },
  ]);
  expect(devices[0].allowedApps).toEqual([]);
  expect(devices[0].token_hash).toBeUndefined(); // hashes never leave the server

  const allow = await patch(`/api/devices/${deviceId}/allowed-apps`, { packages: ["org.example.blocks"] }, asParent());
  expect(allow.status).toBe(200);
  expect((await allow.json()).device.allowedApps).toEqual(["org.example.blocks"]);

  expect((await deviceState(token)).allowedApps).toEqual(["org.example.blocks"]);
});

test("apps/allowlist input validation and auth", async () => {
  const { deviceId, token } = await registerDevice(kid.id);
  expect((await post("/api/device/apps", { apps: "nope" }, asDevice(token))).status).toBe(400);
  expect((await patch(`/api/devices/${deviceId}/allowed-apps`, { packages: ["x"] })).status).toBe(401);
  expect((await patch(`/api/devices/${deviceId}/allowed-apps`, { packages: "x" }, asParent())).status).toBe(400);
  expect((await patch("/api/devices/ghost/allowed-apps", { packages: [] }, asParent())).status).toBe(404);
});

// ---- lock-events pub/sub ----

test("pub/sub: subscribe, publish, unsubscribe; one broken subscriber never breaks the rest", () => {
  const before = subscriberCount();
  let a = 0;
  let b = 0;
  const unsubBoom = subscribe(() => { throw new Error("boom"); });
  const unsubA = subscribe(() => { a++; });
  const unsubB = subscribe(() => { b++; });
  expect(subscriberCount()).toBe(before + 3);
  publishLockChange();
  expect(a).toBe(1);
  expect(b).toBe(1);
  unsubA();
  publishLockChange();
  expect(a).toBe(1);
  expect(b).toBe(2);
  unsubBoom();
  unsubB();
  expect(subscriberCount()).toBe(before);
});

test("mutations publish: run completion, approval decide, and override set all fire the bus", async () => {
  seedRoutineWithWindow();
  const { token } = await registerDevice(kid.id);
  let fired = 0;
  const unsub = subscribe(() => { fired++; });
  try {
    const state = await deviceState(token);
    const { taskRuns } = seedTaskRunsOf(state.routineId as string);
    for (const tr of taskRuns) await post(`/api/task-runs/${tr.id}/done`);
    expect(fired).toBe(1); // only the run-completing task publishes
    const pending = await deviceState(token);
    await post(`/api/approvals/${pending.approvalId}/approve`, { pin: "1234" });
    expect(fired).toBe(2);
    await post("/api/family/override", { mode: "lock" }, asParent());
    expect(fired).toBe(3);
  } finally {
    unsub();
  }
});

// ---- SSE integration ----

/** Read one SSE event block ("\n\n"-terminated) with a timeout. */
async function readEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>, buf: { s: string }, timeoutMs = 3000,
): Promise<{ event: string; data: string }> {
  const deadline = Date.now() + timeoutMs;
  const dec = new TextDecoder();
  while (!buf.s.includes("\n\n")) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("SSE read timeout");
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("SSE read timeout")), left)),
    ]);
    if (chunk.done) throw new Error("SSE stream closed");
    buf.s += dec.decode(chunk.value, { stream: true });
  }
  const cut = buf.s.indexOf("\n\n");
  const block = buf.s.slice(0, cut);
  buf.s = buf.s.slice(cut + 2);
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  return { event, data: data.join("\n") };
}

test("SSE stream: initial state event, then a push when an override lands", async () => {
  seedRoutineWithWindow();
  const { token } = await registerDevice(kid.id);
  const controller = new AbortController();
  const res = await app.request("/api/device/state/stream", { headers: asDevice(token), signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
  const reader = res.body!.getReader();
  const buf = { s: "" };
  try {
    const first = await readEvent(reader, buf);
    expect(first.event).toBe("state");
    expect(JSON.parse(first.data).state).toBe("LOCKED_ROUTINE");

    expect((await post("/api/family/override", { mode: "unlock" }, asParent())).status).toBe(201);
    const second = await readEvent(reader, buf);
    expect(second.event).toBe("state");
    expect(JSON.parse(second.data).state).toBe("UNLOCKED");
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
});

// ---- revocation ----
//
// The gap these close: a bearer token, once minted, was valid forever. Nothing deleted a
// device and nothing deleted a parent session, so a lost tablet kept spending a kid's NIM
// through the Treasure Box (which needs no approval at all) and the parent could watch it
// in the list and do nothing.

const del = (path: string, headers: Record<string, string> = {}) =>
  app.request(path, { method: "DELETE", headers });

test("revoking a device kills its token on the very next call", async () => {
  const { deviceId, token } = await registerDevice(kid.id);
  expect((await app.request("/api/device/state", { headers: asDevice(token) })).status).toBe(200);

  const res = await del(`/api/devices/${deviceId}`, asParent());
  expect(res.status).toBe(200);
  expect((await res.json()).revoked.id).toBe(deviceId);

  expect((await app.request("/api/device/state", { headers: asDevice(token) })).status).toBe(401);
  expect((await post("/api/device/apps", { apps: [] }, asDevice(token))).status).toBe(401);
  expect(lockRepo.getDevice(deviceId)).toBeNull();
  expect((await (await app.request("/api/devices", { headers: asParent() })).json()).devices).toHaveLength(0);
});

test("a device belonging to another household cannot be revoked, and is a 404", async () => {
  const other = repo.createFamily("Stranger", "NQ00");
  const theirs = lockRepo.createDevice(other.id, "Their tablet", await sha256Hex(newToken()), null);
  expect((await del(`/api/devices/${theirs.id}`, asParent())).status).toBe(404);
  expect(lockRepo.getDevice(theirs.id)).not.toBeNull();
  expect((await del("/api/devices/ghost", asParent())).status).toBe(404);
  expect((await del(`/api/devices/${theirs.id}`)).status).toBe(401); // no bearer at all
});

test("parent sessions are listable, and the one asking is marked as such", async () => {
  const second = newToken();
  lockRepo.createParentToken(fam.id, "Kitchen iPad", await sha256Hex(second));
  const res = await app.request("/api/parent/tokens", { headers: asParent() });
  expect(res.status).toBe(200);
  const { tokens } = await res.json();
  expect(tokens).toHaveLength(2);
  expect(tokens.filter((t: { current: boolean }) => t.current)).toHaveLength(1);
  expect(tokens.find((t: { current: boolean }) => t.current).label).toBe("Dad's phone");
  // Never the hash, never the token.
  expect(Object.keys(tokens[0]).sort()).toEqual(["createdAt", "current", "id", "label", "lastUsedAt"]);
});

test("a lost parent phone is signed out from another session and stops working", async () => {
  const lost = newToken();
  const lostRow = lockRepo.createParentToken(fam.id, "Lost phone", await sha256Hex(lost));
  expect((await app.request("/api/devices", { headers: asDevice(lost) })).status).toBe(200);

  expect((await del(`/api/parent/tokens/${lostRow.id}`, asParent())).status).toBe(200);
  expect((await app.request("/api/devices", { headers: asDevice(lost) })).status).toBe(401);
  expect((await app.request("/api/devices", { headers: asParent() })).status).toBe(200); // ours survives
});

test("the last session cannot be revoked, because nothing could mint another one", async () => {
  const mine = lockRepo.listParentTokens(fam.id)[0]!;
  const res = await del(`/api/parent/tokens/${mine.id}`, asParent());
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "last_session" });
  expect((await app.request("/api/devices", { headers: asParent() })).status).toBe(200);
});

test("another household's session is a 404, not a sign-out", async () => {
  const other = repo.createFamily("Stranger", "NQ00");
  const theirs = lockRepo.createParentToken(other.id, "Their phone", await sha256Hex(newToken()));
  expect((await del(`/api/parent/tokens/${theirs.id}`, asParent())).status).toBe(404);
  expect(lockRepo.countParentTokens(other.id)).toBe(1);
});

test("sign out everywhere takes every tablet and every other phone, and keeps this one", async () => {
  const a = await registerDevice(kid.id);
  const b = await registerDevice();
  const otherPhone = newToken();
  lockRepo.createParentToken(fam.id, "Old phone", await sha256Hex(otherPhone));
  // A bystanding household must not lose anything.
  const bystander = repo.createFamily("Neighbour", "NQ00");
  const theirDevice = lockRepo.createDevice(bystander.id, "Their tablet", await sha256Hex(newToken()), null);

  const res = await post("/api/parent/sign-out-everywhere", {}, asParent());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, devices: 2, sessions: 1 });

  expect((await app.request("/api/device/state", { headers: asDevice(a.token) })).status).toBe(401);
  expect((await app.request("/api/device/state", { headers: asDevice(b.token) })).status).toBe(401);
  expect((await app.request("/api/devices", { headers: asDevice(otherPhone) })).status).toBe(401);
  expect((await app.request("/api/devices", { headers: asParent() })).status).toBe(200); // still signed in
  expect(lockRepo.getDevice(theirDevice.id)).not.toBeNull();
  expect(lockRepo.countParentTokens(bystander.id)).toBe(0);
});

// The claim the issue is really about: a lost tablet spending a kid's real NIM. The
// Treasure Box needs no parent approval by design, so a revoked token has to stop at the
// money gate itself, not only at /device/state.
test("a revoked tablet is rejected by the kid money gate on a strict instance", async () => {
  process.env.HATCH_LEGACY_BOOT = "0"; // multi-tenant behaviour; approvalPolicy() reads env live
  try {
    const money = new Hono().route("/api", lockRoutes).route("/api", walletRoutes);
    const { deviceId, token } = await registerDevice(kid.id);
    const before = await money.request(`/api/kids/${kid.id}/wallet`, { headers: asDevice(token) });
    expect(before.status).toBe(200);

    expect((await del(`/api/devices/${deviceId}`, asParent())).status).toBe(200);

    const after = await money.request(`/api/kids/${kid.id}/wallet`, { headers: asDevice(token) });
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: "kid_auth_required" });
  } finally {
    delete process.env.HATCH_LEGACY_BOOT;
  }
});

// ---- what the PARENT can see (#305) ----
//
// The tablet's own state, told to the household that has to act on it. These lock the two
// properties the feature rests on: it is the SAME computation the tablet follows (never a
// second one that can disagree), and it carries the three things a parent needs and a tablet
// does not — the routine named, the override's author, and the last check-in.

const screenState = async () => {
  const res = await app.request("/api/parent/screen-state", { headers: asParent() });
  expect(res.status).toBe(200);
  return res.json();
};

test("screen-state: a row per paired tablet, with the routine NAMED", async () => {
  const { routine } = seedRoutineWithWindow();
  const { deviceId } = await registerDevice(kid.id);

  const { screens } = await screenState();
  expect(screens).toHaveLength(1);
  expect(screens[0]).toMatchObject({
    deviceId, deviceLabel: "Test tablet", childId: kid.id,
    state: "LOCKED_ROUTINE", reason: "routine_due",
    routineId: routine.id, routineTitle: "Morning", approvalId: null, overrideSource: null,
  });
});

test("screen-state: a household with no tablet has no screen state at all", async () => {
  seedRoutineWithWindow();
  expect((await screenState()).screens).toEqual([]);
});

test("screen-state: a waiting routine carries the approval that ends it", async () => {
  const { routine } = seedRoutineWithWindow();
  const { token } = await registerDevice(kid.id);
  const { taskRuns } = seedTaskRunsOf(routine.id);
  for (const tr of taskRuns) expect((await post(`/api/task-runs/${tr.id}/done`)).status).toBe(200);

  const [screen] = (await screenState()).screens;
  expect(screen.state).toBe("PENDING_APPROVAL");
  expect(screen.reason).toBe("awaiting_approval");
  // The id the parent's card deep-links to — and the same one the tablet was handed.
  expect(screen.approvalId).toBe((await deviceState(token)).approvalId);

  expect((await post(`/api/approvals/${screen.approvalId}/approve`, { pin: "1234" })).status).toBe(200);
  const after = (await screenState()).screens[0];
  expect(after.state).toBe("UNLOCKED");
  expect(after.approvalId).toBeNull();
  expect(after.until).toBeGreaterThan(Date.now());
});

// AUTHOR, not recency (#301). A grown-up's lock and a kid's bought minutes are both
// `override_*` and they are not the same sentence, so the ruling has to say which it is.
test("screen-state: an override names its author, and a purchase hidden under a parent row is not misreported", async () => {
  seedRoutineWithWindow();
  await registerDevice(kid.id);

  lockRepo.setOverride(fam.id, "unlock", kid.id, Date.now() + 15 * 60_000, "purchase");
  const bought = (await screenState()).screens[0];
  expect(bought).toMatchObject({ state: "UNLOCKED", reason: "override_unlock", overrideSource: "purchase" });

  // A parent lock outranks it outright, and the row the parent is shown is the parent's.
  lockRepo.setOverride(fam.id, "lock", kid.id, null, "parent");
  const grounded = (await screenState()).screens[0];
  expect(grounded).toMatchObject({ state: "LOCKED_ROUTINE", reason: "override_lock", overrideSource: "parent" });
  expect(grounded.until).toBeNull();
});

test("screen-state: another household's tablet is never listed", async () => {
  await registerDevice(kid.id);
  const other = repo.createFamily("Someone else", "NQ00");
  const otherKid = repo.createChild(other.id, "Their kid", "🐢");
  lockRepo.createDevice(other.id, "Their tablet", await sha256Hex(newToken()), otherKid.id);

  const { screens } = await screenState();
  expect(screens).toHaveLength(1);
  expect(screens[0].childId).toBe(kid.id);
});

test("screen-state: a parent bearer is required", async () => {
  await registerDevice(kid.id);
  expect((await app.request("/api/parent/screen-state")).status).toBe(401);
});

// #307 is contract drift, and this is the half of it this PR could have caused: the parent
// read must NOT have grown the tablet's payload. A wrapper in the field parses that one.
//
// The list grew ONCE, deliberately, for the screen-time meter (#377): `budgetSec`/`usedSec`
// are read by the wrapper so it can keep metering while offline. That is the bar for
// changing this assertion — a field the TABLET consumes, shipped with the wrapper that
// consumes it. A field only a parent screen wants still does not belong here, which is the
// thing this test is actually guarding and the reason it is exhaustive rather than a
// `toContain`.
test("screen-state: the tablet's payload carries only what the TABLET consumes", async () => {
  seedRoutineWithWindow();
  const { token } = await registerDevice(kid.id);
  const payload = await deviceState(token);
  expect(Object.keys(payload).sort()).toEqual(
    ["allowedApps", "budgetSec", "childId", "reason", "routineId", "serverTime", "state", "usedSec"],
  );
});

// The parent's extra fields are the other half of #307: they must be on the parent read and
// NOT on the tablet's. Asserting one without the other lets a field quietly appear on both.
test("screen-state: the meter reaches a parent in the shape a parent reads", async () => {
  const { token } = await registerDevice(kid.id);
  repo.setScreenBudget(kid.id, 60, 30);
  await post("/api/device/usage", { deltaSec: 120 }, { Authorization: `Bearer ${token}` });

  const { screens } = await screenState();
  expect(screens[0].budgetSec).toBe(3600);
  expect(screens[0].usedSec).toBe(120);
  expect(screens[0].earnedSec).toBe(0);
});

test("screen-state: an unmetered kid reports null, never a zeroed meter", async () => {
  await registerDevice(kid.id);
  const { screens } = await screenState();
  expect(screens[0].budgetSec).toBeNull();
  expect(screens[0].usedSec).toBeNull();
});

// ---- #364: the pairing code carries the kid, so nobody types a UUID ----
//
// The bug underneath these: an unbound device is not an error. deviceStateCore falls back
// to repo.listChildren(fam.id)[0], so two unbound tablets follow the SAME kid — same
// routines, same lock windows, and a parent lock aimed at one lands on both. Silently.

test("pair-code: a code minted for a kid binds the tablet that redeems it", async () => {
  const mint = await post("/api/parent/pair-code", { childId: kid.id }, asParent());
  expect(mint.status).toBe(201);
  const { code, childId } = await mint.json();
  expect(childId).toBe(kid.id);

  const res = await post("/api/devices/register", { label: "Mia's tablet", pairCode: code });
  expect(res.status).toBe(201);
  const { deviceId } = await res.json();
  expect(lockRepo.getDevice(deviceId)!.child_id).toBe(kid.id);
});

test("pair-code: a code minted with no kid still pairs, unbound, exactly as before", async () => {
  const mint = await post("/api/parent/pair-code", {}, asParent());
  expect(mint.status).toBe(201);
  const { code, childId } = await mint.json();
  expect(childId).toBeNull();

  const res = await post("/api/devices/register", { label: "Shared tablet", pairCode: code });
  expect(res.status).toBe(201);
  expect(lockRepo.getDevice((await res.json()).deviceId)!.child_id).toBeNull();
});

test("pair-code: the request body still wins, so the adb seam keeps working", async () => {
  const other = repo.createChild(fam.id, "Kid 2", "🦄");
  const { code } = await (await post("/api/parent/pair-code", { childId: kid.id }, asParent())).json();

  const res = await post("/api/devices/register", { label: "T", pairCode: code, childId: other.id });
  expect(res.status).toBe(201);
  expect(lockRepo.getDevice((await res.json()).deviceId)!.child_id).toBe(other.id);
});

test("pair-code: a kid from another household is refused at mint", async () => {
  const other = repo.createFamily("Someone else", "NQ00");
  const theirKid = repo.createChild(other.id, "Their kid", "🐢");
  const res = await post("/api/parent/pair-code", { childId: theirKid.id }, asParent());
  expect(res.status).toBe(404);
});

// The binding cannot dangle: pair_codes.child_id is a real FK, so a kid a live code points
// at cannot be deleted out from under it. (This tree retires rather than deletes anyway —
// the FK is what makes that a guarantee instead of a convention.)
test("pair-code: a live code pins its kid, so the binding cannot dangle", async () => {
  const bound = repo.createChild(fam.id, "Bound", "🦔");
  await post("/api/parent/pair-code", { childId: bound.id }, asParent());
  expect(() => getDb().run("DELETE FROM children WHERE id=?", [bound.id])).toThrow();
});

// The body path is unvalidated caller input, so its check is NOT redundant with the mint's.
test("pair-code: a valid code cannot be used to bind a kid from another household", async () => {
  const other = repo.createFamily("Someone else", "NQ00");
  const theirKid = repo.createChild(other.id, "Their kid", "🐢");
  const { code } = await (await post("/api/parent/pair-code", { childId: kid.id }, asParent())).json();

  const res = await post("/api/devices/register", { label: "T", pairCode: code, childId: theirKid.id });
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("child_not_found");
});

// The same 6 digits attach a parent PHONE at POST /api/pair, where a child binding is
// meaningless. It must be ignored there rather than doing something surprising.
test("pair-code: a kid-bound code still attaches a parent phone, ignoring the binding", async () => {
  const { code } = await (await post("/api/parent/pair-code", { childId: kid.id }, asParent())).json();
  const res = await post("/api/pair", { code });
  expect(res.status).toBe(200);
  expect((await res.json()).token).toBeTruthy();
});

// ---- #377: the screen-time meter ----
//
// Everything here is aimed at the same worry. The tablet is the only thing that can measure
// screen time, the tablet is in a child's hands, and a route that believes whatever it is
// told is a route that hands out unlimited minutes to anyone who reads the traffic once.

const usage = (token: string, body: Record<string, unknown>) =>
  post("/api/device/usage", body, asDevice(token));

test("usage: a reported delta accumulates on today's row", async () => {
  const { token } = await registerDevice(kid.id);
  await usage(token, { deltaSec: 60 });
  const r = await usage(token, { deltaSec: 30 });
  expect((await r.json()).usedSec).toBe(90);
});

test("usage: a single report cannot burn more than one sync interval", async () => {
  const { token } = await registerDevice(kid.id);
  const r = await usage(token, { deltaSec: 86_400 }); // "a whole day, in one tick"
  expect((await r.json()).usedSec).toBe(300);
});

test("usage: a negative delta cannot mint time back", async () => {
  const { token } = await registerDevice(kid.id);
  await usage(token, { deltaSec: 120 });
  expect((await usage(token, { deltaSec: -600 })).status).toBe(400);
  expect(lockRepo.usageFor(kid.id, routines.localDay(fam.tz))!.used_sec).toBe(120);
});

test("usage: the local day comes from the family tz, never from the body", async () => {
  const { token } = await registerDevice(kid.id);
  await usage(token, { deltaSec: 60, localDay: "1999-01-01" });
  // The spoofed day must not exist, and today's must hold the whole 60s.
  expect(lockRepo.usageFor(kid.id, "1999-01-01")).toBeNull();
  expect(lockRepo.usageFor(kid.id, routines.localDay(fam.tz))!.used_sec).toBe(60);
});

test("usage: nothing is burned while a parent override is in charge", async () => {
  const { token } = await registerDevice(kid.id);
  lockRepo.setOverride(fam.id, "unlock", kid.id, null);
  const r = await usage(token, { deltaSec: 300 });
  expect((await r.json()).skipped).toBe("override_active");
  expect(lockRepo.usageFor(kid.id, routines.localDay(fam.tz))).toBeNull();
});

test("usage: a device bearer is required", async () => {
  expect((await post("/api/device/usage", { deltaSec: 60 })).status).toBe(401);
});

test("meter: a spent budget locks the tablet, and the state says which lock", async () => {
  const { token } = await registerDevice(kid.id);
  repo.setScreenBudget(kid.id, 5, 0); // 5 minutes
  expect((await deviceState(token)).state).toBe("UNLOCKED");
  for (let i = 0; i < 1; i++) await usage(token, { deltaSec: 300 });
  const after = await deviceState(token);
  expect(after.state).toBe("LOCKED_BUDGET");
  expect(after.reason).toBe("budget_spent");
});

test("meter: bought minutes raise today's budget and reopen the tablet", async () => {
  const { token } = await registerDevice(kid.id);
  repo.setScreenBudget(kid.id, 5, 30);
  await usage(token, { deltaSec: 300 });
  expect((await deviceState(token)).state).toBe("LOCKED_BUDGET");

  lockRepo.addEarnedSec(kid.id, routines.localDay(fam.tz), 15 * 60);
  const after = await deviceState(token);
  expect(after.state).toBe("UNLOCKED");
  expect(after.budgetSec).toBe(5 * 60 + 15 * 60);
});

test("meter: an unmetered kid is never locked by the budget rule", async () => {
  const { token } = await registerDevice(kid.id);
  await usage(token, { deltaSec: 300 });
  const after = await deviceState(token);
  expect(after.state).toBe("UNLOCKED");
  expect(after.budgetSec).toBe(0);
});

// ---- #377: the curfew ----

const putWindows = (windows: unknown[], headers: Record<string, string> = asParent()) =>
  app.request("/api/family/allow-windows", {
    method: "PUT", body: JSON.stringify({ windows }),
    headers: { "Content-Type": "application/json", ...headers },
  });

/** A one-hour curfew window that provably does NOT contain right now, in the family's tz.
 *  A hardcoded "03:00-03:01" would pass for 1439 minutes of the day and silently assert
 *  nothing for the other one — the suite runs at whatever time CI happens to start. */
function windowExcludingNow(): { startHhmm: string; endHhmm: string; days: string } {
  const hh = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: fam.tz, hour: "2-digit", hourCycle: "h23",
  }).format(new Date()));
  const start = (hh + 3) % 24; // 3 hours out, so neither edge can graze the current minute
  return { startHhmm: `${String(start).padStart(2, "0")}:00`, endHhmm: `${String(start).padStart(2, "0")}:30`, days: "1111111" };
}

test("curfew: a saved schedule locks the tablet outside its hours", async () => {
  const { token } = await registerDevice(kid.id);
  expect((await putWindows([windowExcludingNow()])).status).toBe(200);
  const after = await deviceState(token);
  expect(after.state).toBe("LOCKED_HOURS");
  expect(after.reason).toBe("outside_hours");
  expect(after.until).toBeGreaterThan(Date.now()); // the lock screen has something to count to
});

test("curfew: an all-day window leaves the tablet open", async () => {
  const { token } = await registerDevice(kid.id);
  // Two halves rather than 00:00 to 23:59 (a hole at the last minute, see
  // seedRoutineWithWindow) or 00:00 to 00:00 (the allow-windows route refuses an equal pair as
  // empty_window). The second half crosses midnight into an empty tail.
  await putWindows([
    { startHhmm: "00:00", endHhmm: "12:00", days: "1111111" },
    { startHhmm: "12:00", endHhmm: "00:00", days: "1111111" },
  ]);
  expect((await deviceState(token)).state).toBe("UNLOCKED");
});

test("curfew: an empty list clears it (the curfew is opt-in, and opt-out)", async () => {
  const { token } = await registerDevice(kid.id);
  await putWindows([windowExcludingNow()]);
  await putWindows([]);
  expect((await deviceState(token)).state).toBe("UNLOCKED");
  expect(lockRepo.allowWindowsForFamily(fam.id)).toHaveLength(0);
});

test("curfew: start === end is refused, not read as an all-day window", async () => {
  // windowActive treats end <= start as midnight-crossing, so 09:00-09:00 would be
  // permanently ON — the exact opposite of what typing one time twice means.
  expect((await putWindows([{ startHhmm: "09:00", endHhmm: "09:00", days: "1111111" }])).status).toBe(400);
});

test("curfew: malformed times and day masks are refused", async () => {
  expect((await putWindows([{ startHhmm: "7:00", endHhmm: "20:00", days: "1111111" }])).status).toBe(400);
  expect((await putWindows([{ startHhmm: "25:00", endHhmm: "26:00", days: "1111111" }])).status).toBe(400);
  expect((await putWindows([{ startHhmm: "07:00", endHhmm: "20:00", days: "111" }])).status).toBe(400);
  expect((await putWindows([{ startHhmm: "07:00", endHhmm: "20:00", days: "1111112" }])).status).toBe(400);
});

test("curfew: a parent bearer is required, and it is family-scoped", async () => {
  expect((await putWindows([], {})).status).toBe(401);
  await putWindows([{ startHhmm: "07:00", endHhmm: "20:00", days: "1111111" }]);
  const other = repo.createFamily("Someone else", "NQ00");
  expect(lockRepo.allowWindowsForFamily(other.id)).toHaveLength(0);
});

test("screen-budget: a parent turns the meter on and off for one kid", async () => {
  const on = await patch(`/api/children/${kid.id}/screen-budget`, { dailyMin: 60, maxEarnedMin: 30 }, asParent());
  expect(await on.json()).toEqual({ dailyMin: 60, maxEarnedMin: 30, playMin: 0, restMin: 0 });
  const off = await patch(`/api/children/${kid.id}/screen-budget`, { dailyMin: 0 }, asParent());
  expect((await off.json()).dailyMin).toBe(0);
});

test("screen-budget: another household's kid is not found", async () => {
  const other = repo.createFamily("Someone else", "NQ00");
  const theirs = repo.createChild(other.id, "Their kid", "🐢");
  expect((await patch(`/api/children/${theirs.id}/screen-budget`, { dailyMin: 60 }, asParent())).status).toBe(404);
});
