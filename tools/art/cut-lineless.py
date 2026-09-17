#!/usr/bin/env python3
"""Cut the lineless Midjourney art into the four shapes the app ships.

    python3 tools/art/cut-lineless.py <lineless-dir> [--only heroes|stickers|icons|backgrounds]

`<lineless-dir>` is `lineless/` from the brand-voice-research repo (the Mini,
branch mj-hunt-0915): `frames/` (the 21 egg-hatch characters), `packs/<pack>/`
with `packs/<pack>.txt` manifests, and `backgrounds-square-2048/`. The list of
what ships is tools/art/lineless-list.json; a name in the list with no frame on
disk fails the run.

Writes:
  public/kid/timer/rive-kit/individual-pngs/hero-<id>.png   height 320, the timer rig
  public/kid/timer/heroes.json                              the rig's roster
  public/assets/heroes/hero-<id>.png                        height 640, the app's hatch
  public/assets/manifest.json  animals[]                    (backgrounds[] too)
  public/assets/stickers/<id>.png                           512 square, ink inside the
                                                            inscribed circle (see
                                                            tools/recut-stickers.py)
  public/kid/timer/icons/<slug>.png + icons/index.json      256 box, ink-normalised
  public/assets/backgrounds/<id>.jpg                        1600 square, q86
  public/kid/timer/bg/<id>.jpg                              the same file, the rig's copy

THE CUT. The frames are a character on flat white with a lavender shadow puddle
under it and two or three floating sparkles. Andjroo, 2026-09-17: character only.
  1. background = the near-white region a flood fill from the border can reach.
     A colour key would hollow the panda and the pearl-white bosses; the flood
     stops at their off-white the way the old cut_heroes.py stopped at ink.
  2. sparkles = every foreground blob under 3% of the biggest one.
  3. puddle = the puddle's own colour (sampled where light low-saturation pixels
     meet the background in the bottom band), grown from that seed within ±12 per
     channel. The seed is what keeps a pale belly: it never touches the background.
  4. edge = defringe (push interior colour into the anti-aliased band) BEFORE the
     resize, then premultiplied Lanczos, or the white bleeds back as a halo.
⚠️ The pearl-white bosses (seahorse, astronaut, robot boss) are white on white with
no outline. Their `reach` is printed; a leak shows as a low number and a hollow tile
on the contact sheet. Fix those by hand in the frame (paint the leak) and re-run.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
LIST = json.load(open(os.path.join(HERE, "lineless-list.json")))

def frame_path(src, kind, entry):
    return os.path.join(src, entry["file"])

def cut_character(path, drop_puddle=True):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    h, w, _ = a.shape
    edge = np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3), a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
    bg = np.median(edge, axis=0)
    dist = np.linalg.norm(a - bg, axis=2)
    # ⚠️ TIGHT. The lineless bodies have no outline, and the panda, the corgi's chest and the
    # pearl bosses sit at 235..247 against a 255 background; a 44-wide tolerance flooded
    # straight through them (first run, 2026-09-17). The background itself never strays more
    # than 11 from white, and only in specks the 3% rule below drops.
    SOFT0, SOFT1 = 4.0, 9.0
    loose = dist < SOFT1
    lab, _ = ndimage.label(loose)
    border = set(lab[0].tolist()) | set(lab[-1].tolist()) | set(lab[:, 0].tolist()) | set(lab[:, -1].tolist())
    border.discard(0)
    outside = np.isin(lab, list(border))
    fg = ~outside
    # sparkles: keep blobs that are at least 3% of the biggest
    flab, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, flab, range(1, n + 1))
        keep = [i + 1 for i, s in enumerate(sizes) if s >= 0.03 * sizes.max()]
        fg = np.isin(flab, keep)
        outside = ~fg
    # puddle
    if drop_puddle:
        mx, mn = a.max(2), a.min(2)
        cls = (mx - mn <= 40) & (mn >= 196) & (mx <= 250) & fg
        ys = np.nonzero(fg.any(1))[0]
        if len(ys):
            top, bot = ys.min(), ys.max()
            band = np.zeros_like(fg); band[int(top + 0.55 * (bot - top)):] = True
            near_bg = ndimage.binary_dilation(outside, iterations=4)
            seeds = cls & band & near_bg
            if seeds.sum() > 200:
                q = (a[seeds] // 4 * 4)
                vals, counts = np.unique(q, axis=0, return_counts=True)
                pc = vals[counts.argmax()]
                key = (np.abs(a - pc).max(2) <= 12) & fg
                klab, kn = ndimage.label(key)
                seed_ids = set(np.unique(klab[seeds & key]).tolist()); seed_ids.discard(0)
                puddle = np.isin(klab, list(seed_ids))
                # the puddle's own anti-aliased rim: pixels between its colour and white, so
                # neither key caught them and a hairline ellipse survived the first run. Any
                # light low-saturation pixel within 3px of the puddle goes with it; a pale foot
                # loses at most that band, invisible at a third of the size.
                rimc = (mx - mn <= 40) & (mn >= pc.min() - 6) & fg
                rim = ndimage.binary_dilation(puddle, iterations=3) & rimc
                fg = fg & ~(puddle | rim)
                outside = ~fg
    soft = np.clip((dist - SOFT0) / (SOFT1 - SOFT0), 0.0, 1.0)
    alpha = np.where(fg, 1.0, 0.0)
    # anti-aliased rim: the ring of background pixels just outside fg keeps a soft alpha
    rim = ndimage.binary_dilation(fg, iterations=2) & ~fg
    alpha = np.where(rim, np.minimum(soft, 1.0), alpha)
    # defringe: push the nearest solid colour into the rim
    rgb = a.copy()
    solid = alpha > 0.85
    if solid.any():
        idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
        near = rgb[idx[0], idx[1]]
        band = alpha < 0.98
        rgb[band] = near[band]
    out = Image.fromarray(np.dstack([rgb, alpha * 255.0]).astype(np.uint8), "RGBA")
    m = np.asarray(out)[:, :, 3] > 24
    ys, xs = np.nonzero(m)
    if not len(ys):
        return None, 0.0
    out = out.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    return out, float(m.mean())

def resize_rgba(im, w, h):
    # premultiply so Lanczos never mixes transparent-pixel colour into the edge
    a = np.asarray(im).astype(np.float32)
    al = a[:, :, 3:4] / 255.0
    pre = np.dstack([a[:, :, :3] * al, a[:, :, 3:4]])
    p = Image.fromarray(pre.astype(np.uint8), "RGBA").resize((w, h), Image.LANCZOS)
    b = np.asarray(p).astype(np.float32)
    al2 = np.maximum(b[:, :, 3:4], 1.0) / 255.0
    un = np.dstack([np.clip(b[:, :, :3] / al2, 0, 255), b[:, :, 3:4]])
    return Image.fromarray(un.astype(np.uint8), "RGBA")

def fit_height(im, H):
    s = H / im.height
    return resize_rgba(im, max(1, round(im.width * s)), H)

def to_circle_canvas(im, box, margin=0.04):
    """Square canvas the ink's enclosing circle is inscribed in (tools/recut-stickers.py)."""
    a = np.asarray(im)
    m = a[:, :, 3] > 16
    ys, xs = np.nonzero(m)
    pts = np.stack([xs, ys], 1).astype(np.float64)
    # smallest enclosing circle, iterative (Ritter + refinement is enough at this scale)
    c = pts.mean(0); r = np.linalg.norm(pts - c, axis=1).max()
    for _ in range(60):
        d = np.linalg.norm(pts - c, axis=1); i = d.argmax()
        if d[i] <= r + 0.5: break
        c = c + (pts[i] - c) * 0.5 * (1 - r / d[i]); r = np.linalg.norm(pts - c, axis=1).max()
    R = r * (1 + margin)
    side = int(np.ceil(2 * R))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, (int(round(side / 2 - c[0])), int(round(side / 2 - c[1]))), im)
    return resize_rgba(canvas, box, box)

def cut_icon(path, box=256, ink=0.40):
    im, reach = cut_character(path, drop_puddle=True)
    if im is None: return None, reach, 0.0
    n = float((np.asarray(im)[:, :, 3] > 24).sum())
    s = np.sqrt(ink * box * box / max(n, 1.0))
    s = min(s, box / im.width, box / im.height)
    small = resize_rgba(im, max(1, round(im.width * s)), max(1, round(im.height * s)))
    pad = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    pad.paste(small, ((box - small.width) // 2, (box - small.height) // 2))
    fill = float((np.asarray(pad)[:, :, 3] > 24).mean())
    return pad, reach, fill

def main():
    src = sys.argv[1]
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    def want(k): return only is None or only == k
    report = []

    if want("heroes"):
        rk = os.path.join(ROOT, "public/kid/timer/rive-kit/individual-pngs")
        ah = os.path.join(ROOT, "public/assets/heroes"); os.makedirs(ah, exist_ok=True)
        roster = []; animals = []
        for e in LIST["heroes"]:
            im, reach = cut_character(frame_path(src, "heroes", e))
            assert im is not None, e
            rig = fit_height(im, 320); rig.save(os.path.join(rk, f"hero-{e['id']}.png"), optimize=True)
            # the rig asks for .webp first and falls back to .png (wiggle.html); ship both so the
            # tablet never pays a 404 on the way to the picture
            rig.save(os.path.join(rk, f"hero-{e['id']}.webp"), lossless=True, quality=100, method=6)
            app = fit_height(im, 640); app.save(os.path.join(ah, f"hero-{e['id']}.png"), optimize=True)
            fill = float((np.asarray(rig)[:, :, 3] > 24).mean())
            roster.append({"id": f"hero-{e['id']}", "label": e["label"].lower(), "w": rig.width, "h": rig.height, "fill": round(fill, 3)})
            animals.append({"id": e["id"], "label": e["label"], "url": f"/assets/heroes/hero-{e['id']}.png"})
            report.append(("hero", e["id"], reach))
        json.dump({"version": 1, "h": 320, "heroes": roster}, open(os.path.join(ROOT, "public/kid/timer/heroes.json"), "w"), indent=1)
        mp = os.path.join(ROOT, "public/assets/manifest.json"); man = json.load(open(mp)); man["animals"] = animals
        json.dump(man, open(mp, "w"), indent=2); open(mp, "a").write("\n")

    if want("stickers"):
        sd = os.path.join(ROOT, "public/assets/stickers"); os.makedirs(sd, exist_ok=True)
        for pack in LIST["packs"]:
            for e in pack["stickers"] + ([pack["egg"]] if pack.get("egg") else []):
                im, reach = cut_character(frame_path(src, "stickers", e))
                assert im is not None, e
                to_circle_canvas(im, 512).save(os.path.join(sd, f"{e['id']}.png"), optimize=True)
                report.append(("sticker", e["id"], reach))

    if want("icons"):
        idir = os.path.join(ROOT, "public/kid/timer/icons"); made = []
        for e in LIST["timerIcons"]:
            pad, reach, fill = cut_icon(frame_path(src, "icons", e))
            assert pad is not None, e
            pad.save(os.path.join(idir, f"{e['slug']}.png"), optimize=True)
            made.append({"slug": e["slug"], "fill": round(fill, 3), "reach": round(reach, 3)})
            report.append(("icon", e["slug"], reach))
        json.dump({"version": 1, "box": 256, "icons": made}, open(os.path.join(idir, "index.json"), "w"), indent=1)

    if want("backgrounds"):
        bd = os.path.join(ROOT, "public/assets/backgrounds"); os.makedirs(bd, exist_ok=True)
        td = os.path.join(ROOT, "public/kid/timer/bg"); os.makedirs(td, exist_ok=True)
        free = []
        for e in LIST["backgrounds"]:
            im = Image.open(os.path.join(src, e["file"])).convert("RGB").resize((1600, 1600), Image.LANCZOS)
            for d in (bd, td):
                im.save(os.path.join(d, f"{e['id']}.jpg"), quality=86, optimize=True, progressive=True)
            if not e.get("earnedBy"):
                free.append({"id": e["id"], "label": e["label"], "url": f"/assets/backgrounds/{e['id']}.jpg"})
        mp = os.path.join(ROOT, "public/assets/manifest.json"); man = json.load(open(mp)); man["backgrounds"] = free
        json.dump(man, open(mp, "w"), indent=2); open(mp, "a").write("\n")

    for kind, name, reach in report:
        flag = "  <-- CHECK" if reach < 0.06 else ""
        print(f"  {kind:8} {name:16} reach {reach:.3f}{flag}")

if __name__ == "__main__":
    main()
