#!/usr/bin/env python3
"""A JOB's timer in the REAL kid app, driven end to end — for both kinds of job.

  python3 tools/eggtimer-jobflow.py [width]

`tools/eggtimer-flow.py` drives the DOCK's timer. This drives the other way in: a job
card -> "Is it done?" -> "use timer". That path used to be a different, older egg
(`kid/js/egg.js`, a placeholder SVG predating the rig) and, for a CHORE, used to throw
before rendering anything at all — `chart.js` handed `flow.js` a routineId and a
taskRunId that a chore card does not carry.

So there are two legs and they fail differently against the old build. The chore leg
never reaches a timer; the task leg reaches one made of `.egg-rig` SVG.

Asserts by rendered content: the frame is the real rig (21 characters, 5 crack
patterns), the job's own name and length are on it, everything a job has no business
offering is gone, Start runs it, "I'm done!" hatches it, and Done lands the job.
"""
import asyncio, io, os, sys
from playwright.async_api import async_playwright
from PIL import Image

BASE = os.environ.get("U", "http://localhost:3986")
OUT = os.environ.get("SCRATCH", "/tmp") + "/"
W = int(sys.argv[1]) if len(sys.argv) > 1 else 390

# (card title, the length the server holds for it, what finishing it should leave behind)
TASK = ("Make your bed", "3:00")
CHORE = ("Put your laundry away", "2:00")


async def tap_card(pg, title):
    """Tap the job card called `title`, opening its group first if it is shut.

    ⚠️ The slot groups are an ACCORDION — opening one shuts the last. So this opens
    the one group it needs, immediately before tapping into it; a sweep that opens
    them all ends with only the last one open and the card you wanted hidden again.
    A collapsed group's cards are in the DOM and unclickable, which reads as a
    missing card rather than as a closed drawer."""
    key = await pg.evaluate(
        """(t)=>{const b=[...document.querySelectorAll('.ch-group button.ch-task')]
             .find(e=>e.innerText.includes(t));
           if(!b)return null;
           const g=b.closest('.ch-group');
           return g.classList.contains('is-open')?'':g.querySelector('[data-group]').dataset.group}""",
        title)
    assert key is not None, f"no card called {title!r} on the chart"
    if key:
        await pg.click(f'[data-group="{key}"]')
        await pg.wait_for_timeout(500)
    await pg.locator("button.ch-task", has_text=title).first.click()


async def resume_leg(pg, shots):
    """A routine task is RESUMABLE, and that is the whole reason the two clocks had to
    be reconciled rather than one of them dropped. Start it, walk away, come back: the
    server holds `started_at`, so the timer must open straight into the run at what is
    really left — no set screen, no second Start, and no restarting the task.

    ⚠️ Uses the LAST task in the routine so the two legs below still find their own
    cards untouched."""
    title = "Brush your teeth"
    await tap_card(pg, title)
    await pg.wait_for_timeout(900)
    await pg.click("#dn-timer")
    fr = pg.frame_locator("#eggtimer-frame")
    await fr.locator("#start").wait_for(timeout=25000)
    await pg.wait_for_timeout(1800)
    await fr.locator("#start").click()
    await pg.wait_for_timeout(4000)
    f = next(x for x in pg.frames if "/kid/timer/index.html" in x.url)
    away = (await f.evaluate("document.getElementById('rig').contentWindow.RIG.state()"))["left"]

    await pg.click("#eggtimer-back")
    await pg.wait_for_timeout(2000)
    assert await pg.evaluate("!!document.getElementById('dock-timer')"), "back did not reach the chart"
    await pg.wait_for_timeout(3000)  # time passes while the kid is elsewhere

    await tap_card(pg, title)
    await pg.wait_for_timeout(900)
    await pg.click("#dn-timer")
    fr = pg.frame_locator("#eggtimer-frame")
    await fr.locator("#clock").wait_for(timeout=25000)
    await pg.wait_for_timeout(2500)
    f = next(x for x in pg.frames if "/kid/timer/index.html" in x.url)
    back = (await f.evaluate("document.getElementById('rig').contentWindow.RIG.state()"))["left"]

    scr = await f.evaluate("document.body.className")
    assert scr == "run", f"[resume] reopened on the {scr!r} screen, not straight into the run"
    assert await f.evaluate("document.getElementById('scSet').classList.contains('on')") is False, \
        "[resume] the set screen is showing — it would ask the kid to Start a running task"
    # it kept counting while the kid was away: the server's clock, not the rig's
    assert away - back > 3.5, f"[resume] the clock did not keep running: {away:.1f} -> {back:.1f}"
    print(f"[{W}px] resume: left at {away:.1f}s, reopened at {back:.1f}s, straight into the run")
    shots.append((Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"), "resumed"))
    await pg.click("#eggtimer-back")
    await pg.wait_for_timeout(1800)


async def leg(pg, title, want_clock, errs, seen, shots):
    """One job, card to landed."""
    fresh = [e for e in errs]
    await tap_card(pg, title)
    await pg.wait_for_timeout(900)

    tm = await pg.query_selector("#dn-timer")
    assert tm, f"[{title}] the done sheet offered no timer — durationS missing?"
    await tm.click()
    await pg.wait_for_timeout(1200)

    frame_el = await pg.query_selector("#eggtimer-frame")
    assert frame_el, f"[{title}] no timer frame — this is where a chore used to throw"
    src = await frame_el.get_attribute("src")
    assert "job=1" in src, f"[{title}] frame is not in job mode: {src}"

    fr = pg.frame_locator("#eggtimer-frame")
    await fr.locator("#start").wait_for(timeout=25000)
    await pg.wait_for_timeout(2200)
    f = next((x for x in pg.frames if "/kid/timer/index.html" in x.url), None)
    assert f, f"[{title}] the job frame is not the built timer"

    rig = await f.evaluate(
        "(()=>{const w=document.getElementById('rig').contentWindow;"
        "return w.RIG?{heroes:w.RIG.heroes().length,patterns:w.RIG.patterns().length,"
        "setLeft:typeof w.RIG.setLeft}:null})()")
    assert rig, f"[{title}] no rig in the job frame"
    assert rig["heroes"] == 21 and rig["patterns"] == 5, f"[{title}] not the real rig: {rig}"
    assert rig["setLeft"] == "function", f"[{title}] rig has no setLeft — sync cannot work"

    # the job is named on the screen, and its own length is stated
    head = await fr.locator("#jobName").inner_text()
    assert title in head, f"[{title}] the job is not named on the timer: {head!r}"
    clock = await fr.locator("#jobTime").inner_text()
    assert clock == want_clock, f"[{title}] job length reads {clock!r}, want {want_clock!r}"
    # ⚠️ The job is said IN THE WHITE CARD under the plate, not written across the shell
    # (Andjroo, 2026-08-01) and, since 2026-09-15, not hung above the egg either: the
    # plate frames the egg from the first frame, so the job's row takes the picker's
    # place in #setCard. Assert the row is inside the card and below the plate.
    import json as _j
    gap = _j.loads(await f.evaluate("""(()=>{
      const c=document.getElementById('jobCard').getBoundingClientRect();
      const s=document.getElementById('setCard').getBoundingClientRect();
      const p=document.getElementById('plate').getBoundingClientRect();
      return JSON.stringify({inCard:c.top>=s.top&&c.bottom<=s.bottom, gap:s.top-p.bottom, cardTop:s.top, plateBottom:p.bottom})})()"""))
    assert gap["inCard"], f"[{title}] the job row is not inside the set card: {gap}"
    assert gap["gap"] >= 8, \
        f"[{title}] the card is ON the plate: card top {gap['cardTop']:.0f} vs plate bottom {gap['plateBottom']:.0f}"
    # the REAL icon asset, not the emoji glyph
    ic = await f.evaluate(
        "(()=>{const i=document.getElementById('jobIcon');"
        "return JSON.stringify({hidden:i.hidden,src:i.getAttribute('src')||'',w:i.naturalWidth})})()")
    icd = _j.loads(ic)
    assert not icd["hidden"] and icd["src"], f"[{title}] no icon asset on the card: {icd}"
    assert icd["w"] > 0, f"[{title}] the icon did not load: {icd}"
    print(f"[{W}px] {title}: job row in the card, icon {icd['src'].split('/')[-1]}")

    # everything a job has no business offering
    gone = await f.evaluate(
        "JSON.stringify(['cols','plus','stepUp','stepDn','runCtl']"
        ".filter(id=>!document.getElementById(id).hidden))")
    assert gone == "[]", f"[{title}] still offering: {gone}"
    shots.append((Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"), f"{title} — set"))

    await fr.locator("#start").click()
    await pg.wait_for_timeout(2500)
    st = await f.evaluate("document.getElementById('rig').contentWindow.RIG.state()")
    assert st["running"], f"[{title}] Start did not start the rig: {st}"
    assert await fr.locator("#btnJobDone").is_visible(), f"[{title}] no way to say I'm done"
    # ⚠️ It has to carry WORDS, and they have to be the HOST's. The button ships empty so
    # there is no English to flash before the locale lands, which also means an `init`
    # that never arrived leaves a blank pill — exactly what this catches.
    label = (await fr.locator("#btnJobDone").inner_text()).strip()
    assert label, f"[{title}] the done button is unlabelled — a bare glyph is the thing this replaced"
    print(f"[{W}px] {title}: done button reads {label!r}")

    # the app's clock is the one in charge: it must be CORRECTING the rig, so the rig's
    # remaining has to track the wall clock rather than free-run from its own frames.
    left1 = st["left"]
    await pg.wait_for_timeout(2000)
    st2 = await f.evaluate("document.getElementById('rig').contentWindow.RIG.state()")
    drift = abs((left1 - st2["left"]) - 2.0)
    assert drift < 0.75, f"[{title}] rig clock is not tracking: {left1}->{st2['left']}"
    print(f"[{W}px] {title}: running, 2s of wall clock cost {left1 - st2['left']:.2f}s of egg")

    # ⚠️ THE CORRECTION IS THE POINT, so prove it rather than infer it from agreement.
    # Two clocks that merely happen to tick at the same rate agree until one of them
    # stops — which is exactly what a hidden tab does to the rig's rAF-driven one.
    # Shove the rig's clock somewhere false and the app's next sync must haul it back;
    # if sync were dead, the two would simply drift on from the new offset.
    # ⚠️ Knocked DOWNWARD on purpose. setLeft clamps to TMR.total (it is a correction,
    # not a way to lengthen a run), so a knock upward is refused and would test the
    # clamp rather than the loop. 40s is far enough to be unmistakable and nowhere
    # near zero, which would start the break instead.
    knock = st2["left"] - 40
    await f.evaluate(f"document.getElementById('rig').contentWindow.RIG.setLeft({knock})")
    bad = await f.evaluate("document.getElementById('rig').contentWindow.RIG.state()")
    await pg.wait_for_timeout(1600)
    fixed = await f.evaluate("document.getElementById('rig').contentWindow.RIG.state()")
    assert bad["left"] < st2["left"] - 35, f"[{title}] setLeft did not move the clock: {bad}"
    assert abs(fixed["left"] - (st2["left"] - 1.6)) < 1.5, \
        f"[{title}] the app did not correct the rig: knocked to {bad['left']:.0f}, still {fixed['left']:.0f}"
    print(f"[{W}px] {title}: knocked the egg's clock to {bad['left']:.0f}s, "
          f"the app pulled it back to {fixed['left']:.0f}s")
    shots.append((Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"), f"{title} — running"))

    await fr.locator("#btnJobDone").click()
    await pg.wait_for_timeout(3200)
    assert await fr.locator("#done").is_visible(), f"[{title}] I'm done did not hatch it"
    shots.append((Image.open(io.BytesIO(await pg.screenshot())).convert("RGB"), f"{title} — hatched"))

    await fr.locator("#done").click()
    await pg.wait_for_timeout(2500)
    assert await pg.evaluate("!!document.getElementById('dock-timer')"), \
        f"[{title}] Done did not land back on the chart"

    # the job actually moved: the card is no longer the kid's to start
    state = await pg.evaluate(
        "JSON.stringify((document.querySelector('button.ch-task[data-state]')||{}).dataset||{})")
    print(f"[{W}px] {title}: landed on the chart, first card now {state}")

    new_errs = [e for e in errs if e not in fresh]
    assert not new_errs, f"[{title}] console/network errors: {new_errs[:4]}"
    assert not any("kid/js/egg.js" in u for u in seen), \
        f"[{title}] the OLD placeholder egg was loaded: {[u for u in seen if 'egg.js' in u]}"


async def m():
    errs, seen, shots = [], [], []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": W, "height": 844}, device_scale_factor=3)
        pg.on("console", lambda x: errs.append(f"{x.type}: {x.text}") if x.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        pg.on("requestfailed", lambda r: errs.append(f"failed: {r.url}"))
        pg.on("request", lambda r: seen.append(r.url))

        await pg.goto(f"{BASE}/kid/")
        await pg.evaluate("localStorage.setItem('kid.deviceToken','eggtimer-dev-token-1')")
        await pg.reload()
        await pg.wait_for_timeout(2500)
        await pg.get_by_text("Kid 1").first.click()
        await pg.wait_for_timeout(3000)
        assert await pg.evaluate("!!document.getElementById('dock-timer')"), "never reached the chart"

        await resume_leg(pg, shots)
        for title, clock in (TASK, CHORE):
            await leg(pg, title, clock, errs, seen, shots)

        ov = await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert ov <= 0, f"horizontal overflow of {ov}px"
        await b.close()

    pad, lab = 12, 26
    cw = max(s.width for s, _ in shots)
    sheet = Image.new("RGB", (cw * len(shots) + pad * (len(shots) + 1),
                              max(s.height for s, _ in shots) + pad * 2 + lab), "#15182c")
    for i, (s, _) in enumerate(shots):
        sheet.paste(s, (pad + i * (cw + pad), pad + lab))
    path = f"{OUT}jobflow-{W}.png"
    sheet.save(path)
    print(f"[{W}px] ALL GREEN — both legs. {path}")


asyncio.run(m())
