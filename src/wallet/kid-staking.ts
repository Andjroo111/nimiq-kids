// V2 kid staking service — stake / unstake / lazy settlement + SIM accrual.
//
// REAL: txs are signed with the kid's derived key and delegated to HATCH_VALIDATOR_ADDRESS
// (Andjroo's validator). Unstaking is the honest Albatross multi-step (see src/nimiq/staking.ts):
// deactivate now, retire+remove lazily once the cooldown estimate passes; the node is the real
// gate — a rejected retire/remove just stays pending and retries on the next read.
//
// SIM: ledger-only, but it must FEEL real TODAY — staking locks spendable NIM, the staked
// balance grows daily at EST_APY_PCT (lazy accrual on read, no cron), and unstakes release
// after a short cooldown the kids can actually watch happen.

import { envMs, SIM } from "../nimiq/client";
import {
  accruedRewardLuna, broadcastAddStake, broadcastCreateStaker, broadcastDeactivate,
  broadcastRetireAndRemove, EST_APY_PCT, MINIMUM_STAKE_LUNA, UNSTAKE_COOLDOWN_MS,
  VALIDATOR_ADDRESS, wholeDaysMs,
} from "../nimiq/staking";
import type * as repo from "../repo";
import * as wrepo from "../repo-wallet";
import { readEarnReceipt, type EarnReceipt } from "./earn-settlement";
import {
  ensureKidWallet, kidBalanceLuna, kidKey, readKidWallet, reservedOutflowLuna, simTxHash,
} from "./kid-wallet";
import { childSpendKey, withSpendLock } from "./spend-lock";

export interface StakingView {
  stakedLuna: number;
  pendingLuna: number;
  /** Broadcast but not yet proven on chain — shown as "starting", never as locked. */
  pendingStakeLuna: number;
  estApyPct: number;
  rewardsEarnedLuna: number;
  /** Chain floor (100 NIM); the UI must not offer a stake below it off-SIM. */
  minStakeLuna: number;
  /** False when staking cannot work at all here (no validator configured off-SIM). */
  available: boolean;
}

/**
 * How long a broadcast stake may stay unproven before it is written off as failed.
 * Albatross produces a block roughly every second and observed inclusion was well
 * under a minute, so five minutes is generous. Erring towards 'failed' is the safe
 * direction: under-reporting staked NIM is confusing, over-reporting it invents a
 * lock that does not exist and lets the same NIM be spent twice.
 */
export const STAKE_CONFIRM_TIMEOUT_MS = envMs("HATCH_STAKE_CONFIRM_TIMEOUT_MS", 5 * 60 * 1000);

/**
 * How long to wait for a broadcast retire+remove to show up as returned funds before
 * broadcasting the pair again. Generous: a duplicate retire/remove that lands after the first
 * one succeeded simply fails at execution and costs nothing (fees are 0), whereas retrying too
 * eagerly spams the mempool.
 */
export const UNSTAKE_RETRY_AFTER_MS = envMs("HATCH_UNSTAKE_RETRY_AFTER_MS", 10 * 60 * 1000);

/** wallet_state key holding the pre-broadcast chain balance for a pending stake. */
const stakeCheckKey = (eventId: string) => `stake_check:${eventId}`;
/** wallet_state key marking WHEN a retire+remove was broadcast for this unstake. Rows written
 *  before v0.99 also carry the `balanceBefore` the old balance-rise check compared against; it
 *  is read by nothing now and simply ages out with the row. */
const unstakeCheckKey = (eventId: string) => `unstake_check:${eventId}`;

function readUnstakeAttempt(eventId: string): { at: number } | null {
  const raw = wrepo.getWalletState(unstakeCheckKey(eventId));
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { at?: unknown };
    return typeof p.at === "number" ? { at: p.at } : null;
  } catch {
    return null;
  }
}

/** Test seam, the sibling of kid-wallet's _setEarnChain: drive settlePendingUnstakes against
 *  receipts a test controls, without a node. */
let _readReceipt: ((txHash: string) => Promise<EarnReceipt>) | null = null;
export function _setUnstakeReceiptReader(fn: ((txHash: string) => Promise<EarnReceipt>) | null): void {
  _readReceipt = fn;
}
const readReceipt = (txHash: string) => (_readReceipt ?? readEarnReceipt)(txHash);

const accrualKey = (childId: string) => `sim_accrual:${childId}`;

/**
 * SIM lazy accrual tick: whole days since the last tick × daily rate on the current principal,
 * persisted as ONE auto-restaked 'reward' row. Deterministic + testable via `nowMs`.
 * No-op off-SIM (real rewards restake on-chain; the ledger records what we know).
 */
export function accrueSimRewards(familyId: string, childId: string, nowMs = Date.now()): number {
  if (!SIM) return 0;
  const staked = wrepo.stakedFromLedger(childId);
  if (staked <= 0) {
    wrepo.setWalletState(accrualKey(childId), String(nowMs)); // idle clock doesn't bank rewards
    return 0;
  }
  const lastRaw = wrepo.getWalletState(accrualKey(childId));
  const last = lastRaw ? Number(lastRaw) : nowMs;
  if (!lastRaw) wrepo.setWalletState(accrualKey(childId), String(nowMs));
  const reward = accruedRewardLuna(staked, nowMs - last);
  if (reward <= 0) return 0;
  wrepo.addWalletEvent({
    familyId, childId, kind: "reward", valueLuna: reward,
    counterpartyLabel: "Staking reward", txHash: simTxHash(),
    message: `${EST_APY_PCT}% a year, growing while you sleep`,
  });
  wrepo.setWalletState(accrualKey(childId), String(last + wholeDaysMs(nowMs - last)));
  return reward;
}

export type UnstakeSettleDecision = "returned" | "retry" | "wait";

/**
 * Has an already-broadcast retire+remove actually put the NIM back in the kid's account?
 *
 * ATTRIBUTION, NOT ARITHMETIC — the same correction earn-settlement.ts, deposit detection and
 * top-up crediting each made before it. This was the last place still asking "has the balance
 * risen by at least the unstaked amount?", which is not a question about the unstake at all: a
 * balance rises whoever sent the money, and chore payouts land in exactly that account.
 *
 * The masking was the COMMON case, not an edge case. The unstake amount is kid-chosen and can
 * be 1 NIM; a chore payout is routinely several. So the ordinary sequence — unstake a little,
 * do a job, open the app — confirmed a retire+remove that had failed at execution, which is
 * the documented behaviour this whole check exists to catch (the node ACCEPTS retire and
 * remove from an account with no retired stake and fails them at execution, verified on
 * testnet 2026-07-31). And the false positive is IRREVERSIBLE: settling clears the attempt
 * record, so no later pass ever retries, and the kid's NIM is left inactive inside the staking
 * contract with nothing in the app tracking it.
 *
 * The remove transaction's own receipt is the only chain fact that belongs to this unstake and
 * nothing else, so it is the only thing that may say "returned". Everything else means the NIM
 * is still in the contract:
 *
 *   executed     the remove ran. The money is back. The ONLY door to "returned".
 *   rejected     included and failed at execution — the exact shape above.
 *   unknown      never mined, or dropped from the mempool.
 *   unavailable  OUR blindness, not a fact about the unstake, so it decides nothing at all.
 *                It cannot even age into a retry: re-signing against a node that is not
 *                answering is how a retry storm starts, and the row is correctly pending
 *                meanwhile — the NIM is in the contract and is not counted as spendable.
 *
 * Unlike a failed stake, a failed unstake is never written off. The kid's NIM is still sitting
 * in the staking contract, so the honest state is "still staked, try again" — marking it done
 * would tell a kid their money came back when it did not, and marking it failed would lose it
 * from both balances. A duplicate retire/remove that lands after a successful one simply fails
 * at execution and costs nothing (fees are 0), which is what makes retrying the safe default.
 *
 * `receipt` null means nothing has been broadcast yet.
 */
export function unstakeSettleDecision(opts: {
  receipt: EarnReceipt | null;
  attemptAgeMs: number;
  retryAfterMs?: number;
}): UnstakeSettleDecision {
  if (opts.receipt === null) return "retry"; // never attempted
  if (opts.receipt === "executed") return "returned";
  if (opts.receipt === "unavailable") return "wait"; // node down: never decide, never re-sign
  return opts.attemptAgeMs > (opts.retryAfterMs ?? UNSTAKE_RETRY_AFTER_MS) ? "retry" : "wait";
}

/**
 * Flip pending unstakes whose cooldown has passed. SIM marks them done immediately (no chain
 * to fail). REAL broadcasts the retire+remove pair and then — crucially — waits for the chain
 * to show the funds back before saying so.
 *
 * The node ACCEPTS retire and remove transactions from an account with no retired stake and
 * fails them at execution (verified on testnet 2026-07-31), so a successful broadcast proves
 * nothing. Marking the event done on broadcast, as this used to, told the kid their NIM was
 * spendable again while it was still locked in the staking contract — and because staked
 * already excludes a pending unstake, the amount vanished from both balances at once.
 *
 * Lazy — called on read.
 */
export async function settlePendingUnstakes(child: repo.Child, nowMs = Date.now()): Promise<number> {
  let settled = 0;
  for (const ev of wrepo.listPendingUnstakes(child.id)) {
    if ((ev.available_at ?? 0) > nowMs) continue;
    if (SIM) {
      wrepo.markWalletEventDone(ev.id, simTxHash());
      settled += ev.value_luna;
      continue;
    }
    const attempt = readUnstakeAttempt(ev.id);
    // The REMOVE transaction's hash — the half of the pair that moves the NIM back — is what
    // setWalletEventTxHash recorded when the attempt was broadcast. Its receipt is read for
    // this unstake and nothing else. (No balance is read here any more: it could not attribute
    // anything, and it cost an RPC round trip on every wallet read.)
    const receipt = attempt ? await readReceipt(ev.tx_hash ?? "") : null;
    const decision = unstakeSettleDecision({
      receipt,
      attemptAgeMs: attempt ? nowMs - attempt.at : 0,
    });
    if (decision === "returned") {
      wrepo.markWalletEventDone(ev.id);
      wrepo.deleteWalletState(unstakeCheckKey(ev.id));
      settled += ev.value_luna;
    } else if (decision === "retry") {
      try {
        const key = await kidKey(child);
        const txHash = await broadcastRetireAndRemove(key.privHex, ev.value_luna);
        // Still PENDING: the broadcast was accepted, which is not the same as executed.
        wrepo.setWalletEventTxHash(ev.id, txHash);
        wrepo.setWalletState(unstakeCheckKey(ev.id), JSON.stringify({ at: nowMs }));
      } catch {
        // Node refused outright (cooldown genuinely not over, or unreachable). Stays pending
        // with no attempt recorded, so the next read tries again.
      }
    }
  }
  return settled;
}

/**
 * Reconcile stakes that were broadcast but never proven. A staking transaction can be
 * accepted, mined and reported "confirmed" while failing execution, so the only honest
 * proof that stake left the account is the account balance itself dropping by at least
 * the staked amount. Lazy — called on read, like settlePendingUnstakes.
 *
 * An incoming deposit can mask the debit and hold a genuinely-successful stake at
 * pending until it times out. That direction is deliberate: a stake wrongly written off
 * as failed costs the kid a confusing screen, while a failure wrongly recorded as
 * success invents a lock and lets the same NIM be spent twice.
 */
export type StakeSettleDecision = "confirmed" | "failed" | "wait";

/**
 * Should a pending stake be promoted, written off, or left alone? Pure so the rule can be
 * tested without a chain — the I/O lives in settlePendingStakes.
 *
 * `balanceBefore` null means we have no baseline to compare against (a row written before
 * this check existed): unprovable, so it can only ever time out. `currentBalance` null
 * means the node did not answer: always wait, never write off on an outage.
 */
export function stakeSettleDecision(opts: {
  stakedLuna: number;
  balanceBefore: number | null;
  currentBalance: number | null;
  ageMs: number;
  timeoutMs?: number;
}): StakeSettleDecision {
  const timeout = opts.timeoutMs ?? STAKE_CONFIRM_TIMEOUT_MS;
  if (opts.currentBalance === null) return "wait";
  if (opts.balanceBefore !== null && opts.currentBalance <= opts.balanceBefore - opts.stakedLuna) {
    return "confirmed";
  }
  return opts.ageMs > timeout ? "failed" : "wait";
}

export async function settlePendingStakes(child: repo.Child, nowMs = Date.now()): Promise<number> {
  if (SIM) return 0; // SIM has no chain to fail: stake rows are written 'done'
  let confirmed = 0;
  for (const ev of wrepo.listPendingStakes(child.id)) {
    const stakedLuna = -ev.value_luna; // stake rows are negative
    const beforeRaw = wrepo.getWalletState(stakeCheckKey(ev.id));
    let currentBalance: number | null = null;
    if (beforeRaw !== null) {
      try {
        currentBalance = await kidBalanceLuna(child);
      } catch {
        currentBalance = null; // node unreachable — retried on the next read
      }
    }
    const decision = stakeSettleDecision({
      stakedLuna,
      balanceBefore: beforeRaw === null ? null : Number(beforeRaw),
      // With no baseline there is nothing to compare, but the row must still be able to
      // time out rather than sit pending forever.
      currentBalance: beforeRaw === null ? 0 : currentBalance,
      ageMs: nowMs - ev.created_at,
    });
    if (decision === "confirmed") {
      wrepo.markWalletEventDone(ev.id);
      confirmed += stakedLuna;
    } else if (decision === "failed") {
      wrepo.markWalletEventFailed(ev.id);
    }
  }
  return confirmed;
}

/**
 * Everything that can REFUSE a stake, with no side effects beyond the lazy settle/accrue
 * ticks every read already runs. Shared by queue time (opening a parent approval) and
 * approve time (executing it) so a request that cannot succeed is refused while refusing
 * is still free — and an approval whose funds have since drained stays pending instead
 * of burning. Throws: invalid_value | staking_unavailable | below_min_stake |
 * insufficient_funds.
 */
export async function stakePrecheck(
  fam: repo.Family, childId: string, valueLuna: number, excludeRequestId: string | null = null,
): Promise<{ child: repo.Child; balance: number }> {
  if (!Number.isInteger(valueLuna) || valueLuna <= 0) throw new Error("invalid_value");
  if (!SIM) {
    if (!VALIDATOR_ADDRESS) throw new Error("staking_unavailable");
    // The chain refuses anything under the floor outright, so catching it here turns a
    // raw RPC string ("Transaction has invalid value") into something a kid app can say.
    if (valueLuna < MINIMUM_STAKE_LUNA) throw new Error("below_min_stake");
  }
  const child = await ensureKidWallet(childId);
  accrueSimRewards(fam.id, childId);
  await settlePendingStakes(child);
  const balance = await kidBalanceLuna(child);
  // Anything already in flight is still sitting in the account balance but is spoken for —
  // pending stakes AND approved-but-unsettled outflows (the queued request being executed
  // right now is passed as excludeRequestId so it never blocks itself).
  if (balance - reservedOutflowLuna(childId, excludeRequestId) < valueLuna) throw new Error("insufficient_funds");
  return { child, balance };
}

/** The unstake mirror of stakePrecheck. Throws: invalid_value | insufficient_stake. */
export async function unstakePrecheck(
  fam: repo.Family, childId: string, valueLuna: number, nowMs = Date.now(),
): Promise<{ child: repo.Child; staked: number }> {
  if (!Number.isInteger(valueLuna) || valueLuna <= 0) throw new Error("invalid_value");
  const child = await ensureKidWallet(childId);
  accrueSimRewards(fam.id, childId);
  // Unconfirmed stake is not stake — settle first so a kid cannot unstake NIM that
  // never made it into the staking contract.
  await settlePendingStakes(child, nowMs);
  const staked = wrepo.stakedFromLedger(childId);
  if (staked < valueLuna) throw new Error("insufficient_stake");
  return { child, staked };
}

/**
 * Stake `valueLuna` from the kid's spendable balance, delegated to the family validator.
 * First stake creates the staker; later stakes top it up.
 *
 * Off-SIM the resulting ledger row is written PENDING: broadcasting only proves the node
 * accepted the transaction into its mempool, never that it executed. settlePendingStakes
 * promotes it to done once the chain shows the debit.
 */
export function stake(
  fam: repo.Family, childId: string, valueLuna: number, excludeRequestId: string | null = null,
): Promise<wrepo.WalletEvent> {
  // SERIALIZED per child (src/wallet/spend-lock.ts): the precheck and the broadcast+ledger
  // write are one critical section, so a concurrent send/buy/stake cannot spend the same
  // balance this stake was checked against.
  return withSpendLock(childSpendKey(childId), () => stakeLocked(fam, childId, valueLuna, excludeRequestId));
}

async function stakeLocked(
  fam: repo.Family, childId: string, valueLuna: number, excludeRequestId: string | null,
): Promise<wrepo.WalletEvent> {
  const { child, balance } = await stakePrecheck(fam, childId, valueLuna, excludeRequestId);
  const inFlight = wrepo.pendingStakeFromLedger(childId);
  // create-vs-top-up is decided from OUR ledger because nimiq-settlement exposes no
  // getStaker RPC. Two known hazards, both of which now surface as a failed stake rather
  // than a phantom lock: a staker that exists on chain but not in this ledger (restored
  // DB) makes every create-staker fail, and HATCH_VALIDATOR_ADDRESS must name a validator
  // actually registered on the target network. Verified on testnet 2026-07-31: an
  // undelegated create-staker executes and debits, while delegating to an address that is
  // not a registered validator there is mined, reported "confirmed", and silently does
  // nothing. Confirm the validator on the network you are pointing at before enabling.
  const firstStake = wrepo.stakedFromLedger(childId) + inFlight <= 0;
  let txHash: string;
  if (SIM) {
    txHash = simTxHash();
  } else {
    const key = await kidKey(child);
    txHash = firstStake
      ? await broadcastCreateStaker(key.privHex, valueLuna)
      : await broadcastAddStake(key.privHex, valueLuna);
  }
  const event = wrepo.addWalletEvent({
    familyId: fam.id, childId, kind: "stake", valueLuna: -valueLuna,
    status: SIM ? "done" : "pending",
    counterpartyLabel: "Staking", txHash, message: firstStake ? "Started growing" : "Added to growing",
  });
  if (!SIM) wrepo.setWalletState(stakeCheckKey(event.id), String(balance));
  return event;
}

/** Start an unstake: deactivate now, record the pending release. The value leaves the staked
 *  balance immediately and lands in spendable once the cooldown settles (lazy, on read). */
export function unstake(
  fam: repo.Family, childId: string, valueLuna: number, nowMs = Date.now(),
): Promise<wrepo.WalletEvent> {
  // Same serialization as stake: two concurrent unstakes must not both pass the staked-
  // balance check — the loser would sit pending forever waiting for funds that never return.
  return withSpendLock(childSpendKey(childId), () => unstakeLocked(fam, childId, valueLuna, nowMs));
}

async function unstakeLocked(
  fam: repo.Family, childId: string, valueLuna: number, nowMs: number,
): Promise<wrepo.WalletEvent> {
  const { child, staked } = await unstakePrecheck(fam, childId, valueLuna, nowMs);
  let txHash: string | null;
  if (SIM) {
    txHash = simTxHash();
  } else {
    const key = await kidKey(child);
    txHash = await broadcastDeactivate(key.privHex, staked - valueLuna);
  }
  return wrepo.addWalletEvent({
    familyId: fam.id, childId, kind: "unstake", valueLuna, status: "pending",
    counterpartyLabel: "Staking", txHash, availableAt: nowMs + UNSTAKE_COOLDOWN_MS,
    message: "On its way back to your wallet",
  });
}

/** Can this instance stake at all?
 *
 *  Env-derived and chain-free, which is what lets the wallet read carry it without paying for
 *  it. Off-SIM `stakePrecheck` throws `staking_unavailable` when the validator address is
 *  missing, so an instance booted without one can take a kid as far as the amount keypad and
 *  then refuse. The kid app asks this first and stops offering the screen instead. */
export function stakingAvailable(): boolean {
  return SIM || Boolean(VALIDATOR_ADDRESS);
}

/** The staking read: accrue + settle lazily, then report.
 *
 *  A READ, so `readKidWallet` — same reason as GET /kids/:id/wallet. This backs
 *  `GET /kids/:id/staking`, which the parent app fetches beside the wallet payload on every
 *  kid page, so demanding a provisioned account here 500'd the Grow panel for exactly the
 *  kids whose parent had not registered an address yet. Both settle passes below are ledger
 *  walks over rows an address-less kid cannot have, and they no-op on an empty list. */
export async function stakingView(fam: repo.Family, childId: string, nowMs = Date.now()): Promise<StakingView> {
  const child = await readKidWallet(childId);
  accrueSimRewards(fam.id, childId, nowMs);
  await settlePendingStakes(child, nowMs);
  await settlePendingUnstakes(child, nowMs);
  return {
    stakedLuna: wrepo.stakedFromLedger(childId),
    pendingLuna: wrepo.pendingUnstakeFromLedger(childId),
    pendingStakeLuna: wrepo.pendingStakeFromLedger(childId),
    estApyPct: EST_APY_PCT,
    rewardsEarnedLuna: wrepo.rewardsFromLedger(childId),
    minStakeLuna: MINIMUM_STAKE_LUNA,
    available: stakingAvailable(),
  };
}
