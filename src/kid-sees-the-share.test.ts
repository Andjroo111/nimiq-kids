// A PARTIALLY-APPROVED JOB MUST NOT TELL THE KID IT PAID FULL PRICE (#369).
//
// The bug this pins was introduced by #366 and measured on a live instance: a chore worth
// 2 400 000 000 luna, approved at a 25% share, paid 600 000 000 and told the kid 2 400 000 000
// — while the note the parent was REQUIRED to write never left their phone.
//
// The cause was a recipe instead of an answer. `approved.js` re-derived the amount from
// `reward_luna`, under a comment promising it was "computed the way the server computes it and
// not a second pricing rule". It was correct until the server's rule moved.
//
// So the assertions split cleanly:
//   * the SERVER hands over what it paid (settledView, via the real chart endpoint), and
//   * the KID APP uses what it was handed and never recomputes.
// Anything that only checked the second half would pass on a server that lies.

import { test, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as approvalsRepo from "./repo-approvals";
import { newToken, sha256Hex } from "./auth";
import { stickersRoutes } from "./routes/stickers";
import { kidIconsMock } from "./kid-icons-mock";
import en from "./locales/en";

mock.module("../public/kid/js/icons.js", kidIconsMock);

// `t()` in util.js reads window.nimiqKidsShell and throws outright without a window. Stubbed
// against the REAL English locale rather than a fake map, so the notice tests assert the
// sentence this app actually ships instead of one invented for the test.
(globalThis as { window?: unknown }).window = {
  nimiqKidsShell: {
    t: (key: string, params?: Record<string, unknown>) =>
      String((en as Record<string, string>)[key] ?? key)
        .replace(/\{(\w+)\}/g, (m, k) => String(params?.[k] ?? m)),
  },
};
const { approvedSubjects, noticeText } = await import("../public/kid/js/approved.js");

// ---------------------------------------------------------------- the server's half
const app = new Hono().route("/api", stickersRoutes);
const FULL = 2_400_000_000;

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Mom", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Sam", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "phone", await sha256Hex(bearer));
});

const chartRow = async (choreId: string) => {
  const res = await app.request(`http://hatch.test/api/kids/${kid.id}/chart`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  const body = await res.json() as { todayTasks: Record<string, any>[] };
  return body.todayTasks.find((t) => t.choreId === choreId);
};

/** A chore the kid submitted, then a grown-up ruled on at `shareBps`. */
function ruled(shareBps: number | null, note: string | null) {
  const ch = repo.createChore(fam.id, kid.id, "Tidy your room", FULL, "🧹", {});
  const a = approvalsRepo.openApproval(fam.id, kid.id, "chore", ch.id);
  if (shareBps !== null) approvalsRepo.setApprovalShare(a.id, shareBps);
  approvalsRepo.decideApproval(a.id, "approved", "remote", null, note);
  repo.setChoreStatus(ch.id, "approved");
  return ch;
}

test("the chart reports what a quarter-share APPROVAL PAID, not the chore's price", async () => {
  const ch = ruled(2_500, "only a quarter done");
  const row = await chartRow(ch.id);
  // The promise is still there — it is what the job is advertised at, and the parent app's
  // slider needs it. The paid figure sits beside it rather than overwriting it.
  expect(row!.rewardLuna).toBe(FULL);
  expect(row!.settled).toEqual({
    paidLuna: 600_000_000, shareBps: 2_500, note: "only a quarter done",
  });
});

test("...and the reason travels with it, because the parent was made to write one", async () => {
  const ch = ruled(7_500, "the desk is still a mess");
  expect((await chartRow(ch.id))!.settled.note).toBe("the desk is still a mess");
});

test("a FULL approval pays the whole price and carries no note to explain", async () => {
  // A full yes is not a judgement about the work, so there is nothing to justify. Surfacing a
  // note here would put a parent's private reject-sheet wording on a kid's screen.
  const ch = ruled(10_000, "well done");
  expect((await chartRow(ch.id))!.settled).toEqual({
    paidLuna: FULL, shareBps: 10_000, note: null,
  });
});

test("an approval decided before partial credit existed (share NULL) pays full", async () => {
  const ch = ruled(null, null);
  expect((await chartRow(ch.id))!.settled.paidLuna).toBe(FULL);
});

test("a job nobody has ruled on has settled NULL, and never claims to have paid", async () => {
  const ch = repo.createChore(fam.id, kid.id, "Feed the dog", FULL, "🐕", {});
  expect((await chartRow(ch.id))!.settled).toBeNull();
});

// ---------------------------------------------------------------- the kid app's half
const chore = (over: Record<string, unknown> = {}) => ({
  kind: "chore", choreId: "c1", title: "Tidy your room", titleKey: null,
  status: "approved", rewardLuna: FULL, placement: null, ...over,
});

test("the kid app uses the number it was handed, and does not recompute it", () => {
  const [s] = approvedSubjects({ todayTasks: [chore({
    settled: { paidLuna: 600_000_000, shareBps: 2_500, note: "only a quarter done" },
  })] });
  expect(s.luna).toBe(600_000_000);
  expect(s.note).toBe("only a quarter done");
});

test("with no settled block it falls back to the promise rather than inventing a number", () => {
  const [s] = approvedSubjects({ todayTasks: [chore()] });
  expect(s.luna).toBe(FULL);
  expect(s.note).toBeNull();
});

test("a run's settled figure is the RUN's, never a share recomputed per task", () => {
  // floor() per task then summed does not equal floor() of the sum, and the difference is luna
  // the kid really was paid. Three 1_001-luna tasks at 25% would give 250*3 = 750 per-task; the
  // server pays floor(3003 * 0.25) = 750 here, but the point is the client must not do that
  // arithmetic at all — it takes the run-level number every task row carries.
  const t = (id: string) => ({
    kind: "task", taskRunId: id, runId: "run1", routineId: "r1",
    routineTitle: "Morning", routineTitleKey: null, status: "done", runStatus: "approved",
    rewardLuna: 1_001, placement: null,
    settled: { paidLuna: 750, shareBps: 2_500, note: "half the steps were rushed" },
  });
  const [s] = approvedSubjects({ todayTasks: [t("a"), t("b"), t("c")] });
  expect(s.luna).toBe(750); // NOT 3 * 250, and NOT the 3_003 promise
  expect(s.note).toBe("half the steps were rushed");
});

/** Only the four fields noticeText reads; the rest of ApprovedSubject is the picker's. */
const subj = (over: Record<string, unknown>) =>
  ({ key: "chore:c1", target: { kind: "chore", id: "c1" }, titleKey: null, ...over }) as never;

test("the notice says the reason out loud for one job", () => {
  const line = noticeText([subj({ title: "Tidy your room", luna: 600_000_000,
    note: "only a quarter done" })], "Mom");
  expect(line).toContain("only a quarter done");
  expect(line).toContain("Tidy your room");
});

test("...but not for several, because a kid cannot tell which job it belongs to", () => {
  const line = noticeText([
    subj({ title: "A", luna: 100, note: "only a quarter done" }),
    subj({ title: "B", luna: 100, note: "and this one too" }),
  ], "Mom");
  expect(line).not.toContain("only a quarter done");
});

test("a full yes says nothing extra", () => {
  const line = noticeText([subj({ title: "Tidy your room", luna: FULL, note: null })], "Mom");
  expect(line).toBe(noticeText([subj({ title: "Tidy your room", luna: FULL })], "Mom"));
});
