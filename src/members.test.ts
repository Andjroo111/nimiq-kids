// The capability matrix, and the two questions it deliberately does NOT answer with a role.
//
// Pure unit tests over src/members.ts. The HTTP side is src/member-authz.test.ts; this is here
// because a permission table is exactly the thing that reads correct and is not, and because
// every route in the app now delegates to these five predicates.

import { test, expect, beforeEach } from "bun:test";
import { initTestDb } from "./db";
import * as repo from "./repo";
import * as members from "./repo-members";
import { createParentToken, listParentTokens } from "./repo-lock";
import {
  canApprove, canInvite, canManageBoard, canManageHousehold, canPay, grownUpHolding,
  mayGrantRole, memberView, payoutSender,
} from "./members";

const OWNER_WALLET = "NQ07 0000 0000 0000 0000 0000 0000 0000 0001";
const GRAN_WALLET = "NQ34 0000 0000 0000 0000 0000 0000 0000 0002";

let fam: repo.Family;
let owner: members.Member;
let coparent: members.Member;
let supporter: members.Member;

beforeEach(() => {
  initTestDb();
  fam = repo.getFamily(repo.createFamily("Mom", OWNER_WALLET).id)!;
  owner = members.ownerOf(fam.id)!;
  coparent = members.createMember(fam.id, "Dad", "coparent");
  supporter = members.createMember(fam.id, "Grandma Jo", "supporter");
});

// ---- the matrix ----

test("createFamily mints the owner, from the family's own label and wallet", () => {
  expect(owner).toMatchObject({ label: "Mom", role: "owner", address: OWNER_WALLET });
  // The TILL and the owner's SENDER start life equal and are separate columns from here on.
  expect(fam.parent_address).toBe(OWNER_WALLET);
});

test("every grown-up can approve — that is the whole feature", () => {
  for (const m of [owner, coparent, supporter]) expect(canApprove(m)).toBe(true);
  expect(canApprove(null)).toBe(false);
});

test("a supporter cannot touch the board; a co-parent runs it", () => {
  expect(canManageBoard(owner)).toBe(true);
  expect(canManageBoard(coparent)).toBe(true);
  expect(canManageBoard(supporter)).toBe(false);
});

test("only the owner runs the household", () => {
  expect(canManageHousehold(owner)).toBe(true);
  expect(canManageHousehold(coparent)).toBe(false);
  expect(canManageHousehold(supporter)).toBe(false);
});

test("a removed grown-up can do nothing, whatever their role said", () => {
  members.removeMember(coparent.id);
  const gone = members.getMember(coparent.id)!;
  expect(gone.removed_at).not.toBeNull();
  expect(gone.role).toBe("coparent"); // the row still says who they were
  for (const can of [canApprove, canPay, canManageBoard, canManageHousehold, canInvite]) {
    expect(can(gone)).toBe(false);
  }
});

test("paying is about your WALLET, not your role", () => {
  // A supporter with a wallet can pay; a co-parent without one cannot, and neither fact is a
  // permission. This is why canPay is separate from the three role predicates.
  expect(canPay(supporter)).toBe(false);
  members.setMemberAddress(supporter.id, GRAN_WALLET);
  expect(canPay(members.getMember(supporter.id))).toBe(true);
  expect(canPay(coparent)).toBe(false);
});

// ---- who may hand out what ----

test("nobody invites an owner, and nobody invites above themselves", () => {
  expect(mayGrantRole(owner, "coparent")).toBe(true);
  expect(mayGrantRole(owner, "supporter")).toBe(true);
  expect(mayGrantRole(owner, "owner")).toBe(false);

  // A co-parent brings in a grandparent on their own side of the family without going through
  // the other house — the situation the feature exists for — but cannot mint a second parent.
  expect(mayGrantRole(coparent, "supporter")).toBe(true);
  expect(mayGrantRole(coparent, "coparent")).toBe(false);

  expect(mayGrantRole(supporter, "supporter")).toBe(false);
  expect(mayGrantRole(null, "supporter")).toBe(false);
});

// ---- who pays ----

test("whoever approves pays, out of their own wallet", () => {
  members.setMemberAddress(supporter.id, GRAN_WALLET);
  const paid = payoutSender(fam, members.getMember(supporter.id));
  expect(paid).toEqual({ address: GRAN_WALLET, memberId: supporter.id });
});

test("a grown-up with no wallet falls back to the owner, and is NOT credited for it", () => {
  // Grandma's yes is still worth having before she has connected anything. The money is the
  // owner's, so the trail must say the owner's — crediting the tapper would record a payment
  // she did not make.
  const paid = payoutSender(fam, supporter);
  expect(paid).toEqual({ address: OWNER_WALLET, memberId: owner.id });
});

test("an on-tablet PIN has no grown-up at all, and still pays: the tablet is the owner's", () => {
  expect(payoutSender(fam, null)).toEqual({ address: OWNER_WALLET, memberId: owner.id });
});

test("a household where nobody has a wallet pays nobody, and says so by returning null", () => {
  const bare = repo.getFamily(repo.createFamily("Nobody", "").id)!;
  members.setMemberAddress(members.ownerOf(bare.id)!.id, null);
  expect(payoutSender(bare, null)).toBeNull();
});

test("a removed grown-up's wallet is never the sender, even holding their row", () => {
  members.setMemberAddress(supporter.id, GRAN_WALLET);
  members.removeMember(supporter.id);
  expect(payoutSender(fam, members.getMember(supporter.id))).toEqual({
    address: OWNER_WALLET, memberId: owner.id,
  });
});

test("the owner's sender and the household till are separate columns", () => {
  // Under parent custody `PATCH /family/address` moves both, deliberately. Nothing else does,
  // which is what stops a grandparent's approval re-pointing where a Treasure Box spend lands.
  members.setMemberAddress(owner.id, GRAN_WALLET);
  expect(repo.getFamily(fam.id)!.parent_address).toBe(OWNER_WALLET);
  expect(payoutSender(repo.getFamily(fam.id)!, members.getMember(owner.id))!.address).toBe(GRAN_WALLET);
});

// ---- address collisions ----

test("grownUpHolding matches on the bare address, spacing and case included", () => {
  members.setMemberAddress(supporter.id, GRAN_WALLET);
  const roster = members.listMembers(fam.id);
  expect(grownUpHolding(roster, GRAN_WALLET.toLowerCase().replace(/ /g, ""))?.id).toBe(supporter.id);
  expect(grownUpHolding(roster, OWNER_WALLET)?.id).toBe(owner.id);
  expect(grownUpHolding(roster, "NQ99 0000 0000 0000 0000 0000 0000 0000 0009")).toBeNull();
});

test("a removed grown-up releases their wallet for whoever holds it next", () => {
  members.setMemberAddress(supporter.id, GRAN_WALLET);
  members.removeMember(supporter.id);
  expect(grownUpHolding(members.listMembers(fam.id, true), GRAN_WALLET)).toBeNull();
});

// ---- what the parent app is told ----

test("memberView publishes the permissions instead of making a screen infer them", () => {
  members.setMemberAddress(supporter.id, GRAN_WALLET);
  expect(memberView(members.getMember(supporter.id))).toMatchObject({
    label: "Grandma Jo",
    role: "supporter",
    address: GRAN_WALLET,
    can: { approve: true, pay: true, manageBoard: false, manageHousehold: false, invite: false },
  });
  expect(memberView(null)).toBeNull();
});

test("the roster puts the owner first, then co-parents, then supporters", () => {
  expect(members.listMembers(fam.id).map((m) => m.role)).toEqual(["owner", "coparent", "supporter"]);
});

test("removing a grown-up drops their phones in the same breath", () => {
  createParentToken(fam.id, "Grandma's phone", "hash-gran", supporter.id);
  createParentToken(fam.id, "Mom's phone", "hash-mom", owner.id);
  expect(listParentTokens(fam.id)).toHaveLength(2);
  members.removeMember(supporter.id);
  // Soft on the row, hard on the credential: the trail survives, the access does not.
  expect(listParentTokens(fam.id).map((t) => t.member_id)).toEqual([owner.id]);
  expect(members.getMember(supporter.id)).not.toBeNull();
});

/**
 * The invariant every other file in this feature leans on: A HOUSEHOLD ALWAYS HAS AN OWNER.
 *
 * `payoutSender` falls back to it, `bearerParent` resolves a member-less token to it, and
 * `notifyParent` treats the household topic as its fallback. All three would answer null for a
 * family created by some future path that writes the row directly, and the symptom would be a
 * household that silently cannot pay anybody.
 *
 * Held here rather than trusted: this greps the SOURCE, the same way title-catalog.test.ts
 * fails when a catalog job has no art. One writer is what makes createFamily's owner mint
 * total, and a second `INSERT INTO families` anywhere is the thing that would quietly end that.
 */
test("only ONE place in src/ inserts a family, and it mints the owner", async () => {
  const files = [...new Bun.Glob("src/**/*.ts").scanSync(".")].filter((f) => !f.includes(".test."));
  const writers: string[] = [];
  for (const f of files) {
    if ((await Bun.file(f).text()).includes("INSERT INTO families")) writers.push(f);
  }
  expect(writers).toEqual(["src/repo.ts"]);
});
