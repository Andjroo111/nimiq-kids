// Prove a practice pays NIM, in a real browser, against a running instance.
//
//   BASE=http://127.0.0.1:3977 node practice-pay.mjs
//
// Walks what a household actually does: a parent puts a price on a practice, a kid taps the
// day on the tablet, and the parent answers the card that appears on their phone. Asserts on
// RENDERED content, never on an HTTP 200 — the pill on the kid's card, the hourglass in the
// ring, the words and the amount on the parent's card, and the card leaving the queue.
//
// Playwright resolves node_modules from the SCRIPT'S directory, not the cwd, and this repo does
// not depend on it: COPY this file somewhere that does (`~/Projects/sendhome` has 1.61.0 with
// working browsers) and run it there. Point it at a throwaway instance, never a live one -- it
// mints demo households and approves real payouts.
//
// The instance needs a demo grant big enough for the practice it prices, or the approve is
// correctly refused `budget_exhausted` and the money leg never runs:
//   HATCH_DEMO_SEED=1 HATCH_DEMO_GRANT_LUNA=100000000000 PORT=3977 DB_PATH=... bun run src/server.ts

const BASE = process.env.BASE ?? "http://127.0.0.1:3977";
const OUT = process.env.OUT ?? "/tmp";
const { chromium, devices } = await import("playwright");

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

const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
const watch = (page, errors) => {
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
};

// A household of our own, so nothing here touches the seeded demo one.
const { body: mint } = await api("/api/demo/family", { method: "POST" });
const kid = mint.children[0];
const REWARD_NIM = 300;

// ------------------------------------------------------- the parent prices the practice
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(`${BASE}/parent/#t=${mint.parentToken}`, { waitUntil: "networkidle" });
  await wait(2500);

  // Home lists the kids; the kid's page opens their board; the board has the practices card.
  await page.locator(`[data-kid="${kid.id}"]`).first().click();
  await wait(2000);
  await page.click("#go-board");
  await wait(2000);
  await page.locator("#bd-add-practice").scrollIntoViewIfNeeded();
  await page.click("#bd-add-practice");
  await wait(800);
  await page.fill("#bd-title", "Piano");
  const nim = page.locator("#bd-nim");
  check("parent: the practice sheet asks what it pays", await nim.count() === 1);
  await nim.fill(String(REWARD_NIM));
  await page.locator("#bd-worth").waitFor({ state: "visible" }).catch(() => {});
  const worth = (await page.locator("#bd-worth").textContent().catch(() => "")) ?? "";
  check("parent: it prices the promise in dollars as they type", /\$/.test(worth), worth.trim());
  await page.screenshot({ path: `${OUT}/practice-sheet.png` });
  await page.click("#bd-save");
  await wait(2500);

  const row = page.locator(".bx-row-p").filter({ hasText: "Piano" }).first();
  const rowText = await row.textContent();
  check("parent: the row says what it pays every day", /300\s*NIM.*a day|a day/i.test(rowText.replace(/\s+/g, " ")), rowText.replace(/\s+/g, " ").trim());
  await page.screenshot({ path: `${OUT}/practice-board.png` });
  check("parent: no console errors setting it up", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

const practice = (await api(`/api/practices?childId=${kid.id}`, {}, mint.parentToken)).body.practices[0];
check("the reward really is stored", practice?.rewardLuna === REWARD_NIM * 1e5, `rewardLuna=${practice?.rewardLuna}`);

// ------------------------------------------------------------------- the kid's tablet
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
  await wait(1500);
  // Hand THIS browser our household's device token rather than minting a second one.
  await page.evaluate((tok) => localStorage.setItem("kid.deviceToken", tok), mint.deviceToken);
  await page.goto(`${BASE}/kid/`, { waitUntil: "networkidle" });
  await wait(3000);
  // The roster holds every kid in the household; pick the one the practice belongs to.
  await page.locator(".account-entry").filter({ hasText: kid.label }).first().click();
  await wait(3000);
  // The switch gate (#123): a household with siblings enrols a secret picture on the first
  // roster tap. Pick two, then the same two again to confirm. A precondition of the DEMO
  // household, not of practices, but the board is behind it.
  for (let round = 0; round < 2; round++) {
    if (await page.locator(".k-secret-pic").count() === 0) break;
    await page.locator('.k-secret-pic[data-i="0"]').click();
    await wait(300);
    await page.locator('.k-secret-pic[data-i="5"]').click();
    await wait(1500);
  }
  await wait(2500);
  // The board's groups are an accordion; a closed group keeps its rows in the DOM, invisible.
  await page.evaluate(() => document.querySelectorAll(".ch-group").forEach((g) => g.classList.add("is-open")));
  await wait(500);

  const card = page.locator(".ch-practice").filter({ hasText: "Piano" }).first();
  check("kid: the practice is on the board", await card.count() === 1);
  const pill = card.locator(".k-nim-pill");
  check("kid: it says what the day is worth", await pill.count() === 1, await pill.textContent().catch(() => "no pill"));
  await card.scrollIntoViewIfNeeded();
  await wait(600);
  await page.screenshot({ path: `${OUT}/practice-kid-before.png` });

  await card.click();
  await wait(2500);
  // The sticker picker opens on top of the board. Close it and read the card underneath.
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => document.querySelector(".sheet-scrim, .sheet-close, [data-close]")?.click());
  await wait(2000);
  await page.evaluate(() => document.querySelectorAll(".ch-group").forEach((g) => g.classList.add("is-open")));
  await wait(500);

  const after = page.locator(".ch-practice").filter({ hasText: "Piano" }).first();
  const waitRing = after.locator(".ch-slot-wait");
  check("kid: today's ring says it is with a grown-up", await waitRing.count() === 1);
  check("kid: the pill is still promising the money", await after.locator(".k-nim-pill").count() === 1);
  await after.scrollIntoViewIfNeeded();
  await wait(600);
  await page.screenshot({ path: `${OUT}/practice-kid-waiting.png` });
  check("kid: no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// -------------------------------------------------------------------- the parent answers
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(`${BASE}/parent/#t=${mint.parentToken}`, { waitUntil: "networkidle" });
  await wait(2500);
  await page.click('[data-tab="approvals"]');
  await wait(2000);

  const card = page.locator(".ap-card").filter({ hasText: "Piano" }).first();
  check("parent: the day is in the queue, by name", await card.count() === 1);
  const amount = await card.locator(".ap-reward .amount").textContent().catch(() => "");
  check("parent: for the practice's own price", amount.replace(/\s+/g, "").includes("300"), amount.trim());
  await page.screenshot({ path: `${OUT}/practice-parent-card.png` });

  const before = (await api(`/api/kids/${kid.id}/wallet`, {}, mint.parentToken)).body.balanceLuna;
  await card.locator("[data-approve]").click();
  await wait(6000);
  await page.screenshot({ path: `${OUT}/practice-parent-after.png` });

  check("parent: the card leaves the queue", await page.locator(".ap-card").filter({ hasText: "Piano" }).count() === 0);
  const after = (await api(`/api/kids/${kid.id}/wallet`, {}, mint.parentToken)).body.balanceLuna;
  check("the kid is 300 NIM better off", after - before === REWARD_NIM * 1e5, `${before} -> ${after}`);
  check("parent: no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------------------------------------------------------------- the day is paid, and says so
{
  const view = (await api(`/api/practices?childId=${kid.id}`, {}, mint.parentToken)).body.practices[0];
  check("the card now reads paid", view.payState === "paid", `payState=${view.payState}`);
  check("the day still counts toward the week", view.weekDone === 1, `weekDone=${view.weekDone}`);

  // And the promise cannot be moved out from under a day that IS still waiting. A SECOND
  // practice, because today's piano is paid and done: re-posting the session would be
  // idempotent, open nothing, and the price would move freely and correctly.
  const other = (await api("/api/practices", {
    method: "POST", body: JSON.stringify({ childId: kid.id, title: "Reading", rewardLuna: 50e5 }),
  }, mint.parentToken)).body.practice;
  await api(`/api/practices/${other.id}/session`, { method: "POST", body: "{}" }, mint.deviceToken);
  const reprice = await api(`/api/practices/${other.id}`, {
    method: "PUT", body: JSON.stringify({ rewardLuna: 1 }),
  }, mint.parentToken);
  check("a waiting day freezes the price", reprice.status === 409 && reprice.body.error === "day_awaiting_approval",
    `${reprice.status} ${JSON.stringify(reprice.body)}`);
}

await browser.close();
console.log(failed ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
