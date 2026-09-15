// Real staking per kid — delegation to the family's own validator (env HATCH_VALIDATOR_ADDRESS).
//
// Built against what @nimiq/core@2.5.1 TransactionBuilder ACTUALLY exposes (types/wasm/web.d.ts):
//   newCreateStaker(sender, delegation?, value, fee, vsh, networkId)   — first stake, sets delegation
//   newAddStake(sender, stakerAddress, value, fee, vsh, networkId)     — top up an existing staker
//   newSetActiveStake(sender, newActiveBalance, fee, vsh, networkId)   — signaling; deactivates the delta
//   newRetireStake(sender, retireStake, fee, vsh, networkId)           — signaling; retires INACTIVE stake
//   newRemoveStake(recipient, value, fee, vsh, networkId)              — withdraws RETIRED stake
//   newUpdateStaker(sender, newDelegation?, reactivateAll, fee, vsh, networkId)
//
// So unstaking on Albatross is honestly a MULTI-step: deactivate (setActiveStake) -> cooldown while
// the inactive stake releases -> retire -> remove. We model that with a 'pending' unstake
// wallet_event carrying available_at; completion is attempted lazily on read (no cron).
// nimiq-settlement exposes NO getStaker RPC, so the release time is an env-tuned estimate and the
// retire+remove pair simply stays pending if the node rejects it (cooldown not over yet).

import { getClient, getNimiq, NETWORK_ID, SIM } from "./client";

/** Andjroo's validator (the Beelink) — REQUIRED off-SIM for staking. See docs/WALLET-CONTRACT.md. */
export const VALIDATOR_ADDRESS = process.env.HATCH_VALIDATOR_ADDRESS ?? "";

/**
 * Albatross protocol floor: a staker must hold at least 100 NIM, so a create-staker
 * transaction below it can never execute. Measured against the live testnet on
 * 2026-07-31 by bisection: 9_999_999 luna is refused outright by the node
 * ("Transaction has invalid value"), 10_000_000 luna executes and debits.
 *
 * This is a CHAIN rule, not a policy knob — it is deliberately not env-tunable. SIM
 * does not enforce it (there is no chain to refuse), but the value is reported to the
 * UI in both modes so a kid is never offered a stake the chain would throw away.
 */
export const MINIMUM_STAKE_LUNA = 10_000_000;

/** Static estimated APY (%) shown to kids + used for SIM accrual. Env HATCH_EST_APY, default 12. */
export const EST_APY_PCT = Number(process.env.HATCH_EST_APY ?? 12);

/** Unstake cooldown estimate: SIM 60s (kids SEE it release), real 24h (conservative; the node is
 *  the real gate — completion retries lazily until the chain accepts retire+remove). */
export const UNSTAKE_COOLDOWN_MS = Number(
  process.env.HATCH_UNSTAKE_COOLDOWN_MS ?? (SIM ? 60_000 : 24 * 60 * 60 * 1000),
);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Simple (non-compounding) daily accrual on the staked principal, floored to whole days.
 *  Pure math — the lazy tick in kid-staking.ts persists the result as 'reward' rows. */
export function accruedRewardLuna(stakedLuna: number, elapsedMs: number, apyPct = EST_APY_PCT): number {
  if (stakedLuna <= 0 || elapsedMs < DAY_MS) return 0;
  const days = Math.floor(elapsedMs / DAY_MS);
  return Math.round(stakedLuna * (apyPct / 100 / 365) * days);
}

export function wholeDaysMs(elapsedMs: number): number {
  return Math.floor(elapsedMs / DAY_MS) * DAY_MS;
}

async function signingContext(privHex: string) {
  const Nimiq = await getNimiq();
  const client = await getClient();
  const kp = Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(privHex));
  const height = await client.getHeadHeight();
  return { Nimiq, client, kp, height };
}

function requireValidator(): string {
  if (!VALIDATOR_ADDRESS) throw new Error("HATCH_VALIDATOR_ADDRESS not set: cannot stake off-SIM.");
  return VALIDATOR_ADDRESS;
}

/** First stake: create the kid's staker with delegation to the family validator. Returns tx hash. */
export async function broadcastCreateStaker(privHex: string, valueLuna: number): Promise<string> {
  const { Nimiq, client, kp, height } = await signingContext(privHex);
  const tx = Nimiq.TransactionBuilder.newCreateStaker(
    kp.toAddress(),
    Nimiq.Address.fromUserFriendlyAddress(requireValidator()),
    BigInt(valueLuna), 0n, height, NETWORK_ID,
  );
  tx.sign(kp, undefined);
  return client.sendTransaction(tx);
}

/** Top up the kid's existing staker. Returns tx hash. */
export async function broadcastAddStake(privHex: string, valueLuna: number): Promise<string> {
  const { Nimiq, client, kp, height } = await signingContext(privHex);
  const tx = Nimiq.TransactionBuilder.newAddStake(
    kp.toAddress(), kp.toAddress(), BigInt(valueLuna), 0n, height, NETWORK_ID,
  );
  tx.sign(kp, undefined);
  return client.sendTransaction(tx);
}

/** Unstake step 1 — deactivate: shrink the active balance so `valueLuna` goes inactive.
 *  `newActiveLuna` = staked principal minus the amount being unstaked. Returns tx hash. */
export async function broadcastDeactivate(privHex: string, newActiveLuna: number): Promise<string> {
  const { Nimiq, client, kp, height } = await signingContext(privHex);
  const tx = Nimiq.TransactionBuilder.newSetActiveStake(
    kp.toAddress(), BigInt(Math.max(0, newActiveLuna)), 0n, height, NETWORK_ID,
  );
  tx.sign(kp, undefined);
  return client.sendTransaction(tx);
}

/** Unstake steps 2+3 — retire the released inactive stake, then remove it back to the kid's
 *  account. Throws if the node rejects (cooldown not over) — caller keeps the event pending. */
export async function broadcastRetireAndRemove(privHex: string, valueLuna: number): Promise<string> {
  const { Nimiq, client, kp, height } = await signingContext(privHex);
  const retire = Nimiq.TransactionBuilder.newRetireStake(
    kp.toAddress(), BigInt(valueLuna), 0n, height, NETWORK_ID,
  );
  retire.sign(kp, undefined);
  await client.sendTransaction(retire);
  const remove = Nimiq.TransactionBuilder.newRemoveStake(
    kp.toAddress(), BigInt(valueLuna), 0n, height, NETWORK_ID,
  );
  remove.sign(kp, undefined);
  return client.sendTransaction(remove);
}
