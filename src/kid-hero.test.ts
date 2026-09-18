// A kid picking their character, over HTTP, and the contract between the list and the art.
//
// Hermetic: in-memory DB + app.request(), the harness src/kid-character.test.ts uses.

import { test, expect, beforeEach } from "bun:test";
import { readdirSync } from "node:fs";
import { Hono } from "hono";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { kidCharacterRoutes } from "./routes/kid-character";
import { HERO_IDS, heroArtUrl, isHeroId } from "./kid-hero";

const app = new Hono().route("/api", kidCharacterRoutes);

type House = { fam: repo.Family; kid: repo.Child; sibling: repo.Child; bearer: string; device: string };

async function makeHouse(label: string, kidLabel: string, parentAddress: string): Promise<House> {
  const f = repo.createFamily(label, parentAddress);
  repo.updateFamilySettings(f.id, { mode: "family" });
  const fam = repo.getFamily(f.id)!;
  const kid = repo.createChild(fam.id, kidLabel, "🦖");
  const sibling = repo.createChild(fam.id, `${kidLabel}'s sibling`, "🐢");
  const bearer = newToken();
  lockRepo.createParentToken(fam.id, `${label}'s phone`, await sha256Hex(bearer));
  const device = newToken();
  lockRepo.createDevice(fam.id, "Kid tablet", await sha256Hex(device), null);
  return { fam, kid, sibling, bearer, device };
}

let A: House;
let B: House;

beforeEach(async () => {
  initTestDb();
  A = await makeHouse("Mom A", "Ada", "NQ34 248D M0C9 PFU1 2QM4 PLBG ABCD 7E2F 0001");
  B = await makeHouse("Dad B", "Ben", "NQ55 1B2C 3D4E 5F6G 7H8J 9K0L MN0P QR2S 0002");
});

const patch = (token: string, kidId: string, body: unknown) =>
  app.request(`http://hatch.test/api/kids/${kidId}/hero`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// ---- the list IS the art ----

test("every hero in the list has its art, and every art file is in the list", () => {
  const onDisk = readdirSync("public/assets/heroes")
    .filter((f) => /^hero-.+\.png$/.test(f))
    .map((f) => f.replace(/^hero-/, "").replace(/\.png$/, ""))
    .sort();
  expect([...HERO_IDS] as string[]).toEqual(onDisk);
  expect(HERO_IDS).toHaveLength(21);
  expect(heroArtUrl("frog")).toBe("/assets/heroes/hero-frog.png");
});

test("the timer's roster and the list name the same heroes", async () => {
  const roster = (await Bun.file("public/kid/timer/heroes.json").json()) as { heroes: { id: string }[] };
  const timer = roster.heroes.map((h) => h.id.replace(/^hero-/, "")).sort();
  expect(timer).toEqual([...HERO_IDS] as string[]);
});

test("isHeroId is the gate", () => {
  expect(isHeroId("frog")).toBe(true);
  expect(isHeroId("hero-frog")).toBe(false);
  expect(isHeroId("dragon")).toBe(false);
  expect(isHeroId(null)).toBe(false);
  expect(isHeroId(3)).toBe(false);
});

// ---- picking, and picking again ----

test("a new kid has no hero, and that is what the roster says", () => {
  expect(repo.getChild(A.kid.id)!.hero).toBeNull();
  expect(repo.listChildren(A.fam.id).every((c) => c.hero === null)).toBe(true);
});

test("a kid picks a hero, then a different one, and the row follows", async () => {
  let res = await patch(A.bearer, A.kid.id, { hero: "frog" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ child: { id: A.kid.id, label: "Ada", hero: "frog" } });
  expect(repo.getChild(A.kid.id)!.hero).toBe("frog");

  // Re-pickable: the hero is art, not an address.
  res = await patch(A.bearer, A.kid.id, { hero: "whale" });
  expect(res.status).toBe(200);
  expect(repo.getChild(A.kid.id)!.hero).toBe("whale");
});

test("null clears it; an absent field is refused, not read as a clear", async () => {
  await patch(A.bearer, A.kid.id, { hero: "tiger" });
  let res = await patch(A.bearer, A.kid.id, {});
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("hero_required");
  expect(repo.getChild(A.kid.id)!.hero).toBe("tiger");

  res = await patch(A.bearer, A.kid.id, { hero: null });
  expect(res.status).toBe(200);
  expect(repo.getChild(A.kid.id)!.hero).toBeNull();
});

test("a hero that does not ship is refused and the reply names what does", async () => {
  const res = await patch(A.bearer, A.kid.id, { hero: "dragon" });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe("unknown_hero");
  expect(body.allowed).toEqual([...HERO_IDS]);
  expect(repo.getChild(A.kid.id)!.hero).toBeNull();
});

// ---- the gate ----

test("another household's parent cannot pick for this kid", async () => {
  const res = await patch(B.bearer, A.kid.id, { hero: "frog" });
  expect(res.status).toBe(404);
  expect(repo.getChild(A.kid.id)!.hero).toBeNull();
});

test("the family tablet may pick for its own kids, and for nobody else's", async () => {
  // The switch gate is open since 2026-09-16 (the secret pictures are gone), so a device
  // bearer proves the household and that is the check.
  let res = await patch(A.device, A.kid.id, { hero: "frog" });
  expect(res.status).toBe(200);
  expect(repo.getChild(A.kid.id)!.hero).toBe("frog");

  res = await patch(A.device, B.kid.id, { hero: "frog" });
  expect(res.status).toBe(404);
  expect(repo.getChild(B.kid.id)!.hero).toBeNull();
});
