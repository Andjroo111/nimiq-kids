// "THIS BOARD IS FROM A MOMENT, NOT FROM NOW", the one line a kid gets about being offline.
//
// Its own file because chart.js lives against the 800-line CI guard, and because this is a
// self-contained sentence about state rather than part of drawing the board: `feedDate`,
// `isStaleDay` and the outbox count are three reads that nothing else on the chart makes.

import { state, esc, t, parentName, feedDate } from "./util.js";
import { isStaleDay } from "./snapshot.js";
import { queuedCount } from "./outbox.js";

/**
 * THE LINE THAT SAYS THIS BOARD IS FROM A MOMENT, NOT FROM NOW.
 *
 * Drawn only when the last read of the chart actually failed, so a tablet on the house Wi-Fi
 * never carries it. Two sentences at most, because the reader is four: what is true (no
 * internet), when this was true (a clock time), and, only past midnight, that today's jobs
 * are not on it. That last one is the limit Andjroo chose to accept rather than pre-fetch
 * against; see `isStaleDay` in snapshot.js for why.
 *
 * The queue gets a line only when it has something in it, and it says WHERE those answers
 * went rather than how many there are. A ring that has gone to its waiting look has already
 * told the kid their answer landed; a number would only invite them to count it.
 */
export function offlineNote(chart) {
  if (!state.offline) return "";
  const at = state.syncedAt[`chart:${state.child?.id}`];
  const waiting = queuedCount(state.child?.id);
  return `
    <div class="ch-offline" role="status">
      <p class="ch-offline-lead">${esc(at ? t("app.kidOfflineSince", { time: feedDate(at).time }) : t("app.kidOffline"))}</p>
      ${isStaleDay(chart.today) ? `<p class="ch-offline-sub">${esc(t("app.kidOfflineNewDay"))}</p>` : ""}
      ${waiting ? `<p class="ch-offline-sub">${esc(t("app.kidOfflineQueued", { name: parentName() }))}</p>` : ""}
    </div>`;
}
