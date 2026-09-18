// The response headers this app was serving none of.
//
// The whole middleware stack was compressText, cacheBusting, rootRedirectWhenLegacyClosed and
// serveStatic, and a grep across src/ found exactly two headers ever set on any response:
// Cache-Control and Content-Type. No CSP, no frame-ancestors, no nosniff, no Referrer-Policy.
//
// Both apps keep a long-lived bearer credential in localStorage, so the two that matter most
// here are the ones that bound what an injected script can do with it and who may put this
// origin in a frame.
//
// FRAME-ANCESTORS IS THE HALF THAT WAS MISSING. `parentAuth` returns ok on the bearer token
// alone, and the parent app sends `{}` as the approve body — no PIN — so a page that could
// frame /parent/ could turn one UI-redressed click into an approved payout of real mainnet
// NIM. Chrome's storage partitioning blunts that for a third-party top-level site; it does
// not for a same-site attacker page, and it does not for the kiosk WebView.

import type { Context, Next } from "hono";

/**
 * Where the app legitimately talks to something that is not itself. Kept as one list, with a
 * reason each, because a CSP is only maintainable if the next person can tell which line they
 * are allowed to delete.
 */
const HUB = "https://hub.nimiq.com";        // Nimiq Hub: wallet connect, checkout, signing
const BOT = "https://bot.nimiq.tech";       // "Report a bug" posts straight from the browser
const YOUTUBE = "https://www.youtube-nocookie.com"; // the marketing page's one embed
const RIV = "https://riv.nimiq.kids";       // the characters' .riv files the marketing page plays

/**
 * Google Fonts used to be here, and is not any more.
 *
 * Both copies of `address-display.css` under `public/vendor` opened with
 * `@import url('https://fonts.googleapis.com/css2?family=Fira+Mono…')`, and the parent page
 * links that stylesheet, so every visitor to a children's app announced their IP to Google
 * for a font already sitting in `public/fonts/`. Both stylesheets now declare `@font-face`
 * against those local files, the way Mulish already did, and these two allowances went with
 * them.
 *
 * The objection to editing them was that they are VENDORED (`nq add`), so a component sync
 * would quietly undo it and the CSP would start blocking a real request again.
 * `src/vendor-fonts.test.ts` fails when that happens, which is a better answer than allowing
 * the origin forever in case it comes back.
 *
 * The demo pages under `public/vendor/` still link Google directly. They are component
 * exhibits nobody navigates to, they are `nq add` output verbatim, and a blocked webfont on
 * one is a cosmetic fallback rather than a broken page. Left alone on purpose.
 */

/**
 * Cloudflare Web Analytics was allowed here, and is not any more.
 *
 * It was never in this repo: the TUNNEL injected it, which is why the browser sweep that
 * verified this policy before it shipped could not see it and the first pass against the live
 * demo found two blocked-script violations per page load. It was then allowed to restore what
 * was already running, with the note that turning the beacon off was the other answer and
 * arguably the better one on an app for children.
 *
 * Andjroo turned it off on 2026-08-03: Web Analytics for the `nimiq.kids` hostname is set to
 * Disable ("the JS Snippet will not be injected"), verified by a browser-shaped request to the
 * live parent app returning no beacon. So both allowances are gone.
 *
 * The coupling now runs the other way, and that is deliberate. Re-enabling RUM in the
 * Cloudflare dashboard would put an injected script on every page that this policy blocks, so
 * it fails loudly in the console rather than quietly resuming. Anyone turning it back on has
 * to come here too, which is the correct amount of friction for adding a third party to a
 * children's app.
 *
 * Cloudflare's zone analytics (requests, bandwidth, cache, threats) are server side and are
 * unaffected. Nothing here turns those off.
 */

/**
 * `'unsafe-inline'` in script-src, and the reason it is still here.
 *
 * The portal, demo, invite and marketing pages are server-rendered HTML with inline `<script>`
 * blocks, and the kid roster still uses `href="javascript:void(0)"`. Dropping the keyword today
 * would break all of them, so the policy states the intent and holds every OTHER line tight:
 * `object-src 'none'`, `base-uri 'none'`, a closed `connect-src`, and a `frame-ancestors` that
 * is the actual clickjacking fix. Moving those blocks into files is what earns its removal, and
 * it is a separate change with its own verification.
 *
 * `'unsafe-inline'` in style-src is not going anywhere: `style="…"` attributes are how both
 * apps position things, and inline styles are not a script-execution primitive.
 */
/**
 * `'wasm-unsafe-eval'`, and why it is not a loosening of `'unsafe-eval'`.
 *
 * 🔴 WITHOUT IT THE EGG TIMER HAS NO EGG INSIDE THE APP. The timer's frame and its egg are
 * Rive (`public/kid/timer/rive-kit/*.riv`) and the Rive runtime is WebAssembly, which browsers
 * refuse to instantiate under a `script-src` naming neither `'wasm-unsafe-eval'` nor
 * `'unsafe-eval'`. It fails exactly where nobody looks: the page loads, the chrome and the card
 * draw, the console says the module "violates the following Content Security policy directive",
 * and the hexagon plate and the egg are simply absent. Standalone copies of the same file
 * (riv.nimiq.kids) carry no CSP and looked perfect throughout, which is how it shipped
 * (2026-09-17).
 *
 * `'wasm-unsafe-eval'` permits compiling and instantiating WebAssembly and NOTHING else: it does
 * not restore `eval`, `new Function`, or string-to-code of any kind for JavaScript. It is the
 * directive that exists precisely so an app can run wasm without reopening that door.
 *
 * ⚠️ The runtime's own fallback is a jsdelivr URL and `connect-src` correctly refuses it. That
 * refusal is the SECOND error in the console and it is working as intended; the fix is to let the
 * LOCAL wasm compile, never to open connect-src to a CDN.
 */
export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    // data: for the generated identicons and inlined SVG; blob: for a camera capture the kid
    // app previews before it has uploaded anything.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self'",
    `connect-src 'self' ${HUB} ${BOT} ${RIV}`,
    `frame-src 'self' ${HUB} ${YOUTUBE}`,
    // The clickjacking fix. 'self' rather than 'none' because the Hub flow and the kiosk
    // wrapper both frame our own pages.
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * One middleware, next to cacheBusting in the stack.
 *
 * Set on EVERY response including static files: the uploaded-media route echoes the
 * uploader's own declared MIME, so `nosniff` is doing real work there rather than being
 * boilerplate, and a policy that only covered the API would miss every page it is about.
 *
 * `Referrer-Policy: same-origin` because a kid-app URL can carry a child id, and the bug
 * reporter is not the only way one could leave the device.
 */
export function securityHeaders() {
  const csp = contentSecurityPolicy();
  return async (c: Context, next: Next): Promise<void> => {
    await next();
    c.header("Content-Security-Policy", csp);
    c.header("X-Content-Type-Options", "nosniff");
    // Belt and braces with frame-ancestors, for anything that still reads the older header.
    c.header("X-Frame-Options", "SAMEORIGIN");
    c.header("Referrer-Policy", "same-origin");
    // The kid app asks for the camera itself, from its own origin, so `self` is required
    // rather than empty. Everything else this app has no use for is denied outright.
    c.header("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
  };
}
