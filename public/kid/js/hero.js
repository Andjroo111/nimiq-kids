// "Pick your character" — screen 3 of the climb (2026-09-18), and the me sheet's re-pick.
//
// Twenty-one heroes, the ones drawn for the egg timer (public/assets/heroes), each inside a
// hexagon tile at the 72% the node reserves for art. Tap one and it is picked (the tapped hero
// reacts: Andjroo's riv, the slot is the tile); tap THAT ONE and it is written to the row.
// Two taps rather than one, unlike the money face next door, because this one is a choice a
// kid gets to look at before it counts, and because it is the last screen that is not
// skippable, so the confirm is the moment the climb is on record.
//
// Art, not money: `PATCH /api/kids/:id/hero` may be called again whenever they like, which is
// what the me sheet offers. The identicon has no such door.

import { api } from "./api.js";
import { $, esc, t } from "./util.js";
import { animSlot, climbScreen, hexTile, lipButton, markPicked, remountAnim, thatOne } from "./climb-shell.js";

/** The list, in the server's order. Written out rather than fetched so an offline tablet has
 *  it; src/kid-hero.test.ts holds this copy, the server's, the art folder and the timer's
 *  roster to one another. */
const HEROES = [
  "axolotl", "bee", "bunny", "cat", "corgi", "duck", "frog", "giraffe", "hedgehog", "octopus",
  "owl", "panda", "penguin", "pig", "raccoon", "sloth", "snail", "tiger", "trex", "turtle",
  "whale",
];
export const heroArt = (id) => `/assets/heroes/hero-${id}.png`;
/** How long the confirm holds on the celebrating character before the next screen. */
const RIV_BEAT = 700;

function grid(current) {
  return HEROES.map((id, i) => hexTile(
    `<img src="${heroArt(id)}" alt="" draggable="false" />`,
    { attrs: `data-hero="${id}"`, label: t("app.obHeroPick", { n: String(i + 1) }), picked: id === current },
  )).join("");
}

/**
 * Draw the picker and call `onDone()` once the server has the pick. `onBack`, when given, puts
 * the floating back button on and is the re-pick's way out without changing anything.
 */
export function showHeroPicker(child, { onDone, onBack = null }) {
  let picked = child.hero ?? null;
  climbScreen({
    cls: "ob-hero",
    title: t("app.obHeroTitle"),
    body: `<div class="ob-grid ob-grid-3">${grid(picked)}</div>`,
    // The picked hero's slot: when the pick is one of the three that move (climb-shell RIV)
    // it stands here and does its move on the tap; the others stay their drawn tile.
    foot: `${animSlot("hero-pick", { hero: picked })}${lipButton("ob-that", thatOne(), { disabled: !picked })}`,
    back: onBack,
  });

  document.querySelectorAll(".ob-tile").forEach((tile) => {
    tile.querySelector(".duo-node-face").onclick = () => {
      picked = tile.dataset.hero;
      markPicked(tile, "ob-that");
      remountAnim(document.querySelector('[data-anim="hero-pick"]'), picked);
    };
  });

  let busy = false;
  $("ob-that").onclick = async () => {
    if (!picked || busy) return;
    busy = true;
    const res = await api.setHero(child.id, picked).catch(() => null);
    busy = false;
    if (!res?.child) return; // the button stays; a tap again retries
    child.hero = res.child.hero;
    // The celebrate on confirm: the character's own move, once more, then on to the place.
    document.querySelector('[data-anim="hero-pick"] canvas')?.click();
    setTimeout(onDone, RIV_BEAT);
  };
}
