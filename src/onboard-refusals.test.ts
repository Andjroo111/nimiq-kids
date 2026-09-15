// Every refusal POST /api/onboard can hand the first-run screen, and what the screen says
// back (#242).
//
// The first-run screen is the one place in the app with nothing behind it. There is no board
// to go back to, no other tab, no signed-in state to retry from, so a refusal it cannot name
// is a dead end: "That didn't go through. Try again" was being shown for a 429, where trying
// again is the exact thing that will not work.
//
// #239 fixed one case. This file is the SWEEP, and it is a set comparison rather than a list
// of examples on purpose: the next refusal added to the route fails this test until somebody
// decides out loud whether a parent can act on it. Deciding "generic" is allowed. Never having
// been asked is what produced this bug twice.
//
// src/onboard.test.ts owns the route's side (which status, which code, which brake).
// src/onboard-wallet-step.test.ts owns the wallet step. This file owns the JOIN.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { onboardErrorKey } from "../public/parent/onboard-gate.js";
import { parentLocales } from "./locales/parent";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const GENERIC = "papp.didntGoThrough";

/**
 * Every `error` code the create-a-family handler can return, and the locale key the screen
 * answers it with. `null` means the generic toast, deliberately.
 *
 * The four label refusals are the deliberate ones. The screen cannot produce them: createFamily()
 * refuses to send without both names, and both fields carry `maxlength` equal to the cap the
 * server checks. A parent-facing string for them would be copy in five languages for a response
 * nobody can receive, and the last test in this file is what keeps that claim true rather than
 * inherited: loosen either guard on the screen and it goes red.
 */
const REFUSALS: Record<string, string | null> = {
  parent_label_required: null,
  parent_label_too_long: null,
  kid_label_required: null,
  kid_label_too_long: null,
  invalid_address: "papp.addrInvalid",
  address_required: "papp.onbNeedWallet",
  too_many_requests: "papp.onbTooMany",
  too_many_families_today: "papp.onbTooManyToday",
};

/** The codes the handler actually returns, read out of the route rather than remembered.
 *  Sliced to the create handler: the pairing routes below it have their own screen and their
 *  own messages (`papp.pairBad`, `papp.pairSlow`). */
function routeErrorCodes(): string[] {
  const src = read("src/routes/onboard.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // Both anchors are code, so they survive the comment strip above. The pairing routes start
  // at the first of them and have their own screen and their own messages.
  const from = src.indexOf('onboardRoutes.post("/onboard"');
  const to = src.indexOf('onboardRoutes.post("/parent/pair-code"');
  expect({ from: from > -1, to: to > from }).toEqual({ from: true, to: true });
  const handler = src.slice(from, to);
  return [...new Set([...handler.matchAll(/error:\s*"([a-z_]+)"/g)].map((m) => m[1]!))].sort();
}

test("the screen has a decision for every refusal the route can give", () => {
  // Set equality both ways. A new code fails this until it is triaged; a code deleted from the
  // route fails it too, so the map cannot silently accumulate answers to nothing.
  expect(routeErrorCodes()).toEqual(Object.keys(REFUSALS).sort());
});

test("every refusal a parent can act on gets its own words", () => {
  for (const [code, key] of Object.entries(REFUSALS)) {
    if (!key) continue;
    expect({ code, says: onboardErrorKey({ error: code }) }).toEqual({ code, says: key });
    expect({ code, generic: onboardErrorKey({ error: code }) === GENERIC }).toEqual({ code, generic: false });
  }
});

test("the two brakes are two different waits, not one shrug", () => {
  // They shared a code until #242, and a screen handed one code can only say one thing. An
  // hour is the honest answer to the per-IP brake and the wrong one for the instance's day.
  expect(onboardErrorKey({ error: "too_many_requests" })).not.toBe(onboardErrorKey({ error: "too_many_families_today" }));
  expect(onboardErrorKey({ error: "too_many_requests" })).not.toBe(GENERIC);
  expect(onboardErrorKey({ error: "too_many_families_today" })).not.toBe(GENERIC);
});

test("the refusals left generic are left generic, and so is everything unnamed", () => {
  for (const [code, key] of Object.entries(REFUSALS)) {
    if (key) continue;
    expect({ code, says: onboardErrorKey({ error: code }) }).toEqual({ code, says: GENERIC });
  }
  // Offline, a 502 from in front of the app, a code invented after this file was written.
  for (const data of [null, undefined, {}, { error: "boom" }]) expect(onboardErrorKey(data)).toBe(GENERIC);
});

test("every key the map can produce exists in all five languages", () => {
  // An unresolved key renders as `papp.onbTooMany` on the parent's phone, which is worse than
  // the generic sentence it replaced.
  const keys = [...new Set([...Object.values(REFUSALS).filter((k): k is string => !!k), GENERIC])];
  for (const lang of ["en", "es", "de", "fr", "pt"] as const) {
    for (const key of keys) expect({ lang, key, has: key in parentLocales[lang] }).toEqual({ lang, key, has: true });
  }
});

test("the label refusals stay unreachable because the screen and the server agree", () => {
  // This is the whole basis for leaving four codes on the generic toast. It is an agreement
  // between two files, which is the kind that rots quietly, so it is asserted rather than
  // written in a comment: raise `maxlength` past the server's cap and a parent starts getting
  // "That didn't go through. Try again" for a name that is two characters too long.
  const screen = read("public/parent/views-onboard.js");
  const route = read("src/routes/onboard.ts");
  for (const [field, serverVar] of [["onb-parent", "parentLabel"], ["onb-kid", "kidLabel"]] as const) {
    const onField = new RegExp(`id="${field}"[^>]*maxlength="(\\d+)"`).exec(screen);
    const onServer = new RegExp(`${serverVar}\\.length > (\\d+)`).exec(route);
    expect({ field, cap: onField?.[1] }).toEqual({ field, cap: onServer?.[1] });
  }
  // And the empty case never leaves the phone at all.
  expect(screen).toMatch(/if \(!parentLabel \|\| !kidLabel\)/);
  expect(screen).toMatch(/papp\.onbNeedNames/);
});
