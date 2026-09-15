// GET /api/chores/:id/approval (#117): the id the kid app needs to close the loop.
//
// A chore submit has always opened an approval row (`openApproval(..., "chore", chore.id)`),
// but there was no way to ask for its id, so the kid app's `waiting` branch had nowhere to
// go for a chore and fell through to a toast. On the seeded demo — which plants one
// submitted chore per kid *precisely* so a visitor can approve a payout and watch NIM land —
// that toast was where a judge's first action died.
//
// The route is READ ONLY. Approving still goes through POST /approvals/:id/approve and its
// parentAuth, which is what actually decides whether money moves. These tests pin that
// separation, because the client-side demo gate must never be the only lock.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as approvalsRepo from "./repo-approvals";
import { newToken, sha256Hex } from "./auth";
import { chores as choresRoutes } from "./routes/chores";

const app = new Hono().route("/api", choresRoutes);

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;
let deviceToken: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Mom", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Sam", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "phone", await sha256Hex(bearer));
  deviceToken = newToken();
  lockRepo.createDevice(fam.id, "tablet", await sha256Hex(deviceToken), kid.id);
});

const approvalOf = (choreId: string, token = deviceToken) =>
  app.request(`http://hatch.test/api/chores/${choreId}/approval`, {
    headers: { Authorization: `Bearer ${token}` },
  });

const newChore = () => repo.createChore(fam.id, kid.id, "Feed the cat", 5_000, "🐈", {});

test("a submitted chore hands back the id of its pending approval", async () => {
  const chore = newChore();
  const opened = approvalsRepo.openApproval(fam.id, kid.id, "chore", chore.id);
  const res = await approvalOf(chore.id);
  expect(res.status).toBe(200);
  expect((await res.json()).approvalId).toBe(opened.id);
});

test("a chore with nothing pending is 404, not an empty 200", async () => {
  // The kid app falls through to its "waiting for Mom" toast on this, so it has to be
  // distinguishable from a chore whose approval is genuinely open.
  const res = await approvalOf(newChore().id);
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("no_pending_approval");
});

test("an already-decided approval is not handed back", async () => {
  const chore = newChore();
  const opened = approvalsRepo.openApproval(fam.id, kid.id, "chore", chore.id);
  approvalsRepo.decideApproval(opened.id, "approved", "pin", null, null);
  expect((await approvalOf(chore.id)).status).toBe(404);
});

test("a chore that does not exist is 404", async () => {
  expect((await approvalOf("no-such-chore")).status).toBe(404);
});

test("another family's chore is 404, and reads as not-found rather than forbidden", async () => {
  // Same shape the routine route uses: a stranger learns nothing about whether the id is
  // real, which is the point of collapsing both cases onto not_found.
  const other = repo.createFamily("Neighbour", "NQ01");
  const otherKid = repo.createChild(other.id, "Theirs", "🐙");
  const theirChore = repo.createChore(other.id, otherKid.id, "Their job", 5_000, "🧽", {});
  approvalsRepo.openApproval(other.id, otherKid.id, "chore", theirChore.id);
  expect((await approvalOf(theirChore.id)).status).toBe(404);
});

test("on an auth-required instance, no token means no id", async () => {
  // familyForSubject has a documented open fall-through for a legacy single-household boot
  // (the child id is the capability there), and this route inherits it exactly as the
  // routine route does. What must hold is that a PUBLIC instance does not: those set
  // HATCH_LEGACY_BOOT=0, which is what the live boxes run.
  const before = process.env.HATCH_LEGACY_BOOT;
  process.env.HATCH_LEGACY_BOOT = "0";
  try {
    const chore = newChore();
    approvalsRepo.openApproval(fam.id, kid.id, "chore", chore.id);
    const res = await app.request(`http://hatch.test/api/chores/${chore.id}/approval`);
    expect(res.status).toBe(404);
  } finally {
    if (before === undefined) delete process.env.HATCH_LEGACY_BOOT;
    else process.env.HATCH_LEGACY_BOOT = before;
  }
});

test("the open fall-through is the SAME one the routine route already has", async () => {
  // Not a property this PR introduces, and pinned so it cannot diverge: if the routine
  // route is ever tightened, this route has to move with it rather than becoming the one
  // soft spot nobody remembers to check.
  const chore = newChore();
  approvalsRepo.openApproval(fam.id, kid.id, "chore", chore.id);
  const { routinesRoutes } = await import("./routes/routines");
  const routineApp = new Hono().route("/api", routinesRoutes);
  const routineRes = await routineApp.request("http://hatch.test/api/routine-runs/nope/approval");
  const choreRes = await app.request(`http://hatch.test/api/chores/${chore.id}/approval`);
  // The routine route 404s on a missing run; the point is that NEITHER answers 401, i.e.
  // both defer to familyForSubject rather than each inventing an auth rule.
  expect(routineRes.status).not.toBe(401);
  expect(choreRes.status).not.toBe(401);
  expect(choreRes.status).toBe(200);
});

test("the route hands back an id and NOTHING else about the approval", async () => {
  // It is reachable from a kid's tablet. An approval row carries the family, the child and
  // the subject; publishing any of that here would widen what a device token can read for
  // no reason, since the only thing the caller needs is something to POST to.
  const chore = newChore();
  approvalsRepo.openApproval(fam.id, kid.id, "chore", chore.id);
  const body = await (await approvalOf(chore.id)).json();
  expect(Object.keys(body)).toEqual(["approvalId"]);
});
