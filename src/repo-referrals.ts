// Invite-a-family referral storage (competition build: attribution only — the
// automatic both-sides bonus is deferred, docs/ROADMAP.md Phase 1). Follows
// repo.ts conventions: pure functions over bun:sqlite, no HTTP. Guardrail: a
// referral row carries NOTHING about the invited household — only which code
// was accepted and when, which is all a later bonus grant needs.

import { getDb } from "./db";

export interface FamilyInvite { code: string; family_id: string; created_at: number }
export interface Referral {
  id: string; code: string; inviter_family_id: string; status: string;
  ip_hash: string | null; joined_at: number | null; created_at: number;
}

/** One accept row per (code, ip hash) per rolling day — the count is not spammable. */
export const ACCEPT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Hard row cap per code — the referrals table stays bounded no matter what. */
export const MAX_ACCEPTS_PER_CODE = 500;

// Unambiguous alphabet (no 0/O, 1/I/L) — codes get read aloud between parents.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

export function generateInviteCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]!).join("");
}

/** The family's one shareable invite code — created on first ask, then reused. */
export function getOrCreateInvite(familyId: string): FamilyInvite {
  const existing = getDb().query("SELECT * FROM family_invites WHERE family_id=?").get(familyId) as FamilyInvite | null;
  if (existing) return existing;
  const invite: FamilyInvite = { code: generateInviteCode(), family_id: familyId, created_at: Date.now() };
  getDb().run(
    "INSERT INTO family_invites (code, family_id, created_at) VALUES (?,?,?)",
    [invite.code, invite.family_id, invite.created_at],
  );
  return invite;
}

export function getInvite(code: string): FamilyInvite | null {
  return (getDb().query("SELECT * FROM family_invites WHERE code=?").get(code) as FamilyInvite) ?? null;
}

/**
 * Forget every dedupe digest that is past the window it exists for.
 *
 * `ip_hash` is derived from the visitor's IP and it is only ever READ inside
 * `ACCEPT_DEDUPE_WINDOW_MS` — after that the row keeps it purely because nothing ever
 * deleted it, which is the definition of retention without a purpose. The referral row
 * itself stays: `status`, `code` and the timestamps are what a later bonus grant needs, and
 * none of them says anything about who the visitor was.
 *
 * Runs on write rather than on a timer. The table is row-capped per code, so this is a
 * small UPDATE on a small table and it cannot fall behind the way a cron can.
 */
export function forgetStaleIpHashes(nowMs = Date.now()): void {
  getDb().run(
    "UPDATE referrals SET ip_hash=NULL WHERE ip_hash IS NOT NULL AND created_at < ?",
    [nowMs - ACCEPT_DEDUPE_WINDOW_MS],
  );
}

/** Record that an invite link was accepted (tapped through to Nimiq Pay).
 *  Returns null when the code doesn't exist. Deduped per (code, ipHash) inside
 *  a rolling day and capped per code, so repeat taps and spam never inflate the
 *  count or grow the table without bound. `ipHash` is a truncated MAC keyed on a
 *  per-instance secret, never a raw IP and not invertible without that secret —
 *  and still nothing about WHO the invited household is. */
export function recordAccept(code: string, ipHash: string | null = null): Referral | null {
  const invite = getInvite(code);
  if (!invite) return null;
  const nowMs = Date.now();
  forgetStaleIpHashes(nowMs);
  if (ipHash) {
    const dupe = getDb().query(
      "SELECT * FROM referrals WHERE code=? AND ip_hash=? AND created_at>=? LIMIT 1",
    ).get(invite.code, ipHash, nowMs - ACCEPT_DEDUPE_WINDOW_MS) as Referral | null;
    if (dupe) return dupe;
  }
  if (countAccepts(invite.code) >= MAX_ACCEPTS_PER_CODE) return null;
  const ref: Referral = {
    id: crypto.randomUUID(), code: invite.code, inviter_family_id: invite.family_id,
    status: "accepted", ip_hash: ipHash, joined_at: null, created_at: nowMs,
  };
  getDb().run(
    "INSERT INTO referrals (id, code, inviter_family_id, status, ip_hash, created_at) VALUES (?,?,?,?,?,?)",
    [ref.id, ref.code, ref.inviter_family_id, ref.status, ref.ip_hash, ref.created_at],
  );
  return ref;
}

export function countAccepts(code: string): number {
  const row = getDb().query("SELECT COUNT(*) AS n FROM referrals WHERE code=?").get(code) as { n: number };
  return row.n;
}

/** The invited household actually created its family: accepted -> joined. Flips the
 *  most recent accepted row (or records a fresh joined row when the landing page was
 *  skipped). Still stores NOTHING about the invited household beyond status + time. */
export function recordJoin(code: string): Referral | null {
  const invite = getInvite(code);
  if (!invite) return null;
  const nowMs = Date.now();
  const accepted = getDb().query(
    "SELECT * FROM referrals WHERE code=? AND status='accepted' ORDER BY created_at DESC LIMIT 1",
  ).get(invite.code) as Referral | null;
  if (accepted) {
    getDb().run("UPDATE referrals SET status='joined', joined_at=? WHERE id=?", [nowMs, accepted.id]);
    return { ...accepted, status: "joined", joined_at: nowMs };
  }
  const ref: Referral = {
    id: crypto.randomUUID(), code: invite.code, inviter_family_id: invite.family_id,
    status: "joined", ip_hash: null, joined_at: nowMs, created_at: nowMs,
  };
  getDb().run(
    "INSERT INTO referrals (id, code, inviter_family_id, status, joined_at, created_at) VALUES (?,?,?,?,?,?)",
    [ref.id, ref.code, ref.inviter_family_id, ref.status, ref.joined_at, ref.created_at],
  );
  return ref;
}

export function countJoins(code: string): number {
  const row = getDb().query("SELECT COUNT(*) AS n FROM referrals WHERE code=? AND status='joined'")
    .get(code) as { n: number };
  return row.n;
}
