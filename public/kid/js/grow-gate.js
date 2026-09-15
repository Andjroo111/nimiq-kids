// Whether the Money screen offers Grow at all. Issue #108.
//
// Deliberately its own module with no imports: money.js pulls in chart/send/receive/grow/scan,
// so a decision living there can only be tested through that whole graph or by asserting on
// source text. This is the one rule that matters, so it gets to be a function with inputs.

/** Should the Grow banner render?
 *
 *  Off-SIM an instance with no HATCH_VALIDATOR_ADDRESS cannot stake: `stakePrecheck` throws
 *  `staking_unavailable`. The banner used to paint anyway, so a visitor could open Grow, key
 *  in an amount, and only then hit the wall.
 *
 *  Two rules, and the second is the one worth stating:
 *  - staking off + nothing staked -> no door.
 *  - staking off + NIM already staked -> STILL show it. That NIM has to stay reachable to
 *    unstake. Hiding it would strand real money behind a screen the kid can no longer open,
 *    which is a worse bug than the dead end this closes.
 *
 *  `undefined` means an older server that does not report the field; treat it as available so
 *  a stale cached shell against a working instance keeps its banner instead of silently
 *  losing it. Only an explicit `false` closes the door.
 *
 *  THIRD RULE, and it takes precedence over both: no address, no door. A kid whose grown-up
 *  has not registered an address for them yet has no account to stake FROM, and the server
 *  refuses the stake outright (`kid_address_not_registered`). This is the same dead end as
 *  the missing validator, reached a different way, and it must not survive the second rule
 *  either: a kid with no address has never staked, so there is no stranded NIM to reach.
 *  `null` is the server SAYING there is no address; `undefined` is an older payload that
 *  never carried the field, and that one keeps the old behaviour.
 */
export function showsGrowBanner(wallet) {
  const w = wallet ?? {};
  if (w.address === null) return false;
  return w.stakingAvailable !== false || (w.stakedLuna ?? 0) > 0;
}
