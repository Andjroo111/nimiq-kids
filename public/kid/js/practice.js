// nimiq.kids kid app — "What did you do today?", the sheet a practice with EXERCISES opens.
//
// EACH ROW CARRIES ITS OWN HOW-TO, and it is drawn rather than hidden behind a tap. A title
// is a label you recognise after someone has shown you once ("Five-finger walk"); on its own
// it sends the kid to find a grown-up before every exercise, which is the whole complaint
// this answers. It is deliberately NOT a nested button: the row IS the tick target, and a
// control inside it would be invalid markup and would steal the tap that ticks. The text is
// clamped in CSS instead, so five exercises still leave "I'm done" on the screen.
//
// A practice used to be one tap: you did piano, or you did not. But piano is scales, then
// the song, then sight-reading, and a kid who did two of the three was paid for three or
// paid for nothing. So a practice that has exercises asks which ones, and the day pays the
// ticked ones (src/repo-practices.ts, practiceDayLuna).
//
// THE TICKS ARE THE PRICE, so this sheet is the whole decision and "I'm done" is the only
// way out of it. Nothing is sent while the kid is tapping rows: the POST carries the ticked
// ids, the server writes them once, and the parent's phone is told that number. A sheet that
// saved each tap would let the amount drift after the parent had already been pinged one.
//
// Same bottom sheet done.js uses (openSheet / #kid-sheet), for the same reason: the sticker
// that follows is dragged into the ring ON THE CHART, and startPlacement() measures that
// ring's rect. A setScreen sheet would replace the chart underneath it.

import { rowTitle, $, esc, t, openSheet, closeSheet, sheetHeadText, fmtNimWhole, fmtFiat } from "./util.js";
import { checkIcon } from "./icons.js";

/**
 * A CLIP WE HOST PLAYS HERE; A LINK SOMEWHERE ELSE DOES NOT.
 *
 * One column, `video_url`, answers two readers, and the URL itself says which. A same-origin
 * path is a file this instance serves, so it plays inline on the kid's own row. Anything with
 * a host on it is a page on the open web, and this tablet is a kiosk with no browser — a link
 * here would be a dead tap that teaches a seven-year-old the app is broken. Those stay on the
 * parent board, where there is a phone that can open them.
 *
 * `startsWith("/")` and not `new URL(...).origin` on purpose: a protocol-relative `//host/x`
 * is somebody else's host wearing a leading slash, and it must not pass.
 */
const isLocalClip = (url) => typeof url === "string" && url.startsWith("/") && !url.startsWith("//");

/** The demonstration, for a kid who cannot read the words yet. No autoplay: five of these on
 *  one sheet all talking at once is unusable, and she taps the one she wants. */
const stepClip = (s) => (isLocalClip(s.videoUrl)
  ? `<video class="pr-step-clip" src="${esc(s.videoUrl)}" controls playsinline preload="metadata"
       disablepictureinpicture controlslist="nodownload noremoteplayback"></video>`
  : "");

/** The exercise's own picture, the same rule a job card follows. */
const stepFace = (s) => (s.iconUrl
  ? `<img class="pr-step-icon" src="${esc(s.iconUrl)}" alt="" draggable="false" />`
  : `<span class="pr-step-emoji">${esc(s.emoji ?? "🎵")}</span>`);

/**
 * pr   — the practice's row out of state.chart.practices (carries `steps`)
 * opts — { onDone(stepIds) }, called once with what the kid ticked.
 */
export function openPracticeStepsSheet(pr, opts) {
  const steps = pr.steps ?? [];
  const picked = new Set();

  openSheet(`
    ${sheetHeadText(t("app.kidWhatDidYouDo"), rowTitle(pr))}
    <div class="pr-steps">
      ${/* The clip is a SIBLING of the tick button, never inside it. A <video controls> nested
            in a button swallows its own play tap and ticks the row instead, and the wrapper is
            what lets the two share a card without fighting over the gesture. */""}
      ${steps.map((s) => `
        <div class="pr-step-wrap">
          <button class="pr-step" data-step="${esc(s.id)}" aria-pressed="false">
            <span class="pr-step-tick">${checkIcon()}</span>
            ${stepFace(s)}
            <span class="pr-step-main">
              <span class="pr-step-title">${esc(rowTitle(s))}</span>
              ${s.how ? `<span class="pr-step-how">${esc(s.how)}</span>` : ""}
              ${s.rewardLuna > 0 ? `<span class="k-nim-pill">+${fmtNimWhole(s.rewardLuna)} NIM</span>` : ""}
            </span>
          </button>
          ${stepClip(s)}
        </div>`).join("")}
    </div>
    <p class="pr-steps-total" id="pr-total"></p>
    <div class="dn-actions">
      <button class="mega-btn green" id="pr-done">${checkIcon()} ${esc(t("app.kidImDone"))}</button>
    </div>`);

  // What the day is worth RIGHT NOW, repainted on every tap. The kid is choosing the
  // number, so the number has to be on the screen while they choose it.
  const total = () => steps.filter((s) => picked.has(s.id)).reduce((n, s) => n + s.rewardLuna, 0);
  const paintTotal = () => {
    const luna = total();
    $("pr-total").textContent = luna > 0
      ? t("app.kidTodayPays", { amount: `${fmtNimWhole(luna)} NIM`, fiat: fmtFiat(luna) })
      : t("app.kidTodayPaysNothing");
  };

  document.querySelectorAll("[data-step]").forEach((btn) => (btn.onclick = () => {
    const id = btn.dataset.step;
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    btn.classList.toggle("is-on", picked.has(id));
    btn.setAttribute("aria-pressed", String(picked.has(id)));
    paintTotal();
  }));
  paintTotal();

  $("sheet-x").onclick = closeSheet;
  $("pr-done").onclick = () => {
    $("pr-done").disabled = true; // a double tap would log the day twice
    closeSheet();
    // Order matters, not the count: the server drops anything that is not this practice's
    // own live step, and it writes them once.
    opts.onDone(steps.filter((s) => picked.has(s.id)).map((s) => s.id));
  };
}
