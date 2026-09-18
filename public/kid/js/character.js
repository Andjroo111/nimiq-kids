// "Your money has a face" — the screen where a kid chooses their own identicon (#381,
// reworded and put on hexagon tiles for the climb, 2026-09-18).
//
// A Nimiq identicon is drawn from an address, and a server-custodied kid's address comes from
// one small integer. So these nine pictures are nine real accounts, and tapping one is what
// decides which of them is this kid's forever. That is the whole reason this screen exists
// before anything else: until now the integer was handed out as the next free number the first
// time anything touched the kid's wallet, so the character was birth order, not a choice.
//
// ONE-WAY. Once tapped it cannot be re-tapped: re-deriving would produce a different address and
// leave any NIM at the old one. The server refuses a second pick; this screen never offers one.
// Which is also why the shuffle lives here and not after: changing your mind is free right up
// until it isn't, and the moment it stops being free is the tap.
//
// The reader is four. The copy says what it is in their words ("this is your wallet address,
// it stays yours") and nothing more: no index, no key. Andjroo rewrites the lines; the draft is
// in src/locales/en.ts. Nine pictures, three by three, and a button that says show me more.

import { api } from "./api.js";
import { $, esc, t, identiconImg, paintIdenticons } from "./util.js";
import { armSceneCoach } from "./coach.js";
import { climbScreen, hexTile, lipButton } from "./climb-shell.js";

/** Rendered state for one visit to this screen. Never outlives it. */
let offer = null;
let busy = false;

function grid() {
  return offer.choices.map((c, i) => hexTile(identiconImg(c.address, "ob-iqon"), {
    attrs: `data-index="${esc(String(c.index))}"`,
    label: t("app.obFacePick", { n: String(i + 1) }),
  })).join("");
}

/**
 * Draw the picker for `child` and call `done()` once they have one.
 *
 * `done` is only ever called after the SERVER says the character is theirs, never on the tap.
 * A tap that loses a race with a sibling has to land back on this screen with a fresh nine, and
 * a screen that had already moved on could not do that.
 */
export async function showCharacterPicker(child, done) {
  busy = false;
  await draw(child, done);
}

async function loadOffer(child) {
  const res = await api.characterChoices(child.id).catch(() => null);
  return res && Array.isArray(res.choices) && res.choices.length ? res : null;
}

async function draw(child, done, message = "") {
  offer = await loadOffer(child);
  // No offer means the question is already answered — the kid has an account, or this instance
  // does not derive them. Either way there is nothing to choose and the climb carries on rather
  // than parking a child in front of an empty grid.
  if (!offer) return done();

  climbScreen({
    cls: "ob-face",
    title: t("app.obFaceTitle"),
    sub: t("app.obFaceSub"),
    body: `
      <div class="ob-grid ob-grid-9">${grid()}</div>
      ${message ? `<p class="ob-note">${esc(message)}</p>` : ""}
      ${offer.shufflesLeft > 0 ? "" : `<p class="ob-note">${esc(t("app.obFaceNoMore"))}</p>`}`,
    // The shuffle is the second thing offered, so it is the paper button, never the action one:
    // a blue button under nine faces would make choosing feel like a decision about the button.
    foot: offer.shufflesLeft > 0 ? lipButton("ob-more", t("app.obFaceMore"), { tone: "secondary" }) : "",
  });
  paintIdenticons();

  document.querySelectorAll(".ob-tile").forEach((tile) => {
    tile.querySelector(".duo-node-face").onclick = () => pick(child, done, Number(tile.dataset.index), tile);
  });
  const more = $("ob-more");
  if (more) more.onclick = () => { if (!busy) draw(child, done); };
}

async function pick(child, done, index, tile) {
  if (busy) return;
  busy = true;
  // The tile stays pressed while the server answers: the lip is the tap landing, and the
  // animation slot after it (the picked face rides to the corner) is Andjroo's.
  tile.classList.add("is-picked");
  const res = await api.chooseCharacter(child.id, { setId: offer.setId, index }).catch((e) => e);
  busy = false;

  const address = res?.child?.address;
  if (address) {
    // The row this app is holding is now stale in the one way that matters: it has an address.
    child.address = address;
    // ARM THE SCENE HINT HERE, not on the board (#407). This is the first-login moment, and the
    // pill the hint points at only exists on the screen after this one. Armed AFTER the server
    // agreed, alongside the address, so a pick that lost a race to a sibling arms nothing.
    armSceneCoach(child.id);
    return done();
  }

  // Every refusal lands the same way on this screen, because a four-year-old cannot act on the
  // difference between "a sibling took that one" and "that offer got old". They can act on
  // "here are some more", which is what a redraw is.
  await draw(child, done, t("app.obFaceTryAgain"));
}
