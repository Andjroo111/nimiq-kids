// Kid account coordinates are scoped to the household that owns them.
//
// Before this, indices were handed out across the whole instance: MAX(account_index) over every
// child row, no family predicate. Every kid in every household sat on one flat, enumerable lane.
// Now each family owns a branch and its own index space, so what a household holds is bounded by
// that household.
//
// Hermetic: in-memory DB, offline crypto (SIM), no network and no funds.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb, getDb } from "../db";
import * as repo from "../repo";
import * as wrepo from "../repo-wallet";
import { ensureKidWallet, kidKey } from "./kid-wallet";
import { deriveKidKey } from "../nimiq/hd";
import { purgeFamily } from "../demo-family";

const ADDRESS = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";

beforeEach(() => {
  initTestDb();
});

const newFamily = () => repo.createFamily("Parent", ADDRESS);

test("each family starts its own index space at 0 — indices are no longer instance-global", async () => {
  const a = newFamily();
  const b = newFamily();
  const aKids = [repo.createChild(a.id, "A1"), repo.createChild(a.id, "A2")];
  const bKids = [repo.createChild(b.id, "B1"), repo.createChild(b.id, "B2")];

  for (const kid of [...aKids, ...bKids]) await ensureKidWallet(kid.id);

  const indicesOf = (kids: repo.Child[]) => kids.map((k) => repo.getChild(k.id)!.account_index);
  expect(indicesOf(aKids)).toEqual([0, 1]);
  // The pre-fix code would hand these 2 and 3, because it counted the whole children table.
  expect(indicesOf(bKids)).toEqual([0, 1]);
});

test("the same index in two families is two different accounts, on two different branches", async () => {
  const a = newFamily();
  const b = newFamily();
  const kidA = await ensureKidWallet(repo.createChild(a.id, "A1").id);
  const kidB = await ensureKidWallet(repo.createChild(b.id, "B1").id);

  expect(kidA.account_index).toBe(0);
  expect(kidB.account_index).toBe(0);
  expect(kidA.hd_family_index).not.toBe(kidB.hd_family_index);
  expect(kidA.address).not.toBe(kidB.address);
  expect(repo.getFamily(a.id)!.hd_index).toBe(kidA.hd_family_index);
  expect(repo.getFamily(b.id)!.hd_index).toBe(kidB.hd_family_index);
});

test("a household's branch index is assigned once and never moves", async () => {
  const fam = newFamily();
  expect(repo.getFamily(fam.id)!.hd_index).toBeNull(); // lazy: nothing derived yet

  await ensureKidWallet(repo.createChild(fam.id, "First").id);
  const branch = repo.getFamily(fam.id)!.hd_index!;
  expect(branch).toBeGreaterThanOrEqual(0);

  const second = await ensureKidWallet(repo.createChild(fam.id, "Second").id);
  expect(repo.getFamily(fam.id)!.hd_index).toBe(branch);
  expect(second.hd_family_index).toBe(branch);
  expect(wrepo.assignFamilyHdIndex(fam.id)).toBe(branch); // idempotent
});

test("two children of one family provisioned concurrently never share an index or an address", async () => {
  const fam = newFamily();
  const kids = Array.from({ length: 8 }, (_, i) => repo.createChild(fam.id, `Kid ${i}`));

  const provisioned = await Promise.all(kids.map((k) => ensureKidWallet(k.id)));

  const indices = provisioned.map((c) => c.account_index!);
  expect(new Set(indices).size).toBe(kids.length);
  expect([...indices].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(new Set(provisioned.map((c) => c.address!)).size).toBe(kids.length);
});

test("the per-family uniqueness constraint is enforced by the database, not just by the code", () => {
  const fam = newFamily();
  const one = repo.createChild(fam.id, "One");
  const two = repo.createChild(fam.id, "Two");
  const db = getDb();
  db.run("UPDATE children SET account_index=0, hd_family_index=0 WHERE id=?", [one.id]);
  expect(() =>
    db.run("UPDATE children SET account_index=0, hd_family_index=0 WHERE id=?", [two.id]),
  ).toThrow();
});

test("legacy rows keep the flat path and still constrain each other globally", async () => {
  const a = newFamily();
  const b = newFamily();
  const legacyKid = repo.createChild(a.id, "Legacy");
  const db = getDb();
  // A row as the pre-scoping code left it: an index, no family branch.
  db.run("UPDATE children SET account_index=7, address='NQ_LEGACY' WHERE id=?", [legacyKid.id]);

  // No other legacy row anywhere may claim index 7 — their paths carry no family component.
  const otherLegacy = repo.createChild(b.id, "OtherLegacy");
  expect(() => db.run("UPDATE children SET account_index=7 WHERE id=?", [otherLegacy.id])).toThrow();

  // A SCOPED account may, because its path is a different shape entirely.
  const scoped = await ensureKidWallet(repo.createChild(b.id, "Scoped").id);
  expect(scoped.hd_family_index).not.toBeNull();
  expect(scoped.address).not.toBe("NQ_LEGACY");

  // And the legacy kid's sibling continues from the family's high mark, not from 0.
  const sibling = await ensureKidWallet(repo.createChild(a.id, "Sibling").id);
  expect(sibling.account_index).toBe(8);
  expect(sibling.hd_family_index).not.toBeNull();
  expect(repo.getChild(legacyKid.id)!.hd_family_index).toBeNull(); // untouched
});

test("a deleted child's index is never recycled inside its family", async () => {
  const fam = newFamily();
  const first = await ensureKidWallet(repo.createChild(fam.id, "First").id);
  expect(first.account_index).toBe(0);

  getDb().run("DELETE FROM children WHERE id=?", [first.id]);

  const next = await ensureKidWallet(repo.createChild(fam.id, "Next").id);
  expect(next.account_index).toBe(1);
  expect(next.address).not.toBe(first.address);
});

test("purging a household forgets its wallet_state rows, but never its branch", async () => {
  const keep = newFamily();
  const doomed = newFamily();
  await ensureKidWallet(repo.createChild(keep.id, "Keeper").id);
  const doomedKid = await ensureKidWallet(repo.createChild(doomed.id, "Doomed").id);
  wrepo.takeUnseenFamilyDepositLuna(doomed.id); // the other per-family key: a deposit cursor

  const perFamilyKeys = () =>
    (getDb().query(
      "SELECT key FROM wallet_state WHERE key LIKE 'hd_account_index_high_water:%' OR key LIKE 'family_deposit_seen:%'",
    ).all() as { key: string }[]).map((r) => r.key);
  expect(perFamilyKeys().filter((k) => k.endsWith(doomed.id)).length).toBeGreaterThan(0);

  await purgeFamily(doomed.id);

  // Nothing of the purged household is left behind — not even its id in a key.
  expect(perFamilyKeys().some((k) => k.includes(doomed.id))).toBe(false);
  expect(perFamilyKeys().some((k) => k.includes(keep.id))).toBe(true);

  // ...and the branch it used is still spent: the next household gets a NEW one, so no future
  // kid can ever derive an address the purged household's kid was funded at.
  const after = newFamily();
  const afterKid = await ensureKidWallet(repo.createChild(after.id, "After").id);
  expect(repo.getFamily(after.id)!.hd_index).toBe(2);
  expect(afterKid.address).not.toBe(doomedKid.address);
});

// ---- the signing guard ----
//
// kidKey() re-derives from the row's coordinates and compares to the address the row says the
// kid holds. The scenario that makes this matter is a build that derives those same coordinates
// on a different path — a downgrade past per-family scoping, which would sign with a key for an
// empty account while the funded one sits untouched. Flattening the row reproduces exactly that
// divergence without needing two builds.

test("kidKey refuses to sign when the row's coordinates no longer derive the address it holds", async () => {
  const fam = newFamily();
  const kid = await ensureKidWallet(repo.createChild(fam.id, "Scoped").id);
  const fundedAddress = kid.address!;
  expect(kid.hd_family_index).not.toBeNull();

  // Healthy row: the guard is invisible.
  expect((await kidKey(repo.getChild(kid.id)!)).address).toBe(fundedAddress);

  // Now the downgrade, in the only part that matters: the same row read WITHOUT its family
  // branch, which is what a pre-scoping build does with it.
  getDb().run("UPDATE children SET hd_family_index=NULL WHERE id=?", [kid.id]);
  const flattened = repo.getChild(kid.id)!;
  expect(flattened.address).toBe(fundedAddress); // the app still shows the funded address

  const wrongKey = await deriveKidKey({ index: flattened.account_index!, familyIndex: null });
  expect(wrongKey.address).not.toBe(fundedAddress); // ...and this is what it would have signed with

  await expect(kidKey(flattened)).rejects.toThrow(/kid_key_address_mismatch/);
});

test("the guard covers every path that spends a kid's own account", async () => {
  const fam = newFamily();
  const kid = await ensureKidWallet(repo.createChild(fam.id, "Spender").id);
  wrepo.addWalletEvent({ familyId: fam.id, childId: kid.id, kind: "earn", valueLuna: 500_000 });
  getDb().run("UPDATE children SET hd_family_index=NULL WHERE id=?", [kid.id]);

  // SIM never signs, so drive the seam these paths all funnel through rather than faking REAL.
  await expect(kidKey(repo.getChild(kid.id)!)).rejects.toThrow(/refusing to sign for child/);
});
