// AN EXERCISE HAS TO CARRY ITS OWN INSTRUCTIONS.
//
// A step's title is a label a kid recognises AFTER someone has shown them once
// ("Five-finger walk"). On its own it teaches nothing, so a tick-list of five of them sends
// the kid to find a grown-up before every exercise — which is the complaint `how` answers.
//
// `video_url` is the same information for the other reader. It is held on the step but shown
// on the PARENT board only: the tablet is a kiosk with no browser and its YouTube Kids carries
// approved channels only, so a link on the kid's card is a dead end. It is also rendered into
// an `href`, which is why the scheme is checked here rather than trusted.

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

const send = (method: string, path: string, body: Record<string, unknown>) =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const post = (path: string, body: Record<string, unknown>) => send("POST", path, body);
const patch = (path: string, body: Record<string, unknown>) => send("PATCH", path, body);

beforeEach(async () => {
  initTestDb();
  familyId = repo.createFamily("Mom", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000").id;
  childId = repo.createChild(familyId, "Mia", "🦄").id;
  token = newToken();
  lockRepo.createParentToken(familyId, "Mom's phone", await sha256Hex(token));
});

const piano = () => practices.createPractice(familyId, childId, "Practice piano", {
  emoji: "🎹", targetPerWeek: 2, durationS: 420, rewardLuna: 40_000_000,
});

const today = () => new Date().toISOString().slice(0, 10);
const stepView = (p: practices.Practice, i = 0) =>
  practices.practiceView(p, today()).steps[i] as { how: string | null; videoUrl: string | null };

const HOW = "Thumbs on middle C. Play 1, then 2, 3, 4, 5, saying the number out loud.";

test("the how-to reaches the kid's card", async () => {
  // The whole point: it has to survive into practiceView, which is what the tablet reads.
  const p = piano();
  const r = await post(`/api/practices/${p.id}/steps`, { title: "Five-finger walk", how: HOW });
  expect(r.status).toBe(201);
  expect(stepView(p).how).toBe(HOW);
});

test("a video link is kept, and it is on the step the parent board draws", async () => {
  const p = piano();
  await post(`/api/practices/${p.id}/steps`, {
    title: "Five-finger walk", videoUrl: "https://www.youtube.com/watch?v=piE5wYTeUW8",
  });
  expect(stepView(p).videoUrl).toBe("https://www.youtube.com/watch?v=piE5wYTeUW8");
});

test("blank is NULL, not an empty string", async () => {
  // "" and NULL would otherwise mean the same thing to a parent and different things to
  // every reader downstream — the kid's card tests `s.how` for truthiness to decide whether
  // to draw a line at all.
  const p = piano();
  await post(`/api/practices/${p.id}/steps`, { title: "Scales", how: "   ", videoUrl: "" });
  const s = practices.listSteps(p.id)[0]!;
  expect(s.how).toBeNull();
  expect(s.video_url).toBeNull();
});

test("emptying the box takes the how-to back OFF the card", async () => {
  // A parent who clears the field wants it gone. If `""` were dropped as "nothing was sent"
  // the old text would stay on the kid's row forever with no way to remove it.
  const p = piano();
  await post(`/api/practices/${p.id}/steps`, { title: "Scales", how: HOW });
  const id = practices.listSteps(p.id)[0]!.id;
  const r = await patch(`/api/practices/${p.id}/steps/${id}`, { how: "" });
  expect(r.status).toBe(200);
  expect(stepView(p).how).toBeNull();
});

test("a field that is not sent at all is left alone", async () => {
  // Repricing an exercise must not wipe the instructions on it. `undefined` and `""` are
  // deliberately different here, and this is the half that proves the difference is real.
  const p = piano();
  await post(`/api/practices/${p.id}/steps`, { title: "Scales", how: HOW });
  const id = practices.listSteps(p.id)[0]!.id;
  await patch(`/api/practices/${p.id}/steps/${id}`, { rewardLuna: 8_000_000 });
  expect(stepView(p).how).toBe(HOW);
});

test("a how-to longer than the sheet can hold is cut, not refused", async () => {
  // The cap protects the layout, not the data: five un-clamped paragraphs push "I'm done"
  // off the bottom of the kid's sheet. A parent who overshoots should not lose the save.
  const p = piano();
  const r = await post(`/api/practices/${p.id}/steps`, { title: "Scales", how: "x".repeat(900) });
  expect(r.status).toBe(201);
  expect(practices.listSteps(p.id)[0]!.how!.length).toBe(400);
});

// ---- the href guard ----
//
// `video_url` is written straight into an anchor on the parent board. A `javascript:` URL
// there is a script that runs when the next grown-up opens the sheet, so the scheme is
// checked at the door on BOTH routes. These are the mutation tests for that one line.

for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "not a url"]) {
  test(`POST refuses ${bad.slice(0, 24)}`, async () => {
    const p = piano();
    const r = await post(`/api/practices/${p.id}/steps`, { title: "Scales", videoUrl: bad });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_video_url" });
    expect(practices.listSteps(p.id)).toHaveLength(0);
  });

  test(`PATCH refuses ${bad.slice(0, 24)}`, async () => {
    const p = piano();
    await post(`/api/practices/${p.id}/steps`, { title: "Scales" });
    const id = practices.listSteps(p.id)[0]!.id;
    const r = await patch(`/api/practices/${p.id}/steps/${id}`, { videoUrl: bad });
    expect(r.status).toBe(400);
    expect(practices.listSteps(p.id)[0]!.video_url).toBeNull();
  });
}

test("http is allowed as well as https", async () => {
  // The Mini serves the family instance over the LAN; refusing plain http would rule out
  // hosting a clip on it, which is the one place a link COULD reach the tablet later.
  const p = piano();
  const r = await post(`/api/practices/${p.id}/steps`, {
    title: "Scales", videoUrl: "http://192.168.1.42:3950/clips/scales.mp4",
  });
  expect(r.status).toBe(201);
  expect(practices.listSteps(p.id)[0]!.video_url).toBe("http://192.168.1.42:3950/clips/scales.mp4");
});

test("adding instructions never changes what the day pays", async () => {
  // The rule the whole practices route is built on: adding DETAIL is not a price change.
  const p = piano();
  await post(`/api/practices/${p.id}/steps`, { title: "Scales", how: HOW });
  expect(practices.practiceView(p, today()).fullDayLuna).toBe(40_000_000);
});
