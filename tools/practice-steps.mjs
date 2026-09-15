// Prove a practice made of EXERCISES pays what the kid ticked, in a real browser, against a
// running instance.
//
//   BASE=http://127.0.0.1:3978 node practice-steps.mjs
//
// Walks the whole household: a parent breaks Piano into three priced exercises, the kid ticks
// two of them on the tablet, and the parent answers the card that appears on their phone.
// Asserts on RENDERED content, never on an HTTP 200 — the tick states in the sheet, the
// running total as it is chosen, the exercise list on the parent's card, the amount above it,
// and the luna that actually lands.
//
// Playwright resolves node_modules from the SCRIPT'S directory, not the cwd, and this repo does
// not depend on it: COPY this file somewhere that does (`~/Projects/sendhome` has 1.61.0 with
// working browsers) and run it there. Point it at a throwaway instance, never a live one -- it
// mints demo households and approves real payouts.
//
// The instance needs a demo grant big enough for the day it prices, or the approve is
// correctly refused `budget_exhausted` and the money leg never runs:
//   HATCH_DEMO_SEED=1 HATCH_DEMO_GRANT_LUNA=100000000000 PORT=3978 DB_PATH=... bun run src/server.ts

const BASE = process.env.BASE ?? "http://127.0.0.1:3978";
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
const flat = (s) => (s ?? "").replace(/\s+/g, " ").trim();

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

const SCALES = 40, SONG = 80, SIGHT = 30;   // whole NIM
const TICKED = SCALES + SONG;               // what the kid will actually do

// ------------------------------------------------- the parent breaks the practice up
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(`${BASE}/parent/#t=${mint.parentToken}`, { waitUntil: "networkidle" });
  await wait(2500);

  await page.locator(`[data-kid="${kid.id}"]`).first().click();
  await wait(2000);
  await page.click("#go-board");
  await wait(2000);

  // A practice priced as a whole first — this is the shape every existing practice is in,
  // and the sheet has to offer the way out of it.
  await page.locator("#bd-add-practice").scrollIntoViewIfNeeded();
  await page.click("#bd-add-practice");
  await wait(800);
  await page.fill("#bd-title", "Piano");
  await page.fill("#bd-nim", "150");
  await page.click("#bd-save");
  await wait(2500);

  // Re-open it: the sheet offers to break it into exercises.
  await page.locator(".bx-row-p").filter({ hasText: "Piano" }).first().locator("[data-practice]").click();
  await wait(1000);
  check("parent: the practice sheet offers to split it into exercises",
    await page.locator("#bd-split").count() === 1);
  await page.screenshot({ path: `${OUT}/psteps-practice-sheet.png` });
  await page.click("#bd-split");
  await wait(800);
  check("parent: the exercise sheet asks for a name and a price",
    await page.locator("#bd-title").count() === 1 && await page.locator("#bd-nim").count() === 1);
  // No minutes field: an exercise is ticked, not run against a timer.
  check("parent: and does NOT ask for minutes", await page.locator("#bd-mins").count() === 0);
  await page.fill("#bd-title", "Scales");
  await page.fill("#bd-nim", String(SCALES));
  await page.screenshot({ path: `${OUT}/psteps-exercise-sheet.png` });
  await page.click("#bd-save");
  await wait(2500);

  // The other two, from the card this practice has now become.
  for (const [title, nim] of [["The song", SONG], ["Sight-reading", SIGHT]]) {
    await page.locator("[data-addpstep]").first().scrollIntoViewIfNeeded();
    await page.locator("[data-addpstep]").first().click();
    await wait(900);
    await page.fill("#bd-title", title);
    await page.fill("#bd-nim", String(nim));
    await page.click("#bd-save");
    await wait(2500);
  }

  const card = page.locator(".card.set-card").filter({ hasText: "Piano" }).first();
  const cardText = flat(await card.textContent());
  check("parent: the practice is now a card listing its three exercises",
    /Scales/.test(cardText) && /The song/.test(cardText) && /Sight-reading/.test(cardText), cardText.slice(0, 160));
  check("parent: and states what a whole day is worth",
    new RegExp(`${SCALES + SONG + SIGHT}\\s*NIM`).test(cardText), cardText.slice(0, 160));
  await card.scrollIntoViewIfNeeded();
  await wait(500);
  await page.screenshot({ path: `${OUT}/psteps-parent-board.png` });

  // The practice's own price field is gone: one price, one home.
  await card.locator("[data-practice]").click();
  await wait(1000);
  check("parent: the practice's own reward field is gone once it has exercises",
    await page.locator("#bd-nim").count() === 0);
  check("parent: and the sheet says the exercises are the price",
    await page.locator(".bd-row-static").count() === 1,
    flat(await page.locator(".bd-row-static").textContent().catch(() => "")));
  await page.screenshot({ path: `${OUT}/psteps-practice-sheet-stepped.png` });
  check("parent: no console errors setting it up", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

const practice = (await api(`/api/practices?childId=${kid.id}`, {}, mint.parentToken)).body.practices[0];
check("the three exercises are stored, priced", practice?.steps?.length === 3
  && practice.steps.map((s) => s.rewardLuna / 1e5).join(",") === `${SCALES},${SONG},${SIGHT}`,
  JSON.stringify(practice?.steps?.map((s) => [s.title, s.rewardLuna])));
check("a whole day is worth all three", practice?.fullDayLuna === (SCALES + SONG + SIGHT) * 1e5,
  `fullDayLuna=${practice?.fullDayLuna}`);

// ------------------------------------------------------------------- the kid's tablet
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
  await wait(1500);
  await page.evaluate((tok) => localStorage.setItem("kid.deviceToken", tok), mint.deviceToken);
  await page.goto(`${BASE}/kid/`, { waitUntil: "networkidle" });
  await wait(3000);
  await page.locator(".account-entry").filter({ hasText: kid.label }).first().click();
  await wait(3000);
  // The switch gate (#123): a demo household seeds two kids, so the first roster tap enrols a
  // secret picture. Two taps, then the same two to confirm. A precondition of the household,
  // not of practices — but the board is behind it.
  for (let round = 0; round < 2; round++) {
    if (await page.locator(".k-secret-pic").count() === 0) break;
    await page.locator('.k-secret-pic[data-i="0"]').click();
    await wait(300);
    await page.locator('.k-secret-pic[data-i="5"]').click();
    await wait(1500);
  }
  await wait(2500);
  await page.evaluate(() => document.querySelectorAll(".ch-group").forEach((g) => g.classList.add("is-open")));
  await wait(500);

  const card = page.locator(".ch-practice").filter({ hasText: "Piano" }).first();
  check("kid: the practice is on the board", await card.count() === 1);
  const pill = flat(await card.locator(".k-nim-pill").textContent().catch(() => ""));
  check("kid: the card offers the WHOLE day before anything is ticked",
    pill.replace(/\s/g, "").includes(String(SCALES + SONG + SIGHT)), pill);
  await card.scrollIntoViewIfNeeded();
  await wait(600);
  await page.screenshot({ path: `${OUT}/psteps-kid-before.png` });

  // Tapping asks which exercises, instead of logging the whole day.
  await card.click();
  await wait(1500);
  const rows = page.locator(".pr-step");
  check("kid: tapping asks what they did, one row per exercise", await rows.count() === 3);
  await page.screenshot({ path: `${OUT}/psteps-kid-sheet.png` });
  const totalBefore = flat(await page.locator("#pr-total").textContent().catch(() => ""));
  check("kid: nothing ticked, nothing owed yet", !/\d/.test(totalBefore), totalBefore);

  await rows.filter({ hasText: "Scales" }).first().click();
  await wait(400);
  await rows.filter({ hasText: "The song" }).first().click();
  await wait(600);
  const total = flat(await page.locator("#pr-total").textContent().catch(() => ""));
  check("kid: the total is what they picked, as they pick it",
    total.replace(/\s/g, "").includes(String(TICKED)), total);
  check("kid: the ticked rows say so", await page.locator(".pr-step.is-on").count() === 2);
  await page.screenshot({ path: `${OUT}/psteps-kid-ticked.png` });

  await page.click("#pr-done");
  await wait(2500);
  // The sticker picker opens on top of the board. Close it and read the card underneath.
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => document.querySelector(".sheet-scrim, .sheet-close, [data-close]")?.click());
  await wait(2000);
  await page.evaluate(() => document.querySelectorAll(".ch-group").forEach((g) => g.classList.add("is-open")));
  await wait(500);

  const after = page.locator(".ch-practice").filter({ hasText: "Piano" }).first();
  const afterText = flat(await after.textContent());
  check("kid: the card counts the exercises they did", /2 of 3/i.test(afterText), afterText);
  check("kid: and now promises only what they ticked",
    flat(await after.locator(".k-nim-pill").textContent().catch(() => "")).replace(/\s/g, "").includes(String(TICKED)),
    flat(await after.locator(".k-nim-pill").textContent().catch(() => "")));
  check("kid: today's ring says it is with a grown-up", await after.locator(".ch-slot-wait").count() === 1);
  await after.scrollIntoViewIfNeeded();
  await wait(600);
  await page.screenshot({ path: `${OUT}/psteps-kid-waiting.png` });
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
  const amount = flat(await card.locator(".ap-reward .amount").textContent().catch(() => ""));
  check("parent: for what the kid ticked, not the whole day",
    amount.replace(/\s/g, "").includes(String(TICKED)) && !amount.replace(/\s/g, "").includes("150"), amount);
  const lines = await card.locator(".ap-task").allTextContents();
  check("parent: the card lists all three exercises", lines.length === 3, JSON.stringify(lines.map(flat)));
  const skipped = await card.locator(".ap-task .skip").count();
  check("parent: with the one they skipped marked as skipped", skipped === 1, `skip marks=${skipped}`);
  await page.screenshot({ path: `${OUT}/psteps-parent-card.png` });

  const before = (await api(`/api/kids/${kid.id}/wallet`, {}, mint.parentToken)).body.balanceLuna;
  await card.locator("[data-approve]").click();
  await wait(6000);
  await page.screenshot({ path: `${OUT}/psteps-parent-after.png` });

  check("parent: the card leaves the queue",
    await page.locator(".ap-card").filter({ hasText: "Piano" }).count() === 0);
  const after = (await api(`/api/kids/${kid.id}/wallet`, {}, mint.parentToken)).body.balanceLuna;
  check(`the kid is ${TICKED} NIM better off, not ${SCALES + SONG + SIGHT}`,
    after - before === TICKED * 1e5, `${before} -> ${after}`);
  check("parent: no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ------------------------------------------------- the day is paid, and the week counts it
{
  const view = (await api(`/api/practices?childId=${kid.id}`, {}, mint.parentToken)).body.practices[0];
  check("the card now reads paid", view.payState === "paid", `payState=${view.payState}`);
  check("the day still counts toward the week", view.weekDone === 1, `weekDone=${view.weekDone}`);
  check("and the board still states the whole day's price",
    view.fullDayLuna === (SCALES + SONG + SIGHT) * 1e5, `fullDayLuna=${view.fullDayLuna}`);

  // The promise cannot be moved out from under a day that IS still waiting. A SECOND
  // practice, because today's piano is paid and done.
  const other = (await api("/api/practices", {
    method: "POST", body: JSON.stringify({ childId: kid.id, title: "Push-ups" }),
  }, mint.parentToken)).body.practice;
  const step = (await api(`/api/practices/${other.id}/steps`, {
    method: "POST", body: JSON.stringify({ title: "Ten push-ups", rewardLuna: 10e5 }),
  }, mint.parentToken)).body.step;
  await api(`/api/practices/${other.id}/session`, {
    method: "POST", body: JSON.stringify({ stepIds: [step.id] }),
  }, mint.deviceToken);

  const reprice = await api(`/api/practices/${other.id}/steps/${step.id}`, {
    method: "PATCH", body: JSON.stringify({ rewardLuna: 1 }),
  }, mint.parentToken);
  check("a waiting day freezes an exercise's price",
    reprice.status === 409 && reprice.body.error === "day_awaiting_approval",
    `${reprice.status} ${JSON.stringify(reprice.body)}`);

  const added = await api(`/api/practices/${other.id}/steps`, {
    method: "POST", body: JSON.stringify({ title: "Twenty", rewardLuna: 1e5 }),
  }, mint.parentToken);
  check("and freezes adding a new one", added.status === 409, `${added.status}`);

  // ⚠️ "A kid's tablet cannot price an exercise" is NOT checkable here, and the first draft
  // of this script asserted it and failed. `parentAuth` clears DEMO households outright — a
  // demo visitor is playing both parts, so on this instance a device token IS a grown-up.
  // That refusal is pinned where the household is a real family: src/practice-steps.test.ts,
  // "a kid's tablet can log a day, and cannot create or price a step".
}

await browser.close();
console.log(failed ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
