# The first-run screen under both custody modes, rendered at 390x844 in a real browser.
#
# Three things have to be true and only a browser can say so:
#
#   1. SERVER CUSTODY IS UNCHANGED. The testnet demo is the competition judge path, so this
#      does not eyeball it — it renders the card twice on the same instance, once with
#      origin/main's views-onboard.js served over the branch's, and compares the two outerHTMLs
#      byte for byte.
#   2. PARENT CUSTODY STATES THE WALLET AS A STEP, above the name fields, with the primary
#      button dead until it is done. Then it connects and creates a real family.
#   3. `address_required` REACHES THE PARENT AS SOMETHING TO DO. Driven through the SERVER's
#      own 400, not the client's guard: /health is stubbed to say server custody on the
#      parent-custody instance, so the screen leaves the button live, the POST really is
#      refused, and the toast is whatever the error mapping produced.
#
# The Nimiq Hub cannot open in headless Chromium, so `window.hatchParentShell.wallet` is
# replaced with a stub at the shell's own seam — the same seam tools/famwallet-verify.py stubs
# `.hub` at. Everything on this side of it is the real app talking to the real server.
#
#   3991 = HATCH_CUSTODY=parent    3992 = server custody (the demo's model)
import json, subprocess, sys
from playwright.sync_api import sync_playwright

PARENT = "http://127.0.0.1:3991"
SERVER = "http://127.0.0.1:3992"
ADDR = "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD"
SHOT = "/tmp/onboard-custody"

MAIN_VIEW = subprocess.run(
    ["git", "show", "origin/main:public/parent/views-onboard.js"],
    capture_output=True, text=True, check=True,
).stdout

STUB_WALLET = """
window.hatchParentShell.wallet = {
  account: null,
  connect: async () => { window.hatchParentShell.wallet.account = { address: %s }; },
  onAccountChange: () => {},
};
""" % json.dumps(ADDR)

# Console errors are collected PER SCENARIO, because scenario 3 provokes a 400 on purpose and
# the browser logs every failed request as a console error. Anything else, anywhere, fails.
errs = {}


def page(ctx_factory, label):
    # A FRESH CONTEXT PER SCENARIO. Creating a family writes `kidsParentToken` to
    # localStorage, and a shared context would hand the next page a signed-in app with no
    # first-run screen to look at.
    errs[label] = []
    pg = ctx_factory().new_page()
    pg.on("console", lambda m: errs[label].append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs[label].append(str(e)))
    return pg


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = lambda: b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)

    # ---- 1. server custody: this branch vs origin/main, same instance, same pixels ----
    old = page(ctx, "server/main")
    old.route("**/parent/views-onboard.js*",
              lambda r: r.fulfill(status=200, content_type="text/javascript", body=MAIN_VIEW))
    old.goto(SERVER + "/parent/", wait_until="networkidle")
    old.wait_for_selector(".onb", timeout=15000)
    old.wait_for_timeout(800)   # let the /health read land and repaint if it is going to
    shipped = old.eval_on_selector(".onb", "el => el.outerHTML")
    old.screenshot(path=SHOT + "-server-main.png", full_page=True)

    now = page(ctx, "server/branch")
    now.goto(SERVER + "/parent/", wait_until="networkidle")
    now.wait_for_selector(".onb", timeout=15000)
    now.wait_for_timeout(800)
    branch = now.eval_on_selector(".onb", "el => el.outerHTML")
    now.screenshot(path=SHOT + "-server-branch.png", full_page=True)
    print("--- SERVER CUSTODY (3992) ---")
    print(now.inner_text(".onb"))
    assert shipped == branch, "the demo's first-run card CHANGED:\n%s\n---\n%s" % (shipped, branch)
    assert "Optional right now" in branch, branch
    assert not now.is_disabled("#onb-create"), "the demo's primary button must stay live"
    # and it still creates a family, end to end
    now.fill("#onb-parent", "Andjroo")
    now.fill("#onb-kid", "Ivy")
    now.click("#onb-create")
    now.wait_for_selector("#onb-ping-skip", timeout=15000)
    print("server custody: created, landed on", repr(now.inner_text(".onb h3")))
    now.screenshot(path=SHOT + "-server-created.png", full_page=True)

    # ---- 2. parent custody: the wallet is a step, stated first ----
    pc = page(ctx, "parent")
    pc.goto(PARENT + "/parent/", wait_until="networkidle")
    pc.wait_for_selector(".onb-step", timeout=15000)
    pc.evaluate(STUB_WALLET)
    card = pc.inner_text(".onb")
    print("--- PARENT CUSTODY (3991), first paint ---")
    print(card)
    pc.screenshot(path=SHOT + "-parent-required.png", full_page=True)
    assert "First, connect the wallet that pays" in card, card
    assert "Your kids get paid from this wallet" in card, card
    assert "Optional right now" not in card, "the false sentence is still on the parent screen"
    assert pc.is_disabled("#onb-create"), "the primary is tappable into a guaranteed 400"
    # stated BEFORE anything is typed: the step precedes both name fields in the document
    order = pc.eval_on_selector_all(
        ".onb-step, #onb-parent, #onb-kid, #onb-create",
        "els => els.map(e => e.id || e.className)")
    print("dom order:", order)
    assert order[0].startswith("onb-step"), order

    # connecting completes the step in place and hands the primary back
    pc.click("#onb-connect")
    pc.wait_for_timeout(600)
    done = pc.inner_text(".onb")
    print("--- PARENT CUSTODY, connected ---")
    print(done)
    pc.screenshot(path=SHOT + "-parent-connected.png", full_page=True)
    assert "Wallet connected" in done, done
    assert "First, connect the wallet that pays" not in done, done
    assert not pc.is_disabled("#onb-create"), "still disabled with a wallet connected"

    pc.fill("#onb-parent", "Andjroo")
    pc.fill("#onb-kid", "Ivy")
    pc.click("#onb-create")
    pc.wait_for_selector("#onb-ping-skip", timeout=20000)
    print("parent custody: created, landed on", repr(pc.inner_text(".onb h3")))
    pc.screenshot(path=SHOT + "-parent-created.png", full_page=True)

    # ---- 3. the server's own 400, in words a parent can act on ----
    # /health is stubbed to say SERVER custody on the parent-custody box, so the client's own
    # guard stands down, the button stays live, and the POST is refused by the real route.
    bad = page(ctx, "refusal")

    def fake_health(route):
        r = route.fetch()
        body = r.json()
        body["custody"]["kidCustody"] = "server"
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    bad.route("**/health", fake_health)
    bad.goto(PARENT + "/parent/", wait_until="networkidle")
    bad.wait_for_selector("#onb-create", timeout=15000)
    bad.wait_for_timeout(800)
    assert not bad.is_disabled("#onb-create"), "the stub did not take"
    bad.fill("#onb-parent", "Andjroo")
    bad.fill("#onb-kid", "Ivy")
    bad.click("#onb-create")
    bad.wait_for_selector("#toast:not([hidden])", timeout=15000)
    msg = bad.inner_text("#toast")
    print("--- REFUSAL TOAST (real 400 address_required) ---")
    print(repr(msg))
    bad.screenshot(path=SHOT + "-refusal.png", full_page=True)
    assert "Connect your wallet first" in msg, msg
    assert "didn't go through" not in msg, msg

    b.close()

print("console errors:", errs)
for label, found in errs.items():
    if label == "refusal":
        # The one allowed line, and only here: this scenario exists to make POST /api/onboard
        # answer 400, which Chromium reports as a failed resource load.
        found = [e for e in found if "400 (Bad Request)" not in e]
    assert not found, (label, found)
print("PASS")
