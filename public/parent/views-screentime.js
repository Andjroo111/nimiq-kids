// nimiq.kids parent — SCREEN TIME settings: the curfew and the daily limit (#377).
//
// A Settings card rather than something on a kid's page, because the CURFEW is a house
// rule: both children in this household keep the same hours, and a per-child editor would
// have to be filled in twice to say one thing. The per-kid limit lives here too, beside it,
// since a parent thinking about one is thinking about the other.
//
// THE TWO RULES ARE DIFFERENT KINDS OF THING and the card says so rather than blending them:
//   · Hours are a fence. Nothing gets past them -- not a finished routine, not bought
//     minutes. There is no chore that makes it 7am.
//   · The limit is an allowance. It is spent, it can be topped up in the Treasure Box, and
//     it resets at midnight.

import { state, t, views, call, refresh, render, toast, $, openSheet, closeSheet } from "./core.js";
import { icon } from "./icons.js";
import { esc } from "./fmt.js";
import { canManageHousehold } from "./grownups.js";

/** Mon..Sun, Monday = index 0 — the same mask order lock_windows and allow_windows use. */
const DOW = ["papp.dowMo", "papp.dowTu", "papp.dowWe", "papp.dowTh", "papp.dowFr", "papp.dowSa", "papp.dowSu"];

/** The house default, offered when a household has no curfew yet: Sun-Thu 7-8, Fri-Sat 7-9. */
const SUGGESTED = [
  { startHhmm: "07:00", endHhmm: "20:00", days: "1111001" },
  { startHhmm: "07:00", endHhmm: "21:00", days: "0000110" },
];

export async function loadScreenTime() {
  const r = await call("GET", "/api/family/allow-windows").catch(() => null);
  // null (not []) when the read failed, so the card can say "not loaded" rather than draw
  // an empty schedule that reads as "no curfew" over a household that has one.
  state.allowWindows = r?.status === 200 ? r.data.windows : null;
  render();
}

/**
 * Which rows a day belongs to, as a set of checkboxes rather than a text mask.
 *
 * A weekday mask is the right STORAGE and an awful control: "1111001" is not something a
 * parent can read, let alone edit, and getting it wrong locks a tablet on the wrong day
 * with nothing on any screen to explain it.
 */
function windowRow(w, i) {
  return `<div class="st-win" data-win="${i}">
    <div class="st-times">
      <input class="nq-input st-t" type="time" value="${esc(w.start_hhmm ?? w.startHhmm)}" data-k="start" />
      <span class="st-to">${esc(t("papp.stTo"))}</span>
      <input class="nq-input st-t" type="time" value="${esc(w.end_hhmm ?? w.endHhmm)}" data-k="end" />
      <button class="st-del" data-del="${i}" aria-label="${esc(t("papp.stRemove"))}">${icon("cross", 14)}</button>
    </div>
    <div class="st-days">${DOW.map((key, d) => `
      <label class="st-day">
        <input type="checkbox" data-d="${d}" ${(w.days ?? "")[d] === "1" ? "checked" : ""} />
        <span>${esc(t(key))}</span>
      </label>`).join("")}</div>
  </div>`;
}

export function screenTimeCard() {
  if (!canManageHousehold()) return "";
  const wins = state.allowWindows;

  // THREE states, and they are three different sentences. `undefined` is "not read yet"
  // and must not render an editor at all -- the first paint of the settings tab happens
  // before the fetch, and an empty schedule drawn there reads as "no curfew" over a
  // household that has one.
  if (wins === undefined) {
    return `<div class="card set-card">
      <div class="set-head">${icon("locked-lock", 22)}<h3>${esc(t("papp.stTitle"))}</h3></div>
      <div class="set-hint">${esc(t("papp.loading"))}</div>
    </div>`;
  }
  const body = wins === null
    ? `<div class="set-hint">${esc(t("papp.stNotLoaded"))}</div>`
    : `${wins.length === 0 ? `<div class="set-hint">${esc(t("papp.stNoCurfew"))}</div>` : ""}
       <div id="st-wins">${wins.map(windowRow).join("")}</div>
       <div class="btn-row">
         <button class="pill-btn ghost sm" id="st-add">${esc(t("papp.stAddWindow"))}</button>
         ${wins.length === 0
           ? `<button class="pill-btn ghost sm" id="st-suggest">${esc(t("papp.stUseSuggested"))}</button>` : ""}
         <button class="pill-btn blue sm" id="st-save">${esc(t("papp.save"))}</button>
       </div>`;

  return `<div class="card set-card">
    <div class="set-head">${icon("locked-lock", 22)}<h3>${esc(t("papp.stTitle"))}</h3></div>
    <div class="set-hint">${esc(t("papp.stHoursSub"))}</div>
    ${body}

  </div>`;
}

/**
 * ONE KID'S TWO NUMBERS, on that kid's own page (#418).
 *
 * Andjroo, 2026-09-01: "we should just simplify this ... inside of the kid's profile, there
 * should be individualized versions of this". The card above is the household's HOURS, one
 * schedule the tablet follows. How long each child gets inside those hours, and how much more
 * they may buy, is a fact about the child, and it was a stack of rows in a family-level
 * settings list where a parent had to find their kid's line to read it.
 *
 * The hours stay in Settings and are not moving: `allow_windows` is keyed by FAMILY
 * (src/db.ts), one schedule for the tablet, and four copies of it on four kid pages would be
 * four ways to disagree about when the screen turns off.
 */
/**
 * A ROW THAT STATES THE RULE, and a sheet behind it that changes it (#420).
 *
 * This was a full card: a heading, a sentence explaining it, two number fields, a hint about
 * what zero means, and its own Save button, drawn on every visit to a kid's page for a
 * parent who was not changing anything. Andjroo's standard for every parent surface is
 * "show the state, put the controls behind the tap". The row reads the two numbers as one
 * line; the fields wait in a sheet.
 */
function budgetLine(kid) {
  const daily = Number(kid.dailyScreenMin ?? 0);
  const buy = Number(kid.maxEarnedMin ?? 0);
  const parts = [daily > 0 ? t("papp.stLimitDay", { n: daily }) : t("papp.stLimitNone")];
  if (buy > 0) parts.push(t("papp.stLimitBuy", { n: buy }));
  const play = Number(kid.playMin ?? 0);
  const rest = Number(kid.restMin ?? 0);
  if (play > 0 && rest > 0) parts.push(t("papp.stLimitSitting", { play, rest }));
  return parts.join(" \u00b7 ");
}

export function kidBudgetRow(kid) {
  if (!canManageHousehold() || !kid) return "";
  const sub = budgetLine(kid);
  return `<button class="row" id="kid-st-row" data-kid="${esc(kid.id)}">
    <span class="hex-tile">${icon("locked-lock", 22)}</span>
    <span class="row-main">
      <span class="row-label">${esc(t("papp.stLimitTitle"))}</span>
      <span class="row-sub" title="${esc(sub)}">${esc(sub)}</span>
    </span>
    <span class="chev">${icon("chevron-right", 14)}</span>
  </button>`;
}

function sheetKidBudget(kid) {
  openSheet(`<h2>${esc(t("papp.stLimitTitle"))}</h2>
    <div class="sub">${esc(t("papp.stLimitSub"))}</div>
    <div class="st-kid">
      <label class="st-num"><input class="nq-input" type="number" min="0" max="600" step="5"
        data-f="daily" value="${Number(kid.dailyScreenMin ?? 0)}" /><span>${esc(t("papp.stPerDay"))}</span></label>
      <label class="st-num"><input class="nq-input" type="number" min="0" max="600" step="5"
        data-f="earned" value="${Number(kid.maxEarnedMin ?? 0)}" /><span>${esc(t("papp.stEarnable"))}</span></label>
    </div>
    <div class="set-hint st-note">${esc(t("papp.stZeroMeans"))}</div>
    <div class="st-kid">
      <label class="st-num"><input class="nq-input" type="number" min="0" max="600" step="5"
        data-f="play" value="${Number(kid.playMin ?? 0)}" /><span>${esc(t("papp.stPlayFor"))}</span></label>
      <label class="st-num"><input class="nq-input" type="number" min="0" max="600" step="5"
        data-f="rest" value="${Number(kid.restMin ?? 0)}" /><span>${esc(t("papp.stThenRest"))}</span></label>
    </div>
    <div class="set-hint st-note">${esc(t("papp.stSittingHint"))}</div>
    <button class="pill-btn blue" id="st-save-kid">${esc(t("papp.save"))}</button>`);

  // One kid, one PATCH, and the roster re-read because the limit a chart draws its rule
  // from lives on the child row.
  $("st-save-kid")?.addEventListener("click", async () => {
    const btn = $("st-save-kid");
    btn.disabled = true;
    const r = await call("PATCH", `/api/children/${kid.id}/screen-budget`, {
      dailyMin: Number(document.querySelector('#sheet [data-f="daily"]').value),
      maxEarnedMin: Number(document.querySelector('#sheet [data-f="earned"]').value),
      playMin: Number(document.querySelector('#sheet [data-f="play"]').value),
      restMin: Number(document.querySelector('#sheet [data-f="rest"]').value),
    }).catch(() => null);
    btn.disabled = false;
    if (r?.status !== 200) { toast(t("papp.stSaveFailed"), "error"); return; }
    closeSheet();
    toast(t("papp.stSaved"), "success");
    await refresh();
    render();
  });
}

export function wireKidBudgetRow(el, kid) {
  el.querySelector("#kid-st-row")?.addEventListener("click", () => sheetKidBudget(kid));
}

/** Read the editor back into the wire shape. Days come off the checkboxes, never a mask
 *  the parent typed — see the note on windowRow. */
function readWindows() {
  return [...document.querySelectorAll("#st-wins .st-win")].map((row) => ({
    startHhmm: row.querySelector('[data-k="start"]').value,
    endHhmm: row.querySelector('[data-k="end"]').value,
    days: DOW.map((_, d) => (row.querySelector(`[data-d="${d}"]`).checked ? "1" : "0")).join(""),
  }));
}

export function wireScreenTimeCard(el) {
  if (state.allowWindows === undefined) { loadScreenTime(); return; }

  el.querySelector("#st-add")?.addEventListener("click", () => {
    state.allowWindows = [...(state.allowWindows ?? []), { startHhmm: "07:00", endHhmm: "20:00", days: "1111111" }];
    render();
  });
  el.querySelector("#st-suggest")?.addEventListener("click", () => {
    state.allowWindows = SUGGESTED.map((w) => ({ ...w }));
    render();
  });
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    state.allowWindows = state.allowWindows.filter((_, i) => i !== Number(b.dataset.del));
    render();
  }));

  el.querySelector("#st-save")?.addEventListener("click", async () => {
    const windows = readWindows();
    // Refused here as well as on the server, because the server's 400 arrives as a toast
    // with no idea WHICH row is wrong, and a parent with three rows would have to guess.
    const bad = windows.find((w) => !w.startHhmm || !w.endHhmm || w.startHhmm === w.endHhmm);
    if (bad) { toast(t("papp.stBadTimes")); return; }
    if (windows.some((w) => !w.days.includes("1"))) { toast(t("papp.stNoDays")); return; }

    const r = await call("PUT", "/api/family/allow-windows", { windows }).catch(() => null);
    if (r?.status !== 200) { toast(t("papp.stSaveFailed")); return; }
    state.allowWindows = r.data.windows;
    toast(t("papp.stSaved"));
    render();
  });

}
