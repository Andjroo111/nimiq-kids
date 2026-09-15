// Who has to say yes before a kid's NIM moves — and whether this instance actually asks.
//
// The product has two versions. The REAL one requires a parent to approve every send out of
// a kid's account and every stake, because those are the irreversible actions. The DEMO one
// runs them unlocked so a judge or a visitor can walk the whole flow on their own in under a
// minute — and it therefore owes the viewer a plain statement that this is not how the real
// thing behaves.
//
// This module is that statement, in one place, so the API, the kid app and the parent app
// cannot drift from each other or quietly claim a protection that is not switched on.
//
// The gate is real now (v0.43.0): stake/unstake and outbound sends ride the parent approval
// queue wherever `requiresApproval` says so, and kid money endpoints demand a bearer wherever
// `authRequired` says so (src/routes/families.ts childMoneyGate).

import type { Family } from "./repo";
import { custodyMode } from "./custody-boot";

export type ApprovalPolicy = {
  /** Mirrors src/nimiq/client.ts SIM exactly (same formula; parity-pinned by test). */
  simActive: boolean;
  /** NIMIQ_NETWORK=main and NOT simulated — real money is reachable. */
  mainnetReal: boolean;
  /** Approval required for EVERY family on this instance, regardless of family mode. */
  forced: boolean;
  /** Kid money endpoints demand a valid parent/device bearer. */
  authRequired: boolean;
};

/**
 * Read at CALL time (not import) so route tests can flip env, and so importing this
 * module alone never trips nimiq/client's import-time mainnet arm-check.
 *
 * The SIM formula is duplicated from src/nimiq/client.ts on purpose: importing client.ts
 * here would make custody a chain-touching module. src/custody-policy.test.ts pins the
 * two formulas together so they cannot drift.
 *
 * Policy, from the top:
 *  - mainnet-for-real is NEVER demo-unlocked: approval is forced on regardless of env or
 *    family mode. Demo mode stays a sim/testnet-only affordance.
 *  - HATCH_REQUIRE_PARENT_APPROVAL=1 forces approval on for every family here.
 *  - forced instances (and public boots, HATCH_LEGACY_BOOT=0) also require a bearer on
 *    kid money endpoints; a legacy single-household boot keeps its open tablet.
 */
export function approvalPolicy(env: Record<string, string | undefined> = process.env): ApprovalPolicy {
  // = client.ts SIM formula, pinned by src/custody-policy.test.ts. A parent-custody
  // instance has no key BY DESIGN and is still a real, chain-connected instance; see the
  // long note on SIM in src/nimiq/client.ts for why those two stopped being the same thing.
  const simActive = env.NIMIQ_SIM === "1"
    || (!env.DEV_PARENT_PRIV && custodyMode(env) !== "parent");
  const onMainnet = (env.NIMIQ_NETWORK ?? "test") === "main";
  const mainnetReal = onMainnet && !simActive;
  // FORCED KEYS OFF THE NETWORK ALONE, NEVER OFF `simActive`.
  //
  // `simActive` is true when DEV_PARENT_PRIV is ABSENT. Deriving `forced` from
  // `mainnetReal` therefore meant that REMOVING A KEY SILENTLY DISARMED THE APPROVAL GATE
  // on the mainnet instance: no key -> simActive -> not mainnetReal -> not forced -> every
  // household falls back to its own mode, and a demo-mode row is unlocked. The live
  // mainnet env does not set HATCH_REQUIRE_PARENT_APPROVAL, so nothing else was holding
  // the door.
  //
  // That is not hypothetical. Going non-custodial DELETES DEV_PARENT_PRIV and
  // HATCH_MASTER_SEED by design, so the very change meant to remove server custody would
  // have turned the gate off on its way past.
  //
  // A mainnet instance requires parent approval because it is a mainnet instance. Whether
  // a signing key happens to be present is a separate question, and a weaker one.
  const forced = onMainnet || env.HATCH_REQUIRE_PARENT_APPROVAL === "1";
  const authRequired = forced || env.HATCH_LEGACY_BOOT === "0";
  return { simActive, mainnetReal, forced, authRequired };
}

/**
 * Must a chore payout on this instance be signed by the parent's own wallet?
 *
 * Instance-level, not per-kid, and that is not a simplification. `HATCH_CUSTODY=parent`
 * refuses to boot unless `DEV_PARENT_PRIV` is unset, so such an instance holds no key it
 * could pay ANY child with — including a child whose row still says `address_source:
 * 'derived'` from before the switch. Keying this off the child would produce a payout path
 * that exists in policy and cannot exist in fact.
 *
 * One definition, in one place, because "who signs the money" written twice is the shape of
 * bug where the approve route and the relay disagree about which world they are in.
 */
export function parentSignedPayouts(env: Record<string, string | undefined> = process.env): boolean {
  return custodyMode(env) === "parent";
}

/** Does THIS household's kid-initiated stake/unstake (and outbound send) need a parent?
 *  Forced instances always say yes; otherwise the family's own mode decides. */
export function requiresApproval(fam?: Family | null): boolean {
  return approvalPolicy().forced || fam?.mode === "family";
}

/** Shown verbatim wherever the warning surfaces. Kept short enough for a phone banner. */
export const DEMO_WARNING =
  "Demo mode: sends and staking happen instantly, with no grown-up approval. In the real version a parent has to approve every send and every stake.";

/** The block every wallet-facing response carries, so no client has to infer any of this.
 *  Pass the family for the per-household answer; without one (e.g. /health) it reports
 *  the instance-level floor. `kidAuthRequired` is additive — no frontend reads it yet. */
export function custodyView(fam?: Family | null) {
  const p = approvalPolicy();
  const req = fam ? p.forced || fam.mode === "family" : p.forced;
  return {
    demoUnlocked: !req,
    requiresParentApproval: req,
    warning: req ? null : DEMO_WARNING,
    kidAuthRequired: p.authRequired,
    // Who holds a NEW kid's key on this instance: 'server' (derived from HATCH_MASTER_SEED)
    // or 'parent' (registered from the parent's own wallet, no key here). Published so a
    // client never has to infer custody from the presence of a feature — the parent app
    // shows the registration flow off this, and /health states it out loud.
    kidCustody: custodyMode(),
  };
}
