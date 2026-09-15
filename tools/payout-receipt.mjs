// Prove the payout receipt (#122) against a running instance, in a real browser.
//
//   BASE=http://127.0.0.1:3977 node tools/payout-receipt.mjs
//
// There is no DOM test harness in this repo — every test is server-side — and both halves of
// this are client work, so this walks what a person actually does: a kid hands a job in and
// taps approve on the tablet, and a parent approves the next one from their phone. It asserts
// the link is THERE, that it points at the explorer prefix `/health` publishes with the
// transaction the approve response returned, and that no screen gained a console error.
//
// It goes through /demo and clicks the real button rather than writing a device token into
// localStorage: the live demo serves the GATE at /kid/, so a script that jumps straight there
// tests a path no visitor takes.
//
// Requires Playwright (`npx playwright install chromium`) and an instance with the demo
// enabled. NEVER point it at a live instance: it approves real payouts.

const BASE = process.env.BASE ?? "http://127.0.0.1:3977";
const OUT = process.env.OUT ?? "/tmp";
const { chromium, devices } = await import("playwright").catch(() => {
  console.error("Playwright is required: npm i -D playwright && npx playwright install chromium");
  process.exit(1);
});

const api = async (path, opts = {}, token) => {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const txt = await r.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt.slice(0, 300); }
  return { status: r.status, body };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const health = (await api("/health")).body;
console.log(`instance v${health.v} · network=${health.network} · sim=${health.sim} · explorerTx=${health.explorerTx}`);
if (!health.explorerTx) {
  console.error("FAIL: /health publishes no explorerTx, so neither surface can render a link.");
  process.exit(1);
}

const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
const watch = (page, errors) => {
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
};
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

// ---------------------------------------------------------------- the kid's tablet
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);

  // The gate mints the household and hands this browser its device token. Click the button.
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
  await wait(2000);
  await page.click("#kid");
  await page.waitForLoadState("networkidle");
  await wait(3000);

  // "Who are you?" — the roster, then that kid's board.
  await page.locator(".account-entry").first().click();
  await wait(3000);

  // The board's groups are an ACCORDION: a closed group keeps its rows in the DOM but
  // invisible, so a click finds the card and cannot reach it.
  await page.evaluate(() => document.querySelectorAll(".ch-group").forEach((g) => g.classList.add("is-open")));
  await wait(500);

  // The seeded household plants one SUBMITTED chore per kid — a payout waiting to be approved,
  // which is the whole reason a judge can do anything at all on their first tap. On a demo
  // household tapping it approves and pays right there (chart.js approveOwnChoreOnDemo).
  const waiting = page.locator('.ch-task[data-state="waiting"]').first();
  check("kid: a payout is waiting on the board", await waiting.count() === 1);
  if (await waiting.count()) { await waiting.click(); await wait(3000); } // under the overlay's own 5.2s window

  const shot = `${OUT}/receipt-kid.png`;
  await page.screenshot({ path: shot });
  const chip = page.locator("#celebrate-receipt");
  const shown = await chip.count();
  check("kid: the celebration offers the receipt", shown === 1, shown ? await chip.textContent() : "no #celebrate-receipt");
  if (shown) {
    // Tapping it must open the explorer, and must NOT close the overlay on the way.
    const [popup] = await Promise.all([ctx.waitForEvent("page"), chip.click()]);
    const url = popup.url();
    check("kid: it opens the explorer with a real hash", url.startsWith(health.explorerTx) && url.length > health.explorerTx.length + 30, url);
    check("kid: the overlay survives the tap", await page.locator("#celebrate-receipt").count() === 1);
    await popup.close();
  }
  check("kid: no console errors", errors.length === 0, errors.join(" | "));
  console.log(`      screenshot ${shot}`);
  await ctx.close();
}

// ---------------------------------------------------------------- the parent's phone
{
  const { body: mint } = await api("/api/demo/family", { method: "POST" });
  const kid = mint.children[0];
  const made = await api("/api/chores", {
    method: "POST",
    body: JSON.stringify({ childId: kid.id, catalogId: "bed", rewardLuna: 4200 * 1e5 }),
  }, mint.parentToken);
  await api(`/api/chores/${made.body.chore.id}/submit`, { method: "POST", body: "{}" }, mint.deviceToken);

  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(`${BASE}/parent/#t=${mint.parentToken}`, { waitUntil: "networkidle" });
  await wait(3000);
  await page.click('[data-tab="approvals"]');
  await wait(2000);

  const approve = page.locator("[data-approve]").first();
  check("parent: an approval is on screen to approve", await approve.count() === 1);
  if (await approve.count()) {
    await approve.click();
    await wait(6000); // a real payout is a chain round trip
  }
  const shot = `${OUT}/receipt-parent.png`;
  await page.screenshot({ path: shot });
  const link = page.locator(".nq-toast-action");
  const shown = await link.count();
  check("parent: the success toast offers the receipt", shown === 1, shown ? await link.textContent() : "no .nq-toast-action");
  if (shown) {
    const href = await link.getAttribute("href");
    check("parent: it points at the explorer with a real hash", href.startsWith(health.explorerTx) && href.length > health.explorerTx.length + 30, href);
    check("parent: opens in a new tab, noopener", await link.getAttribute("target") === "_blank" && (await link.getAttribute("rel")).includes("noopener"));
  }
  check("parent: no console errors", errors.length === 0, errors.join(" | "));
  console.log(`      screenshot ${shot}`);
  await ctx.close();
}

await browser.close();
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
