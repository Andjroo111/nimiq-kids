// nimiq.kids kid app v3 — MY MONEY: the real Nimiq wallet's account screen, kid-sized.
//
// Fiat leads (a kid reads dollars, not 80 480.95 NIM), the balance sits on its own
// white card so it stays readable over whatever scene the kid picked, every feed row
// carries a real identicon, and the bottom bar is Receive | Send | scan, which is the
// real wallet's bar exactly (references/.../home-overview-mobile.png).
//
// Grow is the green pill on the name row, which is where the real wallet puts Stake
// (references/screenshots/wallet-app/logged-in/nim-address-overview-mobile.png) —
// bottom bar for moving money, header pill for staking it. It is NOT a third dock
// button; that was the thing being fixed.
//
// The address is deliberately absent. A kid has no use for 36 characters, and it
// costs a line of the card; Receive shows it where it is actually needed, as the
// 3x3 Fira Mono grid with a QR (Andjroo, 2026-07-30).

import {
  state, $, esc, t, setScreen, bgFor, fmtNimLuna, fmtFiat, fmtNimPrice, spacedAddress,
  identiconImg, paintIdenticons, feedDate,
} from "./util.js";
import { arrowIcon, plantIcon, waitIcon, scanIcon, hexIcon } from "./icons.js";
import { showsGrowBanner } from "./grow-gate.js";
import { refreshWallet } from "./data.js";
import { showChart } from "./chart.js";
import { showSend } from "./send.js";
import { showReceive } from "./receive.js";
import { showGrow } from "./grow.js";
import { celebrateIfJustReached, thermometer, wireThermometer } from "./thermo.js";
import { showScan } from "./scan.js";

let pollTimer = 0;
export function stopMoneyPoll() { clearInterval(pollTimer); pollTimer = 0; }

/** Kid-friendly one-liner for a feed row. */
function rowLabel(e) {
  if (e.kind === "reward") return t("app.kidEarnedLine", { amount: fmtNimLuna(Math.abs(e.valueLuna)) });
  return e.counterpartyLabel || (e.kind === "earn" ? t("app.kidEarn") : spacedAddress(e.counterpartyAddress ?? ""));
}

function feedRow(e) {
  const d = feedDate(e.createdAt);
  const incoming = e.valueLuna > 0;
  const pending = e.status === "pending";
  const staky = e.kind === "stake" || e.kind === "unstake" || e.kind === "reward";
  // Lead tile mirrors the real wallet: the counterparty's own identicon. Staking is
  // the one row with no counterparty (the money moves to a validator, not a person),
  // so it keeps the plant tile; an address-less transfer still falls back to arrows.
  const avatar = staky
    ? `<div class="identicon k-stake-tile">${plantIcon()}</div>`
    : e.counterpartyAddress
      ? identiconImg(e.counterpartyAddress)
      : `<div class="identicon k-arrow-tile">${arrowIcon(incoming ? "down" : "up")}</div>`;
  const sub = pending && e.availableAt
    ? `${t("app.kidComingBack", { amount: fmtNimLuna(Math.abs(e.valueLuna)) })}`
    : `${d.time}${e.message && e.message !== e.counterpartyLabel ? ` · ${esc(e.message)}` : ""}`;
  // A row carries its transaction hash, so tapping it opens the public block explorer.
  // That is the whole proof the app is not pretending: the payout a kid just watched land
  // is a row on a chain anyone can go and read. Pending rows link too — the hash is
  // broadcast and the explorer is the authority on what happened to it, and a freshly
  // seeded family is entirely pending, which is exactly when a visitor wants to look.
  // Only a proven-failed row has nothing to show; SIM hashes are invented.
  const receipt = e.status !== "failed" && e.txHash && state.explorerTx ? e.txHash : "";
  return `
    <button class="transaction confirmed ${pending ? "k-pending" : ""}${receipt ? " k-receipt" : ""}"
      ${receipt ? `data-tx="${esc(receipt)}" title="${esc(t("app.kidSeeReceipt"))}"` : ""}>
      <div class="date"><span class="day">${d.day}</span><br><span class="month">${d.month}</span></div>
      ${avatar}
      <div class="data">
        <div class="label">${esc(rowLabel(e))}${pending ? ` <span class="k-row-wait">${waitIcon()}</span>` : ""}</div>
        <div class="time-and-message"><span>${sub}</span></div>
      </div>
      <div class="amounts ${incoming ? "isIncoming" : ""}">
        <span class="amount">${fmtNimLuna(Math.abs(e.valueLuna))} <span class="currency nim">NIM</span></span>
        <div class="fiat-amount">${fmtFiat(e.valueLuna)}</div>
      </div>
    </button>`;
}

function feed(events) {
  if (!events.length) {
    // The egg that sat here left on 2026-09-15 (Andjroo: "there is an egg on there, we can take that
    // out"). Money is a hexagon (nimiq-ui rule 22), at the same step and tint as the board's high-five.
    return `<div class="k-feed-empty">${hexIcon("k-feed-empty-ic")}<p>${esc(t("app.kidFeedEmpty"))}</p></div>`;
  }
  const nowLabel = feedDate(Date.now()).monthLabel;
  let lastMonth = "";
  const out = [];
  for (const e of events) {
    const m = feedDate(e.createdAt).monthLabel;
    if (m !== lastMonth) {
      const label = m === nowLabel ? t("app.thisMonth") : m;
      out.push(`<div class="month-label"><label>${esc(label)}</label></div>`);
      lastMonth = m;
    }
    out.push(feedRow(e));
  }
  return out.join("");
}

/** What a coin is worth today. It rides INSIDE the balance card: bare on the scene
 *  it was grey text on whatever sky the kid picked, which is the exact problem the
 *  card exists to solve.
 *
 *  It sits at the card's FOOT, behind a hairline, and that position is the point.
 *  The price of a coin is not part of a kid's balance, so it must not read as a
 *  fourth line of one — in the real wallet this datum is never in the account
 *  header at all, it is its own sidebar block (the price-chart component, whose
 *  default price is a NIM price). Above the line is the kid's money, balance then
 *  what is growing; below it is a fact about the market. The rule is 1px
 *  rgba(31,35,72,.08), the corner control's divider value — Nimiq separates with a
 *  hairline, whitespace, or a separate surface, and nothing else. */
const rateLine = () => `<div class="k-rate">${esc(t("app.kidCoinWorth", { price: fmtNimPrice() }))}</div>`;

/**
 * WHEN THIS NUMBER WAS TRUE, and only when that is not now.
 *
 * A balance with no qualifier is a claim about this second. Offline it is a claim about
 * whenever the tablet last reached the Mini, and a kid who spent NIM in the Treasure Box an
 * hour ago deserves to know which of the two they are reading. It sits with `rateLine` under
 * the card's hairline, where facts ABOUT the money live rather than the money itself.
 *
 * Silent online, so the ordinary screen is unchanged.
 */
function syncLine() {
  if (!state.offline) return "";
  const at = state.syncedAt[`wallet:${state.child?.id}`];
  const copy = at ? t("app.kidMoneySynced", { time: feedDate(at).time }) : t("app.kidMoneyOffline");
  return `<div class="k-rate k-synced">${esc(copy)}</div>`;
}

/** The wallet's account header, kid-sized.
 *
 *  Built on the vendored `account-header` markup so the component's own CSS
 *  applies natively rather than being re-approximated. Reference:
 *  wallet-app/logged-in/nim-address-overview-mobile.png, which the skill calls
 *  "the screen our wallet UIs mirror". Its shape, which this now follows:
 *
 *    identicon | label ............ AMOUNT NIM
 *              | address (faded) ....... $fiat
 *    ------------------------------------------
 *    green staked banner
 *
 *  Two things change from what was here before, both to match it:
 *
 *  NIM is the headline and fiat is the second line. This screen had it the other
 *  way round, and that was right for the wallet's HOME screen (TOTAL BALANCE in
 *  dollars) but this is the ACCOUNT screen, where the wallet leads with NIM and
 *  hangs the fiat under it on the right.
 *
 *  Grow was a pill sitting where the wallet puts the amount, so it had to move.
 *  It becomes the green staked banner the reference has directly under the
 *  header, which is a better home for it anyway: it can carry the staked figure
 *  instead of just being a door.
 *
 *  identiconImg emits its OWN .identicon wrapper — pass the class, never nest
 *  it inside another one. */
/** The Grow door, or nothing. The rule itself lives in grow-gate.js (issue #108). */
function growBanner(w, staked, pct) {
  if (!showsGrowBanner(w)) return "";
  return `
      <button class="k-stake-banner" id="hdr-grow">
        <span class="k-stake-ring">${plantIcon()}</span>
        <span class="k-stake-text">
          <b>${staked > 0
            ? esc(t("app.kidStakedLine", { amount: fmtNimLuna(staked) }))
            : esc(t("app.kidGrow"))}</b>
          <i>${staked > 0 ? `${fmtFiat(staked)} &middot; ${pct}%` : esc(t("app.kidGrowEmpty"))}</i>
        </span>
      </button>`;
}

function balanceCard(kid, w) {
  const staked = w.stakedLuna ?? 0;
  const pct = w.balanceLuna > 0 ? Math.round((staked / w.balanceLuna) * 100) : 0;
  // A kid whose grown-up has not given them an address yet. Real, ordinary, and the first
  // state every kid is in on a parent-custody instance -- so the line that would hold an
  // address says that, instead of leaving a blank where 36 characters usually are. It
  // reads as a fact, not a fault: the money screen is real, there is just nowhere for NIM
  // to arrive yet, and the grown-up is the one who fixes it.
  const addressLine = w.address
    ? `<div class="address">${esc(w.address)}</div>`
    : `<div class="address k-no-address">${esc(t("app.kidNoAddress"))}</div>`;
  return `
    <div class="k-wallet-card">
      <div class="account-header k-acct">
        <div class="active-address flex-row">
          <div class="identicon-wrapper">${identiconImg(w.address, "k-wallet-ic")}</div>
          <div class="meta">
            <div class="flex-row">
              <div class="label">${esc(kid.label)}</div>
              <span class="amount">${fmtNimLuna(w.balanceLuna)} <span class="currency nim">NIM</span></span>
            </div>
            <div class="flex-row">
              ${addressLine}
              <span class="fiat-amount">${fmtFiat(w.balanceLuna)}</span>
            </div>
          </div>
        </div>
      </div>
      ${growBanner(w, staked, pct)}
      ${syncLine()}
      ${rateLine()}
    </div>`;
}

export function showMoney() {
  const kid = state.child;
  if (!kid) return showChart();
  const bg = bgFor();

  // NO WALLET, NO NUMBER. EVER.
  //
  // The old code fell through to a zero-filled wallet here, so an unreachable node was
  // rendered as "0 NIM / No money moves yet. Go earn some NIM!" — with Send and Receive still
  // enabled. A kid holding 109,834 NIM was told their money was gone.
  //
  // ⚠️ THE GUARD IS `!state.wallet` ALONE, not `state.walletError && !state.wallet`. Those
  // two are not the same condition and the difference is the whole bug: a failure that never
  // set `walletError` (a read that threw before it was reached, a boot that got here first)
  // walked straight past it into the zero-filled fallback below. `state.wallet` is null in
  // exactly one situation, no successful read has ever happened on this device for this kid,
  // and there is no honest number to show in it. Since layer 2 that is also rare: a snapshot
  // is loaded at boot, so a tablet that has EVER seen the balance shows the real one with the
  // time it was read.
  if (!state.wallet) {
    setScreen(`
      <div class="k-home k-money k-money-offline">
        <button class="back-btn" id="money-back">${arrowIcon("left")}</button>
        <div class="k-offline">
          <div class="k-offline-emoji" aria-hidden="true">🛰️</div>
          <h1 class="k-page-title">${esc(t("app.walletUnreachableTitle"))}</h1>
          <p class="k-offline-body">${esc(t("app.walletUnreachableBody"))}</p>
          <button class="nq-button light-blue" id="money-retry">${esc(t("app.tryAgain"))}</button>
        </div>
      </div>`, "k-screen money-screen", bg);
    $("money-back").onclick = () => { stopMoneyPoll(); showChart(); };
    $("money-retry").onclick = async () => { await refreshWallet(); showMoney(); };
    return;
  }

  // Never `?? {balanceLuna: 0}`: the guard above is what makes this safe, and re-adding a
  // zero-filled default here would quietly put the bug back.
  const w = state.wallet;

  // No address, no dock. All three of these need one to do anything: Send is refused by the
  // server (`kid_address_not_registered`), Scan is Send with a destination filled in, and
  // Receive already bounces straight back here rather than draw a QR of nothing. A button
  // that cannot work is a worse answer than a button that says it cannot.
  const noAddress = !w.address;
  const off = noAddress ? " disabled" : "";

  setScreen(`
    <div class="k-home k-money">
      <button class="back-btn" id="money-back">${arrowIcon("left")}</button>
      <!-- THE SLAB, the same surface the board sits on (scene.css). The back button stays
           OUTSIDE it: it is chrome that floats over the screen, and rung 6 is the one rung
           the slab does not quiet. -->
      <div class="k-slab k-money-slab">
        ${balanceCard(kid, w)}
        <!-- Second on the screen because it is the reason the first one matters (#355). -->
        ${thermometer(w.savings)}
        <div class="k-feed-card">
          <div class="transaction-list k-feed">${feed(w.events ?? [])}</div>
        </div>
      </div>
      <footer class="k-dock">
        <button class="k-dock-btn" id="dock-receive"${off}>${arrowIcon("down")}<span>${esc(t("app.kidReceive"))}</span></button>
        <button class="k-dock-btn k-dock-primary" id="dock-send"${off}>${arrowIcon("up")}<span>${esc(t("app.kidSend"))}</span></button>
        <button class="k-dock-scan" id="dock-scan" aria-label="${esc(t("app.kidScanTitle"))}"${off}>${scanIcon()}</button>
      </footer>
    </div>`, "k-screen money-screen", bg);

  paintIdenticons();
  // Fills on the wallet poll this screen already runs — no second poll, per #355.
  wireThermometer(() => { void refreshWallet().then(showMoney); });
  celebrateIfJustReached(w.savings);
  // Delegated: the feed repaints on a 12s poll, so per-row handlers would be rebound
  // every repaint and leak. `noopener` because the explorer is a third-party page.
  document.querySelector(".k-feed")?.addEventListener("click", (ev) => {
    const hash = ev.target.closest?.("[data-tx]")?.dataset.tx;
    if (hash) window.open(`${state.explorerTx}${hash}`, "_blank", "noopener");
  });
  const toGrow = () => { stopMoneyPoll(); showGrow(); };
  $("money-back").onclick = () => { stopMoneyPoll(); showChart(); };
  $("dock-send").onclick = () => { stopMoneyPoll(); showSend(); };
  $("dock-receive").onclick = () => { stopMoneyPoll(); showReceive(); };
  // Optional now: growBanner() omits it entirely where staking is unavailable, and an
  // unguarded .onclick on null would take the whole Money screen down with it.
  const grow = $("hdr-grow");
  if (grow) grow.onclick = toGrow;
  $("dock-scan").onclick = () => { stopMoneyPoll(); showScan(); };
  startMoneyPoll();
}

/** Same rule as the chart: a 12s timer must not rebuild the feed a kid is
 *  reading unless the money actually moved. */
function moneyFingerprint() {
  const w = state.wallet ?? {};
  const ev = w.events ?? [];
  // stakingAvailable is in here because it decides whether the Grow banner exists at all,
  // so a server that gains (or loses) a validator mid-poll has to repaint the card.
  return JSON.stringify([w.balanceLuna ?? 0, w.stakedLuna ?? 0, w.pendingUnstakeLuna ?? 0,
    w.stakingAvailable !== false, ev.length, ev[0]?.createdAt ?? 0]);
}
let lastMoneyPaint = "";
function shouldRepaintMoney() {
  if (!document.querySelector(".k-money")) return false;
  const fp = moneyFingerprint();
  if (fp === lastMoneyPaint) return false;
  lastMoneyPaint = fp;
  return true;
}

function startMoneyPoll() {
  stopMoneyPoll();
  pollTimer = setInterval(async () => {
    if (document.hidden || !document.querySelector(".k-money")) return;
    await refreshWallet();
    if (shouldRepaintMoney()) showMoney();
  }, 12_000);
}

document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !document.querySelector(".k-money")) return;
  await refreshWallet();
  if (shouldRepaintMoney()) showMoney();
});
