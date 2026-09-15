// THE TWO THINGS THAT ARE NOT TODAY: what a kid keeps up, and what they are climbing.
//
// Split out of chart.js at the 800-line guard. It is one unit and not merely the overflow:
// a job answers "when today", and both of these deliberately answer something else —
//
//   a practice   how often THIS WEEK   piano, a workout, reading
//   a goal       how far have I GOT    a ladder of rungs, however long it takes
//
// which is exactly why neither is a time-of-day group and why neither card ever says
// do-this-now. "Hold it for 30 seconds" is not something a kid can be told to do at 4pm on a
// Tuesday. chart.js keeps today; this file keeps the other two axes, cards, groups and taps
// together, so a change to what a practice is lands in one place.
//
// Nothing here imports chart.js. Repainting is the caller's job, handed in as `repaint`, which
// is what keeps this a leaf and not half of a cycle.

import { state, esc, t, toast, parentName, rowTitle } from "./util.js";
import { api } from "./api.js";
import { waitIcon } from "./icons.js";
import { jobIcon, nimPill } from "./card.js";
import { stickerNode, openStickerPicker } from "./stickers.js";
import { openPracticeStepsSheet } from "./practice.js";
import { showGoalPath } from "./goal-path.js";

// ---------- practices ----------
//
// The things a kid KEEPS UP, as opposed to the things a kid does today: piano, a
// workout, reading. Deliberately not a fifth time of day -- morning/afternoon/
// evening all answer "when today", and a practice answers "how often this week".
// So the card never says do-this-now; it says where the week stands, and the
// group sits last because it is the least time-bound thing on the screen.
//
// A rest day owes nothing, so a practice is never counted as an unfinished job:
// the group's count is how many practices have already MET their weekly target.
//
// A practice that pays wears the same NIM pill a job wears, and today's ring wears
// the same hourglass a handed-in job wears. Both are the existing pieces rather than
// a practice-shaped copy of them: the kid learns one thing about the money on this
// screen, and it means the same thing wherever it appears.
//
// The pill goes once the parent has answered. Paid, the NIM is in their wallet and
// the money screen is where money lives; declined, there is nothing coming and a
// pill still promising it would be the broken promise this feature exists to end.
function practiceCard(pr) {
  const met = pr.weekDone >= pr.targetPerWeek;
  const streak = pr.weekStreak >= 2
    ? `<span class="pr-streak">${esc(t("app.kidWeekStreak", { n: pr.weekStreak }))}</span>` : "";
  // Exercises, and only once the day is logged: before that the card's job is to say the
  // week's standing and what a day is worth, and "0 of 3" on an untouched card would read
  // as three things missed rather than three on offer.
  const steps = pr.steps?.length && pr.doneToday
    ? `<span class="pr-steps-count">${esc(t("app.kidStepsDone", {
      done: pr.stepsDone, total: pr.steps.length,
    }))}</span>` : "";
  const owed = pr.payState === null || pr.payState === "waiting";
  const slot = pr.doneToday
    ? `<span class="ch-slot ${pr.placement ? "filled" : ""}" data-slot="practice:${esc(pr.sessionId ?? "")}">
         ${pr.placement ? stickerNode(pr.placement, "stk-slot") : `<span class="ch-slot-empty"></span>`}
         ${pr.payState === "waiting" && !pr.placement ? waitIcon("ch-slot-wait") : ""}
       </span>`
    : "";
  return `
    <button class="ch-task ch-practice ${pr.doneToday ? "is-done" : ""} ${met ? "is-met" : ""}"
      data-pr="${esc(pr.id)}">
      ${jobIcon(pr, "🎹")}
      <span class="ch-task-main">
        <span class="ch-task-title">${esc(rowTitle(pr))}</span>
        <span class="ch-task-meta">
          <span class="pr-week">${esc(t("app.kidThisWeek", { done: pr.weekDone, target: pr.targetPerWeek }))}</span>
          ${steps}
          ${streak}
          ${owed ? nimPill(pr.rewardLuna) : ""}
        </span>
      </span>
      ${slot}
    </button>`;
}

export function practiceGroup(practices) {
  if (!practices?.length) return null;
  return {
    key: "practice", label: "app.kidPractice", quiet: true,
    done: practices.filter((p) => p.weekDone >= p.targetPerWeek).length,
    total: practices.length,
    cards: practices.map(practiceCard),
    items: [],
  };
}

// ---------- goals: the ladders a kid is climbing ----------
//
// A job is what today is. A practice is how often this week. A goal is HOW FAR HAVE I GOT --
// a third axis, so it gets a group of its own rather than being folded into either. The card
// says where the climb has reached and what is left on the ladder, and never do-this-now:
// "Hold it for 30 seconds" is not something a kid can be told to do at 4pm on a Tuesday.
//
// The group's count is LADDERS FINISHED, not rungs climbed. A rung is progress; a finished
// ladder is the thing worth a tick in the header.
function goalCard(g) {
  const owed = !g.done && g.leftLuna > 0;
  const nextUp = g.rungs.find((r) => r.state === "open") ?? g.rungs.find((r) => r.state === "waiting");
  // What the ladder is collecting, on the card itself. A kid scrolling past has to be able to
  // see the set filling up without opening anything -- that IS the pull.
  const set = g.theme ? `<span class="gl-set-mini">${
    g.theme.slots.map((s) => `<span class="gl-dot ${s.owned ? "is-on" : ""}"></span>`).join("")
  }${g.theme.boss ? `<span class="gl-dot gl-dot-boss ${g.theme.boss.owned ? "is-on" : ""}"></span>` : ""}</span>` : "";
  return `
    <button class="ch-task ch-goal ${g.done ? "is-met" : ""}" data-goal="${esc(g.id)}">
      ${jobIcon(g, "🪜")}
      <span class="ch-task-main">
        <span class="ch-task-title">${esc(rowTitle(g))}</span>
        <span class="ch-task-meta">
          <span class="pr-week">${esc(t("app.kidGoalRungs", { done: g.climbed, total: g.total }))}</span>
          ${nextUp && !g.done
            ? `<span class="gl-next">${esc(rowTitle(nextUp))}</span>` : ""}
          ${set}
          ${owed ? nimPill(g.leftLuna) : ""}
        </span>
      </span>
      ${g.rungs.some((r) => r.state === "waiting")
        ? `<span class="ch-slot"><span class="ch-slot-empty"></span>${waitIcon("ch-slot-wait")}</span>` : ""}
    </button>`;
}

export function goalGroup(goals) {
  if (!goals?.length) return null;
  return {
    key: "goals", label: "app.kidGoals", quiet: true,
    done: goals.filter((g) => g.done).length,
    total: goals.length,
    cards: goals.map(goalCard),
    items: [],
  };
}

// ---------- sets a kid can collect, and asking for one ----------
//
// The five theme packs only ever appeared INSIDE a ladder that already existed, so a
// household with no goals never saw them at all. This is where they live before there is a
// ladder: the art, greyed, with a tap that ASKS for one.
//
// A tap is a wish, never a ladder. What it is worth and what it is called are settled with a
// grown-up (src/routes/goals.ts), which is why this card cannot show a price or a rung count.

/** A set the kid does not have a ladder for yet. `asked` dims the tap to a waiting state so a
 *  second tap is not offered for something already in a grown-up's queue.
 *
 *  A DECLINED ask leaves no trace here on purpose (Andjroo, 2026-08-27): the set simply reads
 *  as askable again. A card saying "they said no" is a thing a kid would re-read all week. */
function setCard(th, asked) {
  const slots = (th.stickers ?? []).map((s) => `
    <span class="gl-slot gs-slot">${s.assetUrl ? `<img src="${esc(s.assetUrl)}" alt="" />` : ""}</span>`).join("");
  const boss = th.boss
    ? `<span class="gl-slot gl-slot-boss gs-slot">${
        th.boss.assetUrl ? `<img src="${esc(th.boss.assetUrl)}" alt="" />` : ""}</span>`
    : "";
  return `
    <button class="ch-task gs-set ${asked ? "is-asked" : ""}" data-set="${esc(th.packId)}" ${asked ? "disabled" : ""}>
      <span class="ch-task-main">
        <span class="ch-task-title">${esc(th.title)}</span>
        <span class="gs-strip">${slots}${boss}</span>
        <span class="ch-task-meta">
          <span class="pr-week">${esc(asked ? t("app.kidSetAsked") : t("app.kidSetAsk"))}</span>
        </span>
      </span>
    </button>`;
}

/** Only sets with NO ladder yet. One a kid is already climbing belongs above, in the ladders,
 *  where it shows real progress -- offering it again here would read as a second copy. */
export function setGroup(themes, goals, requests) {
  const taken = new Set((goals ?? []).map((g) => g.theme?.packId ?? g.packId).filter(Boolean));
  const open = (themes ?? []).filter((th) => !taken.has(th.packId));
  if (!open.length) return null;
  const asked = new Set((requests ?? []).filter((r) => r.status === "pending").map((r) => r.pack_id));
  return {
    key: "sets", label: "app.kidSets", quiet: true,
    done: 0, total: open.length,
    cards: open.map((th) => setCard(th, asked.has(th.packId))),
    items: [],
  };
}

/** Asking. Optimistic only as far as the toast: the card's waiting state comes from the
 *  server's own row on the next repaint, so a failed ask does not leave a kid believing
 *  they asked. */
export async function onSetTap(packId, repaint) {
  const kid = state.child;
  if (!kid) return;
  const res = await api.askForGoal(kid.id, packId).catch(() => null);
  if (!res || res.error) return toast(t("app.kidSetAskFailed"));
  toast(t("app.kidSetAsked"));
  await repaint?.();
}

// ---------- the taps ----------

/** Logging a practice is the kid's own call: the day counts the moment they tap it,
 *  and no tap of theirs ever moves money. A practice worth something opens the
 *  parent's approval instead (see src/routes/practices.ts), which is why the card
 *  can wear a NIM pill without the tap being a mint. Tapping an unlogged day logs
 *  it and offers a sticker; tapping a logged day without one still offers the sticker. */
export async function onPracticeTap(id, repaint) {
  const pr = (state.chart?.practices ?? []).find((p) => p.id === id);
  if (!pr) return;
  if (pr.doneToday) {
    if (pr.placement) return toast(t("app.kidPracticeLogged"));
    if (pr.sessionId) return openStickerPicker({ kind: "practice", id: pr.sessionId }, repaint);
    return;
  }
  // A practice made of exercises asks which ones first, and the answer is what it pays.
  if (pr.steps?.length) {
    return openPracticeStepsSheet(pr, { onDone: (stepIds) => logPractice(pr, stepIds, repaint) });
  }
  return logPractice(pr, null, repaint);
}

/** Log today, then offer the sticker — one path whether the day came from a single tap or
 *  from the exercise sheet, so the moment after it is identical either way. */
async function logPractice(pr, stepIds, repaint) {
  const res = await api.logPractice(pr.id, undefined, stepIds).catch(() => null);
  await repaint();
  const sessionId = res?.session?.id;
  if (sessionId) openStickerPicker({ kind: "practice", id: sessionId }, repaint);
}

/** A ladder opens as its own screen, the climb path. Tapping the rung that is OPEN claims it,
 *  which opens the parent's approval exactly as handing in a chore does -- no tap of a kid's
 *  ever moves money. Locked and waiting rungs are not wired, and the server refuses them anyway.
 *  `back` is the board, handed in the same way `repaint` is, so this file stays a leaf. */
export async function onGoalTap(id, repaint, back) {
  const g = (state.chart?.goals ?? []).find((x) => x.id === id);
  if (!g) return back();
  showGoalPath(g, {
    onBack: back,
    onClaim: async (rungId) => {
      // `post` hands back the parsed body, so success is the goal coming back and a
      // refusal is `{ error }`. A rung the tablet thought was open but the server did not
      // (a stale poll, a sibling's tap) says so rather than pretending it landed.
      const res = await api.claimRung(g.id, rungId).catch(() => null);
      // Off the board, `repaint` refreshes the chart and paints nothing; the path repaints
      // itself from the fresh ladder, so the rung just claimed comes back WAITING.
      await repaint();
      toast(res?.goal ? t("app.kidGoalClaimed", { name: parentName() }) : t("app.kidGoalNotYours"));
      onGoalTap(id, repaint, back);
    },
  });
}
