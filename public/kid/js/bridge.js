// KioskBridge shim — thin glue between the kid PWA and the (future) Android kiosk
// wrapper. The wrapper injects `window.KioskBridge` into its WebView; in a plain
// browser (Phase A) that global is undefined and every function here no-ops cleanly.
// Full native contract: docs/KIOSK-CONTRACT.md.

/** @typedef {{ state: string, reason?: string, until?: number, remainingSec?: number, allowedApps?: string[] }} ServerLockState */
/** @typedef {{ mode: "locked"|"unlocked", reason: string|null, until: number|null, remainingSec: number|null, allowedApps: string[] }} NativeLockState */

let config = { getStateUrl: "/api/device/state" };

/** The injected native bridge, or undefined in a plain browser. */
function bridge() {
  return typeof window !== "undefined" ? window.KioskBridge : undefined;
}

/**
 * Configure the shim. Call once at kid-app boot.
 * @param {{ getStateUrl?: string }} [opts]
 * @returns {{ native: boolean, getStateUrl: string }} whether a native wrapper is present
 */
export function initKioskBridge(opts = {}) {
  if (opts.getStateUrl) config.getStateUrl = opts.getStateUrl;
  return { native: bridge() !== undefined, getStateUrl: config.getStateUrl };
}

/**
 * Feed a fresh server lock state (from GET /device/state or an SSE `state` event)
 * to the native side. LockTask rule: locked unless state === "UNLOCKED".
 * @param {ServerLockState} state
 * @returns {NativeLockState} the mapped state (also returned browser-only, for the UI)
 */
export function applyKioskState(state) {
  /** @type {NativeLockState} */
  const mapped = {
    mode: state && state.state === "UNLOCKED" ? "unlocked" : "locked",
    // WHICH lock, so the lock screen can say something true. "Locked" is a fact; "back at
    // 7:00" is a fact a seven-year-old can do something with. The three locks are three
    // different sentences and the page cannot tell them apart from `mode` alone.
    reason: (state && typeof state.reason === "string") ? state.reason : null,
    until: (state && typeof state.until === "number") ? state.until : null,
    remainingSec: (state && typeof state.remainingSec === "number") ? state.remainingSec : null,
    allowedApps: (state && Array.isArray(state.allowedApps)) ? state.allowedApps : [],
  };
  const b = bridge();
  if (b && typeof b.setLockState === "function") {
    try { b.setLockState(JSON.stringify(mapped)); } catch { /* native must never break the PWA */ }
  }
  return mapped;
}

/**
 * The wrapper's last known lock state (its SyncService is the authoritative
 * follower of the server). This is how the kid PWA learns it is UNLOCKED —
 * `/api/device/state` is device-token-authed, so the page can't ask the server
 * directly; the native side already knows.
 * @returns {NativeLockState | null} null in a plain browser (Phase A unchanged)
 */
export function getNativeState() {
  const b = bridge();
  if (!b || typeof b.getState !== "function") return null;
  try {
    const s = JSON.parse(b.getState());
    if (!s || (s.mode !== "locked" && s.mode !== "unlocked")) return null;
    return {
      mode: s.mode,
      reason: typeof s.reason === "string" ? s.reason : null,
      until: typeof s.until === "number" ? s.until : null,
      remainingSec: typeof s.remainingSec === "number" ? s.remainingSec : null,
      allowedApps: Array.isArray(s.allowedApps) ? s.allowedApps : [],
    };
  } catch { return null; }
}

/**
 * Installed apps with labels + 96px base64 icon data-URIs (icons ride the JS
 * bridge only — the server report is pkg+label). Powers the K3 games grid.
 * @returns {{ pkg: string, label: string, icon?: string|null }[] | null} null without a native bridge
 */
export function listInstalledApps() {
  const b = bridge();
  if (!b || typeof b.getInstalledApps !== "function") return null;
  try { return JSON.parse(b.getInstalledApps()); } catch { return null; }
}

/**
 * Launch an allowlisted app by Android package name (kid tapped its icon).
 * @param {string} pkg
 * @returns {boolean} false without a native bridge or when the launch is refused
 */
export function launchApp(pkg) {
  const b = bridge();
  if (!b || typeof b.launchApp !== "function") return false;
  try { return b.launchApp(pkg) === true; } catch { return false; }
}
