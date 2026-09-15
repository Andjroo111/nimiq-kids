// Prove a goal ladder COLLECTS a sticker theme, in a real browser.
//
//   BASE=http://127.0.0.1:3981 node goal-theme.mjs
//
// The rule under test is the one Andjroo arrived at: the COLLECTION is the unit, not the
// ladder. A three-rung ladder hands over three dragons and a SECOND two-rung ladder finishes
// the set; finishing grants the boss and releases the whole pack into the kid's picker, which
// nothing before that moment could place on a job.
//
// Copy into a directory with Playwright (`~/Projects/sendhome`). Throwaway instance only.
//   HATCH_DEMO_SEED=1 HATCH_DEMO_GRANT_LUNA=100000000000 PORT=3981 DB_PATH=... bun run src/server.ts

const BASE = process.env.BASE ?? "http://127.0.0.1:3981";
const OUT = process.env.OUT ?? "/tmp";
const { chromium, devices } = await import("playwright");

const api = async (p, o = {}, tok) => {
  const r = await fetch(BASE + p, { ...o, headers: { "content-type": "application/json",
    ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 300); }
  return { status: r.status, body: b };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => (s ?? "").replace(/\s+/g, " ").trim();
let failed = false;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!ok) failed = true; };

console.log(`instance v${(await api("/health")).body.v}`);
const { body: mint } = await api("/api/demo/family", { method: "POST" });
const kid = mint.children[0];
const P = mint.parentToken, D = mint.deviceToken;

const themes = (await api("/api/goal-themes", {}, P)).body.themes;
check("the instance offers themes with art", themes.length > 0 && themes[0].stickers.length === 5,
  themes.map((t) => `${t.packId}:${t.stickers.length}+boss`).join(" "));
const DRAGONS = themes.find((t) => t.packId === "pack-dragons");
check("dragons is one of them, five plus a boss", !!DRAGONS && !!DRAGONS.boss);

/** Build a ladder on the dragons theme and climb every rung. */
async function ladder(name, rungs) {
  const g = (await api("/api/goals", { method: "POST",
    body: JSON.stringify({ childId: kid.id, title: name, packId: "pack-dragons" }) }, P)).body.goal;
  for (let i = 0; i < rungs; i++) {
    await api(`/api/goals/${g.id}/rungs`, { method: "POST",
      body: JSON.stringify({ title: `${name} step ${i + 1}`, rewardLuna: 10e5 }) }, P);
  }
  const live = (await api(`/api/goals?childId=${kid.id}`, {}, P)).body.goals.find((x) => x.id === g.id);
  for (const r of live.rungs) {
    await api(`/api/goals/${g.id}/rungs/${r.id}/claim`, { method: "POST", body: "{}" }, D);
    const ap = (await api("/api/approvals?status=pending", {}, P)).body.approvals
      .find((a) => a.subjectKind === "goal_rung");
    if (!ap) continue;
    const res = await api(`/api/approvals/${ap.id}/approve`, { method: "POST", body: JSON.stringify({ pin: "1234" }) }, P);
    if (res.status !== 200) { check(`approve ${r.title}`, false, JSON.stringify(res.body).slice(0, 120)); break; }
  }
  return g.id;
}

const goalId1 = await ladder("Stand on one leg", 3);
const afterFirst = (await api(`/api/goals?childId=${kid.id}`, {}, P)).body.goals.find((g) => g.id === goalId1);
check("three rungs collected three dragons", afterFirst.theme.collected === 3,
  `${afterFirst.theme.collected}/${afterFirst.theme.total}`);
check("and the set is not finished", afterFirst.theme.complete === false);
check("so the boss is still unearned", afterFirst.theme.boss.owned === false);

const inv1 = (await api(`/api/kids/${kid.id}/stickers`, {}, D)).body;
const owned1 = new Set((inv1.stickers ?? []).map((s) => s.id));
check("a collected dragon is NOT in the kid's usable pool yet",
  !owned1.has(DRAGONS.stickers[0].id), `${owned1.size} usable`);

// ---- a SECOND ladder finishes the set the first one started ----
await ladder("Swim a length", 2);
const afterSecond = (await api(`/api/goals?childId=${kid.id}`, {}, P)).body.goals.find((g) => g.id === goalId1);
check("a second ladder finished the set the first one started", afterSecond.theme.complete === true,
  `${afterSecond.theme.collected}/${afterSecond.theme.total}`);
check("and the boss landed", afterSecond.theme.boss.owned === true);

const inv2 = (await api(`/api/kids/${kid.id}/stickers`, {}, D)).body;
const owned2 = new Set((inv2.stickers ?? []).map((s) => s.id));
for (const s of DRAGONS.stickers) {
  if (!owned2.has(s.id)) { check(`${s.label} released into the pool`, false); break; }
}
check("the whole pack is usable now", DRAGONS.stickers.every((s) => owned2.has(s.id))
  && owned2.has(DRAGONS.boss.id), `${owned2.size} usable`);

// ---- a theme is not for sale, at any price ----
const shelf = (await api(`/api/kids/${kid.id}/store`, {}, D)).body;
const shelved = JSON.stringify(shelf).includes("pack-dragons");
check("no theme is on the Treasure Box shelf", !shelved);

// ---- and it all renders ----
const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

{ const ctx = await browser.newContext(phone); const page = await ctx.newPage(); const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(`${BASE}/parent/#t=${P}`, { waitUntil: "networkidle" }); await wait(3000);
  await page.locator(`[data-kid="${kid.id}"]`).first().click(); await wait(2500);
  await page.click("#go-board"); await wait(3000);
  const filled = await page.locator(".bd-set-slot.is-on").count();
  check("parent: the board draws the collection, filled", filled >= 5, `${filled} filled slots`);
  check("parent: including the prize", await page.locator(".bd-set-boss.is-on").count() >= 1);
  await page.locator(".card.set-card").filter({ hasText: "Stand on one leg" }).first().scrollIntoViewIfNeeded();
  await wait(600);
  await page.screenshot({ path: `${OUT}/theme-parent-board.png` });
  // the chooser
  await page.locator("#bd-add-goal").scrollIntoViewIfNeeded();
  await page.click("#bd-add-goal"); await wait(1500);
  // One row per DRAWN theme plus the "no theme" row. Dragons is the only theme whose art has
  // passed (unicorns and robots are designed and pulled, see sticker-catalog.ts), so this
  // counts >= 2 rather than a fixed number -- it must not fail the day the next pack lands.
  const picks = await page.locator(".bd-theme-pick").count();
  check("parent: the new-goal sheet offers the themes as art", picks >= 2, `${picks} choices`);
  // Six per theme, and the "no theme" row draws none.
  const art = await page.locator(".bd-theme-art img").count();
  check("parent: each theme shows its whole set", art >= 6 && art % 6 === 0, `${art} thumbnails`);
  await page.screenshot({ path: `${OUT}/theme-chooser.png` });
  check("parent: no console errors", errs.length === 0, errs.join(" | ")); await ctx.close(); }

{ const ctx = await browser.newContext(phone); const page = await ctx.newPage(); const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" }); await wait(2000);
  await page.evaluate((t) => localStorage.setItem("kid.deviceToken", t), D);
  await page.goto(`${BASE}/kid/`, { waitUntil: "networkidle" }); await wait(4000);
  await page.locator(".account-entry").filter({ hasText: kid.label }).first().click(); await wait(3500);
  for (let r = 0; r < 2; r++) { if (await page.locator(".k-secret-pic").count() === 0) break;
    await page.locator('.k-secret-pic[data-i="0"]').click(); await wait(400);
    await page.locator('.k-secret-pic[data-i="5"]').click(); await wait(1800); }
  await wait(3000);
  await page.evaluate(() => document.querySelectorAll(".ch-group").forEach((g) => g.classList.add("is-open")));
  await wait(600);
  const card = page.locator(".ch-goal").first();
  check("kid: the card shows the set as dots", await card.locator(".gl-dot").count() === 6,
    `${await card.locator(".gl-dot").count()} dots`);
  check("kid: all six are filled now", await card.locator(".gl-dot.is-on").count() === 6);
  await card.scrollIntoViewIfNeeded(); await wait(500);
  await page.screenshot({ path: `${OUT}/theme-kid-card.png` });
  await card.click(); await wait(1800);
  check("kid: the sheet draws the collected set", await page.locator(".gl-slot.is-on").count() >= 5);
  check("kid: with the prize apart from it", await page.locator(".gl-slot-boss.is-on").count() === 1);
  check("kid: and says the set is complete",
    /collected them all/i.test(flat(await page.locator(".gl-set-line").textContent())),
    flat(await page.locator(".gl-set-line").textContent()));
  await page.screenshot({ path: `${OUT}/theme-kid-sheet.png` });

  // The OTHER half of the prize. Finishing a theme hands over the boss sticker AND a wallpaper
  // for the kid's own app (Andjroo, 2026-08-04: "two separate things"), and the picker is the
  // only place that is visible -- a unit test can prove the unlock and still leave the tile
  // undrawn, which is exactly the shape of bug the "more soon" slot has been hiding.
  const earned = (await api(`/api/children/${kid.id}/prefs`)).body.backgrounds ?? [];
  check("kid: the finished theme unlocked a wallpaper", earned.length >= 1,
    earned.map((b) => b.id).join(",") || "none");
  await page.click("#sheet-x"); await wait(1200);
  await page.click("#switch-kid"); await wait(1800);
  // 4 built-in scenes + 1 per finished theme. The count is what proves the tile was DRAWN --
  // the unlock can be right in the API and still never reach the picker, which is exactly the
  // shape of bug the "more soon" slot has been hiding.
  const tiles = await page.locator(".me-bgs [data-bg]").count();
  check("kid: and the picker draws it", tiles >= 4 + earned.length, `${tiles} scenes offered`);
  await page.screenshot({ path: `${OUT}/theme-kid-scenes.png` });
  // Wearing it proves the PUT guard lets an EARNED one through. The four built-ins were always
  // free, so picking one of those would prove nothing -- this clicks the earned tile by id.
  await page.locator(`.me-bgs [data-bg="${earned[0]?.id}"]`).click(); await wait(2000);
  const worn = (await api(`/api/children/${kid.id}/prefs`)).body.prefs?.background_id;
  check("kid: and they can wear it", worn === earned[0]?.id, `wearing ${worn}`);

  check("kid: no console errors", errs.length === 0, errs.join(" | ")); await ctx.close(); }

await browser.close();
console.log(failed ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
