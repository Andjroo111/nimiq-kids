#!/usr/bin/env python3
"""Build the served audition site — real audio files over HTTP, no data URIs.

Data-URI pages don't reliably play in every viewer; served files do, and they stream
instead of forcing a 600 KB parse before the first tap.
"""
import html, json, shutil, subprocess
from pathlib import Path

HERE = Path(__file__).parent
SITE = HERE / "site"
CLIPS = SITE / "clips"
BASE = "/sounds"  # tunnel mounts this prefix

shutil.rmtree(SITE, ignore_errors=True)
CLIPS.mkdir(parents=True)

CHARS = {
    "buddy": ("Buddy", "coral", "Bright cartoon-friend. Big smile in the voice."),
    "storyteller": ("Storyteller", "fable", "Whimsical picture-book narrator. Twinkly."),
    "coach": ("Coach", "ballad", "Calm, proud, sincere. No hype."),
}
GROUPS = {
    "done": ("Timer finished", "Fires the second the countdown hits zero, under the fanfare."),
    "paid": ("NIM landed", "Fires when a parent approves and the money actually arrives."),
}

CSS = """
  :root { --bg:#fff; --fg:#1f2348; --mut:#6b7099; --line:#e7e9f4; --gold:#e9b213; --card:#fafbff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12142b; --fg:#f0f1fa; --mut:#9ca2c9; --line:#2a2e52; --card:#1a1d3a; } }
  * { box-sizing:border-box; }
  body { background:var(--bg); color:var(--fg); font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         margin:0; padding:20px 16px 60px; max-width:640px; margin-inline:auto; -webkit-text-size-adjust:100%; }
  h1 { font-size:1.45rem; margin:0 0 4px; letter-spacing:-.02em; }
  .lede { color:var(--mut); margin:0 0 24px; font-size:.94rem; }
  section { border:1px solid var(--line); border-radius:16px; padding:18px 16px; margin-bottom:20px; background:var(--card); }
  h2 { font-size:1.15rem; margin:0 0 2px; }
  .sub { color:var(--mut); font-size:.86rem; margin:0 0 14px; }
  .tag { display:inline-block; background:var(--line); color:var(--mut); border-radius:99px;
         padding:1px 8px; font-size:.72rem; margin-left:4px; white-space:nowrap; }
  h3 { font-size:.82rem; text-transform:uppercase; letter-spacing:.07em; color:var(--mut); margin:18px 0 2px; }
  .gd { color:var(--mut); font-size:.8rem; margin:0 0 10px; }
  .grid { display:grid; gap:8px; }
  .clip { display:flex; align-items:center; gap:10px; width:100%; text-align:left; cursor:pointer;
          background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:12px;
          padding:14px; font:inherit; font-size:.95rem; -webkit-tap-highlight-color:transparent; }
  .clip.on { border-color:var(--gold); background:rgba(233,178,19,.14); }
  .play { color:var(--gold); font-size:.8rem; width:12px; }
  .txt { flex:1; font-weight:600; }
  .dur { color:var(--mut); font-size:.78rem; font-variant-numeric:tabular-nums; }
  .all { margin-top:14px; width:100%; background:var(--gold); color:#1f2348; border:0; cursor:pointer;
         border-radius:12px; padding:13px; font:inherit; font-weight:700; font-size:.9rem; }
  a.card { display:block; border:1px solid var(--line); border-radius:14px; padding:16px; margin-bottom:12px;
           text-decoration:none; color:inherit; background:var(--card); }
  a.card b { display:block; font-size:1.05rem; margin-bottom:2px; }
  a.card span { color:var(--mut); font-size:.86rem; }
  footer { color:var(--mut); font-size:.8rem; border-top:1px solid var(--line); padding-top:16px; margin-top:8px; }
"""

# iOS needs the element created inside the tap handler; one shared element avoids the
# "too many media elements" ceiling on older Safari.
JS = """
  var el = new Audio(); var curBtn = null;
  function clear() { if (curBtn) curBtn.classList.remove('on'); curBtn = null; }
  el.addEventListener('ended', clear);
  el.addEventListener('error', clear);
  function tap(btn, loop) {
    if (curBtn === btn) { el.pause(); clear(); return; }
    clear(); el.pause();
    el.loop = !!loop; el.src = btn.dataset.src;
    curBtn = btn; btn.classList.add('on');
    el.play().catch(function () { clear(); });
  }
  document.querySelectorAll('.clip').forEach(function (b) {
    b.addEventListener('click', function () { tap(b, b.hasAttribute('data-loop')); });
  });
  document.querySelectorAll('.all').forEach(function (b) {
    b.addEventListener('click', function () {
      var list = Array.prototype.slice.call(
        b.closest('section').querySelectorAll('.clip'));
      var i = 0;
      function next() {
        clear();
        if (i >= list.length) return;
        var c = list[i++]; curBtn = c; c.classList.add('on');
        el.loop = false; el.src = c.dataset.src;
        el.onended = function () { setTimeout(next, 240); };
        el.play().catch(next);
      }
      el.onended = null; next();
    });
  });
"""


# Inline favicon: Safari and Chrome both probe /favicon.ico and the apple-touch-icon paths
# on load, and without this every page view logs 404s that look like real breakage later.
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'"
        "%3E%3Ctext y='.9em' font-size='88'%3E%F0%9F%94%8A%3C/text%3E%3C/svg%3E")


def page(title, body, foot=""):
    return (f"<!doctype html><html><head><meta charset=utf-8>"
            f'<meta name=viewport content="width=device-width,initial-scale=1">'
            f'<link rel="icon" href="{ICON}">'
            f'<link rel="apple-touch-icon" href="{ICON}">'
            f'<meta name="color-scheme" content="light dark">'
            f"<title>{title}</title><style>{CSS}</style></head><body>{body}"
            f"{foot}<script>{JS}</script></body></html>")


# ---- voice pack ----
clips = json.loads((HERE / "voice" / "index.json").read_text())
total = 0
for c in clips:
    dst = CLIPS / f"{c['stem']}.m4a"
    subprocess.run(
        ["afconvert", "-f", "m4af", "-d", "aac", "-b", "64000",
         str(HERE / "voice" / "wav" / f"{c['stem']}.wav"), str(dst)],
        check=True, capture_output=True,
    )
    total += dst.stat().st_size

rows = []
for char, (cname, ovoice, desc) in CHARS.items():
    rows.append(f'<section><h2>{cname}</h2><p class="sub">{html.escape(desc)}'
                f'<span class="tag">OpenAI &middot; {ovoice}</span></p>')
    for grp, (gname, gdesc) in GROUPS.items():
        items = [c for c in clips if c["char"] == char and c["group"] == grp]
        rows.append(f'<h3>{gname}</h3><p class="gd">{html.escape(gdesc)}</p><div class="grid">')
        for c in items:
            rows.append(
                f'<button class="clip" data-src="{BASE}/clips/{c["stem"]}.m4a">'
                f'<span class="play">&#9658;</span>'
                f'<span class="txt">{html.escape(c["text"])}</span>'
                f'<span class="dur">{c["dur"]}s</span></button>'
            )
        rows.append("</div>")
    rows.append(f'<button class="all">Play all {cname} &rarr;</button></section>')

(SITE / "voice.html").write_text(page(
    "nimiq.kids — shout-out voices",
    '<h1>Shout-out voices</h1><p class="lede">Three characters, same 12 lines. Pick the one that '
    'sounds like a friend of your kids — or say &ldquo;ship all three&rdquo; and it becomes a picker '
    'in the app. Tap anything to hear it.</p>' + "".join(rows),
    f'<footer>{len(clips)} clips &middot; {total/1024:.0f} KB &middot; OpenAI '
    f'<code>gpt-4o-mini-tts</code>. English only so far; the app ships 5 languages and this '
    f'regenerates in all of them on one command.</footer>',
))

# ---- Deepgram Aura-2 accent sampler ----
dg_path = HERE / "deepgram" / "index.json"
dg_ready = dg_path.exists()
if dg_ready:
    dg = json.loads(dg_path.read_text())
    dg_total = 0
    for c in dg:
        dst = CLIPS / f"{c['stem']}.m4a"
        subprocess.run(
            ["afconvert", "-f", "m4af", "-d", "aac", "-b", "64000",
             str(HERE / "deepgram" / "wav" / f"{c['stem']}.wav"), str(dst)],
            check=True, capture_output=True,
        )
        dg_total += dst.stat().st_size

    by_accent = {}
    for c in dg:
        by_accent.setdefault(c["accent"], {}).setdefault(c["name"], []).append(c)

    ACCENT_ORDER = ["British", "Australian", "Irish", "Filipino", "American Southern", "American"]
    blocks = []
    for accent in sorted(by_accent, key=lambda a: (ACCENT_ORDER.index(a)
                                                   if a in ACCENT_ORDER else 99, a)):
        blocks.append(f'<section><h2>{html.escape(accent)}</h2>')
        for name, items in by_accent[accent].items():
            g = items[0]["gender"]
            blocks.append(
                f'<h3>{html.escape(name)} <span class="tag">{g}</span></h3>'
                f'<p class="gd">{html.escape(items[0]["desc"])}</p><div class="grid">'
            )
            for c in items:
                blocks.append(
                    f'<button class="clip" data-src="{BASE}/clips/{c["stem"]}.m4a">'
                    f'<span class="play">&#9658;</span>'
                    f'<span class="txt">{html.escape(c["text"])}</span>'
                    f'<span class="dur">{c["dur"]}s</span></button>'
                )
            blocks.append("</div>")
        blocks.append('<button class="all">Play all &rarr;</button></section>')

    (SITE / "accents.html").write_text(page(
        "nimiq.kids — accent sampler",
        '<h1>Accent sampler</h1><p class="lede">Deepgram Aura-2, 15 voices across every accent it '
        'offers. Straight talk: these are voice-agent voices, so they may still read a bit '
        '&ldquo;customer service.&rdquo; Aura-2 has <b>no</b> emotion steering &mdash; the character '
        'is entirely the voice. If none of these land, the fix is a real character-voice library, '
        'not more of these.</p>' + "".join(blocks),
        f'<footer>{len(dg)} clips &middot; {dg_total/1024:.0f} KB &middot; Deepgram '
        f'<code>aura-2</code>. No Irish voice exists despite the docs listing one.</footer>',
    ))

# ---- music pack (only once real Suno files have been processed) ----
proc = HERE / "processed-index.json"
music_ready = proc.exists() and (HERE / "processed").exists()
if music_ready:
    results = json.loads(proc.read_text())
    for r in results:
        shutil.copy(HERE / "processed" / r["file"], CLIPS / r["file"])
    body = []
    for kind, label, note in (
        ("music", "During-timer beds", "Loops until you tap again — let one run past the end to hear the seam."),
        ("alarms", "End-of-timer fanfares", "Trimmed to the opening phrase."),
    ):
        items = [r for r in results if r["kind"] == kind]
        if not items:
            continue
        body.append(f'<section><h2>{label}</h2><p class="sub">{note}</p>')
        for r in items:
            meta = f'{r["out_len"]}s &middot; {r["kb"]} KB'
            if r.get("bpm"):
                meta += f' &middot; {r["bpm"]} BPM &middot; seam {r["seam_match"]}'
            body.append(
                f'<h3>{html.escape(r["title"])} <span class="tag">{r["take"]}</span></h3>'
                f'<div class="grid"><button class="clip" data-src="{BASE}/clips/{r["file"]}"'
                f'{" data-loop=1" if kind == "music" else ""}>'
                f'<span class="play">&#9658;</span><span class="txt">Play</span>'
                f'<span class="dur">{meta}</span></button></div>'
            )
        body.append("</section>")
    (SITE / "music.html").write_text(page(
        "nimiq.kids — music pack",
        '<h1>Music pack</h1><p class="lede">Exactly what will ship — already trimmed, looped and '
        'loudness-matched.</p>' + "".join(body),
    ))

cards = []
if dg_ready:
    cards.append(
        f'<a class="card" href="{BASE}/accents.html"><b>Accent sampler &mdash; NEW</b>'
        f'<span>Deepgram Aura-2 &middot; 15 voices &middot; British, Australian, Filipino, '
        f'Southern, American</span></a>'
    )
cards.append(f'<a class="card" href="{BASE}/voice.html"><b>Shout-out voices (rejected)</b>'
             f'<span>OpenAI &middot; {len(clips)} clips &middot; kept for comparison</span></a>')
cards.append(
    f'<a class="card" href="{BASE}/music.html"><b>Music pack</b><span>Suno beds + fanfares, processed</span></a>'
    if music_ready else
    '<div class="card" style="opacity:.55"><b>Music pack</b><span>Waiting on your Suno downloads</span></div>'
)
(SITE / "index.html").write_text(page(
    "nimiq.kids — sound pack",
    '<h1>nimiq.kids sound pack</h1><p class="lede">Tap through on your phone. Nothing here is '
    'in the app yet — this is the review surface.</p>' + "".join(cards),
))

print(f"site built: {SITE}  ({len(list(CLIPS.iterdir()))} clips, {total/1024:.0f} KB)")
