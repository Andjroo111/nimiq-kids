#!/usr/bin/env python3
"""Prove the batch connect flow in a REAL browser, at 390x844, against a running instance.

    BASE=http://127.0.0.1:3967 python3 tools/batch-connect.py

`POST /api/family/connect-challenge` and `/connect-addresses` shipped with no caller in any
browser. This walks the caller: a parent opens the app, sees ONE row offering every waiting kid
an address at once, reads a sheet that names them and names the COUNT, taps once, and the
household comes back registered. Every assertion is on RENDERED text or on what the browser
wrote down, never on an HTTP status.

WHERE THE STUB SITS, stated rather than implied
-----------------------------------------------
The Nimiq Hub cannot open in headless Chromium, so the wallet popup is replaced at the app
shell's own seam: `window.hatchParentShell.hub.connectAccount` (src/parent-shell.ts). That is
the same seam `public/parent/payout-sign.js` was verified through, and it is exactly one
function wide. Everything on this side of it is the real app: the real challenge from the real
endpoint, the real key-path plan, the real all-or-nothing write, the real screens.

The signatures the stub returns are REAL Ed25519 signatures over the real challenge, made by
`tools/connect-keys.ts` under the Keyguard's connect prefix, so the server's verifier is
genuinely exercised. What the stub does NOT reproduce is derivation: the keys are fresh, not
walked out of a recovery phrase. A real wallet signing a real family is still unproven by a
human, and it is the same gap the payout card left.

Point it at a throwaway instance. It mints demo households and rewrites their kid addresses.
"""
import asyncio, json, os, subprocess, sys
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:3967")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get("OUT", "/tmp")

failed = False


def check(name, ok, detail=""):
    global failed
    print(f"{'PASS' if ok else 'FAIL'}  {name}{' — ' + detail if detail else ''}")
    if not ok:
        failed = True


def api(path, method="GET", body=None, token=None):
    import urllib.request
    req = urllib.request.Request(
        BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"content-type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


def sign(challenge, count):
    """A stand-in Keyguard: `count` real signatures over the one challenge."""
    out = subprocess.run(["bun", "run", "tools/connect-keys.ts", challenge, str(count)],
                         cwd=REPO, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"connect-keys failed: {out.stderr[:400]}")
    return json.loads(out.stdout.strip().splitlines()[-1])


async def toast_text(page):
    return await page.evaluate("() => document.querySelector('#toast .status')?.textContent ?? ''")


async def wait_toast(page, contains, timeout=12000):
    try:
        await page.wait_for_function(
            "want => (document.querySelector('#toast .status')?.textContent ?? '').includes(want)",
            arg=contains, timeout=timeout)
        return True
    except Exception:
        return False


async def main():
    health = api("/health")
    print(f"instance v{health['v']} · network={health['network']} · sim={health['sim']}")

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        errors = []

        mint = api("/api/demo/family", "POST", {})
        kids = mint["children"]
        names = [k["label"] for k in kids]
        overview = api("/api/parent/overview", token=mint["parentToken"])
        family_wallet = overview["parentAddress"]
        print(f"household: {', '.join(names)} · family wallet {family_wallet[:14]}...")

        # Console errors are recorded WITH THE PHASE that produced them. Provoking a refusal
        # means provoking an HTTP 400, and Chromium logs every one of those as "Failed to load
        # resource" whatever the app then does with it. Lumping those in with the happy path
        # would either fail a passing run or teach the run to ignore real errors. So the bar is
        # split: zero of ANY kind on the path a parent walks, and nothing but the browser's own
        # note about the status we asked for during the two deliberate refusals.
        phase = {"now": "boot"}
        RESOURCE_NOTE = "Failed to load resource"

        ctx = await browser.new_context(viewport={"width": 390, "height": 844},
                                        device_scale_factor=2, is_mobile=True,
                                        has_touch=True, user_agent=(
                                            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                                            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
                                            "Mobile/15E148 Safari/604.1"))
        page = await ctx.new_page()
        page.on("console", lambda m: errors.append((phase["now"], m.text)) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append((phase["now"], f"pageerror: {e}")))

        # The one seam. Registered before the app loads so the flow can never race it.
        async def do_sign(source, challenge, count):
            return sign(challenge, count)
        await page.expose_binding("__stubConnect", do_sign)

        await page.goto(f"{BASE}/parent/#t={mint['parentToken']}", wait_until="networkidle")
        await page.wait_for_timeout(2500)

        # Replace the Hub call, and nothing else. `mode` lets one browser walk the refusals
        # and the success in the order a household would survive: nothing written, then written.
        await page.evaluate("""() => {
          window.__mode = 'ok';
          window.__asked = null;
          window.hatchParentShell.hub.connectAccount = async (challenge, keyPaths) => {
            window.__asked = { challenge, keyPaths };
            const sigs = await window.__stubConnect(challenge, keyPaths.length);
            if (window.__mode === 'short') return sigs.slice(0, 1);
            if (window.__mode === 'familyWallet') {
              sigs[0] = { ...sigs[0], signer: window.__familyWallet };
              return sigs;
            }
            return sigs;
          };
        }""")
        await page.evaluate("a => { window.__familyWallet = a; }", family_wallet)

        # ---- 1. the row a parent actually sees ---------------------------------------
        row = page.locator("#cb-row")
        check("the home screen offers the batch at all", await row.count() == 1)
        row_text = (await row.inner_text()) if await row.count() else ""
        check("the row says what it does, in plain words",
              "Give your kids an address" in row_text, repr(row_text.replace("\n", " / ")))
        check("the row names the COUNT the wallet will name",
              "All 2 in one wallet check" in row_text, repr(row_text.replace("\n", " / ")))
        await page.screenshot(path=f"{OUT}/batch-connect-1-home.png")

        # ---- 2. the sheet: the kids by name, the count, one button -------------------
        await row.click()
        await page.wait_for_timeout(600)
        sheet = page.locator("#sheet")
        sheet_text = await sheet.inner_text()
        for n in names:
            check(f"the sheet names {n}", n in sheet_text)
        check("the sheet lists the kids and nothing that restates the heading",
              "one address" not in sheet_text, repr(sheet_text.replace("\n", " / ")))
        check("the sheet's count agrees with the Keyguard's",
              "connect 2 addresses" in sheet_text.lower(), repr(sheet_text.replace("\n", " / ")))
        check("no jargon on the sheet",
              not any(w in sheet_text.lower() for w in
                      ("derivation", "key path", "custody", "signature", "challenge", "seed")),
              repr(sheet_text.replace("\n", " / ")))
        buttons = await sheet.locator("button").count()
        check("one primary action on the screen", buttons == 1, f"{buttons} buttons")
        go_text = await page.locator("#cb-go").inner_text()
        check("the button names the count too", go_text == "Connect 2 addresses", repr(go_text))
        await page.screenshot(path=f"{OUT}/batch-connect-2-sheet.png")

        # ---- 3. a wallet that answers with the wrong number is refused HERE ----------
        phase["now"] = "refusals"
        await page.evaluate("() => { window.__mode = 'short'; }")
        await page.locator("#cb-go").click()
        ok = await wait_toast(page, "instead of 2")
        check("a short answer from the wallet is refused before the server sees it", ok,
              repr(await toast_text(page)))
        check("and the parent is told nothing was set up",
              "nothing was set up" in (await toast_text(page)).lower(),
              repr(await toast_text(page)))
        after = api("/api/parent/overview", token=mint["parentToken"])
        check("nothing was written",
              all(c["addressSource"] != "parent" for c in after["children"]))

        # ---- 4. a real server refusal, rendered as a sentence ------------------------
        await page.locator("#cb-row").click()
        await page.wait_for_timeout(500)
        await page.evaluate("() => { window.__mode = 'familyWallet'; }")
        await page.locator("#cb-go").click()
        ok = await wait_toast(page, "family wallet")
        check("handing a kid the family wallet is refused, in words", ok,
              repr(await toast_text(page)))
        after = api("/api/parent/overview", token=mint["parentToken"])
        check("still nothing written (all or nothing)",
              all(c["addressSource"] != "parent" for c in after["children"]))
        await page.screenshot(path=f"{OUT}/batch-connect-3-refused.png")

        # ---- 5. the whole household, in one tap -------------------------------------
        phase["now"] = "happy path"
        await page.locator("#cb-row").click()
        await page.wait_for_timeout(500)
        await page.evaluate("() => { window.__mode = 'ok'; }")
        await page.locator("#cb-go").click()
        ok = await wait_toast(page, "an address of their own")
        check("the success is stated plainly", ok, repr(await toast_text(page)))

        asked = await page.evaluate("() => window.__asked")
        check("the wallet was asked for one path per kid, starting at slot 1",
              asked["keyPaths"] == ["m/44'/242'/0'/1'", "m/44'/242'/0'/2'"], str(asked["keyPaths"]))
        check("the challenge handed to the wallet is the server's, verbatim",
              asked["challenge"].startswith("nimiq.kids: connect this family")
              and "\nnonce " in asked["challenge"], repr(asked["challenge"][:60]))

        after = api("/api/parent/overview", token=mint["parentToken"])
        check("both kids are on a parent-owned address now",
              all(c["addressSource"] == "parent" for c in after["children"]),
              str([c["addressSource"] for c in after["children"]]))
        check("and they are two different addresses",
              len({c["address"] for c in after["children"]}) == 2)

        pins = json.loads(await page.evaluate(
            "() => localStorage.getItem('kidsAddressPins') ?? '{}'"))
        check("this browser pinned each kid's address, as the per-child flow does",
              all(pins.get(c["id"]) == c["address"].replace(" ", "").upper()
                  for c in after["children"]), str(pins))

        # ---- 6. the offer is gone, and so is the per-child row -----------------------
        await page.wait_for_timeout(2500)
        check("the batch row leaves the home screen once there is nothing to offer",
              await page.locator("#cb-row").count() == 0)
        await page.screenshot(path=f"{OUT}/batch-connect-4-done.png")
        await page.locator(f"[data-kid=\"{kids[0]['id']}\"]").first.click()
        await page.wait_for_timeout(1500)
        check("the kid's own page no longer asks for an address either",
              await page.locator("#kid-addr-btn").count() == 0)
        await page.screenshot(path=f"{OUT}/batch-connect-5-kid.png")

        clean = [f"{ph}: {txt}" for ph, txt in errors if ph != "refusals"]
        noise = [f"{ph}: {txt}" for ph, txt in errors
                 if ph == "refusals" and RESOURCE_NOTE not in txt]
        check("0 console errors on the path a parent walks", len(clean) == 0, "; ".join(clean[:5]))
        check("the two deliberate refusals raise nothing but the status we asked for",
              len(noise) == 0, "; ".join(noise[:5]))
        print(f"      (refusal-phase resource notes, expected: "
              f"{len([1 for ph, t in errors if ph == 'refusals' and RESOURCE_NOTE in t])})")
        await browser.close()

    print("\nshots in " + OUT)
    print("ALL PASS" if not failed else "SOMETHING FAILED")
    sys.exit(1 if failed else 0)


asyncio.run(main())
