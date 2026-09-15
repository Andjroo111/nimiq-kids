// Prove #323 on a running instance: a parent says yes from their own phone, and the KID'S
// TABLET says so instead of quietly re-rendering.
//
//   BASE=http://127.0.0.1:3973 node kid-approval-notice.mjs
//
// The unit tests (src/kid-approval-notice.test.ts) pin the rule and the wiring. What they
// cannot prove is the half a kid meets: a toast arriving on a screen nobody touched, off the
// 10-second chart poll, with the right name and the right NIM on it, and a tap on it opening
// the sticker they earned. That is the whole issue, so it is asserted on RENDERED content.
//
// It also walks the trap the issue names: the demo self-approve path already celebrates and
// already opens the sticker, so the notice must NOT fire on top of it.
//
// Boot a throwaway instance with a FRESH DB (a demo household is minted per run):
//
//   rm -f /tmp/kidnotice.db
//   bun run build:shell   # else /dist/app-shell.js 404s and every label renders its raw key
//   PORT=3973 DB_PATH=/tmp/kidnotice.db NIMIQ_SIM=1 NIMIQ_NETWORK=test HATCH_DEMO_ENABLED=1 \
//     HATCH_DEMO_GRANT_LUNA=100000000000 bun run src/server.ts
//
// ⚠️ `HATCH_DEMO_ENABLED=1` is not optional: without it `POST /api/demo/family` answers 404
// `demo_disabled` and this script dies on the mint with no household to drive.
//
// Playwright resolves node_modules from the SCRIPT'S directory, not the cwd, and this repo
// does not depend on it: COPY this file somewhere that does (`~/Projects/sendhome`).

const BASE = process.env.BASE ?? "http://127.0.0.1:3973";
const OUT = process.env.OUT ?? "/tmp/kidnotice";
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
};

const health = (await api("/health")).body;
console.log(`instance v${health.v} · network=${health.network} · sim=${health.sim} · demo=${health.demo}\n`);

const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
const errors = [];
const watch = (page) => {
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
};

const { body: mint } = await api("/api/demo/family", { method: "POST" });
const kid = mint.children[0];
const parentLabel = mint.family?.parent_label ?? "Mom";
console.log(`household ${mint.family?.id} · kid ${kid.label} · parent "${parentLabel}"`);

// ------------------------------------------------------- the kid's tablet, on the chart
const ctx = await browser.newContext(phone);
const page = await ctx.newPage();
watch(page);
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
check("the kid is on their chart", await page.locator(".k-chart").count() === 1);

// A job of our own so the seed's own submitted chore cannot be mistaken for it. Priced in
// whole luna so the toast has a number worth reading.
const REWARD = 7_203 * 1e5;
const made = await api("/api/chores", {
  method: "POST",
  body: JSON.stringify({ childId: kid.id, title: "Sweep the porch", rewardLuna: REWARD, emoji: "🧹" }),
}, mint.parentToken);
const chore = made.body.chore;
check("a job exists to be approved", !!chore?.id, `${made.status}`);

// The kid hands it in from their own device, exactly as the ring does.
const sub = await api(`/api/chores/${chore.id}/submit`, { method: "POST", body: "{}" }, mint.deviceToken);
check("the kid handed it in", sub.status === 200, `${sub.status}`);
await wait(11_000); // one chart poll
await page.evaluate(() => document.querySelectorAll(".ch-group").forEach((g) => g.classList.add("is-open")));
await wait(400);
await page.screenshot({ path: `${OUT}/1-waiting.png` });
check("the tablet shows it waiting, and says nothing",
  flat(await page.locator(".k-chart").textContent()).includes("Sweep the porch")
  && !(await page.locator(".kid-toast.show").count()),
  `toast visible: ${await page.locator(".kid-toast.show").count()}`);

// ------------------------------------------- the parent says yes, from somewhere else
// No browser: this is the parent's own phone, a different device, which is the entire point.
// The kid's tablet is not touched again until the assertion.
const approval = await api(`/api/chores/${chore.id}/approval`, {}, mint.deviceToken);
const said = await api(`/api/approvals/${approval.body.approvalId}/approve`, { method: "POST", body: "{}" }, mint.parentToken);
check("the parent approved it remotely and it paid",
  said.status === 200 && said.body.paidLuna === REWARD, `${said.status} paid=${said.body.paidLuna}`);

// Nothing is clicked. The toast has to arrive on the chart's own poll.
await page.waitForSelector(".kid-toast.show", { timeout: 20_000 }).catch(() => {});
await page.screenshot({ path: `${OUT}/2-notice.png` });
const notice = flat(await page.locator(".kid-toast").textContent());
console.log(`\nnotice: "${notice}"\n`);
check("the tablet TELLS the kid, untouched, off the poll", notice.length > 0, notice);
check("...naming who said yes", notice.includes(parentLabel), notice);
check("...and what they said yes to", notice.includes("Sweep the porch"), notice);
check("...and what it paid", /7[\s ,]?203/.test(notice), notice);
check("...and what to do now", /sticker/i.test(notice), notice);
check("the notice is a control, not a message",
  await page.locator(".kid-toast.is-tappable").count() === 1);

// The point of the whole thing: the sticker is one tap away, from the notice itself.
await page.locator(".kid-toast").click();
await wait(1500);
await page.screenshot({ path: `${OUT}/3-picker.png` });
check("tapping it opens the sticker they earned",
  await page.locator(".kid-scrim.show .stkp-groups").count() === 1,
  flat(await page.locator("#kid-sheet").textContent()).slice(0, 120));

// ---------------------------------------------------------------- told ONCE, not on a loop
await page.evaluate(() => document.querySelector("#sheet-x")?.click());
await wait(1200);
await page.evaluate(() => document.querySelector("#kid-toast")?.classList.remove("show"));
await wait(13_000); // two more polls
check("it does not say it again on the next poll",
  await page.locator(".kid-toast.show").count() === 0);

// ------------------------------------------- a ROUTINE is ONE yes, and so is ONE notice
// The seeded Morning routine has three tasks. One approval turns all three cards green, and
// three toasts for one parent tap is worse than the silence this closes.
const routine = (await api(`/api/routines?childId=${kid.id}`, {}, mint.parentToken)).body.routines
  .find((r) => (r.tasks?.length ?? 0) >= 2);
const today = (await api(`/api/routines/${routine.id}/today`, {}, mint.deviceToken)).body;
const runReward = today.taskRuns.reduce(
  (sum, tr) => sum + (today.tasks.find((tk) => tk.id === tr.task_id)?.reward_luna ?? 0), 0);
for (const tr of today.taskRuns) {
  await api(`/api/task-runs/${tr.id}/done`, { method: "POST", body: "{}" }, mint.deviceToken);
}
const runAppr = await api(`/api/routine-runs/${today.run.id}/approval`, {}, mint.deviceToken);
const paidRun = await api(`/api/approvals/${runAppr.body.approvalId}/approve`,
  { method: "POST", body: "{}" }, mint.parentToken);
check("a whole routine was approved remotely",
  paidRun.status === 200 && paidRun.body.paidLuna === runReward,
  `${paidRun.status} paid=${paidRun.body.paidLuna} expected=${runReward}`);

await page.waitForSelector(".kid-toast.show", { timeout: 20_000 }).catch(() => {});
await page.screenshot({ path: `${OUT}/4-routine.png` });
const runNotice = flat(await page.locator(".kid-toast").textContent());
console.log(`\nnotice: "${runNotice}"\n`);
check("ONE notice for the whole routine, named by the ROUTINE",
  runNotice.includes(routine.title) && !runNotice.includes(today.tasks[0].title), runNotice);
check("...carrying what the RUN paid, not one task's share",
  runNotice.includes(String(Math.round(runReward / 1e5))), runNotice);

await page.evaluate(() => document.querySelector("#kid-toast")?.classList.remove("show"));
await wait(13_000); // two more polls, with two of the three stickers still uncollected
check("and it does not say it again while the rest are still collectable",
  await page.locator(".kid-toast.show").count() === 0);

// ------------------------------------------------- the trap: a self-approval must not double
// On demo the kid taps a submitted job and approves it in place. That path celebrates AND
// opens the sticker itself, so a toast on top of it is the double-fire #323 warns about.
const own = await api("/api/chores", {
  method: "POST",
  body: JSON.stringify({ childId: kid.id, title: "Water the plants", rewardLuna: 4_100 * 1e5, emoji: "🪴" }),
}, mint.parentToken);
await api(`/api/chores/${own.body.chore.id}/submit`, { method: "POST", body: "{}" }, mint.deviceToken);
await wait(11_000);
await page.evaluate(() => document.querySelectorAll(".ch-group").forEach((g) => g.classList.add("is-open")));
await wait(400);
const beforeLuna = (await api(`/api/kids/${kid.id}/wallet`, {}, mint.deviceToken)).body.balanceLuna;
await page.locator(".ch-task").filter({ hasText: "Water the plants" }).first().click();
await wait(9_000); // the celebration runs its ~2.6s, then the sticker sheet opens
await page.screenshot({ path: `${OUT}/5-selfapprove.png` });
// Assert the path RAN before asserting it stayed quiet: "no toast" is trivially true on a
// screen where nothing happened, and that is the shape of a check that rots without noticing.
const afterLuna = (await api(`/api/kids/${kid.id}/wallet`, {}, mint.deviceToken)).body.balanceLuna;
check("the self-approval paid and opened its own sticker",
  afterLuna - beforeLuna === 4_100 * 1e5
  && await page.locator(".kid-scrim.show .stkp-groups").count() === 1,
  `+${(afterLuna - beforeLuna) / 1e5} NIM`);
check("...and the notice does not fire on top of it",
  await page.locator(".kid-toast.show").count() === 0,
  flat(await page.locator(".kid-toast").textContent()));

await browser.close();
console.log(`\nconsole errors: ${errors.length}`);
errors.forEach((e) => console.log(`  ! ${e.slice(0, 160)}`));
if (errors.length) failed = true;
console.log(`\nshots in ${OUT}`);
console.log(failed ? "\nFAIL" : "\nPASS");
process.exit(failed ? 1 : 0);
