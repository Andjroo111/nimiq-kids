// nimiq.kids parent — wallet views: the family home (total balance + roster, modelled on
// the real wallet's multi-account home) and the per-kid account page (account-header
// + transaction-list, modelled on the wallet's address overview).

import {
  state, t, lang, views, go, call, refresh, toast, openSheet, closeSheet, render, $,
  hub, pinKidAddress, pinState,
} from "./core.js";
import { approvalWaitingDays, oldestStaleApproval } from "./stale.js";
import { icon, duotone } from "./icons.js";
import { esc, fmtNim, nimHtml, fmtFiat, identicon, spacedAddress, timeAgo, txList, STAKING_ICON } from "./fmt.js";
import { approvalCard, wireApprovalCards } from "./views-approvals.js";
import { inviteCard, wireInviteCard } from "./views-invite.js";
import { boardRow, wireBoardRow } from "./views-board.js";
import { progressRow, wireProgressRow } from "./views-progress.js";
import { connectBatchRow, sheetOpenInBrowser, wireConnectBatchRow } from "./views-connect.js";
import { offersParentCustody } from "./connect-batch.js";
import { kidLockToggle, lockCard, toggleKidLock, wireLockCard } from "./views-kid-lock.js";
import { kidBudgetRow, wireKidBudgetRow } from "./views-screentime.js";
import { kidLangRow, wireKidLangRow } from "./views-kid-lang.js";
import { canManageHousehold } from "./grownups.js";
import { screenForKid, screenSentence, screenStaleLine, screenBatteryLine, screensGroup, wireScreensGroup } from "./views-screens.js";
import { probeDevices } from "./views-manage.js";

const miniApp = () => window.hatchParentShell?.miniApp ?? null;

// ---- give a kid an address you control --------------------------------------

/* The registration flow, and the reason it is three round trips rather than one.

   This is the PER-CHILD route and the stronger evidence: its challenge names this child and
   this address, so the wallet's signature proves that pairing. views-connect.js is the batch
   alternative, offered on the home screen only when two or more kids are waiting, where one
   popup covers the family and the child mapping is the client's word.


   1. chooseAddress. The parent picks an address out of their OWN wallet. We never see a
      key, and we cannot create the address for them: `addAddress` is Nimiq-domain-only, so
      "open your wallet, add an address, name it, come back" is a step nobody can remove.
   2. ask the server for a CHALLENGE. The message is the server's, not ours: it carries a
      nonce and binds this child and this address, and a client that composed its own would
      be binding nothing.
   3. signMessage over that exact string, then post the proof back.

   Then, and only then, the address is written down LOCALLY (pinKidAddress). That pin is the
   client's own record of a choice the parent actually made, and it is what makes a later
   server-side address swap visible instead of silent.

   Mobile is a full-page redirect: chooseAddress resolves null and the Hub returns on its
   own, so the flow simply stops there and the parent taps again. Nothing is half-written —
   the challenge is not minted until an address is in hand. */
async function registerKidAddress(kid) {
  const h = hub();
  if (!h) { toast(t("papp.didntGoThrough"), "error"); return; }
  const btn = $("kid-addr-btn");
  if (btn) btn.disabled = true;
  try {
    const chosen = await h.chooseAddress();
    if (!chosen) return; // mobile redirect in flight

    toast(t("papp.addrSigning"));
    const ch = await call("POST", `/api/kids/${kid.id}/address-challenge`, { address: chosen.address });
    if (ch.status !== 201) {
      toast(challengeError(ch.data), "error");
      return;
    }

    // The address signed is the SERVER's canonical form of what the wallet returned, and the
    // message is byte-for-byte what it stored. Re-deriving either here would only create a
    // way for the two to differ.
    const proof = await h.signMessage(ch.data.address, ch.data.message);
    const reg = await call("POST", `/api/kids/${kid.id}/address`, {
      challengeId: ch.data.challengeId,
      publicKeyHex: proof.publicKeyHex,
      signatureHex: proof.signatureHex,
    });
    if (reg.status !== 201) {
      toast(registerError(reg.data, kid), "error");
      return;
    }

    pinKidAddress(kid.id, reg.data.child.address);
    toast(t("papp.addrDone", { name: kid.label }), "success");
    await refresh();
    render();
  } catch (err) {
    if (h.isMiniAppUnsupported(err)) { sheetOpenInBrowser(); return; }
    if (miniApp()?.isUserCancel(err)) { toast(t("papp.sendCancelled")); return; }
    toast(t("papp.didntGoThrough"), "error");
  } finally {
    const b = $("kid-addr-btn");
    if (b) b.disabled = false;
  }
}

/* Every refusal the server can give, in words a parent can act on. A generic "that didn't
   work" here would be actively unhelpful: "you picked the family wallet" and "that address
   already belongs to your other kid" have completely different next steps. */
function challengeError(data) {
  if (data?.error === "invalid_address") return t("papp.addrInvalid");
  if (data?.error === "address_is_the_family_wallet") return t("papp.addrIsFamilyWallet");
  // A household holds more than one grown-up's wallet now, so this failure has more than one
  // way to happen — and "that is the family wallet" is untrue when the address is Grandma's.
  if (data?.error === "address_is_a_grownup_wallet") return t("papp.addrIsGrownUpWallet", { name: data.byLabel ?? "" });
  if (data?.error === "address_taken") return t("papp.addrTaken", { name: data.byLabel ?? "" });
  return t("papp.didntGoThrough");
}

function registerError(data, kid) {
  switch (data?.error) {
    case "proof_invalid":
      // address_mismatch is the one a parent can actually fix: they signed with a different
      // address than the one they picked.
      return data.reason === "address_mismatch" ? t("papp.addrWrongSigner") : t("papp.addrProofFailed");
    case "challenge_expired": return t("papp.addrExpired");
    case "challenge_used": return t("papp.addrExpired");
    case "address_taken": return t("papp.addrTaken", { name: data.byLabel ?? "" });
    case "funds_at_old_address":
      return t("papp.addrOldHasFunds", { name: kid.label, amount: fmtNim(data.balanceLuna ?? 0) });
    case "balance_check_failed": return t("papp.addrCheckFailed");
    default: return t("papp.didntGoThrough");
  }
}

/* Three states, three different things to say, and the mismatch is the loud one.
   `registered` is deliberately quiet: once an address is a parent's own, saying so on every
   render turns into wallpaper, and the row that matters is the one that is NOT. */
function addressCard(kid) {
  const pin = pinState(kid);
  if (pin === "mismatch") {
    return `<div class="card set-card addr-warn">
      <div class="set-head">${duotone("duotone-safe-lock", 24)}<h3>${t("papp.addrChangedTitle")}</h3></div>
      <div class="set-hint">${t("papp.addrChangedSub", { name: esc(kid.label) })}</div>
      <div class="addr-line">${esc(spacedAddress(kid.address ?? ""))}</div>
      <button class="pill-btn blue" id="kid-addr-btn">${t("papp.addrRegisterAgain")}</button>
    </div>`;
  }
  if (kid.addressSource === "parent") return "";
  // NOT OFFERED WHERE THE SERVER HOLDS THE KEY (#415). The mismatch warning above is a
  // warning and stays on every instance; this row is an OFFER, and under server custody the
  // thing it offers costs the kid every send, stake and Treasure Box buy they had, with no
  // route back. `offersParentCustody` in connect-batch.js carries the whole argument, and the
  // batch row on the family home reads the same predicate so the two cannot drift apart.
  if (!offersParentCustody(state.overview?.custody)) return "";
  // `title` on both lines: .row-label and .row-sub truncate rather than wrap, and at 320px
  // with a long kid name they do — the shipped "Give {name} some NIM" row beside this one
  // truncates there too. The copy is sized to fit at 390px; the title is what makes the
  // remainder reachable at 320 instead of simply lost.
  const label = t("papp.addrRegisterRow", { name: esc(kid.label) });
  const sub = t("papp.addrRegisterRowSub");
  return `<div class="group"><button class="row" id="kid-addr-btn">
    <span class="hex-tile">${icon("locked-lock", 22)}</span>
    <span class="row-main">
      <span class="row-label" title="${esc(label)}">${label}</span>
      <span class="row-sub" title="${esc(sub)}">${sub}</span>
    </span>
    <span class="chev">${icon("chevron-right", 14)}</span>
  </button></div>`;
}

// ---- add a kid ----

/* Onboarding names exactly ONE kid, and POST /api/children — parent-authenticated,
   unlimited, nickname-only — had no caller anywhere in the app. So a family was stuck
   with the single kid the first run created. This is that caller.
   No emoji picker on purpose: the kid's face on this screen is the identicon of their
   own address now, so the stored emoji is a legacy field and the server defaults it. */
function sheetAddKid() {
  openSheet(`<h2>${t("papp.addKidTitle")}</h2>
    <div class="sub">${t("papp.addKidSub")}</div>
    <input class="nq-input" id="ak-name" maxlength="24" autocomplete="off"
           placeholder="${esc(t("papp.addKidName"))}" />
    <button class="pill-btn" id="ak-save">${t("papp.addKidSave")}</button>`);
  const input = $("ak-name");
  input?.focus();
  const save = async () => {
    const label = input.value.trim();
    if (!label) return;
    const btn = $("ak-save");
    btn.disabled = true;
    const r = await call("POST", "/api/children", { label });
    if (r.status !== 201) {
      btn.disabled = false;
      toast(t("papp.didntGoThrough"), "error");
      return;
    }
    closeSheet();
    toast(t("papp.addKidDone", { name: label }));
    await refresh();
    render();
  };
  $("ak-save")?.addEventListener("click", save);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
}

// ---- give a kid NIM ----

/* Pocket money, a birthday, making something right: the family wallet hands this child
   NIM with no chore behind it. Until now the ONLY way money reached a kid was approving a
   chore, so a parent who simply wanted to give their kid something had to invent a job for
   them to do.

   Amounts are offered as three taps rather than a free number field. A parent on a phone
   is choosing a gift, not entering an invoice, and every preset is inside the server's own
   per-gift cap so the common path can never be refused for being too large. The server
   re-checks both the cap and the family budget regardless — this is a convenience, not the
   guard (POST /api/kids/:id/fund).

   `requestId` is minted once per opened sheet, so a double tap or a retried request pays
   exactly once instead of twice. */
const GIFT_PRESETS_LUNA = [50_000_000, 100_000_000, 200_000_000]; // 500 / 1,000 / 2,000 NIM

// TWO TAPS TO MOVE MONEY: pick an amount, then Send. The three amount pills used to send
// on their own tap, which made this the one sheet in the app where a mis-tap cost real NIM
// with nothing in between, and it put the note field UNDER the buttons that ended the sheet,
// so a parent who wanted to write "for the school trip" had to know to do it first. The
// Send button names the amount it will move and stays off until one is chosen.
function sheetGiveNim(kid) {
  const requestId = crypto.randomUUID();
  openSheet(`<h2>${t("papp.giveTitle", { name: esc(kid.label) })}</h2>
    <div class="sub">${t("papp.giveSub")}</div>
    <div class="btn-row give-row">
      ${GIFT_PRESETS_LUNA.map((v) => `<button class="pill-btn ghost give-amt" data-luna="${v}" aria-pressed="false">${fmtNim(v)} NIM</button>`).join("")}
    </div>
    <input class="nq-input" id="gv-msg" maxlength="64" autocomplete="off"
           placeholder="${esc(t("papp.giveNote"))}" />
    <button class="pill-btn blue" id="gv-send" disabled>${t("papp.giveSendPick")}</button>`);

  const amts = [...document.querySelectorAll(".give-amt")];
  const send = $("gv-send");
  let chosen = null;
  amts.forEach((btn) => btn.addEventListener("click", () => {
    chosen = Number(btn.dataset.luna);
    // The chosen pill wears the navy fill, the others go back to ghost: same two looks the
    // Progress range picker uses, so a picked amount reads as picked and not as pressed.
    amts.forEach((b) => {
      const on = b === btn;
      b.classList.toggle("navy", on); b.classList.toggle("ghost", !on);
      b.setAttribute("aria-pressed", String(on));
    });
    send.disabled = false;
    send.textContent = t("papp.giveSend", { amount: fmtNim(chosen) });
  }));

  send.addEventListener("click", async () => {
    if (!chosen) return;
    const valueLuna = chosen;
    send.disabled = true;
    amts.forEach((b) => { b.disabled = true; });
    const r = await call("POST", `/api/kids/${kid.id}/fund`, {
      valueLuna, requestId, message: $("gv-msg")?.value.trim() || undefined,
    });
    if (r.status !== 201) {
      send.disabled = false;
      amts.forEach((b) => { b.disabled = false; });
      // A refused gift is nearly always an empty payout budget, and saying so is more
      // use than "that didn't go through" — the parent's next move is to top up.
      //
      // The other refusal that has a next move is a kid with no address (#245). The row that
      // opens this sheet is hidden until they have one, so today this is unreachable from the
      // UI — which is exactly why it is worth wording: the fix must not depend on that row
      // staying hidden, and a 409 falling through to "that didn't go through" would send a
      // parent looking for a problem with the network instead of at the address row.
      const err = r.data?.error;
      toast(
        err === "budget_exhausted" ? t("papp.giveNoBudget")
          : err === "kid_address_not_registered" ? t("papp.giveNoAddress", { name: kid.label })
            : t("papp.didntGoThrough"),
        "error",
      );
      return;
    }
    closeSheet();
    toast(t("papp.giveDone", { amount: fmtNim(valueLuna), name: kid.label }), "success");
    await refresh();
    render();
  });
}

// ---- family home ----

// NO CURRENCY HEAD ON THIS GROUP (#414). Andjroo, 2026-09-01: "it still is a little confusing
// why we have the NIM with the wallet addresses and prices."
//
// The gold hexagon + "NIM" was the real wallet's asset head, and it earns its place THERE
// because a Bitcoin group can sit under it. Here NIM is the only asset there will ever be, so
// the head separated this group from nothing, cost a row above the balance a parent came to
// read, and named a unit every amount underneath already spells out.
//
// It is not replaced by a plainer heading. A group whose rows are a wallet and the kids does
// not need to be told it is about money.

/** A number we have not read yet is not zero. One placeholder, one meaning, everywhere on
 *  this screen. */
const UNKNOWN = "&mdash;";

/** Kid balances come from the wallet endpoint and nowhere else.
 *
 *  This used to end `?? k.balanceLuna`, the overview's copy of `children.balance_luna` —
 *  a convenience tally nothing writes off SIM. So whenever the per-kid fetch had not
 *  resolved or had failed, the fallback confidently rendered 0 NIM for a kid holding
 *  thousands (#132). The field is gone from the contract now; null means "not read yet"
 *  and draws a dash, exactly as the family wallet above it already does. */
const kidBal = (k) => state.kidWallet[k.id]?.balanceLuna ?? null;
const kidStaked = (k) => state.kidWallet[k.id]?.stakedLuna ?? k.stakedLuna ?? 0;
const kidPendingUnstake = (k) => state.kidWallet[k.id]?.pendingUnstakeLuna ?? 0;

/** Has this kid been given an address at all?
 *
 *  A THIRD state, beside "read it" and "have not read it yet". On a parent-custody instance
 *  a kid starts with no address, and their wallet reads back `address: null` with a balance
 *  of zero. That zero is TRUE and it is also the least useful thing this screen could say:
 *  an account holding nothing and no account at all render as the identical "0 NIM", and
 *  only one of the two is answered by the "Give {name} an address" row on their page.
 *
 *  Read off the wallet payload rather than the overview's `addressSource`, because it is the
 *  same object the balance came from and cannot be one render out of step with it. Undefined
 *  while the call is in flight, which is deliberately NOT this state — that one is the dash. */
const kidHasNoAddress = (k) => state.kidWallet[k.id]?.address === null;

views.home = (el) => {
  const { children, pending, hotWalletLuna } = state.overview;
  const nimUsd = state.rates.nimUsd;
  // null = the chain has never been read for this instance's hot wallet. Rendering that
  // as 0 told a parent their family wallet was empty when it held 110,000 NIM, and
  // quietly dropped it from TOTAL BALANCE. We cannot total what we have not read, so
  // both fall back to a dash until deposit-check has run once.
  const walletKnown = typeof hotWalletLuna === "number";
  // Same rule one level down: a kid whose wallet call has not answered is unread, not
  // empty, and a total that silently counts them as 0 is the same lie the family wallet
  // used to tell. Every kid is fetched during refresh() before the first render, so this
  // shows a dash only while loading or when a call actually failed.
  const kidsKnown = children.every((k) => kidBal(k) !== null);
  const kidsLuna = children.reduce((s, k) => s + (kidBal(k) ?? 0) + kidStaked(k) + kidPendingUnstake(k), 0);
  const totalKnown = walletKnown && kidsKnown;
  const totalLuna = totalKnown ? hotWalletLuna + kidsLuna : null;

  // A queue nobody has ruled on gets LOUDER, and never pays itself (#272). The strip wears the
  // app's existing "needs you" red and names the OLDEST wait, because "waiting since Tuesday"
  // is the sentence that moves a parent and "3 waiting" is the one they have already ignored.
  const stale = oldestStaleApproval(pending);
  const pendingStrip = pending.length
    ? `<div class="group"><button class="row${stale ? " urgent" : ""}" id="go-approvals">
        <span class="hex-tile">${icon("bell", 22)}</span>
        <span class="row-main"><span class="row-label">${t("papp.pendingHere")}</span>
          ${stale ? `<span class="row-sub">${esc(t("papp.pendingStale", {
            name: stale.child?.label ?? "", days: approvalWaitingDays(stale.createdAt),
          }))}</span>` : ""}</span>
        <span class="pbadge" style="position:static">${pending.length}</span>
        <span class="chev">${icon("chevron-right", 14)}</span>
      </button></div>`
    : "";

  // ONE KID, ONE ROW (#414). Andjroo, 2026-09-01: "either the kid is in a tablet or out of a
  // tablet and then has a wallet or not, all in one thing". The tablet's own sentence used to
  // live in a separate top-level group under a separate heading, so a parent read a kid's
  // money in one place and their screen in another and joined the two in their head.
  //
  // ONE sub-line, not a stack, and the order is what a parent can do something about:
  //
  //   no address      there is no account for any of the rest to be true of
  //   the tablet      a live fact about right now, and the only one that can be WAITING on them
  //   staked          a standing arrangement; it is not going to change while they look at it
  //
  // A kid with a tablet AND staked NIM therefore reads the tablet here and the staking on
  // their own page, which is where the stake and unstake buttons are anyway. A kid with no
  // address has never staked and has no tablet state worth reading, so the first arm is not
  // competing with the other two.
  const kidSub = (k) => {
    if (kidHasNoAddress(k)) return `<span class="row-sub">${t("papp.noAddressYet")}</span>`;
    const scr = screenForKid(k.id);
    if (scr) {
      // A TABLET THAT HAS NEVER CHECKED IN HAS NO STATE TO REPORT. The sentence would be the
      // schedule's guess about a screen nobody has seen, and the row was two lines of nothing
      // ("No lock schedule yet" over "Tablet has never checked in"). One line, the fact.
      if (scr.lastSeenAt === null) return `<span class="row-sub scr-stale">${esc(screenStaleLine(scr))}</span>`;
      // TRUNCATED, not wrapped, unlike the same sentence in `screensGroup`. That group's rows
      // have no amounts column to be pushed under; a roster row does, and "Waiting for you to
      // say yes to Morning routine" is two lines at 390px. `title` is how the rest of that
      // sentence stays reachable, exactly as it is on every other row on this screen.
      const txt = screenSentence(scr).txt;
      const stale = screenStaleLine(scr);
      const batt = screenBatteryLine(scr);
      return `<span class="row-sub" title="${esc(txt)}">${esc(txt)}</span>${
        stale ? `<span class="row-sub scr-stale">${esc(stale)}</span>` : ""}${
        batt ? `<span class="row-sub scr-batt">${esc(batt)}</span>` : ""}`;
    }
    if (kidStaked(k) > 0) {
      return `<span class="row-sub staked">${t("papp.staked")} &middot; ${fmtNim(kidStaked(k))} NIM</span>`;
    }
    return "";
  };

  /** A kid whose tablet is waiting on an approval wears the app's "needs you" red, the same
   *  treatment the pending strip above already gets. The row still opens the KID, not the
   *  approval: the strip at the top of this screen is the one-tap route to the queue and it is
   *  showing whenever this is true, so two different targets for one red would be the
   *  surprise, not the shortcut. */
  const kidUrgent = (k) => {
    const scr = screenForKid(k.id);
    return scr && screenSentence(scr).urgent ? " urgent" : "";
  };

  // TWO CONTROLS IN ONE ROW, once a kid has a tablet (#300). The row itself is no longer the
  // button: it holds one, covering the whole face and body of the row, and the lock switch
  // sits beside it. A <button> inside a <button> is not valid HTML and does not deliver its
  // clicks reliably, so the outer element becomes a <div> that only carries the row's skin.
  //
  // The chevron gives way to the switch rather than sitting beside it. Both are the row's
  // right edge, the whole left of the row already goes to the kid's page, and at 390px an
  // amounts column plus a chevron plus a switch is what pushes a kid's name into an ellipsis.
  const kidRows = children.length
    ? children.map((k) => {
      const tgl = kidLockToggle(k);
      return `<div class="row${kidUrgent(k)}">
        <button class="row-tap" data-kid="${k.id}">
          ${identicon(state.kidWallet[k.id]?.address ?? k.address)}
          <span class="row-main">
            <span class="row-label">${esc(k.label)}</span>
            ${kidSub(k)}
          </span>
          <span class="row-amounts">
            <span class="amount">${kidBal(k) === null ? UNKNOWN : nimHtml(kidBal(k))}</span>
            <span class="fiat-amount">${kidBal(k) === null ? "" : fmtFiat(kidBal(k), nimUsd, lang())}</span>
          </span>
          ${tgl ? "" : `<span class="chev">${icon("chevron-right", 14)}</span>`}
        </button>
        ${tgl}
      </div>`;
    }).join("")
    : `<div class="pstate">${duotone("duotone-group", 80)}
        <h3>${t("papp.noKidsTitle")}</h3><p>${t("papp.noKidsSub")}</p></div>`;

  // ORDER: money, then the kids inside it, then the two admin rows, then invite.
  //
  // Tablets and "give your kids an address" used to sit ABOVE the wallet as top-level
  // peers, which put four unrelated groups between the balance and the kid who earned it
  // (Andjroo, 2026-09-01: "we have tablets, we have give kids an address, then we have our
  // family wallet with the kids wallet balances... it's just kind of confusing, why wouldn't
  // it just be under the kids"). Both are things you do ONCE to a roster, not things you read,
  // so they follow the roster instead of interrupting it. `connectBatchRow()` already returns
  // "" for a household with nothing to move, and `screensGroup()` for one with no tablet, so
  // the settled case is the balance, the queue, the kids, and nothing else.
  el.innerHTML = `
    <div class="total">
      <div class="sec-label">${t("papp.totalBalance")}</div>
      <div class="fiat">${totalKnown ? fmtFiat(totalLuna, nimUsd, lang()) : UNKNOWN}</div>
      ${walletKnown ? "" : `<div class="total-note">${t("papp.walletNotChecked")}</div>`}
    </div>
    ${pendingStrip}
    <div class="group">
      <button class="row" id="go-deposit">
        ${identicon(state.overview.parentAddress)}
        <span class="row-main"><span class="row-label">${t("papp.familyWallet")}</span></span>
        <span class="row-amounts">
          <span class="amount">${walletKnown ? nimHtml(hotWalletLuna) : UNKNOWN}</span>
          <span class="fiat-amount">${walletKnown ? fmtFiat(hotWalletLuna, nimUsd, lang()) : t("papp.tapToCheck")}</span>
        </span>
        <span class="chev">${icon("chevron-right", 14)}</span>
      </button>
      <div class="group-sub">${t("papp.kids")}</div>
      ${kidRows}
      ${!canManageHousehold() ? "" : `<button class="row add-kid" id="add-kid">
        <span class="add-kid-plus" aria-hidden="true">+</span>
        <span class="row-main"><span class="row-label">${t("papp.addKid")}</span></span>
      </button>`}
    </div>
    ${connectBatchRow()}
    ${screensGroup()}
    ${inviteCard()}`;

  el.querySelector("#go-approvals")?.addEventListener("click", () => go("approvals"));
  el.querySelector("#go-deposit").addEventListener("click", () => go("deposit"));
  el.querySelectorAll("[data-kid]").forEach((b) => b.addEventListener("click", () => go("home", b.dataset.kid)));
  el.querySelectorAll("[data-lock]").forEach((b) => b.addEventListener("click", () => {
    const kid = children.find((k) => k.id === b.dataset.lock);
    if (kid) toggleKidLock(b, kid);
  }));
  el.querySelector("#add-kid")?.addEventListener("click", sheetAddKid);
  wireScreensGroup(el);
  wireConnectBatchRow(el);
  wireInviteCard(el);
};

// ---- per-kid account page ----

/** The kid's two settings as two rows of one group: each states its answer, and the
 *  controls wait in a sheet behind the tap. Empty for a grown-up who cannot manage the
 *  household, because both rows are. */
function kidSettingsGroup(kid) {
  const rows = `${kidBudgetRow(kid)}${kidLangRow(kid)}`;
  return rows ? `<div class="group">${rows}</div>` : "";
}

views.kid = (el) => {
  const kid = state.overview.children.find((k) => k.id === state.kidId);
  if (!kid) { go("home"); return; }
  const w = state.kidWallet[kid.id];
  const s = state.kidStaking[kid.id];
  const nimUsd = state.rates.nimUsd;
  const myPending = state.overview.pending.filter((a) => a.child?.id === kid.id);
  // Not awaited: the lock card reads better knowing whether this household owns a tablet at
  // all, and must not hold up the balance to find out. Repaints itself when the probe lands,
  // and does nothing after the first call of the session.
  probeDevices();

  // Null, not `?? kid.balanceLuna`: the overview no longer carries a balance, and the
  // stale copy it used to carry is what made this header read 0 for a funded kid.
  const balanceLuna = w?.balanceLuna ?? null;
  const address = w?.address ?? kid.address ?? null;
  // The address line, or the reason there is none. NOT `copyable` in that case: the whole
  // affordance is "tap to copy the address", and there is nothing to copy. This line used
  // to render empty, which read as a header still loading rather than a kid still waiting
  // for a grown-up; the "Give {name} an address" row is directly under it.
  const addressLine = address
    ? `<div class="copyable"><div class="address">${esc(spacedAddress(address))}</div></div>`
    : `<div class="address no-address">${t("papp.noAddressYet")}</div>`;
  const header = `
    <div class="account-header mobile">
      <div class="active-address flex-row">
        <div class="identicon-wrapper">${identicon(address)}</div>
        <div class="meta">
          <div class="label">${esc(kid.label)}</div>
          ${addressLine}
        </div>
        <div class="amounts-col">
          <span class="amount">${balanceLuna === null ? UNKNOWN : nimHtml(balanceLuna)}</span>
          <span class="fiat-amount">${balanceLuna === null ? "" : fmtFiat(balanceLuna, nimUsd, lang())}</span>
        </div>
      </div>
    </div>`;

  const stakedLuna = w?.stakedLuna ?? kid.stakedLuna ?? 0;
  const pendingLuna = w?.pendingUnstakeLuna ?? 0;
  const rewards = s?.rewardsEarnedLuna ?? 0;
  // NOTHING TO SAY, NOTHING DRAWN. A kid who has never staked used to get a card reading
  // "Staked 0 NIM" and an APY beside it, on a page whose every other card is something a
  // parent can act on. Staking is the kid's own move (Grow, on the tablet); this card is the
  // parent reading the result, and there is no result yet.
  const stakePanel = stakedLuna <= 0 && rewards <= 0 && pendingLuna <= 0 ? "" : `
    <div class="card stake-panel">
      ${STAKING_ICON}
      <div class="stake-main">
        <div class="stake-label">${t("papp.staked")}</div>
        <div class="stake-value">${fmtNim(stakedLuna)} NIM</div>
        ${rewards > 0 ? `<div class="stake-sub">${t("papp.rewards")} +${fmtNim(rewards)} NIM</div>` : ""}
        ${pendingLuna > 0 ? `<div class="stake-sub pending">${t("papp.pendingUnstake")} ${fmtNim(pendingLuna)} NIM</div>` : ""}
      </div>
      ${s ? `<div class="stake-sub">${s.estApyPct}% APY</div>` : ""}
    </div>`;

  const approvalsHtml = myPending.length
    ? `<div class="sec-label">${t("papp.pendingHere")}</div>${myPending.map((a) => approvalCard(a)).join("")}`
    : "";

  const events = w?.events ?? [];
  const activity = `
    <div class="sec-label">${t("papp.activity")}</div>
    ${events.length
      ? `<div class="tx-wrap">${txList(events, {
          nimUsd, lang: lang(), icon, thisMonth: t("papp.thisMonth"), explorerTx: state.explorerTx,
        })}</div>`
      : `<div class="card pstate">${duotone("duotone-high-five", 72)}<p>${t("papp.noActivity")}</p></div>`}`;

  // Sits directly under the balance it changes, and above the chore approvals, because
  // giving is the one thing on this page a parent can start on their own. Built from the
  // roster's own row vocabulary (hex-tile / row-main / chev) rather than a new card, so it
  // reads as another thing you can tap here; `.row-sub` also truncates instead of wrapping,
  // which a bespoke two-line block did not.
  //
  // Not offered at all before there is somewhere for the NIM to land. `POST /kids/:id/fund`
  // answers 502 for a kid with no address, which is the truth arriving far too late: the
  // parent has already opened the sheet, typed an amount and tapped Send. The row above it
  // ("Give {name} an address") is the step this one is waiting on.
  const giveCard = address ? `
    <div class="group"><button class="row" id="give-nim">
      <span class="hex-tile">${icon("arrow-from-bottom", 22)}</span>
      <span class="row-main">
        <span class="row-label">${t("papp.giveRow", { name: esc(kid.label) })}</span>
        <span class="row-sub">${t("papp.giveRowSub")}</span>
      </span>
      <span class="chev">${icon("chevron-right", 14)}</span>
    </button></div>` : "";

  // Directly under the header, above everything that spends: whose address this is comes
  // before what is in it. A swapped address is also the one thing on this page that makes
  // every other number on it a lie, so it has to be seen before they are read.
  // The board sits with `giveCard`, under the balance and above what spends it: giving
  // and setting the work are the two things a parent can START from this page, and both
  // are the same kind of tap. It goes SECOND because a job is the ordinary way money
  // reaches a kid here and a gift is the exception.
  el.innerHTML = `
    <div class="kid-top"><button class="back-btn" id="back">${icon("chevron-left", 16)} ${t("papp.tabHome")}</button></div>
    ${header}${addressCard(kid)}${boardRow(kid)}${progressRow(kid)}${giveCard}${stakePanel}${approvalsHtml}${lockCard(kid)}${kidSettingsGroup(kid)}${activity}`;

  el.querySelector("#back").addEventListener("click", () => go("home"));
  // The address line is dressed as tap-to-copy (`.copyable`, the real wallet's idiom) and for
  // a month nothing listened: a parent tapping it to hand grandma the kid's address got
  // nothing, not even a refusal. Same copy + toast the Top up screen already does.
  el.querySelector(".copyable")?.addEventListener("click", () => {
    if (!address) return;
    navigator.clipboard?.writeText(address).catch(() => {});
    toast(t("papp.copied"), "success");
  });
  el.querySelector("#kid-addr-btn")?.addEventListener("click", () => registerKidAddress(kid));
  el.querySelector("#give-nim")?.addEventListener("click", () => sheetGiveNim(kid));
  wireBoardRow(el, kid);
  wireProgressRow(el, kid);
  wireApprovalCards(el);
  wireLockCard(el, kid);
  wireKidBudgetRow(el, kid);
  wireKidLangRow(el, kid);
  // Delegated so it survives the repaint after a refresh; `noopener` for a third-party page.
  el.querySelector(".tx-wrap")?.addEventListener("click", (ev) => {
    const hash = ev.target.closest?.("[data-tx]")?.dataset.tx;
    if (hash) window.open(`${state.explorerTx}${hash}`, "_blank", "noopener");
  });
};

