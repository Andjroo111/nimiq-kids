// nimiq.kids kid app — "Is it done?", the sheet a job card opens.
//
// Before this, tapping a card dropped the kid straight onto the TIMER screen and
// the timer was the ONLY way to finish a job (Andjroo, 2026-07-31: "I wanna make
// it where the kid doesn't have to use a timer. There should be no timer
// there."). So the timer stopped being the route and became one of the offers on
// this sheet — and only on a job that has a duration to run at all. A chore has
// none, so its sheet is the two answers and nothing else.
//
// The sticker circle on the card is what opens this. That is the whole reason
// chart.js now draws the ring from the START instead of once the job is done:
// the ring is the button, not a reward slot that appears afterwards.
//
// Yes goes to the SAME parent queue the timer's own finish has always used —
// nothing new was invented for the parent side:
//   routine task -> POST /task-runs/:id/done -> completeRunIfFinished() opens a
//                   `routine_run` approval once the run's last task lands
//   chore/lesson -> POST /chores/:id/submit  -> opens a `chore` approval
// Both notify the parent's phone from the server. See src/repo-approvals.ts.
//
// It rides the app's OWN bottom sheet (openSheet / #kid-sheet), not the
// setScreen sheet Send and the amount pad use, for one load-bearing reason: the
// sticker that follows has to be dragged into the ring ON THE CHART, and
// startPlacement() measures that ring's rect. A setScreen sheet would have
// replaced the chart underneath and left placement with no target.

import { rowTitle, $, esc, t, openSheet, closeSheet, sheetHeadText } from "./util.js";
import { checkIcon, maskIcon } from "./icons.js";

/** The job's own picture, the same one its card wears — the drawn icon when the
 *  server resolved one for that emoji, else the emoji itself. Big here because
 *  it is all that says WHICH job this question is about; the title is the sheet's
 *  quiet sub-line and the card is behind the scrim. */
function jobFace(tk) {
  return tk.iconUrl
    ? `<img class="dn-face-icon" src="${esc(tk.iconUrl)}" alt="" draggable="false" />`
    : `<span class="dn-face-emoji">${esc(tk.emoji ?? "⭐")}</span>`;
}

/**
 * tk   — the card's row out of state.chart.todayTasks
 * opts — { onYes(), onTimer() }. onTimer is only ever called for a job with a
 *        durationS, because that is the only kind the timer screen can run.
 */
export function openDoneSheet(tk, opts) {
  const timed = Number(tk.durationS) > 0 && typeof opts.onTimer === "function";

  openSheet(`
    ${sheetHeadText(t("app.kidIsItDone"), rowTitle(tk))}
    <div class="dn-face">${jobFace(tk)}</div>
    <div class="dn-actions">
      <button class="mega-btn green" id="dn-yes">${checkIcon()} ${esc(t("app.kidYesDone"))}</button>
      <button class="mega-btn quiet" id="dn-no">${esc(t("app.kidNotYet"))}</button>
    </div>
    ${timed ? `
      <button class="dn-timer" id="dn-timer">
        ${maskIcon("timer", "dn-timer-ic")}<span>${esc(t("app.kidUseTimer"))}</span>
      </button>` : ""}`);

  $("sheet-x").onclick = closeSheet;
  $("dn-no").onclick = closeSheet;
  $("dn-yes").onclick = () => {
    $("dn-yes").disabled = true; // a double tap would post the job twice
    closeSheet();
    opts.onYes();
  };
  if (timed) $("dn-timer").onclick = () => { closeSheet(); opts.onTimer(); };
}
