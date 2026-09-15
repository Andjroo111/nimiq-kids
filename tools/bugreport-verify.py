# Opens the bug reporter in BOTH real apps and reads what would have gone to nimiq.bot.
#
# `src/bug-report-privacy.test.ts` proves the scrub against the shell's TypeScript, imported
# by bun. This proves it against the thing a phone actually loads: `public/dist/app-shell.js`
# and `parent-shell.js`, bundled from the pinned nimiq-app-shell, running in Chromium at
# 390x844. A pin that resolved to a stale build, or a bundle that was not rebuilt after the
# bump, fails here and passes every version string you could read.
#
# nimiq.bot is intercepted, not called: this must never file a real issue. The intercept is
# also the evidence — the request body it captures is exactly the bytes the browser was about
# to send. Service workers are blocked because they bypass page.route (see the PWA/Playwright
# note in the fleet references), which would let a real POST slip past this.
#
#   PORT=3993 DB_PATH=/tmp/verify.db NIMIQ_SIM=1 NIMIQ_NETWORK=test bun run src/server.ts
#   python3 tools/bugreport-verify.py
import json, os, re, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:3993")
SHOTS = os.environ.get("SHOTS", "/tmp/bugreport")
FAMILY = "NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD"
# A child id and a kid address, in the shapes this app really produces.
KID_UUID = "8f3c1d2e-4b5a-6c7d-8e9f-0a1b2c3d4e5f"
KID_ADDR = "NQ42 5D09 A7PK 0D4N GN9T 8V7M ES2J S8KL KC2T"
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


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
code = api("/api/parent/pair-code", {}, token=token)["code"]
device = api("/api/devices/register", {"pairCode": code, "label": "verify"})["token"]
print("onboarded; kid device paired")

CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST,OPTIONS",
}
sent = []


def fake_bot(route):
    r = route.request
    if r.method == "OPTIONS":
        return route.fulfill(status=204, headers=CORS)
    sent.append(r.post_data or "")
    drafting = r.url.endswith("/api/draft")
    body = (
        {"reportId": "r-1", "draft": {
            # The service writes the issue with an LLM, so it gets to hand back text this app
            # never composed — including, as here, an id copied straight out of the report.
            # That draft is POSTed on the second leg, so it is a second chance to publish.
            "title": "Treasure box refuses a purchase for kid %s" % KID_UUID,
            "body": "The child at %s cannot buy." % KID_ADDR,
            "labels": ["bug"]}}
        if drafting else
        {"number": 999, "url": "https://github.com/Andjroo111/nimiq-kids/issues/999"}
    )
    route.fulfill(status=200, headers={**CORS, "content-type": "application/json"},
                  body=json.dumps(body))


INJECTED = "[verify] no rows for kid %s (address %s)" % (KID_UUID, KID_ADDR)
INJECTED_URL = "/api/kids/%s/buy" % KID_UUID
errs = {}


def watch(pg, surface):
    errs[surface] = []

    def console(m):
        if m.type == "error":
            errs[surface].append((m.text, (m.location or {}).get("url", "")))

    pg.on("console", console)
    pg.on("pageerror", lambda e: errs[surface].append((str(e), "")))


def report(pg, surface, face):
    """Open the corner, file a bug, and return what the browser was about to POST."""
    before = len(sent)
    # The two things a report is supposed to carry and #140 could not: a console error naming
    # a child, and a failed request addressed by one. Both go through the shell's own capture,
    # which the corner installs at mount.
    pg.evaluate("m => console.error(m)", INJECTED)
    pg.evaluate("u => fetch(u, { method: 'POST' }).catch(() => {})",
                "/api/kids/%s/buy" % KID_UUID)
    pg.wait_for_timeout(400)

    pg.locator(face).first.click()
    pg.wait_for_selector(".nq-cc-report", timeout=10000)
    pg.click(".nq-cc-report")
    pg.wait_for_selector("#nq-fb-scrim", state="visible", timeout=10000)
    pg.screenshot(path="%s-%s-sheet.png" % (SHOTS, surface))

    # The rendered proof that diagnostics are ON: the shell only draws this row when
    # `diagnostics !== false`, and it ships pre-ticked. While #140 was open it was absent.
    diag = pg.locator("#nq-fb-diag")
    assert diag.count() == 1, "%s: no diagnostics row — diagnostics are still off" % surface
    assert diag.is_checked(), "%s: diagnostics row is not pre-ticked" % surface

    pg.fill("#nq-fb-summary", "Treasure box won't let her buy anything")
    pg.fill("#nq-fb-details",
            "She taps the sticker pack and nothing happens. Console said kid %s is unknown."
            % KID_UUID)
    pg.click("#nq-fb-send")
    pg.wait_for_selector(".nq-fb-toast", timeout=15000)
    pg.screenshot(path="%s-%s-sent.png" % (SHOTS, surface))
    assert pg.locator("#nq-fb-scrim").count() == 0, "%s: the sheet stayed open" % surface
    print("%s: sheet opened, diagnostics pre-ticked, submitted, thanks toast shown" % surface)
    return "\n".join(sent[before:])


def check(surface, wire):
    assert wire, "%s: nothing was POSTed" % surface
    print("--- %s WIRE ---\n%s\n" % (surface.upper(), wire))
    for bad, what in ((KID_UUID, "child uuid"), (KID_ADDR, "kid address"),
                      (KID_ADDR.replace(" ", ""), "compact kid address")):
        assert bad not in wire, "%s: %s reached the wire" % (surface, what)
    stray = UUID_RE.search(wire)
    assert not stray, "%s: an unredacted uuid reached the wire: %s" % (surface, stray.group())
    # Absence is cheap. These say the diagnostics travelled and were REDACTED, not dropped —
    # the difference between this bump and the diagnostics-off workaround it replaces.
    for need in ("[id redacted]", "[address redacted]",
                 "/api/kids/[id redacted]/buy", "[verify] no rows for kid [id redacted]",
                 "She taps the sticker pack and nothing happens."):
        assert need in wire, "%s: expected %r in the payload" % (surface, need)
    ctx = json.loads(wire.split("\n")[0])["context"]
    assert "?" not in ctx["url"], "%s: the query string survived: %s" % (surface, ctx["url"])
    print("%s: url on the wire = %s" % (surface, ctx["url"]))


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                        service_workers="block")
    ctx.route("**://bot.nimiq.tech/**", fake_bot)

    # ---- the parent app -------------------------------------------------------------------
    pg = ctx.new_page()
    watch(pg, "parent")
    pg.add_init_script("localStorage.setItem('kidsParentToken', %s)" % json.dumps(token))
    # A child id in the QUERY, which is the leak `pageContext` closes before the scrubber even
    # runs. The kiosk wrapper puts one here for real.
    pg.goto(BASE + "/parent/?childId=" + KID_UUID, wait_until="networkidle")
    pg.wait_for_selector("[data-kid]", timeout=15000)
    check("parent", report(pg, "parent", ".nq-cc-face"))

    # ---- the kid app ----------------------------------------------------------------------
    kp = ctx.new_page()
    watch(kp, "kid")
    kp.add_init_script("localStorage.setItem('kid.deviceToken', %s)" % json.dumps(device))
    kp.goto(BASE + "/kid/?childId=" + KID_UUID, wait_until="networkidle")
    kp.wait_for_selector(".account-entry", timeout=15000)
    # The kid's corner lives on the chart screen, not on the account picker (`.kid-lang` is
    # display:none until `#kid-app` is `.chart-screen` / `.login-screen`), so walk in first.
    # One kid in the house means no switch gate.
    kp.click(".account-entry")
    kp.wait_for_selector("#kid-app.chart-screen", timeout=15000)
    check("kid", report(kp, "kid", ".nq-cc-face-flag"))

    b.close()

# This script deliberately makes two errors per app so the report has something to carry: the
# console.error it prints, and the 404 from the /buy call it fires. Chromium logs the latter as
# a page-level "Failed to load resource" too. Everything else is the app's, and the bar is none.
for surface, seen in errs.items():
    mine = [e for e in seen if INJECTED in e[0] or INJECTED_URL in e[1]]
    theirs = [e for e in seen if e not in mine]
    print("%s: %d console error(s), %d injected by this script, %d from the app: %s"
          % (surface, len(seen), len(mine), len(theirs), theirs))
    assert len(mine) == 2, "%s: the injected error and the injected 404 did not both land: %s" % (surface, seen)
    assert not theirs, theirs
print("PASS")
