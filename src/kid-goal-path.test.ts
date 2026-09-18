// A GOAL OPENS AS THE CLIMB PATH (duo-ui, 2026-09-13), and the sheet it replaces is gone.
//
// The path is three vendored nq registry components (duo-button, duo-node, duo-path) read on
// the DEFAULT Nimiq map, plus one screen module and one sheet of our own. Everything below is a
// way that can quietly come apart while the board still renders:
//
//   1. a rung state stops mapping to the node class the component paints (a "waiting" rung
//      drawn as pressable, a "climbed" one drawn grey)
//   2. the prize lands before the rungs in DOM order, so column-reverse puts the boss at the
//      BOTTOM and rung one under the banner: the top-down draft Andjroo rejected on sight
//   3. the three vendor sheets load out of dependency order, or after our overrides, and the
//      --duo-* contract the node reads is not there yet
//   4. the sheets are linked but not precached, so an offline tablet opens a goal and gets
//      four unstyled squares
//   5. someone maps a colour in goal-path.css ("just use whatever the correct NIMIQ version
//      would be")
//   6. the retired sheet (goal.js) comes back through a stale import or SHELL entry

import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const PATH_JS = read("public/kid/js/goal-path.js");
const PATH_CSS = read("public/kid/css/goal-path.css");
const ENTRY = read("public/kid/index.html");
const SW = read("public/sw.js");
const UPKEEP = read("public/kid/js/upkeep.js");

const VENDOR = [
  "/kid/vendor/duo/duo-button/duo-button.css",
  "/kid/vendor/duo/duo-node/duo-node.css",
  "/kid/vendor/duo/duo-path/duo-path.css",
];

test("every rung state maps to the node class the component paints", () => {
  const map = PATH_JS.match(/const NODE_CLASS = \{([^}]*)\}/)?.[1] ?? "";
  expect(map).toContain('locked: "is-locked"');
  expect(map).toContain('open: "is-active"');
  expect(map).toContain('waiting: "is-waiting"');
  expect(map).toContain('climbed: "is-done"');
  expect(PATH_JS).toContain('class="duo-node is-prize');
});

test("the active rung wears the tunnel and the bubble, waiting wears the track only", () => {
  // The ring markup is only emitted for the two states the component reads it on.
  expect(PATH_JS).toMatch(/active \|\| r\.state === "waiting" \? ring\(\)/);
  expect(PATH_JS).toMatch(/active \? `<span class="duo-node-bubble">/);
  expect(PATH_JS).toContain('pathLength="100"');
});

test("rungs come before the prize in DOM order: column-reverse then climbs to the boss", () => {
  const rungs = PATH_JS.indexOf("rungs.map((r, i) => rungNode(r, i + 1, progress))");
  const prize = PATH_JS.indexOf("boss ? prizeNode(boss,");
  expect(rungs).toBeGreaterThan(-1);
  expect(prize).toBeGreaterThan(rungs);
  // and the path is CLIMBED: nothing here asks for the lesson order
  expect(PATH_JS).not.toContain("is-descend");
});

test("the vendor sheets load in dependency order, before goal-path.css", () => {
  const at = VENDOR.map((v) => ENTRY.indexOf(`href="${v}"`));
  for (const [i, v] of VENDOR.entries()) expect({ v, linked: at[i]! > -1 }).toEqual({ v, linked: true });
  expect(at[0]!).toBeLessThan(at[1]!);
  expect(at[1]!).toBeLessThan(at[2]!);
  expect(at[2]!).toBeLessThan(ENTRY.indexOf('href="/kid/css/goal-path.css"'));
  // and after the legacy sheet that declares the --nimiq-* tokens the contract falls back to
  expect(ENTRY.indexOf("nimiq-style.min.css")).toBeLessThan(at[0]!);
});

test("the sheets, the module and its CSS are precached; sw-shell.test does not sweep kid/vendor", () => {
  for (const u of [...VENDOR, "/kid/js/goal-path.js", "/kid/css/goal-path.css"]) {
    expect({ u, cached: SW.includes(`"${u}"`) }).toEqual({ u, cached: true });
  }
  for (const v of VENDOR) expect(existsSync(new URL(`../public${v}`, import.meta.url))).toBe(true);
});

test("goal-path.css maps no colour: the default Nimiq map does it", () => {
  // comments may cite an issue (#401); declarations may not carry a hex
  const rules = PATH_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(PATH_CSS).not.toMatch(/--duo-(face|done|prize|paper|lock)\s*:/);
});

test("the sheet is retired: no goal.js, no import of it, no SHELL entry", () => {
  expect(existsSync(new URL("../public/kid/js/goal.js", import.meta.url))).toBe(false);
  expect(UPKEEP).not.toContain('"./goal.js"');
  expect(UPKEEP).toContain('"./goal-path.js"');
  expect(SW).not.toContain('"/kid/js/goal.js"');
});

test("the claim still goes through the parent: onClaim calls api.claimRung and nothing else moves money", () => {
  expect(UPKEEP).toContain("api.claimRung(g.id, rungId)");
  expect(PATH_JS).not.toContain("api.");
});

// ---- the board repaints when a rung moves ----
// chartFingerprint() is what the poll compares to decide whether the board changed. It listed
// today's tasks and practices but not the goals, so a rung approved on the phone while the
// tablet sat on the board moved nothing: two equal strings, no repaint, a stale goal card
// until something unrelated changed (2026-09-18). The lock-state entries are pinned the same
// way in kid-games-dock.test.ts; this pins the goals.
test("the chart fingerprint carries the goals, so an approved rung repaints the card", () => {
  const CHART = read("public/kid/js/chart.js");
  const fp = CHART.slice(CHART.indexOf("function chartFingerprint"));
  const body = fp.slice(0, fp.indexOf("\n}"));
  expect(body).toMatch(/c\.goals/);
  // and still not the whole chart object, which carries serverTime and would never settle
  expect(body).not.toMatch(/JSON\.stringify\(\s*(state\.chart|c)\s*\)/);
});
