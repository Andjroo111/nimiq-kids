#!/usr/bin/env python3
"""The sounds sheet: uniform pills, and the coming-soon toast where it can be read."""
import asyncio, io, os, sys
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
OUT=os.environ.get("SCRATCH","/tmp")+"/"
ENG=sys.argv[1] if len(sys.argv)>1 else "chromium"
W=int(sys.argv[2]) if len(sys.argv)>2 else 390
async def m():
    errs=[]; shots=[]
    async with async_playwright() as p:
        b=await getattr(p,ENG).launch()
        pg=await b.new_page(viewport={"width":W,"height":844},device_scale_factor=3)
        pg.on("console",lambda x:errs.append(f"{x.type}: {x.text}") if x.type=="error" else None)
        pg.on("pageerror",lambda e:errs.append(f"pageerror: {e}"))
        await pg.goto("http://localhost:3985/timer.html?clean=1")
        await pg.wait_for_function("window.TIMER && document.getElementById('rig').contentWindow.RIG",timeout=30000)
        await pg.evaluate("localStorage.clear();localStorage.removeItem('kidtimer3.photos')")
        await pg.reload()
        await pg.wait_for_function("window.TIMER && document.getElementById('rig').contentWindow.RIG",timeout=30000)
        await pg.wait_for_timeout(1000)
        await pg.evaluate("TIMER.sheet('shMusic')"); await pg.wait_for_timeout(650)

        # every pill the same size, and the rows share their edges
        g=await pg.evaluate("""[...document.querySelectorAll('.lane')].map(l=>
            [...l.querySelectorAll('.opt')].map(o=>{const r=o.getBoundingClientRect();
              return [+r.width.toFixed(1),+r.height.toFixed(1),+r.left.toFixed(1)]})) """)
        for lane in g:
            ws={x[0] for x in lane}; hs={x[1] for x in lane}; ls={x[2] for x in lane}
            assert len(ws)==1, f"pill widths differ: {sorted(ws)}"
            assert len(hs)==1, f"pill heights differ: {sorted(hs)}"
            assert len(ls)==2, f"expected 2 columns, got lefts {sorted(ls)}"
        print(f"[{ENG}] {W}px pills: {g[0][0][0]}x{g[0][0][1]}, 2 columns, uniform in both lanes")
        shots.append((Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"),"sounds"))

        # tap a real sound -> toast, and it must clear the sheet it came from
        await pg.locator(".lane .opt[data-v='lullaby']").click()
        await pg.wait_for_timeout(420)
        t=await pg.evaluate("""(()=>{const t=document.getElementById('toast');
            const s=document.querySelector('.sheet.on');
            const tb=t.getBoundingClientRect(), sb=s.getBoundingClientRect();
            return {txt:t.textContent, on:t.classList.contains('on'),
                    op:+getComputedStyle(t).opacity, above:+(sb.top-tb.bottom).toFixed(1),
                    inside:tb.left>=0 && tb.right<=document.getElementById('app').clientWidth,
                    picked:JSON.parse(localStorage.kidtimer3).during}})()""")
        assert t["on"] and t["op"]>.9, f"toast not shown: {t}"
        assert t["txt"]=="Coming soon", f"toast says {t['txt']!r}"
        assert t["above"]>0, f"toast is not clear of the sheet ({t['above']}px)"
        assert t["inside"], "toast runs off the phone"
        assert t["picked"]=="lullaby", f"the choice was not saved: {t['picked']}"
        print(f"[{ENG}] toast: {t['txt']!r}, {t['above']}px above the sheet, choice saved")
        shots.append((Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"),"toast"))

        # turning one OFF does not apologise
        await pg.locator(".lane .opt[data-v='none']").first.click()
        await pg.wait_for_timeout(2400)
        gone=await pg.evaluate("document.getElementById('toast').classList.contains('on')")
        assert not gone, "the toast never cleared"
        print(f"[{ENG}] toast auto-clears; 'No music' raises none")

        ov=await pg.evaluate("document.getElementById('app').scrollWidth-document.getElementById('app').clientWidth")
        assert ov<=0, f"horizontal overflow of {ov}px at {W}px"
        print(f"[{ENG}] no horizontal overflow at {W}px")
        await b.close()
    print(f"[{ENG}] console:",errs if errs else "clean"); assert not errs
    sc=.5; ims=[(i.resize((int(i.width*sc),int(i.height*sc)),Image.LANCZOS),l) for i,l in shots]
    w,h=ims[0][0].size; pad=20
    out=Image.new("RGB",(len(ims)*w+pad*(len(ims)+1),h+pad*2+22),"#EEF0F4")
    d=ImageDraw.Draw(out)
    for i,(im,l) in enumerate(ims):
        x=pad+i*(w+pad); out.paste(im,(x,pad)); d.text((x+2,pad+h+6),l,fill="#1F2348")
    out.save(OUT+f"sounds-{ENG}-{W}.png"); print("wrote",OUT+f"sounds-{ENG}-{W}.png")
asyncio.run(m())
