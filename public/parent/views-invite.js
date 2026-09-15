// nimiq.kids parent — invite a family: a home-screen row + share sheet. The link
// carries the family's referral code (attribution now, both-sides bonus in a
// later slice — docs/ROADMAP.md). navigator.share where the WebView offers
// it, copy-to-clipboard with a visible confirmation everywhere else.

import { t, call, toast, openSheet, closeSheet, $ } from "./core.js";
import { icon, duotone } from "./icons.js";
import { esc } from "./fmt.js";
import { juice } from "./juice.js";

let invite = null; // { code, shareUrl, accepted } — fetched once, then cached

export function inviteCard() {
  return `<div class="group">
    <button class="row" id="go-invite">
      <span class="hex-tile">${duotone("duotone-paper-plane", 22)}</span>
      <span class="row-main">
        <span class="row-label">${t("papp.inviteTitle")}</span>
        ${invite?.accepted ? `<span class="row-sub">${t("papp.inviteCount", { count: invite.accepted })}</span>` : ""}
      </span>
      <span class="chev">${icon("chevron-right", 14)}</span>
    </button>
  </div>`;
}

export function wireInviteCard(root) {
  root.querySelector("#go-invite")?.addEventListener("click", sheetInvite);
  if (!invite) loadInvite(); // warm the cache so the count shows on the next paint
}

async function loadInvite() {
  try {
    const r = await call("GET", "/api/family/invite");
    if (r.status === 200) invite = r.data;
  } catch { /* offline — the sheet retries on open */ }
  return invite;
}

async function sheetInvite() {
  if (!invite) await loadInvite();
  if (!invite) { toast(t("papp.didntGoThrough"), "error"); return; }
  openSheet(`<h2>${t("papp.inviteTitle")}</h2>
    <div class="sub">${t("papp.inviteSub")}</div>
    <button class="copy-link" id="inv-url">${esc(invite.shareUrl)}</button>
    <button class="pill-btn blue wide" id="inv-share">${icon("arrow-from-bottom", 14)} ${t("papp.inviteShare")}</button>`);
  $("inv-url").onclick = copyInvite;
  $("inv-share").onclick = shareInvite;
}

function copyInvite() {
  navigator.clipboard?.writeText(invite.shareUrl).catch(() => {});
  juice("inviteSent");
  toast(t("papp.inviteCopied"), "success");
}

async function shareInvite() {
  if (navigator.share) {
    try {
      await navigator.share({ title: "NIMIQ.kids", url: invite.shareUrl });
    } catch {
      return; // share sheet dismissed — a normal outcome, not an error
    }
    juice("inviteSent");
    closeSheet();
    toast(t("papp.inviteSentToast"), "success");
    return;
  }
  copyInvite(); // no Web Share here (desktop, some WebViews) — copy instead
}
