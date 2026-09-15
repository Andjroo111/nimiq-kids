// Prove #360 on a running instance: the parent app is a real layout on a tablet, not a
// 460px phone column floating in the middle of an empty grey page.
//
//   BASE=http://127.0.0.1:3993 OUT=/tmp/tab node parent-tablet.mjs
//
// What no unit test can hold: this is a question about painted geometry at a width nobody
// had ever loaded the app at. The three facts below are measured off the real boxes —
// the navy header spans the viewport, the bottom bar spans the viewport, and the reading
// column stays a column and stays centred under both. The phone case is measured in the
// same run, because the whole risk of a min-width breakpoint is that it leaks downward.
//
// Boot a throwaway instance with a FRESH DB (a demo household is minted per run):
//
//   rm -f /tmp/tab.db
//   bun run build:shell   # else /dist/parent-shell.js 404s and every label renders its raw key
//   PORT=3993 DB_PATH=/tmp/tab.db NIMIQ_SIM=1 NIMIQ_NETWORK=test HATCH_DEMO_ENABLED=1 \
//     HATCH_DEMO_GRANT_LUNA=100000000000 bun run src/server.ts
//
// Playwright resolves node_modules from the SCRIPT'S directory, not the cwd, and this repo
// does not depend on it: COPY this file somewhere that does (`~/Projects/sendhome`).

const BASE = process.env.BASE ?? "http://127.0.0.1:3993";
const OUT = process.env.OUT ?? "/tmp/tab";
const TAG = process.env.TAG ?? "after";
const { chromium } = await import("playwright");
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failed = true;
};

const health = (await api("/health")).body;
console.log(`instance v${health.v} · network=${health.network} · sim=${health.sim}\n`);

const { body: mint } = await api("/api/demo/family", { method: "POST" });
const PARENT = mint.parentToken;
const kid = mint.children[0];

const browser = await chromium.launch();

/** The measurements. A box "spans" when it starts at the left edge and ends at the right
 *  one — the failing shape in #360 is a 460px stripe with grey either side, which is
 *  exactly a box whose x is not 0 and whose width is not the viewport's. */
const geometry = async (page, w) => page.evaluate((vw) => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    vw,
    header: box(".phdr"),
    nav: box(".pnav"),
    view: box(".view"),
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  };
}, w);

const spans = (b, vw) => b && b.x === 0 && Math.abs(b.w - vw) <= 1;
const centred = (b, vw) => b && Math.abs((b.x + b.w / 2) - vw / 2) <= 2;

/** `.pill-btn.wide` is "as wide as the container, up to a 300px cap", and it centres itself
 *  with align-self + margin-inline:auto — the first reaches a flex column, the second a
 *  block. That pair is WRONG in one place: a flex ROW, where an auto margin eats the free
 *  space and shoves its siblings around instead of centring. Nothing in CSS can express
 *  "unless my parent is a row", so the guard is this, run on every screen the driver walks:
 *  find every wide pill actually painted, and report any whose parent is a flex row, plus
 *  any that did not end up centred in its parent. Returns [] when the screen has none. */
const widePills = async (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll(".pill-btn.wide")) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;                       // not painted on this screen
    const par = el.parentElement;
    const ps = getComputedStyle(par);
    const pr = par.getBoundingClientRect();
    const row = ps.display.includes("flex") && !ps.flexDirection.startsWith("column");
    out.push({
      label: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 28),
      parent: par.className || par.tagName,
      row,
      display: ps.display,
      dir: ps.flexDirection,
      off: Math.round((r.x + r.width / 2) - (pr.x + pr.width / 2)),
    });
  }
  return out;
});

const auditWide = async (page, where, size) => {
  const pills = await widePills(page);
  if (!pills.length) return;
  const inRow = pills.filter((p) => p.row);
  check(`${size}: ${where} — no wide pill sits in a flex row`, inRow.length === 0,
    inRow.map((p) => `${p.label} in .${p.parent} (${p.display}/${p.dir})`).join(" | "));
  // 1px of rounding is fine; anything more is a button that did not centre.
  const off = pills.filter((p) => Math.abs(p.off) > 1);
  check(`${size}: ${where} — every wide pill is centred in its container`, off.length === 0,
    off.map((p) => `${p.label} off by ${p.off}px in .${p.parent}`).join(" | "));
};

let signedIn = false;
const open = async (page, path = "") => {
  await page.goto(`${BASE}/parent/${path}${signedIn ? "" : `#t=${PARENT}`}`, { waitUntil: "networkidle" });
  signedIn = true;
  await wait(2200);
};

const shot = async (page, name) => page.screenshot({ path: `${OUT}/${TAG}-${name}.png`, fullPage: false });

// ---------------------------------------------------------------- the three real screens
const SIZES = [
  { name: "tablet-portrait",  w: 800,  h: 1280, tablet: true },
  { name: "tablet-landscape", w: 1280, h: 800,  tablet: true },
  { name: "desktop",          w: 1440, h: 900,  tablet: true },
  // A smaller tablet, and the one nobody thinks of: a PHONE turned sideways is 844px wide,
  // which is past the 700px breakpoint. It gets the tablet layout and only 390px of height
  // to put it in — so this is where a centred dialog and two sticky bars either fit or do
  // not. It is the size the breakpoint is most likely to be wrong at.
  { name: "small-tablet",     w: 1024, h: 600,  tablet: true },
  { name: "phone-landscape",  w: 844,  h: 390,  tablet: true },
  { name: "phone",            w: 390,  h: 844,  tablet: false },
];

for (const size of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 2,
    isMobile: !size.tablet,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  signedIn = false;
  await open(page);
  const g = await geometry(page, size.w);
  console.log(`\n== ${size.name} ${size.w}x${size.h} ==`);
  console.log(`   header ${JSON.stringify(g.header)}  nav ${JSON.stringify(g.nav)}  view ${JSON.stringify(g.view)}`);

  if (size.tablet) {
    check(`${size.name}: the navy header spans the viewport`, spans(g.header, size.w), JSON.stringify(g.header));
    check(`${size.name}: the bottom bar spans the viewport`, spans(g.nav, size.w), JSON.stringify(g.nav));
    check(`${size.name}: the reading column is still a column, not a full-width sprawl`,
      g.view.w <= 640, `${g.view.w}px`);
    check(`${size.name}: and it is centred under the chrome`, centred(g.view, size.w), JSON.stringify(g.view));
  } else {
    // The whole risk of a min-width breakpoint is that it leaks down onto the phone the app
    // already got right. 390px must still be the one-column app it was before this change.
    check(`${size.name}: unchanged — the app is still the full phone width`,
      spans(g.header, size.w) && spans(g.nav, size.w), JSON.stringify(g.header));
    check(`${size.name}: content still fills the phone`, g.view.w >= size.w - 1, `${g.view.w}px`);
  }
  check(`${size.name}: no horizontal scrollbar`, g.scrollW <= g.innerW + 1, `${g.scrollW} vs ${g.innerW}`);
  await auditWide(page, "home", size.name);
  await shot(page, `${size.name}-01-home`);

  // ---- the kid's own page (the back-button lane, and the board entry) ----
  await page.locator(`[data-kid="${kid.id}"]`).first().click().catch(() => {});
  await wait(1800);
  await shot(page, `${size.name}-02-kid`);
  const gk = await geometry(page, size.w);
  if (size.tablet) {
    check(`${size.name}: kid page keeps the spanning chrome`,
      spans(gk.header, size.w) && spans(gk.nav, size.w), JSON.stringify(gk.header));
  }

  // The board is the densest thing on the parent side (jobs, routines, practices, the
  // seven-circle days dial) and it is the one screen with its own stylesheet, so a width
  // change has two files to be wrong in rather than one.
  const board = page.locator("#go-board");
  if (await board.count()) {
    await board.click().catch(() => {});
    await wait(1800);
    const gb = await geometry(page, size.w);
    if (size.tablet) {
      check(`${size.name}: the board keeps the spanning chrome and the column`,
        spans(gb.header, size.w) && gb.view.w <= 640 && centred(gb.view, size.w),
        `${JSON.stringify(gb.header)} view ${JSON.stringify(gb.view)}`);
    }
    check(`${size.name}: board does not overflow sideways`, gb.scrollW <= gb.innerW + 1,
      `${gb.scrollW} vs ${gb.innerW}`);
    await auditWide(page, "board", size.name);
    await shot(page, `${size.name}-02b-board`);
    await page.locator("#bd-back").click().catch(() => {});
    await wait(1200);
  }

  await page.locator("#back").click().catch(() => {});
  await wait(1200);

  // ---- approvals, the screen a grown-up actually picks the tablet up for ----
  await page.locator('[data-tab="approvals"]').click();
  await wait(1600);
  await auditWide(page, "approvals", size.name);
  await shot(page, `${size.name}-03-approvals`);

  // ---- a sheet. #360 calls this out by name: a 460px slab bottom-centred on a wide screen.
  // Opened through the real UI (the reject note on the first approval) when there is one.
  const reject = page.locator("[data-reject]").first();
  if (await reject.count()) {
    await reject.click().catch(() => {});
    await wait(1200);
  }
  const sheetOpen = await page.locator("#scrim.show").count();
  if (sheetOpen) {
    const gs = await page.evaluate(() => {
      const r = document.querySelector(".sheet").getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), y: Math.round(r.y), b: Math.round(r.bottom) };
    });
    console.log(`   sheet ${JSON.stringify(gs)}`);
    if (size.tablet) {
      check(`${size.name}: the sheet is a centred dialog, not a narrow bottom slab`,
        Math.abs((gs.x + gs.w / 2) - size.w / 2) <= 2 && gs.y > 0 && gs.b < size.h - 1,
        JSON.stringify(gs));
    }
    await auditWide(page, "sheet", size.name);
    await shot(page, `${size.name}-04-sheet`);
    await page.locator("#scrim").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await wait(600);
  } else {
    console.log("   (no approval to open a sheet from on this run)");
  }

  // ---- settings, the longest form on the parent side ----
  await page.locator('[data-tab="settings"]').click();
  await wait(1600);
  await auditWide(page, "settings", size.name);
  await shot(page, `${size.name}-05-settings`);

  // The Treasure Box manager, off settings. Two more `.pill-btn.wide` — one inside a shelf
  // card, one at section level on the page background — and they are the pair that proves a
  // change to the shared rule did not only get the board right.
  const box = page.locator("#box-manage");
  if (await box.count()) {
    await box.click().catch(() => {});
    await wait(1600);
    await auditWide(page, "treasure box", size.name);
    const gx = await geometry(page, size.w);
    if (size.tablet) {
      check(`${size.name}: the Treasure Box keeps the spanning chrome and the column`,
        spans(gx.header, size.w) && gx.view.w <= 640 && centred(gx.view, size.w),
        `${JSON.stringify(gx.header)} view ${JSON.stringify(gx.view)}`);
    }
    await shot(page, `${size.name}-07-box`);
    await page.locator("#bx-back-p").click().catch(() => {});
    await wait(1000);
  }

  // ---- the corner control's dropdown. position:absolute inside the header, and the
  // header is the one box this change makes full-bleed: it must not be clipped or
  // fly off the right edge.
  const corner = page.locator("#wallet-slot button").first();
  if (await corner.count()) {
    await corner.click().catch(() => {});
    await wait(900);
    const menu = await page.evaluate((vw) => {
      const el = document.querySelector("#wallet-slot [class*='menu'], #wallet-slot [role='menu'], #wallet-slot ul");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width), vw };
    }, size.w);
    if (menu) {
      check(`${size.name}: the corner dropdown stays on screen`,
        menu.x >= 0 && menu.right <= size.w + 1, JSON.stringify(menu));
    }
    await shot(page, `${size.name}-06-corner`);
  }

  check(`${size.name}: no page errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

await browser.close();
console.log(`\nshots -> ${OUT}/${TAG}-*.png`);
console.log(failed ? "\nFAILED" : "\nAll checks passed");
process.exit(failed ? 1 : 0);
