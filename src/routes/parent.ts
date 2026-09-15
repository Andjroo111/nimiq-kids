// Parent phone page endpoints: PIN pre-check for the on-tablet pad, and the
// one-call overview the phone page renders from.

import { Hono } from "hono";
import * as repo from "../repo";
import * as approvalsRepo from "../repo-approvals";
import * as lockRepo from "../repo-lock";
import * as wrepo from "../repo-wallet";
import * as budget from "../repo-budget";
import * as memberRepo from "../repo-members";
import { parentFamilyFrom, parentMemberFrom, requireParent, verifyFamilyPin } from "../auth";
import { memberView } from "../members";
import { PAIRING_REQUIRED, requestFamily } from "./families";
import { enrichApproval } from "./approvals";
import { sanitizeFamily } from "./stars";
import { HOT_BALANCE_KEY, normalizeNqAddress } from "./wallet";
import { custodyMode } from "../custody-boot";
import { custodyView } from "../custody";
import { familySpendKey, withSpendLock } from "../wallet/spend-lock";
import { newNotifyUrl } from "../notify-topic";
import { refuseHouseholdWrite } from "./members";

export const parentRoutes = new Hono();

/** On-tablet PIN pad check (also used before showing parent-only screens on the tablet). */
parentRoutes.post("/parent/verify-pin", async (c) => {
  const fam = await requestFamily(c); // the tablet's own household (or its paired device's)
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  const body = await c.req.json().catch(() => ({}));
  const res = await verifyFamilyPin(fam, String(body.pin ?? ""));
  if (res.ok) return c.json({ ok: true });
  const status = res.error === "locked" ? 423 : 401;
  return c.json({ ok: false, error: res.error, lockedUntil: res.lockedUntil ?? null }, status);
});

/**
 * Mint this family's notification topic, so a parent never has to know what ntfy is (#124).
 *
 * The one thing a parent had to do to make their phone ring was find Settings and paste a
 * topic URL into a bare `type="url"` box. Nothing in onboarding did it, so for most families
 * every notifyParent() call was a no-op: a kid finished a chore, the server built a good
 * message with a deep link to that exact approval, and dropped it.
 *
 * IDEMPOTENT. An existing URL is RETURNED, never replaced. Rotating would silently
 * unsubscribe a phone that is already working, and the symptom of that is notifications
 * quietly stopping — which is the exact failure this endpoint exists to end. A parent who
 * genuinely wants a new topic clears the field in Settings first; that is a deliberate,
 * visible act with a warning attached, not a side effect of tapping a button twice.
 *
 * The URL is returned to the parent who owns it and to nobody else. It is never logged: it
 * is a bearer secret, and a log line is the one place a secret outlives the request that
 * carried it.
 */
parentRoutes.post("/parent/notify-topic", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  // The HOUSEHOLD's topic. Every other grown-up has their own
  // (POST /family/members/me/notify-topic) and does not need this one.
  const notAllowed = await refuseHouseholdWrite(c, fam);
  if (notAllowed) return notAllowed;
  const existing = repo.getFamily(fam.id)?.notify_url;
  if (existing) return c.json({ notifyUrl: existing, created: false });
  const notifyUrl = newNotifyUrl();
  repo.updateFamilySettings(fam.id, { notify_url: notifyUrl });
  return c.json({ notifyUrl, created: true }, 201);
});

/**
 * Correct the household's own wallet address. Parent-only, PARENT CUSTODY ONLY.
 *
 * `families.parent_address` had exactly one writer, `createFamily`, so a parent who
 * onboarded with the wrong address could not fix it without direct database access. That is
 * the second half of #136; the first half is that it was validated by a shape regex rather
 * than by the codec, so "wrong address" included ones that are not addresses at all.
 *
 * REFUSED UNDER SERVER CUSTODY, and this is the whole reason the route is not simply a field
 * on updateFamilySettings. On a server-custody instance the family wallet MUST be the
 * instance hot wallet: a kid's Treasure Box buy pays INTO `parent_address` while a
 * coupon-reject refund pays OUT of the hot wallet, and the per-family budget nets those to
 * zero only because they are the same account. Letting a parent point it at a wallet they own
 * is exactly the hole PR #166 closed on the onboarding side — the spend enriches their wallet
 * while the refund drains the shared float, unbounded, because the budget sees net zero.
 *
 * Under the family spend lock, so it cannot land between a payout's affordability check and
 * its broadcast, and validated by the codec so a typo is refused while refusing is free.
 */
parentRoutes.patch("/family/address", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  // The TILL is the household's, and moving it changes where every kid's Treasure Box spend
  // lands. Whoever's household it is decides that; a member's own paying wallet is set through
  // PUT /family/members/me/address, which needs no role at all.
  const notAllowed = await refuseHouseholdWrite(c, fam);
  if (notAllowed) return notAllowed;
  if (custodyMode() === "server") return c.json({ error: "server_custody_wallet_fixed" }, 409);
  const body = await c.req.json().catch(() => ({}));
  const address = await normalizeNqAddress(String(body.address ?? ""));
  if (!address) return c.json({ error: "invalid_address" }, 400);
  return withSpendLock(familySpendKey(fam.id), async (): Promise<Response> => {
    repo.setFamilyParentAddress(fam.id, address);
    // THE OWNER'S OWN WALLET MOVES WITH THE TILL, and only under parent custody — which is the
    // only world this route runs in at all (server custody is refused above).
    //
    // There, the two are the same account by construction: the household's till IS the owner's
    // wallet, and it is what `payoutSender` falls back to for an on-tablet PIN. Correcting one
    // and not the other would leave a parent who fixed a typo'd address still minting payouts
    // from the wrong wallet — a correction that visibly worked and quietly did not. Only the
    // owner is touched; every other grown-up's wallet is theirs and is set by their own phone.
    const owner = memberRepo.ownerOf(fam.id);
    if (owner) memberRepo.setMemberAddress(owner.id, address);
    return c.json({ address });
  });
});

/** Everything the phone page needs in one call.
 *  W3 additive fields (parent companion v2, cheap DB reads only — no RPC):
 *  per-kid `address` (null until the kid account is provisioned) + `stakedLuna`
 *  (ledger), and family-level `hotWalletLuna` (last deposit-check snapshot). */
parentRoutes.get("/parent/overview", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const pending = approvalsRepo.listApprovals(fam.id, "pending").map(enrichApproval);
  // NO `balanceLuna` here, deliberately (#132). It used to publish `children.balance_luna`,
  // which repo.ts itself calls "a convenience tally only" and which nothing writes off SIM,
  // so on every real-settlement instance this contract reported 0 NIM for a kid holding
  // thousands. The shipped parent app happened to be right because it prefers the per-kid
  // wallet fetch, but that line ended `?? k.balanceLuna`, so the stale 0 was the fallback
  // whenever the fetch had not resolved or had failed.
  //
  // Not filled from the chain either: this handler is DB reads only, on purpose, and the
  // honest version costs one RPC getBalance per kid on the parent's home screen. A bulk
  // balance read against the public RPC also fails DOWNWARD under rate limiting — it
  // under-reports rather than erroring — so the RPC version of this field would be wrong in
  // a second, quieter way. `GET /kids/:id/wallet` is the one place that answers it.
  const children = repo.listChildren(fam.id).map((ch) => ({
    id: ch.id, label: ch.label, emoji: ch.emoji,
    starBalance: ch.star_balance,
    address: ch.address ?? null,
    // Who holds this kid's key. The parent app pins a 'parent' address locally and refuses
    // to build anything for a recipient that does not match, so it has to be able to tell
    // a registered address from a server-derived one — an address alone cannot say.
    addressSource: ch.address_source ?? null,
    registeredAt: ch.address_registered_at ?? null,
    stakedLuna: wrepo.stakedFromLedger(ch.id),
    // The screen-time rule for this kid (#377). Two integers rather than a computed
    // "minutes left today": this is the SETTING a parent edits, and the live remainder is
    // a different question that /parent/screen-state already answers per tablet.
    dailyScreenMin: ch.daily_screen_min,
    maxEarnedMin: ch.max_earned_min,
    // Sittings: play for playMin in one go, then rest restMin. Either 0 = no rule.
    playMin: ch.play_min,
    restMin: ch.rest_min,
    // The language this kid's TABLET reads in (#432). Null is a value, not a gap: it means
    // follow the device, and the picker has to be able to draw that as its own choice rather
    // than guessing English on the parent's behalf.
    lang: ch.lang ?? null,
    override: lockRepo.activeOverride(fam.id, ch.id),
    // The minutes this kid PAID FOR, sent alongside the winner rather than instead of it
    // (#304). A parent's own row hides a purchase from `override` entirely — author beats
    // recency — and the phone has to be able to say so, or "Clear" reads as "back to the
    // schedule" while it actually hands back bought minutes. Same row when the purchase IS
    // the winner; the client compares ids and never re-decides which one is in charge.
    purchasedUnlock: lockRepo.purchasedUnlock(fam.id, ch.id),
  }));
  // "Family wallet" = what THIS family can actually pay out.
  //
  // On a single-household install those are the same number: the hot wallet is the
  // family's own, and the family is budget-exempt. On a PUBLIC multi-family instance
  // one hot wallet serves everyone, so the raw snapshot would show every household the
  // whole instance float — a figure they can neither spend nor claim. A budgeted family
  // therefore sees its remaining budget (grant + its own attributed top-ups - spent),
  // which is the number every payout is actually checked against.
  //
  // This was min(budget, raw snapshot), which leaked: as soon as the shared wallet fell
  // below a family's remaining budget the minimum WAS the raw float, so every household
  // on the instance was shown the same number and watched it move by exactly the amount
  // of whichever other household had just topped up. `visibleFundsLuna` is the fix and
  // the single place that decision now lives — see repo-budget.ts for why an optimistic
  // figure beats a leaky one.
  //
  // NULL when the chain has never been read. The snapshot is only written by
  // deposit-check, so on a fresh install `?? 0` rendered a confident "Family wallet
  // 0 NIM / $0.00" for a hot wallet actually holding 110,000 NIM — and TOTAL BALANCE
  // silently omitted it. "Not checked yet" and "checked, empty" are different facts and
  // the parent app now renders them differently.
  const hotWalletLuna = budget.visibleFundsLuna(fam);
  // The family's own wallet address, so home can draw its identicon instead of
  // borrowing the Nimiq brand hexagon as an avatar. A plain column read, no RPC.
  // ensureFamily() writes an all-zero placeholder when the provider could not be
  // reached at bootstrap; that is not an address and must not become a face.
  const parentAddress = fam.parent_address && !/^NQ00[\s0]*$/.test(fam.parent_address)
    ? fam.parent_address
    : null;
  // WHO SIGNS A PAYOUT, stated rather than left to be inferred. Under parent custody an
  // approval hands back something to sign instead of paying, and the card has to know that
  // BEFORE the tap: what it says on the button, and whether the parent needs their wallet
  // connected, are both decided while the screen is being drawn. Inferring it from a 202 is
  // the exact inference `custodyView` exists to make unnecessary — and it can only be made
  // after the parent has already tapped a button labelled with the wrong verb.
  const custody = custodyView(fam);
  // WHICH GROWN-UP is holding this phone, and what they may do — published rather than left to
  // be inferred, for the same reason `custody` is. Every screen decides what to offer while it
  // is being drawn: a supporter must not be shown an "edit reward" button that answers 403
  // after they have already typed a number into it, and the payer line on an approval card has
  // to know whose wallet it is about BEFORE the tap.
  const me = memberView(parentMemberFrom(c));
  return c.json({
    family: sanitizeFamily(fam), pending, children, hotWalletLuna, parentAddress, custody,
    member: me,
    serverTime: Date.now(),
  });
});
