// Keep the testnet demo's hot wallet funded, measured in VISITORS rather than NIM.
//
// The demo pays each visitor's seeded history on chain, so the hot wallet is the thing that
// decides whether the demo works at all. Drained, it does not fail loudly: `payDemoHistory` is
// best-effort, so a visitor still gets a 201 and a household whose kids hold nothing.
//
// THE THRESHOLD IS IN VISITORS ON PURPOSE. What a visitor costs is not a constant — it moved
// 6,400 -> 24,000 -> 72,000 in a single day as the Treasure Box floor was raised twice, and it
// tracks the live catalogue by design. Every NIM-denominated number written near this system
// has gone stale: `HATCH_DEMO_GRANT_LUNA` went underwater twice, and `docs/NEXT-SESSION.md`
// quoted a hot-wallet balance that was a third wrong within a day. So this asks
// `seedHistoryLunaAt()` what a visitor costs right now and does the arithmetic every run.

import { seedHistoryLunaAt } from "./demo-family";
import { nimUsd } from "./rates";

/** Public testnet faucet. Documented in deploy/testnet-demo/README-TESTNET.md. */
export const FAUCET_URL = process.env.HATCH_FAUCET_URL ?? "https://faucet.pos.nimiq-testnet.com/tapit";

/** Top up when runway falls below this many visitors. */
export const FLOOR_VISITORS = Number(process.env.HATCH_TOPUP_FLOOR_VISITORS ?? 5);
/** Refill up to this many visitors of runway. */
export const TARGET_VISITORS = Number(process.env.HATCH_TOPUP_TARGET_VISITORS ?? 15);
/**
 * Most taps one run may take.
 *
 * This is a public faucet run for developers, and the politeness matters: the cap means a
 * wallet that cannot reach its target creeps up over several runs instead of hammering. It also
 * bounds the damage if the balance read is wrong — without it, a read returning 0 would tap
 * until the target, which is a lot of requests founded on one bad answer.
 */
export const MAX_TAPS_PER_RUN = Number(process.env.HATCH_TOPUP_MAX_TAPS ?? 4);
/** Measured 2026-08-01: one tap is 110,000 NIM. Only used to PLAN; the result is verified. */
export const TAP_LUNA = Number(process.env.HATCH_TOPUP_TAP_LUNA ?? 110_000 * 100_000);

export interface TopUpPlan {
  balanceLuna: number;
  costPerVisitorLuna: number;
  /** Runway now, in visitors. Fractional on purpose — 0.9 is not "1". */
  visitors: number;
  /** Taps to reach TARGET_VISITORS, before the per-run cap. */
  tapsWanted: number;
  /** What this run will actually attempt. */
  taps: number;
  /** False when runway is already above the floor: the normal, quiet case. */
  needed: boolean;
}

/**
 * Decide what one run should do. Pure, so the arithmetic is testable without a faucet or a node.
 *
 * A cost of 0 (a rate lookup that failed, an empty catalogue) means the visitor arithmetic is
 * meaningless, and dividing by it would report infinite runway and never top up — the silent
 * failure this whole file exists to avoid. Treat it as "cannot decide" and do nothing, loudly.
 */
export function planTopUp(
  balanceLuna: number,
  costPerVisitorLuna: number,
  opts: { floor?: number; target?: number; maxTaps?: number; tapLuna?: number } = {},
): TopUpPlan {
  const floor = opts.floor ?? FLOOR_VISITORS;
  const target = opts.target ?? TARGET_VISITORS;
  const maxTaps = opts.maxTaps ?? MAX_TAPS_PER_RUN;
  const tapLuna = opts.tapLuna ?? TAP_LUNA;

  if (!(costPerVisitorLuna > 0)) {
    return { balanceLuna, costPerVisitorLuna, visitors: 0, tapsWanted: 0, taps: 0, needed: false };
  }
  const visitors = balanceLuna / costPerVisitorLuna;
  if (visitors >= floor) {
    return { balanceLuna, costPerVisitorLuna, visitors, tapsWanted: 0, taps: 0, needed: false };
  }
  const shortfall = Math.max(0, target * costPerVisitorLuna - balanceLuna);
  const tapsWanted = Math.ceil(shortfall / tapLuna);
  return {
    balanceLuna, costPerVisitorLuna, visitors, tapsWanted,
    taps: Math.min(tapsWanted, maxTaps), needed: true,
  };
}

/** What a demo visitor costs right now, priced off the live catalogue and the live NIM rate. */
export async function costPerVisitorLuna(): Promise<number> {
  return seedHistoryLunaAt(await nimUsd());
}

/** One faucet tap. Returns whether the faucet ACCEPTED it, which is not the same as it landing. */
export async function tapFaucet(address: string, url = FAUCET_URL): Promise<boolean> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ address }).toString(),
  });
  if (!res.ok) return false;
  const body = await res.json().catch(() => null) as { success?: boolean } | null;
  return body?.success === true;
}
