// The starter board every new family wakes up to, and the one number that has to stay
// bigger than it: the demo grant.
//
// This lived inline in routes/onboard.ts. It moved here because two other places now have
// to ask what the board is worth — the budget invariant (`grant >= board`, #194) and
// /health, which reports whether a live instance still satisfies it — and a board defined
// next to its only reader is a board the budget cannot see. Same reasoning as demo-flag.ts:
// a fact two callers depend on gets one definition, not two that agree today.
//
// Every reward here is a WHOLE number of NIM, and now by taste rather than by force.
// The kid app deliberately prints rewards as whole coins (`fmtNimWhole`, util.js —
// "never 0.1 NIM"). It used to round anything under half a coin all the way to zero, so
// the old 0.25 NIM "Feed the pet" rendered as **"+0 NIM"** on the very first screen of
// every new family: a job advertising that it pays nothing. That was the formatter's
// bug, not this board's, and it was fixed in v0.55.0 (#30) — a sub-coin reward now
// prints as the fraction it is. The round numbers stay because a starter board reads
// better with them, and the sub-cent-fee point is still better made in the copy than in
// the one place a judge looks first.
//
// Catalog ids, not sentences: this is the FIRST board a new family sees, so it is
// also the first place an untranslated title showed. "Tidy up your room" used to
// be worded differently here than the demo's wording; both are `cat.job.room` now
// and there is one translation of it (today it reads "Clean your room").
//
// `petfeed` seeded this board until 2026-09-17. "Feed the pet" was the vaguest of the
// three starter jobs and it was the first line of the first screen; `dogfeed` says which
// animal. Same $0.50, so `starterBoardUsd()` and the grant invariant are untouched.
//
// Priced in DOLLARS, not luna, because that is the app's one chore-pricing strategy and this
// was the only place that broke it. Everywhere else a chore is worth a realistic allowance
// amount: the demo seeds $0.25–$2.00 (demo-family.ts), the live chore-creation route takes
// `rewardUsd` (chores.ts), and the Treasure Box is priced against real dollars too
// (sticker-catalog.ts: 15 min of screen time ≈ $0.47). This board alone hardcoded 1, 1 and
// 2 NIM — a few tenths of a cent — set "when a chore paid 0.1 NIM", so a new family did every
// starter chore, earned about 4 NIM, opened the shop and bounced off `insufficient_funds`
// against a 1,000 NIM shelf (issue #131). Pricing these in dollars puts the first board a
// family ever sees on the same footing as the shop: one or two chores earns a real reward.
// The luna amount is resolved at onboard time against the live rate, exactly as the demo and
// the creation route do, so the ratio to a dollar-labelled shelf holds as the NIM price moves.

import { usdToWholeNimLuna } from "./rates";

export const SAMPLE_CHORES: readonly { job: string; rewardUsd: number }[] = [
  { job: "bed", rewardUsd: 0.5 },
  { job: "dogfeed", rewardUsd: 0.5 },
  { job: "room", rewardUsd: 1.0 },
];

/** What the whole starter board is worth, in dollars. */
export const starterBoardUsd = (): number =>
  SAMPLE_CHORES.reduce((sum, c) => sum + c.rewardUsd, 0);

/**
 * What the whole starter board costs the hot wallet at `rate`, in luna.
 *
 * Summed per chore rather than converting `starterBoardUsd()` in one go, because each
 * reward is independently rounded UP to a whole coin at creation time. Converting the
 * total instead can under-report by a coin per chore, which is exactly the direction that
 * would let the grant look sufficient while the last approval is refused.
 */
export const starterBoardLuna = (rate: number): number =>
  SAMPLE_CHORES.reduce((sum, c) => sum + usdToWholeNimLuna(c.rewardUsd, rate), 0);

/**
 * What `HATCH_DEMO_GRANT_USD` has to be for a new family to finish this board.
 *
 * Derived, never typed out, so raising a starter chore raises the figure the instance is
 * checked against in the same commit. #194 happened because those two lived in different
 * places and only one of them moved.
 *
 * The 5% is deliberate slack, not a computed requirement. Each reward is independently
 * rounded to a whole coin, so the board's luna total drifts up to half a coin per chore
 * either side of its own dollar value; with the prices this board actually ships, the
 * rounding happens to cancel and a grant of exactly `starterBoardUsd()` clears it across
 * the tested band. The margin is there so a future price that does NOT round cleanly, or a
 * rate read a few minutes stale, cannot put the last approval a single coin short. It costs
 * about ten cents a family.
 */
export const starterBoardGrantUsd = (): number =>
  Math.ceil(starterBoardUsd() * 1.05 * 100) / 100;
