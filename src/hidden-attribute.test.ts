// The `hidden` attribute has to actually hide (#241).
//
// `[hidden] { display: none }` is a UA-stylesheet rule, so the weakest author rule that names
// a display beats it. Nothing about `.pnav { display: flex }` or `tabs.hidden = true` looks
// wrong; the defect only exists in the space between them, which is why it survived in two
// places and was found in a browser rather than in a review:
//
//   .pnav     first-run drew the bottom tab bar through the whole onboarding flow, on a
//             screen where none of its four destinations exist yet (#241, the reported one).
//   .jp-tile  the shared job picker's search filtered whole GROUPS and no tiles, so typing
//             "dish" left every job in the matching groups on screen. Found by the sweep the
//             issue asked for, same shape, never reported because nobody reads a search that
//             returns too much as broken.
//
// So the fix is one global `[hidden] { display: none !important }` per app rather than a
// patch per selector: the bug is not a property of those two elements, it is what happens the
// next time somebody gives a display to an element somebody else hides. This file is the part
// that fails in CI instead of on a phone.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Comments stripped first, so a selector merely QUOTED in prose is never read as a rule. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Flat (selector, body) pairs. Nested at-rule wrappers do not match and their inner rules
 *  do, which is all this needs: `@media { .jp-grid { … } }` yields the `.jp-grid` rule. */
function cssRules(css: string): { selectors: string[]; body: string }[] {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(",").map((s) => s.trim()).filter(Boolean),
    body: m[2]!,
  }));
}

/** Does any rule in these sheets give `selector` itself a display? `.jp-tile.is-on` and
 *  `.pnav button` are different selectors and do not count: a hidden element takes its
 *  children with it, and a modifier is a different element state, not this one. */
const declaresDisplay = (sheets: string[], selector: string) =>
  sheets.some((css) => cssRules(css).some((r) => r.selectors.includes(selector) && /(^|[;{\s])display\s*:/.test(r.body)));

/** The global rule, and it has to be `!important`: parent.css and kid.css are both linked
 *  BEFORE some of the sheets that name a display, so source order alone would lose. */
const hasGlobalHiddenRule = (css: string) =>
  cssRules(css).some((r) => r.selectors.includes("[hidden]") && /display\s*:\s*none\s*!important/.test(r.body));

// The two apps, each as the set of sheets its document links plus the one that carries the
// global rule. Only the sheets that style the elements below are listed; a sheet that names no
// display for them cannot change the answer.
const PARENT = { sheets: ["public/parent/parent.css"], global: "public/parent/parent.css" };
const KID = {
  sheets: ["public/kid/kid.css", "public/kid/css/chart.css", "public/kid/css/wallet.css", "public/kid/css/connect.css"],
  global: "public/kid/kid.css",
};

/** Every element the app hides by setting the `hidden` attribute, and where it is set. The
 *  table is hand-kept because the target of `el.hidden = x` is not derivable from the source;
 *  the second test below is what stops it from drifting into fiction. */
const TOGGLED = [
  { app: PARENT, selector: ".pnav", toggle: "public/parent/core.js", match: /tabs\.hidden\s*=/ },
  { app: PARENT, selector: ".pbadge", toggle: "public/parent/core.js", match: /badge\.hidden\s*=/ },
  { app: PARENT, selector: ".nq-toast", toggle: "public/parent/core.js", match: /el\.hidden\s*=\s*true/ },
  { app: PARENT, selector: ".qr-holder", toggle: "public/parent/views-manage.js", match: /qr\.hidden\s*=\s*!qr\.hidden/ },
  { app: PARENT, selector: ".dep-identicon", toggle: "public/parent/views-manage.js", match: /idc\.hidden\s*=/ },
  { app: PARENT, selector: ".jp-tile", toggle: "public/js/lib/job-picker.js", match: /b\.hidden\s*=\s*!hit/ },
  { app: PARENT, selector: ".jp-group", toggle: "public/js/lib/job-picker.js", match: /g\.hidden\s*=/ },
  { app: KID, selector: ".jp-tile", toggle: "public/js/lib/job-picker.js", match: /b\.hidden\s*=\s*!hit/ },
  { app: KID, selector: ".jp-group", toggle: "public/js/lib/job-picker.js", match: /g\.hidden\s*=/ },
  { app: KID, selector: ".aj-icons", toggle: "public/kid/js/addjob.js", match: /\$\("aj-icons"\)\.hidden\s*=/ },
  { app: KID, selector: ".k-amount-hint", toggle: "public/kid/js/pad.js", match: /hint\.hidden\s*=/ },
  { app: KID, selector: ".k-connect-err", toggle: "public/kid/js/main.js", match: /err\.hidden\s*=/ },
];

test("nothing the app hides can be drawn anyway by a display rule", () => {
  // The invariant, stated so it survives refactors in either direction: an element may carry a
  // display, or it may be hidden by attribute, but where it is both the app must carry the
  // global rule. Deleting `[hidden] { display: none !important }` from parent.css fails this
  // on `.pnav`; deleting it from kid.css fails it on `.jp-tile`.
  for (const { app, selector } of TOGGLED) {
    const conflicted = declaresDisplay(app.sheets.map(read), selector);
    const guarded = hasGlobalHiddenRule(read(app.global));
    expect({ selector, safe: !conflicted || guarded }).toEqual({ selector, safe: true });
  }
});

test("the table names toggles that really exist", () => {
  for (const { selector, toggle, match } of TOGGLED) {
    expect({ selector, toggle, set: match.test(read(toggle)) }).toEqual({ selector, toggle, set: true });
  }
});

test("the rule is load-bearing in both apps, not a precaution", () => {
  // If neither app had a selector that conflicts, the global rule would be dead code and the
  // first test above would pass with it deleted. These are the two that make it matter.
  expect(declaresDisplay([read("public/parent/parent.css")], ".pnav")).toBe(true);
  expect(declaresDisplay([read("public/kid/css/chart.css")], ".jp-tile")).toBe(true);
  expect(hasGlobalHiddenRule(read("public/parent/parent.css"))).toBe(true);
  expect(hasGlobalHiddenRule(read("public/kid/kid.css"))).toBe(true);
});

test("the first-run screen is the one that asked for this", () => {
  // setChrome() hides the tab bar for a page with no token AND for the notify screen that
  // runs after the token exists, because render() still draws onboarding there and a tab that
  // does nothing reads as a frozen app. Both states depend on the attribute winning.
  const core = read("public/parent/core.js");
  expect(core).toMatch(/tabs\.hidden\s*=\s*!token\(\)\s*\|\|\s*state\.onboarding/);
});
