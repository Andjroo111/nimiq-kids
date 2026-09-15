// nimiq.kids kid app v2 — RECEIVE (mirrors wallet receive-nim-address: big
// identicon, 3x3 Fira Mono address grid, QR of the kid's REAL address) plus a
// kid-sized "show this to a grown-up" hint.

import { state, $, esc, t, setScreen, bgFor, chunkAddress, identiconImg, paintIdenticons } from "./util.js";
import { arrowIcon, nqCloseIcon, scanIcon } from "./icons.js";
import { showMoney } from "./money.js";

/** The wallet's own QR on this screen is flat NAVY, not the registry's default
 *  light-blue radial. Verified against the captured reference. */
const NIMIQ_QR_NAVY = "#1F2348";

export function showReceive() {
  const kid = state.child;
  if (!kid) return showMoney();
  const bg = bgFor();
  const address = state.wallet?.address ?? "";
  // Without an address this sheet used to render anyway: an empty identicon, a blank
  // address grid, and — worst of all — a perfectly scannable QR encoding the literal
  // string "nimiq:", captioned "Scan this code to send NIM to <kid>". A grown-up would
  // scan it and their wallet would open with no recipient. A screen that cannot do its
  // one job must not pretend it can, so bounce back to the money screen (which now
  // shows the honest unreachable state) rather than draw a convincing lie.
  if (!address) return showMoney();
  const chunks = chunkAddress(address);

  // The wallet's Receive NIM sheet, from the same registry components as Send
  // (small-page + page-header + page-body + page-footer + close-button), so the
  // two screens are one flow rather than two designs. Reference:
  // wallet-app/logged-in/receive-nim-address-mobile.png, which establishes the
  // order: title, one grey instruction line, the identicon, the address grid,
  // then the action in the footer. Back steps up, X abandons.
  //
  // The kid version keeps the QR large where the wallet keeps it as a corner
  // toggle: a grown-up scanning the code IS this screen's whole purpose, and a
  // kid cannot read a chunked address aloud.
  setScreen(`
    <div class="k-receive k-sheet-screen">
      <div class="k-sheet-scrim"></div>
      <div class="small-page nq-card k-sheet k-receive-card">
        <div class="page-header nq-card-header">
          <div class="k-sheet-bar">
            <a class="page-header-back-button" id="rcv-back" title="${esc(t("app.back"))}">${arrowIcon("left")}</a>
            <h1 class="nq-h1">${esc(t("app.kidReceive"))}</h1>
            <button class="close-button nq-button-s" id="rcv-close" aria-label="${esc(t("app.close"))}">${nqCloseIcon()}</button>
          </div>
          <p class="k-sheet-sub">${esc(t("app.kidShareWithFriend"))}</p>
        </div>
        <div class="page-body nq-card-body">
          ${identiconImg(address, "k-receive-identicon")}
          <div class="k-receive-name">${esc(kid.label)}</div>
          <div class="address-display format-nimiq copyable k-address" id="rcv-copy"
            tabindex="0" role="button" aria-label="${esc(t("app.kidCopyAddress"))}">
            <div class="background"></div>
            ${chunks.map((c) => `<span class="chunk">${esc(c)}<span class="space">&nbsp;</span></span>`).join("")}
            <div class="tooltip">${esc(t("app.kidCopied"))}</div>
          </div>
        </div>
        <div class="page-footer nq-card-footer">
          <div class="k-sheet-foot">
            <button class="k-send-scan" id="rcv-qr-toggle"
              aria-label="${esc(t("app.kidShowQr"))}">${scanIcon()}</button>
          </div>
        </div>
      </div>
    </div>`, "k-screen receive-screen", bg);

  paintIdenticons();
  $("rcv-back").onclick = showMoney;
  $("rcv-close").onclick = showMoney;
  $("rcv-qr-toggle").onclick = () => showQrSheet(kid, address);
  wireCopy($("rcv-copy"), address);
}

/** Tap the address to copy it, the way the wallet does.
 *
 *  This is the registry's `copyable` (nq add): the element tints light-blue and
 *  floats a "Copied" tooltip for 800ms. That IS the wallet's feedback here, so
 *  there is no bottom toast -- the confirmation appears on the thing you tapped.
 *
 *  Two departures from the component's demo script, both deliberate:
 *   • the text comes from the address we already hold, not from innerText. The
 *     grid's chunks carry zero-width .space spans and render across three lines,
 *     so scraping the DOM would copy line breaks into the middle of an address.
 *   • "Copied" only shows if the write actually resolved. A clipboard call can
 *     be refused outright inside a wallet webview, and claiming success there
 *     would be worse than staying quiet. */
function wireCopy(el, address) {
  if (!el) return;
  const plain = address.replace(/\s+/g, "");
  let reset = 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plain);
    } catch {
      return; // refused: say nothing rather than claim it worked
    }
    el.classList.add("copied");
    clearTimeout(reset);
    reset = setTimeout(() => el.classList.remove("copied"), 800);
  };
  el.onclick = () => { void copy(); };
  el.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void copy(); }
  };
}

/** The wallet's "NIM Address" sheet, which the Receive corner glyph OPENS.
 *
 *  Reference: shots/wallet-ref/receive-qr-view.png, captured from the live
 *  testnet wallet because the skill's set has no shot of this screen. It is a
 *  screen of its own, not a swap inside Receive, and the differences are the
 *  whole point:
 *    • its own title, "NIM Address", and only an X. No back arrow: it is a peek,
 *      not a step, so there is nothing to step back through.
 *    • the QR is NAVY, not the light-blue gradient the registry defaults to.
 *    • the address is ONE truncated line with a ••• middle, not the 3x3 grid.
 *      The grid is for reading a whole address; here the QR carries it and the
 *      line is only confirmation you are looking at the right one.
 *    • the instruction under it is light blue, and it is the only blue on the
 *      sheet -- the one calculated break. */
function showQrSheet(kid, address) {
  const chunks = chunkAddress(address);
  const short = `${chunks.slice(0, 3).join(" ")} ••• ${chunks.slice(-3).join(" ")}`;
  setScreen(`
    <div class="k-receive k-sheet-screen">
      <div class="k-sheet-scrim"></div>
      <div class="small-page nq-card k-sheet k-qr-sheet">
        <div class="page-header nq-card-header">
          <div class="k-sheet-bar">
            <h1 class="nq-h1">${esc(t("app.kidNimAddress"))}</h1>
            <button class="close-button nq-button-s" id="qr-close" aria-label="${esc(t("app.close"))}">${nqCloseIcon()}</button>
          </div>
        </div>
        <div class="page-body nq-card-body">
          <canvas class="qr-code k-qr" id="qr-canvas"></canvas>
          <p class="k-qr-address">${esc(short)}</p>
        </div>
        <div class="page-footer nq-card-footer">
          <p class="k-qr-hint">${esc(t("app.kidScanToSend", { name: kid.label }))}</p>
        </div>
      </div>
    </div>`, "k-screen receive-screen", bgFor());

  $("qr-close").onclick = () => showReceive();
  try {
    QrCreator.render({
      text: `nimiq:${address.replace(/\s/g, "")}`,
      radius: 0.5, ecLevel: "M", fill: NIMIQ_QR_NAVY, background: null, size: 640,
    }, $("qr-canvas"));
  } catch { /* QR lib missing: the truncated address still identifies the account */ }
}
