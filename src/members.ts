// What each grown-up in a household is allowed to do, in ONE place.
//
// The rules live here rather than as a `role === 'supporter'` test written out at each of the
// two dozen call sites, for the same reason `SUBJECT_PAYS_KID` is a single Set in
// routes/approvals.ts: a predicate transcribed N times is a bug with a delay on it. Miss one
// transcription on the board routes and a grandparent can reprice the job she is about to pay
// for; miss one on the household routes and she can sign the other parent's phone out.
//
// ## The shape of the three roles
//
// `owner`     the household's own parent. Everything, and the only one who can add or remove
//             grown-ups. Exactly one per household, set at onboarding, never handed out by an
//             invite code — two people who each believe they can remove the other is not a
//             permission model.
// `coparent`  the other parent, in the other house. The board, the queue, the kids, the
//             Treasure Box: everything about raising the child. Not the household's own
//             settings, and not the roster.
// `supporter` a grandparent. Sees the queue, approves, and pays out of their own wallet.
//             Money in, no say over the terms — they cannot change what a job is worth, which
//             is the whole reason this role is separate from `coparent` rather than a label
//             on it.
//
// ## What is deliberately NOT here
//
// Whether a grown-up can PAY is `canPay`, and it is about their wallet, not their role. A
// supporter with no address connected still approves; the payout simply falls back to the
// owner's wallet, exactly as it did before that supporter existed.

import type { Family } from "./repo";
import { ownerOf, type Member, type MemberRole } from "./repo-members";

/** Anyone still in the household can answer the queue. This is the point of the feature: the
 *  tablet stops travelling because more than one grown-up can say yes. */
export const canApprove = (m: Member | null): boolean => !!m && m.removed_at === null;

/** Can this grown-up's approval pay out of their OWN wallet? A question about their wallet,
 *  not their standing — see the note above on why it is not a role test. */
export const canPay = (m: Member | null): boolean => !!m && m.removed_at === null && !!m.address;

/** Jobs, routines, practices, kids, the Treasure Box — everything about what the child is
 *  asked to do and what it is worth. */
export const canManageBoard = (m: Member | null): boolean =>
  !!m && m.removed_at === null && (m.role === "owner" || m.role === "coparent");

/** The household itself: settings, the PIN, the family wallet address, device pairing, and
 *  the roster of grown-ups. One person owns these, and it is the person whose household it is. */
export const canManageHousehold = (m: Member | null): boolean =>
  !!m && m.removed_at === null && m.role === "owner";

/** Who may hand out a join code. A co-parent can bring in a grandparent on their own side of
 *  the family without going through the other house — which is the situation this whole
 *  feature exists for. Handing out a role above your own is refused separately, at the route. */
export const canInvite = canManageBoard;

/** May `actor` hand out `role`? Nobody invites an owner, and nobody invites above themselves. */
export function mayGrantRole(actor: Member | null, role: MemberRole): boolean {
  if (!canInvite(actor)) return false;
  if (role === "owner") return false;
  if (role === "coparent") return actor!.role === "owner";
  return true;
}

/** The refusal every gate above answers with, so the parent app sees one shape rather than
 *  a different message per route. 403, not 401: the token is good, the person is not allowed. */
export const NOT_ALLOWED = { error: "not_allowed" } as const;

/**
 * The grown-up in this household who already holds `address`, if any.
 *
 * Guarding a KID's address against it, on both registration paths. A kid whose address is a
 * grown-up's wallet is paid by a transaction from that wallet to itself: the balance never
 * moves, nothing errors anywhere, and the kid's screen shows nothing arriving — the same
 * silent nothing `address_is_the_family_wallet` has always refused, which until now could only
 * happen one way because a household had only one grown-up's wallet in it.
 *
 * Callers check the family's own till FIRST and keep its existing refusal, so a household with
 * one grown-up (where the owner's address and the till are the same account, by construction)
 * answers exactly as it did before this existed.
 */
export function grownUpHolding(members: Member[], address: string): Member | null {
  const bare = address.replace(/\s+/g, "").toUpperCase();
  return members.find(
    (m) => m.removed_at === null && m.address && m.address.replace(/\s+/g, "").toUpperCase() === bare,
  ) ?? null;
}

/**
 * WHOSE WALLET PAYS for work this grown-up just approved.
 *
 * One function, called by both approve routes, because "who pays" written down twice is the
 * shape of bug where the queue mints bytes for one wallet and the board mints them for another
 * — for the same chore, under the same payout ref.
 *
 * Three steps down, and each one is a real state rather than a fallback for tidiness:
 *
 *  1. **The acting grown-up's own wallet.** Whoever says yes, pays. This is the feature.
 *  2. **The owner's wallet.** Two cases land here and both must keep working. A grandparent who
 *     has joined but not connected a wallet yet still approves — her yes is worth having, and
 *     the household pays as it did before she arrived. And an ON-TABLET PIN approval has no
 *     acting grown-up at all (`parentAuth` returns method 'pin' with nobody behind it), because
 *     the household tablet is the owner's.
 *  3. **`families.parent_address`.** Belt and braces for a household whose owner row predates
 *     something; it is the address the owner's row was seeded from, so this is the same wallet.
 *
 * Null means nobody in this household can pay anybody — `mintPayoutIntent` turns that into
 * `no_parent_address`, which is exactly what it meant before members existed.
 *
 * The returned `memberId` is who to CREDIT, and it is deliberately the person whose wallet is
 * being asked, not the person who tapped: on step 2 the money is the owner's, and an audit
 * trail that named the tapper would say a grandparent paid for something she did not.
 */
export function payoutSender(
  fam: Family, acting: Member | null,
): { address: string; memberId: string | null } | null {
  if (acting && acting.removed_at === null && acting.address) {
    return { address: acting.address, memberId: acting.id };
  }
  const owner = ownerOf(fam.id);
  if (owner?.address) return { address: owner.address, memberId: owner.id };
  const till = (fam.parent_address ?? "").trim();
  return till ? { address: till, memberId: owner?.id ?? null } : null;
}

/** What the parent app is told about the grown-up holding this phone. Published so no screen
 *  has to infer a permission from the presence of a button, or discover it from a 403 after
 *  the parent has already tapped. */
export function memberView(m: Member | null) {
  if (!m) return null;
  return {
    id: m.id, label: m.label, role: m.role,
    /** Their own sender wallet. Null = joined, cannot pay from their own account yet. */
    address: m.address,
    /**
     * Their own notification topic, so their Settings screen can tell "pings are on" from
     * "pings have never been set up" without a second endpoint.
     *
     * A BEARER SECRET, and it is here only because `memberView` is ALWAYS the caller
     * describing THEMSELVES — the overview, the join response, and their own address write.
     * The roster of everyone else goes through `rosterView` (src/routes/members.ts), which
     * deliberately omits it. If this view is ever used to describe somebody else, this field
     * has to move first.
     */
    notifyUrl: m.notify_url,
    can: {
      approve: canApprove(m),
      pay: canPay(m),
      manageBoard: canManageBoard(m),
      manageHousehold: canManageHousehold(m),
      invite: canInvite(m),
    },
  };
}
