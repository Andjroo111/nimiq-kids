// nimiq.kids parent — the chart primitives behind the progress tracker (#379).
//
// Hand-drawn SVG, no library. Not asceticism: every charting library ships a canvas
// renderer, its own tooltip DOM and a theme system, and this app needs four chart shapes
// against one palette and already has a tooltip idiom. A dependency here would be more
// code than this file, and none of it would know what a "day" is in this household.
//
// THE PALETTE IS VALIDATED, NOT CHOSEN BY EYE. These four are the Nimiq brand hues stepped
// down until they pass the six checks (lightness band, chroma floor, adjacent CVD
// separation, normal-vision floor, contrast vs surface) in BOTH light and dark:
//
//   #0582CA blue · #A9790B gold · #0E8C79 green · #D94432 red
//
// The raw brand gold (#E9B213) and green (#21BCA5) both FAIL contrast against a light card
// (1.89:1 and 2.32:1) and the gold sits outside the lightness band entirely. They are right
// for a hero and wrong for a 12px bar next to another 12px bar. Do not "restore the brand
// colors" here without re-running the validator.
//
// Colour follows the ENTITY, never its rank: `screen used` is always gold wherever it
// appears, whether or not `screen bought` has any rows that week. A filter that repaints
// the survivors is the fastest way to make a parent stop trusting a chart.

export const SERIES = {
  blue: "#0582CA",
  gold: "#A9790B",
  green: "#0E8C79",
  red: "#D94432",
};

// Text and grid wear the LINE (the paint set, 2026-09-18). The four series stay as validated:
// the paint set run through the dataviz validator as a categorical palette fails CVD
// separation (coral against grass, protan ΔE 5.6), so a chart keeps its own stepped hues.
const INK = "#1C1B13";
const MUTED = "rgba(28, 27, 19, 0.5)";
const GRID = "rgba(28, 27, 19, 0.10)";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** 'Mon 14' — the label under a bar. Short enough that fourteen of them fit a phone. */
function dayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { dow: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][dt.getUTCDay()], dom: String(d) };
}

/**
 * A "nice" axis maximum: the smallest round number at or above the data, so the gridline
 * a parent reads is 60 and not 57. Falls back to 1 for an all-zero series, because an axis
 * that tops out at 0 draws every bar full-height, which is the exact opposite of the truth.
 */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (v <= step * mag) return step * mag;
  }
  return 10 * mag;
}

/**
 * Stacked daily bars.
 *
 * @param {object} o
 * @param {string[]} o.window      ISO days, oldest first — the x axis
 * @param {{key:string,label:string,color:string,points:{day:string,value:number}[]}[]} o.series
 * @param {string} [o.unit]        appended to tooltip values ('min', 'NIM')
 * @param {{value:number,label:string}} [o.rule]  a dashed reference line (the budget)
 */
export function dailyBars({ window: days, series, unit = "", rule = null }) {
  const H = 132;              // plot height; the label strip lives outside it
  const total = (day) => series.reduce((n, s) =>
    n + (s.points.find((p) => p.day === day)?.value ?? 0), 0);
  const peak = Math.max(...days.map(total), rule?.value ?? 0);
  const max = niceMax(peak);
  const colW = 100 / days.length;
  // The bar is narrower than its column so adjacent days never touch: two fills that meet
  // read as one wider bar, which is the stacked-bar failure this 2px gap exists to prevent.
  const barW = Math.max(3, colW * 0.62);

  const bars = days.map((day, i) => {
    const x = i * colW + (colW - barW) / 2;
    let acc = 0;
    // Drawn bottom-up so the stack order matches the legend order top-down.
    const segs = series.map((s) => {
      const v = s.points.find((p) => p.day === day)?.value ?? 0;
      if (v <= 0) return "";
      const h = (v / max) * H;
      const y = H - acc - h;
      acc += h;
      return `<rect class="ch-seg" x="${x}%" y="${y}" width="${barW}%" height="${Math.max(h, 1)}"
        rx="2" fill="${s.color}"></rect>`;
    }).join("");
    const t = total(day);
    const parts = series
      .map((s) => `${s.label} ${s.points.find((p) => p.day === day)?.value ?? 0}${unit}`)
      .join(" · ");
    // ONE hit target per column, the full height of the plot — a 3px-tall segment is not
    // something a thumb can hit, and the question a parent has is about the day anyway.
    return `<g class="ch-col" tabindex="0" role="listitem"
      aria-label="${esc(dayLabel(day).dow)} ${esc(dayLabel(day).dom)}: ${esc(parts)}"
      data-tip="${esc(parts)}" data-day="${esc(day)}">
      <rect x="${i * colW}%" y="0" width="${colW}%" height="${H}" fill="transparent"></rect>
      ${segs}
      ${t > 0 ? "" : `<rect class="ch-zero" x="${x}%" y="${H - 2}" width="${barW}%" height="2" rx="1"></rect>`}
    </g>`;
  }).join("");

  // THE RULE IS HTML, NOT SVG, and that is not a style preference.
  //
  // The plot uses preserveAspectRatio="none" so its 100 x-units stretch to whatever the card
  // is wide — which is what lets a bar's x and width be percentages and survive any screen.
  // But a non-uniform scale stretches EVERYTHING drawn in that space, and the first version
  // of this put the reference line and its label inside it: the label came out as a row of
  // letters pulled to five times their width, and the dashes came out as long bars with
  // hairline gaps. Rects survive the stretch because a rectangle stretched is a rectangle.
  // Text and dash patterns do not.
  const ruleY = rule ? H - (rule.value / max) * H : 0;
  const ruleEl = rule
    ? `<div class="ch-rule" style="top:${ruleY}px"><span>${esc(rule.label)}</span></div>`
    : "";

  const labels = days.map((day, i) => {
    const { dow, dom } = dayLabel(day);
    // Every day gets its date; only the week's start gets its weekday, or fourteen
    // two-letter labels turn into a grey smear nobody reads.
    const showDow = i === 0 || i === days.length - 1 || dow === "Mo";
    return `<div class="ch-lab" style="width:${colW}%">
      <span class="ch-dom">${esc(dom)}</span>${showDow ? `<span class="ch-dow">${esc(dow)}</span>` : ""}
    </div>`;
  }).join("");

  return `
    <div class="ch-wrap">
      <div class="ch-ymax">${esc(String(max))}${esc(unit)}</div>
      <svg class="ch-svg" viewBox="0 0 100 ${H}" preserveAspectRatio="none"
           role="list" aria-label="Daily totals">
        <line class="ch-grid" x1="0" y1="0.5" x2="100%" y2="0.5"></line>
        <line class="ch-grid" x1="0" y1="${H / 2}" x2="100%" y2="${H / 2}"></line>
        <line class="ch-base" x1="0" y1="${H}" x2="100%" y2="${H}"></line>
        ${bars}
      </svg>
      ${ruleEl}
      <div class="ch-labs">${labels}</div>
    </div>`;
}

/** Legend. Always drawn for two or more series; a single series is named by the title. */
export function legend(series) {
  if (series.length < 2) return "";
  return `<div class="ch-key">${series.map((s) =>
    `<span class="ch-key-i"><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}</div>`;
}

/**
 * Donut for composition — where the NIM went.
 *
 * A donut rather than a pie because the hole holds the total, which is the number a parent
 * actually wants; and only for a handful of slices, because past about five a human is
 * comparing angles they cannot compare. Anything beyond the top four folds into "Other"
 * rather than becoming a fifth generated hue.
 */
export function donut({ slices, centerValue, centerLabel }) {
  const palette = [SERIES.blue, SERIES.gold, SERIES.green, SERIES.red];
  const top = slices.slice(0, 4);
  const rest = slices.slice(4).reduce((n, s) => n + s.value, 0);
  const parts = rest > 0 ? [...top, { label: "Other", value: rest }] : top;
  const total = parts.reduce((n, s) => n + s.value, 0);
  if (total <= 0) return "";

  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  const rings = parts.map((s, i) => {
    const frac = s.value / total;
    // A 2px surface gap between neighbouring arcs, same rule as the bars: two fills that
    // meet with no gap read as one slice.
    const len = Math.max(0, frac * C - 2);
    const el = `<circle class="ch-arc" r="${R}" cx="70" cy="70" fill="none"
      stroke="${palette[i % palette.length]}" stroke-width="16"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc * C}"
      tabindex="0" role="listitem"
      aria-label="${esc(s.label)}: ${esc(String(s.value))}"
      data-tip="${esc(s.label)} · ${esc(String(s.value))} NIM"></circle>`;
    acc += frac;
    return el;
  }).join("");

  return `
    <div class="ch-donut">
      <svg viewBox="0 0 140 140" role="list" aria-label="Spending by shelf">
        <g transform="rotate(-90 70 70)">${rings}</g>
        <text class="ch-donut-v" x="70" y="68" text-anchor="middle">${esc(String(centerValue))}</text>
        <text class="ch-donut-l" x="70" y="86" text-anchor="middle">${esc(centerLabel)}</text>
      </svg>
      <div class="ch-key col">${parts.map((s, i) =>
        `<span class="ch-key-i"><i style="background:${palette[i % palette.length]}"></i>${esc(s.label)}
          <b>${esc(String(s.value))}</b></span>`).join("")}</div>
    </div>`;
}

/**
 * One hover/focus tooltip for every chart on the screen.
 *
 * Delegated from the container rather than bound per mark: a fortnight of four charts is
 * ~120 marks, and 120 listeners that all do the same thing is 120 things to unbind when
 * the view repaints on its poll. Focus as well as hover, because these are the only
 * controls on the page a keyboard or a screen reader can reach.
 */
export function wireCharts(root) {
  const tip = document.createElement("div");
  tip.className = "ch-tip";
  tip.hidden = true;
  root.appendChild(tip);

  // VIEWPORT coordinates, not offsets inside `root`. An absolutely-positioned tip would
  // need a positioned ancestor, and this file cannot know whether the container it is
  // handed has one -- if it does not, the tip lands relative to the page and drifts by the
  // whole scroll offset. `fixed` needs nothing from anybody.
  const show = (el) => {
    const text = el.dataset.tip;
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth || 120;
    // Clamped to the viewport so the last column's tip does not hang off the right edge,
    // which on a phone is most of the chart.
    tip.style.left = `${Math.min(Math.max(r.left + r.width / 2, w / 2 + 6), innerWidth - w / 2 - 6)}px`;
    tip.style.top = `${r.top - 8}px`;
  };
  const hide = () => { tip.hidden = true; };

  root.addEventListener("pointerover", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) show(el); else hide();
  });
  root.addEventListener("pointerleave", hide);
  root.addEventListener("focusin", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) show(el);
  });
  root.addEventListener("focusout", hide);
}
