// "Pick your place" — screen 4 of the climb (2026-09-18), skippable.
//
// The scene the kid's app is painted on. It already has a home, `kid_prefs.background_id`
// (the me sheet's grid, PUT /api/children/:id/prefs with its ownership guard), so this screen
// writes THAT and keeps no column of its own. What it offers is the catalogue's free scenes,
// the ones the board can actually paint; a scene a theme has to earn is not here.
//
// A tap previews: the scene goes full-bleed behind the card and the kid's hero stands on it
// (the parallax on swipe is Andjroo's riv; the slot is the stage). THAT ONE writes it, SKIP
// leaves the default, and both go on to the goal path.

import { api } from "./api.js";
import { state, $, esc, t } from "./util.js";
import { refreshCatalog } from "./data.js";
import { animSlot, climbScreen, hexTile, lipButton, markPicked, thatOne } from "./climb-shell.js";
import { heroArt } from "./hero.js";

function scenes() {
  return (state.catalog?.backgrounds ?? []).filter((b) => b.url);
}

function grid(list) {
  return list.map((b, i) => hexTile(
    `<img src="${esc(b.url)}" alt="" draggable="false" class="ob-scene" />`,
    { attrs: `data-place="${esc(b.id)}"`, label: b.label ?? b.id },
  )).join("");
}

/** Paint the tapped scene behind the card, the way setScreen paints a chosen one. */
function preview(url) {
  const root = $("kid-app");
  root.classList.add("bg-image");
  root.style.backgroundImage = `url('${esc(url)}')`;
  document.querySelector(".ob")?.classList.add("is-previewing");
}

export async function showPlacePicker(child, done) {
  // The catalogue is normally read after login (selectChild); here we are before it.
  if (!state.catalog) await refreshCatalog();
  const list = scenes();
  // No catalogue on this tablet: nothing to show, and the climb carries on.
  if (!list.length) return done();

  let picked = null;
  climbScreen({
    cls: "ob-place",
    title: t("app.obPlaceTitle"),
    sub: t("app.obPlaceSub"),
    body: `<div class="ob-grid ob-grid-3">${grid(list)}</div>`,
    // The kid's hero on the ground line of the scene they tapped: the `place` slot once
    // Andjroo's riv lands (it waits, the bands parallax on swipe), the hero's still until then.
    foot: `
      ${animSlot("place", { hero: child.hero })}
      ${child.hero ? `<img class="ob-hero-stand" src="${heroArt(child.hero)}" alt="" draggable="false" />` : ""}
      ${lipButton("ob-skip", t("app.obSkip"), { tone: "secondary" })}
      ${lipButton("ob-that", thatOne(), { disabled: true })}`,
  });

  document.querySelectorAll(".ob-tile").forEach((tile) => {
    tile.querySelector(".duo-node-face").onclick = () => {
      picked = tile.dataset.place;
      markPicked(tile, "ob-that");
      preview(list.find((b) => b.id === picked)?.url ?? "");
    };
  });

  $("ob-skip").onclick = done;
  let busy = false;
  $("ob-that").onclick = async () => {
    if (!picked || busy) return;
    busy = true;
    const res = await api.putPrefs(child.id, { backgroundId: picked }).catch(() => null);
    busy = false;
    if (res?.prefs) state.prefs = res.prefs;
    done();
  };
}
