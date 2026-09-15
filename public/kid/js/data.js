// nimiq.kids kid app — shared data refreshers (no DOM). V3: the chart feed is the
// home-screen truth (ONE call: rows + cells + placements + today's tasks + the
// sticker inventory); the wallet payload backs the balance chip + money screen.

import { api } from "./api.js";
import { state } from "./util.js";
import { saveSnapshot, readSnapshot, snapshotAt } from "./snapshot.js";
import { applyQueuedTaps } from "./outbox.js";

/**
 * ONE READ, THREE OUTCOMES, and keeping them apart is the whole of layer 2.
 *
 *   the server answered        -> take it, write the snapshot, we are online
 *   the server said `error`    -> it is reachable and refusing; that is NOT offline, and the
 *                                 caller's existing rule for a refusal still applies
 *   the fetch THREW            -> no network. Fall back to what this device wrote down, and
 *                                 remember WHEN it was written so a screen can say so
 *
 * Every refresher below used `.catch(() => null)`, which folded the last two together. That is
 * what made an unreachable chain render as an empty wallet, and it is what would make an
 * unreachable Mini render as an empty board.
 */
async function pull(name, call) {
  try {
    const res = await call();
    state.offline = false;
    if (!res || res.error) return { data: null, refused: true };
    state.syncedAt[name] = saveSnapshot(name, res);
    return { data: res, refused: false };
  } catch {
    state.offline = true;
    const snap = readSnapshot(name);
    if (snap) state.syncedAt[name] = snapshotAt(name);
    return { data: snap, refused: false, fromSnapshot: !!snap };
  }
}

/** A device-wide snapshot name (roster, family, catalog); per-child ones carry the id. */
export const snapName = (kind, childId) => (childId ? `${kind}:${childId}` : kind);

/**
 * What a coin is worth. Snapshotted like everything else, and for a sharper reason than the
 * rest: with no rate at all every fiat figure on the tablet is blank, so a kid sees their real
 * NIM balance with no dollars beside it. A price from this morning is not today's price, but
 * it is within a rounding error of one and it is the number the same kid saw at breakfast.
 */
export async function refreshRates() {
  const { data } = await pull("rates", () => api.rates());
  if (typeof data?.nimUsd === "number") state.rates = data;
}

/**
 * GET /kids/:id/wallet → state.wallet (provisions the account on first call).
 *
 * A failed read sets state.walletError and leaves the last good wallet in place.
 * It must never be spelled the same as an empty wallet: when the chain node is
 * unreachable this endpoint 500s, and silently keeping state.wallet null made the
 * money screen render its zero-filled fallback — a kid holding 109,834 NIM was shown
 * "0 NIM" and "No money moves yet. Go earn some NIM!" with Send still enabled.
 */
export async function refreshWallet() {
  const kid = state.child;
  if (!kid) return;
  const { data: w, refused } = await pull(snapName("wallet", kid.id), () => api.wallet(kid.id));
  if (!w) {
    // Refused by a reachable server, or offline with nothing written down. Either way the
    // last good wallet stays exactly where it is and the money screen says it cannot look
    // the number up. It NEVER falls through to zeros.
    state.walletError = true;
    return;
  }
  state.walletError = refused;
  state.wallet = w;
  state.addresses[kid.id] = w.address;
  // ⚠️ NOT FROM A SNAPSHOT. `skewMs` is how far this device's clock is from the server's, and
  // a `serverTime` read off disk is as old as the snapshot, feeding it in would move every
  // countdown on the tablet by however long it has been offline.
  if (!refused && w.serverTime && !state.offline) state.skewMs = w.serverTime - Date.now();
}

/** GET /kids/:id/staking → state.staking (Grow screen). */
export async function refreshStaking() {
  const kid = state.child;
  if (!kid) return;
  const { data: s, refused } = await pull(snapName("staking", kid.id), () => api.staking(kid.id));
  if (!s) return;
  state.staking = s;
  if (!refused && s.serverTime && !state.offline) state.skewMs = s.serverTime - Date.now();
}

/** GET /kids/:id/chart → state.chart (the V3 home: week grid + today + stickers). */
export async function refreshChart() {
  const kid = state.child;
  if (!kid) return;
  const { data: chart, refused } = await pull(snapName("chart", kid.id), () => api.chart(kid.id));
  if (!chart) return;
  // A snapshot replaces the board wholesale, exactly as a fetch does, so an optimistic tap
  // written into state.chart by the outbox survives only because the outbox re-applies it
  // below. Order matters: the board is the server's, then this device's unsent taps on top.
  state.chart = chart;
  if (!refused && chart.serverTime && !state.offline) state.skewMs = chart.serverTime - Date.now();
  // K3: the wrapper is the lock-state authority the page can reach (see games.js).
  state.kioskLock = state.kiosk?.getNativeState?.() ?? null;
  // LAST, and here rather than at any call site: this is the ONE place state.chart is
  // replaced, so it is the one place a tap the kid made offline can be put back on top of it.
  applyQueuedTaps();
}

/**
 * The sets a kid could collect, and which ones they have already asked for.
 *
 * Two reads rather than one field on the chart: the theme CATALOGUE is the same for every
 * household and worth caching once, while the asks are this kid's. Both fail soft -- a board
 * that cannot reach them simply shows no sets, which is what it did before they existed.
 */
export async function refreshGoalSets() {
  const kid = state.child;
  if (!kid) return;
  if (!state.goalThemes) {
    const r = await api.goalThemes().catch(() => null);
    if (r && !r.error) state.goalThemes = r.themes ?? [];
  }
  const q = await api.goalRequests(kid.id).catch(() => null);
  if (q && !q.error) state.goalRequests = q.requests ?? [];
}

/** GET /children/:id/prefs → state.prefs, state.timerStyles (owned timer rigs) and
 *  state.backgrounds (wallpapers a finished sticker theme handed over). */
export async function refreshPrefs() {
  const kid = state.child;
  if (!kid) return;
  const { data: res } = await pull(snapName("prefs", kid.id), () => api.prefs(kid.id));
  if (!res) return;
  state.prefs = res.prefs ?? state.prefs;
  state.timerStyles = res.timerStyles ?? ["egg"];
  state.backgrounds = res.backgrounds ?? [];
}

/** GET /kids/:id/store → state.store (Treasure Box shelves + dock badge count). */
export async function refreshStore() {
  const kid = state.child;
  if (!kid) return;
  const { data: store } = await pull(snapName("store", kid.id), () => api.store(kid.id));
  if (!store) return;
  state.store = store;
}

/** What this kid has already bought (#121). Kept out of refreshStore so a failure here can
 *  never blank the shelves: the catalogue is what the Box is for, and a missing receipt list
 *  is a worse thing to have than no shelves only if it takes the shelves with it. */
export async function refreshPurchases() {
  const kid = state.child;
  if (!kid) return;
  const res = await api.purchases(kid.id).catch(() => null);
  if (!res || res.error) return;
  state.purchases = res.purchases ?? [];
}

// ---------- the boot reads, before any kid is chosen ----------
//
// These four used to be `try {} catch {}` blocks in main.js that simply left their defaults in
// place. Defaults are the right answer for a first-ever boot and the WRONG one for a tablet
// that has run this app a hundred times: `state.children = []` renders "Who are you?" above an
// empty list, which is the screen this whole change exists to stop a kid seeing in a car.

/** GET /health -> the instance's own flags. */
export async function refreshHealth() {
  const { data: h } = await pull("health", () => api.health());
  if (!h) return;
  state.sim = !!h.sim;
  state.demo = !!h.demo;
  // Never in SIM: those tx hashes are invented, so a receipt link would 404 on the explorer.
  state.explorerTx = h.sim ? "" : (h.explorerTx || "");
}

/** GET /api/family -> the household, whose labels the board uses ("Waiting for Mom"). */
export async function refreshFamily() {
  const { data } = await pull("family", () => api.family());
  if (data) state.family = data.family ?? state.family;
}

/** GET /api/catalog -> scenes and timer art. `bgFor()` resolves a kid's chosen background
 *  through it, so without this an offline board loses the wallpaper the kid picked and falls
 *  back to the meadow, which reads as the app having forgotten them. */
export async function refreshCatalog() {
  const { data } = await pull("catalog", () => api.catalog());
  if (data) state.catalog = data;
}

/**
 * The roster, and the THREE answers it can give.
 *
 * 200      the household as the server sees it; written down for next time
 * 401      this tablet holds no token this instance accepts -> the caller shows pairing
 * offline  whatever this device last wrote down, and `state.offline` set
 *
 * The status is what keeps those apart. `probe.status === 0` used to mean "no children",
 * which is indistinguishable from an empty household and is why a car ride showed a roster
 * with nobody on it.
 */
export async function refreshRoster() {
  let probe = null;
  try {
    probe = await api.bootChildren();
    state.offline = false;
  } catch {
    state.offline = true;
  }
  if (probe && probe.status === 200) {
    const children = probe.body.children ?? [];
    state.syncedAt.roster = saveSnapshot("roster", { children });
    return { status: 200, children };
  }
  if (probe) return { status: probe.status, children: [] };
  const snap = readSnapshot("roster");
  if (snap) state.syncedAt.roster = snapshotAt("roster");
  return { status: 0, children: snap?.children ?? [] };
}

/** Build the routine entry the egg flow / waiting screen consume, from fresh
 *  server state (routine identity comes from the chart row). */
export async function loadEntry(routineId) {
  const row = (state.chart?.rows ?? []).find((r) => r.kind === "routine" && r.id === routineId);
  const day = await api.today(routineId);
  if (day.serverTime) state.skewMs = day.serverTime - Date.now();
  return {
    routine: { id: routineId, title: row?.title ?? "", emoji: row?.emoji ?? "🌅" },
    run: day.run, taskRuns: day.taskRuns, tasks: day.tasks,
  };
}

/** Every kid gets a REAL address at boot (idempotent provisioning) so the avatar
 *  login and the send picker can show real identicons, not placeholders. */
export async function provisionAddresses() {
  // READ-ONLY SINCE #381. GET /kids/:id/wallet mints a server-custodied account on first call,
  // so asking it for every address-less kid just to paint the login roster handed out every
  // kid's character before they had ever touched the screen. A kid who has not chosen yet
  // simply has no identicon here, and `identiconImg("")` draws the hexagon placeholder, which
  // is the truth: there is no account yet. They choose one the moment they tap their name.
  for (const c of state.children) if (c.address) state.addresses[c.id] = c.address;
}
