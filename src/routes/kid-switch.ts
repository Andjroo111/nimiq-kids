// Which kid a tablet is acting as: one route, `POST /api/kids/:id/unlock`, taken by the kid
// app on every switch. It takes a DEVICE bearer, because the thing being changed is a fact
// about a tablet. The secret-picture enrolment, proof and reset routes that lived here from
// #123 to 2026-09-16 are gone with the gate (see src/kid-switch.ts).

import { Hono } from "hono";
import type { Context } from "hono";
import * as repo from "../repo";
import * as lockRepo from "../repo-lock";
import { bearerDevice } from "../auth";
import { unlockDeviceFor } from "../kid-switch";

export const kidSwitchRoutes = new Hono();

type Tablet =
  | { ok: true; device: lockRepo.Device; child: repo.Child }
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
  return { ok: true, device, child };
}

/** The tablet is now this kid. Nothing to prove; the body is ignored. */
kidSwitchRoutes.post("/kids/:id/unlock", async (c) => {
  const r = await tabletAndKid(c, c.req.param("id"));
  if (!r.ok) return c.json(r.body, r.status);
  unlockDeviceFor(r.device.id, r.child.id);
  return c.json({ ok: true, via: "open" });
});
