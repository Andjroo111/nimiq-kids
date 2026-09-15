// nimiq.kids parent — WHAT THE TABLET IS DOING (#305).
//
// The third and last side of screen control. #303 is the schedule a parent WRITES, #304 is
// the override they write today, and this is the only one that is not a write at all: the
// answer the tablet is already following, told to the household on the phone in their hand.
//
// Until now the server computed state / reason / routine / approval / until per device and
// served it to the tablet alone. A parent whose kid was standing in front of a locked screen
// waiting for someone to approve their morning routine had nothing on their phone that said
// so, and the feature reads as broken to the kid long before it reads as missing to a parent.
//
// THREE RULES:
//
//  · THE SERVER RULED. This file picks words, and that is all it does. Which override wins,
//    whether a window is open, whether a run counts as done — all of it arrives decided
//    (`GET /api/parent/screen-state`, one computation shared with the tablet's own feed). A
//    client that re-derives any of it is a second copy of the rule that can disagree with the
//    screen it is describing.
//  · A ROW IS A TABLET, NOT A KID. Screen state is a fact about a paired device: a household
//    with no tablet has none, and the section is not drawn rather than drawn empty — the same
//    call #306 made for the Treasure Box shelf.
//  · WAITING IS THE LOUD ONE. `PENDING_APPROVAL` means a child is sitting in front of a
//    locked screen right now, and it is the only state on this screen a parent can end with
//    one tap. It gets the accent treatment and taps straight through to that approval;
//    everything else goes to the kid's own page, where the lock buttons are.

import { go, lang, rowTitle, state, t } from "./core.js";
import { esc, timeAgo, timeHM } from "./fmt.js";
import { icon } from "./icons.js";

/** A live tablet re-reads its state every 15s, so ten minutes of silence is a tablet that is
 *  off, out of the house or off the network — and this screen must not answer confidently for
 *  a device it has not heard from. */
const STALE_MS = 10 * 60_000;

/** This kid's tablet, or null. First match: a second tablet bound to the same child computes
 *  the identical state, so the roster row would say the same sentence twice. */
export const screenForKid = (childId) =>
  (Array.isArray(state.screens) ? state.screens : []).find((s) => s.childId === childId) ?? null;

/** The routine the tablet is waiting on, in the reader's language when we named it. */
const jobName = (s) => rowTitle({ title: s.routineTitle, titleKey: s.routineTitleKey });

/**
 * One screen state, as one sentence.
 *
 * The override cases deliberately borrow #304's own `papp.ovr*` lines rather than growing a
 * parallel set: a grown-up's lock says the same thing wherever it is read, and two wordings
 * for one row is how a parent comes to think there are two overrides.
 *
 * The default arm keys off `state` rather than `reason`, so a reason a newer server invents
 * degrades to "Locked" / "Free right now" instead of rendering a raw enum at a parent.
 */
export function screenSentence(s) {
  const time = s.until ? timeHM(s.until, lang()) : null;
  const job = jobName(s);
  switch (s.reason) {
    case "override_lock":
      return { ic: "locked-lock", txt: time ? t("papp.ovrLockedTill", { time }) : t("papp.ovrLockedOpen") };
    case "override_unlock":
      // A kid's bought minutes are not something a grown-up here chose, and #301 settled that
      // the two must never be told as one thing.
      if (s.overrideSource === "purchase") {
        return { ic: "unlocked-lock", txt: time ? t("papp.ovrBought", { time }) : t("papp.ovrFreeOpen") };
      }
      return { ic: "unlocked-lock", txt: time ? t("papp.ovrFreeTill", { time }) : t("papp.ovrFreeOpen") };
    // #377. Two locks a kid cannot lift, and a parent reads them very differently from a
    // routine: nothing is owed and nothing is waiting on them, so neither line asks for
    // anything. Both name the time they end, because that is the only question either raises.
    case "outside_hours":
      return { ic: "locked-lock", txt: time ? t("papp.scrNightTill", { time }) : t("papp.scrNight") };
    case "budget_spent":
      return { ic: "locked-lock", txt: time ? t("papp.scrSpentTill", { time }) : t("papp.scrSpent") };
    case "break_time":
      return { ic: "locked-lock", txt: time ? t("papp.scrRestTill", { time }) : t("papp.scrRest") };
    case "routine_due":
      return { ic: "locked-lock", txt: job ? t("papp.scrLockedFor", { job }) : t("papp.scrLocked") };
    case "awaiting_approval":
      return { ic: "bell", urgent: true, txt: job ? t("papp.scrWaitingFor", { job }) : t("papp.scrWaiting") };
    case "routine_approved":
    case "outside_windows":
      // With a meter running, `until` is usually when the BUDGET runs out rather than a
      // schedule boundary, and "Free until 3:42" over 18 minutes of allowance is a worse
      // answer than the minutes themselves. Say the minutes when we have them.
      if (typeof s.budgetSec === "number" && s.budgetSec > 0) {
        const left = Math.max(0, Math.round((s.budgetSec - (s.usedSec ?? 0)) / 60));
        return { ic: "unlocked-lock", txt: t("papp.scrMinsLeft", { mins: left }) };
      }
      return { ic: "unlocked-lock", txt: time ? t("papp.scrFreeTill", { time }) : t("papp.scrFree") };
    case "no_windows":
      return { ic: "unlocked-lock", txt: t("papp.scrNoSchedule") };
    case "no_children":
      return { ic: "unlocked-lock", txt: t("papp.scrNoKid") };
    default:
      if (s.state === "PENDING_APPROVAL") return { ic: "bell", urgent: true, txt: t("papp.scrWaiting") };
      return s.state === "LOCKED_ROUTINE"
        ? { ic: "locked-lock", txt: t("papp.scrLocked") }
        : { ic: "unlocked-lock", txt: t("papp.scrFree") };
  }
}

/** Named by the CHILD it follows, because that is who the parent is thinking about — the
 *  device's own label is the fallback for a tablet bound to nobody. */
const screenLabel = (s) =>
  state.overview?.children.find((k) => k.id === s.childId)?.label ?? s.deviceLabel ?? t("papp.tablet");

/** Said only when it is true and only when it matters: a tablet we have not heard from cannot
 *  be answered for, and the sentence above it is the last thing it told us, not the truth.
 *
 *  Its own words rather than Settings' `papp.neverSeen`, which reads fine under a device's
 *  own label ("Demo tablet / never checked in") and reads as a fragment of the state line
 *  here ("Locked until Morning routine is done / never checked in"). This line has to name
 *  its own subject, because the line above it is about the SCREEN and this one is about the
 *  device we heard it from. */
export function screenStaleLine(s) {
  if (s.lastSeenAt === null) return t("papp.scrNeverSeen");
  return Date.now() - s.lastSeenAt > STALE_MS ? t("papp.scrStale", { ago: timeAgo(s.lastSeenAt, lang()) }) : "";
}

/** The charge, said only once the tablet has ever reported one. A stale number keeps its
 *  number: the line above already says when the tablet last spoke, and "Battery 12%" from
 *  this morning is still the last true thing known about it. */
export function screenBatteryLine(s) {
  if (typeof s.batteryPct !== "number") return "";
  return t(s.batteryCharging ? "papp.scrBatteryCharging" : "papp.scrBattery", { pct: s.batteryPct });
}

/**
 * The home section, and it is now the LEFTOVERS (#414).
 *
 * Andjroo, 2026-09-01: "to me, it's like, either the kid is in a tablet or out of a tablet and
 * then has a wallet or not, all in one thing". A tablet bound to a kid on the roster says its
 * sentence on THAT KID'S ROW now (`kidSub`, views-wallet.js), where the parent is already
 * looking, so repeating it in a group of its own is the same fact twice and a whole extra
 * section between the balance and the people who earned it.
 *
 * What is left is the tablet bound to NOBODY: a device paired to the household and not yet
 * given a child, which has no roster row to live on and would otherwise vanish from the app
 * the moment this section stopped being drawn. A settled household has none, so on a settled
 * household this returns "" and the home screen is the balance, the queue and the kids.
 */
export function screensGroup() {
  const roster = new Set((state.overview?.children ?? []).map((k) => k.id));
  const screens = (Array.isArray(state.screens) ? state.screens : [])
    .filter((s) => !s.childId || !roster.has(s.childId));
  if (screens.length === 0) return "";
  const rows = screens.map((s) => {
    const { ic, txt, urgent } = screenSentence(s);
    const stale = screenStaleLine(s);
    const batt = screenBatteryLine(s);
    return `<button class="row scr-row${urgent ? " urgent" : ""}"
        data-scr="${esc(s.deviceId)}" data-scr-kid="${esc(s.childId ?? "")}"
        data-scr-approval="${esc(urgent ? s.approvalId ?? "" : "")}">
      <span class="hex-tile">${icon(ic, 22)}</span>
      <span class="row-main">
        <span class="row-label">${esc(screenLabel(s))}</span>
        <span class="row-sub">${esc(txt)}</span>
        ${stale ? `<span class="row-sub scr-stale">${esc(stale)}</span>` : ""}
        ${batt ? `<span class="row-sub scr-batt">${esc(batt)}</span>` : ""}
      </span>
      <span class="chev">${icon("chevron-right", 14)}</span>
    </button>`;
  }).join("");
  return `<div class="group scr-group">
    <div class="group-sub">${t("papp.scrTitle")}</div>
    ${rows}
  </div>`;
}

export function wireScreensGroup(el) {
  el.querySelectorAll("[data-scr]").forEach((b) => (b.onclick = () => {
    const approvalId = b.dataset.scrApproval;
    // Straight to the card that ends it. The approvals feed already knows how to scroll to
    // and highlight one id (`state.deepLinkId`), which is the same landing an ntfy tap gets.
    if (approvalId) { state.deepLinkId = approvalId; go("approvals"); return; }
    // Otherwise the kid's own page: seeing the state and doing something about it are one
    // move, and Lock now / Give screen time live there (#304).
    if (b.dataset.scrKid) go("home", b.dataset.scrKid);
  }));
}
