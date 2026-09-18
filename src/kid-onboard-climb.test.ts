// THE KID'S CLIMB (2026-09-18): five screens before the app, on the Duolingo mechanics.
//
// Static reads of the modules, the way src/kid-goal-path.test.ts holds the path together.
// Each test is a way the climb can quietly come apart while the board still renders:
//
//   1. the order: Hi, the money face, the character, the place, then login resumes
//   2. the money face keeps its one-way door: the tap posts { setId, index }, never an address,
//      and `done` is only reached through the server's answer
//   3. the hero is written through PATCH /kids/:id/hero and the client's list is the server's
//   4. the place writes prefs.background_id through the existing PUT, no column of its own
//   5. the climb is decided by the row (`hero` null), never by localStorage: shared tablet
//   6. rung one says START above its title, in the same bubble, and only rung one
//   7. the new modules and sheet are linked, precached, and write no hue
//   8. the animation slots are on the shared Rive contract (data-riv, data-verb, .anim)

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { HERO_IDS } from "./kid-hero";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ONBOARD = read("public/kid/js/onboard.js");
const SHELL = read("public/kid/js/climb-shell.js");
const FACE = read("public/kid/js/character.js");
const HERO = read("public/kid/js/hero.js");
const PLACE = read("public/kid/js/place.js");
const MAIN = read("public/kid/js/main.js");
const ME = read("public/kid/js/me.js");
const API = read("public/kid/js/api.js");
const PATH_JS = read("public/kid/js/goal-path.js");
const CSS = read("public/kid/css/onboard.css");
const ENTRY = read("public/kid/index.html");
const SW = read("public/sw.js");

test("the climb runs Hi, the money face, the character, the place, in that order", () => {
  const seq = ONBOARD.slice(ONBOARD.indexOf("export function showClimb"));
  const at = (s: string) => seq.indexOf(s);
  expect(at("showHi(")).toBeGreaterThan(-1);
  expect(at("showCharacterPicker(")).toBeGreaterThan(at("showHi("));
  expect(at("showHeroPicker(")).toBeGreaterThan(at("showCharacterPicker("));
  expect(at("showPlacePicker(")).toBeGreaterThan(at("showHeroPicker("));
});

test("login runs the climb before anything reads the wallet, and lands on the goal path after", () => {
  const sel = MAIN.slice(MAIN.indexOf("export async function selectChild"));
  expect(sel.indexOf("showClimb(")).toBeLessThan(sel.indexOf("await Promise.all([refreshWallet()"));
  expect(sel).toContain("needsClimb(child) && !climbed");
  // The top of the climb: the first goal that is not done, else the board.
  expect(sel).toContain("onGoalTap(first.id");
  expect(sel.indexOf("if (climbed)")).toBeLessThan(sel.indexOf("showChart();"));
});

test("the climb is decided by the row, never by this tablet's storage", () => {
  expect(ONBOARD).toContain("export const needsClimb = (child) => !child.hero;");
  for (const src of [ONBOARD, SHELL, FACE, HERO, PLACE]) expect(src).not.toContain("localStorage.");
});

test("the money face keeps its one-way door: an index is posted, never an address", () => {
  expect(FACE).toContain("api.chooseCharacter(child.id, { setId: offer.setId, index })");
  expect(FACE).not.toMatch(/chooseCharacter\([^)]*address/);
  // `done` only after the server agreed, and the refusal is a redraw with a fresh nine.
  const pick = FACE.slice(FACE.indexOf("async function pick("));
  expect(pick.indexOf("res?.child?.address")).toBeLessThan(pick.indexOf("return done()"));
  expect(pick).toContain('draw(child, done, t("app.obFaceTryAgain"))');
  // Nine on hexagon tiles, and the shuffle is the paper button.
  expect(FACE).toContain('class="ob-grid ob-grid-9"');
  expect(FACE).toContain('{ tone: "secondary" }');
});

test("the hero goes through PATCH /kids/:id/hero, and the client's list is the server's", () => {
  expect(API).toContain("setHero: (childId, hero) => patch(`/api/kids/${encodeURIComponent(childId)}/hero`, { hero })");
  expect(HERO).toContain("api.setHero(child.id, picked)");
  const list = HERO.match(/const HEROES = \[([^\]]*)\]/)?.[1] ?? "";
  const ids = [...list.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  expect(ids).toEqual([...HERO_IDS] as string[]);
  // Two taps: the tile picks, THAT ONE writes; the button sleeps until a tile is picked.
  expect(HERO).toContain('markPicked(tile, "ob-that")');
  expect(HERO).toContain("{ disabled: !picked }");
  // Re-pickable from the me sheet, both ways out on the board.
  expect(ME).toContain("showHeroPicker(kid, { onDone: () => onChanged?.(), onBack: () => onChanged?.() })");
});

test("the place writes prefs.background_id through the existing PUT and is skippable", () => {
  expect(PLACE).toContain("api.putPrefs(child.id, { backgroundId: picked })");
  expect(PLACE).not.toMatch(/api\.\w*[Pp]lace|\/place/);  // no column, no route of its own
  expect(PLACE).toContain('$("ob-skip").onclick = done;');
  // The catalogue's scenes, which are the ones the board paints; nothing else.
  expect(PLACE).toContain("state.catalog?.backgrounds");
  expect(PLACE).not.toContain("timer/bg");
});

test("rung one says START above its title, in the same bubble, and only rung one", () => {
  expect(PATH_JS).toContain("const start = active && n === 1");
  expect(PATH_JS).toContain("${start}${esc(rowTitle(r))}${pay}");
  expect(PATH_JS).toContain('t("app.kidGoalStart")');
});

test("the modules and the sheet are linked, precached, and the sheet writes no hue", () => {
  for (const f of ["climb-shell", "onboard", "hero", "place"]) expect(SW).toContain(`"/kid/js/${f}.js"`);
  expect(SW).toContain('"/kid/css/onboard.css"');
  expect(ENTRY).toContain('href="/kid/css/onboard.css"');
  // The connect sheet must be linked before the climb's, which reuses its page composition.
  expect(ENTRY.indexOf("connect.css")).toBeLessThan(ENTRY.indexOf("onboard.css"));
  // The only hex in the sheet is the ground's grey fallback and the derived edge's #000.
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const hexes = [...rules.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => m[0].toUpperCase());
  expect(new Set(hexes)).toEqual(new Set(["#F8F8F8", "#000"]));
  expect(CSS).toContain("min-height: 0");
});

test("the animation slots are on the shared Rive contract", () => {
  expect(SHELL).toContain('class="anim ob-anim');
  expect(SHELL).toContain('data-riv="${esc(r ? r.src : riv)}" data-verb="${esc(r ? r.verb : verb)}"');
  expect(SHELL).toContain('import("/js/lib/rive-mount.js")');
  expect(ONBOARD).toContain("TRIO.map((h) => animSlot(`hi-${h}`, { hero: h }))");
  expect(HERO).toContain('animSlot("hero-pick", { hero: picked })');
  expect(PLACE).toContain('animSlot("place", { hero: child.hero })');
  expect(PATH_JS).toContain('animSlot("rung-one", { hero: state.child?.hero ?? null');
  expect(CSS).toContain(".anim:empty { display: none; }");
});

test("the three characters that move are heroes, on riv.nimiq.kids, and the CSP names the host", () => {
  const riv = SHELL.match(/export const RIV = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  const entries = [...riv.matchAll(/(\w+): \{ src: "([^"]+)", verb: "(\w+)" \}/g)];
  expect(entries.map((m) => m[1])).toEqual(["frog", "penguin", "octopus"]);
  for (const [, id, src, verb] of entries) {
    expect(HERO_IDS as readonly string[]).toContain(id);
    // never pinned to a hash: a rebuild lands over the same URL
    expect(src).toBe(`https://riv.nimiq.kids/nimiq-kids-${id}.riv`);
    expect(verb).toMatch(/^(jump|slide|wave)$/);
  }
  // connect-src must name riv.nimiq.kids or the loader's fetch is refused (the site builder's
  // PR lands that line; this reads the policy as served, whichever file declares it)
  expect(read("src/security-headers.ts")).toContain("riv.nimiq.kids");
  // the parent's welcome trio is the same three, same verbs
  const parent = read("public/parent/views-onboard.js");
  for (const [, id, src, verb] of entries) expect(parent).toContain(`data-riv="${src}" data-verb="${verb}"`);
  // an unreachable file leaves the slot empty: the mount resolves, nothing throws into the screen
  expect(SHELL).toContain(".catch(() => [])");
});
