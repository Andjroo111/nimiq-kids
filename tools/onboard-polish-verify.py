# #241 + #242, rendered at 390x844 in a real browser on BOTH custody modes.
#
# Neither issue is provable from an HTTP 200. #241 is a CSS cascade question (does the
# `hidden` attribute actually hide?) and #242 is a string a parent reads, so both need the
# real stylesheet, the real shell and the real server.
#
# What it walks, per instance:
#   1. the first-run screen draws NO bottom tab bar (#241, the reported break), measured as
#      computed display + box height rather than "is it in the DOM";
#   2. the tab bar stays hidden through the notify screen, which runs AFTER the token exists,
#      and comes back on the home screen it belongs to;
#   3. the shared job picker's search really filters TILES, not just groups (the second
#      instance of the same shape, found by the sweep #241 asked for);
#   4. a 429 sign-up says which wait it is instead of "That didn't go through. Try again"
#      (#242), on the caller's hour and on the instance's day.
#
# The Nimiq Hub cannot open in headless Chromium, so `window.hatchParentShell.wallet` is
# stubbed at the shell's own seam, exactly as tools/onboard-custody-verify.py does it.
# Everything on this side of the stub is the real app talking to the real server.
#
# Boot first (own DBs, own ports, nothing near the live 3950/3960/3975):
#   HATCH_CUSTODY=parent HATCH_ONBOARD_PER_IP_HOUR=1 PORT=3991 DB_PATH=<scratch>/parentcustody-dev.db bun run src/server.ts
#   HATCH_ONBOARD_PER_IP_HOUR=1                      PORT=3992 DB_PATH=<scratch>/servercustody-dev.db bun run src/server.ts
#   HATCH_ONBOARD_PER_IP_HOUR=50 HATCH_ONBOARD_PER_DAY=1 PORT=3993 DB_PATH=<scratch>/daycap-dev.db  bun run src/server.ts
import json, sys
from playwright.sync_api import sync_playwright

PARENT = "http://127.0.0.1:3991"   # HATCH_CUSTODY=parent, the mainnet apex model
SERVER = "http://127.0.0.1:3992"   # server custody, the competition judge path
DAYCAP = "http://127.0.0.1:3993"   # server custody with the instance's day cap set to 1
ADDR = "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD"
SHOT = "/tmp/onboard-polish"

STUB_WALLET = """
window.hatchParentShell.wallet = {
  account: null,
  connect: async () => { window.hatchParentShell.wallet.account = { address: %s }; },
  onAccountChange: () => {},
};
""" % json.dumps(ADDR)

# How the tab bar is MEASURED. `hidden` in the DOM proved nothing here: that attribute was
# already set when the bar was on screen, which is the whole bug.
NAV_STATE = """() => {
  const n = document.getElementById('tabs');
  if (!n) return { present: false };
  const cs = getComputedStyle(n);
  return { present: true, attr: n.hasAttribute('hidden'), display: cs.display,
           height: n.getBoundingClientRect().height };
}"""

errs = {}


def page(b, label):
    # A fresh context per scenario: creating a family writes `kidsParentToken` to
    # localStorage, and a shared one would hand the next page a signed-in app.
    errs[label] = []
    pg = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2).new_page()
    pg.on("console", lambda m: errs[label].append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs[label].append(str(e)))
    return pg


def onboard(pg, base, custody):
    """First run through to the notify screen, checking the tab bar at every state."""
    pg.goto(base + "/parent/", wait_until="networkidle")
    pg.wait_for_selector(".onb", timeout=15000)
    pg.wait_for_timeout(800)   # let /health land and repaint if it is going to

    first = pg.evaluate(NAV_STATE)
    print("  first run, tab bar:", first)
    pg.screenshot(path="%s-%s-firstrun.png" % (SHOT, custody), full_page=True)
    assert first["present"] and first["attr"], first
    assert first["display"] == "none", "the bar it asks to hide is still displayed: %s" % first
    assert first["height"] == 0, first
    # and the destinations really are absent, which is why it must not be offered
    assert pg.eval_on_selector_all("#tabs button", "els => els.length") == 4

    if custody == "parent":
        pg.evaluate(STUB_WALLET)
        pg.click("#onb-connect")
        pg.wait_for_timeout(600)
        assert "Wallet connected" in pg.inner_text(".onb"), pg.inner_text(".onb")

    pg.fill("#onb-parent", "Andjroo")
    pg.fill("#onb-kid", "Ivy")
    pg.click("#onb-create")
    pg.wait_for_selector("#onb-ping-skip", timeout=20000)
    notify = pg.evaluate(NAV_STATE)
    print("  notify screen (token exists), tab bar:", notify)
    assert notify["display"] == "none", "a tab here is a dead control: %s" % notify

    pg.click("#onb-ping-skip")
    pg.wait_for_selector("#go-deposit", timeout=20000)
    home = pg.evaluate(NAV_STATE)
    print("  home, tab bar:", home)
    pg.screenshot(path="%s-%s-home.png" % (SHOT, custody), full_page=True)
    assert not home["attr"] and home["display"] == "flex" and home["height"] > 40, home


def picker_search(pg, custody):
    """The job picker's search, on the real sheet: tiles, not just groups."""
    pg.click("text=Ivy")                      # the kid's row on the family home
    pg.wait_for_selector("#go-board", timeout=15000)
    pg.click("#go-board")
    pg.wait_for_selector("#bd-add-job", timeout=15000)
    pg.click("#bd-add-job")
    pg.wait_for_selector(".jp-tile", timeout=15000)
    before = pg.eval_on_selector_all(".jp-tile", "els => els.filter(e => e.offsetParent !== null).length")
    pg.fill(".jp-search", "dish")
    pg.wait_for_timeout(300)
    after = pg.eval_on_selector_all(".jp-tile", "els => els.filter(e => e.offsetParent !== null).length")
    shown = pg.eval_on_selector_all(
        ".jp-tile", "els => els.filter(e => e.offsetParent !== null).map(e => e.innerText.trim())")
    print("  job picker: %d tiles -> %d after typing 'dish' %s" % (before, after, shown))
    pg.screenshot(path="%s-%s-picker.png" % (SHOT, custody), full_page=True)
    assert before > 5, before
    assert 0 < after < before, "the search filtered no tiles: %d of %d still drawn" % (after, before)


def refusal(b, base, label, want, forbid_hour=None):
    """The second sign-up from the same caller, and what it says."""
    pg = page(b, label)
    pg.goto(base + "/parent/", wait_until="networkidle")
    pg.wait_for_selector(".onb", timeout=15000)
    pg.wait_for_timeout(800)
    if "parent" in label:
        pg.evaluate(STUB_WALLET)
        pg.click("#onb-connect")
        pg.wait_for_timeout(600)
    pg.fill("#onb-parent", "Second")
    pg.fill("#onb-kid", "Kid")
    pg.click("#onb-create")
    pg.wait_for_selector("#toast:not([hidden])", timeout=15000)
    msg = pg.inner_text("#toast")
    print("  %s toast: %r" % (label, msg))
    pg.screenshot(path="%s-%s.png" % (SHOT, label), full_page=True)
    assert want in msg, msg
    assert "didn't go through" not in msg, msg
    if forbid_hour:
        assert forbid_hour not in msg, msg
    # AND IT HAS TO BE READABLE. The registry toast box is a fixed 8rem and neither scrolls
    # nor ellipsises, so a fourth line is simply cut off top and bottom. The first draft of
    # this copy was measured clipped here, which is why the strings are as short as they are.
    fit = pg.evaluate("""() => {
      const el = document.getElementById('toast'), st = el.querySelector('.status');
      return { box: el.getBoundingClientRect().height, text: st.scrollHeight };
    }""")
    print("    toast fit:", fit)
    assert fit["text"] <= fit["box"], "the refusal is clipped: %s" % fit
    # the refusal leaves the screen usable, and still without the tab bar
    assert pg.evaluate(NAV_STATE)["display"] == "none", "tab bar appeared on a refusal"


with sync_playwright() as p:
    b = p.chromium.launch()

    print("--- SERVER CUSTODY (3992), the competition judge path ---")
    sc = page(b, "server")
    onboard(sc, SERVER, "server")
    picker_search(sc, "server")

    print("--- PARENT CUSTODY (3991), the mainnet apex model ---")
    pc = page(b, "parent")
    onboard(pc, PARENT, "parent")
    picker_search(pc, "parent")

    print("--- 429, the caller's hour ---")
    refusal(b, SERVER, "server-429", "Too many new families right now")
    refusal(b, PARENT, "parent-429", "Too many new families right now")

    print("--- 429, the instance's day (3993) ---")
    day = page(b, "daycap-first")
    onboard(day, DAYCAP, "daycap")
    refusal(b, DAYCAP, "daycap-429", "Too many new families today", forbid_hour="right now")

    b.close()

print("console errors:", json.dumps(errs, indent=1))
for label, found in errs.items():
    if label.endswith("429"):
        # These scenarios exist to provoke a 429, which Chromium reports as a failed load.
        found = [e for e in found if "429" not in e]
    assert not found, (label, found)
print("PASS")
