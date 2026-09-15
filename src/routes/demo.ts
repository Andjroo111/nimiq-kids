// The judge-facing demo entrance: GET /demo (a landing page) and POST /api/demo/family
// (mint this visitor's own seeded household). See src/demo-family.ts for why every
// visitor needs a private copy rather than a shared one.
//
// Off by default. Only an instance that sets HATCH_DEMO_SEED=1 grows these routes, so
// the mainnet competition instance — where minting families and paying real history out
// of a funded hot wallet would be an open tap — is unaffected by this file existing.
//
// The mint is a POST that the landing page's own script fires: a crawler, a link
// preview or a prefetch never creates a family, and a visitor who reloads reuses the
// one they already have (the page keeps the family id next to the tokens).

import { Hono } from "hono";
import { mintDemoFamily, payDemoHistory } from "../demo-family";
import { clientIp } from "../client-ip";
import { allow } from "../rate-limit";
import { makeProvider } from "../wallet";
import { NETWORK, SIM } from "../nimiq/client";
import { GATE, pickLang, networkLabel, type GateLang } from "../locales/demo-gate";

export const demoRoutes = new Hono(); // mounted under /api
export const demoLanding = new Hono(); // site page (GET /demo)

/** Whether this instance hands out seeded demo families at all. Read at call time
 *  (like repo-budget's demoGrantLuna) so tests and ops can flip it without an
 *  import-order dance.
 *
 *  THIS IS A FLAG, NOT A SECRET. The original name, `HATCH_DEMO_SEED`, reads like it
 *  holds a seed — and anything that rotates secrets by matching on `SEED` would
 *  overwrite `1` with 64 hex characters and silently switch the entire judge demo off:
 *  `/demo` starts answering 404 and `POST /api/demo/family` returns `demo_disabled`,
 *  with nothing in the boot log to say why. `HATCH_DEMO_ENABLED` is the name to use.
 *
 *  BOTH are accepted on purpose. The env files on the live instances are edited
 *  separately from a deploy, so requiring them to change together would mean a flag
 *  day where whichever lands second turns the demo off. Drop `HATCH_DEMO_SEED` once
 *  every instance has been moved over. */
// Re-exported, not defined: src/demo-flag.ts owns it, because a second copy of this
// predicate is what silently killed on-tablet approvals on the live demo (see that file).
import { demoSeedEnabled } from "../demo-flag";
export { demoSeedEnabled };

// ---- brakes ----
// Shared store (../rate-limit) and one shared definition of who is calling
// (../client-ip) — never a header the caller chose.

/** Tests only: forget all rate-limit state. */
export { resetRateLimits as resetDemoRateLimits } from "../rate-limit";

const DEMO_MAX_PER_IP_HOUR = Number(process.env.HATCH_DEMO_PER_IP_HOUR ?? 12);
const DEMO_MAX_PER_DAY = Number(process.env.HATCH_DEMO_PER_DAY ?? 500);

// ---- mint ----

/**
 * POST /api/demo/family — this visitor's private household, seeded and ready.
 * Returns both bearers ONCE; the page stores them under the keys the two apps
 * already read (kidsParentToken / kid.deviceToken).
 */
demoRoutes.post("/demo/family", async (c) => {
  if (!demoSeedEnabled()) return c.json({ error: "demo_disabled" }, 404);
  if (!allow(`demo:${clientIp(c)}`, DEMO_MAX_PER_IP_HOUR, 60 * 60 * 1000)
    || !allow("demo:all", DEMO_MAX_PER_DAY, 24 * 60 * 60 * 1000)) {
    return c.json({ error: "too_many_requests" }, 429);
  }

  // The family's "parent address" is the instance hot wallet: it is where a kid's
  // Treasure Box spend goes back to, exactly as for a self-serve family.
  let hotWallet = "NQ00 0000 0000 0000 0000 0000 0000 0000 0000";
  try { hotWallet = await makeProvider().getAddress(); } catch { /* keep the placeholder */ }

  const minted = await mintDemoFamily(hotWallet);
  const paidHistory = await payDemoHistory(minted.familyId, minted.children);

  return c.json({
    parentToken: minted.parentToken,
    deviceToken: minted.deviceToken,
    // No `pin`. It used to ride along here and the landing page dropped it on the floor,
    // which is exactly what #15 observed. Nothing on the demo asks for a PIN, so shipping
    // one to the browser was a credential with no reader. See DEMO_PIN in demo-family.ts.
    family: { id: minted.familyId, parentLabel: "Mom" },
    children: minted.children,
    paidHistory,
    network: NETWORK,
  }, 201);
});

// ---- the landing page ----

// The circular-arrow glyph, verbatim from the Nimiq icon set (`redo` in
// nimiq-icons.json, 13x11). Never redraw a Nimiq icon.
const REDO_ICON = `<svg viewBox="0 0 13 11" width="15" height="13" fill="none" aria-hidden="true" focusable="false"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6.715 10.233a4.605 4.605 0 10-4.458-5.756"/><path fill="currentColor" d="M.08 4.806a.512.512 0 01.502-.778l3.407.467c.43.059.596.593.275.885L2.28 7.183a.512.512 0 01-.777-.106z"/></svg>`;

// The lockup is the title now, with no word beside it, so it is sized directly rather
// than matched to a cap height: 240px wide across its 114.814 x 18 viewBox puts the
// hexagon at 37.6px. That clears the ~48px line in public/assets/brand/README.md only
// by using the light lockup, whose solid hand is the glyph that survives small sizes.
// Was 232 against a 110.943 viewBox; the light file's suffix went from Mulish 400 to
// 700 to match the rest of the fleet, which widened it, so this grew to hold the
// hexagon at the same rendered size rather than let the whole mark shrink 3%.
const LOCKUP_W = 240;

/**
 * The line above the card, and the one job this page has to get right.
 *
 * It was the literal string "Testnet demo". That was true, because the only instance
 * setting `HATCH_DEMO_ENABLED` happens to be the testnet one, but it was an assertion the
 * page had no way of checking. Seed a demo family anywhere else and the page keeps
 * promising testnet while handing a visitor a household on another network. For the one
 * page whose whole purpose is telling a stranger that the money is not real, a claim that
 * cannot go stale is worth more than a shorter one.
 *
 * Read from the same two values `/health` reports, so the label and the API can never
 * disagree. The mainnet case deliberately does NOT say "demo": if a seeded household ever
 * runs against real funds the line has to read as a warning, not as reassurance.
 *
 * Takes its inputs rather than closing over the module constants, so it is testable
 * without fighting module caching — `NETWORK` and `SIM` are resolved once at load in
 * src/nimiq/client.ts, and re-importing this route does not re-evaluate them.
 */
// The three labels themselves moved to src/locales/demo-gate.ts, with the rest of this
// page's copy, so they translate too. Re-exported here because that is where the test
// and every existing caller look for it.
export { networkLabel };

/** Ours, but they land in attributes as well as text. A locale file is exactly where
 *  someone eventually pastes a quote or an ampersand. */
const esc = (v: string) =>
  v.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

function demoPage(lang: GateLang): string {
  const s = GATE[lang];
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(s.title)}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<style>
@font-face { font-family: Mulish; font-style: normal; font-weight: 200 1000; font-display: swap;
  src: url("/fonts/mulish-latin-wght-normal.woff2") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
body { min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px;
  font-family: Mulish, system-ui, sans-serif; color: #1F2348;
  background: radial-gradient(100% 100% at bottom right, #260133, #1F2348); }
.stack { width: 100%; max-width: 420px; text-align: center; }
/* The network label sits ABOVE the card, centred on the navy, in the white-60% Nimiq
   uses for secondary text on dark (about 5:1). In the card's corner it was the only
   thing on the page off the centre line, and it drew the eye first. */
.net { display: block; margin-bottom: 16px; font-size: 12px; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase; color: rgba(255,255,255,.6); }
.card { width: 100%; background: #fff; border-radius: 10px; padding: 32px 24px;
  box-shadow: 0 8px 56px rgba(0,0,0,.2); }
/* The lockup IS the title. h1 rather than a bare img so the page keeps a real heading;
   the alt text carries the name for anything that cannot see the artwork. */
h1 { margin: 0; line-height: 0; }
.lockup { width: min(${LOCKUP_W}px, 100%); height: auto; }
p { margin-top: 16px; font-size: 15px; line-height: 1.55; color: rgba(31,35,72,.75); }
.btn { display: block; width: 100%; margin-top: 12px; padding: 16px 24px; border: 0;
  border-radius: 999px; font: 700 16px Mulish, system-ui, sans-serif; cursor: pointer;
  text-decoration: none; color: #fff; transition: transform .2s cubic-bezier(.25,0,0,1),
  box-shadow .2s cubic-bezier(.25,0,0,1), background-color .2s cubic-bezier(.25,0,0,1);
  background: radial-gradient(100% 100% at bottom right, #265DD7, #0582CA); }
.btn:first-of-type { margin-top: 24px; }
.btn:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(0,0,0,.2); }
.btn:active { transform: translateY(1px); box-shadow: 0 3px 5px rgba(0,0,0,.2); }
.btn.ghost { color: #1F2348; background: rgba(31,35,72,.07); font-weight: 600; }
.btn.ghost:hover { background: rgba(31,35,72,.12); }
/* The reset control carries words: on a page whose other two controls are labelled, an
   unlabelled glyph reads as decoration. It stays quiet by being small and grey, not by
   being wordless, and it lives OUTSIDE the card because it undoes the card. */
.reset { display: inline-flex; align-items: center; gap: 8px; margin-top: 16px;
  padding: 12px 24px; border: 0; border-radius: 999px; cursor: pointer;
  font: 600 13px Mulish, system-ui, sans-serif; color: rgba(255,255,255,.6);
  background: rgba(255,255,255,.08);
  transition: color .2s cubic-bezier(.25,0,0,1), background-color .2s cubic-bezier(.25,0,0,1); }
.reset:hover { color: #fff; background: rgba(255,255,255,.16); }
.reset:focus-visible { outline: 2px solid #0CA6FE; outline-offset: 3px; }
.status { margin-top: 24px; font-size: 13px; color: rgba(31,35,72,.55); }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) {
  .btn, .reset { transition: none; }
  .btn:hover, .btn:active { transform: none; }
}
</style>
</head>
<body>
<main class="stack">
<span class="net" data-g="net">${esc(networkLabel(NETWORK, SIM, lang))}</span>
<div class="card">
  <h1><img class="lockup" src="/assets/brand/nimiq-kids-lockup-light.svg" alt="NIMIQ.kids" /></h1>
  <p data-g="lede">${esc(s.lede)}</p>

  <div id="loading"><p class="status" id="status" data-g="setting">${esc(s.setting)}</p></div>

  <div id="ready" hidden>
    <a class="btn" id="kid" href="/kid/" data-g="openKid">${esc(s.openKid)}</a>
    <a class="btn ghost" id="parent" href="/parent/" data-g="openParent">${esc(s.openParent)}</a>
  </div>

  <div id="failed" hidden>
    <p class="status" id="failmsg" data-g="failed">${esc(s.failed)}</p>
    <button class="btn ghost" onclick="location.reload()" data-g="tryAgain">${esc(s.tryAgain)}</button>
  </div>
</div>
<button class="reset" id="fresh" type="button" hidden>${REDO_ICON}<span data-g="refresh">${esc(s.refresh)}</span></button>
</main>
<script>
// Every language, so a visitor who already chose one in the app gets it here too.
// The server picked the initial paint from Accept-Language, which is right for a
// first-time judge and wrong for someone coming back from a Spanish kid app.
var GATE = ${JSON.stringify(GATE)};
var LANG = ${JSON.stringify(lang)};
var LANG_SERVED = ${JSON.stringify(lang)};
(function () {
  // The shell's own key. A page with no shell still has to agree with one.
  try {
    var stored = localStorage.getItem("nimiq-app-lang");
    if (stored && GATE[stored] && stored !== LANG) {
      LANG = stored;
      document.documentElement.lang = stored;
      document.title = GATE[stored].title;
      var els = document.querySelectorAll("[data-g]");
      for (var i = 0; i < els.length; i++) {
        var k = els[i].getAttribute("data-g");
        // "net" is computed from the network, not a plain lookup, so it matches on
        // WHICH label the server chose rather than re-deriving NETWORK on the client.
        // (No backticks in here: this block lives inside a template literal.)
        if (k === "net") {
          var which = ["netSim", "netTest", "netMain"].filter(function (n) {
            return GATE[LANG_SERVED][n] === els[i].textContent;
          })[0];
          if (which) els[i].textContent = GATE[stored][which];
        } else if (GATE[stored][k]) {
          els[i].textContent = GATE[stored][k];
        }
      }
    }
  } catch (e) { /* storage blocked: the server's choice stands */ }
})();
(function () {
  // The strings this script writes later, in whatever language won above.
  function S() { return GATE[LANG]; }
  var PARENT_KEY = "kidsParentToken";
  var DEVICE_KEY = "kid.deviceToken";
  var FAMILY_KEY = "kids.demoFamilyId";
  var CHILD_KEY = "kid.childId";

  // Forget this browser's household. Two callers — ?fresh=1 and a household the server
  // no longer has — so it is a function rather than a block: the four keys have to go
  // together, and a clear that missed CHILD_KEY would carry the last kid picked onto a
  // family that has never heard of them.
  function forget() {
    localStorage.removeItem(PARENT_KEY);
    localStorage.removeItem(DEVICE_KEY);
    localStorage.removeItem(FAMILY_KEY);
    localStorage.removeItem(CHILD_KEY);
  }

  var fresh = new URLSearchParams(location.search).has("fresh");
  if (fresh) {
    forget();
    history.replaceState(null, "", location.pathname);
  }

  // The reset control only appears once there IS a family to reset; before that it
  // would offer to replace something that does not exist yet.
  function ready() {
    document.getElementById("loading").hidden = true;
    document.getElementById("ready").hidden = false;
    document.getElementById("fresh").hidden = false;
  }

  // Reset is a button now, not a link, so it has to navigate itself. It goes through
  // ?fresh=1 rather than clearing storage inline: the clearing already lives at the
  // top of this script, and one path means one behaviour to keep correct.
  document.getElementById("fresh").addEventListener("click", function () {
    location.href = location.pathname + "?fresh=1";
  });

  function mint() {
    fetch("/api/demo/family", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
      .then(function (res) {
        if (res.status !== 201 || !res.body.parentToken) throw new Error(res.body.error || "demo_failed");
        localStorage.setItem(PARENT_KEY, res.body.parentToken);
        localStorage.setItem(DEVICE_KEY, res.body.deviceToken);
        localStorage.setItem(FAMILY_KEY, res.body.family.id);
        localStorage.removeItem(CHILD_KEY); // fresh family: never inherit the last kid picked
        ready();
      })
      .catch(function (e) {
        document.getElementById("loading").hidden = true;
        document.getElementById("failed").hidden = false;
        document.getElementById("failmsg").textContent =
          String(e.message) === "too_many_requests" ? S().busy : S().failed;
      });
  }

  // Already have one from an earlier visit in this browser? Reuse it — a reload must
  // not silently strand the family the visitor was just using.
  var device = localStorage.getItem(DEVICE_KEY);
  if (!(localStorage.getItem(FAMILY_KEY) && localStorage.getItem(PARENT_KEY) && device)) { mint(); return; }

  // BUT THREE KEYS IN STORAGE ARE NOT A HOUSEHOLD ON THE SERVER, and this page used to
  // treat them as one.
  //
  // (No backticks below: this block lives inside a template literal.)
  //
  // A demo household is swept HATCH_DEMO_TTL_MS after it is minted (four hours on the
  // live instance, and the sweeper runs hourly), which deletes the devices and
  // parent_tokens rows behind both bearers. These four keys never expire. So a visitor
  // coming back after that, which is most of what coming back means here, was handed two
  // buttons into a family that no longer existed: /kid/ booted, /api/children 401'd, and
  // main.js's own demo recovery bounced them straight back to this page via ?fresh=1.
  // It looked like the tap had done nothing, and the demo "only worked the second time".
  //
  // So ask. The probe is /api/children with the stored device bearer, deliberately the
  // SAME call the kid app boots on, because the question is exactly "will that boot
  // succeed" and a second way of asking it could answer differently.
  //
  // One probe covers both buttons: purgeFamily deletes the device row and the parent
  // token in one transaction, so the two tokens are alive or dead together. There is
  // nothing for a second probe of the parent side to find.
  //
  // A network failure is NOT a dead family. Offline, keep what we have and let the
  // visitor through, exactly as before. Only an explicit 401 forgets anything.
  fetch("/api/children", { headers: { Authorization: "Bearer " + device } })
    .then(function (r) {
      if (r.status === 401) { forget(); mint(); return; }
      ready();
    })
    .catch(function () { ready(); });
})();
</script>
</body>
</html>`;
}

demoLanding.get("/demo", (c) => {
  if (!demoSeedEnabled()) return c.notFound();
  // Negotiated per request, so a shared cache would otherwise hand one visitor's
  // language to the next. This page is uncacheable in practice (it mints a family),
  // but the header says so rather than relying on that.
  c.header("Vary", "Accept-Language");
  return c.html(demoPage(pickLang(c.req.header("accept-language"), c.req.query("lang"))));
});
