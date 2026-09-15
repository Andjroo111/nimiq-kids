// Drive the SHARE SLIDER on an approval card (#352) in a real browser.
//
//   BASE=http://127.0.0.1:3996 node parent-share-slider.mjs
//
// The assertion no unit test can make is the last one: a range input does NOT put its thumb
// at the raw percentage, it insets the travel by half a thumb at each end. Position the
// hairline and the quarter ticks by raw percent and they drift off the disc at the ends —
// visibly, and only on a rendered page. This measures the painted hairline against the
// painted tick and fails on more than 1.5px.
//
// Boot a throwaway instance with a FRESH DB:
//   rm -f /tmp/sh.db && bun run build:shell
//   PORT=3996 DB_PATH=/tmp/sh.db NIMIQ_SIM=1 NIMIQ_NETWORK=test HATCH_DEMO_ENABLED=1 \
//     HATCH_DEMO_GRANT_LUNA=100000000000 bun run src/server.ts
//
// Playwright resolves node_modules from the SCRIPT'S directory and this repo does not depend
// on it: COPY this file somewhere that does (`~/Projects/sendhome`).

const BASE = process.env.BASE ?? "http://127.0.0.1:3996";
const OUT = process.env.OUT ?? "/tmp/share";
const { chromium } = await import("playwright");
const fs = await import("node:fs");
fs.mkdirSync(OUT, { recursive: true });
const api = async (p, o = {}, tok) => (await fetch(BASE + p, { ...o, headers: { "content-type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } })).json();
const mint = await api("/api/demo/family", { method: "POST" });
const PARENT = mint.parentToken;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch();
let failed = false;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` -- ${d}` : ""}`); if (!ok) failed = true; };

for (const [w, h, tag] of [[390, 844, "phone"], [800, 1280, "tablet"]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(`${BASE}/parent/#t=${PARENT}`, { waitUntil: "networkidle" });
  await wait(2200);
  await p.locator('[data-tab="approvals"]').click(); await wait(1800);

  const wrap = p.locator(".sh-wrap").first();
  check(`${tag}: an earn card has a share slider`, await wrap.count() > 0);
  // it starts at FULL: no hatch, no hairline, no note
  check(`${tag}: starts at full — no hatch, no note`,
    await p.locator(".sh-held:visible").count() === 0 && await p.locator(".sh-note:visible").count() === 0);
  const fullLabel = (await p.locator("[data-approve]").first().textContent()).trim();
  await p.screenshot({ path: `${OUT}/${tag}-1-full.png` });

  // tap the 50% tick
  await p.locator('.sh-tick[data-bps="5000"]').first().click(); await wait(400);
  check(`${tag}: half reveals the hatch and the note`,
    await p.locator(".sh-held:visible").count() > 0 && await p.locator(".sh-note:visible").count() > 0);
  const halfLabel = (await p.locator("[data-approve]").first().textContent()).trim();
  check(`${tag}: the button says what it will pay`, halfLabel !== fullLabel && /\d/.test(halfLabel), `"${fullLabel}" -> "${halfLabel}"`);
  const readout = (await p.locator(".sh-read .amount").first().textContent()).trim();
  const of = (await p.locator(".sh-of").first().textContent()).trim();
  console.log(`   readout "${readout}"  of "${of}"  btn "${halfLabel}"`);
  await p.screenshot({ path: `${OUT}/${tag}-2-half.png` });

  // THE ASSERTION THAT MATTERS, and the one this file first got wrong. It used to measure the
  // hairline against the tick — both painted from the SAME arithmetic, so it passed while the
  // bar was lying: 25% of the money drew 2% of the bar and 50% drew a third of it. Andjroo saw
  // it in a screenshot the green check had already signed off on.
  // Measure the paint against THE SHARE ITSELF. Nothing else is independent of the bug.
  // Driven through the INPUT, not by clicking ticks: 0 and 100 have no tick (they are the ends
  // of the track, not detents), so a tick-click loop can only ever check the middle.
  const drive = async (pct) => { await p.locator(".sh-input").first().evaluate((el, v) => {
    el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }, pct); await wait(250); };
  for (const bps of [0, 2500, 5000, 7500, 10000]) {
    await drive(bps / 100);
    const m = await p.evaluate(() => {
      const t = document.querySelector(".sh-track").getBoundingClientRect();
      const paid = document.querySelector(".sh-paid").getBoundingClientRect();
      const sep = document.querySelector(".sh-sep");
      const s = sep.hidden ? null : sep.getBoundingClientRect();
      return {
        solid: paid.width / t.width * 100,
        // No hairline is drawn at either end: at 100% nothing is held back and at 0% nothing
        // is paid, so the split IS the end it sits on.
        split: s ? (s.x + s.width / 2 - t.x) / t.width * 100
          : (paid.width > 0 ? 100 : 0),
      };
    });
    const want = bps / 100;
    // The split point is the value. The solid segment stops a 7px handle-gap short of it,
    // which on a phone track is ~2.2 points — so the bar gets the looser bound of the two.
    // At the ends there is no handle gap, so both are exact.
    check(`${tag}: a ${want}% share splits the bar at ${want}%`, Math.abs(m.split - want) <= 1,
      `split ${m.split.toFixed(1)}%`);
    check(`${tag}: ...and paints ${want}% of it solid`, Math.abs(m.solid - want) <= 3,
      `solid ${m.solid.toFixed(1)}%`);
  }
  await drive(50);

  await p.locator('.sh-tick[data-bps="2500"]').first().click(); await wait(400);
  await p.screenshot({ path: `${OUT}/${tag}-3-quarter.png` });

  // ---- the detents, and the two ends ------------------------------------------------------
  // SCOPED TO ONE CARD: the queue holds several, so an unscoped count measures the fixture.
  const card = p.locator(".ap-card").first();
  check(`${tag}: three detents, 25/50/75 — the ends are just the ends`,
    (await card.locator(".sh-tick").count()) === 3,
    (await card.locator(".sh-ticks").textContent()).trim().replace(/\s+/g, " "));
  const set = async (v) => { await card.locator(".sh-input").evaluate((el, val) => {
    el.value = String(val); el.dispatchEvent(new Event("input", { bubbles: true })); }, v); await wait(220); };
  // Magnetic near a quarter, free everywhere else. The second half of that is the half worth
  // testing: a detent that swallows 40% has stopped being a detent and become a stop.
  for (const [drag, want] of [[27, 25], [48, 50], [72, 75], [40, 40], [63, 63]]) {
    await set(drag);
    check(`${tag}: drag to ${drag} settles on ${want}`,
      Number(await card.locator(".sh-input").inputValue()) === want,
      `got ${await card.locator(".sh-input").inputValue()}`);
  }

  // ALL THE WAY EMPTY IS A SEND BACK, not a payment of nothing: paying zero and calling it an
  // approval closes the job for good at no pay, which is harsher than the reject it looks
  // gentler than.
  await set(0);
  const zbtn = card.locator("[data-approve]");
  check(`${tag}: empty turns the action into Send back`,
    (await zbtn.textContent()).trim() === "Send back", (await zbtn.textContent()).trim());
  check(`${tag}: empty draws no solid segment at all`,
    (await card.locator(".sh-paid").evaluate((e) => e.getBoundingClientRect().width)) === 0);
  check(`${tag}: empty drops the now-duplicate 'Not yet'`,
    (await card.locator("[data-reject]:visible").count()) === 0);
  // Green is success only (nimiq-ui rule 5) and sending work back is not one.
  check(`${tag}: and it is navy, not green`,
    await zbtn.evaluate((e) => e.classList.contains("navy") && !e.classList.contains("green")));
  await p.screenshot({ path: `${OUT}/${tag}-4-empty.png` });
  await set(100);
  check(`${tag}: no page errors`, errs.length === 0, errs.join(" | "));
  await ctx.close();
}
await b.close();
console.log(failed ? "\nFAILED" : "\nAll checks passed");
process.exit(failed ? 1 : 0);
