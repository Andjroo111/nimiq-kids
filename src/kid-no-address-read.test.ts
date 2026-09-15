// A kid with NO ADDRESS YET is the normal first state of every kid on a
// `HATCH_CUSTODY=parent` instance, and reading their screen must not be an error.
//
// The bug this file exists for: `GET /kids/:id/wallet` — "THE endpoint the kid app home
// renders from" — answered 500 for exactly that kid, because it asked `ensureKidWallet` to
// PROVISION an account when all it wanted was to READ one. Under parent custody there is
// nothing to provision (a parent registers the address), so the provisioning call threw
// `kid_address_not_registered` and took the handler with it. `GET /kids/:id/staking` had
// the same shape. Both are reached on a plain page load, so the first thing a parent saw
// after adding a kid was a permanently unread screen.
//
// The refusal itself is CORRECT and stays: nothing here may hand an address-less child to a
// path that is about to move money, because a send with no sender is worse than a refusal.
// So the assertions come in two columns — the READS answer, and every OUTFLOW refuses with
// a stable code and writes nothing — plus a server-custody control, because a fix that
// simply stopped provisioning would pass the first column and break every other instance.

import { test, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { getDb, initTestDb } from "./db";
import * as repo from "./repo";
import * as wrepo from "./repo-wallet";
import * as lockRepo from "./repo-lock";
import * as approvalsRepo from "./repo-approvals";
import { newToken, sha256Hex } from "./auth";
import { families } from "./routes/families";
import { walletRoutes } from "./routes/wallet";
import { storeRoutes } from "./routes/store";
import { ensureKidWallet, readKidWallet } from "./wallet/kid-wallet";

const app = new Hono()
  .route("/api", families)
  .route("/api", walletRoutes)
  .route("/api", storeRoutes);

let fam: repo.Family;
let bearer: string;
let kid: repo.Child;

const DEST = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";

beforeEach(async () => {
  initTestDb();
  process.env.HATCH_CUSTODY = "parent";
  const f = repo.createFamily("Mom", "NQ11 PARE NTWA LLET 0000 0000 0000 0000 0000");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "phone", await sha256Hex(bearer));
  // Straight from createChild and left alone: address NULL, account_index NULL. This is a
  // kid the parent has added and not yet run the registration flow for — no fixture, just
  // the state the app itself produces.
  kid = repo.getChild(repo.createChild(fam.id, "Ivy").id)!;
});

afterEach(() => { delete process.env.HATCH_CUSTODY; });

// Headers are built HERE, per call, and never hoisted into a module-level const: `bearer`
// is minted in beforeEach, so a const captured at import time carries "Bearer undefined".
const authed = () => ({ Authorization: `Bearer ${bearer}`, "content-type": "application/json" });

const get = (path: string) =>
  app.request(`http://hatch.test/api${path}`, { headers: authed() });

const post = (path: string, body: unknown) =>
  app.request(`http://hatch.test/api${path}`, {
    method: "POST", headers: authed(), body: JSON.stringify(body),
  });

// ---- the reads answer -------------------------------------------------------------------

test("GET /kids/:id/wallet answers for a kid with no address yet", async () => {
  const res = await get(`/kids/${kid.id}/wallet`);
  expect(res.status).toBe(200);
  const body = await res.json();
  // Null, not "": the field says there is no address, and a client that renders an empty
  // string as an address draws a blank one instead of saying so.
  expect(body.address).toBeNull();
  expect(body.balanceLuna).toBe(0);
  expect(body.events).toEqual([]);
  // The one thing that tells a client WHY there is no address, and who fixes it.
  expect(body.custody.kidCustody).toBe("parent");
});

test("GET /kids/:id/staking answers for a kid with no address yet", async () => {
  const res = await get(`/kids/${kid.id}/staking`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.stakedLuna).toBe(0);
  expect(body.pendingLuna).toBe(0);
});

test("reading does not quietly provision a server-held account", async () => {
  // The whole reason the refusal exists. If the read fell through to provisioning, this kid
  // would leave the GET holding an address the SERVER can sign for — on the one instance
  // whose entire purpose is that it cannot.
  await get(`/kids/${kid.id}/wallet`);
  await get(`/kids/${kid.id}/staking`);
  const after = repo.getChild(kid.id)!;
  expect(after.address).toBeNull();
  expect(after.account_index).toBeNull();
  expect(after.address_source).toBeNull();
});

test("a read repeated is still a read: no rows appear, nothing changes", async () => {
  for (let i = 0; i < 3; i++) await get(`/kids/${kid.id}/wallet`);
  expect(wrepo.listWalletEvents(kid.id, 50)).toHaveLength(0);
  expect(repo.getChild(kid.id)!.address).toBeNull();
});

// ---- the provisioning refusal is intact --------------------------------------------------

test("ensureKidWallet still refuses to provision under parent custody", async () => {
  // Deleting the throw would have "fixed" the 500 and pushed the failure downstream to a
  // send with no sender. It is still here; only the readers stopped calling it.
  expect(ensureKidWallet(kid.id)).rejects.toThrow("kid_address_not_registered");
});

test("readKidWallet hands back the row itself, address and all still empty", async () => {
  const row = await readKidWallet(kid.id);
  expect(row.id).toBe(kid.id);
  expect(row.address).toBeNull();
});

test("readKidWallet on a child that does not exist is still an error", async () => {
  expect(readKidWallet("nope")).rejects.toThrow("child not found");
});

// ---- every outflow refuses, and writes nothing -------------------------------------------

/** Every kid-initiated way NIM can leave an account, same list as parent-owned-outflow. */
const OUTFLOWS: { name: string; path: (id: string) => string; body: unknown }[] = [
  { name: "send to an address", path: (id) => `/kids/${id}/send`, body: { scanned: { valueLuna: 50_000, toAddress: DEST } } },
  { name: "mint a cashlink", path: (id) => `/kids/${id}/send`, body: { cashlink: { valueLuna: 50_000 } } },
  { name: "transfer to a parent", path: (id) => `/kids/${id}/send`, body: { valueLuna: 50_000, toParent: true } },
  { name: "stake", path: (id) => `/kids/${id}/stake`, body: { valueLuna: 50_000 } },
  { name: "unstake", path: (id) => `/kids/${id}/unstake`, body: { valueLuna: 50_000 } },
  // The REAL catalogue id, unlike the parent-owned sibling of this list: there the refusal
  // fires before the item lookup, here the deferred-spend branch has to be walked past it.
  { name: "buy from the Treasure Box", path: (id) => `/kids/${id}/buy`, body: { itemId: "item-screen-30" } },
];

for (const flow of OUTFLOWS) {
  test(`${flow.name}: refused with a reason, never a 500`, async () => {
    // Seeded funds, so the refusal cannot be "broke" wearing another hat.
    wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 5_000_000 });
    const res = await post(flow.path(kid.id), flow.body);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("kid_address_not_registered");
  });
}

test("giving NIM to a sibling who has no address is refused, not crashed", async () => {
  // The RECIPIENT's side of the same rule, and the one the sender's own guard cannot catch.
  // The household is the migration window itself: an older kid provisioned BEFORE the flip
  // still has their derived account and may still spend from it, and the sibling added
  // after it is the one with nowhere for the NIM to land. `ensureKidWallet` threw there
  // with nothing catching it, so one kid giving to a brand-new sibling answered 500.
  delete process.env.HATCH_CUSTODY;
  const sender = await ensureKidWallet(kid.id); // derived, exactly as it was before the flip
  process.env.HATCH_CUSTODY = "parent";
  expect(sender.address).toMatch(/^NQ/);
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 5_000_000 });
  const sibling = repo.createChild(fam.id, "Newbie");

  const res = await post(`/kids/${kid.id}/send`, { valueLuna: 50_000, toChildId: sibling.id });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("recipient_address_not_registered");
  // And the sibling was not handed a server-held account on the way past.
  expect(repo.getChild(sibling.id)!.address).toBeNull();
  expect(approvalsRepo.listApprovals(fam.id, "pending")).toHaveLength(0);
});

test("nothing is written by any of them: no request, no approval, no ledger row", async () => {
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 5_000_000 });
  for (const flow of OUTFLOWS) await post(flow.path(kid.id), flow.body);

  const db = getDb();
  const sends = db.query("SELECT COUNT(*) AS n FROM send_requests WHERE child_id=?").get(kid.id) as { n: number };
  expect(sends.n).toBe(0);
  expect(approvalsRepo.listApprovals(fam.id, "pending")).toHaveLength(0);
  // The seeded earn row, and nothing else.
  const events = wrepo.listWalletEvents(kid.id, 50);
  expect(events).toHaveLength(1);
  expect(events[0]!.kind).toBe("earn");
});

// ---- the control: server custody still provisions on read --------------------------------

test("THE CONTROL, REVERSED: server custody does not provision on a read either", async () => {
  // THIS TEST USED TO ASSERT THE OPPOSITE, and reversing it was the whole point of #381. The
  // original fear was right at the time: a read that stopped provisioning would have stranded
  // every existing instance, because both clients relied on the side effect to get an address
  // at all. So the clients were fixed first, and only then this.
  //
  // What made the old contract untenable is that the side effect ALSO decided every kid's
  // identicon. The address is derived from `account_index`, the character is drawn from the
  // address, and this endpoint is what both apps call just to render a screen. So a kid's
  // character was chosen by whoever opened an app first. Measured in production: a household
  // created at 04:38 one evening had both kids provisioned within the same minute, before
  // either child had touched a tablet.
  //
  // Provisioning now happens where it belongs, on the money paths, through `ensureKidWallet`.
  // A read is a read.
  delete process.env.HATCH_CUSTODY;
  const res = await get(`/kids/${kid.id}/wallet`);
  expect(res.status).toBe(200);
  expect((await res.json()).address).toBeNull();
  const after = repo.getChild(kid.id)!;
  expect(after.address).toBeNull();
  expect(after.account_index).toBeNull();
});

test("THE CONTROL'S OTHER HALF: server custody still provisions on a MONEY path", async () => {
  // The half of the original control that must survive. Nothing above proves the seed-derived
  // account still works at all; this does, and it is what keeps a payout to a kid who has never
  // logged in from becoming a refusal.
  delete process.env.HATCH_CUSTODY;
  const fresh = await ensureKidWallet(kid.id);
  expect(fresh.address).toMatch(/^NQ/);
  expect(repo.getChild(kid.id)!.account_index).not.toBeNull();
});

test("THE OTHER CONTROL: a registered kid reads normally under parent custody", async () => {
  // The refusal must be about the MISSING address and nothing else. A kid whose parent has
  // been through the flow is an ordinary read on the same instance.
  wrepo.setParentOwnedAddress(kid.id, "NQ22 KIDA DDRE SS00 0000 0000 0000 0000 0000", {
    message: "proof", publicKeyHex: "aa", signatureHex: "bb",
  });
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 700_000 });
  const res = await get(`/kids/${kid.id}/wallet`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.address).toBe("NQ22 KIDA DDRE SS00 0000 0000 0000 0000 0000");
  expect(body.balanceLuna).toBe(700_000);
});
