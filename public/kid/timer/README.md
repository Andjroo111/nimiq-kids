# The egg timer — where this came from and what is left

The timer Andjroo signed off over several sessions in `~/gdkc/data/anim-demo`, which
**has a remote now** — private `Andjroo111/nimiq-kids-egg-rig`. Push there after any
authoring session: the copy in this directory is the shipped artefact, not a backup of
the tooling that produced it.

Plan for the whole job: `~/.claude/plans/logical-sauteeing-whistle.md`.
The account of every decision inside the rig: `~/gdkc/data/anim-demo/HANDOFF.md` — read
§0 (there are several) before changing anything in `wiggle.html`. What the load does and
why: `~/gdkc/data/anim-demo/NEXT-SESSION-SPEED.md`.

## Status, 2026-08-01

**Shipped and live on both Mini instances.** The Timer dock button opens the real timer
(set → run → hatch → back), and v0.59.0 (PR #45) fixed its boot: no unstyled flash, one
arrival instead of three, and the dial's selection band centred on the time.

⚠️ **THIS DIRECTORY IS THE SOURCE NOW, NOT A VENDORED COPY (flipped 2026-09-18).** From
2026-08-01 to 2026-09-15 the timer was authored in `~/gdkc/data/anim-demo` and copied here
with a name scrub. Since PR #487 every change (#487 #500 #502 #504 #505 #506) has been made
HERE, and anim-demo fell six PRs behind without anyone noticing. On 2026-09-18 `index.html`,
`wiggle.html` and the four `rive-kit/` files this app added were copied BACK into anim-demo
(commit `5cd5c39` on `art/unicorn-themes`), and that repo's HANDOFF.md now says it is the
archive. **Never copy from anim-demo into this directory again**: its `individual-pngs/` and
`sfx/` are a different generation, and its html would revert whatever landed here since.
Edit here, commit here, and `nq lint` the served URL. If a change is worth keeping in the
archive, the copy runs the other way:
```bash
cd ~/gdkc/data/anim-demo
sed 's/Andjroo/<first name>/g' <this worktree>/public/kid/timer/index.html  > timer.html
sed 's/Andjroo/<first name>/g' <this worktree>/public/kid/timer/wiggle.html > wiggle.html
```
(`Andjroo` is the public spelling; anim-demo is private and carries the first name, which
this tree must never contain, PR #498.)

⚠️ **`index.html`'s `const BUILD='…'` LINE IS AN INTERFACE.** `src/timer-build.ts` scans
this file for it with a regex to mint the token every asset under `/kid/timer/` is stamped
and cached against. No spaces round the equals, single quotes, and it must be the FIRST
such declaration in the file — the scan takes the first match, *including one inside a
comment*. Get it wrong and the token becomes `undefined-<mtime>`: still unique, so nothing
looks broken, and the stamp quietly stops naming a build.

It is excluded from CI's 800-line file-size guard for exactly this reason (see
`.github/workflows/ci.yml`). ⚠️ A NATIVE port into `public/kid/js` is first-party and
must NOT inherit that exclusion.

### The proofs (run them; do not rebuild them)
```bash
tools/eggtimer-flow.py [width]      # the REAL app: dock -> timer -> Start -> hatch -> back
tools/eggtimer-noflash.py <url>     # the tuning page must never paint when embedded
tools/eggtimer-rawdom.py <url>      # the set screen must never be SEEN unsized
tools/eggtimer-hatchproof.py <url> [kbps]   # Start on the arrival frame still hatches
tools/eggtimer-whole.py <url> [kbps,...]    # when background AND egg are both really there
tools/eggtimer-sheetproof.py chromium [w]
tools/eggtimer-photoproof.py / -heroroll.py / -crackroll.py / -soundproof.py
```

⚠️ **NEVER TAKE A CACHING NUMBER OFF :3950.** That instance is HTTPS with a self-signed
mkcert cert, and Chromium refuses its HTTP cache over a cert error. Same code, same
`immutable` headers: a second open measures 0.35s / 0.51MB there and **0.03s / 0.26MB on
:3960 over plain http**. Use :3960, or the tunnel. This looks exactly like a caching
regression and is not one.

⚠️ Two more that flatter a before/after: Playwright **contexts share the browser's HTTP
cache** (under `immutable`, whichever URL is shot second loads warm), and a **screenshot of
a throttled page costs hundreds of ms which accumulates** (a filmstrip shot in one pass
carries times it was not taken at). One cold browser per frame.
Dev server used this session: `PORT=3986 DB_PATH=ui-dev.db MEDIA_DIR=/tmp/eggtimer-media
NIMIQ_SIM=1 bun run src/server.ts`, seeded with `DB_PATH=ui-dev.db bun run
src/scripts/seed.ts`, browser paired by inserting a `devices` row whose `token_hash` is
sha-256 of `eggtimer-dev-token-1` and setting `localStorage['kid.deviceToken']` to it.
⚠️ Restart the server if you delete the DB out from under it — SQLite keeps the old vnode
and every request 500s with `SQLITE_IOERR_VNODE`.

## What is DONE and verified in this branch

**The rig is here and it runs under this app.** `wiggle.html?embed=1` strips itself to
the egg on a transparent stage and exposes `window.RIG`; it is ~3000 lines of canvas that
owns the locked faces, the locked break, the drawn outline and the character landing.
It crossed over intact rather than being re-implemented.

Verified against `http://localhost:3986/kid/timer/wiggle.html?embed=1` by rendered
content, not by status code: build `wig-b0840a`, 21 heroes, 5 crack patterns,
`geom()` reporting the drawn curve (353.22 x 417.4), the stage canvas actually carrying
ink, **console clean and no failed requests**.

⚠️ **ASSET PATHS ARE RELATIVE, AND MUST STAY THAT WAY.** Every path in `wiggle.html` used
to be root-absolute. This app serves the rig from `/kid/timer/`, where `/faces.json`
resolves against the app's root and nothing is there. Relative URLs resolve against the
document, so the SAME file works at `/` in anim-demo and at `/kid/timer/` here — as long
as both keep the same layout under their own base. A leading slash silently works in
exactly one of the two hosts, and it is never the one you are looking at.
(anim-demo commit `d34d0a9`; proved a no-op there with `timershot`, `crackroll` and
`breakproof` — 0.00% on all five patterns.)

⚠️ **`?v=` survives `serve-cache.ts`.** That middleware rewrites `?v=…` in any HTML
response, and this file contains the literal `'?v='+BUILD` in JS strings. Checked: the
regex needs a word character after `=` and finds a quote, so it does not match. If the
regex is ever loosened, this breaks quietly.

⚠️ **The art is NOT in the service worker's `SHELL`** (`public/sw.js`) and must not be
added to it — that array is precached on install and this is 5.9MB. Runtime cache only.

## What is NOT done

`_eggtimer-port/` holds the chrome mid-port: `timer.html`'s stylesheet, markup and module
with every id and class namespaced `eg-` (done mechanically, so nothing was lost in
transcription — colour literals verified intact). `css/eggtimer.css` is the stylesheet.
**None of it is wired up yet and nothing imports it.**

⚠️ **Andjroo has DECIDED the sheets question** (2026-07-31): our sheets win and **PR #94
R3 is reversed** — the app's `sheetHead` should move to the nimiq-ui ruling (close top
RIGHT as the circled X, labels under tiles) so there is ONE sheet style, not two. That is
part of step 6.

To finish, in this order:

1. **Wrap `chrome.js` as a screen module** — `showEggTimer(onBack)` rendering through the
   app's `setScreen(html, "eg " + phase)`. `body.set/.run/.hatch` in the CSS become the
   phase class on the screen root. Drop the `#eg-dev` review strip; it is a tuning-page
   control.
2. **Point the iframe at `/kid/timer/wiggle.html?embed=1`** and the confetti import at
   `/kid/timer/confetti.js` (byte-identical to the approved rig).
3. **Backgrounds come from the app**, not from `/bg/*.jpg`. `bgFor("timer")`
   (`util.js:325`) already exists and the timer already has its own
   `timer_background_id` pref, deliberately falling back to the app's.
4. **Persistence moves off `localStorage`.** `kid_prefs` already carries
   `background_id`, `music_id`, `timer_sound_id`, `alarm_sound_id`, `hatch_mode`,
   `hatch_asset_id` (`src/repo-media.ts:46`). The one genuinely new thing is the
   character SET — the kid ticks several and `hatch_asset_id` is one id. Add
   `hatch_pick_ids TEXT` (JSON array) with the `addColumn` idiom at `src/db.ts:56`,
   extend the `savePrefs` patch type, and add a round-trip test beside
   `src/prefs.test.ts`.
5. **i18n**: every visible string needs an `app.*` key across **5 locales**
   (`src/locales/*.ts`) — Set Timer, Min, Sec, Start, Done, Coming soon, the four sheet
   titles and subtitles, the tray and camera aria-labels. The toast should use the app's
   own `toast()` (`util.js:253`), not the one the port carries.
6. **Replace `openTimerMenu()`** (`studio.js:95`) and point `dock-timer`
   (`chart.js:372`) at the new screen. The three glyphs survive as the timer's own
   bottom tray, which is where the built version already puts them.

Then PR B: `flow.js` drives rigs through `{ setProgress, hatch, reset, wobble, destroy }`
and owns a server-backed, resumable countdown. The rig owns its own clock instead, so it
needs an external-progress entry (`crackJumpTo(elapsed())` is the hook; the jolts are
real-time and keyed to clock beats, which is the part to watch). See the plan.

## Two decisions Andjroo still owns

1. **These sheets reverse PR #94 R3.** That round stripped every word out of the app's
   sheets (*"There shouldn't be any words, it should just be symbols"*); the sheets he
   signed off on 2026-07-31 carry a label under every tile, and the close button moved to
   the top RIGHT per the nimiq-ui ruling while the app's `sheetHead` puts it LEFT. This
   branch does NOT change the app-wide `sheetHead` — only the timer's own sheets — so
   two styles coexist until he says which wins.
2. **Crack pattern 2 is in the pool at 1 run in 5** and is the documented weak landing:
   its crack bites the top rather than splitting the egg, so it lands as a shard and a
   wedge. `CRACK_PATTERNS` in the chrome is the one place to drop it.
