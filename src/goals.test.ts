// A goal is a LADDER: single leg, then hold it thirty seconds, then both legs.
//
// A job answers "what today" and a practice answers "how often this week". A goal answers how
// far have I got, and everything below follows from that being a THIRD axis rather than a
// variant of the other two: a rung is reached once ever, the parent's yes pays that rung's own
// price, and the ladder is finished when the top one is.
//
// The two rules worth defending are about which rungs a kid may claim. On an ordered ladder a
// rung opens only once the one below it has been CLIMBED, not merely claimed — otherwise a kid
// could take the whole ladder in the minute before a parent looks at their phone. And whether
// a ladder is ordered at all is the parent's call per goal, because both shapes really happen.
//
// Hermetic: in-memory DB, Hono app.request(), no chain.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as goals from "./repo-goals";
import * as approvalsRepo from "./repo-approvals";
import * as lockRepo from "./repo-lock";
import * as wrepo from "./repo-wallet";
import * as memberRepo from "./repo-members";
import { hashPin, newToken, sha256Hex } from "./auth";
import { goalsRoutes } from "./routes/goals";
import { approvalsRoutes } from "./routes/approvals";

const app = new Hono()
  .route("/api", goalsRoutes)
  .route("/api", approvalsRoutes);

const PARENT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const LOW = 20_000, MID = 40_000, TOP = 80_000;

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

const auth = () => ({ Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" });

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(`http://hatch.test${path}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

const patch = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(`http://hatch.test${path}`, {
    method: "PATCH", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", PARENT);
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Ivy", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});

const earns = () => wrepo.listWalletEvents(kid.id, 50).filter((e) => e.kind === "earn");
const pendingFor = (rungId: string) => approvalsRepo.pendingApprovalFor("goal_rung", rungId);

function ladder(ordered = true) {
  const g = goals.createGoal(fam.id, kid.id, "Stand on one leg", { ordered });
  return {
    goal: g,
    low: goals.addRung(g.id, "Hold it for 10 seconds", { rewardLuna: LOW }),
    mid: goals.addRung(g.id, "Hold it for 30 seconds", { rewardLuna: MID }),
    top: goals.addRung(g.id, "Both legs", { rewardLuna: TOP }),
  };
}

const claim = (goalId: string, rungId: string, headers?: Record<string, string>) =>
  post(`/api/goals/${goalId}/rungs/${rungId}/claim`, {}, headers);

const states = (goalId: string) =>
  goals.goalView(goals.getGoal(goalId)!).rungs.map((r) => r.state);

const approve = (rungId: string) =>
  post(`/api/approvals/${pendingFor(rungId)!.id}/approve`, { pin: "1234" });

// ---- climbing in order ------------------------------------------------------------

test("an ordered ladder opens only its bottom rung", () => {
  const { goal } = ladder();
  expect(states(goal.id)).toEqual(["open", "locked", "locked"]);
});

test("a locked rung is refused, whatever the tablet thinks it is drawing", async () => {
  const { goal, top } = ladder();
  const res = await claim(goal.id, top.id);
  expect(res.status).toBe(409);
  expect((await res.json() as { error: string }).error).toBe("rung_not_open");
  expect(approvalsRepo.listApprovals(fam.id)).toHaveLength(0);
});

test("CLAIMING a rung does not open the next one, only climbing it does", async () => {
  const { goal, low, mid } = ladder();
  expect((await claim(goal.id, low.id)).status).toBe(201);
  // Still locked: a kid could otherwise take the whole ladder in the minute before a
  // parent looks at their phone.
  expect(states(goal.id)).toEqual(["waiting", "locked", "locked"]);
  expect((await claim(goal.id, mid.id)).status).toBe(409);

  expect((await approve(low.id)).status).toBe(200);
  expect(states(goal.id)).toEqual(["climbed", "open", "locked"]);
  expect((await claim(goal.id, mid.id)).status).toBe(201);
});

test("an unordered ladder opens every rung at once", async () => {
  const { goal, top } = ladder(false);
  expect(states(goal.id)).toEqual(["open", "open", "open"]);
  expect((await claim(goal.id, top.id)).status).toBe(201);
  expect((await approve(top.id)).status).toBe(200);
  expect(earns()[0]!.value_luna).toBe(TOP);
});

// ---- a rung pays its own price, once ----------------------------------------------

test("approving a rung pays that rung, with its own words on it", async () => {
  const { goal, low } = ladder();
  await claim(goal.id, low.id);
  const res = await approve(low.id);
  expect(res.status).toBe(200);
  expect((await res.json() as { paidLuna: number }).paidLuna).toBe(LOW);
  expect(earns()).toHaveLength(1);
  expect(earns()[0]!.value_luna).toBe(LOW);
  expect(earns()[0]!.message).toBe("Hold it for 10 seconds");
});

test("a climbed rung cannot be claimed or paid a second time", async () => {
  const { goal, low } = ladder();
  await claim(goal.id, low.id);
  const approvalId = pendingFor(low.id)!.id;
  expect((await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" })).status).toBe(200);
  expect((await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" })).status).toBe(409);
  // And the rung itself is off the board now.
  expect((await claim(goal.id, low.id)).status).toBe(409);
  expect(earns()).toHaveLength(1);
});

test("tapping a waiting rung again opens no second approval", async () => {
  const { goal, low } = ladder();
  expect((await claim(goal.id, low.id)).status).toBe(201);
  expect((await claim(goal.id, low.id)).status).toBe(409);
  expect(approvalsRepo.listApprovals(fam.id)).toHaveLength(1);
});

test("each rung is paid separately, and the ladder finishes", async () => {
  const { goal, low, mid, top } = ladder();
  for (const rung of [low, mid, top]) {
    expect((await claim(goal.id, rung.id)).status).toBe(201);
    expect((await approve(rung.id)).status).toBe(200);
  }
  expect(earns()).toHaveLength(3);
  expect(wrepo.spendableFromLedger(kid.id)).toBe(LOW + MID + TOP);
  const view = goals.goalView(goals.getGoal(goal.id)!);
  expect(view.done).toBe(true);
  expect(view.climbed).toBe(3);
  expect(view.leftLuna).toBe(0);
});

test("what is left on the ladder is what has not been climbed", async () => {
  const { goal, low } = ladder();
  expect(goals.goalView(goal).leftLuna).toBe(LOW + MID + TOP);
  await claim(goal.id, low.id);
  await approve(low.id);
  expect(goals.goalView(goals.getGoal(goal.id)!).leftLuna).toBe(MID + TOP);
});

// ---- "not this time" sends them back ------------------------------------------------

test("declining a rung pays nothing and puts it back, unlike a practice day", async () => {
  const { goal, low, mid } = ladder();
  await claim(goal.id, low.id);
  const res = await post(`/api/approvals/${pendingFor(low.id)!.id}/reject`, { pin: "1234", note: "nearly" });
  expect(res.status).toBe(200);
  expect(earns()).toHaveLength(0);

  // A rung is a thing they could not do YET. Try again.
  expect(states(goal.id)).toEqual(["open", "locked", "locked"]);
  expect((await claim(goal.id, low.id)).status).toBe(201);
  // And the rung above stayed shut throughout: locking counts what was CLIMBED.
  expect((await claim(goal.id, mid.id)).status).toBe(409);
});

// ---- the price freezes while a rung waits --------------------------------------------

test("repricing, adding or retiring a rung is refused while one waits", async () => {
  const { goal, low, top } = ladder();
  await claim(goal.id, low.id);

  const reprice = await patch(`/api/goals/${goal.id}/rungs/${low.id}`, { rewardLuna: 900_000, pin: "1234" }, auth());
  expect(reprice.status).toBe(409);
  expect((await reprice.json() as { error: string }).error).toBe("rung_awaiting_approval");
  expect(goals.getRung(low.id)!.reward_luna).toBe(LOW);

  expect((await post(`/api/goals/${goal.id}/rungs`, { title: "Eyes shut", rewardLuna: 1, pin: "1234" }, auth())).status)
    .toBe(409);
  expect((await patch(`/api/goals/${goal.id}/rungs/${top.id}`, { active: false, pin: "1234" }, auth())).status)
    .toBe(409);
  expect(goals.listRungs(goal.id)).toHaveLength(3);
});

test("loosening the order is refused while a rung waits", async () => {
  const { goal, low } = ladder();
  await claim(goal.id, low.id);
  // Flipping it loose here would open every rung above the one the parent is looking at.
  const res = await patch(`/api/goals/${goal.id}`, { ordered: false, pin: "1234" }, auth());
  expect(res.status).toBe(409);
  expect(goals.getGoal(goal.id)!.ordered).toBe(1);
});

test("the parent can price a rung once the claim is decided", async () => {
  const { goal, low } = ladder();
  await claim(goal.id, low.id);
  await post(`/api/approvals/${pendingFor(low.id)!.id}/reject`, { pin: "1234" });
  const res = await patch(`/api/goals/${goal.id}/rungs/${low.id}`, { rewardLuna: 25_000, pin: "1234" }, auth());
  expect(res.status).toBe(200);
  expect(goals.getRung(low.id)!.reward_luna).toBe(25_000);
});

// ---- who may build a ladder ------------------------------------------------------

test("a kid's tablet can claim a rung, and cannot create or price one", async () => {
  const { goal, low } = ladder();
  const device = newToken();
  lockRepo.createDevice(fam.id, "Ivy's tablet", await sha256Hex(device), kid.id);
  const asKid = { Authorization: `Bearer ${device}`, "Content-Type": "application/json" };

  expect((await claim(goal.id, low.id, asKid)).status).toBe(201);
  expect((await post(`/api/goals/${goal.id}/rungs`, { title: "Free money", rewardLuna: 900_000 }, asKid)).status)
    .toBe(401);
  expect((await patch(`/api/goals/${goal.id}/rungs/${low.id}`, { rewardLuna: 900_000 }, asKid)).status)
    .toBe(401);
  expect(goals.getRung(low.id)!.reward_luna).toBe(LOW);
});

test("a supporter pays for the climb, and does not build the ladder", async () => {
  const { goal, low } = ladder();
  const supporter = memberRepo.createMember(fam.id, "Grandma Jo", "supporter");
  const supporterBearer = newToken();
  lockRepo.createParentToken(fam.id, "Grandma's phone", await sha256Hex(supporterBearer), supporter.id);
  const asGran = { Authorization: `Bearer ${supporterBearer}`, "Content-Type": "application/json" };

  expect((await post("/api/goals", { childId: kid.id, title: "Swim a length" }, asGran)).status).toBe(403);
  expect((await patch(`/api/goals/${goal.id}/rungs/${low.id}`, { rewardLuna: 1 }, asGran)).status).toBe(403);
  expect(goals.getRung(low.id)!.reward_luna).toBe(LOW);
});

// ---- what the parent is shown ------------------------------------------------------

test("the queue card names the rung and the ladder it belongs to", async () => {
  const { goal, low } = ladder();
  await claim(goal.id, low.id);

  const res = await app.request("http://hatch.test/api/approvals?status=pending", { headers: auth() });
  const { approvals } = await res.json() as {
    approvals: { rewardLuna: number; summary: { title: string; goalTitle: string } }[];
  };
  expect(approvals[0]!.rewardLuna).toBe(LOW);
  expect(approvals[0]!.summary.title).toBe("Hold it for 10 seconds");
  // "Hold it for 10 seconds" on its own does not tell a parent what they are looking at.
  expect(approvals[0]!.summary.goalTitle).toBe("Stand on one leg");
  expect(goal).toBeTruthy();
});

// ---- the board ---------------------------------------------------------------------

test("a retired ladder leaves the kid's board and stays on the parent's", async () => {
  const { goal } = ladder();
  goals.updateGoal(goal.id, { active: false });
  const kidView = await app.request(`http://hatch.test/api/goals?childId=${kid.id}`, {
    headers: { "Content-Type": "application/json" },
  });
  expect((await kidView.json() as { goals: unknown[] }).goals).toHaveLength(0);

  const parentView = await app.request(
    `http://hatch.test/api/goals?childId=${kid.id}&includeInactive=1`, { headers: auth() },
  );
  const seen = (await parentView.json() as { goals: { active: boolean }[] }).goals;
  expect(seen).toHaveLength(1);
  expect(seen[0]!.active).toBe(false);
});

test("a demo household climbs the ladder and pays nothing", async () => {
  repo.updateFamilySettings(fam.id, { mode: "demo" });
  const { goal, low } = ladder();
  expect((await claim(goal.id, low.id)).status).toBe(201);
  expect(pendingFor(low.id)).toBeNull();
  expect(approvalsRepo.listApprovals(fam.id)).toHaveLength(0);
});
