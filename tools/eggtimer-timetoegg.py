#!/usr/bin/env python3
"""How long until the EGG is on screen — not until the page answers.

  python3 tools/timetoegg.py <url> [kbps]

Andjroo, 2026-07-31: "things are still kinda loading out of pace, and the egg loads
last." The chrome renders immediately; the egg is the subject and it was behind every
byte of art. This throttles the link and polls the rig's own stage canvas for ink, so
the number is when a child would SEE the egg.
"""
import asyncio, sys
from playwright.async_api import async_playwright

URL = sys.argv[1]
KBPS = int(sys.argv[2]) if len(sys.argv) > 2 else 1600


async def m():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 390, "height": 844})
        cdp = await pg.context.new_cdp_session(pg)
        await cdp.send("Network.enable")
        await cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": 90,
            "downloadThroughput": KBPS * 1024 / 8, "uploadThroughput": 512 * 1024 / 8})
        t0 = asyncio.get_event_loop().time()
        await pg.goto(URL, wait_until="commit")
        egg = done = None
        for _ in range(400):
            await pg.wait_for_timeout(100)
            r = await pg.evaluate("""(()=>{
              const f=document.getElementById('rig');
              const d=f?f.contentDocument:document;
              const c=d&&d.getElementById('stage'); if(!c) return {ink:0,all:false};
              const g=c.getContext('2d');
              let n=0; try{ const px=g.getImageData(0,0,c.width,c.height).data;
                for(let i=3;i<px.length;i+=4*401) if(px[i]>8) n++; }catch(e){}
              const w=f?f.contentWindow:window;
              return {ink:n, all: !!(w.RIG && w.RIG.patterns && w.RIG.patterns().length)};
            })()""")
            t = asyncio.get_event_loop().time() - t0
            if egg is None and r["ink"] > 20:
                egg = t
            if egg is not None and t - egg > 6:
                break
        await b.close()
    print(f"  {KBPS} kbps → EGG ON SCREEN at {egg:.2f}s" if egg else f"  {KBPS} kbps → egg never drew")
    return egg


asyncio.run(m())
