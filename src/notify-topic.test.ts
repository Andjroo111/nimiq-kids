// The topic a parent's phone subscribes to (#124).
//
// A topic URL is a BEARER SECRET: anyone holding it reads every notification this family
// ever gets, and on ntfy's public server nothing else guards it. That is why the parent is
// never asked to invent one, and why the properties below are pinned rather than assumed.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { parentRoutes } from "./routes/parent";
import { newNotifyTopic, newNotifyUrl, ntfyBase, NTFY_TOPIC_RE } from "./notify-topic";

test("a topic is 32 characters of base64url, which is exactly what ntfy accepts", () => {
  const topic = newNotifyTopic();
  expect(topic).toHaveLength(32);
  expect(topic).toMatch(NTFY_TOPIC_RE);
});

test("topics do not repeat", () => {
  // 192 bits, so a collision here means the generator is not random rather than that we
  // got unlucky. 500 is enough to catch a constant, a counter, or a seeded PRNG.
  const seen = new Set(Array.from({ length: 500 }, () => newNotifyTopic()));
  expect(seen.size).toBe(500);
});

test("every base64url character appears, so no alphabet slice is unreachable", () => {
  // Guards the bug this deliberately avoids: mapping random bytes onto an alphabet with
  // `% n` biases the first `256 % n` characters, and the shortfall is invisible unless
  // you look for it. base64url has no modulo, so the distribution is flat by construction.
  const chars = new Set([...Array.from({ length: 400 }, () => newNotifyTopic()).join("")]);
  expect(chars.size).toBeGreaterThan(60);   // 64 possible, minus whatever 400 samples miss
});

test("the base URL is the public server by default and is overridable", () => {
  const before = process.env.HATCH_NTFY_BASE;
  delete process.env.HATCH_NTFY_BASE;
  expect(ntfyBase()).toBe("https://ntfy.sh");
  // A self-hosted ntfy should not need a code change, and a trailing slash in an env file
  // is the most ordinary typo there is: it would otherwise produce `host//topic`.
  process.env.HATCH_NTFY_BASE = "https://ntfy.example.com/";
  expect(newNotifyUrl()).toMatch(/^https:\/\/ntfy\.example\.com\/[-_A-Za-z0-9]{32}$/);
  if (before === undefined) delete process.env.HATCH_NTFY_BASE;
  else process.env.HATCH_NTFY_BASE = before;
});

// ---- the endpoint ---------------------------------------------------------------

const app = new Hono().route("/api", parentRoutes);
let fam: repo.Family;
let bearer: string;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Dad", "NQ00");
  fam = repo.getFamily(f.id)!;
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "Dad's phone", await sha256Hex(bearer));
});
afterEach(() => { delete process.env.HATCH_NTFY_BASE; });

const mint = (token = bearer) =>
  app.request("http://hatch.test/api/parent/notify-topic", {
    method: "POST", body: "{}",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });

test("a family starts with no notify_url, so nothing leaves the process", () => {
  // The default matters on its own: with notify_url null, notifyParent() returns before it
  // builds a request, so a child's name and chore titles never reach a third party for a
  // family that did not ask. Arming is a choice and this is the state it starts from.
  expect(fam.notify_url).toBeNull();
});

test("minting arms the family and hands the URL back once", async () => {
  const res = await mint();
  expect(res.status).toBe(201);
  const { notifyUrl, created } = await res.json();
  expect(created).toBe(true);
  expect(notifyUrl).toMatch(/^https:\/\/ntfy\.sh\/[-_A-Za-z0-9]{32}$/);
  expect(repo.getFamily(fam.id)!.notify_url).toBe(notifyUrl);
});

test("minting twice returns the SAME topic instead of rotating it", async () => {
  // Rotating would silently unsubscribe a phone that is already working, and the symptom
  // is notifications quietly stopping — the exact failure this endpoint exists to end.
  const first = (await (await mint()).json()).notifyUrl;
  const second = await mint();
  expect(second.status).toBe(200);
  const body = await second.json();
  expect(body.notifyUrl).toBe(first);
  expect(body.created).toBe(false);
});

test("a parent's own webhook is never overwritten by a later tap", async () => {
  // The raw field is the advanced escape hatch and can hold something that is not ntfy at
  // all. Minting on top of it would break that family's integration with no error.
  repo.updateFamilySettings(fam.id, { notify_url: "https://hooks.example.com/family" });
  const body = await (await mint()).json();
  expect(body.notifyUrl).toBe("https://hooks.example.com/family");
  expect(body.created).toBe(false);
});

test("no bearer, no topic", async () => {
  const res = await app.request("http://hatch.test/api/parent/notify-topic", { method: "POST", body: "{}" });
  expect(res.status).toBe(401);
});

test("another family's bearer cannot mint here", async () => {
  const other = repo.createFamily("Neighbour", "NQ01");
  const otherBearer = newToken();
  lockRepo.createParentToken(other.id, "their phone", await sha256Hex(otherBearer));
  await mint(otherBearer);
  // Each token resolves to its OWN family, so the neighbour armed themselves, not us.
  expect(repo.getFamily(fam.id)!.notify_url).toBeNull();
  expect(repo.getFamily(other.id)!.notify_url).toMatch(/^https:\/\/ntfy\.sh\//);
});
