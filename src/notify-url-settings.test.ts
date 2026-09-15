// PATCH /api/family/settings must refuse an SSRF-shaped notify_url (LAN/loopback/non-https)
// and accept a public https target, persisting only the accepted value.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { sha256Hex } from "./auth";
import { starsRoutes } from "./routes/stars";

const app = new Hono().route("/api", starsRoutes);
let fam: repo.Family, token: string;

beforeEach(async () => {
  initTestDb();
  fam = repo.createFamily("Dad", "NQ00");
  repo.updateFamilySettings(fam.id, { mode: "family" });
  token = "tok-" + crypto.randomUUID();
  lockRepo.createParentToken(fam.id, "phone", await sha256Hex(token));
});

const patch = (body: unknown) =>
  app.request("/api/family/settings", {
    method: "PATCH", body: JSON.stringify(body),
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
  });

test("a loopback / LAN / non-https notify_url is rejected and nothing is written", async () => {
  for (const notifyUrl of [
    "http://127.0.0.1:8648/", "https://127.0.0.1:8648/", "https://192.168.1.243/hook",
    "https://[::1]/", "https://localhost/topic",
  ]) {
    const res = await patch({ notifyUrl });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_notify_url");
    expect(repo.getFamily(fam.id)!.notify_url).toBeNull();
  }
});

test("a public https target is accepted and persisted; empty clears it", async () => {
  const ok = await patch({ notifyUrl: "https://1.1.1.1/hook" }); // public IP literal, no DNS
  expect(ok.status).toBe(200);
  expect(repo.getFamily(fam.id)!.notify_url).toBe("https://1.1.1.1/hook");

  const cleared = await patch({ notifyUrl: "" });
  expect(cleared.status).toBe(200);
  expect(repo.getFamily(fam.id)!.notify_url).toBeNull();
});
