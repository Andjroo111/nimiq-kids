# Reads the LIVE flipped mainnet apex in a real browser, at phone width.
#
# Nothing is created. The one POST it provokes is refused by the server on the
# `address_required` check, which sits BEFORE the row creation and before the onboarding
# brake, so it burns nothing and writes nothing.
from playwright.sync_api import sync_playwright

errs, reqs = [], []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    pg = ctx.new_page()
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("response", lambda r: reqs.append((r.status, r.url)) if "/api/" in r.url else None)

    pg.goto("https://nimiq.kids/parent/", wait_until="networkidle")
    pg.wait_for_timeout(2500)
    print("--- PARENT ONBOARDING SCREEN ---")
    print(pg.inner_text("#view")[:700])
    pg.screenshot(path="/tmp/apex-onboard.png", full_page=True)

    # A visitor with no wallet connected must not be able to reach a guaranteed 400.
    #
    # This assertion is the inverse of what it was first written as. Before #239 the primary
    # was live, the copy said connecting was "Optional right now", and tapping Create answered
    # 400 `address_required` under a toast reading "That didn't go through. Try again." — advice
    # that cannot work. The fix states the wallet as a step BEFORE the names and holds the
    # primary until it is done, so the correct outcome here is now a disabled button.
    body = pg.inner_text("#view")
    assert "Optional right now" not in body, "the optional claim is back under parent custody"
    assert "connect the wallet that pays" in body, body
    create = pg.query_selector("#onb-create")
    assert create and create.get_attribute("disabled") is not None, \
        "Create is tappable with no wallet connected, which is a guaranteed 400"
    print("--- SIGN-UP GATE ---")
    print("'Optional right now' present:", "Optional right now" in body)
    print("Create your family disabled  :", create.get_attribute("disabled") is not None)
    pg.screenshot(path="/tmp/apex-onboard-gated.png", full_page=True)

    print("--- API calls ---")
    for s, u in reqs:
        print(" ", s, u)
    print("--- console errors ---", errs)
    b.close()
