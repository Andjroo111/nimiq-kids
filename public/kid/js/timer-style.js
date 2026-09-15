// nimiq.kids kid app — equipping a TIMER STYLE, and nothing else.
//
// This is what survived `studio.js`, which was the kid app's four customization sheets
// (hatch / timer / sounds / background). The Timer dock button has opened the vendored egg
// timer in an iframe since v0.59.0, and that timer brings its OWN character, sound and
// background sheets — so three of those four had no caller left, and the hatch sheet's job
// (choose what comes out of the egg) is done by the timer's own character grid against
// localStorage rather than `kid_prefs.hatch_asset_id`. They were unreachable code that read
// as live: well commented, recently touched, and importing from half the app.
//
// What is genuinely still reached is the Treasure Box handoff — buy a timer style, equip it,
// see it — so that island moved here under a name that says what it is.
//
// ⚠️ Both alternate styles are `retired: true` (src/sticker-catalog.ts), so `timerStyles` is
// `['egg']` for every reachable kid and the sheet currently shows one option. That is the
// catalogue's call, not this file's; re-listing them is one flag.

import { api } from "./api.js";
import { state, esc, t, openSheet, sheetHead, wireClose } from "./util.js";
import { timerPreview } from "./timer-previews.js";

async function savePrefs(patch) {
  const res = await api.putPrefs(state.child.id, patch);
  if (res.prefs) state.prefs = res.prefs;
  if (res.timerStyles) state.timerStyles = res.timerStyles;
  return res;
}

export const TIMER_LABELS = { egg: "app.kidTimerEgg", maker: "app.kidTimerMaker", polaroid: "app.kidTimerPola" };

/** OWNED styles only (server list from /prefs: free egg + Treasure Box buys).
 *  Unowned styles never show here — kids discover them in the Box. */
export function openTimerSheet() {
  const current = state.prefs?.timer_style_id || "egg";
  const owned = state.timerStyles?.length ? state.timerStyles : ["egg"];
  openSheet(`
    ${sheetHead("app.kidTimerStyle", "app.kidTimerPick")}
    <div class="tile-grid">
      ${owned.map((id) => `
        <button class="tile timer-tile ${current === id ? "on" : ""}" data-timer="${id}">
          ${timerPreview(id)}
          <span class="timer-tile-label">${esc(t(TIMER_LABELS[id] ?? id))}</span>
        </button>`).join("")}
    </div>`);
  wireClose();
  document.querySelectorAll("[data-timer]").forEach((b) => {
    b.onclick = async () => { await savePrefs({ timerStyleId: b.dataset.timer }); openTimerSheet(); };
  });
}

/** Treasure Box handoff: right after buying a timer, equip it + show the sheet. */
export async function equipTimerStyle(styleId) {
  await savePrefs({ timerStyleId: styleId });
  openTimerSheet();
}
