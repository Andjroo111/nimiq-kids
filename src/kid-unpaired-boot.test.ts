// An unpaired tablet on an instance that demands auth used to ask /api/family and
// /api/children anyway, and both answered 401 pairing_required. The pairing screen still
// came up, but every first visit to /kid printed two red "Failed to load resource: 401"
// lines in the console (live nimiq.kids, 390px, 2026-11-02). /health already
// says the answer in advance (`custody.kidAuthRequired`), so with no device token the
// boot now goes straight to pairing without the two doomed reads.

import { test, expect, beforeEach, mock } from "bun:test";
import { kidIconsMock } from "./kid-icons-mock";

mock.module("../public/kid/js/icons.js", kidIconsMock);

const g = globalThis as unknown as Record<string, unknown>;
let store: Record<string, string>;
let calls: string[];
let health: Record<string, unknown>;

g.localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = String(v); },
  removeItem: (k: string) => { delete store[k]; },
};
g.fetch = (input: unknown) => {
  const url = String(input);
  calls.push(url);
  const body = url === "/health" ? health : url === "/api/children" ? { children: [{ id: "k1" }] } : { family: { id: "f1" } };
  const status = url !== "/health" && !store["kid.deviceToken"] && (health.custody as { kidAuthRequired?: boolean })?.kidAuthRequired ? 401 : 200;
  const res = status === 401 ? { error: "pairing_required" } : body;
  return Promise.resolve({ status, json: () => Promise.resolve(res) });
};

const { state } = await import("../public/kid/js/util.js");
type Probe = { status: number; children?: unknown };
const { refreshHealth, refreshFamily, refreshRoster } = (await import("../public/kid/js/data.js")) as unknown as {
  refreshHealth: () => Promise<void>;
  refreshFamily: () => Promise<void>;
  refreshRoster: () => Promise<Probe>;
};

async function boot() {
  await refreshHealth();
  await refreshFamily();
  return refreshRoster();
}

beforeEach(() => {
  store = {};
  calls = [];
  delete (state as unknown as Record<string, unknown>).instanceNeedsPairing;
});

test("unpaired tablet on an auth instance: pairing, and no 401 reads at all", async () => {
  health = { ok: true, custody: { kidAuthRequired: true } };
  const probe = await boot();
  expect(probe.status).toBe(401);
  expect(calls).toEqual(["/health"]);
});

test("a paired tablet on the same instance still reads family and roster", async () => {
  health = { ok: true, custody: { kidAuthRequired: true } };
  store["kid.deviceToken"] = "dev-1";
  const probe = await boot();
  expect(probe.status).toBe(200);
  expect(probe.children).toEqual([{ id: "k1" }]);
  expect(calls).toEqual(["/health", "/api/family", "/api/children"]);
});

test("a legacy instance with no auth keeps the tokenless boot", async () => {
  health = { ok: true, custody: { kidAuthRequired: false } };
  const probe = await boot();
  expect(probe.status).toBe(200);
  expect(calls).toEqual(["/health", "/api/family", "/api/children"]);
});

test("an old /health with no custody block falls back to asking", async () => {
  health = { ok: true };
  const probe = await boot();
  expect(probe.status).toBe(200);
  expect(calls).toEqual(["/health", "/api/family", "/api/children"]);
});
