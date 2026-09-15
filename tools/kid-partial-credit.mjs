// The kid's own screen after a grown-up paid PART of a job (#369, epic #349).
//
//   BASE=http://127.0.0.1:3999 node kid-partial-credit.mjs
//
// #370 shipped with this unverified: the data path was proven at the API, but the render was
// not, because nothing could drive the kid app past first-run enrolment. tools/kid-drive.mjs
// is that missing piece, and this is the check it was missing for.
//
// What it is really asserting: that the number on a CHILD'S screen is the number the server
// moved. Everything else in this feature is a grown-up's convenience; this is the promise.
//
// Copy alongside kid-drive.mjs into a directory that has playwright (`~/Projects/sendhome`).

import { demoHousehold, openKidBoard } from "./kid-drive.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3999";
const OUT = process.env.OUT ?? "/tmp/kidpc";
const { chromium } = await import("playwright");
const fs = await import("node:fs"); fs.mkdirSync(OUT, { recursive: true });

let failed = false;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` -- ${d}` : ""}`); if (!ok) failed = true; };
const api = async (p, o = {}, t) => (await fetch(BASE + p, { ...o, headers: {
  "content-type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(o.headers || {}) } })).json();

const home = await demoHousehold(BASE);
const kid = home.children[0];
const ap = (await api("/api/parent/overview", {}, home.parentToken))
  .pending.find((a) => a.subjectKind === "chore" && a.child?.id === kid.id);
const FULL = ap.rewardLuna;
const NOTE = "the desk is still a mess";
const paid = (await api(`/api/approvals/${ap.id}/approve`, {
  method: "POST", body: JSON.stringify({ shareBps: 2_500, note: NOTE }),
}, home.parentToken)).paidLuna;
console.log(`   ${ap.summary?.title ?? "a chore"} worth ${FULL} approved at 25% -> paid ${paid}`);

// The kid app prints whole coins with a thin space between thousands (fmtNimLuna, util.js).
// The kid app prints WHOLE coins (fmtNimLuna, util.js) and only groups thousands above four
// digits, so "+6000 NIM" and "48 002 NIM" are both real renders. Rather than model that, both
// sides are compared with every separator stripped: this asserts the NUMBER, not where the app
// happens to put its spaces. Getting that wrong reads as a failing fix.
const digits = (v) => String(v).replace(/[\s\u202f\u00a0,]/g, "");
const shown = (luna) => digits(Math.round(luna / 1e5));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await openKidBoard(ctx, { base: BASE, deviceToken: home.deviceToken, child: kid });
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await new Promise((r) => setTimeout(r, 2000));

// Chores land in "Any time", which is COLLAPSED on load. A text assertion against the board
// without opening it passes or fails on whether a section happens to be shut, which is a fact
// about the fixture and not about the fix.
for (const label of ["Any time", "Anytime"]) {
  const sec = page.getByText(label, { exact: false }).first();
  if (await sec.count()) { await sec.click().catch(() => {}); await new Promise((r) => setTimeout(r, 1200)); break; }
}
await new Promise((r) => setTimeout(r, 1200));
const body = (await page.locator("body").textContent()).replace(/\s+/g, " ");

const flat = digits(body);
check("the kid's card shows what the job PAID", flat.includes(shown(paid)), `looking for "${shown(paid)}"`);
check("...and never the full price it advertised", !flat.includes(shown(FULL)), `must not contain "${shown(FULL)}"`);
check("no page errors", errs.length === 0, errs.join(" | "));
await page.screenshot({ path: `${OUT}/kid-partial.png` });

await browser.close();
console.log(failed ? "\nFAILED" : "\nAll checks passed");
process.exit(failed ? 1 : 0);
