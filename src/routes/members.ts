// The grown-ups of a household: who is in it, how someone joins, and whose wallet each of
// them pays from.
//
// The situation this exists for: a kid whose parents live in two houses, and grandparents who
// want to put real money into that kid's account. Before this, a household had one grown-up in
// every sense that mattered — one wallet, one undifferentiated bearer token — so the only way
// for a second adult to take part was to hand over the tablet or the phone. That is not a
// design, it is the absence of one.
//
// Joining is a 6-DIGIT CODE READ OUT LOUD, never a link. Same rule POST /api/pair states for
// pairing codes, and for a stronger reason here: this code admits a person to a household and
// a link admitting someone to a household is a bearer secret that lands in message history,
// gets forwarded, and survives in a screenshot.

import { Hono } from "hono";
import type { Context } from "hono";
import * as repo from "../repo";
import * as memberRepo from "../repo-members";
import * as lockRepo from "../repo-lock";
import {
  bearerParent, newToken, parentFamilyFrom, parentMemberFrom, requireParent, sha256Hex,
} from "../auth";
import {
  canInvite, canManageBoard, canManageHousehold, grownUpHolding, mayGrantRole, memberView,
  NOT_ALLOWED,
} from "../members";
import { pairAttemptAllowed, pairGuessBudgetSpent, recordPairGuessMiss } from "../pair-brake";
import { clientIp } from "../client-ip";
import { normalizeNqAddress } from "./wallet";
import { custodyMode } from "../custody-boot";
import { newNotifyUrl } from "../notify-topic";

export const memberRoutes = new Hono();

/**
 * Refuse a request from a grown-up who may not make it — AND ONLY FROM A GROWN-UP.
 *
 * The subtlety that makes this a function rather than an inline role test at each call site:
 * most board routes are not behind `requireParent`. They resolve their household through
 * `familyForSubject`, which also accepts a KID TABLET's device bearer, and on a relaxed
 * instance accepts no bearer at all. A kid adding a job to their own board, or a tablet
 * submitting one, carries no member — so a naive `canManageBoard(member)` would answer 403 to
 * every kid in the household while letting the supporter through by accident of ordering.
 *
 * So: no parent bearer for THIS household means this is not the question being asked, and the
 * route behaves exactly as it did before roles existed. A parent bearer means somebody signed
 * in is asking, and their role decides.
 *
 * The refusal is 403 rather than 401 on purpose: the token is perfectly good. It is the person
 * who is not allowed, and a 401 would send the parent app into a re-authentication loop it can
 * never win.
 */
async function refuseGrownUp(
  c: Context, fam: repo.Family, allowed: (m: memberRepo.Member | null) => boolean,
): Promise<Response | null> {
  const holder = await bearerParent(c);
  if (!holder || holder.family.id !== fam.id) return null;
  return allowed(holder.member) ? null : c.json(NOT_ALLOWED, 403);
}

/** Jobs, routines, practices, kids, the Treasure Box: a supporter is refused, everyone else
 *  who was allowed before still is. See refuseGrownUp for why a kid tablet is untouched. */
export const refuseBoardWrite = (c: Context, fam: repo.Family) =>
  refuseGrownUp(c, fam, canManageBoard);

/** The household itself: settings, pairing, sessions, the family wallet. Owner only. */
export const refuseHouseholdWrite = (c: Context, fam: repo.Family) =>
  refuseGrownUp(c, fam, canManageHousehold);

/** Long enough to read out over the phone and walk someone through typing it, short enough
 *  that a forgotten one dies on its own. Pairing codes get 5 minutes because both devices are
 *  in the same room; inviting a grandparent is a phone call. */
export const MEMBER_INVITE_TTL_MS = 15 * 60 * 1000;
const LABEL_MAX = 24;

function newCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

/** A grown-up as the roster shows them. NEVER their notify_url — that is a bearer secret for
 *  their phone alone, and a roster every member can read is not where it belongs. */
function rosterView(m: memberRepo.Member, meId: string | null) {
  return {
    id: m.id, label: m.label, role: m.role,
    /** Public chain handle, and the household can already see it on every payout. */
    address: m.address,
    /** Can they pay out of their own wallet yet, or does the owner still cover them? */
    canPay: !!m.address,
    isYou: m.id === meId,
    joinedAt: m.created_at,
  };
}

// ---- the roster ----

/**
 * Who is in this household.
 *
 * Readable by every member, including a supporter: a grandparent who is about to pay for a
 * chore should be able to see who else can, and hiding the roster from the people in it buys
 * nothing — they can all see each other's payouts on the queue anyway.
 */
memberRoutes.get("/family/members", requireParent, (c) => {
  const fam = parentFamilyFrom(c)!;
  const me = parentMemberFrom(c);
  return c.json({
    me: memberView(me),
    members: memberRepo.listMembers(fam.id).map((m) => rosterView(m, me?.id ?? null)),
    invites: canInvite(me)
      ? memberRepo.listPendingInvites(fam.id).map((i) => ({
        id: i.id, label: i.label, role: i.role, expiresAt: i.expires_at,
      }))
      // A supporter cannot invite, so an outstanding invitation is not their business.
      : [],
    /** Whether paying from your OWN wallet means anything on this instance. Under server
     *  custody every payout leaves the shared hot wallet whoever approves, so the roster
     *  must not offer to connect a wallet that would never be asked to sign. */
    ownWalletPays: custodyMode() === "parent",
  });
});

// ---- inviting ----

/**
 * Mint a join code for one named person in one named role.
 *
 * The label is chosen by the INVITER, not typed by whoever redeems it. A code is a capability:
 * letting the redeemer name themselves means the household roster says whatever the person
 * holding the code decided it should say, and the one who can check that is the one who sent
 * it. So "Grandma Jo" is Grandma Jo because her daughter said so.
 */
memberRoutes.post("/family/members/invite", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const me = parentMemberFrom(c);
  const body = await c.req.json().catch(() => ({}));
  const role = String(body.role ?? "supporter");
  if (!memberRepo.isMemberRole(role)) return c.json({ error: "invalid_role" }, 400);
  // Two refusals in one test, and they are different refusals: a supporter may not invite at
  // all, and a co-parent may not mint another co-parent. Nobody hands out `owner` — a
  // household has exactly one and it is set at onboarding.
  if (!mayGrantRole(me, role)) return c.json(NOT_ALLOWED, 403);
  const label = String(body.label ?? "").trim();
  if (!label) return c.json({ error: "label_required" }, 400);
  if (label.length > LABEL_MAX) return c.json({ error: "label_too_long", max: LABEL_MAX }, 400);

  const code = newCode();
  const invite = memberRepo.createMemberInvite(
    fam.id, await sha256Hex(code), role, label, MEMBER_INVITE_TTL_MS,
  );
  // The code is returned ONCE and only the hash is kept, exactly like a bearer token.
  return c.json({
    code, inviteId: invite.id, label, role, expiresAt: invite.expires_at,
    ttlMs: MEMBER_INVITE_TTL_MS,
  }, 201);
});

/** Take an invitation back before it is used. Whoever may invite may un-invite. */
memberRoutes.delete("/family/members/invite/:id", requireParent, (c) => {
  const fam = parentFamilyFrom(c)!;
  if (!canInvite(parentMemberFrom(c))) return c.json(NOT_ALLOWED, 403);
  return memberRepo.revokeMemberInvite(c.req.param("id") ?? "", fam.id)
    ? c.json({ ok: true })
    : c.json({ error: "not_found" }, 404);
});

/**
 * The other side: type the code, get a parent token bound to a NEW member row.
 *
 * Public and unauthenticated by necessity — the person joining has nothing yet. It shares the
 * brakes in ../pair-brake with `POST /api/pair` and `POST /api/devices/register` rather than
 * having its own, because a guess is tested against every live code at once and a third
 * endpoint with a third allowance is a third of the protection.
 */
memberRoutes.post("/members/join", async (c) => {
  if (!pairAttemptAllowed(clientIp(c)) || pairGuessBudgetSpent()) {
    return c.json({ error: "too_many_attempts" }, 429);
  }
  const body = await c.req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) return c.json({ error: "bad_code" }, 400);
  const invite = memberRepo.redeemMemberInvite(await sha256Hex(code));
  if (!invite) { recordPairGuessMiss(); return c.json({ error: "bad_code" }, 404); }
  const fam = repo.getFamily(invite.family_id);
  if (!fam) { recordPairGuessMiss(); return c.json({ error: "bad_code" }, 404); }

  const member = memberRepo.createMember(fam.id, invite.label, invite.role);
  const token = newToken();
  // The token is bound to the member, which is what makes every later approval say who made
  // it. Labelled from the invite so the household's session list reads "Grandma Jo's phone"
  // rather than the anonymous "Paired device" a pairing code produces.
  lockRepo.createParentToken(fam.id, `${invite.label}'s phone`, await sha256Hex(token), member.id);
  return c.json({
    token, // shown once; only the hash is stored
    family: { id: fam.id, parentLabel: fam.parent_label },
    member: memberView(member),
    /** Their next step, if there is one: connect a wallet so their own approvals pay from it. */
    connectWallet: custodyMode() === "parent",
  }, 201);
});

// ---- your own wallet ----

/**
 * Point your approvals at your own wallet.
 *
 * NO SIGNATURE PROOF, unlike registering a KID's address, and the asymmetry is the point. A
 * kid's address decides where money GOES, so the server must know the parent really chose it —
 * a wrong one there sends a child's savings to a stranger. This decides where money COMES
 * FROM, and a wrong one costs the person who typed it nothing worse than their own wallet
 * refusing to sign the intent (public/parent/payout-sign.js checks the connected account
 * against the intent's sender before the Hub ever opens).
 *
 * What it does need is to refuse an address that is ALREADY somebody's here. Not for tidiness:
 * claiming another grown-up's address would mint every one of your approvals against THEIR
 * wallet, so they alone could finish paying for work you approved — a way to make the
 * household's payouts un-signable that costs the person doing it nothing.
 */
memberRoutes.put("/family/members/me/address", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const me = parentMemberFrom(c);
  if (!me) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const raw = String(body.address ?? "").trim();
  // Clearing is allowed and is not a failure state: a grown-up who no longer wants to fund
  // anything goes back to approving, and their approvals fall back to the owner's wallet.
  if (!raw) {
    memberRepo.setMemberAddress(me.id, null);
    return c.json({ member: memberView(memberRepo.getMember(me.id)) });
  }
  const address = await normalizeNqAddress(raw);
  if (!address) return c.json({ error: "invalid_address" }, 400);

  const taken = grownUpHolding(
    memberRepo.listMembers(fam.id).filter((m) => m.id !== me.id), address,
  );
  if (taken) return c.json({ error: "address_taken", byLabel: taken.label }, 409);
  // A KID's address is refused for the reason the mint would refuse it anyway (`pays_self`),
  // said here where it can name what went wrong instead of failing at the wallet.
  const kid = repo.listChildren(fam.id).find(
    (ch) => ch.address && ch.address.replace(/\s+/g, "").toUpperCase() === address.replace(/\s+/g, "").toUpperCase(),
  );
  if (kid) return c.json({ error: "address_is_a_kid_wallet", byLabel: kid.label }, 409);

  memberRepo.setMemberAddress(me.id, address);
  return c.json({ member: memberView(memberRepo.getMember(me.id)) });
});

// ---- the roster, changed ----

/** Move somebody between roles. Owner only, and the owner's own role is not up for editing —
 *  a household with no owner has nobody who can fix it. */
memberRoutes.patch("/family/members/:id", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  if (!canManageHousehold(parentMemberFrom(c))) return c.json(NOT_ALLOWED, 403);
  const target = memberRepo.getMember(c.req.param("id") ?? "");
  if (!target || target.family_id !== fam.id || target.removed_at !== null) {
    return c.json({ error: "not_found" }, 404);
  }
  if (target.role === "owner") return c.json({ error: "cannot_change_owner" }, 409);
  const body = await c.req.json().catch(() => ({}));
  if (body.label !== undefined) {
    const label = String(body.label).trim();
    if (!label) return c.json({ error: "label_required" }, 400);
    if (label.length > LABEL_MAX) return c.json({ error: "label_too_long", max: LABEL_MAX }, 400);
    memberRepo.setMemberLabel(target.id, label);
  }
  if (body.role !== undefined) {
    const role = String(body.role);
    if (!memberRepo.isMemberRole(role)) return c.json({ error: "invalid_role" }, 400);
    if (role === "owner") return c.json({ error: "cannot_change_owner" }, 409);
    memberRepo.setMemberRole(target.id, role);
  }
  return c.json({ member: rosterView(memberRepo.getMember(target.id)!, null) });
});

/**
 * Show somebody out. Owner only.
 *
 * Soft on the row and hard on the credential: their phones stop working immediately
 * (removeMember drops their tokens), and the row stays so every approval they ever made can
 * still say who made it. Two households sharing a child is exactly the case where losing that
 * trail matters, and it is the case this whole feature exists for.
 *
 * Their pending approvals are LEFT ALONE. A card in the queue is the kid's work, not the
 * grown-up's, and cancelling it would punish the child for an argument between adults. Anyone
 * still here can answer it.
 */
memberRoutes.delete("/family/members/:id", requireParent, (c) => {
  const fam = parentFamilyFrom(c)!;
  const me = parentMemberFrom(c);
  if (!canManageHousehold(me)) return c.json(NOT_ALLOWED, 403);
  const target = memberRepo.getMember(c.req.param("id") ?? "");
  if (!target || target.family_id !== fam.id || target.removed_at !== null) {
    return c.json({ error: "not_found" }, 404);
  }
  // The owner cannot remove themselves: a household with no owner has no fallback payer, no
  // one who can invite, and no one who can undo it.
  if (target.role === "owner") return c.json({ error: "cannot_remove_owner" }, 409);
  return memberRepo.removeMember(target.id) ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

/**
 * Their own phone's notifications.
 *
 * Split from `POST /parent/notify-topic` (which mints the HOUSEHOLD's topic) because the whole
 * promise of this feature is that the tablet stops travelling — and a grown-up who never gets
 * the ping never approves anything. Idempotent for the same reason the family one is: rotating
 * a working topic silently unsubscribes the phone that was working.
 */
memberRoutes.post("/family/members/me/notify-topic", requireParent, (c) => {
  const me = parentMemberFrom(c);
  if (!me) return c.json({ error: "not_found" }, 404);
  const fresh = memberRepo.getMember(me.id);
  if (fresh?.notify_url) return c.json({ notifyUrl: fresh.notify_url, created: false });
  const notifyUrl = newNotifyUrl();
  memberRepo.setMemberNotifyUrl(me.id, notifyUrl);
  return c.json({ notifyUrl, created: true }, 201);
});

/** Their own phone's notifications, off. Cleared deliberately, never as a side effect. */
memberRoutes.delete("/family/members/me/notify-topic", requireParent, (c) => {
  const me = parentMemberFrom(c);
  if (!me) return c.json({ error: "not_found" }, 404);
  memberRepo.setMemberNotifyUrl(me.id, null);
  return c.json({ ok: true });
});
