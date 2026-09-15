// The switch gate's endpoints (#123): enrol a kid's secret picture, prove it, reset it.
//
// Every route here takes a DEVICE bearer, because the thing being changed is a fact about a
// tablet — which kid it is currently open as. A parent acting from their phone does not
// switch kids on a tablet they are not holding, and childMoneyGate never gates a parent
// bearer anyway.
//
// See src/kid-switch.ts for why the secret is pictures rather than the family PIN, and why
// an un-enrolled kid is deliberately left open.

import { Hono } from "hono";
import type { Context } from "hono";
import * as repo from "../repo";
import * as lockRepo from "../repo-lock";
import { bearerDevice, verifyFamilyPin } from "../auth";
import { clientIp } from "../client-ip";
import {
  SWITCH_SECRET_TAPS, checkSwitchSecret, clearSwitchSecret, hasSwitchSecret,
  lockDevicesFor, parseSecret, setSwitchSecret, switchPictureGrid, unlockDeviceFor,
} from "../kid-switch";

export const kidSwitchRoutes = new Hono();

type Tablet =
  | { ok: true; device: lockRepo.Device; child: repo.Child; fam: repo.Family }
  | { ok: false; status: 401 | 404; body: { error: string } };

/** Resolve the calling tablet and the kid it is asking about, in one place. */
async function tabletAndKid(c: Context, childId: string): Promise<Tablet> {
  const device = await bearerDevice(c);
  if (!device) return { ok: false, status: 401, body: { error: "device_auth_required" } };
  const child = repo.getChild(childId);
  // Cross-household reads answer 404, never 403: a wrong-family id must not be
  // distinguishable from an id that does not exist.
  if (!child || child.family_id !== device.family_id) {
    return { ok: false, status: 404, body: { error: "child_not_found" } };
  }
  const fam = repo.getFamily(child.family_id);
  if (!fam) return { ok: false, status: 404, body: { error: "child_not_found" } };
  return { ok: true, device, child, fam };
}

/** The picture grid itself, so the kid app never keeps a second copy of the order.
 *  Each entry carries its drawn art AND the emoji it replaces: the client draws the
 *  PNG and falls back to the emoji, so a missing file costs a picture, not a login. */
kidSwitchRoutes.get("/switch/pictures", (c) =>
  c.json({ pictures: switchPictureGrid(), taps: SWITCH_SECRET_TAPS }));

/**
 * Become this kid on this tablet.
 *
 * `{ secret }` is the kid's own way in. `{ pin }` is the parent's override for the kid who
 * forgot, and it is the reason a forgotten secret is an inconvenience rather than a locked
 * account.
 */
kidSwitchRoutes.post("/kids/:id/unlock", async (c) => {
  const r = await tabletAndKid(c, c.req.param("id"));
  if (!r.ok) return c.json(r.body, r.status);
  const { device, child, fam } = r;
  const body = await c.req.json().catch(() => ({}));

  // An un-enrolled kid is open by design, and answering ok here (rather than an error)
  // keeps the client's path identical: the app always asks to unlock, and only the server
  // decides whether that cost anything.
  if (!hasSwitchSecret(child.id)) {
    unlockDeviceFor(device.id, child.id);
    return c.json({ ok: true, via: "no_secret", enrolled: false });
  }

  if (body.pin !== undefined) {
    const res = await verifyFamilyPin(fam, String(body.pin ?? ""));
    if (!res.ok) {
      const status = res.error === "locked" ? 423 : 401;
      return c.json({ ok: false, error: res.error, lockedUntil: res.lockedUntil ?? null }, status);
    }
    unlockDeviceFor(device.id, child.id);
    return c.json({ ok: true, via: "pin", enrolled: true });
  }

  const check = await checkSwitchSecret(child.id, body.secret, clientIp(c));
  if (!check.ok) {
    return c.json({ ok: false, error: check.error }, check.error === "too_many_guesses" ? 429 : 401);
  }
  unlockDeviceFor(device.id, child.id);
  return c.json({ ok: true, via: "secret", enrolled: true });
});

/**
 * Set or change a kid's secret picture.
 *
 * FIRST one is unguarded, and that is the deliberate part. Before a kid enrols, their
 * account is open to everyone holding this tablet, so requiring proof to close it would
 * only mean fewer kids ever close it. CHANGING one needs the old secret or the family PIN,
 * which is what stops a sibling taking an account over after the fact.
 */
kidSwitchRoutes.post("/kids/:id/switch-secret", async (c) => {
  const r = await tabletAndKid(c, c.req.param("id"));
  if (!r.ok) return c.json(r.body, r.status);
  const { device, child, fam } = r;
  const body = await c.req.json().catch(() => ({}));

  const next = parseSecret(body.secret);
  if (!next) return c.json({ error: "invalid_secret" }, 400);

  if (hasSwitchSecret(child.id)) {
    if (body.pin !== undefined) {
      const res = await verifyFamilyPin(fam, String(body.pin ?? ""));
      if (!res.ok) {
        const status = res.error === "locked" ? 423 : 401;
        return c.json({ ok: false, error: res.error, lockedUntil: res.lockedUntil ?? null }, status);
      }
    } else {
      const check = await checkSwitchSecret(child.id, body.oldSecret, clientIp(c));
      if (!check.ok) {
        return c.json({ ok: false, error: check.error }, check.error === "too_many_guesses" ? 429 : 401);
      }
    }
    // A changed secret closes the kid everywhere else. The reason to change one is that
    // somebody else learned it, and leaving their tablet open would answer the wrong half
    // of that. This tablet is re-opened immediately below.
    lockDevicesFor(child.id);
  }

  await setSwitchSecret(child.id, next);
  unlockDeviceFor(device.id, child.id);
  return c.json({ ok: true }, 201);
});

/**
 * Forget a kid's secret, so their next open re-enrols them. Parent PIN only: this is the
 * one door that turns the gate back off, so it is the one that cannot be opened by knowing
 * the thing the gate is protecting.
 */
kidSwitchRoutes.delete("/kids/:id/switch-secret", async (c) => {
  const r = await tabletAndKid(c, c.req.param("id"));
  if (!r.ok) return c.json(r.body, r.status);
  const { child, fam } = r;
  const body = await c.req.json().catch(() => ({}));
  const res = await verifyFamilyPin(fam, String(body.pin ?? ""));
  if (!res.ok) {
    const status = res.error === "locked" ? 423 : 401;
    return c.json({ ok: false, error: res.error, lockedUntil: res.lockedUntil ?? null }, status);
  }
  clearSwitchSecret(child.id);
  lockDevicesFor(child.id);
  return c.json({ ok: true });
});
