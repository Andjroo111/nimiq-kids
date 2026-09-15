// THE ONE-TIME POINTER AT THE NAME PILL (#407) — the rules, and how each one fails silently.
//
// The hint itself is a browser question (a driver renders it against a running instance). What
// rots in CI is the wiring, and every rule below is a one-line change from being wrong in a way
// no screenshot would catch: a hint that never fires looks identical to a kid who already saw it,
// and a hint that fires forever looks fine on the paint you happen to be looking at.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const COACH = read("public/kid/js/coach.js");
const CHAR = read("public/kid/js/character.js");
const CHART = read("public/kid/js/chart.js");
const INDEX = read("public/kid/index.html");
const CSS = read("public/kid/css/coach.css");
const EN = read("src/locales/en.ts");

test("an absent flag says NOTHING, which is the opposite of kid.approvedSeen", () => {
  // ⚠️ THE RULE THIS FILE EXISTS FOR. `kid.approvedSeen` treats a missing marker as "never told,
  // so tell them". Inverted here, every kid who already owns a character would meet this hint on
  // every device, on every board paint, forever — the reappearing obstacle #407 rules out.
  const fn = COACH.slice(COACH.indexOf("export function showSceneCoachIfArmed"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  expect(body).toMatch(/!read\(childId\)\) return false/);
  // And nothing else may write the key: only the character pick arms it.
  expect(COACH.match(/localStorage\.setItem/g)?.length ?? 0).toBe(1);
  const arm = COACH.slice(COACH.indexOf("export function armSceneCoach"));
  expect(arm.slice(0, arm.indexOf("\n}"))).toMatch(/localStorage\.setItem/);
});

test("the flag is spent on the DRAW, not on the dismissal", () => {
  // "Once per kid." A flag that survived until the kid engaged would put the bubble back on
  // every board paint until they did — the chart polls, so that is every ten seconds.
  const fn = COACH.slice(COACH.indexOf("export function showSceneCoachIfArmed"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  const cleared = body.indexOf("clear(childId)");
  const drawn = body.indexOf("document.body.appendChild");
  expect(cleared).toBeGreaterThan(-1);
  expect(drawn).toBeGreaterThan(-1);
  expect(cleared).toBeLessThan(drawn);
  // The dismissal only takes the node down. If it cleared too, the ordering above would be
  // decorative rather than load-bearing.
  const off = COACH.slice(COACH.indexOf("export function dismissSceneCoach"));
  expect(off.slice(0, off.indexOf("\n}"))).not.toMatch(/clear\(/);
});

test("it is armed by the character pick, and only after the SERVER agreed", () => {
  // Andjroo's call (2026-09-01): the pick, not the first board paint. A pick that lost a race to
  // a sibling comes back with a fresh nine and must arm nothing — so the call sits inside the
  // `if (address)` branch, beside the address it is really keyed to.
  expect(CHAR).toMatch(/import \{ armSceneCoach \} from "\.\/coach\.js";/);
  const pick = CHAR.slice(CHAR.indexOf("async function pick"));
  const branch = pick.slice(pick.indexOf("if (address) {"), pick.indexOf("return done();"));
  expect(branch).toMatch(/armSceneCoach\(child\.id\)/);
  // The retry path below it is where a wrongly-placed call would land.
  expect(pick.slice(pick.indexOf("await draw(child, done,"))).not.toMatch(/armSceneCoach/);
});

test("it is drawn on the board, pointing at the pill that opens the me-sheet", () => {
  // The scene lives behind the name (`me.js`) and #407 is explicit that it STAYS there: this is
  // a coach mark, not a move. So the anchor must be the same element the sheet hangs off.
  expect(CHART).toMatch(/showSceneCoachIfArmed\(kid\.id, \$\("switch-kid"\)\)/);
  expect(CHART).toMatch(/\$\("switch-kid"\)\.onclick = \(\) => openMeSheet/);
});

test("both ways out exist: tap it away, or take the action", () => {
  const fn = COACH.slice(COACH.indexOf("export function showSceneCoachIfArmed"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  expect(body).toMatch(/node\.onclick = dismissSceneCoach/);
  // ⚠️ `addEventListener`, never `anchor.onclick =`. The pill already carries the handler that
  // opens the me-sheet, and an assignment would replace it — the hint would eat the very tap it
  // is asking for, and the kid would learn the name pill does nothing.
  expect(body).toMatch(/anchor\.addEventListener\("click", dismissSceneCoach, \{ once: true \}\)/);
  expect(body).not.toMatch(/anchor\.onclick\s*=/);
});

test("the bubble is FIXED and parented to body, so no ancestor can clip it", () => {
  // The pill sits in `.ch-aside`, which landscape.css turns into a narrow left column. A bubble
  // positioned inside it is one `overflow` rule away from being clipped to nothing.
  expect(COACH).toMatch(/document\.body\.appendChild\(node\)/);
  const rule = CSS.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.kid-coach\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toMatch(/position:\s*fixed/);
  // top/left/max-width are written by the measurement in JS; a CSS value here would fight it.
  expect(rule).not.toMatch(/(^|\s)(top|left|max-width):/);
  expect(INDEX).toMatch(/<link rel="stylesheet" href="\/kid\/css\/coach\.css" \/>/);
});

test("the anchor is re-read until it stops moving", () => {
  // ⚠️ THE PILL IS STILL MOVING ON THE FRAME THIS DRAWS. `setScreen` marks the new screen
  // `is-entering` and `screen-in` scales the whole board up from 0.985 over 260ms, so a rect
  // read on frame one is the rect of a shrunken board. Measured 2026-09-01 with a single
  // synchronous read: the bubble landed 3px left of the pill and stayed there for good. A
  // one-shot measurement is the natural way to write this and it is silently wrong.
  const fn = COACH.slice(COACH.indexOf("export function showSceneCoachIfArmed"));
  const body = fn.slice(0, fn.indexOf("\nexport ") + 1 || undefined);
  expect(body).toMatch(/requestAnimationFrame\(settle\)/);
  expect(body).toMatch(/stable = key === last \? stable \+ 1 : 0/);
  // Self-terminating in both directions: two identical frames, or a deadline. A loop that
  // only had the deadline would run 700ms of layout reads on every first-run board.
  expect(body).toMatch(/stable < 2 && performance\.now\(\) < deadline/);
});

test("an anchor that has left the document takes the bubble with it", () => {
  // The chart repaints on its own poll and a repaint replaces the pill, so a bubble that only
  // ever removed itself on a tap would hang in mid-air over whatever screen came next.
  expect(COACH).toMatch(/if \(!anchor\.isConnected\) return dismissSceneCoach\(\)/);
  expect(COACH).toMatch(/window\.addEventListener\("resize", reposition\)/);
  expect(COACH).toMatch(/window\.removeEventListener\("resize", reposition\)/);
});

test("localStorage never throws out of a board paint", () => {
  // A private window and an opaque origin both make the accessor itself throw. A hint is not
  // worth taking the board down for, in either direction.
  expect(COACH).toMatch(/try \{ return localStorage\.getItem/);
  expect(COACH).toMatch(/try \{ localStorage\.removeItem/);
  expect(COACH).toMatch(/try \{ localStorage\.setItem/);
});

test("the copy names the action and the thing, and exists in every locale", () => {
  expect(EN).toMatch(/"app\.kidSceneCoach": "Tap your name to change your background"/);
  for (const l of ["de", "es", "fr", "pt"]) {
    expect(read(`src/locales/${l}.ts`)).toMatch(/"app\.kidSceneCoach":/);
  }
});
