// Prove "Add it again" (#128) against a running instance, in a real browser.
//
//   BASE=http://127.0.0.1:3988 node tools/board-jobs-again.mjs
//
// There is no DOM test harness in this repo — every test is server-side — and the whole of
// this feature is client work, so a unit test would have to invent an environment to assert
// something a browser can just do. This walks the failure the issue describes instead: a job
// is finished and approved, the board fills with padlocks, and it proves the one tap back
// produces a faithful copy.
//
// It checks the two fields the sheet never shows, `title_key` and `duration_s`, because a
// naive prefill drops both silently: the copy comes back English on a Spanish tablet and a
// 3-minute timed job becomes untimed, and neither is visible from the sheet.
//
// Requires Playwright (`npx playwright install chromium`) and an instance with
// HATCH_DEMO_SEED=1. Never point it at a live instance: it creates and approves real chores.

const BASE = process.env.BASE ?? "http://127.0.0.1:3988";
const { chromium, devices } = await import("playwright").catch(() => {
  console.error("Playwright is required: npm i -D playwright && npx playwright install chromium");
  process.exit(1);
});
// Screenshots are evidence for whoever is reading the run, not fixtures, so they go to a
// temp dir rather than into the repo.
const OUT = process.env.OUT ?? "/tmp";

const api = async (path, opts = {}, token) => {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const txt = await r.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt.slice(0, 300); }
  return { status: r.status, body };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`instance ${(await api("/health")).body.v}`);
const { body: mint } = await api("/api/demo/family", { method: "POST" });
const { parentToken, deviceToken, children } = mint;
const kid = children[0];

// A CATALOG job with a timer, so the copy has to carry a title_key AND a duration_s —
// the two things a naive prefill silently drops.
const made = await api("/api/chores", {
  method: "POST",
  body: JSON.stringify({ childId: kid.id, catalogId: "bed", rewardLuna: 4200 * 1e5, durationS: 180 }),
}, parentToken);
const src = made.body.chore;
console.log(`source job: title="${src.title}" key=${src.title_key} luna=${src.reward_luna} duration=${src.duration_s}`);

// Finish it the way a family does: the kid hands it in, the parent approves.
await api(`/api/chores/${src.id}/submit`, { method: "POST", body: "{}" }, deviceToken);
const appr = await api(`/api/chores/${src.id}/approve`, { method: "POST", body: "{}" }, parentToken);
const after = (await api(`/api/chores?childId=${kid.id}`, {}, parentToken)).body.chores.find((c) => c.id === src.id);
console.log(`approve -> ${appr.status}, status now "${after.status}"`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}/parent/#t=${parentToken}`, { waitUntil: "networkidle" });
await wait(2500);
await page.click(`.row[data-kid="${kid.id}"]`);
await wait(1400);
await page.click("#go-board");
await wait(1600);
await page.screenshot({ path: `${OUT}/128-board.png`, fullPage: true });

const againBtn = await page.$(`[data-again="${src.id}"]`);
console.log(`\n"Again" offered on the finished job: ${!!againBtn}`);
const openHasAgain = await page.$$eval(".bx-row-p", (els) => els.some((e) =>
  e.querySelector("[data-job]") && e.querySelector("[data-again]")));
console.log(`an OPEN job also shows Again (must be false): ${openHasAgain}`);

await againBtn.click();
await wait(1200);
await page.screenshot({ path: `${OUT}/128-sheet.png` });
const sheet = await page.evaluate(() => ({
  heading: document.querySelector("h2")?.textContent?.trim(),
  title: document.querySelector("#bd-title")?.value,
  nim: document.querySelector("#bd-nim")?.value,
  worth: document.querySelector("#bd-worth")?.textContent?.trim(),
  tileSelected: document.querySelector(".jp-tile.is-on")?.dataset.job ?? null,
  hasRemove: !!document.querySelector("#bd-remove"),
}));
console.log(`\nprefilled sheet: ${JSON.stringify(sheet)}`);

// The demo seed already ships a "Make your bed", so the copy has to be identified by
// being NEW, not by matching the title. Snapshot the ids first.
const before = new Set((await api(`/api/chores?childId=${kid.id}`, {}, parentToken)).body.chores.map((c) => c.id));
await page.click("#bd-save");
await wait(2200);
await page.screenshot({ path: `${OUT}/128-after.png`, fullPage: true });

const chores = (await api(`/api/chores?childId=${kid.id}`, {}, parentToken)).body.chores;
const copy = chores.find((c) => !before.has(c.id));
console.log(`\ncopy created: ${!!copy}`);
if (copy) {
  console.log(`  id       ${copy.id !== src.id ? "NEW" : "SAME (wrong)"}`);
  console.log(`  status   ${copy.status}      (must be "open")`);
  console.log(`  title    ${copy.title}`);
  console.log(`  key      ${copy.title_key}   (must match ${src.title_key})`);
  console.log(`  luna     ${copy.reward_luna}     (must match ${src.reward_luna})`);
  console.log(`  duration ${copy.duration_s}          (must match ${src.duration_s})`);
  console.log(`  emoji    ${copy.emoji}`);
}
console.log(`\nthe source job is untouched: status=${chores.find((c) => c.id === src.id)?.status}`);

await browser.close();
console.log(`\nconsole errors: ${errors.length}`);
errors.forEach((e) => console.log(`  ! ${e.slice(0, 140)}`));

const ok = againBtn && !openHasAgain && copy && copy.status === "open"
  && copy.title_key === src.title_key && copy.reward_luna === src.reward_luna
  && copy.duration_s === src.duration_s && sheet.tileSelected === "bed" && errors.length === 0;
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
