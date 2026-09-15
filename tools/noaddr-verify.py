# Renders BOTH apps for a kid who has no address yet, on a real parent-custody instance.
#
# That kid is the normal first state of every kid on such an instance, and the screens they
# draw are the whole point of #236: the endpoint they render from used to answer 500, so the
# parent's home sat on a dash and the kid's Money screen claimed the chain was unreachable.
# An HTTP 200 does not prove any of that is fixed. This drives the real apps and reads the
# rendered text.
#
# Sibling of tools/famwallet-verify.py, and the same two seams: `hatchParentShell.hub` is
# stubbed because the Nimiq Hub cannot open in headless Chromium, and the kid app is paired
# with a REAL 6-digit code rather than a hand-written token. Everything else is the app
# talking to the server.
#
# MODE=control points it at a SERVER-custody instance and inverts every assertion. That pass
# is not decoration: a "fix" that simply stopped drawing addresses would sail through the pass
# above, and server custody is what every existing instance runs.
#
#   PORT=3987 bun run src/server.ts   # HATCH_CUSTODY=parent NIMIQ_SIM=1 NIMIQ_NETWORK=test
#   python3 tools/noaddr-verify.py
#   PORT=3988 bun run src/server.ts   # no HATCH_CUSTODY
#   BASE=http://127.0.0.1:3988 MODE=control python3 tools/noaddr-verify.py
import json, os, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:3987")
CONTROL = os.environ.get("MODE") == "control"
# Checksum-valid, and the FAMILY's address: parent custody refuses to onboard without one.
# The kid gets nothing, which is exactly the state under test.
FAMILY = "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD"
SHOTS = os.environ.get("SHOTS", "/tmp/noaddr") + ("-control" if CONTROL else "")


def api(path, body=None, method="POST", token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    return json.load(urllib.request.urlopen(req))


fam = api("/api/onboard", {"parentLabel": "Andjroo", "kidLabel": "Ivy", "address": FAMILY})
token = fam.get("token") or fam.get("parentToken")
assert token, fam
kid = api("/api/children", method="GET", token=token)["children"][0]
assert kid["address"] in (None, ""), "a fresh kid is supposed to have NO address: %r" % kid
print("onboarded (%s custody); kid %s starts with address %r"
      % ("server" if CONTROL else "parent", kid["label"], kid["address"]))

# The endpoint the whole issue is about, before a browser is involved.
w = api("/api/kids/%s/wallet" % kid["id"], method="GET", token=token)
if CONTROL:
    # Server custody: reading is still what MINTS the account, exactly as it always was.
    assert w["address"] and w["address"].startswith("NQ"), w
    print("GET /kids/:id/wallet -> 200, provisioned", w["address"])
else:
    assert w["address"] is None and w["balanceLuna"] == 0, w
    print("GET /kids/:id/wallet -> 200, address null")

# The kid app pairs like a real tablet: parent mints a 6-digit code, device redeems it.
code = api("/api/parent/pair-code", {}, token=token)["code"]
device = api("/api/devices/register", {"pairCode": code, "label": "verify"})["token"]

errs = []


def watch(pg):
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)

    # ---- the parent app ------------------------------------------------------------------
    pg = ctx.new_page()
    watch(pg)
    pg.add_init_script("localStorage.setItem('kidsParentToken', %s)" % json.dumps(token))
    pg.goto(BASE + "/parent/", wait_until="networkidle")
    pg.evaluate("() => { window.hatchParentShell.hub = { chooseAddress: async () => null }; }")
    pg.wait_for_selector("[data-kid]", timeout=15000)
    home = pg.inner_text("#view")
    pg.screenshot(path=SHOTS + "-parent-home.png", full_page=True)
    print("--- PARENT HOME ---\n" + home)
    if CONTROL:
        assert "No address yet" not in home, "a provisioned kid must not be told they have none"
    else:
        assert "No address yet" in home, "the roster row does not say why there is no balance"
    # The dash is this screen's "we have not read that yet", and it is what the 500 left the
    # row stuck on forever. A read that ANSWERED puts a number here. (TOTAL BALANCE beside it
    # stays a dash until deposit-check has run once, which is a different, pre-existing state
    # the screen states out loud: "Family wallet not checked yet".)
    amount = pg.inner_text("[data-kid] .amount").strip()
    assert amount not in ("—", "-", ""), "the kid's balance still reads as unread: %r" % amount
    print("kid row amount renders:", amount)

    pg.click("[data-kid]")
    pg.wait_for_selector(".account-header", timeout=15000)
    page = pg.inner_text("#view")
    pg.screenshot(path=SHOTS + "-parent-kid.png", full_page=True)
    print("--- PARENT KID PAGE ---\n" + page)
    if CONTROL:
        assert "NQ" in page, "the account header stopped drawing the address: %r" % page
        assert "Give Ivy some NIM" in page, "the gift row vanished on a provisioned kid"
    else:
        assert "No address yet" in page, "the account header does not say there is no address"
        assert "Give Ivy an address" in page, "the one action that fixes this is missing"
        assert "Give Ivy some NIM" not in page, "offering a gift with nowhere for it to land"

    # ---- the kid app ---------------------------------------------------------------------
    kp = ctx.new_page()
    watch(kp)
    kp.add_init_script("localStorage.setItem('kid.deviceToken', %s)" % json.dumps(device))
    kp.goto(BASE + "/kid/", wait_until="networkidle")
    kp.wait_for_selector(".account-entry", timeout=15000)
    kp.click(".account-entry")           # one kid in the house means no switch gate
    kp.wait_for_selector("#dock-money", timeout=15000)
    kp.click("#dock-money")
    kp.wait_for_selector(".k-money", timeout=15000)
    kp.wait_for_timeout(500)
    money = kp.inner_text(".k-money")
    kp.screenshot(path=SHOTS + "-kid-money.png", full_page=True)
    print("--- KID MONEY ---\n" + money)
    assert "k-money-offline" not in kp.inner_html(".k-money"), "still claiming the chain is down"
    if CONTROL:
        assert "NQ" in money, "the kid's card stopped drawing the address: %r" % money
        assert kp.query_selector("#hdr-grow") is not None, "Grow vanished for a provisioned kid"
        for sel in ("#dock-send", "#dock-receive", "#dock-scan"):
            assert not kp.is_disabled(sel), "%s was disabled for a provisioned kid" % sel
        print("dock live: send, receive, scan")
    else:
        assert "No address yet" in money, "the kid's card does not say there is no address"
        # #108's dead end, reached the other way: no account to stake from, so no door to one.
        assert kp.query_selector("#hdr-grow") is None, "Grow is offered to a kid with no address"
        for sel in ("#dock-send", "#dock-receive", "#dock-scan"):
            assert kp.is_disabled(sel), "%s is tappable and cannot work" % sel
        print("dock disabled: send, receive, scan")

    b.close()

print("console errors:", errs)
assert not errs, errs
print("PASS")
