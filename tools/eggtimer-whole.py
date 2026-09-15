#!/usr/bin/env python3
"""When is the timer WHOLE — background decoded and the egg really drawn?

Measured independently of the cover's cap, so the cap can be chosen from this rather
than the other way round.
"""
import asyncio, sys
from playwright.async_api import async_playwright

URL = sys.argv[1]
SPEEDS = [int(x) for x in sys.argv[2].split(",")] if len(sys.argv) > 2 else [700, 1600, 4000, 8000]

PROBE = """(()=>{
  const b=document.getElementById('bgImg');
  const bg=!!(b&&b.complete&&b.naturalWidth>0);
  let ink=false;
  try{ const w=document.getElementById('rig').contentWindow;
       const c=w.document.getElementById('stage');
       const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
       for(let i=3;i<d.length;i+=4000){ if(d[i]>8){ink=true;break} }
  }catch(e){}
  return {bg, ink, revealed:!!(window.TIMER&&window.TIMER.revealed)};
})()"""


async def m():
    print(f"{'kbps':>6} {'background':>12} {'egg drawn':>12} {'WHOLE':>10}")
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for kbps in SPEEDS:
            ctx = await b.new_context(viewport={"width": 390, "height": 844},
                                      ignore_https_errors=True)
            pg = await ctx.new_page()
            cdp = await ctx.new_cdp_session(pg)
            await cdp.send("Network.enable")
            await cdp.send("Network.emulateNetworkConditions", {
                "offline": False, "latency": 90,
                "downloadThroughput": kbps * 1024 / 8, "uploadThroughput": 512 * 1024 / 8})
            await pg.goto(URL, wait_until="commit")
            tbg = tink = None
            t = 0
            while t < 20000:
                await pg.wait_for_timeout(25); t += 25
                s = await pg.evaluate(PROBE)
                if s["bg"] and tbg is None: tbg = t
                if s["ink"] and tink is None: tink = t
                if tbg and tink: break
            whole = max(tbg or 0, tink or 0)
            print(f"{kbps:>6} {(str(tbg)+'ms'):>12} {(str(tink)+'ms'):>12} {(str(whole)+'ms'):>10}")
            await ctx.close()
        await b.close()


asyncio.run(m())
