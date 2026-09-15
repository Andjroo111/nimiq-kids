// Stars ledger + allowance-day payout (family mode). Payout converts the whole star
// balance into ONE Cashlink through the existing hot-wallet mint path — same
// primitive as chore payouts, new kind 'stars' so it never touches the streak mechanic.

import { Hono } from "hono";
import { mintCashlink } from "../nimiq/cashlink";
import * as repo from "../repo";
import * as approvalsRepo from "../repo-approvals";
import { bearerDeviceFamily, hashPin, parentAuth } from "../auth";
import { approvalPolicy } from "../custody";
import { makeProvider } from "../wallet";
import { checkPayable } from "../wallet/kid-wallet";
import { familySpendKey, withSpendLock } from "../wallet/spend-lock";
import { familyForSubject, PAIRING_REQUIRED, requestFamily } from "./families";
import { notifyUrlSafe } from "../ssrf-guard";
import { refuseHouseholdWrite } from "./members";

export const starsRoutes = new Hono();

// No ceiling on an allowance payout either: the parent sets the star rate, so the parent
// sets what a star is worth. Affordability is the only bound (see wallet/kid-wallet.ts).

starsRoutes.get("/children/:id/stars", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  return c.json({
    balance: child.star_balance,
    rateLuna: fam.star_rate_luna,
    events: approvalsRepo.listStarEvents(child.id),
  });
});

/** Allowance day: stars × rate → one Cashlink; a negative ledger row zeroes the balance. */
starsRoutes.post("/children/:id/payout", async (c) => {
  const child = repo.getChild(c.req.param("id"));
  const fam = child ? await familyForSubject(c, child.family_id) : null;
  if (!child || !fam) return c.json({ error: "child_not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const auth = await parentAuth(c, fam, body.pin);
  if (!auth.ok) return c.json(auth.body, auth.status);
  // Hot-wallet spend: serialized per family, with the star balance re-read under the lock —
  // two concurrent payouts must not both convert the same stars (src/wallet/spend-lock.ts).
  return withSpendLock(familySpendKey(fam.id), async (): Promise<Response> => {
  const stars = repo.getChild(child.id)?.star_balance ?? 0;
  if (stars <= 0) return c.json({ error: "no_stars" }, 400);
  const valueLuna = stars * fam.star_rate_luna;
  // Allowance-day mint is hot-wallet funded, so it answers to the same affordability check
  // as every other payout. Refused before the mint: no stars are debited, nothing is spent.
  {
    const b = await checkPayable(fam, valueLuna);
    if (!b.ok) {
      return c.json({ error: "budget_exhausted", neededLuna: valueLuna, availableLuna: b.availableLuna }, 400);
    }
  }
  // ⚠️ PRE-EXISTING, and NOT the exactly-once guarantee the chore/routine payout now has.
  // mintCashlink broadcasts the funding transaction and only then does createCashlink
  // persist the row — and the claim secret is generated INSIDE the mint, so until that row
  // exists it lives nowhere else. A node that accepts the funding and loses the response
  // therefore strands the NIM in a Cashlink address whose secret was never written down,
  // and the retry mints a SECOND one. A failure BEFORE the broadcast is genuinely harmless
  // (nothing is debited, the retry works); the two cases are indistinguishable from here.
  // The fix is the same write-ahead claim payKidEarn uses — tracked separately, not
  // smuggled into this change.
  try {
    const mint = await mintCashlink(makeProvider(), valueLuna, `nimiq.kids: ⭐ allowance day (${stars} stars)`);
    const cashlink = repo.createCashlink({
      id: crypto.randomUUID(),
      family_id: fam.id,
      chore_id: null,
      child_id: child.id,
      kind: "stars",
      cashlink_address: mint.cashlinkAddress,
      value_luna: mint.valueLuna,
      message: `⭐ ${stars} stars`,
      url: mint.url,
      funding_tx_hash: mint.fundingTxHash,
      status: "ready",
    });
    approvalsRepo.addStarEvent(fam.id, child.id, -stars, "payout", { cashlinkId: cashlink.id });
    return c.json({
      stars,
      cashlink: { id: cashlink.id, url: cashlink.url, valueLuna: cashlink.value_luna },
    });
  } catch (err) {
    return c.json({ error: "mint_failed", detail: String((err as Error)?.message ?? err) }, 502);
  }
  }); // withSpendLock
});

/** Family settings (star rate, notifications, tz, mode, PIN). Parent-gated. */
starsRoutes.patch("/family/settings", async (c) => {
  const fam = await requestFamily(c); // bearer family (parent app) or the legacy tablet household
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  // The household's own settings — the PIN, the timezone, the star rate, notifications —
  // belong to whoever's household it is. A co-parent runs the board, not the house.
  const notAllowed = await refuseHouseholdWrite(c, fam);
  if (notAllowed) return notAllowed;
  const body = await c.req.json().catch(() => ({}));
  const auth = await parentAuth(c, fam, body.pin);
  // Bootstrap exception: a family with NO PIN yet may set its first one without auth
  // (first-run setup on the legacy in-house tablet).
  //
  // It must NEVER be reachable from a paired kid tablet. `POST /api/onboard` sets no PIN,
  // so every self-serve family is permanently in the bootstrap state — and `parentAuth`
  // accepts a PIN as full parent authority, including on /api/approvals/:id/approve. A
  // device bearer that could take this branch could therefore mint the grown-up
  // credential and then approve its own sends, stakes and chore payouts, which defeats
  // the whole approval gate. So: no device bearer, and not on an instance that demands
  // auth at all (where requestFamily already refuses an anonymous caller — this is the
  // belt to that brace). A parent bearer never needs the exception: it already passed
  // parentAuth above.
  const viaDevice = await bearerDeviceFamily(c);
  const bootstrapping = !fam.pin_hash && body.newPin !== undefined
    && !viaDevice && !approvalPolicy().authRequired;
  if (!auth.ok && !bootstrapping) return c.json(auth.body, auth.status);

  const patch: Parameters<typeof repo.updateFamilySettings>[1] = {};
  if (body.mode !== undefined) {
    if (body.mode !== "demo" && body.mode !== "family") return c.json({ error: "invalid_mode" }, 400);
    // Demo mode is a sim/testnet affordance. Where approval is FORCED (mainnet for real,
    // or HATCH_REQUIRE_PARENT_APPROVAL=1) it buys nothing that custody would honour, and
    // leaving the flip writable let a demo-mode row re-open the legacy unauthenticated
    // payout paths that branch on fam.mode. Refused outright, so the row cannot lie.
    if (body.mode === "demo" && approvalPolicy().forced) {
      return c.json({ error: "demo_mode_unavailable" }, 400);
    }
    patch.mode = body.mode;
  }
  if (body.starRateLuna !== undefined) {
    const rate = Math.round(Number(body.starRateLuna));
    if (!Number.isFinite(rate) || rate <= 0) return c.json({ error: "invalid_rate" }, 400);
    patch.star_rate_luna = rate;
  }
  if (body.notifyUrl !== undefined) {
    if (body.notifyUrl) {
      // Server-side fetch target — must be a public https host, never a LAN/loopback address.
      if (!(await notifyUrlSafe(String(body.notifyUrl)))) return c.json({ error: "invalid_notify_url" }, 400);
      patch.notify_url = String(body.notifyUrl);
    } else {
      patch.notify_url = null; // clearing the webhook
    }
  }
  if (body.tz !== undefined) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: String(body.tz) });
    } catch {
      return c.json({ error: "invalid_tz" }, 400);
    }
    patch.tz = String(body.tz);
  }
  // The parent's switch on whether kids may take jobs off their own board.
  if (body.kidsCanRemove !== undefined) patch.kids_can_remove = body.kidsCanRemove ? 1 : 0;
  repo.updateFamilySettings(fam.id, patch);
  if (body.newPin !== undefined) {
    const pin = String(body.newPin);
    if (!/^\d{4,8}$/.test(pin)) return c.json({ error: "invalid_pin" }, 400);
    repo.setFamilyPin(fam.id, await hashPin(pin));
  }
  return c.json({ family: sanitizeFamily(repo.getFamily(fam.id)!) });
});

/** Never leak pin_hash to clients. `isDemo` is safe to expose and the parent app needs
 *  it: a demo household's PIN is a published constant, so Settings can show it rather
 *  than leaving a judge locked out of the tablet's approval pad. */
export function sanitizeFamily(f: repo.Family) {
  return {
    id: f.id, parentLabel: f.parent_label, mode: f.mode, starRateLuna: f.star_rate_luna,
    notifyUrl: f.notify_url, tz: f.tz, hasPin: !!f.pin_hash, isDemo: !!f.demo_at,
  };
}
