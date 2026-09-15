// THE WALLET SHEETS AND THE FOLD (#403).
//
// Andjroo, 2026-09-01: "in portrait, whenever you're in the money section and you do receive or
// send, they look a little low, especially the receive one. The receive cuts off the bottom QR
// code just a little bit."
//
// Two separate defects produced one symptom, and BOTH are the kind that a screenshot on a
// desktop browser cannot show you, because `env(safe-area-inset-bottom)` is 0 and the large
// viewport equals the small one there. That is why nothing in `src/` covered these sheets
// before, and why this file is string assertions rather than a render.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const WALLET = read("public/kid/css/wallet.css");
const PHONE = read("public/kid/css/phone.css");
const KID = read("public/kid/kid.css");

// ⚠️ Comments are stripped FIRST. These rules carry long block comments explaining exactly why
// the values are what they are, and a naive `[^}]*` body match ends at the first `}` inside one
// of them — which is a matcher that reads a rule as empty and passes a `not.toMatch` for free.
// Leading whitespace is allowed too, because phone.css's copy lives inside a media query.
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (css: string, sel: string) => {
  const m = strip(css).match(
    new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  return m?.[1] ?? null;
};

test("the sheet is capped against the SMALL viewport, not the large one", () => {
  // `.screen` is `position: fixed; inset: 0`, which iOS lays out as if the browser chrome were
  // collapsed. A `%` cap therefore measures a box taller than the visible glass, and a
  // bottom-anchored sheet spends the difference below the fold. `svh` is the only unit that
  // asks the right question.
  expect(rule(KID, ".screen")).toMatch(/position:\s*fixed/);
  const sheet = rule(WALLET, ".k-sheet-screen .k-sheet");
  expect(sheet).not.toBeNull();
  expect(sheet!).toMatch(/max-height:\s*92svh/);
  // ⚠️ The regression is writing `92%` back, which looks identical on every desktop browser.
  expect(sheet!).not.toMatch(/max-height:\s*\d+%/);
});

test("every bottom-anchored sheet clears the home indicator", () => {
  // The dock, the kid sheet and the toast have all carried this inset for months; the wallet
  // sheets never had it, and on the TABLET they had no bottom padding at all — phone.css is
  // the only file with a `.k-sheet {}` rule and it lives inside a max-width query.
  const sheet = rule(WALLET, ".k-sheet-screen .k-sheet")!;
  expect(sheet).toMatch(/padding-bottom:\s*calc\(24px \+ env\(safe-area-inset-bottom/);
  // ⚠️ The inset ADDS air, it must never replace it: a phone with no home indicator resolves
  // env() to 0, so a bare `env(...)` here would take 24px off every non-notch phone.
  expect(sheet).not.toMatch(/padding-bottom:\s*env\(/);
  // ⚠️ The pad screen trims this padding deliberately and its rule is the same specificity AND
  // later in the file, so it owns the value outright. Without restating the inset there, the
  // one sheet with a keypad silently loses the fix again.
  const pad = rule(WALLET, ".k-pad-screen .k-sheet")!;
  expect(pad).toMatch(/padding-bottom:\s*calc\(10px \+ env\(safe-area-inset-bottom/);
});

test("phone.css cannot take the inset back off", () => {
  // `.k-sheet` there is (0,1,0) against this rule's (0,2,0), so the shorthand loses on
  // specificity whatever the link order is — but only for the longhand we actually declare.
  // Its left/right padding still applies, which is what we want.
  expect(rule(PHONE, ".k-sheet")).toMatch(/padding:\s*20px 18px 24px/);
});

test("the dead 260px QR rule stays dead", () => {
  // The only `.k-qr` in the app is the canvas inside `.k-qr-sheet`, and the descendant
  // selector outranks a bare class at both breakpoints. A bare `.k-qr { width }` reads as the
  // size the QR is and is not, which is how someone tunes the wrong number for an afternoon.
  expect(strip(WALLET)).not.toMatch(/\n\.k-qr \{/);
  expect(WALLET).toMatch(/\.k-qr-sheet \.k-qr \{ width: min\(70vw, 340px\)/);
  expect(PHONE).toMatch(/\.k-qr-sheet \.k-qr \{ width: min\(64vw, 240px\)/);
});
