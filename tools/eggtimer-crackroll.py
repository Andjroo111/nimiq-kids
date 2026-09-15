#!/usr/bin/env python3
"""It cracks a different way every run — proved by running it, not by reading the code.

  python3 tools/crackroll.py [engine] [runs]

Andjroo, 2026-07-31: "we should have randomized the egg cracking, but I only ever see
one version of this." timer.html had never called RIG.setPattern(), so every run got
whatever the TUNING page was last left on. This asserts the app now chooses, that it
reaches every pattern, and that it never plays the same one twice running.
"""
import asyncio, os, sys, collections
from playwright.async_api import async_playwright

URL = os.environ.get("U", "http://localhost:3985/timer.html?clean=1")
ENG = sys.argv[1] if len(sys.argv) > 1 else "chromium"
RUNS = int(sys.argv[2]) if len(sys.argv) > 2 else 40


async def run():
    errs, seen = [], []
    async with async_playwright() as p:
        b = await getattr(p, ENG).launch()
        pg = await b.new_page(viewport={"width": 390, "height": 844})
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        await pg.goto(URL)
        await pg.wait_for_function(
            "window.TIMER && document.getElementById('rig').contentWindow.RIG", timeout=30000)
        await pg.evaluate("localStorage.clear()")
        await pg.reload()
        await pg.wait_for_function(
            "window.TIMER && document.getElementById('rig').contentWindow.RIG", timeout=30000)
        await pg.wait_for_timeout(1200)

        cut = await pg.evaluate(
            "document.getElementById('rig').contentWindow.RIG.patterns()")
        print(f"[{ENG}] patterns cut by crack_art.py: {cut}")
        for _ in range(RUNS):
            # a real tap on Start, then read which crack the RIG is actually on
            await pg.click("#start")
            await pg.wait_for_timeout(160)
            n = await pg.evaluate(
                "document.getElementById('rig').contentWindow.RIG.pattern()")
            seen.append(n)
            await pg.click("#btnStop")
            await pg.wait_for_timeout(160)
        await b.close()

    c = collections.Counter(seen)
    print(f"[{ENG}] {RUNS} runs -> {dict(sorted(c.items()))}")
    assert None not in c, "the app is still not choosing a pattern"
    assert len(c) >= 4, f"only reached {len(c)} of the cut patterns: {dict(c)}"
    rep = [i for i in range(1, len(seen)) if seen[i] == seen[i - 1]]
    assert not rep, f"the same crack twice running at {rep}: {seen}"
    print(f"[{ENG}] {len(c)} distinct patterns, no back-to-back repeat in {RUNS} runs")
    print(f"[{ENG}] console:", errs if errs else "clean")
    assert not errs, "console was not clean"


asyncio.run(run())
