// The two pieces EVERY card on the chart is built from.
//
// Split out of chart.js at the 800-line guard, and they are the right thing to take out first
// because they are the only two the three card kinds genuinely share: a job, a practice and a
// goal each draw their own row, and each draws it with this picture and this price. Keeping
// them here is also what lets `upkeep.js` exist without importing chart.js, which would be a
// cycle — chart.js already imports upkeep.js.

import { esc, fmtNimWhole } from "./util.js";

/** The picture on a job card: the drawn icon when one exists for that emoji
 *  (src/task-icons.ts resolves it server-side), else the emoji itself, so a
 *  parent can still type any emoji they like and have it render. */
export function jobIcon(tk, fallback = "⭐") {
  return tk.iconUrl
    ? `<img class="ch-task-icon" src="${esc(tk.iconUrl)}" alt="" draggable="false" />`
    : `<span class="ch-task-emoji">${esc(tk.emoji ?? fallback)}</span>`;
}

// Whole coins, never a fraction: a reward is agreed in dollars and paid in NIM.
export const nimPill = (luna) => luna > 0 ? `<span class="k-nim-pill">+${fmtNimWhole(luna)} NIM</span>` : "";
