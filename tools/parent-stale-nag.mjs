// Prove #272 on a running instance: a pending approval nobody ruled on gets LOUDER, and
// never pays itself.
//
//   BASE=http://127.0.0.1:3997 node parent-stale-nag.mjs
//
// The unit tests pin the threshold. What they cannot show is the half a parent meets: whether
// the queue actually LOOKS different after three days, and — the assertion that matters most —
// whether the approval is still sitting there PENDING afterwards. A nag that quietly settled
// the row would pass every "is it red" check ever written.
//
// The clock is moved by ageing the row IN THE DB rather than by waiting three days, so this is
// a real render of a real stale approval. Deliberately not a demo endpoint: a route that ages
// approvals is production surface built for a test's convenience, and it would ship.
//
//   DB_PATH=/tmp/nag.db BASE=http://127.0.0.1:3997 node parent-stale-nag.mjs
//
// Playwright resolves node_modules from the SCRIPT'S directory: copy to ~/Projects/sendhome.

const BASE = process.env.BASE ?? "http://127.0.0.1:3997";
const OUT = process.env.OUT ?? "/tmp/nag";
const { chromium } = await import("playwright");
const fs = await import("node:fs");
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` -- ${d}` : ""}`); if (!ok) failed = true; };

const api = async (p, o = {}, tok) => (await fetch(BASE + p, { ...o, headers: {
  "content-type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } })).json();

const mint = await api("/api/demo/family", { method: "POST" });
const PARENT = mint.parentToken;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const open = async (first) => {
  await p.goto(`${BASE}/parent/${first ? `#t=${PARENT}` : ""}`, { waitUntil: "networkidle" });
  await wait(2200);
};

// ---- fresh: nothing is shouting -----------------------------------------------------------
await open(true);
const strip = p.locator("#go-approvals");
check("a fresh queue is not urgent", (await strip.count()) > 0
  && !(await strip.getAttribute("class")).includes("urgent"), await strip.getAttribute("class"));
check("...and says nothing about waiting", (await strip.locator(".row-sub").count()) === 0);
await p.screenshot({ path: `${OUT}/1-fresh.png` });

// ---- age the approvals past the threshold --------------------------------------------------
// Four days, so it is unambiguously past three rather than sitting on the boundary the unit
// tests already own.
const DB = process.env.DB_PATH ?? "/tmp/nag.db";
const { execFileSync } = await import("node:child_process");
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
execFileSync("sqlite3", [DB,
  `UPDATE approvals SET created_at = created_at - ${FOUR_DAYS_MS} WHERE status='pending';`]);
const agedRows = execFileSync("sqlite3", [DB,
  "SELECT COUNT(*) FROM approvals WHERE status='pending';"]).toString().trim();
console.log(`   aged ${agedRows} pending approvals back four days`);

await open(false);
const cls = (await strip.getAttribute("class")) ?? "";
check("a queue nobody ruled on for four days goes urgent", cls.includes("urgent"), cls);
const sub = (await strip.locator(".row-sub").textContent().catch(() => "")).trim();
// A DURATION, not a relative phrase. "Sam has been waiting 4 days ago" passed a /day/ regex
  // and read as broken English on the screen; only the screenshot caught it.
  check("...and names WHO has been waiting, and how long", /Sam has been waiting 4 days$/.test(sub), sub);
const red = await strip.evaluate((el) => getComputedStyle(el).boxShadow);
check("...in the app's needs-you red, painted not just classed", red.includes("217, 68, 50"), red);
await p.screenshot({ path: `${OUT}/2-stale.png` });

// ---- THE ONE THAT MATTERS: it did not settle itself ----------------------------------------
const overview = await api("/api/parent/overview", {}, PARENT);
check("the approvals are STILL PENDING — a nag never pays itself",
  (overview.pending ?? []).length > 0, `${(overview.pending ?? []).length} pending`);

await p.locator('[data-tab="approvals"]').click(); await wait(1600);
check("the card's own timestamp is reddened too",
  (await p.locator(".ap-when.is-stale").count()) > 0);
await p.screenshot({ path: `${OUT}/3-cards.png` });

check("no page errors", errs.length === 0, errs.join(" | "));
await b.close();
console.log(failed ? "\nFAILED" : "\nAll checks passed");
process.exit(failed ? 1 : 0);
