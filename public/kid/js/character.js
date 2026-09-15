// "Which one is you?" — the screen where a kid chooses their own character (#381).
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
// The reader is four. No address is shown, no index, no word about accounts. Nine pictures, a
// button that says try different ones, and their name at the top.

import { api } from "./api.js";
import { $, esc, t, setScreen, identiconImg, paintIdenticons } from "./util.js";
import { armSceneCoach } from "./coach.js";

/** Rendered state for one visit to this screen. Never outlives it. */
let offer = null;
let busy = false;

function grid() {
  return offer.choices.map((c, i) => `
    <button class="k-char-tile" type="button" data-index="${esc(String(c.index))}"
            aria-label="${esc(t("app.charPickOne", { n: String(i + 1) }))}">
      ${identiconImg(c.address, "k-char-iqon")}
    </button>`).join("");
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
  // does not derive them. Either way there is nothing to choose and the app carries on rather
  // than parking a child in front of an empty grid.
  if (!offer) return done();

  setScreen(`
    <div class="k-connect k-charpick">
      <div class="small-page nq-card k-connect-card">
        <div class="page-header nq-card-header">
          <h1 class="nq-h1">${esc(t("app.charTitle", { name: child.label }))}</h1>
          <p class="nq-notice">${esc(t("app.charSub"))}</p>
        </div>
        <div class="page-body nq-card-body">
          <div class="k-char-grid">${grid()}</div>
          ${message ? `<p class="k-char-message">${esc(message)}</p>` : ""}
          ${offer.shufflesLeft > 0
            ? `<button class="nq-button-s k-char-shuffle" type="button">${esc(t("app.charShuffle"))}</button>`
            : `<p class="k-char-message">${esc(t("app.charNoMore"))}</p>`}
        </div>
      </div>
    </div>`, "k-screen k-connect-screen");
  paintIdenticons();

  document.querySelectorAll(".k-char-tile").forEach((tile) => {
    tile.onclick = () => pick(child, done, Number(tile.dataset.index));
  });
  const shuffle = $(".k-char-shuffle");
  if (shuffle) shuffle.onclick = () => { if (!busy) draw(child, done); };
}

async function pick(child, done, index) {
  if (busy) return;
  busy = true;
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
  await draw(child, done, t("app.charTryAgain"));
}
