// Prove #303 on a running instance: a parent sets the lock schedule, and the tablet hears it.
//
//   BASE=http://127.0.0.1:3971 node lock-windows.mjs
//
// The lock machine could always READ a window; until this nothing could write one, so a
// household ran on whatever `src/scripts/seed.ts` happened to say. The unit tests pin the
// three routes and their refusals. What they cannot prove is the half a family actually
// meets: the schedule section on the routine's card, the sentence the sheet says back, and
// the paired tablet re-computing its own state off a change a parent made in a browser.
//
// Boot a throwaway instance with a FRESH DB (a demo household is minted per run, and a stale
// one would put this run's assertions against the last run's rows):
//
//   rm -f /tmp/lockwin.db
//   bun run build:shell   # else /dist/app-shell.js 404s and every tile renders its raw key
//   PORT=3971 DB_PATH=/tmp/lockwin.db NIMIQ_SIM=1 NIMIQ_NETWORK=test HATCH_DEMO_ENABLED=1 \
//     HATCH_DEMO_GRANT_LUNA=100000000000 bun run src/server.ts
//
// ⚠️ `HATCH_DEMO_ENABLED=1` is not optional: without it `POST /api/demo/family` answers 404
// `demo_disabled` and this script dies on the mint with no household to drive.
//
// Playwright resolves node_modules from the SCRIPT'S directory, not the cwd, and this repo
// does not depend on it: COPY this file somewhere that does (`~/Projects/sendhome`).

const BASE = process.env.BASE ?? "http://127.0.0.1:3971";
const OUT = process.env.OUT ?? "/tmp/lockwin";
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

const routineOf = async () =>
  (await api(`/api/routines?childId=${kid.id}&includeInactive=1`, {}, PARENT)).body.routines[0];
const deviceState = async () => (await api("/api/device/state", {}, DEVICE)).body;

/** Listen on the tablet's own SSE stream and hand back everything it was pushed. This is the
 *  acceptance criterion the HTTP round-trip cannot stand in for: the wrapper is holding this
 *  pipe open, and a schedule change has to arrive on it without anyone asking. */
async function streamStates(ms) {
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
        for (const chunk of buf.split("\n\n")) {
          const m = /event:\s*state[\s\S]*?data:\s*(\{.*\})/.exec(chunk);
          if (m) { try { seen.push(JSON.parse(m[1])); } catch { /* partial frame */ } }
        }
        buf = buf.slice(buf.lastIndexOf("\n\n") + 1);
      }
    } catch { /* aborted */ }
  })();
  return {
    seen,
    stop: async () => { ctrl.abort(); await pump.catch(() => {}); return seen; },
  };
}

const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
const errors = [];
const ctx = await browser.newContext(phone);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const openBoard = async () => {
  await page.goto(`${BASE}/parent/#t=${PARENT}`, { waitUntil: "networkidle" });
  await wait(2500);
  await page.locator(`[data-kid="${kid.id}"]`).first().click();
  await wait(2000);
  await page.click("#go-board");
  await wait(2500);
};
const routineCard = () => page.locator(".card.set-card").filter({ has: page.locator("[data-addlock]") }).first();

// --------------------------------------------------------- the schedule a family starts with
await openBoard();
{
  const card = routineCard();
  await card.scrollIntoViewIfNeeded();
  const text = flat(await card.textContent());
  check("parent: the routine's card has a schedule section", /Locks the tablet/i.test(text), text.slice(-200));
  check("parent: and its empty state says what a window IS, not that there are none",
    /stays locked until this routine is done and approved/i.test(text), text.slice(-200));
  check("the tablet is unlocked with nothing set",
    (await deviceState()).state === "UNLOCKED" && (await deviceState()).reason === "no_windows",
    JSON.stringify(await deviceState()));
  await page.screenshot({ path: `${OUT}/01-empty.png` });
}

// ------------------------------------------------------------------ a parent sets one
{
  await routineCard().locator("[data-addlock]").click();
  await wait(900);
  await page.fill("#bd-lock-start", "06:30");
  await page.fill("#bd-lock-end", "08:30");
  // Mon..Fri are on by default; the sheet opens on the schedule most households want.
  const pressed = await page.locator('.bd-day[aria-pressed="true"]').count();
  check("sheet: it opens on weekdays, and Monday is index 0", pressed === 5,
    `${pressed} days lit, first=${await page.locator('[data-dow="0"]').getAttribute("aria-pressed")}, ` +
    `sun=${await page.locator('[data-dow="6"]').getAttribute("aria-pressed")}`);
  const echo = flat(await page.locator("#bd-lock-echo").textContent());
  check("sheet: the echo says the rule back in words", /Weekdays/i.test(echo)
    && /6:30/.test(echo) && /8:30/.test(echo) && /done and approved/i.test(echo), echo);
  check("sheet: and names the routine it is about", /routine/i.test(echo), echo);
  await page.screenshot({ path: `${OUT}/02-sheet.png` });
  await page.click("#bd-lock-save");
  await wait(2500);

  const text = flat(await routineCard().textContent());
  check("parent: the card now lists the window", /6:30/.test(text) && /8:30/.test(text), text.slice(-220));
  check("parent: with the days in words, not a mask", /Weekdays/i.test(text) && !/1111100/.test(text),
    text.slice(-220));
  await routineCard().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/03-set.png` });

  const stored = (await routineOf()).windows;
  check("the window rides on the routine, stored as the machine reads it",
    stored.length === 1 && stored[0].start_hhmm === "06:30" && stored[0].end_hhmm === "08:30"
      && stored[0].days === "1111100", JSON.stringify(stored));
}

// ------------------------------------------- a change reaches the tablet, on its open stream
{
  const stream = await streamStates();
  await wait(1200);
  const before = stream.seen.length; // the stream sends one immediately on connect
  check("tablet: its stream is open and it is not locked", before >= 1
    && stream.seen[before - 1].state === "UNLOCKED", JSON.stringify(stream.seen[before - 1]));

  // Edit the SAME window to cover the whole day, every day, from the browser. Nothing polls
  // here: the next state the tablet is handed has to arrive because the parent saved.
  await routineCard().locator("[data-lock]").first().click();
  await wait(900);
  await page.fill("#bd-lock-start", "00:00");
  await page.fill("#bd-lock-end", "23:59");
  for (const d of [5, 6]) await page.locator(`[data-dow="${d}"]`).click();
  const echo = flat(await page.locator("#bd-lock-echo").textContent());
  check("sheet: seven days reads as every day", /Every day/i.test(echo), echo);
  await page.click("#bd-lock-save");
  await wait(2500);

  const pushed = await stream.stop();
  const last = pushed[pushed.length - 1];
  check("tablet: it was pushed a new state without asking", pushed.length > before, `${pushed.length} events`);
  check("tablet: and that state is LOCKED, because the routine is not done",
    last?.state === "LOCKED_ROUTINE" && last?.reason === "routine_due", JSON.stringify(last));
}

// -------------------------------------------------------------- a window that crosses midnight
{
  await routineCard().locator("[data-lock]").first().click();
  await wait(900);
  await page.fill("#bd-lock-start", "20:30");
  await page.fill("#bd-lock-end", "06:30");
  const echo = flat(await page.locator("#bd-lock-echo").textContent());
  check("sheet: an end before its start is a bedtime window, not an error",
    /next morning/i.test(echo) && /8:30\s*PM|20:30/.test(echo), echo);
  await page.screenshot({ path: `${OUT}/04-overnight.png` });
  await page.click("#bd-lock-save");
  await wait(2500);

  const stored = (await routineOf()).windows;
  check("the overnight window round-trips exactly as typed",
    stored.length === 1 && stored[0].start_hhmm === "20:30" && stored[0].end_hhmm === "06:30",
    JSON.stringify(stored));
  const text = flat(await routineCard().textContent());
  check("parent: and the card shows it", /6:30/.test(text) && /(8:30|20:30)/.test(text), text.slice(-220));
}

// --------------------------------------------------------------------- and taking it away
{
  await routineCard().locator("[data-lock]").first().click();
  await wait(900);
  await page.click("#bd-lock-remove");
  await wait(2500);
  const text = flat(await routineCard().textContent());
  check("parent: removing it puts the empty state back",
    /stays locked until this routine is done and approved/i.test(text), text.slice(-200));
  check("the row is gone, not retired", (await routineOf()).windows.length === 0);
  const state = await deviceState();
  check("tablet: unlocked again, with nothing scheduled",
    state.state === "UNLOCKED" && state.reason === "no_windows", JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/05-removed.png` });
}

check("no console errors anywhere in the run", errors.length === 0, errors.join(" | "));
await ctx.close();
await browser.close();
console.log(failed ? "\nFAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
