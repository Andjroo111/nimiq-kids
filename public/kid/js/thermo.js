// THE SAVINGS THERMOMETER (#355, epic #350) — what the kid is saving for, on their money screen.
//
// Its own file because money.js is 284 lines and wallet.css 710, and the CI guard bites at 800.
//
// A THERMOMETER, because Andjroo asked for one by name: bulb, stem, and a fill that rises. Not a
// horizontal progress bar. The kid app is a drawn app and the metaphor IS the ask.
//
// ⚠️ IT IS A MIRROR, AND THE COPY SAYS SO FROM THE FIRST SCREEN. Nothing is set aside: if the kid
// spends, the fill drops. That is stated in the picker before they ever set a target ("this is
// your money, this is how far it has got"), because a meter that quietly goes down after the fact
// feels like the app took something.
//
// THE NUMBER IS "40 NIM TO GO", NEVER 62%. A six year old does not read a percentage. `pct` is
// still used, but only to drive the height of the fill, which is a picture and not a number.
//
// The server owns the arithmetic (src/repo-savings.ts). Everything here reads `w.savings`, which
// rides on the wallet poll the screen already runs — no new poll, per the issue.

import { $, esc, t, fmtNimLuna, state, openSheet, closeSheet } from "./util.js";
import { targetIcon } from "./icons.js";
import { api } from "./api.js";
import { celebrate } from "/js/lib/confetti.js";

/** Told them about this target already? Per target id, so a NEW target can celebrate again. */
const PARTY_KEY = (targetId) => `kid.savedParty.${targetId}`;

/**
 * The drawn thermometer. One SVG, sized by CSS, with only the fill's height driven by JS.
 *
 * The bulb is always full: a thermometer with an empty bulb reads as broken rather than as
 * empty, and at 0% the kid needs to see the shape of the thing they are filling.
 */
function thermoSvg(pct) {
  // The stem's inner track runs y=8..64 in the viewBox; the fill grows upward from the bulb.
  const H = 56;
  const h = Math.round((Math.max(0, Math.min(100, pct)) / 100) * H);
  const y = 8 + (H - h);
  return `
    <svg class="k-th-svg" viewBox="0 0 28 88" role="img" aria-hidden="true">
      <rect class="k-th-track" x="9" y="6" width="10" height="60" rx="5" />
      ${h > 0 ? `<rect class="k-th-fill" x="9" y="${y}" width="10" height="${h + 4}" rx="5" />` : ""}
      <circle class="k-th-bulb" cx="14" cy="74" r="12" />
      <rect class="k-th-glass" x="9" y="6" width="10" height="60" rx="5" />
    </svg>`;
}

/**
 * The card, or the invitation to make one.
 *
 * `savings` is null when the kid is not saving for anything, and that is a first-class state
 * rather than a hidden component: an empty thermometer that says what it is for is how a kid
 * finds out the feature exists at all.
 */
export function thermometer(savings) {
  if (!savings) {
    return `
      <button class="k-th k-th-empty" id="th-set">
        ${targetIcon("k-th-empty-ic")}
        <span class="k-th-empty-main">
          <span class="k-th-empty-title">${esc(t("app.kidSaveForTitle"))}</span>
          <span class="k-th-empty-sub">${esc(t("app.kidSaveForSub"))}</span>
        </span>
      </button>`;
  }
  const { target, remainingLuna, pct, reached } = savings;
  return `
    <div class="k-th${reached ? " is-reached" : ""}" id="th-card">
      ${thermoSvg(pct)}
      <div class="k-th-main">
        <div class="k-th-head">
          <span class="k-th-emoji">${target.emoji ? esc(target.emoji) : targetIcon()}</span>
          <span class="k-th-title">${esc(target.title)}</span>
        </div>
        <div class="k-th-togo">${
          reached
            ? esc(t("app.kidSavedGot"))
            : esc(t("app.kidSaveToGo", { amount: fmtNimLuna(remainingLuna) }))
        }</div>
        <button class="k-th-edit" id="th-edit">${esc(t("app.kidSaveChange"))}</button>
      </div>
    </div>`;
}

/**
 * Celebrate ONCE, then read as reached.
 *
 * A bar sitting at full forever stops being an event; the confetti is the event and the calm
 * "you got it" is the state. Keyed per TARGET, so the next thing a kid saves for gets its own
 * moment rather than inheriting a flag from the last one.
 */
export function celebrateIfJustReached(savings) {
  if (!savings?.reached) return;
  const key = PARTY_KEY(savings.target.id);
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch { return; } // private mode: no party rather than one on every poll
  celebrate();
}

/** Wire the card. `after` re-renders the money screen once a target changes. */
export function wireThermometer(after) {
  const open = () => sheetPick(after);
  $("th-set") && ($("th-set").onclick = open);
  $("th-edit") && ($("th-edit").onclick = (ev) => { ev.stopPropagation(); open(); });
}

/**
 * Pick something to save for: a Treasure Box item, or anything at all in the kid's own words.
 *
 * The shelf comes first because it is the case with a real price attached — "save for this"
 * straight off an item the kid has already been looking at. Free text is the escape hatch for a
 * bike, which no shelf has.
 */
async function sheetPick(after) {
  // The shelf the kid already browses, minus screen time: "save up for 15 minutes of tablet" is
  // a target you reach and spend in the same breath, which is not what a thermometer is for.
  const store = state.store ?? (await api.store(state.child.id).catch(() => null));
  const picks = (store?.items ?? []).filter((i) => i.kind !== "screen_time" && !i.owned).slice(0, 8);
  const kidId = state.child.id;

  openSheet(`
    <h2 class="k-sheet-title">${esc(t("app.kidSaveForTitle"))}</h2>
    <p class="k-th-honest">${esc(t("app.kidSaveHonest"))}</p>
    <div class="k-th-picks">
      ${picks.map((i) => `
        <button class="k-th-pick" data-item="${esc(i.id)}" data-price="${i.priceLuna}">
          <span class="k-th-pick-t">${esc(i.title)}</span>
          <span class="k-th-pick-p">${fmtNimLuna(i.priceLuna)} NIM</span>
        </button>`).join("")}
    </div>
    <div class="k-th-own">
      <input class="k-th-own-title" id="th-title" maxlength="40"
             placeholder="${esc(t("app.kidSaveOwnPh"))}" />
      <input class="k-th-own-amt" id="th-amt" type="number" inputmode="numeric" min="1"
             placeholder="NIM" />
      <button class="k-th-go" id="th-save">${esc(t("app.kidSaveGo"))}</button>
    </div>
    ${state.wallet?.savings ? `<button class="k-th-clear" id="th-clear">${esc(t("app.kidSaveStop"))}</button>` : ""}`);

  const done = () => { closeSheet(); after?.(); };
  document.querySelectorAll(".k-th-pick").forEach((b) => (b.onclick = async () => {
    await api.setSavings(kidId, { itemId: b.dataset.item }).catch(() => null);
    done();
  }));
  if ($("th-save")) $("th-save").onclick = async () => {
    const title = $("th-title").value.trim();
    const nim = Number($("th-amt").value);
    if (!title || !Number.isFinite(nim) || nim <= 0) return;
    await api.setSavings(kidId, { title, targetLuna: Math.round(nim * 1e5) }).catch(() => null);
    done();
  };
  if ($("th-clear")) $("th-clear").onclick = async () => {
    await api.clearSavings(kidId).catch(() => null);
    done();
  };
}

