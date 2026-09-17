// nimiq.kids kid app — the "me" sheet, behind the kid's own name.
//
// Tapping your name used to switch kid outright. It now opens the one place
// that is about YOU: who you are, and what your app looks like. The app's scene
// lives here rather than behind the Timer, which is where it used to be and
// where a scene that has nothing to do with timing had no business being. The
// TIMER keeps its own scene, in the Timer menu, and the two no longer mirror
// each other (kid_prefs.timer_background_id).
//
// Its own module rather than more of chart.js: chart.js is the biggest file in
// the app and the CI guard flags anything at 800 lines.

import {
  state, esc, t, toast, openSheet, closeSheet, sheetHeadText, wireClose,
  BUILTIN_BGS, identiconImg, paintIdenticons,
} from "./util.js";
import { maskIcon, plusIcon } from "./icons.js";
import { api } from "./api.js";
import { showLogin } from "./main.js";

// Scene pictograms for the built-in gradient tiles, which are the pre-art
// fallback. Catalog art supersedes any of the same id.
const BG_EMOJI = { meadow: "🌿", ocean: "🌊", space: "🚀", city: "🏙️" };

/** The scene tiles, shared by this sheet and the Timer's. `current` is what to
 *  tick; `attr` is the data attribute the caller wires. */
export function bgTiles(current, attr = "data-bg") {
  // Two sources, and the second one is the point: `catalog` is the app's bundled scenes, and
  // `state.backgrounds` is what THIS kid has earned by finishing a sticker theme. A sibling
  // who has not finished the dragons does not see the dragon valley here.
  const catalogBgs = [...(state.catalog?.backgrounds ?? []), ...(state.backgrounds ?? [])]
    .filter((b) => b.url);
  // The four gradient tiles are the PRE-ART fallback and nothing else (2026-09-17): with eleven
  // free scenes in the catalogue, a gradient called "ocean" beside the ocean a theme has to earn
  // is a second, free ocean. They only show when no catalogue reached the tablet at all.
  const fallbackBgs = catalogBgs.length ? [] : BUILTIN_BGS;
  return `
    ${fallbackBgs.map((id) => `
      <button class="tile bg-tile bg-${id} ${current === id ? "on" : ""}" ${attr}="${id}">
        <span>${BG_EMOJI[id] ?? "🎨"}</span>
      </button>`).join("")}
    ${catalogBgs.map((b) => `
      <button class="tile bg-tile ${current === b.id ? "on" : ""}" ${attr}="${esc(b.id)}"
              style="background-image:url('${esc(b.url)}')"></button>`).join("")}`;
}

/** How many scene slots the me-sheet lays out: three rows of whatever the grid
 *  is running (four across on a phone, three on a tablet). */
const SCENE_ROWS = 3;

/** The empty slots after the real scenes, drawn as dotted outlines so the space
 *  the catalogue is going to fill is visible rather than implied. The FIRST one
 *  is the add button; the rest are quiet.
 *
 *  Deliberately not scenes-you-can-buy: nothing is for sale here, they are
 *  places for art that has not shipped yet, which is why tapping the plus says
 *  so rather than opening anything. */
function sceneSlots(filled, perRow) {
  const total = SCENE_ROWS * perRow;
  const empties = Math.max(0, total - filled);
  if (!empties) return "";
  return Array.from({ length: empties }, (_, i) => (i === 0
    ? `<button class="tile bg-slot bg-slot-add" id="bg-add"
               aria-label="${esc(t("app.kidMoreSoon"))}">${plusIcon("bg-slot-ic")}</button>`
    : `<span class="tile bg-slot" aria-hidden="true"></span>`)).join("");
}

/** The faces the row is offering to switch TO. A kid who cannot read yet still
 *  knows their sibling's identicon, so the picture is the real label here and
 *  the words are the caption. Capped so a big family cannot push the row wide:
 *  past the cap it says how many more rather than shrinking them all to specks. */
const SWITCH_FACES = 4;
function otherKids() {
  const me = state.child?.id;
  return state.children.filter((c) => c.id !== me);
}

export function openMeSheet(onChanged) {
  const kid = state.child;
  if (!kid) return;
  const current = state.prefs?.background_id || "meadow";
  const others = otherKids();
  const shown = others.slice(0, SWITCH_FACES);
  const rest = others.length - shown.length;
  openSheet(`
    ${sheetHeadText(kid.label, null)}
    <button class="me-row" id="me-switch">
      ${maskIcon("switch", "me-row-ic")}
      <span>${esc(t("app.kidSwitchKid"))}</span>
      ${others.length ? `<span class="me-row-kids">
        ${shown.map((c) => identiconImg(state.addresses[c.id] ?? "", "me-face")).join("")}
        ${rest > 0 ? `<i class="me-face-more">+${rest}</i>` : ""}
      </span>` : ""}
    </button>
    <div class="me-section">
      <h3 class="me-lbl">${esc(t("app.kidBackground"))}</h3>
      <div class="tile-grid bg-grid me-bgs">${bgTiles(current)}</div>
    </div>`);
  wireClose();
  paintIdenticons();

  // The empty slots are appended AFTER the grid exists, because how many there
  // are depends on how many columns the grid actually resolved to -- four on a
  // phone, three on a tablet -- and that is only knowable from the live layout.
  const grid = document.querySelector(".me-bgs");
  const perRow = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 4;
  grid.insertAdjacentHTML("beforeend", sceneSlots(grid.querySelectorAll("[data-bg]").length, perRow));
  const add = document.getElementById("bg-add");
  if (add) add.onclick = () => toast(t("app.kidMoreSoon"));

  document.getElementById("me-switch").onclick = () => { closeSheet(); showLogin(); };
  document.querySelectorAll(".me-bgs [data-bg]").forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.bg;
      // Paint the tick before the round trip: a kid tapping a scene should see
      // the choice land now, not after the network.
      document.querySelectorAll(".me-bgs [data-bg]").forEach((x) => x.classList.toggle("on", x === b));
      const res = await api.putPrefs(state.child.id, { backgroundId: id }).catch(() => null);
      if (res?.prefs) state.prefs = res.prefs;
      closeSheet();
      onChanged?.();
    };
  });
}
