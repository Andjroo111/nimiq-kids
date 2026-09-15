// nimiq.kids parent — deposit (family hot-wallet top-up: QR + address grid + wallet-connect
// top-up via the fleet shell's dual-mode wallet) and settings (PIN, pings, tz, tablets,
// sounds). Outside Nimiq Pay the deposit screen offers the mini-app deeplink — top-up
// approvals feel native inside the wallet.

import { state, t, lang, views, call, render, refresh, toast, openSheet, closeSheet, wallet, hub, token, $ } from "./core.js";
import { screenTimeCard, wireScreenTimeCard } from "./views-screentime.js";
import { icon, duotone } from "./icons.js";
import { esc, fmtNim, addressGrid, renderQr, timeAgo, LUNA, identicon } from "./fmt.js";
import { juice, juiceEnabled, setJuiceEnabled } from "./juice.js";
import { notifySetupHtml, wireNotifySetup } from "./notify-setup.js";
import { canManageHousehold, grownUpsCard, loadGrownUps, wireGrownUps } from "./grownups.js";

// ---- deposit / top-up ----

const miniApp = () => window.hatchParentShell?.miniApp ?? null;

/** Standalone browser only: the "open nimiq.kids inside Nimiq Pay" panel (deeplink +
 *  copyable link). Inside Nimiq Pay the panel disappears — you're already home. */
function openInPayPanel() {
  const m = miniApp();
  if (!m || m.active) return "";
  const deeplink = m.deeplink(m.appUrl(token()));
  return `
    <div class="card dep-card">
      <h2>${t("papp.openInPayTitle")}</h2>
      <p class="sub">${t("papp.openInPaySub")}</p>
      <div class="dep-actions">
        <a class="pill-btn blue wide" href="${esc(deeplink)}">${t("papp.openInPay")}</a>
        <button class="pill-btn ghost wide" id="dep-pay-copy">${icon("copy", 14)} ${t("papp.copyAppLink")}</button>
      </div>
    </div>`;
}

/* The household's TILL, on a parent-custody instance.
 *
 * THIS CARD IS NOT THE WALLET THAT PAYS, and it used to be. It was written when a household
 * could hold exactly one grown-up, and `families.parent_address` was both the sender of every
 * payout and the account a kid's spending came back to. #291 split those two jobs apart:
 * `payoutSender` (src/members.ts) now resolves the ACTING GROWN-UP's own address, and
 * `parent_address` is only the till. This card's copy went on claiming "every payout you
 * approve is sent from this address" for as long as that was false, which is worse than
 * saying nothing, because the one screen a parent would go to in order to fix who pays is
 * the one screen that cannot.
 *
 * Who pays now lives in Settings, on the Grown-ups card, per grown-up.
 *
 * The till still deserves a control. It is where a Treasure Box spend returns to and what a
 * family transfer targets, and on a household created before the custody flip it is the
 * instance's own hot wallet.
 *
 * No "is this address yours?" check, on purpose. The server cannot tell whose wallet an
 * address belongs to, and the right action does not depend on the answer — picking the
 * address it already uses succeeds and changes nothing. So there is one button and no
 * branch, rather than a detector that would sometimes be wrong about which one to show.
 */
function familyWalletCard() {
  if (state.overview?.custody?.kidCustody !== "parent") return "";
  return `
    <div class="card dep-card" id="fam-wallet-card">
      <h2>${t("papp.famWalletTitle")}</h2>
      <p class="sub">${t("papp.famWalletSub")}</p>
      <div class="dep-visual">${identicon(state.overview.parentAddress, "dep-identicon")}</div>
      <div class="addr-panel">${addressGrid(state.overview.parentAddress ?? "")}</div>
      <button class="pill-btn blue wide" id="fam-wallet-pick">${t("papp.famWalletPick")}</button>
    </div>`;
}

async function pickFamilyWallet() {
  const h = hub();
  if (!h) { toast(t("papp.didntGoThrough"), "error"); return; }
  const btn = $("fam-wallet-pick");
  if (btn) btn.disabled = true;
  try {
    const chosen = await h.chooseAddress();
    if (!chosen) return; // mobile redirect in flight; the parent taps again on return
    const r = await call("PATCH", "/api/family/address", { address: chosen.address });
    if (r.status !== 200) {
      toast(r.data?.error === "invalid_address" ? t("papp.addrInvalid") : t("papp.didntGoThrough"), "error");
      return;
    }
    toast(t("papp.famWalletDone"), "success");
    await refresh();
    render();
  } catch (err) {
    if (h.isMiniAppUnsupported?.(err)) { toast(t("papp.addrBrowserSub"), "error"); return; }
    if (miniApp()?.isUserCancel(err)) { toast(t("papp.sendCancelled")); return; }
    toast(t("papp.didntGoThrough"), "error");
  } finally {
    const b = $("fam-wallet-pick");
    if (b) b.disabled = false;
  }
}

/* Under parent custody this screen is the family wallet, and NOTHING ELSE.
 *
 * The three top-up cards all exist to fill a shared hot wallet the server pays out of. A
 * parent-custody instance holds no key and therefore has no such wallet: the parent's own
 * account is the source of every payout, and "send NIM to this address, it funds the kids'
 * rewards" would be pointing at an address the app cannot spend from. Shown together the two
 * cards put TWO different addresses on one screen, only one of which does anything, which is
 * exactly the confusion the one-primary-action rule exists to prevent.
 *
 * NONCUSTODIAL-PLAN reaches the same place from the economics: with no shared float there is
 * nothing to ration, so the budget machinery collapses to an affordability hint.
 *
 * The tab is still labelled "Top up" here, which is now a small mismatch with the screen it
 * opens. Left alone on purpose: that label lives in index.html as static markup and making
 * chrome custody-aware is a bigger change than this one, with nothing gained tonight. */
const sharedFloat = () => state.overview?.custody?.kidCustody !== "parent";

views.deposit = (el) => {
  if (!sharedFloat()) {
    el.innerHTML = `${familyWalletCard()}${openInPayPanel()}`;
    $("fam-wallet-pick")?.addEventListener("click", pickFamilyWallet);
    $("dep-pay-copy")?.addEventListener("click", () => {
      navigator.clipboard?.writeText(miniApp().deeplink(miniApp().appUrl(token()))).catch(() => {});
      toast(t("papp.copied"), "success");
    });
    return;
  }
  const info = state.depositInfo;
  if (!info) {
    el.innerHTML = `<div class="card pstate"><h3>${t("papp.loading")}</h3></div>`;
    loadDepositInfo();
    return;
  }
  const acct = wallet()?.account ?? null;
  // "Check for it" is OFF-APP plumbing (#417, Andjroo: "I don't understand what the check for
  // it part is"). It reads the hot wallet on chain and reports the delta, which is the only
  // way the app learns about NIM a parent sent from somewhere else. An in-app top up does not
  // need it: `POST /family/topup-broadcast` waits for the transaction to actually EXECUTE and
  // for the hot wallet to receive it before it answers (topUpExecuted, src/routes/wallet.ts),
  // and `topUpFromWallet` runs the deposit-check itself the moment it does. So a connected
  // parent is shown one action, not two, per this repo's one-primary-action rule.
  //
  // It comes BACK after a top up that did not confirm inside HATCH_TOPUP_CONFIRM_MS, because
  // that is the one case where the money may still land later and the parent has nothing else
  // on this screen to reconcile with. Not shown pre-emptively, not hidden permanently.
  const showCheck = !acct || state.topUpUnconfirmed;
  // The payout-budget line and the family-code hint used to sit on this screen. Both are
  // gone (Andjroo, 2026-09-01: "that all just seems like fluff, I don't understand what any
  // of that is"). A receive screen answers one question, "where do I send it", and the
  // wallet's own Receive answers exactly that and nothing else. The budget is still
  // enforced server-side and the family code is still matched on an off-app deposit; what
  // changed is that neither is explained to a parent who never asked.
  // Receive parity with the real wallet: identicon first, the 3x3 grid in a grey
  // panel, actions below; the QR sits behind the wallet's QR icon toggle.
  el.innerHTML = `
    <div class="card dep-card">
      <h2>${t("papp.topUpTitle")}</h2>
      <p class="sub">${t("papp.topUpSub")}</p>
      <div class="dep-visual">
        ${identicon(info.address, "dep-identicon")}
        <div class="qr-holder" id="dep-qr-holder" hidden><canvas id="dep-qr" width="400" height="400"></canvas></div>
      </div>
      <div class="addr-panel">${addressGrid(info.address)}</div>
      <div class="dep-actions-row">
        <button class="pill-btn ghost" id="dep-copy">${icon("copy", 14)} ${t("papp.copyAddress")}</button>
        <button class="qr-toggle" id="dep-qr-btn" aria-label="${esc(t("papp.showQr"))}" title="${esc(t("papp.showQr"))}">${icon("qr", 20)}</button>
      </div>
    </div>
    ${openInPayPanel()}
    <div class="card dep-card">
      ${acct
        ? `<div class="topup-row">
             <input class="nq-input" id="dep-amt" type="number" inputmode="decimal" min="0" step="any" placeholder="NIM" aria-label="${t("papp.amountNim")}" />
             <button class="pill-btn blue" id="dep-send">${icon("arrow-from-bottom", 14)} ${t("papp.sendFromWallet")}</button>
           </div>
           <div class="dep-hint">${t("papp.fromConnected")}</div>`
        : `<div class="dep-hint">${t("papp.connectFirst")}</div>`}
      ${showCheck ? `<button class="pill-btn ghost wide" id="dep-check">${t("papp.iSentIt")}</button>` : ""}
    </div>`;
  renderQr($("dep-qr"), info.qr);
  $("dep-qr-btn").onclick = () => {
    const qr = $("dep-qr-holder");
    const idc = el.querySelector(".dep-identicon");
    qr.hidden = !qr.hidden;
    idc.hidden = !qr.hidden;
  };
  $("dep-copy").onclick = () => {
    navigator.clipboard?.writeText(info.address).catch(() => {});
    toast(t("papp.copied"), "success");
  };
  const check = $("dep-check");
  if (check) check.onclick = depositCheck;
  $("dep-send")?.addEventListener("click", topUpFromWallet);
  $("dep-pay-copy")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(miniApp().deeplink(miniApp().appUrl(token()))).catch(() => {});
    toast(t("papp.copied"), "success");
  });
};

async function loadDepositInfo() {
  const r = await call("GET", "/api/family/deposit-info");
  if (r.status === 200) { state.depositInfo = r.data; render(); }
}

async function depositCheck() {
  $("dep-check").disabled = true;
  const r = await call("POST", "/api/family/deposit-check", {});
  $("dep-check").disabled = false;
  if (r.status !== 200) { toast(t("papp.didntGoThrough"), "error"); return; }
  if (r.data.deltaLuna > 0) {
    // The thing it came back for arrived, so the button has done its job and goes away again
    // on the next render. A check that found nothing leaves it, because nothing has changed.
    state.topUpUnconfirmed = false;
    toast(t("papp.detected", { amount: fmtNim(r.data.deltaLuna) }), "success");
    render();
  } else { toast(t("papp.noDepositYet")); }
}

/** Wallet-connect top-up: sign in Andjroo's wallet (Hub popup / Nimiq Pay), then let
 *  the server broadcast the serialized tx (the Hub signs but does not relay) and
 *  run a deposit-check for the landed delta. */
async function topUpFromWallet() {
  const w = wallet();
  if (!w?.account) { toast(t("papp.connectFirst")); return; }
  const nim = Number($("dep-amt").value);
  if (!Number.isFinite(nim) || nim <= 0) { toast(t("papp.amountNim")); return; }
  const btn = $("dep-send");
  btn.disabled = true;
  try {
    toast(t("papp.sentForSigning"));
    // The family code rides in the tx data field (sendBasicTransactionWithData inside
    // Nimiq Pay, extraData via the Hub) — an on-chain reference for reconciliation.
    // Attribution itself is server-side: topup-broadcast knows the bearer's family.
    const res = await w.signAndSend({
      recipient: state.depositInfo.address.replace(/\s/g, ""),
      valueLuna: Math.round(nim * LUNA),
      ...(state.depositInfo.familyCode ? { data: `hatch:${state.depositInfo.familyCode}` } : {}),
    });
    const serializedTx = res.serializedTx ?? res.txHash;
    if (serializedTx) await call("POST", "/api/family/topup-broadcast", { serializedTx });
    state.depositInfo = null; // budget changed — refetch on next render
    const r = await call("POST", "/api/family/deposit-check", {});
    const landed = r.status === 200 && r.data.deltaLuna > 0;
    // The broadcast route already waited on chain for this, so a zero here means the block
    // outlived its wait, not that nothing was sent. That is what brings the manual check back
    // (see `showCheck`) and it is the only thing that does.
    state.topUpUnconfirmed = !landed;
    if (landed) toast(t("papp.detected", { amount: fmtNim(r.data.deltaLuna) }), "success");
    else toast(t("papp.noDepositYet"));
    render();
  } catch (err) {
    // Declining the wallet's approval dialog is a normal outcome, not a failure.
    if (miniApp()?.isUserCancel(err)) toast(t("papp.sendCancelled"));
    else toast(t("papp.didntGoThrough"), "error");
  }
  btn.disabled = false;
}

// ---- settings ----

views.settings = (el) => {
  const f = state.overview.family;
  const tzs = ["America/Chicago", "America/New_York", "America/Denver", "America/Phoenix", "America/Los_Angeles", "UTC"];
  const tzList = tzs.includes(f.tz) ? tzs : [f.tz, ...tzs];
  // ROWS THAT STATE THE ANSWER, sheets that change it (#420). The PIN and the time zone were
  // two full cards, one with two password fields and a button, drawn on every visit to
  // Settings for a parent who came for something else. Each is one row now: the PIN row says
  // whether one is set, the zone row names the zone, and the controls wait behind the tap.
  el.innerHTML = `
    ${!canManageHousehold() ? "" : `<div class="group">
      <button class="row" id="pin-row">
        <span class="hex-tile">${duotone("duotone-safe-lock", 22)}</span>
        <span class="row-main">
          <span class="row-label">${t("papp.pinTitle")}</span>
          <span class="row-sub">${f.hasPin ? t("papp.pinRowHas") : t("papp.pinRowNone")}</span>
        </span>
        <span class="chev">${icon("chevron-right", 14)}</span>
      </button>
      <button class="row" id="tz-row">
        <span class="hex-tile">${icon("gear", 22)}</span>
        <span class="row-main">
          <span class="row-label">${t("papp.tzTitle")}</span>
          <span class="row-sub">${esc(f.tz.replace(/_/g, " "))}</span>
        </span>
        <span class="chev">${icon("chevron-right", 14)}</span>
      </button>
    </div>`}

    <div class="card set-card">
      <div class="set-head">${duotone("duotone-bell", 24)}<h3>${t("papp.pingsTitle")}</h3></div>
      <!-- MY topic, not the household's. Every grown-up has their own now, and a card that
           read the family's would tell a grandparent her pings were already on because the
           owner had set theirs up. Falls back to the family's for a phone talking to a server
           that predates members, and for the owner, whose topic IS the household's. -->
      ${notifySetupHtml(state.overview?.member?.notifyUrl ?? f.notifyUrl)}
      <!-- The raw field is the escape hatch, not the front door. Any webhook that accepts a
           POST works here (notify.ts's own header names the GHL sidecar), so removing it to
           simplify the one-tap path would take a real use away. Behind a disclosure because
           a parent who does not know what a webhook is should never meet one. -->
      <details class="nt-adv">
        <summary>${t("papp.pingsAdvanced")}</summary>
        <div class="set-hint">${t("papp.pingsSub")}</div>
        <input class="nq-input" id="nt-url" type="url" placeholder="https://ntfy.sh/your-topic" value="${esc(f.notifyUrl ?? "")}" />
        <button class="pill-btn ghost" id="nt-save">${t("papp.save")}</button>
      </details>
    </div>

    ${screenTimeCard()}

    <div class="card set-card">
      <div class="set-head">${duotone("duotone-bell", 24)}<h3>${t("papp.juiceTitle")}</h3></div>
      <div class="set-hint">${t("papp.juiceSub")}</div>
      <div class="app-toggle"><span class="t">${t("papp.juiceToggle")}</span>
        <button class="tgl ${juiceEnabled() ? "on" : ""}" id="juice-tgl" aria-label="${t("papp.juiceToggle")}"></button></div>
    </div>

    ${grownUpsCard()}

    ${devicesCard()}

    ${!canManageHousehold() ? "" : `<div class="group">
      <button class="row" id="pair-row">
        <span class="hex-tile">${icon("qr", 22)}</span>
        <span class="row-main">
          <span class="row-label">${t("papp.pairDeviceTitle")}</span>
          <span class="row-sub" title="${esc(t("papp.pairDeviceSub"))}">${t("papp.pairDeviceSub")}</span>
        </span>
        <span class="chev">${icon("chevron-right", 14)}</span>
      </button>
      <button class="row" id="lost-row">
        <span class="hex-tile">${duotone("duotone-safe-lock", 22)}</span>
        <span class="row-main">
          <span class="row-label">${t("papp.signOutAllTitle")}</span>
          <span class="row-sub" title="${esc(t("papp.signOutAllSub"))}">${t("papp.signOutAllSub")}</span>
        </span>
        <span class="chev">${icon("chevron-right", 14)}</span>
      </button>
    </div>`}`;
  loadGrownUps();                // fills the Grown-ups card (no-op once loaded)
  wireGrownUps(el);
  if ($("pair-row")) $("pair-row").onclick = mintPairCode;
  if ($("pin-row")) $("pin-row").onclick = () => sheetPin(f);
  if ($("tz-row")) $("tz-row").onclick = () => sheetTz(f, tzList);
  if ($("lost-row")) $("lost-row").onclick = sheetSignOutAll;
  if ($("nt-save")) $("nt-save").onclick = saveNotify;
  // The one-tap path owns #nt-on / #nt-test / the QR. Re-render on arm rather than patching
  // the card in place: the card has two shapes and render() already knows how to draw both.
  wireNotifySetup(el, f.notifyUrl ?? null, {
    onArmed: (notifyUrl) => {
      // The endpoint's answer IS the new state, so there is nothing to re-fetch. Writing it
      // where patchSettings writes its own answer keeps one place that holds the family.
      // The endpoint's answer IS the new state; it is the MEMBER's topic, so it is written
      // onto the member rather than onto the family.
      if (state.overview.member) state.overview.member = { ...state.overview.member, notifyUrl };
      else state.overview.family = { ...f, notifyUrl };
      toast(t("papp.pingsOnNow"), "success");
      render();
    },
  });
  wireScreenTimeCard(el);
  $("juice-tgl").onclick = () => {
    const on = !juiceEnabled();
    setJuiceEnabled(on);
    $("juice-tgl").classList.toggle("on", on);
    if (on) juice("choreApproved"); // an instant taste of what was just turned on
  };
  el.querySelectorAll("[data-dev]").forEach((b) => (b.onclick = () => sheetDevice(b.dataset.dev)));
  // The panic button: a phone that is gone cannot be picked off a list, so this cuts every
  // tablet and every OTHER phone at once and leaves this one signed in.
  probeDevices();
};

function sheetPin(f) {
  openSheet(`<h2>${t("papp.pinTitle")}</h2>
    <div class="sub">${f.hasPin ? t("papp.pinChangeSub") : t("papp.pinSetSub")}</div>
    <input class="nq-input" id="pin-1" type="password" inputmode="numeric" maxlength="8" placeholder="${t("papp.pinNew")}" autocomplete="new-password" />
    <input class="nq-input" id="pin-2" type="password" inputmode="numeric" maxlength="8" placeholder="${t("papp.pinAgain")}" autocomplete="new-password" />
    <button class="pill-btn blue" id="pin-save">${f.hasPin ? t("papp.pinChange") : t("papp.pinSet")}</button>`);
  $("pin-save").onclick = savePin;
  $("pin-1").focus();
}

function sheetTz(f, tzList) {
  openSheet(`<h2>${t("papp.tzTitle")}</h2>
    <div class="sub">${t("papp.tzSub")}</div>
    <select class="nq-input" id="tz-sel">${tzList.map((z) => `<option value="${esc(z)}" ${z === f.tz ? "selected" : ""}>${esc(z.replace(/_/g, " "))}</option>`).join("")}</select>
    <button class="pill-btn blue" id="tz-save">${t("papp.save")}</button>`);
  $("tz-save").onclick = saveTz;
}

/** The question is asked in a sheet of its own rather than a native confirm(): the sheet
 *  names what happens in the app's own words, and the scrim is the "no". */
function sheetSignOutAll() {
  openSheet(`<h2>${t("papp.signOutAllTitle")}</h2>
    <div class="sub">${t("papp.signOutAllConfirm")}</div>
    <button class="pill-btn ghost" id="sign-out-all">${t("papp.signOutAllBtn")}</button>`);
  $("sign-out-all").onclick = async () => {
    $("sign-out-all").disabled = true;
    const r = await call("POST", "/api/parent/sign-out-everywhere", {});
    if (r.status !== 200) { $("sign-out-all").disabled = false; toast(t("papp.couldntSave"), "error"); return; }
    state.devices = null; // re-probe: they are all gone
    closeSheet();
    toast(t("papp.signedOutAll"), "success");
    render();
  };
}

async function patchSettings(patch, okMsg) {
  const r = await call("PATCH", "/api/family/settings", patch);
  if (r.status !== 200) { toast(t("papp.couldntSave"), "error"); return false; }
  state.overview.family = r.data.family;
  toast(okMsg, "success");
  return true;
}

async function savePin() {
  const p1 = $("pin-1").value, p2 = $("pin-2").value;
  if (!/^\d{4,8}$/.test(p1)) { toast(t("papp.pinRule"), "error"); return; }
  if (p1 !== p2) { toast(t("papp.pinMismatch"), "error"); return; }
  if (await patchSettings({ newPin: p1 }, t("papp.pinSaved"))) { closeSheet(); render(); }
}

async function saveNotify() {
  const url = $("nt-url").value.trim();
  if (url && !/^https?:\/\//.test(url)) { toast(t("papp.badLink"), "error"); return; }
  await patchSettings({ notifyUrl: url || null }, t("papp.saved"));
}

async function saveTz() {
  if (await patchSettings({ tz: $("tz-sel").value }, t("papp.saved"))) { closeSheet(); render(); }
}

/** Mint a 6-digit pairing code (5 min, single use) and show it big — the other
 *  device (another phone, or the Nimiq Pay WebView that lost the magic link)
 *  types it on its own sign-in screen. */
async function mintPairCode() {
  const r = await call("POST", "/api/parent/pair-code", {});
  if (r.status !== 201) { toast(t("papp.didntGoThrough"), "error"); return; }
  openSheet(`<h2>${t("papp.pairDeviceTitle")}</h2>
    <div class="sub">${t("papp.pairShowSub")}</div>
    <div class="pair-code-big">${esc(r.data.code)}</div>`);
}

// ---- kid tablets (device allowlist) ----

/** Exported because two other screens ask the same question for the same reason: an override
 *  or a lock window on a household with no tablet reaches nothing, and both the kid page
 *  (#304) and the schedule section (#303) say so. One probe, one answer, whichever screen
 *  asked first — and every screen that reads `state.devices` has to be in the repaint below,
 *  or the answer lands after the paint that needed it and is never drawn. */
export async function probeDevices() {
  if (!state.overview || state.devices !== undefined) return;
  try {
    const r = await call("GET", "/api/devices");
    state.devices = r.status === 404 ? null : (r.data.devices ?? []);
  } catch { state.devices = state.devices ?? null; }
  if (state.tab === "settings" || state.boardOpen || (state.tab === "home" && state.kidId)) render();
}

function devicesCard() {
  if (state.devices == null) return ""; // not probed yet, or endpoint missing
  const rows = state.devices.length === 0
    ? `<div class="set-hint">${t("papp.noDevices")}</div>`
    : state.devices.map((d) => `<div class="dev-row">
        <span class="hex-tile">${icon("qr", 20)}</span>
        <div class="dev-main"><div class="dev-lbl">${esc(d.label ?? t("papp.tablet"))}</div>
        <div class="dev-sub">${d.lastSeenAt ? t("papp.seen", { ago: timeAgo(d.lastSeenAt, lang()) }) : t("papp.neverSeen")}</div></div>
        <button class="pill-btn ghost sm" data-dev="${d.id}">${t("papp.apps")}</button></div>`).join("");
  return `<div class="card set-card">
    <div class="set-head">${duotone("duotone-gamepad", 24)}<h3>${t("papp.devicesTitle")}</h3></div>
    <div class="set-hint">${t("papp.devicesSub")}</div>${rows}</div>`;
}

/** Normalize the devices payload (installedApps rows are {pkg,label}) into {package,label}. */
function deviceApps(d) {
  const norm = (x) => typeof x === "string"
    ? { package: x, label: x }
    : { package: x.pkg ?? x.package ?? x.id ?? x.name, label: x.label ?? x.name ?? x.pkg ?? x.package ?? x.id };
  const installed = (d.installedApps ?? d.apps ?? []).map(norm);
  const allowed = (Array.isArray(d.allowedApps) ? d.allowedApps : []).map(norm);
  const seen = new Set();
  return [...installed, ...allowed].filter((a) => a.package && !seen.has(a.package) && seen.add(a.package));
}

function sheetDevice(devId) {
  const d = state.devices.find((x) => x.id === devId);
  if (!d) return;
  const allowed = new Set((Array.isArray(d.allowedApps) ? d.allowedApps : []).map((a) => (typeof a === "string" ? a : a.package)));
  const apps = deviceApps(d);
  const rows = apps.length === 0
    ? `<div class="set-hint" style="text-align:center;padding:14px 0">${t("papp.noApps")}</div>`
    : apps.map((a) => `<div class="app-toggle"><span class="t">${esc(a.label)}</span>
        <button class="tgl ${allowed.has(a.package) ? "on" : ""}" data-pkg="${esc(a.package)}" aria-label="${esc(a.label)}"></button></div>`).join("");
  openSheet(`<h2>${esc(d.label ?? t("papp.tablet"))}</h2>
    <div class="sub">${t("papp.appsSub")}</div>
    <div>${rows}</div>
    ${apps.length === 0 ? "" : `<button class="pill-btn blue wide" id="dev-save">${t("papp.save")}</button>`}
    <div class="set-hint" style="text-align:center;margin-top:16px">${t("papp.removeDeviceSub")}</div>
    <button class="pill-btn ghost wide" id="dev-remove">${t("papp.removeDevice")}</button>`);
  $("dev-remove").onclick = async () => {
    if (!confirm(t("papp.removeDeviceConfirm", { name: d.label ?? t("papp.tablet") }))) return;
    $("dev-remove").disabled = true;
    const r = await call("DELETE", `/api/devices/${devId}`);
    closeSheet();
    if (r.status !== 200) { toast(t("papp.couldntSave"), "error"); return; }
    state.devices = state.devices.filter((x) => x.id !== devId);
    toast(t("papp.deviceRemoved"), "success");
    render();
  };
  document.querySelectorAll(".tgl").forEach((b) => (b.onclick = () => {
    b.classList.toggle("on");
    b.classList.contains("on") ? allowed.add(b.dataset.pkg) : allowed.delete(b.dataset.pkg);
  }));
  // Absent on a tablet that has not reported its apps: nothing to save, so no button.
  if ($("dev-save")) $("dev-save").onclick = async () => {
    $("dev-save").disabled = true;
    const pkgs = [...allowed];
    const r = await call("PATCH", `/api/devices/${devId}/allowed-apps`, { packages: pkgs });
    closeSheet();
    if (r.status === 404) { state.devices = null; render(); toast(t("papp.notReady"), "error"); return; }
    if (r.status !== 200) { toast(t("papp.couldntSave"), "error"); return; }
    d.allowedApps = pkgs;
    toast(t("papp.saved"), "success");
  };
}
