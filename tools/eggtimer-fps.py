#!/usr/bin/env python3
"""Is the running timer actually dropping frames, or does it just LOAD slowly?

  python3 tools/fps.py <timer-url> [cpu-throttle-x]

Samples the rig's own rAF loop while a countdown runs, and again through the hatch.
"""
import asyncio, sys
from playwright.async_api import async_playwright
URL=sys.argv[1]; CPU=float(sys.argv[2]) if len(sys.argv)>2 else 1

async def sample(f, ms):
    return await f.evaluate("""(ms)=>new Promise(res=>{
      const t=[]; let last=performance.now(), stop=performance.now()+ms;
      (function tick(){ const n=performance.now(); t.push(n-last); last=n;
        if(n<stop) requestAnimationFrame(tick);
        else { t.sort((a,b)=>a-b);
          res({fps:+(1000/(t.reduce((a,b)=>a+b,0)/t.length)).toFixed(1),
               p50:+t[t.length>>1].toFixed(1), p95:+t[Math.floor(t.length*.95)].toFixed(1),
               worst:+t[t.length-1].toFixed(1), frames:t.length}); } })();
    })""", ms)

async def m():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={"width":390,"height":844})
        if CPU>1:
            cdp=await pg.context.new_cdp_session(pg)
            await cdp.send("Emulation.setCPUThrottlingRate",{"rate":CPU})
        await pg.goto(URL)
        await pg.wait_for_function("window.TIMER && document.getElementById('rig').contentWindow.RIG",timeout=60000)
        await pg.wait_for_timeout(2500)
        rf=[f for f in pg.frames if "wiggle" in f.url]
        f=rf[0] if rf else pg.frames[-1]
        print(f"  idle (set screen) : {await sample(f,1500)}")
        await pg.click("#start"); await pg.wait_for_timeout(1500)
        print(f"  running           : {await sample(f,2500)}")
        await f.evaluate("RIG.hatchNow()"); await pg.wait_for_timeout(300)
        print(f"  hatch             : {await sample(f,2200)}")
        await b.close()
asyncio.run(m())
