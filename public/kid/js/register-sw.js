// ARMS THE SERVICE WORKER FROM THE KID ENTRY POINT.
//
// `public/sw.js` has been written and correct since 2026-07, and dead since 2026-08-01: its
// only registrar was `public/js/app.js`, deleted that day. Nothing has registered it since,
// which is why a tablet with no Wi-Fi shows ERR_ADDRESS_UNREACHABLE rather than the app.
//
// It is registered HERE, and not in `/portal/`, because the kiosk wrapper is built with
// `-Pkidkiosk.serverUrl=https://192.168.1.42:3950/kid/` and lands on `/kid/` directly. A
// registration on the chooser is a registration the tablet never runs.
//
// ⚠️ SCOPE IS `/kid/`, NOT `/`. A service worker's scope decides which DOCUMENTS it controls,
// not which URLs it may cache: the kid app's stylesheets, fonts, art and the shared shell all
// live outside `/kid/` and are still intercepted, because the fetch events belong to the page
// that asks for them. Narrowing it is what keeps `/parent/` and the marketing site at `/`
// exactly as they are today, on every instance this code also ships to. `/sw.js` sits at the
// root, so asking for a scope below it is always allowed.
//
// ⚠️ NO `controllerchange` RELOAD. `src/serve-cache.ts` rewrites sw.js's VERSION with the boot
// stamp, so EVERY server restart is new bytes and a new worker, a reload on controllerchange
// would yank the screen out from under a kid on every deploy. Propagation stays what
// `project_hatch_kids_tablet` records: a fresh navigation, or a reboot.

if ("serviceWorker" in navigator && window.isSecureContext) {
  // After load, so the precache (127+ entries) competes with nothing the first paint needs.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/kid/" }).catch(() => {
      // A browser with service workers switched off, or a page served over plain http, is a
      // tablet that works exactly as it does today. There is nothing to tell a child here.
    });
  });
}
