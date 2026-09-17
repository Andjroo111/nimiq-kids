// Which kid a tablet is acting as.
//
// THE SECRET PICTURES ARE GONE (Andjroo, 2026-09-16: "remove the pin entry where the kid has
// to pick two different characters"). From 2026-08 (#123) to 2026-09-16 a kid on a shared
// tablet enrolled two secret pictures and tapped them to open their own account, so a sibling
// could not become them. Andjroo took it out: each of the two tablets in the house is paired
// to one kid, and the gate was a screen every kid met on every open for a hole that pairing
// already covers in practice. What the gate protected is documented in git (this file at
// `fb0bbe4` and before), and the money routes still consult `deviceMayActAs`, so the gate
// can come back as a policy change here without touching them.
//
// ⚠️ THE CONSEQUENCE, stated plainly: on one tablet, tapping a sibling's name now opens the
// sibling's Treasure Box and Send screen. Sends still need a parent's approval on the
// mainnet instance (custody=parent); a Treasure Box purchase does not.
//
// What stays: the tablet records WHICH kid it is acting as (`devices.unlocked_child_id`),
// set by `POST /api/kids/:id/unlock` on every switch, because the parent app reads it and
// because the gate's return needs it. The `kid_switch_secrets` table stays in the schema
// with whatever rows it holds; nothing reads or writes it.

import { getDb } from "./db";

/** Is this device allowed to act as this kid right now? Always, since 2026-09-16. Kept as
 *  the one predicate every money route asks, so a future gate is a change HERE. */
export function deviceMayActAs(_device: { unlocked_child_id: string | null }, _childId: string): boolean {
  return true;
}

/** Hand this device to a kid. Replaces whoever it was acting as; there is only ever one. */
export function unlockDeviceFor(deviceId: string, childId: string): void {
  getDb().run("UPDATE devices SET unlocked_child_id=? WHERE id=?", [childId, deviceId]);
}

/** Every device a kid is currently open on. */
export function lockDevicesFor(childId: string): number {
  return getDb().run("UPDATE devices SET unlocked_child_id=NULL WHERE unlocked_child_id=?", [childId]).changes;
}
