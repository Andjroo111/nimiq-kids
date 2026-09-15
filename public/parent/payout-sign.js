// nimiq.kids parent — signing a payout in the parent's own wallet, and handing the bytes
// back for the server to relay.
//
// This is the browser half of NONCUSTODIAL-PLAN Phase 3. Under `HATCH_CUSTODY=parent` the
// server holds no key it could pay a child with, so approving a chore stops being a payment
// and becomes an intent: a transaction the server planned, published, and can only relay once
// the parent's own wallet has signed it. Until this file existed, both endpoints were
// reachable by curl and by nothing else.
//
// THE SHAPE IS THE TOP-UP'S, deliberately (views-manage.js -> topUpFromWallet): the wallet
// signs, the server relays, the server proves. What is different is the direction and the
// pinning. A top-up pays the family's own wallet and any bytes will do; a payout pays a CHILD,
// so every field is dictated by the intent and the server refuses to relay anything that does
// not match the claim it made first (src/wallet/payout-relay.ts).
//
// ## What is NOT re-derived here
//
// Nothing. `recipient`, `valueLuna`, `feeLuna`, `data` and `validityStartHeight` all go to the
// wallet exactly as the intent published them. `validityStartHeight` in particular: re-signing
// at today's height would produce byte-different transactions for one chore, which dedupe
// against nothing on chain and are how a kid gets paid twice. The intent pinned a height so a
// retry is a REPLAY, and this file's only job is to not undo that.
//
// ## The mobile redirect, and why "tap again" is the whole resume
//
// On mobile the Hub is a full-page navigation. `signAndSend` never resolves, the page is
// rebuilt from scratch, and the Hub's result does not survive the trip (the shell wires no
// return handler). So the resume is not a state machine: the approval was deliberately LEFT
// PENDING by the server, the card is still in the queue when the parent lands back, and
// tapping it again re-mints, gets `already_claimed`, and is handed the SAME bytes. The only
// thing kept across the trip is a note that this card was mid-signature, so the button can
// say "Finish paying" instead of "Approve" and the parent knows the tap is a continuation
// rather than a second payment.

import { $, call, closeSheet, openSheet, pinState, state, t, toast, wallet } from "./core.js";
import { esc, fmtNim, spacedAddress } from "./fmt.js";
import { juice } from "./juice.js";

const bare = (a) => (a ?? "").replace(/\s+/g, "").toUpperCase();

const miniApp = () => window.hatchParentShell?.miniApp ?? null;

/** Does this instance make the parent sign payouts? Published by the server on the overview
 *  (`custodyView`), never inferred from the shape of a response. */
export const parentSigns = () => state.overview?.custody?.kidCustody === "parent";

// ---- the in-flight note (survives the wallet's full-page redirect) ----------
//
// localStorage, not sessionStorage: the Hub redirect is a real navigation away from the
// origin and back, and Safari has been known to hand back a fresh session for it. Being
// wrong here in the safe direction means the button says "Finish paying" for a card that
// was already paid — one confusing word on a card that is about to disappear on the next
// refresh, against the alternative of a parent stranded with no hint that a tap continues.

const FLIGHT_KEY = "kidsPayoutInFlight";

function readFlight() {
  try {
    const raw = JSON.parse(localStorage.getItem(FLIGHT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return []; // corrupt storage must never break the queue
  }
}

const writeFlight = (ids) => {
  try { localStorage.setItem(FLIGHT_KEY, JSON.stringify(ids.slice(-20))); } catch { /* private mode */ }
};

export const payoutInFlight = (approvalId) => readFlight().includes(approvalId);

const markInFlight = (id) => { if (!payoutInFlight(id)) writeFlight([...readFlight(), id]); };
const clearInFlight = (id) => writeFlight(readFlight().filter((x) => x !== id));

// ---- the explanation, shown only when the numbers disagree ------------------

/**
 * "200 for the chore, 80 already spent, 120 to send."
 *
 * Shown ONLY when `nettedLuna` is above zero, and that restraint is the point. On the ordinary
 * payout the wallet's own confirmation screen already names the amount and the recipient, so a
 * sheet in front of it is a tap that says nothing. When the kid's deferred spending has eaten
 * part of the reward, the number the wallet is about to show DISAGREES with the number on the
 * board, and a parent meeting that unexplained has every reason to think the app is wrong.
 *
 * Resolves true to continue, false if the sheet was dismissed — including by tapping the
 * scrim, which is why this owns the close rather than the button handlers.
 */
function confirmNetted(intent, a) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    openSheet(`<h2>${t("papp.netTitle")}</h2>
      <div class="sub">${t("papp.netSub", { name: esc(a?.child?.label ?? "") })}</div>
      <div class="net-lines">
        <div class="net-row"><span>${t("papp.netGross")}</span><span>${fmtNim(intent.grossLuna)} NIM</span></div>
        <div class="net-row net-spent"><span>${t("papp.netSpent")}</span><span>&minus;${fmtNim(intent.nettedLuna)} NIM</span></div>
        <div class="net-row net-total"><span>${t("papp.netToSend")}</span><span>${fmtNim(intent.valueLuna)} NIM</span></div>
      </div>
      <button class="pill-btn blue wide" id="net-go">${t("papp.netContinue")}</button>`);
    $("net-go").onclick = () => { closeSheet(); done(true); };
    // The scrim closes the sheet without telling us, so watch the class the close flips.
    const scrim = $("scrim");
    const obs = new MutationObserver(() => {
      if (!scrim.classList.contains("show")) { obs.disconnect(); done(false); }
    });
    obs.observe(scrim, { attributes: true, attributeFilter: ["class"] });
  });
}

// ---- refusals, in words a parent can act on --------------------------------

/** Why the mint refused. Each one has a different next move, so a single "that didn't work"
 *  here would be actively unhelpful — `no_kid_address` in particular is a flow, not a fault. */
export function mintError(data, a) {
  const name = a?.child?.label ?? "";
  switch (data?.error) {
    case "no_kid_address": return t("papp.payNoKidAddress", { name });
    case "no_parent_address": return t("papp.payNoFamilyWallet");
    case "pays_self": return t("papp.payPaysSelf", { name });
    case "chain_unreachable": return t("papp.payChainDown");
    case "already_paid": return t("papp.payAlreadyPaid", { name });
    default: return t("papp.didntGoThrough");
  }
}

/** Why the relay refused the signed bytes. `tx_mismatch` is the loud one: the transaction
 *  that came back is not the one this instance asked for, and the honest thing to say is that
 *  it was not sent, not "try again". */
function relayError(data) {
  switch (data?.error) {
    case "tx_mismatch": return t("papp.payTxMismatch");
    case "different_bytes_already_broadcast": return t("papp.payAlreadySent");
    case "sim_no_broadcast": return t("papp.payNoChain");
    case "invalid_tx": return t("papp.payTxMismatch");
    default: return t("papp.didntGoThrough");
  }
}

// ---- the flow ---------------------------------------------------------------

/**
 * Sign one payout intent and hand the bytes back. Resolves true when the money is on the wire.
 *
 * Every guard in front of the wallet is here rather than on the server, because the server is
 * the thing they guard against. The address pin is core.js's (`pinState`): a compromised
 * nimiq.kids could rewrite `children.address` and hand it back, and 36 base32 characters do
 * not read as wrong. A MISMATCH refuses outright — this is the one screen where the client
 * genuinely builds the transaction, so it is the one place a refusal can still save the money.
 */
export async function signPayout(intent, a) {
  const kid = state.overview?.children?.find((k) => k.id === a?.child?.id) ?? null;
  if (kid && pinState(kid) === "mismatch") {
    toast(t("papp.payAddrChanged", { name: kid.label }), "error");
    return false;
  }
  // The recipient must also be the address the queue is showing for this kid. They come from
  // the same server, so this catches a swap made BETWEEN the two reads rather than a lying
  // server — cheap, and the alternative is signing to an address no screen ever displayed.
  if (kid?.address && bare(kid.address) !== bare(intent.recipient)) {
    toast(t("papp.payAddrChanged", { name: kid.label }), "error");
    return false;
  }

  // BEFORE the wallet, not after. `connect()` opens a popup or navigates the page away, and a
  // parent who meets that first is being asked to authorise a number they have not been shown
  // the reason for. Dismissing the sheet then costs nothing, which is the whole point of
  // putting the one question this flow asks in front of the one interruption it causes.
  if (intent.nettedLuna > 0 && !(await confirmNetted(intent, a))) return false;

  const w = wallet();
  if (!w) { toast(t("papp.didntGoThrough"), "error"); return false; }
  if (!w.account) {
    try { await w.connect(); } catch { /* declined or redirected */ }
    if (!w.account) { toast(t("papp.payConnect")); return false; }
  }
  // The intent names ONE sender and the server refuses anything else, so catching it here
  // saves the parent a wallet popup that could only ever end in a refusal.
  if (bare(w.account.address) !== bare(intent.sender)) {
    toast(t("papp.payWrongWallet", { address: spacedAddress(intent.sender).slice(0, 9) }), "error");
    return false;
  }

  markInFlight(a.id);
  let res;
  try {
    toast(t("papp.paySigning"));
    res = await w.signAndSend({
      recipient: bare(intent.recipient),
      valueLuna: intent.valueLuna,
      feeLuna: intent.feeLuna,
      data: intent.data,
      validityStartHeight: intent.validityStartHeight,
    });
  } catch (err) {
    // Declining the wallet's own dialog is a normal outcome, not a failure. The in-flight
    // note stays either way: the intent is claimed on the server, so the next tap resumes it.
    if (miniApp()?.isUserCancel(err)) toast(t("papp.sendCancelled"));
    else toast(t("papp.didntGoThrough"), "error");
    return false;
  }
  // Mini-app mode returns the serialized form in both fields; Hub mode signs without
  // broadcasting and returns it alongside a real hash. A missing one means the wallet
  // navigated away instead of resolving, which is the mobile redirect: say nothing, the
  // parent is looking at their wallet.
  if (!res?.serializedTx) return false;

  const r = await call("POST", "/api/payouts/broadcast", {
    intentId: intent.intentId, serializedTx: res.serializedTx,
  });
  if (r.status !== 200) { toast(relayError(r.data), "error"); return false; }

  clearInFlight(a.id);
  juice("payday"); // real NIM just moved to the kid — the payday moment
  const hash = r.data.txHash;
  toast(
    t("papp.approvedPaid", { amount: fmtNim(intent.valueLuna), name: a?.child?.label ?? "" }),
    "success",
    hash && state.explorerTx ? { label: t("papp.seeReceipt"), url: `${state.explorerTx}${hash}` } : null,
  );
  return true;
}

/** A payout the kid's deferred spending ate whole: no wallet, no transaction, and the work
 *  is paid for all the same. Said plainly, because "approved, nothing sent" is exactly the
 *  sentence a parent would otherwise read as a bug. */
export function settledWholeToast(settled, a) {
  clearInFlight(a.id);
  juice("choreApproved");
  toast(t("papp.netSettledWhole", {
    name: a?.child?.label ?? "",
    amount: fmtNim(settled?.settleLuna ?? 0),
  }), "success");
}

export { clearInFlight };
