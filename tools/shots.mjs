// Regenerate the README screenshots against a running instance.
//
//   bun run shots                       # against http://127.0.0.1:3000
//   BASE=http://127.0.0.1:3993 bun run shots
//
// Why this exists: the four screenshots this replaces were captured 2026-06-10, went
// unlinked by any document, and survived twenty releases still showing a product name
// that no longer exists. A README image that nobody can regenerate is a README image
// that rots. This script stages a household through the REAL API and photographs the
// real app, so refreshing the README is one command.
//
// Requires Playwright (`npx playwright install chromium`). It is not a dependency of the
// app; this is a maintenance tool, not part of the build.

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Playwright is a maintenance dependency, not an app one, so it is imported lazily and
// the failure is explained rather than thrown as a module-resolution stack trace.
const { chromium, devices } = await import("playwright").catch(() => {
  console.error("Playwright is required: npm i -D playwright && npx playwright install chromium");
  process.exit(1);
});

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots");
const PIN = "1234";
const NIM = 100_000;

// ---------------------------------------------------------------- staging

const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  if (!r.ok) console.warn(`  ! ${r.status} ${path} ${JSON.stringify(body).slice(0, 140)}`);
  return { status: r.status, body };
};

// Chores are priced in DOLLARS, not in a flat NIM amount. This matters: the Treasure Box
// is priced in real money (a sticker pack is ~$0.94, which is ~2,000 NIM), so a household
// whose chores pay a flat 1 NIM can never afford anything on the shelves, and every
// spend-side screen photographs as an empty state. `POST /chores` already converts a
// dollar price to whole NIM at today's rate; this uses that path.
const PLAN = {
  Sam: [
    { title: "Empty the dishwasher", rewardUsd: 1.0, emoji: "🍽️", pay: true },
    { title: "Walk the dog", rewardUsd: 0.75, emoji: "🐕", pay: true },
    { title: "Take out the trash", rewardUsd: 0.5, emoji: "🗑️", pay: true },
    { title: "Practice piano", rewardUsd: 1.5, emoji: "🎹", pay: true },
    { title: "Rake the leaves", rewardUsd: 2.0, emoji: "🍂", pay: false },
  ],
  Ava: [
    { title: "Fold the laundry", rewardUsd: 1.0, emoji: "🧺", pay: true },
    { title: "Feed the cat", rewardUsd: 0.5, emoji: "🐈", pay: true },
    { title: "Water the plants", rewardUsd: 0.75, emoji: "🪴", pay: false },
  ],
};

async function stage() {
  const mint = await api("/api/demo/family", { method: "POST" });
  if (mint.status !== 201) {
    throw new Error(`could not mint a demo family (${mint.status}). Set HATCH_DEMO_SEED=1 on the instance.`);
  }
  const { parentToken, deviceToken, children } = mint.body;
  const P = { Authorization: `Bearer ${parentToken}` };
  const D = { Authorization: `Bearer ${deviceToken}` };

  const { nimUsd } = (await api("/api/rates")).body;
  console.log(`rate: 1 NIM = $${nimUsd} ($1 = ${Math.round(1 / nimUsd)} NIM)`);

  for (const kid of children) {
    for (const ch of PLAN[kid.label] ?? []) {
      const made = await api("/api/chores", {
        method: "POST", headers: P,
        body: JSON.stringify({ childId: kid.id, title: ch.title, rewardUsd: ch.rewardUsd, emoji: ch.emoji }),
      });
      const chore = made.body?.chore ?? made.body;
      if (!chore?.id) continue;
      await api(`/api/chores/${chore.id}/submit`, { method: "POST", headers: D });
    }
  }

  // The parent works the queue, deliberately leaving the `pay: false` rows pending so the
  // approvals screen has real work on it when it is photographed.
  const pay = new Set(Object.values(PLAN).flat().filter(c => c.pay).map(c => c.title));
  const { approvals = [] } = (await api("/api/approvals", { headers: P })).body;
  let approved = 0;
  for (const a of approvals) {
    if (!pay.has(a.summary?.title ?? "")) continue;
    if ((await api(`/api/approvals/${a.id}/approve`, {
      method: "POST", headers: P, body: JSON.stringify({ pin: PIN }),
    })).status === 200) approved += 1;
  }
  console.log(`approved and paid: ${approved}`);

  // Spend it back inside the family, and put some to work, so neither the Treasure Box
  // nor Grow photographs as a zero.
  const sam = children.find(c => c.label === "Sam") ?? children[0];
  const { items = [] } = (await api(`/api/kids/${sam.id}/store`, { headers: D })).body;
  const pack = items.find(i => i.kind === "pack" && i.priceLuna > 0 && !i.owned);
  if (pack) await api(`/api/kids/${sam.id}/buy`, { method: "POST", headers: D, body: JSON.stringify({ itemId: pack.id }) });
  await api(`/api/kids/${sam.id}/stake`, { method: "POST", headers: D, body: JSON.stringify({ valueLuna: 1500 * NIM }) });

  const w = (await api(`/api/kids/${sam.id}/wallet`, { headers: D })).body;
  const balance = Number(w.balanceLuna ?? 0) / NIM;
  console.log(`${sam.label}: ${balance.toFixed(0)} NIM after buying ${pack?.title ?? "nothing"} and staking 1500`);

  // Fail loudly rather than quietly shipping empty-state screenshots.
  if (balance < 1000) throw new Error(`staging left ${sam.label} with only ${balance} NIM; the spend-side screens would photograph empty`);

  return { parentToken, deviceToken, children, sam };
}

// ---------------------------------------------------------------- capture

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function shot(page, name, settle = 900) {
  await wait(settle);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

const tap = async (page, selector, settle = 700) => {
  await page.click(selector, { timeout: 8000 }).catch(() => console.warn(`  ! no ${selector}`));
  await wait(settle);
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const health = await api("/health");
  if (health.status !== 200) throw new Error(`no instance at ${BASE}`);
  console.log(`nimiq.kids ${health.body.v} · ${health.body.network} · sim=${health.body.sim}`);

  const { parentToken, deviceToken, sam } = await stage();

  const browser = await chromium.launch();
  // DPR 2, not 3. The README renders these around 300px wide, so a 780px asset is
  // already oversampled, and DPR 3 tripled the repo's image weight for no visible gain.
  const phone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

  // The kid app opens on the roster ("Who are you?"), so a kid has to be chosen before
  // the board and its dock exist at all.
  // A remembered kid skips the roster and lands straight on the board, so both
  // outcomes have to be tolerated or the second visit throws.
  const openKid = async (page) => {
    await page.goto(`${BASE}/kid/`, { waitUntil: "networkidle" });
    await page.evaluate(t => localStorage.setItem("kid.deviceToken", t), deviceToken);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".account-entry, .k-chart", { timeout: 20000 });
    if (await page.$(".account-entry")) {
      await page.click(`.account-entry[data-id="${sam.id}"]`);
      await page.waitForSelector(".k-chart", { timeout: 20000 });
    }
    await wait(1600);
  };

  const kidCtx = await browser.newContext(phone);
  const kid = await kidCtx.newPage();
  await openKid(kid);
  await shot(kid, "kid-home", 900);

  // ---- the circle, walked for real: the kid hands a job in, the parent approves it,
  // the money moves, and the board remembers it with a sticker.
  const todo = await kid.$('.ch-task[data-state="open"]');
  if (todo) {
    await todo.click();
    await wait(900);
    await tap(kid, "#dn-yes", 1600);            // "Yes, I did it"
  } else {
    console.warn("  ! no open job to hand in; loop-1 will show the board as-is");
  }
  await shot(kid, "loop-1-done", 1200);

  // ---- the parent's phone. The shell reads #t=<token> into localStorage, then strips
  // the fragment and reassigns location, so the second settle is not optional.
  const parentCtx = await browser.newContext(phone);
  const parent = await parentCtx.newPage();
  await parent.goto(`${BASE}/parent/#t=${parentToken}`, { waitUntil: "networkidle" });
  await wait(1500);
  await parent.waitForSelector("#tabs", { timeout: 20000 }).catch(() => {});
  // Parent home is deliberately not captured. Its TOTAL BALANCE reads from a snapshot
  // only `deposit-check` writes, so on a SIM instance it renders as a dash and looks
  // like an unloaded screen. Forcing the check writes a zero, which then makes
  // payableLuna() refuse every approval (src/repo-budget.ts). Leave it alone.
  await tap(parent, '#tabs button[data-tab="approvals"]', 1600);
  await shot(parent, "parent-approvals", 700);
  await shot(parent, "loop-2-queue", 200);

  // Approve, through the parent's own UI. The proof that this paid is on the kid's side,
  // so loop-3 is captured there, not here.
  await tap(parent, ".ap-approve, button:has-text('Approve')", 2800);

  await tap(parent, '#tabs button[data-tab="deposit"]', 1800);
  await shot(parent, "parent-topup", 1100);
  await parentCtx.close();

  // Back on the tablet, and the money is already there. This is step 3 of the circle:
  // the approval was the decision, and the transaction settled while the parent was
  // still looking at their phone.
  await openKid(kid);
  await tap(kid, "#dock-money", 2400);
  await shot(kid, "kid-money", 1200);
  await shot(kid, "loop-3-paid", 150);

  // An approved job then sits in the "reward" state until the kid opens it and picks a
  // sticker, which is what turns the payment into something the board remembers.
  await openKid(kid);
  // Jobs live in collapsible groups ("Morning", "Any time"), and a closed group keeps
  // its rows in the DOM but invisible, so they have to be opened before anything inside
  // can be tapped.
  for (const hd of await kid.$$('.ch-group:not(.is-open) .ch-group-hd')) {
    await hd.click({ timeout: 4000 }).catch(() => {});
    await wait(400);
  }
  const reward = await kid.$('.ch-task[data-state="reward"]');
  if (reward) {
    // The row can sit inside a collapsed group or below the fold on a 844px viewport.
    await reward.scrollIntoViewIfNeeded().catch(() => {});
    await reward.click({ timeout: 8000, force: true }).catch((e) => console.warn(`  ! reward tap: ${e.message.slice(0, 60)}`));
    await wait(1800);
    const sticker = await kid.$(".stkp-tile");
    if (sticker) {
      await sticker.scrollIntoViewIfNeeded().catch(() => {});
      await sticker.click({ timeout: 8000, force: true }).catch(() => {});
      await wait(1600);
      // Picking a sticker opens a drag layer; the sticker is only actually placed on a
      // pointerup inside the highlighted slot. Without this the shot catches the app
      // mid-drag, which is a transient state and not what the board looks like after.
      const slot = await kid.$(".slot-target");
      if (slot) {
        const b = await slot.boundingBox();
        if (b) {
          const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
          await kid.mouse.move(cx, cy - 40);
          await kid.mouse.down();
          await kid.mouse.move(cx, cy, { steps: 8 });
          await kid.mouse.up();
          await wait(2400);
        }
      } else {
        console.warn("  ! no drop slot; loop-4 may catch the drag layer");
      }
    }
  } else {
    console.warn("  ! nothing waiting for a sticker; loop-4 will show the board as-is");
  }
  await shot(kid, "loop-4-sticker", 1400);

  // ---- the rest of the kid's tablet
  await openKid(kid);                      // the sticker sheet covers the dock
  await tap(kid, "#dock-box", 1800);
  await shot(kid, "kid-treasure-box", 900);
  // An affordable shelf shows "get it" (#bx-buy); an unaffordable one shows "go earn some".
  const tile = await kid.$(".stkp-tile, .bx-tile");
  if (tile) {
    await tile.scrollIntoViewIfNeeded().catch(() => {});
    await tile.click({ timeout: 8000, force: true }).catch(() => {});
    await wait(1400);
    if (!(await kid.$("#bx-buy"))) console.warn("  ! buy sheet is in the cannot-afford state");
  }

  await openKid(kid);
  await tap(kid, "#add-job", 1600);
  await shot(kid, "kid-add-job", 900);

  await openKid(kid);                      // the add-job sheet covers the dock
  await tap(kid, "#dock-timer", 3600);
  await shot(kid, "kid-timer", 2400);

  await kidCtx.close();

  // ---- entry surface
  const marketing = await browser.newContext(phone);
  const m = await marketing.newPage();
  await m.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
  await shot(m, "demo-landing", 1200);
  await marketing.close();

  await browser.close();
  console.log(`\nwrote ${OUT}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
