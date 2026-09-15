#!/usr/bin/env python3
"""Generate the nimiq.kids shout-out voice pack via OpenAI TTS.

Decodes with afconvert (no ffmpeg on this Mini), trims silence and peak-normalizes
with numpy so no clip is startlingly louder than another.
"""
import json, os, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import scipy.io.wavfile as wav

OUT = Path(__file__).parent / "voice"
RAW = OUT / "raw"
WAVD = OUT / "wav"
for d in (RAW, WAVD):
    d.mkdir(parents=True, exist_ok=True)

KEY = os.environ["OPENAI_API_KEY"]

# Three voice characters the kid can choose between.
VOICES = {
    "buddy": dict(
        voice="coral",
        instructions=(
            "Bright, warm, playful cartoon-friend energy cheering for a six-year-old. "
            "Big smile in the voice. Genuinely excited but never shouty, shrill, or manic. "
            "Say it quickly and land it cleanly."
        ),
    ),
    "storyteller": dict(
        voice="fable",
        instructions=(
            "Whimsical storybook narrator delighting in a child's success. Warm, twinkly, "
            "a little theatrical, like the good witch in a picture book. Not condescending. "
            "Say it quickly and land it cleanly."
        ),
    ),
    "coach": dict(
        voice="ballad",
        instructions=(
            "Gentle, proud, sincerely encouraging. Like a calm grown-up who really means it "
            "and is not performing. Soft and warm, low-key, no hype. "
            "Say it quickly and land it cleanly."
        ),
    ),
}

# group -> [(id, text)]
LINES = {
    # fires when the countdown hits zero, alongside the fanfare
    "done": [
        ("great-job", "Great job!"),
        ("you-did-it", "You did it!"),
        ("way-to-go", "Way to go!"),
        ("nice-work", "Nice work!"),
        ("awesome", "Awesome!"),
        ("look-at-you-go", "Look at you go!"),
        ("high-five", "High five!"),
        ("woohoo", "Woohoo!"),
    ],
    # fires when a parent approves and the NIM actually lands
    "paid": [
        ("you-earned-it", "You earned it!"),
        ("cha-ching", "Cha-ching!"),
        ("thats-yours", "That's all yours!"),
        ("payday", "Payday!"),
    ],
}


def tts(text: str, voice: str, instructions: str) -> bytes:
    body = json.dumps(
        {
            "model": "gpt-4o-mini-tts",
            "voice": voice,
            "input": text,
            "instructions": instructions,
            "response_format": "mp3",
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/audio/speech",
        data=body,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def decode(mp3: Path, out_wav: Path):
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", "LEI16@44100", "-c", "1", str(mp3), str(out_wav)],
        check=True, capture_output=True,
    )


def polish(path: Path) -> float:
    """Trim silence head/tail, peak-normalize to -1 dBFS, 10ms fades. Returns duration."""
    sr, d = wav.read(path)
    d = d.astype(np.float32) / 32768.0

    # Trim: first/last sample above -45 dBFS, with a small pad so plosives survive.
    thresh = 10 ** (-45 / 20)
    loud = np.where(np.abs(d) > thresh)[0]
    if len(loud):
        pad = int(sr * 0.02)
        d = d[max(0, loud[0] - pad) : min(len(d), loud[-1] + pad)]

    peak = np.max(np.abs(d))
    if peak > 0:
        d = d * (10 ** (-1 / 20) / peak)

    # 10ms in/out so nothing clicks
    n = int(sr * 0.01)
    if len(d) > 2 * n:
        d[:n] *= np.linspace(0, 1, n)
        d[-n:] *= np.linspace(1, 0, n)

    wav.write(path, sr, (d * 32767).astype(np.int16))
    return len(d) / sr


def job(args):
    char, group, sid, text = args
    stem = f"{char}--{group}--{sid}"
    mp3, wv = RAW / f"{stem}.mp3", WAVD / f"{stem}.wav"
    cfg = VOICES[char]
    mp3.write_bytes(tts(text, cfg["voice"], cfg["instructions"]))
    decode(mp3, wv)
    dur = polish(wv)
    return dict(char=char, group=group, id=sid, text=text, stem=stem, dur=round(dur, 2))


tasks = [
    (char, group, sid, text)
    for char in VOICES
    for group, items in LINES.items()
    for sid, text in items
]

print(f"generating {len(tasks)} clips ...", file=sys.stderr)
with ThreadPoolExecutor(max_workers=8) as ex:
    results = list(ex.map(job, tasks))

results.sort(key=lambda r: (r["char"], r["group"], r["id"]))
(OUT / "index.json").write_text(json.dumps(results, indent=2))

longest = max(results, key=lambda r: r["dur"])
print(f"done. {len(results)} clips, longest {longest['dur']}s ({longest['stem']})")
