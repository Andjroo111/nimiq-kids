// Prove #305 on a running instance: a parent can SEE what the kid's tablet is doing, the
// waiting state is loud and taps through to the approval that ends it, and the sentence on
// the home screen is the same ruling the tablet itself is following.
//
//   BASE=http://127.0.0.1:3987 node parent-screen-state.mjs
//
// The unit tests pin the endpoint. What they cannot prove is the half a family meets: a
// section that only exists when a tablet does, a red row a parent can act on, and — the one
// thing an HTTP round trip cannot stand in for — the state changing on a phone nobody
// touched, because there is no SSE here and the 20s refresh IS the freshness contract.
//
// Boot a throwaway instance with a FRESH DB (a demo household is minted per run):
//
//   rm -f /tmp/scr.db
//   bun run build:shell   # else /dist/parent-shell.js 404s and every label renders its raw key
//   PORT=3987 DB_PATH=/tmp/scr.db NIMIQ_SIM=1 NIMIQ_NETWORK=test HATCH_DEMO_ENABLED=1 \
//     HATCH_DEMO_GRANT_LUNA=100000000000 bun run src/server.ts
//
// ⚠️ A DEMO HOUSEHOLD SHIPS NO LOCK WINDOW (`reason: no_windows`), so this script writes an
// always-on one through the #303 route first. Without it every state below is "Free right
// now" and the run proves nothing about the schedule half.
//
// Playwright resolves node_modules from the SCRIPT'S directory, not the cwd, and this repo
// does not depend on it: COPY this file somewhere that does (`~/Projects/sendhome`).

const BASE = process.env.BASE ?? "http://127.0.0.1:3987";
const OUT = process.env.OUT ?? "/tmp/scr";
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

const screens = async () => (await api("/api/parent/screen-state", {}, PARENT)).body.screens;
const deviceState = async () => (await api("/api/device/state", {}, DEVICE)).body;

// The window this whole run hangs on: always open, every day, so the state is decided by the
// routine rather than by what time it happens to be when somebody runs this.
const routine = (await api(`/api/routines?childId=${kid.id}`, {}, PARENT)).body.routines[0];
const win = await api(`/api/routines/${routine.id}/windows`,
  { method: "POST", body: JSON.stringify({ startHhmm: "00:00", endHhmm: "23:59", days: "1111111" }) }, PARENT);
check("setup: an always-on lock window saves", win.status === 201, JSON.stringify(win.body).slice(0, 160));

const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
const errors = [];
const ctx = await browser.newContext(phone);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

/** The token rides in the hash on the FIRST load only. Arriving with it a second time is a
 *  session handoff the app stops to confirm, and the run hangs on a screen that never paints. */
let signedIn = false;
const openHome = async () => {
  await page.goto(`${BASE}/parent/${signedIn ? "" : `#t=${PARENT}`}`, { waitUntil: "networkidle" });
  signedIn = true;
  await wait(2500);
};
const row = () => page.locator(".scr-row").first();
const rowText = async () => { await row().scrollIntoViewIfNeeded(); return flat(await row().textContent()); };
const openKid = async () => {
  await page.locator(`[data-kid="${kid.id}"]`).first().click();
  await wait(2000);
};
const lockCardText = async () => {
  const card = page.locator(".lock-card").first();
  await card.scrollIntoViewIfNeeded();
  return flat(await card.textContent());
};

// ------------------------------------------------- locked, because the routine is not done
await openHome();
{
  check("home: there is a Tablets section, because this household has one",
    (await page.locator(".scr-group").count()) === 1);
  check("home: one row per paired tablet, named for the kid it follows",
    (await page.locator(".scr-row").count()) === 1 && /Sam/.test(await rowText()), await rowText());
  const text = await rowText();
  check("home: it says WHY the screen is locked, by name",
    /Locked until Morning routine is done/i.test(text), text);
  check("home: and a plain locked screen is not the loud one",
    (await page.locator(".scr-row.urgent").count()) === 0);
  // Every string here is NEW, and a key added to src/locales after the last `build:shell` is
  // served as its own name. It reads as a rendered label at a glance and every check above
  // still passes, which is exactly how it ships. The screen is the only thing that can say.
  const home = flat(await page.locator("#view").textContent());
  check("home: no untranslated key is rendered as a label", !/papp\.[a-zA-Z]/.test(home),
    (home.match(/papp\.[a-zA-Z]+/g) ?? []).join(" "));
  await page.screenshot({ path: `${OUT}/01-locked.png` });

  // The same ruling, one screen over. This line used to read "Follows the schedule" over a
  // tablet locked solid, because the card could only describe the override row (#304).
  await openKid();
  const card = await lockCardText();
  check("kid page: the lock card tells the same truth, not just what a grown-up wrote",
    /Locked until Morning routine is done/i.test(card), card);
  await page.screenshot({ path: `${OUT}/02-kid-card.png` });
  await page.locator("#back").click();
  await wait(1500);
}

// ------------------------------------- a kid finishes it and is now WAITING on a grown-up
{
  const today = (await api(`/api/routines/${routine.id}/today`, {}, DEVICE)).body;
  for (const tr of today.taskRuns) {
    await api(`/api/task-runs/${tr.id}/done`, { method: "POST" }, DEVICE);
  }
  const server = (await screens())[0];
  check("server: the tablet is now waiting on an approval",
    server.state === "PENDING_APPROVAL" && server.approvalId, JSON.stringify(server).slice(0, 200));

  // NOBODY TOUCHES THE PHONE. This is the acceptance criterion: the parent's screen has to
  // catch up on its own. There is no SSE here on purpose (a bearer cannot ride an
  // EventSource), so the 20s refresh loop is the whole contract and it has to be real.
  await page.waitForSelector(".scr-row.urgent", { timeout: 30_000 });
  const text = await rowText();
  check("home: the row went red on its own, with no reload and no tap",
    /Waiting for you to say yes to Morning routine/i.test(text), text);
  await page.screenshot({ path: `${OUT}/03-waiting.png` });

  // ...and it is one tap from the thing that ends it.
  await row().click();
  await wait(2000);
  const target = page.locator(`#ap-${server.approvalId}`);
  check("tap: it lands on the approval itself, highlighted", (await target.count()) === 1
    && (await target.first().getAttribute("class")).includes("hl"),
    await flat(await page.locator("#view").textContent()).slice(0, 120));
  await page.screenshot({ path: `${OUT}/04-approval.png` });
}

// -------------------------------------------------------------- approved, so the screen is free
{
  const approvalId = (await screens())[0].approvalId;
  const ok = await api(`/api/approvals/${approvalId}/approve`, { method: "POST" }, PARENT);
  check("the approval goes through", ok.status === 200 || ok.status === 202, JSON.stringify(ok).slice(0, 160));
  await openHome();
  const text = await rowText();
  check("home: free again, and it says until when", /Free until \d/i.test(text), text);
  check("home: and the red is gone", (await page.locator(".scr-row.urgent").count()) === 0);
  await page.screenshot({ path: `${OUT}/05-free.png` });
}

// ------------------------------------------- a grown-up's lock, and a kid's bought minutes
{
  await api("/api/family/override",
    { method: "POST", body: JSON.stringify({ mode: "lock", childId: kid.id, untilMs: null }) }, PARENT);
  await openHome();
  const text = await rowText();
  check("home: a grown-up's lock is named as one", /Locked by a grown-up/i.test(text), text);
  check("tablet: and it is following that same override",
    (await deviceState()).reason === "override_lock", JSON.stringify(await deviceState()));
  await page.screenshot({ path: `${OUT}/06-grownup-lock.png` });

  const id = (await screens())[0];
  const parentRow = (await api("/api/parent/overview", {}, PARENT)).body
    .children.find((c) => c.id === kid.id).override;
  await api(`/api/family/override/${parentRow.id}`, { method: "DELETE" }, PARENT);
  const bought = await api(`/api/kids/${kid.id}/buy`,
    { method: "POST", body: JSON.stringify({ itemId: "item-screen-15" }) }, PARENT);
  check("the kid buys 15 minutes", bought.status === 200, JSON.stringify(bought).slice(0, 160));
  check("server: and the author of the row is the PURCHASE, not a grown-up",
    (await screens())[0].overrideSource === "purchase", JSON.stringify(id).slice(0, 120));

  await openHome();
  const paid = await rowText();
  check("home: bought minutes are named as bought, never as something a grown-up did",
    /Screen time they bought, until \d/i.test(paid), paid);
  await page.screenshot({ path: `${OUT}/07-bought.png` });
}

// ------------------------------------------------- no tablet, no section (the #306 rule)
{
  const deviceId = (await screens())[0].deviceId;
  const gone = await api(`/api/devices/${deviceId}`, { method: "DELETE" }, PARENT);
  check("the tablet is unpaired", gone.status === 200, JSON.stringify(gone).slice(0, 120));
  await openHome();
  check("home: the whole section is GONE, not drawn empty and not greyed",
    (await page.locator(".scr-group").count()) === 0 && (await page.locator(".scr-row").count()) === 0);
  check("home: and the roster is still there, so nothing took the screen down with it",
    (await page.locator(`[data-kid="${kid.id}"]`).count()) === 1);
  await page.screenshot({ path: `${OUT}/08-no-tablet.png` });
}

check("no console errors anywhere in the run", errors.length === 0, errors.join(" | "));
await ctx.close();
await browser.close();
console.log(failed ? "\nFAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
