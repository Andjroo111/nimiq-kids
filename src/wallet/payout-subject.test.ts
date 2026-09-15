// What a relayed payout FINISHES.
//
// Tested here rather than through POST /api/payouts/broadcast because that route's happy path
// is unreachable in this suite: `SIM` is a module-level const read at import time and the
// process runs with no key, so the route refuses with `sim_no_broadcast` before it can settle
// anything (src/payout-broadcast-route.test.ts says the same thing about its own coverage).
// The function is the whole of the decision either way; the route's contribution is one call.
//
// The bug this exists to prevent is silent and complete: a parent approves a chore, signs it,
// the NIM lands at their kid's address, and the board reads "waiting for a grown-up" forever.
// Money moved and nothing said so.

import { test, expect, beforeEach } from "bun:test";
import { getDb, initTestDb } from "../db";
import * as repo from "../repo";
import * as routines from "../repo-routines";
import * as approvalsRepo from "../repo-approvals";
import * as stickersRepo from "../repo-stickers";
import { payoutRefFor } from "./kid-wallet";
import { settlePayoutSubject } from "./payout-subject";

let fam: repo.Family;
let kid: repo.Child;

beforeEach(() => {
  initTestDb();
  const f = repo.createFamily("Mom", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Sam", "🦖");
});

const submittedChore = () => {
  const chore = repo.createChore(fam.id, kid.id, "Feed the cat", 5_000, "🐈", {});
  const approval = approvalsRepo.openApproval(fam.id, kid.id, "chore", chore.id);
  return { chore, approval };
};

test("a relayed chore payout approves the chore, clears its card and shines the sticker", () => {
  const { chore, approval } = submittedChore();
  // The sticker the kid placed when they marked it done. Asserted against a REAL row: a
  // placement read through an optional call with a default would pass whether or not the
  // settlement touched it, which is a green test for the branch it was written to cover.
  const stickerId = (getDb().query("SELECT id FROM stickers LIMIT 1").get() as { id: string }).id;
  stickersRepo.placeSticker({
    childId: kid.id, subjectKind: "chore", subjectId: chore.id, day: "2026-08-02",
    stickerId, xPct: 50, yPct: 50, tiltDeg: 0, state: "pending",
  });
  const out = settlePayoutSubject(payoutRefFor("chore", chore.id));
  expect(out).toEqual({ kind: "chore", settled: true, approvalDecided: true });
  expect(repo.getChore(chore.id)!.status).toBe("approved");
  expect(approvalsRepo.getApproval(approval.id)!.status).toBe("approved");
  expect(stickersRepo.getPlacement("chore", chore.id)!.state).toBe("shined");
});

test("a relayed routine payout approves the run", () => {
  const routine = routines.createRoutine(fam.id, kid.id, "Morning", "morning");
  routines.addTask(routine.id, "Brush teeth", 120, { rewardLuna: 10_000 });
  const { run } = routines.todayRun(routine, routines.localDay(fam.tz));
  const approval = approvalsRepo.openApproval(fam.id, kid.id, "routine_run", run.id);
  const out = settlePayoutSubject(payoutRefFor("routine_run", run.id));
  expect(out).toEqual({ kind: "routine_run", settled: true, approvalDecided: true });
  expect(routines.getRun(run.id)!.status).toBe("approved");
  expect(approvalsRepo.getApproval(approval.id)!.status).toBe("approved");
});

test("settling twice is a no-op, because a relayed retry calls it again", () => {
  // The relay answers a re-post of identical bytes with `replayed: true` and the original
  // ledger row, and the route settles either way. If that second call counted, summed or
  // appended anything, a parent whose first response was lost would pay for it.
  const { chore, approval } = submittedChore();
  expect(settlePayoutSubject(payoutRefFor("chore", chore.id)).approvalDecided).toBe(true);
  const again = settlePayoutSubject(payoutRefFor("chore", chore.id));
  expect(again).toEqual({ kind: "chore", settled: true, approvalDecided: false });
  expect(repo.getChore(chore.id)!.status).toBe("approved");
  expect(approvalsRepo.getApproval(approval.id)!.decided_at).not.toBeNull();
});

test("a payout with no approval row still settles its subject", () => {
  // /api/chores/:id/approve opens one, but a household that reached this ref another way must
  // not leave the chore pending just because no card was ever in a queue.
  const chore = repo.createChore(fam.id, kid.id, "Wash up", 1_000, "🧼", {});
  const out = settlePayoutSubject(payoutRefFor("chore", chore.id));
  expect(out).toEqual({ kind: "chore", settled: true, approvalDecided: false });
  expect(repo.getChore(chore.id)!.status).toBe("approved");
});

test("a ref that names no settleable subject changes nothing", () => {
  // `repay:` and `topup:` refs share the payout_attempts table. Forcing one of them into a
  // chore lookup would either throw or, worse, match a UUID that belongs to something else.
  expect(settlePayoutSubject("repay:abc")).toEqual({ kind: null, settled: false, approvalDecided: false });
  expect(settlePayoutSubject("chore")).toEqual({ kind: null, settled: false, approvalDecided: false });
  expect(settlePayoutSubject("chore:")).toEqual({ kind: null, settled: false, approvalDecided: false });
  // A subject that no longer exists is reported as unsettled rather than pretended into one.
  expect(settlePayoutSubject("chore:gone")).toEqual({ kind: "chore", settled: false, approvalDecided: false });
});
