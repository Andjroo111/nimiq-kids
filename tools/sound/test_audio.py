#!/usr/bin/env python3
"""Prove the DSP works before Andjroo's real files land.

Synthesizes a track with a known BPM and a known repeating structure, then checks that
the loop finder recovers it and that the seam is actually smooth.
"""
import numpy as np

import audio as A

SR = A.SR
fail = 0


def check(name, ok, detail=""):
    global fail
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
    if not ok:
        fail += 1


def fake_song(bpm=96, bars=40, sr=SR):
    """4-bar chord loop, with an intro build and an outro fade — like Suno gives us."""
    beat = 60.0 / bpm
    bar = beat * 4
    chords = [[262, 330, 392], [294, 370, 440], [220, 277, 330], [349, 440, 523]]
    out = []
    for b in range(bars):
        n = int(bar * sr)
        t = np.arange(n) / sr
        sig = np.zeros(n)
        for f in chords[b % 4]:
            sig += np.sin(2 * np.pi * f * t) / 3
        for k in range(4):  # kick on every beat
            s = int(k * beat * sr)
            e = min(n, s + int(0.08 * sr))
            env = np.exp(-np.linspace(0, 8, e - s))
            sig[s:e] += np.sin(2 * np.pi * 60 * np.arange(e - s) / sr) * env * 0.8
        out.append(sig)
    d = np.concatenate(out) * 0.3
    d[:int(bar * 2 * sr)] *= np.linspace(0, 1, int(bar * 2 * sr))      # intro build
    d[-int(bar * 2 * sr):] *= np.linspace(1, 0, int(bar * 2 * sr))     # outro fade
    return d


print("\n== loudness ==")
t = np.arange(SR * 3) / SR
sine = np.sin(2 * np.pi * 1000 * t) * (10 ** (-20 / 20)) * np.sqrt(2)  # -20 dBFS RMS
m = A.lufs(sine, SR)
check("1 kHz @ -20 dBFS reads ~-20 LUFS", -23 < m < -17, f"got {m:.2f}")

quiet = A.normalize(sine * 0.01, SR, target=-16.0)
check("normalize hits target", abs(A.lufs(quiet, SR) - (-16.0)) < 0.6,
      f"got {A.lufs(quiet, SR):.2f}")
check("normalize respects ceiling", np.max(np.abs(quiet)) <= 10 ** (-1 / 20) + 1e-6,
      f"peak {20*np.log10(np.max(np.abs(quiet))):.2f} dBFS")

loud = A.normalize(np.sign(np.sin(2 * np.pi * 200 * t)) * 0.99, SR, target=0.0)
check("clip-prone source is backed off", np.max(np.abs(loud)) <= 10 ** (-1 / 20) + 1e-6)

print("\n== tempo ==")
for bpm in (84, 96, 108):
    d = fake_song(bpm=bpm)
    got = 60.0 / A.beat_period(d, SR)
    # half/double-time is a musically valid answer, so accept the octave
    ok = min(abs(got - bpm), abs(got - bpm / 2), abs(got - bpm * 2)) < 6
    check(f"{bpm} BPM recovered", ok, f"got {got:.1f}")

print("\n== loop ==")
d = fake_song(bpm=96, bars=48)
loop, info = A.make_loop(d, SR, target=30.0)
check("loop is a sane length", 15 < info["len_s"] < 45, f"{info['len_s']}s")
check("loop skips the intro build", info["start_s"] >= 10, f"starts {info['start_s']}s")
check("seam matches well", info["seam_match"] > 0.5, f"corr {info['seam_match']}")
check("loop length is whole bars", info["bars"] >= 4, f"{info['bars']} bars")

# The real test: splice the loop to itself and confirm the wrap is no more discontinuous
# than an ordinary interior point.
xf = int(0.4 * SR)
wrap = np.concatenate([loop[-xf:], loop[:xf]])
wrap_jump = float(np.max(np.abs(np.diff(wrap[xf - 8:xf + 8]))))
mid = len(loop) // 2
interior_jump = float(np.max(np.abs(np.diff(loop[mid - 8:mid + 8]))))
check("wrap-around has no click", wrap_jump < max(interior_jump * 3, 0.02),
      f"wrap {wrap_jump:.4f} vs interior {interior_jump:.4f}")

# Level should hold across the seam rather than dipping (equal-power, not linear).
pre = np.sqrt(np.mean(loop[-xf:] ** 2))
post = np.sqrt(np.mean(loop[:xf] ** 2))
body = np.sqrt(np.mean(loop[xf:-xf] ** 2))
check("seam holds level", 0.55 < min(pre, post) / (body + 1e-9),
      f"pre {pre/body:.2f}x post {post/body:.2f}x of body")

print("\n== sting trim ==")
sting = np.concatenate([
    np.zeros(int(0.35 * SR)),                                  # lead-in silence
    fake_song(bpm=120, bars=8)[int(2 * 60 / 120 * 4 * SR):],    # skip its own build
])
cut = A.trim_sting(sting, SR, lo=3.0, hi=6.0)
check("sting lands in 3-6s window", 2.9 <= len(cut) / SR <= 6.2, f"{len(cut)/SR:.2f}s")
check("leading silence removed", np.max(np.abs(cut[:int(0.05 * SR)])) > 1e-4)
check("ends silent (faded)", np.max(np.abs(cut[-int(0.01 * SR):])) < 0.02)

short = np.concatenate([np.zeros(int(0.2 * SR)), fake_song(bpm=120, bars=2)])
cut2 = A.trim_sting(short, SR)
check("short input survives without crash", len(cut2) > 0, f"{len(cut2)/SR:.2f}s")

print(f"\n{'ALL PASS' if not fail else str(fail) + ' FAILED'}\n")
raise SystemExit(1 if fail else 0)
