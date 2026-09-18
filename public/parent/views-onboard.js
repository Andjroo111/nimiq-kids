// nimiq.kids parent — first run as a CLIMB (WP2, 2026-09-18): six stepped screens and a
// prize, one ask per screen, progress on top, duo lip buttons, under 90 seconds. Rendered
// whenever the page has no bearer token; screens 2 to 5 collect into the ONE POST
// /api/onboard that mints the token, step 5 rides in as its `goal` field, and the prize
// screen mints the tablet's pairing code. Or sign in with a 6-digit code from the welcome.
//
//   1 welcome     the cast, Get started, I have a code
//   2 parent      what the kids call you
//   3 kid         the first kid's nickname (more later)
//   4 wallet      onboard-gate.js decides: server custody may skip, parent custody must connect
//   5 goal        a prize and three rungs from the starter template (onboard-goal.js), then POST
//   6 notify      the existing notify offer (#124), allow or later
//   ★ ready       hatch, then the pairing code for the tablet, then home
//
// THE WALLET IS OPTIONAL IN ONE CUSTODY MODE AND A STEP IN THE OTHER, and which one is read
// off /health, never guessed from a failed response (core.js reads it into state.custody at
// boot). The decision is onboard-gate.js so it is one function with inputs; this file only
// draws what it returns. Under parent custody Continue does not fire without an address and
// the refusal has words a parent can act on.
//
// Guardrails on the screen itself, not buried: parent-custodial framing (you fund it, you
// approve every payout) + the privacy note (no kid accounts, no ads, nicknames only).
//
// ANIMATION SLOTS are `.anim[data-riv]` mounts for the shared loader (/js/lib/rive-mount.js).
// A blank data-riv fetches nothing and the empty mount collapses. Screen 1 carries the three
// characters Andjroo approved 2026-09-18 (frog, penguin, octopus, one verb each, from
// riv.nimiq.kids, never pinned to a hash: rebuilds land over the same URL), the prize screen one
// (the hatch, still blank). Nothing else here animates.

import { views, state, t, toast, refresh, render, wallet, TOKEN_KEY, $, call } from "./core.js";
import { icon, duotone } from "./icons.js";
import { esc } from "./fmt.js";
import { juice } from "./juice.js";
import { notifySetupHtml, wireNotifySetup } from "./notify-setup.js";
import { walletRequired, walletBlock, walletBlocksCreate, onboardErrorKey } from "./onboard-gate.js";
import { goalHtml, wireGoal, goalDraft, loadGoalData } from "./onboard-goal.js";
import { mountAll } from "/js/lib/rive-mount.js";

// The invite code rides ?ref=CODE (set by the public landing page / share link).
// Captured once, sent with the create call, then scrubbed from the URL.
const REF = new URLSearchParams(location.search).get("ref") ?? "";

/** The five counted steps, in climb order. The welcome and the prize sit outside the bar. */
const STEPS = ["parent", "kid", "wallet", "goal", "notify"];
let screen = "welcome"; // welcome | parent | kid | wallet | goal | notify | ready | pair
let busy = false;
const draft = { parent: "", kid: "" }; // survives re-renders (language flips etc.)
let family = null;      // the POST's answer: { child, ... }, for the prize screen
let pairCode = null;    // { code, expiresAt } minted for the tablet
let armedUrl = null;    // the notify offer's topic once armed

views.onboard = (el) => {
  const body = {
    welcome: welcomeHtml, parent: parentHtml, kid: kidHtml, wallet: walletHtml,
    goal: goalStepHtml, notify: notifyHtml, ready: readyHtml, pair: pairHtml,
  }[screen]();
  const n = STEPS.indexOf(screen);
  el.innerHTML = `<div class="climb ${n >= 0 ? "is-step" : `is-${screen}`}">
    ${n >= 0 ? progressHtml(n) : ""}
    <div class="climb-body">${body}</div>
  </div>`;
  ({ welcome: wireWelcome, parent: wireParent, kid: wireKid, wallet: wireWallet,
    goal: wireGoalStep, notify: wireNotify, ready: wireReady, pair: wirePair })[screen](el);
  mountAll(el);
};

const go = (next) => { screen = next; render(); };
const back = () => go(screen === "parent" ? "welcome" : STEPS[STEPS.indexOf(screen) - 1]);

// ---- chrome shared by the five steps ----

function progressHtml(n) {
  const label = t("papp.climbStep", { n: n + 1, total: STEPS.length });
  return `<div class="climb-top">
    <button type="button" class="climb-back" id="climb-back" aria-label="${esc(t("papp.climbBack"))}">${icon("chevron-left", 18)}</button>
    <div class="climb-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${STEPS.length}" aria-valuenow="${n + 1}" aria-label="${esc(label)}">
      <i style="--p: ${(n + 1) / STEPS.length}"></i>
    </div>
  </div>`;
}
const wireBack = (el) => el.querySelector("#climb-back")?.addEventListener("click", back);
const primary = (id, label, disabled = false) =>
  `<div class="climb-foot"><button type="button" class="duo-button is-block" id="${id}"${disabled ? " disabled" : ""}>${label}</button></div>`;
/** Enter in a single field is Continue. The field blurs first: core.js's render() skips a
 *  repaint while an input inside the view has focus (a background refresh must never wipe
 *  typing), and a step change is a repaint. */
const enterIs = (input, btn) => input?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !btn.disabled) { input.blur(); btn.click(); }
});

// ---- 1 welcome ----

function welcomeHtml() {
  return `
    <div class="climb-stage" aria-hidden="true">
      <img class="climb-lockup" src="/assets/brand/nimiq-kids-lockup-light.svg" alt="" />
      <div class="climb-cast">
        <div class="anim" data-riv="https://riv.nimiq.kids/nimiq-kids-frog.riv" data-verb="jump"></div>
        <div class="anim" data-riv="https://riv.nimiq.kids/nimiq-kids-penguin.riv" data-verb="slide"></div>
        <div class="anim" data-riv="https://riv.nimiq.kids/nimiq-kids-octopus.riv" data-verb="wave"></div>
      </div>
    </div>
    <h2 class="climb-title">${t("papp.onbTitle")}</h2>
    ${REF ? `<p class="onb-invited">${t("papp.onbInvited")}</p>` : ""}
    <p class="climb-sub">${t("papp.climbWelcomeSub")}</p>
    <p class="onb-privacy">${t("papp.onbPrivacy")}</p>
    ${primary("climb-start", t("papp.climbGetStarted"))}
    <button type="button" class="onb-link" id="onb-pair">${t("papp.onbHaveCode")}</button>`;
}
function wireWelcome(el) {
  el.querySelector("#climb-start").onclick = () => go("parent");
  el.querySelector("#onb-pair").onclick = () => go("pair");
}

// ---- 2 your name ----

function parentHtml() {
  return `
    <h2 class="climb-title">${t("papp.climbParentTitle")}</h2>
    <input class="nq-input climb-field" id="onb-parent" maxlength="24" placeholder="${esc(t("papp.climbParentField"))}" value="${esc(draft.parent)}" autocomplete="off" autocapitalize="words" />
    ${primary("climb-next", t("papp.climbContinue"), !draft.parent.trim())}`;
}
function wireParent(el) {
  wireBack(el);
  const input = $("onb-parent"), btn = $("climb-next");
  input.addEventListener("input", () => { draft.parent = input.value; btn.disabled = !draft.parent.trim(); });
  enterIs(input, btn);
  btn.onclick = () => { if (draft.parent.trim()) go("kid"); };
  input.focus();
}

// ---- 3 kid's name ----

function kidHtml() {
  return `
    <h2 class="climb-title">${t("papp.climbKidTitle")}</h2>
    <input class="nq-input climb-field" id="onb-kid" maxlength="24" placeholder="${esc(t("papp.climbKidField"))}" value="${esc(draft.kid)}" autocomplete="off" autocapitalize="words" />
    <p class="climb-hint">${t("papp.climbKidHint")}</p>
    ${primary("climb-next", t("papp.climbContinue"), !draft.kid.trim())}`;
}
function wireKid(el) {
  wireBack(el);
  const input = $("onb-kid"), btn = $("climb-next");
  input.addEventListener("input", () => { draft.kid = input.value; btn.disabled = !draft.kid.trim(); });
  enterIs(input, btn);
  btn.onclick = () => { if (draft.kid.trim()) go("wallet"); };
  input.focus();
}

// ---- 4 wallet ----

/** onboard-gate.js decides which of three blocks this is. "required" (parent custody, nothing
 *  connected) keeps Continue dead and says why above it; "optional" (server custody) offers the
 *  connect as the secondary and lets Continue read "Skip for now"; "connected" is the chip in
 *  both modes. `walletBlock` can never return "optional" under parent custody, which is what
 *  keeps the optional sentence from being told where it is false. */
function walletHtml() {
  const address = wallet()?.account?.address ?? "";
  const required = walletRequired(state.custody);
  const block = walletBlock(state.custody, address);
  const connected = `<div class="onb-connected">${t("papp.onbConnected")}</div>`;
  const title = required ? t("papp.onbWalletStep") : t("papp.climbWalletTitle");
  const sub = required ? t("papp.onbWalletStepSub") : t("papp.onbConnectHint");
  const offer = block === "connected" ? connected
    : `<button type="button" class="duo-button is-block ${required ? "" : "is-secondary"}" id="onb-connect">${t("papp.onbConnect")}</button>`;
  const next = block === "connected" || required ? t("papp.climbContinue") : t("papp.climbWalletSkip");
  return `
    <h2 class="climb-title">${title}</h2>
    <p class="climb-sub">${sub}</p>
    <div class="climb-wallet">${offer}</div>
    ${primary("climb-next", next, walletBlocksCreate(state.custody, address))}`;
}
function wireWallet(el) {
  wireBack(el);
  el.querySelector("#onb-connect")?.addEventListener("click", connectWallet);
  $("climb-next").onclick = async () => {
    const address = wallet()?.account?.address ?? "";
    if (walletBlocksCreate(state.custody, address)) { toast(t("papp.onbNeedWallet"), "error"); return; }
    await loadGoalData();
    go("goal");
  };
}

/** Wallet connect. Inside Nimiq Pay this is the native listAccounts flow; on the web it opens
 *  the Hub. Declining is a normal outcome and never an error — under parent custody it simply
 *  leaves the step where it was, with the primary still dead and still saying why. */
async function connectWallet() {
  const w = wallet();
  if (!w) return;
  const btn = $("onb-connect");
  if (btn) btn.disabled = true;
  try {
    await w.connect();
  } catch (err) {
    if (!window.hatchParentShell?.miniApp?.isUserCancel(err)) toast(t("papp.didntGoThrough"), "error");
  }
  render(); // connected chip, or the button back
}

// ---- 5 first goal, then the POST ----

function goalStepHtml() {
  return `${goalHtml()}${primary("onb-create", t("papp.onbCreate"))}`;
}
function wireGoalStep(el) {
  wireBack(el);
  wireGoal(el, render);
  $("onb-create").onclick = createFamily;
}

async function createFamily() {
  if (busy) return;
  // The disabled Continue on step 4 is the visible guard; this is the one that holds when
  // custody lands between paints, or when anything calls this without the button. A create
  // that cannot succeed must name what is missing, never spend a round trip to be told.
  const address = wallet()?.account?.address ?? "";
  if (walletBlocksCreate(state.custody, address)) { toast(t("papp.onbNeedWallet"), "error"); go("wallet"); return; }
  const parentLabel = draft.parent.trim();
  const kidLabel = draft.kid.trim();
  if (!parentLabel || !kidLabel) { toast(t("papp.onbNeedNames"), "error"); go(parentLabel ? "kid" : "parent"); return; }
  busy = true;
  const btn = $("onb-create");
  btn.disabled = true;
  btn.textContent = t("papp.onbCreating");
  try {
    // Plain fetch: there is no bearer yet — this call MINTS it. Screens 2 to 5 are the body.
    const r = await fetch("/api/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentLabel, kidLabel, address, goal: goalDraft(), ...(REF ? { ref: REF } : {}) }),
    });
    const data = await r.json().catch(() => ({}));
    // A refusal the server has NAMED is not a mystery, and this screen is the one place in
    // the app with nothing behind it. onboardErrorKey maps the ones a parent can act on; the
    // outer catch below is still the generic message, for the failures nobody named (offline).
    if (r.status !== 201 || !data.token) {
      toast(t(onboardErrorKey(data)), "error");
      busy = false;
      render();
      return;
    }
    localStorage.setItem(TOKEN_KEY, data.token); // exactly how core.js expects it
    family = data;
    if (REF) history.replaceState(null, "", location.pathname); // scrub the ref
    juice("choreApproved");
    toast(t("papp.onbWelcome"), "success");
    // Two more screens before home. Notifications (#124) need a bearer to mint a topic, so
    // they could not come earlier; the prize screen hands the tablet its code.
    state.onboarding = true;   // hold the first-run view past the token
    busy = false;
    go("notify");
  } catch {
    toast(t("papp.didntGoThrough"), "error");
    busy = false;
    render();
  }
}

// ---- 6 make the phone ring (#124) ----

/** Skipping is a first-class button, not fine print. A parent who does not want a third
 *  party in their family's day should not have to hunt for the way past, and one who taps
 *  it can turn pings on from Settings later with the same card. */
function notifyHtml() {
  return `
    <div class="climb-glyph">${duotone("duotone-bell", 72)}</div>
    <h2 class="climb-title">${t("papp.onbPingTitle")}</h2>
    <div class="climb-notify">${notifySetupHtml(armedUrl, { compact: true })}</div>
    ${primary("onb-ping-skip", armedUrl ? t("papp.climbContinue") : t("papp.onbPingSkip"))}`;
}
function wireNotify(el) {
  // No back from here: the family exists. The bar's back button is not drawn on this step.
  el.querySelector("#climb-back")?.remove();
  // notify-setup.js is shared with Settings and draws pill buttons; here they are lips.
  for (const b of el.querySelectorAll(".climb-notify .pill-btn")) {
    const ghost = b.classList.contains("ghost");
    b.className = `duo-button ${ghost ? "is-secondary" : ""} ${b.classList.contains("wide") ? "is-block" : ""}`.trim();
  }
  wireNotifySetup(el, armedUrl, { onArmed: (url) => { armedUrl = url; render(); } });
  el.querySelector("#onb-ping-skip").onclick = async () => { await mintPairCode(); go("ready"); };
}

// ---- ★ family ready: the hatch, then the tablet's code ----

/** A 6-digit code for THIS kid's tablet (5 min, single use), the same one Settings mints and
 *  /api/devices/register redeems. Minted with the child so the tablet follows this kid. */
async function mintPairCode() {
  const r = await call("POST", "/api/parent/pair-code", { childId: family?.child?.id }).catch(() => null);
  pairCode = r?.status === 201 ? r.data : null;
}

function readyHtml() {
  const name = family?.child?.label ?? draft.kid.trim();
  return `
    <div class="climb-stage" aria-hidden="true"><div class="anim climb-hatch" data-riv="" data-verb="hatch"></div></div>
    <h2 class="climb-title">${t("papp.climbReadyTitle")}</h2>
    <p class="climb-sub">${t("papp.climbReadySub", { name })}</p>
    <div class="climb-code-card">
      <div class="climb-label">${t("papp.climbCodeTitle")}</div>
      ${pairCode ? `<div class="pair-code-big">${esc(pairCode.code)}</div>` : ""}
      <p class="climb-hint">${t("papp.climbCodeSub")}</p>
      <button type="button" class="duo-button is-secondary is-sm" id="climb-code-again">${t("papp.climbCodeAgain")}</button>
    </div>
    ${primary("climb-go", t("papp.climbGo"))}`;
}
function wireReady(el) {
  el.querySelector("#climb-code-again").onclick = async () => { await mintPairCode(); render(); };
  // refresh() is what leaves onboarding: it reads the bearer that createFamily() already
  // stored and swaps this view for the live home screen.
  el.querySelector("#climb-go").onclick = () => {
    screen = "welcome";
    state.onboarding = false;
    refresh();
  };
}

// ---- pairing code entry (the WebView-dropped-the-fragment rescue) ----

function pairHtml() {
  return `
    <div class="climb-glyph">${duotone("duotone-safe-lock", 72)}</div>
    <h2 class="climb-title">${t("papp.pairTitle")}</h2>
    <p class="climb-sub">${t("papp.pairSub")}</p>
    <input class="nq-input climb-field onb-code" id="pair-code" inputmode="numeric" autocomplete="one-time-code"
      maxlength="6" placeholder="${esc(t("papp.pairCode"))}" />
    ${primary("pair-go", t("papp.pairGo"))}
    <button type="button" class="onb-link" id="pair-back">${t("papp.pairBack")}</button>`;
}

function wirePair(el) {
  el.querySelector("#pair-go")?.addEventListener("click", doPair);
  el.querySelector("#pair-back")?.addEventListener("click", () => go("welcome"));
  el.querySelector("#pair-code")?.addEventListener("keydown", (e) => { if (e.key === "Enter") doPair(); });
  el.querySelector("#pair-code")?.focus();
}

const post = (path, code) => fetch(path, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code }),
});

/**
 * Redeem a 6-digit code. TWO KINDS ARRIVE HERE and the person typing one does not know which
 * they were given.
 *
 * `/api/members/join` admits a GROWN-UP to a household (the other parent, a grandparent) and
 * mints a token bound to them. `/api/pair` re-attaches a phone whose magic-link fragment a
 * WebView ate — the rescue this screen was built for. They are separate tables, so a code is
 * one or the other and never both, and asking a person "which sort of code is this?" is asking
 * them about our schema.
 *
 * Join is tried first because it is the one somebody is handed by another human. Both share
 * the pair-brake, so a wrong code costs two attempts rather than one; that halves a caller's
 * allowance from six tries a minute to three, which is still more than a person typing off a
 * phone call needs, and the instance-wide miss budget is unchanged in kind.
 */
async function doPair() {
  const code = $("pair-code").value.trim();
  if (!/^\d{6}$/.test(code)) { toast(t("papp.pairBad"), "error"); return; }
  const btn = $("pair-go");
  btn.disabled = true;
  try {
    let r = await post("/api/members/join", code);
    let data = await r.json().catch(() => ({}));
    let joinedName = data?.family?.parentLabel ?? null;
    if (!data.token && r.status !== 429) {
      r = await post("/api/pair", code);
      data = await r.json().catch(() => ({}));
      joinedName = null;
    }
    if (r.status === 429) { toast(t("papp.pairSlow"), "error"); btn.disabled = false; return; }
    if (!data.token) { toast(t("papp.pairBad"), "error"); btn.disabled = false; return; }
    localStorage.setItem(TOKEN_KEY, data.token);
    // Only the join path can name the household — a pairing code re-attaches a phone that was
    // already in one, and "you have joined your own family" is a confusing thing to be told.
    if (joinedName) toast(t("papp.gupJoinDone", { name: joinedName }), "success");
    refresh();
  } catch {
    toast(t("papp.didntGoThrough"), "error");
    btn.disabled = false;
  }
}
