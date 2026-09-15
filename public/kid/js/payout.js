// nimiq.kids kid app — allowance-day payout ceremony. Stars turned into a real
// Cashlink: stars->coins animation, the QR, the NIM value, and (in SIM mode) a
// big Claim! button. Kept simple on purpose; polish lands later.

import { celebrate } from "/js/lib/confetti.js";
import { api } from "./api.js";
import { state, $, esc, t, setScreen, renderQr, fmtNim, toast } from "./util.js";
import { arrowIcon, checkIcon } from "./icons.js";
import { refreshWallet } from "./data.js";
import { showChart } from "./chart.js";

export async function showPayout(cashlinkId) {
  const link = await api.cashlinkLink(cashlinkId).catch(() => ({ error: "gone" }));
  if (link.error) { toast(t("app.errGeneric")); return showChart(); }

  // Coin rain = celebration content (kid-content, not chrome).
  const rain = Array.from({ length: 10 }, (_, i) =>
    `<span class="coin-coin" style="--i:${i};left:${6 + i * 9}%">🪙</span>`).join("");

  setScreen(`
    <div class="payout">
      <button class="back-btn" id="p-back">${arrowIcon("left")}</button>
      <div class="coin-rain" aria-hidden="true">${rain}</div>
      <h1 class="p-title">${esc(t("app.kidPayday"))}</h1>
      <div class="p-value">${fmtNim(link.valueLuna)} <span>NIM</span></div>
      <div class="p-qr" id="p-qr"></div>
      <div class="p-actions">
        ${state.sim ? `<button class="mega-btn green" id="p-claim">${esc(t("app.kidClaimNow"))}</button>` : ""}
      </div>
    </div>`, "payout-screen bg-space");

  renderQr($("p-qr"), link.url);
  celebrate();
  $("p-back").onclick = () => showChart();

  if (state.sim) {
    $("p-claim").onclick = async () => {
      $("p-claim").disabled = true;
      const res = await api.claimSim(cashlinkId);
      if (res.status === "claimed") {
        celebrate(undefined, { sound: "cheer" });   // claimed: the money is really theirs
        $("p-claim").innerHTML = checkIcon();
        setTimeout(async () => { await refreshWallet(); showChart(); }, 1800);
      } else {
        $("p-claim").disabled = false;
      }
    };
  }
}
