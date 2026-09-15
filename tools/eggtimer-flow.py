#!/usr/bin/env python3
"""The Timer button in the REAL kid app, driven end to end.

Asserts by rendered content, never by a status code: the dock opens the built
timer (not the three glyphs), the rig inside it is alive, Start actually starts
it, and the back chevron returns to the chart.
"""
import asyncio, io, os, sys
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw

BASE = os.environ.get("U", "http://localhost:3986")
OUT = os.environ.get("SCRATCH", "/tmp") + "/"
W = int(sys.argv[1]) if len(sys.argv) > 1 else 390


async def m():
    errs, shots = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": W, "height": 844}, device_scale_factor=3)
        pg.on("console", lambda x: errs.append(f"{x.type}: {x.text}") if x.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        pg.on("requestfailed", lambda r: errs.append(f"failed: {r.url}"))
        await pg.goto(f"{BASE}/kid/")
        await pg.evaluate("localStorage.setItem('kid.deviceToken','eggtimer-dev-token-1')")
        await pg.reload()
        await pg.wait_for_timeout(3500)
        card = await pg.query_selector("[data-id]")
        if card:
            await card.click()
            await pg.wait_for_timeout(3500)
        assert await pg.evaluate("!!document.getElementById('dock-timer')"), "no dock"

        await pg.click("#dock-timer")
        await pg.wait_for_timeout(1200)
        # the three-glyph sheet must be GONE
        assert not await pg.query_selector("[data-tm]"), "still the three-glyph menu"
        fr = pg.frame_locator("#eggtimer-frame")
        await fr.locator("#start").wait_for(timeout=20000)
        await pg.wait_for_timeout(1800)
        # ⚠️ Matched by PATH, not by the whole URL. The src carries a version token now
        # (js/eggtimer.js), so an exact-URL match silently fell through to frames[1].
        f = next((x for x in pg.frames if "/kid/timer/index.html" in x.url), pg.frames[1])
        build = await f.evaluate("window.TIMER && TIMER.build")
        rig = await f.evaluate(
            "(()=>{const w=document.getElementById('rig').contentWindow;"
            "return w.RIG?{build:w.RIG.build,heroes:w.RIG.heroes().length,"
            "patterns:w.RIG.patterns(),hero:w.RIG.hero()}:null})()")
        print(f"[{W}px] timer build {build} · rig {rig}")
        assert rig and rig["heroes"] == 21 and len(rig["patterns"]) == 5, f"rig not alive: {rig}"
        shots.append((Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"), "Timer in the app"))

        # a real tap on Start, inside the frame
        await fr.locator("#start").click()
        await pg.wait_for_timeout(2000)
        st = await f.evaluate("document.getElementById('rig').contentWindow.RIG.state()")
        assert st["running"], f"Start did not start the rig: {st}"
        clock = await fr.locator("#clock").inner_text()
        assert clock != "00:00", f"clock reads {clock}"
        print(f"[{W}px] Start ran it: clock {clock}, rig running")
        shots.append((Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"), "running"))

        # the hatch
        await f.evaluate("document.getElementById('rig').contentWindow.RIG.hatchNow()")
        await pg.wait_for_timeout(2800)
        assert await fr.locator("#done").is_visible(), "no Done after the hatch"
        shots.append((Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"), "hatched"))
        print(f"[{W}px] hatched, Done shown")

        # back to the chart
        await pg.click("#eggtimer-back")
        await pg.wait_for_timeout(1500)
        assert await pg.evaluate("!!document.getElementById('dock-timer')"), "back did not reach the chart"
        print(f"[{W}px] back returns to the chart")

        ov = await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert ov <= 0, f"horizontal overflow of {ov}px"
        await b.close()

    # ⚠️ Pre-existing app noise, intermittent and NOT this change: /api/rates (fiat
    # rates, absent in SIM), the Mulish woff2, and bridge.js (the Android kiosk
    # wrapper's, only present on a tablet). They appear on the chart screen with the
    # timer never opened. Anything under /kid/timer/ is OURS and always fails the run.
    PRE = ("favicon", "/api/rates", "/fonts/", "/kid/js/bridge.js")
    mine = [e for e in errs if not any(x in e for x in PRE)]
    for e in errs:
        print(("  ERR: " if e in mine else "  (pre-existing) "), e)
    errs = mine
    print(f"[{W}px] console:", "clean" if not errs else f"{len(errs)} problem(s)")
    assert not errs, "console was not clean"
    sc = .5
    ims = [(i.resize((int(i.width * sc), int(i.height * sc)), Image.LANCZOS), l) for i, l in shots]
    w, h = ims[0][0].size
    pad = 18
    out = Image.new("RGB", (len(ims) * w + pad * (len(ims) + 1), h + pad * 2 + 22), "#EEF0F4")
    d = ImageDraw.Draw(out)
    for i, (im, l) in enumerate(ims):
        x = pad + i * (w + pad)
        out.paste(im, (x, pad))
        d.rectangle([x, pad, x + w - 1, pad + h - 1], outline="#C9CEDA")
        d.text((x + 2, pad + h + 6), l, fill="#1F2348")
    out.save(OUT + f"appflow-{W}.png")
    print("wrote", OUT + f"appflow-{W}.png")


asyncio.run(m())
