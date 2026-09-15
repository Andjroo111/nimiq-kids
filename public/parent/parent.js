// nimiq.kids — parent companion wallet, entry module. The view modules register
// themselves into core's `views` registry; this file wires chrome, boots i18n
// off the fleet shell (parent-shell.js, loaded first), and starts the refresh loop.
//
// Auth is the bearer magic link (#t=..., minted by src/scripts/parent-token.ts);
// the header wallet connect is for PAYMENTS (hot-wallet top-up), never auth.

import { state, captureFromHash, confirmPendingSwitch, token, refresh, render, paintChrome, go, closeSheet, $ } from "./core.js";
import { walletRequired } from "./onboard-gate.js";
import "./views-wallet.js";
import "./views-approvals.js";
import "./views-manage.js";
import "./views-store.js";
import "./views-board.js";
import "./views-progress.js";
import "./views-onboard.js";

const REFRESH_MS = 20_000;

// ---- token + ntfy deep-link capture ----

const got = captureFromHash();
if (got.approval) state.tab = "approvals";
// A link that wants to REPLACE the current session must be confirmed, never silently applied.
if (got.pendingSwitch) confirmPendingSwitch();

// A notification tap while the page is open is a same-document navigation (only
// the hash changes) — catch it too, or the deep link would be ignored.
window.addEventListener("hashchange", () => {
  const g = captureFromHash();
  if (g.approval) state.tab = "approvals";
  if (g.pendingSwitch) confirmPendingSwitch();
  if (g.token || g.approval) refresh();
});

// ---- tabs + overlay plumbing ----

document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
$("scrim").addEventListener("click", (e) => { if (e.target === $("scrim")) closeSheet(); });
$("photo-view").addEventListener("click", () => $("photo-view").classList.remove("show"));

// ---- i18n: paint chrome now, repaint + re-render when the shell flips language ----

function bootShell() {
  paintChrome();
  window.hatchParentShell?.onLang(() => { paintChrome(); render(); });
  render();
  // A wallet connect/disconnect changes what the deposit screen offers, and — under parent
  // custody only — whether first run can proceed at all. Inside Nimiq Pay the account resolves
  // eagerly rather than on a tap, so the required step would otherwise sit there asking for a
  // wallet that is already connected. Server custody is deliberately not in this condition:
  // the demo judge path repaints on exactly the events it always did.
  window.hatchParentShell?.wallet.onAccountChange(() => {
    if (state.tab === "deposit" || (!token() && walletRequired(state.custody))) render();
  });
}
if (window.hatchParentShell) bootShell();
else window.addEventListener("hatch-parent-shell-ready", bootShell, { once: true });

// ---- boot + refresh loop ----

setInterval(() => { if (!document.hidden && token()) refresh(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden && token()) refresh(); });

render();     // instant paint (loading / no-token state)
refresh();    // then data
