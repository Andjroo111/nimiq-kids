// nimiq.kids kid app — shared state + tiny helpers. Vanilla ES module, no framework.

import { closeIcon } from "./icons.js";
import { esc } from "../../js/lib/esc.js";
import { meanLuma, isDarkLuma } from "./luma.js";

export const LUNA = 100_000;
export const fmtNim = (luna) => {
  const n = luna / LUNA;
  return Number.isInteger(n) ? n.toString() : n.toFixed(2).replace(/\.?0+$/, "");
};

/** Wallet-style NIM amount: thin-space (U+202F) digit grouping when the integer
 *  part has more than 4 digits, up to 5 decimals, trailing zeros trimmed. */
export function fmtNimLuna(luna, maxDecimals = 5) {
  const neg = luna < 0 ? "-" : "";
  const abs = Math.abs(Math.round(luna));
  let int = String(Math.floor(abs / LUNA));
  let dec = String(abs % LUNA).padStart(5, "0").slice(0, maxDecimals).replace(/0+$/, "");
  if (int.length > 4) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return neg + int + (dec ? `.${dec}` : "");
}

/** A reward, as a WHOLE number of coins. Rewards are agreed in dollars and paid
 *  in NIM, so a kid should read "4 317 NIM" — never "0.1 NIM", and never a
 *  fraction of a coin (Andjroo, 2026-07-30). Grouping matches the wallet.
 *
 *  With ONE exception, which is the whole of the rule's point: an amount that
 *  would round to zero is shown as the fraction it really is. Rounding a real
 *  0.25 NIM job to "+0 NIM" tells a kid the work is worth nothing, which is the
 *  opposite of what whole coins were for. `fmtFiat` below already refuses the
 *  same lie in the other currency, for the same stated reason.
 *
 *  Every reward of half a coin or more is unaffected and still reads whole, so
 *  a dollar-priced chore is never printed as 4 317.28 NIM. Sub-coin rewards get
 *  the wallet's own 5 decimals, which is also where Nimiq's sub-cent-fee story
 *  actually lives: 0.25 NIM is only worth paying out because the fee is smaller
 *  still. Three separate places had already worked around this by editing the
 *  DATA (demo-family.ts twice, onboard.ts's sample board); the formatter was
 *  the thing that was wrong. */
export const fmtNimWhole = (luna) =>
  luna !== 0 && Math.abs(luna) < LUNA / 2
    ? fmtNimLuna(luna, 5)
    : fmtNimLuna(Math.round(luna / LUNA) * LUNA, 0);

// ---------- reference currency ----------
//
// Which currency a kid reads amounts in comes from the corner control's "Show
// amounts in" grid, the same one every other app in the fleet has. The shell
// owns the choice, the rate for it, and the formatting: symbol, symbol side and
// decimal separator all move with the currency AND the language, so a local
// dollar formatter would be wrong in 13 of the 14 (and in en vs de for the 14th).

/** Price of 1 NIM in the chosen currency, falling back to the served USD rate
 *  before the shell's rate table lands. */
export function nimPrice() {
  return window.nimiqKidsShell?.getRate?.() || state.rates?.nimUsd || 0;
}

/** Format a fiat VALUE (not luna) in the chosen currency. */
const fiat = (value) => window.nimiqKidsShell?.fmtFiat?.(value) ?? `$${value.toFixed(2)}`;

/** Fiat for a luna amount at the current rate. Amounts too small to render as
 *  money show as a floor rather than a rounded-away zero, like the real wallet:
 *  a kid told a real payout is worth nothing has been told something false. */
export function fmtFiat(luna, rate = nimPrice()) {
  // ⚠️ NO RATE MEANS NO PRICE, NOT A PRICE OF ZERO. `/api/rates` is a live read and a tablet
  // with no network has never made it, so a rate of 0 used to print "$0.00" beside a real
  // 109 834 NIM. That is the same lie the wallet fallback told (see showMoney), one line
  // down: the balance was right and the dollars said the kid had nothing. `fmtNimPrice`
  // below already returned "" for exactly this reason; this is the same rule for a balance.
  if (!rate) return "";
  const value = Math.abs(luna) / LUNA * rate;
  if (value > 0 && value < 0.01) return `< ${fiat(0.01)}`;
  return fiat(value);
}

/** What one coin is worth right now. NIM trades well under a cent, so this goes
 *  through the shell's fiat formatter, which widens the decimals until the
 *  rounded figure is within 10% of the true one (the wallet's FiatAmount rule)
 *  instead of collapsing every price to a two-decimal zero. */
export function fmtNimPrice(rate = nimPrice()) {
  if (!rate) return "";
  return fiat(rate);
}

/** Normalize an NQ address into its 9 four-char chunks (accepts spaced or bare). */
export function chunkAddress(address) {
  const bare = String(address ?? "").replace(/\s+/g, "").toUpperCase();
  return bare.match(/.{1,4}/g) ?? [];
}
export const spacedAddress = (address) => chunkAddress(address).join(" ");

// One mutable state bag for the whole kid app (single tablet, single kid at a time).
export const state = {
  children: [], child: null, family: null,
  prefs: null, catalog: null, sim: true,
  demo: false,               // GET /health `demo`: this instance hands out seeded demo
                             // households, so an unpaired boot has an entrance to go to
                             // rather than a pairing code to ask for (#12)
  explorerTx: "",            // GET /health `explorerTx`: the block explorer's per-network
                             // prefix, so a paid row can show where the money really went.
                             // Empty in SIM, where the hashes are made up.
  timerStyles: ["egg"],      // equippable timer styles (free egg + Treasure Box buys)
  backgrounds: [],           // app wallpapers EARNED by finishing a sticker theme, {id,url}.
                             // Its own slot beside timerStyles rather than a field on prefs:
                             // `state.prefs` is the prefs ROW, and these are not stored on it.
  skewMs: 0,                 // serverTime - Date.now(), refreshed on every /today
  chart: null,               // GET /kids/:id/chart payload (V3: THE home screen truth)
  store: null,               // GET /kids/:id/store payload (Treasure Box shelves)
  purchases: [],             // GET /kids/:id/purchases: what this kid has already bought,
                             // which is the Treasure Box's receipt and used to be nowhere (#121)
  wallet: null,              // GET /kids/:id/wallet payload (balance chip + money screen)
  staking: null,             // GET /kids/:id/staking payload (Grow screen)
  rates: { nimUsd: 0 },      // GET /api/rates
  addresses: {},             // childId -> NQ address (provisioned at boot for identicons)
  kiosk: null,               // /kid/js/bridge.js module when the kiosk branch has landed
  kioskLock: null,           // wrapper's native lock state {mode,until,allowedApps} | null (browser)
  // ---------- offline (see kid/js/snapshot.js) ----------
  // `offline` is set by the last network ATTEMPT, never by navigator.onLine: the tablet in the
  // car is on no network at all, but a tablet on a Wi-Fi with no route to the Mini reports
  // onLine === true, and both are the same thing to a kid. A thrown fetch is the only
  // honest signal, so it is the only one read.
  offline: false,
  syncedAt: {},              // snapshot name -> ms, for "last checked" on the board and money
};

// ---------- identicons (@nimiq/iqons, vendored — offline tablet) ----------
export const IDENTICON_PLACEHOLDER = `data:image/svg+xml,<svg width="64" height="64" viewBox="0 -4 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity=".1" d="M62.3 25.4L49.2 2.6A5.3 5.3 0 0 0 44.6 0H18.4c-1.9 0-3.6 1-4.6 2.6L.7 25.4c-1 1.6-1 3.6 0 5.2l13.1 22.8c1 1.6 2.7 2.6 4.6 2.6h26.2c1.9 0 3.6-1 4.6-2.6l13-22.8c1-1.6 1-3.6.1-5.2z" fill="url(%23identicon_radial)"/><defs><radialGradient id="identicon_radial" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="matrix(-63.0033 0 0 -56 63 56)"><stop stop-color="%23260133"/><stop offset="1" stop-color="%231F2348"/></radialGradient></defs></svg>`;

let Iqons = null;
const iqonCache = new Map();

/** Load the vendored iqons lib + sprite and WARM the part catalog (the first svg()
 *  call lazy-loads it; a cold burst returns empty strings — see nimiq-ui skill). */
export async function initIdenticons() {
  try {
    Iqons = (await import("/vendor/nq/iqons.min.js")).default;
    Iqons.svgPath = "/vendor/nq/nimiq/assets/img/iqons.min.svg";
    await Iqons.svg("NQ07 0000 0000 0000 0000 0000 0000 0000 0000");
  } catch { Iqons = null; /* placeholder hexagons render instead */ }
}

async function iqonUrl(address) {
  if (!Iqons || !address) return IDENTICON_PLACEHOLDER;
  const key = spacedAddress(address);
  if (!iqonCache.has(key)) {
    try {
      const url = await Iqons.toDataUrl(key);
      iqonCache.set(key, url && url.length > 60 ? url : IDENTICON_PLACEHOLDER);
    } catch { iqonCache.set(key, IDENTICON_PLACEHOLDER); }
  }
  return iqonCache.get(key);
}

/** Identicon markup (hexagon placeholder now, real iqon after paintIdenticons). */
export function identiconImg(address, cls = "") {
  return `<div class="identicon ${cls}" data-iqon="${esc(spacedAddress(address ?? ""))}">` +
    `<img src='${IDENTICON_PLACEHOLDER}' alt="" /></div>`;
}

/** Swap every [data-iqon] placeholder in root (default: whole doc) for the real iqon. */
export async function paintIdenticons(root = document) {
  for (const el of root.querySelectorAll(".identicon[data-iqon]")) {
    const img = el.querySelector("img");
    if (img && el.dataset.iqon) img.src = await iqonUrl(el.dataset.iqon);
  }
}

// ---------- kid-readable dates for the wallet feed ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function feedDate(ms) {
  const d = new Date(ms);
  return {
    day: String(d.getDate()).padStart(2, "0"),
    month: MONTHS[d.getMonth()],
    monthLabel: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
  };
}

export const $ = (id) => document.getElementById(id);
// One definition for both apps, re-exported so the ~30 call sites here are unchanged.
// See /js/lib/esc.js: `'` is in the set because single-quoted attributes are legal HTML.
export { esc };

// ---------- i18n (shell bridge + English fallback while the shell bundle boots) ----------
const FALLBACK = {
  "app.kidWho": "Who are you?",
  "app.charTitle": "Which one is you, {name}?",
  "app.charSub": "Pick the one you like. It is yours to keep.",
  "app.charShuffle": "Show me different ones",
  "app.charNoMore": "That is all of them. Pick your favourite.",
  "app.charTryAgain": "Someone was quicker. Here are some more.",
  "app.charPickOne": "Character {n}",
  "app.pairTitle": "Connect your tablet",
  "app.pairSub": "Ask a grown-up to open the parent app, go to Settings, tap Pair a device, and read you the 6 digits.",
  "app.pairGo": "Connect",
  "app.pairBad": "That code didn't work. Ask for a fresh one and try again.",
  "app.kidStart": "Start!",
  "app.kidImDone": "I'm done!",
  "app.pairPrompt": "Type the 6 digits",
  "app.pairBadTitle": "Try again",
  "app.kidIsItDone": "Is it done?",
  "app.kidYesDone": "Yes, it's done",
  "app.kidNotYet": "Not yet",
  "app.kidUseTimer": "Use the timer",
  "app.kidAllDoneTitle": "You did it!",
  "app.kidWaiting": "Waiting for {name}",
  "app.kidShowWork": "Show your work",
  "app.kidParentHere": "{name} is here",
  "app.kidPinPrompt": "Type the secret code",
  "app.kidPinWrong": "Oops, try again!",
  "app.kidPinLocked": "Locked for now. Ask {name} later!",
  "app.kidPayday": "Payday!",
  "app.kidClaimNow": "Claim!",
  "app.kidMoreSoon": "More coming soon!",
  "app.kidPhotoSent": "Sent! Great job!",
  "app.kidGamesOpen": "Your games are open!",
  "app.kidGamesOver": "Game time is over!",
  "app.sendToFriend": "Send to a friend",
  "app.allDone": "All done, nice work!",
  "app.errGeneric": "Something went wrong, try again",
  // v2 kid wallet
  "app.kidEarn": "Earn",
  "app.kidSend": "Send",
  "app.kidReceive": "Receive",
  "app.kidGrow": "Grow",
  // The dock's four words. They paint on the FIRST frame of the chart screen,
  // so without a fallback the bar reads "app.kidDockBox" until the shell bundle
  // lands -- which is exactly the window a cold tablet spends here.
  "app.kidDockBox": "Treasure",
  "app.kidDockWeek": "Calendar",
  "app.kidDockTimer": "Timer",
  "app.kidDockMoney": "Money",
  // The home money card renders with the first paint of the chart, which is
  // before the shell bundle lands on a cold tablet — without this it flashes
  // the raw key.
  "app.kidMoney": "My money",
  // The me-sheet opens off the first screen a kid sees, so it can be reached
  // before the shell bundle has landed.
  "app.kidSwitchKid": "Switch kid",
  "app.kidBackground": "Background",
  "app.kidFeedEmpty": "No money moves yet. Go earn some NIM!",
  "app.kidGrowing": "{amount} NIM is growing",
  "app.kidComingBack": "{amount} NIM is coming back",
  "app.kidEarnedLine": "{amount} NIM earned by growing",
  "app.kidSendMoney": "Send money",
  "app.kidEnterAddress": "Enter address",
  "app.kidBadAddress": "That address does not look right",
  "app.kidShowQr": "Show the QR code",
  "app.kidCopyAddress": "Copy my address",
  "app.kidCopied": "Copied",
  "app.kidNimAddress": "NIM Address",
  "app.kidScanToSend": "Scan this code to send NIM to {name}",
  "app.kidShareWithFriend": "Share your address with a friend",
  "app.kidHowMuch": "How much?",
  "app.kidYouHave": "You have {amount} NIM",
  "app.kidSendIt": "Send it",
  "app.kidSent": "Sent!",
  "app.kidNeedsOk": "A grown-up needs to say OK first",
  "app.kidNotEnough": "Not enough NIM yet",
  "app.kidGrowMore": "Grow more",
  "app.kidTakeBack": "Take some back",
  "app.kidGrowHint": "Keep {amount} NIM growing for a year and it becomes about {future} NIM",
  "app.kidGrowEmpty": "Put some NIM here and watch it grow",
  "app.kidStakedLine": "{amount} NIM growing",
  "app.kidJobs": "Jobs",
  "app.kidLearning": "Learning",
  "app.kidNimToday": "{amount} NIM today!",
  "app.kidOff": "Off",
  "app.kidMusic": "Music",
  "app.kidTick": "Timer sound",
  "app.kidDing": "Alarm",
  // The lock screen (#377). In this table rather than left to the shell because it is the
  // one screen that can paint BEFORE the shell bundle is warm and still has to make sense:
  // a kid staring at "app.kidLockedNightTitle" over a tablet that will not turn on has been
  // told nothing at all. `src/kid-locked-screen.test.ts` holds this list to en's.
  "app.kidLockedNightTitle": "The tablet is asleep",
  "app.kidLockedSpentTitle": "Screen time is all used up",
  "app.kidLockedRestTitle": "Time for a rest",
  "app.kidLockedParentTitle": "A grown-up locked this",
  "app.kidLockedBackAt": "Back at {time}",
  "app.kidLockedSeconds": "{s} seconds",
  "app.kidLockedMinutes": "{m} minutes",
  "app.kidLockedHours": "{h} hours",
  "app.kidLockedHoursMins": "{h} hours {m} minutes",
  "app.kidLockedJobs": "Do my jobs",
  "app.kidBattery": "Battery {pct}%",
  "app.kidBatteryCharging": "Battery {pct}%, charging",
  "app.kidTimeLeft": "{m} min left",
};
export const t = (key, params) => {
  if (window.nimiqKidsShell) return window.nimiqKidsShell.t(key, params);
  return (FALLBACK[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => String(params?.[k] ?? m));
};
/**
 * A row's title, in the reader's language when we are the ones who named it.
 *
 * Every title on a board is a database row. The ones WE seeded now carry a
 * `title_key` (src/title-catalog.ts) and translate; the ones a parent typed
 * carry none and are printed exactly as typed, in every language, because
 * "Feed Winston his 5pm scoop" is not ours to reword.
 *
 * That is the whole rule, and it is the one `box.js` already used for Treasure
 * Box shelves before this existed. Use it for ANY title that came off the wire:
 * a raw `row.title` in a template is the bug this replaces.
 *
 * Accepts either casing because the two APIs disagree: the kid board serializes
 * camelCase views (`/api/stickers/today`) while the parent reads rows closer to
 * the table (`title_key`). Normalising here is cheaper than a migration of every
 * response shape, and a caller cannot get it wrong.
 */
export const rowTitle = (row) => {
  const key = row?.titleKey ?? row?.title_key ?? null;
  const stored = row?.title ?? "";
  if (!key) return stored;
  // `t()` returns the KEY when nothing matches, and a card reading
  // "cat.job.dust" is worse than the English the row already carries. So a key
  // that did not resolve falls back to the stored title, which is exactly what
  // that column is for. This is not hypothetical: it is what every device sees
  // in the gap between a server deploy and a client cache refresh, and what an
  // older cached bundle sees forever.
  const out = t(key);
  return out === key ? stored : out;
};

/** The parent's short label ("Dad"/"Mom"), used in waiting/PIN copy. */
export const parentName = () => state.family?.parent_label || "Dad";

// ---------- screen + toast ----------
/** Paint a screen.
 *
 *  Two things here are load-bearing and were both wrong:
 *
 *  1. Scroll. A poll repainting the SAME screen must not yank the kid back to
 *     the top. Only a real screen change resets scrollTop; a same-screen
 *     repaint keeps the position (a 10s timer used to snatch it mid-tap).
 *  2. The entry animation. kid.css declared `animation: screen-in` on .screen,
 *     but this node is never reinserted -- only its className and innerHTML
 *     change -- so the animation never re-ran and every navigation in the app
 *     was an instant swap. Re-triggering needs the class removed, layout
 *     flushed, then re-added.
 *  3. The scene. `bgFor()` returns TWO halves and they must land on the SAME
 *     element, so this function takes the whole object and applies both here.
 *     They used to be split -- the class arrived in `cls` (so it landed on
 *     #kid-app) while the caller wrote the image inline on its own root div --
 *     and the two halves then sized against different boxes. #kid-app is the
 *     only node that is always exactly the viewport (844px tall, overflow-y
 *     auto); a screen's own root grows with its CONTENT. So `.bg-image`'s
 *     `background-size: cover` was being applied to an element with no image,
 *     while the element WITH the image got `auto` and painted the art at its
 *     natural 896x1200 anchored top-left. The Treasure Box was the worst case:
 *     its root is 1192px tall, so the scene was sized against 1192 rather than
 *     844 and stretched half again as tall as it should be. Keep them together. */
export function setScreen(html, cls = "", bg = null) {
  const root = $("kid-app");
  const next = `screen ${cls}${bg ? ` ${bg.cls}` : ""}`.trim();
  const changed = root.className.replace(/\s*is-entering\s*/g, " ").trim() !== next;
  root.className = next;
  // Always assigned, never conditional: a gradient scene (image "") has to CLEAR
  // whatever art the previous screen left behind, or the old photo shows through.
  root.style.backgroundImage = bg?.image ?? "";
  root.innerHTML = html;
  if (changed) {
    root.scrollTop = 0;
    root.classList.remove("is-entering");
    void root.offsetWidth; // flush, or the re-added class is coalesced away
    root.classList.add("is-entering");
  }
}
/** Which screen is painted right now, named from the classes it carries — the read
 *  side of `setScreen`, and what a language or currency change consults to decide
 *  what to repaint.
 *
 *  THE ORDER IS THE CONTRACT, and it is the whole reason this is a function rather
 *  than a chain of `if`s at the call site. The roster reuses the pairing screen's
 *  page composition and therefore carries `k-connect` TOO (`showLogin` renders
 *  `class="k-connect k-roster"`). Testing the general class first matched the
 *  roster and repainted it as the pairing screen, so a visitor who changed the
 *  language on the kid app's FIRST screen was stranded on a 6-digit code they had
 *  no way to obtain, and the `k-roster` branch below it was unreachable (#13).
 *
 *  Specific before general: a screen that borrows another's composition is listed
 *  ABOVE the one it borrows from. Nothing at the borrowing call site hints at this,
 *  which is exactly why the decision lives in one named place with a test on it.
 *
 *  @param {(cls: string) => boolean} has class predicate — the DOM stays at the call
 *    site so the ordering can be exercised without one.
 *  @returns {"chart"|"money"|"roster"|"pairing"|null} */
export function currentScreen(has) {
  if (has("k-chart")) return "chart";
  if (has("k-money")) return "money";
  if (has("k-roster")) return "roster"; // borrows k-connect — must precede it
  if (has("k-connect")) return "pairing";
  return null;
}

/** How many pixels at the BOTTOM of the layout viewport are covered by something the
 *  layout does not know about — in practice the iOS software keyboard.
 *
 *  iOS Safari does not resize the layout viewport when the keyboard opens, so a
 *  `position: fixed; inset: 0` screen keeps its full height and the keyboard simply
 *  covers the bottom of it. Nothing inside can scroll away from that, because as far as
 *  the layout is concerned nothing is hidden: on the pairing screen the Connect button
 *  sat 23px under the keyboard with `scrollHeight === clientHeight`, so it read as a
 *  screen with no submit button at all (#14).
 *
 *  `dvh` does NOT solve this. It tracks the URL bar, not the keyboard. The visual
 *  viewport is the only thing that knows, hence the arithmetic here.
 *
 *  `offsetTop` matters: iOS scrolls the visual viewport up to keep the focused field in
 *  sight, and that shift comes out of the same budget. Ignoring it under-reports the
 *  cover by exactly the amount the page was pushed.
 *
 *  @param {{innerHeight: number, viewport?: {height: number, offsetTop?: number} | null}} w
 *    the window and its visualViewport; the shape is taken as an argument so the
 *    arithmetic can be tested without a browser that has a soft keyboard.
 *  @returns {number} pixels covered, never negative. 0 when there is no visual viewport
 *    to ask (older browsers, headless), which leaves the layout exactly as it was. */
export function keyboardInset(w) {
  const vp = w?.viewport;
  if (!vp || !Number.isFinite(vp.height) || !Number.isFinite(w.innerHeight)) return 0;
  const covered = w.innerHeight - vp.height - (Number(vp.offsetTop) || 0);
  return covered > 0 ? Math.round(covered) : 0;
}

/**
 * The one toast. `opts` is optional and every existing caller passes none.
 *
 * @param opts.ms   how long it stays up (default 2.4s). A line worth READING needs longer:
 *   the approval notice (approved.js) is four beats and lands in front of a six-year-old.
 * @param opts.onTap makes it a control rather than a message, which is the only way a toast
 *   can say "tap for your sticker" and mean it. `.kid-toast` is `pointer-events: none` so
 *   ordinary toasts never eat a tap meant for the screen behind them; the modifier class is
 *   what lifts that, and BOTH it and the handler are cleared on the way out — a stale
 *   `onclick` under a hidden toast is a tap that opens a sheet from nowhere.
 */
export function toast(msg, opts) {
  const el = $("kid-toast");
  const hide = () => {
    el.classList.remove("show", "is-tappable");
    el.onclick = null;
  };
  el.textContent = msg;
  el.classList.add("show");
  el.classList.toggle("is-tappable", !!opts?.onTap);
  el.onclick = opts?.onTap ? () => { hide(); opts.onTap(); } : null;
  clearTimeout(el._t); el._t = setTimeout(hide, opts?.ms ?? 2400);
}

/** Sheet header, per the Little Timer reference: close on the LEFT, the sheet's
 *  name centred, and a quiet line under it saying what the sheet is for.
 *
 *  This lives HERE, not next to the sheet that first needed it, because four other
 *  sheets (buy, pack-open, sticker picker, placement) emitted a bare .sheet-close
 *  with no .sheet-hd wrapper -- which positions it against .kid-sheet instead,
 *  landing it at x=0, y=673: dead centre of the sheet's left edge. */
export const sheetHead = (titleKey, subKey) => `
  <div class="sheet-hd">
    <button class="sheet-close" id="sheet-x">${closeIcon()}</button>
    ${titleKey ? `<h2 class="sheet-name">${esc(t(titleKey))}</h2>` : ""}
  </div>
  ${subKey ? `<p class="sheet-sub">${esc(t(subKey))}</p>` : ""}`;

/** Same, for a sheet whose title is data rather than a locale key. */
export const sheetHeadText = (title, sub) => `
  <div class="sheet-hd">
    <button class="sheet-close" id="sheet-x">${closeIcon()}</button>
    ${title ? `<h2 class="sheet-name">${esc(title)}</h2>` : ""}
  </div>
  ${sub ? `<p class="sheet-sub">${esc(sub)}</p>` : ""}`;

export const wireClose = () => { $("sheet-x").onclick = closeSheet; };

// ---------- bottom sheet ----------
let sheetClearTimer = 0;
export function openSheet(html) {
  clearTimeout(sheetClearTimer);
  $("kid-sheet").innerHTML = html;
  $("kid-scrim").classList.add("show");
}
export function closeSheet() {
  $("kid-scrim").classList.remove("show");
  stopPreview();
  // The scrim hides via opacity/pointer-events, so stale sheet DOM would stay in
  // the a11y tree (focusable buttons behind an invisible layer) — empty it once
  // the 250ms close transition lands, unless a new sheet opened meanwhile.
  clearTimeout(sheetClearTimer);
  sheetClearTimer = setTimeout(() => {
    if (!$("kid-scrim").classList.contains("show")) $("kid-sheet").innerHTML = "";
  }, 300);
}

// ---------- kid-readable time ----------
export const fmtClock = (remainingS) => {
  const total = Math.max(0, Math.ceil(remainingS));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// ---------- background scenes ----------
const BUILTIN_BGS = ["meadow", "ocean", "space", "city"];
/** Scenes whose ARTWORK is dark. They need the opposite treatment from the rest:
 *  a wash tinted with their own navy (a white one greys them out) and light text
 *  for anything not sitting on a card. Keyed by scene id so it holds whether the
 *  scene renders as catalog art or as the built-in gradient — `bg-space` alone
 *  does not, since catalog art returns `bg-image` instead.
 *
 *  This static list is only the FALLBACK now: any scene that renders as art is
 *  measured (see measureScene below) and the measurement wins. The list's job
 *  is the first paint before the measurement lands, and the built-in CSS
 *  gradients, which have no pixels to measure. */
const DARK_BGS = ["space"];

/* Measured scene lightness. Earned wallpapers and catalog art were never in
   DARK_BGS, so a dark earned scene got light-scene chrome and vice versa — and
   the bare labels ("Today", "Your games", the minutes left) could land
   light-on-light. Each art scene is measured ONCE (16x16 downscale, mean
   Rec. 709 luminance), cached in localStorage so every later paint is
   synchronous, and `bg-dark` is applied from the cache in bgFor. The first
   ever paint of an uncached scene starts the measurement and flips the class
   in place when it lands — no repaint, just the classList. */
const LUMA_KEY = "kid.sceneLuma";
let lumaCache = null;
function lumaStore() {
  if (!lumaCache) {
    try { lumaCache = JSON.parse(localStorage.getItem(LUMA_KEY) ?? "0") || {}; }
    catch { lumaCache = {}; }
  }
  return lumaCache;
}
const lumaPending = new Set();
function measureScene(id, url) {
  if (lumaPending.has(id)) return;
  lumaPending.add(id);
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, 16, 16);
      const mean = meanLuma(g.getImageData(0, 0, 16, 16).data);
      lumaStore()[id] = mean;
      try { localStorage.setItem(LUMA_KEY, JSON.stringify(lumaStore())); } catch { /* private mode */ }
      // Land it on whatever is painted RIGHT NOW, but only if that is still this
      // scene — checked against the painted image itself, not against prefs,
      // because the timer screen can be up wearing a different scene.
      const root = document.getElementById("kid-app");
      if (root && root.style.backgroundImage.includes(url)) {
        root.classList.toggle("bg-dark", isDarkLuma(mean));
      }
    } catch { /* canvas refused (tainted/blocked): the static answer stands */ }
  };
  img.src = url;
}
/** Resolve the kid's chosen background. Catalog art supersedes the built-in CSS
 *  gradient of the same id (the gradients are the pre-art fallback).
 *
 *  `scope` is "app" everywhere except the running-timer screen, which has its
 *  OWN scene so a kid can keep a calm timer on a loud app or the reverse. The
 *  timer's pref is nullable and falling back to the app's is deliberate: it is
 *  what every kid had before the two were split, so nobody's timer changes
 *  appearance until they deliberately pick a different one. Read the fallback
 *  as "same as my app", not as "unset".
 *
 *  `image` is a ready `background-image` VALUE, not a declaration, because the scene
 *  is painted by `setScreen` on #kid-app and never by the caller on its own root.
 *  The note on setScreen says why that distinction is load-bearing. */
export function bgFor(scope = "app") {
  const id = (scope === "timer"
    ? (state.prefs?.timer_background_id || state.prefs?.background_id)
    : state.prefs?.background_id) || "";
  // Earned wallpapers (prefs.backgrounds, unlocked by finishing a sticker theme) resolve the
  // same way the bundled ones do, and are looked at FIRST: a kid who has earned a scene has
  // chosen it deliberately, and it is the only list that can contain it.
  const entry = [...(state.backgrounds ?? []), ...(state.catalog?.backgrounds ?? [])]
    .find((b) => b.id === id);
  if (entry?.url) {
    // Measured wins over the static list; unmeasured starts the measurement and
    // paints the static answer meanwhile.
    const mean = lumaStore()[id];
    if (mean === undefined) measureScene(id, entry.url);
    const dark = mean === undefined ? DARK_BGS.includes(id) : isDarkLuma(mean);
    return { cls: `bg-image${dark ? " bg-dark" : ""}`, image: `url('${esc(entry.url)}')` };
  }
  const dark = DARK_BGS.includes(id) ? " bg-dark" : "";
  if (BUILTIN_BGS.includes(id)) return { cls: `bg-${id}${dark}`, image: "" };
  // Nothing chosen, or a scene that no longer ships: the catalogue's meadow if it reached the
  // tablet (2026-09-17, the lineless scenes), else the gradient it always was.
  const meadow = (state.catalog?.backgrounds ?? []).find((b) => b.id === "meadow" && b.url);
  if (meadow) return { cls: "bg-image", image: `url('${esc(meadow.url)}')` };
  return { cls: "bg-meadow", image: "" };
}
export { BUILTIN_BGS, DARK_BGS };

// ---------- surprise (what hatches out of the egg) ----------
const SURPRISE_EMOJI = ["🐣", "🦖", "🦄", "🐸", "🐼", "🦊", "🐙", "🦁"];
const SURPRISE_BG = ["#FFF2C7", "#DFF7E8", "#FDE7F1", "#E3F1FF", "#F1E7FD", "#FFE9D6"];
/** Data-URL SVG surprise: intrinsic size + slice so the rig's egg clip fills correctly. */
export function emojiSurprise(emoji = SURPRISE_EMOJI[(Math.random() * SURPRISE_EMOJI.length) | 0]) {
  const bg = SURPRISE_BG[(Math.random() * SURPRISE_BG.length) | 0];
  return "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice">` +
    `<rect width="200" height="200" fill="${bg}"/>` +
    `<text x="100" y="112" font-size="104" text-anchor="middle" dominant-baseline="middle">${esc(emoji)}</text></svg>`);
}
/** Pick the hatch image per kid prefs: own photo, else random catalog animal, else emoji burst. */
export function pickSurprise() {
  const p = state.prefs;
  if (p?.hatch_mode === "photo" && p.hatch_asset_id) return `/api/media/${p.hatch_asset_id}/file`;
  const animals = (state.catalog?.animals ?? []).filter((a) => a.url);
  if (animals.length) return animals[(Math.random() * animals.length) | 0].url;
  return emojiSurprise();
}

// ---------- audio ----------
let previewAudio = null, previewBtn = null;
/** One preview at a time; toggling the same button stops it. */
export function togglePreview(url, btn) {
  const same = previewBtn === btn;
  stopPreview();
  if (same) return;
  previewAudio = new Audio(url); previewBtn = btn;
  btn.classList.add("playing");
  previewAudio.play().catch(() => stopPreview());
  previewAudio.onended = stopPreview;
}
export function stopPreview() {
  previewAudio?.pause(); previewAudio = null;
  previewBtn?.classList.remove("playing"); previewBtn = null;
}

let music = null;
export function startMusic() {
  stopMusic();
  const id = state.prefs?.music_id;
  const entry = (state.catalog?.music ?? []).find((m) => m.id === id);
  if (!entry?.url) return;
  music = new Audio(entry.url); music.loop = true; music.volume = 0.5;
  music.play().catch(() => {});
}
export function stopMusic() { music?.pause(); music = null; }

// WebAudio chirp fallback for the hatch alarm (unlocked during the Start tap gesture).
let actx = null;
export function unlockAudio() {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    actx.resume();
  } catch { /* no audio, no problem */ }
}
export function playAlarm() {
  const id = state.prefs?.alarm_sound_id;
  const entry = (state.catalog?.alarms ?? []).find((a) => a.id === id);
  if (entry?.url) { new Audio(entry.url).play().catch(() => {}); return; }
  if (!actx) return;
  try {
    [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(([freq, at]) => {
      const osc = actx.createOscillator(), gain = actx.createGain();
      osc.type = "triangle"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, actx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + at + 0.22);
      osc.connect(gain).connect(actx.destination);
      osc.start(actx.currentTime + at); osc.stop(actx.currentTime + at + 0.25);
    });
  } catch { /* ignore */ }
}

// ---------- proof/hatch photo pipeline: downscale to 1280px JPEG q0.8 ----------
export async function toJpeg(file, maxSide = 1280, quality = 0.8) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file; // undecodable: let the server validate it
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
  return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
}

// ---------- QR (vendored qrcode.js global, same as the parent app) ----------
export function renderQr(el, text) {
  try {
    const qr = qrcode(0, "M"); qr.addData(text); qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    const svg = el.querySelector("svg");
    if (svg) { svg.style.width = "100%"; svg.style.height = "100%"; }
  } catch { el.textContent = "QR"; }
}
