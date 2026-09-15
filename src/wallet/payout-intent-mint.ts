/**
 * Minting a signing intent for a piece of work, and what a refusal LOOKS like over HTTP.
 *
 * TWO routes approve the same chore. `/api/chores/:id/approve` is the parent tapping a job on
 * the board; `/api/approvals/:id/approve` is the parent (or a tablet PIN) answering the queue
 * the kid submitted into. Under `HATCH_CUSTODY=parent` both must produce the SAME bytes for
 * the same work, refuse for the same reasons, and say so with the same status codes — so this
 * lives in one module rather than being transcribed into each route.
 *
 * That is not a tidiness argument. `mintPayoutIntent` claims the payout ref, and the ref is
 * derived from the subject, not from the route that reached it. Two transcriptions of "what do
 * we do when the claim comes back already held" is exactly the shape where one route resumes
 * the existing intent and the other quietly mints a second signable transaction for one chore.
 *
 * The status codes are here with the mint for the same reason. They are not a route's local
 * choice; they are part of the contract the parent app keys its resume path on.
 */

import type { Context } from "hono";
import { getClient } from "../nimiq/client";
import * as repo from "../repo";
import { mintPayoutIntent, type PayoutIntent } from "./payout-intent";

export type MintedIntent =
  | { ok: true; settledWhole?: false; intent: PayoutIntent }
  | { ok: true; settledWhole: true; settleLuna: number }
  | { ok: false; body: Record<string, unknown>; status: 400 | 409 | 502 };

/**
 * Mint the signing intent for approved work, or say why there is nothing to sign.
 *
 * The head height is read HERE and pinned into the intent, so a parent who takes twenty
 * minutes signs the same bytes they were shown. An unreachable node fails before anything is
 * committed to, which is the same ordering `prepare` uses on the server-signed path and for
 * the same reason: the caller then knows for certain that nothing can be half-done.
 */
export async function mintSubjectIntent(args: {
  fam: repo.Family;
  /** The acting grown-up's own wallet — see `payoutSender` (src/members.ts) for the three
   *  states behind it, and mintPayoutIntent for why it is NOT `fam.parent_address`. */
  sender: string;
  child: repo.Child;
  /** The GROSS — what the work is worth. What the parent signs is this minus the kid's
   *  deferred spending; see src/kid-netting.ts. */
  valueLuna: number;
  /** Rides along as the transaction's on-chain memo, so it is the job's own title. */
  message: string;
  /** The payout ref, which is also the intent id. Derived from the SUBJECT. */
  ref: string;
}): Promise<MintedIntent> {
  let headHeight: number;
  try {
    headHeight = await (await getClient()).getHeadHeight();
  } catch (err) {
    return {
      ok: false,
      status: 502,
      body: { error: "chain_unreachable", detail: String((err as Error)?.message ?? err) },
    };
  }
  const minted = mintPayoutIntent({
    ref: args.ref, fam: args.fam, sender: args.sender, child: args.child,
    valueLuna: args.valueLuna, message: args.message, headHeight,
  });
  // The kid's deferred spending ate the whole reward, so there is nothing for a wallet to do.
  // The work is still paid for — the debt it cleared IS the payment — so this is a success
  // the caller completes, not a refusal it unwinds. See src/kid-netting.ts.
  if (minted.ok && minted.settledWhole) {
    return { ok: true, settledWhole: true, settleLuna: minted.settleLuna };
  }
  if (minted.ok) return { ok: true, intent: minted.intent };
  if (minted.error === "already_settled") {
    return { ok: false, status: 409, body: { error: "already_paid", settleLuna: minted.settleLuna } };
  }
  if (minted.error === "already_claimed") {
    // Not an error to a parent: it is the SAME payout, and handing the existing intent back
    // is what makes a second tap (or a mobile redirect that lost the page) resumable rather
    // than a second popup signing different bytes for one chore.
    return minted.intent
      ? { ok: false, status: 409, body: { error: "already_claimed", signingIntent: minted.intent } }
      : { ok: false, status: 409, body: { error: "already_claimed" } };
  }
  // `no_kid_address` is the interesting one: under parent custody a kid has no address until
  // a parent registers one out of their own wallet, and the parent app has a flow for exactly
  // that. Saying which thing is missing is what lets it offer the flow instead of a shrug.
  return { ok: false, status: 400, body: { error: minted.error } };
}

/** The refusal, as the response both routes send. Split out so neither has to remember that
 *  the status travels with the body. */
export const mintRefusal = (c: Context, minted: Extract<MintedIntent, { ok: false }>): Response =>
  c.json(minted.body, minted.status);
