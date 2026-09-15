// A kid picking their own character, end to end over HTTP.
//
// The feature is a delight; the tests are about the two ways a delight becomes a bug.
//
//   THE KID GETS WHAT THEY TAPPED. The nine addresses are derived at offer time and the account
//   is derived again at claim time. If those two derivations ever disagree the kid picks a
//   vampire and is handed a pear, and nothing on any screen says why. That is the first test.
//
//   THE DEVICE NEVER NAMES AN ADDRESS. The parent routes next door are parent-authed because a
//   kid's tablet must not be able to point their own payouts somewhere. This endpoint is
//   kid-reachable, so the offer is the only thing between a device token and an arbitrary
//   derivation index, and it has to hold against an index that was never offered, another
//   household's set, a spent set, and an expired one.
//
// Hermetic: in-memory DB + app.request(), mirroring src/kid-address.test.ts. No chain involved.

import { test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getDb, initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import { newToken, sha256Hex } from "./auth";
import { kidCharacterRoutes } from "./routes/kid-character";
import { CHOICES_PER_SET, MAX_SETS_PER_CHILD, claimCharacter, issueCharacterSet } from "./kid-character";
import { deriveKidKey } from "./nimiq/hd";

const app = new Hono().route("/api", kidCharacterRoutes);

type House = { fam: repo.Family; kid: repo.Child; sibling: repo.Child; bearer: string };

async function makeHouse(label: string, kidLabel: string, parentAddress: string): Promise<House> {
  const f = repo.createFamily(label, parentAddress);
  repo.updateFamilySettings(f.id, { mode: "family" });
  const fam = repo.getFamily(f.id)!;
  const kid = repo.createChild(fam.id, kidLabel, "🦖");
  const sibling = repo.createChild(fam.id, `${kidLabel}'s sibling`, "🐢");
  const bearer = newToken();
  lockRepo.createParentToken(fam.id, `${label}'s phone`, await sha256Hex(bearer));
  return { fam, kid, sibling, bearer };
}

let A: House;
let B: House;

beforeEach(async () => {
  initTestDb();
  A = await makeHouse("Mom A", "Ada", "NQ34 248D M0C9 PFU1 2QM4 PLBG ABCD 7E2F 0001");
  B = await makeHouse("Dad B", "Ben", "NQ55 1B2C 3D4E 5F6G 7H8J 9K0L MN0P QR2S 0002");
});

const get = (h: House, path: string) =>
  app.request(`http://hatch.test/api${path}`, { headers: { Authorization: `Bearer ${h.bearer}` } });

const post = (h: House, path: string, body: unknown) =>
  app.request(`http://hatch.test/api${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${h.bearer}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const offer = (h: House, kidId?: string) => get(h, `/kids/${kidId ?? h.kid.id}/character-choices`);
const claim = (h: House, body: unknown, kidId?: string) => post(h, `/kids/${kidId ?? h.kid.id}/character`, body);

// ---- the happy path, and the one property that makes it correct ----

test("a kid is offered three rows of three, each with an address to draw", async () => {
  const res = await offer(A);
  const body = await res.json();
  expect(res.status).toBe(201);
  expect(body.choices).toHaveLength(CHOICES_PER_SET);
  expect(body.shufflesLeft).toBe(MAX_SETS_PER_CHILD - 1);
  for (const choice of body.choices) {
    expect(typeof choice.index).toBe("number");
    expect(choice.address).toMatch(/^NQ\d{2} /);
  }
  // Nine DIFFERENT characters, which is the entire point of showing nine.
  expect(new Set(body.choices.map((c: { address: string }) => c.address)).size).toBe(CHOICES_PER_SET);
});

test("the address a kid is shown is the address they end up holding", async () => {
  const shown = await (await offer(A)).json();
  const picked = shown.choices[4]; // the middle of the grid, no reason beyond not always testing [0]

  const res = await claim(A, { setId: shown.setId, index: picked.index });
  const body = await res.json();
  expect(res.status).toBe(201);
  expect(body.child.address).toBe(picked.address);
  expect(body.child.addressSource).toBe("derived");

  const row = repo.getChild(A.kid.id)!;
  expect(row.account_index).toBe(picked.index);
  // And the key the server will actually sign with derives that same address.
  const key = await deriveKidKey({ index: row.account_index!, familyIndex: row.hd_family_index });
  expect(key.address).toBe(picked.address);
});

test("no offered address leaks a private key", async () => {
  const body = await (await offer(A)).json();
  expect(JSON.stringify(body)).not.toContain("priv");
  for (const choice of body.choices) expect(Object.keys(choice).sort()).toEqual(["address", "index"]);
});

// ---- what it must refuse ----

test("an index that was never offered is refused", async () => {
  const shown = await (await offer(A)).json();
  const notOffered = Math.max(...shown.choices.map((c: { index: number }) => c.index)) + 500;
  const res = await claim(A, { setId: shown.setId, index: notOffered });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("not_offered");
  expect(repo.getChild(A.kid.id)!.account_index).toBeNull();
});

test("another household's set is refused, and looks like it never existed", async () => {
  const shown = await (await offer(B)).json();
  const res = await claim(A, { setId: shown.setId, index: shown.choices[0].index });
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("set_not_found");
});

test("a sibling's set is refused even inside the same household", async () => {
  const shown = await (await offer(A, A.sibling.id)).json();
  const res = await claim(A, { setId: shown.setId, index: shown.choices[0].index });
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("set_not_found");
});

test("a set cannot be spent twice", async () => {
  const shown = await (await offer(A)).json();
  expect((await claim(A, { setId: shown.setId, index: shown.choices[0].index })).status).toBe(201);
  const again = await claim(A, { setId: shown.setId, index: shown.choices[1].index });
  expect(again.status).toBe(409);
  expect((await again.json()).error).toBe("already_chosen");
});

test("an expired set is refused", async () => {
  const shown = await (await offer(A)).json();
  getDb().run("UPDATE kid_character_sets SET expires_at=? WHERE id=?", [Date.now() - 1, shown.setId]);
  const res = await claim(A, { setId: shown.setId, index: shown.choices[0].index });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("set_expired");
});

test("a kid who already has an account is not offered a choice", async () => {
  wrepo.assignKidAccount(A.kid.id);
  const res = await offer(A);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("already_chosen");
});

test("a claim without an index is a bad request, but index 0 is a real choice", async () => {
  const missing = await claim(A, { setId: "whatever" });
  expect(missing.status).toBe(400);
  expect((await missing.json()).error).toBe("choice_required");

  // Index 0 is falsy and is the FIRST character the first kid in a household is ever offered.
  const shown = await (await offer(A)).json();
  expect(shown.choices[0].index).toBe(0);
  const res = await claim(A, { setId: shown.setId, index: 0 });
  expect(res.status).toBe(201);
  expect(repo.getChild(A.kid.id)!.account_index).toBe(0);
});

// ---- shuffling ----

test("a shuffle offers nine different characters and never repeats one", async () => {
  const seen = new Set<string>();
  let last: { shufflesLeft: number } = { shufflesLeft: MAX_SETS_PER_CHILD };
  for (let i = 0; i < MAX_SETS_PER_CHILD; i++) {
    const body = await (await offer(A)).json();
    for (const c of body.choices) seen.add(c.address);
    last = body;
  }
  expect(seen.size).toBe(CHOICES_PER_SET * MAX_SETS_PER_CHILD);
  expect(last.shufflesLeft).toBe(0);
});

test("shuffling runs out rather than walking the index space forever", async () => {
  for (let i = 0; i < MAX_SETS_PER_CHILD; i++) expect((await offer(A)).status).toBe(201);
  const res = await offer(A);
  expect(res.status).toBe(429);
  expect((await res.json()).error).toBe("no_shuffles_left");
});

test("an older set still works after a shuffle, because a kid may go back", async () => {
  const first = await (await offer(A)).json();
  await offer(A); // they looked at the next nine and preferred the first
  const res = await claim(A, { setId: first.setId, index: first.choices[2].index });
  expect(res.status).toBe(201);
  expect((await res.json()).child.address).toBe(first.choices[2].address);
});

// ---- siblings ----

test("two siblings picking cannot end up on the same address", async () => {
  const forAda = await (await offer(A)).json();
  const forSib = await (await offer(A, A.sibling.id)).json();

  await claim(A, { setId: forAda.setId, index: forAda.choices[0].index });
  // The sibling's offer was minted before Ada claimed, so it may contain the index she took.
  const clash = forSib.choices.find((c: { index: number }) => c.index === forAda.choices[0].index);
  if (clash) {
    const res = await claim(A, { setId: forSib.setId, index: clash.index }, A.sibling.id);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("index_taken");
  }
  const free = forSib.choices.find((c: { index: number }) => c.index !== forAda.choices[0].index)!;
  const res = await claim(A, { setId: forSib.setId, index: free.index }, A.sibling.id);
  expect(res.status).toBe(201);
  expect(repo.getChild(A.sibling.id)!.address).not.toBe(repo.getChild(A.kid.id)!.address);
});

// ---- the service level, where custody mode can be forced ----

test("a parent-custody instance offers nothing to pick from", async () => {
  const prior = process.env.HATCH_CUSTODY;
  process.env.HATCH_CUSTODY = "parent";
  try {
    const res = await issueCharacterSet(A.fam, A.kid);
    expect(res).toEqual({ ok: false, error: "parent_custody" });
    const claimed = await claimCharacter(A.fam, A.kid, { setId: "x", index: 0 });
    expect(claimed).toEqual({ ok: false, error: "parent_custody" });
  } finally {
    if (prior === undefined) delete process.env.HATCH_CUSTODY;
    else process.env.HATCH_CUSTODY = prior;
  }
});

test("a kid with a parent-registered address has already been answered", async () => {
  getDb().run("UPDATE children SET address=?, address_source='parent' WHERE id=?", [
    "NQ07 0000 0000 0000 0000 0000 0000 0000 0000", A.kid.id,
  ]);
  const res = await issueCharacterSet(A.fam, repo.getChild(A.kid.id)!);
  expect(res).toEqual({ ok: false, error: "already_chosen" });
});
