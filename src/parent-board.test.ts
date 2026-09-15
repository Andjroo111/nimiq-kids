// The two edit paths a parent board needs and the app did not have: PATCH /chores/:id
// and PATCH /routines/:id (#84).
//
// The rules being pinned here are not about tidiness:
//  · Renaming CLEARS `title_key`. Everything else in the app already does this
//    (updateTask, updatePractice) because keeping our key would put OUR words back over
//    the parent's edit the moment the device language changed — the edit would look
//    applied on the phone and be gone on the tablet.
//  · A chore stops being editable once it leaves `open`. /chores/:id/approve pays
//    `reward_luna` as it reads it AT APPROVAL TIME, so editing the reward of a submitted
//    chore changes what a kid gets paid after they already did the work for the old
//    number. This is the money rule; the rest is bookkeeping.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as routines from "./repo-routines";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex, hashPin } from "./auth";
import { chores as choresRoute } from "./routes/chores";
import { routinesRoutes } from "./routes/routines";
import { jobKey, job } from "./title-catalog";

let fam: repo.Family;
let kid: repo.Child;
let bearer: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});

const auth = (withToken = true) => ({
  "content-type": "application/json",
  ...(withToken ? { Authorization: `Bearer ${bearer}` } : {}),
});

async function patchChore(id: string, body: Record<string, unknown>, withToken = true) {
  const res = await choresRoute.request(`/chores/${id}`, {
    method: "PATCH", headers: auth(withToken), body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function patchRoutine(id: string, body: Record<string, unknown>, withToken = true) {
  const res = await routinesRoutes.request(`/routines/${id}`, {
    method: "PATCH", headers: auth(withToken), body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

// ---------- chores ----------

test("PATCH /chores/:id edits the three things a parent argues about", async () => {
  const ch = repo.createChore(fam.id, kid.id, "Dishes", 500_000, "🧽");
  const r = await patchChore(ch.id, { title: "Empty the dishwasher", rewardLuna: 900_000, emoji: "🍽️" });
  expect(r.status).toBe(200);
  expect(r.json.chore.title).toBe("Empty the dishwasher");
  expect(r.json.chore.reward_luna).toBe(900_000);
  expect(r.json.chore.emoji).toBe("🍽️");
  // The row, not just the response.
  expect(repo.getChore(ch.id)!.title).toBe("Empty the dishwasher");
});

test("renaming a seeded chore clears its title_key, so our words cannot come back", async () => {
  const seeded = job("dishwasher")!;
  const ch = repo.createChore(fam.id, kid.id, seeded.en, 500_000, seeded.emoji, {
    titleKey: jobKey(seeded.id),
  });
  expect(repo.getChore(ch.id)!.title_key).toBe(jobKey(seeded.id));

  const r = await patchChore(ch.id, { title: "Feed Winston his 5pm scoop" });
  expect(r.status).toBe(200);
  expect(r.json.chore.title).toBe("Feed Winston his 5pm scoop");
  expect(repo.getChore(ch.id)!.title_key).toBeNull();
});

test("a picker tile re-sets words, emoji and key together", async () => {
  const ch = repo.createChore(fam.id, kid.id, "Whatever I typed", 500_000, "🧽");
  const tile = job("trash")!;
  const r = await patchChore(ch.id, { catalogId: tile.id });
  expect(r.status).toBe(200);
  expect(r.json.chore.title).toBe(tile.en);
  expect(r.json.chore.emoji).toBe(tile.emoji);
  expect(r.json.chore.title_key).toBe(jobKey(tile.id));
});

test("a tile wins over a title posted alongside it (they can never disagree)", async () => {
  const ch = repo.createChore(fam.id, kid.id, "Dishes", 500_000);
  const tile = job("trash")!;
  const r = await patchChore(ch.id, { catalogId: tile.id, title: "something else entirely" });
  expect(r.status).toBe(200);
  expect(r.json.chore.title).toBe(tile.en);
  expect(r.json.chore.title_key).toBe(jobKey(tile.id));
});

test("a submitted chore is NOT editable: the reward is what approval pays", async () => {
  const ch = repo.createChore(fam.id, kid.id, "Dishes", 500_000);
  repo.setChoreStatus(ch.id, "submitted");
  const r = await patchChore(ch.id, { rewardLuna: 99_000_000 });
  expect(r.status).toBe(409);
  expect(r.json.error).toBe("already_started");
  expect(repo.getChore(ch.id)!.reward_luna).toBe(500_000);
});

test("a removed chore is not editable either, it is restored first", async () => {
  const ch = repo.createChore(fam.id, kid.id, "Dishes", 500_000);
  repo.removeChore(ch.id, "kid");
  const r = await patchChore(ch.id, { title: "Nope" });
  expect(r.status).toBe(409);
  expect(r.json.error).toBe("chore_removed");
});

test("a parent's own job still has to be worth something; a kid's may be worth nothing", async () => {
  const mine = repo.createChore(fam.id, kid.id, "Dishes", 500_000, "🧽", { createdBy: "parent" });
  const refused = await patchChore(mine.id, { rewardLuna: 0 });
  expect(refused.status).toBe(400);
  expect(refused.json.error).toBe("reward_required");

  // A kid may put a job worth nothing on their own board (agency, not earning),
  // and an edit must not quietly take that away.
  const theirs = repo.createChore(fam.id, kid.id, "Tidy my room", 0, "🧸", { createdBy: "kid" });
  const ok = await patchChore(theirs.id, { rewardLuna: 0, title: "Tidy my whole room" });
  expect(ok.status).toBe(200);
  expect(ok.json.chore.reward_luna).toBe(0);
});

test("PATCH /chores/:id rejects an empty title and a negative reward", async () => {
  const ch = repo.createChore(fam.id, kid.id, "Dishes", 500_000);
  expect((await patchChore(ch.id, { title: "   " })).json.error).toBe("title_required");
  expect((await patchChore(ch.id, { rewardLuna: -1 })).json.error).toBe("invalid_reward");
});

test("PATCH /chores/:id needs a parent; a PIN works where the phone token is absent", async () => {
  const ch = repo.createChore(fam.id, kid.id, "Dishes", 500_000);
  const anon = await patchChore(ch.id, { title: "Mine now" }, false);
  expect(anon.status).toBe(401);
  expect(repo.getChore(ch.id)!.title).toBe("Dishes");

  const withPin = await patchChore(ch.id, { title: "Mine now", pin: "1234" }, false);
  expect(withPin.status).toBe(200);
});

test("PATCH /chores/:id on an unknown id is a 404, not a crash", async () => {
  expect((await patchChore("nope", { title: "x" })).status).toBe(404);
});

// ---------- routines ----------

test("PATCH /routines/:id renames, re-slots, and clears the key on a rename", async () => {
  const r0 = routines.createRoutine(fam.id, kid.id, "Morning routine", "morning", "🌅", "cat.routine.morning");
  routines.addTask(r0.id, "Brush teeth", 120, { rewardLuna: 10_000 });

  const r = await patchRoutine(r0.id, { title: "Before the bus", slot: "afternoon", emoji: "☀️" });
  expect(r.status).toBe(200);
  expect(r.json.routine.title).toBe("Before the bus");
  expect(r.json.routine.slot).toBe("afternoon");
  expect(r.json.routine.emoji).toBe("☀️");
  expect(r.json.routine.title_key).toBeNull();
  // The tasks ride along, so the caller can repaint from one response.
  expect(r.json.routine.tasks).toHaveLength(1);
});

test("PATCH /routines/:id rejects a slot the kid's board cannot show", async () => {
  const r0 = routines.createRoutine(fam.id, kid.id, "Morning", "morning");
  const r = await patchRoutine(r0.id, { slot: "midnight" });
  expect(r.status).toBe(400);
  expect(r.json.error).toBe("invalid_slot");
  expect(routines.getRoutine(r0.id)!.slot).toBe("morning");
});

test("retiring a routine hides it from every board and keeps its history", async () => {
  const r0 = routines.createRoutine(fam.id, kid.id, "Morning", "morning");
  routines.addTask(r0.id, "Brush teeth", 120, { rewardLuna: 10_000 });
  expect(routines.listRoutines(fam.id, kid.id)).toHaveLength(1);

  const r = await patchRoutine(r0.id, { active: false });
  expect(r.status).toBe(200);
  expect(routines.listRoutines(fam.id, kid.id)).toHaveLength(0);
  // The row survives, which is what makes it restorable and its runs readable.
  expect(routines.getRoutine(r0.id)).not.toBeNull();

  const back = await patchRoutine(r0.id, { active: true });
  expect(back.status).toBe(200);
  expect(routines.listRoutines(fam.id, kid.id)).toHaveLength(1);
});

test("PATCH /routines/:id needs a parent", async () => {
  const r0 = routines.createRoutine(fam.id, kid.id, "Morning", "morning");
  const anon = await patchRoutine(r0.id, { title: "Mine now" }, false);
  expect(anon.status).toBe(401);
  expect(routines.getRoutine(r0.id)!.title).toBe("Morning");
});

test("PATCH /routines/:id rejects an empty title and an unknown id", async () => {
  const r0 = routines.createRoutine(fam.id, kid.id, "Morning", "morning");
  expect((await patchRoutine(r0.id, { title: " " })).json.error).toBe("title_required");
  expect((await patchRoutine("nope", { title: "x" })).status).toBe(404);
});
