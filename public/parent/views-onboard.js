// nimiq.kids parent — first run: create your family (the judge path) or sign in with a
// 6-digit pairing code. Rendered whenever the page has no bearer token; the create
// call mints one server-side and lands straight on the home screen. Target: a total
// stranger inside Nimiq Pay is using nimiq.kids in under a minute (two nicknames, one tap).
//
// THE WALLET IS OPTIONAL IN ONE CUSTODY MODE AND A STEP IN THE OTHER, and which one is read
// off /health, never guessed from a failed response. Under server custody nothing here has
// changed: the family wallet is the instance's own, a connect only affects top-ups, and the
// ghost button with "Optional right now" is the shipped screen. Under parent custody the
// parent's own wallet is the SENDER of every payout, so POST /api/onboard cannot invent one
// (`address_required`) — the step is stated above the name fields, the primary button does
// not fire without it, and the refusal has words a parent can act on. The decision itself is
// in onboard-gate.js so it is one function with inputs rather than three conditions here.
//
// Guardrails on the screen itself, not buried: parent-custodial framing (you fund it,
// you approve every payout, you can pause it any time) + the privacy note (no kid
// accounts, no ads, no tracking, nicknames only).

import { views, state, t, toast, refresh, render, wallet, TOKEN_KEY, $ } from "./core.js";
import { duotone } from "./icons.js";
import { esc } from "./fmt.js";
import { juice } from "./juice.js";
import { notifySetupHtml, wireNotifySetup } from "./notify-setup.js";
import { walletRequired, walletBlock, walletBlocksCreate, onboardErrorKey } from "./onboard-gate.js";

// The invite code rides ?ref=CODE (set by the public landing page / share link).
// Captured once, sent with the create call, then scrubbed from the URL.
const REF = new URLSearchParams(location.search).get("ref") ?? "";

let mode = "create"; // 'create' | 'pair' | 'notify'
let busy = false;
const draft = { parent: "", kid: "" }; // survives re-renders (language flips etc.)

views.onboard = (el) => {
  if (mode === "notify") { el.innerHTML = notifyHtml(); wireNotify(el); return; }
  el.innerHTML = mode === "pair" ? pairHtml() : createHtml();
  if (mode === "pair") wirePair(el);
  else wireCreate(el);
};

// ---- create your family ----

function createHtml() {
  const address = wallet()?.account?.address ?? "";
  const required = walletRequired(state.custody);
  const block = walletBlock(state.custody, address);
  const connectedChip = `<div class="onb-connected">${t("papp.onbConnected")}</div>`;
  // ABOVE the name fields, and only where it is required. A step a parent meets after typing
  // is not a step, it is a dead end — which is exactly what this screen was on mainnet: two
  // names, one tap, 400, "try again". The connect is the blue primary while it is the only
  // thing on the screen that can be done; "Create your family" is the blue one once it is not.
  // Connected, it collapses to the chip IN PLACE, so the step completes where it stood.
  // The empty case carries no newline of its own, and that is not cosmetic: under server
  // custody this template has to produce the shipped markup with nothing added, and a
  // whitespace-only text node is a difference. tools/onboard-custody-verify.py compares the
  // rendered card against origin/main's byte for byte on a live instance.
  const stepBlock = !required
    ? ""
    : block === "required"
      ? `
      <div class="onb-step">
        <div class="onb-step-title">${t("papp.onbWalletStep")}</div>
        <div class="onb-step-sub">${t("papp.onbWalletStepSub")}</div>
        <button class="pill-btn blue wide" id="onb-connect">${t("papp.onbConnect")}</button>
      </div>`
      : connectedChip;
  // Server custody, the shipped screen unchanged: the ghost button and the "optional" hint in
  // the same slot under the names. walletBlock() can never return "optional" under parent
  // custody, which is what keeps that sentence from being told where it is false.
  const offerBlock = required
    ? ""
    : block === "connected"
      ? connectedChip
      : `<button class="pill-btn ghost wide" id="onb-connect">${t("papp.onbConnect")}</button>
         <div class="onb-hint">${t("papp.onbConnectHint")}</div>`;
  return `<div class="card pstate onb">
    <div class="onb-hex" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 18"><g fill="none"><path fill="url(#onb-hex-grad)" d="M19.964 8.156 15.758.844A1.69 1.69 0 0014.299 0H5.887c-.6 0-1.156.32-1.456.844L.225 8.156c-.3.523-.3 1.165 0 1.688l4.206 7.312c.3.523.856.844 1.456.844h8.412c.6 0 1.156-.32 1.456-.844l4.206-7.312a1.69 1.69 0 00.003-1.688"/><defs><radialGradient id="onb-hex-grad" cx="0" cy="0" r="1" gradientTransform="matrix(20.1956 0 0 20.2552 15.188 17.766)" gradientUnits="userSpaceOnUse"><stop stop-color="#ec991c"/><stop offset="1" stop-color="#e9b213"/></radialGradient></defs></g></svg></div>
    <h3>${t("papp.onbTitle")}</h3>
    ${REF ? `<p class="onb-invited">${t("papp.onbInvited")}</p>` : ""}
    <p>${t("papp.onbSub")}</p>${stepBlock}
    <input class="nq-input" id="onb-parent" maxlength="24" placeholder="${esc(t("papp.onbParentName"))}" value="${esc(draft.parent)}" autocomplete="off" />
    <input class="nq-input" id="onb-kid" maxlength="24" placeholder="${esc(t("papp.onbKidName"))}" value="${esc(draft.kid)}" autocomplete="off" />
    ${offerBlock}
    <button class="pill-btn blue wide" id="onb-create"${walletBlocksCreate(state.custody, address) ? " disabled" : ""}>${t("papp.onbCreate")}</button>
    <p class="onb-privacy">${t("papp.onbPrivacy")}</p>
    <button class="onb-link" id="onb-pair">${t("papp.onbHaveCode")}</button>
  </div>`;
}

function wireCreate(el) {
  const keep = () => {
    draft.parent = $("onb-parent")?.value ?? draft.parent;
    draft.kid = $("onb-kid")?.value ?? draft.kid;
  };
  el.querySelector("#onb-parent")?.addEventListener("input", keep);
  el.querySelector("#onb-kid")?.addEventListener("input", keep);
  el.querySelector("#onb-connect")?.addEventListener("click", connectWallet);
  el.querySelector("#onb-create")?.addEventListener("click", createFamily);
  el.querySelector("#onb-pair")?.addEventListener("click", () => { mode = "pair"; render(); });
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

async function createFamily() {
  if (busy) return;
  // The disabled button is the visible guard; this is the one that holds when custody lands
  // between paints, or when anything ever calls this without going through the button. A
  // create that cannot succeed must name what is missing, never spend a round trip to be told.
  const address = wallet()?.account?.address ?? "";
  if (walletBlocksCreate(state.custody, address)) { toast(t("papp.onbNeedWallet"), "error"); return; }
  const parentLabel = $("onb-parent").value.trim();
  const kidLabel = $("onb-kid").value.trim();
  if (!parentLabel || !kidLabel) { toast(t("papp.onbNeedNames"), "error"); return; }
  busy = true;
  const btn = $("onb-create");
  btn.disabled = true;
  btn.textContent = t("papp.onbCreating");
  try {
    // Plain fetch: there is no bearer yet — this call MINTS it.
    const r = await fetch("/api/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentLabel, kidLabel, address, ...(REF ? { ref: REF } : {}) }),
    });
    const data = await r.json().catch(() => ({}));
    // A refusal the server has NAMED is not a mystery, and this screen is the one place in
    // the app with nothing behind it: "That didn't go through. Try again" on a first run is
    // advice that cannot work. onboardErrorKey maps the ones a parent can act on; the outer
    // catch below is still the generic message, for the failures nobody named (offline).
    if (r.status !== 201 || !data.token) {
      toast(t(onboardErrorKey(data)), "error");
      busy = false;
      render();
      return;
    }
    localStorage.setItem(TOKEN_KEY, data.token); // exactly how core.js expects it
    if (REF) history.replaceState(null, "", location.pathname); // scrub the ref
    juice("choreApproved");
    toast(t("papp.onbWelcome"), "success");
    // One more screen before home, and it is the one that decides whether this app is
    // alive next week: notifications were OFF for every family that never found Settings
    // and pasted an ntfy topic in, so the loop's latency was "whenever the parent next
    // remembers to open the app" (#124). Asked here because the parent is holding the
    // phone and has just proved they want this; asked, not done, because arming it starts
    // sending a child's name and chore titles to a third party and that is a choice.
    mode = "notify";
    state.onboarding = true;   // hold the first-run view for one more screen
    busy = false;
    render();
  } catch {
    toast(t("papp.didntGoThrough"), "error");
    busy = false;
    render();
  }
}

// ---- make the phone ring (#124) ----------------------------------------------

/** Skipping is a first-class button, not fine print. A parent who does not want a third
 *  party in their family's day should not have to hunt for the way past, and one who taps
 *  it can turn pings on from Settings later with the same card. */
function notifyHtml() {
  return `<div class="card pstate onb">
    ${duotone("duotone-bell", 72)}
    <h3>${t("papp.onbPingTitle")}</h3>
    ${notifySetupHtml(armedUrl, { compact: true })}
    <button class="onb-link" id="onb-ping-skip">${armedUrl ? t("papp.onbPingDone") : t("papp.onbPingSkip")}</button>
  </div>`;
}

let armedUrl = null;

function wireNotify(el) {
  wireNotifySetup(el, armedUrl, { onArmed: (url) => { armedUrl = url; render(); } });
  // refresh() is what leaves onboarding: it reads the bearer that createFamily() already
  // stored and swaps this view for the live home screen.
  el.querySelector("#onb-ping-skip")?.addEventListener("click", () => {
    mode = "create";
    state.onboarding = false;
    refresh();   // reads the bearer createFamily() stored and swaps in the live home screen
  });
}

// ---- pairing code entry (the WebView-dropped-the-fragment rescue) ----

function pairHtml() {
  return `<div class="card pstate onb">
    ${duotone("duotone-safe-lock", 72)}
    <h3>${t("papp.pairTitle")}</h3>
    <p>${t("papp.pairSub")}</p>
    <input class="nq-input onb-code" id="pair-code" inputmode="numeric" autocomplete="one-time-code"
      maxlength="6" placeholder="${esc(t("papp.pairCode"))}" />
    <button class="pill-btn blue wide" id="pair-go">${t("papp.pairGo")}</button>
    <button class="onb-link" id="pair-back">${t("papp.pairBack")}</button>
  </div>`;
}

function wirePair(el) {
  el.querySelector("#pair-go")?.addEventListener("click", doPair);
  el.querySelector("#pair-back")?.addEventListener("click", () => { mode = "create"; render(); });
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
