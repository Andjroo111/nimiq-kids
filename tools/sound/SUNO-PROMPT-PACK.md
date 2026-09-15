# nimiq.kids — Suno prompt pack

**You generate, I do everything else.** Trimming, seamless looping, normalizing, encoding,
manifest rows, service-worker precache, attribution file. Just download and drop.

---

## Settings — same for all 12

| Setting | Value | Why |
|---|---|---|
| Mode | **Custom** | You need the Style + Title fields |
| **Instrumental** | **ON** | Non-negotiable. Lyrics in a chore timer = unusable |
| Lyrics box | leave empty | Instrumental toggle handles it |
| **Title** | **paste the `id` exactly** | Suno names the download file after the title, so this saves us a renaming pass |
| Model | latest (v5) | |

Suno gives you 2 takes per generation. **Keep both** if you like them — I'll pick, or give you
an A/B. Pro is 2,500 credits/month and this whole pack is ~120, so don't be precious.

**Download to:** `~/Desktop/nimiq-kids-sounds/`
Two subfolders: `music/` and `alarms/`. That's the only organizing you have to do.

---

# PART 1 — During-timer beds (6)

These loop **under a kid doing a chore**, at volume 0.5, possibly 40 times a day. The enemy is
not "boring," it's "annoying on the twelfth listen." Steady, no builds, no drops, no big finish.
I'll cut a seamless loop out of the middle of whatever you generate.

Four are themed to the backgrounds a kid can already pick (meadow / ocean / space / city), so the
music matches the scene on screen. Two are neutral.

### 1. `sunny-day`
> Warm major-key instrumental at 96 BPM. Ukulele, glockenspiel, soft hand claps, brushed kick.
> Gentle steady groove that never builds. Playful and encouraging, like a children's picture-book
> soundtrack. No vocals, no risers, no drops, no big ending. Same energy start to finish.

*(This id matters — it's the database default, so it becomes the out-of-box music for every kid.)*

### 2. `cozy-focus`
> Calm instrumental at 82 BPM. Felt piano, soft marimba, warm upright bass, brushed snare.
> Cozy and unhurried, quiet background music for concentrating. Very low melodic density,
> repetitive and hypnotic. No vocals, no builds, no dynamic changes.

### 3. `meadow-stroll`
> Bright pastoral instrumental at 100 BPM. Acoustic guitar fingerpicking, tin whistle, light
> tambourine, soft woodblock. Sunny outdoor meadow feeling, gentle and skipping. Steady loop with
> no build. No vocals, no big ending.

### 4. `ocean-drift`
> Gentle aquatic instrumental at 88 BPM. Vibraphone, harp glissandi, soft synth pad, muted kick,
> shaker. Floating underwater feeling, dreamy and buoyant. Steady and repetitive, no builds,
> no drops. No vocals.

### 5. `star-hop`
> Playful retro-space instrumental at 104 BPM. Bubbly analog synth arpeggios, soft 8-bit blips,
> plucky bass, light electronic percussion. Curious and bouncy, exploring-the-galaxy feeling.
> Steady loop, no build, no drop. No vocals.

### 6. `city-skip`
> Upbeat instrumental at 108 BPM. Muted funk guitar, clavinet, walking bass, brushed drums,
> occasional handclap. Cheerful city-sidewalk strut, light and jaunty. Steady groove throughout,
> no build, no big finish. No vocals.

---

# PART 2 — End-of-timer fanfares (6)

The payoff. Fires the instant the countdown hits zero, right before the confetti and the egg
hatches. **I only need the first 3–6 seconds** — so what matters is that it lands hard in the
opening bar. Don't worry that Suno hands you a two-minute track; I'm cutting the front off it.

Prompt each as a *sting* so the hook is at the top instead of after an intro.

### 7. `chick-chirp`
> Short celebratory fanfare sting that starts immediately on the downbeat. Glockenspiel and
> pizzicato strings rising, tiny bird chirps, a soft pop, ending on a bright shimmer. Joyful
> "something just hatched" surprise. Opens on the hook with no intro.

*(Also a database default — this becomes the out-of-box end sound.)*

### 8. `big-fanfare`
> Triumphant brass fanfare sting, hits immediately on the downbeat. Bright trumpets, timpani roll,
> cymbal swell, ending on a big major chord. Classic victory fanfare, warm and not military.
> Opens on the hook, no intro.

### 9. `star-sparkle`
> Magical chime sting that starts instantly. Ascending celesta and bell run, harp glissando,
> sparkling shimmer tail. Enchanted, twinkly, wonder-struck. Opens on the hook, no intro.

### 10. `level-up`
> Retro video game level-up sting, starts immediately. Bright chiptune arpeggio climbing fast,
> punchy 8-bit bass, ending on a satisfying resolved chord. Nintendo-style reward jingle.
> Opens on the hook, no intro.

### 11. `marching-band`
> Playful marching band sting that hits on the downbeat. Snare roll, sousaphone oompah, piccolo
> trill, crash cymbal finish. Silly small-town parade energy. Opens on the hook, no intro.

### 12. `silly-honk`
> Comedy celebration sting, starts instantly. Slide whistle up, kazoo, bicycle horn honk, tuba
> blat, ending on a goofy xylophone run. Deliberately absurd and funny, cartoon slapstick.
> Opens on the hook, no intro.

---

## When you're done

Tell me and I'll take it from there. What I'll run:

1. Decode, trim each fanfare to its punchiest 3–6 seconds with a clean tail
2. Cut a seamless loop region out of each bed and crossfade the seam so it never clicks
3. Loudness-match everything so no sound is startlingly louder than the others
4. Encode small (AAC ~96k) — this ships to a tablet that runs offline
5. Write the manifest rows, add to service-worker precache, add the attribution file
6. Screenshot the Sounds sheet with all 12 populated so you can see it before it merges

## Not in this pack

- **Shout-outs** ("Great job!" / "You did it!") — those are voice, not music. Suno is the wrong
  tool. I'm generating those directly with OpenAI TTS, in all 5 app languages. No work for you.
- **Timer ticking** — the picker has a slot for it but nothing plays it, and a ticking clock is a
  stress cue for kids. Say the word if you want it and I'll build it, otherwise I'm leaving it.
