// Family-mode auth: parent PIN (Bun.password, rate-limited) and bearer tokens for
// the parent phone page + kiosk devices. Tokens are random 256-bit values shown
// once; only sha-256 hashes are stored.

import type { Context, Next } from "hono";
import * as repo from "./repo";
import * as lockRepo from "./repo-lock";
import * as memberRepo from "./repo-members";
import { demoSeedEnabled } from "./demo-flag";

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 5 * 60 * 1000;

export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPin(pin: string): Promise<string> {
  return Bun.password.hash(pin);
}

export type PinResult = { ok: true } | { ok: false; error: "no_pin" | "locked" | "wrong_pin"; lockedUntil?: number };

/** Verify the parent PIN with persistent rate limiting (5 fails -> 5 min lockout, stored on
 *  the family row so it survives restarts). Success resets the counter. */
export async function verifyFamilyPin(family: repo.Family, pin: string): Promise<PinResult> {
  if (!family.pin_hash) return { ok: false, error: "no_pin" };
  const nowMs = Date.now();
  if (family.pin_locked_until && family.pin_locked_until > nowMs) {
    return { ok: false, error: "locked", lockedUntil: family.pin_locked_until };
  }
  const good = await Bun.password.verify(pin, family.pin_hash).catch(() => false);
  if (good) {
    if (family.pin_attempts > 0 || family.pin_locked_until) repo.setPinAttempts(family.id, 0, null);
    return { ok: true };
  }
  const attempts = family.pin_attempts + 1;
  const lockedUntil = attempts >= PIN_MAX_ATTEMPTS ? nowMs + PIN_LOCKOUT_MS : null;
  repo.setPinAttempts(family.id, lockedUntil ? 0 : attempts, lockedUntil);
  return lockedUntil
    ? { ok: false, error: "locked", lockedUntil }
    : { ok: false, error: "wrong_pin" };
}

function bearerFrom(c: Context): string | null {
  const h = c.req.header("Authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/** The family the request's parent bearer token belongs to, or null when the request
 *  carries no valid token. Multi-family: THIS is how parent-facing routes learn which
 *  household they are acting on — never firstFamily(). */
export async function bearerFamily(c: Context): Promise<repo.Family | null> {
  return (await bearerParent(c))?.family ?? null;
}

/** The parent token row behind this request, with its family. Routes that manage
 *  SESSIONS need the row itself — which phone is asking — and not just the household,
 *  so "sign out everywhere" can keep the phone in the parent's hand signed in.
 *
 *  `member` is WHICH GROWN-UP is holding that phone (src/repo-members.ts). It falls back to
 *  the household's owner when the token carries no member id, and that fallback is not a
 *  defensive shrug: every token minted before this feature existed WAS the owner's, by
 *  construction — a household could hold only one grown-up. Null only for a household with no
 *  owner row at all, which `createFamily` and the db.ts backfill between them make impossible. */
export async function bearerParent(
  c: Context,
): Promise<{ token: lockRepo.ParentToken; family: repo.Family; member: memberRepo.Member | null } | null> {
  const token = bearerFrom(c);
  if (!token) return null;
  const row = lockRepo.findParentByTokenHash(await sha256Hex(token));
  if (!row) return null;
  const family = repo.getFamily(row.family_id);
  if (!family) return null;
  const member = row.member_id ? memberRepo.getMember(row.member_id) : memberRepo.ownerOf(family.id);
  // A REMOVED grown-up's token is deleted with them (removeMember), so this cannot normally be
  // a stale row — but reading one back as if they were still here would silently restore a
  // person the household deliberately let go, so it is refused rather than trusted.
  if (member && member.removed_at !== null) return null;
  return { token: row, family, member };
}

/** The grown-up this request is acting as, or null when it carries no parent bearer. */
export async function bearerMember(c: Context): Promise<memberRepo.Member | null> {
  return (await bearerParent(c))?.member ?? null;
}

/** True when the request carries a valid parent bearer token FOR THIS FAMILY.
 *  A valid token from another household must never authorize here. */
export async function hasParentToken(c: Context, family: repo.Family): Promise<boolean> {
  return (await bearerFamily(c))?.id === family.id;
}

/** The family a DEVICE bearer token belongs to (kiosk tablets), or null. Slice 3:
 *  lets a paired tablet's boot surfaces (/family, /children) scope to its own
 *  household instead of the instance's first one. */
export async function bearerDeviceFamily(c: Context): Promise<repo.Family | null> {
  const device = await bearerDevice(c);
  if (!device) return null;
  return repo.getFamily(device.family_id);
}

/** The paired device a request carries, or null. Split out of bearerDeviceFamily because
 *  the switch gate (#123) needs the DEVICE, not just its household: which kid a shared
 *  tablet is currently acting as is a fact about the tablet. */
export async function bearerDevice(c: Context): Promise<lockRepo.Device | null> {
  const token = bearerFrom(c);
  if (!token) return null;
  return lockRepo.findDeviceByTokenHash(await sha256Hex(token));
}

export type ParentAuthResult =
  | {
    ok: true; method: "remote" | "pin" | "demo";
    /**
     * WHICH grown-up this is, when there is one to name.
     *
     * Null on the `pin` and `demo` paths, and that is the honest answer rather than a gap:
     * a PIN is typed on the household tablet by whoever is holding it, and nobody is signed
     * in. It is why `payoutSender` falls back to the owner — the tablet is the owner's — and
     * why `decided_by_member_id` is nullable.
     */
    member: memberRepo.Member | null;
  }
  | { ok: false; status: 401 | 423; body: Record<string, unknown> };

/** Whether this instance hands out seeded demo households at all. Same env read as
 *  routes/demo's demoSeedEnabled, duplicated deliberately: importing that module here
 *  would close the cycle auth -> routes/demo -> demo-family -> auth. */
// THE flag, not a local copy of it. This line used to read `HATCH_DEMO_SEED` only, and the
// flag had been renamed to `HATCH_DEMO_ENABLED` everywhere else — so on the live demo the
// branch below was dead and every on-tablet approval answered 401. See src/demo-flag.ts.
const demoInstance = demoSeedEnabled;

/** Parent authorization for one-shot actions: a valid bearer token of THIS family
 *  (= remote, the phone page) OR a correct PIN in the body (= pin, typed on the tablet). */
export async function parentAuth(
  c: Context, family: repo.Family, pin: unknown,
): Promise<ParentAuthResult> {
  // Resolved ONCE and carried, rather than asking `hasParentToken` and then asking again for
  // the member: these routes do not run through `requireParent`, so the auth result is the
  // only place the answer to "who is this" can travel with the answer to "may they".
  const holder = await bearerParent(c);
  if (holder?.family.id === family.id) return { ok: true, method: "remote", member: holder.member };
  // A DEMO household has no grown-up to fetch. One visitor plays both parts, everything
  // in it was minted for them alone, and it is swept within the day, so a PIN gate here
  // asks a question with no answer and is the one place the demo can dead-end. Both
  // halves matter: the household must be demo-stamped AND the instance must be one that
  // mints demo households, so the mainnet competition instance (no HATCH_DEMO_SEED)
  // cannot take this path even if a stamped row somehow reached it.
  if (family.demo_at && demoInstance()) return { ok: true, method: "demo", member: null };
  if (pin !== undefined && pin !== null && pin !== "") {
    const res = await verifyFamilyPin(family, String(pin));
    if (res.ok) return { ok: true, method: "pin", member: null };
    if (res.error === "locked") {
      return { ok: false, status: 423, body: { error: "pin_locked", lockedUntil: res.lockedUntil } };
    }
    return { ok: false, status: 401, body: { error: res.error } };
  }
  return { ok: false, status: 401, body: { error: "parent_auth_required" } };
}

// Authenticated parent family per request (same pattern as deviceByRequest below).
const parentFamilyByRequest = new WeakMap<Request, repo.Family>();
const parentTokenByRequest = new WeakMap<Request, lockRepo.ParentToken>();
const parentMemberByRequest = new WeakMap<Request, memberRepo.Member>();

/** Middleware for parent-page routes (bearer only — the phone page always has its token).
 *  Resolves the token's OWN family; handlers read it via parentFamilyFrom(c). */
export async function requireParent(c: Context, next: Next) {
  const auth = await bearerParent(c);
  if (!auth) return c.json({ error: "parent_auth_required" }, 401);
  parentFamilyByRequest.set(c.req.raw, auth.family);
  parentTokenByRequest.set(c.req.raw, auth.token);
  if (auth.member) parentMemberByRequest.set(c.req.raw, auth.member);
  await next();
}
export function parentFamilyFrom(c: Context): repo.Family | null {
  return parentFamilyByRequest.get(c.req.raw) ?? null;
}
/** The parent token this request arrived on. Only session management needs it. */
export function parentTokenFrom(c: Context): lockRepo.ParentToken | null {
  return parentTokenByRequest.get(c.req.raw) ?? null;
}
/** WHICH GROWN-UP is acting. Every role gate (src/members.ts) and the choice of whose wallet
 *  a payout leaves from read this. Null on a request that reached the handler some other way
 *  than requireParent — a tablet PIN, or a kid device bearer — which is a real case and the
 *  reason the payout path has an owner fallback rather than a non-null assertion. */
export function parentMemberFrom(c: Context): memberRepo.Member | null {
  return parentMemberByRequest.get(c.req.raw) ?? null;
}

// Authenticated device per request (avoids Hono Variables typing for one value).
const deviceByRequest = new WeakMap<Request, lockRepo.Device>();

/** Middleware for kiosk-device routes; the handler reads the device via deviceFrom(c). */
export async function requireDevice(c: Context, next: Next) {
  const token = bearerFrom(c);
  if (!token) return c.json({ error: "device_auth_required" }, 401);
  const device = lockRepo.findDeviceByTokenHash(await sha256Hex(token));
  if (!device) return c.json({ error: "device_auth_required" }, 401);
  deviceByRequest.set(c.req.raw, device);
  await next();
}
export function deviceFrom(c: Context): lockRepo.Device | null {
  return deviceByRequest.get(c.req.raw) ?? null;
}
