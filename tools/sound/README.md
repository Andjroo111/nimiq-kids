# Sound pack toolchain

Everything needed to generate, shape and ship the kid app's audio: during-timer music,
end-of-timer fanfares, and spoken shout-outs.

Nothing here runs at app runtime. It produces files that land in `public/assets/sounds/`
plus rows for `public/assets/manifest.json`.

---

## Requirements

- **macOS.** `afconvert` does all codec work (decode mp3/m4a → WAV, encode AAC). There is no
  ffmpeg dependency and none is wanted — `afconvert` ships with the OS.
- **Python 3.9+** with `numpy` + `scipy`. (Written against 3.9.6; avoid `X | Y` annotations
  unless the file imports `from __future__ import annotations`.)
- **Bun**, only for the review server.

Generated output (`voice/`, `deepgram/`, `elevenlabs/`, `site/`, `work/`, `processed/`) is
gitignored on purpose. Samples are review artifacts, not assets — regenerate, don't commit.

---

## The three sound slots

The app was already wired for all of this before any file existed. `openSoundsSheet()` in
`public/kid/js/studio.js` renders three sections straight off `state.catalog`:

| Slot | Catalog key | Pref column | Plays where |
|---|---|---|---|
| During-timer music | `music` | `music_id` | `startMusic()`, loops at volume 0.5 |
| Timer tick | `timerSounds` | `timer_sound_id` | **nowhere — no implementation exists** |
| End-of-timer | `alarms` | `alarm_sound_id` | `playAlarm()` at `flow.js` `finishTask()` |

`playAlarm()` already prefers a file URL and only falls back to its WebAudio oscillator
arpeggio when the catalog is empty. **So music and fanfares need zero new playback code** —
just files plus manifest rows.

Shout-outs have **no slot yet**; that's new code (see the handoff doc).

### Two traps

- Manifest rows for sound must use **`title`**, not `label`. `studio.js` reads `e.title ?? e.id`,
  so a row with only `label` renders the raw id. (Animals and backgrounds use `label` — that's
  the trap.)
- `schema.sql` `kid_prefs` defaults point at ids that never existed: **`sunny-day`**,
  `soft-tick`, **`chick-chirp`**. Naming assets to match makes the DB defaults light up for free.

---

## Provider status

| Provider | Key | Verdict |
|---|---|---|
| **Suno** (music) | web UI only | Andjroo is on **Pro** → commercial rights. No official API; hand-generate. |
| **OpenAI** `gpt-4o-mini-tts` | `OPENAI_API_KEY` ✅ | **Rejected by Andjroo** — assistant voices. |
| **Deepgram** `aura-2` | `DEEPGRAM_API_KEY` ✅ | Accents but voice-agent stock, no emotion steering. Unjudged. |
| **ElevenLabs** | ⚠️ **expired** | The intended fix. Only library with child + character voices. |

The ElevenLabs key in `~/gdkc/projects/competitor-intel/.env` returns `401 invalid_api_key`
(file dated Feb 21). Use the laptop's key.

**Suno licensing, non-obvious and expensive to get wrong:** rights attach only to songs generated
*while* on a paid plan, and upgrading later does **not** retroactively license anything made on
Free. Never let a track for this app be generated on a free account.

---

## Workflows

### Music (Suno → app)

1. Generate the 12 prompts in `SUNO-PROMPT-PACK.md` in the Suno web UI.
   **Instrumental ON. Paste the asset id into the Title field** — Suno names the download after
   the title, which skips a renaming pass.
2. Download into `~/Desktop/nimiq-kids-sounds/music/` and `.../alarms/`.
3. `python3 intake.py` — decodes, shapes, loudness-matches, encodes, and writes
   `manifest-fragment.json` plus a review page.

`intake.py` handles Suno's duplicate `name (1).mp3` downloads as `take2` automatically.

### Voice

```bash
python3 gen-elevenlabs.py --probe                        # verify key, self-check API shape
python3 gen-elevenlabs.py --search --accent irish --age young
python3 gen-elevenlabs.py --generate <id>:buddy <id>:pip
```

`gen-voice.py` (OpenAI) and `gen-deepgram.py` are kept for comparison and produce the same
12 lines in the same layout, so packs are directly A/B-able.

### Review

```bash
python3 build-site.py && bun run server.ts      # http://localhost:3961/sounds/
```

Served over the existing `kids-dev` named tunnel via a path rule at
`https://kids-dev.internal/sounds/` — no new DNS needed.

**The server implements HTTP byte-range (206) deliberately: iOS Safari will not play audio from
an origin that answers a Range request with a plain 200.** The page loads fine and every tap
silently does nothing. Do not "simplify" that away.

Review pages reference real files rather than data URIs, for the same reason — inlined base64
audio failed to play in Andjroo's viewer.

---

## The DSP

`audio.py`, covered by `test_audio.py` (17 checks against synthesized tracks with known BPM):

- **`trim_sting`** — cuts a fanfare to its opening phrase. Finds the first onset, then picks the
  quietest moment inside a 3–6s window so the cut lands *between* phrases instead of slicing a
  held note. Half-Hann fade (reaches true zero, no corner at the fade-in).
- **`make_loop`** — skips the intro build, snaps loop length to whole bars via onset-autocorrelation
  tempo, and equal-power crossfades the seam.
- **Loudness is ITU-R BS.1770 K-weighted, not peak** — targets −20 LUFS beds / −14 fanfares /
  −16 voice, so a brass hit and a spoken line actually sound equally loud.

**Bug worth not reintroducing:** the loop seam scorer originally compared raw waveform samples and
scored a perfect musical match at **−0.17** — two musically identical bars are near-uncorrelated
sample-wise from phase drift alone, so it picked start points at random. It now compares
log-magnitude spectra (phase-invariant); the same fixture scores **1.0**. It was also scoring the
windows *before* each candidate while the crossfade blends the ones *after*.

Run `python3 test_audio.py` after touching any of it.
