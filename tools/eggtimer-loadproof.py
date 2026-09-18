#!/usr/bin/env python3
"""The timer arrives ONCE: whole, and nothing moves after the cover lifts.

  python3 tools/eggtimer-loadproof.py <url-to-timer> [cpu-slowdown]

Andjroo, 2026-09-18: "it's just kind of glitchy whenever the page loads." Measured on
the .186 tablet it was three things, each asserted below:
  1. the cover lifted on an EMPTY plate. The rig said inked on its first frame, but
     the egg is a PNG inside egghatch.riv and the runtime decodes those after onLoad;
     the egg's centre pixel was alpha 0 for another second. The rig now decodes its
     own shells and inks when they are drawn.
  2. the hexagon was not awaited at all, so it popped in after the fade.
  3. the egg SHRANK by 17% over .52s as it faded in: layout() ran first from the old
     canvas egg's geometry and again from the rig's, and #rigWrap tweens its box.
     The fallback is the rig's geometry now and nothing tweens under the cover.
Runs at a CPU slowdown (default 4x) because that is where the tablet lives.
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3986/kid/timer/index.html?clean=1"
CPU = int(sys.argv[2]) if len(sys.argv) > 2 else 4

EGG_PX = """(()=>{ const c=document.getElementById('rive'); const g=c.getContext('2d');
  const y=Math.round(c.height*316.92/560), x=Math.round(c.width/2);
  const d=g.getImageData(x-2,y-2,5,5).data; let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return n })()"""
PLATE_PX = """(()=>{ const c=document.getElementById('plate'); const g=c.getContext('2d');
  const d=g.getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4*61) if(d[i]>0) n++; return n })()"""
RIG_BOX = """(()=>{ const r=document.getElementById('rigWrap').getBoundingClientRect(); return [r.left,r.top,r.width,r.height].map(v=>Math.round(v*10)/10) })()"""


async def m():
    fails = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda msg: errs.append(msg.text) if msg.type == "error" else None)
        cdp = await ctx.new_cdp_session(pg)
        await cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU})
        await pg.goto(URL, wait_until="commit")
        revealed = False
        for _ in range(600):
            await pg.wait_for_timeout(20)
            try:
                revealed = await pg.evaluate("!!(window.TIMER&&window.TIMER.revealed)")
            except Exception:
                pass
            if revealed:
                break
        if not revealed:
            fails.append("the cover never lifted")
        else:
            box0 = await pg.evaluate(RIG_BOX)      # FIRST: the pixel reads below are slow at 4x
            rig = [f for f in pg.frames if "wiggle.html" in f.url][0]
            egg = await rig.evaluate(EGG_PX)
            plate = await pg.evaluate(PLATE_PX)
            print(f"at reveal: egg centre {egg}/25 px painted, plate {plate} opaque samples, rig box {box0}")
            if egg < 25: fails.append(f"the cover lifted on an unpainted egg ({egg}/25)")
            if plate < 100: fails.append(f"the cover lifted on an undrawn plate ({plate})")
            # long enough for the late hook the old page had (2.4s at 4x, off the frame's
            # load event) and then its .52s tween; the fixed page is still from the reveal on
            moved = None
            for _ in range(30):
                await pg.wait_for_timeout(100)
                box1 = await pg.evaluate(RIG_BOX)
                if box1 != box0: moved = box1; break
            if moved: fails.append(f"the rig moved after the reveal: {box0} -> {moved}")
        if errs: fails.append(f"console errors: {errs}")
        await b.close()
    if fails:
        print("FAIL —", "; ".join(fails)); sys.exit(1)
    print("PASS — whole at the reveal, still afterwards")


asyncio.run(m())
