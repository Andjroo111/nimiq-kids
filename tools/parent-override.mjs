// Prove #304 on a running instance: a parent locks and unlocks the tablet from their phone,
// and the tablet obeys on the stream it is already holding open.
//
//   BASE=http://127.0.0.1:3972 node parent-override.mjs
//
// `POST /api/family/override` has been live and tested since Phase B with nothing in
// `public/parent/` calling it, so the only thing in the product that could write an unlock
// was a kid spending NIM. The unit tests pin the routes and the new refusal. What they
// cannot prove is the half a family meets: the card on the kid's page, the four lengths in
// the sheet, and a paired tablet re-computing its state off a tap made in a browser.
//
// Boot a throwaway instance with a FRESH DB (a demo household is minted per run):
//
//   rm -f /tmp/ovr.db
//   bun run build:shell   # else /dist/app-shell.js 404s and every label renders its raw key
//   PORT=3972 DB_PATH=/tmp/ovr.db NIMIQ_SIM=1 NIMIQ_NETWORK=test HATCH_DEMO_ENABLED=1 \
//     HATCH_DEMO_GRANT_LUNA=100000000000 bun run src/server.ts
//
// ⚠️ `HATCH_DEMO_ENABLED=1` is not optional: without it `POST /api/demo/family` answers 404
// `demo_disabled` and this script dies on the mint with no household to drive.
//
// Playwright resolves node_modules from the SCRIPT'S directory, not the cwd, and this repo
// does not depend on it: COPY this file somewhere that does (`~/Projects/sendhome`).

const BASE = process.env.BASE ?? "http://127.0.0.1:3972";
const OUT = process.env.OUT ?? "/tmp/ovr";
const { chromium, devices } = await import("playwright");
const fs = await import("node:fs");
fs.mkdirSync(OUT, { recursive: true });

const api = async (path, opts = {}, token) => {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const txt = await r.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt.slice(0, 300); }
  return { status: r.status, body };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => (s ?? "").replace(/\s+/g, " ").trim();

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failed = true;
};

const health = (await api("/health")).body;
console.log(`instance v${health.v} · network=${health.network} · sim=${health.sim}`);

const { body: mint } = await api("/api/demo/family", { method: "POST" });
const kid = mint.children[0];
const PARENT = mint.parentToken;
const DEVICE = mint.deviceToken;

const deviceState = async () => (await api("/api/device/state", {}, DEVICE)).body;
const kidRow = async () =>
  (await api("/api/parent/overview", {}, PARENT)).body.children.find((c) => c.id === kid.id);

/** Listen on the tablet's own SSE stream and hand back everything it was pushed. The
 *  acceptance criterion an HTTP round trip cannot stand in for: the wrapper is holding this
 *  pipe open, and a parent's tap has to arrive on it without anyone asking. */
async function streamStates() {
  const ctrl = new AbortController();
  const seen = [];
  const res = await fetch(`${BASE}/api/device/state/stream`, {
    headers: { Authorization: `Bearer ${DEVICE}` }, signal: ctrl.signal,
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (const chunk of buf.split("\n\n").slice(0, -1)) {
          const data = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (data) { try { seen.push(JSON.parse(data.slice(5).trim())); } catch { /* heartbeat */ } }
        }
        buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
      }
    } catch { /* aborted */ }
  })();
  return { seen, stop: async () => { ctrl.abort(); await pump; return seen; } };
}

const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
const errors = [];
const ctx = await browser.newContext(phone);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const card = () => page.locator(".lock-card").first();
const cardText = async () => { await card().scrollIntoViewIfNeeded(); return flat(await card().textContent()); };
/** The token rides in the hash on the FIRST load only. It is in localStorage after that,
 *  and arriving with it a second time is a session handoff the app stops to confirm. */
let signedIn = false;
const openKid = async () => {
  await page.goto(`${BASE}/parent/${signedIn ? "" : `#t=${PARENT}`}`, { waitUntil: "networkidle" });
  signedIn = true;
  await wait(2500);
  await page.locator(`[data-kid="${kid.id}"]`).first().click();
  await wait(2000);
};
/** Open one of the two sheets and tap a length by its visible label. */
const choose = async (which, label) => {
  await page.locator(`[data-ovr="${which}"]`).click();
  await wait(900);
  await page.locator(".ovr-choice", { hasText: label }).first().click();
  await wait(2500);
};

// --------------------------------------------------------------- a household with no override
await openKid();
{
  const text = await cardText();
  check("parent: the kid's page has a screen-control card", text.length > 0, text);
  check("parent: with nothing set it says the schedule is in charge",
    /Follows the schedule/i.test(text), text);
  check("parent: and offers no Clear, because there is nothing of theirs to take back",
    (await page.locator('[data-ovr="clear"]').count()) === 0);
  check("tablet: unlocked, on its own derived state",
    (await deviceState()).state === "UNLOCKED", JSON.stringify(await deviceState()));
  await page.screenshot({ path: `${OUT}/01-schedule.png` });
}

// ------------------------------------------------------ giving screen time, for a set length
{
  await page.locator('[data-ovr="unlock"]').click();
  await wait(900);
  const labels = await page.locator(".ovr-choice").allTextContents();
  check("sheet: four lengths, and the open-ended one reads last on a gift",
    labels.length === 4 && /15/.test(labels[0]) && /30/.test(labels[1])
      && /hour/i.test(labels[2]) && /Until I turn it off/i.test(labels[3]), JSON.stringify(labels));
  await page.screenshot({ path: `${OUT}/02-give-sheet.png` });

  const stream = await streamStates();
  await wait(1200);
  const before = stream.seen.length;   // the stream sends one immediately on connect

  await page.locator(".ovr-choice", { hasText: "30" }).first().click();
  await wait(2500);

  const text = await cardText();
  check("parent: the card now says screen time is on, and until when",
    /Screen time on until \d/i.test(text), text);
  const row = await kidRow();
  const mins = Math.round((row.override.until_ms - Date.now()) / 60000);
  check("the override is the parent's own, expiring in about 30 minutes",
    row.override.source === "parent" && row.override.mode === "unlock" && mins >= 29 && mins <= 30,
    `${row.override.source}/${row.override.mode} ${mins}min`);

  const pushed = await stream.stop();
  const last = pushed[pushed.length - 1];
  check("tablet: it was pushed a new state without asking", pushed.length > before, `${pushed.length} events`);
  check("tablet: and that state is unlocked BY the override",
    last?.state === "UNLOCKED" && last?.reason === "override_unlock", JSON.stringify(last));
  await page.screenshot({ path: `${OUT}/03-given.png` });
}

// ------------------------------------------------------------- locking, open ended, and Clear
{
  const stream = await streamStates();
  await wait(1200);
  const before = stream.seen.length;

  await page.locator('[data-ovr="lock"]').click();
  await wait(900);
  const labels = await page.locator(".ovr-choice").allTextContents();
  check("sheet: on a lock the open-ended choice reads FIRST",
    /Until I turn it back on/i.test(labels[0]), JSON.stringify(labels));
  await page.screenshot({ path: `${OUT}/04-lock-sheet.png` });
  await page.locator(".ovr-choice", { hasText: "Until I turn it back on" }).first().click();
  await wait(2500);

  const text = await cardText();
  check("parent: the card says a grown-up locked it, with no clock on it",
    /Locked by a grown-up$/i.test(text.replace(/(Lock now|Give screen time|Clear)/g, "").trim()),
    text);
  check("parent: and Clear is offered now that a grown-up's row exists",
    (await page.locator('[data-ovr="clear"]').count()) === 1);

  const pushed = await stream.stop();
  const last = pushed[pushed.length - 1];
  check("tablet: pushed straight to locked, by the override and not a routine",
    last?.state === "LOCKED_ROUTINE" && last?.reason === "override_lock", JSON.stringify(last));
  await page.screenshot({ path: `${OUT}/05-locked.png` });
}

// ------------------------------------- minutes the kid PAID for, underneath a grown-up's lock
{
  const buy = await api(`/api/kids/${kid.id}/buy`,
    { method: "POST", body: JSON.stringify({ itemId: "item-screen-15" }) }, PARENT);
  check("the kid can still buy screen time while grounded? no: the Box refuses it first",
    buy.status === 409 && buy.body.error === "locked_by_parent", JSON.stringify(buy));

  // So buy them with the lock lifted, then put the lock back on top of them. This is the
  // state the card has to be honest about: a purchase hidden under a parent's row.
  const clearRes = await api(`/api/family/override/${(await kidRow()).override.id}`,
    { method: "DELETE" }, PARENT);
  check("clearing the grown-up's lock over the API works", clearRes.status === 200, JSON.stringify(clearRes));
  const bought = await api(`/api/kids/${kid.id}/buy`,
    { method: "POST", body: JSON.stringify({ itemId: "item-screen-15" }) }, PARENT);
  check("and the kid's 15 minutes go through", bought.status === 200, JSON.stringify(bought));

  // Back in through the front door rather than a reload: `state.kidId` does not survive a
  // page load, so a reload lands on the family home and there is no card to read.
  await openKid();
  {
    const text = await cardText();
    check("parent: a purchase is NAMED as one, never as something a grown-up did",
      /Screen time they bought, until \d/i.test(text), text);
    check("parent: and Clear is not offered on it, because those minutes are not theirs to take",
      (await page.locator('[data-ovr="clear"]').count()) === 0);
    await page.screenshot({ path: `${OUT}/06-bought.png` });
  }

  const purchaseId = (await kidRow()).purchasedUnlock.id;
  const refused = await api(`/api/family/override/${purchaseId}`, { method: "DELETE" }, PARENT);
  check("the server refuses it too, not just the screen",
    refused.status === 409 && refused.body.error === "purchased_minutes", JSON.stringify(refused));

  await choose("lock", "Until I turn it back on");
  {
    const text = await cardText();
    check("parent: a grown-up's lock is what shows, because author beats recency",
      /Locked by a grown-up/i.test(text), text);
    check("parent: and the card says the bought minutes are still there, waiting",
      /min they bought come back when you clear this/i.test(text), text);
    check("tablet: locked, over paid-for minutes",
      (await deviceState()).reason === "override_lock", JSON.stringify(await deviceState()));
    await page.screenshot({ path: `${OUT}/07-underneath.png` });
  }

  await page.locator('[data-ovr="clear"]').click();
  await wait(2500);
  {
    const text = await cardText();
    check("parent: clearing the lock hands the purchase back, it does not end it",
      /Screen time they bought, until \d/i.test(text), text);
    const row = await kidRow();
    check("and it is the SAME row with the SAME expiry, not a fresh clock",
      row.override.id === purchaseId && row.override.source === "purchase",
      JSON.stringify(row.override));
    check("tablet: unlocked again, on the minutes the kid paid for",
      (await deviceState()).reason === "override_unlock", JSON.stringify(await deviceState()));
    await page.screenshot({ path: `${OUT}/08-handed-back.png` });
  }
}

check("no console errors anywhere in the run", errors.length === 0, errors.join(" | "));
await ctx.close();
await browser.close();
console.log(failed ? "\nFAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
