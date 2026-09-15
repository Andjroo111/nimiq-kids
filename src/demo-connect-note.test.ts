// "Connect wallet" on a seeded demo household explains instead of opening the Hub
// (src/parent-shell.ts), and the kid's waiting screen puts the button that actually unblocks
// them first (public/kid/js/waiting.js).
//
// Both are source assertions rather than behavioural tests, for the same reason
// parent-demo-recovery.test.ts checks getClient()'s source: the seam lives inside a browser
// entry that boots a wallet, a Hub and a corner control, and the thing worth protecting is the
// WIRING, which is exactly what a refactor silently undoes.

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const shell = readFileSync(join(root, "src", "parent-shell.ts"), "utf8");
const waiting = readFileSync(join(root, "public", "kid", "js", "waiting.js"), "utf8");
const connectLocale = readFileSync(join(root, "src", "locales", "parent-connect.ts"), "utf8");
const core = readFileSync(join(root, "public", "parent", "core.js"), "utf8");

test("the corner control is handed the intercepting wallet, not the raw one", () => {
  // `wallet,` (the shorthand) here would put the Hub back on a demo household without any
  // other symptom: everything still works, it just stops explaining.
  const mount = /mountCornerControl\([\s\S]*?\n  \}\);/.exec(shell)?.[0] ?? "";
  expect(mount).toContain("wallet: cornerWallet");
  expect(mount).not.toMatch(/^\s*wallet,\s*$/m);
});

test("'New to Nimiq? Create a wallet' goes through the same door", () => {
  // It routes via connect() because the Hub's `onboard` is privileged and rejects third-party
  // origins. If it called the raw wallet, one of the two ways into wallet creation would still
  // walk a judge out of the demo.
  expect(shell).toContain("onboard: () => { void cornerWallet.connect()");
});

test("the demo flag is read at CALL time, off the /health read that already happens", () => {
  expect(shell).toContain("demoInstance = !!h.demo");
  // Default false: a mainnet or family instance must never be affected by a /health that has
  // not landed yet.
  expect(shell).toContain("let demoInstance = false");
});

test("the proxy binds methods to the TARGET, not the proxy", () => {
  // `Wallet` is a class instance. Forwarding a private-field access through a proxy receiver
  // throws "cannot read private member", and it would throw at the moment a parent tries to
  // pay, on the instances that hold real money.
  const proxy = /const cornerWallet[\s\S]*?\n\}\);/.exec(shell)?.[0] ?? "";
  expect(proxy).toContain("Reflect.get(target, prop, target)");
  expect(proxy).toContain("v.bind(target)");
});

test("the demo connect path RESOLVES, it does not throw", () => {
  // The corner control renders a rejection as a failed connection and offers "Retry", which is
  // the wrong story for a deliberate answer.
  //
  // Comments are stripped first: the prose above the code says "throw" and "rejects" for the
  // same reason the assertion looks for them, and the first version of this test failed on its
  // own explanation.
  const proxy = /const cornerWallet[\s\S]*?\n\}\);/.exec(shell)?.[0] ?? "";
  const code = proxy.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  expect(code).not.toMatch(/throw|reject/);
});

test("the note exists in all five locales", () => {
  expect(connectLocale.match(/papp\.demoConnectNote/g)?.length).toBe(5);
});

test("the toast dwell is long enough to read", () => {
  // 2.8s is the default, tuned for "Saved". This is two sentences a judge has to actually
  // read, and a message that vanishes first is the same as no message.
  expect(core).toContain('toast(t(key), "info", null, ev.detail?.ms ?? 7000)');
});

// ---- the kid's waiting screen ----

test("on DEMO the unblocking button is first and primary; on a real household it is not", () => {
  const fn = /function actions\([\s\S]*?\n\}/.exec(waiting)?.[0] ?? "";
  expect(fn).toContain("state.family?.demo_at");
  // demo: "Mom is here" blue and first. real: the camera blue and first, because a kid on a
  // real household genuinely IS waiting and the photo is the only useful thing they can do.
  expect(fn).toContain('`${here("blue")}${proof("gold")}`');
  expect(fn).toContain('`${proof("blue")}${here("gold")}`');
});

test("both buttons survive in both modes", () => {
  // Demoting the camera is the point; removing it would hide real product from a judge.
  const fn = /function actions\([\s\S]*?\n\}/.exec(waiting)?.[0] ?? "";
  expect(fn.match(/proof\(/g)?.length).toBeGreaterThanOrEqual(2);
  expect(fn.match(/here\(/g)?.length).toBeGreaterThanOrEqual(2);
});
