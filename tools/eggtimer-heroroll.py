#!/usr/bin/env python3
"""Many characters ticked, a different one out of the egg each run.

  python3 tools/heroroll.py [engine] [runs]

Andjroo, 2026-07-31: "I want the kid to be able to select multiple characters, so that
way it's randomized as well." Asserts the grid is genuinely multi-select, that the set
can never be emptied, that Start rolls within the ticked set and never outside it, and
that one ticked character still hatches every time.
"""
import asyncio, collections, os, sys
from playwright.async_api import async_playwright

URL = os.environ.get("U", "http://localhost:3985/timer.html?clean=1")
ENG = sys.argv[1] if len(sys.argv) > 1 else "chromium"
RUNS = int(sys.argv[2]) if len(sys.argv) > 2 else 36


async def tick(pg, idxs):
    """Leave exactly these tile indices ticked."""
    await pg.evaluate("TIMER.sheet('shEgg')")
    await pg.wait_for_timeout(500)
    tiles = pg.locator("#eggGrid .pick[data-hero]")
    n = await tiles.count()
    for i in range(n):
        want = i in idxs
        on = await tiles.nth(i).evaluate("e=>e.classList.contains('on')")
        if on != want:
            await tiles.nth(i).scroll_into_view_if_needed()
            await tiles.nth(i).click()
            await pg.wait_for_timeout(45)
    await pg.evaluate("TIMER.sheet(null)")
    await pg.wait_for_timeout(320)
    return await pg.evaluate("JSON.parse(localStorage.kidtimer3).heroes")


async def run():
    errs = []
    async with async_playwright() as p:
        b = await getattr(p, ENG).launch()
        pg = await b.new_page(viewport={"width": 390, "height": 844})
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        await pg.goto(URL)
        await pg.wait_for_function(
            "window.TIMER && document.getElementById('rig').contentWindow.RIG", timeout=30000)
        await pg.evaluate("localStorage.clear();localStorage.removeItem('kidtimer3.photos')")
        await pg.reload()
        await pg.wait_for_function(
            "window.TIMER && document.getElementById('rig').contentWindow.RIG", timeout=30000)
        await pg.wait_for_timeout(1200)

        # 1. the set cannot be emptied — untick the only ticked one
        start = await pg.evaluate("JSON.parse(localStorage.kidtimer3).heroes")
        assert len(start) == 1, f"a fresh device should start with one: {start}"
        await pg.evaluate("TIMER.sheet('shEgg')")
        await pg.wait_for_timeout(500)
        await pg.locator("#eggGrid .pick[data-hero]").first.click()
        await pg.wait_for_timeout(250)
        still = await pg.evaluate("JSON.parse(localStorage.kidtimer3).heroes")
        assert still == start, f"the last character was untickable: {still}"
        await pg.evaluate("TIMER.sheet(null)")
        await pg.wait_for_timeout(300)
        print(f"[{ENG}] the set cannot be emptied: {still}")

        # 2. multi-select, and the roll stays inside it
        want = [0, 3, 7, 12]
        sel = await tick(pg, set(want))
        assert len(sel) == len(want), f"multi-select did not stick: {sel}"
        print(f"[{ENG}] ticked {len(sel)}: {sel}")

        seen = []
        for _ in range(RUNS):
            await pg.click("#start")
            await pg.wait_for_timeout(140)
            seen.append(await pg.evaluate(
                "document.getElementById('rig').contentWindow.RIG.hero()"))
            await pg.click("#btnStop")
            await pg.wait_for_timeout(140)
        c = collections.Counter(seen)
        out = [h for h in c if h not in sel]
        assert not out, f"hatched something that was never ticked: {out}"
        assert len(c) == len(sel), f"only {len(c)} of {len(sel)} ever came out: {dict(c)}"
        rep = [i for i in range(1, len(seen)) if seen[i] == seen[i - 1]]
        assert not rep, f"the same character twice running at {rep}"
        print(f"[{ENG}] {RUNS} runs -> {dict(c)}; all inside the set, no repeat")

        # 3. one ticked still hatches, every time
        sel1 = await tick(pg, {5})
        one = []
        for _ in range(6):
            await pg.click("#start")
            await pg.wait_for_timeout(140)
            one.append(await pg.evaluate(
                "document.getElementById('rig').contentWindow.RIG.hero()"))
            await pg.click("#btnStop")
            await pg.wait_for_timeout(140)
        assert set(one) == set(sel1), f"one ticked gave {set(one)}, expected {sel1}"
        print(f"[{ENG}] one ticked -> {sel1[0]} every run")
        await b.close()

    print(f"[{ENG}] console:", errs if errs else "clean")
    assert not errs, "console was not clean"


asyncio.run(run())
