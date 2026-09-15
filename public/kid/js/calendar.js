// nimiq.kids kid app — THE CALENDAR.
//
// Structure, top to bottom (Andjroo's spec): the month name, then the week (the
// day letters), then the dates. Each date carries the sticker the kid actually
// put there, which is how a day says it got done -- not a tiny check.
//
// Tapping the dates opens the whole month. The rule that shapes everything here:
// NOTHING EVER MOVES UP. The month name and the day-letter row are pinned; the
// dates grow DOWNWARD from one week into the month grid, and Today is pushed
// further down rather than the calendar climbing the screen. Because the day
// letters are a row of their own, the columns stay put whether there are seven
// dates under them or forty-two.

import { state, esc, t } from "./util.js";
import { api } from "./api.js";
import { stickerNode } from "./stickers.js";
import { checkIcon, arrowIcon, chevronIcon, closeIcon, maskIcon, CAL_D } from "./icons.js";

const OPEN_KEY = "kid.calOpen";
const isOpen = () => { try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; } };
const setOpen = (v) => { try { localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch { /* private mode */ } };

// Month feeds are LAZY snapshots: fetched the first time a kid opens that month,
// then kept. The live week feed overlays them (see feedFor) so today's cell never
// goes stale behind the cache.
//
// Cached per month rather than one at a time because the arrows make paging back
// and forth the normal way to use this: a single slot would refetch the month a kid
// just came from every time they stepped back onto it, and each of those refetches
// repaints the grid under their thumb.
const monthFeeds = new Map();
let loading = "";

// Which month the grid is showing. Only ever differs from today's month while the
// calendar is open, and closing puts it back (see toggleCalendar) so a kid who left
// it parked on April does not open tomorrow's calendar in April.
let viewMonth = "";

export function resetCalendar() { monthFeeds.clear(); loading = ""; viewMonth = ""; }

// ---------- dates ----------
const lang = () => window.nimiqKidsShell?.getLanguage?.() || "en";
const pad = (n) => String(n).padStart(2, "0");
const dayDate = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (day, n) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const mondayOf = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mon=0..Sun=6
  return addDays(day, -dow);
};

/** The 7xN grid for 'YYYY-MM'. Mirrors monthDays() on the server so the grid can
 *  paint the instant a kid taps, before the feed lands; once it lands we render
 *  the server's own day list instead (see grid()). */
function monthGrid(month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = mondayOf(`${month}-${pad(last)}`);
  const days = [];
  for (let week = mondayOf(`${month}-01`); ; week = addDays(week, 7)) {
    for (let i = 0; i < 7; i++) days.push(addDays(week, i));
    if (week === end) break;
  }
  return days;
}

/** "July" — the locale's own month name, capitalised as a heading. Takes a whole
 *  day so it can be handed either `chart.today` or a month's own first date. */
/**
 * THE ROW HAS TO SAY "CALENDAR" WITHOUT BEING READ (Andjroo, 2026-09-07).
 *
 * "September" alone is a word, and the users are 4 to 8 and may not know the months, so the
 * one row on the board that is a calendar looked exactly like a collapsed part of the day.
 *
 * ⚠️ NOT the dock's `week` mask, which was the first try. Two things were wrong with it:
 * it is 128px raster drawn for 24px and goes coarse at 34, and it had to be tinted
 * `--blue` to read at all, which made it the only blue thing on the whole board
 * (Andjroo: "that icon is not very great, and it's the only thing that's blue").
 * This is inline vector at the app's own icon weight, in the same navy as every other
 * heading, so it belongs to the row rather than announcing itself.
 *
 * The date is drawn as TEXT in the same SVG rather than in the host, so it scales with the
 * glyph and cannot drift out of the window at a different font size.
 *
 * ⚠️ THE DATE WINDOW IS THE POINT OF THE DRAWING, so the drawing is sized around it.
 * Andjroo, twice: the number is hard to read, "and with two digits I think it would be even
 * harder". Widening the gap alone did not fix that, because the problem was the WINDOW: the
 * first icon spent 10 of its 24 units on a header band the date does not use.
 * Now the band is 5 units and the window is 10 (divider ends at y=10.6, the 2-wide body stroke
 * puts the inner floor at y=20.5), and the glyph renders at 38px rather than 30.
 * `textLength` + `lengthAdjust` pin the digits to a fixed 6 or 12 units so "28" occupies the
 * window the same way "7" does instead of shrinking to fit whatever the font does.
 * Tuned by MEASURING the rendered pixels for BOTH a one- and a two-digit date, never by
 * arithmetic on the cap height: Mulish's digits do not fill their cap box.
 */
function calGlyph(heading, chart) {
  // ⚠️ `heading` is a "YYYY-MM-DD" STRING, not a Date: shut it is `chart.today`, open it is the
  //    month's own first day. Slicing the string is also the only safe way to read a calendar
  //    day here, because `new Date("YYYY-MM-DD")` parses as UTC and lands on the PREVIOUS day
  //    for anyone west of Greenwich, which is every user of this app.
  const today = chart?.today ?? "";
  const day = today.slice(0, 7) === String(heading).slice(0, 7) ? Number(today.slice(8, 10)) : 0;
  // The dock's own calendar (icons.js CAL_D), so the month row and the My week button are one
  // drawing at one weight, with the day number sitting in the page below the binding.
  return `<span class="k-icon k-line cal-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg">
    <path vector-effect="non-scaling-stroke" d="${CAL_D}"/>
    ${day ? `<text x="12" y="18.6" text-anchor="middle" font-size="8.6" font-weight="800" stroke="none"
      fill="currentColor" font-family="Mulish, system-ui, sans-serif"
      textLength="${day > 9 ? 11 : 5.5}" lengthAdjust="spacingAndGlyphs">${day}</text>` : ""}
  </svg></span>`;
}

function monthName(day) {
  let name;
  try { name = new Intl.DateTimeFormat(lang(), { month: "long" }).format(dayDate(day)); }
  catch { name = day.slice(0, 7); }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** 'YYYY-MM' + n months. Pure string math, like everything else here. */
function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** M T W T F S S in the kid's language, from any Monday. */
function dayLetters(monday) {
  let fmt;
  try { fmt = new Intl.DateTimeFormat(lang(), { weekday: "narrow" }); }
  catch { return ["M", "T", "W", "T", "F", "S", "S"]; }
  return Array.from({ length: 7 }, (_, i) => fmt.format(dayDate(addDays(monday, i))));
}

// ---------- a day's state ----------
/** Did that day's jobs get done? One definition, used by every date on screen. */
function dayState(feed, day) {
  let total = 0, done = 0;
  for (const row of feed?.rows ?? []) {
    const cell = (row.cells ?? []).find((c) => c.day === day);
    if (!cell) continue;
    total++;
    if (cell.status === "approved" || (cell.placements ?? []).length) done++;
  }
  return { total, done, cls: total === 0 ? "" : done === total ? "is-full" : done > 0 ? "is-part" : "" };
}

/** The sticker the kid put on that day — the first one they placed. */
function stickerFor(feed, day) {
  for (const row of feed?.rows ?? []) {
    const p = ((row.cells ?? []).find((c) => c.day === day)?.placements ?? [])[0];
    if (p) return p;
  }
  return null;
}

/** The week feed is live (10s poll); the month feed is a snapshot. For any day
 *  the week covers, the week wins — so a sticker placed a moment ago shows up in
 *  the month grid without refetching it. */
const feedFor = (chart, day, month) =>
  ((chart?.days ?? []).includes(day) ? chart : monthFeeds.get(month));

/** A placement, with its lean capped for calendar scale. Rotating a square grows
 *  its bounding box by (cos+sin), so the kid's full +/-20deg tilt makes a 24px
 *  sticker measure 32px and shove into the day beside it. Half the lean keeps
 *  the handmade feel and stops the collision. */
const CAL_TILT = 7;
const calTilt = (p) => ({
  ...p, tiltDeg: Math.max(-CAL_TILT, Math.min(CAL_TILT, p.tiltDeg ?? 0)),
});

// ---------- render ----------
function dayCell(chart, day, month) {
  const feed = feedFor(chart, day, month || (chart.today ?? "").slice(0, 7));
  const st = dayState(feed, day);
  const sticker = stickerFor(feed, day);
  const out = month && day.slice(0, 7) !== month;
  // The sticker IS the done mark. A day finished without one (a parent approved
  // it, the kid never picked) still has to read as done, so it keeps a check.
  const mark = sticker ? stickerNode(calTilt(sticker), "stk-cal")
    : st.cls === "is-full" ? `<span class="cal-check">${checkIcon()}</span>` : "";
  return `<span class="cal-day ${st.cls} ${day === chart.today ? "is-today" : ""} ${out ? "is-out" : ""}">
    <b>${Number(day.slice(-2))}</b>
    <span class="cal-day-mark">${mark}</span>
  </span>`;
}

/** Which dates are under the letters: this week when closed, the month when open. */
function grid(chart, month, open) {
  if (!open) return chart.days ?? [];
  const feed = monthFeeds.get(month);
  return feed?.days?.length ? feed.days : monthGrid(month);
}

/** The month on screen, and the month Today is in. `viewMonth` is only set by the
 *  arrows, so an untouched calendar always answers with today's. */
const shownMonth = (chart) => viewMonth || (chart.today ?? "").slice(0, 7);
const thisMonth = (chart) => (chart.today ?? "").slice(0, 7);
/** The month the kid's own history starts, served on /chart and /month. Falls back to
 *  today's month, which is also what the server sends for a child with no history yet —
 *  so a kid who has done nothing gets no back arrow rather than an infinite one. */
const firstMonth = (chart) => chart.firstMonth || thisMonth(chart);

function inner(chart) {
  const open = isOpen();
  const month = shownMonth(chart);
  const days = grid(chart, month, open);
  const monday = days[0] ?? chart.today;
  // The heading names the month being SHOWN, which is only today's month until an
  // arrow is pressed. Fed a date inside that month rather than the month string, so
  // Intl still does the naming in the kid's language.
  const heading = open ? `${month}-01` : chart.today;
  // No forward past the month Today is in. A kid cannot have done chores in the
  // future, so every grid beyond this one is blank by construction, and offering to
  // page into an endless run of empty months is a dead end rather than a feature.
  const atNow = month >= thisMonth(chart);
  // And no back past the month their history STARTS, for the same reason pointing the other
  // way. Back used to be unbounded: hold the arrow and the calendar walks into 2019, one
  // empty grid at a time (Andjroo, 2026-08-04: "the kid could be able to go to years, but
  // not like that ... should just be back and forth months").
  const atStart = month <= firstMonth(chart);
  // ⚠️ THREE CHEVRONS, ONE OF WHICH CLOSED IT (#402). Andjroo, 2026-09-01: "it's hard to know
  // how to close it because there's three arrows." All three were the same glyph: the header's
  // rotated one closed the month, and the pair beside it stepped through months, with the
  // forward one greyed out on the very first open. So of the three arrows a kid could see, one
  // did the thing they wanted and one did nothing at all.
  //
  // Open, the row is now two jobs that look like two jobs: the month name flanked by its own
  // stepper, and an explicit X. A close control that is a rotated version of a navigation
  // control is a puzzle; an X is not.
  //
  // Shut, this is byte-for-byte the control it has always been — name plus chevron — because
  return `
    <div class="cal-top">
      ${open ? `
        <div class="cal-nav">
          <button id="cal-prev" aria-label="${esc(t("app.kidCalPrev"))}"
            ${atStart ? "disabled" : ""}>${arrowIcon("left")}</button>
        </div>
        <button class="cal-hd is-open" id="cal-hd" aria-expanded="true">
          ${calGlyph(heading, chart)}
          <span class="cal-month">${esc(monthName(heading))}</span>
        </button>
        <div class="cal-nav">
          <button id="cal-next" aria-label="${esc(t("app.kidCalNext"))}"
            ${atNow ? "disabled" : ""}>${arrowIcon("right")}</button>
          <button id="cal-shut" class="cal-shut"
            aria-label="${esc(t("app.close"))}">${closeIcon()}</button>
        </div>`
    : `
        <button class="cal-hd" id="cal-hd" aria-expanded="false">
          ${calGlyph(heading, chart)}
          <span class="cal-month">${esc(monthName(heading))}</span>
          <span class="cal-chev">${chevronIcon()}</span>
        </button>`}
    </div>
    <div class="cal-dow">${dayLetters(monday).map((l) => `<span>${esc(l)}</span>`).join("")}</div>
    <button class="cal-dates" id="cal-dates" aria-expanded="${open}"
      aria-label="${esc(t("app.kidMyWeek"))}">
      ${days.map((d) => dayCell(chart, d, open ? month : "")).join("")}
    </button>`;
}

export function calendarHtml(chart) {
  if (!chart?.today) return "";
  return `<section class="k-cal ${isOpen() ? "is-open" : ""}" id="k-cal">${inner(chart)}</section>`;
}

/** Repaint the calendar ALONE. Everything above it is untouched, so opening the
 *  month can only ever push Today down. */
function paint() {
  const sec = document.getElementById("k-cal");
  const chart = state.chart;
  if (!sec || !chart?.today) return;
  sec.className = `k-cal ${isOpen() ? "is-open" : ""}`;
  sec.innerHTML = inner(chart);
  wireCalendar();
}

async function ensureMonth(month) {
  if (!month || monthFeeds.has(month) || loading === month) return;
  const kid = state.child;
  if (!kid) return;
  loading = month;
  const feed = await api.month(kid.id, month).catch(() => null);
  loading = "";
  // Painting only for the month still on screen: a kid can page past a slow month,
  // and repainting on its late arrival would yank the grid out from under them.
  if (feed && !feed.error) {
    monthFeeds.set(month, feed);
    if (shownMonth(state.chart ?? {}) === month) paint();
  }
}

/** Open or close the month. Also what the dock's week button does. */
export function toggleCalendar() {
  setOpen(!isOpen());
  // Closing returns to today. The week strip under a shut calendar is always THIS
  // week, so leaving viewMonth parked would name the wrong month over the right dates.
  if (!isOpen()) viewMonth = "";
  paint();
  if (isOpen()) ensureMonth(shownMonth(state.chart ?? {}));
}

/** Step the grid a month. Never past the month Today is in — the same bound the
 *  disabled arrow draws, kept here too so it holds however the call arrives. */
function stepMonth(n) {
  const chart = state.chart;
  if (!chart?.today) return;
  const next = addMonths(shownMonth(chart), n);
  // Both bounds are enforced here as well as on the disabled attribute, so they hold
  // however the call arrives — a keyboard repeat can fire click faster than the repaint
  // that greys the arrow out.
  if (next > thisMonth(chart) || next < firstMonth(chart)) return;
  viewMonth = next;
  paint();          // the grid is drawn from monthGrid() immediately, feed or no feed
  ensureMonth(next);
}

export function wireCalendar() {
  if (!document.getElementById("k-cal")) return;
  // Three ways out, and that is deliberate: the X is the one a kid is TOLD about, the header
  // is the control they opened it with, and a date is where their finger already is. The
  // problem #402 fixed was never how many ways there were, it was that none of them looked
  // different from the month arrows.
  for (const id of ["cal-hd", "cal-dates", "cal-shut"]) {
    const el = document.getElementById(id);
    if (el) el.onclick = toggleCalendar;
  }
  const prev = document.getElementById("cal-prev");
  if (prev) prev.onclick = () => stepMonth(-1);
  const next = document.getElementById("cal-next");
  if (next) next.onclick = () => stepMonth(1);
  if (isOpen()) ensureMonth(shownMonth(state.chart ?? {})); // reopened from a previous session
  markMore();
}

/**
 * SAY THERE IS MORE BELOW (2026-09-07).
 *
 * `.cal-dates` is capped at 42svh and SCROLLS; all 42 cells always render, and #401 put that cap
 * there so a 6-week month cannot eat the column Today needs. Measured on v0.118.5: the grid is
 * over by 63px on an 800x1280 tablet and 114px on a 390x844 phone, so the last week sits under
 * the fold with a row cut in half and nothing saying it can be reached. It reads as broken.
 *
 * ⚠️ It cannot be fixed by tapping, because `.cal-dates` is one of the three ways to CLOSE the
 * calendar (#402): a finger put on the last row to drag it up shuts the whole thing if it does
 * not move. A drag still scrolls, so the gap is purely that nothing announces the scroll.
 *
 * ⚠️ CSS alone cannot ask "is this element scrollable", so the state is a data attribute and
 * the fade hangs off it. `scroll` and `resize` both re-run it: the cap is a viewport unit, so
 * turning the tablet changes the answer without any re-render.
 */
function markMore() {
  const d = document.getElementById("cal-dates");
  if (!d) return;
  const set = () => {
    const more = d.scrollHeight - d.clientHeight - d.scrollTop > 2;
    d.dataset.more = more ? "1" : "0";
  };
  set();
  d.onscroll = set;
  addEventListener("resize", set, { passive: true });
}
