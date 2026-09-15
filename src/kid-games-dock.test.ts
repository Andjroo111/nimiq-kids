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

test("with no wrapper the slot keeps the Timer, so a browser is unchanged", () => {
  // In a plain browser and on a household that has allowlisted nothing there is nothing to
  // launch, and a dock button opening an empty grid is worse than one that is not offered. The
  // judge demo, every browser driver and the existing timer tests all still find `dock-timer`.
  expect(CHART).toMatch(/games\.present\s*\n?\s*\?\s*btn\("games"/);
  expect(CHART).toMatch(/:\s*btn\("timer", "timer", "app\.kidDockTimer"\)/);
  expect(CHART).toMatch(/\$\("dock-timer"\)\?\.addEventListener/);
});

test("the minutes pill only ever shows a number the wrapper gave us", () => {
  // An unmetered kid has no budget, so there is no number, and inventing one would be a lie —
  // the rule the shelf's status line held. `mins === null` is the whole guard.
  const fn = CHART.slice(CHART.indexOf("function gamesDockState"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  expect(body).toMatch(/typeof lock\?\.remainingSec === "number"/);
  expect(body).toMatch(/mins === null \? "" :/);
});

test("a badge sits ABOVE its glyph, never on it", () => {
  // Andjroo, 2026-09-01: "there's eighteen minutes, but it's on top of the controller. Same
  // thing with the box. Nine is on top of the box, which is not very valuable to us."
  //
  // A dock glyph is a 23px mask with no padding, so it fills its box corner to corner and the
  // iOS habit of hanging a badge off the icon's top-right corner puts it straight on the
  // drawing. The fix is a lane, not a nudge: the glyph+word column is BOTTOM-aligned in a
  // taller button, and the badge owns the space above it.
  const rule = (sel: string) => {
    const m = CHART_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
      .match(new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\{([^}]*)\\}`));
    return m?.[1] ?? null;
  };
  const btn = rule("\\.ch-dock-btn");
  expect(btn).not.toBeNull();
  expect(btn!).toMatch(/justify-content:\s*flex-end/);
  const badge = rule("\\.ch-badge");
  expect(badge).not.toBeNull();
  expect(badge!).toMatch(/top:\s*0/);
  // ⚠️ Centred over its own button. Pinned right, a wide pill ("18m") drifts toward the
  // neighbouring button and reads as though it belongs to that one.
  expect(badge!).toMatch(/left:\s*50%/);
  expect(badge!).toMatch(/translateX\(-50%\)/);
  // The regression is a corner pin coming back, in any of the three blocks that size this bar.
  for (const [name, css] of [["chart.css", CHART_CSS], ["landscape.css", LANDSCAPE_CSS]] as const) {
    const corner = css.replace(/\/\*[\s\S]*?\*\//g, "")
      .match(/\.ch-badge\s*\{[^}]*right:\s*-?\d/);
    expect({ file: name, cornerPinned: !!corner }).toEqual({ file: name, cornerPinned: false });
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

test("the Timer is a Tools tile and never goes through the launcher", () => {
  // It is a screen in this app, not an Android package, so it neither can be nor should be
  // refused by the wrapper's allowlist. Routing it through launchApp would toast "Game time is
  // over" at a kid trying to time a chore.
  expect(GAMES).toMatch(/\{ category: "tools", act: "timer", mask: "timer", label: t\("app\.kidDockTimer"\) \}/);
  expect(GAMES).toMatch(/querySelectorAll\('\[data-act="timer"\]'\)/);
  const launch = GAMES.slice(GAMES.indexOf('querySelectorAll("[data-pkg]")'));
  expect(launch.slice(0, launch.indexOf("});"))).toMatch(/launchApp\?\.\(b\.dataset\.pkg\)/);
});

test("the photos tile is a RENAME, and it still goes through the launcher", () => {
  // #405. Andjroo: "there's not really a way for them to even view their pictures right now."
  // There is — Samsung Gallery has been on both tablets' allowlists all along — so the fix is a
  // door with the right word on it, not an in-app viewer. The two ways to get this wrong are
  // both a one-line change: giving it the Timer's `onTap` shape (a tile that opens nothing),
  // or letting the rename leak into the parent's picker (a grown-up ticking a name they will
  // never see again).
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
