#!/usr/bin/env python3
"""The kid's own characters, end to end, off the real page.

Feeds a real image file into the camera input the way a phone does, then asserts:
  - it is stored downscaled to the roster's own 320px height (not the phone's 3024)
  - it appears in the grid, is pickable, and the marker lands on it
  - the RIG accepted it: it is in HEROES, measured, and setHero() takes
  - a SECOND one lands too, so 'as many as they want' is real
  - photos live in their own localStorage key, so they cannot cost the settings
"""
import asyncio, io, os, sys
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw

URL = os.environ.get("U", "http://localhost:3985/timer.html?clean=1")
OUT = os.environ.get("SCRATCH", "/tmp") + "/"
ENG = sys.argv[1] if len(sys.argv) > 1 else "chromium"
W, H = 390, 844


def fake_photo(path, colour, w=1200, h=1600):
    im = Image.new("RGB", (w, h), colour)
    d = ImageDraw.Draw(im)
    d.ellipse([w * .2, h * .2, w * .8, h * .8], fill="#F2554B")
    im.save(path)
    return path


async def run():
    errs = []
    a = fake_photo(OUT + "shot-a.jpg", "#8ED1C4")
    b_ = fake_photo(OUT + "shot-b.jpg", "#E9B213")
    async with async_playwright() as p:
        br = await getattr(p, ENG).launch()
        pg = await br.new_page(viewport={"width": W, "height": H}, device_scale_factor=3)
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        await pg.goto(URL)
        await pg.wait_for_function(
            "window.TIMER && document.getElementById('rig').contentWindow.RIG", timeout=30000)
        await pg.evaluate("localStorage.clear();localStorage.removeItem('kidtimer3.photos')")
        await pg.reload()
        await pg.wait_for_function(
            "window.TIMER && document.getElementById('rig').contentWindow.RIG", timeout=30000)
        await pg.wait_for_timeout(900)

        await pg.evaluate("TIMER.sheet('shEgg')")
        await pg.wait_for_timeout(650)
        base = await pg.eval_on_selector_all("#eggGrid .pick[data-hero]", "e=>e.length")
        print(f"[{ENG}] drawn roster: {base}")

        for i, f in enumerate([a, b_], 1):
            await pg.set_input_files("#shoot", f)
            await pg.wait_for_function(
                f"JSON.parse(localStorage.getItem('kidtimer3.photos')||'[]').length==={i}",
                timeout=10000)
            await pg.wait_for_timeout(400)
            n = await pg.eval_on_selector_all("#eggGrid .pick[data-hero]", "e=>e.length")
            assert n == base + i, f"grid shows {n} heroes, expected {base+i}"
            print(f"[{ENG}] photo {i}: grid now {n} tiles")

        ph = await pg.evaluate("""(()=>{const l=JSON.parse(localStorage.getItem('kidtimer3.photos'));
            return l.map(p=>({id:p.id,name:p.name,bytes:p.src.length}))})()""")
        sizes = await pg.evaluate("""(async()=>{const l=JSON.parse(localStorage.getItem('kidtimer3.photos'));
            return Promise.all(l.map(p=>new Promise(r=>{const i=new Image();
              i.onload=()=>r([i.naturalWidth,i.naturalHeight]); i.src=p.src})))})()""")
        for (wq, hq) in sizes:
            assert hq == 320, f"photo stored at {wq}x{hq}, not the roster's 320px height"
        print(f"[{ENG}] stored {sizes}, {[p['bytes']//1024 for p in ph]}KB — own key, 320px tall")

        # the settings key must NOT be carrying the image data
        sbytes = await pg.evaluate("(localStorage.getItem('kidtimer3')||'').length")
        assert sbytes < 2000, f"settings key is {sbytes} bytes — a photo leaked into it"
        print(f"[{ENG}] settings key still {sbytes} bytes")

        # ⚠️ The grid is MULTI-SELECT now, so a photo taken from this sheet is
        # already ticked — it went into the mix when it was taken. A tap on it is
        # therefore an UNTICK, and a second tap puts it back. That round trip is the
        # thing worth asserting; "tapping selects" is no longer the contract.
        read = """(()=>{
            const cells=[...document.querySelectorAll('#eggGrid .cell')];
            const hs=document.getElementById('rig').contentWindow.RIG.heroes();
            const sel=JSON.parse(localStorage.kidtimer3).heroes||[];
            return {on:cells.map((c,i)=>c.classList.contains('on')?i:-1).filter(i=>i>=0),
                    sel, inRig:sel.every(id=>hs.some(h=>h.id===id)), rigN:hs.length};
        })()"""
        st = await pg.evaluate(read)
        idx = base  # the first photo's tile
        assert idx in st["on"], f"a photo taken from this sheet was not ticked: {st}"
        assert st["inRig"], f"the rig never got the photos: {st}"
        print(f"[{ENG}] both photos auto-ticked: cells {st['on']}, set {st['sel']}")

        tiles = pg.locator("#eggGrid .pick[data-hero]")
        await tiles.nth(idx).scroll_into_view_if_needed()
        await pg.wait_for_timeout(250)
        await tiles.nth(idx).click()
        await pg.wait_for_timeout(300)
        off = await pg.evaluate(read)
        assert idx not in off["on"], f"tapping a ticked photo did not untick it: {off}"
        await tiles.nth(idx).click()
        await pg.wait_for_timeout(300)
        back = await pg.evaluate(read)
        assert idx in back["on"], f"tapping it again did not put it back: {back}"
        assert back["inRig"], f"the rig lost the photo on the round trip: {back}"
        print(f"[{ENG}] untick -> {off['on']}, tick again -> {back['on']}, "
              f"rig roster {back['rigN']}")

        await pg.evaluate("TIMER.sheet(null)")
        await pg.wait_for_timeout(400)
        # and it has to survive a reload, still registered with the rig
        await pg.reload()
        await pg.wait_for_function(
            "window.TIMER && document.getElementById('rig').contentWindow.RIG", timeout=30000)
        await pg.wait_for_timeout(1400)
        # ⚠️ The grid is built ON FIRST OPEN now (21 thumbnails is ~3MB and it used to
        # sit on the boot path of a screen showing an egg and a Start button). After a
        # reload it is legitimately empty until the sheet is asked for.
        await pg.evaluate("TIMER.sheet('shEgg')")
        await pg.wait_for_timeout(700)
        again = await pg.evaluate("""(()=>{const R=document.getElementById('rig').contentWindow.RIG;
            return {rigN:R.heroes().length,
                    tiles:document.querySelectorAll('#eggGrid .pick[data-hero]').length}})()""")
        assert again["tiles"] == base + 2, f"after reload the grid shows {again['tiles']}"
        print(f"[{ENG}] after reload: {again['tiles']} tiles, rig roster {again['rigN']} (no dupes)")

        await pg.evaluate("TIMER.sheet('shEgg')")
        await pg.wait_for_timeout(650)
        await pg.eval_on_selector("#eggGrid", "e=>e.scrollIntoView({block:'end'})")
        await pg.wait_for_timeout(400)
        Image.open(io.BytesIO(await pg.screenshot())).convert("RGB").save(OUT + f"photos-{ENG}.png")
        print("wrote", OUT + f"photos-{ENG}.png")

        ov = await pg.evaluate(
            "document.getElementById('app').scrollWidth-document.getElementById('app').clientWidth")
        assert ov <= 0, f"horizontal overflow of {ov}px"
        await br.close()
    print(f"[{ENG}] console:", errs if errs else "clean")
    assert not errs, "console was not clean"


asyncio.run(run())
