// Kiosk device + lock-override routes (Phase B). The Android wrapper (device owner +
// LockTask) pairs with POST /devices/register, then follows GET /device/state — live via
// the SSE stream, 15s polling as fallback. Contract: docs/KIOSK-CONTRACT.md.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as repo from "../repo";
import * as routines from "../repo-routines";
import * as approvalsRepo from "../repo-approvals";
import * as lockRepo from "../repo-lock";
import * as stickersRepo from "../repo-stickers";
import { computeLockState, type LockResult, type RunInput } from "../lock-machine";
import { publishLockChange, subscribe } from "../lock-events";
import { deviceFrom, newToken, parentFamilyFrom, parentTokenFrom, requireDevice, requireParent, sha256Hex } from "../auth";
import { ensureFamily } from "./families";
import { clientIp } from "../client-ip";
import { pairAttemptAllowed, pairGuessBudgetSpent, recordPairGuessMiss } from "../pair-brake";
import { refuseBoardWrite, refuseHouseholdWrite } from "./members";

export const lockRoutes = new Hono();

const HEARTBEAT_MS = 25_000;

function parseJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/**
 * ONE RULING PER TABLET, and everything that needs it reads this.
 *
 * The tablet asks "what do I do", a parent asks "what is it doing" (#305). Those are two
 * questions about one fact, and the moment they are computed twice they can disagree — a
 * phone saying "Free until 8:30" over a screen that is locked is worse than a phone that
 * says nothing. So the computation happens here, once, and the two shapers below only
 * choose what to publish.
 *
 * It hands back the override ROW it ruled on rather than just the machine's verdict,
 * because "who decided this" is the parent's question and not the tablet's — and reading
 * it a second time in the parent shaper would be a second read at a second instant, which
 * is how `reason: override_unlock` comes to arrive beside a source of null.
 */
interface DeviceStateCore {
  device: lockRepo.Device;
  childId: string | null;
  allowedApps: string[];
  result: LockResult;
  override: lockRepo.LockOverride | null;
  approvalId?: string;
  nowMs: number;
  /** null = this kid is unmetered. Carried so both shapers can publish the meter without
   *  a second read at a second instant — the same rule the override row above follows. */
  budget?: { budgetSec: number; usedSec: number } | null;
  usage?: lockRepo.ScreenUsage | null;
  day?: string;
}

async function deviceStateCore(deviceId: string): Promise<DeviceStateCore | null> {
  const device = lockRepo.getDevice(deviceId);
  if (!device) return null;
  // The device row names its family — never the instance's first household.
  const fam = repo.getFamily(device.family_id);
  if (!fam) return null;
  const nowMs = Date.now();
  const parentAllowed = parseJson<string[]>(device.allowed_apps, []);
  // Unbound (shared) device: state follows the first kid until avatar-login lands.
  const childId = device.child_id ?? repo.listChildren(fam.id)[0]?.id ?? null;
  if (!childId) {
    const allowedApps = parentAllowed;
    return {
      device, childId: null, allowedApps, nowMs, override: null,
      result: { state: "UNLOCKED", reason: "no_children" },
    };
  }

  // #376. What the tablet may launch is the PARENT'S list UNION the apps this kid BOUGHT.
  //
  // Two owners, one list, and neither may erase the other: `allowed_apps` is replaced
  // wholesale every time a grown-up saves the picker, so a purchase written into it would
  // vanish the next time anyone ticked a box — a kid's real NIM, gone silently. Ownership
  // lives in `kid_unlocks` and is joined HERE, at the one read that answers "what may this
  // tablet run", so there is exactly one place the two can disagree and it is this line.
  //
  // De-duplicated, because a parent allowlisting something a kid already bought is a normal
  // thing to happen and LockTask should not be handed the same package twice.
  const allowedApps = [...new Set([...parentAllowed, ...stickersRepo.listUnlocks(childId, "app")])];

  const windows = lockRepo.windowsForChild(childId);
  const day = routines.localDay(fam.tz, nowMs);
  const runsToday: RunInput[] = [];
  const pendingRunIds: string[] = [];
  const approvalByRoutine = new Map<string, string>();
  for (const routineId of new Set(windows.map((w) => w.routine_id))) {
    const run = routines.findRun(routineId, day);
    if (!run) continue;
    runsToday.push({ routineId, status: run.status, runId: run.id });
    const pending = approvalsRepo.pendingApprovalFor("routine_run", run.id);
    if (pending) { pendingRunIds.push(run.id); approvalByRoutine.set(routineId, pending.id); }
  }
  const o = lockRepo.activeOverride(fam.id, childId, nowMs);

  // The meter. `daily_screen_min` 0 = this kid is unmetered, and the machine must be handed
  // a null rather than a zero budget: `{budgetSec: 0}` and "no meter" are the same answer
  // here only because the machine says so, and passing null keeps that from being an
  // accident that a later edit to either side could quietly reverse.
  const child = repo.getChild(childId);
  const usage = lockRepo.usageFor(childId, day);
  const budget = child && child.daily_screen_min > 0
    ? {
        budgetSec: child.daily_screen_min * 60 + (usage?.earned_sec ?? 0),
        usedSec: usage?.used_sec ?? 0,
      }
    : null;

  // Sittings, same opt-in shape: a rule with either half at 0 is handed over as null.
  const sitting = child && child.play_min > 0 && child.rest_min > 0
    ? {
        playSec: child.play_min * 60, restSec: child.rest_min * 60,
        usedSec: usage?.sitting_sec ?? 0, lastBurnAtMs: usage?.last_burn_at ?? 0,
      }
    : null;

  const result = computeLockState({
    nowMs, tz: fam.tz,
    windows: windows.map((w) => ({ routineId: w.routine_id, startHhmm: w.start_hhmm, endHhmm: w.end_hhmm, days: w.days })),
    allowWindows: lockRepo.allowWindowsForFamily(fam.id)
      .map((w) => ({ startHhmm: w.start_hhmm, endHhmm: w.end_hhmm, days: w.days })),
    budget, sitting,
    runsToday, pendingApprovalRunIds: pendingRunIds,
    override: o ? { mode: o.mode, untilMs: o.until_ms } : null,
  });
  const approvalId = result.routineId !== undefined ? approvalByRoutine.get(result.routineId) : undefined;
  return { device, childId, allowedApps, result, override: o, approvalId, nowMs, budget, usage, day };
}

/** What the TABLET follows (docs/KIOSK-CONTRACT.md). Byte-for-byte the payload it has
 *  always been served — the parent's extra fields are not added here, because a wrapper
 *  in the field parses this and a field it does not know about is drift (#307). */
async function deviceStatePayload(deviceId: string): Promise<Record<string, unknown> | null> {
  const core = await deviceStateCore(deviceId);
  if (!core) return null;
  return {
    ...core.result, childId: core.childId,
    ...(core.approvalId !== undefined ? { approvalId: core.approvalId } : {}),
    allowedApps: core.allowedApps, serverTime: core.nowMs,
    // The meter, published so the wrapper can keep counting while OFFLINE. Without these
    // two a tablet that loses the network holds its last state forever, which for an
    // UNLOCKED kid means the hour never ends. `budgetSec` 0 = unmetered, matching the
    // machine's own convention, so an old wrapper reading zeroes behaves exactly as before.
    budgetSec: core.budget?.budgetSec ?? 0,
    usedSec: core.budget?.usedSec ?? 0,
  };
}

/**
 * The same ruling, told to the household that has to act on it (#305).
 *
 * Three things the tablet does not need and a parent cannot do without:
 *  · the routine NAMED — "Locked" is a fact, "Locked until Morning is done" is something
 *    a parent can answer. `title_key` rides along so a seeded name still translates.
 *  · the override's AUTHOR — a grown-up's lock and a kid's bought minutes both read as
 *    `override_*`, and #301 settled that those are different sentences.
 *  · when the tablet last CHECKED IN. This screen claims to say what the tablet is doing;
 *    a tablet that has not spoken to us since Tuesday is one we cannot answer for, and a
 *    confident "Locked" over a tablet sitting switched off in a drawer is exactly the kind
 *    of lie this endpoint exists to end.
 *
 * `allowedApps` is deliberately NOT here: it is settings, it already rides on GET /devices,
 * and a second copy is a second thing to keep true.
 */
function parentScreen(core: DeviceStateCore) {
  const routine = core.result.routineId ? routines.getRoutine(core.result.routineId) : null;
  return {
    deviceId: core.device.id,
    deviceLabel: core.device.label,
    lastSeenAt: core.device.last_seen_at,
    childId: core.childId,
    state: core.result.state,
    reason: core.result.reason,
    routineId: core.result.routineId ?? null,
    routineTitle: routine?.title ?? null,
    routineTitleKey: routine?.title_key ?? null,
    approvalId: core.approvalId ?? null,
    until: core.result.until ?? null,
    // null on every non-override reason, so a client never has to ask twice what it means.
    overrideSource: core.result.reason.startsWith("override_") ? core.override?.source ?? null : null,
    // The meter as a parent reads it: how long today's allowance is, how much is gone, and
    // how much of it was bought. All null for an unmetered kid — a screen that draws "0 of
    // 0 minutes" over a tablet with no meter is describing a rule that does not exist.
    budgetSec: core.budget?.budgetSec ?? null,
    usedSec: core.budget?.usedSec ?? null,
    earnedSec: core.usage?.earned_sec ?? null,
    // The charge (§11), as the tablet last said. Null until it ever has; a parent screen that
    // drew "0%" over a tablet that never reported would be describing a dead battery.
    batteryPct: core.device.battery_pct ?? null,
    batteryCharging: core.device.battery_charging === null ? null : core.device.battery_charging === 1,
    batteryAt: core.device.battery_at ?? null,
  };
}

// ---- pairing ----

/**
 * One-time pairing → device bearer token, shown ONCE. Two paths:
 *  - `pairCode`: a 6-digit code the parent just minted in their app (Settings →
 *    Pair a device). Family-scoped: the device joins THAT household — this is how a
 *    NEW family pairs a tablet on a multi-family instance. Single use, 5 min TTL.
 *  - `setupCode`: the legacy env KIOSK_SETUP_CODE flow, pinned to the instance's
 *    first household (the pre-multi-family live install). Disabled when the env var
 *    is unset — which is how a public instance runs.
 *
 * The pairCode branch redeems the SAME 6-digit codes as `POST /api/pair` and mints a
 * device bearer, so it guesses at exactly the same secret. It shares that route's
 * brakes (../pair-brake) rather than offering a second, unlimited allowance.
 */
lockRoutes.post("/devices/register", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const label = String(body.label ?? "").trim();
  if (!label) return c.json({ error: "label_required" }, 400);

  let fam: repo.Family | null = null;
  // #364: a pairCode minted from a kid's page carries that kid. The request body still
  // wins when it names one, so the adb seam and a deliberately shared tablet are unchanged.
  let codeChildId: string | null = null;
  const pairCode = String(body.pairCode ?? "");
  if (pairCode) {
    if (!pairAttemptAllowed(clientIp(c)) || pairGuessBudgetSpent()) {
      return c.json({ error: "too_many_attempts" }, 429);
    }
    if (!/^\d{6}$/.test(pairCode)) return c.json({ error: "bad_pair_code" }, 403);
    const row = lockRepo.redeemPairCode(await sha256Hex(pairCode));
    fam = row ? repo.getFamily(row.family_id) : null;
    if (!fam) { recordPairGuessMiss(); return c.json({ error: "bad_pair_code" }, 403); }
    codeChildId = row?.child_id ?? null;
  } else {
    const code = process.env.KIOSK_SETUP_CODE;
    if (!code) return c.json({ error: "registration_disabled" }, 403);
    const setupCode = String(body.setupCode ?? "");
    if (!setupCode) return c.json({ error: "setup_code_required" }, 400);
    if (setupCode !== code) return c.json({ error: "bad_setup_code" }, 403);
    fam = await ensureFamily(); // env setup code is a legacy single-household flow
  }

  const childId = body.childId ? String(body.childId) : codeChildId;
  // Re-validated even when it came off the code: a child can be retired between minting a
  // 5-minute code and redeeming it, and a device bound to a stranger's id is worse than one
  // that refuses to pair.
  if (childId && repo.getChild(childId)?.family_id !== fam.id) return c.json({ error: "child_not_found" }, 404);
  const token = newToken();
  const device = lockRepo.createDevice(fam.id, label, await sha256Hex(token), childId);
  return c.json({ deviceId: device.id, token }, 201); // the token is NEVER retrievable again
});

// ---- device state ----

lockRoutes.get("/device/state", requireDevice, async (c) => {
  const device = deviceFrom(c)!;
  return c.json(await deviceStatePayload(device.id));
});

/** Live state: an SSE `state` event immediately, again on every relevant mutation
 *  (via lock-events), plus a `ping` heartbeat every 25s so proxies keep the pipe open. */
lockRoutes.get("/device/state/stream", requireDevice, (c) => {
  const device = deviceFrom(c)!;
  return streamSSE(c, async (stream) => {
    const send = async () => {
      const payload = await deviceStatePayload(device.id);
      await stream.writeSSE({ event: "state", data: JSON.stringify(payload) });
    };
    const unsub = subscribe(() => { send().catch(() => {}); });
    const hb = setInterval(() => { stream.writeSSE({ event: "ping", data: String(Date.now()) }).catch(() => {}); }, HEARTBEAT_MS);
    try {
      await send();
      await new Promise<void>((resolve) => stream.onAbort(resolve)); // hold until the client drops
    } finally {
      unsub();
      clearInterval(hb);
    }
  });
});

// ---- the screen-time meter ----

/**
 * The tablet reports the seconds it burned since its last successful report (#377).
 *
 * The DEVICE is the only thing that can measure this. The server knows a tablet is
 * unlocked; it cannot know whether a kid is playing Minecraft, doing their chores in the
 * kid app, or has walked away with the screen off -- and those are three different answers,
 * only one of which should cost them anything. So the wrapper meters and reports, and this
 * route's job is to be unable to be talked into anything by a client it does not trust.
 *
 * Three guards, and each one closes a real hole:
 *  1. `deltaSec` is a DELTA and is clamped to one sync interval's worth. A device that
 *     reported an absolute total could rewrite a whole day with one request; a delta of
 *     86_400 could do it in one tick. The clamp means the worst a broken or hostile tablet
 *     can do per report is burn the time it would have burned anyway.
 *  2. The day is computed HERE from the family's timezone, never taken from the body. A
 *     client-chosen `localDay` is a client-chosen budget: send yesterday's date and today's
 *     meter stays at zero forever.
 *  3. It is refused outright while an override is in charge. That is the other half of the
 *     parent-unlock promise -- "leave it open and it doesn't count" is a lie the moment
 *     this route accepts a tick during one. The tablet is told not to send them; this is
 *     what makes it true even if it does.
 */
const MAX_REPORT_SEC = 300; // one sync interval, generously

lockRoutes.post("/device/usage", requireDevice, async (c) => {
  const device = deviceFrom(c)!;
  const fam = repo.getFamily(device.family_id);
  if (!fam) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const raw = Number((body as { deltaSec?: unknown }).deltaSec);
  if (!Number.isFinite(raw) || raw < 0) return c.json({ error: "delta_required" }, 400);

  const childId = device.child_id ?? repo.listChildren(fam.id)[0]?.id ?? null;
  if (!childId) return c.json({ error: "no_children" }, 409);

  const nowMs = Date.now();
  // Guard 3. `activeOverride` is the same read the state machine makes, so the two cannot
  // disagree about whether an override was live at this instant.
  if (lockRepo.activeOverride(fam.id, childId, nowMs)) {
    return c.json({ ok: true, skipped: "override_active" });
  }

  const day = routines.localDay(fam.tz, nowMs);
  // The sitting rides on the same tick: the rest is what decides whether this delta extends
  // the sitting or starts a fresh one, and only the child row knows how long a rest is.
  const child = repo.getChild(childId);
  const rest = child && child.play_min > 0 && child.rest_min > 0 ? { restSec: child.rest_min * 60 } : null;
  const usage = lockRepo.addUsageSec(childId, day, Math.min(raw, MAX_REPORT_SEC), nowMs, rest);
  publishLockChange(); // a spent budget or a full sitting is a lock, and the parent screen should see it land
  return c.json({ ok: true, localDay: day, usedSec: usage.used_sec, earnedSec: usage.earned_sec });
});

// ---- the curfew ----

lockRoutes.get("/family/allow-windows", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  return c.json({ windows: lockRepo.allowWindowsForFamily(fam.id) });
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Replace the whole curfew in one write. Whole-schedule rather than row-at-a-time because
 *  a curfew read half-applied is a tablet with the wrong hours, and the parent screen edits
 *  every day of the week on one page anyway. An EMPTY list is legal and means "no curfew". */
lockRoutes.put("/family/allow-windows", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const notAllowed = await refuseHouseholdWrite(c, fam);
  if (notAllowed) return notAllowed;

  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.windows)) return c.json({ error: "windows_required" }, 400);
  const windows = [];
  for (const w of (body.windows as unknown[]).slice(0, 21)) {
    const startHhmm = String((w as { startHhmm?: unknown })?.startHhmm ?? "");
    const endHhmm = String((w as { endHhmm?: unknown })?.endHhmm ?? "");
    const days = String((w as { days?: unknown })?.days ?? "");
    if (!HHMM.test(startHhmm) || !HHMM.test(endHhmm)) return c.json({ error: "bad_time" }, 400);
    if (!/^[01]{7}$/.test(days)) return c.json({ error: "bad_days" }, 400);
    // start === end would be a window of zero length that `windowActive` reads as
    // MIDNIGHT-CROSSING and therefore always-on -- the exact opposite of what a parent
    // typing the same time twice means. Refuse it rather than guess.
    if (startHhmm === endHhmm) return c.json({ error: "empty_window" }, 400);
    windows.push({ startHhmm, endHhmm, days });
  }
  const saved = lockRepo.replaceAllowWindows(fam.id, windows);
  publishLockChange();
  return c.json({ windows: saved });
});

/** Turn the meter on or off for one kid, and set what they may buy on top of it. */
lockRoutes.patch("/children/:id/screen-budget", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const child = repo.getChild(c.req.param("id") ?? "");
  if (!child || child.family_id !== fam.id) return c.json({ error: "not_found" }, 404);
  const notAllowed = await refuseHouseholdWrite(c, fam);
  if (notAllowed) return notAllowed;

  const body = await c.req.json().catch(() => ({}));
  const dailyMin = Number((body as { dailyMin?: unknown }).dailyMin);
  const maxEarnedMin = Number((body as { maxEarnedMin?: unknown }).maxEarnedMin ?? 0);
  if (!Number.isFinite(dailyMin) || dailyMin < 0) return c.json({ error: "daily_required" }, 400);
  repo.setScreenBudget(child.id, dailyMin, Number.isFinite(maxEarnedMin) ? maxEarnedMin : 0);
  // Sittings ride on the same PATCH, and are optional so a caller written before they
  // existed keeps its exact old effect: absent means "leave the rule as it is".
  const { playMin, restMin } = body as { playMin?: unknown; restMin?: unknown };
  if (playMin !== undefined || restMin !== undefined) {
    const play = Number(playMin ?? child.play_min);
    const rest = Number(restMin ?? child.rest_min);
    if (!Number.isFinite(play) || play < 0 || !Number.isFinite(rest) || rest < 0) return c.json({ error: "bad_sitting" }, 400);
    repo.setScreenBreaks(child.id, play, rest);
  }
  publishLockChange();
  const after = repo.getChild(child.id)!;
  return c.json({
    dailyMin: after.daily_screen_min, maxEarnedMin: after.max_earned_min,
    playMin: after.play_min, restMin: after.rest_min,
  });
});

// ---- battery (§11) ----

/** The tablet reports its charge. Clamped to 0..100 and never trusted to be a number; there
 *  is nothing here a hostile client gains, so no further brake. Not published as a lock
 *  change: the number moves slowly and the parent screen re-reads on its own. */
lockRoutes.post("/device/battery", requireDevice, async (c) => {
  const device = deviceFrom(c)!;
  const body = await c.req.json().catch(() => ({}));
  const pct = Number((body as { pct?: unknown }).pct);
  if (!Number.isFinite(pct)) return c.json({ error: "pct_required" }, 400);
  const charging = (body as { charging?: unknown }).charging === true;
  lockRepo.noteBattery(device.id, Math.max(0, Math.min(100, Math.round(pct))), charging);
  return c.json({ ok: true });
});

/** A day's curve for one tablet, for the parent. `days` caps at the 30 the log keeps. */
lockRoutes.get("/parent/devices/:id/battery", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const device = lockRepo.getDevice(c.req.param("id") ?? "");
  if (!device || device.family_id !== fam.id) return c.json({ error: "not_found" }, 404);
  const days = Math.max(1, Math.min(30, Math.round(Number(c.req.query("days") ?? 1) || 1)));
  return c.json({ points: lockRepo.batteryHistory(device.id, Date.now() - days * 86_400_000) });
});

// ---- installed apps / allowlist ----

/** The wrapper reports what's installed on the tablet (for the parent's allowlist picker). */
lockRoutes.post("/device/apps", requireDevice, async (c) => {
  const device = deviceFrom(c)!;
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.apps)) return c.json({ error: "apps_required" }, 400);
  const apps = (body.apps as unknown[]).slice(0, 500).flatMap((a) => {
    const pkg = String((a as { pkg?: unknown })?.pkg ?? "").trim();
    if (!pkg) return [];
    return [{ pkg, label: String((a as { label?: unknown })?.label ?? pkg).slice(0, 100) }];
  });
  lockRepo.setInstalledApps(device.id, apps);
  return c.json({ ok: true, count: apps.length });
});

lockRoutes.patch("/devices/:id/allowed-apps", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const device = lockRepo.getDevice(c.req.param("id") ?? "");
  if (!device || device.family_id !== fam.id) return c.json({ error: "not_found" }, 404);
  const notAllowed = await refuseHouseholdWrite(c, fam);
  if (notAllowed) return notAllowed;

  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.packages)) return c.json({ error: "packages_required" }, 400);
  const packages = (body.packages as unknown[]).map((p) => String(p).trim()).filter(Boolean).slice(0, 500);
  lockRepo.setAllowedApps(device.id, packages);
  publishLockChange();
  return c.json({ device: publicDevice(lockRepo.getDevice(device.id)!) });
});

function publicDevice(d: lockRepo.Device) {
  return {
    id: d.id, label: d.label, childId: d.child_id, lastSeenAt: d.last_seen_at, createdAt: d.created_at,
    installedApps: parseJson<{ pkg: string; label: string }[]>(d.installed_apps, []),
    allowedApps: parseJson<string[]>(d.allowed_apps, []),
  };
}

/** Parent-page device picker (token hashes never leave the server). */
lockRoutes.get("/devices", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  return c.json({ devices: lockRepo.listDevices(fam.id).map(publicDevice) });
});

/**
 * What every tablet in this household is doing right now (#305).
 *
 * One row per PAIRED DEVICE, not per child: an unlocked screen is a fact about a tablet,
 * and a kid with no tablet has no screen state to report — the same rule #306 settled for
 * the Treasure Box, where screen time is hidden rather than greyed. A household that owns
 * no tablet gets an empty list and the parent app draws nothing at all.
 *
 * Read-only, so no role gate: a supporter who can approve the routine the tablet is waiting
 * on has to be able to see that it is waiting. Family-scoped by the bearer, like every other
 * parent read here.
 *
 * NOT an SSE stream, and that is a decision rather than an omission. `EventSource` cannot
 * carry an Authorization header, and this app's whole auth model is a bearer — the only way
 * to stream one to a browser is to put the token in the query string, where it lands in
 * access logs and Referer headers and outlives the request that carried it. The parent app
 * re-reads this beside the overview on its own 20s cycle instead, which also catches the
 * transitions a push never could: a lock window opening at 6:30 is a state change with no
 * mutation behind it, and `lock-events` has nothing to publish. The tablet solves the same
 * problem the same way (SSE plus a 15s poll); the poll is the half that is load-bearing.
 */
lockRoutes.get("/parent/screen-state", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const screens = [];
  for (const d of lockRepo.listDevices(fam.id)) {
    const core = await deviceStateCore(d.id);
    if (core) screens.push(parentScreen(core));
  }
  return c.json({ screens, serverTime: Date.now() });
});

// ---- revocation ----
//
// A bearer token used to be valid forever. There was no route that removed a device and
// none that removed a parent session, so a tablet that was lost, sold, handed down or
// simply had its token read out of `localStorage` kept working access to that kid's
// wallet, sends and Treasure Box for good — and the parent could see it in the list
// above and do nothing about it.
//
// Deleting the row IS the revocation: `requireDevice` and `requireParent` resolve a
// bearer by looking the row up, so the next call after a delete fails. Nothing caches a
// token, and the SSE stream re-reads the device row on every push.

/** Cut off one tablet. Family-scoped: another household's device id is a 404, not a 403,
 *  because whether it exists is not this caller's business. */
lockRoutes.delete("/devices/:id", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const device = lockRepo.getDevice(c.req.param("id") ?? "");
  if (!device || device.family_id !== fam.id) return c.json({ error: "not_found" }, 404);
  const notAllowed = await refuseHouseholdWrite(c, fam);
  if (notAllowed) return notAllowed;
  lockRepo.deleteDevice(device.id);
  publishLockChange(); // the tablet's own stream re-reads and finds nothing
  return c.json({ ok: true, revoked: publicDevice(device) });
});

/** The parent phones that are signed in. `current` marks the one asking, so the UI can
 *  say "this phone" and never offer to strand the parent holding it. */
lockRoutes.get("/parent/tokens", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const mine = parentTokenFrom(c)!;
  return c.json({
    tokens: lockRepo.listParentTokens(fam.id).map((t) => ({
      id: t.id, label: t.label, createdAt: t.created_at, lastUsedAt: t.last_used_at, current: t.id === mine.id,
    })),
  });
});

/**
 * Sign one parent phone out.
 *
 * The last remaining session cannot be revoked. Minting a parent token needs either a
 * brand new household or an existing signed-in session to mint the pairing code, so a
 * family that deleted its only token would be locked out of its own money with no way
 * back. This never blocks a real rescue: revoking a stolen phone is done FROM another
 * session, which means there were always at least two.
 */
lockRoutes.delete("/parent/tokens/:id", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const id = c.req.param("id") ?? "";
  const row = lockRepo.listParentTokens(fam.id).find((t) => t.id === id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const notAllowed = await refuseHouseholdWrite(c, fam);
  if (notAllowed) return notAllowed;

  if (lockRepo.countParentTokens(fam.id) <= 1) return c.json({ error: "last_session" }, 409);
  lockRepo.deleteParentToken(row.id);
  return c.json({ ok: true, wasCurrent: row.id === parentTokenFrom(c)!.id });
});

/** The panic button: every tablet and every other phone, cut off at once. The session
 *  making the request survives, so the parent is not locked out by their own rescue. */
lockRoutes.post("/parent/sign-out-everywhere", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const mine = parentTokenFrom(c)!;
  const notAllowed = await refuseHouseholdWrite(c, fam);
  if (notAllowed) return notAllowed;
  const devices = lockRepo.deleteDevicesForFamily(fam.id);
  const sessions = lockRepo.deleteOtherParentTokens(fam.id, mine.id);
  publishLockChange();
  return c.json({ ok: true, devices, sessions });
});

// ---- overrides ----

lockRoutes.post("/family/override", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  // Lifting screen time for a kid is parenting, so a co-parent may; a supporter may not.
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  const body = await c.req.json().catch(() => ({}));
  const mode = String(body.mode ?? "");
  if (mode !== "lock" && mode !== "unlock") return c.json({ error: "invalid_mode" }, 400);
  const childId = body.childId ? String(body.childId) : null;
  if (childId && repo.getChild(childId)?.family_id !== fam.id) return c.json({ error: "child_not_found" }, 404);
  let untilMs: number | null = null;
  if (body.untilMs !== undefined && body.untilMs !== null) {
    untilMs = Math.round(Number(body.untilMs));
    if (!Number.isFinite(untilMs) || untilMs <= Date.now()) return c.json({ error: "invalid_until" }, 400);
  }
  const override = lockRepo.setOverride(fam.id, mode, childId, untilMs);
  publishLockChange();
  return c.json({ override }, 201);
});

/**
 * Clear undoes what a GROWN-UP did, and nothing else (#304).
 *
 * A purchase row is minutes a kid spent real NIM on. Deleting one takes them back with no
 * refund and no way for the kid to learn what happened, which is the same rule #301 settled
 * for the buy side: never unwind a spend that has already told the kid it worked. It is not
 * a hole in what a parent can do either — `mode: "lock"` outranks a purchase outright, so a
 * grown-up who wants the screen off gets it in one call, and the untouched purchase is still
 * there when they change their mind.
 *
 * Gated exactly like the POST, and it was NOT: a supporter has never been allowed to write
 * an unlock, and could lift a grounding through here — which is the same power by a longer
 * route. Ending a grown-up's lock is a decision about the kid, so it is a board write.
 */
lockRoutes.delete("/family/override/:id", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const override = lockRepo.getOverride(c.req.param("id") ?? "");
  if (!override || override.family_id !== fam.id) return c.json({ error: "not_found" }, 404);
  const notAllowed = await refuseBoardWrite(c, fam);
  if (notAllowed) return notAllowed;
  if (override.source !== "parent") return c.json({ error: "purchased_minutes" }, 409);
  lockRepo.clearOverride(override.id);
  publishLockChange();
  return c.json({ ok: true });
});
