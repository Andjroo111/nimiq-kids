// nimiq.kids parent — the household's grown-ups: the roster, inviting one, and pointing your
// own approvals at your own wallet.
//
// Its own module rather than another card in views-manage.js, which is already the longest
// view file here and sits under the same 800-line CI guard as everything else. Settings calls
// `grownUpsCard()` for the markup and `wireGrownUps()` for the handlers, the same seam
// `notify-setup.js` uses.
//
// ## What this screen is actually for
//
// A kid whose parents live in two houses, and grandparents who want to put real money into
// that kid's savings. Every grown-up here approves from their OWN phone and pays from their
// OWN wallet, which is the whole reason the tablet stops travelling. So the roster's second
// line is never decoration: "pays from their own wallet" and "their approvals come out of
// yours" are different financial arrangements and a parent has to be able to see which one
// they are in at a glance.

import { $, call, openSheet, render, state, t, toast, wallet } from "./core.js";
import { esc, spacedAddress } from "./fmt.js";
import { icon, duotone } from "./icons.js";

/** The acting grown-up, as the server described them on the overview. Null on an older
 *  server, which is why every call site treats "no member" as "the way it was before". */
export const me = () => state.overview?.member ?? null;

/** May this phone put work on the board (jobs, routines, practices, kids, the Treasure Box)?
 *  Defaults TRUE when the server said nothing: an older server has no roles, and hiding every
 *  edit button on it would be a worse failure than showing one that answers 403. */
export const canManageBoard = () => me()?.can?.manageBoard ?? true;
/** May this phone change the household itself (settings, pairing, the family wallet)? */
export const canManageHousehold = () => me()?.can?.manageHousehold ?? true;

const ROLE_LABEL = {
  owner: "papp.gupRoleOwner",
  coparent: "papp.gupRoleCoparent",
  supporter: "papp.gupRoleSupporter",
};

/** Does paying from your OWN wallet mean anything here? Under server custody every payout
 *  leaves the shared hot wallet whoever approves, so the screen must not offer to connect a
 *  wallet that would never be asked to sign. */
const ownWalletPays = () => state.grownUps?.ownWalletPays === true;

/** The household's owner, for the sentences that name whose wallet is covering you. */
const ownerLabel = () =>
  state.grownUps?.members?.find((m) => m.role === "owner")?.label ?? state.overview?.family?.parentLabel ?? "";

// ---- the roster ----

export async function loadGrownUps() {
  if (state.grownUps !== undefined) return;
  state.grownUps = null; // in flight: stops a second load racing the first
  try {
    const r = await call("GET", "/api/family/members");
    state.grownUps = r.status === 200 ? r.data : null;
  } catch { state.grownUps = null; }
  if (state.tab === "settings") render();
}

function memberRow(m) {
  const you = m.isYou ? ` · ${t("papp.gupYou")}` : "";
  const payLine = ownWalletPays()
    ? (m.canPay
      ? `<div class="gup-sub gup-sub--on">${icon("check", 14)} ${t("papp.gupWalletOn")}</div>`
      : `<div class="gup-sub gup-sub--off">${t("papp.gupNoWallet")}</div>`)
    : "";
  // Remove is offered ONLY where it would work: the owner alone may, and never on themselves.
  const canRemove = canManageHousehold() && m.role !== "owner";
  return `<div class="gup-row">
    <span class="hex-tile">${duotone("duotone-group", 20)}</span>
    <div class="gup-main">
      <div class="gup-lbl">${esc(m.label)}<span class="gup-you">${esc(you)}</span></div>
      <div class="gup-sub">${t(ROLE_LABEL[m.role] ?? "papp.gupRoleSupporter")}</div>
      ${payLine}
    </div>
    ${canRemove ? `<button class="pill-btn ghost sm" data-gup-remove="${esc(m.id)}" data-gup-name="${esc(m.label)}">${t("papp.gupRemove")}</button>` : ""}
  </div>`;
}

function pendingRow(inv) {
  return `<div class="gup-row gup-row--pending">
    <span class="hex-tile">${icon("qr", 20)}</span>
    <div class="gup-main">
      <div class="gup-lbl">${esc(inv.label)}</div>
      <div class="gup-sub">${t("papp.gupPending")}</div>
    </div>
    <button class="pill-btn ghost sm" data-gup-cancel="${esc(inv.id)}">${t("papp.gupPendingCancel")}</button>
  </div>`;
}

/** The Settings card. Empty string until the roster has loaded, so the card never flashes a
 *  half-drawn household — the same restraint devicesCard() uses. */
export function grownUpsCard() {
  const g = state.grownUps;
  if (!g?.members) return "";
  const mine = g.me;
  // THE CONTROL IS OFFERED WHETHER OR NOT AN ADDRESS IS ALREADY SET.
  //
  // It used to appear only for a grown-up who had none, which reads as reasonable and is a
  // dead end for the one case that matters most. `payoutSender` falls back to the household
  // owner and then to `families.parent_address`, so a household that predates multi-grown-up
  // support came through the migration with its owner already carrying an address — and on
  // the live mainnet household that inherited address is the instance's old hot wallet, which
  // nobody holds a key for. Every approval mints an intent naming a sender that cannot sign,
  // the wallet answers "Address not found", and the screen offered no way to correct it.
  //
  // An address that can be set once and never changed is also just wrong on its own terms: a
  // grown-up who picks the wrong one, or moves wallets, is stuck for good.
  const myWallet = ownWalletPays() && mine
    ? `<div class="gup-mine">
         <div class="set-hint">${mine.address ? t("papp.gupMyWalletTitle") : t("papp.gupMyWalletNone", { name: ownerLabel() })}</div>
         ${mine.address ? `<div class="gup-addr">${esc(spacedAddress(mine.address))}</div>` : ""}
         <button class="pill-btn ${mine.address ? "ghost" : "blue"}" id="gup-my-wallet">
           ${mine.address ? t("papp.gupMyWalletChange") : t("papp.gupMyWalletPick")}
         </button>
       </div>`
    : "";
  return `<div class="card set-card">
    <div class="set-head">${duotone("duotone-group", 24)}<h3>${t("papp.gupTitle")}</h3></div>
    <div class="set-hint">${ownWalletPays() ? t("papp.gupSub") : t("papp.gupSubServer")}</div>
    ${g.members.map(memberRow).join("")}
    ${(g.invites ?? []).map(pendingRow).join("")}
    ${myWallet}
    ${mine?.can?.invite ? `<button class="pill-btn ghost" id="gup-invite">${t("papp.gupInvite")}</button>` : ""}
  </div>`;
}

// ---- inviting ----

function inviteSheet() {
  // A co-parent may only hand out the supporter role (the server refuses the other, and a
  // button that answers 403 is a button that should not have been drawn).
  const canMakeCoparent = me()?.role === "owner";
  openSheet(`
    <h3>${t("papp.gupInvite")}</h3>
    <div class="set-hint">${t("papp.gupInviteName")}</div>
    <input class="nq-input" id="gup-name" maxlength="24" placeholder="${t("papp.gupInviteNamePh")}" />
    <div class="set-hint">${t("papp.gupInviteRole")}</div>
    <div class="gup-roles">
      ${canMakeCoparent ? `<label class="gup-role">
        <input type="radio" name="gup-role" value="coparent" />
        <span><b>${t("papp.gupInviteCoparent")}</b><i>${t("papp.gupInviteCoparentSub")}</i></span>
      </label>` : ""}
      <label class="gup-role">
        <input type="radio" name="gup-role" value="supporter" checked />
        <span><b>${t("papp.gupInviteSupporter")}</b><i>${t("papp.gupInviteSupporterSub")}</i></span>
      </label>
    </div>
    <button class="pill-btn blue" id="gup-make">${t("papp.gupInviteMake")}</button>`);
  $("gup-make").onclick = mintInvite;
}

async function mintInvite() {
  const label = $("gup-name").value.trim();
  if (!label) { toast(t("papp.gupInviteName"), "error"); return; }
  const role = document.querySelector('input[name="gup-role"]:checked')?.value ?? "supporter";
  const r = await call("POST", "/api/family/members/invite", { label, role });
  if (r.status !== 201) { toast(t("papp.gupNotAllowed"), "error"); return; }
  // The code is shown ONCE — only its hash is stored — so this sheet is the only place it
  // ever exists. Read out, never sent as a link: a link that admits somebody to a household
  // lands in message history and survives in a screenshot.
  openSheet(`
    <h3>${t("papp.gupCodeTitle")}</h3>
    <div class="pair-code-big">${esc(r.data.code)}</div>
    <div class="set-hint">${t("papp.gupCodeSub", { name: label })}</div>
    <div class="set-hint">${t("papp.gupCodeWhere")}</div>`);
  state.grownUps = undefined;
  loadGrownUps();
}

// ---- your own wallet ----

async function useMyWallet() {
  const w = wallet();
  const address = w?.account?.address;
  if (!address) { toast(t("papp.famWalletSub"), "error"); return; }
  const r = await call("PUT", "/api/family/members/me/address", { address });
  if (r.status === 200) {
    toast(t("papp.gupMyWalletDone"), "success");
    state.grownUps = undefined;
    loadGrownUps();
    return;
  }
  // Named refusals, because "that address is already somebody's here" is a different fix from
  // "that is not an address".
  if (r.data?.error === "address_taken") toast(t("papp.gupMyWalletTaken", { name: r.data.byLabel ?? "" }), "error");
  else if (r.data?.error === "address_is_a_kid_wallet") toast(t("papp.gupMyWalletKid", { name: r.data.byLabel ?? "" }), "error");
  else toast(t("papp.addrInvalid"), "error");
}

// ---- removing ----

async function removeGrownUp(id, name) {
  if (!window.confirm(t("papp.gupRemoveConfirm", { name }))) return;
  const r = await call("DELETE", `/api/family/members/${id}`);
  if (r.status !== 200) { toast(t("papp.gupNotAllowed"), "error"); return; }
  toast(t("papp.gupRemoved", { name }), "success");
  state.grownUps = undefined;
  loadGrownUps();
}

async function cancelInvite(id) {
  await call("DELETE", `/api/family/members/invite/${id}`);
  toast(t("papp.gupInviteDone"), "success");
  state.grownUps = undefined;
  loadGrownUps();
}

/** Wire the card's buttons. Called from views.settings after it writes its innerHTML. */
export function wireGrownUps(el) {
  const invite = $("gup-invite");
  if (invite) invite.onclick = inviteSheet;
  const myWallet = $("gup-my-wallet");
  if (myWallet) myWallet.onclick = useMyWallet;
  el.querySelectorAll("[data-gup-remove]").forEach((b) => {
    b.onclick = () => removeGrownUp(b.dataset.gupRemove, b.dataset.gupName);
  });
  el.querySelectorAll("[data-gup-cancel]").forEach((b) => {
    b.onclick = () => cancelInvite(b.dataset.gupCancel);
  });
}

// ---- who is paying, on an approval card ----

/**
 * The payer line under an approval's amount.
 *
 * Three states, and the third is the one worth the code: an intent already claimed by SOMEBODY
 * ELSE. Their wallet is the only one that can sign those bytes (the server pinned the sender
 * when it minted them, and payout-sign.js refuses a mismatch before the Hub opens), so a card
 * that just said "Approve" would send this parent into a wallet that declines with no
 * explanation they could act on.
 *
 * Silent under server custody and on an older server: there is no "whose wallet" question when
 * every payout leaves the same shared one.
 */
export function payerLine(approval) {
  if (state.overview?.custody?.kidCustody !== "parent") return "";
  const mine = me();
  if (!mine) return "";
  const claimedBy = approval?.payerLabel ?? null;
  if (claimedBy && approval?.payerMemberId && approval.payerMemberId !== mine.id) {
    return `<div class="gup-payer gup-payer--other">${t("papp.gupPayingOther", { name: claimedBy })}
      <i>${t("papp.gupPayingOtherSub")}</i></div>`;
  }
  return mine.address
    ? `<div class="gup-payer">${t("papp.gupPayingYou")}</div>`
    : `<div class="gup-payer">${t("papp.gupPayingOwner", { name: ownerLabel() })}</div>`;
}
