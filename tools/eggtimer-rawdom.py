#!/usr/bin/env python3
"""The set screen must never be seen before it has been laid out.

  python3 tools/rawdom.py <url-to-timer> [kbps]

Andjroo, 2026-08-01: opening the timer showed "a weird little pop up where it looks
like there's almost a list of things", for a split second, before the egg.

It was the minute column. EVERY dimension on the set screen comes from layout() —
there is no CSS fallback for any of them — so a paint that beats layout() shows the
sixty numbers at their natural height, 1440px, running the length of the phone. What
let a paint beat layout() was a top-level `await import()` sitting between fillCol()
and layout(); the module suspended there for one round trip and the browser painted
the gap. One round trip, so it survived every bandwidth: ~80ms on localhost at 8 Mbps,
200-400ms on a phone.

This samples DURING the load and fails if the column is ever taller than the ~3-row
box layout() gives it, or if the cover is gone while the screen is still unsized. It
does not care HOW the flash comes back — a second await, a slow font, a stylesheet
that arrives late — only that it is visible, which is the only part Andjroo can see.
"""
import asyncio
import io
import os
import sys

from playwright.async_api import async_playwright
from PIL import Image

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3986/kid/timer/index.html?clean=1"
KBPS = float(sys.argv[2]) if len(sys.argv) > 2 else 1600
OUT = os.environ.get("SCRATCH", "/tmp") + "/"

# layout() gives the column three rows plus a row of padding top and bottom. Anything
# past this and it is the raw list, not a laid-out one.
MAX_COL_H = 320

PROBE = """(()=>{
  const c=document.getElementById('colMin');
  const cover=document.getElementById('preboot');
  if(!c) return {n:0};
  const h=Math.round(c.getBoundingClientRect().height);
  const covered=!!cover && !cover.classList.contains('gone');
  return {n:c.children.length, h, covered,
          ready:!!(window.TIMER&&window.TIMER.revealed)};
})()"""


async def m():
    worst, shots = 0, []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  ignore_https_errors=True)
        pg = await ctx.new_page()
        cdp = await ctx.new_cdp_session(pg)
        await cdp.send("Network.enable")
        await cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": 90,
            "downloadThroughput": KBPS * 1024 / 8, "uploadThroughput": 512 * 1024 / 8})
        await pg.goto(URL, wait_until="commit")
        for i in range(60):
            await pg.wait_for_timeout(50)
            t = (i + 1) * 50
            s = await pg.evaluate(PROBE)
            # A tall column behind the cover is invisible and therefore not the bug.
            if s.get("n") and s["h"] > MAX_COL_H and not s.get("covered"):
                worst = max(worst, s["h"])
                print(f"  t+{t}ms  RAW: #colMin is {s['h']}px, uncovered")
                shots.append(Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"))
            if s.get("ready"):
                print(f"  arrived at t+{t}ms  (#colMin {s['h']}px)")
                break
        await b.close()

    if shots:
        shots[0].save(OUT + "rawdom-FAIL.png")
        print("wrote", OUT + "rawdom-FAIL.png")
    assert worst == 0, (
        f"the set screen was painted before layout() ran — #colMin reached {worst}px "
        f"(laid out it is <= {MAX_COL_H}px). This is Andjroo's 'list of things'.")
    print("PASS — the set screen was never seen unsized")


asyncio.run(m())
