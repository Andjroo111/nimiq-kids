// nimiq.kids parent — GOALS on the board: the ladder a kid climbs.
//
// Its own file rather than another hundred lines of views-board.js, which was at 713 of the
// repo's 800-line guard. The split is along the seam the screen already has: this module owns
// one section, and borrows the pieces every section shares (the face, the reward field, the
// one outcome path) from views-board.js rather than growing a second copy of them.
//
// A goal is a CARD, like a routine and like a practice that has exercises, because it contains
// things and the rungs are the point. What is different is one control the other two do not
// have: whether the ladder is climbed IN ORDER. Andjroo, 2026-08-04 — "sometimes it could be
// any of them, sometimes they don't need to go in order". Holding a plank longer every week is
// a sequence; five swimming badges are not, and the parent is the one who knows which.

import { rowTitle, state, t, call, toast, openSheet, $ } from "./core.js";
/** The themes, fetched once. A ladder's theme is art, not household data, so the list is the
 *  same for every family and there is no reason to re-read it per sheet. */
let themes = null;
async function loadThemes() {
  if (themes) return themes;
  const r = await call("GET", "/api/goal-themes").catch(() => null);
  themes = r?.status === 200 ? r.data.themes ?? [] : [];
  return themes;
}
import { esc } from "./fmt.js";
import { jobPickerHtml, wireJobPicker } from "/js/lib/job-picker.js";
import { ring, giftIcon, NODE_CLASS } from "./duo-bits.js";
import {
  face, faceUrl, finish, jobGroups, nimLabel, rewardField, rewardLunaValue, wireReward,
} from "./views-board.js";

/** What a rung looks like on the parent's side: its price, and where the kid has got to.
 *  The four states are the server's own (`goalView`), never re-derived here. */
const RUNG_STATE = {
  climbed: "papp.boardRungClimbed",
  waiting: "papp.boardRungWaiting",
  locked: "papp.boardRungLocked",
  open: "papp.boardRungOpen",
};

/* THE LADDER IS THE KID'S CLIMB, here too (2026-09-18). The parent used to read the ladder as
   a list of rows while the kid climbed a duo-path; the same object drawn two ways is two
   things to learn. So this is the kid's path (goal-path.js): climbed, the prize under the
   banner, rung one at the bottom, the rung title in the active bubble, the gift on the prize.
   What the parent needs that the kid does not is under every node as a caption: the title,
   the price and the state, because a parent manages rungs by name and a number alone would
   send them tapping to find out. Every node is tappable and opens the rung sheet, the one
   action a row had (Edit). The rung sheet is unchanged. */
function rungNode(goal, r, n, progress) {
  const cls = NODE_CLASS[r.state] ?? "is-locked";
  const active = r.state === "open";
  const pay = r.rewardLuna > 0 ? nimLabel(r.rewardLuna) : t("papp.boardPaysNothing");
  return `<li class="duo-path-step">
    <div class="pg-step">
      <div class="duo-node ${cls}${r.active ? "" : " is-locked"}"${active ? ` style="--duo-progress: ${progress}"` : ""}>
        ${active || r.state === "waiting" ? ring() : ""}
        ${active ? `<span class="duo-node-bubble">${esc(rowTitle(r))}</span>` : ""}
        <button class="duo-node-face" type="button" data-rung="${esc(r.id)}" data-ingoal="${esc(goal.id)}"
          aria-label="${esc(rowTitle(r))}, ${esc(t("papp.boxEdit"))}">${n}</button>
      </div>
      <span class="pg-cap">
        <b>${esc(rowTitle(r))}</b>
        <span>${pay} &middot; ${r.active ? t(RUNG_STATE[r.state]) : t("papp.boardRetired")}</span>
      </span>
    </div>
  </li>`;
}

/** The prize, last in DOM so column-reverse puts it under the banner: the kid path's own rule
 *  (goal-path.js prizeNode), the pack's egg while the set is unfinished and the boss once it is
 *  owned, grey until then and the yolk after; the gift only when the theme has no art. Only a
 *  ladder that collects a theme has one. */
function prizeNode(g) {
  const boss = g.theme?.boss;
  if (!boss) return "";
  const art = boss.owned ? boss.assetUrl : g.theme?.eggUrl;
  return `<li class="duo-path-step">
    <div class="pg-step">
      <div class="duo-node is-prize${boss.owned ? "" : " is-locked"}">
        <span class="duo-node-face" aria-label="${esc(boss.label)}">${art ? `<img src="${esc(art)}" alt="" draggable="false" />` : giftIcon()}</span>
      </div>
    </div>
  </li>`;
}

function climb(g) {
  const rungs = g.rungs ?? [];
  const progress = g.total ? Math.round((g.climbed / g.total) * 100) / 100 : 0;
  return `<section class="duo-path pg-path">
    <header class="duo-path-head">
      <div class="duo-path-head-text">
        <p class="duo-path-kicker">${esc(t("papp.boardClimbed", { done: g.climbed, total: g.total }))}</p>
        <h2 class="duo-path-title">${esc(rowTitle(g))}</h2>
      </div>
    </header>
    <ol class="duo-path-steps">
      ${rungs.map((r, i) => rungNode(g, r, i + 1, progress)).join("")}
      ${prizeNode(g)}
    </ol>
  </section>`;
}

/* THE COLLECTION, not this ladder's progress. The same five dragons are collected across
   every ladder set to that theme, so the row says where the SET has got to — which is why a
   parent can start a second ladder and have it continue the first one's collection. */
function themeRow(g) {
  if (!g.theme) return "";
  const slot = (s) => `<span class="bd-set-slot ${s.owned ? "is-on" : ""}">${
    s.owned && s.assetUrl ? `<img src="${esc(s.assetUrl)}" alt="${esc(s.label)}" />` : ""}</span>`;
  const boss = g.theme.boss
    ? `<span class="bd-set-slot bd-set-boss ${g.theme.boss.owned ? "is-on" : ""}">${
      g.theme.boss.owned && g.theme.boss.assetUrl
        ? `<img src="${esc(g.theme.boss.assetUrl)}" alt="${esc(g.theme.boss.label)}" />` : ""}</span>`
    : "";
  return `<div class="bd-theme">
    <div class="bd-set">${g.theme.slots.map(slot).join("")}${boss}</div>
    <div class="set-hint">${t(g.theme.complete ? "papp.boardThemeDone" : "papp.boardThemeGoing", {
      done: g.theme.collected, total: g.theme.total,
    })}</div>
  </div>`;
}

function goalCard(g) {
  const rungs = g.rungs.length
    ? climb(g)
    : `<div class="set-hint bx-empty">${t("papp.boardNoRungs")}</div>`;
  // The card's picture is never the OS's emoji (2026-09-18, the same rule as the kid board,
  // #546): a ladder with a theme wears the pack's egg, else the drawn icon for its emoji,
  // else the ladder icon. The seeded "Ride the bike" carries a bicycle nobody has drawn.
  const picture = g.theme?.eggUrl
    ? `<img class="bd-face" src="${esc(g.theme.eggUrl)}" alt="" draggable="false" />`
    : face(faceUrl(g.emoji) ? g : { emoji: "🪜" }, "🪜");
  return `<div class="card set-card ${g.active ? "" : "is-off"}">
    <div class="bx-shelf-hd-p">
      ${picture}
      <h3>${esc(rowTitle(g))}</h3>
      <div class="bx-shelf-tools">
        <button class="pill-btn ghost sm" data-goal="${esc(g.id)}">${t("papp.boxEdit")}</button>
      </div>
    </div>
    <div class="set-hint">${t("papp.boardClimbed", { done: g.climbed, total: g.total })} &middot; ${
      t(g.ordered ? "papp.boardInOrder" : "papp.boardAnyOrder")}${
      g.active ? "" : ` &middot; ${t("papp.boardRetired")}`}</div>
    ${themeRow(g)}
    ${rungs}
    <button class="pill-btn ghost wide" data-addrung="${esc(g.id)}">${t("papp.boardAddRung")}</button>
  </div>`;
}

export function goalsCards(b) {
  const cards = (b.goals ?? []).map(goalCard).join("");
  return `<div class="sec-label bd-sec">${t("papp.boardGoals")}</div>
    ${cards || `<div class="card set-card"><div class="set-hint">${t("papp.boardNoGoals")}</div></div>`}
    <button class="pill-btn ghost wide" id="bd-add-goal">${t("papp.boardAddGoal")}</button>`;
}

export function wireGoals(el, b) {
  el.querySelectorAll("[data-goal]").forEach((n) => (n.onclick = () =>
    void sheetGoal((b.goals ?? []).find((g) => g.id === n.dataset.goal))));
  el.querySelector("#bd-add-goal")?.addEventListener("click", () => void sheetGoal(null));
  el.querySelectorAll("[data-addrung]").forEach((n) => (n.onclick = () =>
    sheetRung((b.goals ?? []).find((g) => g.id === n.dataset.addrung), null)));
  el.querySelectorAll("[data-rung]").forEach((n) => (n.onclick = () => {
    const goal = (b.goals ?? []).find((g) => g.id === n.dataset.ingoal);
    sheetRung(goal, goal?.rungs.find((r) => r.id === n.dataset.rung));
  }));
}

async function sheetGoal(goal) {
  const isNew = !goal;
  let ordered = goal ? goal.ordered : true;
  let packId = goal?.packId ?? null;
  const list = await loadThemes();
  // The theme is offered as its OWN ART, not as a word: the parent is choosing what their kid
  // will be collecting, and "Dragons" tells them nothing a row of six dragons does not tell
  // them better. It is also the only place in the parent app the sticker art appears at size.
  const themeChooser = list.length ? `
    <div class="set-hint">${t("papp.boardCollects")}</div>
    <div class="bd-themes">
      <button class="bd-theme-pick ${packId ? "" : "on"}" data-theme=""
        aria-pressed="${!packId}">${t("papp.boardNoTheme")}</button>
      ${list.map((th) => `
        <button class="bd-theme-pick ${packId === th.packId ? "on" : ""}" data-theme="${esc(th.packId)}"
          aria-pressed="${packId === th.packId}">
          <span class="bd-theme-art">${[...th.stickers, th.boss].filter(Boolean).map((st) =>
            `<img src="${esc(st.assetUrl)}" alt="" draggable="false" />`).join("")}</span>
          <span class="bd-theme-name">${esc(rowTitle({ title: th.title, titleKey: th.titleKey }))}</span>
        </button>`).join("")}
    </div>
    <div class="set-hint">${t("papp.boardCollectsHint")}</div>` : "";
  openSheet(`
    <h2>${isNew ? t("papp.boardNewGoal") : t("papp.boardEditGoal")}</h2>
    ${jobPickerHtml({ t, groups: jobGroups() })}
    <input class="nq-input" id="bd-title" maxlength="40" autocomplete="off"
      placeholder="${esc(t("papp.boardGoalName"))}" value="${esc(goal?.title ?? "")}" />
    <div class="set-hint">${t("papp.boardHowToClimb")}</div>
    <div class="app-toggle bx-kind">
      <button class="pill-btn ghost sm ${ordered ? "on" : ""}" data-ord="1"
        aria-pressed="${ordered}">${t("papp.boardInOrder")}</button>
      <button class="pill-btn ghost sm ${ordered ? "" : "on"}" data-ord="0"
        aria-pressed="${!ordered}">${t("papp.boardAnyOrder")}</button>
    </div>
    <div class="set-hint">${t("papp.boardHowToClimbHint")}</div>
    ${themeChooser}
    <div class="btn-row bd-actions">
      ${isNew ? "" : `<button class="pill-btn ghost" id="bd-retire">${
        goal.active ? t("papp.boardRetire") : t("papp.boxShow")}</button>`}
      <button class="pill-btn blue" id="bd-save">${t("papp.save")}</button>
    </div>`);
  const picker = wireJobPicker({ titleInput: $("bd-title") });

  document.querySelectorAll("[data-ord]").forEach((btn) => (btn.onclick = () => {
    ordered = btn.dataset.ord === "1";
    document.querySelectorAll("[data-ord]").forEach((o) => {
      o.classList.toggle("on", o === btn);
      o.setAttribute("aria-pressed", String(o === btn));
    });
  }));

  document.querySelectorAll("[data-theme]").forEach((btn) => (btn.onclick = () => {
    packId = btn.dataset.theme || null;
    document.querySelectorAll("[data-theme]").forEach((o) => {
      o.classList.toggle("on", o === btn);
      o.setAttribute("aria-pressed", String(o === btn));
    });
  }));

  $("bd-save").onclick = async () => {
    const catalogId = picker.catalogId();
    const title = $("bd-title").value.trim();
    if (!title && !catalogId) { toast(t("papp.boxNameNeeded"), "error"); return; }
    $("bd-save").disabled = true;
    // `packId` is sent on every save, null included, so clearing a theme is a real edit and
    // not an absent field the server would read as "leave it alone".
    const body = { title, ordered, packId, ...(catalogId ? { catalogId } : {}) };
    const r = isNew
      ? await call("POST", "/api/goals", { childId: state.board.kidId, ...body }).catch(() => null)
      : await call("PATCH", `/api/goals/${goal.id}`, body).catch(() => null);
    await finish(r, isNew ? 201 : 200, t("papp.saved"));
  };

  $("bd-retire")?.addEventListener("click", async () => {
    $("bd-retire").disabled = true;
    const r = await call("PATCH", `/api/goals/${goal.id}`, { active: !goal.active }).catch(() => null);
    await finish(r, 200, t("papp.saved"));
  });
}

/* A rung. The exercise sheet's twin, and for the same reason: a rung is a name and a price,
   and every save here is a price change, so the server takes the PIN and refuses while a rung
   of this ladder is waiting. `errorFor` in views-board.js words that 409. */
function sheetRung(goal, rung) {
  if (!goal) return;
  const isNew = !rung;
  openSheet(`
    <h2>${isNew ? t("papp.boardNewRung") : t("papp.boardEditRung")}</h2>
    ${jobPickerHtml({ t, groups: jobGroups() })}
    <input class="nq-input" id="bd-title" maxlength="40" autocomplete="off"
      placeholder="${esc(t("papp.boardRungName"))}" value="${esc(rung?.title ?? "")}" />
    ${rewardField(rung?.rewardLuna, true)}
    <div class="btn-row bd-actions">
      ${isNew ? "" : `<button class="pill-btn ghost" id="bd-remove">${t("papp.boardRemoveRung")}</button>`}
      <button class="pill-btn blue" id="bd-save">${t("papp.save")}</button>
    </div>
    ${isNew ? `<div class="set-hint">${t("papp.boardRungHint")}</div>` : ""}`);
  const picker = wireJobPicker({ titleInput: $("bd-title") });
  wireReward();

  $("bd-save").onclick = async () => {
    const catalogId = picker.catalogId();
    const title = $("bd-title").value.trim();
    if (!title && !catalogId) { toast(t("papp.boxNameNeeded"), "error"); return; }
    $("bd-save").disabled = true;
    const body = { title, rewardLuna: rewardLunaValue(), ...(catalogId ? { catalogId } : {}) };
    const r = isNew
      ? await call("POST", `/api/goals/${goal.id}/rungs`, body).catch(() => null)
      : await call("PATCH", `/api/goals/${goal.id}/rungs/${rung.id}`, body).catch(() => null);
    await finish(r, isNew ? 201 : 200, t("papp.saved"));
  };

  // Retired, not deleted: a climbed rung is the record of something the kid did, and the
  // approval that paid it still points here.
  $("bd-remove")?.addEventListener("click", async () => {
    $("bd-remove").disabled = true;
    const r = await call("PATCH", `/api/goals/${goal.id}/rungs/${rung.id}`, { active: false })
      .catch(() => null);
    await finish(r, 200, t("papp.saved"));
  });
}
