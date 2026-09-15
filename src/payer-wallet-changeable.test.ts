// The grown-up who pays must be able to change the wallet they pay FROM.
//
// #291 split one address into two jobs. `families.parent_address` used to be both the sender
// of every payout and the till a kid's spending came back to; `payoutSender` (src/members.ts)
// now resolves the acting grown-up's OWN address and falls back to the owner, then the till.
//
// Two defects came out of that split, and both were found on the live mainnet household
// rather than in review, because neither is visible in either file alone:
//
//  1. The Settings card offered "Use my wallet" ONLY to a grown-up with no address. That
//     reads as reasonable and is a dead end for the exact case the fallback creates: a
//     household that predates #291 came through with its owner already carrying an address,
//     and on mainnet that inherited address is the instance's old hot wallet, which nobody
//     holds a key for. Every approval then mints an intent naming a sender that cannot sign,
//     the wallet answers "Address not found", and no screen could correct it.
//  2. The Top up card went on saying "every payout you approve is sent from this address"
//     while writing the TILL. A screen that claims to control who pays, and does not, is
//     worse than one that says nothing: it is where a parent goes to fix exactly this.
//
// These are assertions about the shipped client source, in CI, because both defects lived in
// the space between a template and a route and a green suite shipped them.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { addrEn } from "./locales/parent-address";
import { memEn } from "./locales/parent-members";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the own-wallet control is not gated on having no address", () => {
  const src = read("public/parent/grownups.js");
  // The button exists in the template...
  expect(src).toContain('id="gup-my-wallet"');
  // ...and the condition that decides whether to draw the block does not test for an ABSENT
  // address. `!mine.address` was the whole bug: it made the control disappear at exactly the
  // moment somebody needed it. A ternary INSIDE the block choosing the label is fine.
  const block = src.slice(src.indexOf("const myWallet ="), src.indexOf('id="gup-my-wallet"'));
  expect(block).not.toContain("!mine.address");
  expect(block).not.toContain("!mine?.address");
});

test("the control says something different when it is replacing an address", () => {
  const src = read("public/parent/grownups.js");
  expect(src).toContain("papp.gupMyWalletChange");
  expect(src).toContain("papp.gupMyWalletPick");
  // "Use my wallet" under an address you already have reads as a no-op, so the two states
  // must not share one label.
  expect(memEn["papp.gupMyWalletChange"]).not.toBe(memEn["papp.gupMyWalletPick"]);
});

test("the till card no longer claims to be the wallet that pays", () => {
  // The exact false sentence, and the shape of it. `payoutSender` reads the member, so any
  // copy on this card promising that approvals are sent from it is wrong again.
  const sub = addrEn["papp.famWalletSub"];
  expect(sub).not.toMatch(/payout you approve is sent from this address/i);
  expect(sub.toLowerCase()).not.toMatch(/every payout/);
  // And it points at where who-pays actually lives, so the card is a signpost rather than a
  // dead end.
  expect(sub).toMatch(/Settings/);
});

test("the till card writes the till, and nothing else does", () => {
  const src = read("public/parent/views-manage.js");
  expect(src).toContain('"/api/family/address"');
  // The member endpoint belongs to the Grown-ups card. If this card ever grew a call to it,
  // two screens would be writing who-pays and the copy would be ambiguous again.
  expect(src).not.toContain("members/me/address");
  expect(read("public/parent/grownups.js")).toContain("members/me/address");
});
