// The one decision behind "this browser's parent session is no good — now what?", as a pure
// function of the instance flag. No DOM, no location, no fetch, same shape and the same
// reason as token-capture.js and onboard-gate.js: the rule is worth exercising as a function
// with inputs rather than through a boot path and a redirect.
//
// WHAT THIS IS FOR. A seeded demo household is purged HATCH_DEMO_TTL_MS after it is minted —
// four hours on the live instance, swept hourly — and that takes its `parent_tokens` row with
// it, while `kidsParentToken` in localStorage never expires. So on essentially every return
// visit to demo.nimiq.kids (a reload, a bookmark, the installed shortcut, a tab left open past
// lunch) the stored bearer names a family the server no longer has, and /api/parent/overview
// answers 401.
//
// What the parent app DID with that 401 was drop the token and render, which lands on the
// first-run "Welcome to nimiq.kids / Create your family" screen. A judge who tapped "open the
// parent app" was asked to sign up for the product they came to look at, and the seeded
// household — two kids, paid history, a stocked Treasure Box — was simply gone. The kid app
// has never had this problem: main.js has read /health `demo` at boot since #12 and sends a
// 401 to the entrance. This is that same recovery for the other half of the demo.

/** Where a browser with no usable session goes to get one. `?fresh=1` rather than plain
 *  `/demo` for main.js's reason: it is the landing page's own reset path, which clears all
 *  four demo keys and mints unconditionally, where plain `/demo` reuses whatever is in
 *  storage. A 401 is exactly the proof that what is in storage does not work, so there is
 *  nothing to preserve, and going through the reset path is what makes a bounce loop
 *  impossible. */
export const DEMO_ENTRANCE = "/demo?fresh=1";

/**
 * What to do about a parent session this instance will not accept — either a bearer it
 * rejected, or no bearer at all. Both are the same dead end for the same visitor.
 *
 *   "entrance"   go to DEMO_ENTRANCE: this instance mints households, so one is a tap away
 *   "signedOut"  render the shipped signed-out screen: on a family or competition instance
 *                that screen is the correct and only answer
 *   "wait"       /health has not answered yet, so we do not know which instance this is
 *
 * @param demo  /health `demo` as core.js stored it: true, false, or null for not-yet-answered
 * @param bounced  whether this page load has already navigated to the entrance
 */
export function demoRecoveryAction(demo, bounced) {
  if (bounced) return "entrance"; // already leaving; never render over a navigation in flight
  if (demo === true) return "entrance";
  if (demo === false) return "signedOut";
  return "wait";
}

// ⚠️ THIS FUNCTION IS SYNCHRONOUS, AND THAT IS THE LOAD-BEARING PART.
//
// The first version of this recovery awaited the /health read whenever the flag was still
// unknown. That made the signed-out screen on the COMPETITION and FAMILY apps wait on
// /health — measured at 8s against a hung one, where it had painted in 89ms. /health is the
// request most likely to BE the one hanging (it is what surfaceAccessGate probes, and a
// lapsed Cloudflare Access session is exactly how it hangs), so it is the worst thing in the
// app to gate a sign-in screen on.
//
// Awaiting also bought nothing. Both requests start at module eval and /health is cheaper and
// unauthenticated, so by the time a 401 comes back the flag is already known and "wait" is not
// reached at all. Where it genuinely is reached, painting first and bouncing when the answer
// lands costs a demo visitor one frame and costs a real parent nothing. Returning a promise
// from here would quietly reintroduce all of it.
