// Parent-owned kid addresses: the two endpoints the registration flow rides on.
//
//   POST /api/kids/:id/address-challenge  { address }        -> { challengeId, message, expiresAt }
//   POST /api/kids/:id/address            { challengeId, publicKeyHex, signatureHex } -> { child }
//
// Both are PARENT-authed, never kid- or device-authed. A kid's tablet must not be able to
// point their own payouts somewhere, and a kiosk device is a shared object in a house.
//
// The rules live in src/kid-address.ts; this file is the HTTP shape and the status codes.
// The one decision made here is what a refusal LOOKS like, and it is: the machine-readable
// error stays stable, and the extra fields (`byLabel`, `address`, `balanceLuna`, `reason`)
// ride alongside so the parent app can say something true instead of "that didn't work".

import { Hono } from "hono";
import type { Context } from "hono";
import * as repo from "../repo";
import { parentFamilyFrom, requireParent } from "../auth";
import { getClient, SIM } from "../nimiq/client";
import {
  CHALLENGE_TTL_MS, issueChallenge, pruneExpiredChallenges, registerParentOwnedAddress,
} from "../kid-address";
import {
  CONNECT_CHALLENGE_TTL_MS, issueConnectChallenge, registerConnectedAddresses,
  type ConnectAssignment,
} from "../kid-address-connect";

export const kidAddressRoutes = new Hono();

/** The child, only if it belongs to the bearer's own family. Same 404 for "no such child"
 *  and "not yours", so the endpoint is not a probe for child ids on other households. */
function ownChild(c: Context): repo.Child | null {
  const fam = parentFamilyFrom(c);
  const id = c.req.param("id");
  const child = id ? repo.getChild(id) : null;
  return child && fam && child.family_id === fam.id ? child : null;
}

kidAddressRoutes.post("/kids/:id/address-challenge", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const child = ownChild(c);
  if (!child) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const res = await issueChallenge(fam, child, String(body.address ?? ""));
  if ("error" in res) {
    // 409 for the two "the world is already like this" refusals, 400 for a bad address.
    const status = res.error === "invalid_address" ? 400 : 409;
    return c.json(res, status);
  }
  pruneExpiredChallenges();
  return c.json({
    challengeId: res.id,
    address: res.address,
    // The client MUST sign this string verbatim. It never builds its own: the server owns
    // the nonce and the binding, and a client-composed message would bind nothing.
    message: res.message,
    expiresAt: res.expires_at,
    ttlMs: CHALLENGE_TTL_MS,
  }, 201);
});

kidAddressRoutes.post("/kids/:id/address", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const child = ownChild(c);
  if (!child) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const challengeId = String(body.challengeId ?? "");
  const publicKeyHex = String(body.publicKeyHex ?? "");
  const signatureHex = String(body.signatureHex ?? "");
  if (!challengeId || !publicKeyHex || !signatureHex) return c.json({ error: "proof_required" }, 400);

  // SIM has no chain to ask and no real money to strand, so the old-balance gate is off
  // there. Everywhere else a read that FAILS refuses the registration — see
  // registerParentOwnedAddress for why an unreadable balance is not a zero.
  const readBalance = SIM ? null : async (address: string) => (await getClient()).getBalance(address);

  const res = await registerParentOwnedAddress(
    fam, child, { challengeId, publicKeyHex, signatureHex }, { readBalance },
  );
  if (!res.ok) {
    const { ok: _ok, ...refusal } = res;
    const status = res.error === "balance_check_failed" ? 502
      : res.error === "funds_at_old_address" || res.error === "address_taken" ? 409
        : res.error === "challenge_not_found" ? 404
          : 400;
    return c.json(refusal, status);
  }
  return c.json({
    child: {
      id: res.child.id, label: res.child.label, emoji: res.child.emoji,
      address: res.child.address, addressSource: res.child.address_source,
      registeredAt: res.child.address_registered_at,
    },
  }, 201);
});

// ---- the batch route ---------------------------------------------------------------------
//
//   POST /api/family/connect-challenge  {}                          -> { challengeId, message }
//   POST /api/family/connect-addresses  { challengeId, assignments } -> { children }
//
// One popup for the whole family instead of one per child, and no manual "Add address" step,
// because `connectAccount` derives the paths the app asks for. The trade is that the signed
// message names the household rather than a child, so the child mapping is the client's word.
// src/kid-address-connect.ts says what that does and does not buy.

kidAddressRoutes.post("/family/connect-challenge", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const res = issueConnectChallenge(fam);
  return c.json({
    challengeId: res.id,
    // Passed to `connectAccount` as `challenge`, verbatim. The client never composes it: the
    // nonce and the family binding are ours, and a client-built string would bind nothing.
    message: res.message,
    expiresAt: res.expires_at,
    ttlMs: CONNECT_CHALLENGE_TTL_MS,
  }, 201);
});

kidAddressRoutes.post("/family/connect-addresses", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const body = await c.req.json().catch(() => ({}));
  const challengeId = String(body.challengeId ?? "");
  if (!challengeId) return c.json({ error: "proof_required" }, 400);
  if (!Array.isArray(body.assignments)) return c.json({ error: "no_assignments" }, 400);

  const assignments: ConnectAssignment[] = body.assignments.map((a: Record<string, unknown>) => ({
    childId: String(a?.childId ?? ""),
    keyPath: a?.keyPath === undefined ? undefined : String(a.keyPath),
    address: String(a?.address ?? ""),
    publicKeyHex: String(a?.publicKeyHex ?? ""),
    signatureHex: String(a?.signatureHex ?? ""),
  }));

  const readBalance = SIM ? null : async (address: string) => (await getClient()).getBalance(address);
  const res = await registerConnectedAddresses(fam, { challengeId, assignments }, { readBalance });
  if (!res.ok) {
    const { ok: _ok, ...refusal } = res;
    const status = res.error === "balance_check_failed" ? 502
      : res.error === "funds_at_old_address" || res.error === "address_taken"
        || res.error === "duplicate_address" || res.error === "duplicate_child" ? 409
        : res.error === "challenge_not_found" || res.error === "unknown_child" ? 404
          : 400;
    return c.json(refusal, status);
  }
  return c.json({
    children: res.children.map((child) => ({
      id: child.id, label: child.label, emoji: child.emoji,
      address: child.address, addressSource: child.address_source,
      registeredAt: child.address_registered_at,
    })),
  }, 201);
});
