#!/usr/bin/env python3
"""Prove the demo family opens on a kid with a history, and that a judge can reach it.

Four assertions, each of which failed at some point while this was being built:

  1. MOST of the week ABOVE Today carries a sticker, and not all of it. That row is the
     only past week the month grid ever shows, so a sparse one misses the point and an
     unbroken one reads as generated (Andjroo: "not every day ... but most days").
  2. Those stickers are drawn at full strength even when the date belongs to last
     month. `.cal-day.is-out` used to fade the whole cell to 0.35 and five of the
     seven dates in that row are usually last month's.
  3. The back arrow reaches the month before, and it has stickers on it too.
  4. Forward is refused on the month Today is in. There are no chores in the future.

Usage:  KID=<childId> DEV=<deviceToken> [BASE=http://127.0.0.1:3987] python3 tools/demo-past-verify.py [outdir]
"""
import os
import sys
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:3987")
KID = os.environ["KID"]
DEV = os.environ["DEV"]
OUT = sys.argv[1] if len(sys.argv) > 1 else "."

fails: list[str] = []


def check(ok: bool, label: str) -> None:
    print(("  ok   " if ok else "  FAIL ") + label)
    if not ok:
        fails.append(label)


# The cells of the week directly above Today, read out of the rendered grid rather
# than out of the feed: the feed being right is not the same claim as the kid seeing it.
#
# ⚠️ The GRID ROW, never `slice(i - 7, i)`. That is the seven days ending yesterday, which
# is a window that slides with the weekday and lines up with the row only on a Monday —
# and the same conflation, in src/demo-past.ts, is what let the row above Today go unfloored
# from Wednesday on (fixed 2026-08-05). A tool that exists to prove this property must not
# measure the thing that hid it.
ROW_ABOVE_TODAY = """
() => {
  const cells = [...document.querySelectorAll('.cal-dates .cal-day')];
  const i = cells.findIndex((c) => c.classList.contains('is-today'));
  const rowStart = i - (i % 7); // whole Monday weeks, 7 cells wide
  if (i < 0 || rowStart < 7) return null;
  return cells.slice(rowStart - 7, rowStart).map((c) => {
    const stk = c.querySelector('.stk');
    const num = c.querySelector('b');
    return {
      date: num.textContent.trim(),
      out: c.classList.contains('is-out'),
      sticker: !!stk,
      stickerOpacity: stk ? +getComputedStyle(stk).opacity : null,
      numberOpacity: +getComputedStyle(num).opacity,
      fit: stk ? getComputedStyle(stk.querySelector('img') || stk).objectFit : null,
    };
  });
}
"""

STICKER_COUNT = "() => document.querySelectorAll('.cal-dates .stk').length"

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    ctx.add_init_script(
        f"localStorage.setItem('kid.deviceToken', {DEV!r});"
        f"localStorage.setItem('kid.childId', {KID!r});"
        f"localStorage.setItem('kid.calOpen', '1');"
    )
    page = ctx.new_page()
    page.goto(f"{BASE}/kid/", wait_until="networkidle")
    page.wait_for_selector("#k-cal .cal-day", timeout=15000)
    time.sleep(2.0)  # the month feed lands after the first paint

    this_month = page.locator(".cal-month").inner_text()
    print(f"\n{this_month} (the month Today is in)")
    page.locator("#k-cal").screenshot(path=f"{OUT}/cal-1-this-month.png")

    row = page.evaluate(ROW_ABOVE_TODAY)
    check(row is not None, "there is a whole week above Today")
    if row:
        stickered = [c for c in row if c["sticker"]]
        print("       " + "  ".join(f"{c['date']}{'*' if c['sticker'] else '-'}" for c in row))
        check(5 <= len(stickered) <= 6,
              f"most of the week above Today is stickered, but not all of it (got {len(stickered)}/7)")
        cropped = [c for c in stickered if c["fit"] == "cover"]
        check(not cropped, f"no sticker is cropped to its circle (cover: {[c['date'] for c in cropped]})")
        faded = [c for c in stickered if c["stickerOpacity"] < 0.99]
        check(not faded, f"no sticker is faded (faded: {[c['date'] for c in faded]})")
        outs = [c for c in row if c["out"]]
        check(
            bool(outs) and all(c["numberOpacity"] < 0.5 for c in outs),
            f"last month's dates stay dim ({len(outs)} of them)",
        )

    check(page.locator("#cal-next").is_disabled(), "forward is refused on the current month")

    page.locator("#cal-prev").click()
    page.wait_for_timeout(1200)
    prev_month = page.locator(".cal-month").inner_text()
    print(f"\n{prev_month} (one back)")
    page.locator("#k-cal").screenshot(path=f"{OUT}/cal-2-prev-month.png")
    check(prev_month != this_month, f"the heading followed the grid ({this_month} -> {prev_month})")
    back_stickers = page.evaluate(STICKER_COUNT)
    check(back_stickers >= 10, f"the month before has a history too ({back_stickers} stickers)")
    check(not page.locator("#cal-next").is_disabled(), "forward is offered once off the current month")

    page.locator("#cal-next").click()
    page.wait_for_timeout(1200)
    check(page.locator(".cal-month").inner_text() == this_month, "forward comes back to where it started")

    browser.close()

print("\n" + ("FAILED: " + "; ".join(fails) if fails else "all checks passed"))
sys.exit(1 if fails else 0)
