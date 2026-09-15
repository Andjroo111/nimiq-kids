#!/usr/bin/env python3
"""Cut sticker art to the CIRCLE the disc clips it to, instead of to its bounding box.

    python3 tools/recut-stickers.py <src-dir> <dst-dir>     (src == dst is fine, in place)

WHY THIS EXISTS, because the symptom keeps being read as a CSS bug and it is not.

A sticker is drawn in `.stk img` (public/kid/css/chart.css): `object-fit: contain` inside
a square content box, `border-radius: 50%` over the top. `contain` fits the art's BOUNDING
BOX to that square — and the circle the radius clips to is the one INSCRIBED in the same
square. Measured against a running instance at the 34px calendar size: content box
25.22px, clip circle 25.25px across. So a square's corners sit 5.2px outside the circle,
and any ink that reaches them is gone. That was 29 of 30 stickers, the unicorn losing
17.4% of its ink (ears, horn, tail), the fox 10.7%, the shell 9.6%.

Padding cannot help: it shrinks the square and the circle together. Nor is the art itself
damaged — every source PNG is whole, it is just cut to its own outline, which is exactly
the shape that puts ink in the corners.

WHAT IT DOES. Finds the smallest circle enclosing all the ink (Welzl), then lays the art
on a SQUARE canvas that circle is inscribed in, with a little margin. `contain` maps that
canvas to the content box, the ink's enclosing circle lands inside the clip circle, and
nothing is clipped anywhere the sticker is drawn — calendar, chart slot, picker and
Treasure Box all share this CSS, and the 46px chart slot was losing up to 14.8% too.

It rewrites the CANVAS and never the drawing: every pixel is carried over untouched.

THE COST, stated so nobody rediscovers it as a bug: a shape that used to reach into the
corners now renders SMALLER, because the disc shows its circumscribed circle rather than
its bounding box. Measured over the 30: 89% of the previous drawn size on average, 79%
at worst (shell, star2, unicorn). Round subjects (balloon, rainbow) lose nothing.

`src/sticker-art.test.ts` is the guard. New art that skips this tool fails there.
"""
import os
import sys
import math
import glob
import random
from PIL import Image

THRESH = 16      # alpha above this counts as ink
MARGIN = 0.955   # the ink circle sits ~4.5% inside the clip circle, so rim antialiasing
                 # survives too. At 1.0 the outline is exactly tangent and the disc still
                 # shaves a device pixel off it, which measured as up to 2.5% of the ink.


def ink_points(im):
    """Extreme ink pixels per row and per column — a superset of the silhouette, and all
    the minimum enclosing circle can ever touch."""
    w, h = im.size
    a = im.getchannel("A").load()
    pts = set()
    for y in range(h):
        row = [x for x in range(w) if a[x, y] > THRESH]
        if row:
            pts.add((row[0], y))
            pts.add((row[-1], y))
    for x in range(w):
        col = [y for y in range(h) if a[x, y] > THRESH]
        if col:
            pts.add((x, col[0]))
            pts.add((x, col[-1]))
    return list(pts)


def hull(pts):
    """Andjroo's monotone chain. The enclosing circle is decided by hull points only, and
    dropping the interior keeps Welzl's shuffle cheap."""
    pts = sorted(pts)
    if len(pts) <= 2:
        return pts

    def half(ps):
        out = []
        for p in ps:
            while len(out) >= 2:
                (ox, oy), (bx, by) = out[-2], out[-1]
                if (bx - ox) * (p[1] - oy) - (by - oy) * (p[0] - ox) > 0:
                    break
                out.pop()
            out.append(p)
        return out

    return half(pts)[:-1] + half(pts[::-1])[:-1]


def _circ2(a, b):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), math.dist(a, b) / 2


def _circ3(a, b, c):
    ax, ay = a
    bx, by = b
    cx, cy = c
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-9:
        return None
    sa, sb, sc = ax * ax + ay * ay, bx * bx + by * by, cx * cx + cy * cy
    ux = (sa * (by - cy) + sb * (cy - ay) + sc * (ay - by)) / d
    uy = (sa * (cx - bx) + sb * (ax - cx) + sc * (bx - ax)) / d
    return (ux, uy), math.dist((ux, uy), a)


def enclosing_circle(pts):
    """Welzl by incremental construction. Seeded shuffle so a re-run is byte-identical —
    art that changes only because it was regenerated is noise in a diff."""
    ps = pts[:]
    random.Random(7).shuffle(ps)
    inside = lambda c, r, p: math.dist(c, p) <= r + 1e-7
    c, r = ps[0], 0.0
    for i, p in enumerate(ps):
        if inside(c, r, p):
            continue
        c, r = p, 0.0
        for j in range(i):
            q = ps[j]
            if inside(c, r, q):
                continue
            c, r = _circ2(p, q)
            for k in range(j):
                s = ps[k]
                if inside(c, r, s):
                    continue
                got = _circ3(p, q, s)
                if got:
                    c, r = got
    return c, r


def already_cut(im, centre, radius):
    """Is this file already circle-cut? Square canvas, and the ink's own circle sitting
    inside the inscribed one with the margin.

    Without this the tool is not idempotent: re-running it re-applies MARGIN to art that
    already has it and lands a pixel off, so a no-op pass over the folder rewrites all 30
    files and every one shows up in the diff. A tool that is going to be pointed at a
    whole directory of new packs has to be safe to point at twice.
    """
    w, h = im.size
    if w != h:
        return False
    reach = math.dist(centre, (w / 2, h / 2)) + radius
    # Judged against what the GUARD asks for (sticker-art.test.ts: reach <= 0.99), not
    # against MARGIN. Fresh output lands near 0.96 once the integer paste offset and the
    # ceil() on the side have had their say, and art that was never cut reads 1.0 or more,
    # so anything under this is already good enough to leave byte-identical.
    return reach <= (w / 2) * 0.985


def recut(path, out):
    im = Image.open(path).convert("RGBA")
    centre, radius = enclosing_circle(hull(ink_points(im)))
    if already_cut(im, centre, radius):
        if os.path.abspath(path) != os.path.abspath(out):
            with open(path, "rb") as s, open(out, "wb") as d:
                d.write(s.read())
        return im.size, im.size[0], True
    radius = max(radius, 1.0) / MARGIN
    side = int(math.ceil(2 * radius))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, (round(side / 2 - centre[0]), round(side / 2 - centre[1])), im)
    canvas.save(out)
    return im.size, side, False


def main(src, dst):
    os.makedirs(dst, exist_ok=True)
    files = sorted(glob.glob(os.path.join(src, "*.png")))
    if not files:
        sys.exit(f"no PNGs in {src}")
    print(f"{'file':<18}{'was':>12}{'now':>10}{'draws at':>10}")
    print("-" * 50)
    shrink, skipped = [], 0
    for p in files:
        name = os.path.basename(p)
        (w, h), side, kept = recut(p, os.path.join(dst, name))
        if kept:
            skipped += 1
            print(f"{name:<18}{f'{w}x{h}':>12}{'—':>10}{'already cut':>12}")
            continue
        pct = 100.0 * max(w, h) / side
        shrink.append(pct)
        print(f"{name:<18}{f'{w}x{h}':>12}{f'{side}²':>10}{pct:>9.0f}%")
    print("-" * 50)
    if shrink:
        print(f"{len(shrink)} re-cut · draws at {sum(shrink)/len(shrink):.0f}% of before "
              f"on average, {min(shrink):.0f}% at worst")
    if skipped:
        print(f"{skipped} left alone (already circle-cut)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__.strip().splitlines()[2].strip())
    main(sys.argv[1], sys.argv[2])
