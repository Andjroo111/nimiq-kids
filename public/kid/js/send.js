// nimiq.kids kid app v2 — SEND (mirrors the wallet send flow, kid-sized).
// Recipient picker = the family as identicons (siblings + parent, real addresses);
// family sends execute immediately. "Send to a friend" = the cashlink path, which
// needs a grown-up's OK first (parent approval queue) — shown honestly as pending.

import {
  state, $, esc, t, setScreen, toast, bgFor, fmtNimLuna,
  identiconImg, paintIdenticons,
} from "./util.js";
import { api } from "./api.js";
import { icon, arrowIcon, checkIcon, nqCloseIcon, scanIcon } from "./icons.js";
import { refreshWallet } from "./data.js";
import { showMoney } from "./money.js";
import { showAmountScreen } from "./pad.js";
import { showScan } from "./scan.js";

/** Step 1: who gets it? */
export function showSend() {
  const kid = state.child;
  if (!kid) return showMoney();
  const bg = bgFor();
  const siblings = state.children.filter((c) => c.id !== kid.id);
  const parentLabel = state.family?.parent_label || "Mom";

  // The wallet's Send Transaction sheet, built from the REGISTRY components it
  // is actually made of -- small-page + page-header + page-body + page-footer +
  // close-button (nq add) -- not a lookalike panel. Reference:
  // wallet-app/logged-in/send-transaction-enter-address-mobile.png.
  //
  // What that reference actually establishes, beyond where the title sits:
  //   • it is a MODAL SHEET over the dimmed page, anchored to the bottom. It is
  //     not a card floating in the middle of the page behind it.
  //   • the header carries a back arrow LEFT and a close X RIGHT. Back steps up
  //     the flow, X abandons it. Ours only ever had back, so a kid two screens
  //     deep had no way out but to retrace.
  //   • recipients are a ROW of bare identicons with a name under each.
  //   • the Cashlink is the FOOTER's secondary action under a quiet prompt
  //     ("Address unavailable?" / "Create a Cashlink"), with the scan glyph
  //     beside it. Here that is "Send to a friend", which mints exactly that.
  // The registry rem values are used as-is: this app loads legacy nimiq-style,
  // so html is already 8px and 52.5rem really is 420px.
  setScreen(`
    <div class="k-send k-sheet-screen">
      <div class="k-sheet-scrim"></div>
      <div class="small-page nq-card k-sheet">
        <div class="page-header nq-card-header">
          <div class="k-sheet-bar">
            <a class="page-header-back-button" id="send-back" title="${esc(t("app.back"))}">${arrowIcon("left")}</a>
            <h1 class="nq-h1">${esc(t("app.kidSendMoney"))}</h1>
            <button class="close-button nq-button-s" id="send-close" aria-label="${esc(t("app.close"))}">${nqCloseIcon()}</button>
          </div>
        </div>
        <div class="page-body nq-card-body">
          <div class="k-peers">
            ${siblings.map((c) => `
              <button class="k-peer" data-kid="${c.id}">
                ${identiconImg(state.addresses[c.id] ?? "")}
                <span class="k-peer-name">${esc(c.label)}</span>
              </button>`).join("")}
            <button class="k-peer" id="send-parent">
              ${identiconImg(state.family?.parent_address ?? "")}
              <span class="k-peer-name">${esc(parentLabel)}</span>
            </button>
          </div>
          <p class="k-enter-label">${esc(t("app.kidEnterAddress"))}</p>
          <div class="address-input display-as-nim-address k-address-input">
            <textarea id="send-address" spellcheck="false" autocomplete="off"
              autocapitalize="characters" inputmode="text" placeholder="NQ"></textarea>
            <svg width="210" height="99" viewBox="0 0 210 99" stroke-width="1.5"
              stroke-linecap="round" fill="none" xmlns="http://www.w3.org/2000/svg" class="grid">
              <line x1="0.75" y1="30.25" x2="209.25" y2="30.25"/>
              <line x1="0.75" y1="68.25" x2="209.25" y2="68.25"/>
              <g>
                <line x1="67.75" y1="0.75" x2="67.75" y2="22.25"/>
                <line x1="143.75" y1="0.75" x2="143.75" y2="22.25"/>
                <line x1="67.75" y1="37.75" x2="67.75" y2="60.25"/>
                <line x1="143.75" y1="37.75" x2="143.75" y2="60.25"/>
                <line x1="67.75" y1="75.75" x2="67.75" y2="98.25"/>
                <line x1="143.75" y1="75.75" x2="143.75" y2="98.25"/>
              </g>
            </svg>
          </div>
        </div>
        <div class="page-footer nq-card-footer">
          <p class="k-sheet-prompt">${esc(t("app.kidNoOneHere"))}</p>
          <div class="k-sheet-foot k-send-foot">
            <button class="k-cashlink-btn" id="send-friend">
              <span>${esc(t("app.sendToFriend"))}</span>
            </button>
            <button class="k-send-scan" id="send-scan" aria-label="${esc(t("app.kidScanTitle"))}">${scanIcon()}</button>
          </div>
        </div>
      </div>
    </div>`, "k-screen send-screen", bg);

  paintIdenticons();
  $("send-back").onclick = showMoney;
  $("send-close").onclick = showMoney;
  $("send-scan").onclick = () => { void showScan(); };
  document.querySelectorAll(".k-peer[data-kid]").forEach((b) => {
    b.onclick = () => {
      const target = state.children.find((c) => c.id === b.dataset.kid);
      if (target) pickAmount({ toChildId: target.id }, target.label, state.addresses[target.id]);
    };
  });
  $("send-parent").onclick = () => pickAmount({ toParent: true }, parentLabel, state.family?.parent_address);
  $("send-friend").onclick = () => pickAmount({ cashlink: true }, t("app.sendToFriend"), null);
  wireAddressInput($("send-address"));
}

/** The registry's address-input ships as a static visual; the live formatting is
 *  the host app's job. Format on every keystroke into the wallet's shape: three
 *  lines of three four-character blocks, uppercase, `nimiq:` prefix tolerated so
 *  a pasted link works. The caret is put back at the end because rewriting
 *  .value collapses it to position 0 and typing then runs backwards.
 *
 *  A complete address goes straight on to the amount step. That is deliberate
 *  and it is NOT a straight-to-send path: it lands in api.sendScanned, the same
 *  parent approval queue a scanned code uses, because a destination the app
 *  cannot vouch for always needs a grown-up's OK. */
function wireAddressInput(el) {
  if (!el) return;
  // The prefix has to be stripped AFTER the punctuation, not before it. Typing
  // fires input per character, so by the time the ":" arrives the field already
  // reads "NIMIQ" and a `^nimiq:` test never matches -- it only ever worked on a
  // whole-string paste. A NIM address is NQ + 34, so a buffer opening "NIMIQ"
  // is unambiguously the prefix and never the address itself.
  const format = (raw) => {
    const bare = raw.replace(/[^0-9a-z]/gi, "").toUpperCase()
      .replace(/^NIMIQ/, "").slice(0, 36);
    const blocks = bare.match(/.{1,4}/g) ?? [];
    return blocks.map((b, i) => b + (i % 3 === 2 ? "\n" : " ")).join("").trimEnd();
  };
  el.addEventListener("input", () => {
    el.value = format(el.value);
    el.setSelectionRange(el.value.length, el.value.length);
    const bare = el.value.replace(/\s+/g, "");
    el.classList.toggle("is-ready", /^NQ[0-9A-Z]{34}$/.test(bare));
    if (/^NQ[0-9A-Z]{34}$/.test(bare)) {
      el.blur();
      pickAmount({ scannedAddress: bare }, shortAddress(bare), bare);
    }
  });
}

/** A 36-character address is not a name. Show the first block so the amount
 *  screen still says WHERE the money is going. */
const shortAddress = (bare) => `${bare.slice(0, 4)}…${bare.slice(-4)}`;

/** Step 2: how much? (shared amount sheet)
 *
 *  The route row is the wallet's, from shots/wallet-ref/send-amount.png: the
 *  SENDER on the left, the recipient on the right, a hairline connector
 *  between them. This screen used to show the recipient alone, so nothing on it
 *  said who the money was leaving -- which for a kid choosing between their own
 *  balance and a sibling's is the more confusable half.
 *
 *  The wallet labels its right-hand side with the raw address because it has no
 *  name for a new contact. Here the family DOES have names, so the name is the
 *  label and the identicon carries the address, which is the same information a
 *  kid can actually read. */
function pickAmount(target, name, address) {
  const max = state.wallet?.balanceLuna ?? 0;
  const kid = state.child;
  const from = state.wallet?.address ?? state.addresses[kid.id] ?? "";
  showAmountScreen({
    title: t("app.kidHowMuch"),
    cta: t("app.kidSendIt"),
    maxLuna: max,
    headerHtml: `
      <div class="k-send-route">
        <span class="k-route-end">
          ${identiconImg(from, "k-route-icon")}
          <span class="k-route-name">${esc(kid.label)}</span>
        </span>
        <span class="k-route-link" aria-hidden="true"></span>
        <span class="k-route-end">
          ${address ? identiconImg(address, "k-route-icon") : icon("paper-plane", "k-route-icon k-contact-plane")}
          <span class="k-route-name">${esc(name)}</span>
        </span>
      </div>`,
    onBack: showSend,
    onClose: showMoney,
    onConfirm: (valueLuna) => doSend(target, name, valueLuna),
  });
  paintIdenticons();
}

/** Step 3: send it (family = instant, friend = cashlink pending grown-up OK). */
async function doSend(target, name, valueLuna) {
  const kid = state.child;
  // A typed address takes the SAME road as a scanned one: the parent approval
  // queue, never a direct transfer.
  if (target.scannedAddress) {
    const res = await api.sendScanned(kid.id, target.scannedAddress, valueLuna)
      .catch(() => ({ error: "network" }));
    if (res?.error) {
      toast(res.error === "insufficient_funds" ? t("app.kidNotEnough")
        : res.error === "invalid_address" ? t("app.kidBadAddress") : t("app.errGeneric"));
      return showSend();
    }
    await refreshWallet();
    return showResult(false, esc(t("app.kidNeedsOk")));
  }
  const body = target.cashlink ? { cashlink: { valueLuna } } : { ...target, valueLuna };
  const res = await api.sendNim(kid.id, body).catch(() => ({ error: "network" }));

  if (res.status === "sent") {
    await refreshWallet();
    return showResult(true, `${esc(t("app.kidSent"))}`);
  }
  if (res.status === "pending_approval") {
    return showResult(false, esc(t("app.kidNeedsOk")));
  }
  toast(res.error === "insufficient_funds" ? t("app.kidNotEnough") : t("app.errGeneric"));
  showSend();
}

/** Full-screen status (status-screen pattern: green success / navy waiting).
 *  Exported: grow.js shows the same "needs a grown-up's OK" screen for queued staking. */
export function showResult(success, message) {
  setScreen(`
    <div class="status-screen k-status">
      <div class="wrapper ${success ? "success nq-green-bg" : "nq-blue-bg"}">
        <div class="spacer"></div>
        <div class="icon-row">
          ${success ? checkIcon("k-status-icon") : icon("safe-lock", "k-status-icon k-status-duo")}
          <h1 class="title nq-h1">${message}</h1>
        </div>
        <div class="spacer"></div>
      </div>
    </div>`, "k-screen k-status-screen");
  setTimeout(async () => { await refreshWallet(); showMoney(); }, success ? 1600 : 2600);
}
