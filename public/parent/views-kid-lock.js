// nimiq.kids parent — SCREEN CONTROL: lock or unlock a kid's tablet right now (#304).
//
// The schedule (#303) is a rule about every future Tuesday. This is the sentence a parent
// says today: screen off, now, because of what just happened at the dinner table. Both
// write `lock_overrides`; only this one is a fact about the moment, which is why it lives
// on the kid's own page beside their balance rather than on a routine's card.
//
// Its own file rather than more of views-wallet.js: that screen is the money screen, this
// is the tablet, and the sheet below is most of what either of them weighs.
//
// TWO RULES CARRY THE WHOLE SCREEN, and both are about telling a parent the truth over
// giving them a bigger button:
//
//  · A PURCHASE IS NAMED AS A PURCHASE. `activeOverride` hands back one winner and a
//    parent's own row hides a kid's bought minutes from it completely (author beats
//    recency, src/repo-lock.ts). The overview therefore sends `purchasedUnlock` alongside
//    the winner, and this screen says what is underneath rather than pretending the only
//    thing happening is the thing a grown-up did.
//  · CLEAR ONLY EVER UNDOES A GROWN-UP. It is not offered on a purchase, and the server
//    refuses it there too (409 `purchased_minutes`) — deleting that row would take back
//    minutes a kid spent real NIM on, with no refund and nothing on their screen to say
//    why. A parent who wants the tablet off gets it with `Lock now`, which outranks a
//    purchase outright and leaves it intact for when they change their mind.
//
// Reading the tablet's own live state — locked because a routine is not done, waiting on an
// approval, free until 8:30 — is #305. It is a different question, and the line at the top of
// this card is now the SERVER's answer to it whenever a tablet is paired: this screen is still
// what a parent WRITES, but it must not describe the tablet from the override row alone.

import { call, closeSheet, lang, openSheet, refresh, render, state, t, toast } from "./core.js";
import { esc, timeHM } from "./fmt.js";
import { boxMinutes, icon } from "./icons.js";
import { loadScreenTime } from "./views-screentime.js";
import { screenForKid, screenSentence } from "./views-screens.js";

const MIN = 60_000;
/** The three lengths, drawn with the same minute dial the kid's Treasure Box tile uses
 *  (icons.js `boxMinutes`), so 30 minutes wears one face in this house and not two. */
const LENGTHS = [15, 30, 60];

const clockAt = (ms) => timeHM(ms, lang());
const minsLeft = (o) => Math.max(1, Math.round(((o?.until_ms ?? 0) - Date.now()) / MIN));
const lengthLabel = (mins) => (mins === 60 ? t("papp.ovrHour") : t("papp.ovrMins", { mins }));

/**
 * What the tablet is doing and WHO decided it.
 *
 * THE SERVER'S OWN RULING COMES FIRST (#305). The override row alone can only describe an
 * override, so this line used to say "Follows the schedule" over a tablet that was locked
 * solid because the morning routine was not done — true about what a grown-up had written
 * and useless about the screen the kid was holding. `screenSentence` reuses these same
 * `papp.ovr*` words for the override cases, so nothing a parent already recognises changes.
 *
 * The derived line below is the fallback for the two cases where there is no ruling to read:
 * a household with no tablet paired, and the moment before the first read lands.
 */
function stateLine(kid) {
  const scr = screenForKid(kid.id);
  if (scr) {
    const said = screenSentence(scr);
    // "Active" is navy rather than grey: something is HAPPENING to this screen. Ordinary
    // schedule-driven freedom is the quiet case, exactly as it was before.
    const active = scr.state !== "UNLOCKED" || scr.reason.startsWith("override_");
    return { ic: said.ic, txt: said.txt, active };
  }
  const o = kid.override;
  if (!o) return { ic: "unlocked-lock", txt: t("papp.ovrSchedule"), active: false };
  if (o.source === "purchase") {
    return {
      ic: "unlocked-lock", active: true,
      txt: o.until_ms ? t("papp.ovrBought", { time: clockAt(o.until_ms) }) : t("papp.ovrFreeOpen"),
    };
  }
  if (o.mode === "lock") {
    return {
      ic: "locked-lock", active: true,
      txt: o.until_ms ? t("papp.ovrLockedTill", { time: clockAt(o.until_ms) }) : t("papp.ovrLockedOpen"),
    };
  }
  return {
    ic: "unlocked-lock", active: true,
    txt: o.until_ms ? t("papp.ovrFreeTill", { time: clockAt(o.until_ms) }) : t("papp.ovrFreeOpen"),
  };
}

/**
 * IS THIS KID'S SCREEN LOCKED RIGHT NOW, or null when nothing can answer.
 *
 * The server's ruling, never the override row. An override row can only describe an
 * override, and a kid can be locked solid with no override at all: outside the household's
 * hours, out of minutes, or standing in front of a routine nobody has approved. The home
 * toggle has to show the screen the kid is holding, not the last thing a grown-up wrote.
 *
 * Null when no tablet is bound to this kid, which is most households. A switch that cannot
 * be answered is not drawn (`kidLockToggle`), for the same reason `screensGroup` is not.
 */
export function kidScreenLocked(kid) {
  const scr = screenForKid(kid?.id);
  return scr ? scr.state !== "UNLOCKED" : null;
}

/**
 * The one-tap lock, on the family home, beside the kid it belongs to (#300).
 *
 * Andjroo, 2026-09-01: "on the home screen I would really like a easy button where I could
 * just close down the app ... basically a toggle to lock it or unlock it. And it should
 * override the timer or the screen time. That's been something that's been a little bit of a
 * struggle: if I wanna override the time, I have to come talk to you to then override it."
 *
 * THIS IS THE ONE CONTROL HERE THAT ACTS ON ITS OWN TAP, and that is a deliberate exception
 * to the rule the sheet below enforces. It is allowed because it is REVERSIBLE IN ONE TAP by
 * the same control that caused it, and because it says what it did: the switch and the kid's
 * sub-line both change, on the screen the parent is already looking at. The sheet still owns
 * every timed choice, where a wrong tap costs an hour a parent cannot hand back.
 *
 * It writes an INDEFINITE override either way, which is what "until I say so" means and what
 * makes it beat the screen-time meter: a parent override sits on top of the meter and the
 * meter does not burn during one (`lock-machine.ts`). Going back to "just follow the
 * schedule" is Clear, on the kid's own page, because that is a third state and this is a
 * switch.
 *
 * KID SIDE ONLY. Confirmed directly: "the toggle should unlock just the kid's portion, not
 * the adult side of things." It writes `lock_overrides` for one child and touches nothing
 * the grown-up app can reach.
 */
export function kidLockToggle(kid) {
  const locked = kidScreenLocked(kid);
  if (locked === null) return "";
  const label = t(locked ? "papp.lockTglOn" : "papp.lockTglOff", { name: kid.label });
  return `<button class="tgl lock-tgl ${locked ? "" : "on"}" data-lock="${esc(kid.id)}"
    role="switch" aria-checked="${locked ? "false" : "true"}"
    aria-label="${esc(label)}" title="${esc(label)}"></button>`;
}

/**
 * Flip it, and do not wait for the round trip to say so.
 *
 * The switch moves first because a toggle that lags a network hop reads as broken and gets
 * tapped twice, and a second tap here writes the opposite override. `disabled` is what makes
 * that safe rather than the optimism: the real state arrives with `refresh()` a moment later
 * and overwrites whatever this guessed, including on a failure.
 */
export async function toggleKidLock(btn, kid) {
  const wasLocked = kidScreenLocked(kid);
  if (wasLocked === null) return;
  btn.disabled = true;
  btn.classList.toggle("on", wasLocked);
  const r = await call("POST", "/api/family/override", {
    mode: wasLocked ? "unlock" : "lock", childId: kid.id, untilMs: null,
  }).catch(() => null);
  if (r?.status !== 201) {
    btn.disabled = false;
    btn.classList.toggle("on", !wasLocked);
    toast(r?.status === 404 ? t("papp.notReady") : t("papp.didntGoThrough"), "error");
    return;
  }
  toast(t(wasLocked ? "papp.ovrGiven" : "papp.ovrLocked"), "success");
  await refresh();
  render();
}

export function lockCard(kid) {
  // NOTHING TO LOCK, NOTHING DRAWN (#420). A household that is KNOWN to own no tablet used to
  // get this card anyway: a state line about a screen that does not exist, two buttons that
  // could not reach anything, and a sentence under them apologising for both. `state.devices`
  // is null before the probe has run or when the endpoint refused, and a maybe still draws
  // the card, the same call #303 makes on the schedule section. Pairing lives in Settings.
  if (Array.isArray(state.devices) && state.devices.length === 0) return "";
  const st = stateLine(kid);
  // The minutes a kid paid for, still ticking under a grown-up's row. Only said when it is
  // actually hidden: when the purchase IS the winner the state line above already names it,
  // and the same fact twice reads as two different overrides.
  const bought = kid.purchasedUnlock;
  const hidden = bought && kid.override && bought.id !== kid.override.id
    ? `<div class="lock-sub">${esc(t("papp.ovrUnderneath", { mins: minsLeft(bought) }))}</div>`
    : "";
  return `<div class="card lock-card">
    <div class="lock-state ${st.active ? "active" : ""}">${icon(st.ic, 15)} ${esc(st.txt)}</div>
    ${hidden}
    <div class="btn-row">
      <button class="pill-btn navy sm" data-ovr="lock">${t("papp.ovrLock")}</button>
      <button class="pill-btn blue sm" data-ovr="unlock">${t("papp.ovrGive")}</button>
      ${kid.override?.source === "parent"
        ? `<button class="pill-btn ghost sm" data-ovr="clear">${t("papp.ovrClear")}</button>` : ""}
    </div>
  </div>`;
}

export function wireLockCard(el, kid) {
  // The curfew is normally read by the Settings card, which a parent may never have opened.
  // Without it the "Until bedtime" row below simply does not appear -- and silently missing
  // a control is exactly the failure that hid the whole Screen control card from Andjroo for
  // weeks. One request, once per session, on the screen that needs the answer.
  if (state.allowWindows === undefined) loadScreenTime();

  el.querySelectorAll("[data-ovr]").forEach((b) => (b.onclick = () => {
    if (b.dataset.ovr !== "clear") { sheetOverride(kid, b.dataset.ovr); return; }
    // Clear acts on its own tap, so it is the one button here that can be double-tapped
    // into a second DELETE of a row that is already gone. That answers 404, which this
    // screen reads as "the tablet controls are not ready" — a lie about a tap that worked.
    b.disabled = true;
    clearOverride(kid);
  }));
}

// ---- the sheet ----------------------------------------------------------------
//
// Neither button acts on its own tap. "Screen off, indefinitely" is the heaviest thing a
// parent can do from their phone and a pocket should not be able to do it, so both open the
// same four choices and the second tap is the one that lands. It is also where the expiry
// the issue asked for actually lives: the same sheet, read in the direction of its mode.

/**
 * "Until bedtime" — minutes from now to when the household's hours next close (#377).
 *
 * Null when there is no curfew, or when we happen to be outside it already: both would make
 * a row that either cannot be computed or ends immediately, and offering a control that
 * expires the moment it is tapped is worse than not offering it.
 *
 * Computed on the CLIENT from the schedule the settings card already loaded, which is the
 * compromise here: the server owns the same arithmetic (`nextBoundary`) and would be exact
 * about DST. This is a convenience row on a sheet, the error is at most an hour twice a
 * year, and a round trip to open a sheet is a worse trade.
 */
export function untilCurfewMins(nowMs = Date.now()) {
  const wins = state.allowWindows;
  if (!Array.isArray(wins) || wins.length === 0) return null;
  const now = new Date(nowMs);
  const dayIdx = (now.getDay() + 6) % 7;           // Mon = 0, matching the mask
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":"); return Number(h) * 60 + Number(m || 0); };

  let soonest = null;
  for (const w of wins) {
    const start = toMin(w.start_hhmm ?? w.startHhmm);
    const end = toMin(w.end_hhmm ?? w.endHhmm);
    const crosses = end <= start;
    const activeToday = w.days[dayIdx] === "1" && mins >= start && (crosses || mins < end);
    if (!activeToday) continue;
    const left = crosses ? (24 * 60 - mins) + end : end - mins;
    if (left > 0 && (soonest === null || left < soonest)) soonest = left;
  }
  return soonest;
}

function sheetOverride(kid, mode) {
  const isLock = mode === "lock";
  const openEnded = { mins: null, label: isLock ? t("papp.ovrOpenLock") : t("papp.ovrOpenGive") };
  const lengths = LENGTHS.map((mins) => ({ mins, label: lengthLabel(mins) }));
  // "Until bedtime", on the GIVE side only. An indefinite unlock is the one control here
  // that can be forgotten and run all night, and this is the row that answers the reason
  // people reach for it -- keep them busy while I do something -- without that risk. It is
  // meaningless on the lock side, where indefinite is exactly what a grounding means.
  const tillCurfew = isLock ? null : untilCurfewMins();
  const tillRow = tillCurfew ? [{ mins: tillCurfew, label: t("papp.ovrTillCurfew") }] : [];
  // Indefinite reads FIRST on a lock and LAST on a gift: a grounding is normally "until I
  // say so" and screen time is normally a handful of minutes.
  const choices = isLock ? [openEnded, ...lengths] : [...lengths, ...tillRow, openEnded];

  openSheet(`
    <h2>${isLock ? t("papp.ovrLockTitle") : t("papp.ovrGiveTitle", { name: esc(kid.label) })}</h2>
    <div class="set-hint">${isLock ? t("papp.ovrLockHint") : t("papp.ovrGiveHint")}</div>
    <div class="ovr-choices">
      ${choices.map((ch) => `
        <button class="pill-btn ghost wide ovr-choice" data-mins="${ch.mins ?? ""}">
          ${ch.mins ? (ch.mins === tillCurfew ? icon("unlocked-lock", 16) : boxMinutes(ch.mins, 20))
            : icon(isLock ? "locked-lock" : "unlocked-lock", 16)}
          <span>${esc(ch.label)}</span>
        </button>`).join("")}
    </div>`);

  document.querySelectorAll(".ovr-choice").forEach((btn) => (btn.onclick = () => {
    document.querySelectorAll(".ovr-choice").forEach((b) => { b.disabled = true; });
    setOverride(kid, mode, btn.dataset.mins ? Number(btn.dataset.mins) : null);
  }));
}

async function setOverride(kid, mode, minutes) {
  const r = await call("POST", "/api/family/override", {
    mode, childId: kid.id, untilMs: minutes ? Date.now() + minutes * MIN : null,
  }).catch(() => null);
  await settle(r, 201, mode === "lock" ? t("papp.ovrLocked") : t("papp.ovrGiven"));
}

/** Clear targets the PARENT row by id, never "whatever is in charge". The two are the same
 *  row whenever this button is drawn at all, and saying so here is what keeps them the same
 *  row if a kid buys minutes between the paint and the tap. */
async function clearOverride(kid) {
  const id = kid.override?.id;
  if (!id) { refresh(); return; }
  const r = await call("DELETE", `/api/family/override/${id}`).catch(() => null);
  await settle(r, 200, t("papp.ovrCleared"));
}

/** One outcome path for all three writes: close, say so, reload — the same shape
 *  views-board.js `finish` uses, over this screen's own refresh. */
async function settle(r, okStatus, msg) {
  if (r?.status !== okStatus) {
    document.querySelectorAll(".sheet .pill-btn").forEach((b) => { b.disabled = false; });
    // `purchased_minutes` is the server refusing to spend a kid's NIM for them. It cannot be
    // reached from this card, which never offers Clear on a purchase, but the route is not
    // this card's alone and "That didn't go through" would be a lie about a rule.
    toast(r?.data?.error === "purchased_minutes" ? t("papp.ovrBoughtKeep")
      : r?.status === 404 ? t("papp.notReady")
      : t("papp.didntGoThrough"), "error");
    return;
  }
  closeSheet();
  toast(msg, "success");
  await refresh();
}
