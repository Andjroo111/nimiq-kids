// A practice is made of EXERCISES, and a day pays the ones the kid ticked.
//
// Piano is scales, then the song, then sight-reading. Before this, a kid who did two of the
// three was paid for three or paid for nothing, because the whole day carried one price.
//
// The rule is not a new one: `runRewardLuna()` has always paid a routine run by summing
// reward_luna over the tasks that read 'done'. This is that rule, in the shape a practice has
// — the tick rows are the 'done' rows, and the day is still the subject.
//
// What the tests below actually defend is that ONE number survives the whole path: the pill
// on the kid's card, the amount in the parent's push, the figure on the queue card and the
// luna that leaves the wallet are all `practiceDayLuna`, and nothing in between can move it.
//
// Hermetic: in-memory DB, Hono app.request(), no chain.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as practices from "./repo-practices";
import * as approvalsRepo from "./repo-approvals";
import * as lockRepo from "./repo-lock";
import * as wrepo from "./repo-wallet";
import * as routines from "./repo-routines";
import * as memberRepo from "./repo-members";
import { hashPin, newToken, sha256Hex } from "./auth";
import { practicesRoutes } from "./routes/practices";
import { approvalsRoutes } from "./routes/approvals";

const app = new Hono()
  .route("/api", practicesRoutes)
  .route("/api", approvalsRoutes);

const PARENT = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const SCALES = 40_000;   // 0.4 NIM
const SONG = 80_000;     // 0.8 NIM
const SIGHT = 30_000;    // 0.3 NIM
const WHOLE_DAY = SCALES + SONG + SIGHT;

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

const today = () => routines.localDay(fam.tz);
const earns = () => wrepo.listWalletEvents(kid.id, 50).filter((e) => e.kind === "earn");
const pendingFor = (sessionId: string) => approvalsRepo.pendingApprovalFor("practice_session", sessionId);

/** Piano with three exercises, priced. The practice's own reward is deliberately non-zero
 *  and deliberately wrong — nothing may read it once steps exist. */
function pianoWithSteps() {
  const p = practices.createPractice(fam.id, kid.id, "Piano", { targetPerWeek: 4, rewardLuna: 999_999 });
  return {
    practice: p,
    scales: practices.addStep(p.id, "Scales", { rewardLuna: SCALES }),
    song: practices.addStep(p.id, "The song", { rewardLuna: SONG }),
    sight: practices.addStep(p.id, "Sight-reading", { rewardLuna: SIGHT }),
  };
}

const logToday = (practiceId: string, stepIds?: string[]) =>
  post(`/api/practices/${practiceId}/session`, stepIds ? { stepIds } : {});

// ---- the day pays what was ticked ------------------------------------------------

test("a day pays the sum of the TICKED steps, not the whole practice", async () => {
  const { practice, scales, song } = pianoWithSteps();
  const body = await (await logToday(practice.id, [scales.id, song.id])).json() as {
    session: { id: string }; practice: { rewardLuna: number; stepsDone: number };
  };

  // The card the kid is looking at, the approval, and the payout: one number.
  expect(body.practice.rewardLuna).toBe(SCALES + SONG);
  expect(body.practice.stepsDone).toBe(2);

  const approvalId = pendingFor(body.session.id)!.id;
  const res = await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" });
  expect(res.status).toBe(200);
  expect((await res.json() as { paidLuna: number }).paidLuna).toBe(SCALES + SONG);
  expect(earns()[0]!.value_luna).toBe(SCALES + SONG);
});

test("before the day is logged the card offers the WHOLE day", () => {
  const { practice } = pianoWithSteps();
  const view = practices.practiceView(practice, today());
  expect(view.rewardLuna).toBe(WHOLE_DAY);
  expect(view.fullDayLuna).toBe(WHOLE_DAY);
  expect(view.steps.every((s) => !s.done)).toBe(true);
});

test("the parent's board row keeps stating the whole day after the kid ticks two", async () => {
  const { practice, scales } = pianoWithSteps();
  await logToday(practice.id, [scales.id]);
  const view = practices.practiceView(practices.getPractice(practice.id)!, today());
  // What today pays vs what a day is worth: two questions, two numbers, both true.
  expect(view.rewardLuna).toBe(SCALES);
  expect(view.fullDayLuna).toBe(WHOLE_DAY);
});

test("a day with nothing ticked still counts, and owes nothing", async () => {
  const { practice } = pianoWithSteps();
  const body = await (await logToday(practice.id, [])).json() as {
    session: { id: string }; practice: { payState: string | null; rewardLuna: number };
  };
  expect(pendingFor(body.session.id)).toBeNull();
  expect(approvalsRepo.listApprovals(fam.id)).toHaveLength(0);
  expect(body.practice.payState).toBeNull();
  expect(body.practice.rewardLuna).toBe(0);
  // The day is on the record all the same: the week count and the streak are the kid's own,
  // and they have never needed a grown-up.
  expect(practices.sessionDays(practice.id, today(), today())).toEqual([today()]);
});

test("a practice with NO steps pays its own reward, exactly as before", async () => {
  const p = practices.createPractice(fam.id, kid.id, "Reading", { rewardLuna: 100_000 });
  const body = await (await logToday(p.id)).json() as {
    session: { id: string }; practice: { rewardLuna: number; steps: unknown[] };
  };
  expect(body.practice.steps).toHaveLength(0);
  expect(body.practice.rewardLuna).toBe(100_000);
  const approvalId = pendingFor(body.session.id)!.id;
  expect((await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" })).status).toBe(200);
  expect(earns()[0]!.value_luna).toBe(100_000);
});

// ---- the ticks freeze when the day is logged -------------------------------------

test("a second log the same day cannot add a step, or change what is owed", async () => {
  const { practice, scales, song, sight } = pianoWithSteps();
  const first = await (await logToday(practice.id, [scales.id])).json() as { session: { id: string } };

  const second = await (await logToday(practice.id, [song.id, sight.id])).json() as {
    session: { id: string }; practice: { rewardLuna: number };
  };
  expect(second.session.id).toBe(first.session.id);
  expect(second.practice.rewardLuna).toBe(SCALES);
  expect(practices.tickedStepIds(first.session.id)).toEqual([scales.id]);
  expect(approvalsRepo.listApprovals(fam.id)).toHaveLength(1);
});

test("a step id from ANOTHER practice is never ticked", async () => {
  const { practice, scales } = pianoWithSteps();
  const other = practices.createPractice(fam.id, kid.id, "Push-ups", { rewardLuna: 0 });
  const strayStep = practices.addStep(other.id, "Ten push-ups", { rewardLuna: 500_000 });

  const body = await (await logToday(practice.id, [scales.id, strayStep.id])).json() as {
    session: { id: string }; practice: { rewardLuna: number };
  };
  expect(body.practice.rewardLuna).toBe(SCALES);
  expect(practices.tickedStepIds(body.session.id)).toEqual([scales.id]);
});

test("a retired step cannot be ticked", async () => {
  const { practice, scales, song } = pianoWithSteps();
  practices.updateStep(song.id, { active: false });
  const body = await (await logToday(practice.id, [scales.id, song.id])).json() as {
    practice: { rewardLuna: number };
  };
  expect(body.practice.rewardLuna).toBe(SCALES);
});

test("a step RETIRED after it was ticked still pays", async () => {
  const { practice, scales, song } = pianoWithSteps();
  const { session } = await (await logToday(practice.id, [scales.id, song.id])).json() as {
    session: { id: string };
  };
  const approvalId = pendingFor(session.id)!.id;
  // Straight at the repo: the route refuses this while a day waits (the test below), and
  // what is pinned here is that the payout join does not filter on `active`.
  practices.updateStep(song.id, { active: false });

  expect((await post(`/api/approvals/${approvalId}/approve`, { pin: "1234" })).status).toBe(200);
  expect(earns()[0]!.value_luna).toBe(SCALES + SONG);
});

// ---- the price freezes while a day waits ------------------------------------------

test("repricing a step while a day waits is refused", async () => {
  const { practice, scales } = pianoWithSteps();
  await logToday(practice.id, [scales.id]);

  const res = await patch(`/api/practices/${practice.id}/steps/${scales.id}`,
    { rewardLuna: 900_000, pin: "1234" }, auth());
  expect(res.status).toBe(409);
  expect((await res.json() as { error: string }).error).toBe("day_awaiting_approval");
  expect(practices.getStep(scales.id)!.reward_luna).toBe(SCALES);
});

test("adding a step while a day waits is refused", async () => {
  const { practice, scales } = pianoWithSteps();
  await logToday(practice.id, [scales.id]);

  const res = await post(`/api/practices/${practice.id}/steps`,
    { title: "Arpeggios", rewardLuna: 10_000, pin: "1234" }, auth());
  expect(res.status).toBe(409);
  expect(practices.listSteps(practice.id)).toHaveLength(3);
});

test("retiring a step while a day waits is refused", async () => {
  const { practice, scales, sight } = pianoWithSteps();
  await logToday(practice.id, [scales.id]);

  const res = await patch(`/api/practices/${practice.id}/steps/${sight.id}`,
    { active: false, pin: "1234" }, auth());
  expect(res.status).toBe(409);
  expect(practices.getStep(sight.id)!.active).toBe(1);
});

test("the parent can price a step once the day is decided", async () => {
  const { practice, scales } = pianoWithSteps();
  const { session } = await (await logToday(practice.id, [scales.id])).json() as {
    session: { id: string };
  };
  await post(`/api/approvals/${pendingFor(session.id)!.id}/reject`, { pin: "1234" });

  const res = await patch(`/api/practices/${practice.id}/steps/${scales.id}`,
    { rewardLuna: 50_000, pin: "1234" }, auth());
  expect(res.status).toBe(200);
  expect(practices.getStep(scales.id)!.reward_luna).toBe(50_000);
});

// ---- who may price an exercise ----------------------------------------------------

test("a kid's tablet can log a day, and cannot create or price a step", async () => {
  const { practice, scales } = pianoWithSteps();
  // A REAL device bearer, not an unauthenticated request: `familyForSubject` accepts one, so
  // this is the token that actually reaches these routes from a tablet in the house.
  const device = newToken();
  lockRepo.createDevice(fam.id, "Ivy's tablet", await sha256Hex(device), kid.id);
  const asKid = { Authorization: `Bearer ${device}`, "Content-Type": "application/json" };

  expect((await post(`/api/practices/${practice.id}/session`, { stepIds: [scales.id] }, asKid)).status)
    .toBe(201);
  expect((await post(`/api/practices/${practice.id}/steps`, { title: "Extra", rewardLuna: 900_000 }, asKid)).status)
    .toBe(401);
  expect((await patch(`/api/practices/${practice.id}/steps/${scales.id}`, { rewardLuna: 900_000 }, asKid)).status)
    .toBe(401);
  expect(practices.getStep(scales.id)!.reward_luna).toBe(SCALES);
  expect(practices.listSteps(practice.id)).toHaveLength(3);
});

test("a supporter approves and pays, but cannot price an exercise", async () => {
  const { practice, scales } = pianoWithSteps();
  const supporter = memberRepo.createMember(fam.id, "Grandma Jo", "supporter");
  const supporterBearer = newToken();
  lockRepo.createParentToken(fam.id, "Grandma's phone", await sha256Hex(supporterBearer), supporter.id);

  const res = await patch(`/api/practices/${practice.id}/steps/${scales.id}`, { rewardLuna: 1 },
    { Authorization: `Bearer ${supporterBearer}`, "Content-Type": "application/json" });
  expect(res.status).toBe(403);
  expect(practices.getStep(scales.id)!.reward_luna).toBe(SCALES);
});

// ---- what the parent is shown -----------------------------------------------------

test("the queue card lists every exercise, ticked and skipped, and agrees with the amount", async () => {
  const { practice, scales, song, sight } = pianoWithSteps();
  const { session } = await (await logToday(practice.id, [scales.id, sight.id])).json() as {
    session: { id: string };
  };

  const res = await app.request("http://hatch.test/api/approvals?status=pending", { headers: auth() });
  const { approvals } = await res.json() as {
    approvals: {
      rewardLuna: number;
      summary: { title: string; tasks: { title: string; status: string; elapsedS: number | null }[] };
    }[];
  };
  const card = approvals[0]!;
  expect(card.rewardLuna).toBe(SCALES + SIGHT);
  expect(card.summary.title).toBe("Piano");
  expect(card.summary.tasks.map((t) => [t.title, t.status])).toEqual([
    ["Scales", "done"],
    ["The song", "skipped"],
    ["Sight-reading", "done"],
  ]);
  // An exercise is ticked, not timed: the card's elapsed column stays empty.
  expect(card.summary.tasks.every((t) => t.elapsedS === null)).toBe(true);
  expect(session).toBeTruthy();
  expect(song).toBeTruthy();
});

test("a practice with no steps sends the parent no exercise list", async () => {
  const p = practices.createPractice(fam.id, kid.id, "Reading", { rewardLuna: 100_000 });
  await logToday(p.id);
  const res = await app.request("http://hatch.test/api/approvals?status=pending", { headers: auth() });
  const { approvals } = await res.json() as { approvals: { summary: { tasks?: unknown[] } }[] };
  expect(approvals[0]!.summary.tasks).toBeUndefined();
});
