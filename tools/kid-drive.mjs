// HOW TO DRIVE THE KID APP IN A BROWSER (#371). Import this; do not rediscover it.
//
// Three things stand between a fresh demo instance and the kid's board, and the second one
// costs an hour if you meet it cold:
//
// 1. "Who are you?" — the shared-tablet kid picker. Just a click.
//
// 2. THE DEVICE TOKEN. The kid app reads it from `localStorage["kid.deviceToken"]`
//    (public/kid/js/api.js) and every kid-side WRITE is a 401 without it. A plain
//    page.goto() has no token, so the app looks like it loaded and then refuses everything.
//
// 3. "Pick your secret pictures" — first-run enrolment: tap two, confirm the same two.
//    The picture list is CACHED (switch-gate.js `cache`), so `data-i` IS stable across the
//    two rounds and tapping the same indices twice is correct.
//
// ⚠️ THE TRAP THAT WASTES THE HOUR. With no device token, step 3's confirm fails on the
// SERVER and the screen says **"Not those ones. Try again."** — which reads as "your taps
// were wrong" and sends you off chasing the grid, the shuffle and the tile identity, none of
// which is the problem. That misleading message is fixed alongside this file (a 401 now says
// the tablet is not set up), but the shape of the lesson stands: on this screen, read the
// server's answer before you believe the copy.
//
// WHAT THIS PROMISES, since a driver is only worth what its failure mode is worth: when
// `openKidBoard` returns, the board rendered (`.k-chart` is on the page) and nothing threw on
// the way there. Both are asserted, and both were added after #408, where a missing import
// threw out of the whole board render and this file reported success anyway.
//
// Playwright resolves node_modules from the SCRIPT'S directory and this repo does not depend
// on it, so a driver that imports this must live somewhere that does (`~/Projects/sendhome`).

/** Mint a demo household and return everything a kid driver needs. */
export async function demoHousehold(base) {
  const r = await fetch(`${base}/api/demo/family`, {
    method: "POST", headers: { "content-type": "application/json" },
  });
  return r.json(); // { parentToken, deviceToken, children: [...] }
}

/**
 * Open the kid app as `child`, past the picker and past enrolment, and leave the page on the
 * board. Returns the page.
 *
 * @param ctx a Playwright BrowserContext that has NOT navigated yet — the token is installed
 *   with addInitScript, which only applies to loads made after it is set.
 */
export async function openKidBoard(ctx, { base, deviceToken, child, secret = [0, 1] }) {
  // ⚠️ An init script runs on EVERY document, `about:blank` included, and localStorage on an
  // opaque origin throws SecurityError. That lands in a driver's own console-error tally and
  // reads as a bug in the app. The catch only ever swallows the blank-page case; a real page
  // load reaching this line and failing would strand the token, and the board never rendering
  // is how that shows up.
  await ctx.addInitScript((t) => {
    try { localStorage.setItem("kid.deviceToken", t); } catch { /* about:blank */ }
  }, deviceToken);
  const page = await ctx.newPage();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // AN UNCAUGHT ERROR IS A FAILED DRIVE, and it has to be collected as it happens: a module
  // that throws leaves the last screen standing, so the page still has a body, a title and a
  // screenshot, and nothing later can tell the difference. #408 threw ReferenceError out of
  // the whole board render and the driver reported success. They are thrown at the end rather
  // than here, because the caller wants to know the drive failed AND why, and a listener
  // cannot throw into the caller's stack.
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));

  await page.goto(`${base}/kid/`, { waitUntil: "networkidle" });
  await wait(2500);

  const pick = page.getByText(child.label, { exact: true }).first();
  if (await pick.count()) { await pick.click(); await wait(2000); }

  // Two rounds: choose, then confirm. Same indices both times — see the cache note above.
  for (let round = 0; round < 2; round++) {
    if (!(await page.locator(".k-secret-pic").count())) break;
    for (const i of secret) {
      await page.locator(`.k-secret-pic[data-i="${i}"]`).click();
      await wait(350);
    }
    await wait(1600);
  }
  await wait(2500);

  await page.waitForSelector(BOARD_SELECTOR, { timeout: 10_000 }).catch(() => {});
  const failure = arrivalFailure({
    hasBoard: (await page.locator(BOARD_SELECTOR).count()) > 0,
    bodyText: (await page.locator("body").textContent()) ?? "",
    pageErrors,
  });
  if (failure) throw new Error(failure);
  return page;
}

/** `showChart`'s own root element. Nothing else in the kid app renders it, so its presence
 *  IS the board. */
export const BOARD_SELECTOR = ".k-chart";

/**
 * Did the drive arrive? Null when it did, the sentence to throw when it did not.
 *
 * ASSERT THE BOARD, do not deny a list of gates. This used to be
 * `if (/secret pictures|Who are you/i.test(body)) throw`, a check that can only catch the two
 * screens it happens to name. The CONFIRM step says "Tap the same 2 pictures again" and
 * matches neither, so a driver stuck on enrolment was handed back as a SUCCESS and
 * screenshotted the gate.
 *
 * That is how #408 stayed invisible. `chart.js` used `stickerNode` without importing it, so
 * a board carrying any placed sticker threw ReferenceError out of the whole render, the last
 * screen stayed standing, and this file said the board had been reached.
 *
 * A thrown error is a failure even when the board IS present: a module can throw after
 * painting and leave a board that no longer answers a tap.
 *
 * Pure and exported, so src/kid-drive-guard.test.ts can prove it rejects the exact screen
 * that used to pass. A guard nothing exercises is a guard nobody knows is inverted.
 */
export function arrivalFailure({ hasBoard, bodyText = "", pageErrors = [] }) {
  if (pageErrors.length) {
    return `kid-drive: the page threw ${pageErrors.length} error(s) on the way to the board:\n  ${pageErrors.join("\n  ")}`;
  }
  if (!hasBoard) {
    return `kid-drive: never reached the board. Screen reads: ${String(bodyText).replace(/\s+/g, " ").trim().slice(0, 160)}`;
  }
  return null;
}
