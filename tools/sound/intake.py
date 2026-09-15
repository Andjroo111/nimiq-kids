#!/usr/bin/env python3
"""Turn Andjroo's Suno downloads into shippable app assets.

  python3 intake.py [--src ~/Desktop/nimiq-kids-sounds]

Reads  <src>/music/*.mp3   -> seamless loops   (during-timer beds)
       <src>/alarms/*.mp3  -> trimmed stings   (end-of-timer fanfares)

Writes processed .m4a + a manifest fragment + an audition page of the RESULT, so what
he reviews is exactly what ships rather than the raw download.
"""
import argparse, base64, html, json, re, shutil, sys
from pathlib import Path

import audio as A

HERE = Path(__file__).parent
WORK = HERE / "work"

# Loudness targets. Beds sit deliberately under the fanfares, and the app layers its own
# volume 0.5 on music on top of this.
KINDS = {
    "music": dict(lufs=-20.0, bitrate=96000, label="During-timer bed"),
    "alarms": dict(lufs=-14.0, bitrate=128000, label="End-of-timer fanfare"),
}

TITLES = {
    "sunny-day": "Sunny Day", "cozy-focus": "Cozy Focus", "meadow-stroll": "Meadow Stroll",
    "ocean-drift": "Ocean Drift", "star-hop": "Star Hop", "city-skip": "City Skip",
    "chick-chirp": "Chick Chirp", "big-fanfare": "Big Fanfare", "star-sparkle": "Star Sparkle",
    "level-up": "Level Up", "marching-band": "Marching Band", "silly-honk": "Silly Honk",
}


def parse_stem(stem: str) -> tuple[str, str]:
    """'ocean-drift (1)' -> ('ocean-drift', 'take2'). Suno numbers duplicate downloads."""
    m = re.match(r"^(.*?)[ _-]*\((\d+)\)$", stem.strip())
    if m:
        return m.group(1).strip().lower().replace(" ", "-"), f"take{int(m.group(2)) + 1}"
    return stem.strip().lower().replace(" ", "-"), "take1"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(Path.home() / "Desktop" / "nimiq-kids-sounds"))
    ap.add_argument("--out", default=str(HERE / "processed"))
    args = ap.parse_args()

    src, out = Path(args.src).expanduser(), Path(args.out).expanduser()
    if not src.exists():
        print(f"source folder not found: {src}", file=sys.stderr)
        return 1

    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)
    out.mkdir(parents=True, exist_ok=True)

    results = []
    for kind, cfg in KINDS.items():
        folder = src / kind
        files = []
        if folder.is_dir():
            for ext in ("*.mp3", "*.m4a", "*.wav"):
                files += sorted(folder.glob(ext))
        if not files:
            print(f"  {kind}: nothing found in {folder}")
            continue

        for f in files:
            sid, take = parse_stem(f.stem)
            raw = WORK / f"{kind}--{sid}--{take}.wav"
            A.decode(f, raw)
            sr, d = A.read(raw)
            src_len = len(d) / sr

            if kind == "music":
                shaped, info = A.make_loop(d, sr)
            else:
                shaped, info = A.trim_sting(d, sr), {}

            shaped = A.normalize(shaped, sr, target=cfg["lufs"])

            stem = f"{sid}--{take}" if take != "take1" else sid
            wv = WORK / f"{kind}--{stem}.wav"
            A.write(wv, sr, shaped)
            m4a = out / f"{stem}.m4a"
            A.encode_aac(wv, m4a, cfg["bitrate"])

            rec = dict(
                kind=kind, id=sid, take=take, stem=stem,
                title=TITLES.get(sid, sid.replace("-", " ").title()),
                src_len=round(src_len, 1), out_len=round(len(shaped) / sr, 2),
                lufs=round(A.lufs(shaped, sr), 1), kb=round(m4a.stat().st_size / 1024),
                file=m4a.name, **info,
            )
            results.append(rec)
            extra = f"  {info.get('bpm', '')}bpm {info.get('bars', '')}bars seam={info.get('seam_match', '')}" if info else ""
            print(f"  {kind:6} {stem:24} {src_len:6.1f}s -> {rec['out_len']:5.2f}s  "
                  f"{rec['lufs']:6.1f} LUFS  {rec['kb']:4}KB{extra}")

    if not results:
        print("\nNothing to process. Expected mp3s in <src>/music/ and <src>/alarms/.")
        return 1

    (HERE / "processed-index.json").write_text(json.dumps(results, indent=2))

    # Manifest fragment, in the shape public/assets/manifest.json wants. studio.js reads
    # `title` (not `label`) — a sound added with only `label` renders its raw id.
    manifest = {
        k: [
            {"id": r["id"], "title": r["title"], "url": f"/assets/sounds/{r['file']}"}
            for r in results if r["kind"] == k and r["take"] == "take1"
        ]
        for k in KINDS
    }
    (HERE / "manifest-fragment.json").write_text(json.dumps(manifest, indent=2))

    build_audition(results, out)
    total = sum(r["kb"] for r in results if r["take"] == "take1")
    print(f"\n{len(results)} processed. Shipping set = {total} KB.")
    print(f"  audition : {HERE / 'result-audition.html'}")
    print(f"  manifest : {HERE / 'manifest-fragment.json'}")
    return 0


def build_audition(results, out: Path):
    groups = {}
    for r in results:
        groups.setdefault(r["kind"], {}).setdefault(r["id"], []).append(r)

    body = []
    for kind, cfg in KINDS.items():
        if kind not in groups:
            continue
        body.append(f'<section><h2>{cfg["label"]}s</h2>'
                    f'<p class="sub">Normalized to {cfg["lufs"]} LUFS. '
                    f'{"Loops seamlessly &mdash; let one run past the end to hear the seam." if kind == "music" else "Trimmed to the opening phrase."}</p>')
        for sid, takes in groups[kind].items():
            body.append(f'<h3>{html.escape(takes[0]["title"])}</h3><div class="grid">')
            for r in takes:
                b64 = base64.b64encode((out / r["file"]).read_bytes()).decode()
                meta = f'{r["out_len"]}s &middot; {r["kb"]} KB'
                if r.get("bpm"):
                    meta += f' &middot; {r["bpm"]} BPM &middot; {r["bars"]} bars &middot; seam {r["seam_match"]}'
                body.append(
                    f'<button class="clip" data-src="data:audio/mp4;base64,{b64}" '
                    f'{"data-loop=1" if kind == "music" else ""}>'
                    f'<span class="play">&#9658;</span><span class="txt">{r["take"]}</span>'
                    f'<span class="dur">{meta}</span></button>'
                )
            body.append("</div>")
        body.append("</section>")

    page = f"""<title>nimiq.kids &mdash; sound pack</title>
<style>
  :root {{ --bg:#fff; --fg:#1f2348; --mut:#6b7099; --line:#e7e9f4; --gold:#e9b213; --card:#fafbff; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --bg:#12142b; --fg:#f0f1fa; --mut:#9ca2c9; --line:#2a2e52; --card:#1a1d3a; }} }}
  :root[data-theme="dark"] {{ --bg:#12142b; --fg:#f0f1fa; --mut:#9ca2c9; --line:#2a2e52; --card:#1a1d3a; }}
  :root[data-theme="light"] {{ --bg:#fff; --fg:#1f2348; --mut:#6b7099; --line:#e7e9f4; --card:#fafbff; }}
  body {{ background:var(--bg); color:var(--fg); font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         margin:0; padding:20px 16px 60px; max-width:640px; margin-inline:auto; }}
  h1 {{ font-size:1.45rem; margin:0 0 4px; letter-spacing:-.02em; }}
  .lede {{ color:var(--mut); margin:0 0 26px; font-size:.94rem; }}
  section {{ border:1px solid var(--line); border-radius:16px; padding:18px 16px; margin-bottom:20px; background:var(--card); }}
  h2 {{ font-size:1.15rem; margin:0 0 2px; }}
  .sub {{ color:var(--mut); font-size:.86rem; margin:0 0 14px; }}
  h3 {{ font-size:.82rem; text-transform:uppercase; letter-spacing:.07em; color:var(--mut); margin:16px 0 8px; }}
  .grid {{ display:grid; gap:8px; }}
  .clip {{ display:flex; align-items:center; gap:10px; width:100%; text-align:left; cursor:pointer;
           background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:12px;
           padding:12px 14px; font:inherit; font-size:.95rem; }}
  .clip.on {{ border-color:var(--gold); background:color-mix(in srgb, var(--gold) 12%, var(--bg)); }}
  .play {{ color:var(--gold); font-size:.8rem; }}
  .txt {{ font-weight:600; min-width:52px; }}
  .dur {{ flex:1; text-align:right; color:var(--mut); font-size:.76rem; font-variant-numeric:tabular-nums; }}
</style>
<h1>Sound pack</h1>
<p class="lede">Exactly what will ship &mdash; already trimmed, looped and loudness-matched.
Beds keep looping until you tap them again, so you can hear whether the seam is clean.</p>
{''.join(body)}
<script>
  let cur = null, curBtn = null;
  document.querySelectorAll('.clip').forEach(function (b) {{
    b.addEventListener('click', function () {{
      if (cur) {{ cur.pause(); curBtn && curBtn.classList.remove('on'); }}
      if (curBtn === b) {{ cur = null; curBtn = null; return; }}
      cur = new Audio(b.dataset.src);
      cur.loop = b.hasAttribute('data-loop');
      curBtn = b; b.classList.add('on');
      cur.onended = function () {{ b.classList.remove('on'); cur = null; curBtn = null; }};
      cur.play();
    }});
  }});
</script>"""
    (HERE / "result-audition.html").write_text(page)


if __name__ == "__main__":
    raise SystemExit(main())
