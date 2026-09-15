// nimiq.kids kid app v2 — the shared amount screen. Used by Send and by Grow
// (stake / unstake). Decimals are capped at 2 (kid-friendly; luna precision
// stays server-side).
//
// This is the wallet's SET AMOUNT screen, kid-sized. Reference:
// shots/wallet-ref/send-amount.png, captured from the live testnet wallet
// because the branding-cli's own gaps list says the set has no amount screen
// ("Send flow step 2+: amount entry screen ... we only have the address-entry
// modal"). What that capture settles, all of which this screen had wrong:
//
//   • It is a modal SHEET over the dimmed page, exactly like Send step 1 --
//     which this app already builds correctly. Step 2 used to drop the kid back
//     onto the bare scene, so the flow broke its own idiom halfway through and
//     the figures had nothing behind them. The kid's background is not lost:
//     the sheet sits over it, which is what the wallet does with the wallet.
//   • The amount is the registry's `amount-input`: a BOXED value with the
//     ticker beside it and the fiat underneath -- not a 96px bare numeral. The
//     component is grey until there is a value (`has-value`), which is the
//     whole placeholder-vs-entry signal.
//   • The sender and the recipient BOTH appear, as two identicons either side
//     of a connector. Ours showed the recipient alone, so nothing on screen
//     said who the money was leaving.
//   • The primary action lives in the footer and is disabled until the amount
//     is valid.
//
// Deliberately NOT copied: the wallet types into the field with a system
// keyboard. A kid on a tablet gets the big pad instead, and it drives the same
// component. The wallet's "Add a public message" is also skipped -- this app
// has no message concept.

import { $, esc, t, setScreen, bgFor, fmtNimLuna, fmtFiat, LUNA } from "./util.js";
import { arrowIcon, deleteIcon, nqCloseIcon } from "./icons.js";

/** The component's `maxFontSize` prop, READ OFF THE COMPONENT instead of
 *  hardcoded. It has to match the font-size on `.amount-input` itself, because
 *  the fit measures the hidden width-finder spans at that size and then applies
 *  the result to the input: a hardcoded 11 against a root of 8rem measured at
 *  one size and painted at another, so the box came out ~27% narrow and "125"
 *  rendered clipped. Deriving it lets CSS scale the value with the viewport --
 *  which it now does, so a short phone still fits the pad -- and makes it
 *  impossible for the two to drift apart again. */
const maxFontRem = (wrap) => {
  const px = parseFloat(getComputedStyle(wrap).fontSize);
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 8;
  return px / root;
};

/**
 * opts: { title, cta, maxLuna, minLuna?, availLabel, onBack(), onConfirm(valueLuna),
 *         headerHtml?, onClose? }
 *
 * `minLuna` is a hard chain floor (staking: 100 NIM), not a preference. Enforced at the
 * keypad so the kid is stopped while the number is still on screen and editable.
 */
export function showAmountScreen(opts) {
  const bg = bgFor();
  let raw = "0";

  setScreen(`
    <div class="k-pad-screen k-sheet-screen">
      <div class="k-sheet-scrim"></div>
      <div class="small-page nq-card k-sheet">
        <div class="page-header nq-card-header">
          <div class="k-sheet-bar">
            <a class="page-header-back-button" id="pad-back" title="${esc(t("app.back"))}">${arrowIcon("left")}</a>
            <h1 class="nq-h1">${esc(opts.title)}</h1>
            <button class="close-button nq-button-s" id="pad-close" aria-label="${esc(t("app.close"))}">${nqCloseIcon()}</button>
          </div>
        </div>
        <div class="page-body nq-card-body">
          ${opts.headerHtml ?? ""}
          <!-- registry amount-input: the width-finder spans are what let the
               value's font shrink instead of overflowing. Keep .width-value in
               sync with the input on every keystroke or the fit is stale. -->
          <div class="amount-input k-amount-input">
            <form class="label-input">
              <span class="width-finder width-placeholder">0</span>
              <div class="full-width">Width</div>
              <span class="width-finder width-value" id="pad-width">0</span>
              <input type="text" inputmode="none" readonly class="nq-input" id="pad-value"
                placeholder="0" value="" aria-label="${esc(opts.title)}" />
            </form>
            <span class="nim">NIM</span>
          </div>
          <div class="k-amount-fiat" id="pad-fiat">${fmtFiat(0)}</div>
          <div class="k-amount-avail">${esc(opts.availLabel ?? t("app.kidYouHave", { amount: fmtNimLuna(opts.maxLuna) }))}</div>
          <div class="k-amount-hint" id="pad-hint" hidden></div>
        </div>
        <!-- The pad lives in the FOOTER with the action, not in the body. The
             body is the registry's scrolling region, and a pad inside it loses
             its bottom row the moment the content is a little tall: ".", "0"
             and delete were all under the fold at 390 and at 320, reachable
             only by scrolling a surface that does not look scrollable. Keys are
             not content -- they are the instrument. What may scroll is the
             route, the amount and the balance line above them. -->
        <div class="page-footer nq-card-footer">
          <div class="pin-grid k-pad-grid" id="pad-grid">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join("")}
            <button data-k=".">.</button><button data-k="0">0</button><button data-k="del">${deleteIcon()}</button>
          </div>
          <button class="mega-btn blue" id="pad-go" disabled>${esc(opts.cta)}</button>
        </div>
      </div>
    </div>`, "k-screen pad-screen", bg);

  const input = $("pad-value");
  const wrap = input.closest(".amount-input");
  const form = wrap.querySelector(".label-input");
  const fullWidth = form.querySelector(".full-width");
  const widthPlaceholder = form.querySelector(".width-placeholder");
  const widthValue = $("pad-width");

  // The component measures its available width from a 1000px spacer that is IN
  // FLOW, then takes the spacer out of flow. So the class has to come off again
  // before any re-measure: the first pass leaves .full-width absolute, and a
  // second read with it still absolute returns the form's content width (~35px
  // when the field is empty) instead of the space available. That is what
  // crushed "125" to 27px -- the fit was dividing by a phantom.
  let maxWidth = 0;
  const measure = () => {
    fullWidth.classList.remove("width-finder");
    maxWidth = form.offsetWidth;
    fullWidth.classList.add("width-finder");
  };

  const valueLuna = () => Math.round(Number(raw) * LUNA);

  /** The registry's fit, verbatim in behaviour: shrink the font only once the
   *  value would overflow, and size the box to the value (or to the
   *  placeholder while empty) so the ticker sits right beside the digits. */
  const fit = () => {
    measure();
    widthValue.textContent = raw;
    const placeholderWidth = widthPlaceholder.offsetWidth;
    const valueWidth = widthValue.offsetWidth;
    const maxRem = maxFontRem(wrap);
    const factor = Math.min(1, Math.max(maxWidth / (valueWidth || 1), 1 / maxRem));
    const empty = raw === "0";
    input.style.width = (empty ? placeholderWidth : (factor === 1 ? valueWidth : maxWidth)) + "px";
    input.style.fontSize = factor * maxRem + "rem";
  };

  const paint = () => {
    // The zero a kid sees before typing is the PLACEHOLDER, not a value. That is
    // how the wallet's own screen renders it: `.nq-input` hardcodes
    // `color: var(--nimiq-blue)`, so a real "0" is navy and reads as an entered
    // amount, while `::placeholder` is the 50% grey the reference actually
    // shows. Setting value="" is the component's contract, not a workaround --
    // `.width-placeholder` exists precisely to size the box in this state.
    input.value = raw === "0" ? "" : raw;
    // `has-value` is the component's placeholder-vs-entry signal.
    wrap.classList.toggle("has-value", raw !== "0");
    fit();
    $("pad-fiat").textContent = fmtFiat(valueLuna());
    const v = valueLuna();
    // `minLuna` is a CHAIN floor, not a preference: Albatross refuses a stake under
    // 100 NIM outright. Enforcing it here means the kid is stopped at the keypad,
    // where the number is still on screen and editable, instead of tapping Grow and
    // being bounced back to the start with a generic error and their entry lost.
    const min = opts.minLuna ?? 0;
    $("pad-go").disabled = !(v > 0 && v <= opts.maxLuna && v >= min);
    const hint = $("pad-hint");
    if (hint) {
      const short = min > 0 && v > 0 && v < min;
      hint.textContent = short ? t("app.kidMinStake", { amount: fmtNimLuna(min) }) : "";
      hint.hidden = !short;
    }
  };

  $("pad-back").onclick = opts.onBack;
  $("pad-close").onclick = opts.onClose ?? opts.onBack;
  $("pad-grid").querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.k;
      if (k === "del") raw = raw.length > 1 ? raw.slice(0, -1) : "0";
      else if (k === ".") { if (!raw.includes(".")) raw += "."; }
      else {
        const [, dec] = raw.split(".");
        if (dec !== undefined && dec.length >= 2) return; // 2 decimals max
        raw = raw === "0" ? k : raw + k;
        if (raw.length > 9) raw = raw.slice(0, 9);
      }
      paint();
    };
  });
  // A real transaction takes ~6s to broadcast and another few to reconcile. The old
  // handler disabled the button and fired a non-awaited async call, so for 6-9s the kid
  // stared at an unchanged keypad with a greyed button while their NIM was already
  // moving on chain (measured: tap +8.1s, "Sent!" +17.5s). Say that it is happening,
  // and lock the keys so the number cannot drift under a request already in flight.
  $("pad-go").onclick = async () => {
    const go = $("pad-go");
    if (go.disabled) return;
    go.disabled = true;
    go.classList.add("is-working");
    go.textContent = t("app.kidSending");
    $("pad-grid").querySelectorAll("button").forEach((b) => { b.disabled = true; });
    const hint = $("pad-hint");
    if (hint) { hint.hidden = false; hint.textContent = t("app.kidSendingHint"); }
    try {
      await opts.onConfirm(valueLuna());
    } finally {
      // onConfirm usually navigates away; if it did not, hand the screen back rather
      // than leaving a dead button behind.
      if (document.body.contains(go)) {
        go.classList.remove("is-working");
        go.textContent = opts.cta;
        $("pad-grid").querySelectorAll("button").forEach((b) => { b.disabled = false; });
        if (hint) { hint.hidden = true; hint.textContent = ""; }
        paint();
      }
    }
  };
  paint();
  // Web fonts land after the first paint and change every measurement the fit
  // depends on, so re-run once they are ready. Without this the box is sized
  // from the fallback font's metrics and the ticker sits adrift.
  if (document.fonts?.ready) document.fonts.ready.then(fit);
}
