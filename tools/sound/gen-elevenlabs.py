#!/usr/bin/env python3
"""ElevenLabs shout-out generator — browse the community voice library, then generate.

    export ELEVENLABS_API_KEY=sk_...
    python3 gen-elevenlabs.py --probe                       # verify key + tier, self-check API
    python3 gen-elevenlabs.py --search --accent irish --age young
    python3 gen-elevenlabs.py --generate <voice_id>:buddy <voice_id>:pip ...

WHY THIS EXISTS: OpenAI and Deepgram were both rejected as "assistant voices." Neither ships a
single child or character voice. ElevenLabs' community library is the only one of the three with
voices filterable by AGE (including child) and deep ACCENT coverage, which is what was asked for.

STATUS: the TTS call is written against the confirmed API reference. The voice-library SEARCH
filters could NOT be verified without a working key (the one on the Mac Mini is expired), so
`--probe` prints the raw response and reports which filters the server actually honoured.
Run --probe FIRST; it will tell you within seconds if any parameter name is wrong.
"""
from __future__ import annotations  # `dict | None` is evaluated at runtime without this

import argparse, json, os, sys, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import audio as A

HERE = Path(__file__).parent
OUT = HERE / "elevenlabs"
RAW, WAVD = OUT / "raw", OUT / "wav"

API = "https://api.elevenlabs.io/v1"
MODEL = "eleven_multilingual_v2"   # v3 is more expressive; flash_v2_5 is cheaper/faster


def key() -> str:
    k = os.environ.get("ELEVENLABS_API_KEY")
    if not k:
        sys.exit("ELEVENLABS_API_KEY not set. On the laptop:\n"
                 "  export ELEVENLABS_API_KEY=sk_...")
    return k


def get(path: str, params: dict | None = None):
    url = f"{API}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    req = urllib.request.Request(url, headers={"xi-api-key": key()})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="ignore")[:400]
        sys.exit(f"HTTP {e.code} on {path}\n  {body}")


# Same 12 lines as the other generators so packs stay directly comparable.
LINES = {
    "done": [("great-job", "Great job!"), ("you-did-it", "You did it!"),
             ("way-to-go", "Way to go!"), ("nice-work", "Nice work!"),
             ("awesome", "Awesome!"), ("look-at-you-go", "Look at you go!"),
             ("high-five", "High five!"), ("woohoo", "Woohoo!")],
    "paid": [("you-earned-it", "You earned it!"), ("cha-ching", "Cha-ching!"),
             ("thats-yours", "That's all yours!"), ("payday", "Payday!")],
}


def probe():
    print("== subscription ==")
    s = get("/user/subscription")
    for f in ("tier", "status", "character_count", "character_limit"):
        print(f"  {f:18}: {s.get(f)}")

    print("\n== your voices ==")
    v = get("/voices").get("voices", [])
    print(f"  {len(v)} voice(s)")
    for x in v[:10]:
        lab = x.get("labels") or {}
        print(f"    {x.get('voice_id','?')[:20]:22} {x.get('name','?'):<18} "
              f"{lab.get('accent','-'):<12} {lab.get('age','-')}")

    print("\n== shared library: does it respond, and are filters honoured? ==")
    try:
        r = get("/shared-voices", {"page_size": 3, "accent": "irish"})
    except SystemExit as e:
        print(f"  shared-voices FAILED -> {e}")
        print("  If this 401s, the tier may not include library access.")
        print("  If it 422s, a filter NAME is wrong; drop filters and re-probe.")
        return
    voices = r.get("voices", r.get("shared_voices", []))
    print(f"  top-level keys : {sorted(r.keys())}")
    print(f"  returned       : {len(voices)}")
    if voices:
        print(f"  voice keys     : {sorted(voices[0].keys())[:14]}")
        for x in voices:
            print(f"    {x.get('voice_id','?')[:20]:22} {str(x.get('name'))[:16]:<18} "
                  f"accent={x.get('accent','-'):<10} age={x.get('age','-'):<8} "
                  f"gender={x.get('gender','-')}")
        got = {str(x.get("accent", "")).lower() for x in voices}
        print(f"\n  accent filter honoured: {got == {'irish'}}  (saw: {got or 'n/a'})")
    print("\nIf the above looks right, run --search to browse, then --generate.")


def search(args):
    params = {"page_size": args.limit}
    for f in ("accent", "age", "gender", "category", "language", "use_cases"):
        if getattr(args, f, None):
            params[f] = getattr(args, f)
    if args.query:
        params["search"] = args.query
    r = get("/shared-voices", params)
    voices = r.get("voices", r.get("shared_voices", []))
    print(f"{len(voices)} voice(s)  filters={ {k: v for k, v in params.items() if k != 'page_size'} }\n")
    for x in voices:
        print(f"  {x.get('voice_id','?')}")
        print(f"    {x.get('name','?')}  |  accent={x.get('accent','-')}  age={x.get('age','-')}"
              f"  gender={x.get('gender','-')}  use={x.get('use_case', x.get('category','-'))}")
        if x.get("description"):
            print(f"    {str(x['description'])[:110]}")
        if x.get("preview_url"):
            print(f"    preview: {x['preview_url']}")
        print()
    print("Pick ids, then:  python3 gen-elevenlabs.py --generate <id>:<label> <id>:<label>")


def tts(voice_id: str, text: str, settings: dict) -> bytes:
    body = json.dumps({"text": text, "model_id": MODEL, "voice_settings": settings}).encode()
    req = urllib.request.Request(
        f"{API}/text-to-speech/{voice_id}?output_format=mp3_44100_128",
        data=body,
        headers={"xi-api-key": key(), "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def generate(pairs, settings):
    for d in (RAW, WAVD):
        d.mkdir(parents=True, exist_ok=True)

    def job(a):
        vid, label, group, sid, text = a
        stem = f"{label}--{group}--{sid}"
        mp3, wv = RAW / f"{stem}.mp3", WAVD / f"{stem}.wav"
        mp3.write_bytes(tts(vid, text, settings))
        A.decode(mp3, wv)
        sr, d = A.read(wv)
        d = d[A.first_onset(d, sr):]
        end = len(d)
        while end > sr // 10 and abs(d[end - 1]) < 0.004:
            end -= 1
        d = A.normalize(d[:end], sr, target=-16.0)
        A.write(wv, sr, d)
        return dict(char=label, voice=vid, group=group, id=sid, text=text,
                    stem=stem, dur=round(len(d) / sr, 2))

    tasks = [(vid, label, g, sid, txt)
             for vid, label in pairs
             for g, items in LINES.items()
             for sid, txt in items]
    print(f"generating {len(tasks)} clips across {len(pairs)} voice(s) ...", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(job, tasks))
    res.sort(key=lambda r: (r["char"], r["group"], r["id"]))
    (OUT / "index.json").write_text(json.dumps(res, indent=2))
    print(f"done. {len(res)} clips -> {OUT/'index.json'}")
    print("Next:  python3 build-site.py && bun run server.ts")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--probe", action="store_true", help="verify key + self-check API shape")
    p.add_argument("--search", action="store_true")
    p.add_argument("--generate", nargs="+", metavar="VOICE_ID:LABEL")
    p.add_argument("--query"); p.add_argument("--accent"); p.add_argument("--age")
    p.add_argument("--gender"); p.add_argument("--category"); p.add_argument("--language")
    p.add_argument("--use-cases", dest="use_cases")
    p.add_argument("--limit", type=int, default=20)
    # Higher style + lower stability = more expressive, which is the whole point here.
    p.add_argument("--stability", type=float, default=0.35)
    p.add_argument("--style", type=float, default=0.65)
    a = p.parse_args()

    if a.probe:
        probe()
    elif a.search:
        search(a)
    elif a.generate:
        pairs = []
        for item in a.generate:
            if ":" not in item:
                sys.exit(f"expected VOICE_ID:LABEL, got {item!r}")
            vid, label = item.split(":", 1)
            pairs.append((vid.strip(), label.strip()))
        generate(pairs, {"stability": a.stability, "similarity_boost": 0.75,
                         "style": a.style, "use_speaker_boost": True})
    else:
        p.print_help()
