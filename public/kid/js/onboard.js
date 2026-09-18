// nimiq.kids kid app — the kid's CLIMB (2026-09-18): the five screens a kid sees the first
// time the tablet is theirs, in order, on the Duolingo mechanics.
//
//   1  Hi, Sam        the nickname the parent typed, one button          (here)
//   2  the money face the identicon, ONE-WAY, it is the wallet address   (character.js)
//   3  the character  one of the 21 heroes, re-pickable                  (hero.js)
//   4  the place      one of the catalogue scenes, skippable             (place.js)
//   5  the goal path  the parent's first goal, rung one, START           (main.js lands it)
//
// WHAT DECIDES A KID CLIMBS: `children.hero` is null. The kid area is a shared tablet, so
// nothing per kid may live in localStorage; the server row is the only memory. A kid who
// picked a hero has been up the climb, whatever else they skipped.
//
// The order is the point. The money face comes BEFORE anything reads the wallet, because
// `refreshWallet()` is the call that would mint an address for a kid who has none, and that
// mint is birth order rather than a choice (see character.js). main.js keeps that ordering:
// the climb runs before the wallet, and the rest of login resumes through `done`.

import { esc, t } from "./util.js";
import { animSlot, climbScreen, lipButton, TRIO } from "./climb-shell.js";
import { showCharacterPicker } from "./character.js";
import { showHeroPicker } from "./hero.js";
import { showPlacePicker } from "./place.js";

/** Has this kid been up the climb? The hero is the last thing that is not skippable. */
export const needsClimb = (child) => !child.hero;

/** The kid's emoji as one of the 21 lineless heroes (public/assets/heroes), the same
 *  drawing the hatch and the timer use. Andjroo, 2026-09-18, on the raw 🦖 at the top of the
 *  climb: "it needs to be on brand. It could still be the dinosaur." The default kid emoji is
 *  the T-rex, so the default stage is hero-trex. An emoji nobody has drawn (the demo's Ava is
 *  a 🦄) is the T-rex too: the raw emoji is the OS's drawing, and Andjroo saw exactly that,
 *  "an old unicorn", on the demo the same day. The stage is always one of ours. */
const HERO_FOR_EMOJI = {
  "🦖": "trex", "🐸": "frog", "🐙": "octopus", "🐰": "bunny", "🐇": "bunny", "🐳": "whale", "🐋": "whale",
  "🐢": "turtle", "🦆": "duck", "🐯": "tiger", "🐱": "cat", "🐈": "cat", "🐼": "panda", "🐧": "penguin",
  "🦉": "owl", "🐝": "bee", "🦔": "hedgehog", "🐌": "snail", "🐷": "pig", "🐖": "pig", "🦒": "giraffe",
  "🦥": "sloth", "🐶": "corgi", "🐕": "corgi", "🦝": "raccoon", "🦎": "axolotl",
};
export const heroArtFor = (emoji) => {
  const id = HERO_FOR_EMOJI[String(emoji ?? "").replace(/\uFE0F/g, "")] ?? "trex";
  return `/assets/heroes/hero-${id}.png`;
};

/** Screen 1. The opener's trio (frog, penguin, octopus, WP4 2026-09-18) greets and answers
 *  taps, the plan's "three characters, each doing something different". While the files are
 *  unreachable the stage shows the kid's own character, drawn (heroArtFor), so the screen is
 *  never empty and never the OS's emoji: the slots are hidden while blank (`.anim:empty`),
 *  the stand-in while any slot is full. */
function showHi(child, next) {
  const standIn = `<img class="ob-stage-emoji ob-stage-hero" src="${esc(heroArtFor(child.emoji))}" alt="" draggable="false" />`;
  const cast = TRIO.map((h) => animSlot(`hi-${h}`, { hero: h })).join("");
  climbScreen({
    cls: "ob-hi",
    stage: `<div class="ob-stage" aria-hidden="true"><div class="ob-cast">${cast}</div>${standIn}</div>`,
    title: t("app.obHi", { name: child.label }),
    foot: lipButton("ob-go", t("app.obGo")),
  });
  document.getElementById("ob-go").onclick = next;
}

/**
 * Run the climb for `child` and call `done()` at the top of it.
 *
 * Each screen hands the next one its own continuation, so a screen that has nothing to ask
 * (the money face on a parent-custody instance, the place when no catalogue reached the
 * tablet) can step aside without the others knowing.
 */
export function showClimb(child, done) {
  showHi(child, () =>
    showCharacterPicker(child, () =>
      showHeroPicker(child, { onDone: () =>
        showPlacePicker(child, done) })));
}
