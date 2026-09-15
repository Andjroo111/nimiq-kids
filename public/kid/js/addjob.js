// "Add a job" — a kid putting something on their own board.
//
// Andjroo, 2026-07-30: a kid should be able to pick their own chores sometimes,
// and take one off again if they added it by accident. This is the adding half;
// the X on a card is the taking-off half (chart.js).
//
// The amount is the kid's to name, and it can be nothing at all — the point is
// agency, not earning. Nothing is ever paid without a parent approving it, so an
// ambitious ask is a conversation rather than an exploit.

import { state, $, esc, t, toast, openSheet, closeSheet, sheetHead, fmtFiat, LUNA } from "./util.js";
import { api } from "./api.js";
import { jobCatalog, jobPickerHtml, wireJobPicker } from "../../js/lib/job-picker.js";

let icons = [];

export async function openAddJob(onAdded) {
  const kid = state.child;
  if (!kid) return;
  if (!icons.length) icons = (await api.taskIcons().catch(() => null))?.icons ?? [];
  // A kid picking a tile is the best case for the catalog: they get the job in
  // their own language, and it is one tap instead of typing it on a tablet.
  const { groups } = await jobCatalog();

  let pickedIcon = icons[0]?.id ?? null;

  openSheet(`
    ${sheetHead("app.kidAddJob")}
    <div class="aj">
      ${jobPickerHtml({ t, groups, searchable: false })}
      <input class="aj-title" id="aj-title" maxlength="40"
        placeholder="${esc(t("app.kidJobName"))}" autocomplete="off" />
      <!-- The icon strip is for a job the kid NAMED, and appears only once they start
           naming one. A catalog tile already carries its own picture, so showing both
           by default put two pickers on one sheet, made the kid choose a face for a job
           that has one, and pushed the amount field and the Add button off the bottom. -->
      <div class="aj-icons" id="aj-icons" hidden>
        ${icons.map((i) => `
          <button class="aj-icon ${i.id === pickedIcon ? "is-on" : ""}" data-ic="${esc(i.id)}"
            aria-label="${esc(i.label)}" aria-pressed="${i.id === pickedIcon}">
            ${i.url
              ? `<img src="${esc(i.url)}" alt="" draggable="false" />`
              : `<span class="aj-icon-emoji" aria-hidden="true">${esc(i.emoji)}</span>`}
          </button>`).join("")}
      </div>
      <div class="aj-label">${esc(t("app.kidJobWorth"))}</div>
      <div class="aj-amt-row">
        <input class="aj-amt" id="aj-amt" inputmode="numeric" pattern="[0-9]*"
          maxlength="7" placeholder="0" autocomplete="off" />
        <span class="aj-amt-unit">NIM</span>
      </div>
      <div class="aj-hint" id="aj-hint">${esc(t("app.kidJobNoReward"))}</div>
      <button class="k-btn k-btn-primary aj-go" id="aj-go">${esc(t("app.kidAddJobGo"))}</button>
    </div>`);

  const pick = (sel, attr, set) => document.querySelectorAll(sel).forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll(sel).forEach((o) => {
        o.classList.remove("is-on"); o.setAttribute("aria-pressed", "false");
      });
      b.classList.add("is-on"); b.setAttribute("aria-pressed", "true");
      set(b.dataset[attr]);
    };
  });
  pick(".aj-icon", "ic", (v) => { pickedIcon = v; });
  // One face per job. A tile brings its own; the strip is for a typed job, and shows
  // up once there is a typed job to give a face to. Declared before syncIcons reads
  // it rather than relying on the callback firing late.
  const jobs = wireJobPicker({ titleInput: $("aj-title"), onPick: () => syncIcons() });
  const syncIcons = () => {
    $("aj-icons").hidden = !!jobs.catalogId() || !$("aj-title").value.trim();
  };
  $("aj-title").addEventListener("input", syncIcons);

  // Any whole number of coins, the kid's own choice. What it is WORTH shows
  // underneath as they type, because "1081 NIM" means nothing to a seven-year-old
  // on its own; nothing at all is still a perfectly good answer.
  const amount = () => Math.max(0, Math.floor(Number($("aj-amt").value.replace(/\D/g, "")) || 0));
  $("aj-amt").oninput = () => {
    const nim = amount();
    $("aj-amt").value = nim ? String(nim) : "";
    $("aj-hint").textContent = nim ? fmtFiat(nim * LUNA) : t("app.kidJobNoReward");
  };

  $("aj-go").onclick = async () => {
    const catalogId = jobs.catalogId();
    const title = $("aj-title").value.trim();
    if (!title && !catalogId) { $("aj-title").focus(); return; }
    const icon = icons.find((i) => i.id === pickedIcon);
    const res = await api.createChore({
      childId: kid.id, title, emoji: icon?.emoji ?? "🧽",
      // A tile wins over the icon strip and the text box: the server reads the
      // words, the emoji and the key from the catalog so all three agree.
      ...(catalogId ? { catalogId } : {}),
      rewardLuna: amount() * LUNA, createdBy: "kid",
    }).catch(() => null);
    if (!res?.chore) return toast(t("app.errGeneric"));
    closeSheet();
    toast(t("app.kidJobAdded"));
    onAdded?.();
  };
  $("sheet-x").onclick = closeSheet;
}
