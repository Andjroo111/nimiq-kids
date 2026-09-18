// nimiq.kids kid app v3 — boot + avatar login. HOME IS THE CHART
// (chart.js): the week's sticker grid + today's tasks. Money lives behind the
// balance chip (money.js), the Treasure Box behind the chest dock button
// (box.js). Kids are REAL account holders: the login cards show each kid's
// identicon from their actual on-chain address.

import { api, saveDeviceToken } from "./api.js";
import {
  state, $, esc, t, setScreen, closeSheet, currentScreen, keyboardInset,
  initIdenticons, identiconImg, paintIdenticons,
} from "./util.js";
import { loadIcons, goldHexIcon, caretIcon } from "./icons.js";
import {
  provisionAddresses, refreshRates, refreshWallet, refreshChart, refreshStore, refreshGoalSets,
  refreshHealth, refreshFamily, refreshCatalog, refreshRoster, refreshPrefs,
} from "./data.js";
import { flushOutbox } from "./outbox.js";
import { showChart, stopChartPoll } from "./chart.js";
import { stopMoneyPoll, showMoney } from "./money.js";
import { showPayout } from "./payout.js";
import { applyKidLang } from "./kid-lang.js";
import { mountBattery, repaintBattery } from "./battery.js";
import { needsClimb, showClimb } from "./onboard.js";
import { onGoalTap } from "./upkeep.js";
import { warmLocalPhotos } from "/js/lib/local-photos.js";

const STORE_KEY = "kid.childId";

// ---------- avatar login (identicons from the kids' REAL addresses) ----------
//
// The SECOND of the two screens that come before the app, and it now matches the
// first (Andjroo, 2026-07-31: the meadow gradient "needs to go ... I wanted to
// match the connect screen"). Same page composition, literally the same classes:
// light body, one centred white small-page, generous air.
//
// The rows are the registry's `account-list` — the component Nimiq ships for
// exactly this question, an identicon-and-label chooser with a caret. It arrived
// as the Hub's AccountSelector, which is the same job word for word: pick which
// of these identities is you. The identicons stay BIG, because the reader is
// four and the picture is the label; the row treatment is the brand's.
//
// Every row now carries a surface at REST (Andjroo, 2026-08-01: "hard to see and
// only highlights once selected"). The component paints nothing until hover, and
// a tablet has no hover, so the fill it reserves for hover is simply what the row
// wears all the time. It is the component's own value, not a chosen grey. See
// connect.css.
export function showLogin() {
  stopChartPoll(); stopMoneyPoll();
  setScreen(`
    <div class="k-connect k-roster">
      <div class="small-page nq-card k-connect-card">
        <div class="page-header nq-card-header">
          <h1 class="nq-h1">${esc(t("app.kidWho"))}</h1>
        </div>
        <div class="page-body nq-card-body">
          <div class="account-list k-roster-list">
            ${state.children.map((c) => `
              <a href="javascript:void(0)" class="account-entry" data-id="${esc(c.id)}">
                <div class="account row">
                  <div class="identicon-and-label">
                    ${identiconImg(state.addresses[c.id] ?? "")}
                    <div class="label">${esc(c.label)}</div>
                  </div>
                </div>
                ${caretIcon()}
              </a>`).join("")}
          </div>
        </div>
      </div>
    </div>`, "k-screen k-connect-screen");
  paintIdenticons();
  document.querySelectorAll(".account-entry").forEach((b) => {
    b.onclick = () => enterChild(state.children.find((c) => c.id === b.dataset.id));
  });
}

/**
 * Tapping a face on the roster (#123).
 *
 * The tap on a kid's face. The secret-picture gate that stood between the roster and the app
 * from #123 to 2026-09-16 is gone; `unlock` still runs so the tablet records who it is.
 */
export async function enterChild(child) {
  if (!child) return showLogin();
  // THE LANGUAGE STARTS HERE, not at selectChild (#432). The switch gate names this kid and
  // asks them for their own pictures, so it is already their screen; applying the language
  // after it would show a kid two sentences in a language their parent did not pick for them
  // before the app changed under them. The roster above is the one screen that cannot be in
  // anybody's language, because it belongs to all of them.
  setKidLang(child);
  // No gate (2026-09-16, the secret pictures are gone): unlock is still called, so the device
  // row records who it is acting as, then straight into the app.
  await api.unlockKid(child.id, {}).catch(() => null);
  return selectChild(child);
}

/** The real dependencies for `applyKidLang`, which is pure so it can be tested with two
 *  siblings on one tablet. localStorage throws in a private-mode WebView, so both accessors
 *  swallow rather than take the boot down over a language. */
const LANG_DEPS = {
  getLanguage: () => window.nimiqKidsShell?.getLanguage?.() ?? "en",
  setLanguage: (id) => window.nimiqKidsShell?.setLanguage?.(id),
  read: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  write: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** Guarded so a shell that has not booted yet cannot take a tap down; called on BOTH the way
 *  into the gate and the way into the app, because either can be a kid's first screen. */
const setKidLang = (child) => {
  if (window.nimiqKidsShell?.setLanguage) applyKidLang(child, LANG_DEPS);
};

export async function selectChild(child, { climbed = false } = {}) {
  if (!child) return showLogin();
  // BEFORE ANYTHING READS THE WALLET (#381). A kid with no hero has never been up the climb,
  // and the climb's second screen is the money face: `refreshWallet()` below is the call that
  // would mint an address for a kid who has none. So the climb comes first, and the rest of
  // login resumes through the callback once the server has the pick (onboard.js).
  //
  // `climbed` is what makes this terminate. The climb also calls back when a screen has NOTHING
  // to ask — the money face on a parent-custody instance, the place with no catalogue — and the
  // row this client holds may still say null. Re-testing it would send the same kid back up the
  // same climb forever. Asked once, answered once.
  if (needsClimb(child) && !climbed) {
    return showClimb(child, () => selectChild(child, { climbed: true }));
  }
  state.child = child;
  localStorage.setItem(STORE_KEY, child.id);
  // BEFORE the first paint of this kid's screens, and before the fetches below whose results
  // are rendered in whatever language is set when they land.
  setKidLang(child);
  // THIS KID'S photos, before anything that can draw a sticker renders. A shared tablet is
  // one origin, so the warm is what keeps a sibling's face out of this kid's chart, and
  // `stickerFace` resolves synchronously off the cache it fills (#282).
  await warmLocalPhotos(child.id);
  // ⚠️ THESE TWO USED TO BE BARE AWAITS. `api.prefs()` and `api.catalog()` reject on a dead
  // network, and neither was caught, so the first thing an offline tablet did after a kid
  // tapped their own face was throw out of selectChild and paint nothing at all. Both go
  // through the snapshot path now, which is also what keeps a kid's chosen scene on the
  // board when the Mini is unreachable.
  await Promise.all([refreshPrefs(), refreshCatalog()]);
  // refreshChart re-applies any unsent taps itself, so the board a kid lands on already
  // carries the answers they gave in the car.
  await Promise.all([refreshWallet(), refreshChart(), refreshStore(), refreshGoalSets()]);
  // THE TOP OF THE CLIMB IS THE GOAL PATH, not the board: the parent's first goal, rung one
  // open, START in its bubble. A kid with no goal yet lands on the board as before. `back`
  // is the board, and the repaint refreshes the ladder the way the board's own tap does.
  if (climbed) {
    const first = (state.chart?.goals ?? []).find((g) => !g.done);
    if (first) {
      return onGoalTap(first.id, () => Promise.all([refreshChart(), refreshGoalSets()]), showChart);
    }
  }
  showChart();
}

// ---------- device pairing (slice 3) ----------
// A public multi-family instance answers the unauthenticated boot with 401
// pairing_required. The tablet asks for the 6-digit code the parent mints in
// their app (Settings -> Pair a device), trades it for a device token, and from
// then on boots straight into ITS OWN household. Legacy single-household
// instances never send the 401, so this screen never appears there.
// The screen was hand-rolled out of inline styles and it showed (Andjroo,
// 2026-07-31: "it doesn't match the rest of the branding"). Everything it got
// wrong is something the brand has a rule and a component for:
//
//   • the code field was `border: 2px solid var(--navy)`. Nimiq NEVER borders an
//     input — the border is `box-shadow: inset` (rule 1).
//   • the action was a `.who-card`: a big white SQUARE. Every Nimiq button is a
//     pill; `nq lint` flags a small square button by name.
//   • the error was `#c0392b`, which is not in the palette (rule 13). Nimiq red
//     is #D94432, and an error message is a `status-alert`, not loose text.
//   • the whole thing sat on `bg-meadow`. That gradient is a SCENE a kid picks
//     for their own app; nobody has picked anything yet here, and it appears
//     nowhere else in the fleet.
//
// Rebuilt on the registry (`nq add`): the page is the brand's own composition —
// light body, one centred white `small-page` — and the code entry is the
// Keyguard's `password-box`, which is literally the component Nimiq ships for
// "type your secret to get in". It is also the screen's ONE calculated break:
// exactly one saturated element per experience, and the light-blue gradient box
// is it. Everything else is white, navy and air.
function showPairing() {
  setScreen(`
    <div class="k-connect">
      <div class="small-page nq-card k-connect-card">
        <div class="page-header nq-card-header">
          ${goldHexIcon("connect-hex-grad", "k-connect-hex")}
          <h1 class="nq-h1">${esc(t("app.pairTitle"))}</h1>
          <p class="k-connect-sub">${esc(t("app.pairSub"))}</p>
        </div>
        <div class="page-body nq-card-body">
          <!-- registry password-box, unmasked: the 6 digits are being READ ALOUD
               to the kid, so there is nothing to hide and no eye toggle. The wide
               letter-spacing is kept (upstream drops it for type=text) because a
               6-digit code is exactly what that spacing is for. -->
          <form class="password-box actionbox nq-light-blue-bg k-connect-box" id="pair-form">
            <div class="prompt nq-text-s">${esc(t("app.pairPrompt"))}</div>
            <div class="password-input">
              <div class="input-container">
                <div class="input-wrapper">
                  <input class="nq-input password" id="pair-code" type="text" inputmode="numeric"
                    autocomplete="one-time-code" maxlength="6" placeholder="••••••"
                    aria-label="${esc(t("app.pairPrompt"))}" />
                </div>
              </div>
            </div>
            <button class="submit nq-button light-blue inverse" type="submit" id="pair-go">${esc(t("app.pairGo"))}</button>
          </form>
          <!-- status-alert 'caution', the brand's error treatment. Its upstream
               TITLE ("Caution") is a docs-callout label; these readers are 4-8 and
               half of them cannot read it anyway, so the title carries the kid
               voice while the component keeps its own colour and shape. -->
          <div class="nq-status-alert caution k-connect-err" id="pair-err" hidden>
            <p class="alert-title">${esc(t("app.pairBadTitle"))}</p>
            <p>${esc(t("app.pairBad"))}</p>
          </div>
        </div>
      </div>
    </div>`, "k-screen k-connect-screen");

  const form = $("pair-form"), input = $("pair-code"), err = $("pair-err");
  // The box's own eligibility gate, at SIX rather than the password default of
  // eight: the submit only appears once a whole code is in.
  const gate = () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 6); // digits only, always
    form.classList.toggle("input-eligible", input.value.length === 6);
  };
  // The sixth digit submits. On iOS the button was under the keyboard with no way to
  // scroll to it (#14), but the deeper point is that a 6-digit code should never need a
  // button: `autocomplete="one-time-code"` lets iOS fill all six at once, and every other
  // code entry on the platform submits itself. The button stays for the paste-and-edit
  // path and for anyone who reaches it. `requestSubmit` rather than `submit` so the
  // handler below still runs.
  input.addEventListener("input", () => {
    err.hidden = true;
    gate();
    if (input.value.length === 6 && !form.classList.contains("loading")) form.requestSubmit();
  });
  gate();

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (input.value.length !== 6) return;
    form.classList.add("loading"); // the box's own hexagon spinner state
    const r = await api.pairDevice(input.value, "Kid tablet").catch(() => ({}));
    if (r.token) { saveDeviceToken(r.token); location.reload(); return; }
    form.classList.remove("loading");
    err.hidden = false;
    input.value = ""; gate(); input.focus();
  };
  input.focus();
  trackKeyboard();
}

// Shrink the connect screen to the space the keyboard leaves, so its own centring and
// scrolling work against the height the visitor can actually see. `.k-connect-screen`
// reads `--k-kbd` as its `bottom` (connect.css); everything else about the composition
// is untouched. See `keyboardInset` in util.js for why dvh cannot do this.
//
// Registered once and left registered: the listener costs nothing while no keyboard is
// open (inset 0), and re-registering per repaint would stack duplicates every time the
// language changes.
let keyboardTracked = false;
function trackKeyboard() {
  const vp = window.visualViewport;
  if (!vp) return; // no visual viewport: the layout stays exactly as it was
  const apply = () => {
    const px = keyboardInset({ innerHeight: window.innerHeight, viewport: vp });
    document.documentElement.style.setProperty("--k-kbd", `${px}px`);
  };
  apply();
  if (keyboardTracked) return;
  keyboardTracked = true;
  vp.addEventListener("resize", apply);
  vp.addEventListener("scroll", apply);
}

// Repaint the current screen's strings when the shell i18n arrives/changes.
// Which screen that is comes from util's `currentScreen`, which owns the ordering
// and the reason for it (#13); this map is deliberately flat, so no call site can
// get the order wrong again.
const REPAINT = { chart: showChart, money: showMoney, roster: showLogin, pairing: showPairing };
function onLangReady() {
  repaintBattery(); // the corner's label is translated
  REPAINT[currentScreen((cls) => !!document.querySelector(`.${cls}`))]?.();
}
// Currency rides the same repaint path: every fiat figure on these screens is
// formatted at render time, so switching the ticker is a re-render, not a patch.
function wireShell() {
  window.nimiqKidsShell.onLang(onLangReady);
  window.nimiqKidsShell.onCurrency?.(onLangReady);
}
if (window.nimiqKidsShell) wireShell();
else window.addEventListener("nimiq-shell-ready", () => { onLangReady(); wireShell(); }, { once: true });

// ---------- boot ----------
(async function boot() {
  // The battery corner first: it is about the tablet, not the kid, so it needs no
  // pairing, no token and no roster, and it should be there on the very first paint.
  mountBattery();
  // Anything this device is still holding onto goes out the moment the app opens, before the
  // reads below — so a tap made in the car is with the parent by the time the board repaints.
  void flushOutbox();
  await refreshHealth();
  await refreshFamily();
  const probe = await refreshRoster();
  if (probe.status === 401) {
    // 401 means one thing: this browser holds no device token this instance accepts.
    // What to DO about that depends on which instance it is.
    //
    // On a family or competition instance it is an unpaired tablet, and the pairing
    // screen is right: a parent mints a 6-digit code in their app and types it in here.
    //
    // On the seeded DEMO instance there is no parent app and no code to mint, so that
    // screen was a dead end for anyone who reached /kid/ without going through the
    // entrance — a shared link, a bookmark, a reload after the 24h family expired
    // (#12). Send them to the entrance instead, which mints a household and hands this
    // browser its tokens.
    //
    // `?fresh=1` rather than plain `/demo` so this cannot become a loop: it is the
    // landing page's own reset path, which CLEARS the four demo keys and mints
    // unconditionally, where plain `/demo` reuses whatever is in storage. Nothing is
    // lost by clearing — a 401 is exactly the proof that what is stored does not work.
    // `replace`, not `href`, so Back does not return here and bounce again.
    if (state.demo) { location.replace("/demo?fresh=1"); return; }
    showPairing(); return;
  }
  state.children = probe.children;

  // Icons + identicons + rates + per-kid address provisioning, all in parallel.
  await Promise.all([loadIcons(), initIdenticons(), refreshRates(), provisionAddresses()]);

  // Kiosk seam: a parallel branch ships /kid/js/bridge.js; feature-detect + no-op fallback.
  try {
    const bridge = await import("/kid/js/bridge.js");
    state.kiosk = bridge;
    bridge.initKioskBridge?.({ state });
    // #377: the lock screen owns its own watcher, because a lock lands at a wall-clock
    // moment and can land on ANY screen. No-ops in a plain browser, where there is no
    // wrapper to report a lock at all.
    const locked = await import("/kid/js/locked.js");
    locked.startLockWatch(() => showChart());
  } catch { /* no kiosk bridge yet */ }

  $("kid-scrim").addEventListener("click", (e) => { if (e.target === $("kid-scrim")) closeSheet(); });

  const forced = new URLSearchParams(location.search).get("child"); // kiosk wrapper override
  const remembered = localStorage.getItem(STORE_KEY);
  const pick = state.children.find((c) => c.id === (forced || remembered));

  if (pick) await selectChild(pick);
  else showLogin();

  // #payout=<cashlinkId>: parent hands the tablet over straight into the ceremony.
  if (location.hash.startsWith("#payout=")) showPayout(location.hash.slice(8));
})();
