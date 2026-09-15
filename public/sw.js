// nimiq.kids service worker — cache-busting from day one (see PWA lesson).
// Bump VERSION on every deploy. HTML + /api are network-first (never stale); app code (css/js) is
// also network-first so a judge's installed PWA always runs current code; other static assets are
// cache-first. skipWaiting + clients.claim + a gated controllerchange reload finish the job.
//
// REGISTERED BY `public/kid/js/register-sw.js`, at scope `/kid/` (nothing else registers it).
// It was dead from 2026-08-01, when public/js/app.js was deleted, until the kid tablet needed
// to work in a car with no Wi-Fi. The scope is the kid app alone on purpose: /parent/ and the
// marketing site at "/" are uncontrolled and behave exactly as they did.
//
// ⚠️ THREE LAYERS SHIP TOGETHER OR NONE DO. This file caches the SHELL. The shell alone paints
// an EMPTY app, because /api is never cached (below) and an empty board is worse than an error
// page. `public/kid/js/snapshot.js` is the data half and `public/kid/js/outbox.js` is the write
// half. Removing either one and leaving this is a regression, not a simplification.
const VERSION = "v15";
// TWO CACHES, AND THE SPLIT IS ABOUT WHAT A DEPLOY ACTUALLY CHANGES.
//
// `src/serve-cache.ts` rewrites VERSION with the server's boot stamp, so every restart is a
// new worker and a new CACHE name, and `activate` below drops the old one. That is right for
// code: a deploy IS new code and the tablet should take all of it.
//
// It is wrong for ART. The precache is 12MB and 11 of them are stickers, job icons, the
// switch-gate pictures and fonts, none of which a code deploy touches. Throwing those away on
// every restart means re-pulling 11MB over the house Wi-Fi to end up byte-identical. So art
// lives in a cache that is NOT stamped, is never purged by `activate`, and is only fetched at
// install time for entries it does not already hold. Redrawn art at an unchanged URL still
// lands, through the cache-first-then-refresh path in `fetch` below, which is how every
// runtime-cached picture has always updated.
const CACHE = `nimiq-kids-${VERSION}`;
const ART = "nimiq-kids-art";
const PREFIX = "nimiq-kids-";
const isArt = (p) => p.startsWith("/assets/") || p.startsWith("/kid/assets/") || p.startsWith("/fonts/");
const cacheFor = (p) => caches.open(isArt(p) ? ART : CACHE);
// NOTE: "/" is deliberately NOT precached and is never the offline fallback. On the
// public instance "/" is the marketing site (src/root-redirect.ts), so caching it here
// would let an offline tablet render a marketing page where the app should be. The app
// entry is /portal/, which auto-routes to /parent/ or /kid/ on a known device.
const APP_ENTRY = "/portal/";
// The document the KIOSK actually lands on, and therefore the offline fallback for every
// navigation this worker controls. /portal/ stays the fallback for anything outside /kid/,
// which under the current scope is nothing, it is kept so widening the scope later is safe.
const KID_ENTRY = "/kid/";
const SHELL = [
  APP_ENTRY, "/js/lib/confetti.js?v=9",   // v9: celebrate() now makes a sound
  // ⚠️ AUDIO NEEDS EXPLICIT SHELL ENTRIES. Nothing else pulls these — they are
  // fetched by `new Audio()` at the moment of celebrating, so without them here an
  // offline tablet celebrates in silence until the first time it was already online.
  "/assets/sounds/celebrate.mp3", "/assets/sounds/cheer.mp3",
  "/fonts/mulish-latin-wght-normal.woff2", "/js/vendor/qrcode.js", "/manifest.webmanifest", "/icon.svg", "/favicon.svg",
  // kid tablet app (/kid/) — v3 sticker chart
  "/kid/", "/kid/kid.css",
  // EVERY stylesheet /kid/index.html links, and the list is checked by src/sw-shell.test.ts
  // rather than by hand. Nine of these were missing, which is a first offline boot with no
  // calendar card, no landscape layout, no savings thermometer and no games rows, the app
  // laid out as if half its sheets had 404ed, which is exactly what had happened.
  "/kid/css/chrome.css", "/kid/css/wallet.css", "/kid/css/no-address.css",
  "/kid/css/phone.css", "/kid/css/chart.css", "/kid/css/icons.css", "/kid/css/calendar.css", "/kid/css/scene.css",
  "/kid/css/box.css", "/kid/css/done.css", "/kid/css/goal-path.css", "/kid/css/connect.css", "/kid/css/thermo.css",
  "/kid/css/games.css", "/kid/css/coach.css", "/kid/css/landscape.css", "/kid/css/offline.css",
  "/kid/css/sticker-maker.css", "/kid/css/polaroid.css", "/kid/css/eggtimer.css",
  // THE SHARED SHELL. Untracked build output (`bun run build:shell`), served at a stamped
  // URL, and the only thing on the page that carries i18n, without it an offline board
  // renders raw `app.*` keys where every label should be.
  "/dist/app-shell.js",
  // EVERY module under /kid/js and /js/lib, checked by src/sw-shell.test.ts. An ES import
  // graph has no partial failure that is worth having: one module missing offline is a
  // ReferenceError out of boot, so the list is all of them or it is decoration.
  "/kid/js/register-sw.js", "/kid/js/snapshot.js", "/kid/js/outbox.js", "/kid/js/offline-note.js",
  "/kid/js/timer.js", "/kid/js/timer-previews.js",
  "/kid/js/util.js", "/kid/js/luma.js", "/kid/js/api.js", "/kid/js/main.js", "/kid/js/flow.js",
  "/kid/js/waiting.js", "/kid/js/timer-style.js", "/kid/js/payout.js",
  "/kid/js/bridge.js", "/kid/js/games.js", "/kid/js/locked.js", "/kid/js/battery.js",
  "/kid/js/icons.js", "/kid/js/data.js", "/kid/js/chart.js", "/kid/js/stickers.js",
  "/kid/js/box.js", "/kid/js/addjob.js", "/kid/js/done.js", "/kid/js/money.js",
  "/kid/js/send.js", "/kid/js/receive.js", "/kid/js/grow.js", "/kid/js/pad.js",
  "/kid/js/approved.js", "/kid/js/calendar.js", "/kid/js/card.js", "/kid/js/character.js",
  "/kid/js/coach.js", "/kid/js/confetti.js", "/kid/js/eggtimer.js", "/kid/js/goal-path.js",
  "/kid/js/grow-gate.js", "/kid/js/kid-lang.js", "/kid/js/me.js", "/kid/js/polaroid.js",
  "/kid/js/practice.js", "/kid/js/scan.js", "/kid/js/sticker-maker.js",
  "/kid/js/switch-gate.js", "/kid/js/thermo.js", "/kid/js/upkeep.js",
  "/js/lib/app-categories.js", "/js/lib/box-glyphs.js", "/js/lib/esc.js",
  "/js/lib/job-picker.js", "/js/lib/local-photos.js",
  // NO GENERATED ART IS LISTED, AND src/sw-shell.test.ts AGREES. The sixty stickers, the
  // forty-five job icons, the five Treasure Box faces and the twelve switch-gate pictures all
  // left the tree on 2026-09-15 (the art repass; src/sticker-catalog.ts has the story) and
  // every renderer draws its emoji or glyph instead. When the new files land, list ALL of
  // each set here again, in the four blocks this note replaced (git shows them): a partial
  // list was how "Feed the dog" drew a broken-image glyph offline on 2026-09-11.
  // vendored nq registry pieces (offline tablet: iqons + fonts + icons local)
  "/vendor/nq/nimiq/legacy/nimiq-style.min.css", "/vendor/nq/nq-bundle.css",
  // The Duolingo path a goal opens as (goal-path.js). Under kid/vendor, so the shell test's
  // directory sweep does not see them; they are listed by hand for the same reason the audio is.
  "/kid/vendor/duo/duo-button/duo-button.css", "/kid/vendor/duo/duo-node/duo-node.css",
  "/kid/vendor/duo/duo-path/duo-path.css",
  "/vendor/nq/iqons.min.js", "/vendor/nq/nimiq/assets/img/iqons.min.svg",
  "/vendor/nq/qr-creator.min.js",
  "/fonts/fira-mono-latin-400.woff2", "/fonts/fira-mono-latin-500.woff2",
  "/vendor/nq/icons/duotone-paper-plane.svg", "/vendor/nq/icons/duotone-document-text.svg",
  "/vendor/nq/icons/duotone-gamepad.svg", "/vendor/nq/icons/duotone-high-five.svg",
  "/vendor/nq/icons/duotone-safe-lock.svg", "/vendor/nq/icons/duotone-key-puzzle.svg",
  "/vendor/nq/icons/duotone-bell.svg", "/vendor/nq/icons/duotone-nimiq-environment.svg",
  "/vendor/nq/icons/duotone-speedmeter.svg", "/vendor/nq/icons/duotone-sparkling-swap.svg",
  // The dock's seven PNG masks used to be listed here; since 2026-09-15 the dock is inline SVG
  // in kid/js/icons.js like every other glyph, so an offline tablet has its navigation the
  // moment it has the modules above.
];

self.addEventListener("install", (e) => {
  // allSettled so one bad URL can't nuke the whole precache.
  e.waitUntil((async () => {
    const [code, art] = await Promise.all([caches.open(CACHE), caches.open(ART)]);
    await Promise.allSettled(SHELL.map(async (u) => {
      const target = isArt(u) ? art : code;
      // Art we already hold is art we do not re-download. This is the whole point of the
      // split above, and it is what keeps a deploy at about a megabyte instead of twelve.
      if (target === art && (await art.match(u))) return;
      return target.add(u);
    }));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // ⚠️ ART IS NOT PURGED, and the filter is `startsWith(PREFIX)` rather than `!== CACHE` so
  // that a cache belonging to anything else on this origin is left alone as well.
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE && k !== ART).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

// A body can only be read once, so this is a getter, not a shared Response object.
const offline = () => new Response("offline", { status: 503 });

const isAppCode = (p) => p.endsWith(".js") || p.endsWith(".css");

/**
 * THE LOOKUP THAT MAKES THE PRECACHE WORTH HAVING, and without it almost none of it matched.
 *
 * `src/serve-cache.ts` stamps every asset URL with the server's boot stamp, in the HTML
 * (`src=`/`href=`) and inside the module graph (`from "./waiting.js"`). So the page asks for
 * `/kid/js/main.js?v=1789084307563` while SHELL precached the bare `/kid/js/main.js`, and a
 * Cache API match is by FULL URL including the query. Every one of those entries missed.
 *
 * Worse, the stamp changes on every server boot and `activate` below deletes the previous
 * cache, so the runtime copies that DID match were thrown away on each deploy. A tablet that
 * went offline after a deploy had a cache full of files it could not find.
 *
 * `ignoreSearch` is the second chance: exact URL first (the right answer whenever the tablet
 * has this boot's copy), then the same path with any query. On a fallback path there is no
 * newer answer to prefer, so an older stamp of a file is simply the file.
 */
const cacheLookup = async (req) =>
  (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));

/** The document to paint when a navigation cannot reach the network. `/kid/` for the kiosk,
 *  which is every navigation under the current scope; `/portal/` for anything else. */
const entryFor = (url) =>
  caches.match(url.pathname.startsWith("/kid/") ? KID_ENTRY : APP_ENTRY);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache the API.
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") { e.respondWith(fetch(req)); return; }

  // The marketing landing at "/" is always network, never cached: a judge must never be
  // served a stale homepage, and it must never occupy the app's offline fallback slot.
  if (url.origin === location.origin && (url.pathname === "/" || url.pathname === "/index.html")) {
    e.respondWith(fetch(req).catch(async () => (await caches.match(APP_ENTRY)) || offline()));
    return;
  }

  // HTML / navigations + app code: network-first, fall back to cache offline (never resolve undefined).
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html") || isAppCode(url.pathname)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200 && url.origin === location.origin) { const copy = res.clone(); cacheFor(url.pathname).then((c) => c.put(req, copy)); }
        return res;
      }).catch(async () => (await cacheLookup(req)) || (await entryFor(url)) || offline()),
    );
    return;
  }

  // Other static assets: cache-first, refresh in background.
  e.respondWith(
    cacheLookup(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200 && url.origin === location.origin) { const copy = res.clone(); cacheFor(url.pathname).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    }),
  );
});
