#!/usr/bin/env python3
"""Generate the egg timer's sound catalogue: end stings, during-timer beds, reminders.

Fills the three lists that have been named and silent since the sounds sheet was built:

  ENDING    none / chime / fanfare / bell / cheer / pop     -- one-shots, ElevenLabs SFX
  DURING    none / lullaby / bouncy / floaty / ticking      -- loops, ElevenLabs SFX
  REMINDER  12 spoken phrases                               -- ElevenLabs TTS, the cast

⚠️ THE CAST IS ALREADY PICKED. DO NOT RE-AUDITION IT. Eva, Ziggy, Teddy and Tilly came
out of a 133-voice sweep of the library (video-studio/scripts/gen-count-kids.mjs) filtered
for voices that read as an actual CHILD rather than a young adult or a cartoon animal --
animal characters were skipped on purpose because "they land as a mascot, and this has to
land as somebody's kid". They are the same four who count down in the film and in the app,
so a reminder in any other voice is a stranger arriving at the end of the run.

⚠️ LEVELS ARE BAKED AT ENCODE TIME, NOT SET IN THE PLAYER. HTMLMediaElement.volume is
read-only on iOS, and iOS is the family tablet. See the SFX block in timer index.html.

  export ELEVENLABS_API_KEY=$(op read "op://<vault>/<item>/credential")
  python3 gen-timer-sounds.py --what ending,during,reminders
  python3 gen-timer-sounds.py --what ending --only chime      # re-roll one
  python3 gen-timer-sounds.py --estimate                      # cost, generates nothing

Output lands in `out/` (gitignored). Shipping is a separate, deliberate copy step --
review first, because a sound nobody has heard is a sound nobody has approved.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.elevenlabs.io/v1"
OUT = Path(__file__).parent / "out"

# The four children, by library id. Same cast as the film's count and cheer.
CAST = {
    "eva": ("Xn6GqAFT1vo7SexgOVmn", "Eva"),
    "ziggy": ("J1lfByWs8gvoooryDWEi", "Ziggy"),
    "teddy": ("XjGYkUkzth8BPs29fmcV", "Teddy Twinkle"),
    "tilly": ("MkTSSXNgnBULS6ek4pon", "Tilly"),
}

# ---- ENDING: the sting when the clock runs out -------------------------------------
# `cheer` is deliberately absent: it is already the film's real recording of the same
# four children, shipped as sfx/cheer.mp3, and a synthesised second one would be a
# different set of kids arriving a frame after the first.
ENDING = {
    "chime": ("a single soft warm glockenspiel chime, gentle bell-like ring with a long "
              "clean decay, no reverb tail, children's app UI sound", 2.0),
    "fanfare": ("a short bright cheerful toy trumpet fanfare, four ascending notes ending "
                "on a happy resolved chord, playful and celebratory, children's app", 2.5),
    "bell": ("a small hand bell rung once, bright metallic ding with a clean short decay, "
             "friendly not shrill, children's app UI sound", 1.5),
    "pop": ("a single soft cartoon bubble pop, rounded and low, satisfying, no click, "
            "children's app UI sound", 1.0),
}

# ---- DURING: the bed that plays while the egg counts down ---------------------------
# ⚠️ lullaby, bounce and space are NOT these files any more (2026-09-17), and cozy, ocean, robot,
# dragon (beds) plus rocket, roar (stings) were never here at all (Suno, 2026-09-18). Andjroo A/B'd the
# ElevenLabs beds against Suno takes and picked Suno for those three: v6, Custom, no lyrics,
# 1:10 masters, then audio.make_loop (whole bars, spectral seam match, 0.4s equal-power
# crossfade) to a ~30s loop, normalised to -25 LUFS (what these files measured after the
# 0.35 bake, so the kid hears the same level) and lame -V2 mono. Re-running this script
# for those three would overwrite a chosen bed with the losing one. `clock` stayed.
# ⚠️ `clock` is in the list because the sheet lists it, NOT because it is recommended.
# tools/sound/README.md: a ticking clock is a stress cue for children. Selectable, never
# the default. Keep it soft and slow if it is regenerated.
DURING = {
    "lullaby": ("a gentle slow music box lullaby, soft mallet notes, calm and warm, "
                "seamless loop, no percussion, nursery", 10.0),
    "bounce": ("a light bouncy playful ukulele and marimba tune, cheerful mid tempo, "
               "seamless loop, children's game background music", 10.0),
    "space": ("soft floating dreamy ambient pad with slow gentle bell tones, calm and "
              "weightless, seamless loop, no beat", 10.0),
    "clock": ("a soft slow gentle clock tick tock, muted wooden ticks, quiet and even, "
              "not loud or sharp, seamless loop", 8.0),
}

# ---- REMINDER: what the timer says the child should do next --------------------------
# Keys are the ids already in REMINDERS in timer index.html. `youdidit` is new -- Andjroo
# named it when he listed the green button's contents ("there's a good job, you did it,
# hooray"), and it was the one that had no tile.
# The bracket tags are ElevenLabs audio tags; they steer delivery, they are not spoken.
REMINDERS = {
    "goodjob": "[cheerful] Good job!",
    "youdidit": "[excited] You did it!",
    "hooray": "[cheering] Hooray!",
    "love": "[warmly] Love you!",
    "shoes": "[bright] Shoes on!",
    "socks": "[bright] Time to get dressed!",
    "bath": "[playful] Bath time!",
    "bed": "[gentle] Bedtime!",
    "tidy": "[bright] Time to clean up!",
    "teeth": "[playful] Time to brush your teeth!",
    "eat": "[excited] Time to eat!",
    "screenoff": "[gentle] Screens off!",
}

# Baked playback levels, applied by lame --scale at encode time. Beds sit well under the
# voices because they play UNDER a running timer; stings and reminders are foreground.
# ⚠️ A SCALE IS NOT A LEVEL. These multiply whatever ElevenLabs happened to return, and
# measured on 2026-09-17 the shipped results were 31 dB apart: end-chime (the default)
# sat at -39 LUFS, end-fanfare at -8, bed-clock at -46. All three were "no sound" or
# "too loud" bugs that nothing in this file could see. The shipped files were re-levelled
# by measurement instead (stings -17 LUFS with a -1 dBFS peak cap, clock -27.8, the
# most its transients allow); anything regenerated here has to be measured the same way
# (ffmpeg ebur128) before it ships, not scaled.
LEVEL = {"ending": 0.85, "during": 0.35, "reminders": 0.9}


def key() -> str:
    k = os.environ.get("ELEVENLABS_API_KEY")
    if not k:
        sys.exit("ELEVENLABS_API_KEY not set.\n"
                 '  export ELEVENLABS_API_KEY=$(op read '
                 '"op://<vault>/<item>/credential")')
    return k


def post(path: str, body: dict, k: str) -> bytes:
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode(),
        headers={"xi-api-key": k, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:400]
        # ⚠️ The key is IP-allowlisted to the house address, which is DHCP. When the lease
        # rotates every call fails looking exactly like a bad key, so say so here rather
        # than let the next person go hunting through 1Password.
        hint = ("\n  -> 401/403 can be the IP allowlist, not the key: it is pinned to the "
                "home address\n     and Google Fiber hands that out on a lease. Check the "
                "current IP before the key." if e.code in (401, 403) else "")
        raise SystemExit(f"FAIL {e.code} on {path}: {detail}{hint}")


def balance(k: str) -> tuple:
    req = urllib.request.Request(f"{API}/user/subscription", headers={"xi-api-key": k})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    return d.get("character_count", 0), d.get("character_limit", 0)


def encode(src: Path, dst: Path, scale: float) -> None:
    """MP3 at a baked level. lame, because afconvert cannot write MP3 and MP3 is the one
    format the Playwright harness can decode -- see the timer's SFX comment."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["lame", "--quiet", "-V2", "--noreplaygain", "--scale", str(scale),
                    str(src), str(dst)], check=True)


def gen_sfx(name: str, prompt: str, secs: float, loop: bool, k: str, group: str) -> Path:
    raw = OUT / group / "raw" / f"{name}.mp3"
    raw.parent.mkdir(parents=True, exist_ok=True)
    body = {"text": prompt, "duration_seconds": secs, "prompt_influence": 0.45}
    if loop:
        body["loop"] = True
    raw.write_bytes(post("/sound-generation", body, k))
    out = OUT / group / f"{name}.mp3"
    encode(raw, out, LEVEL[group])
    return out


def trim_silence(src: Path, dst_wav: Path, head_ms: int = 30, tail_ms: int = 140) -> None:
    """Cut ElevenLabs' leading and trailing silence off a spoken line.

    ⚠️ THE PADDING IS WHY THIS EXISTS. "Good job!" came back at 1.9-2.5s for two spoken
    words -- the rest is silence the model adds at both ends. Inaudible on its own and
    wrong in place: the reminder fires after the cheer, so a second of dead air reads as
    the timer having finished and then thought of something.

    ⚠️ STDLIB ONLY, DELIBERATELY. audio.py would do this more elegantly but it needs
    numpy and scipy, and neither is installed on the laptop -- so importing it would make
    generating a sound depend on a toolchain nobody has set up. `wave` + `array` is the
    same choice video-studio's mix-kid-recordings.py made, for the same reason.

    The threshold is relative to each clip's OWN peak, because the four voices come back
    at noticeably different levels and one absolute number would over-trim the quiet ones.
    """
    import array
    import wave
    tmp = dst_wav.with_suffix(".decoded.wav")
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@44100", "-c", "1",
                    str(src), str(tmp)], check=True, capture_output=True)
    with wave.open(str(tmp), "rb") as w:
        sr, n = w.getframerate(), w.getnframes()
        d = array.array("h")
        d.frombytes(w.readframes(n))
    tmp.unlink(missing_ok=True)

    peak = max((abs(x) for x in d), default=0)
    if peak > 0:
        gate = peak * 0.02
        first = next((i for i, x in enumerate(d) if abs(x) > gate), 0)
        last = next((i for i in range(len(d) - 1, -1, -1) if abs(d[i]) > gate), len(d) - 1)
        a = max(0, first - sr * head_ms // 1000)
        b = min(len(d), last + sr * tail_ms // 1000)
        d = d[a:b]

    with wave.open(str(dst_wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(d.tobytes())


def gen_voice(rid: str, text: str, who: str, vid: str, k: str) -> Path:
    raw = OUT / "reminders" / "raw" / f"{rid}-{who}.mp3"
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_bytes(post(f"/text-to-speech/{vid}",
                         {"text": text, "model_id": "eleven_v3"}, k))
    # ⚠️ eleven_v3, NOT multilingual_v2. v2 reads the bracket tag as a word ("Cheerful. Good
    # job", verified by scribe_v1 on the shipped file, 2026-09-18); v3 treats it as delivery.
    # Also transcribe every take back and reject it if the tag word is in the text, and cut
    # the tail after the last voiced sample with a fade: v3 ends its mp3 mid-decay = a click.
    trimmed = OUT / "reminders" / "raw" / f"{rid}-{who}.trim.wav"
    trim_silence(raw, trimmed)
    out = OUT / "reminders" / f"{rid}-{who}.mp3"
    encode(trimmed, out, LEVEL["reminders"])
    trimmed.unlink(missing_ok=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--what", default="ending,during,reminders")
    ap.add_argument("--only", help="comma-separated ids within the chosen groups")
    ap.add_argument("--voices", help="comma-separated cast keys (default: all four)")
    ap.add_argument("--estimate", action="store_true", help="cost only, generate nothing")
    a = ap.parse_args()

    want = {w.strip() for w in a.what.split(",") if w.strip()}
    only = {o.strip() for o in a.only.split(",")} if a.only else None
    cast = {c.strip(): CAST[c.strip()] for c in a.voices.split(",")} if a.voices else CAST

    if a.estimate:
        n_sfx = sum(len([x for x in d if not only or x in only])
                    for g, d in (("ending", ENDING), ("during", DURING)) if g in want)
        chars = 0
        if "reminders" in want:
            for rid, text in REMINDERS.items():
                if only and rid not in only:
                    continue
                chars += len(text) * len(cast)
        print(f"  sound effects: {n_sfx} generations")
        print(f"  speech:        {chars} characters ({len(cast)} voices)")
        return 0

    k = key()
    before, limit = balance(k)
    print(f"  balance before: {before}/{limit}\n")

    made = []
    for group, table, loop in (("ending", ENDING, False), ("during", DURING, True)):
        if group not in want:
            continue
        for name, (prompt, secs) in table.items():
            if only and name not in only:
                continue
            p = gen_sfx(name, prompt, secs, loop, k, group)
            made.append(p)
            print(f"  {group}/{name:<10} {p.stat().st_size:>7} bytes")

    if "reminders" in want:
        for rid, text in REMINDERS.items():
            if only and rid not in only:
                continue
            for who, (vid, label) in cast.items():
                p = gen_voice(rid, text, who, vid, k)
                made.append(p)
                print(f"  reminders/{rid}-{who:<8} {p.stat().st_size:>7} bytes")

    after, _ = balance(k)
    print(f"\n  {len(made)} files -> {OUT}")
    print(f"  balance after:  {after}/{limit}  (spent {after - before})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
