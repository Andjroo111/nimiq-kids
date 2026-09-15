// nimiq.kids parent — the approvals feed. Chore/routine approvals pay real NIM
// (rewardLuna) on approve; the `send` variant is a kid asking to send a Cashlink
// out of the family (their own money) and returns a cashlinkUrl on approve.

import { rowTitle, state, t, lang, views, call, refresh, render, toast, openSheet, closeSheet, showPhoto, $ } from "./core.js";
import { approvalIsStale } from "./stale.js";
import { icon, duotone } from "./icons.js";
import { esc, fmtNim, nimHtml, fmtFiat, fmtElapsed, identicon, timeAgo, renderQr } from "./fmt.js";
import { juice } from "./juice.js";
import {
  clearInFlight, mintError, parentSigns, payoutInFlight, settledWholeToast, signPayout,
} from "./payout-sign.js";
import { payerLine } from "./grownups.js";

views.approvals = (el) => {
  const { pending } = state.overview;
  if (pending.length === 0) {
    el.innerHTML = `<div class="card pstate">${duotone("duotone-high-five", 88)}
      <h3>${t("papp.allCaughtUp")}</h3><p>${t("papp.allCaughtUpSub")}</p></div>`;
    return;
  }
  el.innerHTML = pending.map((a) => approvalCard(a)).join("");
  wireApprovalCards(el);
  if (state.deepLinkId) {
    const target = $(`ap-${state.deepLinkId}`);
    if (target) { target.scrollIntoView({ behavior: "smooth", block: "center" }); target.classList.add("hl"); }
    else toast(t("papp.alreadyHandled"));
    state.deepLinkId = null;
  }
};

/** Kid address for the card identicon (roster is in the overview). */
const kidAddress = (a) => state.overview.children.find((k) => k.id === a.child?.id)?.address ?? null;

/**
 * The mark beside a step, one per terminal state, and three rather than two on purpose.
 *
 * 'skipped' is the parent's own doing (they excused it) and 'passed' is a side quest the kid
 * chose to leave (#341). Both are unpaid, so the amount on this card is right either way, but
 * showing them as the same grey cross would tell a parent they had excused something they
 * never touched. A green check on either would be worse: it would claim work nobody did.
 */
function taskMark(task) {
  if (task.status === "skipped") return `<span class="skip">${icon("cross", 12)}</span>`;
  if (task.status === "passed") return `<span class="passed" aria-hidden="true">+</span>`;
  return `<span class="ok">${icon("check", 12)}</span>`;
}

export function approvalCard(a) {
  const isSend = a.subjectKind === "send";
  // Queued staking intent: the kid's own money moving between spendable and staked.
  const isStake = a.subjectKind === "stake" || a.subjectKind === "unstake";
  // V3 Treasure Box coupon: the kid ALREADY paid (spend tx); approving fulfills the
  // prize, rejecting refunds. No payout amount on the card, the paid price instead.
  const isCoupon = a.subjectKind === "coupon";
  const valueLuna = (isSend || isStake) ? (a.summary?.valueLuna ?? 0) : a.rewardLuna;
  const nimUsd = state.rates.nimUsd;
  const reward = isCoupon
    ? `<div class="ap-reward"><span class="fiat-amount">${t("papp.couponPaid", { amount: fmtNim(a.summary?.priceLuna ?? 0) })}</span></div>`
    : `<div class="ap-reward">
      <span class="amount">${(isSend || isStake) ? "" : "+"}${nimHtml(valueLuna)}</span>
      <span class="fiat-amount">${fmtFiat(valueLuna, nimUsd, lang())}</span>
    </div>`;
  // A queued in-family transfer rides the same 'send' subject and carries the recipient's
  // name; without one this is the outbound Cashlink/address case, worded as before.
  const what = isSend
    ? `<div class="ap-what">${duotone("duotone-paper-plane", 22)} ${
      a.summary?.toLabel
        ? t("papp.wantsToGive", { name: esc(a.summary.toLabel) })
        : t("papp.wantsToSend")
    }</div>
       ${a.summary?.message ? `<div class="ap-msg">&ldquo;${esc(a.summary.message)}&rdquo;</div>` : ""}`
    : isStake
      ? `<div class="ap-what">${duotone("duotone-staking-ripple", 22)} ${t(a.subjectKind === "stake" ? "papp.wantsToStake" : "papp.wantsToUnstake")}</div>`
      : isCoupon
        ? `<div class="ap-what">${duotone("duotone-medal", 22)} ${t("papp.couponPrize")}</div>
           <div class="ap-msg">${esc(a.summary?.title ?? "")}</div>`
        : ""; // a chore's title rides in the head now, beside the kid's name. See choreTitle.
  const tasks = a.summary?.tasks?.length
    ? `<div class="ap-tasks">${a.summary.tasks.map((task) => `
        <div class="ap-task">
          ${taskMark(task)}
          <span class="t">${esc(rowTitle(task))}</span>
          <span class="el">${task.status === "passed" ? t("papp.taskPassed") : fmtElapsed(task.elapsedS)}</span>
        </div>`).join("")}</div>`
    : "";
  const photo = a.photoUrl
    ? `<button class="ap-photo" data-photo="${esc(a.photoUrl)}" aria-label="View proof photo">
        <img src="${esc(a.photoUrl)}" alt="Proof photo" loading="lazy" /></button>`
    : "";
  // WHO and WHAT on one line (#416, asked twice). A chore's title used to sit on a full-width
  // row of its own under the head, behind a green check that said nothing: every card on this
  // screen is work a kid finished, so a mark that never varies distinguishes nothing. It is
  // the head's right column now, above the amount, which is where a parent's eye already is
  // and one row shorter. Only the chore card moves: 'send', 'stake' and 'coupon' carry a
  // SENTENCE and a duotone that names which of the three it is, not a title, and their rows
  // stay exactly where they were.
  //
  // Truncated rather than wrapped, with the full title on `title`, for the reason the roster
  // rows are: a two-line title on the right would push the amount off the kid's name line and
  // undo the whole point of the move.
  const choreTitle = (isSend || isStake || isCoupon) ? "" : (a.summary?.title ?? "");
  return `<div class="card ap-card" id="ap-${a.id}">
    <div class="ap-head">
      ${identicon(kidAddress(a))}
      <div class="ap-who"><div class="ap-kid">${esc(a.child?.label ?? "")}</div>
      <div class="ap-when${approvalIsStale(a.createdAt) ? " is-stale" : ""}">${timeAgo(a.createdAt, lang())}</div></div>
      <div class="ap-right">
        ${choreTitle ? `<div class="ap-title" title="${esc(choreTitle)}">${esc(choreTitle)}</div>` : ""}
        ${reward}
      </div>
    </div>
    ${what}${tasks}${photo}${payerLine(a)}${shareSlider(a)}
    <div class="ap-actions">
      <button class="pill-btn ghost" data-reject="${a.id}">${t("papp.notYet")}</button>
      <button class="pill-btn green" data-approve="${a.id}">${icon("check", 13)} ${approveLabel(a)}</button>
    </div></div>`;
}

/* ---- THE SHARE SLIDER (#352) -------------------------------------------------------------
   How much of what a job promised this approval actually pays.

   The shape is Andjroo's own, from the nimiq.blog /predict/ sliders, which are a port of the
   wallet's swap-balance-bar: the handle splits the WHOLE bar in two, solid one side and
   hatched the other, no leftover track. Here the two sides are literally the money — solid
   navy is what the kid gets, hatched is what the job promised and is not being paid.

   Quarter snaps, because "three quarters of it" is how a grown-up thinks about a half-done
   job and a parent doing this one-handed is not landing on 63%. A quarter is also the FLOOR:
   zero is refused server-side, because approving at nothing would close the job for good at
   no pay, where rejecting leaves it open to try again. Reject stays the only way to say no.

   Earn cards only. A send, a coupon or a stake moves the KID'S own money at an amount they
   chose, so there is no share of it for a grown-up to set, and the server 400s on one. */

const SHARE_FULL = 10_000;
/* Andjroo: "there should only be stops for 25, 50, 75 — zero and a hundred will just be if it
   is all the way full or all the way empty." So these are DETENTS the handle is magnetic to
   on the way past, not the only reachable values. The two ends need no detent because the
   track already stops there, and a detent on a position you cannot overshoot is friction
   that buys nothing. Everything between is reachable: #351 says continuous drag with quarter
   detents is fine and arbitrary precision is simply not the point. */
const SHARE_DETENTS = [25, 50, 75];
/** How close the handle has to come before a detent takes it. ~1/16 of the track: wide enough
 *  to catch a thumb, narrow enough that a parent aiming at 40% still gets 40%. */
const DETENT_PULL = 6;
/** Must match .sh-input's thumb width and the gap it sits in, both in share.css. */
const SH_THUMB = 28;
const SH_GAP = 7;

/** Only the kinds whose price a grown-up set. Mirrors SUBJECT_PAYS_KID on the server. */
const SHAREABLE = new Set(["chore", "routine_run", "practice_session", "goal_rung"]);
const canShare = (a) => SHAREABLE.has(a.subjectKind) && (a.rewardLuna ?? 0) > 0;

const shareLuna = (fullLuna, bps) => Math.floor((fullLuna * bps) / SHARE_FULL);

function shareSlider(a) {
  if (!canShare(a)) return "";
  const full = a.rewardLuna;
  const ticks = SHARE_DETENTS.map((pct) => {
    const bps = pct * 100;
    // POSITIONED BY THE SHARE, NOT BY THE INDEX. Spacing the four stops evenly across the
    // track put 50% at a THIRD of the bar and 25% at 2% of it, so the solid segment stopped
    // being a picture of the money — which is the only job it has. Andjroo: "the fifty percent
    // looks closer to twenty five percent." It was.
    // The cost is that the first quarter of the track cannot be reached, and that is correct:
    // 25% is the floor, and a dead run of track is an honest way to show one.
    // TRUE proportion, with no half-thumb correction, because the input itself is widened by
    // a thumb so its travel spans the whole track (see .sh-input in share.css). Compensating
    // for the inset instead still squeezed everything toward the middle: 75% painted at 71%.
    const frac = bps / SHARE_FULL;
    const left = `${frac * 100}%`;
    return `<span class="sh-tick" data-bps="${bps}" style="left:${left}">
      <i></i><b>${pct}%</b></span>`;
  }).join("");
  return `<div class="sh-wrap" data-share="${a.id}" data-full="${full}" data-kid="${esc(a.child?.label ?? "")}">
    <div class="sh-read">
      <span class="amount">+${nimHtml(full)}</span>
      <span class="fiat-amount">${fmtFiat(full, state.rates.nimUsd, lang())}</span>
    </div>
    <div class="sh-of" hidden></div>
    <div class="sh-track">
      <span class="sh-seg sh-paid"></span>
      <span class="sh-seg sh-held" hidden></span>
      <span class="sh-sep" hidden></span>
      <input class="sh-input" type="range" min="0" max="100" step="1" value="100"
        aria-label="${t("papp.shareNoteLabel")}" />
    </div>
    <div class="sh-ticks">${ticks}</div>
    <div class="sh-note" hidden>
      <input class="nq-input" maxlength="300" placeholder="${esc(t("papp.shareNotePh"))}" />
    </div>
  </div>`;
}

/** Repaint one card's slider from its input. Pure function of the DOM it is handed. */
function paintShare(wrap) {
  const input = wrap.querySelector(".sh-input");
  const full = Number(wrap.dataset.full);
  const bps = Number(input.value) * 100;
  // ALL THE WAY EMPTY IS NOT A ZERO-PAY APPROVAL, IT IS A SEND BACK.
  // Zero is reachable now, and it has to mean something. Paying nothing and calling it an
  // approval would CLOSE the job for good at no pay, which is a harsher outcome than reject
  // reached through a friendlier-looking control (#351 names this). Reject already means
  // "not this time, try again" and leaves the job open — which is exactly what a parent
  // dragging the bar to empty is saying. So the primary action becomes Send back, and the
  // note field already on screen is the one reject wanted anyway.
  const isNone = bps === 0;
  const partial = bps < SHARE_FULL;
  const paid = shareLuna(full, bps);

  // The readout REPLACES the header amount's job while a share is set, so the card never
  // shows two different numbers. "of 24 003 NIM" is what makes a reduced figure legible as
  // a fraction of a promise rather than as the price.
  const readAmt = wrap.querySelector(".sh-read .amount");
  const readFiat = wrap.querySelector(".sh-read .fiat-amount");
  // "+0 NIM" at the empty end reads as a payment of nothing, which is the one thing this
  // position does NOT do. It says what will actually happen instead.
  readAmt.innerHTML = isNone ? esc(t("papp.notYet")) : `+${nimHtml(paid)}`;
  readFiat.textContent = isNone ? "" : fmtFiat(paid, state.rates.nimUsd, lang());
  const of = wrap.querySelector(".sh-of");
  of.textContent = isNone
    ? t("papp.sendBackTo", { name: wrap.dataset.kid ?? "" })
    : t("papp.shareOf", { amount: `${fmtNim(full)} NIM` });
  of.hidden = !partial;

  // THE BAR IS A PICTURE OF THE MONEY, so its edge sits at the share's true fraction of the
  // track and nowhere else. The gap either side of the handle is the handle's, not the
  // value's, so it is subtracted from the segments and never from the split point.
  const at = `${(bps / SHARE_FULL) * 100}%`;
  // At full there is no handle gap to leave room for, so the bar runs the whole track rather
  // than stopping short of it — which rendered as "not quite everything" on the one setting
  // that means everything.
  const held = wrap.querySelector(".sh-held");
  const sep = wrap.querySelector(".sh-sep");
  // Mirror of the full case: at zero nothing is paid, so the hatch runs the whole track and
  // the solid segment is not drawn at all rather than drawn at a 7px sliver, which would read
  // as a rendering artefact instead of as "none of it".
  wrap.querySelector(".sh-paid").style.width = isNone ? "0" : partial ? `calc(${at} - ${SH_GAP}px)` : "100%";
  held.style.left = isNone ? "0" : `calc(${at} + ${SH_GAP}px)`;
  sep.style.left = at;
  // At full there is nothing held back, so the hatch and the hairline are not drawn at all
  // rather than drawn at zero width: a 2px sliver of hatching against the right edge reads
  // as a rendering artefact, not as "none withheld".
  held.hidden = !partial;
  sep.hidden = !partial || isNone;

  wrap.querySelectorAll(".sh-tick").forEach((tk) => tk.classList.toggle("on", Number(tk.dataset.bps) === bps));
  // The note is REQUIRED below full — the server 400s without one — so it appears with the
  // reduced share instead of sitting on every card asking a question nobody has.
  wrap.querySelector(".sh-note").hidden = !partial;

  // THE CARD SHOWS ONE AMOUNT, and on a card with a slider that is the readout. The header's
  // top-right figure is the job's price, which the readout already is at full and which
  // "of 24 003 NIM" already says below full — so leaving it up prints the same number twice
  // at full and two DIFFERENT numbers four lines apart below it. The readout is the better
  // survivor of the two: it is centred, it is the one that moves, and it is the one the
  // slider is attached to. Cards with no slider keep their header exactly as before.
  const head = document.querySelector(`#ap-${CSS.escape(wrap.dataset.share)} .ap-reward`);
  if (head) head.hidden = true;

  input.setAttribute("aria-valuetext", partial
    ? `${bps / 100}%, ${fmtNim(paid)} NIM ${t("papp.shareOf", { amount: `${fmtNim(full)} NIM` })}`
    : `${t("papp.shareAll")}, ${fmtNim(paid)} NIM`);

  // The button says what it will do. "Approve" over a slider at a quarter is the one wording
  // that could pay a fraction while reading as paying the job.
  const btn = document.querySelector(`#ap-${CSS.escape(wrap.dataset.share)} [data-approve]`);
  if (btn && !payoutInFlight(wrap.dataset.share)) {
    btn.innerHTML = isNone
      ? esc(t("papp.sendBack"))
      : partial
        ? `${icon("check", 13)} ${esc(t("papp.shareApprove", { amount: `${fmtNim(paid)} NIM` }))}`
        : `${icon("check", 13)} ${esc(t("papp.approve"))}`;
    // Green is success only (nimiq-ui rule 5), and sending work back is not a success. The
    // same navy the reject sheet's own button already wears.
    btn.classList.toggle("green", !isNone);
    btn.classList.toggle("navy", isNone);
  }
  // The ghost "Not yet" beside it would now be a second button doing the same thing.
  const ghost = document.querySelector(`#ap-${CSS.escape(wrap.dataset.share)} [data-reject]`);
  if (ghost) ghost.hidden = isNone;
}

/** What this card's slider is asking for, or null when it is at full / has none. */
function shareOf(id) {
  const wrap = document.querySelector(`[data-share="${CSS.escape(id)}"]`);
  if (!wrap) return null;
  const bps = Number(wrap.querySelector(".sh-input").value) * 100;
  if (bps >= SHARE_FULL) return null;
  // 0 is returned rather than swallowed: approve() turns it into a send back.
  return { shareBps: bps, note: wrap.querySelector(".sh-note .nq-input").value.trim() };
}

/** "Finish paying" for a card whose payout was already minted on this device and never
 *  signed — the mobile wallet is a full-page redirect, and a parent landing back on an
 *  unchanged "Approve" has no way to know the tap continues rather than pays twice. It
 *  cannot pay twice: the intent is claimed server-side and a second tap gets the same bytes. */
const approveLabel = (a) => (payoutInFlight(a.id) ? t("papp.finishPaying") : t("papp.approve"));

export function wireApprovalCards(root) {
  root.querySelectorAll(".sh-wrap").forEach((wrap) => {
    const input = wrap.querySelector(".sh-input");
    input.addEventListener("input", () => {
      // Magnetic detents. The handle is free everywhere, but passing near a quarter it lands
      // on it — which is what makes "three quarters of it" a gesture instead of a target.
      const v = Number(input.value);
      const near = SHARE_DETENTS.find((d) => Math.abs(v - d) <= DETENT_PULL);
      if (near !== undefined) input.value = String(near);
      paintShare(wrap);
    });
    // A tick is a tap target, not just a guide: reaching 25% by dragging a 28px disc across a
    // phone card is the fiddly half of this control, and the labels are already there.
    wrap.querySelectorAll(".sh-tick").forEach((tk) => (tk.onclick = () => {
      input.value = String(Number(tk.dataset.bps) / 100);
      paintShare(wrap);
    }));
    paintShare(wrap); // paint once at full, so the bar is never an unstyled empty track
  });
  root.querySelectorAll("[data-approve]").forEach((b) => (b.onclick = () => approve(b.dataset.approve)));
  root.querySelectorAll("[data-reject]").forEach((b) => (b.onclick = () => sheetReject(b.dataset.reject)));
  root.querySelectorAll("[data-photo]").forEach((b) => (b.onclick = () => showPhoto(b.dataset.photo)));
}

/** The refusals that come from minting a signing intent rather than from the old paying path.
 *  Listed rather than inferred from the status, because `already_paid` and `chain_unreachable`
 *  share their codes with refusals the branch below already words correctly. */
const MINT_ERRORS = new Set([
  "no_kid_address", "no_parent_address", "pays_self", "chain_unreachable", "already_paid",
]);

function dropPending(id) {
  if (!state.overview) return;
  state.overview.pending = state.overview.pending.filter((a) => a.id !== id);
  render();
}

async function approve(id) {
  const a = state.overview.pending.find((x) => x.id === id);
  // Approving pays real NIM and takes ~6s on chain. Disabling the buttons alone left the
  // card looking untouched for the whole window, so a parent could not tell the tap had
  // registered. Say it is working.
  const row = document.getElementById(`ap-${CSS.escape(id)}`);
  row?.classList.add("is-working");
  const approveBtn = row?.querySelector("[data-approve]");
  const priorLabel = approveBtn?.innerHTML;
  // Under parent custody the wait is not a payment, it is a round trip to mint something to
  // sign — so "Paying…" would be a claim about money that has not moved and may not.
  if (approveBtn) approveBtn.textContent = parentSigns() ? t("papp.payPreparing") : t("papp.paying");
  document.querySelectorAll(`#ap-${CSS.escape(id)} .pill-btn`).forEach((b) => (b.disabled = true));
  // A partial share needs its note: the server refuses one without it, and losing that round
  // trip to a 400 would blank the card's buttons for nothing.
  const share = shareOf(id);
  // All the way empty is a send back, not a payment of nothing. Routed here rather than in
  // the click handler so the keyboard path and the tick taps reach it too.
  if (share && share.shareBps === 0) {
    row?.classList.remove("is-working");
    if (approveBtn && priorLabel !== undefined) approveBtn.innerHTML = priorLabel;
    document.querySelectorAll(`#ap-${CSS.escape(id)} .pill-btn`).forEach((b) => (b.disabled = false));
    return rejectWithNote(id, share.note);
  }
  if (share && !share.note) {
    document.querySelectorAll(`#ap-${CSS.escape(id)} .pill-btn`).forEach((b) => (b.disabled = false));
    row?.classList.remove("is-working");
    if (approveBtn && priorLabel !== undefined) approveBtn.innerHTML = priorLabel;
    document.querySelector(`[data-share="${CSS.escape(id)}"] .sh-note .nq-input`)?.focus();
    toast(t("papp.shareNoteLabel"));
    return;
  }
  const r = await call("POST", `/api/approvals/${id}/approve`, share ?? {});
  row?.classList.remove("is-working");
  if (approveBtn && priorLabel !== undefined) approveBtn.innerHTML = priorLabel;

  // ---- parent custody: the server planned a transaction instead of making one ----
  //
  // 202 is a fresh intent; 409 + signingIntent is the SAME one handed back, which is what a
  // second tap and a returned-from-the-wallet tap both look like. They are one case here on
  // purpose: the bytes are identical, so distinguishing them could only produce two different
  // words for one thing that is about to happen.
  if (r.data?.signingIntent) {
    const paid = await signPayout(r.data.signingIntent, a);
    if (paid) dropPending(id);
    else render(); // repaint: the button now reads "Finish paying"
    refresh();
    return;
  }
  // The kid's deferred spending ate the reward whole, so there is nothing to sign and the
  // work is already paid for (src/kid-netting.ts).
  if (r.status === 200 && r.data?.settled) {
    settledWholeToast(r.data.settled, a);
    dropPending(id);
    refresh();
    return;
  }
  // A mint that refused: every reason has a different next move, and `no_kid_address` is a
  // flow the parent app already has rather than a fault.
  if (parentSigns() && r.status !== 200 && MINT_ERRORS.has(r.data?.error)) {
    clearInFlight(id);
    toast(mintError(r.data, a), "error");
    render();
    return;
  }

  if (r.status === 409) { toast(t("papp.alreadyHandled")); dropPending(id); refresh(); return; }
  // Budget hit: the approval stays pending — warm nudge toward the Top up tab.
  if (r.data?.error === "budget_exhausted") { toast(t("papp.budgetNeedsTopUp")); render(); return; }
  // The kid's own money moved since they asked, so this card can never succeed as it
  // stands and the only exit is Send back. Say so, instead of "that didn't go through" —
  // which reads like a network blip and invites a parent to keep tapping Approve.
  if (["insufficient_funds", "insufficient_stake"].includes(r.data?.error)) {
    toast(t("papp.kidMoneyMoved", { name: a?.child?.label ?? "" }), "error"); render(); return;
  }
  if (r.status !== 200) { toast(t("papp.didntGoThrough"), "error"); render(); return; }
  if (r.data.cashlinkUrl) {
    juice("choreApproved");
    sheetCashlink(r.data.cashlinkUrl, a);
  } else if (a?.subjectKind === "coupon") {
    juice("choreApproved");
    toast(t("papp.couponFulfilled", { name: a?.child?.label ?? "" }), "success");
  } else {
    juice("payday"); // real NIM just moved to the kid — the payday moment
    // The transaction carries the job's own title as on-chain data, so this link opens a real
    // Nimiq transaction whose memo reads "Tidy your room". Offered once, here, at the moment
    // it happens; it stays reachable from the money feed forever after. No hash or no
    // configured explorer (SIM invents hashes) means no link, same rule the feed rows use.
    const hash = r.data.txHash;
    toast(
      t("papp.approvedPaid", { amount: fmtNim(r.data.paidLuna ?? a?.rewardLuna ?? 0), name: a?.child?.label ?? "" }),
      "success",
      hash && state.explorerTx ? { label: t("papp.seeReceipt"), url: `${state.explorerTx}${hash}` } : null,
    );
  }
  dropPending(id);
  refresh();
}

function sheetReject(id) {
  const a = state.overview.pending.find((x) => x.id === id);
  openSheet(`<h2>${t("papp.notYet")}</h2>
    <div class="sub">${t("papp.sendBackTo", { name: esc(a?.child?.label ?? "") })}</div>
    <input class="nq-input" id="rj-note" maxlength="300" />
    <button class="pill-btn navy wide" id="rj-send">${t("papp.sendBack")}</button>`);
  $("rj-send").onclick = async () => {
    $("rj-send").disabled = true;
    await rejectWithNote(id, $("rj-note").value.trim(), closeSheet);
  };
}

/** Send one approval back. Shared by the reject sheet and by a share slider dragged all the
 *  way empty, which means the same thing and must not answer differently. */
async function rejectWithNote(id, note, after) {
  const a = state.overview.pending.find((x) => x.id === id);
  const r = await call("POST", `/api/approvals/${id}/reject`, note ? { note } : {});
  after?.();
  if (r.status === 409) toast(t("papp.alreadyHandled"));
  else if (r.status !== 200) { toast(t("papp.didntGoThrough"), "error"); render(); return; }
  else toast(t("papp.sentBackToast", { name: a?.child?.label ?? "" }), "success");
  dropPending(id);
  refresh();
}

/** Approved `send`: the cashlink is minted from the kid's account — hand it over. */
function sheetCashlink(url, a) {
  openSheet(`<h2>${t("papp.approvedCashlink")}</h2>
    <div class="sub">${esc(a?.child?.label ?? "")} &middot; ${fmtNim(a?.summary?.valueLuna ?? 0)} NIM</div>
    <div class="qr-holder"><canvas id="cl-qr" width="400" height="400" style="width:200px;height:200px"></canvas></div>
    <button class="copy-link" id="cl-copy">${esc(url)}</button>
    <button class="pill-btn blue wide" id="cl-copy2">${icon("copy", 14)} ${t("papp.copyLink")}</button>`);
  renderQr($("cl-qr"), url);
  const copy = () => { navigator.clipboard?.writeText(url).catch(() => {}); toast(t("papp.copied"), "success"); };
  $("cl-copy").onclick = copy;
  $("cl-copy2").onclick = copy;
}
