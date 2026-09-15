// nimiq.kids parent — PROGRESS: how a kid is actually doing, over time (#379).
//
// A sub-page of the per-kid page, not a fifth tab. The tab bar is chrome and stays four
// wide (core.js), and this answers a question a parent asks ABOUT ONE CHILD, standing on
// that child's page already.
//
// WHAT IT DELIBERATELY DOES NOT DO: score them. There is no streak, no percentage, no
// grade. Every chart here is counts and minutes over days, because the question Andjroo
// asked was "are they trending up", and a single composite number is the fastest way to
// turn a chart a parent reads into a number a child is measured by.
//
// The four charts share ONE x axis (the same window, same order, same width), which makes
// them small multiples rather than four unrelated pictures: a week where screen time went
// up and practice went down is visible by looking straight down the column.

import { state, t, views, go, call, render } from "./core.js";
import { duotone, icon } from "./icons.js";
import { esc } from "./fmt.js";
import { dailyBars, donut, legend, wireCharts, SERIES } from "./charts.js";

/** Ranges a parent actually means. Beyond 90 the daily grain stops being the question. */
const RANGES = [7, 14, 30];

/** The shelf names, in the household's language. Falls back to the raw kind, which is
 *  English and lowercase but never a blank slice. */
const KIND_LABEL = {
  pack: "papp.prgShelfPack",
  screen_time: "papp.prgShelfScreen",
  coupon: "papp.prgShelfCoupon",
  timer_style: "papp.prgShelfTimer",
};

const sum = (points) => points.reduce((n, p) => n + p.value, 0);
const avg = (points) => (points.length ? Math.round(sum(points) / points.length) : 0);

export async function loadProgress(days = state.progressDays ?? 14) {
  state.progressDays = days;
  const r = await call("GET", `/api/parent/progress?days=${days}`).catch(() => null);
  // A failed read leaves the LAST payload up rather than blanking the screen: a parent
  // looking at a fortnight of charts on a flaky phone would rather see slightly stale
  // numbers than an empty card that says nothing at all.
  if (r?.status === 200) state.progress = r.data;
  render();
}

/** One number, big, with what it is under it. The dataviz rule: when the answer IS a
 *  number, a chart of one value is a worse way to say it. */
function tile(value, unit, label) {
  // Thousands grouped the way fmtNim groups them: "42 007", not "42007". The tile shows a
  // count or a whole number of NIM, so this is the same rule with no fraction to carry.
  const shown = typeof value === "number" ? String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") : String(value);
  return `<div class="prg-tile">
    <div class="prg-tile-v">${esc(shown)}<span class="prg-tile-u">${esc(unit)}</span></div>
    <div class="prg-tile-l">${esc(label)}</div>
  </div>`;
}

function chartCard(title, sub, series, body) {
  return `<section class="card prg-card">
    <div class="prg-hd"><h3>${esc(title)}</h3>${sub ? `<span class="prg-sub">${esc(sub)}</span>` : ""}</div>
    ${legend(series)}
    ${body}
  </section>`;
}

views.progress = (el) => {
  const kid = state.overview?.children.find((k) => k.id === state.kidId);
  if (!kid) { go("home"); return; }
  const p = state.progress?.children?.find((c) => c.id === kid.id);
  const days = state.progressDays ?? 14;

  if (!p) {
    el.innerHTML = `<div class="card pstate"><h3>${t("papp.loading")}</h3></div>`;
    loadProgress(days);
    return;
  }
  const window = state.progress.window;

  const screenSeries = [
    { key: "used", label: t("papp.prgScreenUsed"), color: SERIES.gold, points: p.screenMin },
    { key: "bought", label: t("papp.prgScreenBought"), color: SERIES.blue, points: p.screenEarnedMin },
  ];
  const jobSeries = [
    { key: "ok", label: t("papp.prgJobsApproved"), color: SERIES.green, points: p.approved },
    { key: "no", label: t("papp.prgJobsRejected"), color: SERIES.red, points: p.rejected },
  ];
  const practiceSeries = [
    { key: "practice", label: t("papp.prgPractice"), color: SERIES.blue, points: p.practiceMin },
  ];
  const earnSeries = [
    { key: "earned", label: t("papp.prgEarned"), color: SERIES.green, points: p.earnedNim },
  ];

  const spent = p.spendByKind.reduce((n, s) => n + s.nim, 0);

  el.innerHTML = `
    <div class="kid-top">
      <button class="back-btn" id="prg-back">${icon("chevron-left", 16)} ${esc(kid.label)}</button>
    </div>

    <div class="prg-range" role="group" aria-label="${esc(t("papp.prgRange"))}">
      ${RANGES.map((d) => `<button class="pill-btn ghost sm ${d === days ? "on" : ""}"
        data-days="${d}">${esc(t("papp.prgDays", { days: d }))}</button>`).join("")}
    </div>

    <div class="prg-tiles">
      ${tile(avg(p.screenMin), t("papp.prgMinShort"), t("papp.prgAvgScreen"))}
      ${tile(sum(p.approved), "", t("papp.prgJobsDone"))}
      ${tile(sum(p.practiceMin), t("papp.prgMinShort"), t("papp.prgPracticeTotal"))}
      ${tile(sum(p.earnedNim), "NIM", t("papp.prgEarnedTotal"))}
    </div>

    ${chartCard(
      t("papp.prgScreenTitle"),
      p.dailyScreenMin > 0 ? t("papp.prgScreenSub", { mins: p.dailyScreenMin }) : t("papp.prgNoMeter"),
      screenSeries,
      dailyBars({
        window, series: screenSeries, unit: t("papp.prgMinShort"),
        // The line they are spending against. Only drawn when there IS one: a dashed rule
        // labelled "0" over an unmetered kid would be describing a rule that does not exist.
        rule: p.dailyScreenMin > 0
          ? { value: p.dailyScreenMin, label: t("papp.prgBudgetLine") } : null,
      }),
    )}

    ${chartCard(t("papp.prgJobsTitle"), t("papp.prgJobsSub"), jobSeries,
      dailyBars({ window, series: jobSeries }))}

    ${chartCard(t("papp.prgPracticeTitle"), t("papp.prgPracticeSub"), practiceSeries,
      dailyBars({ window, series: practiceSeries, unit: t("papp.prgMinShort") }))}

    ${chartCard(t("papp.prgEarnedTitle"), t("papp.prgEarnedSub"), earnSeries,
      dailyBars({ window, series: earnSeries, unit: " NIM" }))}

    ${spent > 0 ? `<section class="card prg-card">
      <div class="prg-hd"><h3>${esc(t("papp.prgSpentTitle"))}</h3></div>
      ${donut({
        slices: p.spendByKind.map((s) => ({
          label: KIND_LABEL[s.kind] ? t(KIND_LABEL[s.kind]) : s.kind, value: s.nim,
        })),
        centerValue: spent, centerLabel: "NIM",
      })}
    </section>` : ""}

    <details class="card prg-table">
      <summary>${esc(t("papp.prgTable"))}</summary>
      ${tableOf(window, [...screenSeries, ...jobSeries, ...practiceSeries, ...earnSeries])}
    </details>`;

  document.getElementById("prg-back").onclick = () => { state.progressOpen = false; go("home", kid.id); };
  el.querySelectorAll("[data-days]").forEach((b) => (b.onclick = () => loadProgress(Number(b.dataset.days))));
  wireCharts(el);
};

/**
 * The same numbers as a table, behind a disclosure.
 *
 * Not an accessibility box-tick: colour and length are the only two things the charts
 * encode, and both are unavailable to somebody who cannot see them or is reading this on a
 * phone in sunlight. It is also the fastest way for a parent to check a number the chart
 * only implies -- "what exactly was Tuesday".
 */
function tableOf(window, series) {
  return `<div class="prg-table-scroll"><table>
    <thead><tr><th>${esc(t("papp.prgDay"))}</th>${series.map((s) =>
      `<th>${esc(s.label)}</th>`).join("")}</tr></thead>
    <tbody>${window.map((day) => `<tr><td>${esc(day)}</td>${series.map((s) =>
      `<td>${esc(String(s.points.find((p) => p.day === day)?.value ?? 0))}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>`;
}

/* The door in, built from the roster's own row vocabulary (hex-tile / row-main / chev) so
   it reads as another thing you can tap on this page rather than a new kind of card —
   exactly as `boardRow` does, two rows above it.

   Unlike the board, a SUPPORTER does see this one. Everything behind it is read-only: it
   creates nothing, prices nothing and retires nothing, and a grandparent who is trusted to
   approve a kid's jobs is trusted to see whether the kid is doing them. */
export function progressRow(kid) {
  const label = t("papp.prgRow");
  const sub = t("papp.prgRowSub", { name: esc(kid.label) });
  return `<div class="group"><button class="row" id="go-progress">
    <span class="hex-tile">${duotone("duotone-speedmeter", 22)}</span>
    <span class="row-main">
      <span class="row-label" title="${esc(label)}">${label}</span>
      <span class="row-sub" title="${esc(sub)}">${sub}</span>
    </span>
    <span class="chev">${icon("chevron-right", 14)}</span>
  </button></div>`;
}

export function wireProgressRow(el, kid) {
  el.querySelector("#go-progress")?.addEventListener("click", () => {
    state.progressOpen = true;
    // A different kid's charts must not paint with the last kid's series for a frame.
    if (state.progress && !state.progress.children?.some((c) => c.id === kid.id)) state.progress = null;
    go("home", kid.id);
  });
}
