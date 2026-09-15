// A kid's language: the column, the route, and the one that matters, NULL.
//
// #432. The kid app's own switcher was removed on 2026-08-27 and is not coming back, and
// nothing replaced it, so until this route a kid's language was unsettable by anybody: it was
// whatever the tablet's browser happened to say.
//
// THE ASSERTION THIS FILE EXISTS FOR IS THAT NULL SURVIVES. `null` means "follow the device",
// which is what every household in the database has today. A `NOT NULL DEFAULT 'en'` column,
// or a route that reads a missing field as a clear, or a picker that posts "en" for its empty
// option, all end in the same place: a household that never opened this control finds its
// tablet in English on the deploy that shipped it, with nothing on any screen to say why.
import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getDb, initTestDb } from "./db";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { families } from "./routes/families";
import { children } from "./routes/children";

const app = new Hono().route("/api", families).route("/api", children);

let fam: repo.Family;
let bearer: string;
let kid: repo.Child;

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Mom", "NQ11 PARE NTWA LLET 0000 0000 0000 0000 0000");
  fam = repo.getFamily(f.id)!;
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "phone", await sha256Hex(bearer));
  kid = repo.createChild(fam.id, "Sam");
});

const patch = (path: string, body: unknown) =>
  app.request(`http://hatch.test/api${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const langOf = (id: string) =>
  (getDb().query("SELECT lang FROM children WHERE id=?").get(id) as { lang: string | null }).lang;

// ---- null is the default, and it is not English ----------------------------

test("a new kid follows the device, which is NULL and not 'en'", () => {
  expect(kid.lang).toBeNull();
  expect(langOf(kid.id)).toBeNull();
});

test("a kid that existed before the column still follows the device", () => {
  // The migration is `ADD COLUMN lang TEXT` with no default, so every row that predates it
  // reads null. Simulated by clearing the column the way an old row would have it.
  getDb().run("UPDATE children SET lang=NULL WHERE id=?", [kid.id]);
  expect(langOf(kid.id)).toBeNull();
});

// ---- the route --------------------------------------------------------------

test("a parent sets one of the five", async () => {
  const r = await patch(`/children/${kid.id}/lang`, { lang: "es" });
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ child: { id: kid.id, lang: "es" } });
  expect(langOf(kid.id)).toBe("es");
});

test("null hands it back to the device, and null is stored as null", async () => {
  repo.setChildLang(kid.id, "de");
  const r = await patch(`/children/${kid.id}/lang`, { lang: null });
  expect(r.status).toBe(200);
  expect(langOf(kid.id)).toBeNull();
});

test("an ABSENT lang is refused, never read as a clear", async () => {
  repo.setChildLang(kid.id, "fr");
  const r = await patch(`/children/${kid.id}/lang`, {});
  expect(r.status).toBe(400);
  expect((await r.json()).error).toBe("lang_required");
  // The whole point: a client that forgot the field did not reset this household.
  expect(langOf(kid.id)).toBe("fr");
});

test("a language this app cannot draw is refused", async () => {
  const r = await patch(`/children/${kid.id}/lang`, { lang: "ja" });
  expect(r.status).toBe(400);
  expect((await r.json()).error).toBe("unknown_language");
  expect(langOf(kid.id)).toBeNull();
});

test("another family's kid is not found, not forbidden", async () => {
  const other = repo.createFamily("Dad", "NQ11 OTHE R000 0000 0000 0000 0000 0000 0000");
  const theirs = repo.createChild(other.id, "Ivy");
  const r = await patch(`/children/${theirs.id}/lang`, { lang: "es" });
  expect(r.status).toBe(404);
  expect(langOf(theirs.id)).toBeNull();
});

// ---- the repo is the only door, so the validation lives there too ------------

test("the repo refuses an unknown id rather than storing it", () => {
  expect(() => repo.setChildLang(kid.id, "ja")).toThrow();
  expect(langOf(kid.id)).toBeNull();
});

test("the five the app translates are the five the column takes", () => {
  for (const id of repo.KID_LANGS) {
    repo.setChildLang(kid.id, id);
    expect(langOf(kid.id)).toBe(id);
  }
  expect([...repo.KID_LANGS]).toEqual(["en", "es", "de", "fr", "pt"]);
});
