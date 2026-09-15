# Proves #288 on a running instance, by what the two apps DRAW.
#
# The unit tests prove the join and the charge against an in-memory DB. What they cannot
# prove is that a parent can reach any of it: the pack rows were padlocked in the shelf
# manager, so "the server accepts a price" and "a parent can set one" are two different
# claims and only the second one is the feature.
#
# Two households on ONE strict instance, which is what production is, because the whole
# reason this is an override table and not an unlocked PATCH is that the row is shared. If
# household B's Treasure Box moves when household A reprices, the feature is a bug.
#
#   rm -f /tmp/pricing-verify.db   # the run onboards two fresh households
#   PORT=3994 DB_PATH=/tmp/pricing-verify.db NIMIQ_SIM=1 NIMIQ_NETWORK=test \
#     HATCH_LEGACY_BOOT=0 bun run src/server.ts
#   python3 tools/store-pricing-verify.py
import json, os, re, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:3994")
SHOTS = os.environ.get("SHOTS", "/tmp/pricing")
os.makedirs(SHOTS, exist_ok=True)

CATALOGUE_NIM = 2000   # src/sticker-catalog.ts, pack-space
NEW_NIM = 40


def api(path, body=None, method="POST", token=None, ip=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    # Onboarding is rate-limited per client IP, and both households here arrive from
    # loopback. Loopback is a trusted proxy by default (src/client-ip.ts), so a distinct
    # forwarded address is what a second household really looks like.
    if ip:
        req.add_header("cf-connecting-ip", ip)
    return json.load(urllib.request.urlopen(req))


def household(parent, kid, addr, ip):
    fam = api("/api/onboard", {"parentLabel": parent, "kidLabel": kid, "address": addr}, ip=ip)
    token = fam.get("token") or fam.get("parentToken")
    assert token, fam
    code = api("/api/parent/pair-code", {}, token=token)["code"]
    device = api("/api/devices/register", {"pairCode": code, "label": "verify"})["token"]
    child = api("/api/parent/overview", method="GET", token=token)["children"][0]["id"]
    return token, device, child


A = household("Andjroo", "Ann", "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD", "203.0.113.10")
B = household("Bea", "Bo", "NQ42 5D09 A7PK 0D4N GN9T 8V7M ES2J S8KL KC2T", "203.0.113.20")
print("two households onboarded on one instance")

fails = []


def check(label, ok, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + label + ((" — " + detail) if detail else ""))
    if not ok:
        fails.append(label)


def nim_in(text):
    """Every NIM figure a screen actually renders, as ints."""
    return [int(m.replace(",", "").replace(" ", "").replace("\xa0", ""))
            for m in re.findall(r"([\d][\d, \xa0]*)\s*NIM", text)]


def open_box(pg, token):
    """The parent's Treasure Box manager: Settings -> the Box card."""
    pg.add_init_script("localStorage.setItem('kidsParentToken', %s)" % json.dumps(token))
    pg.goto(BASE + "/parent/", wait_until="networkidle")
    pg.wait_for_selector("[data-tab='settings']", timeout=15000)
    pg.click("[data-tab='settings']")
    pg.wait_for_selector("#box-manage", timeout=15000)
    pg.click("#box-manage")
    pg.wait_for_selector(".bx-shelf-p", timeout=15000)


def kid_box(pg, device, child):
    """The kid's own Treasure Box, walked to the way a kid does."""
    pg.add_init_script("localStorage.setItem('kid.deviceToken', %s)" % json.dumps(device))
    pg.goto(BASE + "/kid/?childId=" + child, wait_until="networkidle")
    pg.wait_for_selector(".account-entry", timeout=15000)
    pg.click(".account-entry")
    pg.wait_for_selector("#kid-app.chart-screen", timeout=15000)
    pg.click("#dock-box")
    pg.wait_for_selector(".bx-item", timeout=15000)
    # The Box fades in. The DOM is already right, but a shot taken now is a white page and
    # this run is evidence for eyes as well as for assertions.
    pg.wait_for_timeout(1200)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)

    # ---- the parent shelf manager: a pack is reachable at all -------------------------
    pa = ctx.new_page()
    open_box(pa, A[0])
    shelf = pa.query_selector(".bx-shelf-p")
    row = next(r for r in pa.query_selector_all(".bx-row-p") if "Space" in (r.inner_text() or ""))
    pa.screenshot(path=SHOTS + "/1-shelf-before.png", full_page=True)
    check("the Space pack row is no longer padlocked",
          row.query_selector(".bx-row-lock") is None and row.query_selector("[data-item]") is not None,
          row.inner_text().replace("\n", " / "))
    check("it renders the catalogue price to start with",
          CATALOGUE_NIM in nim_in(row.inner_text()), row.inner_text().replace("\n", " / "))

    # ---- the sheet: one field, and it is the price ------------------------------------
    row.query_selector("[data-item]").click()
    pa.wait_for_selector("#bx-it-price", timeout=15000)
    pa.screenshot(path=SHOTS + "/2-price-sheet.png", full_page=True)
    sheet = pa.inner_text(".sheet") if pa.query_selector(".sheet") else pa.inner_text("body")
    check("the sheet is named after the pack, not the generic thing editor", "Space" in sheet, sheet.split("\n")[0])
    check("no name field on a catalogue row", pa.query_selector("#bx-it-title") is None)
    check("no face picker on a catalogue row", pa.query_selector(".bx-glyphs") is None)
    check("no Hide button on a catalogue row", pa.query_selector("#bx-it-hide") is None)
    check("the price field starts on the catalogue price",
          pa.input_value("#bx-it-price") == str(CATALOGUE_NIM), pa.input_value("#bx-it-price"))

    pa.fill("#bx-it-price", str(NEW_NIM))
    pa.dispatch_event("#bx-it-price", "input")
    pa.wait_for_timeout(200)
    fiat = pa.inner_text("#bx-it-fiat")
    pa.screenshot(path=SHOTS + "/3-price-typed.png", full_page=True)
    check("the live fiat readout follows the typed price", "$" in fiat, fiat)

    pa.click("#bx-it-save")
    pa.wait_for_timeout(1200)
    pa.wait_for_selector(".bx-shelf-p", timeout=15000)
    row2 = next(r for r in pa.query_selector_all(".bx-row-p") if "Space" in (r.inner_text() or ""))
    pa.screenshot(path=SHOTS + "/4-shelf-after.png", full_page=True)
    check("the shelf row repaints on the new price",
          nim_in(row2.inner_text()) == [NEW_NIM], row2.inner_text().replace("\n", " / "))

    # ---- household A's kid sees it ----------------------------------------------------
    ka = ctx.new_page()
    kid_box(ka, A[1], A[2])
    tile_a = next(t for t in ka.query_selector_all(".bx-item") if "Space" in (t.inner_text() or ""))
    ka.screenshot(path=SHOTS + "/5-kidA-box.png", full_page=True)
    check("household A's Treasure Box draws the new price",
          NEW_NIM in nim_in(tile_a.inner_text()), tile_a.inner_text().replace("\n", " / "))

    # ---- household B, same shared row, is untouched ------------------------------------
    kb = ctx.new_page()
    kid_box(kb, B[1], B[2])
    tile_b = next(t for t in kb.query_selector_all(".bx-item") if "Space" in (t.inner_text() or ""))
    kb.screenshot(path=SHOTS + "/6-kidB-box.png", full_page=True)
    check("household B's Treasure Box is still on the catalogue price",
          CATALOGUE_NIM in nim_in(tile_b.inner_text()) and NEW_NIM not in nim_in(tile_b.inner_text()),
          tile_b.inner_text().replace("\n", " / "))

    pb = ctx.new_page()
    open_box(pb, B[0])
    rowb = next(r for r in pb.query_selector_all(".bx-row-p") if "Space" in (r.inner_text() or ""))
    check("household B's shelf manager is still on the catalogue price",
          nim_in(rowb.inner_text()) == [CATALOGUE_NIM], rowb.inner_text().replace("\n", " / "))

    b.close()

# ---- the charge itself, on the live instance ---------------------------------------------
# The tile and the till have to be the same number. This buys the repriced pack for real
# through the running server and reads what actually left the kid's balance.
api("/api/kids/%s/fund" % A[2], {"valueLuna": CATALOGUE_NIM * 100_000}, token=A[0])
buy = api("/api/kids/%s/buy" % A[2], {"itemId": "item-pack-space"}, token=A[0])
check("the live buy charges the household's price, not the catalogue's",
      buy["event"]["valueLuna"] == -NEW_NIM * 100_000, json.dumps(buy["event"]))
check("the balance left behind agrees",
      buy["balanceLuna"] == (CATALOGUE_NIM - NEW_NIM) * 100_000, str(buy["balanceLuna"]))
receipt = api("/api/kids/%s/purchases" % A[2], method="GET", token=A[0])["purchases"][0]
check("the receipt says the same number", receipt["priceLuna"] == NEW_NIM * 100_000, json.dumps(receipt))

print("\nshots in " + SHOTS)
print("FAILED: " + ", ".join(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
