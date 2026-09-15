// nimiq.kids parent — WHEN THE TABLET LOCKS: a routine's lock windows (#303).
//
// The engine has been here since Phase B (src/lock-machine.ts): weekday masks, windows that
// cross midnight, DST, most-restrictive-wins across overlaps. Nothing could WRITE one. The
// only caller of `addLockWindow` in the whole tree was the seed script, so every household
// that ever installed this ran on whatever two windows the seeder happened to write, with no
// way to change them short of opening the database.
//
// It lives on the routine's own card rather than on a screen of its own, because a window is
// not a setting about the tablet — it is a sentence about THIS routine: the tablet stays shut
// until it is done and approved. Shown anywhere else, a parent would have to hold the routine
// in their head to read it.
//
// Its own file for the same reason goals got one: views-board.js is at 728 of the repo's
// 800-line guard. The seam is a section, and the shared pieces (the one outcome path, the
// sheet) are imported rather than copied.

import { lang, rowTitle, state, t, call, openSheet, toast, $ } from "./core.js";
import { esc } from "./fmt.js";
import { finish } from "./views-board.js";

/** Mon..Sun, and MONDAY IS INDEX 0 — the mask is written the way a week is read here, not the
 *  way `Date.getDay()` numbers it (Sunday 0). Getting this backwards silently moves a
 *  weekday schedule onto the weekend, so both directions go through these two helpers. */
const DOW = [0, 1, 2, 3, 4, 5, 6];
const isOn = (days, i) => String(days ?? "")[i] === "1";
const maskFrom = (set) => DOW.map((i) => (set.has(i) ? "1" : "0")).join("");

const WEEKDAYS = "1111100";
const WEEKENDS = "0000011";
const EVERY_DAY = "1111111";

/** A Monday, so day 0 of the mask is day 0 of the formatter. Any Monday will do; this one is
 *  arbitrary and in UTC so no timezone can shift it onto a Sunday. */
const MONDAY = Date.UTC(2026, 0, 5);
const dayDate = (i) => new Date(MONDAY + i * 86400000);

function dayNames(style) {
  try {
    const fmt = new Intl.DateTimeFormat(lang(), { weekday: style, timeZone: "UTC" });
    return DOW.map((i) => fmt.format(dayDate(i)));
  } catch {
    return style === "narrow"
      ? ["M", "T", "W", "T", "F", "S", "S"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  }
}

/** '06:30' as the parent's own clock writes it — 6:30 AM, 06:30, or 6h30 — because the input
 *  beside it is a native time field and shows the same thing. Built in UTC and read in UTC:
 *  a wall-clock time has no timezone, and running it through the local one would print 1:30
 *  for half the world. */
function clock(hhmm) {
  const [h, m] = String(hhmm ?? "").split(":");
  const d = new Date(Date.UTC(2026, 0, 5, Number(h) || 0, Number(m) || 0));
  try {
    return new Intl.DateTimeFormat(lang(), { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(d);
  } catch { return String(hhmm ?? ""); }
}

/** Which days, in words. The three masks a parent actually picks get their own sentence;
 *  anything else is the days themselves, which is shorter than any phrase describing them. */
function daysLabel(days) {
  if (days === EVERY_DAY) return t("papp.lockEveryDay");
  if (days === WEEKDAYS) return t("papp.lockWeekdays");
  if (days === WEEKENDS) return t("papp.lockWeekends");
  const names = dayNames("short");
  return DOW.filter((i) => isOn(days, i)).map((i) => names[i]).join(", ");
}

/** The whole rule as one sentence. A window whose end is not after its start crosses
 *  midnight — the machine reads it that way and a bedtime one always does — so it gets its
 *  own sentence rather than a range that reads backwards. */
export function windowSentence(w, routineTitle) {
  const overnight = String(w.end_hhmm) <= String(w.start_hhmm);
  return t(overnight ? "papp.lockEchoOvernight" : "papp.lockEcho", {
    days: daysLabel(w.days), from: clock(w.start_hhmm), to: clock(w.end_hhmm), routine: routineTitle,
  });
}

const range = (w) => `${clock(w.start_hhmm)} ${t("papp.lockTo")} ${clock(w.end_hhmm)}`;

// ---- the section on a routine's card ------------------------------------------

export function lockLines(r) {
  const rows = (r.windows ?? []).map((w) => `
    <div class="bx-row-p">
      <span class="bd-lock-ic" aria-hidden="true">🔒</span>
      <div class="bx-row-main">
        <div class="bx-row-title">${esc(range(w))}</div>
        <div class="bx-row-sub">${esc(daysLabel(w.days))}</div>
      </div>
      <button class="pill-btn ghost sm" data-lock="${esc(w.id)}" data-inroutine="${esc(r.id)}">${
        t("papp.boxEdit")}</button>
    </div>`).join("");
  // The empty state has to say what a window IS. "No lock windows" would be a label for a
  // feature the parent has never met: nothing else in this app locks anything.
  const body = rows || `<div class="set-hint bx-empty">${t("papp.lockNone")}</div>`;
  // Only ever shown when the household is KNOWN to have no tablet. `state.devices` is null
  // when the probe has not run or the endpoint refused, and a maybe is not worth a warning.
  const noTablet = Array.isArray(state.devices) && state.devices.length === 0
    ? `<div class="set-hint">${t("papp.lockNoTablet")}</div>` : "";
  return `<div class="bd-locks">
    <div class="set-hint bd-lock-hd">${t("papp.lockSection")}</div>
    ${body}${noTablet}
    <button class="pill-btn ghost wide" data-addlock="${esc(r.id)}">${t("papp.lockAdd")}</button>
  </div>`;
}

export function wireLocks(el, b) {
  const routineOf = (id) => (b.routines ?? []).find((r) => r.id === id);
  el.querySelectorAll("[data-addlock]").forEach((n) => (n.onclick = () =>
    sheetWindow(routineOf(n.dataset.addlock), null)));
  el.querySelectorAll("[data-lock]").forEach((n) => (n.onclick = () => {
    const routine = routineOf(n.dataset.inroutine);
    sheetWindow(routine, (routine?.windows ?? []).find((w) => w.id === n.dataset.lock));
  }));
}

// ---- the sheet -----------------------------------------------------------------

/* Two native time fields and seven circles. A time picker is the one control every phone
   already has a good one of, and `<input type="time">` hands back exactly the "HH:MM" the
   server takes, so nothing here parses a clock the parent typed. */
function sheetWindow(routine, window) {
  if (!routine) return;
  const isNew = !window;
  const start = window?.start_hhmm ?? "06:30";
  const end = window?.end_hhmm ?? "08:30";
  let days = new Set(DOW.filter((i) => isOn(window?.days ?? WEEKDAYS, i)));
  const names = dayNames("narrow");
  const full = dayNames("long");

  openSheet(`
    <h2>${isNew ? t("papp.lockNew") : t("papp.lockEdit")}</h2>
    <div class="set-hint">${t("papp.lockFromTo")}</div>
    <div class="bd-lock-times">
      <input class="nq-input" id="bd-lock-start" type="time" value="${esc(start)}" />
      <span class="bd-lock-sep">${t("papp.lockTo")}</span>
      <input class="nq-input" id="bd-lock-end" type="time" value="${esc(end)}" />
    </div>
    <div class="set-hint">${t("papp.lockOnDays")}</div>
    <div class="bd-days">
      ${DOW.map((i) => `<button class="bd-day ${days.has(i) ? "on" : ""}" data-dow="${i}"
        aria-pressed="${days.has(i)}" aria-label="${esc(full[i])}">${esc(names[i])}</button>`).join("")}
    </div>
    <div class="bd-lock-echo" id="bd-lock-echo"></div>
    <div class="btn-row bd-actions">
      ${isNew ? "" : `<button class="pill-btn ghost" id="bd-lock-remove">${t("papp.lockRemove")}</button>`}
      <button class="pill-btn blue" id="bd-lock-save">${t("papp.save")}</button>
    </div>`);

  // THE ECHO IS THE FEATURE. A mask and two clock times are a rule about a screen a parent
  // cannot see from here, so the sheet says the rule back in the words it will act in, and
  // says it as the switches move rather than after the save.
  const echo = () => {
    const w = {
      start_hhmm: $("bd-lock-start").value || start,
      end_hhmm: $("bd-lock-end").value || end,
      days: maskFrom(days),
    };
    $("bd-lock-echo").textContent = days.size
      ? windowSentence(w, rowTitle(routine))
      : t("papp.lockPickADay");
  };

  document.querySelectorAll("[data-dow]").forEach((btn) => (btn.onclick = () => {
    const i = Number(btn.dataset.dow);
    if (days.has(i)) days.delete(i); else days.add(i);
    btn.classList.toggle("on", days.has(i));
    btn.setAttribute("aria-pressed", String(days.has(i)));
    echo();
  }));
  $("bd-lock-start").oninput = echo;
  $("bd-lock-end").oninput = echo;
  echo();

  $("bd-lock-save").onclick = async () => {
    const startHhmm = $("bd-lock-start").value;
    const endHhmm = $("bd-lock-end").value;
    if (!startHhmm || !endHhmm) { toast(t("papp.lockNeedTimes"), "error"); return; }
    if (!days.size) { toast(t("papp.lockPickADay"), "error"); return; }
    $("bd-lock-save").disabled = true;
    const body = { startHhmm, endHhmm, days: maskFrom(days) };
    const r = isNew
      ? await call("POST", `/api/routines/${routine.id}/windows`, body).catch(() => null)
      : await call("PATCH", `/api/routines/${routine.id}/windows/${window.id}`, body).catch(() => null);
    await finish(r, isNew ? 201 : 200, t("papp.saved"));
  };

  // Deleted, not retired, and the only thing on this screen that is: a window points at
  // nothing and nothing points at it. It is a rule about tomorrow, so taking it away leaves
  // no history with a hole in it. (src/repo-lock.ts deleteLockWindow says the same.)
  $("bd-lock-remove")?.addEventListener("click", async () => {
    $("bd-lock-remove").disabled = true;
    const r = await call("DELETE", `/api/routines/${routine.id}/windows/${window.id}`).catch(() => null);
    await finish(r, 200, t("papp.lockRemoved"));
  });
}
