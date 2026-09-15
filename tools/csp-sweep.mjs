// Walk every surface in a real browser and count CSP violations (#141).
//
//   BASE=http://127.0.0.1:3992 node tools/csp-sweep.mjs
//
// Adding a CSP to a vanilla PWA breaks inline handlers fast, and the failure is silent: the
// page still renders, one handler just never runs. So this asserts the thing that actually
// matters — that no screen reports a violation — rather than that a header is present, which
// a curl can tell you and which proves nothing about whether the app still works.
//
// It separates violations from ordinary console noise, because a 404 on a favicon is not a
// CSP problem and drowning the signal is how a sweep like this stops being read.
//
// Requires Playwright. Never point it at a live instance: it mints demo households.

const BASE = process.env.BASE ?? "http://127.0.0.1:3992";
const OUT = process.env.OUT ?? "/tmp";
const { chromium, devices } = await import("playwright").catch(() => {
  console.error("Playwright is required: npm i -D playwright && npx playwright install chromium");
  process.exit(1);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, opts = {}, token) => {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
};

// ---- the header is actually on every kind of response ----
const probes = [
  ["/health", "API json"],
  ["/kid/", "kid app html"],
  ["/kid/kid.css", "static css"],
  ["/parent/", "parent app html"],
  ["/demo", "demo gate (server-rendered)"],
];
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

console.log("== headers ==");
for (const [path, what] of probes) {
  const r = await api(path);
  const missing = ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy"]
    .filter((h) => !r.headers.get(h));
  check(`${what} (${path})`, missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : `${r.status}`);
}
const csp = (await api("/health")).headers.get("content-security-policy") ?? "";
check("frame-ancestors is set", /frame-ancestors/.test(csp), csp.match(/frame-ancestors [^;]*/)?.[0] ?? "");
check("object-src is none", /object-src 'none'/.test(csp));
check("base-uri is none", /base-uri 'none'/.test(csp));

// ---- every surface renders with no violation ----
console.log("\n== screens ==");
const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

/** A page's CSP violations, separated from ordinary console noise. */
function watch(page) {
  const violations = [];
  const other = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    (/Content Security Policy|violates the following|Refused to/i.test(t) ? violations : other).push(t);
  });
  page.on("pageerror", (e) => other.push(`pageerror: ${e.message}`));
  return { violations, other };
}

/** Load `path`, run `drive` on it, and report. */
async function surface(name, path, drive) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const seen = watch(page);
  try {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await wait(1800);
    if (drive) await drive(page, ctx);
    await wait(1200);
    const body = (await page.locator("body").innerText().catch(() => "")).trim();
    await page.screenshot({ path: `${OUT}/csp-${name}.png` });
    check(
      `${name} (${path})`,
      seen.violations.length === 0 && body.length > 0,
      seen.violations.length ? seen.violations.slice(0, 2).join(" | ")
        : body.length === 0 ? "rendered EMPTY" : `${body.split("\n")[0]?.slice(0, 42)}…`,
    );
    if (seen.other.length) console.log(`      (${seen.other.length} non-CSP console error(s): ${seen.other[0]?.slice(0, 90)})`);
  } finally {
    await ctx.close();
  }
}

// Mint a household so the parent app has something to render.
const mint = (await api("/api/demo/family", { method: "POST" })).body;

await surface("site", "/");
await surface("demo-gate", "/demo");
await surface("portal", "/portal/");
await surface("kid-gate", "/kid/");
await surface("kid-app", "/demo", async (page) => {
  await page.click("#kid");
  await page.waitForLoadState("networkidle");
  await wait(2500);
  await page.locator(".account-entry").first().click();
  await wait(2500);
  // The board is the screen with the most inline-handler surface in the app.
  await page.evaluate(() => document.querySelectorAll(".ch-group").forEach((g) => g.classList.add("is-open")));
  await wait(500);
});
await surface("parent-home", `/parent/#t=${mint.parentToken}`);
await surface("parent-approvals", `/parent/#t=${mint.parentToken}`, async (page) => {
  await page.click('[data-tab="approvals"]');
  await wait(1500);
});
await surface("parent-settings", `/parent/#t=${mint.parentToken}`, async (page) => {
  await page.click('[data-tab="settings"]');
  await wait(1500);
});
await surface("parent-topup", `/parent/#t=${mint.parentToken}`, async (page) => {
  await page.click('[data-tab="deposit"]');
  await wait(1500);
});

// The invite landing is its own server-rendered page with its own inline <style>.
const inv = await api("/api/family/invite", {}, mint.parentToken);
if (inv.body.code) await surface("invite", `/invite/${inv.body.code}`);
else console.log("SKIP  invite (no code)");

await browser.close();
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
