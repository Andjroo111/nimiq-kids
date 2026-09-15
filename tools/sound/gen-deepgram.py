#!/usr/bin/env python3
"""Deepgram Aura-2 accent sampler.

Aura-2 has no style/emotion steering (unlike OpenAI's `instructions`), so the character
has to come entirely from the voice choice. Shortlisted to the ones whose descriptors are
cheerful/energetic rather than professional/trustworthy, plus every non-American accent.
"""
import json, os, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import audio as A

OUT = Path(__file__).parent / "deepgram"
RAW, WAVD = OUT / "raw", OUT / "wav"
for d in (RAW, WAVD):
    d.mkdir(parents=True, exist_ok=True)

KEY = os.environ["DEEPGRAM_API_KEY"]

# (id, display, gender, accent, descriptors)
VOICES = [
    # --- non-American accents: the whole point of the exercise ---
    ("aura-2-draco-en",     "Draco",     "M", "British",          "Warm, approachable, baritone"),
    ("aura-2-pandora-en",   "Pandora",   "F", "British",          "Smooth, calm, melodic"),
    ("aura-2-hyperion-en",  "Hyperion",  "M", "Australian",       "Caring, warm, empathetic"),
    ("aura-2-theia-en",     "Theia",     "F", "Australian",       "Expressive, polite, sincere"),
    ("aura-2-amalthea-en",  "Amalthea",  "F", "Filipino",         "Engaging, natural, cheerful"),
    ("aura-2-janus-en",     "Janus",     "F", "American Southern", "Southern, smooth, trustworthy"),
    # --- American, filtered to the cheerful/energetic end ---
    ("aura-2-aurora-en",    "Aurora",    "F", "American", "Cheerful, expressive, energetic"),
    ("aura-2-ophelia-en",   "Ophelia",   "F", "American", "Expressive, enthusiastic, cheerful"),
    ("aura-2-delia-en",     "Delia",     "F", "American", "Casual, friendly, cheerful, breathy"),
    ("aura-2-iris-en",      "Iris",      "F", "American", "Cheerful, positive, approachable"),
    ("aura-2-phoebe-en",    "Phoebe",    "F", "American", "Energetic, warm, casual"),
    ("aura-2-selene-en",    "Selene",    "F", "American", "Expressive, engaging, energetic"),
    ("aura-2-atlas-en",     "Atlas",     "M", "American", "Enthusiastic, confident, friendly"),
    ("aura-2-aries-en",     "Aries",     "M", "American", "Warm, energetic, caring"),
    ("aura-2-hermes-en",    "Hermes",    "M", "American", "Expressive, engaging"),
]

LINES = [("great-job", "Great job!"), ("you-did-it", "You did it!"),
         ("way-to-go", "Woohoo! Way to go!")]


def job(args):
    vid, name, gender, accent, desc, sid, text = args
    stem = f"{vid}--{sid}"
    mp3, wv = RAW / f"{stem}.mp3", WAVD / f"{stem}.wav"
    req = urllib.request.Request(
        f"https://api.deepgram.com/v1/speak?model={vid}&encoding=mp3",
        data=json.dumps({"text": text}).encode(),
        headers={"Authorization": f"Token {KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        mp3.write_bytes(r.read())
    A.decode(mp3, wv)
    sr, d = A.read(wv)
    d = d[A.first_onset(d, sr):]
    end = len(d)
    while end > sr // 10 and abs(d[end - 1]) < 0.004:   # strip trailing silence
        end -= 1
    d = A.normalize(d[:end], sr, target=-16.0)
    n = int(0.012 * sr)
    if len(d) > 2 * n:
        d[:n] *= np_lin(0, 1, n)
        d[-n:] *= np_lin(1, 0, n)
    A.write(wv, sr, d)
    return dict(voice=vid, name=name, gender=gender, accent=accent, desc=desc,
                id=sid, text=text, stem=stem, dur=round(len(d) / sr, 2))


def np_lin(a, b, n):
    import numpy as np
    return np.linspace(a, b, n)


tasks = [(*v, sid, text) for v in VOICES for sid, text in LINES]
print(f"generating {len(tasks)} Deepgram clips ...", file=sys.stderr)
with ThreadPoolExecutor(max_workers=8) as ex:
    results = list(ex.map(job, tasks))

order = {v[0]: i for i, v in enumerate(VOICES)}
results.sort(key=lambda r: (order[r["voice"]], r["id"]))
(OUT / "index.json").write_text(json.dumps(results, indent=2))
print(f"done. {len(results)} clips across {len(VOICES)} voices")
