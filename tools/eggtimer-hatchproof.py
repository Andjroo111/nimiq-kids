#!/usr/bin/env python3
"""A run that starts the INSTANT the timer arrives must still crack and still hatch.

  python3 hatchproof.py <url> [kbps]

The point of the change under test is that the crack sprites and the characters load
AFTER the screen arrives. So the case that matters is the impatient one: reveal, then
Start on the very next frame, on a slow link. The roll must still land on art that
exists, the egg must still break, and a character must still come out.
"""
import asyncio, io, os, sys
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw

URL = sys.argv[1]
KBPS = float(sys.argv[2]) if len(sys.argv) > 2 else 1600
OUT = os.environ.get("SCRATCH", "/tmp") + "/"

RIG = """(()=>{const w=document.getElementById('rig').contentWindow;
  return w.RIG?{pattern:w.RIG.pattern(), hero:w.RIG.hero(),
                heroLoaded:w.RIG.loaded(w.RIG.hero()),
                patLoaded:w.RIG.loaded('crack-p'+w.RIG.pattern()+'-cracked'),
                st:w.RIG.state()}:null})()"""


async def m():
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                  ignore_https_errors=True)
        pg = await ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        pg.on("console", lambda c: errs.append(c.text) if c.type == "error" else None)
        cdp = await ctx.new_cdp_session(pg)
        await cdp.send("Network.enable")
        await cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": 90,
            "downloadThroughput": KBPS * 1024 / 8, "uploadThroughput": 512 * 1024 / 8})

        await pg.goto(URL, wait_until="commit")
        t = 0
        while t < 15000:
            await pg.wait_for_timeout(25); t += 25
            if await pg.evaluate("!!(window.TIMER&&window.TIMER.revealed)"):
                break
        print(f"arrived at {t/1000:.2f}s — pressing Start on the next frame")

        # ⚠️ TAP ONCE, THE INSTANT THE SCREEN ARRIVES. Below ~1.9 Mbps the cover gives
        # up at CAP before the rig has hooked, so this tap is legitimately a no-op —
        # Start's guard must keep us on the SET screen rather than throwing on
        # RIG.go(). Assert that, then wait for the rig and do the real run.
        await pg.evaluate("(()=>{const s=TIMER.state().S; s.min=0; s.sec=5})()")
        # read BEFORE the click — the rig can appear in the 250ms after it, and then
        # "there was a rig" would be a statement about the wrong moment
        had_rig = await pg.evaluate("!!document.getElementById('rig').contentWindow.RIG")
        await pg.click("#start")
        await pg.wait_for_timeout(250)
        if not had_rig:
            scr = await pg.evaluate("TIMER.state().screen")
            assert scr == "set", f"Start ran without a rig — screen is {scr!r}"
            print("  the cover gave up before the rig; Start correctly did nothing")
            await pg.wait_for_function(
                "()=>!!document.getElementById('rig').contentWindow.RIG", timeout=30000)
            await pg.evaluate("(()=>{const s=TIMER.state().S; s.min=0; s.sec=5})()")
            await pg.click("#start")
            await pg.wait_for_timeout(250)
        assert await pg.evaluate("TIMER.state().screen") == "run", "Start did not start"
        rolled = await pg.evaluate(RIG)
        print(f"  rolled: pattern={rolled['pattern']} (art in: {rolled['patLoaded']})  "
              f"hero={rolled['hero']} (art in: {rolled['heroLoaded']})")

        shots = []
        for _ in range(40):
            await pg.wait_for_timeout(500)
            s = await pg.evaluate(RIG)
            if s["st"]["breaking"]:
                break
        await pg.wait_for_timeout(2600)          # through the break and the landing
        s = await pg.evaluate(RIG)
        print(f"  after the break: breaking={s['st']['breaking']} landed={s['st']['landed']} "
              f"heroIn={s['st']['heroIn']}  hero art in: {s['heroLoaded']}")
        shots.append(Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"))

        # is there actually a character on the canvas?
        ink = await pg.evaluate("""(()=>{const w=document.getElementById('rig').contentWindow;
          const c=w.document.getElementById('stage');
          const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          let n=0; for(let i=3;i<d.length;i+=400) if(d[i]>8) n++; return n})()""")
        print(f"  ink on the rig canvas at the hatch: {ink}")
        await b.close()

    shots[0].save(OUT + "hatchproof.png")
    print("wrote", OUT + "hatchproof.png")
    assert not errs, f"page errors: {errs[:4]}"
    # ⚠️ NOT "the art is in at Start". Wave 1b (the active pattern's CRACKED sprite,
    # and the faces) resolves after start(), which is also when the screen arrives —
    # so a run begun on the very next frame legitimately begins before it lands. That
    # was true before this change and is unchanged by it. What must hold is the end:
    # the break lands, and both the crack and the character are real by then.
    assert s["st"]["landed"], "the break never landed"
    assert s["patLoaded"], "the crack art was still missing at the hatch"
    assert s["heroLoaded"], "hatched a character whose art had not landed"
    assert ink > 100, f"the hatch drew almost nothing ({ink})"
    print("PASS — an impatient run still cracks and still hatches a character")


asyncio.run(m())
