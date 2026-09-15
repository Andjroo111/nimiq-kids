// Relaying a payout the parent's own wallet signed.
//
//   POST /api/payouts/broadcast  { intentId, serializedTx }  -> { event, txHash }
//
// PARENT-authed, never kid- or device-authed. A tablet must not be able to push bytes into
// the family's payout ledger, even correct ones.
//
// The intent id goes in the BODY rather than the path. It is `chore:<uuid>` — a colon in a
// path segment survives most stacks and is mangled by some, and a payout that fails because a
// proxy normalised a URL is a bad way to find that out.
//
// The rules live in src/wallet/payout-relay.ts; this file is the HTTP shape and the status
// codes. The one decision made here is what a refusal LOOKS like: a stable machine-readable
// `error`, with the specific field that disagreed alongside it, so the parent app can say
// which thing was wrong instead of "that didn't work".

import { Hono } from "hono";
import { parentFamilyFrom, parentMemberFrom, requireParent } from "../auth";
import { getClient, NETWORK_ID, SIM } from "../nimiq/client";
import { getPayoutIntent } from "../wallet/payout-intent";
import { relayParentSignedPayout } from "../wallet/payout-relay";
import { settlePayoutSubject } from "../wallet/payout-subject";
import { publishLockChange } from "../lock-events";
import { eventView } from "./wallet";

export const payoutRoutes = new Hono();

payoutRoutes.post("/payouts/broadcast", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const body = await c.req.json().catch(() => ({}));
  const intentId = String(body.intentId ?? "");
  const serializedTx = String(body.serializedTx ?? "");
  if (!intentId) return c.json({ error: "intent_required" }, 400);
  if (!/^[0-9a-fA-F]{20,}$/.test(serializedTx)) return c.json({ error: "invalid_tx" }, 400);

  const intent = getPayoutIntent(intentId);
  // Same 404 for "no such intent" and "not yours", so this is not a probe for other
  // households' payout refs. The ownership test still runs inside the relay, because a
  // route-level check is the wrong place for the invariant that protects the ledger.
  if (!intent || intent.familyId !== fam.id) return c.json({ error: "not_found" }, 404);

  // SIM has no chain to broadcast to, so the relay would be verifying a signature against a
  // network that does not exist. Off-SIM only; the sim path keeps paying the way it always
  // has, out of the instance's fake ledger.
  if (SIM) return c.json({ error: "sim_no_broadcast" }, 409);

  const res = await relayParentSignedPayout({
    fam,
    intent,
    serializedTx,
    networkId: NETWORK_ID,
    broadcast: async (hex) => (await getClient()).sendTransaction(hex),
  });

  if (!res.ok) {
    if (res.error === "not_your_intent") return c.json({ error: "not_found" }, 404);
    if (res.error === "invalid_tx") return c.json({ error: "invalid_tx" }, 400);
    if (res.error === "different_bytes_already_broadcast") return c.json(res, 409);
    // 422, not 400: the request is well-formed and the signature is real, it just does not
    // do what this instance asked for. That is a different thing for a client to handle.
    return c.json(res, 422);
  }
  // The money is on the wire, so the work it paid for is finished. Doing this HERE rather
  // than inside the relay keeps that module about one transaction and nothing else — it is
  // the same seam `applyApprove` sits on, one request later. Idempotent, so the replay branch
  // above runs it too: a parent whose first response was lost gets a settled board on the
  // retry rather than a chore stuck pending behind a payout that already paid.
  // Credited to the grown-up who posted the signed bytes. That is not an inference: the relay
  // above refuses anything whose sender is not the address this instance named in the intent,
  // so the phone that got here is the one holding the wallet the money left.
  const subject = settlePayoutSubject(intent.intentId, "remote", parentMemberFrom(c)?.id ?? null);
  if (subject.settled) publishLockChange();

  return c.json({
    event: eventView(res.event, fam.parent_address),
    txHash: res.txHash,
    replayed: res.replayed,
    subject,
  });
});
