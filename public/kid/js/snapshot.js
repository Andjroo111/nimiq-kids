// THE BOARD, WRITTEN DOWN. Layer 2 of three (sw.js caches the shell, outbox.js queues taps).
//
// The service worker never caches `/api` and it never will: a chore's state, a balance and a
// parent's approval are facts about a moment, and serving yesterday's from an HTTP cache with
// no way to tell the difference is how a kid gets told the wrong thing about their own money.
// So the DATA is kept here instead, deliberately and per child, with the time it was read.
//
// That distinction is the whole design. A cached response pretends to be fresh. A snapshot
// knows it is a snapshot, carries `syncedAt`, and every screen that renders one says so.
//
// ⚠️ THE MONEY RULE. `refreshWallet` in data.js must never resolve to a zero-filled wallet
// because a fetch failed. A kid holding 109,834 NIM was once shown "0 NIM" and "No money
// moves yet" (see the comment on refreshWallet); the fix then was to keep the last good
// wallet in memory, which died with the tab. This is that same value, on disk.
//
// ⚠️ WHY localStorage AND NOT IndexedDB, when local-photos.js argues the opposite. That file
// stores photographs: megabytes of Blob, where localStorage's ~5MB string quota and its
// throw-at-quota behaviour are exactly wrong. These are small JSON documents read on the
// boot path, where a synchronous read means the roster is on screen in the first paint
// instead of one frame later. Different sizes, different answer. Every access is still
// wrapped, because a WebView in private mode throws on the property itself.

const PREFIX = "kid.snap.";
const VERSION = 1;
// The feed is the only unbounded field in any of these payloads: a kid two years in has a
// row per payout. Sixty is more than the money screen shows before a kid stops scrolling,
// and it keeps the whole snapshot comfortably inside a localStorage value.
const FEED_LIMIT = 60;

const key = (name) => `${PREFIX}${name}`;

function read(name) {
  try {
    const raw = localStorage.getItem(key(name));
    if (!raw) return null;
    const box = JSON.parse(raw);
    return box?.v === VERSION && box.at ? box : null;
  } catch { return null; }
}

/** Drop every snapshot but one. The escape hatch for a full quota: a board we cannot write
 *  is worse than a sibling's board we lose, and the sibling's is one online boot from back. */
function evictOthers(keep) {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX) && k !== key(keep)) localStorage.removeItem(k);
    }
  } catch { /* nothing else to try */ }
}

/** Trim what has no bound. Only the wallet feed does. */
function trim(name, payload) {
  if (!name.startsWith("wallet:") || !Array.isArray(payload?.events)) return payload;
  return { ...payload, events: payload.events.slice(0, FEED_LIMIT) };
}

/**
 * Write one payload with the moment it was true.
 *
 * Returns the timestamp so the caller can put it straight into `state.syncedAt` without a
 * second read, which also means a device whose storage is refusing writes still shows an
 * honest "just now" for the copy it is holding in memory.
 */
export function saveSnapshot(name, payload) {
  const at = Date.now();
  if (payload === null || payload === undefined) return at;
  const box = JSON.stringify({ v: VERSION, at, p: trim(name, payload) });
  try {
    localStorage.setItem(key(name), box);
  } catch {
    evictOthers(name);
    try { localStorage.setItem(key(name), box); } catch { /* give up quietly */ }
  }
  return at;
}

/** The payload as last written, or null. Never throws. */
export function readSnapshot(name) {
  return read(name)?.p ?? null;
}

/** When that payload was read from the server, or null if there is no snapshot. */
export function snapshotAt(name) {
  return read(name)?.at ?? null;
}

/** Everything this device is holding for one child, cleared. Used when a kid is removed
 *  from the household, so a sibling's tablet does not keep their board around. */
export function forgetChild(childId) {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX) && k.endsWith(`:${childId}`)) localStorage.removeItem(k);
    }
  } catch { /* nothing to do */ }
}

/**
 * Is this snapshot from a different day than the device thinks it is?
 *
 * The one limit we accept rather than solve (Andjroo, 2026-09-11). Routine task runs are
 * created server-side, lazily, by the chart read itself (`src/routes/stickers.ts` calls
 * `todayRun`), so a tablet that never reaches the server across midnight has no runs for the
 * new day and nothing to tick. Chores, lessons, practices and goals are not per-day and are
 * unaffected.
 *
 * Pre-fetching a few days would mean creating runs ahead of time, which changes WHEN a run
 * exists for the lock machine, `reconcileRun` and the parent's approval queue: a bigger change
 * than all three offline layers together, for a case a car journey does not produce. So the
 * board says which day it is showing instead of quietly pretending.
 *
 * `chartToday` is the server's own local day for the household (its timezone, not the
 * device's), compared against the device's. They agree on any day the tablet has synced.
 */
export function isStaleDay(chartToday, now = new Date()) {
  if (!chartToday) return false;
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return chartToday !== local;
}
