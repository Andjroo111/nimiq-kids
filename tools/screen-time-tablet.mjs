// Prove #306 on a running instance, by what the kid's Treasure Box DRAWS.
//
//   BASE=http://127.0.0.1:3987 node screen-time-tablet.mjs
//
// A minute of screen time is only obeyed by a paired tablet. The Box sold them anyway, so a
// household with none paid real NIM for a minute nothing in the world could hear. The unit
// tests prove the filter and the refusal against an in-memory DB; what they cannot prove is
// that the SHELF disappears and comes back, which is the whole feature a family sees.
//
// Boot a throwaway RELAXED instance — that is the configuration where a tablet-less household
// can open the kid app at all, since a strict one authenticates the kid app with a device
// bearer and a household with no device therefore has nothing to sign in with:
//
//   rm -f /tmp/notablet.db
//   bun run build:shell   # else /dist/app-shell.js 404s and every tile renders its raw key
//   PORT=3987 DB_PATH=/tmp/notablet.db NIMIQ_SIM=1 NIMIQ_NETWORK=test HATCH_LEGACY_BOOT=1 \
//     HATCH_DEMO_GRANT_LUNA=100000000000 bun run src/server.ts
//
// Playwright resolves node_modules from the SCRIPT'S directory, not the cwd, and this repo
// does not depend on it: COPY this file somewhere that does (`~/Projects/sendhome`).

const BASE = process.env.BASE ?? "http://127.0.0.1:3987";
const OUT = process.env.OUT ?? "/tmp/notablet";
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

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const health = (await api("/health")).body;
console.log(`instance v${health.v} · network=${health.network} · sim=${health.sim}`);

// ---------------------------------------------------------------- a household with no tablet
const onboard = (await api("/api/onboard", {
  method: "POST",
  body: JSON.stringify({ parentLabel: "Andjroo", kidLabel: "Sam", address: "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD" }),
})).body;
const parentToken = onboard.token ?? onboard.parentToken;
const kid = onboard.child;
console.log(`household ${onboard.family.id} · kid ${kid.label}`);

// Money in the kid's wallet, so a refusal is a refusal and not a kid who could not afford it.
// Needs the instance booted with a family grant (HATCH_DEMO_GRANT_LUNA), else the hot wallet
// has nothing to give and this answers `budget_exhausted`.
const funded = await api(`/api/kids/${kid.id}/fund`, { method: "POST", body: JSON.stringify({ valueLuna: 200_000_000 }) }, parentToken);
if (funded.status >= 400) console.log(`  fund: ${funded.status} ${JSON.stringify(funded.body)}`);
const balance = async () => (await api(`/api/kids/${kid.id}/wallet`, {}, parentToken)).body.balanceLuna;
const before = await balance();
check("the kid has NIM to spend", before > 0, `${before} luna`);

const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

/** Open the kid's Treasure Box and report what it DREW: shelf headings and tiles. */
async function box(shot) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  // A bare "Failed to load resource" names nothing: keep the URL, so a 404 that is really a
  // missing icon cannot be mistaken for the feature failing to load.
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/kid/`, { waitUntil: "networkidle" });
  await wait(2500);
  const entry = page.locator(".account-entry").filter({ hasText: kid.label });
  if (await entry.count()) { await entry.first().click(); await wait(2500); }
  // The #123 switch gate: two taps on the secret picture, then the same two to confirm.
  for (let round = 0; round < 2; round++) {
    if (await page.locator(".k-secret-pic").count() === 0) break;
    await page.locator('.k-secret-pic[data-i="0"]').click();
    await wait(300);
    await page.locator('.k-secret-pic[data-i="5"]').click();
    await wait(1500);
  }
  await wait(1500);
  await page.locator("#dock-box").first().click({ timeout: 10_000 });
  await wait(3000);
  // The Box FADES IN: a shot taken the moment `.bx-item` exists is a white page with the DOM
  // already correct, so wait for the tiles to be opaque before reading or photographing it.
  await page.waitForFunction(() => {
    const t = document.querySelector(".bx-item");
    return t !== null && Number(getComputedStyle(t).opacity) > 0.9;
  }, { timeout: 15_000 }).catch(() => {});
  await wait(800);
  // `POST /kids/:id/unlock` is the #123 switch gate and wants a DEVICE bearer, which a
  // browser driving a relaxed instance does not hold. It 401s identically before and after
  // pairing and has nothing to do with the Box; everything else counts.
  const noise = (e) => /\/unlock\b/.test(e) || /Failed to load resource/.test(e);
  const shelves = await page.locator(".bx-shelf-hd").allTextContents();
  const tiles = await page.locator(".bx-item").allTextContents();
  await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  await ctx.close();
  return {
    shelves: shelves.map((s) => s.trim()),
    tiles: tiles.map((t) => t.replace(/\s+/g, " ").trim()),
    errors: errors.filter((e) => !noise(e)),
  };
}

// ------------------------------------------------------------------ with no tablet paired
const noTablet = await box("box-no-tablet");
check("no Screen time shelf is drawn", !noTablet.shelves.some((s) => /screen/i.test(s)), noTablet.shelves.join(" | "));
// "N minutes", never a bare /minute/: `Stay up 30 minutes late` is a COUPON and belongs here.
const minuteTiles = (r) => r.tiles.filter((t) => /^\d+ minutes/i.test(t));
check("and no minutes tile with it", minuteTiles(noTablet).length === 0, noTablet.tiles.join(" | "));
check("the rest of the Box is still there", noTablet.shelves.length > 0 && noTablet.tiles.length > 0,
  `${noTablet.shelves.length} shelves, ${noTablet.tiles.length} tiles`);
check("no console errors drawing it", noTablet.errors.length === 0, noTablet.errors.join(" | "));

const refused = await api(`/api/kids/${kid.id}/buy`, { method: "POST", body: JSON.stringify({ itemId: "item-screen-15" }) }, parentToken);
check("a stale client asking anyway is refused 409 no_tablet",
  refused.status === 409 && refused.body.error === "no_tablet", `${refused.status} ${JSON.stringify(refused.body)}`);
check("and not one luna moved", (await balance()) === before, `${await balance()} vs ${before}`);
const purchases = (await api(`/api/kids/${kid.id}/purchases`, {}, parentToken)).body.purchases ?? [];
check("no receipt was written", purchases.length === 0, JSON.stringify(purchases));

// ------------------------------------------------------------------------- pair the tablet
const code = (await api("/api/parent/pair-code", { method: "POST" }, parentToken)).body.code;
const paired = await api("/api/devices/register", { method: "POST", body: JSON.stringify({ pairCode: code, label: "Sam's tablet" }) });
check("a tablet pairs", paired.status === 200 || paired.status === 201, String(paired.status));

const withTablet = await box("box-with-tablet");
check("the Screen time shelf is back", withTablet.shelves.some((s) => /screen/i.test(s)), withTablet.shelves.join(" | "));
check("with all three tiles on it", minuteTiles(withTablet).length === 3, withTablet.tiles.join(" | "));
check("no console errors drawing it", withTablet.errors.length === 0, withTablet.errors.join(" | "));

const bought = await api(`/api/kids/${kid.id}/buy`, { method: "POST", body: JSON.stringify({ itemId: "item-screen-15" }) }, parentToken);
check("and the same buy now goes through", bought.status === 200 && bought.body.minutes === 15,
  `${bought.status} ${JSON.stringify(bought.body)}`);
check("paying for it moved the kid's NIM", (await balance()) < before, `${await balance()} vs ${before}`);

await browser.close();
console.log(failed ? "\nFAILED" : "\nALL PASS");
process.exit(failed ? 1 : 0);
