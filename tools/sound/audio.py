"""Shared DSP for the nimiq.kids sound pack.

No ffmpeg on this Mini, so: afconvert for codec work, numpy/scipy for everything else.
Loudness is ITU-R BS.1770 K-weighted (not peak) so a voice clip and a brass fanfare
normalized to the same target actually *sound* equally loud.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
import scipy.io.wavfile as wavio
from scipy.signal import bilinear_zpk, lfilter, sosfilt, zpk2sos

SR = 44100


# ---------- codec I/O ----------

def decode(src: Path, dst: Path, sr: int = SR, mono: bool = True) -> None:
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", f"LEI16@{sr}", "-c", "1" if mono else "2",
         str(src), str(dst)],
        check=True, capture_output=True,
    )


def encode_aac(src: Path, dst: Path, bitrate: int) -> None:
    subprocess.run(
        ["afconvert", "-f", "m4af", "-d", "aac", "-b", str(bitrate), str(src), str(dst)],
        check=True, capture_output=True,
    )


def read(path: Path) -> tuple[int, np.ndarray]:
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        sr, d = wavio.read(path)
    if d.ndim > 1:
        d = d.mean(axis=1)
    return sr, d.astype(np.float32) / 32768.0


def write(path: Path, sr: int, d: np.ndarray) -> None:
    wavio.write(path, sr, (np.clip(d, -1, 1) * 32767).astype(np.int16))


# ---------- loudness (ITU-R BS.1770 K-weighting) ----------

def _k_weight(d: np.ndarray, sr: int) -> np.ndarray:
    """Stage 1 high-shelf (+4 dB above ~1.5 kHz) then stage 2 high-pass (~38 Hz)."""
    # Stage 1: shelving filter, coefficients from BS.1770-4 (defined at 48k, re-derived here).
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = np.tan(np.pi * f0 / sr)
    Vh = 10 ** (G / 20.0)
    Vb = Vh ** 0.4996667741545416
    a0 = 1.0 + K / Q + K * K
    b = np.array([(Vh + Vb * K / Q + K * K), 2.0 * (K * K - Vh), (Vh - Vb * K / Q + K * K)]) / a0
    a = np.array([1.0, 2.0 * (K * K - 1.0) / a0, (1.0 - K / Q + K * K) / a0])
    d = lfilter(b, a, d)

    # Stage 2: high-pass
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = np.tan(np.pi * f0 / sr)
    a0 = 1.0 + K / Q + K * K
    b = np.array([1.0, -2.0, 1.0])
    a = np.array([1.0, 2.0 * (K * K - 1.0) / a0, (1.0 - K / Q + K * K) / a0])
    return lfilter(b, a, d)


def lufs(d: np.ndarray, sr: int) -> float:
    """Integrated loudness with the BS.1770 absolute gate at -70 LUFS."""
    y = _k_weight(d, sr)
    block = int(0.4 * sr)
    hop = max(1, block // 4)
    if len(y) < block:
        ms = np.mean(y ** 2)
        return -0.691 + 10 * np.log10(ms + 1e-12)
    powers = np.array([
        np.mean(y[i:i + block] ** 2) for i in range(0, len(y) - block + 1, hop)
    ])
    l = -0.691 + 10 * np.log10(powers + 1e-12)
    keep = powers[l > -70]
    if not len(keep):
        keep = powers
    return -0.691 + 10 * np.log10(np.mean(keep) + 1e-12)


def normalize(d: np.ndarray, sr: int, target: float, ceiling_db: float = -1.0) -> np.ndarray:
    """Loudness-match to `target` LUFS, then back off if that would clip."""
    gain = 10 ** ((target - lufs(d, sr)) / 20.0)
    out = d * gain
    peak = float(np.max(np.abs(out))) or 1.0
    ceiling = 10 ** (ceiling_db / 20.0)
    if peak > ceiling:
        out *= ceiling / peak
    return out


# ---------- onset / tempo ----------

def onset_envelope(d: np.ndarray, sr: int, hop: int = 512) -> np.ndarray:
    """Spectral-flux novelty curve — the basis for both onset finding and tempo."""
    win = 2048
    frames = 1 + max(0, (len(d) - win) // hop)
    w = np.hanning(win)
    mags = np.abs(np.fft.rfft(
        np.stack([d[i * hop:i * hop + win] * w for i in range(frames)]), axis=1
    ))
    mags = np.log1p(mags * 100.0)
    flux = np.maximum(0.0, np.diff(mags, axis=0)).sum(axis=1)
    return flux / (flux.max() + 1e-9)


def first_onset(d: np.ndarray, sr: int, thresh: float = 0.02) -> int:
    """Sample index of the first real sound, backed off 15 ms so attacks stay intact."""
    idx = np.where(np.abs(d) > thresh)[0]
    if not len(idx):
        return 0
    return max(0, int(idx[0]) - int(0.015 * sr))


def beat_period(d: np.ndarray, sr: int, hop: int = 512) -> float:
    """Dominant inter-beat interval in seconds, via autocorrelation of the novelty curve."""
    env = onset_envelope(d, sr, hop)
    env = env - env.mean()
    ac = np.correlate(env, env, mode="full")[len(env) - 1:]
    lo, hi = int(0.3 * sr / hop), int(1.2 * sr / hop)  # 50-200 BPM
    hi = min(hi, len(ac) - 1)
    if hi <= lo:
        return 0.5
    return float((lo + int(np.argmax(ac[lo:hi]))) * hop / sr)


def _spectrum(x: np.ndarray) -> np.ndarray:
    """Phase-invariant timbre fingerprint of a window, mean-removed for cosine scoring."""
    s = np.log1p(np.abs(np.fft.rfft(x * np.hanning(len(x)))) * 100.0)
    return s - s.mean()


# ---------- the two shaping algorithms ----------

def trim_sting(d: np.ndarray, sr: int, lo: float = 3.0, hi: float = 6.0,
               fade: float = 0.35) -> np.ndarray:
    """Cut a fanfare down to its opening phrase.

    Starts at the first onset, then inside the lo..hi second window picks the quietest
    moment — the gap between phrases — so the cut lands where the music breathes rather
    than slicing a held note in half.
    """
    d = d[first_onset(d, sr):]
    if len(d) <= int(hi * sr):
        end = len(d)
    else:
        win = int(0.05 * sr)
        a, b = int(lo * sr), int(hi * sr)
        energy = np.array([
            np.sqrt(np.mean(d[i:i + win] ** 2)) for i in range(a, b, win)
        ])
        end = a + int(np.argmin(energy)) * win + win

    out = d[:end].copy()
    n = int(fade * sr)
    if len(out) > n:
        # Half-Hann: eases in smoothly and settles to true zero, so there is no
        # audible corner where the fade starts and no residue at the tail.
        out[-n:] *= 0.5 * (1 + np.cos(np.pi * np.linspace(0, 1, n)))
    return out


def make_loop(d: np.ndarray, sr: int, target: float = 30.0, skip: float = 12.0,
              xfade: float = 0.4) -> tuple[np.ndarray, dict]:
    """Extract a seamless loop.

    Skips the intro (Suno almost always builds for the first few bars), snaps the loop
    length to a whole number of bars so the groove stays in phase, then scans candidate
    start points for the one whose pre-roll best matches the loop's tail. Crossfading
    those two matched regions makes the wrap-around inaudible.
    """
    period = beat_period(d, sr)
    bar = period * 4
    bars = max(4, round(target / bar))
    loop_n = int(round(bars * bar * sr))
    xf = int(xfade * sr)

    start_min = int(skip * sr)
    if start_min + loop_n + xf >= len(d):
        start_min = max(xf, (len(d) - loop_n - xf) // 2)
    if start_min + loop_n + xf >= len(d):  # track too short to be picky
        loop_n = max(sr, len(d) - start_min - xf)

    # Score candidate starts a bar apart. The crossfade blends the xf-second region at
    # the loop start with the one just past the loop end, so those are the two windows
    # that have to match. Compare log-magnitude spectra, not raw samples: two musically
    # identical bars can be near-uncorrelated sample-wise purely from phase drift, which
    # would make a waveform metric pick essentially at random.
    best, best_score = start_min, -np.inf
    step = max(1, int(bar * sr))
    hi_bound = min(len(d) - loop_n - xf, start_min + int(bar * sr * 8) + 1)
    for s in range(start_min, max(start_min + 1, hi_bound), step):
        a, b = d[s:s + xf], d[s + loop_n:s + loop_n + xf]
        if len(a) != xf or len(b) != xf:
            continue
        sa, sb = _spectrum(a), _spectrum(b)
        denom = np.linalg.norm(sa) * np.linalg.norm(sb)
        score = float(np.dot(sa, sb) / denom) if denom else -np.inf
        if score > best_score:
            best, best_score = s, score

    s = best
    loop = d[s:s + loop_n].copy()
    tail = d[s + loop_n:s + loop_n + xf]
    if len(tail) == xf and len(loop) > xf:
        # Equal-power crossfade so the seam holds level instead of dipping.
        t = np.linspace(0, 1, xf)
        loop[:xf] = loop[:xf] * np.sqrt(t) + tail * np.sqrt(1 - t)

    return loop, {
        "bpm": round(60.0 / period, 1) if period else 0.0,
        "bars": bars,
        "start_s": round(s / sr, 2),
        "seam_match": round(best_score, 3),
        "len_s": round(len(loop) / sr, 2),
    }
