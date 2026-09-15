// The kid character picker: the two endpoints the first-login choice rides on.
//
//   GET  /api/kids/:id/character-choices  -> { setId, choices: [{ index, address }], shufflesLeft }
//   POST /api/kids/:id/character          { setId, index } -> { child }
//
// These go through `childMoneyGate`, not `requireParent`, and that is the deliberate difference
// from src/routes/kid-address.ts next door. The gate is what makes a kid-authed pick safe: a
// device bearer must be unlocked AS THIS KID (the #123 switch gate), so a sibling on the shared
// tablet cannot choose for them, and a parent bearer legitimately acts for any kid in the house.
//
// What a caller may influence: which of nine offered indices. Not the address, not the path, not
// how many are offered. The rules live in src/kid-character.ts; this file is the HTTP shape and
// the status codes.

import { Hono } from "hono";
import type { Context } from "hono";
import * as repo from "../repo";
import { childMoneyGate } from "./families";
import {
  claimCharacter, issueCharacterSet, MAX_SETS_PER_CHILD, type CharacterRefusal,
} from "../kid-character";

export const kidCharacterRoutes = new Hono();

/** Every refusal's status code in one place, so the two endpoints cannot drift apart. */
function statusFor(error: CharacterRefusal): number {
  switch (error) {
    case "set_not_found":
      return 404;
    // The kid already has an account, someone took the index first, or the offer is spent.
    // All three mean "the world moved", which is a conflict, not a bad request.
    case "already_chosen":
    case "index_taken":
    case "set_used":
    case "set_expired":
      return 409;
    // The instance does not derive kid addresses at all; nothing the caller sends can fix it.
    case "parent_custody":
      return 409;
    case "no_shuffles_left":
      return 429;
    case "not_offered":
      return 400;
  }
}

/** The child this request is allowed to act for, or the gate's own refusal. */
async function gated(c: Context) {
  const gate = await childMoneyGate(c, c.req.param("id") ?? "");
  return gate;
}

kidCharacterRoutes.get("/kids/:id/character-choices", async (c) => {
  const gate = await gated(c);
  if (!gate.ok) return c.json(gate.body, gate.status as 401 | 403 | 404);

  const res = await issueCharacterSet(gate.fam, gate.child);
  if (!res.ok) return c.json({ error: res.error }, statusFor(res.error) as 400 | 404 | 409 | 429);

  return c.json({
    setId: res.id,
    // Addresses only. The identicon is drawn on the device from the address string; no key
    // material exists in this response and none ever should.
    choices: res.choices,
    expiresAt: res.expiresAt,
    shufflesLeft: res.shufflesLeft,
    maxSets: MAX_SETS_PER_CHILD,
  }, 201);
});

kidCharacterRoutes.post("/kids/:id/character", async (c) => {
  const gate = await gated(c);
  if (!gate.ok) return c.json(gate.body, gate.status as 401 | 403 | 404);

  const body = await c.req.json().catch(() => ({}));
  const setId = String(body?.setId ?? "");
  const index = Number(body?.index);
  // A missing index and index 0 are different things, and Number(undefined) is NaN rather than
  // 0, so this rejects the first without rejecting the second.
  if (!setId || !Number.isInteger(index)) return c.json({ error: "choice_required" }, 400);

  const res = await claimCharacter(gate.fam, gate.child, { setId, index });
  if (!res.ok) return c.json({ error: res.error }, statusFor(res.error) as 400 | 404 | 409 | 429);

  const child: repo.Child = res.child;
  return c.json({
    child: {
      id: child.id, label: child.label, emoji: child.emoji,
      address: child.address, addressSource: child.address_source,
    },
  }, 201);
});
