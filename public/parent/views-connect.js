// nimiq.kids parent — giving EVERY kid an address in one trip to the wallet.
//
// The browser caller for `POST /api/family/connect-challenge` + `/connect-addresses`. Those
// two shipped with no caller at all, so the batch existed only for curl; the per-child flow
// (`registerKidAddress`, views-wallet.js) is what a parent has been using and stays exactly
// where it was, on each kid's own page.
//
// ## Where it is offered, and where it is not
//
// ONLY on an instance under PARENT CUSTODY (`custody.kidCustody === "parent"`, #415). There a
// kid has no address until this flow or the per-child one gives them one, so it is the way in.
// Under server custody the same flow is a one-way trap: the server signs a kid's sends today
// and stops being able to the moment their row says `parent`, with no route back. The gate is
// `offersParentCustody` in connect-batch.js, which carries the argument in full.
//
// And then only when two or more kids are still waiting. With one kid the batch buys nothing and costs
// something: it is the same single popup either way, and the per-child challenge names that
// child, so it is the stronger record. Offering both to a parent with one kid would be two
// buttons that do the same thing, one of them worse.
//
// ## What the parent is told, and why the count is in the copy
//
// The Keyguard's own consent screen reads "nimiq.kids is requesting access to N addresses",
// and it is the screen the parent meets one tap later. If our sheet says "give your kids
// addresses" and theirs says "2 addresses", the parent is left checking our arithmetic at the
// moment they are being asked to trust us. So the count is in the sheet, in the button, and in
// the toast, and it is the same number that goes into `requestedKeyPaths`.
//
// The sheet also comes BEFORE the wallet, for the reason payout-sign.js's netting sheet does:
// `connectAccount` opens a popup or navigates the page away, and a parent who meets that first
// is being asked to approve something they have not been told the shape of.
//
// ## What is deliberately NOT said
//
// Not "only you can spend from them". The addresses are derived from the parent's own recovery
// phrase, so the parent holds the keys — but the Hub refuses to SIGN from a connect-derived
// address ("Address not found"), so a sentence about spending would be a promise the wallet
// does not currently keep. Payouts INTO these addresses are unaffected, which is the whole
// point of them. The copy says where they come from and stops there.

import {
  $, call, closeSheet, hub, lang, openSheet, pinKidAddress, refresh, render, state, t, toast,
} from "./core.js";
import { esc, fmtNim } from "./fmt.js";
import { icon } from "./icons.js";
import { assignmentsFrom, connectRefusal, offersParentCustody, planConnectBatch } from "./connect-batch.js";

const miniApp = () => window.hatchParentShell?.miniApp ?? null;

/** "Ivy and Sam", "Ivy, Sam and Max" — in the reader's language, which is the whole reason
 *  this is Intl and not a join. Older engines without ListFormat get a plain comma list
 *  rather than a crash. */
function nameList(labels) {
  try {
    return new Intl.ListFormat(lang(), { style: "long", type: "conjunction" }).format(labels);
  } catch {
    return labels.join(", ");
  }
}

/** The kids this batch would cover, in roster order.
 *
 *  EMPTY UNDER SERVER CUSTODY, and that is the gate, not a filter. See `offersParentCustody`:
 *  on an instance that holds the keys, moving a kid onto a parent-owned address costs them
 *  every outflow they had and no route gives it back. The plan is the one place both the row
 *  and the sheet read, so refusing here refuses both. */
export const connectBatchPlan = () =>
  (offersParentCustody(state.overview?.custody) ? planConnectBatch(state.overview?.children ?? []) : []);

// ---- the row on the family home ---------------------------------------------

/**
 * One tap, and only when the batch is worth offering. Built from the roster's own row
 * vocabulary (hex-tile / row-main / chev) so it reads as another thing you can tap on this
 * screen rather than a banner, and kept SHORT because `.row-label` and `.row-sub` truncate
 * instead of wrapping at 320px.
 */
export function connectBatchRow() {
  const plan = connectBatchPlan();
  if (plan.length < 2) return "";
  const label = t("papp.cbRow");
  const sub = t("papp.cbRowSub", { count: plan.length });
  return `<div class="group"><button class="row" id="cb-row">
    <span class="hex-tile">${icon("locked-lock", 22)}</span>
    <span class="row-main">
      <span class="row-label" title="${esc(label)}">${esc(label)}</span>
      <span class="row-sub" title="${esc(sub)}">${esc(sub)}</span>
    </span>
    <span class="chev">${icon("chevron-right", 14)}</span>
  </button></div>`;
}

export function wireConnectBatchRow(el) {
  el.querySelector("#cb-row")?.addEventListener("click", sheetConnectBatch);
}

// ---- the sheet: one screen, one button --------------------------------------

function sheetConnectBatch() {
  const plan = connectBatchPlan();
  if (plan.length < 2) return;
  const count = plan.length;
  openSheet(`<h2>${esc(t("papp.cbTitle", { names: nameList(plan.map((p) => p.label)) }))}</h2>
    <div class="sub">${esc(t("papp.cbSub", { count }))}</div>
    <div class="cb-kids">
      ${plan.map((p) => `<div class="cb-kid">${esc(p.label)}</div>`).join("")}
    </div>
    <button class="pill-btn blue wide" id="cb-go">${esc(t("papp.cbGo", { count }))}</button>`);
  $("cb-go")?.addEventListener("click", () => runConnectBatch(plan));
}

// ---- the flow ----------------------------------------------------------------

/**
 * Challenge, one popup, post the lot back.
 *
 * The challenge is minted FIRST and the wallet is asked second, so a household the server
 * would refuse costs no popup. Everything after the popup is all-or-nothing on the server
 * (`registerConnectedAddresses`): a batch that fails anywhere writes nothing, which is why
 * every refusal below can honestly say nothing was set up.
 *
 * Mobile is a full-page redirect, exactly as the per-child flow is: the Hub navigates away and
 * the result does not come back, so there is nothing to resume. The challenge simply expires
 * and the row is still on the home screen when the parent lands back.
 */
async function runConnectBatch(plan) {
  const h = hub();
  if (!h?.connectAccount) { toast(t("papp.didntGoThrough"), "error"); return; }
  const btn = $("cb-go");
  if (btn) btn.disabled = true;
  try {
    const ch = await call("POST", "/api/family/connect-challenge", {});
    if (ch.status !== 201) { toast(t("papp.didntGoThrough"), "error"); return; }

    closeSheet();
    toast(t("papp.cbWorking", { count: plan.length }));
    // The challenge string goes to the wallet VERBATIM. It carries the server's nonce and its
    // family binding; a client that composed its own would be binding nothing.
    const signatures = await h.connectAccount(ch.data.message, plan.map((p) => p.keyPath));
    if (!signatures?.length) return; // mobile redirect in flight, or a dismissed popup

    const built = assignmentsFrom(plan, signatures);
    if (!built.ok) { toast(refusalText(built), "error"); return; }

    const reg = await call("POST", "/api/family/connect-addresses", {
      challengeId: ch.data.challengeId, assignments: built.assignments,
    });
    if (reg.status !== 201) { toast(refusalText(reg.data), "error"); return; }

    // The client's own record of a choice the parent actually made, per kid, exactly as the
    // per-child flow writes it. Without it a later server-side address swap is silent, and
    // payout-sign.js has nothing to refuse against.
    for (const child of reg.data.children ?? []) pinKidAddress(child.id, child.address);
    toast(t("papp.cbDone", { count: reg.data.children?.length ?? plan.length }), "success");
    await refresh();
    render();
  } catch (err) {
    if (h.isMiniAppUnsupported?.(err)) { sheetOpenInBrowser(); return; }
    if (miniApp()?.isUserCancel(err)) { toast(t("papp.sendCancelled")); return; }
    toast(t("papp.didntGoThrough"), "error");
  } finally {
    const b = $("cb-go");
    if (b) b.disabled = false;
  }
}

/** Every refusal in words a parent can act on, resolved through the pure mapper so the
 *  wording rules live somewhere a test can reach without a DOM. */
function refusalText(data) {
  const { key, params } = connectRefusal(data, {
    nameOf: (id) => state.overview?.children?.find((k) => k.id === id)?.label ?? "",
    nim: fmtNim,
  });
  return t(key, params);
}

/** Inside Nimiq Pay there is no Hub to open and the mini-app SDK has no `connectAccount`, so
 *  the flow refuses with a typed error instead of opening a popup that can never appear.
 *  Shared with the per-child flow in views-wallet.js — one sentence, one place. */
export function sheetOpenInBrowser() {
  openSheet(`<h2>${esc(t("papp.addrBrowserTitle"))}</h2>
    <div class="sub">${esc(t("papp.addrBrowserSub"))}</div>
    <button class="pill-btn" id="addr-browser-ok">${esc(t("papp.addrBrowserOk"))}</button>`);
  $("addr-browser-ok")?.addEventListener("click", closeSheet);
}
