// nimiq.kids kid app v2 — the all-done handoff: celebration, "Waiting for Dad",
// photo proof ("Show your work"), on-tablet PIN pad, and the +NIM celebration
// (the earned amount flies into the balance) once the parent approves.
// V2: rewards are NIM (reward_luna) — no stars anywhere in family mode.

import { celebrate } from "/js/lib/confetti.js";
import { api } from "./api.js";
import {
  state, $, esc, t, parentName, setScreen, bgFor, toJpeg, playAlarm, fmtNimLuna,
} from "./util.js";
import { icon, arrowIcon, checkIcon, deleteIcon, cameraIcon, waitIcon } from "./icons.js";
import { refreshWallet, refreshChart } from "./data.js";
import { showChart, openEarnedStickerOrChart } from "./chart.js";
// #323: all three paths below END in a celebration, so all three have to bank the approval as
// already told. A ROUTINE is the one that bites — one yes turns every task card green, the
// first sticker opens automatically and the rest stay collectable, so the chart's own notice
// would otherwise announce a routine the kid just watched pay out.
import { markApprovalsSeen } from "./approved.js";

let waitTimer = 0;
function stopWaitPoll() { clearInterval(waitTimer); waitTimer = 0; }

/** NIM earned by this run = sum of reward_luna over its DONE tasks (matches server). */
const nimEarned = (entry) => entry.taskRuns
  .filter((tr) => tr.status === "done")
  .reduce((sum, tr) => sum + (entry.tasks.find((tk) => tk.id === tr.task_id)?.reward_luna ?? 0), 0);

/**
 * The two buttons under "Waiting for Mom", in the order that matches who is actually in the room.
 *
 * ON A REAL HOUSEHOLD the kid genuinely is waiting: a parent will approve from their own phone,
 * and the only thing the kid can usefully do meanwhile is send a photo. So "Show your work" is
 * the primary, and "Mom is here" is the smaller path for when she walks over.
 *
 * ON A DEMO HOUSEHOLD there is nobody to wait for. The visitor is playing both parts, so the
 * ONLY way forward through this screen is "Mom is here" — and it was the gold secondary, under
 * a blue primary camera button that unblocks nothing. Andjroo hit exactly that wall: a screen
 * whose one exit is styled as the afterthought. On demo the two swap places and colours, which
 * keeps this screen honest about the repo's own "one primary action per screen" rule: the
 * primary is the action that moves you on, and which action that is depends on the household.
 *
 * Both buttons stay in both modes. The camera is real product and a judge should see it.
 */
function actions(approvalId, name) {
  const off = approvalId ? "" : "disabled";
  const proof = (cls) => `<button class="mega-btn ${cls}" id="btn-proof" ${off}>${cameraIcon()} ${esc(t("app.kidShowWork"))}</button>`;
  const here = (cls) => `<button class="mega-btn ${cls}" id="btn-pin" ${off}>${icon("key-puzzle")} ${esc(t("app.kidParentHere", { name }))}</button>`;
  return state.family?.demo_at
    ? `${here("blue")}${proof("gold")}`
    : `${proof("blue")}${here("gold")}`;
}

export async function showWaiting(entry) {
  stopWaitPoll();
  const bg = bgFor();
  const earnedLuna = nimEarned(entry);
  const name = parentName();
  const approval = await api.runApproval(entry.run.id).catch(() => ({}));
  const approvalId = approval.approvalId ?? null;

  setScreen(`
    <div class="waiting">
      <button class="back-btn" id="w-back">${arrowIcon("left")}</button>
      <div class="w-party">${icon("high-five", "w-party-icon")}</div>
      <h1 class="w-title">${esc(t("app.kidAllDoneTitle"))}</h1>
      <div class="w-nim"><span class="k-nim-pill k-nim-pill-big">+${fmtNimLuna(earnedLuna)} NIM</span><br>
        <span class="w-nim-sub">${esc(t("app.kidNimToday", { amount: fmtNimLuna(earnedLuna) }))}</span></div>
      <div class="w-wait">${waitIcon("w-hour")} ${esc(t("app.kidWaiting", { name }))}</div>
      <div class="w-photo" id="w-photo"></div>
      <div class="w-actions">${actions(approvalId, name)}</div>
      <input type="file" accept="image/*" capture="environment" id="proof-input" hidden />
    </div>`, "k-screen waiting-screen", bg);

  celebrate();
  $("w-back").onclick = () => { stopWaitPoll(); showChart(); };

  // Show your work: camera -> downscale -> media(role=proof) -> attach to the approval.
  $("btn-proof").onclick = () => $("proof-input").click();
  $("proof-input").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !approvalId) return;
    $("btn-proof").disabled = true;
    const jpeg = await toJpeg(file);
    const up = await api.upload(jpeg, "proof", state.child.id);
    if (up.media?.id) {
      const att = await api.attachPhoto(approvalId, up.media.id);
      if (!att.error) {
        $("w-photo").innerHTML = `<img src="${esc(up.media.url)}" alt="" /> <span>${esc(t("app.kidPhotoSent"))}</span>`;
      }
    }
    $("btn-proof").disabled = false;
  };

  // Parent is here: on-tablet PIN pad — except on a DEMO household, where there is no
  // PIN and no second person. The visitor is playing both parts, so a keypad asking for
  // a code nobody gave them is the one place the demo dead-ends. The server agrees
  // (parentAuth), so this just goes straight through and lands on the same celebration.
  $("btn-pin").onclick = async () => {
    if (!approvalId) return;
    if (!state.family?.demo_at) return showPinPad(approvalId, entry);
    $("btn-pin").disabled = true;
    const res = await api.approve(approvalId).catch(() => ({}));
    if (res.paidLuna === undefined) { $("btn-pin").disabled = false; return; }
    stopWaitPoll();
    await Promise.all([refreshWallet(), refreshChart()]);
    markApprovalsSeen();
    // Straight on into the sticker the routine just earned. Without this the kid landed back
    // on the chart with three green cards and no reason to tap any of them.
    nimCelebration(res.paidLuna, res.txHash, openEarnedStickerOrChart);
  };

  // Poll every 5s: the parent may approve remotely from the phone page.
  waitTimer = setInterval(async () => {
    if (document.hidden) return;
    const day = await api.today(entry.routine.id).catch(() => null);
    if (day?.run?.status === "approved") {
      stopWaitPoll();
      await Promise.all([refreshWallet(), refreshChart()]);
      markApprovalsSeen();
      nimCelebration(earnedLuna);
    }
  }, 5_000);
}

// ---------- PIN pad ----------
function showPinPad(approvalId, entry) {
  stopWaitPoll();
  const name = parentName();
  let pin = "";
  setScreen(`
    <div class="pinpad">
      <button class="back-btn" id="pin-back">${arrowIcon("left")}</button>
      <div class="pin-lock">${icon("safe-lock", "pin-lock-icon")}</div>
      <div class="pin-prompt" id="pin-prompt">${esc(t("app.kidPinPrompt"))}</div>
      <div class="pin-dots" id="pin-dots"></div>
      <div class="pin-grid" id="pin-grid">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join("")}
        <button data-k="del">${deleteIcon()}</button><button data-k="0">0</button><button data-k="ok" class="ok">${checkIcon()}</button>
      </div>
    </div>`, "pin-screen");

  const dots = () => { $("pin-dots").innerHTML = "●".repeat(pin.length) || "&nbsp;"; };
  dots();
  $("pin-back").onclick = () => showWaiting(entry);

  $("pin-grid").querySelectorAll("button").forEach((b) => {
    b.onclick = async () => {
      const k = b.dataset.k;
      if (k === "del") { pin = pin.slice(0, -1); return dots(); }
      if (k !== "ok") { if (pin.length < 8) pin += k; return dots(); }
      if (pin.length < 4) return shake();
      const res = await api.approve(approvalId, pin);
      if (res.paidLuna !== undefined) {
        await Promise.all([refreshWallet(), refreshChart()]);
        markApprovalsSeen();
        return nimCelebration(res.paidLuna, res.txHash);
      }
      if (res.error === "pin_locked") {
        $("pin-prompt").textContent = t("app.kidPinLocked", { name });
        $("pin-grid").style.display = "none";
        setTimeout(() => showWaiting(entry), 3000);
        return;
      }
      shake(); // wrong_pin / anything else: wiggle + clear
      pin = ""; dots();
    };
  });
  function shake() {
    const el = document.querySelector(".pinpad");
    $("pin-prompt").textContent = t("app.kidPinWrong");
    el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake");
  }
}

// ---------- +NIM celebration (approval landed: the amount flies into the balance) ----------
/**
 * @param amountLuna what just landed.
 * @param txHash the payout's own transaction, when the approve response carried one.
 *
 * THE RECEIPT IS THE POINT OF THE WHOLE APP, and this is the moment it is true. Every chore
 * payout writes the chore's own title into the transaction as on-chain data, so the link below
 * opens a real Nimiq transaction whose memo reads "Tidy your room". It was already reachable —
 * from the Money feed, three taps away, after leaving the celebration — which is three taps
 * after anybody cares.
 *
 * Same rule the feed rows use: a hash and a configured explorer, or nothing at all. SIM hashes
 * are invented and `state.explorerTx` is blanked there, so a simulated payout renders no link.
 */
/**
 * @param onDone runs INSTEAD of returning to the chart, once the overlay closes. It exists so
 *   a demo self-approval can carry straight on into the sticker the kid just earned: the
 *   celebration is the money moment, the sticker is the one they came for, and dropping them
 *   back on the chart in between left the sticker behind a tap nothing had told them to make.
 *   Called at most once even though `done` has two triggers (a tap and the timeout).
 */
export function nimCelebration(amountLuna, txHash, onDone) {
  const overlay = $("kid-overlay");
  const receipt = txHash && state.explorerTx ? txHash : "";
  overlay.innerHTML = `
    <div class="celebrate-box">
      <div class="celebrate-pill k-nim-pill k-nim-pill-fly">+${fmtNimLuna(amountLuna)} NIM</div>
      ${receipt ? `<button class="k-receipt-link" id="celebrate-receipt">${esc(t("app.kidSeeReceipt"))}</button>` : ""}
    </div>`;
  overlay.classList.add("show");
  // The cheer, not the pop: this is NIM actually arriving, which is the moment the whole
  // app exists for. The same four children who cheer the egg open cheer this.
  celebrate(undefined, { sound: "cheer" });
  playAlarm();

  let closed = false;
  const done = () => {
    if (closed) return; // a tap and the timeout both fire this; the follow-up must run once
    closed = true;
    overlay.classList.remove("show");
    overlay.innerHTML = "";
    if (onDone) onDone(); else showChart();
  };
  overlay.onclick = done;
  if (receipt) {
    // The overlay closes on any tap, so the link has to stop its own — and 2.6s is not long
    // enough to read a line and reach it, so the window doubles when there is something to
    // reach. `noopener` because the explorer is a third-party page.
    $("celebrate-receipt").onclick = (ev) => {
      ev.stopPropagation();
      window.open(`${state.explorerTx}${receipt}`, "_blank", "noopener");
    };
  }
  setTimeout(done, receipt ? 5200 : 2600);
}
