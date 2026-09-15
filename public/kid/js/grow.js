// nimiq.kids kid app v2 — GROW (staking, kid-sized and honest). Current staked NIM
// with a gently growing plant, stake/unstake via the shared big pad, the unstake
// cooldown shown truthfully (availableAt), and a simple projection line from
// estApyPct. The green-flooded hero is this app's ONE calculated break.

import {
  state, $, esc, t, setScreen, toast, bgFor, fmtNimLuna, fmtFiat,
} from "./util.js";
import { api } from "./api.js";
import { arrowIcon, stakingIcon, waitIcon } from "./icons.js";
import { refreshWallet, refreshStaking } from "./data.js";
import { showMoney } from "./money.js";
import { showAmountScreen } from "./pad.js";
import { showResult } from "./send.js";

let tickTimer = 0;
function stopTick() { clearInterval(tickTimer); tickTimer = 0; }

function cooldownText(availableAt) {
  const leftMs = Math.max(0, availableAt - (Date.now() + state.skewMs));
  const m = Math.ceil(leftMs / 60_000);
  if (m >= 90) return `~${Math.ceil(m / 60)} h`;
  return `~${m} min`;
}

export async function showGrow() {
  const kid = state.child;
  if (!kid) return showMoney();
  await refreshStaking();
  stopTick();
  const bg = bgFor();
  // pendingStakeLuna matters as much as the settled figure here. A stake is written
  // pending until the chain is seen to agree, which takes roughly one confirmation
  // (8-15s observed on testnet), and for that whole window `stakedLuna` is still 0.
  // Without this the screen answered a kid who had just staked with "0 NIM" and the
  // "put some NIM here" hint, which reads as though nothing happened — it is exactly
  // what made a live verification look like a failed stake.
  const s = state.staking ?? { stakedLuna: 0, pendingLuna: 0, pendingStakeLuna: 0, estApyPct: 0, rewardsEarnedLuna: 0 };
  const spendable = state.wallet?.balanceLuna ?? 0;
  const pendingUnstakes = (state.wallet?.events ?? []).filter((e) => e.kind === "unstake" && e.status === "pending");
  // No projection line. It read "keep {amount} growing for a year and it becomes
  // about {future}", which is a forward yield promise made to a child off a
  // hardcoded EST_APY_PCT. The hero already shows what has actually been earned,
  // which is a fact rather than a forecast. Replacement wording is Andjroo's.

  setScreen(`
    <div class="k-grow">
      <button class="back-btn" id="grow-back">${arrowIcon("left")}</button>
      <!-- THE SLAB (scene.css). Back button outside it, same as every other screen. -->
      <div class="k-slab grow-slab">
        <h1 class="k-page-title">${esc(t("app.kidGrow"))}</h1>
        <div class="k-grow-hero">
          ${stakingIcon("k-grow-plant")}
          <div class="k-grow-amount">${fmtNimLuna(s.stakedLuna)} <span>NIM</span></div>
          <div class="k-grow-fiat">${fmtFiat(s.stakedLuna)}</div>
          ${s.rewardsEarnedLuna > 0 ? `<div class="k-grow-earned">${esc(t("app.kidEarnedLine", { amount: fmtNimLuna(s.rewardsEarnedLuna) }))}</div>` : ""}
        </div>
        ${pendingUnstakes.map((e) => `
          <div class="k-grow-pending">
            ${waitIcon()}
            <span>${esc(t("app.kidComingBack", { amount: fmtNimLuna(Math.abs(e.valueLuna)) }))}</span>
            <b data-cooldown="${e.availableAt ?? 0}">${e.availableAt ? cooldownText(e.availableAt) : ""}</b>
          </div>`).join("")}
        ${s.pendingStakeLuna > 0 ? `
          <div class="k-grow-pending">
            ${waitIcon()}
            <span>${esc(t("app.kidStakeOnItsWay", { amount: fmtNimLuna(s.pendingStakeLuna) }))}</span>
          </div>` : ""}
        ${s.stakedLuna > 0 || s.pendingStakeLuna > 0 ? "" : `<p class="k-grow-hint">${esc(t("app.kidGrowEmpty"))}</p>`}
        <div class="k-grow-actions">
          <button class="mega-btn blue" id="grow-add" ${spendable > 0 ? "" : "disabled"}>${esc(t("app.kidGrowMore"))}</button>
          ${s.stakedLuna > 0 ? `<button class="k-grow-take" id="grow-take">${esc(t("app.kidTakeBack"))}</button>` : ""}
        </div>
      </div>
    </div>`, "k-screen grow-screen", bg);

  $("grow-back").onclick = () => { stopTick(); showMoney(); };
  $("grow-add").onclick = () => { stopTick(); pickStake(s); };
  $("grow-take") && ($("grow-take").onclick = () => { stopTick(); pickUnstake(s); });

  // Honest cooldown countdown (and SIM unstakes release quickly — refresh through).
  tickTimer = setInterval(async () => {
    if (document.hidden || !document.querySelector(".k-grow")) return;
    const els = document.querySelectorAll("[data-cooldown]");
    if (!els.length) return;
    let due = false;
    els.forEach((el) => {
      const at = Number(el.dataset.cooldown);
      if (at && at <= Date.now() + state.skewMs) due = true;
      else if (at) el.textContent = cooldownText(at);
    });
    if (due) { stopTick(); await refreshWallet(); if (document.querySelector(".k-grow")) showGrow(); }
  }, 5_000);
}

function pickStake(s) {
  const max = state.wallet?.balanceLuna ?? 0;
  showAmountScreen({
    title: t("app.kidGrowMore"),
    cta: t("app.kidGrowMore"),
    maxLuna: max,
    // The chain refuses a stake under 100 NIM. The API has always reported the floor
    // as `minStakeLuna` and the kid app never read it, so a kid with 59 NIM got an
    // enabled button and an unfixable "Something went wrong".
    minLuna: s.minStakeLuna ?? 0,
    onBack: showGrow,
    onConfirm: async (valueLuna) => {
      const res = await api.stake(state.child.id, valueLuna).catch(() => ({ error: "network" }));
      // Queued for a parent (family mode / enforced instances): the same honest
      // "needs a grown-up's OK" screen a queued send shows.
      if (res.status === "pending_approval") return showResult(false, esc(t("app.kidNeedsOk")));
      // The keypad already blocks below-minimum amounts; this is the safety net for a
      // floor that moved under us. Either way the kid is told which it is.
      if (res.error) {
        const msg = res.error === "insufficient_funds" ? t("app.kidNotEnough")
          : res.error === "below_min_stake" ? t("app.kidMinStake", { amount: fmtNimLuna(s.minStakeLuna ?? 0) })
          : res.error === "staking_unavailable" ? t("app.kidGrowUnavailable")
          : t("app.errGeneric");
        toast(msg); return showGrow();
      }
      await refreshWallet();
      showGrow();
    },
  });
}

function pickUnstake(s) {
  showAmountScreen({
    title: t("app.kidTakeBack"),
    cta: t("app.kidTakeBack"),
    maxLuna: s.stakedLuna,
    availLabel: t("app.kidGrowing", { amount: fmtNimLuna(s.stakedLuna) }),
    onBack: showGrow,
    onConfirm: async (valueLuna) => {
      const res = await api.unstake(state.child.id, valueLuna).catch(() => ({ error: "network" }));
      if (res.status === "pending_approval") return showResult(false, esc(t("app.kidNeedsOk")));
      if (res.error) {
        toast(res.error === "insufficient_stake" ? t("app.kidNotEnough") : t("app.errGeneric"));
        return showGrow();
      }
      await refreshWallet();
      showGrow();
    },
  });
}
