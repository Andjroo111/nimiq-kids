#!/usr/bin/env python3
"""When a child SEES the egg after tapping Timer — in the REAL app.

  python3 tools/eggtimer-appegg.py [kbps]

`tools/eggtimer-timetoegg.py` times the timer page opened on its own. That is not
what Andjroo taps. In the app the timer is an iframe raised on top of a booted PWA,
so the honest number is measured from the TAP, twice on the same browser:

  1st open  nothing of the timer is in the HTTP cache yet
  2nd open  back to the chart, tap Timer again — the state Andjroo's tablet is in
            every time after the first

⚠️ THE SECOND OPEN IS THE ONE THAT MATTERS, and it is not free by default: the app
serves every .html `Cache-Control: no-cache` with etag and last-modified stripped
(src/serve-cache.ts), so an unversioned iframe re-downloads the whole timer and the
whole rig on every open with no 304 available.

⚠️ There is no service worker in play. `public/sw.js` exists and is stamped by the
cache-busting middleware, but nothing ever calls `navigator.serviceWorker.register`
in this branch — do not reason about SW caching here until something does.

Bytes over the wire are reported per open, because "cached" and "not fetched" are
different claims and only the second one is a speed win.
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

BASE = os.environ.get("U", "http://localhost:3986")
KBPS = int(sys.argv[1]) if len(sys.argv) > 1 else 1600


async def throttle(pg):
    """⚠️ Applied AFTER the chart is up, never before. Throttling the app's own boot
    measures the PWA, which is not what this tool is about. The clock starts at the tap."""
    cdp = await pg.context.new_cdp_session(pg)
    await cdp.send("Network.enable")
    await cdp.send("Network.emulateNetworkConditions", {
        "offline": False, "latency": 90,
        "downloadThroughput": KBPS * 1024 / 8, "uploadThroughput": 512 * 1024 / 8})
    return cdp


def meter(cdp):
    """Bytes that actually crossed the wire, and how many requests did.

    ⚠️ NOT Playwright's `response` event. It fires for cache hits as well, with the
    cached `content-length` attached, so a page that fetched nothing at all reports the
    same megabytes as one that fetched everything — which is precisely the claim this
    tool exists to check. CDP's `loadingFinished.encodedDataLength` is 0 for a hit."""
    seen = {"b": 0, "n": 0, "last": 0.0}

    def fin(e):
        seen["last"] = asyncio.get_event_loop().time()
        n = e.get("encodedDataLength") or 0
        if n:
            seen["b"] += n
            seen["n"] += 1

    cdp.on("Network.loadingFinished", fin)
    return seen


INK = """(()=>{
  const h=document.getElementById('eggtimer-frame');
  const hd=h&&h.contentDocument; if(!hd) return 0;
  const f=hd.getElementById('rig'); const d=f?f.contentDocument:hd;
  const c=d&&d.getElementById('stage'); if(!c) return 0;
  const g=c.getContext('2d'); let n=0;
  try{ const px=g.getImageData(0,0,c.width,c.height).data;
       for(let i=3;i<px.length;i+=4*401) if(px[i]>8) n++; }catch(e){}
  return n;
})()"""


async def open_timer(pg, loop, seen):
    """Tap Timer, return (seconds to egg ink, bytes over the wire, requests)."""
    seen["b"] = seen["n"] = 0
    await pg.click("#dock-timer")
    t0 = loop.time()
    egg = None
    for _ in range(600):
        await pg.wait_for_timeout(100)
        if await pg.evaluate(INK) > 20:
            egg = loop.time() - t0
            break
    # ⚠️ WAIT FOR QUIET, NOT FOR A FIXED DELAY. This was 4 seconds, which was fine when
    # the egg took 5.4s to draw — wave 2 was well under way by then. Now the egg is up in
    # 1.4s and a fixed window cuts the first open off mid-download, so the SECOND open
    # re-fetches the remainder and reads as a caching regression that is not one. Both
    # opens have to run to completion or their byte counts are not comparable.
    seen["last"] = loop.time()
    while loop.time() - seen["last"] < 5.0 and loop.time() - t0 < 150:
        await pg.wait_for_timeout(250)
    return egg, seen["b"], seen["n"], loop.time() - t0


async def to_chart(pg):
    await pg.goto(f"{BASE}/kid/")
    await pg.evaluate("localStorage.setItem('kid.deviceToken','eggtimer-dev-token-1')")
    await pg.reload()
    # Same shape as tools/eggtimer-flow.py: the child card may or may not be there
    # depending on what the paired device last picked; the dock is the real gate.
    await pg.wait_for_timeout(3500)
    card = await pg.query_selector("[data-id]")
    if card:
        await card.click()
        await pg.wait_for_timeout(3500)
    await pg.wait_for_selector("#dock-timer", state="attached", timeout=30000)


async def m():
    loop = asyncio.get_event_loop()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        pg = await ctx.new_page()

        await to_chart(pg)
        cdp = await throttle(pg)
        seen = meter(cdp)
        first = await open_timer(pg, loop, seen)

        # Back to the chart and in again — the same browser, the same session. This
        # is the open Andjroo does all day.
        await pg.click("#eggtimer-back")
        await pg.wait_for_selector("#dock-timer", state="attached", timeout=30000)
        await pg.wait_for_timeout(800)
        second = await open_timer(pg, loop, seen)
        await b.close()

    def row(label, r):
        t, by, n, tot = r
        print(f"  {KBPS} kbps · {label}  EGG at "
              f"{f'{t:.2f}s' if t else 'never drew'}   {by/1e6:.2f} MB over {n} requests"
              f"   (quiet after {tot:.0f}s)")

    row("1st open ", first)
    row("2nd open ", second)


asyncio.run(m())
