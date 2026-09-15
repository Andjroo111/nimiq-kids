// nimiq.kids parent — one EXERCISE inside a practice.
//
// Lifted out of views-board.js for the 800-line guard, the same reason goals and locks
// already live in their own files. It is the routine step's sheet minus the minutes field:
// a practice's timer belongs to the practice, and an exercise is ticked rather than run.
//
// EVERY SAVE HERE IS A PRICE CHANGE (a stepped practice is priced by its steps and its own
// reward is not read), so the server takes the PIN and refuses while a day of it waits —
// `errorFor` already words that 409.
//
// TWO FIELDS ANSWER TWO DIFFERENT PEOPLE, and that is the whole design of this sheet:
//
//  · HOW TO DO IT goes to the KID. It is drawn straight onto the row on her tick sheet,
//    because a title is a label you recognise after being shown once and cannot teach the
//    thing cold. Write it the way you would say it out loud.
//  · SOMETHING TO WATCH goes to the GROWN-UP, and only here. The tablet is a kiosk with no
//    browser and its YouTube Kids carries approved channels only, so a link on the kid's
//    card is a dead end that teaches her the app is broken. It opens on the phone of
//    whoever is coaching, which is who was going to press play anyway.

import { t, call, toast, openSheet, $ } from "./core.js";
import { esc } from "./fmt.js";
import { jobPickerHtml, wireJobPicker } from "/js/lib/job-picker.js";
import { finish, jobGroups, rewardField, rewardLunaValue, wireReward } from "./views-board.js";

export function sheetPracticeStep(practice, step) {
  if (!practice) return;
  const isNew = !step;
  openSheet(`
    <h2>${isNew ? t("papp.boardNewExercise") : t("papp.boardEditExercise")}</h2>
    ${jobPickerHtml({ t, groups: jobGroups() })}
    <input class="nq-input" id="bd-title" maxlength="40" autocomplete="off"
      placeholder="${esc(t("papp.boardExerciseName"))}" value="${esc(step?.title ?? "")}" />
    ${rewardField(step?.rewardLuna, true)}
    <textarea class="nq-input bd-how" id="bd-how" maxlength="400" rows="3"
      placeholder="${esc(t("papp.boardHowPlaceholder"))}">${esc(step?.how ?? "")}</textarea>
    <div class="set-hint">${t("papp.boardHowHint")}</div>
    <input class="nq-input" id="bd-video" type="url" inputmode="url" autocomplete="off"
      placeholder="${esc(t("papp.boardVideoPlaceholder"))}" value="${esc(step?.videoUrl ?? "")}" />
    <div class="set-hint">${t("papp.boardVideoHint")}</div>
    <div class="btn-row bd-actions">
      ${isNew ? "" : `<button class="pill-btn ghost" id="bd-remove">${t("papp.boardRemoveExercise")}</button>`}
      <button class="pill-btn blue" id="bd-save">${t("papp.save")}</button>
    </div>`);
  const picker = wireJobPicker({ titleInput: $("bd-title") });
  wireReward();

  $("bd-save").onclick = async () => {
    const catalogId = picker.catalogId();
    const title = $("bd-title").value.trim();
    if (!title && !catalogId) { toast(t("papp.boxNameNeeded"), "error"); return; }
    $("bd-save").disabled = true;
    // Both always sent, even empty: emptying the box is how a parent takes a how-to back off
    // the kid's row, and a field omitted when blank could never do that.
    const body = {
      title,
      rewardLuna: rewardLunaValue(),
      how: $("bd-how").value,
      videoUrl: $("bd-video").value,
      ...(catalogId ? { catalogId } : {}),
    };
    const r = isNew
      ? await call("POST", `/api/practices/${practice.id}/steps`, body).catch(() => null)
      : await call("PATCH", `/api/practices/${practice.id}/steps/${step.id}`, body).catch(() => null);
    // A typed URL that is not a URL comes back 400 `invalid_video_url`; `errorFor` words it
    // and `finish` re-enables the buttons, the same path every other refusal here takes.
    await finish(r, isNew ? 201 : 200, t("papp.saved"));
  };

  // Retired, not deleted: the days that ticked it still point at it, and they still pay.
  $("bd-remove")?.addEventListener("click", async () => {
    $("bd-remove").disabled = true;
    const r = await call("PATCH", `/api/practices/${practice.id}/steps/${step.id}`, { active: false })
      .catch(() => null);
    await finish(r, 200, t("papp.saved"));
  });
}
