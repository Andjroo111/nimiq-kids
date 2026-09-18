#!/usr/bin/env python3
"""Prove the sheet fixes by RENDERED CONTENT, in whichever engine is asked for.

  python3 sheetproof.py chromium|webkit [width]

Asserts, per sheet:
  - the close button exists, is ONE consistent control, and is a real tap target
  - the selected marker is PAINTED OUTSIDE the tile it belongs to (the old bug was
    that overflow:hidden dragged it inside), and is on the tile that was tapped
  - the header, sub-line and section labels are all centred
  - no horizontal overflow at this width, console clean
"""
import asyncio, io, os, sys
from playwright.async_api import async_playwright
from PIL import Image

URL = os.environ.get("U", "http://localhost:3985/timer.html?clean=1")
OUT = os.environ.get("SCRATCH", "/tmp") + "/"
ENG = sys.argv[1] if len(sys.argv) > 1 else "chromium"
W = int(sys.argv[2]) if len(sys.argv) > 2 else 390
H = 844
SHEETS = [("shReminder", "add a reminder"), ("shEgg", "hatch surprises"),
          ("shMusic", "sounds"), ("shBg", "background")]


async def run():
    errs, shots, labs = [], [], []
    async with async_playwright() as p:
        b = await getattr(p, ENG).launch()
        pg = await b.new_page(viewport={"width": W, "height": H}, device_scale_factor=3)
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        await pg.goto(URL)
        await pg.wait_for_function(
            "window.TIMER && document.getElementById('rig').contentWindow.RIG", timeout=30000)
        await pg.evaluate("localStorage.clear();localStorage.removeItem('kidtimer3.photos')")
        await pg.reload()
        await pg.wait_for_function(
            "window.TIMER && document.getElementById('rig').contentWindow.RIG", timeout=30000)
        await pg.wait_for_timeout(1000)

        # geom must now describe the DRAWN curve, not the raster
        g = await pg.evaluate("document.getElementById('rig').contentWindow.RIG.geom()")
        print(f"[{ENG}] geom.egg = {g['egg']}")
        assert abs(g["egg"]["w"] - 353.2) < 1.5 and abs(g["egg"]["h"] - 417.4) < 1.5, \
            f"geom still reports the raster box: {g['egg']}"

        # one close button per sheet, all identical, all a real tap target
        cls = await pg.evaluate("""[...document.querySelectorAll('.sheet')].map(s=>{
            const b=s.querySelectorAll('.sclose');
            const r=b.length===1?b[0].getBoundingClientRect():null;
            return {id:s.id, n:b.length, w:r&&+r.width.toFixed(1), h:r&&+r.height.toFixed(1),
                    svg:b.length===1?b[0].querySelector('svg').getAttribute('width'):null,
                    glyph:/[✕✖x]/i.test(s.querySelector('.shead').textContent)};
        })""")
        for c in cls:
            assert c["n"] == 1, f"{c['id']} has {c['n']} close buttons"
            assert c["w"] >= 44 and c["h"] >= 44, f"{c['id']} close target {c['w']}x{c['h']} < 44"
            assert not c["glyph"], f"{c['id']} still has a text glyph in its header"
        assert len({(c["w"], c["h"], c["svg"]) for c in cls}) == 1, f"close buttons differ: {cls}"
        print(f"[{ENG}] close: 4/4 identical, {cls[0]['w']}x{cls[0]['h']} target, "
              f"{cls[0]['svg']}px icon")

        # centring, per sheet
        for sid, _ in SHEETS:
            al = await pg.evaluate(f"""(()=>{{const s=document.getElementById('{sid}');
                const t=[s.querySelector('.shead h2'), s.querySelector('.ssub'),
                         ...s.querySelectorAll('.lane h3')].filter(Boolean);
                return t.map(e=>getComputedStyle(e).textAlign)}})()""")
            assert all(a == "center" for a in al), f"{sid} not centred: {al}"
        print(f"[{ENG}] centring: header + sub + section labels centred on all four")

        # the marker: tapped item, and PAINTED PROUD of its tile
        for sid, sel, want in [("shReminder", "#remGrid", 6), ("shEgg", "#eggGrid", 9)]:
            await pg.evaluate(f"TIMER.sheet('{sid}')")
            await pg.wait_for_timeout(650)
            tiles = pg.locator(f"{sel} .pick[data-hero], {sel} .pick[data-rem]")
            # ⚠️ THE INDEX IS LIFTED FROM THE GRID, NOT PINNED. The reminder list is
            # Andjroo's to edit and it went from twelve tiles to five on 2026-09-17; a
            # hard 6 made this assert about a tile that no longer exists, which reads as
            # a broken sheet rather than as a shorter list. Any tile but the first proves
            # the same thing, so take the last one when the grid is small.
            n = await tiles.count()
            assert n >= 2, f"{sid}: {n} tiles, nothing to tap"
            tap = min(want, n - 1)
            await tiles.nth(tap).scroll_into_view_if_needed()
            await pg.wait_for_timeout(200)
            await tiles.nth(tap).click()
            await pg.wait_for_timeout(350)
            # ⚠️ The character grid is MULTI-SELECT (Andjroo, 2026-07-31 — the kid picks
            # several and the egg rolls between them), so "the first ticked cell" is no
            # longer the one that was tapped. The contract is that the tapped one is IN
            # the ticked set, and that its marker is painted PROUD of its own tile.
            r = await pg.evaluate(f"""(()=>{{
                const g=document.querySelector('{sel}');
                const cells=[...g.querySelectorAll('.cell')];
                const on=cells.map((c,i)=>c.classList.contains('on')?i:-1).filter(i=>i>=0);
                const c=cells[{tap}]; if(!c) return {{on}};
                const t=c.querySelector('.tick'), pk=c.querySelector('.pick');
                const tb=t.getBoundingClientRect(), pb=pk.getBoundingClientRect();
                return {{on, n:cells.length,
                    // how far the marker sticks out past the tile's own box
                    outTop:+(pb.top-tb.top).toFixed(1), outRight:+(tb.right-pb.right).toFixed(1),
                    vis:getComputedStyle(t).display, size:+tb.width.toFixed(1)}};
            }})()""")
            assert tap in r["on"], f"{sid}: tapped {tap}, ticked {r['on']}"
            assert r["vis"] != "none", f"{sid}: marker not painted"
            assert r["outTop"] > 0 and r["outRight"] > 0, \
                f"{sid}: marker still inside the tile ({r['outTop']}, {r['outRight']})"
            print(f"[{ENG}] {sid}: tapped {tap} -> ticked {r['on']}, "
                  f"{r['size']}px, proud by {r['outTop']}/{r['outRight']}px")
            await pg.evaluate("TIMER.sheet(null)")
            await pg.wait_for_timeout(350)

        # sounds: the opt-out is FIRST in both lanes (Andjroo, 2026-07-31 — "the no
        # music part should be the first thing on the sounds page")
        lanes = await pg.evaluate("""[...document.querySelectorAll('.lane')].map(l=>
            [...l.querySelectorAll('.opt')].map(o=>o.dataset.v))""")
        for l in lanes:
            assert l[0] == "none", f"opt-out is not first: {l}"
        print(f"[{ENG}] sounds: opt-out first in both lanes {lanes}")

        # the gear is gone
        assert not await pg.evaluate("!!document.getElementById('gear')"), "gear still there"
        print(f"[{ENG}] gear: gone")

        # backgrounds: real ones + empty slots, and the sheet rises further
        bgh = await pg.evaluate("""(()=>{document.getElementById('shBg').classList.add('on');
            const s=document.getElementById('shBg');
            return {h:+s.getBoundingClientRect().height.toFixed(0),
                    real:s.querySelectorAll('.bgpick').length,
                    slots:s.querySelectorAll('.bgslot').length}})()""")
        assert bgh["slots"] > 0 and bgh["h"] >= H * 0.44, f"bg sheet {bgh}"
        print(f"[{ENG}] background: {bgh['real']} live + {bgh['slots']} empty, "
              f"sheet {bgh['h']}px of {H} ({bgh['h']*100//H}%)")
        await pg.evaluate("TIMER.sheet(null)")
        await pg.wait_for_timeout(350)

        # the shots
        for sid, lab in SHEETS:
            await pg.evaluate(f"TIMER.sheet('{sid}')")
            await pg.wait_for_timeout(620)
            shots.append(Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"))
            labs.append(lab)
            await pg.evaluate("TIMER.sheet(null)")
            await pg.wait_for_timeout(380)

        ov = await pg.evaluate(
            "document.getElementById('app').scrollWidth-document.getElementById('app').clientWidth")
        assert ov <= 0, f"horizontal overflow of {ov}px at {W}px"
        print(f"[{ENG}] no horizontal overflow at {W}px")
        await b.close()

    print(f"[{ENG}] console:", errs if errs else "clean")
    assert not errs, "console was not clean"

    sc = 0.5
    ims = [i.resize((int(i.width * sc), int(i.height * sc)), Image.LANCZOS) for i in shots]
    w, h = ims[0].size
    pad = 20
    out = Image.new("RGB", (4 * w + pad * 5, h + pad * 2), "#EEF0F4")
    for i, im in enumerate(ims):
        out.paste(im, (pad + i * (w + pad), pad))
    f = OUT + f"sheets-{ENG}-{W}.png"
    out.save(f)
    print("wrote", f)


asyncio.run(run())
