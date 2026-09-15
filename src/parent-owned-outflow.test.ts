// EVERY way a kid's NIM can leave their account must refuse when that account is
// parent-owned, and it must refuse BEFORE anything is written.
//
// This test exists because the obvious guard was in the wrong place. `kidKey` refuses to
// sign for a parent-owned address, which is correct and is still there — but it refuses at
// SIGNING time, and on the queued paths that is after a parent has already tapped Approve.
// Found by running the thing (a SIM instance happily "sent" 50,000 luna out of an address it
// holds no key for, wrote the ledger row, and answered 200), not by any test that existed.
//
// So the assertions here are deliberately about the ROUTE and the SIDE EFFECTS, not about
// the signer: nothing queued, nothing debited, no approval opened for a parent to honour.
//
// The list of endpoints is the point. A new way to spend a kid's money that does not appear
// here is a way around the guard, and the control column below (the same calls on a
// server-custodied sibling) is what stops this from passing because the endpoints are
// broken for everyone.

import { test, expect, beforeEach } from "bun:test";
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
import { ensureKidWallet } from "./wallet/kid-wallet";

const app = new Hono()
  .route("/api", families)
  .route("/api", walletRoutes)
  .route("/api", storeRoutes);

let fam: repo.Family;
let bearer: string;
let derived: repo.Child;   // control: a normal server-custodied kid
let owned: repo.Child;     // the one whose address a parent holds

const DEST = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";

beforeEach(async () => {
  initTestDb();
  const f = repo.createFamily("Mom", "NQ11 PARE NTWA LLET 0000 0000 0000 0000 0000");
  repo.updateFamilySettings(f.id, { mode: "family" });
  fam = repo.getFamily(f.id)!;
  bearer = newToken();
  lockRepo.createParentToken(fam.id, "phone", await sha256Hex(bearer));

  derived = await ensureKidWallet(repo.createChild(fam.id, "Derived").id);
  const o = repo.createChild(fam.id, "Owned");
  // Straight to the repo: the registration route is exercised in kid-address.test.ts, and
  // what this file is about is the state, not how it was reached.
  wrepo.setParentOwnedAddress(o.id, "NQ22 KIDA DDRE SS00 0000 0000 0000 0000 0000", {
    message: "proof", publicKeyHex: "aa", signatureHex: "bb",
  });
  owned = repo.getChild(o.id)!;

  // Both kids hold real, spendable money. Without this every call is refused for being
  // broke and the test would pass while proving nothing.
  for (const kid of [derived, owned]) {
    wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 5_000_000 });
  }
});

const post = (path: string, body: unknown) =>
  app.request(`http://hatch.test/api${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Every kid-initiated outflow this app has. */
const OUTFLOWS: { name: string; path: (id: string) => string; body: unknown }[] = [
  { name: "send to an address", path: (id) => `/kids/${id}/send`, body: { scanned: { valueLuna: 50_000, toAddress: DEST } } },
  { name: "mint a cashlink", path: (id) => `/kids/${id}/send`, body: { cashlink: { valueLuna: 50_000 } } },
  { name: "transfer to a parent", path: (id) => `/kids/${id}/send`, body: { valueLuna: 50_000, toParent: true } },
  { name: "stake", path: (id) => `/kids/${id}/stake`, body: { valueLuna: 50_000 } },
  { name: "unstake", path: (id) => `/kids/${id}/unstake`, body: { valueLuna: 50_000 } },
  { name: "buy from the Treasure Box", path: (id) => `/kids/${id}/buy`, body: { itemId: "screen-30" } },
];

for (const flow of OUTFLOWS) {
  test(`${flow.name}: refused for a parent-owned address, with a reason`, async () => {
    const res = await post(flow.path(owned.id), flow.body);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("parent_signature_required");
  });
}

test("nothing is written: no request, no approval, no ledger row", async () => {
  for (const flow of OUTFLOWS) await post(flow.path(owned.id), flow.body);

  const db = getDb();
  const sends = db.query("SELECT COUNT(*) AS n FROM send_requests WHERE child_id=?").get(owned.id) as { n: number };
  const approvals = approvalsRepo.listApprovals(fam.id, "pending").filter((a) => a.child_id === owned.id);
  const events = wrepo.listWalletEvents(owned.id, 50);

  expect(sends.n).toBe(0);
  expect(approvals).toHaveLength(0);
  // The one earn row it was seeded with, and nothing else. A debit here would be a ledger
  // that says money left an account it cannot leave.
  expect(events).toHaveLength(1);
  expect(events[0]!.kind).toBe("earn");
});

test("THE CONTROL: the same calls still work for a server-custodied kid", async () => {
  // Without this, the test above would pass just as well if every endpoint were broken.
  const send = await post(`/kids/${derived.id}/send`, { scanned: { valueLuna: 50_000, toAddress: DEST } });
  expect(send.status).toBe(202);
  const pending = approvalsRepo.listApprovals(fam.id, "pending").filter((a) => a.child_id === derived.id);
  expect(pending).toHaveLength(1);

  // And the refusal is about custody, not about the endpoint: a derived kid gets past it
  // and is judged on the merits (this one has no such Treasure Box item).
  const buy = await post(`/kids/${derived.id}/buy`, { itemId: "screen-30" });
  expect(buy.status).toBe(404);
});

test("money coming IN is unaffected: a parent can still pay a parent-owned kid", async () => {
  // The point of the whole exercise is that a kid can be paid into an account only their
  // family controls. If the refusal above had been written as "no money moves for this
  // kid", it would have broken the feature it exists to protect.
  const res = await post(`/kids/${owned.id}/fund`, { valueLuna: 100_000, requestId: crypto.randomUUID() });
  expect(res.status).toBe(201);
  expect((await res.json()).paidLuna).toBe(100_000);
});
