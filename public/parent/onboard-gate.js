// Pure decisions for the first-run "create your family" screen — no DOM, no globals, no
// fetch — so the custody rule can be exercised as a function with inputs rather than through
// the whole boot path. Same shape and the same reason as token-capture.js.
//
// WHAT THIS IS FOR. Under parent custody `families.parent_address` is the SENDER of every
// payout intent the server mints, so POST /api/onboard refuses a household that brings no
// address of its own (src/routes/onboard.ts, `address_required`): a family whose row names
// the instance hot wallet cannot sign for itself. That refusal is correct and stays.
//
// The screen in front of it was the bug. It called the wallet "optional right now", left the
// primary button live, and turned a precise server refusal into "That didn't go through. Try
// again" — advice that cannot work, on the one screen with no way forward. So: under parent
// custody the wallet is a STEP, stated before the parent types anything, the primary button
// does not fire without it, and the refusal has words a parent can act on.
//
// CUSTODY IS READ, NEVER INFERRED FROM A FAILED RESPONSE. /health publishes
// `custody.kidCustody` unauthenticated, which is the only source a screen holding no bearer
// token has (core.js reads it at boot into state.custody). An instance that has not answered
// yet is UNKNOWN, and unknown resolves to the shipped server-custody screen on purpose: the
// testnet demo is the competition judge path and must not change while a fetch is in flight.
// The screen repaints when the answer lands.

/** True when this instance hands new kids parent custody, i.e. the parent's own wallet is
 *  the sender and onboarding cannot invent one for them. */
export function walletRequired(custody) {
  return custody?.kidCustody === "parent";
}

/**
 * Which wallet block the first-run screen draws, and the ONE place that decides it.
 *
 *   "connected"  a wallet is connected: the same confirmation chip in both custody modes
 *   "required"   parent custody with nothing connected: the step, above the name fields
 *   "optional"   server custody with nothing connected: the shipped ghost button + hint
 *
 * "optional" is the block carrying "Optional right now. You can top up any time later." — a
 * true sentence on a server-custody instance, where the family wallet is the instance's own
 * and a connect really does only affect top-ups, and a false one under parent custody. That
 * it can never be returned for parent custody is the invariant this function exists to hold.
 */
export function walletBlock(custody, address) {
  if (String(address ?? "").trim()) return "connected";
  return walletRequired(custody) ? "required" : "optional";
}

/** Whether the primary button would be firing into a guaranteed 400. Derived from
 *  walletBlock rather than re-deciding, so a disabled button and the step explaining it can
 *  never disagree: the button is dead exactly while the step is on screen. */
export function walletBlocksCreate(custody, address) {
  return walletBlock(custody, address) === "required";
}

/**
 * A refusal from POST /api/onboard, as a locale KEY the caller translates. Same job as
 * registerError/challengeError in views-wallet.js; a key rather than a rendered string only
 * so this module stays free of the i18n shell and can be tested as a function.
 *
 * `address_required` is the whole point: it is the one refusal the parent can fix, and it is
 * the one that used to arrive as the generic "try again".
 *
 * THE TWO BRAKES ARE TWO DIFFERENT SENTENCES (#242), which is why the route stopped answering
 * both with one code. "Try again" is wrong advice for either of them, but so is telling a
 * family the instance turned away for the day that an hour will fix it. Waiting is the only
 * move in both cases and the honest message is how long.
 *
 * The four label refusals stay on the generic message ON PURPOSE. The screen in front of them
 * cannot produce one: createFamily() refuses to send without both names, and both fields carry
 * `maxlength` equal to the server's cap. src/onboard-refusals.test.ts holds that agreement, so
 * the day the screen loosens either guard the decision is re-taken rather than inherited.
 */
export function onboardErrorKey(data) {
  switch (data?.error) {
    case "address_required": return "papp.onbNeedWallet";
    case "invalid_address": return "papp.addrInvalid";
    case "too_many_requests": return "papp.onbTooMany";
    case "too_many_families_today": return "papp.onbTooManyToday";
    default: return "papp.didntGoThrough";
  }
}
