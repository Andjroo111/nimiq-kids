// Prove a goal ladder climbs and pays, in a real browser, against a running instance.
//
//   BASE=http://127.0.0.1:3979 node goal-ladder.mjs
//
// Walks the household: a parent builds a three-rung ladder set to be climbed IN ORDER, the
// kid's tablet shows one rung reachable and the rest shut, they claim it, and the parent pays
// it — which is what opens the next one. Asserts on RENDERED content, never an HTTP 200.
//
// Playwright resolves node_modules from the SCRIPT'S directory, not the cwd, and this repo
// does not depend on it: COPY this file somewhere that does (`~/Projects/sendhome` has 1.61.0
// with working browsers). Point it at a throwaway instance, never a live one.
//
//   HATCH_DEMO_SEED=1 HATCH_DEMO_GRANT_LUNA=100000000000 PORT=3979 DB_PATH=... bun run src/server.ts

const BASE = process.env.BASE ?? "http://127.0.0.1:3979";
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

const { body: mint } = await api("/api/demo/family", { method: "POST" });
const kid = mint.children[0];
const LOW = 20, MID = 40, TOP = 80;   // whole NIM

// ------------------------------------------------------------- the parent builds a ladder
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

  await page.locator("#bd-add-goal").scrollIntoViewIfNeeded();
  await page.click("#bd-add-goal");
  await wait(900);
  check("parent: the goal sheet asks how they work through it",
    await page.locator('[data-ord="1"]').count() === 1 && await page.locator('[data-ord="0"]').count() === 1);
  check("parent: and starts IN ORDER, which is what a ladder is",
    (await page.locator('[data-ord="1"]').getAttribute("aria-pressed")) === "true");
  await page.fill("#bd-title", "Stand on one leg");
  await page.screenshot({ path: `${OUT}/goal-sheet.png` });
  await page.click("#bd-save");
  await wait(2500);

  for (const [title, nim] of [["Hold it 10 seconds", LOW], ["Hold it 30 seconds", MID], ["Both legs", TOP]]) {
    await page.locator("[data-addrung]").first().scrollIntoViewIfNeeded();
    await page.locator("[data-addrung]").first().click();
    await wait(900);
    await page.fill("#bd-title", title);
    await page.fill("#bd-nim", String(nim));
    await page.click("#bd-save");
    await wait(2500);
  }

  const card = page.locator(".card.set-card").filter({ hasText: "Stand on one leg" }).first();
  const text = flat(await card.textContent());
  check("parent: the ladder lists its three steps", /Hold it 10 seconds/.test(text) && /Both legs/.test(text),
    text.slice(0, 180));
  check("parent: with only the bottom one theirs to try",
    (text.match(/Not open yet/g) ?? []).length === 2 && /Theirs to try/.test(text), text.slice(0, 220));
  await card.scrollIntoViewIfNeeded();
  await wait(500);
  await page.screenshot({ path: `${OUT}/goal-parent-board.png` });
  check("parent: no console errors building it", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

const goal = (await api(`/api/goals?childId=${kid.id}`, {}, mint.parentToken)).body.goals[0];
check("the ladder is stored, in order, with three rungs",
  goal?.ordered === true && goal.rungs.length === 3,
  JSON.stringify(goal?.rungs?.map((r) => [r.title, r.rewardLuna, r.state])));
check("and the server says which rungs are reachable",
  goal.rungs.map((r) => r.state).join(",") === "open,locked,locked", goal.rungs.map((r) => r.state).join(","));

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
  // The #123 switch gate: a demo household seeds two kids, so the first roster tap enrols a
  // secret picture. Two taps, then the same two to confirm.
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

  const card = page.locator(".ch-goal").filter({ hasText: "Stand on one leg" }).first();
  check("kid: the ladder is on the board", await card.count() === 1);
  const cardText = flat(await card.textContent());
  check("kid: the card says how far they have got", /0 of 3 climbed/i.test(cardText), cardText);
  check("kid: and names the step they can actually try", /Hold it 10 seconds/.test(cardText), cardText);
  check("kid: the pill is what is LEFT on the ladder",
    cardText.replace(/\s/g, "").includes(String(LOW + MID + TOP)), cardText);
  await card.scrollIntoViewIfNeeded();
  await wait(600);
  await page.screenshot({ path: `${OUT}/goal-kid-card.png` });

  await card.click();
  await wait(1500);
  const rungs = page.locator(".gl-rung");
  check("kid: the sheet shows all three steps", await rungs.count() === 3);
  check("kid: only the bottom one can be pressed", await page.locator(".gl-rung:not([disabled])").count() === 1);
  check("kid: the two above are drawn as not-yet", await page.locator(".gl-rung.is-locked").count() === 2);
  await page.screenshot({ path: `${OUT}/goal-kid-sheet.png` });

  await page.locator(".gl-rung:not([disabled])").first().click();
  await wait(2500);
  await page.evaluate(() => document.querySelectorAll(".ch-group").forEach((g) => g.classList.add("is-open")));
  await wait(500);
  const after = page.locator(".ch-goal").filter({ hasText: "Stand on one leg" }).first();
  check("kid: the card now says it is with a grown-up", await after.locator(".ch-slot-wait").count() === 1);
  await after.scrollIntoViewIfNeeded();
  await wait(600);
  await page.screenshot({ path: `${OUT}/goal-kid-waiting.png` });

  // The rung above stays SHUT while the claim is only waiting: a claim is not a climb.
  await after.click();
  await wait(1200);
  check("kid: a claimed step does not open the next one",
    await page.locator(".gl-rung:not([disabled])").count() === 0,
    `${await page.locator(".gl-rung:not([disabled])").count()} still pressable`);
  await page.screenshot({ path: `${OUT}/goal-kid-waiting-sheet.png` });
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

  const card = page.locator(".ap-card").filter({ hasText: "Hold it 10 seconds" }).first();
  check("parent: the step is in the queue, by name", await card.count() === 1);
  const amount = flat(await card.locator(".ap-reward .amount").textContent().catch(() => ""));
  check("parent: for that step's own price", amount.replace(/\s/g, "").includes(String(LOW)), amount);
  await page.screenshot({ path: `${OUT}/goal-parent-card.png` });

  const before = (await api(`/api/kids/${kid.id}/wallet`, {}, mint.parentToken)).body.balanceLuna;
  await card.locator("[data-approve]").click();
  await wait(6000);
  check("parent: the card leaves the queue",
    await page.locator(".ap-card").filter({ hasText: "Hold it 10 seconds" }).count() === 0);
  const after = (await api(`/api/kids/${kid.id}/wallet`, {}, mint.parentToken)).body.balanceLuna;
  check(`the kid is ${LOW} NIM better off`, after - before === LOW * 1e5, `${before} -> ${after}`);
  check("parent: no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ------------------------------------------------------- paying a rung is what opens the next
{
  const climbed = (await api(`/api/goals?childId=${kid.id}`, {}, mint.parentToken)).body.goals[0];
  check("the paid step is climbed and the next one has opened",
    climbed.rungs.map((r) => r.state).join(",") === "climbed,open,locked",
    climbed.rungs.map((r) => r.state).join(","));
  check("and what is LEFT on the ladder drops by what was paid",
    climbed.leftLuna === (MID + TOP) * 1e5, `leftLuna=${climbed.leftLuna}`);

  // The top rung is still refused, and refused by the SERVER, whatever a client sends.
  const jump = await api(`/api/goals/${climbed.id}/rungs/${climbed.rungs[2].id}/claim`, {
    method: "POST", body: "{}",
  }, mint.deviceToken);
  check("a locked step is refused even when asked for directly",
    jump.status === 409 && jump.body.error === "rung_not_open", `${jump.status} ${JSON.stringify(jump.body)}`);

  // And the ladder freezes while a claim waits.
  await api(`/api/goals/${climbed.id}/rungs/${climbed.rungs[1].id}/claim`, { method: "POST", body: "{}" },
    mint.deviceToken);
  const reprice = await api(`/api/goals/${climbed.id}/rungs/${climbed.rungs[1].id}`, {
    method: "PATCH", body: JSON.stringify({ rewardLuna: 1 }),
  }, mint.parentToken);
  check("a waiting step freezes the ladder's prices",
    reprice.status === 409 && reprice.body.error === "rung_awaiting_approval",
    `${reprice.status} ${JSON.stringify(reprice.body)}`);
}

await browser.close();
console.log(failed ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
