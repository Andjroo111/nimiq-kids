// nimiq.kids parent — the climb's step 5: the kid's FIRST GOAL from a template (WP2, corrected
// 2026-09-18). A prize on top (a theme pack, data only), a goal template (a skill in steps),
// and a live preview of the path the kid will see. Own module: views-onboard.js is the state
// machine and the other six screens, and the two together would sit on the 800-line guard.
//
// A GOAL IS NOT A CHORE. Andjroo, 2026-09-18: nimiq.kids has two separate things, the everyday
// loop (jobs and routines on the board) and goals (a ladder of steps to manage, a prize on
// top). The first cut of this screen let the parent keep or swap three STARTER CHORES as the
// ladder's rungs, which fused the two. Now the three starter jobs land on the board on their
// own (routes/onboard.ts does that whatever this screen sends) and this screen picks the
// ladder: a prize and a template whose steps are goal-shaped (src/goal-templates.ts).
//
// WHAT IS SENT. `goalDraft()` hands views-onboard.js the `goal` field of the ONE POST
// /api/onboard ({ packId, template }); the route builds the ladder with the family.
//
// THE PREVIEW IS THE KID'S PATH. duo-path, climbed (prize under the banner, rung one at the
// bottom), rung one active with its bubble, on the paint-set map. The prize node draws what
// the kid's own path draws (goal-path.js prizeNode): the pack's EGG while the set is
// unfinished, the boss once it is owned, the gift only for a ladder that collects nothing.
// Andjroo, 2026-09-18, on a gift glyph in every tile: "the packs should have their actual
// [art] inside". The picker tiles carry the pack's boss, the prize the kid is climbing for.

import { t } from "./core.js";
import { esc } from "./fmt.js";
import { ring, giftIcon } from "./duo-bits.js";

// ---- the draft, kept across re-renders (a language flip repaints the screen) ----
const draft = { packId: null, template: "shoes" };
let themes = null;      // GET /api/goal-themes, open to anyone, fetched once
let templates = null;   // GET /api/goal-templates, the same

/** The `goal` field of POST /api/onboard. */
export function goalDraft() {
  return { packId: draft.packId, template: draft.template };
}

/** Both catalogues, once. Resolves when the screen can be drawn with names on it. */
export async function loadGoalData() {
  if (!themes) {
    themes = await fetch("/api/goal-themes").then((r) => (r.ok ? r.json() : { themes: [] }))
      .then((d) => d.themes ?? []).catch(() => []);
  }
  if (!templates) {
    templates = await fetch("/api/goal-templates").then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => d.templates ?? []).catch(() => []);
    if (templates.length && !templates.some((x) => x.id === draft.template)) draft.template = templates[0].id;
  }
}

const picked = () => (templates ?? []).find((x) => x.id === draft.template) ?? null;

// ---- markup ----

const pickedTheme = () => (themes ?? []).find((th) => th.packId === draft.packId) ?? null;

/* THE GROUND UNDER A BOSS. Andjroo, 2026-09-18, on the grey tiles: the seahorse, the astronaut
   and the robot are near white and vanished. Measured against all five paints, blurple is the
   one ground all four bosses read on (yolk loses the gold dragon, white loses the three white
   ones), so a pack tile is a blurple hexagon, the action to pick one. Just the NIM stays the
   yolk prize hex with the gift. The picked tile wears the START node's ring (is-active, fluid
   off) on top of the tinted tile, so selection is a ring and a tint, never a colour swap. */
function prizeTiles() {
  const tile = (packId, label, art) => {
    const on = draft.packId === packId;
    return `
    <button type="button" class="climb-prize ${on ? "is-on" : ""}"
      data-pack="${esc(packId ?? "")}" aria-pressed="${on}">
      <span class="duo-node ${art ? "" : "is-prize"} ${on ? "is-active" : ""}">${on ? ring() : ""}<span class="duo-node-face">${art ? `<img src="${esc(art)}" alt="" draggable="false" />` : giftIcon()}</span></span>
      <span class="climb-prize-name">${esc(label)}</span>
    </button>`;
  };
  return `<div class="climb-prizes" role="group" aria-label="${esc(t("papp.climbPrize"))}">
    ${(themes ?? []).map((th) => tile(th.packId, th.titleKey ? t(th.titleKey) : th.title, th.boss?.assetUrl ?? th.eggUrl ?? null)).join("")}
    ${tile(null, t("papp.climbNoPrize"), null)}
  </div>`;
}

/** The templates as a list: the skill, its step count, the picked one marked. */
function templateRows() {
  return `<ol class="climb-rungs" role="group" aria-label="${esc(t("papp.climbSteps"))}">${(templates ?? []).map((x) => `
    <li class="climb-rung climb-tpl ${x.id === draft.template ? "is-on" : ""}">
      <button type="button" class="climb-tpl-btn" data-template="${esc(x.id)}" aria-pressed="${x.id === draft.template}">
        <span class="climb-rung-job">${x.iconUrl ? `<img class="climb-rung-icon" src="${esc(x.iconUrl)}" alt="" draggable="false" />` : `<span class="climb-rung-emoji" aria-hidden="true">${esc(x.emoji)}</span>`}${esc(t(x.titleKey))}</span>
        <span class="climb-tpl-n">${esc(t("papp.climbStepCount", { n: x.steps }))}</span>
      </button>
    </li>`).join("")}</ol>`;
}

/** The kid's path, as it will open: the template's steps climbed in order, the prize under the
 *  banner. */
function preview() {
  const x = picked();
  if (!x) return "";
  const node = (key, i) => {
    const active = i === 0;
    return `<li class="duo-path-step">
      <div class="duo-node ${active ? "is-active" : "is-locked"}"${active ? ' style="--duo-progress: 0"' : ""}>
        ${active ? ring() : ""}
        ${active ? `<span class="duo-node-bubble">${esc(t(key))}</span>` : ""}
        <span class="duo-node-face" aria-label="${esc(t(key))}">${i + 1}</span>
      </div>
    </li>`;
  };
  return `<section class="duo-path climb-preview" aria-hidden="true">
    <header class="duo-path-head">
      <div class="duo-path-head-text">
        <p class="duo-path-kicker">0 / ${x.steps}</p>
        <h2 class="duo-path-title">${esc(t(x.titleKey))}</h2>
      </div>
    </header>
    <ol class="duo-path-steps">
      ${x.stepKeys.map(node).join("")}
      <li class="duo-path-step"><div class="duo-node is-prize is-locked"><span class="duo-node-face">${pickedTheme()?.eggUrl ? `<img src="${esc(pickedTheme().eggUrl)}" alt="" draggable="false" />` : giftIcon()}</span></div></li>
    </ol>
  </section>`;
}

/** The step's body, under the progress bar views-onboard.js draws. Andjroo, 2026-09-18, final:
 *  the title, one line under it, then the prizes, the templates and the preview; no section
 *  labels and no other explaining. The group labels survive as aria-labels only. */
export function goalHtml() {
  return `
    <h2 class="climb-title">${t("papp.climbGoalTitle")}</h2>
    <p class="climb-sub">${t("papp.climbGoalSub")}</p>
    ${prizeTiles()}
    ${templateRows()}
    ${preview()}`;
}

/** Wire the tiles. `repaint` re-renders the step (the host's render). */
export function wireGoal(el, repaint) {
  el.querySelectorAll("[data-pack]").forEach((b) => (b.onclick = () => {
    draft.packId = b.dataset.pack || null;
    repaint();
  }));
  el.querySelectorAll("[data-template]").forEach((b) => (b.onclick = () => {
    draft.template = b.dataset.template;
    repaint();
  }));
}
