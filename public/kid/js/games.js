// nimiq.kids kid app — the K3 games launcher. The parent's allowlisted apps (icons + labels
// straight from the Android wrapper via KioskBridge.getInstalledApps()), sorted into rows a kid
// can be told; a tap hands the tablet to the app through KioskBridge.launchApp(pkg). Only ever
// reachable while the wrapper reports UNLOCKED — in a plain browser there is no dock entry at
// all (chart.js gamesDockState).
//
// FIVE ROWS, not one grid (#399). Which row a package sits in is `public/js/lib/app-categories.js`,
// shared with the parent side so the two cannot drift. An unrecognised package lands in Play and
// is never hidden — the allowlist is the grown-up's, this only decides where a tile sits in it.
//
// THE TIMER IS A TOOLS TILE (#398). It left the dock for the Games slot, and it belongs here
// because it is what it is: a thing on the tablet that is not a game. It is the one tile that is
// not an Android package, so tiles take an `onTap` rather than always calling launchApp.

import { state, $, esc, t, setScreen, toast, bgFor } from "./util.js";
import { icon, arrowIcon, maskIcon } from "./icons.js";
import { groupApps } from "/js/lib/app-categories.js";
import { showEggTimer } from "./eggtimer.js";

let watchTimer = 0;
function stopWatch() { clearInterval(watchTimer); watchTimer = 0; }

// A KID WORD OVER THE OEM ONE (#405). Samsung Gallery is already on both tablets' allowlists and
// opens fine, so this is presentation, not access: the tile read "Gallery", which is the name of
// a Samsung app rather than the name of the thing a four-year-old is hunting for. It stays a
// `pkg` tile through launchApp — the photos are device-local and non-custodial (#282), so the
// honest shape is a well-named door, not a viewer this app would have to read them to build.
//
// ⚠️ KID-SIDE ONLY. The parent's installed-apps picker must keep showing the real Android label,
// because that is what a grown-up is ticking; a household that renames a package for a kid and
// then hides the real name from the person choosing it has two different apps in two screens.
// That is also why this is not in `app-categories.js`, which IS shared with the parent side.
const KID_LABEL = {
  "com.sec.android.gallery3d": "app.kidGamesPhotos",
};

/** Allowlisted launcher apps, grid-ready. Icon may be null (fallback tile shows the gamepad). */
function allowedGames() {
  const lock = state.kioskLock;
  const apps = state.kiosk?.listInstalledApps?.() ?? [];
  if (!lock || !Array.isArray(apps)) return [];
  const allowed = new Set(lock.allowedApps);
  return apps
    .filter((a) => a && allowed.has(a.pkg))
    .map((a) => (KID_LABEL[a.pkg] ? { ...a, label: t(KID_LABEL[a.pkg]) } : a));
}

function gameTile(app) {
  // A tile that is not an app carries its own mask glyph, drawn from the SAME dock sheet the
  // bar uses, so the Timer here and the Timer that used to be in the bar are one drawing.
  const face = app.mask
    ? `<span class="game-icon game-icon-mask">${maskIcon(app.mask)}</span>`
    : app.icon
      ? `<img class="game-icon" src="${esc(app.icon)}" alt="" />`
      : `<span class="game-icon game-icon-fallback" aria-hidden="true">${icon("gamepad")}</span>`;
  const attr = app.pkg ? ` data-pkg="${esc(app.pkg)}"` : ` data-act="${esc(app.act)}"`;
  return `
    <button class="game-tile"${attr}>
      ${face}
      <span class="game-label">${esc(app.label || app.pkg)}</span>
    </button>`;
}

function rowSection(row) {
  return `
    <section class="games-row">
      <h2 class="games-row-hd">${esc(t(row.label))}</h2>
      <div class="games-grid">${row.items.map(gameTile).join("")}</div>
    </section>`;
}

/** The full-screen launcher. Back button returns to the board; a relock bounces back too. */
export function showGames(showEarn, refreshEarn) {
  stopWatch();
  const bg = bgFor();
  const rows = groupApps(allowedGames(), [
    { category: "tools", act: "timer", mask: "timer", label: t("app.kidDockTimer") },
  ]);

  setScreen(`
    <div class="games">
      <button class="back-btn" id="g-back">${arrowIcon("left")}</button>
      <div class="k-slab games-slab">
        <!-- The page title, the same white pill every other screen wears (scene.css), holding
             the same word as the dock button that got the kid here. It sits INSIDE the slab,
             the way .bx-hd does on the Treasure Box (Andjroo, 2026-09-10: "Games should be in
             the container like the other"), so the two screens read as the same object. -->
        <header class="games-hd">
          <span class="games-emoji" aria-hidden="true">${maskIcon("games")}</span>
          <h1 class="games-title">${esc(t("app.kidDockGames"))}</h1>
        </header>
        <div class="games-rows">
          ${rows.length ? rows.map(rowSection).join("")
    : `<div class="games-empty">${icon("gamepad", "games-empty-icon")}</div>`}
        </div>
      </div>
    </div>`, "k-screen games-screen", bg);

  const back = async () => { stopWatch(); await refreshEarn(); showEarn(); };
  $("g-back").onclick = back;

  document.querySelectorAll("[data-pkg]").forEach((b) => {
    b.onclick = () => {
      const ok = state.kiosk?.launchApp?.(b.dataset.pkg) === true;
      if (!ok) toast(t("app.kidGamesOver")); // relocked (or refused) meanwhile
    };
  });
  // The Timer never goes through the wrapper: it is a screen in this app, so it neither can be
  // nor should be refused by the launcher's allowlist.
  document.querySelectorAll('[data-act="timer"]').forEach((b) => {
    b.onclick = () => { stopWatch(); showEggTimer(() => showGames(showEarn, refreshEarn)); };
  });

  // Free time can end while the grid is up: poll the native state and bounce home
  // the moment the wrapper reports locked (native enforcement already re-pinned).
  watchTimer = setInterval(() => {
    const lock = state.kiosk?.getNativeState?.();
    state.kioskLock = lock ?? null;
    if (!document.querySelector(".games")) return stopWatch();
    if (!lock || lock.mode !== "unlocked") { toast(t("app.kidGamesOver")); back(); }
  }, 5_000);
}
