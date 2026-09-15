// nimiq.kids parent — core: state, bearer-token auth (magic link #t=...), API calls,
// i18n glue to the fleet shell (window.hatchParentShell), chrome (tabs/badge),
// toast + sheet plumbing, and the render dispatcher the view modules register into.
//
// NO service worker on this page, deliberately: stale cached JS on the parent's
// phone is worse than a network round-trip while the family API is still moving.

import { icon, duotone } from "./icons.js";
import { esc, hydrateIdenticons } from "./fmt.js";
import { decideTokenCapture } from "./token-capture.js";
import { demoRecoveryAction, DEMO_ENTRANCE } from "./demo-recovery.js";

export const TOKEN_KEY = "kidsParentToken";
export const REFRESH_MS = 20_000;

export const $ = (id) => document.getElementById(id);

export const t = (key, params) => window.hatchParentShell?.t(key, params) ?? key;

/**
 * A row's title, in the reader's language when we are the ones who named it.
 *
 * Every title on a board is a database row. The ones WE seeded now carry a
 * `title_key` (src/title-catalog.ts) and translate; the ones a parent typed
 * carry none and are printed exactly as typed, in every language, because
 * "Feed Winston his 5pm scoop" is not ours to reword.
 *
 * That is the whole rule, and it is the one `box.js` already used for Treasure
 * Box shelves before this existed. Use it for ANY title that came off the wire:
 * a raw `row.title` in a template is the bug this replaces.
 *
 * Accepts either casing because the two APIs disagree: the kid board serializes
 * camelCase views (`/api/stickers/today`) while the parent reads rows closer to
 * the table (`title_key`). Normalising here is cheaper than a migration of every
 * response shape, and a caller cannot get it wrong.
 */
export const rowTitle = (row) => {
  const key = row?.titleKey ?? row?.title_key ?? null;
  const stored = row?.title ?? "";
  if (!key) return stored;
  // `t()` returns the KEY when nothing matches, and a card reading
  // "cat.job.dust" is worse than the English the row already carries. So a key
  // that did not resolve falls back to the stored title, which is exactly what
  // that column is for. This is not hypothetical: it is what every device sees
  // in the gap between a server deploy and a client cache refresh, and what an
  // older cached bundle sees forever.
  const out = t(key);
  return out === key ? stored : out;
};

export const lang = () => window.hatchParentShell?.getLanguage() ?? "en";
export const wallet = () => window.hatchParentShell?.wallet ?? null;
export const hub = () => window.hatchParentShell?.hub ?? null;

// ---- kid address pinning (the client's own copy of who is who) --------------
//
// THE SERVER IS NOT THE AUTHORITY ON WHERE A KID'S MONEY GOES.
//
// A compromised nimiq.kids could rewrite `children.address` to an attacker's and hand it
// back on the next overview. Every screen would render it, and a parent signing a payout
// would be signing to a stranger without a way of knowing: 36 base32 characters do not read
// as wrong. So at the moment a parent registers an address — the one moment they genuinely
// chose it, out of their own wallet, and proved it — this browser writes it down.
//
// From then on the pin is compared against whatever the server says, and a mismatch is
// shown as a mismatch. Phase 3, where the client actually builds a transaction, refuses to
// build one for an unpinned recipient at all; that check has to be here, in the code the
// server does not get to write, or it is not a check.
//
// Scope and limits, stated rather than implied:
//  - per browser. A new phone starts with no pins and sees no warnings until it registers
//    or re-pins. That is not a hole a server can walk through; it just means the defence is
//    per device, like every other client-side pin.
//  - clearing site data drops it. So does a browser evicting storage. Losing a pin is a
//    false NEGATIVE (no warning), never a false positive, which is the safe direction.
//  - the second, independent check is the Keyguard's own confirmation screen, which renders
//    its label for an address inside the parent's account and a bare address for one that is
//    not. That one is NONCUSTODIAL-PLAN's Q4 and is not yet confirmed, so this pin is the
//    only mitigation we can currently claim.
const PIN_KEY = "kidsAddressPins";

const bare = (a) => (a ?? "").replace(/\s+/g, "").toUpperCase();

function readPins() {
  try {
    const raw = JSON.parse(localStorage.getItem(PIN_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {}; // corrupt storage must not blank the app
  }
}

/** Remember the address a parent just registered for this kid. */
export function pinKidAddress(childId, address) {
  const pins = readPins();
  pins[childId] = bare(address);
  try { localStorage.setItem(PIN_KEY, JSON.stringify(pins)); } catch { /* private mode */ }
}

export const pinnedKidAddress = (childId) => readPins()[childId] ?? null;

/** How the address the server reports compares with what this browser pinned.
 *   "unpinned"  nothing was registered from this device (no claim either way)
 *   "match"     the server agrees with the pin
 *   "mismatch"  IT DOES NOT, and that is the one a parent has to be told about */
export function pinState(child) {
  const pin = pinnedKidAddress(child.id);
  if (!pin) return "unpinned";
  return bare(child.address) === pin ? "match" : "mismatch";
}

export const state = {
  tab: "home",
  kidId: null,          // non-null = per-kid account page (on the home tab)
  overview: null,       // /api/parent/overview
  rates: { nimUsd: 0.002 },
  onboarding: false,    // first run is still on screen even though a token now exists
  kidWallet: {},        // childId -> /api/kids/:id/wallet payload
  kidStaking: {},       // childId -> /api/kids/:id/staking payload
  depositInfo: null,    // /api/family/deposit-info
  // An in-app top up that did NOT come back landed (#417). `topup-broadcast` waits on chain
  // for the money to arrive before it answers, so the ordinary in-app top up reconciles
  // itself and the manual "Check for it" is off-app plumbing a connected parent should never
  // meet. It waits at most HATCH_TOPUP_CONFIRM_MS though, and a slow block outlives that. So
  // the one case where a connected parent genuinely needs the manual check is this one, and
  // it is the only case that brings the button back.
  topUpUnconfirmed: false,
  devices: undefined,   // undefined = not probed, null = endpoint missing, [] = list
  screens: undefined,   // undefined = not read, null = endpoint missing, [] = no tablet paired.
                        // /api/parent/screen-state: what each paired tablet is DOING, ruled
                        // server-side and never re-derived here (#305).
  grownUps: undefined,  // undefined = not probed, null = endpoint missing/in flight,
                        // else /api/family/members (the household's roster + who you are)
  loadError: false,
  deepLinkId: null,
  store: null,          // /api/parent/store (Treasure Box catalogue)
  board: null,          // one kid's jobs/routines/practices (views-board.js)
  boardOpen: false,     // true = the board manager (a sub-page of the per-kid page)
  progressOpen: false,  // true = the progress tracker (#379), another sub-page of the same
  progress: null,       // the whole household's series, one payload on one `now`
  progressDays: 14,     // the window the parent last chose
  // undefined = never read, null = the read FAILED, [] = this household has no curfew.
  // The three are different sentences on the settings card and must not collapse.
  allowWindows: undefined,
  explorerTx: "",       // /health `explorerTx`: block-explorer prefix for a tx hash.
                        // Empty in SIM, where the hashes are invented.
  custody: null,        // /health `custody`: what this INSTANCE does, read without a bearer.
                        // null = not answered yet, never "server" by assumption. The signed-in
                        // app reads custody off state.overview.custody (the family's own view);
                        // the first-run screen has no token and no family, so this is the only
                        // source it has. See onboard-gate.js.
  demo: null,           // /health `demo`: this instance hands out SEEDED demo households
                        // (demoSeedEnabled), which is a different question from
                        // custody.demoUnlocked. null = not answered yet. It is what lets a 401
                        // be read as a swept demo family rather than a signed-out parent.
  pendingToken: null,   // a #t= link that wants to REPLACE the current session — held for confirm
};

// ---- token capture (magic link is THE auth; wallet connect is for payments) ----

// The magic link is the whole auth model, so a link that carries #t=<token> supplies the
// identity. Silently writing it over an existing session is session fixation: a crafted link
// (SMS, QR, chat) could swap a signed-in parent onto an attacker's household, where a top-up
// then funds the attacker's budget. The rule lives in decideTokenCapture (token-capture.js) so
// it is testable without a DOM: a token that DIFFERS from the current session is not committed,
// it is held in state.pendingToken for an explicit, household-named confirm
// (confirmPendingSwitch). A first sign-in and a link matching the current session commit as before.
export function captureFromHash() {
  const d = decideTokenCapture(location.hash, localStorage.getItem(TOKEN_KEY));
  if (d.commit) localStorage.setItem(TOKEN_KEY, d.commit);
  if (d.pendingSwitch) state.pendingToken = d.pendingSwitch;
  if (d.approval) state.deepLinkId = d.approval;
  // Wipe the fragment either way — the token must not linger in the URL or history.
  if (d.wipe) history.replaceState(null, "", location.pathname + location.search);
  return { token: !!d.commit, approval: !!d.approval, pendingSwitch: !!d.pendingSwitch };
}

/** A #t= link tried to switch an already-signed-in parent to a DIFFERENT household. Name that
 *  household (fetched with the incoming token) and require an explicit yes before committing it;
 *  otherwise the current session is kept and the incoming token is discarded. */
export async function confirmPendingSwitch() {
  const incoming = state.pendingToken;
  if (!incoming) return false;
  state.pendingToken = null;
  let label = "";
  try {
    const r = await fetch("/api/family", { headers: { Authorization: `Bearer ${incoming}` }, cache: "no-store" });
    if (r.ok) label = (await r.json())?.family?.parent_label ?? "";
  } catch { /* offline / bad token — fall back to an unnamed prompt */ }
  const who = label ? `“${label}”` : "a different family";
  const msg = `This link signs you in to ${who}, not the account you are already using on this device.\n\nSwitch to ${who}? Your current account stays put if you cancel.`;
  if (typeof confirm === "function" && confirm(msg)) {
    localStorage.setItem(TOKEN_KEY, incoming);
    location.reload();
    return true;
  }
  return false;
}

export const token = () => localStorage.getItem(TOKEN_KEY);

// ---- api ----

// Cloudflare Access gate detection. When a gate session expires, every API
// fetch dies as a cross-origin redirect (indistinguishable from offline) while
// the service worker keeps the cached shell alive — a silently FROZEN app that
// never updates (this is exactly how a phone got pinned to an old build on
// 2026-07-23). Probe /health with redirect:"manual": an opaqueredirect means
// the gate is up — one hard navigation lets the browser follow it to the
// login, which un-freezes everything after sign-in. Genuine offline leaves the
// cached app alone. At most one navigation per page load (no loops).
let gateProbed = false;
async function surfaceAccessGate() {
  if (gateProbed) return;
  gateProbed = true;
  try {
    const r = await fetch("/health", { redirect: "manual", cache: "no-store" });
    if (r.type === "opaqueredirect") {
      // ≤1 auto-navigation per minute per tab: if a browser ever serves the
      // cached shell instead of following the redirect, we must not reload-loop.
      const last = Number(sessionStorage.getItem("gateNavAt") ?? 0);
      if (Date.now() - last > 60_000) {
        sessionStorage.setItem("gateNavAt", String(Date.now()));
        location.assign(location.pathname + location.search + location.hash);
      }
    }
  } catch { /* offline — keep the cached app */ }
}
// Probe at boot too: a signed-out page makes no API calls at all, so a frozen
// gate state would otherwise never be noticed.
void surfaceAccessGate();

// The block-explorer prefix and this instance's custody model, read once at boot.
// Unauthenticated and cheap: one is what lets a transaction row link to the public record of
// itself, the other is what tells the first-run screen whether connecting a wallet is a step
// of signing up or an offer. Custody is READ here, never inferred from a 400 later.
//
// The repaint is conditional for a reason. This resolves after the first paint, and the
// screen it changes is the one with no bearer token — so only that screen is redrawn, and
// only when the answer could matter. A signed-in app is left alone.
//
// Kept as a PROMISE, not a fire-and-forget, for one narrow reason: a 401 can beat it home,
// and the recovery below needs a way to be told when the answer lands. It is never awaited
// on a path that paints (see demo-recovery.js) — it is subscribed to.
const healthRead = (async () => {
  try {
    const h = await (await fetch("/health", { cache: "no-store" })).json();
    state.explorerTx = h.sim ? "" : (h.explorerTx || "");
    state.custody = h.custody ?? null;
    state.demo = !!h.demo;
    if (!token()) render();
  } catch { /* no receipts rather than broken ones */ }
})();

/**
 * Act on a parent session this instance will not accept — a rejected bearer, or none at all.
 * The decision itself (and why it exists) lives in demo-recovery.js; this is the half that
 * touches `location`.
 *
 * `replace` so Back does not return to a dead session and bounce again, and once per page
 * load so a second failing call cannot re-navigate mid-flight.
 *
 * Returns whether it is navigating away, so the caller can skip the render that would
 * otherwise flash the sign-up screen on the way out.
 */
let demoBounced = false;
function recoverDemoSession() {
  const action = demoRecoveryAction(state.demo, demoBounced);
  if (action === "entrance") {
    if (!demoBounced) { demoBounced = true; location.replace(DEMO_ENTRANCE); }
    return true;
  }
  // "wait" = /health has not answered. Never block the signed-out screen on it (see
  // demo-recovery.js); paint now and bounce only if the answer lands as demo. healthRead
  // cannot reject, and an unreachable /health leaves the flag null forever, which lands on
  // the shipped behaviour rather than a blank screen.
  if (action === "wait") void healthRead.then(recoverDemoSession);
  return false;
}

export async function call(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token() ?? ""}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    // On the demo instance this navigates to the entrance and re-mints; anywhere else it is
    // a no-op and the signed-out screen renders exactly as before.
    if (!recoverDemoSession()) render();
    throw new Error("unauthorized");
  }
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

// ---- data refresh ----

let ratesLoaded = false;

export async function refresh() {
  // No token at all is the same dead end as a rejected one, for the same visitor: someone
  // handed /parent/ directly, or a link, or an installed shortcut that outlived its family.
  // On a seeded-demo instance the entrance is what mints a household, so that is where they
  // go — there is no self-serve sign-up on an instance whose whole job is handing one out.
  if (!token()) { if (!recoverDemoSession()) render(); return; }
  try {
    const jobs = [
      call("GET", "/api/parent/overview"),
      // Beside the overview rather than on a stream of its own — the route's own comment says
      // why there is no SSE. Resolving in the same tick is also what stops the tablet card on
      // home and the lock card on a kid's page from being two answers read at two instants.
      // Never allowed to fail the render: a household with no tablet has nothing to draw here
      // anyway, so a blip must not take the roster and the balances down with it.
      call("GET", "/api/parent/screen-state").catch(() => null),
    ];
    if (!ratesLoaded) jobs.push(fetch("/api/rates").then((r) => r.json()));
    const [ov, scr, rates] = await Promise.all(jobs);
    if (ov.status !== 200) { state.loadError = true; render(); return; }
    state.overview = ov.data;
    // A 404 is an older server with no such endpoint; anything else keeps the last good
    // answer. Both land on "draw nothing", never on a stale sentence dressed as fresh.
    state.screens = scr?.status === 200 ? (scr.data.screens ?? []) : (state.screens ?? null);
    if (rates?.nimUsd) { state.rates = rates; ratesLoaded = true; }
    state.loadError = false;
    // Balances render from the contract's wallet endpoint (children.balance_luna is
    // the legacy demo column; GET /kids/:id/wallet is truth in BOTH modes). A couple
    // of kids = a couple of cheap calls.
    //
    // THIS NO LONGER PROVISIONS, and it must not go back to it (#381). Reading a roster used
    // to mint every kid's account as a side effect, which decided their identicon before the
    // kid ever saw the picker. A kid with no account yet reads `address: null` and the screens
    // say so, which is the truth.
    //
    // These go through call(), NOT a bare fetch: /kids/:id/* is money-gated, so on any
    // instance that demands auth a headerless request answers 401 and the whole app
    // silently falls back to the legacy column, i.e. shows wrong balances. Errors are
    // swallowed per kid so one bad row never blanks the roster.
    await Promise.all(state.overview.children.map(async (k) => {
      try {
        const r = await call("GET", `/api/kids/${k.id}/wallet`);
        if (r.status === 200) state.kidWallet[k.id] = r.data;
      } catch { /* keep the previous snapshot */ }
    }));
    if (state.kidId) await loadKid(state.kidId);
  } catch (e) {
    if (e.message === "unauthorized") return; // call() already re-rendered
    state.loadError = true;
    void surfaceAccessGate();
  }
  render();
}

/** Per-kid page payloads. A READ: it does not provision, see refresh() above.
 *  Bearer-carrying call() for the same reason as refresh(): both endpoints are money-gated. */
export async function loadKid(id) {
  const [w, s] = await Promise.all([
    call("GET", `/api/kids/${id}/wallet`).catch(() => null),
    call("GET", `/api/kids/${id}/staking`).catch(() => null),
  ]);
  if (w?.status === 200) state.kidWallet[id] = w.data;
  if (s?.status === 200) state.kidStaking[id] = s.data;
}

// ---- render dispatch (views register themselves; avoids circular imports) ----

export const views = {};
export const viewEl = () => $("view");

export function render() {
  setChrome();
  const el = viewEl();
  // A background refresh must never wipe in-progress form input (PIN fields, ntfy
  // url, reject note focus). Skip the repaint while a control inside the view has
  // focus; the next tick or navigation repaints with fresh data.
  const active = document.activeElement;
  if (el.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;
  // `state.onboarding` keeps the first-run view up for one more screen AFTER the token
  // exists. The notify offer (#124) has to mint a topic, which needs a bearer, so it
  // cannot run before the family is created — and the token alone would otherwise hand
  // the screen straight to home the instant onboarding succeeds.
  if (!token() || state.onboarding) {
    // First run: the self-serve onboarding view (create your family / pairing code).
    // The needs-key card stays as the fallback if the module ever fails to load.
    if (views.onboard) { views.onboard(el); return; }
    el.innerHTML = `<div class="card pstate">${duotone("duotone-safe-lock", 88)}
      <h3>${t("papp.needsKeyTitle")}</h3><p>${t("papp.needsKeySub")}</p></div>`;
    return;
  }
  if (!state.overview) {
    el.innerHTML = state.loadError
      ? `<div class="card pstate">${duotone("duotone-nimiq-environment", 88)}
          <h3>${t("papp.cantReach")}</h3><p>${t("papp.cantReachSub")}</p>
          <button class="pill-btn blue" id="retry">${t("papp.tryAgain")}</button></div>`
      : `<div class="card pstate"><h3>${t("papp.loading")}</h3></div>`;
    $("retry")?.addEventListener("click", refresh);
    return;
  }
  // Sub-pages hang off a tab rather than owning one of their own: the per-kid account page
  // under Home, and that kid's BOARD one step deeper again. The Treasure Box used to be a
  // third, under Settings; it is its own tab now (#418) because it is what a kid's NIM buys
  // and not a preference. The tab bar is five wide.
  const name = state.tab === "home" && state.kidId
    ? (state.boardOpen ? "board" : state.progressOpen ? "progress" : "kid")
    : state.tab;
  views[name]?.(el);
  hydrateIdenticons(el);
}

export function go(tab, kidId = null) {
  // Leaving a tab closes the sub-page hanging off it, or tapping that tab again
  // would land back inside the sub-page instead of on the tab.
  if (tab !== state.tab) { state.boardOpen = false; state.progressOpen = false; }
  // Leaving the kid closes their board too: it belongs to one child, and coming
  // back to Home should be the roster, never the last kid's job list.
  if (kidId === null) { state.boardOpen = false; state.progressOpen = false; }
  state.tab = tab;
  state.kidId = kidId;
  render();
  if (kidId && !state.kidWallet[kidId]) loadKid(kidId).then(render);
}

function setChrome() {
  // The tab bar is chrome for a family that exists. During onboarding it must stay hidden
  // even once the token does — the notify offer (#124) runs AFTER the family is created, and
  // a visible tab there is a dead control: render() would still draw the onboarding view, so
  // the tap would look like the app had frozen.
  const tabs = document.getElementById("tabs");
  if (tabs) tabs.hidden = !token() || state.onboarding;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  // A supporter cannot manage the Box, so they must not be given a tab that renders nothing
  // (`views.store` answers to the same permission the Settings card used to). Hidden rather
  // than disabled: a dead tab in a five-wide bar is a fifth of the bar spent on a control
  // that never works.
  //
  // Read off `state` rather than imported from grownups.js, which imports THIS file: a cycle
  // between chrome and a view is how a module ends up half-initialised at first paint. The
  // default is TRUE for the same reason `canManageBoard` defaults true, an older server has
  // no roles and hiding the tab on one would be the worse failure.
  const boxTab = document.getElementById("tab-store");
  if (boxTab) boxTab.hidden = !(state.overview?.member?.can?.manageBoard ?? true);
  const n = state.overview?.pending?.length ?? 0;
  const badge = $("badge");
  badge.hidden = n === 0;
  badge.textContent = n;
}

/** Fill static chrome (tab labels via data-t, tab icons via data-ic). Re-run on language change. */
export function paintChrome() {
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll("[data-ic]").forEach((el) => { el.innerHTML = icon(el.dataset.ic, 20); });
}

// ---- toast (registry toast-notification component) ----

const TOAST_CHECK = `<svg class="nq-icon" width="74" height="74" viewBox="0 0 74 74" xmlns="http://www.w3.org/2000/svg"><path d="M71.12 1.84a4.5 4.5 0 0 0-6.28 1.04l-42.1 58.74L8.68 47.54a4.5 4.5 0 1 0-6.36 6.37l17.8 17.81a4.57 4.57 0 0 0 6.84-.56l45.2-63.03a4.5 4.5 0 0 0-1.04-6.29z" fill="currentColor" stroke="currentColor" stroke-width=".8"/></svg>`;
const TOAST_ALERT = `<svg class="nq-icon" width="17" height="16" viewBox="0 0 17 16" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M15.913 13.333L9.68 1.433a1.333 1.333 0 0 0-2.362 0l-6.232 11.9a1.333 1.333 0 0 0 1.182 1.952H14.73a1.333 1.333 0 0 0 1.182-1.952zm-8.08-7.718a.667.667 0 0 1 1.334 0v4a.667.667 0 1 1-1.334 0v-4zm.682 7.674h.018a.983.983 0 0 0 .967-1.022 1.018 1.018 0 0 0-1.016-.978h-.019a.984.984 0 0 0-.965 1.02c.02.546.468.978 1.015.98z" fill="currentColor"/></svg>`;

/**
 * @param action optional `{ label, url }` — one link inside the toast, opened in a new tab.
 *
 * The one caller is the approve success toast handing over the payout's own transaction. A
 * toast is the right home for it: the receipt is worth ONE offer at the moment it is true, and
 * it is already permanently reachable from the money feed afterwards. The window stretches when
 * there is a link, because 2.8s is not long enough to read a line and then decide to tap it.
 */
/** @param ms overrides the dwell. An EXPLANATION needs longer than a confirmation: the
 *  defaults below are tuned for "Saved" and "That didn't go through", not for a sentence
 *  somebody has to actually read. */
export function toast(msg, kind = "info", action = null, ms = null) {
  const el = $("toast");
  el.className = `nq-toast${kind === "success" ? " nq-toast--success" : kind === "error" ? " nq-toast--error" : ""}`;
  const ic = kind === "success" ? TOAST_CHECK : kind === "error" ? TOAST_ALERT : "";
  // The action link is OUR markup with escaped parts. The MESSAGE is somebody's data:
  // every caller passes t(key, params) and t() interpolates {name} raw, so a value like a
  // child's nickname used to arrive here as parsed HTML. It goes in as textContent, which
  // means it cannot, whatever any of the callers forgets.
  const link = action?.url
    ? `<a class="nq-toast-action" href="${esc(action.url)}" target="_blank" rel="noopener">${esc(action.label)}</a>`
    : "";
  el.innerHTML = `${ic ? `<div class="icon">${ic}</div>` : ""}<div class="content" ${ic ? "" : 'style="padding-left:16px"'}><div class="status"></div>${link}</div>`;
  el.querySelector(".status").textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms ?? (link ? 6000 : 2800));
}

/**
 * The shell asking this app to say something, because it cannot.
 *
 * `src/parent-shell.ts` and this file are two separate module graphs on one page: the shell is
 * a bundled entry from `src/`, `core.js` is served raw and owns the toast. So when the corner
 * control needs to explain something in the app's own voice it dispatches an event rather than
 * growing a second toast of its own, which would style and stack differently from every other
 * message in the app.
 *
 * Today there is exactly one sender: a "Connect wallet" tap on a demo household. Keeping it a
 * generic key-carrying event rather than a demo-specific one means the next thing the shell
 * needs to say does not need another seam. The key is translated HERE, where the parent
 * locales live; the shell never sees the string.
 */
window.addEventListener("nimiq-kids-toast", (ev) => {
  const key = ev.detail?.key;
  // 7s, not the 2.8s default: this is two sentences explaining what the demo skipped, and a
  // message that vanishes before it is read is the same as no message.
  if (key) toast(t(key), "info", null, ev.detail?.ms ?? 7000);
});

// ---- sheet + photo plumbing ----

export function openSheet(html) { $("sheet").innerHTML = html; $("scrim").classList.add("show"); }
export function closeSheet() { $("scrim").classList.remove("show"); }

export function showPhoto(url) {
  $("photo-img").src = url;
  $("photo-view").classList.add("show");
}
