#!/usr/bin/env python3
"""The tuning page must never paint when the rig is embedded.

  python3 tools/noflash.py <url-to-wiggle.html?embed=1>

embed() runs at the end of start(), which waits on four JSON fetches and ~30 images.
Before 2026-07-31 that meant the whole tuning page -- header, tabs, face picker, crack
grid, sliders -- was painted and sat there for the length of that load. This samples
DURING the load, on a throttled connection, and fails if any of that chrome is visible.
"""
import asyncio, io, os, sys
from playwright.async_api import async_playwright
from PIL import Image

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3985/wiggle.html?embed=1"
OUT = os.environ.get("SCRATCH", "/tmp") + "/"


async def m():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 390, "height": 560})
        # throttle, so the load is long enough to sample mid-flight like a phone would
        cdp = await pg.context.new_cdp_session(pg)
        await cdp.send("Network.enable")
        await cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": 120,
            "downloadThroughput": 900 * 1024 / 8, "uploadThroughput": 512 * 1024 / 8})
        await pg.goto(URL, wait_until="commit")
        worst, shots = 0, []
        for i in range(12):
            await pg.wait_for_timeout(220)
            vis = await pg.evaluate("""(()=>{
                const sel=['header','#stripCard','.tabs','#faceLib','#patRow','#crackList'];
                let n=0, names=[];
                for(const s of sel){ for(const e of document.querySelectorAll(s)){
                    const r=e.getBoundingClientRect();
                    if(r.width>2&&r.height>2&&getComputedStyle(e).display!=='none'){n++;names.push(s);break} } }
                return {n, names, ready:!!window.RIG};
            })()""")
            worst = max(worst, vis["n"])
            if vis["n"]:
                print(f"  t+{(i+1)*220}ms  VISIBLE: {vis['names']}")
                shots.append(Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"))
            if vis["ready"]:
                print(f"  rig ready at t+{(i+1)*220}ms")
                break
        await b.close()
    if shots:
        shots[0].save(OUT + "noflash-FAIL.png")
        print("wrote", OUT + "noflash-FAIL.png")
    assert worst == 0, f"the tuning page painted while embedded ({worst} region(s))"
    print("PASS — no tuning chrome ever painted")


asyncio.run(m())
