// nimiq.kids kid app — a GOAL is a path you climb (duo-ui, 2026-09-13).
//
// The bottom sheet of rows (goal.js, retired) told the four rung states apart with a tick
// on the left. This is the Duolingo shape instead: its own screen, a banner, the prize under
// it, then the rungs winding DOWN to rung one at the bottom, because in
// Duolingo you go up. Every node is the Nimiq hexagon (duo-node, never a circle); the one rung
// the kid can reach wears the egg plate's tunnel and a bubble that names it.
//
// The components are the nq registry's duo-path / duo-node / duo-button, vendored under
// /kid/vendor/duo and read on the DEFAULT Nimiq map: blue is the action, green is a rung
// climbed, gold is the prize. Nothing is mapped here (Andjroo: "just use whatever the correct
// NIMIQ version would be").
//
// Money never moves on a tap of a kid's. The open rung calls `onClaim`, which opens the
// parent's approval exactly as handing in a chore does; the server refuses anything else
// (`rungClaimable`), so wiring only the open node is manners rather than the fence.

import { $, esc, t, setScreen, bgFor, rowTitle, fmtNimWhole, parentName } from "./util.js";
import { arrowIcon, checkIcon } from "./icons.js";

/** The verbatim Nimiq hexagon, 20:18 (nimiq-ui rule 22), drawn twice on the active rung:
 *  the groove and the fluid of the tunnel. `pathLength=100` makes the dash a percentage. */
const HEX = "M19.964 8.156 15.758.844A1.69 1.69 0 0014.299 0H5.887c-.6 0-1.156.32-1.456.844L.225 8.156c-.3.523-.3 1.165 0 1.688l4.206 7.312c.3.523.856.844 1.456.844h8.412c.6 0 1.156-.32 1.456-.844l4.206-7.312a1.69 1.69 0 00.003-1.688z";
const ring = () => `<svg class="duo-node-ring" viewBox="0 0 20 18" aria-hidden="true">
  <path class="duo-node-track" d="${HEX}"/><path class="duo-node-arc" d="${HEX}" pathLength="100"/></svg>`;

/** goal.js rung state → duo-node class. One class on the wrapper, the component does the rest. */
const NODE_CLASS = { locked: "is-locked", open: "is-active", waiting: "is-waiting", climbed: "is-done" };

/** What sits in the face: GENERIC marks, on purpose. Andjroo, 2026-09-13: the characters, the
 *  boss stickers and the emoji icons are all being redrawn and none of the current ones ship,
 *  so the path reads with nothing but its own vocabulary: the rung's NUMBER until it is
 *  climbed, the wallet's check once it is, and a gift on the prize. The node is the frame;
 *  when the new art lands it goes inside the face as an <img> and nothing here moves. */
const rungMark = (r, n) => (r.state === "climbed"
  ? checkIcon("gp-mark")
  : `<span class="gp-num" aria-hidden="true">${n}</span>`);
/** nimiq-icons gift, the same glyph the registry's own duo-path demo puts on the prize. */
const giftIcon = () => `<svg viewBox="0 0 11 12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width=".956" d="M5.5 4v6.5m0-6.5c-.166-.745-.451-1.382-.82-1.828-.367-.446-.8-.68-1.242-.672a1.1 1.1 0 00-.81.366 1.3 1.3 0 00-.336.884c0 .332.12.65.335.884a1.1 1.1 0 00.81.366M5.5 4c.166-.745.451-1.382.82-1.828.367-.446.8-.68 1.242-.672a1.1 1.1 0 01.81.366c.216.235.336.552.336.884s-.12.65-.335.884a1.1 1.1 0 01-.81.366m1.145 2v3.5c0 .265-.096.52-.268.707a.88.88 0 01-.648.293H3.208a.88.88 0 01-.648-.293 1.05 1.05 0 01-.268-.707V6m-.459-2h7.334a.5.5 0 01.5.5V6H1.333V4.5a.5.5 0 01.5-.5z"/></svg>`;

/** One rung. The bubble carries the rung's TITLE (the point of a kids step) and, under it,
 *  what the rung pays; the component only shows it on the active node. The tunnel's fluid is
 *  how far up the ladder the kid has got: a rung is yes-or-no, the climb is not. */
function rungNode(r, n, progress) {
  const cls = NODE_CLASS[r.state] ?? "is-locked";
  const active = r.state === "open";
  const pay = active && r.rewardLuna > 0
    ? `<span class="gp-bubble-pay">+${fmtNimWhole(r.rewardLuna)} NIM</span>` : "";
  return `
    <li class="duo-path-step">
      <div class="duo-node ${cls}" data-rung="${esc(r.id)}"${active ? ` style="--duo-progress: ${progress}"` : ""}>
        ${active || r.state === "waiting" ? ring() : ""}
        ${active ? `<span class="duo-node-bubble">${esc(rowTitle(r))}${pay}</span>` : ""}
        <button class="duo-node-face" type="button" aria-label="${esc(rowTitle(r))}"${active ? "" : " tabindex=\"-1\""}>
          ${rungMark(r, n)}
        </button>
      </div>
    </li>`;
}

/** The prize, last in DOM so column-reverse puts it under the banner. Grey until it is won
 *  (the component's own locked prize), gold after. Since 2026-09-17 the face is ART: the
 *  theme's PACK EGG while the set is unfinished, the boss once it is owned, both as the
 *  <img> at 72% the component reserves (the 09-13 decision: the node is the frame, the art
 *  goes inside the face). The gift stays as the face of a theme with no egg drawn. */
function prizeNode(boss, eggUrl) {
  const art = boss.owned ? boss.assetUrl : eggUrl;
  return `
    <li class="duo-path-step">
      <div class="duo-node is-prize${boss.owned ? "" : " is-locked"}">
        <button class="duo-node-face" type="button" aria-label="${esc(boss.label)}" tabindex="-1">
          ${art ? `<img src="${esc(art)}" alt="" draggable="false" />` : giftIcon()}
        </button>
      </div>
    </li>`;
}

/** WHAT THEY ARE COLLECTING, above the path, because it is the reason to climb. The sheet's
 *  rule, minus the art: an earned slot is a filled well and an unearned one a dashed well, so
 *  3 of 5 has to look like two more to go. No sticker inside either (see rungMark). */
function setStrip(theme) {
  if (!theme) return "";
  const slot = (s, extra = "") => `<span class="gl-slot ${extra} ${s.owned ? "is-on" : ""}"></span>`;
  return `
    <div class="gl-set">
      ${theme.slots.map((s) => slot(s)).join("")}
      ${theme.boss ? slot(theme.boss, "gl-slot-boss") : ""}
    </div>
    <p class="gl-set-line">${esc(theme.complete
      ? t("app.kidSetDone")
      : t("app.kidSetGoing", { done: theme.collected, total: theme.total }))}</p>`;
}

/** The line under the path: the bubble already says which rung to tap, so this only has to
 *  cover the two moments there is no bubble, a rung with a grown-up and a ladder that is done. */
function footer(g, rungs) {
  if (g.done) return t("app.kidGoalFinished");
  if (rungs.some((r) => r.state === "open")) return t("app.kidGoalNext");
  if (rungs.some((r) => r.state === "waiting")) return t("app.kidWaiting", { name: parentName() });
  return "";
}

/**
 * g    — the goal's row out of state.chart.goals
 * opts — { onClaim(rungId), onBack() }. onClaim is called once, for a rung that is open.
 */
export function showGoalPath(g, opts) {
  const rungs = g.rungs ?? [];
  const progress = g.total ? Math.round((g.climbed / g.total) * 100) / 100 : 0;
  const boss = g.theme?.boss;
  const line = footer(g, rungs);

  // The back button is chrome and floats OUTSIDE the slab (kid-slab-screens.test.ts).
  setScreen(`
    <div class="gp">
      <button class="back-btn" id="gp-back">${arrowIcon("left")}</button>
      <div class="k-slab gp-slab">
        <div class="gp-scroll" id="gp-scroll">
          ${setStrip(g.theme)}
          <section class="duo-path">
            <header class="duo-path-head">
              <div class="duo-path-head-text">
                <p class="duo-path-kicker">${esc(t("app.kidGoalRungs", { done: g.climbed, total: g.total }))}</p>
                <h2 class="duo-path-title">${esc(rowTitle(g))}</h2>
              </div>
            </header>
            <ol class="duo-path-steps">
              ${rungs.map((r, i) => rungNode(r, i + 1, progress)).join("")}
              ${boss ? prizeNode(boss, g.theme?.eggUrl ?? null) : ""}
            </ol>
          </section>
          ${line ? `<p class="pr-steps-total">${esc(line)}</p>` : ""}
        </div>
      </div>
    </div>`, "k-screen k-goal", bgFor());

  $("gp-back").onclick = () => opts.onBack();

  // Only the OPEN rung is wired; locked, waiting, done and the prize have no pointer events.
  const face = document.querySelector(".gp .duo-node.is-active .duo-node-face");
  if (face) {
    face.onclick = () => {
      face.disabled = true; // a double tap would claim it twice
      opts.onClaim(face.closest("[data-rung]").dataset.rung);
    };
  }

  // Open ON the rung that matters. A fresh ladder has its first rung at the bottom of a
  // column that is taller than a phone, and a kid who opens a goal and sees only the prize
  // and three grey hexagons has been shown the wrong end of it.
  const focus = document.querySelector(".gp .duo-node.is-active, .gp .duo-node.is-waiting");
  if (focus && !g.done) focus.closest("li").scrollIntoView({ block: "center" });
}
