# The grown-up's own-wallet control, rendered, in BOTH states.
#
# The bug was that the control vanished once an address existed, which is invisible to any
# test that only ever looks at a fresh grown-up. So this walks the transition: no address ->
# set one -> the control is STILL there -> set a different one -> the server agrees.
#
# The Nimiq Hub cannot open in headless Chromium, so `hatchParentShell.wallet` is stubbed at
# the shell's own seam. Everything on this side of it is the real app against a real server,
# including both PUTs.
import json, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3996"
FIRST = "NQ89 A6FR U7YF U0XD MP2L KKNK YTQC MT8Q A754"
SECOND = "NQ88 XCBE BYC4 RHDY TTDJ AP14 9H4P MDF6 N7FG"


def api(path, body=None, method="POST", token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    return json.load(urllib.request.urlopen(req))


fam = api("/api/onboard", {"parentLabel": "Andjroo", "kidLabel": "Ivy", "address": FIRST})
token = fam.get("token") or fam.get("parentToken")
assert token, fam

errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    pg = ctx.new_page()
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.add_init_script("localStorage.setItem('kidsParentToken', %s)" % json.dumps(token))
    pg.goto(BASE + "/parent/", wait_until="networkidle")
    pg.wait_for_timeout(1500)

    def stub(addr):
        pg.evaluate(
            "a => { window.hatchParentShell.wallet = { account: { address: a } }; }", addr)

    def settings():
        pg.click("[data-tab='settings']")
        pg.wait_for_selector("#gup-my-wallet", timeout=15000)
        pg.wait_for_timeout(800)

    # Onboarding put FIRST on the member already, so this opens in the "has an address" state
    # — which is exactly the state that used to have no control at all.
    settings()
    txt = pg.inner_text("#view")
    label = pg.inner_text("#gup-my-wallet").strip()
    print("--- state: address already set ---")
    print("button:", repr(label))
    assert "A6FR" in txt.replace("\n", " "), "current address not drawn"
    assert label, "no control offered to a grown-up who already has an address"
    pg.screenshot(path="/tmp/payer-has-address.png", full_page=True)

    # Change it.
    stub(SECOND)
    pg.click("#gup-my-wallet")
    pg.wait_for_timeout(2500)
    after = pg.inner_text("#view")
    print("--- after picking a different wallet ---")
    assert "XCBE" in after.replace("\n", " "), "card did not repaint with the new address"
    assert "A6FR" not in after.replace("\n", " "), "old address still drawn"
    pg.screenshot(path="/tmp/payer-changed.png", full_page=True)

    # The control must still be there, or it is a one-shot again.
    assert pg.query_selector("#gup-my-wallet"), "control vanished after the change"
    print("control still offered:", repr(pg.inner_text("#gup-my-wallet").strip()))

    # And the till card must no longer claim to be the payer.
    pg.click("[data-tab='deposit']")
    pg.wait_for_selector("#fam-wallet-card", timeout=15000)
    pg.wait_for_timeout(800)
    till = pg.inner_text("#fam-wallet-card")
    print("--- till card ---")
    print(till.split("\n")[0], "|", till.split("\n")[1] if "\n" in till else "")
    assert "payout you approve is sent from this address" not in till
    assert "Settings" in till, "till card does not point at where who-pays lives"
    pg.screenshot(path="/tmp/payer-till.png", full_page=True)
    b.close()

member = api("/api/parent/overview", method="GET", token=token)["member"]
print("\nserver says member.address:", member["address"])
assert member["address"].replace(" ", "") == SECOND.replace(" ", ""), member
print("console errors:", errs)
assert not errs, errs
print("PASS")
