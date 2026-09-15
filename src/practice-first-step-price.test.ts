// ADDING DETAIL MUST NOT SILENTLY CHANGE WHAT A DAY PAYS.
//
// A stepped practice is priced by its steps and its own `reward_luna` stops being read
// (repo-practices `fullDayLuna`). So the first exercise added to a 400 NIM piano — named,
// left at no price, saved — used to drop the day from 400 to 0. Nothing failed and nothing
// warned; the card on the kid's tablet just stopped paying for a practice they still do.
//
// The parent app's own button already promised otherwise: "Break it into exercises and each
// one carries its own share" (papp.boardSplitHint). This is the behaviour that copy describes.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as practices from "./repo-practices";
import { practicesRoutes } from "./routes/practices";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";

const app = new Hono().route("/api", practicesRoutes);

let familyId = "";
let childId = "";
let token = "";

const post = (path: string, body: Record<string, unknown>) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  initTestDb();
  familyId = repo.createFamily("Mom", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000").id;
  childId = repo.createChild(familyId, "Mia", "🦄").id;
  token = newToken();
  lockRepo.createParentToken(familyId, "Mom's phone", await sha256Hex(token));
});

/** A priced, step-less practice — Mia's piano the evening before her teacher's list lands. */
function piano(rewardLuna = 40_000_000) {
  return practices.createPractice(familyId, childId, "Practice piano", {
    emoji: "🎹", targetPerWeek: 2, durationS: 420, rewardLuna,
  });
}

const dayPrice = (id: string) =>
  practices.listSteps(id).reduce((n, s) => n + s.reward_luna, 0);

test("the first exercise inherits the practice's price, so the day still pays the same", async () => {
  const p = piano();
  const r = await post(`/api/practices/${p.id}/steps`, { title: "Scales" });
  expect(r.status).toBe(201);
  expect(dayPrice(p.id)).toBe(40_000_000);
  // `fullDayLuna` is what the parent board prints as "400 NIM a day" and what the kid's card
  // promises, so the view has to agree with the rows, not just the rows with themselves.
  expect((await r.json() as { practice: { fullDayLuna: number } }).practice.fullDayLuna).toBe(40_000_000);
});

test("a price the parent actually typed is never overridden", async () => {
  const p = piano();
  const r = await post(`/api/practices/${p.id}/steps`, { title: "Scales", rewardLuna: 10_000_000 });
  expect(r.status).toBe(201);
  expect(dayPrice(p.id)).toBe(10_000_000);
});

test("only the FIRST inherits — a later exercise left at nothing is worth nothing", async () => {
  // Once there are steps the price genuinely lives in them, and a parent adding a fourth
  // exercise at 0 is saying that one is worth nothing. That has to stay possible, or the
  // inheritance becomes a rule you cannot opt out of.
  const p = piano();
  await post(`/api/practices/${p.id}/steps`, { title: "Scales" });
  await post(`/api/practices/${p.id}/steps`, { title: "The piece" });
  expect(practices.listSteps(p.id).map((s) => s.reward_luna)).toEqual([40_000_000, 0]);
  expect(dayPrice(p.id)).toBe(40_000_000);
});

test("a practice that pays nothing still pays nothing", async () => {
  // A habit worth keeping up is not always a habit worth paying for, and reading the
  // practice's own zero must not turn into a special case that invents money.
  const p = piano(0);
  await post(`/api/practices/${p.id}/steps`, { title: "Scales" });
  expect(dayPrice(p.id)).toBe(0);
});
