// THE LOGIN GATE READS TO A FOUR-YEAR-OLD, OR IT READS TO NOBODY.
//
// Andjroo, 2026-09-01, looking at the enrolment screen: *"'Tap the same 2 pictures again, Sam'
// is way too confusing for a little kid. It should just say the kid's name, Sam. Tap 2
// pictures."* And on the button under it: *"I don't understand why it says ask a grown up
// because the kid's doing the setup."*
//
// Both are copy, so both are one careless edit from coming back, and neither fails anything.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { appLocales } from "./locales/index";
import { SWITCH_SECRET_TAPS } from "./kid-switch";

const GATE = readFileSync(new URL("../public/kid/js/switch-gate.js", import.meta.url), "utf8");

test("the heading is the kid's name, and nothing else", () => {
  // The screen used to stack three sentences: a title that was an instruction, the name under
  // it as a subtitle, and a second instruction saying the same thing again. Who it is for,
  // then what to do.
  expect(GATE).toMatch(/<h1 class="nq-h1">\$\{esc\(child\.label\)\}<\/h1>/);
  // ⚠️ The old subtitle slot is gone with it. Putting the name back under a heading is exactly
  // the shape that was wrong.
  expect(GATE).not.toMatch(/nq-notice">\$\{esc\(child\.label\)\}/);
  for (const dead of ["switchPickTitle", "switchAskTitle", `switchConfirm"`]) {
    expect({ key: dead, gone: !GATE.includes(dead) }).toEqual({ key: dead, gone: true });
  }
});

test("each state says one short thing, and none of them explains itself", () => {
  const en = appLocales.en!;
  expect(en["app.switchPickSub"]).toBe("Tap {taps} pictures.");
  expect(en["app.switchConfirmSub"]).toBe("Tap the same {taps} again!");
  expect(en["app.switchAskSub"]).toBe("Tap your {taps} pictures.");
  // ⚠️ "You will tap the same ones to open your app" is a thing a four-year-old cannot act on,
  // and it was on screen at the moment they were being asked to act.
  for (const k of ["app.switchPickSub", "app.switchConfirmSub", "app.switchAskSub"]) {
    for (const [lang, msgs] of Object.entries(appLocales)) {
      const v = msgs![k]!;
      expect({ lang, k, sentences: v.split(/[.!?]/).filter((x) => x.trim()).length })
        .toEqual({ lang, k, sentences: 1 });
    }
  }
});

test("the copy cannot say 2 while the gate asks for 3", () => {
  // `{taps}` stays a placeholder rather than a hardcoded "2" precisely because
  // SWITCH_SECRET_TAPS is a constant somebody can move, and the dots below the line already
  // draw whatever it says.
  expect(SWITCH_SECRET_TAPS).toBeGreaterThan(1);
  for (const k of ["app.switchPickSub", "app.switchConfirmSub", "app.switchAskSub"]) {
    for (const [lang, msgs] of Object.entries(appLocales)) {
      expect({ lang, k, hasPlaceholder: msgs![k]!.includes("{taps}") })
        .toEqual({ lang, k, hasPlaceholder: true });
    }
  }
});

test("setting up offers a way BACK, signing in offers a grown-up", () => {
  // Two screens, two different failures. Enrolling, the kid IS doing the setup and the thing
  // that can go wrong is tapping the wrong name, so the escape is the roster. Signing in, the
  // failure is a forgotten picture and the family PIN is the answer.
  expect(GATE).toMatch(/enrolling \? t\("app\.switchNotMe"\) : t\("app\.switchGrownUp"\)/);
  expect(GATE).toMatch(/enrolling \? onCancel\?\.\(\) : askGrownUp\(\)/);
  // ⚠️ The button is the ONLY way off the enrolment screen (there is no back chevron rendered),
  // so it may be relabelled but never removed: a kid who tapped their sibling's name would be
  // stuck enrolling as them.
  expect(GATE).toMatch(/id="sg-grown"/);
});
