import { Hono } from "hono";
import type { Context } from "hono";
import { makeProvider } from "../wallet";
import * as repo from "../repo";
import { bearerDevice, bearerDeviceFamily, bearerFamily } from "../auth";
import { approvalPolicy } from "../custody";
import { deviceMayActAs } from "../kid-switch";

export const families = new Hono();

/**
 * LEGACY single-household bootstrap: the first family row, created on demand.
 * Pre-multi-family instances (Andjroo's live household, the demo) boot through
 * here — their kid tablets call instance-level endpoints with no auth at all.
 * Multi-family surfaces must NOT call this; they resolve the family from the
 * parent bearer (bearerFamily) or from the subject row (familyForSubject).
 */
async function ensureFamily(): Promise<repo.Family> {
  let fam = repo.firstFamily();
  if (!fam) {
    let address = "";
    try {
      address = await makeProvider().getAddress();
    } catch {
      address = "NQ00 0000 0000 0000 0000 0000 0000 0000 0000";
    }
    fam = repo.createFamily("Parent", address);
  }
  return fam;
}

/** Family for instance-level surfaces (kid tablet boot, demo pages, on-tablet PIN pad).
 *  Resolution order (slice 3): the parent bearer's family, then a paired kiosk DEVICE
 *  bearer's family (a paired tablet already knows its household), then the legacy
 *  first-household bootstrap — which any instance that demands auth disables, making
 *  these surfaces return null (routes answer 401 pairing_required). New (non-first)
 *  families are never exposed through the fallback.
 *
 *  v0.43: the disabling condition is approvalPolicy().authRequired rather than
 *  HATCH_LEGACY_BOOT alone. HATCH_LEGACY_BOOT=0 still implies it, but so does a
 *  mainnet-for-real instance and HATCH_REQUIRE_PARENT_APPROVAL=1 — otherwise an
 *  instance that forces approval still handed an anonymous caller a whole household
 *  through ensureFamily() (which creates it in the unlocked 'demo' mode). */
export async function requestFamily(c: Context): Promise<repo.Family | null> {
  const viaParent = await bearerFamily(c);
  if (viaParent) return viaParent;
  const viaDevice = await bearerDeviceFamily(c);
  if (viaDevice) return viaDevice;
  if (approvalPolicy().authRequired) return null;
  return ensureFamily();
}

/** The standard answer for an instance-level surface with no family context. */
export const PAIRING_REQUIRED = { error: "pairing_required" } as const;

/**
 * Family that owns a subject row (child, chore, run, device, approval...), for routes
 * addressed by an unguessable subject id. A valid parent bearer — or, since v0.43, a
 * paired kiosk DEVICE bearer — must belong to the subject's family: a token from
 * household A can never read or act on household B's rows (return null => 404).
 *
 * The deliberate decision on the read-only surfaces (task item 1): where the instance
 * demands auth, the subject id STOPS being a capability. It was one door short of the
 * money gate — `GET /children/:id` hands back the kid's real NQ address, and an address
 * is a public chain handle, so leaking it leaks that child's mainnet balance and whole
 * transaction history to anyone holding the id. On a relaxed instance (legacy
 * single-household boot, fresh clones, CI) the open fall-through is unchanged: the id
 * is the capability, which is the kid-tablet trust model these instances are built on.
 *
 * The device bearer is what makes closing it safe: every kid-app call already carries
 * one (public/kid/js/api.js), and a public instance only pairs tablets.
 */
export async function familyForSubject(c: Context, familyId: string): Promise<repo.Family | null> {
  const bf = await bearerFamily(c);
  if (bf) return bf.id === familyId ? bf : null;
  const dev = await bearerDeviceFamily(c);
  if (dev) return dev.id === familyId ? dev : null;
  if (approvalPolicy().authRequired) return null;
  return repo.getFamily(familyId);
}

export type MoneyGate =
  | { ok: true; child: repo.Child; fam: repo.Family; via: "parent" | "device" | "open" }
  | { ok: false; status: 401 | 403 | 404; body: { error: string } };

/**
 * Money-route resolver for /kids/:id/* and /children/:id/send — every endpoint that can
 * move or spend a kid's NIM. Unlike familyForSubject there is NO open fall-through when
 * the instance demands auth (approvalPolicy().authRequired), and a paired kiosk DEVICE
 * bearer counts: the kid tablet holds one wherever pairing happened.
 *
 * A valid bearer from ANOTHER household answers 404 (same cross-family semantics as
 * familyForSubject) — including device bearers, which previously fell through open.
 * On relaxed instances (legacy single-household boot, fresh clones, CI) the no-token
 * behavior is unchanged: the child id itself is the capability.
 */
export async function childMoneyGate(c: Context, childId: string): Promise<MoneyGate> {
  const viaParent = await bearerFamily(c);
  const device = viaParent ? null : await bearerDevice(c);
  const viaDevice = device ? repo.getFamily(device.family_id) : null;
  const bearerFam = viaParent ?? viaDevice;
  if (!bearerFam && approvalPolicy().authRequired) {
    // 401 BEFORE the child lookup: an unauthenticated caller learns nothing about ids.
    return { ok: false, status: 401, body: { error: "kid_auth_required" } };
  }
  const child = repo.getChild(childId);
  if (!child) return { ok: false, status: 404, body: { error: "child_not_found" } };
  if (bearerFam) {
    if (bearerFam.id !== child.family_id) return { ok: false, status: 404, body: { error: "child_not_found" } };
    // THE SWITCH GATE (#123). A device bearer proves which HOUSEHOLD is calling, and that
    // was the whole check — so on the shared family tablet every sibling was every other
    // sibling, and this is the door their Send button and Treasure Box balance sit behind.
    // A kid with no secret picture passes, which is exactly the behaviour this replaces.
    //
    // The PARENT bearer is deliberately not gated: a parent legitimately acts for every kid
    // in the house, and it is the parent who resets a forgotten secret.
    if (device && !deviceMayActAs(device, childId)) {
      return { ok: false, status: 403, body: { error: "switch_locked" } };
    }
    return { ok: true, child, fam: bearerFam, via: viaParent ? "parent" : "device" };
  }
  const fam = repo.getFamily(child.family_id);
  if (!fam) return { ok: false, status: 404, body: { error: "child_not_found" } };
  return { ok: true, child, fam, via: "open" };
}

// pin_hash and rate-limit state never leave the server.
function publicFamily(f: repo.Family) {
  const { pin_hash: _p, pin_attempts: _a, pin_locked_until: _l, ...pub } = f;
  return { ...pub, hasPin: !!f.pin_hash };
}

families.get("/family", async (c) => {
  const fam = await requestFamily(c);
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  return c.json({ family: publicFamily(fam) });
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Dashboard payload: family + each child with their chores grouped by status. */
families.get("/dashboard", async (c) => {
  const fam = await requestFamily(c);
  if (!fam) return c.json(PAIRING_REQUIRED, 401);
  const weekLuna = repo.weeklyEarnings(fam.id, Date.now() - WEEK_MS); // { childId: luna } for the leaderboard
  const children = repo.listChildren(fam.id).map((child) => ({
    ...child,
    weekLuna: weekLuna[child.id] ?? 0, // NIM earned in the last 7 days (weekly leaderboard)
    earnings: repo.earningsByKind(child.id), // { choreLuna, learningLuna } — claimed payouts
    chores: repo.listChores(fam.id, child.id).map((ch) => {
      if (ch.status !== "approved" && ch.status !== "claimed") return ch;
      const cl = repo.latestCashlinkForChore(ch.id); // attach on-chain receipt (no secret url)
      return cl ? { ...ch, receipt: { address: cl.cashlink_address, txHash: cl.funding_tx_hash, status: cl.status } } : ch;
    }),
  }));
  return c.json({ family: publicFamily(fam), children });
});

export { ensureFamily };
