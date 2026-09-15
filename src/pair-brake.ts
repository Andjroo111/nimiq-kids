// How many wrong pair codes this instance will look at.
//
// A pair code is 6 digits. It is single-use, lives 5 minutes, and a family has at most
// one live at a time — good constraints, but they are only worth anything with a brake
// on guessing, because a guess is tested against EVERY live code at once
// (`redeemPairCode` looks up by hash, not by family).
//
// Two routes redeem one, and they are in different files: `POST /api/pair` mints a
// PARENT token, `POST /api/devices/register` mints a DEVICE token. Both spend the same
// budget here, so an attacker cannot get a second allowance by switching endpoints.
//
// ONLY A WRONG GUESS PAYS: the budget is charged after a lookup misses, never before, so
// normal traffic — where codes are typed off a screen and almost always right — never
// touches it. It exists for the one case the per-caller brake cannot reach, a botnet
// spending six guesses per address.
//
// THE TRADE-OFF, STATED PLAINLY. To bound guessing we have to refuse to LOOK, so once the
// budget is spent a correct code is refused too, until the window rolls. That is a real
// availability cost and it is the right way round: this route mints a bearer token that
// can spend a household's money, pairing is rare, and the wait is under a minute. The
// window is deliberately short and the cap deliberately generous for that reason.

import { allow, overLimit } from "./rate-limit";

const WINDOW_MS = 60 * 1000;

/** Wrong codes per minute, instance-wide, across both redeem routes. */
const MAX_MISSES_PER_MIN = Number(process.env.HATCH_PAIR_MISSES_PER_MIN ?? 30);

/** Per-caller attempts per minute, shared by both redeem routes (see clientIp). */
export const PAIR_MAX_PER_IP_MIN = Number(process.env.HATCH_PAIR_PER_IP_MIN ?? 6);

const MISS_KEY = "pair:miss";

/** True once this instance has looked at enough wrong codes for one minute. */
export function pairGuessBudgetSpent(): boolean {
  return overLimit(MISS_KEY, MAX_MISSES_PER_MIN);
}

/** Charge one wrong guess. Call this only after a lookup has actually missed. */
export function recordPairGuessMiss(): void {
  allow(MISS_KEY, MAX_MISSES_PER_MIN, WINDOW_MS);
}

/** One attempt from this caller, against the shared per-caller allowance. */
export function pairAttemptAllowed(ip: string): boolean {
  return allow(`pair:${ip}`, PAIR_MAX_PER_IP_MIN, WINDOW_MS);
}
