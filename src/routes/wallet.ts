// V2 wallet routes — the kid app home renders from GET /kids/:id/wallet; sends, staking,
// parent deposit info, and the fiat rate live here too. Kid money endpoints go through
// childMoneyGate: open on a legacy single-household tablet, bearer-required wherever the
// instance demands auth (src/custody.ts). Family deposit endpoints are parent-only.
// Full request/response contract: docs/WALLET-CONTRACT.md.

import { Hono } from "hono";
import { envMs, getClient, getNimiq, SIM } from "../nimiq/client";
import { displayBalance } from "../nimiq/htlc-display-balance";
import * as repo from "../repo";
import * as approvalsRepo from "../repo-approvals";
import * as wrepo from "../repo-wallet";
import * as budget from "../repo-budget";
import * as savingsRepo from "../repo-savings";
import * as referrals from "../repo-referrals";
import { parentFamilyFrom, requireParent } from "../auth";
import { custodyView, parentSignedPayouts, requiresApproval } from "../custody";
import { custodyMode } from "../custody-boot";
import { outstandingDebtLuna } from "../kid-netting";
import { notifyParent } from "../notify";
import {
  availableKidLuna, checkPayable, earnRepayKey, ensureKidWallet, kidBalanceLuna,
  kidOutflowRefusal, kidTransfer, payKidEarn, payoutRefFor, readKidWallet, repayFailedEarn,
} from "../wallet/kid-wallet";
import { familySpendKey, withSpendLock } from "../wallet/spend-lock";
import {
  accrueSimRewards, settlePendingStakes, settlePendingUnstakes, stake, stakePrecheck,
  stakingAvailable, stakingView, unstake, unstakePrecheck,
} from "../wallet/kid-staking";
import { makeProvider } from "../wallet";
// Re-exported, not redefined: `deposit-check` is one place a balance becomes a snapshot,
// and it now lives beside the key it writes (../family-wallet).
import { depositCheckCore, familyWalletKey } from "../family-wallet";
export { depositCheckCore, familyWalletKey };
import { childMoneyGate } from "./families";

export const walletRoutes = new Hono();

/** The fiat rate and its conversions live in ../rates, so the wallet service can
 *  price its payout ceiling without importing a route. Re-exported here because
 *  existing callers import NIM_USD/nimRates from this module. */
import { NIM_USD, nimRates } from "../rates";
export { NIM_USD, nimRates };

/** Moved to repo-wallet so the budget/wallet layers can read the snapshot without
 *  importing a route. Re-exported because existing callers import it from here. */
export { HOT_BALANCE_KEY } from "../repo-wallet";
const HOT_BALANCE_KEY = wrepo.HOT_BALANCE_KEY;

/** A chore payout is a payment FROM the family wallet, but it is written without a
 *  counterparty address (the Cashlink is minted later), so the feed had no identicon
 *  to draw and fell back to a gold hexagon on every row. Fill the sender in here, at
 *  the source, so the kid app and the parent app both get the real thing. */
export function eventView(e: wrepo.WalletEvent, familyAddress?: string | null) {
  const counterpartyAddress = e.counterparty_address
    ?? (e.kind === "earn" ? familyAddress ?? null : null);
  return {
    id: e.id, kind: e.kind, status: e.status, valueLuna: e.value_luna,
    counterpartyAddress, counterpartyLabel: e.counterparty_label,
    txHash: e.tx_hash, message: e.message, availableAt: e.available_at, createdAt: e.created_at,
  };
}

const errStatus = (msg: string): 400 | 404 | 503 => {
  if (msg === "not_family" || msg.startsWith("child not found")) return 404;
  // No validator configured: staking is switched off here, not a bad request.
  if (msg === "staking_unavailable") return 503;
  return 400;
};

/** A NIM address is 36 chars: 'NQ' + 34 base32. A camera hands us whatever was on the
 *  sticker, so anything that is not exactly that shape is refused rather than queued —
 *  a parent should never be asked to approve a send to a malformed destination.
 *
 *  Shape is not validity, and the gap is not academic: the address is TYPED by hand now,
 *  so 'NQ75 …' for 'NQ74 …' is one keystroke away, and the regex above also admits
 *  I/O/W/Z, which are not in Nimiq's base32 alphabet at all. Verified on testnet
 *  2026-07-31: all three passed, queued, and pinged the parent; approving then threw
 *  "Invalid checksum" AFTER the approval had been decided — burning it (409 on retry)
 *  and orphaning the send request in 'pending' forever.
 *
 *  So the codec gets the last word. It runs offline, and it is the same check the
 *  signer would eventually apply — just applied while refusing is still free. */
export async function normalizeNqAddress(raw: string): Promise<string | null> {
  const bare = raw.trim().replace(/^nimiq:/i, "").replace(/\s+/g, "").toUpperCase();
  if (!/^NQ[0-9A-Z]{34}$/.test(bare)) return null;
  try {
    const Nimiq = await getNimiq();
    return Nimiq.Address.fromUserFriendlyAddress(bare).toUserFriendlyAddress();
  } catch {
    return null;
  }
}

/** THE endpoint the kid app home renders from. Gated: balances + history are sensitive.
 *
 *  `readKidWallet`, never `ensureKidWallet`: this is a page load, and on a parent-custody
 *  instance a kid whose parent has not registered an address yet is an ordinary household
 *  in an ordinary state, not an error. It still provisions under server custody, where
 *  minting the account on first GET has always been what this call means. `address` comes
 *  back null for the un-registered kid and the screens say so. */
walletRoutes.get("/kids/:id/wallet", async (c) => {
  const gate = await childMoneyGate(c, c.req.param("id"));
  if (!gate.ok) return c.json(gate.body, gate.status);
  const { child, fam } = gate;
  const fresh = await readKidWallet(child.id);
  accrueSimRewards(fam.id, fresh.id);
  await settlePendingStakes(fresh);
  await settlePendingUnstakes(fresh);
  // NO payout reconciliation here, deliberately. Proving a chore payout means a by-hash
  // lookup per pending row, and a payout that has NOT landed is precisely the one that costs
  // a full read budget to ask about — so hanging it off this handler made the kid's home
  // screen slowest at the exact moment something had gone wrong with their money (measured:
  // 45 s for three unlanded payouts, which past any proxy is a broken screen, not a slow one).
  // The background sweep owns payout settlement outright now.
  //
  // This handler is NOT chain-free, and never was: off-SIM the two settle* calls above each
  // read the chain, and kidBalanceLuna below is an RPC getBalance. Those are pre-existing and
  // bounded — one read apiece, on a query every node answers — whereas payout settlement was
  // unbounded in the number of by-hash lookups AND slowest exactly when it mattered most.
  // Taking the rest of the chain off this path is a separate change and is not made here.
  const balanceLuna = await kidBalanceLuna(fresh);
  return c.json({
    address: fresh.address,
    balanceLuna,
    // Already spent, not yet moved (src/kid-netting.ts). ALREADY subtracted from balanceLuna
    // — published so a screen can explain the gap between what the chain says and what the
    // app says, never so a client can do the subtraction itself and land on a third number.
    // 0 on every instance that does not defer, which is all of them today.
    deferredSpentLuna: outstandingDebtLuna(fresh.id),
    stakedLuna: wrepo.stakedFromLedger(fresh.id),
    pendingUnstakeLuna: wrepo.pendingUnstakeFromLedger(fresh.id),
    pendingStakeLuna: wrepo.pendingStakeFromLedger(fresh.id),
    pendingEarnLuna: wrepo.pendingEarnFromLedger(fresh.id),
    // Chore-free and chain-free (env only), so the Money screen can decide whether to offer
    // Grow at all without a second round trip. See the banner gate in public/kid/js/money.js.
    stakingAvailable: stakingAvailable(),
    events: wrepo.listWalletEvents(fresh.id, 50).map((e) => eventView(e, fam.parent_address)),
    custody: custodyView(fam),
    // WHAT THEY ARE SAVING FOR, and how close (#354). Rides on the wallet read because it is a
    // MIRROR: the meter is this exact `balanceLuna` over the target, so publishing it anywhere
    // else would mean a second read of the balance and a second chance to disagree with it.
    // Null when the kid is not saving for anything. `readMeter` also stamps `reached_at` the
    // first time the balance touches the target -- see repo-savings for why the stamp lives on
    // the read rather than on an event.
    savings: savingsRepo.readMeter(child.id, balanceLuna),
    serverTime: Date.now(),
  });
});

/**
 * Kid-initiated send. Everything that moves the kid's NIM out of their account opens a
 * parent approval (subject_kind 'send') where custody requires one — a Cashlink, a typed
 * address, and since v0.43 an in-family transfer too. Demo-mode households on sim/testnet
 * keep the instant family transfer.
 */
walletRoutes.post("/kids/:id/send", async (c) => {
  const gate = await childMoneyGate(c, c.req.param("id"));
  if (!gate.ok) return c.json(gate.body, gate.status);
  const { child, fam } = gate;
  // Nothing leaves a parent-owned address by a server signature. Refused HERE, before a
  // request is written or a parent is pinged, so no approval is ever opened against a
  // spend this instance cannot perform. See kidOutflowRefusal.
  const refusal = kidOutflowRefusal(child);
  if (refusal) return c.json({ error: refusal }, 409);
  const body = await c.req.json().catch(() => ({}));

  // Anything leaving the family queues for a parent's sign-off and moves NO funds
  // here: a Cashlink (no destination yet) and a raw address (one the app cannot
  // vouch for) both land in the same approval queue.
  //
  // The kid app now HAS an address input (Andjroo, 2026-07-31), on the Send sheet
  // where the wallet keeps it. That does not change the rule it used to justify:
  // a destination outside the family is never a straight-to-send path, whether
  // it was scanned from a camera or typed in by hand. Both arrive as
  // `body.scanned` and both wait for a grown-up.
  const outbound = body.cashlink ?? body.scanned;
  if (outbound) {
    const valueLuna = Math.round(Number(outbound.valueLuna ?? 0));
    if (!Number.isFinite(valueLuna) || valueLuna <= 0) return c.json({ error: "invalid_value" }, 400);
    const toAddress = body.scanned ? await normalizeNqAddress(String(body.scanned.toAddress ?? "")) : null;
    if (body.scanned && !toAddress) return c.json({ error: "invalid_address" }, 400);
    const fresh = await ensureKidWallet(child.id);
    // In-flight value (pending stakes, approved-but-unsettled requests) is already spoken
    // for — a request the parent could never fund must not reach their queue.
    const balance = await availableKidLuna(fresh);
    if (balance < valueLuna) return c.json({ error: "insufficient_funds" }, 400);
    const message = outbound.message ? String(outbound.message).slice(0, 64) : null;
    const req = wrepo.createSendRequest(fam.id, child.id, valueLuna, message, toAddress);
    const approval = approvalsRepo.openApproval(fam.id, child.id, "send", req.id);
    notifyParent(fam, {
      // "scanned a code" was accurate when scanning was the only way in. An
      // address can be typed now, so the alert must not claim how it arrived.
      title: toAddress
        ? `${child.emoji} ${child.label} wants to send NIM to an address`
        : `${child.emoji} ${child.label} wants to send a Cashlink`,
      body: toAddress
        ? `${(valueLuna / 1e5).toFixed(2)} NIM to ${toAddress.slice(0, 9)}…, needs your OK`
        : `${(valueLuna / 1e5).toFixed(2)} NIM, needs your OK`,
      clickUrl: process.env.PARENT_URL ? `${process.env.PARENT_URL}#approval=${approval.id}` : undefined,
      tags: "money_with_wings",
    });
    // Both names on purpose: `sendRequestId` is the shipped field, `requestId` matches what
    // the staking queue answers, so a client can read one key across the whole queue contract.
    return c.json({ status: "pending_approval", approvalId: approval.id, sendRequestId: req.id, requestId: req.id }, 202);
  }

  // Family transfer (kid -> sibling, kid -> parent).
  const valueLuna = Math.round(Number(body.valueLuna ?? 0));
  const message = body.message ? String(body.message).slice(0, 64) : null;
  const toChildId = body.toChildId ? String(body.toChildId) : null;
  const target: import("../wallet/kid-wallet").TransferTarget | null = toChildId
    ? { toChildId }
    : body.toParent
      ? { toParent: true as const }
      : null;
  if (!target) return c.json({ error: "target_required" }, 400);

  // A transfer inside the family is still the kid moving their own NIM out of their own
  // account, and `toParent` is the sharpest one on this list: the recipient is
  // fam.parent_address, which routes/onboard.ts deliberately falls back to the INSTANCE HOT
  // WALLET for any household that never connected a wallet — the judge path. Nothing gives
  // that back. So where approval is required these queue too, on the SAME `send` subject and
  // the same request row the outbound path uses (public/kid/js/send.js already renders the
  // 202 as "a grown-up needs to say OK", and the parent card already exists).
  if (requiresApproval(fam)) {
    let toAddress: string;
    let toLabel: string;
    if (toChildId) {
      // Resolve + validate exactly as an immediate transfer would, so a request that could
      // never succeed is refused here rather than parked in front of a parent.
      if (toChildId === child.id) return c.json({ error: "self_transfer" }, 400);
      const sibling = repo.getChild(toChildId);
      if (!sibling || sibling.family_id !== fam.id) return c.json({ error: "not_family" }, 404);
      // The RECIPIENT's side of the same rule: a sibling needs somewhere for this to land.
      //
      // `ensureKidWallet`, because THIS IS A MONEY PATH and under server custody an account can
      // be minted for a sibling who has simply never logged in. That used to happen implicitly,
      // back when `readKidWallet` provisioned; now that reading is only reading (#381) it has to
      // be asked for, or a gift to a brand-new sibling would refuse for no reason. A kid who
      // receives before they ever choose gets the next index rather than a chosen character,
      // which is the same trade every money path makes: the NIM moving beats the artwork.
      //
      // Under parent custody nothing here can mint, so it throws, and the honest answer is a
      // refusal in words. It used to be an uncaught 500.
      let fresh: repo.Child;
      try {
        fresh = await ensureKidWallet(sibling.id);
      } catch {
        return c.json({ error: "recipient_address_not_registered" }, 409);
      }
      if (!fresh.address) return c.json({ error: "recipient_address_not_registered" }, 409);
      toAddress = fresh.address;
      toLabel = fresh.label;
    } else {
      toAddress = fam.parent_address;
      toLabel = fam.parent_label;
    }
    if (!Number.isFinite(valueLuna) || valueLuna <= 0) return c.json({ error: "invalid_value" }, 400);
    const sender = await ensureKidWallet(child.id);
    if (await availableKidLuna(sender) < valueLuna) return c.json({ error: "insufficient_funds" }, 400);
    const req = wrepo.createSendRequest(fam.id, child.id, valueLuna, message, toAddress);
    const approval = approvalsRepo.openApproval(fam.id, child.id, "send", req.id);
    notifyParent(fam, {
      title: `${child.emoji} ${child.label} wants to give NIM to ${toLabel}`,
      body: `${(valueLuna / 1e5).toFixed(2)} NIM, needs your OK`,
      clickUrl: process.env.PARENT_URL ? `${process.env.PARENT_URL}#approval=${approval.id}` : undefined,
      tags: "money_with_wings",
    });
    return c.json({ status: "pending_approval", approvalId: approval.id, sendRequestId: req.id, requestId: req.id }, 202);
  }

  try {
    const { sent } = await kidTransfer(fam, child.id, target, valueLuna, message);
    return c.json({ status: "sent", event: eventView(sent), balanceLuna: await kidBalanceLuna(repo.getChild(child.id)!) });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    return c.json({ error: msg }, errStatus(msg));
  }
});

// ---- staking ----
walletRoutes.get("/kids/:id/staking", async (c) => {
  const gate = await childMoneyGate(c, c.req.param("id"));
  if (!gate.ok) return c.json(gate.body, gate.status);
  const { child, fam } = gate;
  return c.json({ ...(await stakingView(fam, child.id)), custody: custodyView(fam), serverTime: Date.now() });
});

/**
 * Kid-initiated stake. Where approval is required (src/custody.ts requiresApproval) the
 * intent queues for a parent exactly like an outbound send — precheck first so a request
 * that cannot succeed never reaches the parent, no ledger row until execution. Demo-mode
 * households on relaxed instances keep the instant path, byte-identical.
 */
walletRoutes.post("/kids/:id/stake", async (c) => {
  const gate = await childMoneyGate(c, c.req.param("id"));
  if (!gate.ok) return c.json(gate.body, gate.status);
  const { child, fam } = gate;
  const refusal = kidOutflowRefusal(child);
  if (refusal) return c.json({ error: refusal }, 409);
  const body = await c.req.json().catch(() => ({}));
  const valueLuna = Math.round(Number(body.valueLuna ?? 0));
  if (requiresApproval(fam)) {
    try {
      await stakePrecheck(fam, child.id, valueLuna);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      return c.json({ error: msg }, errStatus(msg));
    }
    const req = wrepo.createStakeRequest(fam.id, child.id, "stake", valueLuna);
    const approval = approvalsRepo.openApproval(fam.id, child.id, "stake", req.id);
    notifyParent(fam, {
      title: `${child.emoji} ${child.label} wants to grow NIM`,
      body: `${(valueLuna / 1e5).toFixed(2)} NIM into staking, needs your OK`,
      clickUrl: process.env.PARENT_URL ? `${process.env.PARENT_URL}#approval=${approval.id}` : undefined,
      tags: "seedling",
    });
    return c.json({ status: "pending_approval", approvalId: approval.id, requestId: req.id, sendRequestId: req.id }, 202);
  }
  try {
    const event = await stake(fam, child.id, valueLuna);
    // stakingView settles pending stakes, and on a fast chain it can confirm THIS one —
    // so re-read the row rather than echoing the snapshot taken before it was settled.
    const view = await stakingView(fam, child.id);
    return c.json({ event: eventView(wrepo.getWalletEvent(event.id) ?? event), ...view });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    return c.json({ error: msg }, errStatus(msg));
  }
});

/** Kid-initiated unstake — same queue-or-instant split as /stake. */
walletRoutes.post("/kids/:id/unstake", async (c) => {
  const gate = await childMoneyGate(c, c.req.param("id"));
  if (!gate.ok) return c.json(gate.body, gate.status);
  const { child, fam } = gate;
  const refusal = kidOutflowRefusal(child);
  if (refusal) return c.json({ error: refusal }, 409);
  const body = await c.req.json().catch(() => ({}));
  const valueLuna = Math.round(Number(body.valueLuna ?? 0));
  if (requiresApproval(fam)) {
    try {
      await unstakePrecheck(fam, child.id, valueLuna);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      return c.json({ error: msg }, errStatus(msg));
    }
    const req = wrepo.createStakeRequest(fam.id, child.id, "unstake", valueLuna);
    const approval = approvalsRepo.openApproval(fam.id, child.id, "unstake", req.id);
    notifyParent(fam, {
      title: `${child.emoji} ${child.label} wants to take NIM back from staking`,
      body: `${(valueLuna / 1e5).toFixed(2)} NIM back to spendable, needs your OK`,
      clickUrl: process.env.PARENT_URL ? `${process.env.PARENT_URL}#approval=${approval.id}` : undefined,
      tags: "leaves",
    });
    return c.json({ status: "pending_approval", approvalId: approval.id, requestId: req.id, sendRequestId: req.id }, 202);
  }
  try {
    const event = await unstake(fam, child.id, valueLuna);
    return c.json({ event: eventView(event), ...(await stakingView(fam, child.id)) });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    return c.json({ error: msg }, errStatus(msg));
  }
});

/**
 * Pay a written-off chore payout again. Parent-only.
 *
 * The gap this closes: a payout the chain refuses leaves the chore already 'approved', the
 * approvals row already 'approved', and the parent already told `paidLuna` — so re-approving
 * the chore returns 409 and the kid simply never gets the money. There was no other path.
 *
 * Only a row the chain PROVED did not execute qualifies (`status='failed'`), so this can
 * never double-pay a payout that was merely slow; and only once per row. Serialized on the
 * family spend lock like every other hot-wallet outflow, with the same affordability gate.
 */
walletRoutes.post("/family/earns/:id/repay", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const ev = wrepo.getWalletEvent(c.req.param("id") ?? "");
  if (!ev || ev.family_id !== fam.id || !ev.child_id) return c.json({ error: "not_found" }, 404);
  if (ev.kind !== "earn" || ev.status !== "failed") return c.json({ error: "not_repayable" }, 409);
  return withSpendLock(familySpendKey(fam.id), async (): Promise<Response> => {
    const fresh = wrepo.getWalletEvent(ev.id)!;
    if (fresh.status !== "failed" || wrepo.getWalletState(earnRepayKey(fresh.id))) {
      return c.json({ error: "already_repaid" }, 409);
    }
    const affordable = await checkPayable(fam, fresh.value_luna);
    if (!affordable.ok) {
      return c.json({
        error: "budget_exhausted", neededLuna: fresh.value_luna, availableLuna: affordable.availableLuna,
      }, 400);
    }
    try {
      const replacement = await repayFailedEarn(fam, fresh);
      return c.json({ event: eventView(replacement, fam.parent_address), paidLuna: replacement.value_luna });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      return c.json({ error: "pay_failed", detail: msg }, 502);
    }
  });
});

// ---- parent funds a kid directly ----

/**
 * The most a single gift may move, so one visitor cannot drain the shared hot wallet for
 * everyone else even while staying inside their own family budget. 2,000 NIM is about a
 * sticker pack: enough for the gesture to be worth making, small enough that the worst
 * case per demo visitor rises from ~6,500 NIM to ~8,500 rather than without limit.
 */
export const MAX_FUND_LUNA = Number(process.env.HATCH_MAX_FUND_LUNA ?? 200_000_000);

/**
 * Parent -> kid, with no chore behind it: pocket money, a birthday, making something right.
 *
 * This is written as an `earn` row on purpose, and that is the load-bearing decision here.
 * The budget's `spentLuna` (src/repo-budget.ts) derives what a family has spent from
 * `kind='earn'`, Treasure Box refunds and Cashlink mints. A NEW row kind — `deposit`,
 * `gift`, anything — would move real NIM out of the shared hot wallet and be invisible to
 * that sum, which is an open tap: the family's available budget would never fall and one
 * visitor could empty the wallet for every other household on the instance. Reusing `earn`
 * also inherits the write-ahead payout claim, the pending-until-the-chain-agrees status and
 * `sweepPendingEarns`, none of which is worth reimplementing beside a copy that lacks them.
 *
 * Gated with `checkPayable` BEFORE anything moves, exactly like an approval: `payKidEarn`
 * itself does not consult the budget, so the caller has to. A refusal leaves nothing
 * half-applied and the parent can top up and try again.
 */
walletRoutes.post("/kids/:id/fund", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const child = repo.getChild(c.req.param("id") ?? "");
  if (!child || child.family_id !== fam.id) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  // Validated BEFORE any rounding: `Math.round` first would make an integer check
  // unfailable, and quietly turn a caller's 1.5 luna into a 2 luna payment. Luna is the
  // indivisible unit, so a fractional amount is a bug in the caller and is worth saying so.
  const valueLuna = Number(body.valueLuna ?? 0);
  if (!Number.isInteger(valueLuna) || valueLuna <= 0) return c.json({ error: "invalid_value" }, 400);
  if (valueLuna > MAX_FUND_LUNA) {
    return c.json({ error: "above_max_fund", maxLuna: MAX_FUND_LUNA }, 400);
  }
  const message = String(body.message ?? "").slice(0, 64) || "A present from your family";

  // A KID WITH NOWHERE TO RECEIVE IT (#245). Under `HATCH_CUSTODY=parent` this server holds no
  // key and cannot mint an account, so a kid whose parent has not registered an address yet is
  // a normal, expected state. It used to reach `payKidEarn` and come back 502 `pay_failed`,
  // which says the chain or the node let us down and invites a retry that can never succeed.
  //
  // NOT behind `kidOutflowRefusal`, and that is the whole reason this was left out of #237.
  // That helper also refuses `parent_signature_required` when `address_source === 'parent'`,
  // which is a rule about money LEAVING the kid's account. Funding pays money IN: refusing a
  // gift because the kid cannot spend it unaided would be a new bug wearing a shared helper's
  // name. Only the address half of the rule applies here.
  //
  // `kid_address_not_registered` rather than the `recipient_address_not_registered` a transfer
  // to an unregistered sibling gets: that code exists in /send to tell the RECIPIENT apart from
  // the sender, and this route has exactly one kid, who is its subject.
  //
  // Read the row rather than provisioning one, and refuse in front of the queue so nothing is
  // written and no lock is taken.
  if (!child.address && custodyMode() === "parent") {
    return c.json({ error: "kid_address_not_registered" }, 409);
  }

  // Serialized on the family spend lock like every other hot-wallet outflow, so two taps
  // cannot both pass an affordability check against the same balance.
  return withSpendLock(familySpendKey(fam.id), async (): Promise<Response> => {
    const affordable = await checkPayable(fam, valueLuna);
    if (!affordable.ok) {
      return c.json({
        error: "budget_exhausted", neededLuna: valueLuna, availableLuna: affordable.availableLuna,
      }, 400);
    }
    // The client sends a key per opened sheet, so a double tap or a retried request pays
    // once. Without one this is still a single shot; it just has no replay protection.
    const key = String(body.requestId ?? "").slice(0, 64) || crypto.randomUUID();
    try {
      const event = await payKidEarn(fam, child.id, valueLuna, message, {
        ref: payoutRefFor("fund", key),
      });
      return c.json({ event: eventView(event, fam.parent_address), paidLuna: event.value_luna }, 201);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      return c.json({ error: "pay_failed", detail: msg }, 502);
    }
  });
});

// ---- family deposit (parent top-up of the hot wallet) ----
/** The hot wallet address + a QR payload the parent app renders ("top up" screen).
 *  Slice 3 additions: the family's payout-budget view (so the screen can show what's
 *  left) and the short family code the in-app top-up rides in the tx data field. */
walletRoutes.get("/family/deposit-info", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  // Under parent custody the household's wallet IS `fam.parent_address`, so the provider is
  // not asked at all. It used to be asked and to throw, and the catch below produced the
  // right answer for the wrong reason — a fallback that would have started returning the
  // instance wallet the moment a key appeared in that env for any reason.
  let address = fam.parent_address;
  if (!parentSignedPayouts()) {
    try {
      address = await makeProvider().getAddress();
    } catch {
      /* provider not configured (read-only boot) — family row address is the fallback */
    }
  }
  return c.json({
    address, qr: `nimiq:${address.replace(/\s/g, "")}`, sim: SIM,
    familyCode: referrals.getOrCreateInvite(fam.id).code,
    budget: budget.budgetView(fam),
  });
});

walletRoutes.post("/family/deposit-check", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  // WHOSE BALANCE THIS READS. Under `HATCH_CUSTODY=parent` the instance holds no key and has
  // no hot wallet, so `makeProvider().getAddress()` throws, `readBalance` rejects, and the
  // whole check answered 502 `balance_check_failed`. Nothing ever refreshed the snapshot, so
  // every parent-custody household's Home tab showed an empty family wallet forever, however
  // much real NIM sat at its address. The household's wallet there is `fam.parent_address`.
  const parentCustody = parentSignedPayouts();
  const readBalance = SIM
    ? null
    : async () => (await getClient()).getBalance(
      parentCustody ? fam.parent_address : await makeProvider().getAddress(),
    );
  const res = await depositCheckCore(fam, readBalance, parentCustody ? fam.id : null);
  if ("error" in res) return c.json(res, 502);
  return c.json({ ...res, sim: SIM });
});

/** Offline-parse a serialized top-up tx so the budget can attribute it: sender +
 *  recipient + value + fee + hash, or null when the hex isn't a parseable transaction.
 *  The SENDER is what makes attribution possible at all (see topUpExecuted).
 *  Exported for tests. */
export async function parseTopUpTx(
  serializedTx: string,
): Promise<{ sender: string; recipient: string; valueLuna: number; feeLuna: number; txHash: string } | null> {
  try {
    const Nimiq = await getNimiq();
    const tx = Nimiq.Transaction.fromAny(serializedTx);
    return {
      sender: tx.sender.toUserFriendlyAddress(),
      recipient: tx.recipient.toUserFriendlyAddress(),
      valueLuna: Number(tx.value),
      feeLuna: Number(tx.fee),
      txHash: tx.hash(),
    };
  } catch {
    return null;
  }
}

const normalizeAddr = (a: string) => a.replace(/\s/g, "").toUpperCase();

/** The ONE place a family deposit becomes visible: the budget credit (tx-hash-deduped)
 *  and the family-level 'deposit' feed event are written together, attributed to the
 *  family that actually broadcast the money. Returns the credited luna, 0 on a replay
 *  (the unique tx-hash index makes the whole thing idempotent). Exported for tests. */
export function recordAttributedTopUp(familyId: string, valueLuna: number, txHash: string): number {
  const credit = budget.addBudgetCredit(familyId, valueLuna, "topup", txHash);
  if (!credit) return 0;
  wrepo.addWalletEvent({
    familyId, childId: null, kind: "deposit", valueLuna: credit.value_luna,
    counterpartyLabel: "Top-up", txHash, message: "Family wallet top-up detected",
  });
  return credit.value_luna;
}

/** How long topup-broadcast waits for a broadcast top-up to actually LAND in the hot
 *  wallet before it gives up on crediting the budget. Re-posting the same tx is the
 *  retry (the hash dedupe makes that safe), so a slow block costs nothing but a wait. */
export const TOPUP_CONFIRM_TIMEOUT_MS = envMs("HATCH_TOPUP_CONFIRM_MS", 25_000);
const TOPUP_POLL_MS = envMs("HATCH_TOPUP_POLL_MS", 2_000);

/**
 * Did THIS transaction actually execute after the broadcast?
 *
 * A node returning a tx hash from sendRawTransaction means only "accepted into the
 * mempool" — it is NOT proof of funding. A transaction signed by an empty account is
 * accepted exactly the same way and then silently never executes. Crediting on that
 * hash let any parent-authed caller mint unlimited payout budget out of nothing and
 * spend it out of the SHARED hot wallet (verified against live testnet 2026-07-31).
 *
 * The first fix watched the hot wallet's balance rise instead — and that was still not
 * attribution. The hot wallet is SHARED, so "the balance went up by at least what my tx
 * was signed for" is satisfied just as well by somebody else's deposit landing in the
 * window. An attacker signs an unfunded tx sized to an inflow they expect, and the other
 * household's money is credited to them: the exact leak, re-entered from the other side.
 *
 * Attribution needs a chain fact that ONLY this transaction can produce, so the gate is
 * the SENDER's balance falling. The sender is the caller's own account, nobody else can
 * spend out of it, and an unfunded account's balance cannot fall at all. Both legs must
 * hold before a credit:
 *
 *   sender  senderBefore - senderNow >= value + fee   this tx really executed
 *   hot     hotNow - hotBefore       >= value         and the money really arrived
 *
 * Balance is the only chain read every supported node can answer — `getTransactionByHash`
 * is unavailable on the light-client sidecar and `getTransactionsByAddress` is unavailable
 * on validator / non-history nodes, so neither can be the gate.
 *
 * Both legs are one-directional, so the failure mode is a false NEGATIVE, never a false
 * positive: if the sender receives other money inside the window its drop reads short and
 * nothing is credited. Re-posting the same tx is the retry and the hash dedupe makes that
 * free, so a missed credit costs a second poll, while a wrong credit costs real NIM.
 *
 * Exported for tests; the two `read*` functions are the seam.
 */
export async function topUpExecuted(
  readSender: () => Promise<number>,
  readHot: () => Promise<number>,
  senderBefore: number,
  hotBefore: number,
  expectedLuna: number,
  feeLuna: number,
  opts: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? TOPUP_CONFIRM_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? TOPUP_POLL_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // A read that fails reports the UNCHANGED baseline, so a flaky RPC can never look
    // like a confirmation.
    const [senderNow, hotNow] = await Promise.all([
      readSender().catch(() => senderBefore),
      readHot().catch(() => hotBefore),
    ]);
    const spent = senderBefore - senderNow >= expectedLuna + feeLuna;
    const arrived = hotNow - hotBefore >= expectedLuna;
    if (spent && arrived) return true;
    if (Date.now() >= deadline) return false;
    await sleep(pollMs);
  }
}

/**
 * W3 additive: broadcast a parent-signed top-up transaction. The Hub's signTransaction
 * signs but does NOT relay, so the parent app posts the serialized tx here and the
 * server broadcasts it over the same RPC path every other tx uses. SIM: no chain, no-op
 * (deposit-check is snapshot-only there anyway).
 *
 * Slice 3 deposit attribution: this route is parent-authed, so the family is KNOWN.
 * The tx is parsed offline; when it verifiably pays the hot wallet AND that exact
 * transaction is observed to EXECUTE (see topUpExecuted — a broadcast is not a payment,
 * and neither is the shared wallet's balance going up), its value credits THIS family's
 * payout budget, deduped by tx hash so reposting the same tx can never double-credit.
 * An unparseable, off-target, unfunded or never-executed tx still broadcasts (it is the
 * parent's own signed money) but credits nothing; the response says so via `landed`.
 *
 * Attribution follows the SENDER's money, not the bearer's word, so the worst a caller
 * can do by broadcasting somebody else's signed tx is credit their own family with money
 * that account genuinely paid — once, because the hash dedupe closes behind it.
 */
walletRoutes.post("/family/topup-broadcast", requireParent, async (c) => {
  const fam = parentFamilyFrom(c)!;
  const body = await c.req.json().catch(() => ({}));
  const serializedTx = String(body.serializedTx ?? "");
  if (!/^[0-9a-fA-F]{20,}$/.test(serializedTx)) return c.json({ error: "invalid_tx" }, 400);
  if (SIM) return c.json({ sim: true, txHash: null });
  const parsed = await parseTopUpTx(serializedTx);
  const client = await getClient();

  // Resolve the hot wallet and snapshot BOTH baselines BEFORE the broadcast — the
  // sender's balance and the hot wallet's. The pair is the whole basis of the credit,
  // so both have to be read first.
  let hotAddress = "";
  try {
    hotAddress = await makeProvider().getAddress();
  } catch { /* provider not configured — no attribution possible */ }
  // A tx the hot wallet sends to itself has no sender to watch, so it can never be
  // attributed; nor can a zero-value or off-target one.
  const attributable = !!parsed && parsed.valueLuna > 0 && !!hotAddress
    && normalizeAddr(parsed.recipient) === normalizeAddr(hotAddress)
    && normalizeAddr(parsed.sender) !== normalizeAddr(hotAddress);
  // A duplicate hash is already credited; skip the (slow) confirmation wait entirely.
  const alreadyCredited = attributable && budget.hasBudgetCreditTx(parsed!.txHash);
  let hotBefore = 0;
  let senderBefore = 0;
  // These two baselines are the ONLY thing this read is for. There is deliberately no
  // "can the sender afford it?" pre-check any more: it was a second, weaker judgment
  // standing in front of a strictly stronger one. topUpExecuted below proves execution
  // from chain — the sender's balance FALLING by value+fee AND the hot wallet receiving
  // it — which a merely-affordable account cannot fake and an unaffordable one cannot
  // pass. The pre-check could only ever subtract: any read that understates the sender
  // (a stale or degraded RPC, an account whose funds are mid-settlement) turned it into
  // a SILENT skip of a credit for money that really moved. Cost of dropping it is
  // bounded and visible: an unfundable tx now sits out TOPUP_CONFIRM_TIMEOUT_MS before
  // returning landed:false, instead of bailing immediately. It still credits nothing.
  if (attributable && !alreadyCredited) {
    try {
      [hotBefore, senderBefore] = await Promise.all([
        client.getBalance(hotAddress),
        client.getBalance(parsed!.sender),
      ]);
    } catch (err) {
      return c.json({ error: "balance_check_failed", detail: String((err as Error)?.message ?? err) }, 502);
    }
  }

  let txHash: string;
  try {
    txHash = await client.sendTransaction(serializedTx);
  } catch (err) {
    return c.json({ error: "broadcast_failed", detail: String((err as Error)?.message ?? err) }, 502);
  }

  let creditedLuna = 0;
  let landed = false;
  if (attributable && !alreadyCredited) {
    landed = await topUpExecuted(
      () => client.getBalance(parsed!.sender),
      () => client.getBalance(hotAddress),
      senderBefore, hotBefore, parsed!.valueLuna, parsed!.feeLuna,
    );
    if (landed) creditedLuna = recordAttributedTopUp(fam.id, parsed!.valueLuna, txHash || parsed!.txHash);
  }
  return c.json({ sim: false, txHash, creditedLuna, landed: landed || alreadyCredited });
});

// ---- fiat rates ----
// The fetching, caching and conversion all live in ../rates so the wallet
// service can price its payout ceiling without importing a route.
walletRoutes.get("/rates", async (c) => {
  const nim = await nimRates();
  return c.json({ nimUsd: nim.usd ?? NIM_USD, nim });
});

// ---- connected-wallet balance (the header corner control) ----
/** Balance of an arbitrary address — the CONNECTED wallet in the corner
 *  control. PUBLIC: an address balance is public chain data, and the corner
 *  renders for any connected visitor (Andjroo hit this signed OUT of a family —
 *  the parent gate hid his balance). The strict address shape plus the 30s
 *  per-address cache keeps this from being a useful open RPC proxy.
 *
 *  The number is HTLC-aware: a Nimiq Pay wallet parks NIM in swap contracts, so
 *  the basic balance alone can tell a solvent visitor they are broke. The walk
 *  that corrects it costs ~13.3s against ~0.35s for the basic read, so it runs
 *  in the background and never delays this handler — see ../nimiq/htlc-display-balance.
 *  DISPLAY ONLY: nothing spendable is gated on it. */
walletRoutes.get("/wallet/balance", async (c) => {
  const address = (c.req.query("address") ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!/^NQ\d{2}( [0-9A-HJ-NP-VXY]{4}){8}$/.test(address)) return c.json({ error: "bad_address" }, 400);
  if (SIM) return c.json({ balanceLuna: 0, sim: true });
  try {
    const client = await getClient();
    const bal = await displayBalance(address, (a) => client.getBalance(a));
    return c.json({ ...bal, sim: false });
  } catch (err) {
    return c.json({ error: "balance_failed", detail: String((err as Error)?.message ?? err) }, 502);
  }
});
