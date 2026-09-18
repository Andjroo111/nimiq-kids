#!/usr/bin/env python3
"""The plate never runs into the white card, on any phone shape.

  python3 tools/eggtimer-setcard.py [base-url]

Andjroo, 2026-09-15, off his phone: "This is over the hex". The card's top is a share of
H and the plate used to be a share of W, so any frame shorter than 2.16:1 (the app's
frame under the host's chrome is) put the plate's bottom vertex on the card. The plate is
sized off the badge now, and the badge is capped so the plate's canvas stops 12px short
of the card. Asserts, on set AND run, at every shape below:
  plate canvas bottom + 12 <= card top · card bottom inside the frame · the set card is
  the run card's box (same top, bottoms within 4px) · no page errors.
Shots land in $SCRATCH (default /tmp) as setcard-<W>x<H>-<screen>.png.
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("U", "http://localhost:8766/index.html")
OUT = os.environ.get("SCRATCH", "/tmp") + "/"
SHAPES = [(390, 844), (390, 760), (390, 700), (360, 640), (430, 932), (375, 667), (768, 1024)]

PROBE = """()=>{const r=id=>document.getElementById(id).getBoundingClientRect();
  const p=r('plate'), s=r('setCard'), c=r('runCard'), a=r('app');
  return {plateBottom:p.bottom, setTop:s.top, setBottom:s.bottom, runTop:c.top, runBottom:c.bottom, H:a.height}}"""


async def m():
    bad = 0
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for W, H in SHAPES:
            ctx = await b.new_context(viewport={"width": W, "height": H})
            pg = await ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            await pg.goto(BASE + "?clean", wait_until="load"); await pg.wait_for_timeout(2000)
            g = await pg.evaluate(PROBE)
            await pg.screenshot(path=f"{OUT}setcard-{W}x{H}-set.png")
            await pg.click("#start"); await pg.wait_for_timeout(900)
            await pg.screenshot(path=f"{OUT}setcard-{W}x{H}-run.png")
            gap = g["setTop"] - g["plateBottom"]
            ok = (gap >= 12 and g["setBottom"] <= g["H"] and g["runBottom"] <= g["H"]
                  and abs(g["setTop"] - g["runTop"]) < 1 and abs(g["setBottom"] - g["runBottom"]) <= 4
                  and not errs)
            bad += not ok
            print(f"{'ok ' if ok else 'BAD'} {W}x{H}  plate bottom {g['plateBottom']:.0f}  card {g['setTop']:.0f}..{g['setBottom']:.0f}"
                  f"  gap {gap:.0f}  run card {g['runTop']:.0f}..{g['runBottom']:.0f}  {errs or ''}")
            await ctx.close()
        await b.close()
    sys.exit(1 if bad else 0)


asyncio.run(m())
