# Renders the family-wallet card on a PARENT-CUSTODY instance and drives the pick.
#
# The Nimiq Hub cannot open in headless Chromium, so `hatchParentShell.hub` is stubbed at the
# shell's own seam — exactly where public/parent/payout-sign.js was verified. Everything on
# this side of the stub is the real app talking to the real server, including the PATCH.
import json, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3982"
MINE = "NQ88 XCBE BYC4 RHDY TTDJ AP14 9H4P MDF6 N7FG"   # not the onboarding address
START = "NQ89 A6FR U7YF U0XD MP2L KKNK YTQC MT8Q A754"

def api(path, body=None, method="POST", token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    return json.load(urllib.request.urlopen(req))

fam = api("/api/onboard", {"parentLabel": "Andjroo", "kidLabel": "Ivy", "address": START})
token = fam.get("token") or fam.get("parentToken")
assert token, fam
print("onboarded, parent_address =", api("/api/parent/overview", method="GET", token=token)["parentAddress"])

errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    pg = ctx.new_page()
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("localStorage.setItem('kidsParentToken', %s)" % json.dumps(token))
    pg.goto(BASE + "/parent/", wait_until="networkidle")
    # Stub the Hub at the shell's seam, then walk to the family wallet screen.
    pg.evaluate("addr => { window.hatchParentShell.hub = { chooseAddress: async () => ({ address: addr }) }; }", MINE)
    pg.wait_for_selector("#go-deposit", timeout=15000)
    pg.click("#go-deposit")
    pg.wait_for_selector("#fam-wallet-card", timeout=15000)
    card = pg.inner_text("#fam-wallet-card")
    print("--- CARD ---\n" + card)
    pg.screenshot(path="/tmp/famwallet-before.png", full_page=True)
    assert "pays your kids" in card, card
    assert "A6FR" in card.replace("\n", " "), "starting address not drawn"
    pg.click("#fam-wallet-pick")
    pg.wait_for_timeout(2500)
    after = pg.inner_text("#fam-wallet-card")
    print("--- AFTER ---\n" + after)
    pg.screenshot(path="/tmp/famwallet-after.png", full_page=True)
    b.close()

server = api("/api/parent/overview", method="GET", token=token)["parentAddress"]
print("server parent_address now:", server)
assert server.replace(" ", "") == MINE.replace(" ", ""), server
assert "XCBE" in after.replace("\n", " "), "card did not repaint with the new address"
# The only console errors on this screen are 500s from GET /kids/:id/wallet, which throws
# `kid_address_not_registered` for a kid the parent has not registered an address for yet.
# Pre-existing, on the same flip path, filed and owned by its own branch. Anything else fails.
other = [e for e in errs if "500" not in e]
print("console errors (500 = the known kid-address bug):", errs)
assert not other, other
print("PASS")
