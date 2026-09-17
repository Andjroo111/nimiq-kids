// GAMES IN THE DOCK: the rules that have to hold, and each one is a way it could quietly be wrong.
//
// This file replaces `kid-app-shelf.test.ts`. The shelf it guarded put five app icons on the
// board; games is a dock destination now (#398), and the two facts the shelf carried have to
// survive the move: it is ALWAYS there, and locked it says so rather than going away or going
// dead. Both are a one-word change from being wrong, and both look fine in a screenshot.
//
// The rendering itself is a browser question (tools drive it against a running instance with an
// injected KioskBridge). What CAN rot in CI is the wiring.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const CHART = read("public/kid/js/chart.js");
const GAMES = read("public/kid/js/games.js");
const CATS = read("public/js/lib/app-categories.js");
const INDEX = read("public/kid/index.html");
const CAL_CSS = read("public/kid/css/calendar.css");
const CHART_CSS = read("public/kid/css/chart.css");
const LANDSCAPE_CSS = read("public/kid/css/landscape.css");

test("the Games button is drawn whether or not the tablet is unlocked", () => {
  // ⚠️ THE WHOLE POINT, carried over from the shelf. The green card this lineage started with
  // returned "" unless `mode === "unlocked"`, so the board said nothing about games for most of
  // the day. The button may only be withheld when there is NOTHING TO OPEN — no wrapper, or no
  // allowlist — never because of the lock.
  const fn = CHART.slice(CHART.indexOf("function gamesDockState"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  expect(body).toMatch(/const present = !!lock && Array\.isArray\(installed\) && !!lock\.allowedApps\?\.length;/);
  // The lock is read AFTER that, and only to choose a look and a sentence.
  expect(body).toMatch(/const locked = lock\?\.mode !== "unlocked";/);
  expect(body).not.toMatch(/present\s*=\s*[^;]*mode/);
});

test("a locked Games button is still a button that answers a tap", () => {
  // A control that ignores a four-year-old reads as a broken tablet rather than as a rule.
  // `disabled` or `pointer-events: none` would be the easy way to do this wrong and would pass
  // every other test here.
  // The toast names the LOCK when the tablet is locked out (a rest, bedtime, a spent budget)
  // and falls back to "finish your jobs first" for the routine lock, the only one that is
  // about jobs. See locked.js lockTitleKey.
  expect(CHART).toMatch(/if \(gamesDockState\(\)\.locked\) return toast\(t\(lockTitleKey\(\) \?\? "app\.kidShelfDoJobs"\)\);/);
  const games = CHART_CSS.slice(CHART_CSS.indexOf(".ch-dock-games"));
  expect(games.slice(0, games.indexOf("\n\n"))).not.toMatch(/pointer-events:\s*none/);
  expect(CHART).not.toMatch(/id="dock-games"[^>]*disabled/);
});

test("the Timer is in the dock on every board, and Games joins it only when there is something to launch", () => {
  // Andjroo, 2026-09-17: "move the timer that's in the games page ... back onto the main
  // navigation bar." #398 had made the Timer a Games tile to free the slot; the bar is five
  // wide now, so nothing has to give way. Games is still withheld in a plain browser and on a
  // household that has allowlisted nothing (an empty grid is worse than no button), and the
  // Timer is not behind that gate: the judge demo, every browser driver and the timer tests
  // all find `dock-timer` unconditionally.
  const dock = CHART.slice(CHART.indexOf("function dock("));
  const body = dock.slice(0, dock.indexOf("\n}"));
  expect(body).toMatch(/\$\{btn\("timer", "timer", "app\.kidDockTimer"\)\}/);
  expect(body).not.toMatch(/present[^\n]*\n?[^\n]*btn\("timer"/);
  expect(body).toMatch(/games\.present\s*\n?\s*\?\s*btn\("games"[\s\S]*?:\s*""/);
  expect(CHART).toMatch(/\$\("dock-timer"\)\.onclick = /);
  // Order a kid can say: Treasure, Calendar, Timer, Games, Money.
  const order = ["box", "chart", "timer", "games", "money"].map((id) => body.indexOf(`btn("${id}"`));
  expect(order).toEqual([...order].sort((x, y) => x - y));
  expect(order.every((i) => i >= 0)).toBe(true);
});

test("the dock's Games button wears no minutes, and the minutes are still a number the wrapper gave us", () => {
  // The "120m" pill left the bar on 2026-09-15 (Andjroo: "remove the time from games"). The
  // number itself stays honest where it is still printed (the shelf, the lock banner): an
  // unmetered kid has no budget, so there is no number, and inventing one would be a lie.
  const fn = CHART.slice(CHART.indexOf("function gamesDockState"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  expect(body).toMatch(/typeof lock\?\.remainingSec === "number"/);
  expect(body).not.toMatch(/ch-badge-mins/);
  const dock = CHART.slice(CHART.indexOf("function dock("));
  expect(dock.slice(0, dock.indexOf("\n}"))).not.toMatch(/minsPill/);
});

test("a badge sits at the glyph's corner, OUTSIDE its ink, and the column is centred", () => {
  // Andjroo, 2026-09-01: "there's eighteen minutes, but it's on top of the controller. Same
  // thing with the box. Nine is on top of the box." The first fix was a LANE: bottom-align the
  // column and let the badge own the strip above it. Andjroo, 2026-09-15: "the 120 minutes
  // pushes the others that don't have anything low on the bar", which is the lane read from
  // the other three buttons.
  //
  // Since the icon system (2026-09-15) a dock glyph is an SVG whose ink stops at 20 of its 24
  // units, so at --ic-l (40px) the ink ends 16.7px right of centre and a badge whose left edge
  // starts past that is beside the drawing, not on it. The column is centred again, the badge
  // is pinned to the top-right corner of the glyph's box, and both complaints hold at once.
  const rule = (sel: string) => {
    const m = CHART_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
      .match(new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\{([^}]*)\\}`));
    return m?.[1] ?? null;
  };
  const btn = rule("\\.ch-dock-btn");
  expect(btn).not.toBeNull();
  expect(btn!).toMatch(/justify-content:\s*center/);
  const badge = rule("\\.ch-badge");
  expect(badge).not.toBeNull();
  // At the top of the glyph's box or a hair above it (Phosphor ink reaches 232 of 256, so the
  // badge lifts 2px to stay off it); never below the top, which would be on the drawing.
  const top = badge!.match(/top:\s*(-?\d+)(?:px)?/);
  expect(top, "the badge is pinned by top").not.toBeNull();
  expect(Number(top![1])).toBeLessThanOrEqual(0);
  // Past the ink: 50% + at least 17px (the ink ends at +16.7 for a 40px glyph).
  const off = badge!.match(/left:\s*calc\(50% \+ (\d+)px\)/);
  expect(off, "the badge is anchored right of the glyph's centre").not.toBeNull();
  expect(Number(off![1])).toBeGreaterThanOrEqual(17);
  // The regression is a badge back ON the drawing: centred over it (the old lane) or pinned to
  // the button's right edge (the iOS habit), in any block that sizes this bar.
  for (const [name, css] of [["chart.css", CHART_CSS], ["landscape.css", LANDSCAPE_CSS]] as const) {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const onGlyph = bare.match(/\.ch-badge\s*\{[^}]*(?:right:\s*-?\d|translateX\(-50%\))/);
    expect({ file: name, onGlyph: !!onGlyph }).toEqual({ file: name, onGlyph: false });
  }
});

test("the board repaints when the lock state moves, not just when the chart data does", () => {
  // The chart only repaints on a fingerprint change. Without the lock in it, free time could
  // start or the last ten minutes drain away and the dock would sit stale until something else
  // on the board happened to change.
  const fp = CHART.slice(CHART.indexOf("function chartFingerprint"));
  const body = fp.slice(0, fp.indexOf("\n}"));
  expect(body).toMatch(/kioskLock\?\.mode/);
  expect(body).toMatch(/kioskLock\?\.reason/);
  expect(body).toMatch(/remainingSec/);          // the minutes the button prints
  expect(body).toMatch(/allowedApps/);           // a purchase adding a game mid-session
});

test("an unrecognised package is sorted, never hidden", () => {
  // ⚠️ The allowlist is the grown-up's. If `categoryOf` returned null for something it had not
  // been taught, this file would become a second, invisible allowlist that a parent cannot see
  // and cannot edit — a game they ticked would simply not appear on the tablet.
  expect(CATS).toMatch(/return APP_CATEGORY\[pkg\] \?\? "play";/);
  const grp = CATS.slice(CATS.indexOf("export function groupApps"));
  expect(grp).toMatch(/bins\.get\(categoryOf\(a\.pkg\)\)\?\.push\(a\)/);
  // Empty rows are dropped: a heading with nothing under it reads as something taken away.
  expect(grp).toMatch(/\.filter\(\(c\) => c\.items\.length\)/);
});

test("the Timer is not a Games tile, and every Games tile goes through the launcher", () => {
  // The Timer is a screen in this app, not an Android package. While it was a Tools tile
  // (#398) it needed its own tap route past launchApp, or the wrapper would toast "Game time
  // is over" at a kid trying to time a chore. It lives in the dock now, so the grid has no
  // non-package tile and no second tap route: a tile that is not `data-pkg` is a regression.
  expect(GAMES).not.toMatch(/act: "timer"/);
  expect(GAMES).not.toMatch(/data-act/);
  expect(GAMES).not.toMatch(/showEggTimer/);
  expect(GAMES).toMatch(/const rows = groupApps\(allowedGames\(\)\);/);
  const launch = GAMES.slice(GAMES.indexOf('querySelectorAll("[data-pkg]")'));
  expect(launch.slice(0, launch.indexOf("});"))).toMatch(/launchApp\?\.\(b\.dataset\.pkg\)/);
});

test("the photos tile is a RENAME, and it still goes through the launcher", () => {
  // #405. Andjroo: "there's not really a way for them to even view their pictures right now."
  // There is — Samsung Gallery has been on both tablets' allowlists all along — so the fix is a
  // door with the right word on it, not an in-app viewer. The two ways to get this wrong are
  // both a one-line change: giving it a non-package shape (a tile that opens nothing, the way
  // the Timer tile once did), or letting the rename leak into the parent's picker (a grown-up
  // ticking a name they will never see again).
  expect(GAMES).toMatch(/"com\.sec\.android\.gallery3d":\s*"app\.kidGamesPhotos"/);
  // The map is applied on the way out of allowedGames, so `pkg` survives and the tile keeps
  // its `data-pkg` attribute — which is the ONLY thing that routes a tap to launchApp.
  const fn = GAMES.slice(GAMES.indexOf("function allowedGames"));
  expect(fn.slice(0, fn.indexOf("\n}"))).toMatch(/KID_LABEL\[a\.pkg\]\s*\?\s*\{\s*\.\.\.a,\s*label:/);
  expect(GAMES).not.toMatch(/gallery3d[\s\S]{0,200}?data-act/);
  // ⚠️ NOT in the shared lib. `app-categories.js` is read by the parent side too, and a kid
  // word arriving in the installed-apps picker renames the app for the person choosing it.
  expect(CATS).not.toMatch(/kidGamesPhotos/);
});

test("the calendar's resting state is one line, and opening it still works", () => {
  // A shut calendar used to still be a whole week of dates, 182px, which on a landscape screen
  // was most of the column.
  expect(CAL_CSS).toMatch(/\.k-cal:not\(\.is-open\) \.cal-dow,\s*\.k-cal:not\(\.is-open\) \.cal-dates \{ display: none; \}/);
  // ⚠️ `.cal-dates` is ALSO a button that opens the month, so hiding it would strand the
  // calendar shut if it were the only way in. Two others survive: the header, and the dock.
  expect(read("public/kid/js/calendar.js")).toMatch(/el\.onclick = toggleCalendar/);
  expect(CHART).toMatch(/\$\("dock-chart"\)\.onclick = toggleCalendar/);
});

test("games.css is linked, and shelf.css is gone for good", () => {
  const links = [...INDEX.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map((m) => m[1]!);
  expect(links).toContain("/kid/css/games.css");
  expect(links).not.toContain("/kid/css/shelf.css");
  // games.css sizes .games-row* for the screen; landscape.css stays last on principle.
  expect(links.indexOf("/kid/css/games.css")).toBeLessThan(links.indexOf("/kid/css/landscape.css"));
});
