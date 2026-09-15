// The grown-ups of a household, and the codes that let one join. Same conventions as repo.ts
// — pure functions over getDb(), no HTTP.
//
// A household used to hold exactly one grown-up in the money sense. `families.parent_address`
// was the only wallet that could pay a kid, and every parent bearer token carried the same
// undifferentiated authority, so a second phone joining was indistinguishable from the first.
// This module is what makes "the other parent" and "Grandma" separate people with separate
// wallets, separate roles and separate phones.
//
// THE ONE DISTINCTION NOT TO COLLAPSE: `families.parent_address` remains the household TILL —
// where a kid's Treasure Box purchase returns to, and what a family transfer targets.
// `family_members.address` is the SENDER — whose wallet pays a kid for their work. They are
// equal for a household with one grown-up and must be free to differ the moment there are two.

import { getDb } from "./db";

/**
 * What a grown-up is allowed to do, in three steps down.
 *
 * `supporter` is the shape this feature exists for and the reason there is more than one role:
 * a grandparent should be able to put real money into a kid's account without also being able
 * to decide what a job is worth. Money in, no say over the terms.
 */
export type MemberRole = "owner" | "coparent" | "supporter";
export const MEMBER_ROLES: MemberRole[] = ["owner", "coparent", "supporter"];
/** The roles an invite may hand out. `owner` is not among them: a household has exactly one,
 *  it is set at onboarding, and handing it out through an invite code is how two people end up
 *  each believing they can remove the other. */
export const INVITABLE_ROLES: MemberRole[] = ["coparent", "supporter"];

export interface Member {
  id: string; family_id: string; label: string; role: MemberRole;
  address: string | null; notify_url: string | null;
  created_at: number; removed_at: number | null;
}

export interface MemberInvite {
  id: string; family_id: string; code_hash: string; role: MemberRole; label: string;
  expires_at: number; used_at: number | null; created_at: number;
}

const uid = () => crypto.randomUUID();
const now = () => Date.now();

export const isMemberRole = (v: unknown): v is MemberRole =>
  typeof v === "string" && (MEMBER_ROLES as string[]).includes(v);

// ---- members ----

export function createMember(
  familyId: string, label: string, role: MemberRole,
  opts: { address?: string | null; notifyUrl?: string | null } = {},
): Member {
  const m: Member = {
    id: uid(), family_id: familyId, label, role,
    address: opts.address ?? null, notify_url: opts.notifyUrl ?? null,
    created_at: now(), removed_at: null,
  };
  getDb().run(
    "INSERT INTO family_members (id, family_id, label, role, address, notify_url, created_at) VALUES (?,?,?,?,?,?,?)",
    [m.id, m.family_id, m.label, m.role, m.address, m.notify_url, m.created_at],
  );
  return m;
}

export function getMember(id: string): Member | null {
  return (getDb().query("SELECT * FROM family_members WHERE id=?").get(id) as Member) ?? null;
}

/** Everyone still in the household, owner first, then in the order they arrived. */
export function listMembers(familyId: string, includeRemoved = false): Member[] {
  const gone = includeRemoved ? "" : "AND removed_at IS NULL ";
  return getDb().query(
    `SELECT * FROM family_members WHERE family_id=? ${gone}
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'coparent' THEN 1 ELSE 2 END, created_at`,
  ).all(familyId) as Member[];
}

/**
 * The household's owner.
 *
 * Every payout falls back to this row when the acting grown-up has no wallet of their own, and
 * an on-tablet PIN approval has no acting grown-up at all — so this is not a convenience, it is
 * the answer to "whose wallet pays when nobody in particular is asking".
 */
export function ownerOf(familyId: string): Member | null {
  return (getDb().query(
    "SELECT * FROM family_members WHERE family_id=? AND role='owner' AND removed_at IS NULL ORDER BY created_at LIMIT 1",
  ).get(familyId) as Member) ?? null;
}

/** Is this address already spoken for inside the household? Members only — the family's own
 *  till and the kids' addresses are checked by their own guards, which have more to say. */
export function memberWithAddress(familyId: string, address: string, exceptMemberId?: string): Member | null {
  const bare = address.replace(/\s+/g, "").toUpperCase();
  return listMembers(familyId).find(
    (m) => m.id !== exceptMemberId && m.address && m.address.replace(/\s+/g, "").toUpperCase() === bare,
  ) ?? null;
}

export function setMemberAddress(id: string, address: string | null): void {
  getDb().run("UPDATE family_members SET address=? WHERE id=?", [address, id]);
}

export function setMemberNotifyUrl(id: string, url: string | null): void {
  getDb().run("UPDATE family_members SET notify_url=? WHERE id=?", [url, id]);
}

export function setMemberRole(id: string, role: MemberRole): void {
  getDb().run("UPDATE family_members SET role=? WHERE id=?", [role, id]);
}

export function setMemberLabel(id: string, label: string): void {
  getDb().run("UPDATE family_members SET label=? WHERE id=?", [label, id]);
}

/**
 * Remove a grown-up: stamp the row, drop their phones.
 *
 * SOFT, and the softness is the point. An approval names the member who decided it, and two
 * households sharing a kid is exactly the situation where "who approved this payment" has to
 * stay answerable after somebody leaves. Their tokens go in the same breath, so removal is
 * immediate in the only sense that matters — they cannot act again.
 */
export function removeMember(id: string): boolean {
  const db = getDb();
  const changed = db.run("UPDATE family_members SET removed_at=? WHERE id=? AND removed_at IS NULL", [now(), id]).changes > 0;
  if (changed) db.run("DELETE FROM parent_tokens WHERE member_id=?", [id]);
  return changed;
}

// ---- invites ----

/**
 * Issue a join code for one named person in one named role.
 *
 * Unlike a pairing code (`repo-lock.createPairCode`), minting one does NOT cancel the
 * household's other live codes. A household with two kids' tablets and two grown-ups to invite
 * has several genuinely concurrent handoffs going, and cancelling by side effect turns the
 * second invitation into a mystery. Expired and used rows are swept here instead.
 */
export function createMemberInvite(
  familyId: string, codeHash: string, role: MemberRole, label: string, ttlMs: number,
): MemberInvite {
  const db = getDb();
  const nowMs = now();
  db.run("DELETE FROM member_invites WHERE expires_at<? OR used_at IS NOT NULL", [nowMs]);
  const inv: MemberInvite = {
    id: uid(), family_id: familyId, code_hash: codeHash, role, label,
    expires_at: nowMs + ttlMs, used_at: null, created_at: nowMs,
  };
  db.run(
    "INSERT INTO member_invites (id, family_id, code_hash, role, label, expires_at, used_at, created_at) VALUES (?,?,?,?,?,?,NULL,?)",
    [inv.id, inv.family_id, inv.code_hash, inv.role, inv.label, inv.expires_at, inv.created_at],
  );
  return inv;
}

/** Spend a code. Single use, enforced by the conditional UPDATE rather than by the read, so
 *  two callers racing on one code cannot both be admitted. */
export function redeemMemberInvite(codeHash: string): MemberInvite | null {
  const db = getDb();
  const nowMs = now();
  const inv = db.query(
    "SELECT * FROM member_invites WHERE code_hash=? AND used_at IS NULL AND expires_at>=?",
  ).get(codeHash, nowMs) as MemberInvite | null;
  if (!inv) return null;
  const won = db.run("UPDATE member_invites SET used_at=? WHERE id=? AND used_at IS NULL", [nowMs, inv.id]).changes > 0;
  return won ? inv : null;
}

/** Live invitations, so the inviter can see what is outstanding rather than re-sending blind. */
export function listPendingInvites(familyId: string): MemberInvite[] {
  return getDb().query(
    "SELECT * FROM member_invites WHERE family_id=? AND used_at IS NULL AND expires_at>=? ORDER BY created_at",
  ).all(familyId, now()) as MemberInvite[];
}

export function revokeMemberInvite(id: string, familyId: string): boolean {
  return getDb().run("DELETE FROM member_invites WHERE id=? AND family_id=?", [id, familyId]).changes > 0;
}
