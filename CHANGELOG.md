# Changelog

All notable changes to nimiq.kids will be documented here.

## [0.120.4] - 2026-09-15
### Changed
- One icon system on the kid app: every UI glyph is drawn on a 24 grid, renders its stroke at
  one CSS width (`--icon-stroke`, non-scaling) whatever its box, and takes one of four size
  steps (`--ic-s/m/l/xl`). The dock's six PNG masks are SVGs in that system now, the month row
  wears the same calendar as the My week button, the row chevrons are one chevron, the
  savings row draws a target instead of an emoji, and the money screen's empty feed shows the
  hexagon instead of the egg. Measured before on Leo's tablet: six sources, strokes 1.5px to
  5px, boxes 11px to 84px. Andjroo, 2026-09-15: "we need to have a universal for our icons."
- The first row on the Games screen is "Games", not "Play", in all five languages.
### Fixed
- Finger scrolling on the Games screen (and any inner list that fit its screen): the rows had
  grown past the screen and `overscroll-behavior: contain` on a list with nothing to scroll ate
  every swipe that started inside it. Containment lives on the screen root and the sheet now,
  every inner list chains up to it, and `.games` got the `min-height: 0` it was missing.
- The dock keeps the badge's own lane above a bigger glyph (76px in landscape, 68 elsewhere).

## [0.120.3] - 2026-09-15
### Changed
- Marketing site: the Live now card is six facts and the thesis line instead of a 127-word paragraph; the four roadmap chips lose their run-ups and restatements, every fact kept.

## [0.120.2] - 2026-09-15
### Removed
- Every piece of generated art is out of the tree while the backgrounds, characters and icons
  are redrawn: the 60 stickers, the 21 heroes and their 46 timer cut-outs, the 11 wallpapers and
  the timer's 4 scenes, the 12 switch-gate pictures, the 45 chore icons, the 5 Treasure Box
  faces, the portal dinosaur and the 37MB of contact sheets (215 files, 52MB). The mechanics all
  stay and each draws its no-art face: a sticker its emoji, a chore its emoji, the wallpaper
  picker its four gradient tiles, the egg hatches empty (a kid's own photo still hatches), the
  switch gate its emoji at the same twelve indexes so no enrolled kid is locked out. Every art
  seam is one `*_ART_SHIPPED` flag (`sticker-catalog.ts`, `task-icons.ts`, `kid-switch.ts`,
  `store-art.ts`) and the on-disk gates skip on it, so the new set lands by dropping files in
  and flipping four booleans.

## [0.120.1] - 2026-09-14
### Added
- The demo family wakes up with one goal ladder on Sam, "Ride the bike", four rungs, fresh
  (#demo-ladder). The climb path was the one kid screen a judge could not reach without a parent
  building a ladder first. Fresh rather than half-climbed because a climbed rung is money moved and
  the demo's history is real: tap rung one, say yes in the parent app, and the payout lands the way
  a chore's does. Title and rungs carry catalogue keys in all five languages.

## [0.120.0] - 2026-09-14
### Changed
- A goal opens as its own screen, the Duolingo climb path, instead of a bottom sheet of rows
  (#goal-climb-path). The set the ladder collects sits above a banner that sticks while the column
  scrolls; the prize is under the banner; rung one is at the bottom, because you go up. Every
  node is the Nimiq hexagon: grey with its number until it is the kid's turn, blue with the egg
  plate's tunnel and a bubble naming the rung when it is, blue with a grey groove while a grown-up
  has it, green with a check once it is climbed, a gift on the prize. No sticker, emoji or
  character rides the path: that art is being redrawn, and the node is the frame it will go in.
  The screen opens scrolled to the rung that matters.
  Nothing about the money moved: the open rung still calls `claimRung`, the parent still says yes.
- The components are the nq registry's `duo-button`, `duo-node` and `duo-path`, vendored under
  `public/kid/vendor/duo` on the default Nimiq map, and precached with the shell.
### Removed
- `public/kid/js/goal.js`, the goal sheet, and its rung rows in `done.css`.

## [0.119.0] - 2026-09-11
### Added
- The kid tablet works with no network at all (#kid-offline). It is three layers, and they only
  mean anything together: `public/sw.js` is registered again, from the KID entry point at scope
  `/kid/`, so the shell is on the device; `public/kid/js/snapshot.js` writes the board, the
  wallet, the roster and the rate down per child so there is something to draw; and
  `public/kid/js/outbox.js` queues a "yes, it's done" tap and sends it on reconnect. Verified on
  Leo's tablet with the server unreachable: the board renders today's jobs, the money screen
  shows the real balance, and a tap made offline reached the parent's approval queue on its own
  with the screen still off.
- Every screen that draws from a snapshot says when it was read. The board carries "No internet.
  This is your board from 09:45", the money card carries "Checked at 09:45", and the outbox says
  where a saved answer went.
### Fixed
- Nothing had registered the service worker since `public/js/app.js` was deleted on 2026-08-01,
  so a tablet with no Wi-Fi showed `ERR_ADDRESS_UNREACHABLE`.
- The precache barely matched anything it held. `src/serve-cache.ts` stamps every asset URL with
  the boot stamp while SHELL listed bare paths, and a Cache API match is by full URL including
  the query, so `/kid/js/main.js?v=<stamp>` missed the precached `/kid/js/main.js`. Lookups now
  fall back to `ignoreSearch`, and an offline navigation falls back to `/kid/` rather than to the
  portal chooser.
- The precache had holes that were visible on the tablet: nine of the kid app's stylesheets,
  twenty of its modules, the shared i18n shell bundle, twenty-nine of the forty-five job icons
  (so "Feed the dog" drew a broken-image glyph), thirty of the sixty stickers, and three of the
  seven dock glyphs. `src/sw-shell.test.ts` now fails when a new file in any of those
  directories lands without an entry.
- The money screen could still render a balance of zero for a wallet it had simply failed to
  read: the guard was `state.walletError && !state.wallet`, and a failure that never set
  `walletError` walked past it into a zero-filled default. It is `!state.wallet` now, and the
  zero-filled default is gone. `fmtFiat` returns nothing rather than `$0.00` when no rate has
  ever been read, which is what put "$0.00" beside a real 109 834 NIM on the first offline boot.
- Tapping a job with no network did nothing at all: the POST threw, `.catch(() => ({}))` turned
  it into an empty object, and the board repainted unchanged. The same catch is the queue now.
- `selectChild` awaited `api.prefs()` and `api.catalog()` uncaught, so an offline tablet threw
  out of login the moment a kid tapped their own face and painted nothing.
- A tap on a job waiting for a grown-up called `loadEntry`, a live GET, from inside an onclick
  with nothing catching it.
- A deploy no longer costs the tablet a 12MB re-download. Art lives in an unstamped cache that
  `activate` does not purge, because `src/serve-cache.ts` renames the code cache on every server
  boot and eleven of those twelve megabytes are pictures a code deploy never touches.
### Known limit
- Routine task runs are created server-side by the chart read itself (`src/routes/stickers.ts`
  calls `todayRun`), so a tablet offline across midnight has no runs for the new day. Andjroo's
  call, 2026-09-11: say so on the board rather than pre-fetch days of runs, which would change
  when a run exists for the lock machine, `reconcileRun` and the approval queue. Chores, lessons,
  practices and goals are not per-day and are unaffected.

## [0.118.11] - 2026-09-10
### Fixed
- The Games title no longer sits on the first row heading. The gap was on the screen wrapper,
  which holds one child, so the two white pills stacked edge to edge; it lives on the slab now.

## [0.118.10] - 2026-09-10
### Changed
- One heading scale across the kid app. Page titles are 38 / 800 on a white pill and section
  headings 22 / 900 on the same pill, from two tokens with a single tablet bump, instead of
  three sizes each that every screen set for itself. The games screen is called Games now,
  the word its own dock button uses, in a pill like every other title rather than small text
  on the chrome line.

## [0.118.9] - 2026-09-10
### Changed
- Money, the Treasure Box, Games and Grow join the board on the slab. Each screen's cards sit
  on one surface, two rungs quieter, with the back button and the games header left floating
  above it. The games screen's full-bleed white wash steps back from 0.55 to 0.22, because the
  slab is the surface that wash was standing in for. Sheets, the camera and the egg timer stay
  off it on purpose.

## [0.118.8] - 2026-09-10
### Changed
- The kid board sits on one slab. Every card carried its own big shadow, which read on the
  tablet as a hard line under each one with nothing holding it up; the weight moves to a
  single translucent surface behind the board and the cards on it drop two rungs. The name
  pill stays above it on rung 6. Sideways, the slab is the element that lays the two columns.

## [0.118.7] - 2026-09-07
### Changed
Nothing in the kid app is on the old flat shadow any more. The game tiles, the lock screen, the timer options, the sound buttons, the PIN keys, the page titles, the scan panel and the small floating controls all sit on the same elevation ladder as the board.

## [0.118.6] - 2026-09-07
### Changed
The month grid now fades out at the bottom edge while there is more of the month below it, instead of cutting a week in half with nothing to say it can be scrolled.

## [0.118.5] - 2026-09-07
### Changed
Each part of the day is now one card. "Today" is a bare header, and Morning, Any time and Practice each become a single card holding their own heading and their jobs as little cards in a recessed tray, instead of a row of separate cards floating with gaps between them. The board also has an elevation ladder: money highest, the day parts and Treasure Box items next, the calendar lower, labels nearly flat. A job card falls to the board while a finger is on it and springs back.
The month row on the board now carries a calendar with today's date on it, so the one row that is a calendar says so without having to be read. Users are 4 to 8 and may not know the months.
The money screen reads the same way as the board: the account card sits highest, the Save up and Grow rows are the things you tap, and the history list sits under them.

## [0.118.4] - 2026-09-02
### Fixed
- Kid app: the lock banner on the board wraps its sentence instead of truncating it in landscape.

## [0.118.3] - 2026-09-02
### Changed
- Kid app: a locked tablet (bedtime, a spent budget, a rest, a grown-up's lock) now carries a "Do my jobs" button on the lock screen. It opens the board with games still locked and the lock's countdown as a banner; the screensaver returns three minutes after the last touch. The dead games button names the lock instead of "finish your jobs first".

## [0.118.2] - 2026-09-02
### Added
- Kid app: a battery pill in the top-right corner of every screen, read off the tablet's own Battery Status API. Red under 15%, a bolt while charging. The kiosk hides the status bar, so this is the only battery a kid can see.

## [0.118.1] - 2026-09-02
### Added
- Battery: the tablet reports its charge (`POST /api/device/battery`, KIOSK-CONTRACT §11); the parent's kid row and tablet rows read "Battery 80%, charging", and `GET /api/parent/devices/:id/battery?days=N` returns the log behind it (30 days kept).

## [0.118.0] - 2026-09-02
### Added
- Sittings: a per-kid "play for N minutes, then rest for M" rule on top of the daily meter. A full sitting locks the tablet as `LOCKED_BREAK` with a countdown to the end of the rest; a pause shorter than the rest does not restart the sitting. Parent app: the kid's Screen time sheet gains the two numbers; `PATCH /api/children/:id/screen-budget` takes `playMin` / `restMin`.

## [0.117.47] - 2026-09-02
### Changed
- `docs/WALLET-CONTRACT.md` now carries the per-route reachability map under parent custody: a Treasure Box buy works and defers into the next parent-signed payout, while `send`, `stake` and `unstake` refuse 409. The old text said every outflow refuses, which was wrong for the Box (#338). Phase 4 (kid outflows signed by the parent) now has an epic, #456.

## [0.117.46] - 2026-09-02
### Docs
- NEXT-SESSION.md carries the 2026-09-02 overnight pass: the 13 PRs, the traps they cost, and what is still Andjroo's call.

## [0.117.45] - 2026-09-02
### Fixed
- The grown-up invite sheet names the button the invited person actually taps. It said "Join a family"; the first screen says "Already set up? Enter a pairing code".

## [0.117.44] - 2026-09-02
### Fixed
- A grown-up invited as family and friends no longer sees "Add a kid" on the home roster. The server already refused it, so the tap ended in "That didn't go through. Try again." for something a retry could never fix.

## [0.117.43] - 2026-09-02
### Changed
- The pings step of first-run setup says one thing under its heading instead of two sentences making the same point.
- The kid app's tab title reads NIMIQ.kids, the way the parent app's does.

## [0.117.42] - 2026-09-02
### Fixed
- The picture on every empty state in the parent app ("All caught up", "Nothing here yet", no kids yet) is drawn at its intended size. A vendored rule had been shrinking it to the size of a letter.

## [0.117.41] - 2026-09-02
### Fixed
- The Save button in the Treasure Box sheets fills the row instead of shrinking into the left corner.
- A tablet that has not reported its apps no longer shows a greyed Save under the sentence saying so.

## [0.117.40] - 2026-09-02
### Changed
- A kid's page no longer shows the lock card while the household has no tablet paired. It was a state line about a screen that does not exist, two buttons that could not reach anything, and a sentence apologising for both.

## [0.117.39] - 2026-09-02
### Changed
- A kid whose tablet has never checked in gets one line on the home roster saying so, instead of a schedule sentence over it.
- The Nimiq Pay card on Top up no longer repeats its own title in the line under it.

## [0.117.38] - 2026-09-02
### Changed
- Settings opens on two rows instead of two forms: the tablet PIN row says whether one is set, the time zone row names the zone, and the fields wait in a sheet behind the tap. "Pair another device" and "Lost a phone or tablet?" are rows too, and signing out everywhere asks in a sheet of its own instead of a browser dialog.
### Fixed
- The lock-route tests' always-on window ran 00:00 to 23:59, which leaves the last minute of the day outside it, so the suite failed for one minute a day at midnight in the family's zone. A machine test now pins the hole.

## [0.117.37] - 2026-09-02
### Changed
- A kid's screen-time limit and language are two rows on their page that state the answer, with the fields in a sheet behind the tap. They were two full cards with a Save button each, drawn on every visit for a parent who was not changing anything.
- The Staked card on a kid's page only appears once there is something staked, a reward, or an unstake on the way.

## [0.117.36] - 2026-09-02
### Changed
- Sending NIM to a kid is two taps: pick an amount, then Send. The amount pills used to send on their own tap, with the note field underneath them where nobody could fill it in first.
### Fixed
- The Progress tiles group thousands the way every other number in the app does.

## [0.117.35] - 2026-09-02
### Fixed
- The Earned chart on a kid's Progress page counts their job payouts. It read staking rewards instead, so it drew a flat zero over a kid whose feed listed every payout.
- A demo family's seeded history shows up on Progress: each past job now has a decided approval on the day its sticker sits, so "Jobs done" is no longer 0 over a board with four finished jobs.

## [0.117.34] - 2026-09-02
### Fixed
- The Progress row on a kid's page has its icon back. It asked for `speedmeter`, a name the parent app's icon table never had, and an unknown name renders as nothing, so the row shipped with a blank tile.
- Tapping the address under a kid's name copies it. The line was dressed as tap-to-copy and nothing listened.
- A test now checks every icon name the parent app asks for against its own registry, so a blank tile fails CI instead of waiting for a phone.

## [0.117.33] - 2026-09-02
### Changed

- `NEXT-SESSION.md` records that seven walkthrough issues (#399 #400 #401 #402 #403 #404 #406) were already shipped and left open, and closes them out of the worklist. Nothing Andjroo filed from the 2026-09-01 walkthrough is open. What remains is split by what it waits on: his call, the Rive lab after #413, or buildable now.

## [0.117.32] - 2026-09-02
### Changed

- `NEXT-SESSION.md` records #414 and #432 shipping, and that the issue board was carrying finished and fictional work: 9 recon findings already labelled with their own rejection verdict, a `[P0] security` issue that was a suggestion from another repo we already implement more strongly, and two kid-side bugs a parallel session had shipped and left open. 43 open became 30. It also lists what is genuinely left, in the order worth doing it.

## [0.117.31] - 2026-09-01
### Added

- A parent can set what language each kid's tablet reads in (#432). The kid-side switcher was removed on 2026-08-27 and is not coming back, and nothing replaced it, so until now a kid's language was unsettable by anybody: it was whatever the tablet's browser happened to say. The picker is on the kid's own page, under screen time, and its first option is "Same as the tablet", which is what `children.lang IS NULL` means and what every household has today.
- `children.lang TEXT`, nullable. Null is not English: it means follow the device. A `NOT NULL DEFAULT 'en'` would have flipped every non-English tablet in the database to English on the boot that upgraded it, with nothing on any screen to say why, and `PATCH /api/children/:id/lang` refuses an ABSENT `lang` with 400 rather than reading it as a clear, so a client that forgot the field cannot silently reset a household.
### Fixed

- The shell's `setLanguage` persists to localStorage and is read back ahead of the browser's own preference at the next boot, so a per-kid language would have become a device-wide one: set Sam to Spanish and Ava, who has chosen nothing, boots Spanish forever. The device's own answer is captured once into a key the shell never touches, and a kid with no language of their own is restored to it rather than left alone. Backing out of the gate hands the roster back to the device language too, because that screen belongs to all of them.

## [0.117.30] - 2026-09-01
### Changed

- The gold hexagon and "NIM" head is gone from the family home's money group (#414). Andjroo, 2026-09-01: "it still is a little confusing why we have the NIM with the wallet addresses and prices." It is the real wallet's asset head, and it earns its place there because a Bitcoin group can sit under it. Here NIM is the only asset there will ever be, so it separated this group from nothing, cost a row above the balance a parent came to read, and named a unit every amount underneath already spells out. Not replaced by a plainer heading: a group whose rows are a wallet and the kids does not need to be told it is about money.

## [0.117.29] - 2026-09-01
### Added
- A kid is shown, once, where their background lives (#407). The scene has always sat behind
  the name pill and stays there; Andjroo built it and still could not find it, so the character
  pick now arms a one-time pointer that the next board paint spends. Tapping the pill or tapping
  the bubble takes it down, and it never comes back.

## [0.117.28] - 2026-09-01
### Changed
- The kid's Gallery tile reads **"My photos"** rather than the OEM app name (#405). Samsung
  Gallery was already allowlisted on both tablets, so this is presentation, not access: the tile
  stays a `pkg` tile launched through the wrapper, because the photos are device-local and
  non-custodial (#282) and an in-app viewer would have to read them. Kid-side only — the
  parent's installed-apps picker keeps the real Android label, which is what a grown-up ticks.
### Fixed
- `tools/kid-drive.mjs` no longer throws a `SecurityError` into a driver's console-error tally.
  Its device-token init script runs on `about:blank` too, where `localStorage` is unavailable.

## [0.117.27] - 2026-09-01
### Changed

- `NEXT-SESSION.md` records #408's guard fix and the `gh pr checks` trap: it prints "no checks reported" before a workflow starts, which a wait-until-nothing-is-pending loop reads as green.

## [0.117.26] - 2026-09-01
### Fixed

- The kid driver asserts the board instead of denying two gate screens (#408). It read `if (/secret pictures|Who are you/i.test(body)) throw`, which can only catch the two screens it names, and the enrolment CONFIRM step says "Tap the same 2 pictures again" and matches neither. A driver stuck on the gate was handed back as a success and screenshotted it. It now waits for `.k-chart`, `showChart`'s own root, and collects `pageerror` so a module that throws fails the drive instead of leaving the last screen standing. That is exactly how #408's ReferenceError stayed invisible.
- `src/kid-drive-guard.test.ts` proves the guard rejects the exact screen text that used to pass, and that a thrown error fails the drive even when the board did paint. The decision moved into a pure `arrivalFailure()` so it can be exercised without a browser.

## [0.117.25] - 2026-09-01
### Changed

- `NEXT-SESSION.md` records that the mainnet deploy checkout is pinned to `3f469e7` plus the #423 fix, and why. Its `public/dist/parent-shell.js` is untracked build output that a `git pull` does not move, and every locale string lives in that bundle, so pulling `main` there put new view modules against an old string table: `papp.tabBox`, `papp.stLimitTitle` and `papp.lockTglOn` would have rendered as their own key names. The four commands that bring it up to date are written out, along with the rule that a pull there is never enough on its own.

## [0.117.24] - 2026-09-01
### Changed

- A kid's daily and buyable minutes moved onto that kid's own page, under the lock card (#418). Andjroo, 2026-09-01: "we should just simplify this... inside of the kid's profile, there should be individualized versions of this". They were a stack of rows in a family-level settings list, where reading one child's limit meant finding their line. The Settings card keeps the household's HOURS, and only those.
- The hours are not moving and should not: `allow_windows` is keyed by family, one schedule the tablet follows, and a copy of it on every kid's page would be four ways to disagree about when the screen turns off. Same for the time zone, which is `families.tz` and is what those hours are measured in.

## [0.117.23] - 2026-09-01
### Added

- A flat `medal` icon. `duotone-medal` is the Box's face on a card and could not be reused in the nav: its shape is painted through a radialGradient of `currentColor` at 0.6 to 0.2 opacity, which over an inactive tab's grey is close to invisible. It reached the demo as a label with empty space above it.
### Changed

- The Treasure Box is its own bottom tab, not the seventh card in Settings (#418). Andjroo, 2026-09-01: "Treasure box, I feel like that needs to be up higher... that's gonna be something that we'll want for them to spend their own NIM on." It is what a kid's NIM buys, which is not a preference. The tab bar is five wide, its labels 11px with a hard ellipsis, because "Einstellungen" is wider than a fifth of a 390px screen at 12px. The tab is hidden for a grown-up who cannot manage the board, and `views.store` refuses for them too, because hidden chrome is not a permission.

## [0.117.22] - 2026-09-01
### Added

- A one-tap lock switch beside each kid on the family home (#300). Andjroo, 2026-09-01: "on the home screen I would really like a easy button where I could just close down the app ... basically a toggle to lock it or unlock it. And it should override the timer or the screen time." It writes an indefinite parent override either way, which is what beats the screen-time meter: an override sits on top of the meter and the meter does not burn during one. Kid side only, confirmed directly; the grown-up app stays reachable. Drawn only for a kid with a tablet bound to them, and it shows the server's own ruling rather than the override row, so a kid locked by an unfinished routine reads as locked.
### Changed

- A kid's roster row is a `<div>` holding a button rather than being one. A `<button>` inside a `<button>` is invalid and does not deliver its clicks reliably, and the switch had to be a real control. The chevron gives way to the switch on rows that have one: both are the row's right edge, the whole left of the row still opens the kid, and at 390px an amounts column plus a chevron plus a switch is what pushes a kid's name into an ellipsis.

## [0.117.21] - 2026-09-01
### Changed

- `NEXT-SESSION.md` rewritten for the state after #423, #424 and #426. It leads with the five decisions waiting on Andjroo, because each moves a control he has already reviewed, and it records the backtick-in-a-template-literal failure and why a green CI run could not see it.

## [0.117.20] - 2026-09-01
### Changed

- The kid rows in the screen-time settings card wear the kid's own identicon instead of `children.emoji` (#418). Andjroo, 2026-09-01: "we're using old characters for these names. They should just be the identicons." `emoji` is a legacy field the add-kid sheet stopped writing once the identicon became the face on every other surface, so a kid added since then wore a server default here and nothing they would recognise.

## [0.117.19] - 2026-09-01
### Changed

- One kid, one row on the family home (#414). A tablet bound to a kid says its sentence on that kid's roster row now, under their name and beside their balance, instead of in a separate top-level group under its own heading. A kid whose tablet is waiting on an approval wears the same needs-you red the pending strip does. The tablets group is what is left over: a device paired to the household and not yet given a child, which has no roster row to live on. A settled household sees the balance, the queue and the kids, and nothing else.
- The approved screen puts the chore's title beside the kid's name and drops the check mark in front of it (#416). Every card on that screen is work a kid finished, so a mark that never varies distinguished nothing, and the title had a full-width row to itself for it. Send, stake and coupon cards are untouched: they carry a sentence and a duotone that names which of the three they are, not a title.
- "Check for it" is hidden on the top up screen while a wallet is connected (#417). `POST /family/topup-broadcast` already waits for the transaction to execute and for the hot wallet to receive it before it answers, and the app runs the deposit check itself the moment it does, so an in-app top up reconciles without it. It comes back only after a top up that did not confirm inside `HATCH_TOPUP_CONFIRM_MS`, which is the one case where the money may still land later.
- The approval card's CSS moved to `public/parent/approvals.css`. `parent.css` went back over the 800-line CI guard, and the card is one screen's chrome that uses parent.css's tokens, exactly as `board.css` and `share.css` are. It loads after `parent.css` and before `share.css`, which reaches into these rules and has to keep winning.

- "Move your kids into your wallet" is "Give your kids an address" again, on both the family home and each kid's page. With the custody gate in place the flow only ever runs where a kid has no address, so there is nothing to move them off. `papp.giveNoAddress` quotes the new label in all five languages.
### Fixed

- Parent-owned kid addresses are offered only where the server holds no key. Both the family-home batch row and the per-kid row read `custody.kidCustody === "parent"` (#415). On a server-custody instance, moving a kid onto a parent-owned address answered 409 `parent_signature_required` for every kid-initiated send, stake, unstake and Treasure Box buy from that point on, with no route back and no parent-signed outflow path to replace it. The demo runs server custody, so the row was one tap from permanently ending a kid's spending.

## [0.117.18] - 2026-09-01
### Fixed

- The parent app loaded as a blank white screen on every instance. An HTML comment inside a template literal in `public/parent/views-store.js` quoted two field names in markdown backticks; the first of them ended the string mid-sentence and the module stopped parsing. One dead module takes the whole app, because every view is reached through the same static import graph. Shipped in #409 and live on the demo and on mainnet until now.
- `src/browser-modules-parse.test.ts` parses every `.js` under `public/` on each run. Nothing in this repo read those files before: `bun run check` type-checks `src/` with `allowJs` off, `build:shell` bundles `src/*-shell.ts` and serves `public/parent/*.js` raw, and no test imports a view. The first thing that ever read the broken syntax was a phone.

## [0.117.17] - 2026-09-01
### Parent app: a concision and consolidation pass

- Demo gate lede is one sentence again: "This is a demo family."
- Toast no longer spills. The vendor pins `height: 8rem`; ours wrap, so height now follows content with 8rem as the floor.
- Top up lost the payout-budget line and the family-code hint, and its copy is short.
- 29 strings rewritten across all 5 languages. Parent copy: 2842 words to 2611, strings over 12 words 46 to 19.
- "Give your kids an address" is "Move your kids into your wallet" on both surfaces, because it moves a kid off a server-derived address, it does not create a first one.
- "Give {name} some NIM" is "Send NIM".
- Home puts the two admin rows after the roster instead of above the wallet.
- The app calls itself NIMIQ.kids in prose. URLs unchanged.

## [0.117.16] - 2026-09-01
### Added

- **Games is a bottom-nav destination** (#398). The dock is Box / My week / Games / Money, with
  a new controller glyph drawn to the same 11px stroke as the other four and the minutes left
  riding it as a badge. The app shelf that used to put five icons on the board is retired: it
  cost ~190px of the tablet's column and was the only route to the games grid, which is the
  screen a seven-year-old could not find.
- **The games grid sorts into Play / Learn / Make / Watch / Tools** (#399), from a shared
  `public/js/lib/app-categories.js` so the parent side can read the same map. An unrecognised
  package lands in Play and is never hidden.
- **The Timer is a Tools tile** in that grid rather than a dock button. Every route into it from
  a job card is unchanged.
- **Real art on five Treasure Box tiles** (#404): 15 / 30 / 60 minutes, pick what's for dinner,
  stay up late. Resolved from data the row already carries (`src/store-art.ts`, the
  `task-icons.ts` pattern) and served as one `artUrl` from `itemView`, so the kid's shelf and
  the parent's manager cannot show different pictures of the same thing.
- **"Sets you can collect" moved to its own shelf in the Treasure Box** (#400), last, under a
  line saying it is not for sale. On Today it sat in the same list as the morning routine, where
  five of six headings were things to do and one was a thing to want.
### Changed

- **The login gate leads with the kid's name.** It used to stack an instruction as the heading,
  the name under it as a subtitle, and a second instruction repeating the first plus an
  explanation a four-year-old cannot act on. Now: "Sam", then "Tap 2 pictures." (or "Tap the
  same 2 again!"). "Ask a grown up" is gone from the setup screen, where the kid IS the one
  doing the setup; the escape there is "Not me" and it goes back to the roster. Signing in
  keeps the grown-up PIN, because a forgotten picture is what that button is for.
- **The 12 login-gate pictures were redrawn in the house family, and the set changed.** They
  were saturated, faceless and realistically shaded next to a sticker set that is pale pastel
  with a navy outline, dot eyes and rosy cheeks.
  ⚠️ The limbs the first pass grew came from the STYLE string, not the subject: the shared
  recipe ends "with short stubby limbs tucked in at its sides", which is right for a creature
  and is why a soccer ball arrived with feet. Objects get a style that says the opposite now.
  ⚠️ The set is four that lean boy, four that lean girl and four that lean neither, with twelve
  different expressions rather than one smile twelve times. Five subjects left and five arrived,
  which invalidates every stored secret, so both live kids' `kid_switch_secrets` rows go with
  it and the golden order test moved in the same commit.
- **The games grid lays three tiles across on a phone, not two.** At two the Play row filled
  the screen on its own and the five rows the page had just been sorted into were all below the
  fold.
### Fixed

- **A dock badge sat on top of its glyph.** The glyphs are 23px masks with no padding, so a
  corner badge lands on the drawing: the minutes covered the controller and the item count
  covered the chest. The glyph and word are bottom-aligned in a taller button now and the badge
  has a lane of its own above them. The `>=768px` block also stopped sizing these as the discs
  they were before each grew a word underneath, which is why the bar drew 100px against the
  74px every screen reserved.

- **A board carrying a placed sticker threw** (#408). `chart.js` called `stickerNode` without
  importing it, so `showChart` died with a `ReferenceError` the moment any of today's jobs had a
  sticker on it. Present on `main`; found by driving the real app.
- **An open calendar no longer squeezes Today to nothing** (#401). `.ch-today` was the only
  block in the column that could shrink, so a 6-week month took the whole shortfall out of it
  and the app's one scroller resolved to 0px. The calendar yields now, and its dates scroll
  inside a cap. Measured at 390x844: the job list went from 0px to 155px with all 35 cells still
  rendered and no page overflow.
- **The open calendar has one close control, and it is an X** (#402). It used to show three
  identical chevrons, of which one closed the month and one was disabled.
- **Send, Receive and the QR sheet sat under the fold** (#403). `max-height: 92%` measured the
  large viewport (`.screen` is `position: fixed; inset: 0`), and no wallet sheet has ever
  carried `env(safe-area-inset-bottom)`. On a tablet they had no bottom padding at all. The
  `92svh` fix already written for the amount pad now covers all of them.
### Removed

- `public/kid/js/shelf.js`, `public/kid/css/shelf.css` and the dead `.games-card` rules across
  four stylesheets. Also the bare `.k-qr { width: 260px }`, which had not applied to anything
  since the QR became its own sheet.

## [0.117.15] - 2026-09-01
### Fixed
- A parent-custody household can see its own wallet again. `POST /api/family/deposit-check`
  read the balance of the instance hot wallet, which under `HATCH_CUSTODY=parent` does not
  exist, so the check answered 502 and the snapshot behind the parent app's Home tab was
  never written. It now reads `families.parent_address` and stores the snapshot against that
  household rather than over the instance-global float.
- The Home tab stops reporting a spent grant as an empty wallet. Under parent custody
  `visibleFundsLuna` fell through to the family's remaining budget, a bound that governs
  nothing there because the money leaves the parent's own account and `parentSignedApprove`
  decides before the budget check is reached. A household holding 16,442 NIM read
  "Family wallet 0 NIM" after six ordinary payouts.

## [0.117.14] - 2026-09-01
### Fixed
- `demo-past` no longer fails CI on the 1st of the month. `pastDays` stops before today by
  design, so the current month holds no trail at all on the 1st, and the test asked both
  months for the same fixed count. The previous month keeps the count it can always keep;
  the current month is now measured against the days the trail actually covers.

## [0.117.13] - 2026-08-28
### Added

- **A practice exercise can show a video on the kid's own card.** Uploading a clip and putting
  its path in the exercise's video field makes it play inline on the "What did you do?" sheet.
  A seven-year-old who cannot read the how-to yet can watch it instead, which is what the text
  alone could never do.
- Media uploads accept `video/mp4` (kind `video`, role `clip`), with their own 40 MB ceiling.
  5 MB is a photo budget, and a demonstration squeezed under it makes hands on keys unreadable.
### Changed

- One field, two readers, and the URL decides: a **same-origin path** is a clip this instance
  serves, so it plays on the kid's row; **anything with a host** is a page on the open web, so
  it stays a link on the parent board. The tablet is a kiosk with no browser, so a link on the
  kid's card was always a dead tap. A protocol-relative `//host/x` counts as outside.
- The parent board says "Clip plays on her card" instead of offering a link that goes nowhere.

## [0.117.12] - 2026-08-28
### Changed
- Cards and headers are white again on every scene, by Andjroo's call after seeing gray, navy and black side by side. What stays from the contrast work: solid label pills with full-ink text, the hairline edge on cards and pills, and the measured scene lightness driving the remaining dark-scene styling.

## [0.117.11] - 2026-08-28
### Added

- Shelves can carry a `budget_kind` tag (`utility` / `learning` / `games`), the first slice of
  per-category time budgets. Descriptive only: no runtime code reads it yet, an untagged shelf
  behaves exactly as before, and the parent control is behind `FEATURE_CATEGORY_BUDGETS=1`.
  The design it is groundwork for is written up in `docs/CATEGORY-TIME-BUDGETS.md`.

## [0.117.10] - 2026-08-28
### Changed
- The light-scene card gray is a full step darker, so it reads as gray on the tablet panel rather than as a second white.

## [0.117.9] - 2026-08-28
### Changed
- Every solid card on every scene screen — the board, the Treasure Box, the money screen, the practice card, the games grid — now follows the background: gray on light scenes, white on dark. One `--card` token replaces the per-screen list, so a card added tomorrow follows automatically.

## [0.117.8] - 2026-08-28
### Added

- **An exercise can now say how to do it.** A practice step carries a plain-text how-to, drawn
  straight onto the row on the kid's "What did you do?" sheet, under the name. A title is a
  label you recognise after being shown once ("Five-finger walk") and cannot teach the thing
  cold, so a tick-list of five sent the kid to find a grown-up before every one.
- **And a video to watch, on the grown-up's phone.** A step can hold a link, shown on the parent
  board only. The tablet is a kiosk with no browser and its YouTube Kids carries approved
  channels only, so a link on the kid's card would be a dead end. The scheme is checked
  server-side (`http`/`https` only) because the string is rendered into an `href`.
### Changed

- The practice-exercise sheet moved to `public/parent/views-board-practice-step.js`, the same
  800-line split goals and locks already took.

## [0.117.7] - 2026-08-28
### Changed
- The board's solid cards follow the scene the way the labels already do: gray on a light background, white on a dark one. Job icons blend onto the gray instead of showing their baked-in white squares.

## [0.117.6] - 2026-08-28
### Changed
- `readKidWallet` is now a read, which is what its name and its own doc comment always claimed.
  Provisioning happens on money paths through `ensureKidWallet`, unchanged.
- A kid-to-sibling transfer now mints the RECIPIENT's account under server custody instead of
  refusing. That is a money path, and a gift to a sibling who has never logged in has to land
  somewhere. Parent custody still refuses in words rather than throwing.
### Fixed
- Opening either app no longer mints a kid's account. `GET /kids/:id/wallet` is what both the
  parent roster and the kid login screen call just to draw a screen, and it used to provision as
  a side effect, so a kid's address (and therefore their identicon) was decided by whoever loaded
  an app first. Measured in production: a household created at 04:38 had both kids provisioned
  within the same minute, before either had touched a tablet.
### Notes
- The control test in `kid-no-address-read.test.ts` asserted the old contract on purpose, to stop
  exactly this change. Its original reasoning was correct at the time: both clients relied on the
  side effect. They were fixed first, so the test is now reversed with that history written into
  it, plus a second test pinning the half that must survive, that money paths still provision.

## [0.117.5] - 2026-08-28
### Added

- A **Goal section** on the kid's board: under their ladders, the sets they could collect but
  have no ladder for yet, with the art shown rather than hidden. Tapping one asks a grown-up
  for that ladder — the title and what it is worth are still settled together. A declined ask
  leaves no trace; the set simply reads as askable again.

## [0.117.4] - 2026-08-28
### Fixed
- The kid board scrolls from anywhere again: a swipe or wheel starting on a task card used to be swallowed by the card list's own dead scroll container, so with the day's groups open the board only scrolled from the header strips ("it's like I can only go so far").
- The bare labels on the scene — "Today", "Your games", the minutes left — now wear the opposite of the background: a navy pill with white text on light scenes, a white pill with ink on dark ones. Scene lightness is measured from the artwork itself (cached per scene), so catalog and earned wallpapers classify correctly instead of only the space id.
- Solid cards carry a hairline ring so a white card no longer melts into white art (city clouds).

## [0.117.3] - 2026-08-28
### Added
- `src/scripts/reset-kid-character.ts` gives a kid their character choice back. Dry run by
  default, `--apply` to write, `--kid <id>` for one child. Needed because every kid provisioned
  before the picker shipped was handed `MAX(account_index) + 1` by birth order, and the picker
  refuses anyone who already holds an account.
### Changed
- The per-account emptiness check moved out of `parentCustodyBootReport` into an exported
  `derivedAccountEmptiness`. The boot guard and the reset are both deciding whether it is safe
  to forget a key, so they now ask the same question through the same code. Behaviour unchanged.
### Notes
- A reset only happens when the chain PROVES the old account holds nothing. A balance, a stake,
  an unreadable read, a node that will not answer the staking question on an address with
  history, or coordinates with no address: all refuse and leave the row exactly as it was.
- A parent-registered address is never reset, even when empty. Clearing it would discard a
  signed binding proof and quietly return the kid to server custody.
- `derived_address` is kept, so the row still records which account the kid used to be.

## [0.117.2] - 2026-08-27
### Added
- A kid picks their own character on their first login. Nine identicons, three rows of three,
  with a shuffle for a different nine. `GET /api/kids/:id/character-choices` mints the offer and
  `POST /api/kids/:id/character` claims one.
### Changed
- A server-custodied kid's `account_index` is no longer always `MAX + 1`. It is whichever of the
  nine offered indices the kid tapped, so the character is a choice rather than birth order. The
  index is still assigned exactly once and never re-derived.
### Notes
- Both endpoints go through `childMoneyGate`, so a device bearer must be unlocked as that kid.
  A kid returns an index the server minted, never an address: the parent-only rule in
  `src/routes/kid-address.ts` is unchanged and uncrossed.
- The pick is refused once a kid holds coordinates at all, funded or not. Re-picking would derive
  a different address and strand any NIM at the old one.

## [0.117.1] - 2026-08-27
### Added

- **The kid's own games, on the board.** A shelf of real app icons sits at the top of home,
  above the money card. Tapping one launches it; the last tile opens the full grid and says how
  many more are behind it. It is drawn whether or not the tablet is unlocked: locked, the icons
  grey out and the row says what to do about it instead of how long is left. The tiles stay
  tappable when locked and answer with the reason, because a picture of a game that ignores a
  finger reads as a broken tablet rather than as a rule.
### Changed

- **A shut calendar is one line.** It used to be a whole week of dates even closed, 182px of
  board. The month name and its chevron are the resting state now; tapping (or the Week button
  in the dock) opens the month grid as before, and the week the strip showed is its top row.
- **The green "Your games are open!" card is gone.** The shelf carries that route behind its
  last tile, so it was two controls leading to one screen, and in the landscape column its title
  had started ellipsing to "Your games a...".

## [0.117.0] - 2026-08-27
### Added

- **Robots**, the fifth goal-ladder theme, and **three** unlockable wallpapers: a factory
  canyon, a scrapyard at golden hour, and a mech hangar. Six transforming machines of one
  world: Bolt, Rover, Jet, Digger, Guard, and Titan as the boss. Earned on a parent's goal
  ladder like every theme, never on the Treasure Box shelf.

- A theme can now unlock **more than one wallpaper**. `PackDef.backgroundId` became
  `backgroundIds`, and finishing a set hands over every wallpaper it names. The four existing
  themes each name one and behave exactly as before.

  It is a COMMUNITY pack, not the growth ladder the catalogue had sketched out while it was
  undrawn. Community packs vary by MATERIAL rather than by hue, and here the material is the
  machine each robot is built out of, so Rover rides on bulldozer treads, Jet wears its wing
  panels flat across its chest, and Digger has an excavator claw for a hand. Titan is the rare
  one: mirror chrome and a glowing amber core, no gold.

## [0.116.14] - 2026-08-27
### Changed

- **The timer starts with music on.** Sound came back on in v0.116.12, but the Sounds sheet
  still opened with "No music" ticked, so the fix landed and the timer still ran in silence
  until somebody went and picked a bed. The default is Bouncy now. Bouncy rather than
  Lullaby because the reminders this timer is built around are mostly get-ready (shoes on,
  get dressed, brush teeth, clean up, time to eat) and a lullaby at 7am is the wrong room;
  Lullaby is one tap away on the same sheet. "No music" stays the first tile, because it is
  a real choice and it is where a parent looks to turn the music off. A latched migration
  converts a stored `'none'` once, and only `'none'`, since that is what the old default
  produced on its own. Safe because sound was globally off from 2026-08-03 to 2026-08-27, so
  nobody could have chosen silence by listening to the alternatives and preferring it.
### Fixed

- **The egg's outline keeps its weight where the crack reaches the rim.** Andjroo, 2026-08-21,
  on a zoom of a mouth: "where the crack meets the egg the line density changes, so it gets
  thinner near the edges where it's cracking, and I don't like that." The intact layer wears
  the drawn curve; the cracked layer wore nothing, so wherever the reveal touched the rim the
  outline stopped being the drawn curve and became the generator's own, softer and lighter.
  The cracked layer is stroked `source-atop` now, which paints only where that layer is
  already opaque, so the notch still opens on the drawing's own alpha and every whole arc
  either side of it takes a full line.
- **The crack really is a different one each run.** `CRACK_PATTERNS` was the literal
  `[1,2,3,4,5]`. When the cut set changed, `setPattern()` refused the missing number,
  `rollPattern()` returned null without updating `lastPat`, and the next roll was then free
  to repeat the one just played, which is the exact complaint the roll exists to fix. The
  list is asked of the rig now, so it cannot drift from the art.
- **The crack picker on the tuning page paints eleven different eggs.** It drew its tiles at
  boot, before the art wave that carries the cracks, so it painted eleven identical uncracked
  eggs and only rebuilt when a tile was picked. Not visible in the app, which has no picker.

<!-- This is a straight re-vendor of ~/data/anim-demo (timer.html, wiggle.html), where
     the timer is authored. The three fixes above had been sitting there unvendored since
     2026-08-21. The two copies are byte-identical again. -->

## [0.116.13] - 2026-08-27
### Fixed

- **Editing a routine no longer deletes the kid's day (#381).** A run snapshots its routine's
  task list once, and an edited task is retired rather than deleted, so a parent changing the
  morning routine at 9am made the whole routine vanish off the tablet with no error anywhere.
  Worse, and not in the report: `allTasksFinished` counts a retired task's pending row as
  still open, so the run could never be handed in, no approval was opened, and **the day could
  never be paid**. A run in progress is now reconciled against its routine on read: a step
  added mid-day appears, an unstarted retired step goes, and a retired step the kid already
  did stays, still pays, and still shows on the board. Finished runs are history and untouched.

- **Splitting a practice into exercises no longer wipes its price.** A stepped practice is
  priced by its steps and its own reward stops being read, so the first exercise added to a
  400 NIM piano, saved with no price of its own, silently dropped the day to nothing. The
  parent app's own button already promised otherwise ("Break it into exercises and each one
  carries its own share"). The first exercise now inherits the practice's price when the
  parent names none. Later exercises are unaffected: one left at nothing is worth nothing.

- **A week the kid was not here no longer breaks a practice streak.** `weekStreak` walked back
  week by week and stopped at the first week under target, so for a child who is with their
  other parent every second week the streak reset every fortnight forever: they could never
  hold a streak longer than 1, whatever they did, and nothing in the app explained why. A week
  with no trace of that child at all (no routine run, no practice session, no sticker) is now
  stepped over rather than counted as a miss. Any trace makes the week real again, so an
  ordinary week where they were home and fell short still ends the streak.

- **The Treasure Box fits a landscape screen.** It was 1068px of content in an 800px viewport,
  so a kid deciding what to spend their NIM on saw the header and one shelf and had to scroll
  for the rest. Landscape now lays the shelves in two columns, and drops the tile floor so a
  shelf fits four across instead of wrapping the fourth onto a second row (a grid row is as
  tall as its tallest shelf, so that one wrapped tile was costing ~200px). 1068px to 746px:
  the whole Box, no scrolling. Portrait and phone are untouched.

## [0.116.12] - 2026-08-27
### Changed

- **No language switcher in the kid area.** Andjroo: "I wanna remove the language selection
  from the kids area." The `#lang` mount is gone from `public/kid/index.html`, and with it
  every rule that dressed the flag-hex pill. The i18n is untouched: the shell still resolves
  the language and `onLangReady` still repaints. What a kid can no longer do is change it on
  a shared tablet, which lives in the parent app. The header lane the pill used to reserve
  collapses to the page gutter, so the kid's own name gets that width back.
- **All sound is back on.** It was switched off on 2026-08-03 ("lets remove all sound for
  now, it needs some work") and the pause was invisible from inside the app, so silence read
  as broken wiring rather than as a decision. Both `SOUND_ON` constants (the timer and
  `public/js/lib/confetti.js`) are true again. Nothing was ever deleted, so this is one line
  in each file: the audio, the baked-in levels, the five guards and the iOS unlock are
  exactly as they were built and proven. `tools/eggtimer-soundproof.py` asserts the opposite
  of the shipped behaviour now and is the off-switch's test, not a gate.
- **The hatch sheet starts with all 21 animals ticked.** `heroSet()`'s never-empty floor was
  `heroes[0]`, and because that floor is materialised into storage the first time the roster
  loads, it *was* the default. So the one sheet whose idea is "who can come out of the egg"
  shipped with a set of one and the same bear hatched every run. A latched migration clears a
  stored set of one, which is precisely what the old floor produced on its own, and leaves a
  real multi-pick alone.
### Fixed

- **The timer's background fills the tablet.** Andjroo, on the family tablet: "the background
  doesn't fit the whole screen." `#app` is a 430px column and the scene lived inside it, so a
  1024px screen showed the picture down the middle with a navy bar either side. `#bgImg` and
  `#conf` are fixed to the viewport now, and `layout()` converts the badge clip into screen
  coordinates; the egg, the dial, Start and the dock keep the column. On a phone the gutter is
  zero and every number is the one it always was. The scrim and the four sheets moved out for
  the same reason, since a dim that stopped at the column read as a lit background with one
  dark stripe in it; `#sheetCol` re-imposes the column on the sheets alone, so no `.sheet`
  rule changed. The confetti is the whole screen too, which is what it was always meant to be.
- **A chosen reminder no longer disappears when the timer starts.** Andjroo set "thumbs up" or
  "shoes on", pressed Start, and "it just goes away automatically." It did: the bubble lived
  inside `#scSet`, which fades out, so the run screen showed no sign of the pick and, with the
  sound off, never spoke it either. `#plus` is a child of `#app` now and `layoutRun()` parks
  it on the badge's shoulder, clear of the rim arc, travelling on the same curve the egg does.
  It is a label there rather than a control, so a running countdown is never one tap from a
  modal sheet. Job mode still hides it.

<!-- The timer is vendored one-way from ~/data/anim-demo; the same change is committed
     there (nimiq-kids-egg-rig, art/unicorn-themes) so re-vendoring cannot revert it. -->

## [0.116.11] - 2026-08-27
### Changed

- **`chart.js` split at the 800-line guard.** The practice and goal cards, their groups and
  their taps move to `public/kid/js/upkeep.js`, and the two pieces every card shares (the
  drawn icon, the NIM pill) to `public/kid/js/card.js`. It is a real unit rather than the
  overflow: a job answers "when today", a practice answers "how often this week" and a goal
  answers "how far have I got", so chart.js keeps today and upkeep keeps the other two axes.
### Fixed

- **The kid's board, with the tablet turned sideways.** Every stylesheet in the kid app was
  written for one shape, 800x1280 portrait, so landscape kept all four stacked blocks at
  full portrait size on a screen half as tall. On the real viewport (1280x800) Today's list
  was left **104px of room for 616px of cards**. That is not one whole card, and the list
  barely moved when a kid scrolled it. Landscape now lays the chart in two columns: the
  kid's name, their money and their week in a narrow left column, Today taking the full
  height of the right one. The same list gets **661px**, and a three-task morning fits with
  nothing to scroll at all. Portrait and phone are untouched.

## [0.116.10] - 2026-08-24
### Added
- The savings thermometer on the kid's money screen (#355): a drawn bulb-and-stem that fills as
  they get closer, under the balance card and above the feed. It says "41 991 NIM to go", never a
  percentage. Empty state invites them to pick something, from the Treasure Box or in their own
  words. It celebrates once at 100% and then reads as reached. The picker says out loud that this
  is a mirror and the meter drops if they spend, before they ever set a target.

## [0.116.9] - 2026-08-24
### Added
- A kid can be saving for something, and see how close they are (#354). `savings_targets` plus a
  read model on `GET /kids/:id/wallet`: the meter is `balance / target` and nothing is reserved,
  so a kid who spends tomorrow watches it drop. `reached_at` is stamped the first time they get
  there and never cleared, because getting there happened. One active target per kid, enforced by
  a partial unique index. A target can name a Treasure Box item and take its price.
### Fixed
- The demo trail reached the previous month by zero days on a month-ending Monday (and five days
  for the week before that), so a visitor arriving late in a month found an empty grid behind the
  back arrow. `PAST_WEEKS = 4` was a floor whose comment claimed it was the rule; `pastDays` now
  always reaches the Monday on or before the 1st of the previous month. This is why a scheduled
  run failed a commit on 2026-08-24 that had been green on 2026-08-22.

## [0.116.8] - 2026-08-22
### Added
- A pairing code can now name the kid its tablet belongs to. `POST /api/parent/pair-code`
  takes an optional `childId`, and a tablet redeeming that code is bound to that child
  without anyone typing a UUID. A code minted with no kid behaves exactly as before, and a
  `childId` in the register body still wins. (#364)

## [0.116.7] - 2026-08-22
### Added
- `tools/kid-drive.mjs`, the recipe for driving the kid app in a browser past the kid picker,
  the device token and first-run enrolment. `tools/kid-partial-credit.mjs` is the first check
  built on it, and it proves on a real screen what #370 could only prove at the API.
### Fixed
- Enrolling a picture secret on an unpaired tablet told the child "Not those ones. Try again."
  when their taps were correct and the server had refused with a 401 (#371). A failure only a
  grown-up can fix now says so, and `setSwitchSecret` keeps its HTTP status the way
  `bootChildren` and `unlockKid` already do.

## [0.116.6] - 2026-08-22
### Fixed
- A partially-approved job no longer tells the kid it paid full price (#369). The chart now
  serves what the approval actually paid, computed by the same function that paid it, and
  carries the note the parent was required to write. The kid's card pill and the approval
  notice both use it, so a quarter-share job reads as a quarter and says why.

## [0.116.5] - 2026-08-22
### Added
- A pending approval nobody has ruled on for three days makes the queue say so (#272). The
  "Waiting for your OK" strip on the family home wears the app's needs-you red and names who
  has been waiting and for how long; the card's own timestamp reddens with it. Nothing about
  the approval changes: it stays pending, and no money moves without a grown-up saying yes.

## [0.116.4] - 2026-08-22
### Fixed
- `POST /api/kids/:id/fund` answers `409 kid_address_not_registered` instead of `502 pay_failed`
  when a kid has no address yet on a parent-custody instance (#245). That is a normal, expected
  state there, not an upstream failure, and 502 invited a retry that could never succeed. The
  gift sheet now names the next move (the "Give your kids an address" row) rather than falling
  through to "that didn't go through".

## [0.116.3] - 2026-08-22
### Fixed
- The parent app is a layout on a tablet instead of a 460px phone column floating in the
  middle of an empty grey page (#360). At 700px and up the navy header and the bottom tab bar
  span the viewport, the card list stays a 560px reading column centred under them, and sheets
  open as centred dialogs rather than a narrow slab stuck to the bottom edge. Phone widths are
  untouched: every rule lives inside one `min-width` query in a new `public/parent/tablet.css`,
  and `tools/parent-tablet.mjs` measures 390px in the same run as 800/1280/1440 to hold that.
- A `.pill-btn.wide` centres itself instead of sitting against the left edge of its card.
  On a phone the offset was 13px and invisible; on a tablet it read as debris under rows that
  span the whole card. The same fix had already been written by hand eight times (six inline
  `align-self:center`, two `.bd-wide`) — all retired, and the driver now fails if any wide pill
  is off centre or lands in a flex row, where its auto margins would be wrong.

## [0.116.2] - 2026-08-22
### Added
- Partial credit on an approval (#351): a grown-up can approve a job for a fraction of what it
  promised. `approvals.share_bps` (basis points, NULL = full), payout is
  `floor(full * share_bps / 10000)` — floor never round, so a family can pay less than the
  promise and never more. A share is refused on `send`/`stake`/`unstake`/`coupon`, refused at
  zero (reject is still the only way to say no), and refused without a note. The share is
  committed to the pending row **before** the signing intent is minted, so a parent-custody
  instance signs the partial amount rather than the full one.
- The share slider on the approval card (#352). Solid navy is what the kid gets paid, hatched
  is what the job promised and is not being paid. Detents at 25/50/75 that are also tap
  targets; everything between them is reachable, and the two ends are just the ends. Dragging
  all the way empty turns the action into Send back rather than approving a payment of
  nothing, which would close the job for good at no pay. Ported from the nimiq.blog `/predict/` sliders, which are themselves a port
  of the wallet's swap-balance-bar. Earn cards only; the note appears with a reduced share
  because the server requires one, and the header amount yields so a card never shows two
  different numbers.

## [0.116.1] - 2026-08-15
### Fixed

- The custody boot guard could not tell "this address has never staked" from "the node is
  broken". Albatross reports a missing staker as a generic `Internal error` with the real
  sentence in `error.data`, and the classifier only read `error.message`, so a proven zero
  came back as an unreadable balance and the instance refused to start. Classification now
  reads both fields and is pinned by tests against the payloads real nodes send.

## [0.116.0] - 2026-08-11
### Added
- A routine step can be marked **Extra credit** from the board, which is what finally makes
  side quests reachable (#342). The kid's card says `Bonus` so the two kinds of step are
  tellable apart.
- The kid can end their own day when they leave a side quest alone. Without it, a child who
  did every required job and simply did not want the bonus could never be paid for any of it:
  the run held open waiting for a step they had chosen not to take, and no grown-up was ever
  asked. This is the chest of `docs/SPEC-quest-map.md`, drawn as a card until the trail exists.
### Fixed
- Tapping a finished step no longer claims "Waiting for {parent}" while the run is still the
  kid's to end. Nobody had been asked yet, so the app was naming a person who had not been sent
  anything.

## [0.115.0] - 2026-08-11
### Added
- Side quests: a routine step can be marked extra credit, so the day finishes without it and
  doing it pays its own reward on top (#341). A run with one still open no longer auto-submits
  when the last required step lands, because submitting freezes the run and would have turned
  the bonus into a trap. The kid ends the day themselves, and a bonus they left alone is
  recorded as `passed`, which the parent's card shows apart from a step they excused.

## [0.114.3] - 2026-08-11
### Fixed
- `docs/FIRST-PAYOUT.md` sent Andjroo to the wrong screen. Since #291 the Top-up card's
  "Pick my address" sets the household **till**, not who pays; who pays is per grown-up at
  Settings → Grown-ups → "Use a different wallet". Following the old text set nothing that
  matters and then failed at signing time with "Address not found". Adds the **Connect
  wallet** step the control depends on, and records that #297 is what put a button on that
  card for a migrated household at all.

## [0.114.2] - 2026-08-05
### Fixed

- **The demo's calendar row above Today could come out three or four days blank**, which is
  the opposite of what the history trail exists to show. The gap floor was applied to the
  trail's trailing seven days, a window that slides with the weekday; the grid draws whole
  Monday weeks, so from Wednesday on the two stopped overlapping and the row a visitor
  actually reads went unfloored. Measured on 10 of 28 consecutive start dates. The floor now
  covers the calendar row as well as the trailing week, and `tools/demo-past-verify.py` reads
  the grid row rather than the seven cells before Today.

## [0.114.1] - 2026-08-05
### Docs
- `docs/NEXT-SESSION.md` records #323: the approval-is-the-unit rule, the four celebrate-paths
  that must bank the approval first, the marker being a key set rather than a timestamp, and
  the goal-rung sticker that still arrives in silence.

## [0.114.0] - 2026-08-05
### Added
- A kid is now TOLD when a grown-up says yes from their own phone (#323). The chart used to
  re-render in silence: the ring went from an hourglass to a green circle and the sticker they
  had just earned sat behind a tap nothing had told them to make. A tappable notice now names
  who said yes, what to, what it paid, and opens that sticker. One approval is one notice, so
  a three-task routine says "Mom said yes to Morning routine! +7200 NIM" rather than saying it
  three times, and a kid whose app was shut when the yes landed hears about it on next open.
### Changed
- `toast()` takes an optional `{ ms, onTap }`, so a line worth reading can stay up longer than
  2.4 s and can be tapped. Every existing caller is unchanged.

## [0.113.4] - 2026-08-05
### Added

- **A parent can see what the kid's tablet is doing (#305).** `GET /api/parent/screen-state`
  serves the household the same ruling the tablet itself follows: locked because a routine is
  not done, waiting on a grown-up, free until the next window, or held by an override. It
  carries the routine's name, the override's author, and the tablet's last check-in. The
  family home draws a **Tablets** row per paired device; the waiting one is red and taps
  straight through to the approval that ends it. A household with no tablet gets no section.
- The lock card on a kid's page now reads that same ruling instead of describing the override
  row alone, so it no longer says "Follows the schedule" over a tablet that is locked solid.

## [0.113.3] - 2026-08-05
### Changed

- `docs/NEXT-SESSION.md` records PR #329 (the demo's Connect-wallet toast and the waiting
  screen's button hierarchy), including the three Proxy details that keep the corner control
  safe on the instances holding real money.

## [0.113.2] - 2026-08-05
### Changed

- **"Connect wallet" on the demo now answers instead of walking a judge out of it.** On
  `demo.nimiq.kids` the household's wallet IS the instance hot wallet: already funded, every
  payout signed server-side. The header's most prominent control was still inviting a visitor to
  connect or create a Nimiq wallet they do not have, to solve a problem the funded balance right
  underneath had already solved, and the Hub it opened was a detour out of the demo. The button
  stays, because connecting a wallet is real product a judge should see, and the tap now says:
  *"This is the demo, so the family wallet is already funded. In the live app on mainnet, this is
  where you would connect your own wallet."* All five locales.
- The menu's "New to Nimiq? Create a wallet" routes through the same door, so both ways into
  wallet creation land on the same sentence. On a family or competition instance nothing changes
  and the Hub opens exactly as before, which `src/demo-connect-note.test.ts` holds along with the
  proxy detail that makes it safe: methods bind to the target, because forwarding a class's
  private field through a proxy receiver throws at the moment a parent tries to pay.
- **The kid's "Waiting for Mom" screen now leads with the button that unblocks them.** On a demo
  household the only way through is "Mom is here", and it was the gold secondary sitting under a
  blue camera button that unblocks nothing. The two swap places and colours on demo only. On a
  real household the kid genuinely is waiting, so the camera stays primary. Both buttons remain
  in both modes.
- Toasts take an optional dwell. The defaults (2.8s, or 6s with a link) are tuned for "Saved",
  not for two sentences somebody has to read; the demo note gets 7s.

## [0.113.1] - 2026-08-05
### Changed
- `docs/NEXT-SESSION.md` records #304: the override button, why the issue's premise was half
  wrong, and the two rules that hold the screen up.

## [0.113.0] - 2026-08-05
### Added
- A parent can lock or unlock a kid's tablet from their phone (#304). The kid's page now
  says what the tablet is doing and who decided it, and both buttons open the same four
  lengths: 15 minutes, 30 minutes, an hour, or until a grown-up says otherwise. A paired
  tablet obeys on the SSE stream it is already holding open, in about a second.
- The parent overview reports `purchasedUnlock` per kid: the minutes a kid bought and has
  not used up, sent alongside the override in charge rather than instead of it. A parent's
  own row hides a purchase from `activeOverride` completely, and the phone has to be able to
  say that the bought minutes are still there.
### Changed
- `DELETE /api/family/override/:id` now clears a **parent** row only and answers
  `409 purchased_minutes` on a purchase. Deleting one took back minutes a kid spent real NIM
  on, with no refund and nothing on their screen to say why. Locking the tablet still
  outranks a purchase outright and leaves it intact underneath.
### Fixed
- A supporter could end a grounding through `DELETE /api/family/override/:id`, which they
  have never been allowed to write. Clearing a lock is a board write and is now gated like
  one (#304).

## [0.112.5] - 2026-08-05
### Changed

- `docs/NEXT-SESSION.md` records the three demo dead ends fixed on 2026-08-04 (PRs #321, #322,
  #324), including the two invariants that must survive future edits: `demoRecoveryAction` stays
  synchronous, and chain sends are never retried while balances are never cached.

## [0.112.4] - 2026-08-05
### Changed

- **The sticker sheet on a demo household now says what the demo skipped:** "In the real app, a
  grown-up says yes from their own phone before this lands." The demo lets one visitor play both
  parts, which is right for a demo and wrong to leave a judge believing about the product. Gated
  on `demo_at`, the same flag the self-approve uses, so the note appears exactly where that
  shortcut does and nowhere else. Translated into all five locales.
### Fixed

- **In the demo, approving your own work paid the NIM and then swallowed the sticker.** A kid
  finished their jobs, hit "Waiting for Mom", tapped "Mom is here", watched the money land, and
  was returned to the chart with the sticker sitting behind a second tap on the same card that
  nothing had told them to make. The approval and the sticker are two halves of one moment and
  the app handed back only the first. Both demo self-approval paths (a routine in `waiting.js`,
  a one-off chore in `chart.js`) now carry straight on into the sticker picker once the
  celebration finishes.
- The sticker it opens is found from `cardState -> "reward"`, which already means "approved and
  no sticker yet", so it cannot disagree with the ring the kid is looking at. One approval that
  turns several cards green opens the first; the rest stay collectable by tapping them, as
  before. A household with nothing to place still lands on the chart rather than an empty sheet.

## [0.112.3] - 2026-08-05
### Fixed

- **A rate-limited chain read turned the kid's Treasure Box into 0 NIM.** The public Nimiq RPC
  answers `HTTP 429` under load, and that error travelled straight out of `getClient()`:
  `GET /api/kids/:id/wallet` returned 500, and the kid app rendered a balance of 0 for a child
  holding 42,000 NIM, so every shelf in the Treasure Box read as unaffordable and nothing could
  be bought. Measured on the live testnet demo on 2026-08-04, where one log held 22 of them.
  Chain **reads** now retry with exponential backoff (4 attempts, 400/800/1600ms) in
  `src/nimiq/retry-read.ts`, applied by `getClient()` to `getBalance` and `getHeadHeight`.
- **Sends are still never retried**, and `src/nimiq/retry-read.test.ts` asserts it against the
  source of `getClient()`. A broadcast that throws may still have been accepted, so retrying one
  is a possible double spend. The same test refuses a balance cache: three callers prove a money
  movement by re-reading a balance, and a cache would make them read their own stale answer and
  conclude nothing had landed.
- `src/demo-reclaim.ts` had this retry loop privately, so the hourly reclaim sweep was protected
  while every screen read went bare. It now uses the shared one and no longer double-wraps
  `balanceOf`, which would have cost one rate-limited read sixteen attempts.
- Each retry logs `[rpc] <call> attempt N failed ..., retrying in Nms`. Silence is what let 22
  rate-limited reads in one evening look like an app with no chain problem at all.

## [0.112.2] - 2026-08-05
### Fixed

- **The demo's parent app asked judges to sign up instead of showing them the demo.** A seeded
  household is swept four hours after it is minted, which deletes its `parent_tokens` row,
  while `kidsParentToken` in the browser never expires. Every return visit to
  `demo.nimiq.kids/parent/` therefore 401'd, and the app answered that by dropping the token
  and rendering the first-run "Welcome to nimiq.kids / Create your family" screen. The seeded
  two-kid household, its paid history and its stocked Treasure Box were simply gone. A 401 on
  a seeded-demo instance now goes to the entrance and re-mints, which is what the kid app has
  done since #12. Arriving at `/parent/` with no token at all (a shared link, an installed
  shortcut) takes the same path, because on an instance whose whole job is handing out a
  household there is no self-serve sign-up worth landing on.
- The decision is `public/parent/demo-recovery.js`, a pure function alongside
  `token-capture.js` and `onboard-gate.js`, and it is **synchronous on purpose**. Gating it on
  the in-flight `/health` read delayed the signed-out screen on the competition and family apps
  from 89ms to 8s against a hung `/health`, which is exactly the request a lapsed Cloudflare
  Access session hangs. `src/parent-demo-recovery.test.ts` holds both halves, including that
  `core.js` never awaits it.

## [0.112.1] - 2026-08-04
### Changed

- `docs/NEXT-SESSION.md` records the lock schedule (#303, #319): why a window hangs off its
  routine rather than the household, why an end before its start is a bedtime window and not a
  validation error, that Monday is index 0 in the day mask, and why deleting a window is a real
  delete when nothing else in this tree is. Also the two refusals (an empty week, a duplicate)
  and the fact that live databases already carry duplicate seeded windows.

## [0.112.0] - 2026-08-04
### Added

- A parent can set the lock schedule from their own phone (#303). The times of day the tablet
  stays locked until a routine is done and approved lived only in `src/scripts/seed.ts`:
  `addLockWindow` had exactly one non-test caller in the tree, so every household that ever
  installed nimiq.kids ran on the two windows the seeder happened to write, with no way to
  change them short of opening the database. The lock state machine has handled weekday masks,
  windows that cross midnight, DST and most-restrictive-wins since Phase B; this is the
  steering wheel.
  - The schedule sits on the routine's own card on the board, because a window is a sentence
    about that routine rather than a setting about the tablet. Two native time fields, seven
    day circles, and an echo underneath that says the rule back in words as the switches move:
    *"Weekdays from 6:30 AM to 8:30 AM, the tablet stays locked until Morning routine is done
    and approved."* A window whose end is not after its start crosses midnight, which is what a
    bedtime window is, so it gets its own sentence instead of a range that reads backwards.
  - `POST`, `PATCH` and `DELETE /api/routines/:id/windows[/:wid]`, parent-authed and
    family-scoped exactly like the routine's steps. Each one publishes a lock change, so a
    paired tablet re-computes on the stream it is already holding open rather than waiting for
    its next poll.
  - An all-zero day mask is refused rather than saved: a window that can never fire is how a
    parent comes to believe they set a schedule they did not. A duplicate is refused too, since
    the machine reads two identical rows as one and they are only ever confusing to read.

## [0.111.0] - 2026-08-04
### Added
- Two new goal-ladder themes. **Unicorns** is a GROWTH pack — the house unicorn at six ages,
  from her egg to the great winged unicorn — and **Unicorn friends** is a COMMUNITY pack of six
  unicorns of one world, each one's mane made of her own element: petals, water, grass, fire,
  night sky, and cloud for the boss. Each unlocks its own app wallpaper on completion, the
  cloud kingdom and the glade.
### Fixed
- The demo only worked the second time you opened it. A demo household is swept four hours
  after it is minted, which deletes both of its bearer tokens, but the four localStorage keys
  naming them never expire. `/demo` decided a returning visitor "already has a family" from
  those keys being *present*, so it offered two buttons into a household the server had
  forgotten: `/kid/` booted, `/api/children` answered 401, and the kid app's own demo recovery
  bounced the visitor straight back to the entrance. The tap looked like it had done nothing.
  The page now asks `/api/children` whether the household is still there before offering it,
  and mints a new one when the answer is 401. A network failure is not a dead family, so
  offline still keeps whatever the visitor had.

## [0.110.9] - 2026-08-04
### Changed

- `docs/NEXT-SESSION.md` records why screen time needs a paired tablet (#306, #315): the one
  place the rule lives, why it hides the tile rather than greying it, why the shared category
  row is never retired to do the hiding, and the two claims in the issue that the real
  databases do not support.

## [0.110.8] - 2026-08-04
### Fixed

- The Treasure Box no longer sells screen time to a household with no tablet paired (#306).
  The unlock override a purchase writes is read by exactly one thing in the world, a paired
  device asking what its screen should do, so with none paired the kid's real NIM bought a
  minute that could not exist anywhere. The tiles are off the shelf until a tablet is paired,
  and the buy is refused server-side (`409 no_tablet`) before any charge. The shelf comes back
  by itself the day the tablet does, with no row written and no client change.

## [0.110.7] - 2026-08-04
### Changed
- `docs/NEXT-SESSION.md` and `docs/KIOSK-CONTRACT.md` record the override-author rule: a
  parent's row outranks a kid's purchase regardless of which was written last (#301).

## [0.110.6] - 2026-08-04
### Fixed
- A kid could spend real NIM in the Treasure Box and end a parent's grounding. Lock
  overrides now carry an author, and a parent's row outranks a purchase no matter which was
  written last; buying screen time while a parent lock is live is refused before any money
  moves (`409 locked_by_parent`), with the shelf greyed and named rather than silently
  failing on the tap (#301).
- Buying more screen time destroyed the minutes already paid for: 15 more with 55 on the
  clock left 15, not 70. A purchase now extends the live one (#302).

## [0.110.5] - 2026-08-04
### Fixed

- **The kid calendar's back arrow stops at the month their history starts.** Forward has always
  stopped at the month Today is in, because a kid cannot have done chores in the future; back had
  no bound at all, so holding the arrow walked the calendar into 2019 one empty grid at a time.
  The bound is the earliest day the calendar can actually draw — a routine run, a practice
  session or a placed sticker — and deliberately **not** the child's join date, since a demo
  family is minted today with four weeks of history seeded behind it.

## [0.110.4] - 2026-08-04
### Changed
- Added `docs/funding/`: research on every Nimiq Community Council decision since March 2026, plus the drafted Rive animation proposal for the kid-facing app.
- Corrected the ROADMAP's Rive grant figure from "5 to 10 thousand" to $4,500, the largest sum the Council has ever approved.

## [0.110.3] - 2026-08-04
### Changed
- A sticker theme's two kinds are **growth** and **community**, not "family" and "community".
  `family` already meant the household, and separately the house art style, so a third meaning
  would have made the word impossible to search for. Comments and docs only, no behaviour.

## [0.110.2] - 2026-08-04
### Added
- **Goal ladders collect a sticker THEME.** A ladder can be pointed at a set of five stickers
  plus a boss, and each rung climbed hands over the next one. The collection is the unit, not
  the ladder: a three-rung ladder gives three and a two-rung ladder finishes the set, across as
  many ladders as it takes.
- **A theme is earned, never sold.** No theme appears on the Treasure Box shelf at any price, so
  a big balance cannot shortcut a climb.
- **Collected is not the same as usable.** A theme sticker sits in the collection and cannot be
  placed on anything until the set is finished; finishing it lands the boss and releases the
  whole pack into the picker at once.
- **The Dragons theme**, a GROWTH set: one dragon growing up, in order. An egg, a hatchling, a
  young dragon, horns, scales, and the great dragon breathing fire.
- **The Dragon friends theme**, a COMMUNITY set: six dragons of one world, each with its own
  colour and its own feature, in no order at all.
- **Finishing a theme also unlocks an app background.** The wallpaper appears in the kid's own
  Background picker, and only for the kid who earned it.
### Changed
- The parent's board splits its styles into `public/parent/board.css`; `parent.css` had reached
  814 lines, over the 800-line CI guard.
- Choosing an app background now takes the same guard a timer style takes: the four built-in
  scenes stay free, and anything else has to have been earned.

## [0.110.1] - 2026-08-04
### Changed

- **Five stickers redrawn, judged at the size a kid actually sees them.** Smiley is a sun now
  — the old one was a plain circle with a face, which at the 34px calendar disc read as an
  amber dot beside moon and star2, and it carried a grey wisp left from its plate cut. The fish
  has a fanned tail and dorsal fin that break its outline instead of being an orange teardrop,
  the shell is a scallop that survives being shrunk rather than a pink croissant, the unicorn
  has a cream body so it separates from the white disc it sits on, and the bear reads as a bear.
  **The unicorn and the bear are also egg-timer heroes, so both were swapped in lockstep** —
  a kid meets one bear in this app, not two.
### Fixed

- **Stickers are no longer clipped by their own disc.** `object-fit: contain` fits a
  sticker's bounding box to a square, and `border-radius: 50%` clips to the circle
  inscribed in that square — so a square's corners sat 5.2px outside it and the ink that
  reached them was cut. All 30 files are re-cut onto a square canvas that their ink's
  enclosing circle is inscribed in, so nothing is clipped on the calendar, the chart, the
  picker or the Treasure Box. The unicorn was losing 17.4% of its drawing, the fox 10.7%,
  the shell 9.6%; 29 of 30 lost something. Art that used to reach into the corners now
  draws about 11% smaller, which is the whole cost. `tools/recut-stickers.py` does the cut
  and `src/sticker-art.test.ts` keeps new art honest.
- **A redrawn asset reaches the tablet.** `/assets/` was served with no `Cache-Control`
  and no validator, and sticker URLs come out of the database rather than the HTML, so
  nothing stamped them — Cloudflare caches `.png` by extension regardless, which would
  have left this very fix invisible behind the edge. They revalidate now.

## [0.110.0] - 2026-08-04
### Added
- The demo family arrives with four weeks of history behind it. Most past days carry the
  sticker the kid put there, so the calendar opens on a household with a track record
  instead of a month of empty dates. It costs nothing: the trail is work done, not money
  moved, so no transaction is sent and the grant is untouched.
- The kid calendar pages between months. A back arrow reaches the weeks before this one;
  forward stops at the month Today is in, because there are no chores in the future.
- Every demo kid now has a practice they have been keeping up (Sam reads, Ava plays
  piano). Practices ship and they pay NIM, and until now the demo seeded none, so a judge
  had no way to meet the feature at all.
### Fixed
- Stickers are no longer cropped by their own circle. Each drawing is cut to its own
  outline at its own aspect, from 0.68 for the alien to 1.61 for the rainbow, and the disc
  was filling itself with `object-fit: cover`, so the wide ones lost 38% of their width
  and the tall ones a third of their height. They are fitted whole now, and a calendar day
  draws them at 34px rather than 24px. A photo sticker still fills its circle; it has no
  silhouette to protect.
- A finished day belonging to last month is no longer drawn as a ghost. The calendar grid
  is whole Monday weeks, so on the 3rd of a month five of the seven dates in the row above
  Today belong to the month before, and fading the whole cell to 35% took a week of
  finished work with it. The date number still fades; the sticker does not.

## [0.109.0] - 2026-08-04
### Added
- **Goals: a ladder a kid climbs, one priced step at a time.** Single leg, then hold it for
  thirty seconds, then both legs. A job answers "what today" and a practice answers "how often
  this week"; a goal answers how far have I got, which is a third question neither of the other
  two could be bent into. Each step carries its own price and pays when the parent says the kid
  got there, exactly as a job does.
- **The parent chooses how a ladder is worked through, per goal.** In order, where the next step
  opens only once the one before it has been paid; or any order, where every step is theirs to
  try. Holding a plank longer every week is a sequence. Five swimming badges are not.
- Goals are a fourth section on the board, and a fourth group on the kid's Today screen, under
  Practice. The kid's card says how far they have got, names the step they can actually try
  next, and prices what is left on the ladder.
### Fixed
- `purgeFamily` now clears a household's practice steps, their ticks, and its goals and rungs.
  A demo household that had used either feature would have refused to purge, and because the
  throw escapes the sweep loop it would have taken every household after it in that cycle
  down too.

## [0.108.0] - 2026-08-04
### Added
- **A practice can be made of exercises, and a day pays the ones the kid ticked.** Piano is
  scales, then the song, then sight-reading; until now a kid who did two of the three was paid
  for three or paid for nothing, because the whole day carried one price. A parent breaks a
  practice into ordered exercises and prices each one, the kid ticks what they actually did,
  and the day is worth the sum of the ticked ones. That is the rule `runRewardLuna()` has
  always used to pay a routine run, now running on a practice day too rather than a second one
  being invented beside it.
- The parent's queue card lists every exercise, ticked or skipped, above the amount it pays.
  It is the same list a routine's steps already draw.
### Changed
- **A practice with exercises is priced by its exercises alone**; its own reward field is gone
  from the sheet, because a price stored in two places is a price that comes to disagree with
  itself. A practice with no exercises is unchanged in every respect.
- Adding, repricing or retiring an exercise takes the parent's PIN and is refused
  (`409 day_awaiting_approval`) while a day of that practice is waiting to be paid. That is the
  rule the practice's own reward already followed, extended to the fields that replaced it.
- The kid ticks in a sheet and taps "I'm done" once. That logs the day, opens the approval and
  fixes the amount, so the number in the parent's notification and the number on their card
  can never drift apart. A second tap the same day is the idempotent nothing it always was.

## [0.107.3] - 2026-08-04
### Fixed

- A grown-up can change the wallet they pay from. The control was offered only to one who
  had no address yet, which is a dead end for the case the fallback creates: a household
  that predates multi-grown-up support came through the migration with its owner already
  carrying an address, and on the live mainnet household that inherited address is the
  instance's old hot wallet, which nobody holds a key for. Every approval minted an intent
  naming a sender that could not sign and no screen could correct it.
- The Top up card stopped claiming to be the wallet that pays. It writes the household till,
  which since the grown-ups split is a different address from the payout sender, and the
  copy went on promising "every payout you approve is sent from this address" while it was
  false. It now says what the till is for and points at Settings for who pays.

## [0.107.2] - 2026-08-04
### Changed
- `docs/NEXT-SESSION.md` opens with the 2026-08-04 state: grown-ups, the one art family, and the two traps each of them left behind.

## [0.107.1] - 2026-08-04
### Changed
- **The egg hatches into the art we actually approved.** The 21 pastel characters built for
  the egg rig have shipped inside the app since the rig port; nothing loaded them, and the
  hatch drew at random from eight saturated ones that were rejected on 2026-07-31 for reading
  "like a different product". The hatchling catalogue now serves the 21, and the eight are
  deleted. No new art was generated — this is wiring.
- The portal's dino is the same file as the timer's dino now, rather than a second copy at a
  second size.
- **All 30 stickers are redrawn in that same family, and the coloured plate is gone.** The
  plate was what made the sticker set read as imported from another app — nothing else in
  nimiq.kids sits on one. Objects wear the family's face now (a star smiles, a trophy smiles).
  Seven of the thirty are not new art at all: bear, bunny, dino, fox and unicorn ARE the hero
  files, and cat/dog are the hero kitten and puppy — so a creature is drawn once in the whole
  app instead of four times.
- **The old in-app egg rig is deleted.** `js/egg.js` drew the character peeking out from
  INSIDE the shell — a composition that was rejected twice — and stopped being reachable when
  chores and routine tasks both moved onto the real timer (`/kid/timer/`, the one with the
  locked faces and break). It had been dead code since; the file, its stylesheet, its two dev
  pages and its service-worker precache entries go with it, along with `egg2.js`.

## [0.107.0] - 2026-08-04
### Added
- **A household can hold more than one grown-up, and each pays from their own wallet.** The
  other parent and the grandparents join with a 6-digit code, approve from their own phone, and
  their approval mints a transaction from *their* address to the kid. Two houses, one kid's
  account, and the tablet stops travelling. Settings → Grown-ups.
- Three roles. The **owner** runs the household; a **co-parent** runs the board (jobs, prices,
  routines, practices, kids, the Treasure Box); **family and friends** approve and pay but
  cannot change what a job is worth. Money in, no say over the terms.
- Notifications now reach every grown-up who has set up their own phone, not one household
  topic. Without that the second household would have had a feature they must remember to go
  and look at.
- An approval card names whose wallet is involved, including the case that matters: a payout
  another grown-up has already started. Those bytes are pinned to their wallet, so the card
  says so instead of sending you into a wallet that declines.
### Changed
- `families.parent_address` is now the household **till** only — where a Treasure Box spend
  returns to and what a family transfer targets. Who **pays a kid** is the approving grown-up's
  own address. They start equal for every existing household and nothing about a payout moves
  the till.
- A kid's address is refused if it belongs to *any* grown-up in the household, not just the
  family wallet. Same silent nothing (a transaction to self moves no money and errors nowhere),
  one member further out.
- The first-run 6-digit screen accepts either kind of code — an invitation to join a household,
  or the pairing code that re-attaches a phone whose magic link was eaten by a WebView.

## [0.106.0] - 2026-08-04
### Added
- **A parent can set what a sticker pack costs their household (#288).** Packs, the seeded
  coupons and the screen-time tiles are one shared catalogue row per item, which every family
  on the instance reads, so the write path refused them and the shelf manager drew a padlock.
  A price now lives per family in `store_item_overrides` and is joined in on every shelf read,
  so the ladder a household builds is theirs alone. Sticker packs unlock on the parent's
  Treasure Box manager, opening a sheet that sets a price and nothing else: a catalogue row's
  name keys its translations and its payload points at the stickers it grants, and neither is
  a parent's to move. Typing the catalogue's own price back in withdraws the override, which
  hands that row back to the catalogue.
### Fixed
- `GET /api/kids/:id/stickers` no longer serves a pack price. `sticker_packs.price_luna` is a
  second copy of a number the Treasure Box charges from `store_items`, so once a family could
  set their own it would have shown one price on the sticker book and taken another at the
  till. That endpoint is inventory; the shelf is `GET /api/kids/:id/store`.

## [0.105.0] - 2026-08-04
### Changed
- **A kid's photographs stay on the kid's device (#282).** A photo sticker is written to the
  tablet's own IndexedDB and only its `local:<uuid>` handle reaches the server, so the sticker
  row and its placement are all the server can know. The picture renders on the device that
  took it; anywhere else the sticker wears a camera stand-in rather than a broken image.
- Proof photos still reach the server, because the parent has to see them, but they no longer
  stay: the photo is deleted the moment the approval is decided, with a 24h TTL backstop swept
  lazily at the top of the approvals read path and on every upload. No cron to die quietly.
- `POST /api/media` refuses roles `sticker` and `hatch`. Neither has had a writer since the egg
  timer was vendored in and the sticker bytes went local.
### Fixed
- The Polaroid timer drew its mystery photo from server media, which this change empties. It
  now reads the same photographs off the device, so the surprise survives instead of quietly
  degrading to fallback art for ever.

## [0.104.2] - 2026-08-03
### Changed

- **Deleted the kid app's unreachable customization studio.** `public/kid/js/studio.js` held
  four bottom sheets (hatch / timer / sounds / background). The Timer dock has opened the
  vendored egg timer in an iframe since v0.59.0 and that timer brings its own character, sound
  and background sheets, so three of the four had no caller left; the hatch sheet's job is done
  by the timer's own character grid. Only the Treasure Box handoff was still reached, so it
  moved to `public/kid/js/timer-style.js` under a name that says what it is. Seven locale keys
  that nothing referenced any more went with it, in all five languages. No behaviour change.

## [0.104.1] - 2026-08-03
### Fixed

- **A kid can take a photo back off the egg timer's character sheet.** Photos only ever
  accumulated: one could be unticked so it would not hatch, but it stayed on the sheet
  forever and kept its share of the localStorage quota — and that quota fails by throwing,
  which the timer catches into a photo that silently refuses to be added. So a kid who
  snapped enough eventually could not add another and had no way to make room. Each photo
  tile now carries a delete badge; two taps (arm, then confirm) so a stray tap cannot take
  a picture that is gone for good. Drawn characters are untouched — only the kid's own
  photos are removable, and the chosen set can still never be emptied.
- `DELETE /api/media/:id` answered **500** for the one asset most likely to be deleted.
  `kid_prefs.hatch_asset_id` is a real foreign key and the database runs with
  `PRAGMA foreign_keys = ON`, but the delete ran bare, so removing a photo a child had
  selected raised `SQLITE_CONSTRAINT_FOREIGNKEY`. It now clears the referencing preference
  (and drops that kid back to a surprise) in the same transaction, the way `purgeFamily`
  always has.

## [0.104.0] - 2026-08-03
### Changed
- `nimiq-settlement` pinned to `v0.3.0` (was `v0.2.0`).
### Fixed
- The connected-wallet balance in the corner control no longer under-reports a Nimiq Pay
  wallet that has NIM parked in a swap HTLC — sometimes all the way to zero, which told a
  solvent visitor they were broke. `GET /api/wallet/balance` now adds back the unexpired
  HTLC contracts the address funded, via `createHtlcAwareBalance` from nimiq-settlement
  v0.3.0. The walk that finds them costs ~13.3s against ~0.35s for a basic read, so it runs
  in the background and never delays the response; the reply carries `htlcAware` to say
  which of the two numbers it is. Display only — no spend or credit is gated on it.

## [0.103.14] - 2026-08-03
### Fixed

- Top-up attribution no longer pre-checks whether the sender can afford the transaction.
  That check was a second, weaker judgment standing in front of `topUpExecuted()`, which
  already proves execution from chain (the sender's balance falling by value+fee AND the
  hot wallet receiving it). It could only ever subtract: any balance read that understated
  the sender silently skipped the budget credit for money that really moved. An unfundable
  transaction now waits out the confirmation timeout instead of bailing immediately, and
  still credits nothing.

## [0.103.13] - 2026-08-03
### Changed
- Dropped the "Built for the Nimiq Mini Apps Competition." line from the site footer. The
  now-unused `.ftr-note` rule went with it, so the footer is one row: lockup and links.

## [0.103.12] - 2026-08-03
### Fixed
- The site footer now carries the real `NIMIQ.kids` lockup. It was a bare Nimiq hexagon with
  the words "nimiq.kids" retyped beside it, so the footer shipped no hand in the mark and no
  logotype at all — the one thing `public/assets/brand/README.md` says never to do.
- `nimiq-kids-lockup-light.svg` sets `.kids` at Mulish 700, matching the dark and mono
  lockups and the rest of the `NIMIQ.x` fleet. It was alone at 400, so the suffix visibly
  changed thickness between the light and dark files of the same mark.

## [0.103.11] - 2026-08-03
### Fixed

- **The hero video on the marketing page now plays. It was the `Referrer-Policy` header, not
  the video.** `Referrer-Policy: same-origin` applies to every outbound request the document
  makes, including the hero's YouTube iframe, so YouTube received no `Referer`, could not
  identify the embedding site, and rendered **"Error 153, Video player configuration error"**
  where the player should be. The uploads were healthy throughout: public,
  `playableInEmbed: true`, fully processed to 1080p. That is what made this so expensive. Two
  separate videos were re-recorded and re-uploaded on the assumption that the video was broken,
  and the second one landed in a hero that failed for exactly the same reason as the first.

  The header stays as it is, because the reason for it stands: a kid-app URL can carry a child
  id. The embed now sets an element-level `referrerPolicy = "strict-origin-when-cross-origin"`,
  which overrides the document policy for that one request and sends the **origin only**, so
  YouTube learns `https://nimiq.kids` and never a path. `src/marketing-video-embed.test.ts`
  pins the coupling, since nothing in the marketing page hints that a header set in a
  middleware three directories away decides whether its hero works.

## [0.103.10] - 2026-08-03
### Changed

- Three rows added to the SETTLED table in `docs/NEXT-SESSION.md`, all about the first real
  mainnet payout: the server half does not need re-running, it does NOT close ops #3, and the
  throwaway family it left in the live database stays. Each is a question the file would
  otherwise invite, since the run is written up as a newest-first log entry.

## [0.103.9] - 2026-08-03
### Documentation
- The parent-signed payout path is proven on mainnet with real NIM: 1 NIM relayed and settled
  end to end on a keyless instance. `docs/FIRST-PAYOUT.md` records the transaction, the exact
  list of what the run covers, and the fact that the Nimiq Hub leg is still unproven, so ops #3
  stays open.

## [0.103.8] - 2026-08-03
### Changed
- The kid login gate's twelve secret pictures are drawn art instead of raw emoji. Generated
  from the same locked Higgsfield prompt as the chore icons (`icon-style.txt`), so they are
  siblings of the 45 already shipped rather than a second look.
- **The twelve subjects and their order are unchanged**, because the stored secret is an
  index: a reorder would not throw, it would quietly mean a different picture and tell a kid
  who tapped what they remember that they were wrong. The emoji stays as the label, the
  offline fallback and the thing a grown up says out loud ("the rocket, then the frog").
- The emoji and its art are now one row in `kid-switch.ts` rather than two parallel arrays,
  and two new tests hold the line: one freezes the picture order against exactly that silent
  reorder, one asserts every picture has art and that the file it names is on disk.
- All twelve are in the service worker's precache, unlike the task icons where only a subset
  is. This is the login gate on a shared tablet — a gap here is a kid who cannot get in.

## [0.103.7] - 2026-08-03
### Changed
- The fixed top chrome (the back-button line, the language corner, and the shared
  `--kid-chrome-*` / `--kid-corner-*` measurements) moved out of `wallet.css` into
  `public/kid/css/chrome.css`. `wallet.css` was 796 lines against the 800-line CI guard, so it
  had no room left; this is the same split `box.css` got out of `chart.css`.
### Fixed
- Kid app on tablet/desktop (>=768px): the kid's identicon no longer hangs out of its own name
  pill. The tablet block scaled the hexagon to 64px while `--kid-corner-h` stayed at its 46px
  phone value, so it overflowed the white capsule by 9px top and bottom and the language pill
  beside it stayed phone-sized. The identicon, the pill that holds it, the language flag and
  the band every screen reserves are now all derived from one `--kid-ident`, which is the only
  thing the tablet block changes.
- Treasure box title no longer sits 96px right of everything it titles. Its header reserved a
  left lane for the back button, but that header is pushed a full corner-band below the button
  and never shared a row with it, so the lane was dead space. "Treasure box" now starts on the
  same line as "Sticker packs" and the cards beneath it. Phone layout unchanged.

## [0.103.6] - 2026-08-03
### Fixed
- The bottom tab bar no longer draws on the first-run screen that asks it to hide. The
  `hidden` attribute is a UA-stylesheet rule, so `.pnav { display: flex }` outranked it and a
  parent with no family yet was shown four destinations that do not exist (#241). The same
  shape was hiding a second bug: the shared job picker's search set `hidden` on `.jp-tile`,
  which also names a display, so typing filtered whole groups and no tiles in either app. Both
  are fixed by one `[hidden] { display: none !important }` per app rather than a patch per
  selector.
- A refused sign-up now says which wait it is. `POST /api/onboard` answered `429` with the
  generic "That didn't go through. Try again", which is the one instruction that cannot work
  when the refusal IS that they tried again (#242). The per-IP hour and the instance's day were
  also one error code and are now two, because an hour is the honest answer to the first and
  the wrong one for the second.

## [0.103.5] - 2026-08-03
### Fixed
- **Bug reports carry their diagnostics again, without carrying a child's id** (#140).
  `nimiq-app-shell` moves to **v0.9.2**, which redacts any UUID as `[id redacted]` alongside
  the NQ-address shapes it already caught, and cuts a captured `url`/`referrer` at the first
  `?` or `#`. Both shells turn `diagnostics` back on, so a report once again arrives with the
  page it came from, the last failed requests and the last console errors. That is the half
  that identifies a bug, and the half that switching them off used to cost every report.

  The scrub is a dependency's promise, so it is tested as one rather than trusted.
  `src/bug-report-privacy.test.ts` drives a realistic payload (a child UUID in the path, in
  the query string, inside a `kid_<uuid>_v2` key, in a `console.error` line, plus an NQ
  address) through the shell's real `submitToBot` with `fetch` stubbed, and reads the body
  that would have been POSTed, including the leg that files the issue service's own
  LLM-written draft. `tools/bugreport-verify.py` does the same against the built browser
  bundles in Chromium at 390x844, through both apps' real corner menus. A pin that resolved
  to a stale build fails both; a version string cannot.

  One thing is deliberately NOT redacted, and a test now pins it so it stays a decision: a
  failed request keeps its own query string, so a query *key* still travels, with the value
  scrubbed. Keep ids there, where the scrub reaches them, and never a secret.

## [0.103.4] - 2026-08-03
### Fixed

- `tools/apex-flip-verify.py` asserted the sign-up path was broken. It was written against the
  pre-#239 apex, where the primary was live and tapping it answered 400. Now it asserts the
  fix: no "Optional right now" claim under parent custody, and Create held disabled until a
  wallet is connected.

## [0.103.3] - 2026-08-03
### Added
- The wallet is a stated STEP of sign-up under parent custody, above the name fields rather
  than a surprise after them: what it is for, that payouts come out of it, and that nothing
  can be created without it. The primary button does not fire until it is done, and
  `address_required` now arrives as "Connect your wallet first. It is the one your kids get
  paid from" in all five languages.
- `public/parent/onboard-gate.js` — the custody decision as pure functions, so "the optional
  claim is unreachable under parent custody" is an invariant with a test rather than a
  condition spread over a template.
### Fixed
- Signing up on a `HATCH_CUSTODY=parent` instance works again. The flip to parent custody
  made the parent's own wallet the sender of every payout, so `POST /api/onboard` refuses a
  household that brings no address (`address_required`) — correctly. The screen in front of
  it did not know: it called the wallet "optional right now", left the primary button live,
  and turned that refusal into "That didn't go through. Try again" on the one screen with
  nothing behind it. Two names, one tap, HTTP 400, no way forward.
### Unchanged
- Server custody, deliberately and provably: `tools/onboard-custody-verify.py` renders the
  first-run card twice on one instance, once with `origin/main`'s `views-onboard.js` served
  over this branch's, and compares the two byte for byte. The testnet demo is the competition
  judge path. Custody is read from `/health` at boot and never inferred from a failed
  response, and an instance that has not answered yet gets the shipped screen.

## [0.103.2] - 2026-08-03
### Added

- `docs/FIRST-PAYOUT.md`, the one page a human needs to sign the first real payout on a
  parent-custody instance, plus the two rehearsal harnesses behind it:
  `tools/flip-morning-rehearsal.py` walks the whole path against a copy of the live mainnet
  database and stops at the signature, and `tools/apex-flip-verify.py` reads the live apex at
  phone width.

## [0.103.1] - 2026-08-03
### Fixed
- A kid with no registered address no longer breaks the screens that draw them. On a
  `HATCH_CUSTODY=parent` instance that kid is the normal first state of every kid, and both
  `GET /kids/:id/wallet` and `GET /kids/:id/staking` answered `500` for them, so the first
  thing a parent saw after adding a kid was a home screen stuck on a dash and a kid app
  claiming the chain was unreachable. A read now asks to READ, not to PROVISION: `address`
  comes back null and every screen says "no address yet" in words. The provisioning refusal
  is untouched, and every path that moves NIM still refuses in front of the queue with
  `kid_address_not_registered` rather than crashing inside it (#236).

## [0.103.0] - 2026-08-03
### Added
- **Every kid gets an address in one trip to the wallet.** `POST /api/family/connect-challenge`
  and `/connect-addresses` (#213) had no caller in any browser; the parent app now offers the
  batch on the family home whenever two or more kids are still waiting. One sheet names the
  kids and the COUNT the Keyguard is about to name, one tap, one popup, and the household comes
  back registered (`public/parent/views-connect.js`, `public/parent/connect-batch.js`).
  `window.hatchParentShell.hub.connectAccount` is the new shell seam it rides on.
### Changed
- The per-child registration flow is unchanged and stays on each kid's own page. It is the
  stronger evidence and the batch does not replace it: a batch challenge names the FAMILY, so
  which address belongs to which child is the client's assertion, recorded as such in
  `children.address_proof_kind`. The batch is offered only from two kids up, because with one
  kid it is the same single popup with a weaker record.

## [0.102.8] - 2026-08-03
### Tests
- `pendingStakeLuna` is now covered end to end: a real pending stake row, through
  `GET /kids/:id/staking` and `GET /kids/:id/wallet`, into the Grow screen's real render.
  Pins that a stake in flight is explained on screen and that the "put some NIM here" hint
  stays out of its way, which is the regression that once made a live stake look like it had
  failed. Eight mutations of the four production clauses were checked, and each turns the
  suite red.
- One shared `icons.js` stub (`src/kid-icons-mock.ts`) for every kid-app test. The last
  `mock.module()` registered in a run wins for the whole run, so a narrower stub in one file
  broke an unrelated file with a link error naming neither of them.

## [0.102.7] - 2026-08-03
### Added

- The parent app can point the household at the wallet that pays for it.
  `PATCH /api/family/address` shipped in #136 with no caller in any browser, so a family
  created before the flip kept the instance's own hot wallet as the sender of every payout
  intent, and the parent's wallet answered "Address not found" when asked to sign one. The
  family wallet screen now shows that address and offers one button to replace it with one
  out of the parent's own wallet.
### Changed

- Under parent custody the family wallet screen drops the three top-up cards. They fill a
  shared hot wallet that a keyless instance does not have, and shown together they put two
  different addresses on one screen with only one of them meaning anything.
### Fixed

- A database stamped by a seed-holding instance can now boot seedless under
  `HATCH_CUSTODY=parent`. The stamp guard treated "this database had a seed and this process
  has none" as one event; it is two, and under parent custody it is the migration working
  rather than a misconfiguration. The refusal now names `HATCH_CUSTODY=parent` as the
  supported way to run without a seed. Nothing else about the stamp moved: the wrong network
  still refuses, a changed seed still refuses, and rolling the flip back is not blocked.

## [0.102.6] - 2026-08-03
### Changed
- The language pill has no grey outline. It reads as a control through its white surface and
  shadow instead, matching the kid's name pill beside it. The line came from the shell, so the
  fix did too (`nimiq-app-shell` v0.9.1) and every app on the shell gets it.

## [0.102.5] - 2026-08-03
### Changed

- **All sound is off.** The hatch, the five-second countdown, the during-timer beds, the
  end stings, the spoken reminders and the app's confetti are all silent. Andjroo, on
  hearing the lot in production: "lets remove all sound for now, it needs some work."
- Nothing was deleted. The audio files, the timings, the iOS unlock, the vendor sync and
  the generator in `tools/sound/` all stay exactly as built and proven — this pauses the
  output, not the machinery. Two `SOUND_ON` constants turn it back on: one in the timer,
  one in `public/js/lib/confetti.js`.
- The guard sits on **every** function that can produce a sound rather than at one choke
  point. `sfxPrime()` reaches its elements directly while the bed, sting and reminder go
  through `clip()`, so gating the shared helper alone would have left the Start-tap prime
  audible — which is exactly the leak that was reported once already.

## [0.102.4] - 2026-08-03
### Changed

- `docs/NEXT-SESSION.md` carries the practices-pay-NIM session (v0.102.3), and records the
  decisions inside it that must not be re-litigated: the subject is the DAY, and declining a
  day refuses the payment without un-logging it.

## [0.102.3] - 2026-08-03
### Added

- **A practice pays NIM, like a chore.** Logging a day of a practice worth something opens the
  parent's approval instead of minting anything, so the one self-reported thing on the board
  still crosses the same queue every other payout crosses: it passes `checkPayable`, mints a
  signing intent under `HATCH_CUSTODY=parent`, and nets against deferred spending. The subject
  is the DAY (`practice_session`), never the practice, which is what makes the payout ref
  unique per day: a week of piano is a week of payments and a second tap on today buys nothing.
- The reward field is back on the parent's practice sheet, and the kid's card wears the same
  NIM pill a job wears while a day is waiting to be paid.
### Changed

- **A practice's reward cannot be moved while a day of it is waiting**, and changing it at all
  now needs a grown-up. A kid practised for the number that was on the card; repricing while
  that day sits in the queue would change what they are paid for work already done. Same rule
  `PATCH /chores/:id` states as "a promise stops being editable when it is claimed".
- Declining a practice day refuses the PAYMENT and nothing else. The day stays counted and the
  sticker stays placed: the week count and the streak are the kid's own record of a habit they
  own, and wiring payment must not quietly make the parent the referee of those too.

## [0.102.2] - 2026-08-03
### Added

- **The app's confetti makes a sound.** Confetti fires at ten places in the kid app — a
  chore finished, NIM arriving, a treasure box opened, screen time bought, a sticker
  placed — and every one of them was silent. The sound lives inside `celebrate()` rather
  than at the ten call sites, so it is a property of celebrating and the next celebration
  anyone adds is not silent by default.
- **Two sizes of moment.** A short pop by default; the film's real recording of the four
  children when money actually arrives (a claimed cashlink, NIM landing in the kid's
  wallet). A two-second cheer every time a sticker is placed would stop meaning anything
  by the third one.
- Both files are precached in the service worker. Nothing else pulls them — they are
  fetched by `new Audio()` at the moment of celebrating — so without explicit entries an
  offline tablet would celebrate in silence until the first time it was already online.

## [0.102.1] - 2026-08-03
### Fixed

- **A test that went red every Monday and green the other six days.** "A practice session
  wears its own sticker, one per day" logged a session *yesterday* and *today*, but the
  chart renders exactly one week (`weekDays(mondayOf(anchor))`). On a Monday, yesterday is
  Sunday and belongs to the previous week, so only one of the two sessions came back and
  the test saw one sticker where it wanted two. Both days are pinned inside one settled
  week now and the chart is asked for that week by `?week=`, so nothing about the test
  depends on the day it runs. No production code changed — the app was right, the test
  was reading a window it had not accounted for.

## [0.102.0] - 2026-08-03
### Changed
- The kid's balance leads the home screen. It was a third white pill wedged between the kid's
  name and the language flag, capped at 46% of the width by the lane the corner control
  reserves, so a six-figure balance ellipsed before it was ever big. It is now its own card
  under the name, on the money screen's own shape — the screen it opens.
### Fixed
- The language pill is the same size as the kid's name pill. `--kid-corner-h` has said 46px
  since 2026-07-30 and the pill has been 40px the whole time: the app's override sat at
  `.kid-lang .nq-cc-face-flag` (0,2,0) and the shell ships
  `.nq-cc[data-face="lang"] .nq-cc-face-flag` (0,3,0), so it lost silently. Its flag hexagon
  now reads at the same scale as the kid's identicon, and it is opaque white like the pill
  beside it instead of 92% white.
- "Add a job" no longer collapses to a dashed line when today is full. Everything in the
  scrolling `.ch-groups` column is `flex: none`, so overflow pushes the scrollbar instead of
  being paid for by squashing whichever child had no content to defend itself.

## [0.101.2] - 2026-08-03
### Added

- **The sounds sheet and the reminder sheet make sound.** Both have been fully built since
  2026-07-31 and every choice toasted "Coming soon", because the repo held no audio.
  - **Four during-timer beds** — Lullaby, Bouncy, Floaty, Ticking. They loop under the run
    and stop before the shell breaks.
  - **Four end stings** — Chime, Fanfare, Bell, Pop. They ride the crack. "Kids cheer" is
    not among them on purpose: picking it means the cheer that already plays, not a second
    set of children arriving a frame later.
  - **Twelve spoken reminders**, in the voices of the same four children who count down,
    so nobody new arrives at the end of a run. They wait for the cheer's 2.03s tail to
    clear, because a line spoken over children shouting is simply lost.
- **A "You did it" tile**, which Andjroo named when he listed the green button's contents
  and which was the one with no tile.
- **Choosing a sound plays it.** That tap is also the only legal moment to unlock the clip
  on iOS, so the preview and the unlock are the same gesture. Bed previews cut off after
  4.2s rather than looping on under the sheet.
### Fixed

- **Leaving the timer left the music playing.** `eggtimer.js` deliberately never re-creates
  its iframe — doing so would restart the rig mid-countdown — so the back chevron left the
  timer document alive with its bed still looping, over the chore chart and every screen
  after, with no visible cause and nothing to tap to stop it. The host posts `hush` on the
  way out now. The timer's only message listener was inside `if(JOB)`, so dock mode had
  none at all; the hush listener is registered unconditionally.

## [0.101.1] - 2026-08-03
### Added

- **The last five seconds are counted out loud**, by the same four children who count in
  the competition film and with the same recordings, so the app and the film count in one
  voice. "One" lands a beat before the shell goes, where the film places it against the rim.
### Fixed

- **Tapping Start sometimes played the cheer.** The iOS unlock primes each clip by playing
  it, and `play()` resolves *after* playback has begun — so a plain play-then-pause leaked
  the first few milliseconds of audio. It was a race, which is why it happened "sometimes",
  usually on the first run of a session. The prime is muted now and unmutes after the pause
  lands.
- **The mix was wrong on iOS, which is the device this is for.** `HTMLMediaElement.volume`
  is read-only on iOS — assignment is silently ignored — so the balance that was right on a
  laptop played flat out on a tablet. Every level is baked into its file at encode time
  now (`lame --scale`), and nothing scales anything at runtime. Re-dialling the mix means
  re-encoding, not editing a constant.

## [0.101.0] - 2026-08-03
### Added
- **The parent-signed payout path is reachable from a browser.** Under `HATCH_CUSTODY=parent`,
  approving a chore in the parent app now mints a signing intent, opens the parent's own
  wallet with the exact bytes the server published, and hands the signature back for relay.
  When the kid's deferred spending has eaten part of the reward the card explains the gap
  first ("300 for the job, 80 already spent, 220 to send") rather than letting the wallet show
  a number that disagrees with the board.
- `GET /api/parent/overview` publishes the instance's `custody` block, so a screen never has
  to infer who signs a payout from the shape of a response it has already provoked.
### Fixed
- **`POST /api/approvals/:id/approve` had no parent-signed branch at all**, so on a flipped
  instance every card in the parent's queue reached `payKidEarn` and asked a server holding no
  key to sign. Only `/api/chores/:id/approve` had been wired.
- **A relayed payout never settled the work it paid for.** The ledger row was written and the
  chore stayed `pending` forever, so a parent could sign, watch the NIM land at their kid's
  address, and still see "waiting for a grown-up". `settlePayoutSubject` closes it, idempotent
  so a replayed broadcast costs nothing.
- Under parent custody an approval now stays in the queue until the money moves. It was being
  decided the moment it was tapped, which took the card off screen while a mobile wallet
  redirect was still in flight and left the kid's work unreachable.

## [0.100.3] - 2026-08-03
### Added

- **The egg hatch has a sound now, in the app and not only in the film.** The crack, the
  kids' cheer and the anticipation bed that fills the wobble are the same three recordings
  the competition video uses, re-encoded from WAV to AAC (328KB → 54KB). They play on every
  hatch, whatever the end-sound picker is set to, because the crack and the cheer are what
  the egg *does* — the sounds sheet layers on top of them rather than replacing them. The
  mute switch still silences everything.
- The crack is anchored on the **burst**, not on the rig's `breaking` flag. `breaking` goes
  true when the egg starts to swell and the halves do not fly for another 0.46s, so anchoring
  there leaves an audible hole between the clock running out and the shell breaking. This is
  the same mistake the film made and fixed; the fix is ported rather than rediscovered.
### Fixed

- **Static audio was served as `application/octet-stream`.** Hono's MIME table has no entry
  for `.m4a`, and this app sets `X-Content-Type-Options: nosniff` deliberately, so the browser
  was forbidden from guessing — audio would have failed silently, with a 200 in the network
  tab and nothing in the console. `serveStatic` now carries an explicit map for `m4a`, `mp3`,
  `wav` and `ogg`, so anything audio added later lands in the same fixed hole.

## [0.100.2] - 2026-08-03
### Changed
- `docs/NEXT-SESSION.md` opens with a **SETTLED** table of questions Andjroo has already
  answered, and every historical "waiting on Andjroo" block now points at it. The file is a
  newest-first log, so an answered question written down in an old session still read as open
  to whoever opened the file next — "should a practice pay NIM?" was put in front of him at
  least three times that way.

## [0.100.1] - 2026-08-03
### Changed
- `docs/NEXT-SESSION.md` records the netting session: why a fully-netted payout produces no
  transaction, the two failure shapes the four rules did not cover, and the four traps.

## [0.100.0] - 2026-08-03
### Added
- **The netting engine (`src/kid-netting.ts`): a Treasure Box purchase no longer needs its own
  wallet popup.** On a `HATCH_CUSTODY=parent` instance the server holds no key for a kid's
  address, so a purchase records a debit instead of a transaction and the next payout the
  parent signs is minted for the difference. One signature, both movements of money. A
  purchase is instant, the shown balance drops immediately, and outstanding debt may never
  exceed what is actually at the kid's address — so every number the app shows is still backed
  by NIM genuinely sitting there.
- A payout intent now carries `nettedLuna` and `grossLuna`, so a parent's screen can say
  "200 for the chore, 80 already spent, 120 to send" instead of a number that disagrees with
  the board. `GET /kids/:id/wallet` gains `deferredSpentLuna` (already subtracted from
  `balanceLuna`; published so a screen can explain the gap, never so a client can subtract it
  a second time).
- A chore whose reward the debt eats WHOLE is approved with no signature at all and answers
  `200 { settled }` rather than `202 { signingIntent }` — there is nothing for a wallet to do,
  and leaving it pending would strand it against an event that is never coming.
### Fixed
- A rejected coupon on a parent-custody instance tried to refund the kid out of a hot wallet
  that does not exist there. It now reverses the debit, which is the only answer available on
  an instance holding no key. Which of the two a refund takes is read off the purchase itself,
  not off today's custody setting.
- Deferred spending is subtracted inside `kidBalanceLuna` rather than per screen, so the
  staking precheck, the Treasure Box and the home screen cannot disagree about what a kid has.
  `kidChainBalanceLuna` is the raw figure for the one caller that needs it.

## [0.99.72] - 2026-08-03
### Changed

- The netting rules and the app-shell UUID scrub are decided and recorded in
  `docs/NEXT-SESSION.md`. No decisions are outstanding.

## [0.99.71] - 2026-08-03
### Changed

- `docs/NEXT-SESSION.md` records the connect-account session, and its decision list is
  rewritten: four answered items become facts, and the netting engine's open fork replaces
  them.

## [0.99.70] - 2026-08-03
### Changed

- Cloudflare Web Analytics is off, so its two origins are out of the CSP. The only third
  parties the policy still allows are the Nimiq Hub, the bug reporter, and the marketing
  page's video embed.

- Fira Mono is served from this origin instead of Google. The parent app no longer makes a
  request to a third party on every screen, and Google Fonts is out of the CSP.

## [0.99.69] - 2026-08-03
### Added

- Register every child's address from one wallet popup. `POST /api/family/connect-challenge`
  and `POST /api/family/connect-addresses` take a `connectAccount` batch, verify one signature
  per child under the connect prefix, and move the whole family at once or not at all.
- `children.address_proof_kind` records which Keyguard flow signed a stored proof, so it is
  re-checked under the right prefix. `verifyStoredBinding` now reports whether the signature
  binds the child or only the household.

- `connectAccount` support in the address-proof verifier. The Keyguard signs a connect
  challenge under its own prefix, so proofs now carry which flow produced them and are
  rejected when checked under the other one.
- A spike card that asks the wallet for kid addresses by derivation path, and a second that
  tries to spend from one afterwards.

## [0.99.68] - 2026-08-03
### Added

- `connectAccount` support in the address-proof verifier. The Keyguard signs a connect
  challenge under its own prefix, so proofs now carry which flow produced them and are
  rejected when checked under the other one.
- A spike card that asks the wallet for kid addresses by derivation path, and a second that
  tries to spend from one afterwards.

## [0.99.67] - 2026-08-02
### Changed
- `docs/NEXT-SESSION.md` records the 2026-08-03 security session: both custody boot guard holes
  (#208, #209), Phase 0 completed, the re-derived flip window, and the full map of which keys
  control which money.

## [0.99.66] - 2026-08-02
### Fixed
- The custody boot guard refused to arm parent custody while `DEV_PARENT_PRIV` was set, but
  never checked the wallet that key opens. `DEV_PARENT_PRIV` is the shared hot wallet's only
  key, so deleting it orphans whatever the wallet still holds. The guard now refuses when the
  last recorded hot wallet balance is non-zero, and words it differently depending on whether
  the key is still there to sweep with (a warning) or already deleted (a key restore). A
  snapshot that was never taken stays "unknown" and does not block a clean boot.

## [0.99.65] - 2026-08-02
### Fixed
- The parent-custody boot guard proved a kid's *basic* balance was zero and called that
  "verified empty". A stake lives in the staking contract, not the basic account, so a kid who
  had staked everything read as empty and would have had that stake stranded forever when
  `HATCH_MASTER_SEED` was deleted. The guard now also reads the staking contract, and where the
  node has no staker RPC it falls back to transaction history, since an address that has never
  transacted has provably never staked. History with no staker read refuses the boot rather
  than guessing.

## [0.99.64] - 2026-08-02
### Changed

- `docs/NEXT-SESSION.md` now leads with the non-custodial session: Q1 proven green against the
  deployed Hub, the Q4 answer that forces a more modest security claim, the four traps the
  session paid for, and the fact that Step 0 on mainnet is still open and is the cheapest
  action outstanding.

## [0.99.63] - 2026-08-02
### Added

- **A chore approval on a parent-custody instance is now a transaction waiting for a
  signature, not a boolean the server checks before signing for itself** (NONCUSTODIAL-PLAN
  Phase 3, part two). `POST /api/chores/:id/approve` answers `202` with a signing intent, and
  `POST /api/payouts/broadcast` relays the bytes the parent's wallet returns.

  The relay decodes those bytes and compares every field against the claimed intent before
  broadcasting. It refuses to relay anything that does not match, records the bytes before
  they reach the wire so a retry replays rather than rebuilds, and writes the earn row
  `pending` for the existing `sweepPendingEarns` to settle.

  The chore is not marked approved at `202`. It is approved when money moves, and money moves
  in the parent's wallet — which may be a full-page redirect away on mobile, so intents live
  server-side and resume by id.

  Gated on `HATCH_CUSTODY=parent`, which is unset on all three instances, so nothing changes
  for anyone today. A regression test pins that the old path is untouched when it is unset.
### Changed

- `docs/WALLET-CONTRACT.md` said parent-signed outflows "do not exist yet" and that money
  coming in was unaffected. Half of that stopped being true with this change, so it now
  documents the intent, the relay, the pinned height and why budgets do not apply.

## [0.99.62] - 2026-08-02
### Fixed

- **Turning on parent custody silently simulated the whole instance.** `SIM` was
  `NIMIQ_SIM=1 || !DEV_PARENT_PRIV`, and the `HATCH_CUSTODY=parent` boot guard *requires*
  `DEV_PARENT_PRIV` to be unset, so the non-custodial instance was simulated by definition:
  `makeProvider()` returned a `SimProvider`, `kidBalanceLuna` returned a ledger sum instead of
  reading the chain, staking and cashlinks wrote fake hashes, and `HATCH_REQUIRE_REAL=1`
  refused to boot at all.

  SIM now means "there is no chain", not "there is no key here". A keyless real instance reads
  the chain and relays bytes it did not sign, which is exactly what Phase 3 needs and exactly
  what keeps the promise that a kid's balance cannot lie.

  Nothing changes for any instance where `HATCH_CUSTODY` is unset, which is all three today.

## [0.99.61] - 2026-08-02
### Added

- A payout the parent signs, and the server can only relay (NONCUSTODIAL-PLAN Phase 3, part
  one). `src/wallet/payout-intent.ts` mints a signing intent onto the existing
  `payout_attempts` claim and verifies a returned transaction field by field before anything
  reaches the wire. Inert on its own: no route calls it yet, so nothing changes for any
  instance until the wiring lands.

  The intent pins `validityStartHeight`, so the bytes are deterministic and the chain itself
  refuses a duplicate for the whole validity window. The claim is still the primary guard,
  because it is what stops a second wallet popup from ever opening.

  The verifier is whole-field equality on sender, recipient, value, fee, validity height,
  extraData bytes, network and account types. Never a range: "at least the right value" would
  let a client empty a parent's wallet into an address the parent did approve.
### Verified

- Q1 of NONCUSTODIAL-PLAN came back **green** against the deployed testnet Hub and Keyguard,
  not just against the source. `signTransaction({sender})` signs from an address the calling
  origin never received from `chooseAddress`, as long as it sits in one of the user's Hub
  accounts. Details and the Q3/Q4 answers are on the private ops issues.
- The suite includes a transaction a **real Nimiq Keyguard** signed, so the verifier is checked
  against a parent's wallet rather than against our own builder agreeing with itself.

## [0.99.60] - 2026-08-02
### Changed
- `docs/NEXT-SESSION.md` records how nimiq.kids gets a frictionless demo and a non-custodial
  mainnet at the same time: they are already separate processes with separate env files, so the
  demo instance keeps server custody on testnet while the mainnet instance takes
  `HATCH_CUSTODY=parent`. Both boot preconditions were checked and hold today, including the one
  server-derived kid account on mainnet holding zero, which is the window that makes the
  migration cheap.

## [0.99.59] - 2026-08-02
### Changed
- `docs/NEXT-SESSION.md` records the 2026-08-02 evening security session: what shipped, the two
  things waiting on Andjroo (an empty mainnet hot wallet, and the grant env that still pins luna),
  the decisions inside the switch gate, and four traps, including a dollar-priced figure computed
  at the static fallback rate going live as a confident wrong answer.

## [0.99.58] - 2026-08-02
### Added
- `/health` reports `economy.funded`: whether the instance hot wallet holds anything at all. The
  live mainnet box was found holding zero, which refuses every approval on it through
  `payableLuna = min(budget, funds)`, and nothing anywhere said so (#200). One bit, never the
  balance, because the float is the one money figure this codebase does not publish on an
  unauthenticated surface. `null` means never snapshotted, which is not the same as empty.

## [0.99.57] - 2026-08-02
### Fixed
- `/health` no longer claims `economy.covers` from a price it never fetched. The starter board is
  priced in dollars, so its NIM cost is a conversion, and before this process has read a real price
  that conversion silently uses the static $0.002 fallback, which is roughly 4x the live rate. The
  block therefore went live reporting `covers: true` about a board the grant does not cover. It now
  reports which rate it used and answers `covers: null` until a real one has been seen, and the
  price cache is warmed at boot alongside the hot-wallet snapshot.

## [0.99.56] - 2026-08-02
### Added
- Switching kid on the shared family tablet now costs something (#123). Each child picks a short
  sequence of secret pictures, and a tablet can only act as the kid whose pictures were entered on
  it. Tapping a sibling's face used to hand over their wallet screen, their Send button and their
  Treasure Box balance, which was the one place the money controls were bypassed by the trust
  model rather than by a bug. Pictures rather than digits because the user is four and cannot
  read; the family PIN is the grown-up override for a kid who forgets.
### Changed
- The money gate refuses a device acting as a kid it was not opened for (`403 switch_locked`). A
  kid who has not picked pictures yet is gated by nothing, which is exactly the behaviour this
  replaces, so no household is locked out by the upgrade. A parent bearer is never gated.

## [0.99.55] - 2026-08-02
### Added
- `/health` reports `economy`: the grant, what the starter board costs at the current rate, and
  whether the first covers the second. The failure it makes visible was silent, since nothing said the
  two had crossed except a parent being refused on chore two of the board the app gave them.
### Fixed
- A new family can finish the whole starter board again. The board is priced in dollars and the
  per-family payout grant was pinned in NIM, so the two drifted apart until the board resolved to
  4,240 NIM against a 2,000 NIM grant and the second chore came back `budget_exhausted` (#194).
  The grant now takes `HATCH_DEMO_GRANT_USD` and resolves at the live rate, so both sides are
  anchored the same way; `HATCH_DEMO_GRANT_LUNA` still wins where an operator wants an exact
  ceiling, and an instance that sets neither keeps the 5 NIM default.

## [0.99.54] - 2026-08-02
### Changed
- `docs/NEXT-SESSION.md` records the 2026-08-02 product + hardening session: 15 shipped issues, the two patterns behind most of the money bugs, five traps, and the five decisions waiting on Andjroo.

## [0.99.53] - 2026-08-02
### Fixed
- The Content-Security-Policy allows Cloudflare's analytics beacon, which the tunnel injects in production and no file in this repo mentions. It was blocked on every live page load, two console errors at a time (#141 follow-up).

## [0.99.52] - 2026-08-02
### Fixed
- A parent-supplied wallet address is validated by the Nimiq codec instead of a shape regex, stored in one canonical form, and correctable afterwards through `PATCH /api/family/address` under parent custody. It was checked by a pattern that accepts any NQ-ish string and written exactly once, so a wrong address was permanent (#136).

## [0.99.51] - 2026-08-02
### Added
- A database records which network and which master seed it belongs to on first boot, and the server refuses to start when either disagrees with how it is configured. Pointing a mainnet database at testnet used to change nothing visible: addresses are identical across networks, so every screen rendered while every balance came from a chain that never saw those transactions (#125).

## [0.99.50] - 2026-08-02
### Added
- Security headers on every response: a Content-Security-Policy, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy` and a `Permissions-Policy`. The app served none of these, so `/parent/` could be framed by any page and one redressed click approved a payout (#141).

## [0.99.49] - 2026-08-02
### Changed
- `hono` bumped to `^4.12.25` so `bun audit` reads clean on a public repo. None of the 8 advisories were exploitable here — the app imports only `hono/bun` serveStatic and `hono/streaming` streamSSE — but a high-severity audit result on a children's money app is worth not having (#144).

## [0.99.48] - 2026-08-02
### Fixed
- The invite-accept dedupe key is now a MAC under a per-instance secret with the day folded in, and it is nulled out once the dedupe window has passed. It was an unsalted truncated SHA-256 of (known code | IP), so the visitor's IP address was recoverable by brute force from anyone holding a copy of the database (#142).

## [0.99.47] - 2026-08-02
### Fixed
- Purging a demo household now deletes its uploaded photo files, not only the rows that index them. Every purge used to leave the JPEGs on the operator's disk with no owner, no expiry and no way to tell an orphan from a real family's photo (#143).

## [0.99.46] - 2026-08-02
### Fixed
- "Report a bug" no longer attaches page diagnostics. The block defaulted on and shipped pre-ticked, and it carried the page URL, the last failed requests and the last console errors, nearly all of which are addressed by child UUID, into an LLM-written issue on this public repo (#140).

## [0.99.45] - 2026-08-02
### Fixed
- The seed and hot-wallet generators now enforce 0600 on the env file before writing to it, instead of passing a `mode` that Node ignores on a file that already exists. An env file created with a plain `touch` left the HD master seed behind every kid account world-readable while the script reported success (#139).

## [0.99.44] - 2026-08-02
### Security
- The parent app's `toast()` sets its message with `textContent` instead of interpolating it
  into `innerHTML`. Every caller passes `t(key, params)`, and `t()` substitutes raw, so a
  value like a child's nickname used to reach the toast as parsed HTML. Fixing the sink means
  it cannot, whatever any of the dozen call sites forgets.
- One escaper for both apps (`public/js/lib/esc.js`), replacing four copies with two different
  behaviours: two of them omitted `'`, so whether a string was safe inside a single-quoted
  attribute depended on which file you were in.

## [0.99.43] - 2026-08-02
### Fixed
- A failed Cashlink mint writes its claim URL, which carries the private key, to a 0600 recovery file beside the database instead of into the process log. The address and value still go to stdout, so the operator sees what to check on chain without the key travelling with it (#138).

## [0.99.42] - 2026-08-02
### Added
- A payout now offers its on-chain receipt at the moment it happens: "See this on the chain" on the kid's celebration, "See the receipt" on the parent's success toast. Both open the payout's own Nimiq transaction, whose memo is the job's own title (#122).

## [0.99.41] - 2026-08-02
### Security
- The kid app now escapes an `emoji` before it reaches the DOM. Five sinks rendered it raw
  while the title beside it was escaped: the job card, the task screen, the done sheet, the
  hatch SVG, and the shared sticker face.
- `emoji` is validated where it is written, in one place (`src/emoji-field.ts`): chores,
  children, routines, routine tasks and practices answer `400 invalid_emoji` for a value that
  is not one. The rule is generous about real emoji (flags, keycaps, ZWJ families, skin tones
  all pass) and bounded at two grapheme clusters.
- The kid app's `esc()` escapes `'` as well, matching the shared helpers.

## [0.99.40] - 2026-08-02
### Fixed
- The demo reclaim sweeper takes the child's spend lock before reading a balance and sweeping it, and the purge that follows waits behind every spend key in the household. A visitor buying from the Treasure Box past the TTL could race the sweeper for the same balance, and the purge could delete the derivation coordinates out from under a spend still in flight (#126).

## [0.99.39] - 2026-08-02
### Fixed
- Buying a Treasure Box pack or timer style tests ownership inside the same hold of the child's spend lock as the charge and the grant. Simultaneous buys of the same item used to charge a kid twice and give them one (#129).

## [0.99.38] - 2026-08-02
### Security
- A paired tablet or parent phone can now be signed out. `DELETE /api/devices/:id` revokes a
  tablet, `GET`/`DELETE /api/parent/tokens/:id` list and revoke parent sessions, and
  `POST /api/parent/sign-out-everywhere` cuts every tablet and every other phone at once while
  keeping the session making the request. Deleting the row is the revocation, so the token
  fails on the very next call. The last remaining parent session is refused (`409`), because
  nothing could mint another one.
- Parent app: "Remove this tablet" in the tablet sheet, and a "Lost a phone or tablet?" card
  with sign out everywhere else.

## [0.99.37] - 2026-08-02
### Fixed
- An unstake is confirmed by the remove transaction's own receipt, not by the kid's balance having risen. A chore payout landing in the same account used to confirm a retire+remove that had failed at execution, stranding the kid's NIM inside the staking contract with nothing in the app tracking it (#135).

## [0.99.36] - 2026-08-02
### Fixed
- A routine's tasks freeze once the run is handed in, and a task the parent excused can no longer be flipped back to "done" from the kid's tablet — both of which raised the NIM the parent was then asked to approve above the number they were pinged about (#134).

## [0.99.35] - 2026-08-02
### Fixed
- The "Pay again" route now moves money under the same exactly-once key as every other payout, so a repay whose RPC response is lost replays that one transaction instead of building a second, and a repaid chore is known to be paid — it can no longer be handed in again, approved again, or rejected out from under the kid who holds the NIM (#133).

## [0.99.34] - 2026-08-02
### Security
- Rate limits are now keyed on the socket peer, not on a header the caller supplies. A
  forwarded header (`cf-connecting-ip`, `x-forwarded-for`) is read only when the request
  arrives from a trusted proxy — loopback by default, since the tunnel runs on the same
  host; override with `HATCH_TRUSTED_PROXIES`. The resolver lives in one place,
  `src/client-ip.ts`, rather than in three private copies.
- Pair codes: `POST /api/devices/register` shares `POST /api/pair`'s per-caller allowance
  instead of having none of its own, and an instance-wide budget bounds wrong guesses
  across both routes. Only a miss spends it (`HATCH_PAIR_MISSES_PER_MIN`, default 30).

## [0.99.33] - 2026-08-02
### Fixed

- The starter chores a new family is given are now priced realistically against the shop. They
  were 1, 1 and 2 NIM (a few tenths of a cent, set "when a chore paid 0.1 NIM"), so a family did
  every starter chore, earned about 4 NIM, opened the Treasure Box and bounced off
  `insufficient_funds` on a 1,000 NIM shelf. They are now dollar-priced ($0.50 / $0.50 / $1.00),
  the same basis the demo and the chore-creation route already use, so the first board a family
  sees is on the same footing as the shop: the first chore alone clears the cheapest reward.

## [0.99.32] - 2026-08-02
### Changed
- Handoff records the 2026-08-02 product session: ten issues shipped (#117 to #121, #124,
  #127, #128, #132, plus the deploy guards #119 and #120), the `changelog.d` fold protocol
  that replaced hand-edited version bumps, and the flag rename that had silently broken every
  on-tablet approval on the live demo. Names the one queue item left (#122), the decision
  still open on whether practices should pay, and the demo hot wallet's runway as the real
  constraint on judging.

## [0.99.31] - 2026-08-02
### Fixed
- **On-tablet approvals on the live demo answered 401 for every household.** The flag was
  renamed `HATCH_DEMO_SEED` to `HATCH_DEMO_ENABLED`, and `demoSeedEnabled` in `routes/demo.ts`
  was updated to accept both names, but `parentAuth` in `auth.ts` had its own private copy
  that read only the old one. So the demo instance reported `demo: true`, minted households
  and showed the kid the tap, while the one call that lands the NIM had been refusing for as
  long as the rename. It took the routine path in `waiting.js` down with the chore path.
- The predicate now lives in `src/demo-flag.ts` and both callers import it, so the two can no
  longer disagree. A test asserts they are the same function, not two that happen to agree.

Found by driving the live demo in a browser during wrap-up: `GET /chores/:id/approval`
answered 200 and `POST /approvals/:id/approve` answered 401 on the very next call.

## [0.99.30] - 2026-08-02
### Changed
- `docs/NEXT-SESSION.md` records which hardening work has shipped and adds the migration rule that
  a new column's index belongs in `migrate()`, never `schema.sql`.

## [0.99.29] - 2026-08-02
### Added
- **The chore payout loop closes inside the kid tablet on the demo** (#117). The seed plants
  one submitted chore per kid precisely so a visitor can approve a payout and watch NIM land,
  and tapping that chore fell through to a "Waiting for Mom" toast. So the money, which is
  the entire pitch, never landed unless the visitor went back to the landing page and opened
  the parent door instead. On a demo household the tap now approves and the NIM arrives, the
  same thing the routine path has always done.
- `GET /api/chores/:id/approval`, a mirror of the routine-run route. A chore submit has
  always opened exactly such a row; there was simply no way to ask for its id.
### Changed
- Nothing on a real household. The branch is gated on `state.family?.demo_at` exactly as
  `waiting.js` gates it, and the server's `parentAuth` (which clears only demo households) is
  the real lock. The client gate is the second one and never the only one.
- Homepage: the Live now card's opening drops from 192 words to 127. The previous version
  spent three sentences on Nimiq Hub mechanics before reaching anything a parent cares
  about, and opened on ecosystem trivia ("a Nimiq wallet already runs in a plain browser")
  that only parses if you already know Nimiq. The mechanism is now one clause: it opens in
  any browser, or as a mini app inside Nimiq Pay, because the mini wallet is built into the
  page. The Hub is implied rather than named.

## [0.99.28] - 2026-08-02
### Added
- **"My prizes" in the Treasure Box** (#121). A kid bought a coupon, real NIM left their
  wallet, a `kid_purchases` row went to `pending_parent`, and they got a two-second toast. No
  screen anywhere, kid or parent, listed what was bought, and when the parent handed it over
  days later the row flipped to `fulfilled` in a table no screen read. Saving up for something
  is why a kid tolerates chores, so the thing they saved for now exists on screen: waiting on
  a grown-up, ready, or got it.
- **"What they bought" in the parent's Treasure Box**, kid by kid, with the ones still owed
  first. A coupon is handed over in the real world days later and the only trace was an
  approvals row that vanished once actioned, so "did I ever actually take her for that ice
  cream" had no answer anywhere.
- `GET /api/kids/:id/purchases` and `GET /api/parent/purchases`. Money-gated like the rest of
  `/kids/:id/*`: a purchase list is a spending history, and a device that cannot see a kid's
  balance should not read what they bought either.
- A store tile now says how many of that item are already queued. A coupon has no owned state
  and is re-buyable on purpose, so the tile stayed at full price with nothing to say one was
  already waiting and a second tap spent the money again in silence. It is a count, not a
  block: two ice cream trips is a real thing for a kid to want, so the fix is to say one is
  already waiting rather than to refuse it. The spend path is untouched.

## [0.99.27] - 2026-08-02
### Added
- **The kid's real NIM balance is on the kid home screen** (#118), as a chip opposite their
  name that opens Money. This is the one number that separates nimiq.kids from every
  chore-sticker app and it had no pixels on the first screen anyone sees: the demo's primary
  button opened the tablet and showed a name, a calendar and a to-do list. The value was
  already fetched and already drove repaints, so this is render only.
- The chip shows nothing until the wallet has been read, rather than a confident `0 NIM`. A
  kid holding 42,002 NIM being told they have nothing is worse than a chip that lands a
  moment late, and it is the rule the parent app's family wallet already follows.

## [0.99.26] - 2026-08-02
### Security
- Under server custody, self-serve onboarding no longer lets the caller choose the family wallet
  address; it is always the instance hot wallet. A kid's Treasure Box purchase pays into that
  address while a rejected-coupon refund pays out of the hot wallet, and the per-family budget
  only nets the two to zero when they are the same account — so a caller-chosen address let the
  spend enrich a wallet they owned while the refund drained the shared float. Parent-custody
  onboarding still requires and uses the parent's own address.

## [0.99.25] - 2026-08-02
### Added
- **Notifications now take one tap, and onboarding offers them** (#124). They used to require
  finding Settings and pasting an ntfy topic URL into a bare `type="url"` box, which is this
  app asking a non-technical parent to know what ntfy.sh is. Nothing in onboarding did it, so
  for most families every `notifyParent` call was a no-op: a kid finished a chore, the server
  built a good message with a deep link to that exact approval, and dropped it. The loop's
  latency became "whenever the parent next remembers to open the app".
- `POST /api/parent/notify-topic` mints the topic server-side with 192 bits of entropy, as
  base64url so no modulo can bias the alphabet. A topic URL is a bearer secret on a public
  server, and a parent asked to invent one writes "smith-family-chores". It is idempotent: an
  existing URL is returned, never replaced, because rotating would silently unsubscribe a
  phone that already works and the symptom is notifications quietly stopping.
- The setup card shows a QR for the other phone and an `ntfy://` deep link for the one
  holding it, plus a test that posts straight from the phone so it proves the path the
  notifications will actually take. `HATCH_NTFY_BASE` points it at a self-hosted server.
### Changed
- The raw webhook field moves behind an "Advanced" disclosure rather than going away. Any
  endpoint that accepts a POST works there, which is a real use, but a parent who does not
  know what a webhook is should never meet one.
- Notifications stay **off by default** and arming is a choice a parent makes. With
  `notify_url` null nothing leaves the process, so a family that skips the offer never sends
  a child's name or a chore title to a third party.
- The tab bar stays hidden for the extra onboarding screen. It is drawn once a token exists,
  and the offer runs after the family is created, so a tab there would have been a dead
  control that looked like the app had frozen.

## [0.99.24] - 2026-08-02
### Security
- The Treasure Box catalogue is now scoped per family. `store_items` and `store_categories`
  carry a `family_id` (NULL = the shared seeded catalogue); every read returns only the shared
  rows plus the caller's own, parent-created items and categories are stamped with the creating
  family, and a kid can only buy an item on their own shelf. On a multi-tenant instance a parent
  bearer can no longer see, edit, retire, reprice or add items to another household's shop, nor
  reprice the shared catalogue; a single-household instance keeps its shared catalogue editable.

## [0.99.23] - 2026-08-02
### Added
- **"Again" on a finished job** in the parent board (#128). Day 1 a family gets three sample
  jobs, the kid does them, the parent approves, and on day 2 the board is a list of padlocks
  with nothing to do. Refilling it meant opening the sheet and retyping each job, which is the
  loudest week-two failure in the app. One tap on the job that just finished now opens the
  create sheet prefilled, and Save puts it back on the board.
- The copy carries the two fields the sheet has never shown, `title_key` and `duration_s`, so
  a re-added catalog job keeps its translation and a timed job keeps its timer. Without the
  key the copy is stored as English prose and comes back English on the tablet while the
  phone is in Spanish.
- `wireJobPicker` takes an `initialId`, so the picker opens with the copied job's tile already
  chosen. Everything that keeps the picker honest is written against its own selection, so a
  parent who edits the prefilled title clears the key by the rule that already existed.
### Changed
- Nothing is created without a parent tapping Save. The re-add is a prefilled sheet rather
  than a one-tap create, which keeps it clear of the money question: the new job lands `open`
  and still has to be submitted, approved and paid exactly like one typed by hand. The reward
  is copied as the NIM already agreed rather than re-priced from today's dollars, and the
  field shows what that is worth today so a parent who wants to re-price can, in the same tap.

## [0.99.22] - 2026-08-02
### Changed
- Homepage: the Live now card now opens on what the app is and *why* it runs in a plain
  browser. It names the mechanism instead of gesturing at it: a mini wallet built into the
  page talking to the Nimiq Hub, running as a mini app inside Nimiq Pay and falling back to
  the Hub anywhere else (`nimiq-app-shell` `detectModeSync`), which is what frees a kid from
  one tablet. The card closes on the own-bank thesis with staking named.
- Roadmap: the kids' ages come out for a generic line; the community feedback button is
  described as already live in both the kid and parent apps rather than as future work;
  "Duolingo playfulness" becomes concrete examples; and the cosmetics card is reframed
  around outside creators, with the two approval gates (mine into the app, then the
  parent's for their own kid) spelled out.
- The learning apps named under Integrations (Ello, Khan Academy Kids, Yousician) are links.
### Security
- The parent-notification webhook URL (`notify_url`) is now validated as a public `https` target.
  `PATCH /api/family/settings` rejects a loopback, private, link-local or unique-local address
  (and any non-https or unresolvable host) with `invalid_notify_url`, and the same check runs again
  before each server-side notification fetch — with redirects disabled — so a URL stored by an
  older build can no longer be used to POST to an internal host.

## [0.99.21] - 2026-08-02
### Security
- The parent magic link no longer overwrites an existing session silently. A `#t=` link whose
  token differs from the one already signed in on the device is held aside and requires an
  explicit confirmation that names the household it belongs to, instead of switching the parent
  onto another account without any signal. A first sign-in and a link matching the current
  session are unchanged, and the token fragment is still scrubbed from the URL either way.

## [0.99.20] - 2026-08-02
### Changed
- Saving a practice no longer sends `rewardLuna` at all, not even `0`. `PUT /api/practices/:id`
  treats an absent field as no change, so stored amounts are left exactly as they are.
  Whether a self-reported practice should pay, and through which approval, is still open and
  is a decision about money; zeroing the data would have been this change making it.
### Fixed
- **The parent board no longer asks what a practice pays** (#127). It offered a NIM field on
  every practice, showed the dollar value as the parent typed, and the server stored it.
  Nothing ever paid it. A parent set "Piano, 3x a week, 100 NIM", the kid practised, logged
  it, got a sticker, and no money moved, with nobody told. It was the one place in this app
  that made a promise about money to a child and quietly did not keep it. The sheet now says
  what a practice does earn: stickers and a streak.
- An amount set on a practice **before** this shipped is shown rather than hidden, in red, on
  the row and in the sheet, with the one thing a parent can do about it today. Removing the
  field on its own would have turned a visible broken promise into an invisible one.

## [0.99.19] - 2026-08-02
### Security
- Kid-surface routes that address a subject by id — prefs read/write, sticker inventory, photo
  stickers, task-run start, task-run stickers, the Treasure Box catalogue, and the routine-run
  approval lookup — now resolve the owning family and refuse a caller who is not in it, matching
  the routes around them. On an instance that requires auth this stops an anonymous or
  cross-household caller from reading or rewriting another child's app state by id, and the egg
  photo can no longer be set to another household's media asset.

## [0.99.18] - 2026-08-02
### Security
- `GET /api/media` and `GET /api/media/:id/file` now enforce family ownership, matching the
  upload and delete handlers. On instances that require auth, an anonymous or cross-household
  caller receives 404 instead of another child's photo list or image bytes. Because photos load
  as plain `<img>` with no Authorization header, the authenticated listing and upload responses
  set a short-lived, HMAC-signed, per-family HttpOnly cookie that the image request replays;
  relaxed single-household instances keep their open kid-tablet behavior.

## [0.99.17] - 2026-08-02
### Fixed
- `GET /api/parent/overview` no longer publishes a per-kid `balanceLuna` (#132). It carried
  `children.balance_luna`, which `repo.ts` itself calls a convenience tally and which nothing
  writes off SIM, so on every real-settlement instance the documented contract reported 0 NIM
  for a kid holding thousands. The parent app happened to be right because it prefers the
  per-kid wallet fetch, but that line ended `?? k.balanceLuna`, so the stale 0 was the
  fallback whenever the fetch had not resolved or had failed. A balance that has not been
  read now draws the same dash the family wallet already uses, and TOTAL BALANCE waits for
  every kid rather than counting an unread one as empty.
- `POST /api/routines` and `PATCH /api/routines/:id` now refuse a `rewardLuna` instead of
  accepting it and dropping it without a word. A routine pays the sum of its tasks and the
  table has no reward column, so setting it in the obvious place produced a routine that paid
  nothing and no error explaining why. The refusal names where the reward actually goes.
- Chore titles are capped at 60 characters and stripped of control characters. `POST
  /api/chores` accepted a 5,000 character title, null bytes and a 50 emoji flood, all 201,
  while kid and parent labels have been capped at 24 since they were written. The cap counts
  code points, so an emoji is bounded the same way a letter is. Angle brackets are still
  stored verbatim: titles render escaped, and a blocklist here would refuse legitimate titles
  while reading as protection that is not there.

## [0.99.16] - 2026-08-02
### Fixed
- Boot no longer fails on databases created before the `cashlinks.url_secret` column. The index
  on that column is created by the migration (after the column is added) instead of in
  `schema.sql`, which runs first and cannot reference a column the migration has yet to add.

## [0.99.15] - 2026-08-02
### Added

- `SendTxOptions.extraDataBytes`, for recipient data that no string can express. The marker's
  bytes are above 0x7F, so the existing UTF-8 `extraData` field encodes them to nine bytes
  rather than five.
### Fixed

- Cashlink funding transactions now carry Nimiq's `FUNDING` marker, so Nimiq Wallet recognises
  them as Cashlinks instead of showing them as ordinary payments — and the kid's message no
  longer rides on chain in the clear. The message travels in the link, where the Hub reads it
  from. Verified by broadcasting a real Cashlink on mainnet and reading the transaction back:
  block 57,816,309, on-chain recipient data `0082809287`.

## [0.99.14] - 2026-08-02
### Security
- On mainnet, a missing `HATCH_MASTER_SEED` is now always a hard boot error instead of silently
  falling back to the built-in development seed to derive kid accounts. The dev-seed fallback is
  restricted to non-mainnet SIM runs. `docs/RUNBOOK-MINI.md` and the competition env template now
  list `HATCH_MASTER_SEED` as required before enabling mainnet.

## [0.99.13] - 2026-08-02
### Security
- Cashlink claim lookup now matches the scanned link's secret by exact equality instead of a
  SQL `LIKE` pattern, so the caller can no longer influence which row is returned. The secret
  fragment is stored in its own indexed column (`cashlinks.url_secret`) and backfilled for
  existing links on first boot.

## [0.99.12] - 2026-08-02
### Added
- `/health` now reports a `bundle` block carrying the size and build time of each browser
  bundle, and `ok:false` naming any that is missing or zero-byte. `public/dist` is gitignored
  and built at boot, so it is the one part of a running instance that a merged commit cannot
  prove. An instance can report the right `v` while serving a bundle from two deploys ago. No
  path is published, matching the rule that keeps the RPC URL and the validator address off
  this endpoint.
### Fixed
- **A failed `build:shell` now fails the boot** instead of serving the previous bundle (#119).
  Both plist templates gated the server exec on the build with `;`, so a build that failed
  still execed the server and it served whatever was left in `public/dist`, or nothing at all
  on a fresh checkout, because that directory is gitignored. The parent app has no i18n
  fallback, so a missing `parent-shell.js` renders approvals, top-ups and the board as raw
  `papp.*` keys with nothing anywhere saying why. It is `&&` now: the boot fails loudly,
  KeepAlive crash-loops, and the autodeploy health check times out into its existing rollback.

## [0.99.11] - 2026-08-02
### Added
- **`changelog.d/` and a fold bot.** A PR no longer edits `CHANGELOG.md` or the `version` in
  `package.json` — it writes `changelog.d/<branch-name>.md`, and
  `.github/workflows/changelog-fold.yml` folds every fragment in on `main` after the merge,
  bumps the version and commits. Those two files were the only ones every PR touched, so they
  were the only two guaranteed to conflict between parallel sessions; two of the three PRs
  stacked on 2026-08-02 collided on exactly them. `changelog.d/README.md` is the protocol and
  `node tools/changelog-fold.mjs --dry-run` previews a release without writing anything.

## [0.99.10] - 2026-08-02
### Changed
- Handoff records where security findings go. They live in the PRIVATE `nimiq.kids-ops` repo, and
  the ops repo gets checked before anything security-shaped is filed here, because this repo is
  public. One public issue had to be deleted for exactly that reason.
- Handoff indexes what the 2026-08-02 audit sweep filed: features #117 to #128, public hardening
  #133 to #144, security in ops #17 to #26. Records the two refuted findings so they are not
  rediscovered, and notes that all 8 `hono` advisories from `bun audit` are inapplicable.

## [0.99.9] - 2026-08-02
### Changed
- Handoff records the settled staking decision: **delegate to a public pool** until Andjroo's own
  pool validator is up. #108 and #130 had recorded opposite calls; #130 won and both are closed.
  The validator was already set and is verified against the staking contract (409 stakers, not
  retired, not jailed), not a directory listing.

## [0.99.8] - 2026-08-02
### Added
- **`/health` now reports `staking.available`.** Grow was dark on the live mainnet instance
  from the day it shipped, because `HATCH_VALIDATOR_ADDRESS` was never set there and nothing
  surfaced it — the only way to find out was to be a kid, open Grow and get
  `staking_unavailable` back. A runbook can now ask the running instance directly, with no kid
  token. Same shape and same reason as the existing `custody` block.
- The **validator address is deliberately not published**, matching the RPC-URL rule: whether
  this box can stake is operational truth; which validator it delegates to is infrastructure
  detail and stays behind auth. A test asserts the address never appears in the response.

## [0.99.7] - 2026-08-02
### Changed
- `docs/NEXT-SESSION.md` opens with where things actually stand at v0.99.6: what is live and how
  to verify it, the three PRs that shipped, and the traps that cost time.
- Records the one thing blocking staking work: **#108 and #130 are the same issue and carry
  contradicting decisions** on which validator to delegate to. No validator has been set.

## [0.99.6] - 2026-08-02
### Fixed
- **The judge-demo gate was English in every language.** `/demo` is a standalone HTML
  document served straight out of `src/routes/demo.ts` — no app shell, nothing to call
  `t()` on — so it stayed English while the app behind it translated. It is the FIRST
  screen a non-English judge sees on the demo instance.
  - The language is negotiated on the SERVER from `Accept-Language`, by q-value, with
    region tags matching their base language (`pt-BR`, `es-419` and `de-CH` are all
    served). `?lang=` overrides it, so a link can pin the language. The response carries
    `Vary: Accept-Language`.
  - A `*` wildcard is ignored rather than matched against the first language in the list,
    which would have handed everyone English while looking like negotiation. `q=0` means
    "not acceptable" and is never selected.
  - **A returning visitor gets the language they picked in the app, not the one their
    browser asks for.** The page ships all five languages (12 strings, under 2KB) and
    re-renders from the shell's own `nimiq-app-lang` key. First-timers get the right
    language server-side with no flash.
  - `<html lang>` follows, so screen readers and translation tooling get the truth.
- **The network label translates too, and mainnet still reads as a warning in all five.**
  A test asserts no language quietly calls a real-money instance a demo.

### Changed
- `networkLabel()` moved to `src/locales/demo-gate.ts` with the rest of the page's copy
  and is re-exported from `src/routes/demo.ts`, where its callers and its test look for it.

## [0.99.5] - 2026-08-02
### Fixed
- **A node saying it cannot answer is no longer read as proof a payout is missing.** The
  absence regex in `src/nimiq/client.ts` enforced adjacency rather than subjecthood, so
  `no such transaction index` — the natural phrasing for a non-history node refusing the
  by-hash question — parsed as "this transaction is absent from the chain". Same for
  `unknown transaction type|format`, `block containing transaction not found` and
  `route /transaction not found`.
- Impact was wording and timing of one parent notification, never money: an over-claimed
  absence still leaves the row pending, still counts the budget spent and still credits
  nothing. The parent got "has not shown up on chain yet" instead of "cannot be checked
  right now".
- The subject now has to be the transaction: a trailing WORD disqualifies the match (a
  trailing hash or punctuation does not), and a governing noun or route prefix disqualifies
  it too. Pinned by tests that fail against the previous expression.

## [0.99.4] - 2026-08-02
### Fixed
- **The kid app no longer offers Grow where staking cannot work** (#108, found by the #62 demo
  audit). The public competition instance has no `HATCH_VALIDATOR_ADDRESS`, so off-SIM
  `stakePrecheck` throws `staking_unavailable`, yet the Money screen painted the Grow banner,
  opened the Grow screen and offered an amount keypad. A visitor keyed in an amount and only
  then hit the wall. The wallet read now carries `stakingAvailable` (env-derived, no chain
  read) and the banner asks before it paints.
- Staked NIM **keeps** the banner even when staking is switched off, because unstaking lives
  behind it and hiding it would strand real money on an unreachable screen. A server that
  omits the field is treated as available, so only an explicit `false` closes the door.
- This does not fix staking on that instance. Choosing a mainnet validator is still open
  on #108.

## [0.99.3] - 2026-08-01
### Fixed
- **Bug reports arrive labelled.** The blocker was never code: the nimiq.bot GitHub App is
  installed with "Only select repositories", which also grants *public* repos read-only, and
  this repo went public on 07-31 without being added. Anyone may open an issue on a public
  repo, so filing worked; labelling needs triage/write, so it 403'd. Adding the repo to the
  App's selected list fixed it with no deploy. Verified from the live demo: issue #113 carries
  `bug`, `user-report`, `surface:kid`.
- The handoff's reporter section said the service drops console errors and that labels are
  unfixable. Both were wrong and both are corrected: it renders them, and they are fixed.

## [0.99.2] - 2026-08-01
### Fixed
- **Reports no longer repeat the console errors nimiq.bot already prints** (shell v0.8.3).
  v0.99.0 pushed the captured errors into the report text because one filed issue showed
  none; that issue just had a clean page. The service renders them as their own sections,
  so only `surface` and the app version travel in the text now.
- **Labels should actually stick** once [nimiq.bot#3](https://github.com/Andjroo111/nimiq.bot/pull/3)
  deploys. `labels` on issue creation are validated and then silently dropped for a caller
  without push access, which is why `surface:kid` never appeared and why one missing label
  (`user-report`) killed every report on this repo until it was created by hand. The service
  now applies labels in a second call, which its `Issues: write` scope does cover.

## [0.99.1] - 2026-08-01
### Changed
- **Handoff records what the reporter actually does now**, including the two nimiq.bot traps
  that cost real time (a label the repo lacks kills the entire report; the service renders
  only part of `context`), the fact that the client-side scrub is now the only one, and that
  the service accepts labels without applying them, so `surface:` triage does not work yet.

## [0.99.0] - 2026-08-01
### Changed
- **The bug reporter now files through nimiq.bot, the fleet's issue service** (shell v0.8.0).
  v0.98.0 shipped a reporter that needed this repo to run its own endpoint and hold its own
  GitHub token, because `bot.nimiq.tech` was missed when it was built. It has been filing
  issues for the fleet since June, with an LLM that writes the issue and one central token.
  - **The corner row is unchanged** — same placement, same sheet, same five languages. What
    changed is where the report goes. That placement is the reason this is not simply the
    nimiq.bot widget: the widget mounts a floating button on every page, which is exactly
    what a kid's tablet should not have.
  - **Reports now carry what nobody can retype**: the last console errors, unhandled
    rejections and failed requests, captured from app boot rather than from when the sheet
    opens. A parent can say "the timer froze"; only the app can say `TypeError` at 21:04.
  - Issues arrive labelled `surface:kid` / `surface:parent`, so a tablet bug is one filter away.

### Removed
- `src/routes/feedback.ts`, `src/github-issues.ts`, `src/feedback.test.ts` and
  `docs/operational/feedback-channel-setup.md`. **No `HATCH_GITHUB_TOKEN` is needed on any
  instance** — the outstanding setup job from v0.98.0 is cancelled, not deferred. Nothing
  else read those files.

### Security
- **Address redaction moved client-side and is now the ONLY scrub.** In this mode the browser
  talks to the issue service directly, so this repo's server never sees a report and cannot
  clean one up on the way out. `nimiq-app-shell` strips address-shaped text from the report,
  from the captured console/network context, and from the title the service returns; its
  suite pins all three. If that ever regresses, kid account ids reach public GitHub issues.
## 0.98.4

- Three more em dashes in the parent approval notification bodies
  (`X NIM — needs your OK`). The previous sweep reported this repo clean and it was
  not: the linter had a 25-character floor and a 3-lowercase-run floor that between
  them hid any short notification string. Both floors lowered upstream.

## 0.98.3

- Strip the AI-writing tells from shipped copy. Nine em dashes across parent
  notifications, a payout-refused message and thrown errors; `X not set — cannot Y`
  became `X not set: cannot Y`, and the refused-payout body took a period rather than
  the comma splice the auto-fix left.
- Add `.proseignore`. The egg-timer tuning rig at `public/kid/timer/wiggle.html` is an
  instrument, not a screen: served from public/ because it loads the real sprites, but
  its copy is knobs. Also the in-public session handoffs and the unreferenced egg-demo
  harness. All five locales stay linted.
- No behaviour change.

## [0.98.2] - 2026-08-01
### Changed
- **Handoff correction: do NOT wire a feedback PAT yet.** `bot.nimiq.tech/widget.js` is live
  and is the fleet's actual bug submitter (voice + text, console/network capture, AI-drafted
  issues, central GitHub token, so no per-app PAT). It was missed when v0.98.0 was built, so
  this repo now has a second, thinner reporter. The two are complementary rather than
  redundant — the widget has the capture and triage, this has the corner placement instead of
  a floating button — so the handoff now says stop and get a decision instead of "one
  10-minute job".

## [0.98.1] - 2026-08-01
### Changed
- **`docs/NEXT-SESSION.md` records the bug reporter**: where the row lives and why it is not
  a floating button, what the server scrubs before anything reaches an issue, the PAT job
  that is still outstanding, and the kid connect screen's missing corner. Plus two traps that
  cost real time: `pkill -f "bun run src/server.ts"` is what all three launchd services exec
  (it took the apex down for ~30s), and the kid corner only renders on `.chart-screen`, so
  verifying anything in `#lang` means going through the demo and picking a kid first.

## [0.98.0] - 2026-08-01
### Added
- **Anyone can report a bug from inside the app, on both the kid tablet and the parent
  app.** The app has been live to real families and to competition judges with no way to
  tell us anything was wrong: a bug found on the tablet had to survive until someone got
  to a laptop and remembered it. It now takes about fifteen seconds from the screen the
  bug is on.
  - **It lives in the corner menu, not on the screen.** Hashmark's reporter (the one this
    is ported from) mounts a floating dot on every page. The kid app is a full-bleed
    tablet surface for a child, and a permanent button parked on it is both a distraction
    and something a five-year-old will press: the whole point of putting this behind the
    corner control is that a screen with no bug on it looks exactly as it did before.
  - **Both apps, one row.** Parent and kid already mount the same
    `mountCornerControl` (`#wallet-slot` and `#lang`), so this is one line each and the
    row reads in all five languages the app ships.
  - **The report knows which screen it came from.** Surface (`kid`/`parent`/`portal`/
    `demo`) and the running version ride along, read off the path and `/health` rather
    than typed by the person reporting, and land as GitHub labels: `surface:kid` is a
    filter, not a guess.
- **`POST /api/feedback`** files the report as a GitHub issue with a server-side PAT
  (`HATCH_GITHUB_TOKEN`, Issues-only, on this repo alone). Setup and rotation:
  `docs/operational/feedback-channel-setup.md`.
  - **Nothing about a child leaves in an issue body.** The client is thin about what it
    collects, but a client is editable, so the server scrubs too: address-shaped text is
    redacted, the opt-in diagnostic block is capped at 2000 characters, and the reporter's
    IP is masked to a /24 before it is written down. No name, no family id, and the page
    URL arrives without its query string.
  - **Three reports per hour per address**, and an unconfigured instance answers 503 with
    an optional `mailto` rather than swallowing what someone just typed.
  - Optional `HATCH_FEEDBACK_NTFY` pings a phone when a report lands, so this does not
    depend on anyone remembering to watch a repo.

### Notes
- Requires `nimiq-app-shell` v0.7.0, which adds the `reportBug` seam. Every other fleet
  app gets the same row by bumping the shell and passing one option.
- **Known gap, pre-existing:** the kid app's connect/login screen hides the corner
  entirely (`wallet.css` shows it only on `.chart-screen`, and its `.login-screen` rule
  matches nothing — the class is `.k-connect-screen`). So pairing problems, which are
  exactly the ones worth reporting, still have no reporter. Left alone here rather than
  changed blind, since that CSS is about where the language control belongs.

## [0.97.0] - 2026-08-01
### Added
- **A parent can finally put a job on their own kid's board (#84).** `/parent/` registered
  seven views and not one of them created or edited work: a parent could approve it, fund
  it and stock the Treasure Box, but the only things that could ever CREATE a chore were
  the kid's own Add a job sheet, the seeder, and a raw API call. New `views-board.js` is
  the missing half: jobs, routines with their steps, and practices, all on one screen.
  - **Per kid, reached from the kid.** A board belongs to a child the way a balance does,
    so it hangs off the per-kid page exactly as the Treasure Box hangs off Settings. The
    tab bar is chrome and stays four wide.
  - **One screen for all three shapes.** Three tables, but to a parent one question: what
    does this kid do? It is also how the kid's own Today screen groups them. (That
    answers all three of the issue's open questions.)
  - **Every name field sits under the shared job picker**, so the ordinary path posts
    `catalogId` and the row stores a `title_key` that reads in the kid's language forever
    (v0.92.0). Typed words stay the parent's, untranslated, on purpose.
- **`PATCH /chores/:id` and `PATCH /routines/:id`.** The issue said the server side was
  complete; it was complete for CREATING. Nothing could rename a chore or a routine, or
  change what a chore pays. Both now mirror the rule `updateTask`/`updatePractice` already
  had: **renaming clears `title_key`**, or our words would come back over the parent's
  edit at the next language change.
- **`?includeInactive=1` on `GET /routines` and `GET /practices`**, honoured only for a
  parent bearer token of that family. Without it, retiring a routine was a ONE-WAY DOOR:
  both lists filter `active=1`, so a routine hidden by mistake could never be found again.
  Retired rows now show here greyed with a way back, which is the rule the Treasure Box
  manager already runs on. A kid's tablet asks for neither and sees neither.

- **29 new job icons, so all 42 catalog jobs have drawn art on BOTH screens.** The first
  sixteen covered only thirteen of the catalog, so twenty-nine tiles fell back to their raw
  emoji — on the kid's own board as much as the parent's. It stayed invisible because an
  emoji is a plausible-looking fallback; it only surfaced when the parent board started
  drawing the same faces. Generated from the same locked prompt and auto-crop as the
  original sixteen (`icon-style.txt`), so they are siblings, not a second set.
  `src/title-catalog.test.ts` now fails if a catalog job has no art, or if a drawn icon's
  file is missing, or if two icons claim the same emoji.

### Fixed
- **The parent board drew raw emoji where the kid sees drawn art** (Andjroo, on the first
  render). Every job on a kid's tablet wears a real icon that `src/task-icons.ts` resolves
  from its emoji; the parent's endpoints return raw rows, so one job looked like two
  different jobs on two screens in the same house. Same bug the Treasure Box hit with pack
  art (#34), same fix: draw what the kid draws. The emoji-to-art map is read from
  `GET /api/task-icons`, the server's own table, not a second copy over here.
- **A toast raised while a sheet was open landed on the sheet's own controls.** The happy
  path was only ugly; the bad path was broken, because a failed save keeps the sheet OPEN,
  so the error telling you what to fix sat on top of the button you fix it with. While the
  scrim is up the toast goes to the top instead.

### Changed
- `src/locales/parent.ts` hit exactly 800 lines (the CI guard is `>=`) when this branch added
  one import, even though every new string went into its own file. The first-run and pairing
  strings now live in `parent-onboard.ts` too, which takes it to 676 and gives it real headroom
  rather than leaving the next change to trip the same wire.
- Chores are editable **only while `open`**, and that is a money rule, not a tidiness one:
  `/chores/:id/approve` pays `reward_luna` as it reads it AT APPROVAL TIME, so an editable
  reward on a submitted chore would change what a kid gets paid for work already done.

## [0.96.0] - 2026-08-01
### Fixed
- **The kid's Add a job sheet had two pickers on it.** Dropping the job grid in above the
  existing icon strip meant a kid picked a job and then picked a face for a job that
  already had one, and the amount field and the Add button were pushed below the fold.
  The job grid is the primary choice now and owns the sheet's scroll; the icon strip is
  what a job the kid NAMED gets, so it appears only once they start typing and disappears
  the moment a tile is selected. Caught by looking at a render, not by a test.

### Known gap
- The judge-demo gate (`src/routes/demo.ts`) is still English in every language. It is a
  standalone page that loads no app shell, so it needs `Accept-Language` picked server
  side rather than the `t()` path everything else uses. It is the first screen a
  non-English judge sees on the demo instance.

## [0.95.0] - 2026-08-01
### Removed
- **The legacy root app is gone: `public/index.html`, `public/js/app.js`, `public/app.css.`**
  It was a second, older copy of screens `/parent/` and `/kid/` already own, and it had
  stopped being reachable on both public instances on 2026-07-30, when "/" became the
  marketing site. Three things it was quietly still holding:
  - it was the ONLY surface that still rendered raw chore titles, so it was also the only
    place the v0.92.0 localization would have had to be done twice;
  - it was the only registrar of `public/sw.js` (`navigator.serviceWorker.register`), which
    means the service worker has been dead in production since that same date — verified
    against the live apex and `/portal/`, neither of which registers it;
  - it carried the last consumer of `EXPLORER_TX`.

### Changed
- **A family install's "/" now redirects to `/portal/`** instead of serving that shell.
  The competition instance (marketing site) and the demo instance (redirect to `/demo`)
  are untouched; all three modes verified against a running server.
- `public/sw.js` is KEPT, with its precache list corrected and a header stating plainly
  that nothing registers it. Re-arming it is one line in `portal/index.html` — a
  deliberate call about offline behaviour, not something to decide inside a cleanup.

## [0.94.0] - 2026-08-01
### Fixed
- **The language switch translated the headings and not the board underneath them.**
  "MORNING" became "MAÑANA" and "Brush your teeth" stayed English below it. Headings were
  keys; everything on a board is a row in SQLite with a `title` column, and the titles we
  SEEDED were stored as English prose — demo chores, routine sub-tasks, the onboarding
  starter board, Treasure Box shelves, coupons and sticker packs. Those were never the
  parent's words, so storing them as prose was the mistake rather than the renderer.
  Every title we author now carries a `title_key` (`src/title-catalog.ts`) beside the
  English, and one rule renders everywhere: `title_key ? t(title_key) : title`. That is
  the rule `public/kid/js/box.js` already used for Treasure Box shelves, generalised — its
  hard-coded id-to-key map is gone, replaced by a key the row carries.
- **A parent's own words are NOT translated, on purpose** (Andjroo, 2026-08-01). A typed
  chore stores no key and renders verbatim in every language, because "Feed Winston his
  5pm scoop" comes back from a translator with the dog as a noun. Renaming a seeded row
  CLEARS its key in every table that has one, so an edit can never be overwritten by ours
  at the next language change.
- **Adding a job is now a picker, which is what makes typed input rare.** `GET
  /api/catalog/jobs` serves 42 named jobs in 7 groups as KEYS with no prose, so the grid
  is itself in the reader's language. Tapping a tile posts `catalogId` and the server
  reads the words, the emoji and the key from one table — a client cannot post a title and
  a key that disagree. Wired into the kid's Add a job sheet.
- **The parent's approval queue named its subjects in English on every phone.** "Routine",
  "Chore", "Prize", "Grow NIM", "Give NIM to {name}", "Send a Cashlink" were composed
  server-side with no row to hang a key on. Now keyed (`papp.subj*`), all 5 languages.
- Existing databases are backfilled ONCE, on the boot that adds the column, matched on the
  exact English we seeded — so the demo households already on disk (the ones a judge opens)
  localize too, not just families created after the deploy. Rows a parent has edited are
  skipped.
- A missing translation falls back to the row's stored English rather than painting the raw
  key onto a card. Caught by a test, not by eye: every device sees that state in the gap
  between a server deploy and a client cache refresh.

### Added
- `src/title-catalog.ts` — the titles we author, as stable ids. `src/locales/catalog.ts`
  carries them in all 5 languages, merged into BOTH app locale sets so the kid's board and
  the parent's queue name a chore identically. A test fails the suite if a new tile is
  missing from any language, which is the only thing standing between a new chore and a
  board that is half-translated in production.

### Changed
- `src/locales/parent-approvals.ts` split out of `parent.ts` (800-line CI guard).
- `app.kidShelf*` removed: shelves carry their own key now.

## [0.93.0] - 2026-08-01
### Changed
- `docs/NEXT-SESSION.md` records the evening the demo economy became self-running: the six PRs
  from v0.80.0 to v0.92.0, how money now moves (mint on chain -> 4h TTL -> reclaim -> faucet
  top-up), where to read each figure FRESH rather than copying it, what is still open, and the
  three traps that cost real time. The standing instruction is not to quote a NIM number out of
  the file at all, since every previous copy went stale within a day.

## [0.92.0] - 2026-08-01
### Fixed
- **`purgeFamily` could not delete a household that had ever recorded a payout attempt**, and
  the failure took the whole sweep with it. `payout_attempts` and `kid_address_challenges` both
  carry a `child_id` foreign key and neither was in the delete list, so `DELETE FROM children`
  threw `SQLITE_CONSTRAINT_FOREIGNKEY` — and because the throw escaped the sweep loop, every
  household queued behind it was skipped too. Measured live: a backlog of **82 stale families
  got through 33** before the cycle died with a stack trace and no summary line.
- **One bad household no longer ends the sweep.** Each purge is isolated; a household that
  cannot be deleted is counted as `unpurgeable` and reported, which is a bug to fix rather than
  a reason to stop forgetting everyone else.
- **The delete list is now derived from the schema by a test.** It has fallen behind three
  times — `sticker_placements` was caught in review, these two were not. Any future table with
  a children foreign key fails `demo-family.test.ts` the moment it is added. Both new tests were
  confirmed to fail against the unfixed code.

### Changed
- **Sweeps are capped at 12 households per cycle** (`HATCH_DEMO_SWEEP_MAX`). The reclaim makes
  two RPC calls per kid, and a backlog of 82 families is ~330 calls in a tight loop: the public
  node's 429s defeated even the four-attempt backoff, so balances read as unreadable and the
  money stayed put. Capping keeps each pass inside what the node will answer and lets the next
  tick take the next slice, so a backlog drains over several passes instead of failing in one.

## [0.91.0] - 2026-08-01
### Fixed
- **The top-up's mainnet guard exited 1 instead of 2, and 1 is the wrong page.** The guards
  were below static imports, so pointing the script at mainnet made `../nimiq/client` throw at
  IMPORT time — which exits 1, the code that means "the faucet is not keeping up". A
  misconfigured operator would have been paged as a budget problem rather than a broken setup.
  The guards now read raw env before anything chain-touching loads, the chain imports are
  dynamic, and a module that refuses to load is itself reported as "cannot decide" (2). Found
  by testing the exit contract rather than by reading it: an alerting system nobody has fired
  is not an alerting system.

### Changed
- The wrapper gates itself to hourly (`MIN_INTERVAL`, default 3600s) and rides
  `poller-watchdog.sh` — which cron already runs every 10 minutes and which every other
  nimiq.kids watchdog already hangs off — rather than taking a crontab line of its own.
  `crontab` cannot be written from an agent shell on this box; it fails `Interrupted system
  call` on its own temp file. The rider sits ABOVE the `pgrep … && exit 0` early-exit, because
  that line returns 0 whenever poller-loop is already running, which is the normal case.

## [0.90.0] - 2026-08-01
### Added
- `src/nimiq/keyguard-vectors.test.ts` checks our signed-message digest against **the
  Keyguard's own committed fixtures** rather than against a second transcription of its
  algorithm. `tests/lib/Key.spec.js` spells out the prefix literal, the message bytes and the
  length field it concatenates; `tests/DummyData.spec.js` plus "can derive addresses (BIP39)"
  give a mnemonic and the two addresses it must produce. We reproduce both exactly. That is
  the gap `address-proof.test.ts` names in its own header and could not close.
- A test that the length field is the **byte** count. Every Keyguard fixture is ASCII, where
  byte and character counts are equal, so their vectors cannot tell the two apart — and
  neither could ours: swapping `body.length` for `message.length` left the whole suite green.
  The new test builds both candidate digests and demands ours be the byte-length one.
- `spike/hub-q1` grew the round trip it was missing: the server mints a real challenge with the
  production `bindingMessage`, the wallet signs it, and the signature goes back to
  **`verifyAddressProof` itself** — not to a copy of it in the page, because a second
  transcription agreeing with the first is the evidence we already had and already distrusted.
- On failure the page names the mistake instead of shrugging. `/verify` re-checks the signature
  against eight specific wrong recipes (character count, missing length field, no prefix,
  unhashed, Blake2b, the CONNECT_CHALLENGE prefix) and reports which one matches, plus the
  address the key actually belongs to.

### Fixed
- **`spike/hub-q1` could never have loaded in a browser.** The vendored `HubApi.es.js` kept its
  bare `@nimiq/rpc` and `@nimiq/utils` imports and the page shipped no import map, so the module
  would have failed to resolve and every button would have been dead. The bundle is now built
  from the installed package on boot and served at `/HubApi.js`, which also means it cannot
  drift from `node_modules`. Verified by loading the page headless: no console errors.
- The Q4 "unknown recipient" address is generated per run instead of hard-coded, so it has a
  valid checksum (the Hub refuses anything else) and is genuinely absent from the address book.

### Changed
- `docs/NEXT-SESSION.md` no longer says the digest is unproven, because most of it now is, and
  says precisely what is left: not the algorithm, but whether the **deployed** Hub behaves like
  the source we read, through a real popup.
- Records that NONCUSTODIAL-PLAN **Q2, Q3, Q5 and Q6** are answered from upstream source rather
  than from a spike, with the parts that change a design decision called out: the `signStaking`
  array is capped at two and must be `retire-stake` then `remove-stake`; `meta.account` is
  identical within an account but is client-reported free text and collides across accounts, so
  it is a negative signal only; the validity window is 7200 blocks (~2 hours) with 60 blocks of
  grace before the pinned height; and the transaction hash excludes the proof, so a pinned-height
  intent is exactly-once on chain regardless of signature determinism.

## [0.89.0] - 2026-08-01
### Added
- **The testnet demo's hot wallet tops itself up** (Andjroo: "is there a way for you to set up
  an automation so that way we do this as the funds get depleted?"). `nimiq-kids-faucet-topup.sh`
  runs hourly from cron, reads the balance, and taps the public faucet when runway falls below
  5 visitors, refilling to 15. A drained wallet does not fail loudly — `payDemoHistory` is
  best-effort, so a visitor still gets a `201` and a household whose kids hold nothing — and
  nothing on the box was watching that.
- **The threshold is denominated in VISITORS, not NIM,** which is the whole design. What a
  visitor costs moved 6,400 -> 24,000 -> 72,000 in a single day as the Treasure Box floor was
  raised twice. Every NIM-denominated number written near this system has gone stale:
  `HATCH_DEMO_GRANT_LUNA` went underwater twice, and `README-TESTNET.md` quoted a balance that
  was a third wrong within a day. `src/topup.ts` asks `seedHistoryLunaAt()` what a visitor costs
  on every run and does the arithmetic fresh.
- `src/scripts/topup-hot-wallet.ts` with `--dry-run`. Its exit codes are the alert contract:
  `0` fine, `1` still below the floor after tapping (a budget problem that may resolve itself),
  `2` could not decide at all. Those last two are deliberately distinct — "the faucet is not
  keeping up" and "I am blind" must not page as the same thing.

### Changed
- `README-TESTNET.md`: the runway table was priced at the old 24,000 NIM per family and is
  corrected to 72,000, with an instruction NOT to copy the number anywhere else and to ask
  `seedHistoryLunaAt()` or the boot line instead. Also records that the TTL, not the balance,
  is the dial that decides daily capacity, since reclaim (#44) made the wallet a float.

### Notes
- Taps are capped at 4 per run and spaced, because this is a shared public faucet run for
  developers. The cap also bounds the damage from a bad balance read: without it, a read
  returning 0 would tap all the way to the target on one wrong answer.
- Verified: one real tap measured **+110,000 NIM**, confirmed on chain, and the dry run against
  the live wallet reported `859,626 NIM · 11.9 visitors · above the floor, nothing to do`.

## [0.88.0] - 2026-08-01
### Changed
- **"Their own bank" is the thesis of the product, so it is now the headline of the Live now
  card.** It used to be a trailing clause, "and they learn to be their own bank along the
  way", and a first pass at this changelog cut it as puffery. Andjroo: "the whole point of
  crypto is to learn how to be your own bank, but for a child it is the essence of this whole
  thing." The generic "A working family ecosystem" is gone; the card is now titled **"A kid
  learning to be their own bank"**. The phrase "family ecosystem" survives in the meta
  description, so the never-say-"family allowance" rule is unaffected.
- **The custody caveat is said out loud rather than implied.** "Be your own bank" is a
  self-custody phrase, and `docs/WALLET-CONTRACT.md` is explicit that kid accounts are derived
  from `HATCH_MASTER_SEED` and server-custodied. So the title says **learning** to be, and the
  body closes with "They are learning to be their own bank with the training wheels still on:
  they run it, you hold it up." A judge who reads the wallet contract finds the page agreeing
  with it.
- **The thesis has to be in the body wording, not carried by the headline alone.** A pass that
  put "own bank" only in the title left the body ending on "The training wheels are still
  on", and Andjroo caught it: a training-wheels metaphor with no bank beside it has lost its
  referent, and the idea reads as removed even though the title still says it. The phrase is
  back in the sentence. This does NOT contradict the restatement rule below: the body sentence
  repeats the phrase but adds the custody qualification the title cannot carry, and a thesis
  is the one thing a page is allowed to say twice.
- **The restatement sweep. Andjroo named the pattern precisely: "This is the general idea of
  how I see the app growing from here" sits under a heading that says "What comes next", so
  "why would anybody say that?"** Applied as a rule to every string in the section, a line
  earns its place only if it says something the line above it does not. Eight failures:
  - The roadmap intro is **deleted outright**, not shortened. The heading already says it.
  - Five chip kickers restated their own titles and are now facts the title lacks: "Real use"
    to **One month**, "New features" to **Building now**, "Families" to **Distribution**,
    "Content" to **Cosmetics**, "Learning" to **Integrations**. "Community funding" and "Live
    now" already earned their space and are untouched.
  - "The rules that never change" under a label reading "Always" said the same thing twice.
    The title is now **"No ads, no tracking, nothing predatory"**, promoted out of the body,
    and the body keeps only what the title does not cover.
  - "The beta decides what comes after it" duplicated "That month writes the build list" two
    cards above it. Cut, along with "It is the feature I am building now", which the new
    Building now kicker says in two words.
- **Two calls made by Andjroo off side-by-side renders. Decided, do not relitigate:**
  - **The `ROADMAP` eyebrow stays.** It is technically the same restatement as the deleted
    intro, but it is a nimiq-ui marketing element marking a section boundary on a long scroll,
    which is a job the words are not doing. The nav and footer jump to the `#roadmap` id, not
    to that text, so removing it was never a functional question.
  - **The Live now title stays "A kid learning to be their own bank", not "Teaching a kid
    to..."** The teaching variant was rendered with the body's closing line switched to match
    ("You are teaching them to be their own bank..."), and rejected. Do not "fix" this toward
    the parent-voice used elsewhere on the page.
- **Roadmap copy cut from 449 words of body text to 330, without losing a single claim.**
  Andjroo: parts of it read like AI filler. Audited against Wikipedia's "Signs of AI writing"
  (WikiProject AI Cleanup) and cut what it names. The specific removals:
  - "which shows me what to build, what to remove, what to simplify, and what needs to be
    more engaging" (Real use). A four-item participial graft that restates the sentence
    before it. Replaced with "That month writes the build list", which is the phrasing
    already approved in `ROADMAP-COPY.md`.
  - "This is the general idea of" (intro), "The next part of this phase is" (Community
    funding), "A month of real use is how I find the next features" (New features) and
    "This phase is about" (Families). Empty run-ups, and the New features one repeated the
    Real use chip verbatim.
  - "Paying kids for learning, **not just** chores" -> "Paying kids for learning too", and
    "on a schedule **rather than** all at once" -> "on a schedule, not all at once". Both are
    negative parallelisms, the pattern the Wikipedia page ranks first.
- **A title that promised something the body never delivered is now honest.** "Recurring
  allowance and steady releases" said releases; the body only ever described the allowance.
  Retitled "Recurring allowance and bonuses". No release cadence is committed to anywhere.
- **Duplicate labels removed.** The September lane held a chip also labeled "September", and
  the Future goals lane held two chips both labeled "Later". Now "Families", "Content" and
  "Learning", so a label carries information the lane heading does not already give.
- Verified: no em dashes, en dashes or double hyphens in any visible string; the section is
  930px shorter at 390px wide; the accuracy line "approves every chore before it pays" is
  untouched, so the page still does not overclaim against `maybeMintStreakBonus`.
- **Lesson worth keeping.** The Wikipedia checklist flags a real pattern, but it cannot tell
  a hollow significance claim from the one sentence that states what the product is for. Cut
  by rule and you will eventually cut the thesis. Every removal on a page in Andjroo's voice
  gets shown to him before it ships.

## [0.87.0] - 2026-08-01
### Changed
- **A demo kid can now buy one of EVERY item in the Treasure Box, not one of each kind**
  (Andjroo: "we need to fund the kids as well so the tester can purchase things in the
  treasure box"). The per-shelf floor unlocked all three categories but still left a tester a
  single purchase deep: buy the dinner coupon and the 6,000 was gone with the other coupon and
  two thirds of the packs still locked. A tester has to reach every OUTCOME the Box produces (a
  pack that grants stickers, a screen-time unlock that opens a lock window, a coupon that
  queues a parent approval) and still watch a balance go down without hitting zero.
- Floor is now **one of everything plus change**: 30,000 NIM per kid against the catalogue as
  of today, so a demo family seeds at **72,000 NIM** rather than 24,000. Still computed from
  the live catalogue, so repricing or adding a shelf moves it automatically — the property that
  has carried this through three floor changes now.
- **`HATCH_DEMO_GRANT_LUNA` raised to 150,000 NIM**, and this was a blocker rather than a
  tidy-up. `payKidEarn` pays the seeded history without consulting the budget but its rows
  still count as SPENT, so the old 60,000 grant would have left every family at zero available
  and the first approval a tester tried would have died with `budget_exhausted` — while the
  mint still answered a cheerful `paidHistory: 4`. A new test pins the template's grant against
  the seeded history so the two cannot drift apart silently a third time.

### Note
- **This triples what a demo visitor costs, and the runway maths changed with it.** At 72,000
  NIM a visitor, the hot wallet funds roughly 11 concurrent households instead of 34. Reclaim
  (#44, v0.86.0) is what makes that survivable, since the NIM comes home when a household is
  swept — but the TTL is still 24h, so 11 is also the practical per-day ceiling until it drops.
  `docs/NEXT-SESSION.md` carries the arithmetic and the balance-reading command.

## [0.86.0] - 2026-08-01
### Added
- **Abandoned demo families give their NIM back** ([#44]). Every demo visitor is paid a real
  seeded history on chain, and `purgeFamily` then deleted the household without touching the
  money: "this only forgets the household, it cannot claw money back." So each visitor
  permanently scattered their seed into two accounts nobody would ever open again. Measured on
  the live testnet instance the evening of 2026-08-01: **688,720 NIM sitting in 156 demo kid
  accounts** against 808,643 NIM left in the hot wallet, all of it queued for deletion. The
  sweeper now reclaims a household's balances to the hot wallet BEFORE forgetting it, which
  turns the demo from a budget that drains into a float that recycles.
- `src/demo-reclaim.ts` holds the money path, with the chain calls behind an injectable seam so
  the decisions (whose money may be moved, what counts as a failure) have real tests despite the
  suite running in SIM.
- `src/scripts/reclaim-demo.ts` — on-demand reclaim with a `--dry-run` that prices the backlog
  without sending anything. `--include-active` drains households still in use and is deliberately
  awkward to reach.

### Fixed
- **Reads against the public RPC now back off, and it matters more than it sounds.** A sweep
  makes two calls per kid; at 170 accounts a plain loop drew `HTTP 429` on 110 of them. The
  first dry run priced the estate at 253,750 NIM. With a four-attempt backoff the same estate
  measured **688,720 NIM** — rate-limiting had been hiding nearly two thirds of it. Sends are
  deliberately NOT retried: a broadcast that throws may still have landed, so the next sweep
  re-reads the balance instead of guessing.

### Changed
- `sweepDemoFamilies` is async and returns `{ purged, reclaimedLuna, held, abandoned }` rather
  than a count. A household whose reclaim fails is **held** for a retry instead of being deleted
  with its money on it; past `HATCH_DEMO_RECLAIM_GRACE_TTLS` (default 3) the sweeper gives up,
  purges, and says so, because it must never wedge.
- The boot sweep is guarded against re-entry. It used to be synchronous DB work that could not
  overlap itself; it is now hundreds of RPC round trips and can outrun its own hourly timer, and
  two concurrent sweeps would read the same balance twice and try to spend it twice.
- New knobs: `HATCH_DEMO_RECLAIM=0` disables reclaim, `HATCH_DEMO_RECLAIM_GRACE_TTLS` sets the
  retry window.

[#44]: https://github.com/Andjroo111/nimiq-kids/issues/44

## [0.85.0] - 2026-08-01
### Changed
- `docs/NEXT-SESSION.md` records the job timer: why there were two eggs, why the clock
  conflict is settled by correction rather than by picking a winner, what job mode drops and
  why, and the traps (mask-size on a viewBox-only SVG, never positioning the card from a
  measured height, the safe-area failure no local screenshot can show, and width being the
  wrong lever against the back chevron).
- Documents a **third** silent deploy killer: a deploy checkout left on a feature branch. The
  loop refuses and says so only in the log, so that one instance stops while the others carry
  on. Includes the branch-and-dirtiness check for all three, and the phantom ` M` a stale
  index stat produces on a clean tree.

## [0.84.0] - 2026-08-01
### Changed
- **The job says itself ABOVE the egg, in a card, and the egg gets its face back.** Andjroo:
  the title sat on the shell and "just doesn't look very well positioned on top of the egg".
  Name, length and icon move into a callout in the space above it — the vendored Nimiq
  tooltip (`public/vendor/nqp/tooltip/`), the same card-with-a-triangle as the copy-address
  toast, transcribed at its own 8px rem scale and then scaled to this screen. `RIG.rest()`
  is the new third rig state: face on, clock untouched. The faceless shell was only ever
  right while the dial was written across it. Sized 20px against the host's back chevron
  rather than by eye: the card grows upward, so at 28px a wrapped title put its top at
  y=11, straight through it. A four-word job stays on one line.
- **The icon is the job's real icon.** Every other surface draws `iconUrl` (the asset
  `src/task-icons` resolves from the emoji); only the timer was rendering the raw emoji
  glyph. Falls back to the emoji, then to nothing, exactly as `chart.js` and `done.js` do.

## [0.83.0] - 2026-08-01
### Changed
- **"I'm done!" is a labelled pill, not a bare check.** Andjroo's call. It leaves the round
  `#runCtl` row — which now goes entirely in job mode, because pause and stop were already
  gone and an empty flex row is just a gap where the kid's one button should be — and takes
  the screen's big bottom slot, the same box Start uses on the set screen and Done uses after
  the hatch. Teal, so the primary action wears the one accent. The words come from the host,
  and the button ships empty so there is no English to flash before the locale lands.

### Added
- **One timed chore per demo kid** (`Make your bed` 3:00, `Water the plants` 2:00). A chore
  offers "use timer" only when it carries a duration, and no seeded chore did — so on the
  live demo a judge could reach the egg timer from a routine task and never from a chore,
  even though the two run different code (a task's clock is the server's and resumable, a
  chore's is local). `SeedChore.durationS` carries it; a test holds it at exactly one per kid.

## [0.82.0] - 2026-08-01
### Fixed
- **A job's timer is the same egg the dock opens.** Tapping "use timer" on a job card ran
  `kid/js/egg.js` — a placeholder SVG with four hardcoded crack strokes that predates the
  canvas rig and was never swapped when the rig landed. The dock's Timer and a job's timer
  were two different eggs. They are one now.
- **A timed CHORE no longer throws.** `chart.js` handed `flow.js` a `routineId` and a
  `taskRunId` on every card, which a chore has neither of, so it fetched
  `/api/routines/undefined/today` and died on `entry.taskRuns.find`. The button rendered
  (chores do carry `durationS`) and did nothing at all. The card goes through now, and which
  kind of job it is belongs to `flow.js`.

### Added
- `RIG.setLeft(sec)` in the rig, and `?job=1` in the timer screen: the job's name and length
  in place of the dial, "I'm done!" in place of stop, and no `+`/`-`/pause — those would lie
  about a duration the server owns. Labels cross the frame so the timer stays free of i18n.
- `tools/eggtimer-jobflow.py` — a routine task and a chore, card to landed, plus resume and a
  deliberate knock to the rig's clock to prove the app corrects it.

### Changed
- The app keeps the clock. The rig's own is `run.left -= dt`, which stops when the tab hides;
  `createCountdown` re-derives from the wall clock and corrects the rig once a second, so a
  task stays resumable against the server's `started_at`.

## [0.81.0] - 2026-08-01
### Fixed
- **A demo kid could afford a sticker pack and nothing else.** The seed floored at twice the
  cheapest shelf (2,000 NIM) while a coupon is 6,000, so a visitor could buy one thing, find a
  whole category still locked, and reasonably read the demo as the same wall it had been. The
  floor is now one of the cheapest item on **every** shelf plus change (10,000 NIM against the
  current catalogue), computed per shelf from the live catalogue so repricing a shelf moves it.
- **The week grid opened blank on every fresh demo.** The chart home *is* the current week's
  sticker grid, but the seeded history wrote ledger rows and approved chores without ever
  writing a PLACEMENT. Each seeded past job now places its sticker, `shined` (the state a
  parent's approval produces), dated Monday-through-today in the family's timezone, so a
  placement can never fall outside the rendered week or land on a day that has not happened.

### Changed
- `HATCH_DEMO_GRANT_LUNA` in the testnet template raised to 60,000 NIM. The old 2,500,000 luna
  (25 NIM) predates both the shelf reprice and the seed floor and is underwater by three orders
  of magnitude; the boot check flags it, and this is the value that clears it.
- `README-TESTNET.md` now states what a demo visitor **costs** the hot wallet, how many visitors
  a given balance funds, and how to spot the silent failure: `payDemoHistory` is best-effort, so
  a drained wallet still answers `201` and hands over a family whose kids hold nothing.
- **Each demo visitor now costs 24,000 NIM, up from ~6,400** — the direct consequence of the
  higher floor, and the number to plan a judging window around. Measured against the live hot
  wallet the evening of 2026-08-01, that is ~40 visitors of runway rather than ~149. One faucet
  tap (~110k NIM) is now ~4.5 visitors, so a judging window needs several taps.

### Note
- This branch also carried a `background-size: cover` fix for `.k-chart, .k-box`. It is dropped
  as superseded: v0.80.0 removed that rule outright and moved the scene onto `#kid-app`, which
  fixes the same distortion and the six wallet screens the `cover` patch never reached.

## [0.80.0] - 2026-08-01
### Fixed
- **The kid's scene is framed to the screen again, on every screen.** `bgFor()` returns two
  halves and they were landing on two different elements: the CLASS went to `#kid-app` (via
  `setScreen`) while each screen wrote the IMAGE inline on its own root. `#kid-app` is the only
  node that is always exactly the viewport, so `.bg-image`'s `background-size: cover` was sizing
  an element that had no image, and the element that DID have one fell through to `auto` and
  painted the art at its natural 896x1200 anchored top-left. That is what the wallet, Send,
  Receive, Grow, the amount pad and the scanner were all showing. `setScreen` now takes the whole
  `bgFor()` object and applies both halves to `#kid-app`, so the scene is sized once, in one
  place, against the viewport.
- **The chart home and the Treasure Box are no longer distorted.** Both were sized by
  `background-size: 100% calc(100% - var(--kid-dock-h))` in `chart.css`. A two-value
  `background-size` sets width and height independently and cannot preserve aspect ratio, so the
  chart rendered at 68% of the art's true aspect (round shapes as ovals) and the Treasure Box at
  47%: `.k-box` grows with its shelves (1192px measured on a 390x844 phone) and the percentage
  grew with it, so the one rule squashed one screen and stretched the other. The rule is gone;
  the note in its place explains why fitting a composition above the dock is an art problem.
- **The marketing page's primary pill had its gradient reversed.** Nimiq anchors every colored
  radial at bottom right with the DEEPER stop at the anchor, lightening outward. `.pill--primary`
  had the light stop at the anchor and the dark one at 78%, off-palette stops, and a `120% 180%`
  extent. It now uses `--nimiq-light-blue-bg` (`#265DD7` -> `#0582CA`) verbatim, with
  `--nimiq-light-blue-bg-darkened` for hover and focus, the way `.nq-button.light-blue` pairs
  them. This is the "Try the demo" pill in the drawer menu and in the closing CTA.
- `app.css`'s gradient tokens were drawn at a `120% 120%` extent, so the same button read lighter
  there than in the kid app, the parent app or on the site. All four are `100% 100%` now.

## [0.78.0] - 2026-08-01
### Changed
- `docs/NEXT-SESSION.md` records that non-custodial Phase 2 is live, and what it did NOT do:
  `HATCH_CUSTODY` is unset on all three instances, so every kid is still on a server-derived
  address and nothing changed for anyone.
- Says plainly that **the registration flow has never been run against a real Nimiq wallet**.
  The verifier reproduces the Keyguard digest transcribed from source, and the tests check it
  against an independent transcription of the same algorithm, which cannot prove the
  transcription. The failure mode is fail-closed, so nothing is at risk, but "a parent can
  register an address" is built-and-plausible rather than proven until someone signs with a
  wallet.
- Four traps written down where the next person will look: a guard on the SIGNING seam is not a
  guard on the REQUEST; `:3950` serves HTTPS, so a plain curl reads as a dead instance; an
  additive column migration must add the column it writes to FIRST or it throws only on the one
  boot that matters; roster row copy truncates rather than wraps, so measure it.
- Open now names Phase 3 as the next headline, with the production pattern it should reuse, and
  points Q2/Q3/Q5 at reading the Hub and Keyguard source the way Q1 was answered.

## [0.77.0] - 2026-08-01
### Added
- **A kid's address can now be one the PARENT controls** (NONCUSTODIAL-PLAN Phase 2, address
  provenance). A parent picks an address out of their own Nimiq wallet, signs a server-issued
  challenge with it, and that address becomes the child's. No key for it exists on this server
  and none can be derived. `children.address_source` says which kind a row is: `derived` (the
  old server-custodied HD account), `parent`, or NULL for a kid with no address yet.
  - `POST /api/kids/:id/address-challenge` then `POST /api/kids/:id/address`. Both parent-authed,
    never kid or device. Two round trips because the Hub is a full-page redirect on mobile, so
    the challenge lives server-side and is resumable by id.
  - The proof is verified against the Keyguard's own digest, read from nimiq/keyguard source
    rather than remembered: `SHA256(utf8("\x16Nimiq Signed Message:\n") || utf8(byteLength) ||
    messageBytes)`, signed over the HASH. Both legs must hold — the signature verifies over OUR
    message, AND the public key hashes to the address being claimed. Either alone proves nothing.
  - The whole proof is stored on the row, not a "verified" boolean, so it can be re-judged from
    the row alone against a restored or hand-edited database.
- **The parent app pins each registered address in localStorage** and shows a loud card when the
  server later reports a different one for that kid. That is the shape an address swap by a
  compromised server would take, and 36 base32 characters do not read as wrong. The pin is the
  only mitigation we can currently claim: the Keyguard's own address-book label (Q4) is still
  unconfirmed.
- **The boot guard.** `HATCH_CUSTODY=parent` refuses to start unless `HATCH_MASTER_SEED` and
  `DEV_PARENT_PRIV` are both unset AND every child with a non-null `account_index` reads a ZERO
  balance at its derived address. An unreadable balance refuses too — a read that failed is not
  a zero, and the safe direction here is the opposite of `topUpExecuted`'s. This is what turns
  "every kid balance is zero" from an assumption into a checked precondition.
- **The migration script** (`src/scripts/migrate-to-parent-custody.ts`), dry run by default. It
  re-verifies each stored binding, reads each derived account, and drops the derivation
  coordinates only for kids whose old account is PROVED empty. It never sweeps, never signs, and
  refuses to clear coordinates for a funded account — those coordinates are the only remaining
  way to derive the key that can move that money.

### Fixed
- **Every kid-initiated outflow now refuses at REQUEST time on a parent-owned address**
  (409 `parent_signature_required`): send, cashlink, family transfer, stake, unstake, and the
  Treasure Box buy. The first cut relied on `kidKey()` refusing to sign, which refuses too late:
  on the queued paths that is AFTER a parent has tapped Approve, leaving a burned approval and a
  send request orphaned in `pending` — the same shape as the checksum failure in #33. Worse, in
  SIM nothing signs at all, so a live instance happily "sent" 50,000 luna out of an address it
  holds no key for and answered 200. Found by running it, not by a test. `kidKey()` keeps the
  refusal as a backstop.

### Notes
- **Nothing changes on server custody.** `HATCH_CUSTODY` defaults to `server` and only the exact
  string `parent` flips it, so a typo leaves the old path alone rather than half-applying a
  custody change. Existing kids keep the address they have until a parent re-registers them; an
  instance can run mixed indefinitely.
- Under `HATCH_CUSTODY=parent`, `POST /api/onboard` requires a real `address` and loses the
  hot-wallet fallback: a family whose `parent_address` is the instance wallet cannot sign for
  itself. Gated on the switch so the judge path, which never connects a wallet, is unchanged.
- Registration is Hub-only. `@nimiq/mini-app-sdk@0.1.0` has neither `chooseAddress` nor
  `signMessage`, so inside Nimiq Pay the flow says "open this in a browser" rather than opening a
  popup that will never appear. It drops to `@nimiq/hub-api` directly rather than bumping
  nimiq-app-shell fleet-wide for one screen.
- Phase 3 (chore payout by parent signature) is deliberately NOT in here.

## [0.76.0] - 2026-08-01
### Changed
- `docs/NEXT-SESSION.md`: Grow is ON. The handoff's red "one thing needs Andjroo" block is
  replaced with the verified result (stake and unstake settling on the live demo, block
  7,582,088) and the three ways it can regress: a validator that retires silently turns
  staking into a no-op, the env value must be quoted because a Nimiq address contains
  spaces, and reading `stakedLuna` too early looks exactly like a failed stake.
- Records that the mainnet competition instance was deliberately left unchanged.

## [0.75.0] - 2026-08-01
### Fixed
- **The Grow screen said "0 NIM" to a kid who had just staked.** A stake is written pending
  until the chain is seen to agree, and for that window `stakedLuna` is still 0 while
  `pendingStakeLuna` holds the amount — which the screen never read. So it answered with an
  empty hero and the "put some NIM here and watch it grow" hint, as though nothing had
  happened. It shows the amount on its way in instead, mirroring the pending-unstake line
  that was already there, and the empty-state hint no longer fires while a stake is settling.
- Found while verifying Grow on the live demo: the screen reading empty is exactly what made
  a stake that had in fact broadcast and confirmed look like a failure.

## [0.74.0] - 2026-08-01
### Changed
- `docs/NEXT-SESSION.md` records the demo audit (#62) and what came of it: what a judge can
  actually do today, the two findings I raised and then disproved by looking at the render
  (the Timer is canvas, not blank; Receive does show the address, chunked), and the two that
  are still open (blank week grid, no equip path).
- The handoff now opens with the ONE thing that needs Andjroo: `HATCH_VALIDATOR_ADDRESS` is
  commented out on both instances, which is why Grow is a dead end, and it is an env line
  rather than code. Includes the quoting trap (a Nimiq address contains spaces) and the
  reason to pick a currently-active validator.
- Corrected the hot-wallet figure to 1,044,550 NIM and the per-visitor cost to ~8,500 NIM
  now that a visitor can also be given NIM, so ~120 visitors of runway rather than ~195.

## [0.73.0] - 2026-08-01
### Added
- **A parent can give a kid NIM directly** (`POST /api/kids/:id/fund`, plus a "Give ... some
  NIM" row on the parent's per-kid page). Until now the ONLY way money reached a kid was
  approving a chore, so a parent who simply wanted to hand over pocket money had to invent a
  job for them to do. Three preset amounts, an optional note, real settlement.
- **Transaction rows link to the block explorer, in both apps.** `EXPLORER_TX` was already
  computed per network and published on `/health`, but its only consumer was
  `public/js/app.js` — the legacy root app. The kid's Money feed and the parent's activity
  list now open the public record of any row that has a hash, which is the proof that the
  payout a visitor just watched land is a real transaction and not a number in a database.

### Notes on the money path
- The gift is written as an `earn` row **on purpose**. `spentLuna` (src/repo-budget.ts)
  derives a family's spending from `kind='earn'`, Treasure Box refunds and Cashlink mints, so
  a gift under a new row kind would move real NIM out of the shared hot wallet and be
  invisible to the budget — an open tap where one visitor drains the wallet for every other
  household. Reusing `earn` also inherits the write-ahead payout claim, the
  pending-until-the-chain-agrees status and `sweepPendingEarns`.
- Gated with `checkPayable` BEFORE anything moves, like an approval: `payKidEarn` does not
  consult the budget itself, so the caller has to. Capped per gift at `HATCH_MAX_FUND_LUNA`
  (2,000 NIM) so one caller cannot empty the hot wallet in a single request. Serialized on the
  family spend lock. `requestId` makes a double tap pay once.
- Cost: worst case per demo visitor goes from ~6,500 NIM to ~8,500, i.e. testnet runway
  ~195 -> ~148 visitors at the wallet's 1,261,863 NIM measured today.
- Pending rows link to the explorer too. A payout is written pending until the chain is seen
  to agree, but the hash is already broadcast and the explorer is the authority on what
  became of it; excluding them would mean a freshly minted demo family shows no receipts at
  all, which is exactly when someone wants to check. Only `failed` rows stay inert, and SIM
  never links because its hashes are invented.

## [0.72.0] - 2026-08-01
### Changed
- **The handoff said the competition entry was "filled but not submitted". Andjroo submitted
  it on 2026-07-31**, ahead of the machine-enforced close (Fri 19:00 US Central). The line
  was written earlier that day and went stale within hours, then got repeated back to him as
  an outstanding task.
- `docs/NEXT-SESSION.md` now records the submission and, more usefully, says **not to
  re-assert submission status from this repo at all**: nothing on the machine knows it. The
  local `~/Desktop/nimiq-kids-submission/` folder holds only exported images, so its presence
  proves an export happened, not that anything was filed. Ask Andjroo.
- Second instance of the same failure in one day, after [#28]: a stale local artifact read as
  live state. Both are now called out where someone would look.

## [0.71.0] - 2026-08-01
### Changed
- **The handoff said the walkthrough video was still missing. It has been live for a while**
  ([#28] closed). `VIDEO_URL` is set, the hero renders
  `youtube-nocookie.com/embed/A-w300LQUzQ`, `GET /video` 302s to the watch URL, and the
  video is public. `docs/NEXT-SESSION.md` listed it as the one thing blocked on Andjroo; it
  was blocked on nobody.
- Records **why** it read as open: grepping the served HTML still finds the string
  `Video goes here`, because that text lives in the inline script that builds the
  placeholder **only when `VIDEO_ID` is empty**. It never reaches the DOM once the id is
  set, so a `curl | grep` reports a placeholder that is not there. Verified by rendered
  content instead: one iframe, zero visible placeholder nodes.
- That leaves **exactly one open issue in the repo: [#44]**, which is not urgent.

[#28]: https://github.com/Andjroo111/nimiq-kids/issues/28
[#44]: https://github.com/Andjroo111/nimiq-kids/issues/44

## [0.70.0] - 2026-08-01
### Changed
- **Handoff refreshed** now that the kid-app pairing cluster is closed. `docs/NEXT-SESSION.md`
  led with "#12, #13 and #14 all still reproduce, with #13 the one to take first"; all four
  (including #15) are done and live, so it now records what shipped and what each one taught
  rather than what to go and do.
- **New deploy trap, found the hard way: an untracked file in a deploy checkout silently
  stops that one instance.** `git merge --ff-only` refuses to overwrite an untracked file,
  so the apex sat on v0.63.0 through v0.64.0 and v0.65.0 while the testnet demo deployed
  normally — which is worse than all three stopping, because the fleet looks alive. The log
  line blames "dirty tree or force-pushed main", pointing at the *other* failure mode, so
  the handoff now says to check the trees first and gives the one-liner that does it.
- Corrected two figures the old handoff stated that have since moved: the testnet hot
  wallet holds **1,300,369 NIM (~200 visitors)**, not ~50, and `HATCH_DEMO_GRANT_LUNA` on
  that instance is **60,000 NIM**, not 30,000. Both now say to read the live value rather
  than trust the file.
- Records that `GET /health` publishes `demo`, and that it moved to `src/routes/health.ts`.
- Two new traps: rewriting your own version heading *before* rebasing sidesteps the
  shared-`## [x.y.z]` changelog trap entirely (main moved four times under this session and
  no release was swallowed), and the shell's working directory persists between commands —
  a stray `cd` made `git show origin/main:package.json` report another repo's version.

## [0.69.0] - 2026-08-01
### Changed
- **The demo mint stops handing the browser a PIN nobody reads** ([#15], closed as
  obsolete). `POST /api/demo/family` returned `pin`, the landing page dropped it on the
  floor, and nothing else ever looked at it — which is precisely what that issue observed,
  from the other direction. Nothing on the demo asks for a PIN, so shipping one to the
  client was a credential with no reader. Removed from the response and from `MintedDemo`.
- The PIN is still **set** on a demo household, so a demo family stays a well-formed
  family rather than a special case with a hole in it. What changed is only that it is no
  longer published.
- The comment on `DEMO_PIN` claimed it was *"shown on the demo landing so a visitor can
  use the on-tablet parent PIN pad too."* It was not shown, and the pad does not open: the
  kid tablet checks `demo_at` before opening it and `parentAuth` authorizes a demo
  household directly. The comment now says which surfaces skip it and why.
- The landing-page test's reason was stale too — it said the PIN *"moved to the parent
  app's Settings"*, a pass that was reverted. It now asserts against `DEMO_PIN` itself
  rather than a field of the response, which is stronger: the constant is the single
  source of truth, so the assertion keeps holding if the value ever changes. It also pins
  that the response carries no `pin` at all.

[#15]: https://github.com/Andjroo111/nimiq-kids/issues/15

## [0.68.0] - 2026-08-01
### Fixed
- **The pairing screen's Connect button sat under the iOS keyboard with no way to reach
  it** ([#14]). Measured at 390x844: the button occupied y=531-591 while an iPhone's
  numeric keyboard and accessory bar cover everything below y≈508, so it was 83px under
  the fold — and `.k-screen` is `position: fixed` with `scrollHeight === clientHeight`, so
  there was no scroll to recover it. The screen read as having no submit button at all.
- **The sixth digit now submits on its own**, which takes the button off the critical path
  entirely. This is what a 6-digit code should always have done: `autocomplete=
  "one-time-code"` lets iOS fill all six at once, and every other code entry on the
  platform submits itself. The button stays for the paste-and-edit path. A wrong code
  still clears the field, shows the error and waits, rather than resubmitting.
- **The connect screen now stands on top of the keyboard rather than under it.** iOS does
  not shrink the layout viewport when the keyboard opens, so `inset: 0` kept the screen at
  full height. `.k-connect-screen` now takes its `bottom` from `--k-kbd`, derived from the
  VISUAL viewport, which hands the whole composition — its centring and its
  `overflow-y: auto` alike — the height that is actually visible. `dvh` cannot stand in
  for this: dvh follows the URL bar, not the keyboard.
- With a 336px cover simulated, the button moves from y=531-591 (83px under) to y=363-423
  (reachable), and the screen gains real scroll room where the card is too tall for what
  is left.

### Added
- `keyboardInset()` in `public/kid/js/util.js` with `src/kid-keyboard-inset.test.ts`. It
  takes the window shape as an argument rather than reading globals, because the only
  browser that reproduces this is a real iPhone — headless Chromium reflows on resize and
  never shows the overlap. The test pins the measured iPhone case, that `offsetTop` counts
  (iOS scrolls the visual viewport to keep the field in sight, out of the same budget),
  that the result is never negative, and that a browser with no visual viewport gets 0 and
  therefore the layout it always had.

### Note
- The on-device overlap itself still wants one look on a real iPhone. Everything here is
  verified by measurement and by simulating the visual viewport the way iOS reports it;
  no headless browser can raise a soft keyboard.
- After [#12], a demo visitor never reaches this screen. It is now the first screen a real
  family's unpaired tablet sees, which is where it always mattered most.

[#14]: https://github.com/Andjroo111/nimiq-kids/issues/14

## [0.67.0] - 2026-08-01
### Fixed
- **Opening `/kid/` directly on the demo was a dead end** ([#12]). A shared link, a
  bookmark, or a reload after the 24h family expired landed on "Connect your device" and
  its 6-digit code prompt. That code is minted by a parent app in Settings, and a demo
  visitor has no parent session, so there was no way forward from that screen at all.
- The 401 that triggers it means one thing — this browser holds no device token the
  instance accepts — but what to *do* about it differs by instance. On a family or
  competition instance it is an unpaired tablet and the pairing screen is exactly right,
  so the screen stays; the kid app now checks whether it is on a seeded demo instance and,
  if so, sends the visitor to the demo entrance instead, which mints a household and hands
  this browser its tokens.
- It redirects to `/demo?fresh=1` rather than `/demo` so it cannot become a loop: the
  `?fresh=1` path clears the four demo keys and mints unconditionally, where plain `/demo`
  reuses whatever is in storage. Nothing is lost by clearing, because a 401 is the proof
  that what is stored does not work. Verified that a revisit to `/kid/` once a family
  exists stays put rather than bouncing.

### Added
- `GET /health` publishes `demo` — whether this instance hands out seeded demo households.
  It is the flag `demoSeedEnabled()` already reads, and NOT `custody.demoUnlocked`, which
  answers a different question (are approvals enforced). Free to the kid app: `/health` is
  already the first call boot makes. It is a flag, not a secret, and `GET /demo` answering
  200 rather than 404 already announces it.

### Changed
- `/health` moved out of `src/server.ts` into `src/routes/health.ts`. The endpoint every
  runbook in this repo tells you to trust over a green CI run had no test, because
  `server.ts` opens the DB and primes a chain snapshot at import, so nothing could
  exercise it. As a route module it composes into a bare Hono like every other route here.
  `src/health-demo-flag.test.ts` is its first test: the flag under both env names, that it
  is read per request rather than frozen at import, that it is not `custody.demoUnlocked`,
  that the fields a deploy check reads are all still there, and that nothing about the RPC
  endpoint is published.

[#12]: https://github.com/Andjroo111/nimiq-kids/issues/12

## [0.66.0] - 2026-08-01
### Fixed
- **The legacy gift route refunded a kid whose NIM may already have been sent.** It handed
  the reservation back on ANY mint failure. If the node accepted the funding and merely lost
  the response, the Cashlink is live and claimable on chain AND the kid keeps their balance —
  paid twice, with the hot wallet short the difference. That case was previously
  indistinguishable from a harmless one, so the code refunded blindly and said so in a
  comment.
- `mintCashlink` now splits build from broadcast using `WalletProvider`'s own documented
  `prepareTransaction`/`broadcastRaw` pair, which the payout path already relied on and
  minting never used. A failure in `prepareTransaction` is *provably* pre-broadcast;
  everything after it is ambiguous. `CashlinkMintError.stage` records which, and
  `provablyUnsent` is the single predicate the refund branches on.
- The refund now happens only when the transaction demonstrably never reached the wire —
  which is also the common failure (an unreachable node dies at the head-height read), so
  the ordinary retry path is unchanged. Otherwise the reservation stays and the recovery key
  is logged: a stuck balance is recoverable by hand, a double payout is not.

### Changed
- The `FlakyProvider` test double now implements `prepareTransaction`/`broadcastRaw`, as all
  three real providers do. A double offering only `sendTransaction` exercised a path no
  production provider takes, and is what let this bug hide.

## [0.65.0] - 2026-08-01
### Fixed
- **Changing the language on the kid roster stranded the visitor on the device-pairing
  screen** ([#13]). The "Who are you?" picker is the kid app's first screen and the
  language pill is a headline feature of the demo, so a judge could take the entirely
  correct path and land on a 6-digit code prompt they had no way to answer. Switching the
  currency rode the same repaint path and did the same thing.
- The cause was an ordering nobody could see from the call site. The roster reuses the
  pairing screen's page composition and therefore renders as `class="k-connect k-roster"`,
  while the repaint chain in `onLangReady` tested `.k-connect` first — so the roster
  matched the pairing branch, and the `.k-roster` branch below it was unreachable code
  that had never once run.
- The decision now lives in `currentScreen()` in `public/kid/js/util.js` — the read side
  of `setScreen`, with the ordering rule and its reason written down where the ordering
  is: a screen that borrows another's composition is tested *before* the one it borrows
  from. The call site is a flat lookup table, so it can no longer get the order wrong.

### Added
- `src/kid-lang-repaint.test.ts` pins the repaint contract, including that no branch is
  unreachable — the failure mode that made this bug invisible. `currentScreen` takes a
  class predicate rather than reading the DOM, so the ordering is exercised for real
  without a document. The test also pins the premise (the roster really does still borrow
  the connect composition), so it reports itself moot instead of passing for a reason that
  has gone away.

[#13]: https://github.com/Andjroo111/nimiq-kids/issues/13

## [0.64.0] - 2026-08-01
### Added
- `src/scripts/sweep-hot-wallet.ts` — empty the mainnet hot wallet to a given address.
  The instance holds a funded key so it can pay chore rewards, and there was no supported
  way to take that NIM back off an internet-facing box; it had to be done by hand against a
  live key, which is the worst way to move real money. Supports `--dry-run` (reads, builds
  and signs, stops before broadcasting), refuses without `--yes`, and refuses off mainnet
  or in SIM.
- It prints the signed hex **before** broadcasting and confirms by **re-reading the
  balance** rather than trusting the call's return value. A broadcast call that throws can
  still have been accepted — that is exactly what stranded 0.1 NIM on 2026-08-01 — so the
  hex stays recoverable and the ledger, not the response, decides.

## [0.63.0] - 2026-08-01
### Changed
- **Handoff refreshed** after the sweep of the #20 capture findings. `docs/NEXT-SESSION.md`
  led with a warning that autodeploy was broken and production was eight releases behind;
  that was issue #35, it is closed, and all three checkouts are back on main's lineage, so
  the warning now says what to check rather than what is broken.
- Records what shipped (#29, #30, #31, #32, #34), the ops change #29 required on the
  testnet instance, and the new per-visitor cost of the demo (~5,000-6,500 NIM against ~3
  before, so about 50 visitors per wallet fill).
- Re-verified the older kid-app pairing cluster against live v0.55.1 and wrote down the
  result: #12, #13 and #14 all still reproduce, with #13 the one to take first; #15 is
  obsolete and should be closed.
- Seven new traps, including the two that cost the most time here: every merge re-conflicts
  every other open PR on `CHANGELOG.md`, and a shared `## [x.y.z]` header line makes git
  conflict only the bodies, so a careless resolution silently swallows another session's
  release heading.

## [0.62.0] - 2026-08-01
### Fixed
- **The parent's Treasure Box manager drew a ticket where the kid sees real pack art**
  ([#34]). Every sticker-pack row in the shelf manager showed the generic `ticket` glyph
  while the kid app showed the actual fanned sticker stack for the same item, so the two
  sides of one shelf did not look like the same product.
- The client's fallback chain could never have found the art: a pack's payload carries
  `packId`, never `icon`, and `cat-stickers` has `icon: null` on purpose *because* packs
  draw their own art and were never meant to reach a fallback. Both links fell through to
  the default. The real gap was on the server - `GET /parent/store` simply never sent the
  stickers, while `GET /kids/:id/store` always had.
- The parent endpoint now sends `packId` and the pack's stickers, from the same helper the
  kid endpoint uses so the two cannot drift. Ownership is deliberately NOT included: that
  is a fact about a child, and this endpoint has none in scope.
- `stickerFace` and a new `packFan` moved into `/js/lib/box-glyphs.js`, the lib both apps
  already share for the glyph palette, and the kid app now imports them from there instead
  of owning the only copy. Copying four lines of markup into the parent app would have
  re-created exactly the drift that file exists to prevent - and is what the fleet rule
  about using the real art rather than a stand-in is pointing at.
- An artless pack still falls back to a glyph rather than rendering an empty box, on both
  sides: `packFan` returns "" when a pack has no stickers.

[#34]: https://github.com/Andjroo111/nimiq-kids/issues/34

## [0.61.0] - 2026-08-01
### Fixed
- **Broadcasts aborted after 15 s, so transactions that succeeded were reported as failures.**
  `getClient()` built its RPC sender with `createRpcSender({ url })` and never passed
  `rpcTimeoutMs`, silently inheriting nimiq-settlement's 15 s default. That default assumes a
  full node; this app's mainnet instance broadcasts through a light-client sidecar which
  relays to peers before answering. Proven on mainnet: `sendRawTransaction` aborted while the
  transaction executed on chain (block 57723827, `executionResult: true`). Every chore
  payout, kid send and Cashlink mint carried that risk. Now `HATCH_RPC_SENDER_TIMEOUT_MS`,
  default 60 s. Aborting early never undoes a broadcast, it only destroys our knowledge of one.
- **A failed Cashlink mint could strand real NIM forever.** The URL fragment IS the
  cashlink's private key, and it was derived only AFTER the broadcast and the funding wait —
  so `clKey` was the sole copy of a key that money was already being sent to. Any throw in
  that window destroyed it. That is how 0.1 NIM became permanently unspendable at
  `NQ22 D4XK HBAD H8NY 3UKX P7EA 0EPT 9DLY Y2FF` on 2026-08-01. The URL is now built before
  the transfer, and `CashlinkMintError` carries it out so the key always outlives the failure.
- The streak-bonus mint no longer swallows failures with a bare `catch {}`. A mint that had
  already moved real NIM previously left no row, no key and no log. It now logs the recovery
  material. Deliberately a log and not a `funding` row: nothing in this codebase writes or
  reconciles that status, so a row there would be unreconciled money state.

### Note
`CashlinkMintError` does **not** claim to know whether money moved, and nothing may branch a
refund on it. `provider.sendTransaction` bundles build, sign and broadcast, so a transaction
that was never built is indistinguishable from one whose broadcast response was lost — the
real incident had a null `fundingTxHash` and executed anyway. The pre-existing peer-gift
refund is therefore unchanged and still tracked separately.

## [0.60.0] - 2026-08-01
### Changed
- `public/kid/timer/README.md` said three things that cost time: that `~/data/anim-demo` has
  no git remote (it has had one since 2026-07-31 — private `Andjroo111/nimiq-kids-egg-rig`), that
  vendoring is a plain `cp` (it is not — this repo is public and the authoring copy says "Andjroo",
  so the copy step must scrub the name), and it pointed at a worktree path that no longer exists.
- Adds the two rules the v0.59.0 session learned the hard way: **vendor immediately before
  committing here**, not merely at some point beforehand — a rig change made after the vendor step
  shipped an app copy one change behind; and `index.html`'s `const BUILD='…'` line is an
  **interface**, scanned by `src/timer-build.ts` with a regex that takes the first match in the
  file *including one inside a comment*.
- Documents the three measurement traps that make a before/after lie: `:3950` is HTTPS with a
  self-signed cert and Chromium refuses its HTTP cache over a cert error (a second open measures
  0.35s there and 0.03s on `:3960`, same code, same headers), Playwright contexts share the
  browser's HTTP cache, and a screenshot of a throttled page costs hundreds of ms that accumulate.
- Lists the three proofs added in v0.59.0 (`eggtimer-rawdom`, `-hatchproof`, `-whole`).

## [0.59.0] - 2026-08-01
### Fixed
- **The egg timer flashed its own unstyled DOM before it loaded.** Andjroo: "before the actual
  egg loads, there is a weird little pop up where it looks like there's almost a list of things."
  It was the minute column. Every dimension on the set screen comes from `layout()` and none has
  a CSS fallback, so a paint that beat `layout()` showed sixty numbers at their natural 1440px
  running the length of the phone. What let a paint beat it was a top-level
  `await import('./confetti.js')` between `fillCol()` and `layout()` — the module suspended there
  for one network round trip and the browser painted the gap. One round trip, so bandwidth never
  helped: ~80ms on localhost at 8 Mbps, 200-400ms on a phone. The import stays late and versioned
  and is no longer awaited.
- **And it arrived in three pieces.** Chrome at ~200ms, the egg at ~1350ms, the background at
  ~1598ms. A cover in the markup — markup, not a class set by script, because the thing being
  guarded against is script not having run yet — now lifts once, when the background has decoded
  AND the rig has put ink on its canvas. `RIG.onInk()` exists because `window.RIG` is published
  one frame before the first `draw()`.
- **Start could be pressed before the rig existed.** `rollPattern()` and `rollHero()` have always
  checked; `RIG.go()` never did, so an early tap threw *after* `go('run')` had switched the
  screen, leaving the run screen up with a dead clock.
- **The selection band on the dial sat above the time it was selecting.** Andjroo: "on the green
  selector where it's over the two minutes, the starting position, it's like at the bottom rather
  than centered. It just needs to move down slightly and center on the time." The band's box and
  the row's box are exactly co-located, to 0.0px — it is the digits that sit low inside their own
  row, measured 6.68px low at 390px, so the band read high against every number in the column and
  the time hung off its bottom edge.
- Measured per render, not a constant and not from the font's metrics. The obvious derivation
  (half the font's ascent/descent against half the glyph's) predicts -0.28px where the pixels say
  +6.68px, because it models where `place-items:center` leaves the baseline and gets it wrong. And
  a constant taken from a headless box would be the wrong constant on a phone, where the stack
  resolves to SF Pro Rounded with a different ink box. A `Range` over the text is the browser
  reporting where it actually drew, and it tracked the rendered pixels to 0.32px. The colon gets
  its own read — smaller text in the same font, its own offset.
- Band centre vs digit ink: **+6.68px → -0.32px**, at 360, 390 and 430. `timershot flow` moves on
  the set screen only (1.08% against a 0.00% noise floor); the running and hatched screens sit
  inside their own hero-roll/confetti noise.

### Changed
- The heavy art is sequenced behind the arrival instead of racing it. The background is preloaded
  from the `<head>` off the saved choice; wave 3 (five crack patterns, 21 characters, 2.2MB) waits
  for the host's `RIG.loadRest()` and starts with only the characters the kid has **ticked** — a
  run rolls only between those. Nothing is fetched speculatively: the picker's tiles are `<img>`
  at the same versioned URLs, so opening that sheet fetches them anyway.
- Cold at 1.6 Mbps, 390px: whole at 1.38s → **1.30s**, 0.41MB → **0.29MB** to get there. Second
  open 0.33s → **0.03s**. A whole open that never opens the picker: 3.12MB / 71 requests →
  **1.53MB / 51**.
- `setHero()` refuses a character whose art has not landed, the way `setPattern()` always has, and
  `rollHero()` rolls from what exists. `?embed=1` opened as the *top* document loads its own art
  (`window.parent===window`) — half of `tools/` drives the rig that way, and waiting there for a
  host call that can never come left every landing sized off the fallback box.
- New harness: `tools/eggtimer-rawdom.py` (fails on the old timer, passes on this one — the flash,
  asserted), `tools/eggtimer-hatchproof.py` (Start on the arrival frame at 8000/1600/700/400 kbps
  still cracks, breaks and hatches a character), `tools/eggtimer-whole.py`. Authored in
  `~/data/anim-demo`; `breakproof` reports the locked pose unchanged, 0.00% of pixels on all
  five patterns.

## [0.57.0] - 2026-08-01
### Fixed
- **The demo landing page hardcoded "Testnet demo"** ([#31]). It was a literal string, so the
  page asserted a network it had no way of checking. Correct today only because the one
  instance setting `HATCH_DEMO_ENABLED` happens to be the testnet one, and a false claim the
  moment a demo family is seeded anywhere else - which is a bad failure for the single page
  whose whole job is telling a stranger that the money is not real. A SIM instance was
  already saying it while touching no chain at all.
- The label is now derived from the same `network` and `sim` values `/health` reports, so the
  page and the API cannot disagree. A simulated instance says "Simulated demo".
- A mainnet instance reads **"Mainnet · real money"** and deliberately never says "demo". If a
  seeded household ever runs against real funds, that line has to read as a warning rather
  than as reassurance, and a test asserts the word "demo" cannot appear there.
- `networkLabel()` takes its inputs instead of closing over the module constants. `NETWORK`
  and `SIM` resolve once at load in `src/nimiq/client.ts`, so a test that flips the env and
  re-imports the route gets the stale values back and passes for the wrong reason - which is
  exactly what the first version of this test did.

[#31]: https://github.com/Andjroo111/nimiq-kids/issues/31

## [0.56.0] - 2026-08-01
### Fixed
- **Parent home read as an unloaded screen before the first deposit check** ([#32]). TOTAL
  BALANCE rendered as a bare dash, which is what every parent on a fresh install met the first
  time they opened the app. The dash was truthful (an exempt family is shown the raw chain
  snapshot, and nothing had written one yet) but it looked like a screen that failed to load.
- Fixed at the root rather than in the copy: `primeHotWalletSnapshot()` reads the wallet once
  at boot and now runs on **every** instance. It was gated behind the demo-only block, so it
  never reached the households it matters most to. It stays safe everywhere for the three
  reasons it was already safe on demo instances - it returns immediately in SIM, it never
  overwrites an existing snapshot, and a failed read writes nothing and leaves the value null.
- The trap in the issue is respected and now pinned by tests: **nothing forces a
  deposit-check.** On an instance whose chain read answers 0 that writes a snapshot of ZERO,
  `payableLuna()` then returns 0, and every approval afterwards fails with `budget_exhausted`.
  "Not checked yet" (null, never blocks) and "checked, empty" (0, blocks everything) are
  different facts and `src/parent-home-empty.test.ts` asserts they stay that way.
- Where the wallet genuinely has not been read (SIM, or a node unreachable at boot) the dash
  now carries a line saying so, in the same ink and size as the "Tap to check" it pairs with.
- **The kid rows' staked line wrapped and collided at 390px.** `.row-label` and `.row-sub` are
  both `<span>`, and `.row-main` was a plain block, so they laid out INLINE: the staked figure
  ran along beside the kid's name instead of under it and wrapped mid-phrase into the balance
  column ("Sam Staked · 1 500 / NIM"). `.row-label`'s own ellipsis could not help, because
  overflow and text-overflow need a block box. `.row-main` is now an explicit column and
  `.row-sub` truncates rather than wraps, matching what `.row-amounts .fiat-amount` had always
  done on the other side of the row.

[#32]: https://github.com/Andjroo111/nimiq-kids/issues/32

## [0.55.1] - 2026-08-01
### Fixed
- **Tapping the burger or the drawer's X painted blue focus rings on iPhone.** The drawer's
  focus handoff called `focus()` unconditionally, and WebKit matches `:focus-visible` on any
  programmatic `focus()`, so the keyboard-only outline rendered for plain taps (Chromium's
  heuristic hides it, which is why the harness screenshots looked clean). Focus now moves only
  when the activation came from the keyboard: a `click` fired by Enter/Space reports
  `detail === 0`, a real pointer click reports 1+. Tap flows no longer move focus at all, so no
  engine has a ring to paint; keyboard flows keep the full handoff (burger -> X on open, X ->
  burger on close, Escape -> burger).

## [0.55.0] - 2026-08-01
### Fixed
- **A sub-1-NIM chore advertised itself as "+0 NIM"** ([#30]). `fmtNimWhole` rounded to whole
  coins unconditionally, so anything under half a NIM rendered as zero and a real 0.25 NIM job
  told a kid on their own board that the work was worth nothing.
- Whole coins were never the point in themselves. The rule exists so a dollar-priced reward
  reads "4 317 NIM" rather than "4 317.28 NIM", and every reward of half a coin or more still
  does. An amount that would round to zero now shows the fraction it really is, at the wallet's
  own 5 decimals: `0.25`, `0.1`, even `0.00001`. `fmtFiat`, ten lines below in the same file,
  had already refused exactly this lie in the other currency, for exactly this stated reason.
- This is also where Nimiq's sub-cent-fee story lives. A 0.25 NIM job is only worth paying out
  because the fee is smaller still, and the formatter was erasing the number that made the point.
- Three separate places had already worked around the formatter by editing the DATA
  (`demo-family.ts` twice, `onboard.ts`'s starter board), each with a comment explaining the
  detour. That is the tell that the formatter was the bug. The starter board keeps its round
  numbers because it reads better that way, but its comment no longer claims it has to.

[#30]: https://github.com/Andjroo111/nimiq-kids/issues/30

## [0.54.0] - 2026-08-01
### Changed
- **The marketing page's hamburger menu is now a right-side drawer.** The burger sits top-right,
  but the menu rose from the bottom as a sheet; the panel now slides in from the right edge
  (full height, square corners, `translateX` on the Nimiq ease over the navy scrim, the same
  mechanics as the wallet's own sidebar). The interior keeps the vocabulary captured off
  nimiq.com's mobile menu: one gradient CTA pill on top, then uppercase grey hairline rows with
  the real arrow-right glyph. The sheet's drag handle did not carry over; the registry
  close-button stands in for it, pinned exactly where the burger sits so the toggle point never
  moves under the thumb.
- **The menu's two demo entries are now one.** "Try the demo" (the CTA pill) and "Demo" (a list
  row) both pointed at the same URL; the row is gone and the pill is the single demo entry.
  Remaining rows: Roadmap, Live.

## [0.53.0] - 2026-08-01
### Fixed
- **A demo family could never afford anything in the Treasure Box** ([#29]). The seeder priced
  chores in flat NIM (1-2 NIM each) while the shelves are priced in real money (the cheapest
  item is 1,000 NIM, a sticker pack 2,000). A seeded kid earned about 5 NIM a day, so the
  cheapest thing in the shop was roughly two hundred days of chores away. Every visitor to the
  public demo met the Treasure Box as a wall of unaffordable items, the buy sheet only ever
  reached "Go earn some", and Grow sat at 0 — so the spend-it-back half of the circle, the half
  the README, the marketing page and the roadmap all describe, could not be reached by anyone.
- The seed is now authored in **dollars** and converted to whole NIM at mint, the same
  `rewardUsd` path `POST /chores` has always used, so the seeder is no longer a second pricing
  scheme. Chores, past jobs and routine tasks all moved together; a routine task used to pay a
  flat 1 NIM, which next to a dollar-priced chore read as free work.
- Dollars alone do not actually close this, and that is worth writing down: the shelves are
  **fixed in NIM**, not dollar-priced, so a dollar-priced seed drifts AWAY from them as NIM
  moves rather than tracking them. Two ways it bites: NIM appreciates far enough and the demo
  silently breaks again, and — more immediately — when CoinGecko is unreachable `nimUsd()` falls
  back to a static rate about four times the one the shelves were priced against, so every
  family minted during an outage would wake up too poor to shop. The seeded history is therefore
  floored against the live catalogue (`historyScale`): the poorest seeded kid always clears
  twice the cheapest shelf, at any rate, and the floor is inert whenever the dollars already
  clear it.
- **The demo grant has to move with the seed, and now says so out loud.** `payKidEarn` pays the
  seeded history without consulting the budget, but its rows still count as SPENT, so a grant
  below the history leaves every minted family at zero available and the judge's first approval
  dies with `budget_exhausted` — while the mint still reports a cheerful `paidHistory: 4`.
  Boot now logs whether the grant clears the history and warns with the shortfall when it does
  not. `deploy/testnet-demo/README-TESTNET.md` carries the arithmetic and the new faucet cadence
  (~5,000-6,500 NIM per visitor, against ~3 NIM before).

[#29]: https://github.com/Andjroo111/nimiq-kids/issues/29

## [0.52.1] - 2026-08-01
### Fixed
- **The Fly deploy target would have booted ungated.** `approvalPolicy` keys `forced` off
  `NIMIQ_NETWORK`, which defaults to `"test"` when unset, and `fly.toml` never set it. A Fly
  boot therefore came up demo-unlocked with kid money endpoints open to anonymous callers -
  the posture the v0.43.0 hardening exists to prevent. It was easy to miss because Fly does
  not serve `https://nimiq.kids`: the apex is a Cloudflare tunnel to the Mac Mini's mainnet
  instance, so the Fly app is the one nobody looks at. `fly.toml` now sets
  `HATCH_REQUIRE_PARENT_APPROVAL=1` and `HATCH_LEGACY_BOOT=0` so an unwatched target fails
  closed, and says in its header that pointing DNS at it serves an EMPTY database rather than
  moving the app.
- `src/fly-target-policy.test.ts` pins the deploy config to the custody policy (asserting
  against the real `fly.toml`, not a copy of its values) so the two cannot drift apart
  silently. Both gate flags are asserted load-bearing.

## [0.52.0] - 2026-08-01
### Fixed
- **Removing a signing key could disarm the mainnet approval gate.** `approvalPolicy` derived
  `forced` from `mainnetReal`, and `mainnetReal` required `!simActive` — but `simActive` is true
  whenever `DEV_PARENT_PRIV` is **absent**. So on a mainnet instance with no key: `simActive` ->
  not `mainnetReal` -> not `forced`, every household fell back to its own `mode`, and a demo-mode
  row was unlocked. The live mainnet env sets no `HATCH_REQUIRE_PARENT_APPROVAL`, so nothing else
  was holding the door.
- This was not hypothetical. Moving to parent-held keys **deletes `DEV_PARENT_PRIV` and
  `HATCH_MASTER_SEED` by design**, so the very change meant to remove server custody would have
  switched the approval gate off on its way past.
- `forced` now keys off the NETWORK alone. A mainnet instance requires parent approval because it
  is a mainnet instance; whether a signing key happens to be present is a separate and weaker
  question. `mainnetReal` is still reported, and still means "real money is reachable" — it just
  no longer decides policy.
- Consequence worth knowing: an instance configured for mainnet now reports the gate even under
  `NIMIQ_SIM=1`. Demo mode belongs to the testnet instances, which is where every live demo
  actually runs. Two tests that asserted the old behaviour are updated; they had written the bug
  down as expected behaviour.

## [0.51.1] - 2026-08-01
### Changed
- **`docs/NEXT-SESSION.md` says that autodeploy is currently broken and production is
  stale.** The doc's Deploying section described a healthy loop, and the loop *is* healthy:
  it wakes every two minutes, snapshots each database, fails `merge --ff-only` on unrelated
  histories and correctly refuses to deploy. That is why nothing surfaced while `main` ran
  eight releases ahead of both public instances. Restarting the job does not help, so the
  note says so and points at the diagnosis in #35.
- The handoff now covers **`tools/shots.mjs`**: every README image is generated, so a changed
  screen means re-running the script rather than replacing one PNG. It records the two things
  that are easy to lose, why the script prices chores in dollars (#29) and why parent home is
  deliberately never captured (#32).
- The Open list carries the issues found while photographing the app for the README: #28
  through #35.

## [0.51.0] - 2026-08-01
### Changed
- **The judge-demo switch is `HATCH_DEMO_ENABLED`, because `HATCH_DEMO_SEED` reads like a
  secret and is not one.** The only value that ever meant anything is `1`. Any tooling that
  rotates secrets by matching on `SEED` would write 64 hex characters over it and switch the
  entire judge demo off — `/demo` answering 404 and `POST /api/demo/family` returning
  `demo_disabled`, with nothing in the boot log to explain it. That is not hypothetical: it
  happened to a test harness that treated the name as a secret and substituted a random value.
- **Both names are accepted, on purpose.** The env files on the live instances are edited
  separately from a deploy, so requiring them to change together would create a flag day where
  whichever landed second turned the demo off. `HATCH_DEMO_SEED=1` keeps working; drop it once
  every instance has moved over. A seed-shaped value in the legacy variable correctly reads as
  "off", which is the case the rename exists for and is now pinned by a test.
- `root-redirect.ts` calls `demoSeedEnabled()` instead of re-reading the env var itself, so the
  bare-domain `/demo` redirect and the demo routes can never disagree about whether the demo is on.

## [0.50.0] - 2026-08-01
### Fixed
- **A payout that never landed could never be established, so nobody was ever told.** v0.47.0
  made a payout's own transaction the only thing that can confirm it, and v0.48.0 built the
  retry on top. Both were correct. What was not correct was the RPC layer underneath them:
  `getTransactionByHash` threw on **any** JSON-RPC error body, and a node reporting "I have no
  transaction with that hash" reports it as an error, not as an empty result. So absence was
  read as *our own blindness*, which the settlement rule deliberately refuses to act on. The
  payout stayed `pending`, the kid's screen kept saying "on its way", the family budget kept
  counting the NIM as spent, and `unresolved` — the state whose entire job is to tell the
  parent — was **unreachable**. Indefinitely, and silently.

  `isNotFoundRpcError()` is the missing discriminator, and it is narrow on purpose: absence has
  to mean **the transaction** is absent. Both shapes seen in the wild are recognised (the
  reason in `message`, and the reason in `data` behind a generic code), but a bare "not found"
  is not enough — nodes and the proxies in front of them say that about blocks, peers, history
  stores, API keys and HTTP routes, and reading `upstream route not found` as proof about a
  kid's money lets a broken deployment speak for the chain. `Method not found` is rejected
  explicitly, despite containing the words. Everything the discriminator declines lands as
  blindness, which keeps the row pending and decides nothing. That is the safe direction.
- **A payout that had not landed broke the kid's home screen.** Reconciliation ran inline on
  `GET /api/kids/:id/wallet`, one serial by-hash lookup per pending payout — and an unlanded
  payout is precisely the one that costs a full read budget to ask about. Three of them held
  the request for **45,019 ms** (measured), which past any proxy is not a slow screen but a
  broken app, and it broke hardest exactly when a child's money was already in trouble.
  **Settlement is now off every request path**: the background sweep owns it outright, and the
  same request returns in **11 ms**. A guard test asserts the route module references no
  settlement function, so this cannot quietly come back.
- **The parent was told the wrong one of the two silences.** "The network has not seen it" and
  "we cannot ask the network" ask different things of a parent. Against a node that answers
  absence correctly but slowly, the app aborted first and reported its own blindness. Now that
  no request waits on a receipt read, `HATCH_RPC_TIMEOUT_MS` defaults to **60 s** instead of
  15 s — long enough to collect the real answer, measured at ~42 s on the light-client sidecar
  this app's mainnet instance reads through. That knob governs the by-hash lookup and nothing
  else (broadcast goes through the shared RPC sender, which owns its own timeouts), and the
  runbook now says so rather than calling it a generic budget.
- **Prolonged blindness is now said out loud, and still writes nothing off.** `earnSettleDecision`
  ages sustained blindness into `unresolved` after `HATCH_EARN_BLIND_TIMEOUT_MS` (30 min
  default, six times the confirm window, because "no answer" is not information and short
  outages are ordinary). The v0.47 guarantee is untouched: `unresolved` keeps the row
  **pending**, keeps the budget spent, and credits nothing. `failed` is still reachable *only*
  from the node stating the transaction was included and execution failed.
- **Sweeps no longer stack.** With a read budget of a minute and a tick of a minute, a busy
  household could start a sweep before the previous one finished, forever, each holding its own
  sockets. A slow sweep now simply skips the next tick.
- **An empty or malformed timeout env var no longer zeroes a money-path budget.**
  `Number(x ?? d)` only falls back on unset, and `Number("") === 0` — which aborts every call
  at 0 ms. `envMs()` ignores anything that is not a positive finite number and takes the
  default instead. Applied to `HATCH_RPC_TIMEOUT_MS`, `HATCH_EARN_SWEEP_MS`,
  `HATCH_EARN_CONFIRM_TIMEOUT_MS`, `HATCH_EARN_BLIND_TIMEOUT_MS`, and to five pre-existing
  siblings that had the same hole: `HATCH_STAKE_CONFIRM_TIMEOUT_MS`,
  `HATCH_UNSTAKE_RETRY_AFTER_MS`, `HATCH_TOPUP_CONFIRM_MS`, `HATCH_TOPUP_POLL_MS` and
  `HATCH_FUNDING_CONFIRM_MS`.

### Changed
- **Settlement of a broadcast payout moved out of `wallet/kid-wallet.ts` into
  `wallet/earn-settlement.ts`** — the receipt read, the decision rule, the sweep and the parent
  alert. A pure move, re-exported from the old module so no caller changes. `kid-wallet.ts`
  goes from 797 to 587 lines, clear of the 800-line CI guard.

### Removed
- **The `/health` capability probe (`chain.receipts`, `canConfirmPayouts`, `rpc-capability.ts`).**
  It graded the node at boot from one synthetic lookup and printed a remedy. Every part of that
  could be wrong in a way an operator would act on: a pruned or wrong-network node answers "no
  such transaction" to every hash in milliseconds and scored **perfect**; one transient
  JSON-RPC error condemned a healthy node for the whole 10-minute cache lifetime and suppressed
  all payout confirmation with no network call at all; and the remedy it printed — raise the
  read budget — made a misconfigured instance worse. A verdict that can be wrong, stated as
  advice, is worse than no verdict.
- **`NIMIQ_RPC_READ_URL` and the read/broadcast split**, which an earlier revision of this
  release added and which is **not** shipping. Two reasons, either sufficient. It disclosed
  the read endpoint from the **unauthenticated** `/health`, and an RPC URL routinely carries
  basic-auth credentials, an API key in its path, or an internal hostname. And it handed the
  system's only write-off authority to a node other than the one trusted to broadcast:
  `executionResult: false` from that endpoint alone is enough to write off a payout, so the
  read that can void a payment must come from the same node the payment went out through.
  By-hash reads go to `NIMIQ_RPC_URL`, exactly as on main.
- **The `/health` `chain` block and `nimiq/receipt-reads.ts`** (per-outcome read counters and
  `lastAbsentMs`). With the read URL gone the disclosure goes with it, but the whole block was
  unrequested surface on an unauthenticated endpoint that main does not have. `/health` is now
  **byte-identical to main** — verified by booting both and comparing the response, which
  differs only in the version string.
- The runbook section that told an operator to point reads at a different node.

**Two known characteristics this release does NOT change**, both pre-existing on main and both
deliberately left for the owner rather than changed at the same time as a security fix:
- **Confirmation depth.** A payout is credited as soon as the node reports it in a block, at
  whatever depth that is. Raising the bar is a policy call about how long a kid waits, not a
  bug fix.
- **Sweep throughput.** The sweep is serial, one by-hash lookup at a time, with no parallelism
  and no backoff. With a 60 s budget per read, a household holding many unlanded payouts can
  outrun a 60 s tick; the re-entrancy guard makes that safe (the next tick is skipped, nothing
  stacks) but not fast. Adding concurrency is a separate change with its own failure modes.

Verified against a stand-in node reproducing the measured mainnet behaviour (absence answered
correctly in 41.7 s): the wallet endpoint went 45,019 ms → 11 ms with three unlanded payouts,
and the parent's alert changed from "cannot be checked right now" to "has not shown up on chain
yet". No transaction was broadcast and no wallet was funded.

## [0.49.0] - 2026-08-01
### Changed
- **New kid accounts derive on a per-family branch instead of one instance-wide lane.**
  `assignAccountIndex` picked the next HD index from `MAX(account_index)` over the whole
  `children` table with no family predicate, so a household's account indices were a
  function of every other household on the instance and every kid sat on the same flat,
  enumerable lane `m/44'/242'/7'/i'`. A family now gets its own branch (`families.hd_index`,
  assigned once, globally unique, never reused) and a new kid gets an index inside THAT
  branch (`m/44'/242'/7'/family'/kid'`), so index 0 of one household and index 0 of another
  are unrelated keys.

  Scope of that claim, stated exactly: the separation is one of PATHS INSIDE ONE INSTANCE's
  tree, not one of secrets. `HATCH_MASTER_SEED` is a single instance-wide seed, so two
  deployments configured with the same seed derive the same keys at the same coordinates —
  branch 0 / kid 0 on one is branch 0 / kid 0 on the other. Scoping bounds a household
  against the other households sharing its instance; separating deployments from each other
  still requires separate seeds. `docs/WALLET-CONTRACT.md` carries the same wording.
- **Nothing that already exists moves.** Accounts provisioned before this keep the flat
  legacy path and are marked by `children.hd_family_index IS NULL`; the code reads the shape
  off the row and never retrofits a family branch onto an existing account. Re-deriving one
  would change its address and strand its funds, so `src/wallet/legacy-account-invariance.test.ts`
  performs the upgrade against a pre-change database and asserts every pre-existing kid still
  derives, byte for byte, the address it had before — including against a real database
  snapshot when `LEGACY_DB_SNAPSHOT` points at a copy of one.
- Concurrency is enforced by the database, not by hope: `idx_children_family_account_index`
  (unique per `family_id`) makes two children provisioned at the same moment in one household
  collide loudly and retry rather than quietly share an address, and a partial unique index
  preserves the old global-uniqueness rule for legacy rows, whose paths carry no family
  component. High-water marks are now kept per family, so a purged household or a deleted
  child never returns a funded address to the next kid. (Different problem from the v0.45.0
  spend lock: that serializes money leaving a balance, this serializes handing out a
  coordinate.)
- **Purging a household now also forgets its HD bookkeeping.** `purgeFamily` empties 25
  tables and used to leave the household's per-family kid high-water key behind in
  `wallet_state` forever, so a table that held two keys grew one row per household ever
  provisioned — each carrying the id of a household the demo sweeper had been asked to
  erase. The key goes with the family. Branch indices are still never reused: that is the
  instance-wide family high-water mark, which is deliberately kept.

### Added
- **The signing path refuses to sign for an address it does not derive.** `kidKey()` now
  re-derives from the row's stored coordinates and compares the result to the address
  cached on that row; a mismatch throws instead of signing. Every send, Cashlink mint,
  stake and unstake goes through it, so a key/address divergence — a restored database
  from another instance, a rotated seed, a derivation change — surfaces as a loud refusal
  on one kid rather than a transaction silently signed from the wrong account.

### Migration
- **This migration is one-way, and rolling the deploy back is a money event.** A kid
  provisioned by this build has `children.hd_family_index` set and is funded at its scoped
  address. Older builds ignore that column and re-derive on the flat legacy path, so they
  would sign with a key belonging to a different, empty account while still displaying the
  funded balance — sends fail or spend from the wrong account. Kids provisioned BEFORE this
  build are unaffected in both directions. Before rolling back, confirm no kid has been
  provisioned since the upgrade:
  `SELECT COUNT(*) FROM children WHERE hd_family_index IS NOT NULL;` — a non-zero count
  means roll forward, do not roll back. `docs/WALLET-CONTRACT.md` carries the same procedure.

### Documentation
- **The docs called the kid side non-custodial. It is not, and now they say so.** A kid's
  account is derived from a server-held master seed, so this server can sign for it: kid
  accounts are server-custodied, not self-custodied and not sub-wallets of the parent's
  wallet. Corrected in `README.md`, `CLAUDE.md`, `schema.sql`, `docs/WALLET-CONTRACT.md`,
  `docs/SPEC.md`, `docs/PRD.md`, `docs/STARTUP.md` and `docs/adr/0002`. The parent's own
  wallet is unaffected — it signs for itself.
- `docs/WALLET-CONTRACT.md` now states both derivation shapes and that `HATCH_MASTER_SEED`
  is one seed per instance rather than one per household.

## [0.48.0] - 2026-08-01
### Fixed
- **A failed chore or routine payout returns the approval to a retriable state — and the
  retry can no longer pay twice.** The send path already worked this way: decide, apply, and
  on failure put the approval back in the queue. The earn path did not. It settled the
  subject first and paid after, so an RPC that threw left the approval reading `approved`,
  the chore reading `approved`, and no NIM anywhere — invisible to every screen, 409 on
  every retry, and the parent's only recovery was to pay the kid by hand. Payment now
  happens before the subject settles, and a failure puts the approval back in front of the
  parent with the chore exactly as the kid left it.
- **A payout is exactly-once, not merely idempotent-on-success.** Making a failed payout
  retriable is only safe if the retry cannot become a second payment, and the dangerous case
  is not "it already succeeded" — it is "we do not know". A node can accept a transaction and
  lose the response on the way back (RPC timeout, socket hang-up, tunnel blip). The ledger row
  is written after the broadcast returns, so it is absent in exactly that case; reading that
  absence as "nothing was sent" made the retry build a *new* transaction, and because
  `validityStartHeight` had advanced it was byte-different, hashed differently and deduped
  against nothing. Two payments for one chore, one ledger row — invisible to the parent, to
  the kid's history, and to the per-family budget that caps the shared hot wallet.
  A payout now stakes a claim in the database *before* anything reaches a node, and that claim
  carries the exact signed bytes. Failures are no longer one undifferentiated event:
  a failure while building is provably pre-broadcast, so the claim is released and the retry
  starts clean; a failure while broadcasting replays *those same bytes*, and one transaction
  cannot be applied twice; and a wallet that will not surrender its bytes fails closed —
  the approval is left decided rather than offered as something to tap again. Verified end to
  end against a node that accepts a transaction and then drops the response: one build, one
  transaction on chain, where it used to be two of each.
- **The payout key is the work, not the approval row.** A chore collects several approval
  rows over its life — a failed payout reopens one, the direct chore-approve route opens its
  own whenever none is pending, and a reject sends the kid back to redo the work, which mints
  a fresh one on re-submit. Keyed on the approval id each of those was a separate key, so the
  same chore could be paid once per row through ordinary taps, with no RPC failure involved.
  Keyed on the subject there is one key for the work and the second payment cannot be built.
- **A chore whose payout already moved can no longer be rejected.** `pending` stopped
  implying `unpaid` the moment a landed-but-unfinished payout could return to the queue, and
  Reject is the natural reaction to a chore reappearing. It stripped the chore while the kid
  kept the NIM, and for a routine it also returned the run to `in_progress`, where
  re-submitting paid the same work again. Both reject routes now refuse with `already_paid`.
- **A retry whose payout already landed is not charged to the family budget twice.** The
  budget derives spend from the ledger, so once the payout's own `earn` row existed it counted
  against the family's cap and the retry was refused for the money it had itself spent —
  leaving the approval stuck in the queue forever, since approve answered 400 every time and
  reject would have lost the money. A payout that already moved now skips the funding gate; it
  is not spending anything new.
- A payout the chain PROVES did not execute releases its key, so the work stays payable —
  by re-approving it or through `repayFailedEarn` — while every *unproven* payout keeps its
  key and stays protected.
- `NimiqPayProvider` and `DevProvider` both expose sign-without-broadcast, so the replayable
  path is the one real deployments take; the fail-closed branch is a fallback, not the norm.

### Notes
- The allowance mint and the legacy gift route have the same lost-response window and are
  NOT fixed here — both broadcast before persisting, and the gift route's rollback refunds
  the kid while the Cashlink is live on chain. Their call sites now say so plainly instead of
  claiming a safety they do not have; fixing them means giving them this same write-ahead
  claim, tracked separately rather than smuggled into a money-path change.
- The family spend lock still spans the payout's RPC round trip, so a degraded node
  serializes a household's payouts at roughly the RPC timeout each. Bounded, pre-existing,
  and now documented where the lock is defined.

## [0.47.0] - 2026-08-01
### Fixed
- **A chore payout is credited only when the chain says THAT transaction executed.**
  `payKidEarn` wrote its `earn` ledger row straight after the transaction was broadcast.
  A node answering with a transaction hash means "accepted into the mempool", not
  "executed" — the same gap already closed for staking, unstaking, top-up crediting and
  Cashlink minting. A rejected transaction was always safe (the sender throws and no row
  is written), but an accepted-then-failed-at-execution one credited a kid for NIM that
  never arrived and spent the family's payout budget on it. The row is now written PENDING
  carrying its own transaction hash, and only the node reporting THAT transaction included
  in a block promotes it (`earnSettleDecision` / `settlePendingEarns`). SIM is untouched —
  there is no chain to fail, so rows stay `done` and the demo flow is byte-identical.
- **Proof is the payout's transaction, never a balance.** A balance rises whoever sent the
  money, so a balance test cannot answer "did MY payout land?". Every payout broadcast
  before the previous one was mined shared one baseline, and a single arrival promoted all
  of them — a parent clearing a morning's chore queue is the normal case, so a kid could
  be shown three payouts for one that landed. Any unrelated inbound NIM (a grandparent's
  Cashlink, a sibling transfer, a parent deposit) confirmed a payout that had died in the
  mempool, with no concurrency needed at all. This is the same correction 0.46.0 made for
  deposit detection, applied to the payout direction.
- **Nothing is written off on a timer.** `failed` is now reachable only from the node
  stating the transaction was included and execution failed. The old rule wrote a payout
  off after a timeout, which was wrong in both directions: a payout whose kid spent the
  NIM before anyone read the wallet was written off although it had really executed —
  erasing a payment the kid genuinely received from their history AND refunding the
  family's payout budget for NIM that really left the shared hot wallet, a repeatable
  grind on a public multi-family instance. An unproven payout now stays pending and stays
  counted as spent; the parent is told once instead.
- **A single RPC hiccup at approval time no longer costs a payout.** The pre-broadcast
  balance read existed only to seed the old baseline, and a read that failed left the row
  unprovable — deterministically written off regardless of what the chain did. There is no
  pre-broadcast chain read at all now, so the failure mode is gone by construction.
- **Reconciliation no longer depends on a kid opening the app.** `settlePendingEarns` ran
  from exactly one place, `GET /api/kids/:id/wallet`. A tablet left off kept a payout in
  flight indefinitely with nobody told, and no parent surface reconciled it. A sweeper
  (`HATCH_EARN_SWEEP_MS`, default 60s, off in SIM) now reconciles every household's
  in-flight payouts on its own tick.
- `wallet_state` keys are deleted once they have served their purpose rather than blanked,
  so settled payouts leave no dead rows on the table the HD high-water mark lives in.
### Added
- **A refused payout can be paid again.** `POST /api/family/earns/:id/repay` (parent-only).
  A written-off payout used to be unrecoverable: the chore already read `approved`, the
  parent had already been told `paidLuna`, and re-approving answered `409`. Only a row the
  chain PROVED did not execute is repayable, and only once — a pending row may yet land,
  and paying it twice is the worse mistake. Serialized on the family spend lock with the
  same affordability gate as any other hot-wallet outflow.
- Parent notifications for both outcomes: a payout the network refused (with the nothing-
  left-the-wallet reassurance and the repay path), and a payout still unconfirmed after
  `HATCH_EARN_CONFIRM_TIMEOUT_MS` (default 5 minutes) — which is now purely a notification
  clock and never changes a row's status.
- `getTransactionByHash` on the chain seam, keeping "the node has no such transaction"
  apart from "the node cannot answer". The distinction is load-bearing: by-hash lookups are
  not universally available (a light-client sidecar and a non-history node both refuse
  them), and a refusal must never be read as evidence about the payout. On such a node a
  payout simply stays pending and counted — off-SIM the kid's balance is read from the
  chain, so the NIM they actually hold is never affected.
- `pendingEarnLuna` on `GET /api/kids/:id/wallet`: payouts broadcast but not yet proven,
  alongside the existing `pendingStakeLuna` / `pendingUnstakeLuna`. The rows themselves
  already carry `status: "pending"` and render with the existing on-its-way treatment, so
  a chore visibly pays the moment a parent approves it — what it does not do until proven
  is count as ledger balance.

## [0.46.0] - 2026-08-01
### Fixed
- **A top-up is credited to the household whose account actually paid it.** The broadcast
  path used to credit on the shared hot wallet's balance rising by at least the value of
  the transaction it had just relayed. That is not attribution: the hot wallet is one
  account serving every household, so a rise satisfies the test no matter whose money
  caused it. A household could sign a top-up from an account holding nothing, post it
  while another household's deposit was in flight, and be credited with the difference —
  spendable payout budget, plus a family-level `deposit` feed event carrying somebody
  else's amount and timing and a receipt link to a transaction that never executed.
  `POST /family/topup-broadcast` now confirms the SENDER's balance falling by value+fee
  as well as the arrival: only that transaction can spend the caller's own account, and
  an account that cannot cover the transfer is refused up front instead of waiting out
  the confirmation window. Re-posting an unconfirmed top-up is still the retry, and the
  tx-hash dedupe still makes it free.
- **`POST /family/deposit-check` no longer answers with the shared wallet's balance.** It
  returned the instance-global snapshot verbatim to every parent-authed caller, so a
  household could difference two polls and read another household's exact top-up, timed
  to its own polling interval — with `deltaLuna` correctly 0 the whole time. The response
  field is now `familyWalletLuna`: what THIS household can pay out, the same figure
  `GET /parent/overview` shows. The global snapshot is still refreshed on every check, as
  the affordability bound for payouts; it just stays server-side.
- **`GET /parent/overview` no longer degenerates to the instance float.** `hotWalletLuna`
  was `min(remaining budget, raw wallet balance)`, which is the raw balance whenever the
  shared wallet is the tighter bound — the designed steady state once several households
  hold grants plus credits. Every household then saw the same number and watched it move
  by exactly whatever any other household had just deposited. A budgeted family is now
  shown its own remaining budget and nothing else; a budget-exempt family (the
  single-household install) still sees the wallet, because that wallet is its own.
- **The per-family deposit cursor is a position, not a timestamp.** It stored a bare
  `created_at` and advanced to `MAX(created_at)` of the rows it had just returned, so a
  second deposit written inside the same millisecond could never satisfy the strict `>`:
  its budget credit landed but the family was never told, and no later poll recovered it.
  The cursor is now `created_at:rowid`. Values written by older builds parse forward with
  their original meaning, so an upgrade resurfaces nothing.
### Changed
- **Deposit detection is per-family.** One hot wallet serves every household on a public
  instance, so a raw balance delta carries no attribution — `POST /family/deposit-check`
  no longer books it to whichever family happened to poll first. A family-level `deposit`
  event (and its tx-hash-deduped budget credit) is now written only by the verified
  top-up broadcast path, where the bearer's family is known and its transaction is
  confirmed to have executed; `deltaLuna` reports the polling family's OWN not-yet-seen
  deposits and nothing else.
- **One place decides what a household may be told about money.** `repo-budget`'s new
  `visibleFundsLuna` is the single source for every client-facing figure (overview,
  deposit-check, and the `availableLuna` in a refused payout). The internal `payableLuna`
  minimum stays the gate and never leaves the server. A refusal now also carries a
  `reason` (`budget` | `funds`) so the cause is legible without the causing value.
- **Zero-schema migration with a first-poll guard.** Boot writes a one-shot
  `family_deposit_seen_floor` watermark (the newest pre-upgrade family-level deposit row)
  into `wallet_state`, so a family's first deposit-check after the upgrade reports 0
  instead of re-reporting history; per-family cursors then advance from there. Existing
  rows and tables are untouched — verified by booting against a copy of a live predeploy
  DB snapshot and by a migration test from the old single-row shape.
### Added
- `src/deposit-scope.test.ts`: two-household route + seam tests pinning the invariant
  (poll order buys nothing, replays credit nothing twice, a failed balance read loses
  nothing) plus the upgrade test above — and a non-SIM subprocess that drives
  `POST /family/topup-broadcast` itself against a node which accepts any well-formed
  transaction but only executes a funded one, covering the cross-household scenario, a
  repeat loop with distinct hashes, and the honest top-up it must not break.

## [0.45.0] - 2026-08-01
### Fixed
- **Two approvals can no longer spend the same balance.** Every execution path that moves
  money is now serialized per balance owner (`src/wallet/spend-lock.ts`): sends, Treasure
  Box buys, stakes and unstakes serialize per child (they spend the kid's own account),
  while chore/routine payouts, allowance mints, streak bonuses and the legacy gift route
  serialize per family (they spend the shared hot wallet). Before this, two concurrent
  approvals for the same child could each read the pre-spend balance across their await
  points and both proceed — the sequential re-check added in v0.27.1 never covered the
  concurrent interleaving. The loser of a serialized race now gets the same answer a
  sequential refusal gets: `400 insufficient_funds`, nothing spent, approval left pending.
- **In-flight value counts as spent before anything else is approved.** A new
  `availableKidLuna` feeds every affordability check on a kid's money (queue time,
  approve time, execution time): it subtracts stakes that were broadcast but not yet
  proven executed, and requests whose approval was decided but whose settlement never
  landed (the crash-window state) — previously both still looked spendable to the next
  approval. Executed transfers, buys and minted Cashlinks were already out of the balance
  the moment they existed (the ledger row is written at execution and a mint waits for
  its funding to land on chain), so they are deliberately not double-counted. An
  approved-but-unsettled unstake reserves nothing: it adds money later, never spends it.
- Approve/decide now re-reads the approval row inside the critical section, chore
  approval re-reads the chore, and allowance payout re-reads the star balance — so a
  decision that lost a race answers `409` instead of acting on a stale row.
## [0.44.0] - 2026-08-01
### Added
- **Staking now goes through the parent approval queue.** In family mode (and on any
  instance that enforces approval) a kid's stake or unstake no longer executes instantly:
  it opens an approval (`subjectKind: "stake" | "unstake"`), the parent app renders it as
  a card with the amount, and the kid app shows the same "a grown-up needs to say OK"
  screen a queued send shows. Approve executes through the existing hardened stake/unstake
  services; reject leaves every luna where it was. Demo-mode households on sim/testnet
  instances keep the instant flow, with the existing honest warning.
- **In-family transfers queue too.** `{ toParent }` and `{ toChildId }` are still the kid's
  own NIM leaving their own account, and `toParent` pays `families.parent_address`, which is
  the INSTANCE HOT WALLET for any household that onboarded without connecting a wallet. Both
  now open the same `send` approval the outbound path uses; approving lands exactly where the
  instant transfer did, sibling `deposit` row and all, and rejecting moves nothing. Demo-mode
  households on sim/testnet keep the instant transfer.
- `POST /kids/:id/send|stake|unstake` answer `202 { status: "pending_approval", approvalId,
  requestId, sendRequestId }` where approval is required — the two id fields carry the same
  value so one key reads across the whole queue contract (docs/WALLET-CONTRACT.md).
### Changed
- **Kid money endpoints require auth on public instances.** `GET/POST /kids/:id/wallet`,
  `staking`, `send`, `stake`, `unstake`, `buy` and `POST /children/:id/send` now resolve
  through a money gate: where the instance demands auth, a request without a valid parent
  or paired-device bearer answers `401 kid_auth_required` before any lookup, and a bearer
  from another household answers 404. Legacy single-household tablets are unaffected.
- **A subject id stops being a capability on instances that demand auth.** The read-only
  sibling routes were one door short of the money gate: `GET /children/:id` hands back a
  kid's real NQ address, and an address is a public chain handle, so the id alone leaked
  that child's mainnet balance and full transaction history. Subject-id routes now accept a
  paired-device bearer (which every kid-app call already sends) and refuse the anonymous
  fall-through where auth is required. `GET /cashlinks/:id/link` and `claim-sim` are scoped
  the same way — that URL fragment is the claim secret. Relaxed boots are unchanged.
- **`HATCH_REQUIRE_PARENT_APPROVAL=1` is enforced, not cosmetic** — it forces the
  approval queue and kid-endpoint auth on for every family on the instance, and it now
  reaches the chore payout too: `POST /chores/:id/approve` keys its parent check on the
  custody policy rather than on `families.mode`, so a demo-mode row can no longer walk an
  anonymous caller through a hot-wallet mint. `POST /children/:id/send` (the V1 peer
  cashlink, hot-wallet funded despite spending the demo tally) is closed where approval is
  required and bounded by the payout budget everywhere else.
- **Mainnet is never demo-unlocked.** With `NIMIQ_NETWORK=main` off-SIM, parent approval
  and kid-endpoint auth are forced on regardless of env or family mode, and switching a
  household to demo mode is refused outright (`demo_mode_unavailable`). `/health` and the
  wallet/staking payloads report the enforced state honestly (`custody` is per-family now,
  plus `kidAuthRequired`, plus `demoModeFamilies` on `/health` so an instance-level floor
  cannot read as "demo unlocked" where no household actually is).
### Fixed
- **A paired kid tablet could mint the grown-up credential.** `PATCH /family/settings` let
  any caller set a family's FIRST PIN without parent auth (first-run bootstrap), and
  `POST /onboard` never sets one, so every self-serve household sat in that state forever.
  A PIN is full parent authority, including on `/approvals/:id/approve`, so the tablet could
  set one and then approve its own sends, stakes and chore payouts. The bootstrap exception
  is now closed to device bearers and to any instance that demands auth; the parent app's
  own bearer is unaffected, and the legacy in-house tablet keeps first-run setup.
- **The parent app read kid balances without its bearer.** `refresh()` and `loadKid()` fetched
  `/kids/:id/wallet` and `/staking` bare, which the money gate answers 401 — the app would have
  fallen back to `children.balance_luna`, the legacy demo column, and shown wrong balances on
  both public instances. Both go through the bearer-attaching `call()` helper, with a test that
  fails if a bare fetch of a money endpoint ever comes back.
- An approval that can no longer succeed (the kid spent or unstaked the money after asking)
  now says so instead of "that didn't go through", which read like a network blip and invited
  a parent to keep tapping Approve on a card whose only exit is Send back.
### Ops note
- Rollback hazard: do not revert past this release while a stake/unstake or family-transfer
  approval is pending — reject pending approvals first.

## [0.43.0] - 2026-08-01
### Added
- **The README shows the app.** It had no images at all: 155 lines of prose about a product
  that ships 273 image assets and a full brand kit, so anyone who found the public repo read
  about nimiq.kids and never saw it. It now opens on the real brand lockup, as a `<picture>`
  that swaps dark and light with the reader's GitHub theme. Both lockups are self-contained
  paths with no font dependency, so they render there; the mono one cannot be used, because
  it needs inlining for `currentColor` and GitHub strips that. Then a three-up of the board,
  the Treasure Box and the wallet, the circle as four real screenshots instead of a table of
  file paths, and both apps side by side.
- **`tools/shots.mjs`, so the screenshots cannot rot.** It stages a household through the
  real API and photographs the running app, so refreshing every image is `bun run shots`.
  Every image the README references is generated by it and every image it generates is
  referenced, which is the part that actually failed before: the four it replaces were
  captured 2026-06-10, were linked by nothing, and survived twenty releases still showing
  a product name that no longer exists.
- CI, licence and language badges, and links to the live demo and the mainnet instance. The
  README previously contained no link to the running app at all.

### Changed
- **The product is a family ecosystem, not a family allowance.** The README opened on "A
  family allowance that runs on real money", contradicting the shipped marketing page, the
  repository description and the locked wording. `package.json`'s description carried the
  same line and now matches the site verbatim.
- "What is actually built today" was pinned to v0.34.0, twenty releases back, and predated
  the Treasure Box parent manager, the demo page, the portal and the tablet PIN.
- The test count was quoted as 339 across 37 files. It is 360 across 38, from a real run.
- The North Star banner moves from directly under the title to the foot of the page. It was
  the first thing a reader met, ahead of any statement of what the product is.
- The GitHub repository description, homepage and topics are set. The About sidebar was
  empty, so the repo had no link to nimiq.kids and no discovery keywords.

### Removed
- The four stale screenshots in `docs/screenshots/`, which showed the dead "ChoreCoin" name,
  emoji avatars and emoji chore icons, a text-truncation bug, and em dashes in the UI copy.

### Known issue this surfaced
- **A demo family can never afford anything in the Treasure Box.** `demo-family.ts` seeds
  chore rewards at a flat 1 NIM (`rewardLuna: NIM`) while the shelves are priced in real
  dollars, so the cheapest item, fifteen minutes of screen time, costs 1,000 NIM: a thousand
  chores. The spend-it-back half of the circle, which is the whole thesis, is unreachable for
  every visitor to the public demo. `tools/shots.mjs` works around it by pricing its chores
  with `rewardUsd`, the dollar path `POST /chores` already implements, and refuses to run if
  staging leaves the kid too poor to shop. The seeder itself is unchanged here.

## [0.42.9] - 2026-08-01
### Changed
- `docs/NEXT-SESSION.md`: the demo has no PIN at all now, and the module-cache trap that
  made a deploy look like a no-op is written down with the diagnostic that catches it.

## [0.42.8] - 2026-08-01
### Fixed
- **The boot stamp now reaches the module graph.** 0.42.7 made unstamped `.js` revalidate,
  which closes the hole for the future but cannot evict an edge object that is already
  sitting on a bare URL with hours left on it. Every relative and root-relative `import`
  specifier in a served `.js` is now stamped at serve time, so a deploy mints new module
  URLs and a stale object simply stops being requested. Stamped modules are then honestly
  immutable, which is better than what these files had before the bug existed.

## [0.42.7] - 2026-08-01
### Fixed
- **A deploy that changed any kid-app module but the entry point was invisible.** The
  serve-time stamp reaches every `src=` and `href=` in the HTML, but it cannot reach an ES
  `import`, so `/kid/js/main.js?v=<stamp>` was fresh while its own
  `import ... from "./waiting.js"` resolved to a bare URL with no `Cache-Control` at all,
  which Cloudflare caches by extension. Caught on the live demo: the server had the new
  `waiting.js` and the page kept booting the old one, with no service worker involved.
  Unstamped `.js`/`.css` now answers `no-cache`, which is revalidate-then-use, so the
  steady state is a 304 rather than a re-download. Stamped URLs stay immutable.

## [0.42.6] - 2026-08-01
### Changed
- **No PIN anywhere in the demo** (Andjroo: "it's a demo, I just don't want there to be PINs,
  this is too much"). A demo household has no second person to fetch: one visitor plays both
  kid and parent, so the tablet's approval pad was asking for a code nobody gave them, and it
  was the one place the demo could dead-end. `parentAuth` now authorizes a demo-stamped
  household directly, and the kid app's "Mom is here" approves instead of opening the pad.
  Both halves are required: the household must be demo-stamped AND the instance must set
  `HATCH_DEMO_SEED`, so the mainnet competition instance cannot take this path. Approvals
  record `method: "demo"`.
- The demo-PIN line added to the parent app's Settings in 0.42.2 is removed with it, along
  with `demoPin` on `GET /api/parent/overview`. There is no PIN gate left to explain.

## [0.42.5] - 2026-08-01
### Changed
- `docs/NEXT-SESSION.md`: the demo landing page and the kid picker now have sections of
  their own (what they look like, why, and what was deliberately cut), plus three traps
  that cost real time this session: `pkill -f "src/server.ts"` takes down all three live
  instances, branching off an already-merged branch stops CI from ever running, and the
  wallet's greys do not transfer onto a white surface.

## [0.42.4] - 2026-08-01
### Changed
- **"Who are you?" gives every kid a surface at rest** (Andjroo: "hard to see and only
  highlights once selected"). `account-list` paints nothing until hover, because upstream
  it lives in a mouse-driven Hub modal; a tablet has no hover, so two kids read as two
  words on a white card. The row now wears the component's own picked-out fill,
  `rgba(31,35,72,0.06)`, with `.nq-button-s`'s `0.12` on press. Radius, padding and
  margins stay the component's. The same screen backs the in-app Switch kid row, so both
  entry points are covered.
- The caret is inset to the component's own `2rem` instead of sitting flush on the row edge.

## [0.42.3] - 2026-08-01
### Changed
- The demo landing page's reset control reads "Refresh demo family" (Andjroo's wording).

## [0.42.2] - 2026-08-01
### Changed
- **The demo landing page, second pass on Andjroo's read of it.** The word "Try" is gone: the
  lockup is the title, alone and centred. "Testnet demo" moves out of the card's corner to
  above the card, in the white-60% Nimiq uses for secondary text on dark. It was the only
  element on the page off the centre line, and it took the eye first. It does not come back
  as a pill, because in this system the one sanctioned pill is the status alert, and a pill
  here would read as a warning about the page.
- The line about testnet NIM and the test chain is deleted. The network label already says it.
- **Reset carries words again.** A bare circular arrow next to two labelled buttons reads as
  decoration, and "refresh" is the wrong guess at what it does. It is now "Start a new demo
  family", it appears only once there is a family to replace, and it sits outside the card
  because it undoes the card.
- Every margin and pad on the page is on the Nimiq spacing scale.

### Added
- **The demo PIN now lives in the parent app** (Settings -> Tablet PIN), which is where a
  parent would look for it, instead of on the landing page. `GET /api/parent/overview`
  returns `demoPin` for a demo household and `null` for a real one, `sanitizeFamily` gained
  `isDemo`, and the string ships in all five locales.

## [0.42.1] - 2026-08-01
### Changed
- The judge demo landing page (`GET /demo`) now reads as nimiq.kids rather than as a generic
  demo notice. The retyped `nimiq.kids` is replaced by the real brand lockup, set beside the
  word "Try" with its cap height and baseline matched to the live type from the file's own
  geometry rather than nudged by eye. The gold badge that collided with the loose hexagon is
  gone: the network is a small grey label in the card's top right corner, and the hexagon now
  appears only inside the lockup, which is the one place it belongs.
- The copy is four lines shorter and drops the block-explorer and per-visitor-isolation
  explanations, the em dashes and the kids' names.
- "Start over with a brand new family" was a text link; it is now a circular reset button
  carrying Nimiq's own `redo` glyph, with the label kept for screen readers.

## [0.42.0] - 2026-08-01
### Added
- **A parent surface for the Treasure Box** (Settings -> Manage the box). The kid side
  has always read its shelves from data; there was no way for a parent to WRITE that
  data. Five parent-authed routes (`GET /parent/store`, create/patch a category,
  create/patch an item) plus `public/parent/views-store.js`. A parent creates shelves,
  reorders them, adds coupons and screen time, renames, re-prices and hides. Nothing is
  ever deleted: hiding is `active=0`, hidden rows stay visible to the parent and greyed,
  because `kid_purchases.item_id` is a real FK. Sticker packs and timer rigs are shown
  but locked, since their art and unlock ids can only come from the catalogue.
- **One glyph palette, shared by both apps** (`public/js/lib/box-glyphs.js`). The parent
  picks a face; the kid app draws it. Two copies would have drifted, which is how this
  app got five drawing styles in the first place.
- Three app-own glyphs in the wallet stroke language — dinner, moon, ticket — because
  the Nimiq duotone set has no meal, no bedtime and no prize ticket, and its one food
  icon is a Bitcoin-pizza reference drawn at a 0.6 stroke.
- `src/store-parent.test.ts`, and a retirement test in `stickers.test.ts` proving the
  Timers rows survive and a purchase against them still resolves.

### Changed
- **The Treasure Box header chest comes from the dock's own sheet.** It was
  `chestIcon()`, a hand-authored thin outline that belonged to no set — a fifth
  drawing style for a glyph the dock's generated sheet already had, in the app's own
  hand. Now `maskIcon("box")`. `chestIcon()` is deleted; its comment claimed it
  survived for "an animated lid", but `.bx-lid` had no CSS rule anywhere.
- **Shelf headers are solid `#fff` and hug their word.** They reused `.ch-sec-hd`, the
  CHART's floating label, and it was wrong twice over. It stretched — `align-self:
  flex-start` does nothing to a block `<h2>` inside a plain `<section>`, so every
  header ran 362 of 390px. And it was `rgba(255,255,255,0.82)`, which is the treatment
  for a label alone ON the scene; a shelf header sits directly on solid white tiles,
  the case `.ch-group-hd` already settles. New `.bx-shelf-hd`, no `.bg-dark` flip.
- **The Treasure Box title and chest moved onto one white capsule.** They were bare on
  the scene, which on Space is navy ink on a navy sky: measured `rgb(31,35,72)` with no
  background at all, both effectively invisible. Same answer `.k-page-title` gives Grow,
  the amount pad and the scanner. The header wraps now, because "Cofre del tesoro" /
  "Coffre au trésor" / "Baú do tesouro" beside a balance pill do not fit 390 on one row.
- **Screen time tiles draw their minutes.** All three drew one gamepad-with-Zzz, so 15,
  30 and 60 were the same picture three times. `minuteDialIcon()` fills a dial to
  `minutes/60`, derived from the datum, so a shelf that later sells 45 or 90 gets correct
  art with nothing new drawn.
- **An item's face is DATA.** `payload.icon`, else the icon its category carries, else a
  per-kind default — so a parent-created shelf and its items get a picture with no UI
  code change. `store_categories.icon` is a new column; the two coupons, which both drew
  one high-five, now name `dinner` and `moon`.
- **Timers are retired from the Treasure Box.** `cat-timers`, `item-timer-maker` and
  `item-timer-pola` go `active=0`. RETIRED, never deleted: `kid_purchases.item_id` is a
  real FK, and a kid who already bought the Sticker Maker keeps it — the rig is equipped
  out of `kid_unlocks` via `ownedTimerStyles()`, which never reads `store_items`.
- **`store_items` / `store_categories` gained `parent_edited`.** Once a parent edits a
  seeded row it is theirs and `syncStickerCatalog()` stops re-applying the catalogue's
  price, payload and title over the top at the next boot.

- **Re-priced, and the dollar is now on the tile** (Andjroo's call off a rendered
  comparison at $0.00046914/NIM). Screen time 800/1400/2500 -> **1000/2000/4000**, coupons
  4000 -> **6000**: the ladder doubles, so an hour is exactly four fifteens. The fiat sits
  under the NIM pill and on the buy sheet, read through the same `fmtFiat()` the money
  screen uses, so it follows the kid's own currency picker and never goes stale. Sticker
  packs untouched.
- **`duotone-medal` and `duotone-high-five` repaired.** Both collapse every internal id
  onto one string, so `url(#x)` bound to the mask and the medal painted as three bars.
  Fixed with `fix-duotone-ids.ts`, the tool PROGRESS.md already documents. Worth reporting
  upstream: 20 of the 48 branding-cli duotones have this defect.

## [0.41.2] - 2026-08-01
### Changed
- **Redacted internal identifiers from the public docs.** This repo is public; the dev
  handoff/runbook docs referenced the operator's business domain and internal Cloudflare
  hostnames (`hatch.*`, `kids-demo.*`, `kids-dev.*`), a personal email, and an internal ops
  abbreviation. All replaced with neutral placeholders (`*.internal`, `ops`, `<redacted>`).
  No behaviour change; the accurate hostnames live in the private ops repo.
- **`root-redirect` demo-link guard is now a whitelist.** It asserted the served page does
  not contain a specific business host by name; it now asserts every absolute `/demo` link
  equals the branded `https://demo.nimiq.kids/demo`. Strictly stronger, and it no longer
  embeds the business domain in a public test.

## [0.41.1] - 2026-08-01
### Fixed
- **`data/` is gitignored.** `routes/media.ts` defaults `MEDIA_DIR` to `data/media`, inside
  the working tree, so every dev or prod run writes kid-uploaded photo stickers into the
  repo. The directory was untracked but never *ignored* — and this repository is public, so
  a single `git add -A` in a worktree that had served an upload would publish a photograph
  of a child. That already happened on a branch (a jpg under `data/media/2026/07/`); it has
  never been on `main`. Untracked is not the same as ignored.


## [0.41.0] - 2026-08-01
### Added
- **CI gates every PR on `nq lint`** — the fleet's brand/visual check, run against the app
  as it actually renders. A new `brand-lint` job clones `nimiq-branding-cli` at the pinned
  `v1.4.1`, installs Playwright chromium, boots the seeded SIM app on :3300 and lints the
  live URL, propagating `nq lint`'s exit code so it is a hard gate. It hard-fails on
  unambiguous off-brand output: em/en dashes, periods on titles, glassmorphism, input
  borders, off-palette colours, generic icon sets.
- ⚠️ **Turned on only after checking main passes it.** The risk with a gate like this is
  switching it on while the app already trips it, which blocks every open PR until someone
  fixes the app. `nq lint` was run against the live site first: `https://nimiq.kids/` is
  **0 errors** (4 warning categories) and `/kid/` is **0 errors** (2). `nimiq-branding-cli`
  is public and the `v1.4.1` tag resolves, so the unauthenticated clone in the job works.
- ⚠️ This adds a branding-cli clone plus a Playwright install to every PR, on top of a
  check/test job that finishes in about 50s. That cost is the deliberate trade.


## [0.40.1] - 2026-07-31
### Changed
- **One switch for the walkthrough video.** `VIDEO_URL` already drove `GET /video`;
  the marketing page had a separate hardcoded `VIDEO_ID` needing a code edit and a
  deploy. Two mechanisms for one thing, guaranteed to drift. `applyVideoUrl` now
  substitutes the id into the page's own constant at serve time, so setting the env
  var on the instance is enough: no code edit, no PR, no rebuild. The page still
  works exactly as written, so hardcoding by hand also still works and wins when no
  env var is set. Accepts a watch URL, `youtu.be`, `/embed/`, `/shorts/`, or a bare
  11-char id. A non-YouTube URL still drives `/video` but leaves the placeholder up,
  because this page only knows how to build a YouTube iframe.
  This is what makes `https://nimiq.kids/video`, already submitted in the competition
  entry before the video existed, resolve to the real thing.

### Added
- **`docs/NEXT-SESSION.md`** — the cold-start handoff: live URL table, the video
  switch, how to force a deploy, and the traps that cost real time (a duplicate
  landing page built without checking for `feat/marketing-site-root`; `/portal/?choose`
  is not the demo; rebuild the shell after editing locales).

## [0.40.0] - 2026-07-31
### Added
- `tools/sound/` — the toolchain for the kid app's audio: generators for Suno (prompt pack),
  ElevenLabs, OpenAI and Deepgram; a shaping pipeline; and a phone-first review server.
  `audio.py` carries the DSP — phrase-aware fanfare trimming, seamless bar-snapped looping with
  an equal-power crossfade, and ITU-R BS.1770 K-weighted loudness matching — covered by
  `test_audio.py` (17 checks). No ffmpeg dependency; `afconvert` does all codec work.
- `docs/HANDOFF-sound-pack.md` — state of play, rejected providers, and remaining wiring.

### Notes
- **No app code or assets changed.** `public/assets/manifest.json` still has empty `music`,
  `timerSounds` and `alarms` arrays, so the Sounds sheet still shows "More coming soon!".
  The version bump belongs with the PR that actually adds audio assets.
- The Sounds sheet was already fully wired; `playAlarm()` prefers a file URL over its oscillator
  fallback and `startMusic()` already loops. Music and fanfares need only files plus manifest
  rows — no new playback code.

## [0.39.0] - 2026-07-31
### Added
- **A parent surface for the Treasure Box** (Settings -> Manage the box). The kid side
  has always read its shelves from data; there was no way for a parent to WRITE that
  data. Five parent-authed routes (`GET /parent/store`, create/patch a category,
  create/patch an item) plus `public/parent/views-store.js`. A parent creates shelves,
  reorders them, adds coupons and screen time, renames, re-prices and hides. Nothing is
  ever deleted: hiding is `active=0`, hidden rows stay visible to the parent and greyed,
  because `kid_purchases.item_id` is a real FK. Sticker packs and timer rigs are shown
  but locked, since their art and unlock ids can only come from the catalogue.
- **One glyph palette, shared by both apps** (`public/js/lib/box-glyphs.js`). The parent
  picks a face; the kid app draws it. Two copies would have drifted, which is how this
  app got five drawing styles in the first place.
- Three app-own glyphs in the wallet stroke language — dinner, moon, ticket — because
  the Nimiq duotone set has no meal, no bedtime and no prize ticket, and its one food
  icon is a Bitcoin-pizza reference drawn at a 0.6 stroke.
- `src/store-parent.test.ts`, and a retirement test in `stickers.test.ts` proving the
  Timers rows survive and a purchase against them still resolves.

### Changed
- **The Treasure Box header chest comes from the dock's own sheet.** It was
  `chestIcon()`, a hand-authored thin outline that belonged to no set — a fifth
  drawing style for a glyph the dock's generated sheet already had, in the app's own
  hand. Now `maskIcon("box")`. `chestIcon()` is deleted; its comment claimed it
  survived for "an animated lid", but `.bx-lid` had no CSS rule anywhere.
- **Shelf headers are solid `#fff` and hug their word.** They reused `.ch-sec-hd`, the
  CHART's floating label, and it was wrong twice over. It stretched — `align-self:
  flex-start` does nothing to a block `<h2>` inside a plain `<section>`, so every
  header ran 362 of 390px. And it was `rgba(255,255,255,0.82)`, which is the treatment
  for a label alone ON the scene; a shelf header sits directly on solid white tiles,
  the case `.ch-group-hd` already settles. New `.bx-shelf-hd`, no `.bg-dark` flip.
- **The Treasure Box title and chest moved onto one white capsule.** They were bare on
  the scene, which on Space is navy ink on a navy sky: measured `rgb(31,35,72)` with no
  background at all, both effectively invisible. Same answer `.k-page-title` gives Grow,
  the amount pad and the scanner. The header wraps now, because "Cofre del tesoro" /
  "Coffre au trésor" / "Baú do tesouro" beside a balance pill do not fit 390 on one row.
- **Screen time tiles draw their minutes.** All three drew one gamepad-with-Zzz, so 15,
  30 and 60 were the same picture three times. `minuteDialIcon()` fills a dial to
  `minutes/60`, derived from the datum, so a shelf that later sells 45 or 90 gets correct
  art with nothing new drawn.
- **An item's face is DATA.** `payload.icon`, else the icon its category carries, else a
  per-kind default — so a parent-created shelf and its items get a picture with no UI
  code change. `store_categories.icon` is a new column; the two coupons, which both drew
  one high-five, now name `dinner` and `moon`.
- **Timers are retired from the Treasure Box.** `cat-timers`, `item-timer-maker` and
  `item-timer-pola` go `active=0`. RETIRED, never deleted: `kid_purchases.item_id` is a
  real FK, and a kid who already bought the Sticker Maker keeps it — the rig is equipped
  out of `kid_unlocks` via `ownedTimerStyles()`, which never reads `store_items`.
- **`store_items` / `store_categories` gained `parent_edited`.** Once a parent edits a
  seeded row it is theirs and `syncStickerCatalog()` stops re-applying the catalogue's
  price, payload and title over the top at the next boot.

- **Re-priced, and the dollar is now on the tile** (Andjroo's call off a rendered
  comparison at $0.00046914/NIM). Screen time 800/1400/2500 -> **1000/2000/4000**, coupons
  4000 -> **6000**: the ladder doubles, so an hour is exactly four fifteens. The fiat sits
  under the NIM pill and on the buy sheet, read through the same `fmtFiat()` the money
  screen uses, so it follows the kid's own currency picker and never goes stale. Sticker
  packs untouched.
- **`duotone-medal` and `duotone-high-five` repaired.** Both collapse every internal id
  onto one string, so `url(#x)` bound to the mask and the medal painted as three bars.
  Fixed with `fix-duotone-ids.ts`, the tool PROGRESS.md already documents. Worth reporting
  upstream: 20 of the 48 branding-cli duotones have this defect.

## [0.38.1] - 2026-07-31
### Fixed
- **"Try the demo" went to the live mainnet app, not the demo.** Every demo link on
  the marketing page pointed at `/portal/?choose`, which on this instance is the
  real chooser: no Sam, no Ava, nothing seeded, and it asks a visitor to create a
  real family with real money. A test asserted that link with the comment "Demo:
  the seeded family", so the belief was baked in. The seeded family (Mom, Sam, Ava,
  jobs on the board, allowance already earned) only ever existed on the testnet
  instance, which runs `HATCH_DEMO_SEED=1` and mints one private household per
  visitor. All four links now point there. The demo itself was never broken.
- **The demo now has a branded hostname**, `demo.nimiq.kids`, so a competition
  visitor never sees a `internal` URL. A test asserts that host never appears
  on the page. The old alias still answers for internal use.
- **"Roadmap" scrolls to the roadmap.** Both the menu and footer linked it to `/`,
  which just re-served the page and dropped the visitor back at the top.

## [0.38.0] - 2026-07-31

The egg timer, in the app. Six unreleased bumps on `feat/kid-egg-timer` (0.30.0-0.30.5)
collapse into this one release — main went 0.29.11 -> 0.31.0 while the branch was out, so
that 0.30.x range never existed here. Their notes are kept below, a level down.

⚠️ **RE-DERIVE THIS NUMBER AT THE MOMENT OF MERGE.** It has already moved twice while this
branch sat: #143 and #145 both claimed 0.35.0, then #145 landed as **0.36.0** and #150 as
**0.37.0**, each taking the number this file had picked minutes earlier. This is the third
re-derivation. Do not trust this line; check `main` first.

### [0.30.5] - 2026-07-31
#### Fixed
- **The whole app's page background was near-black, and it showed as a line under the
  dock.** Andjroo: *"there is a black line below my bottom navigation, in the border of the
  page."* `public/kid/css/eggtimer.css` is the egg timer's **staged native port** — a
  prefixed copy of `timer.html`'s CSS — and `public/kid/index.html` links it on every
  screen. It carried that page's own reset,
  `html,body{height:100%;overflow:hidden;background:#0d1020}`, so the standalone timer's
  near-black became the page background of the entire kid app. The dock is white and ends
  at the viewport bottom, so wherever the safe-area inset and the dynamic viewport
  disagree by a pixel, the body showed underneath it.
  ⚠️ **Invisible in every headless render** — the inset is 0 at 390x844. Only ever on a
  real phone. `kid.css` already owned the layout half and loads after, so the rule was
  pure background; removed, and the body is now **white to match the dock**, the one
  element this colour is ever adjacent to.
  ⚠️ When the port CSS is re-derived, drop the `html/body` rule again — a prefixer cannot
  know it is scoping a whole page.
- **The build stamp is gone.** It was added this session so a speed claim could be checked
  and Andjroo killed it on sight: *"the numbers just need to be gone."* The version stays in
  the iframe URL, where it does the real work — a stale copy can no longer be served,
  which is what fixed the second open. The pill was only ever the diagnostic.

### [0.30.4] - 2026-07-31
#### Fixed
- **You can see which timer you are looking at.** Andjroo: *"I have said 'it looks exactly
  the same' twice in one session and neither time could I check."* The timer printed its
  build only in the review strip, which `?clean=1` hides — and `?clean=1` is exactly what
  the app's iframe passes, so the one surface he looks at was the one with no version on
  it. The frame asks for `?stamp=1` now: a small always-on pill reading
  `timer · rig · the time this copy was written`. The clock time comes off the vendored
  files' own mtimes, so it cannot go stale the way a hand-typed constant can.
- **The iframe src carries a version** (`src/timer-build.ts`), derived from the newest
  mtime in `public/kid/timer/` rather than typed anywhere. Editing any of those 111 files
  changes it whether or not anyone remembers to bump a BUILD string.

#### Performance
- **Tapping Timer a second time costs nothing: 5.40s → 0.18s, 5.05 MB → 0 bytes.**
  Nothing under `/kid/timer/` was cacheable. `serveStatic` sets no `Cache-Control`, no
  `ETag` and no `Last-Modified`, and `serve-cache.ts` puts `no-cache` on every `.html`
  while stripping the validators — so the timer and the rig re-downloaded in full on
  every open with not even a 304 available. Now that every URL under there carries the
  version token, they are served `immutable`.
- **First open: 5.41s → 1.43s to the egg, 5.05 MB → 2.90 MB.** Three causes, all measured
  at 1.6 Mbps: the background picker was still built at boot (four full-bleed JPEGs for a
  kid looking at one, landing *ahead* of the egg's own art); wave 1 carried the face set
  and the cracked sprite for a set screen that is faceless and uncracked; and
  `wiggle.html` shipped as 195.7 KB of plain text.
- **gzip for text responses** (`src/serve-compress.ts`) — the rig goes 195.7 KB → 69 KB.
  ⚠️ Registered outermost, above `cacheBusting()`: that middleware rewrites HTML bodies by
  reading them back as text and would read a compressed one as noise.
- **Lossless WebP art, 4.42 MB → 2.68 MB.** Not the quantising that has been turned down
  before: `tools/webp_art.py` (in anim-demo) proves file by file that the alpha channel is
  bit-identical and every pixel with any alpha at all is the same colour. Only fully
  transparent pixels differ. `loadImg()` falls back to the `.png`.

#### Notes
- ⚠️ **There is no service worker in this app.** `public/sw.js` exists, `cacheBusting()`
  stamps it and there is a test for it, but nothing ever calls
  `navigator.serviceWorker.register`. Do not reason about SW caching until something does.
- `tools/eggtimer-appegg.py` times the egg from the *tap*, twice, and reports bytes that
  actually crossed the wire (CDP `encodedDataLength` — Playwright's `response` event fires
  for cache hits too and would report a fully cached open as megabytes).

### [0.30.3] - 2026-07-31
#### Performance
- **The egg appears in 5.9s instead of 24.6s** on a throttled 1.6 Mbps link. Andjroo:
  *"things are still kinda loading out of pace, and the egg loads last."* One
  `Promise.all` held every image — shell, ten crack sprites, twenty-one characters, face
  parts — and the rig's `start()` is what *draws*, so the egg could not appear until the
  last of 4.9 MB landed while the chrome around it rendered immediately. Boot is two
  waves now: ~0.65 MB to draw a still egg, then the rest in the background. Neither the
  crack (well into the clock) nor the character (the hatch) is needed at boot.
- ⚠️ `setPattern()` refuses a pattern whose art has not landed — `eggImg()` falls back to
  the plain shell, so it would not crash, it would silently hatch an egg with no crack.
- `tools/eggtimer-timetoegg.py` measures it by polling the rig's own canvas for ink, so
  the number is when a child would *see* the egg rather than when the server answered.

### [0.30.2] - 2026-07-31
#### Performance
- **The timer's boot weight went 8.10 MB / 106 requests → 5.04 MB / 74, with no pixel
  changed.** Andjroo: *"it was kind of slow loading everything."* Two causes, both free:
  every hero PNG was fetched **twice** (the rig versions its URL with `?v=<rig build>`,
  the picker grid asked for the bare path, and a query string is part of the cache key —
  42 requests for 21 files), and the two picker grids were built at boot inside **closed**
  sheets. `loading="lazy"` does not save those: a sheet is only translated off-screen, so
  its images count as near the viewport and load anyway.
- ⚠️ The lazy build lives in `sheet()`, not at the buttons that open it. At the buttons
  first, `TIMER.sheet('shReminder')` — the public API — landed on an empty grid.
- **Not done, and it is an art call:** quantizing the hero art is another 61% off
  (2.97 → 1.17 MB) but it is lossy (mean error 1.94/255, worst 40, which shows on a
  gradient). A lossless re-encode buys only 4%.

### [0.30.1] - 2026-07-31
#### Fixed
- **The timer no longer flashes its own tuning page on the way in.** Andjroo: *"I see
  all that picking stuff we had, the wiggly faces... I see the whole process of how we
  made this."* The rig's `embed()` ran at the END of a chain that fetches four JSON
  files and loads ~30 images, so the entire tuning page — header, tabs, face picker,
  crack grid, sliders — painted and sat there for the length of that load before
  anything hid it. Embed is decided in the `<head>` now, synchronously from the URL, so
  the chrome is never painted once. `tools/eggtimer-noflash.py` samples *during* the
  load on a throttled connection and reproduces the bug against an unfixed copy.

#### Changed
- **The countdown is the red ring around the badge, not the corner pie.** The rim was
  already one of the three placements behind the review strip; it is the one that
  ships. ⚠️ The timer's storage key moved `kidtimer2` → `kidtimer3` because a *default*
  changed — a stored value beats a new default every time.

### [0.30.0] - 2026-07-31
#### Added
- **The Timer button opens a timer.** It used to open three round glyphs (hatch /
  sounds / background) and no way to set or start anything — issue #87's "dead end".
  It now opens the egg timer Andjroo signed off across several sessions: the Set Timer
  dial, Start, the running screen with the pie and the steppers, the hatch, and the
  four sheets. The three glyphs survive as that timer's own bottom tray, which is
  where they already were in the built version.
- **The egg rig itself** (`public/kid/timer/`) — the drawn silhouette, the locked
  faces, the locked break, the crack that rolls a different pattern every run, and a
  character rolled from the set the kid ticks. ~3000 lines of canvas that crossed over
  intact rather than being re-implemented, plus 6.8MB of art.

#### Notes
- ⚠️ **The timer is hosted whole, in a frame, for now.** That put the real thing in
  Andjroo's hands today; the native port (app i18n, server-side `kid_prefs`, the app's
  own sheet plumbing) is staged in `public/kid/js/_eggtimer-port/` with the steps in
  `public/kid/timer/README.md`. What the trade costs, plainly: the timer's choices live
  in its own localStorage rather than following the kid across devices, its strings are
  English rather than the app's five locales, and its four sheets are its own — so the
  app has two sheet styles until the port lands.
- ⚠️ **Asset paths inside `public/kid/timer/` are relative and must stay that way.**
  The same files are served from `/` in the source repo and `/kid/timer/` here; a
  leading slash silently works in exactly one of the two hosts.
- ⚠️ **The 6.8MB of art is deliberately NOT in `sw.js`'s `SHELL`** — that array is
  precached on install.
- Task countdowns still run the old sprite rig (`egg2.js`). One egg everywhere is the
  next change.

## [0.37.0] - 2026-07-31

### Changed
- **The bare domain now serves the designed marketing site** (`public/site/index.html`)
  from `feat/marketing-site-root`, which had been finished and left unmerged. A
  duplicate homepage was built against it earlier today in ignorance of that branch
  and briefly shipped as 0.36.0; `public/home/index.html` and its stills are deleted
  here, along with the `app.home*` locale keys, so there is exactly one landing page.
- Kept from the interim work: `cacheBusting()` running ahead of the root handler
  (both branches reached that fix independently), the `HATCH_DEMO_SEED=1` branch so
  the testnet demo's bare domain still goes to `/demo`, and `GET /video`.
- `sw.js` `VERSION` stays at the higher `v15`. A service-worker cache name must
  never go backwards or clients pin the older shell.

## [0.36.1] - 2026-07-31
### Fixed
- **A merge now goes live in about two minutes instead of up to ten.**
  `com.nimiqkids.autodeploy` was a `StartInterval=120` job, and launchd never
  services StartInterval for agent-shell bootstraps on this Mini, so the interval
  was dead and every deploy fell through to the `*/10` cron rider. It is now a
  self-looping process (`deploy; sleep 120`), which does not depend on launchd
  servicing anything, and the cron rider was demoted to a watchdog that restarts
  the loop if it dies. Same shape as poller-loop + poller-watchdog.

## [0.36.0] - 2026-07-31
### Added
- **A homepage on the bare domain.** `docs/ROADMAP.md` has said since it was written
  that "this mirrors the roadmap on the homepage; if the two ever disagree, the
  homepage is the one people read" — there was no homepage. The domain dropped
  straight into `/portal/`, so a visitor met a two-door chooser with no idea what
  the product was. `public/home/index.html` now carries a hero, the four-step
  circle, a walkthrough slot and the roadmap, in the portal's exact construction
  (same navy radial header, same lockup at 27.6px, same card treatment) so the two
  pages read as one product.
- **A menu behind the wallet's own MenuIcon**, mirrored to the right edge it sits
  on: try the demo (testnet, no real money), use it for real, the parent and kid
  apps for anyone already set up, the roadmap, the repo, and andjroo.com.
- **The walkthrough slot fills itself in.** With `VIDEO_URL` set the section
  becomes a YouTube/Vimeo/Loom embed; without it, two real app stills and a line
  saying the walkthrough is being recorded. It is never an empty player and never
  a dead link.

### Changed
- **`/` serves the homepage in place rather than redirecting**, so the bare domain
  stays bare. `/portal/` is unchanged and one click on. The judge-demo instance
  (`HATCH_DEMO_SEED=1`) still goes straight to `/demo`, and the family install
  keeps its root demo.
- **Returning visitors never see the homepage**: a stored parent session or a
  paired kid device goes to its app, and inside Nimiq Pay's WebView the homepage
  hands off to `/portal/`, because a kid there needs their sign-in and not a pitch.
  `?stay` forces the page.
- **`cacheBusting()` now runs before the root handler.** It post-processes, so
  registered after, a homepage served straight from the root handler would have
  skipped both its `no-cache` header and its `?v=` stamp, and an installed PWA
  could have pinned a stale shell.

### Notes
- Homepage strings ship English in all five locales so `locales.test.ts` parity
  holds; translating is now a copy pass over the `app.home*` block.
- `nq lint`: 0 errors. The remaining warnings are deliberate — 16px card radius and
  the spacing rhythm match the shipped `/portal/`, which is the stronger constraint
  here than the abstract scale.

## [0.34.4] - 2026-07-31
### Fixed
- **A deploy now actually reaches the edge.** `serve-cache.ts` replaced `?v=`
  placeholders in served HTML but never minted one, so any page that referenced an
  asset plainly kept a URL that was byte-identical across deploys — Cloudflare held
  the old bundle for the full `max-age` (4h). The v0.34.3 corner fix was live at the
  origin while `/portal/` still loaded a four-hour-old `app-shell.js`. The portal
  chooser's `/dist/app-shell.js`, eleven `/kid/` stylesheets and `/kid/js/main.js`
  all had the hole. The stamp is minted now for any root-relative `.js`/`.css`;
  absolute and protocol-relative URLs are left to the host that owns them. (#146)

## [0.34.3] - 2026-07-31
### Fixed
- **The portal chooser's language control got its pill back.** It rendered as a bare
  flag while `/parent/` wore the outline pill for the same control. Cause was
  upstream: `nimiq-app-shell` v0.5.0 built the wallet-less corner by reusing
  `data-mode="miniapp"` — right for the menu, wrong for the face, since chrome-less
  is a mini-app statement (inside Nimiq Pay the host wallet is the context). The
  portal is the only surface here that mounts wallet-less; `/parent/` and the kid app
  mount `#wallet-slot`, which is why the two headers disagreed. Fixed in shell v0.6.1
  (`data-face="lang"` carries the pill); this is the dep bump. (#144)

## [0.34.2] - 2026-07-31
### Added
- **`GET /video` redirects to `VIDEO_URL`.** The competition entry has to carry a
  walkthrough link before the walkthrough is recorded, and a submitted form field is
  not editable afterwards. `https://nimiq.kids/video` is submitted instead, and
  pointing it at the real upload is an env change plus a restart. Unset, it falls
  back to `/portal/` so the link is never dead.

## [0.34.1] - 2026-07-31
### Fixed
- **The portal chooser now fits a desktop.** The whole page lived inside a 460px
  column, so on a desktop the navy header was a cropped strip on grey. The header
  now spans the viewport (row inside constrained to 1100px), and the chooser
  centers in the remaining space at every size, with a slightly larger card scale
  from 768px up. Cards gain the standard hover lift; `prefers-reduced-motion`
  respected.
- **The portal header now carries the real `NIMIQ.kids` lockup** (same
  `/assets/brand/` artwork and 27.6px height as the parent app, bare mark under
  400px) instead of a bare hexagon plus a retyped wordmark, which the brand README
  forbids. Title weights dropped 800 -> 700, the brand headline weight.
- **The chooser copy says what each door is for.** Parent: "Set up chores, rules
  and approvals" (was "Chores, approvals and top-ups"); kid: "Do my jobs and earn
  coins" (was "My chores and my money", which read oddly). All five locales.
- **The kid card's avatar is the egg rig's own dinosaur** (`/assets/heroes/dino.png`,
  real cut pixels from the approved anim-demo roster at 200px, 3x the 64px card),
  replacing the old saturated sticker-keyline puppy that read as a different
  product. A rotating crossfade through eight roster characters was built and
  walked in session; Andjroo's final call was the single static dinosaur.

## [0.29.9] - 2026-07-31
### Fixed
- **A stake under 100 NIM no longer says "Something went wrong".** Albatross refuses a
  stake below 100 NIM, and the API has always reported the floor as `minStakeLuna` — the
  kid app never read it. So a kid with 59 NIM got an enabled "Grow more" button, a
  generic error, and a bounce back to Grow with their entry lost. The keypad now enforces
  the floor with "You need at least 100 NIM to grow" while the number is still on screen
  and editable, and `below_min_stake` / `staking_unavailable` map to real messages
  instead of `errGeneric`.

## [0.29.8] - 2026-07-31
### Fixed
- **An unreachable chain no longer reads as an empty wallet.** When the node is down
  `/kids/:id/wallet` 500s; `refreshWallet` swallowed it and the money screen fell through
  to a zero-filled fallback, so a kid holding 109,834 NIM was shown "0 NIM" and "No money
  moves yet. Go earn some NIM!" with Send still enabled. There is now a `walletError`
  state and an honest screen with Try again.
- **Receive no longer draws a QR with no address in it.** Without an address the sheet
  still rendered, emitting a perfectly scannable code encoding the literal string
  `nimiq:` under "Scan this code to send NIM to <kid>". A grown-up would scan it and get
  a wallet with no recipient. The sheet now refuses to open.
- **"Family wallet 0 NIM" for a wallet holding 110,000 NIM.** The parent overview read a
  snapshot only `deposit-check` ever writes, so `?? 0` stated as fact a balance that had
  never been read — and TOTAL BALANCE silently omitted it. `hotWalletLuna` is now `null`
  until the chain has actually been read, and the parent app draws an em dash plus "Tap
  to check". A real zero, once checked, still reads 0.

## [0.29.7] - 2026-07-31
### Fixed
- **The back arrow was dead on every sheet.** `.nq-button-s` hangs an
  absolutely-positioned hit-halo (inset -1.5rem) off the close button, and the app
  forced `position: static` on it — a static element is not a containing block for its
  own absolute `::before`, so the halo resolved against the `relative` page-header and
  stretched 378x73px across the whole row. `elementFromPoint` on the back arrow
  returned the CLOSE button at 320/360/390/430. On the amount pad those are different
  actions, so **tapping back abandoned the send** instead of stepping to the recipient
  picker. One word: `static` -> `relative`.
- **The starter board advertised a job paying "+0 NIM".** Rewards print as whole coins
  by design (`fmtNimWhole`, "never 0.1 NIM"), so the 0.25 NIM sample chore rounded to
  zero on the first screen every new family sees. Sample rewards are now whole NIM.
  The sub-cent-fee point belongs in copy, not in the one place a judge looks first.

## [0.29.1] - 2026-07-31
### Fixed
- **An unstake no longer reports the NIM returned until the chain has returned it.**
  `settlePendingUnstakes` marked the event done the moment retire+remove BROADCAST.
  The node accepts both from an account whose stake has not been released and fails
  them at execution, so a successful broadcast proved nothing. Because
  `stakedFromLedger` already subtracts a pending unstake and off-SIM spendable comes
  from the chain, the amount left the staked total, never arrived in spendable, and
  **disappeared from the kid's screen entirely** — neither staked nor spendable.
- Settlement now waits for the account balance to RISE by the unstaked amount, the
  mirror of the stake check added in 0.27.0. A node outage waits rather than
  retrying blindly, and a partial return does not count.
- Unlike a failed stake, a failed unstake is **retried, never written off**: the NIM
  is still in the staking contract, so "still staked, try again" is the only honest
  state. Retry interval `HATCH_UNSTAKE_RETRY_AFTER_MS`, default 10 min.
- Verified on the live testnet: stake executed (block 7507206), unstake broadcast
  retire (7507227) then removeStake three times (7507293, 7507397, 7507502), every
  one accepted into a block having moved **0 luna**. The ledger held `pending`
  throughout and never claimed the funds back.
## [0.29.3] - 2026-07-31
### Fixed
- **A self-serve family had no usable family wallet, so half its money paths were dead.**
  `POST /api/onboard` stored `NQ00 0000 …` whenever the parent onboarded without
  connecting a wallet — and that string is not an address, it fails its own checksum.
  Everything that pays back INTO the family wallet therefore threw at signing time:
  verified on the live testnet, `POST /api/kids/:id/send {toParent:true}` answered
  `400 "Invalid checksum"` and every `POST /api/kids/:id/buy` answered `502`, i.e. the
  entire Treasure Box was dead — on exactly the path a competition judge takes, since
  that is the path that never connects a wallet. Onboarding now falls back to the
  instance hot wallet, the same address `ensureFamily()` gives the legacy household and
  `POST /api/demo/family` already gives a demo one. (`src/routes/onboard.ts`)
- **A one-key typo in a typed address reached the parent, then burned the approval.**
  `normalizeNqAddress()` checked only the SHAPE (`NQ` + 34 chars), never the checksum,
  and its character class also admitted `I/O/W/Z`, which are not in Nimiq's base32
  alphabet. Verified on testnet: `NQ75…` for `NQ74…` queued, notified the parent, and
  survived until approval — where it threw `Invalid checksum` AFTER the approval had
  been decided. The parent got a `502`, the approval was spent (`409 already_decided`
  on retry) and the send request was stranded in `pending` forever. The codec now has
  the last word while refusing is still free. (`src/routes/wallet.ts`)
- The address `generate-hot-wallet.ts` appends is now quoted: the user-friendly form
  contains spaces, so `set -a; . env` broke on it. (`src/scripts/generate-hot-wallet.ts`)
## 0.28.1 — Cashlink funding is verified before the link exists

Live-testnet integrity run (2026-07-31, TestAlbatross via a local light-client sidecar).
The mint/claim loop works end to end — a kid's Cashlink was funded on chain, the URL
opened in the real `hub.nimiq-testnet.com` Cashlink page showing the right amount and
message, and the funds were swept to a fresh address. Two ways it could lie were found
and closed.

- **A returned tx hash is no longer treated as proof of funding.** `sendRawTransaction`
  answered with a hash for a transaction that never executed (a conflicting spend of the
  same balance), and `mintCashlink` handed back a Cashlink URL for an address holding
  nothing. The Hub renders that link as a real "30 000 NIM — Claim your Cash", and
  `checkClaim` reads the empty address as CLAIMED. `mintCashlink` now waits for the
  funding to actually land (`waitForFunding`, `HATCH_FUNDING_CONFIRM_MS`, default 20s)
  and throws `funding_not_confirmed` instead of minting a dead link.
- **A send approval whose payment failed goes back in the queue.** It was left
  `approved` with its send request still `pending` — on no screen, and un-retryable
  (`already_decided`, 409). The kid's request just disappeared. `reopenApproval` puts it
  back, and only when the request is verifiably untouched, so nothing half-applied can
  be replayed.
## [0.30.0] - 2026-07-31
### Changed
- **There is no payout ceiling any more. The parent sets the price.** (Andjroo: "there
  should be no payout ceiling. The parent should be able to pick that.") Every fixed cap
  we shipped was wrong for somebody. 10 NIM was worth half a cent. The dollar-denominated
  replacement still told a parent their own $20 job was "too large". And the 50,000 luna
  cap running on the live instance refused the app's own seeded 100,000 luna "Tidy up your
  room" chore, so the first approval a judge ever tried came back `400 payout_too_large`.
  A chore is worth what a household says it is worth, and no number we pick in an env file
  knows that. Removed: `HATCH_MAX_EARN_LUNA`, `HATCH_MAX_EARN_USD`, `maxEarnLuna()`, the
  `MAX_PAYOUT_LUNA` ceiling on allowance day, and the `payout_too_large` error itself.
  Setting those vars now does nothing.
- **The only thing that can refuse a payout is the money not being there**, and it says so.
  A payout a family cannot cover answers `400 budget_exhausted` with `neededLuna` and
  `availableLuna`, and the approval stays PENDING: the parent tops up and approves the very
  same chore again. Nothing is half-applied, nothing is silently dropped.
- **What "can afford" means is now one number, and the parent can see it.** A payout is
  bounded by the family's budget on a shared instance and by the hot wallet's real balance
  always, whichever is tighter. That is exactly the figure `GET /parent/overview` already
  shows as "Family wallet", so a parent is never refused a payout their own screen says
  they can afford. Before refusing, the server re-reads the chain balance, so a stale
  snapshot can never be the reason a funded payout is blocked; if that read fails the
  payout goes through on the snapshot's word, because an unfunded transaction is refused
  loudly by the network anyway.

### Kept, deliberately
- **The per-family budget is untouched.** `HATCH_DEMO_GRANT_LUNA` plus attributed top-ups
  still bounds what one household can draw from the shared hot wallet on the public
  instance. It is a different mechanism from the per-payout ceiling and it is the one that
  actually stops a stranger draining the wallet.
- **The overdraft re-check survives.** A kid's queued send is still re-tested against their
  balance at approval time, not only when they queued it, so two individually affordable
  sends can still never both go through.

### Known issue
- Removing the ceiling widens an existing race on the shared public instance: the budget is
  checked before an approval is decided, but the `earn` row it is derived from is written
  after the payout, so approvals fired concurrently can each see the same untouched budget.
  One family's worst-case overshoot was `ceiling × concurrency` and is now `remaining budget
  × concurrency`. A single payout still cannot exceed the budget, so exploiting it takes a
  deliberate burst of concurrent approvals against a household you already control. The fix
  is to reserve the spend in the same write that decides the approval. Documented in
  `deploy/competition/README-COMPETITION.md`.

## [0.29.2] - 2026-07-31
### Fixed
- **A broadcast is not a payment: `/api/family/topup-broadcast` credited the payout
  budget for NIM that never arrived.** The route took the tx hash returned by
  `sendRawTransaction` as proof of funding. It is not — an Albatross node accepts a
  transaction signed by an *empty* account into its mempool and hands back a hash
  exactly as it does for a funded one, and that transaction then silently never
  executes. Verified end to end against the live testnet on 2026-07-31: a second,
  non-exempt household posted a well-formed 5,000 NIM transfer signed by a zero-balance
  key, was credited `500000000` luna of payout budget, and then approved a 6 NIM chore
  (above its 5 NIM grant) that paid **out of the shared hot wallet on chain** — funded
  by another family's genuine top-up. The credit now waits for the hot wallet's own
  balance to rise by at least the transaction's value before it is granted
  (`topUpArrived`, bounded by `HATCH_TOPUP_CONFIRM_MS`, default 25s), and the response
  carries `landed` so the parent app can tell "sent" from "settled". Balance is the gate
  because it is the only chain read every supported node answers —
  `getTransactionByHash` is unavailable on the light-client sidecar and
  `getTransactionsByAddress` is unavailable on validator / non-history nodes. Replaying
  an already-credited tx short-circuits the wait via the new
  `repo-budget.hasBudgetCreditTx`; the unique index on `tx_hash` remains the thing that
  actually prevents a double credit. 6 new tests in `src/budget.test.ts`.
## [0.29.0] - 2026-07-31
<!-- Authored as 0.28.0; main took that number for the judge demo (#105) while
     this branch was in flight, so it renumbered on the merge. -->
### Changed
- **A job is finished by answering a question, not by running a timer.** Tapping
  a card used to drop the kid onto the timer screen, and the timer was the only
  way to complete a chore (Andjroo: "I wanna make it where the kid doesn't have to
  use a timer. There should be no timer there."). It now opens an "Is it done?"
  sheet with two answers, and the timer is one of that sheet's offers.
- **The sticker circle renders from the start**, on every job that is still open.
  It used to appear only once the job was done, on the reasoning that an empty
  ring you cannot fill is dead card. That held while the timer was the only way
  in; now the ring IS the button, so the invitation is honest. Cards go 64 -> 72px
  at 390. The reward pill did not move.
- **Yes routes to the parent through the path that already existed** — no new
  mechanism. A routine task posts `/task-runs/:id/done` (which opens the
  `routine_run` approval once the run's last task lands); a chore posts
  `/chores/:id/submit` (which opens its `chore` approval). Both notify the
  parent's phone server-side, exactly as the timer's own finish always did.
- **THE STICKER NOW WAITS FOR THE PARENT.** Andjroo's call, given the two renders:
  saying a job is done no longer hands out a sticker. The ring goes to a waiting
  look, and the picker opens from that same ring once the parent has approved.
  This is the load-bearing change — it applies to the timer's finish too, because
  otherwise the timer would be the only way to still get a sticker on the spot,
  which is exactly what was being removed.
- **"Not yet" just closes**, also Andjroo's call. Nothing is recorded, nothing is
  reported: a kid who opens the sheet by accident is out with no consequence.
- **One card state machine** (`chart.js cardState`) — `open` / `waiting` /
  `retry` / `reward` / `done`. The ring's look, what a tap does and whether the
  sticker is available now all read off ONE function; they were three separate
  reads of the same fields and had drifted apart.
- **The timer offer runs the job that was pressed.** `enterRoutine()` takes an
  optional `taskRunId`; without one it still falls back to the routine's first
  unfinished task, which was all it could mean while the timer was the only door.
- **Finishing a task no longer shoves the kid into the next task's timer.**
  Auto-advance was right while the timer WAS the routine.
- A chore has no duration, so its sheet has no timer row rather than an offer
  that cannot be honoured.

### Fixed
- **An approved chore no longer falls off Today before its sticker is
  collected.** `/chart` kept a finished chore only while its placement was dated
  today — impossible to fail before, because the sticker was always placed before
  the parent ever saw the job. With approval now first, the card vanished at the
  exact moment it became the reward the kid was told to come back for. It stays
  while it is approved today and uncollected. Regression test in `stickers.test.ts`.
- **A collected job no longer goes translucent.** `opacity: .8` on the whole
  card (what `.is-approved` did) makes a white card see-through, and a
  see-through card over a busy scene drags the artwork up through its own title.
  The INK steps back now, the card stays solid #fff — the same rule `.ch-group-hd`
  already follows. Barely reachable in review before; it is the resting state of
  every job a kid finishes from now on.
- A placement that exists always renders, whatever the card's state says: a
  sent-back sticker still greys and wobbles, and rows written before this change
  still show. Keying the sticker off the state hid both behind the hourglass.

### Added
- `public/kid/js/done.js` + `public/kid/css/done.css` — the sheet. It rides the
  app's own bottom sheet (`openSheet`), not the `setScreen` sheet Send uses,
  because the sticker that eventually follows is dragged into the ring ON THE
  CHART and `startPlacement()` measures that ring's rect: a `setScreen` sheet
  would have left placement with no target. Own CSS file because chart.css hit
  822 lines with it inlined, past the 800-line guard.
- `public/kid/css/box.css` — the Treasure Box screen, split out of chart.css.
  The CI guard is `>= 800` and chart.css had reached **810**; the Box is a screen
  with its own root, header and grid, and the only thing it borrows is the `.stk`
  component, so it is the honest seam. chart.css is 682 now, with real headroom.
  Proved inert by a computed-style + rect diff of every element on the Box screen
  at 390 and 800: **0 differences**.
- `app.kidIsItDone` / `app.kidYesDone` / `app.kidNotYet` / `app.kidUseTimer` in
  all five locales, plus `util.js`'s fallback table.
- `.mega-btn.quiet` — the neutral second answer, declared ABOVE `:disabled` so
  the equal-specificity trap that has bitten three times cannot bite a fourth.

## [0.28.0] - 2026-07-31
### Added
- **A judge demo that survives the judge before you.** `GET /demo` hands every visitor
  their OWN seeded household — a parent, **Sam** and **Ava**, a stocked board with a
  chore already waiting for approval on each kid, a Learn-to-Earn lesson, a routine, and
  allowance the kids have **already been paid on-chain**. Nothing one visitor does is
  visible to the next. `POST /api/demo/family` mints it and returns both bearers the
  apps already speak (`kidsParentToken`, `kid.deviceToken`), so isolation is the same
  isolation self-serve onboarding gets — `HATCH_LEGACY_BOOT=0` already shuts every
  unauthenticated boot surface, and each bearer resolves to its own family. New:
  `src/demo-family.ts`, `src/routes/demo.ts`, `src/demo-family.test.ts` (12 tests,
  including two visitors proving they cannot see or act on each other's household).
- The seeded history is **real settlement, not a fixture**. In family mode a kid's
  balance is read from the chain, so a seeded ledger row would have rendered as a feed
  of earnings above a balance of zero. Every past job is an actual payout from the
  instance hot wallet — which is exactly why this belongs on **testnet**: a public,
  approval-free demo (see `src/custody.ts`) must never sit on a funded mainnet wallet.
- Demo households are throwaway: `families.demo_at` stamps them and an hourly sweeper
  purges the abandoned ones (`HATCH_DEMO_TTL_MS`, default 24h), so the table cannot grow
  without bound. `purgeFamily()` deletes child rows first — the schema declares no
  `ON DELETE CASCADE`, so the order is load-bearing.
- Both routes are **off unless `HATCH_DEMO_SEED=1`**. The mainnet competition instance
  is unaffected by this code existing.
- On a demo instance the bare domain now redirects to `/demo` rather than the portal
  chooser: a judge who trims the URL gets the seeded family instead of a two-way choice
  they have nothing behind yet. `/portal/` stays reachable directly.
- Deploy kit for the testnet instance: `deploy/testnet-demo/` (env template, launchd
  plist template, `README-TESTNET.md` with the funding + pre-flight checklist).

### Fixed
- **A deleted household could hand its kid's funded on-chain address to the next kid.**
  `assignAccountIndex()` derived the next HD index from `MAX(account_index)` over the
  live rows, so deleting the newest family lowered the max and the next kid derived an
  index — and therefore an address — that was already in use and already funded. It now
  also respects a high-water mark in `wallet_state` that only ever rises. Latent before
  (nothing deleted families); load-bearing now that the demo sweeper does.
- **The testnet block explorer host does not exist.** `test.nimiqscan.com` fails to
  resolve, so every on-chain "Receipt" tap on a testnet instance landed on a dead page.
  Testnet now points at `test.nimiq.watch` (which addresses a tx by hash fragment);
  `HATCH_EXPLORER_TX` overrides either network.
- **"Family wallet" showed every household the whole instance float.** One hot wallet
  serves every family on a public instance, so the raw snapshot advertised a number a
  household can neither spend nor claim. A budgeted family now sees its own remaining
  budget — the figure every payout is actually checked against. Exempt (single-household)
  families are unchanged. The demo instance also primes that snapshot at boot, so the
  first visitor to tap Top up no longer books the entire instance balance as their own
  "top-up detected".
- The boot banner printed a hardcoded `0.12.0` and called real settlement "LIVE testnet"
  regardless of network. It now prints the real version and the real network.

## [0.27.1] - 2026-07-31
### Fixed
- **A kid can no longer overdraw by queueing two affordable sends.** Each outbound
  send is checked for affordability when the kid makes it, but nothing re-checked
  it when the parent approved it — and a queue is approved one at a time. A kid
  holding 75,000 luna could queue two 50,000 Cashlinks, have both approved, and end
  at **-25,000 luna with 100,000 luna of spendable Cashlinks minted**. Found by the
  wallet audit, reproduced, and now covered by `src/cashlink-overdraft.test.ts`
  (the tests fail against the previous code).
- The re-check sits in the approve route **before** `decideApproval`, so a refused
  send stays PENDING and can be approved again once the kid has earned the rest —
  the same contract the payout ceiling already used. `executeSendRequest` carries
  its own guard too, so the service is safe regardless of caller. The
  scanned-address branch was already covered by `kidTransfer`.

## [0.27.0] - 2026-07-31
### Changed
- **The scene grid lays out three whole rows**, four across on every size. The
  slots past today's four scenes are drawn as dotted outlines: the space the
  catalogue is going to fill is now visible rather than implied. The app's own
  idiom for a space waiting to be filled, same as `.ch-slot-empty` for a sticker
  a kid has not placed yet.
- **The fade is gone.** It hinted at a scroll, but with three whole rows laid out
  there is nothing below the fold to hint at, and a fade over a dotted slot just
  reads as the slot being broken. The grid still scrolls if the catalogue
  outgrows three rows; it no longer pretends to.
- **The first empty slot is an add button** carrying `nq-plus-circle`, verbatim
  from `@nimiq/style`'s icon sheet — the set's only plus, and rule 15 is that
  Nimiq icons are never fabricated. Tapping it toasts "More coming soon!"
  (`app.kidMoreSoon`, already in all five locales).
- Four columns on the TABLET too, not the studio grid's three: at 820px wide
  three columns made each scene ~250px and the three rows could not be seen
  without scrolling, which defeats laying out three rows.

## [0.26.1] - 2026-07-31
### Changed
- **The Switch-kid row shows the other kids' faces**, right-aligned. A kid who
  cannot read yet still knows their sibling's identicon, so the picture is the
  real label on that row and the words are the caption.
- Capped at 4 faces, then "+N": a big family would otherwise push the row wide
  and squeeze the words. Verified with a simulated family of eight -- 4 faces,
  "+3", label not clipped, no horizontal overflow.
- No wrapper of our own around `identiconImg()`; it emits its own `.identicon`
  and nesting one inside another lets the inner 10rem width win.

## [0.26.0] - 2026-07-31
### Added
- **The "me" sheet, behind the kid's own name.** Tapping your name used to switch
  kid outright; it now opens the one place that is about YOU: your name, Switch
  kid, and Background. The app's scene moved here from behind the Timer, where a
  background for the whole app had no business living.
- **A generated glyph for Switch kid**, in the dock sheet's own hand. Rather
  than regenerating the four-icon sheet (which would redraw the four already
  approved), the sheet goes in as an IMAGE REFERENCE and the model matches it.
  The subject is a hexagon with a circular arrow, not two little people: the
  app's kids ARE identicons in hexagons, so that is what "a kid" looks like in
  this app's language, and it survives 20px in a way a face would not. Shipped
  as an alpha mask like the dock glyphs, so it tints with its row.
- **The scene grid is built to grow.** It fills its columns (four across on a
  phone), scrolls inside the sheet with a fade at the foot, and the sheet rides
  higher than the studio's. Rendered against a simulated catalogue of 16: still
  67% of the screen, still nothing off-screen, the name and Switch kid still put.

### Changed
- **The Timer menu's Background now sets the TIMER's scene** (`timerBackgroundId`),
  which is what 0.25.0's split was for. The two no longer mirror: verified by
  picking a timer scene and asserting the app's pref did not move.
- `app.kidBgSub` retexted to "Pick the scene behind your timer." in all five
  locales; it is the timer sheet's subtitle now, not the app's.

## [0.25.0] - 2026-07-31
### Added
- **The timer has its own scene, separate from the app's.** `kid_prefs` gains
  `timer_background_id` and `bgFor()` gains a scope: every screen calls it bare
  and gets the app's scene, the running-timer screen calls `bgFor("timer")`.
  A kid can now keep a calm timer on a loud app, or the reverse.
  - The column is **nullable on purpose**: NULL means "same as the app", which is
    what every kid had before the split, so no existing kid's timer changes
    appearance until they deliberately choose otherwise. A `NOT NULL DEFAULT`
    would have frozen today's app scene onto the timer for everyone.
  - `PUT /children/:id/prefs` takes `timerBackgroundId`, and an explicit `null`
    survives as null (it is how a kid puts the timer back on the app's scene).
    `String(null)` would have written the literal "null" and the timer would then
    hunt for a scene by that name.

### Not yet wired
- Nothing writes `timer_background_id` from the UI yet, so this ships INERT and
  the app looks identical. The timer menu's Background sheet still sets the app
  scene, deliberately: repointing it before the app's own picker has a home
  would leave the app background unreachable. Both move in one commit once the
  placement is chosen (mocks in `shots/bg-placement/`).

## [0.24.4] - 2026-07-31
### Changed
- **The kid's name pill is opaque.** It was `rgba(255,255,255,0.92)` while the
  balance chip at the other end of the same header row was solid `#fff`, so the
  scene bled through one and not the other.
- The dark-scene flip on `.ch-kid-name` goes with it. A label only needs to turn
  white while it is BARE on the scene; on an opaque white pill that rule put
  white text on white. Same trap the page titles hit in 0.23.1 when they moved
  onto their pill. Verified navy on both Meadow and Space.

## [0.24.3] - 2026-07-31
### Changed
- **More air between the pad and the action.** 6px was smaller than the pad's
  own row gap, so the button read as a fifth key rather than a separate thing.
  Now `clamp(12px, 2.4svh, 24px)`, on the same axis as everything else on this
  screen so it does not eat the headroom back on a short phone. All eight
  height cases still fit with no scroll, the iOS-vh simulation included.

## [0.24.2] - 2026-07-31
### Fixed
- **The amount sheet is sized in `svh`, not `vh`, and that is the whole bug.**
  It still arrived cut off on Andjroo's phone while every headless sweep said it
  fitted. **On iOS Safari `vh` is the LARGE viewport**: it measures the screen as
  if the URL bar and toolbar were collapsed and does not shrink while they show.
  So `8vh` resolved against ~890px on a phone whose visible area was ~745px,
  every `clamp()` picked its biggest value, and the layout was sized for a screen
  taller than the one it was on. Chromium resolves `vh` to the real viewport, so
  no headless check can reproduce it.
  - `svh` is the viewport at its SMALLEST, all chrome showing, so it fits in
    every state and never re-flows as the bars animate (which `dvh` would).
  - Each declaration keeps a plain-`vh` line before it as the fallback for
    browsers that predate `svh`; an unsupported value is dropped, so the `svh`
    line wins wherever it is understood.
  - The sheet's own `max-height` moves to `92svh` for the same reason: `92%`
    resolved against a `position: fixed; inset: 0` box, which iOS ALSO lays out
    against the large viewport, so the cap was ~30px looser than the glass.
- **Everything on the screen is a step smaller**, per Andjroo. Keys run 45-62px
  instead of 50-74, and the amount, names, identicons and action came down with
  them.

### Added
- `pad-heights.ts` now carries an **iOS-vh simulation**: it forces every
  viewport-derived size to its large-viewport value while measuring against the
  small one, which is exactly the consequence of the Safari behaviour. It also
  asserts each block is WHOLLY inside the body -- cut off at the TOP is what was
  actually reported once the body had scrolled, and a bottom-only check misses
  it. All eight cases pass, the simulation included.

## [0.24.1] - 2026-07-31
### Fixed
- **The amount sheet fits a phone.** Andjroo: half the screen was cut off behind
  the pad and had to be scrolled to. Reproduced and measured: his phone is
  440x956, Safari's chrome takes that to ~806, and the URL bar expanding on
  scroll takes it to ~750. At 806 the fiat and the balance were cut; at 750 the
  amount itself went. The earlier check ran at 390x844 with no browser chrome,
  which is why it passed.
- **Everything on the screen now scales off one axis, the viewport height.** The
  pad's rows, the amount, the two names, the identicons and the action pill are
  all `clamp(floor, Nvh, cap)`. Only the pad carries a hard floor (44px, below
  which a key stops being tappable); nothing else needs one. Verified with no
  scroll at 956 / 844 / 806 / 750 / 620 and on the tablet at 1180, with keys
  from 50px to 74px and every key hit-tested rather than measured.
  - Two earlier attempts to do this with flex-grow failed for the same reason
    both times: grow only divides space that already EXISTS, and a content-sized
    sheet has none, so the rows sat at their floor and "elastic" was a fiction.
    A row height in vh is simply what the pad is, a fraction of the screen.
- **`maxFontSize` is read off the component instead of hardcoded.** It has to
  match `.amount-input`'s own font-size or the fit measures at one size and
  paints at another; deriving it lets CSS scale the value with the viewport and
  makes the two impossible to drift apart. The ticker is `0.5em`, which is the
  same 2:1 the component ships (8rem : 4rem) but as a ratio, so it tracks the
  value instead of stranding itself when the value scales.
- This sheet's own chrome is tighter than Send's and Receive's: header, body and
  sheet padding together were 86px of air on a screen that was 70px short.

### Known
- Below about a 600px viewport the body scrolls again. That is smaller than any
  phone this runs on (an iPhone SE 1st gen at 320x568 is 22px over).

## [0.24.0] - 2026-07-31
### Changed
- **Send step 2 is the wallet's Set Amount screen.** Reference:
  `wallet-app/logged-in/send-set-amount-mobile.png`, captured from the live
  testnet wallet this session because the branding-cli's own gaps list said the
  set had no amount screen at all. Step 1 was already the wallet's sheet; step 2
  dropped the kid back onto the bare scene, so the flow broke its own idiom
  halfway through and the figures had nothing behind them. It is a
  `small-page` + `page-header` + `page-body` + `page-footer` + `close-button`
  sheet now, like step 1. The kid's background is not lost: the sheet sits over
  it, which is exactly what the wallet does with the wallet.
- **The amount is the registry's `amount-input`** (`nq add`), not a 96px bare
  numeral: a boxed value with the ticker beside it and the fiat underneath. The
  pad drives it in place of the system keyboard, which is the kid version of the
  same screen.
  - The zero before any entry is the component's **placeholder**, not a value.
    `.nq-input` hardcodes `color: var(--nimiq-blue)`, so a real "0" renders navy
    and reads as an entered amount; `::placeholder` is the 50% grey the wallet
    actually shows. `has-value` carries the rest.
  - `maxFontSize` must match `.amount-input`'s own `font-size: 8rem`. At 11 the
    fit measured at 8rem and painted at 11, so the box came out ~27% narrow and
    "125" rendered clipped.
- **Both ends of the transfer are on screen.** Sender and recipient identicons
  either side of a hairline connector, the wallet's own arrangement. The screen
  used to show the recipient alone, so nothing said who the money was leaving.
- **The pad sits in the sheet's footer, with the action.** In the scrolling body
  its bottom row went under the fold at 390 and at 320: ".", "0" and delete were
  reachable only by scrolling a surface that does not look scrollable. Keys are
  the instrument, not content. What scrolls is the route, amount and balance.
- Grow's stake and unstake screens share this sheet and get the same treatment.

### Fixed
- **Disabled primary buttons painted a live blue gradient with grey text.**
  `.mega-btn:disabled` was declared ABOVE `.mega-btn.blue`, and both are 0,2,0,
  so the colour variant won and the disabled rule was dead everywhere in the
  app. The wallet greys the whole pill. App-wide, not just this screen.
- The amount screen's `.bg-dark` flip is gone with the bare layout: nothing on
  it changes appearance with the kid's chosen background any more.

## [0.23.1] - 2026-07-31
### Fixed
- **Grow and the amount pad put their titles on the scanner's white pill.** They
  were the last two words sitting bare on the kid's scene, navy type held up by
  a white text-shadow -- which is a way of admitting the contrast is not there
  rather than fixing it. The scanner already had the fix; it was scoped to
  `.k-scan` and is now the rule for all three.
- **One word, one look.** On a dark scene (Space) the old treatment flipped the
  title to white type over a dark shadow, so the same word had two appearances
  depending on the background a kid chose. The pill is opaque, so navy on white
  reads on every scene and the `.bg-dark` flip for the title is gone.
- `.k-page-title` is exactly the three screens with no card behind their title,
  so the rule lives there rather than on a scoped selector. The 56px of
  horizontal air the bare type carried at phone widths becomes the scanner's
  `5px 18px`: on a white capsule the old value reads as a slab.

### Known, not changed
- The amount pad's figures (`0 NIM`, the fiat line, "You have ...") still sit
  bare on the scene and still flip on `.bg-dark`. Same class of problem as the
  titles, but they are the content of that screen rather than its heading, so
  the answer is not a pill and it is a separate call.
- Grow's "Take some back" and its empty-state hint are untouched: Grow's
  behaviour and copy are Andjroo's.

## [0.23.0] - 2026-07-31
### Changed
- **Every dock glyph carries its word: Box, My week, Timer, Money.** The home
  dock was the last bare icon row in the app -- the money screen's own bar has
  labelled Receive and Send all along -- and no kid could name the four
  pictures, which is a complaint a nicer drawing does not answer.
- **The discs go.** Two of them (Box, and whichever was selected) had grown to
  54px purely to out-rank the others, which is rank expressed as size. The
  selected state is now blue glyph + blue word, the standard bar idiom.
- **The bar stays 74px and the tap targets get bigger.** The labels were
  budgeted at ~18px of Today's scroll and cost nothing: the 54px disc they
  replace fits a 23px glyph over an 11px word with room left, so a 46px circle
  becomes a 64 x 54 target and Today loses no scroll.
- **The labels are their own short keys** (`app.kidDock*`), not the aria names
  they replace. "Treasure box" and "My timer" title their screens; four of those
  side by side at 320 is a row of ellipses. Verified clean in all five locales
  at 320 and 390 -- no clipping, no overflow.
- **The aria-label goes with them.** An accessible name that differs from the
  label a kid reads out is the label-in-name failure, so the visible text is the
  accessible name now, the badge is `aria-hidden`, and the current destination
  carries `aria-current="page"`.

## [0.22.1] - 2026-07-31
### Fixed
- **The kid's name no longer fades out.** The component masks the LABEL's last
  3rem as well as the address's, and reserves `margin-right: 3rem` for it. That
  idiom is right for an address, which is long, machine-readable and safe to
  trail off; a name is neither. Fade off, the reserved gutter handed back, and
  an ellipsis as the fallback if a name is genuinely too long.
  - The override needed to out-specify the component's own
    `.account-header .active-address .label` (0,3,0). A 0,2,0 selector lost
    silently and the fade simply stayed on.
- **At 320 the name had no width at all** — it measured 0px, so it vanished
  entirely rather than merely fading. `--h1-size` and `--body-size` are fluid
  now, so the amount leaves the label room to exist. Measured: 38 / 55 / 290px
  of label at 320 / 390 / 768, mask none, nothing clipped.

## [0.22.0] - 2026-07-31
### Changed
- **The money screen's balance card is the wallet's `account-header`.** Built on
  the vendored component's own markup so its CSS applies natively instead of
  being re-approximated. Reference:
  `wallet-app/logged-in/nim-address-overview-mobile.png`, which the skill calls
  "the screen our wallet UIs mirror". Its shape: identicon, then label + NIM
  amount on one line, faded address + fiat under it.
- **NIM leads here, fiat is the second line.** The card had it the other way
  round, which is right for the wallet's HOME screen (TOTAL BALANCE in dollars)
  but not for the ACCOUNT screen this one mirrors.
- **Grow became the green staked banner** the reference puts under the header.
  It was a pill sitting exactly where the wallet puts the amount, so it had to
  move, and the banner can carry the staked figure and percentage instead of
  only being a door.
- `app.kidStakedLine` in all five locales.
- The component is scaled through its **own vars** (`--h1-size`, `--body-size`),
  per the skill's mobile-wallet rule. Setting font-size on `.label`/`.amount`/
  `.address`/`.fiat-amount` directly fights the component, and it crushed the
  kid's name to one letter: `.label` carries `flex-grow: 1` + `overflow: hidden`
  and a competing `justify-content`/`gap` left it nothing to grow into.

## [0.21.1] - 2026-07-31
### Fixed
- **Tap-to-copy was a box inside a box, and the digits never turned blue.** The
  `copyable` class belongs ON the address-display, not around it: the registry
  composes them as one element (`.address-display.copyable` is a real rule in
  the bundle, because `copyable` is a PROP of AddressDisplay upstream, not a
  wrapper). Wrapping gave the address a second surface, and left the digits grey
  because `.address-display` declares its own `color` and so never inherited the
  light blue the copyable was setting on the parent. On one element it applies
  directly, which is what makes the panel and the numbers turn blue together,
  the way the wallet does it. Measured: digits `rgb(5,130,202)`, one box, not two.
- Dropping the wrapper also removes the definite-width workaround it needed, and
  the tooltip's border-radius now inherits the panel's instead of its own 4px.

## [0.21.0] - 2026-07-31
### Added
- **Tap the address on Receive to copy it**, from the registry's `copyable`
  (`nq add`). The element tints light-blue and floats a "Copied" tooltip for
  800ms, which is the wallet's own feedback for this: the confirmation appears
  on the thing you tapped, not as a bottom toast. Keyboard-operable (Enter or
  Space) and labelled for screen readers.
- `app.kidCopyAddress` and `app.kidCopied` in all five locales.

### Fixed
- The copied string comes from the address the screen already holds, not from
  `innerText` as the component's demo script does. The grid's chunks carry
  zero-width `.space` spans and render across three lines, so scraping the DOM
  copies line breaks into the middle of an address. Verified: the clipboard gets
  36 unbroken characters matching what is on screen.
- "Copied" only appears if the clipboard write actually resolved. A wallet
  webview can refuse it outright, and claiming success there is worse than
  staying quiet.
- `copyable` centres its tooltip with a hard-coded `margin-left: -3.75rem`, half
  the width of the English word. Replaced with `translateX(-50%)` so Kopiert,
  Copiado and Copié centre too.
- **Wrapping the grid un-spaced the address.** `.address-display` is
  `width: 100%`, and inside a shrink-to-fit wrapper that resolves to min-content,
  which packs the 33% columns together and swallows the gaps between blocks. The
  wrapper carries a definite width now, tracking `.k-address`'s own max-width per
  breakpoint. Measured back at 226px/24px on phones and 420px/30px on tablet.

## [0.20.3] - 2026-07-31
### Fixed
- **The sheet header's X was not on the title's line**, sitting 10.4px above it
  on all three sheets. The registry pins `.close-button.top-right` at a fixed
  `top: 2rem`, which measures from the header box rather than from the title, so
  it drifts with any title size and with Receive's subtitle underneath. Back,
  title and X now share one grid row (`1fr auto 1fr`), centred against each
  other. Explicit `grid-column` means the NIM Address sheet can omit the back
  arrow without the title sliding into the empty slot. Measured: X and back both
  0.0px from the title, title 0.0px off-centre, on all three.

## [0.20.2] - 2026-07-31
### Fixed
- **The scanner's title sits on solid white.** "Scan a code" was bare navy type
  on the kid's sky, held up by a white `text-shadow` -- which admits the
  contrast is not there rather than supplying it. It takes the same white pill
  the hint under the stage already had, so both words on the screen are on a
  real surface. Scoped to `.k-scan`; Grow and the amount pad still float their
  titles the old way and are a separate call.

## [0.20.1] - 2026-07-31
### Added
- **The QR is its own "NIM Address" sheet**, opened by Receive's corner glyph,
  not an in-place swap. Captured the real screen from the live testnet wallet
  first (`shots/wallet-ref/receive-qr-view.png`), because the skill's reference
  set has no shot of it. The differences it settled: its own title and an X but
  no back arrow (it is a peek, not a step); a NAVY QR, not the registry's
  default light-blue radial; the address as ONE truncated line with a ••• middle
  rather than the 3x3 grid; and a light-blue instruction as the only colour on
  the sheet.
- `app.kidNimAddress` and `app.kidScanToSend` in all five locales.

### Fixed
- **The Receive subtitle was not centred**, by 3px at 390 and 23px at 430. The
  phone rules cap it at 300px and a block narrower than its container sits LEFT
  unless its margins are auto: the text was centred inside a box that was not.
  `margin-inline: auto`. Measured 0px off at 320, 390 and 430.
- **The scanner stage was translucent.** At `rgba(31,35,72,0.9)` the kid's candy
  artwork read straight through the camera area, so there was nothing solid to
  aim at. Opaque now, and the aiming marks are the wallet's four corner brackets
  instead of a large faint QR glyph.

### Changed
- The scanner **keeps the kid's scene** (Andjroo's call). The wallet's version is
  a full-screen dark room, and matching it lost the background the kid picked,
  which they own on every other screen. Only the stage went opaque.
- `app.cancel` removed again with the full-screen Cancel pill it was added for.

## [0.20.0] - 2026-07-31
### Added
- **Send has the wallet's ENTER ADDRESS grid.** `nq add address-input`, with the
  grey uppercase label over it, under the family row. The registry ships that
  component as a static visual, so the live formatting is written here: three
  lines of three four-character blocks, uppercase, a `nimiq:` prefix tolerated,
  and the caret restored to the end because rewriting `.value` collapses it to 0
  and typing then runs backwards. A complete address goes straight on to the
  amount step, which is what the wallet does.
- **Receive's QR is behind the corner glyph**, as in the wallet. The address is
  what the screen shows; the glyph swaps address for QR and back. The QR is no
  longer on screen by default.
- `app.kidEnterAddress`, `app.kidBadAddress`, `app.kidShowQr` in all five
  locales and the `util.js` fallback table.

### Fixed
- **The Receive toggle showed the address AND the QR at once.** `hidden` is a UA
  style, so any author `display` beats it, and `.address-display` sets
  `display: grid` while `.qr-code` sets `display: block`. Both stayed painted
  while their `.hidden` property read `true`. Explicit `[hidden]` rules now, and
  the harness asserts **computed display** rather than the property, which is
  what let the bug pass in the first place.
- **A typed `nimiq:` prefix was never stripped.** Typing fires input per
  character, so by the time the `:` arrives the field already reads `NIMIQ` and
  a `^nimiq:` test cannot match; it only ever worked on a whole-string paste.
  Stripped after punctuation instead. A NIM address is `NQ` + 34, so a buffer
  opening `NIMIQ` is unambiguously the prefix.

### Changed
- A typed address takes the SAME road as a scanned one: `api.sendScanned`, into
  the parent approval queue. Outside the family is never a straight-to-send
  path, however the address arrived. The server comment claiming the app has no
  address input, and the parent alert saying the kid "scanned a code", are both
  corrected: the alert no longer asserts how the address got there.

## [0.19.9] - 2026-07-31
### Changed
- **Send is titled "Send money"**, not "Who gets it?". The recipients answer
  that question themselves; the title should say what the screen is for.
- **The paper plane is off the "Send to a friend" button.**
- **The scan glyph is bare and pinned to the corner**, where the wallet keeps
  it. The white disc it wore existed for when the glyph sat on the kid's scene;
  on a white sheet there is nothing for it to lift away from.
- **Receive says "Share your address with a friend"** and the grown-up line is
  gone, along with the "Share my address" button and its share/clipboard code.
  The QR moved into the footer and is 140px, down from 260.
- **The address grid uses the registry's OWN spec** rather than a re-guess of
  it: `address-display` is 3rem type in a 28.25rem box, and this app runs the
  8px root, so that is literally 24px in a 226px box. It had been overridden to
  `clamp(15px, 4.6vw, 19px)` in a 300px box, which is what made the characters
  look small and the blocks look sprayed apart. Measured 24px Fira Mono / 226px
  at 320, 390 and 430.

### Fixed
- **The scan button's tap target.** Dropping the disc dropped `width`/`height`
  with it, and a `<button>` shrinks to its glyph, so the target fell to 24px.
  The circle came from the background and shadow, never the size: the box is
  44px on phones and 56px on tablets again, still with no visible chrome.
  Probed by hit-testing, not by bounding box, because the close button's target
  comes from a `::before` and measures 24px while being clickable at 46px.

### Removed
- `app.kidSendTo`, `app.kidAskGrownUp`, `app.kidShareAddress` and
  `app.kidAddressCopied`, in all five locales and the offline fallback table in
  `util.js`. Added `app.kidSendMoney` and `app.kidShareWithFriend`.

## [0.19.8] - 2026-07-30
### Changed
- **Send and Receive are built from the registry components the wallet's own
  sheets are made of**, added with `nq add`: `small-page`, `page-header`,
  `page-body`, `page-footer`, `close-button`. The previous pass moved the title
  onto a white panel and stopped there, which fixed how the screens LOOKED and
  left the flow untouched. What the references actually establish:
  - it is a **modal sheet over the dimmed page, anchored to the bottom**, not a
    card floating in the middle of the page behind it. Scrim is navy at 0.6
    (rule 11), never black.
  - the header carries a **back arrow left and a close X right**. Back steps up
    the flow, X abandons it. These screens only ever had back, so a kid two
    steps in could only retrace.
  - the secondary action sits in the **footer under a quiet prompt**, the slot
    the wallet fills with "Address unavailable?" over "Create a Cashlink".
- The registry rem values are used as-is: the app loads legacy nimiq-style, so
  `html` is already 8px and `52.5rem` really is 420px. Only the desktop
  SmallPage geometry is overridden, into the wallet's mobile sheet: full width,
  content height, square bottom corners.
- The close X uses the **registry's own icon**, not the app's `closeIcon`. That
  one is a bare 2px stroke and renders as a heavy black cross in a slot whose
  CSS expects a filled glyph at 20% opacity.

### Added
- `app.back` and `app.kidNoOneHere` in all five locales.

## [0.19.7] - 2026-07-30
### Changed
- **Send and Receive put their title on the sheet, not on the scene.** Both
  screens floated a 44px navy `<h1>` on the kid's candy background with a white
  `text-shadow` propping it up, which is why "Receive" was close to invisible.
  In both wallet references the title sits on the white sheet with the content,
  so a shared `.k-sheet` now carries the surface, the padding and the title for
  both screens. Receive also gains the wallet's grey subtitle line.
- **The Box glyph is a chest with a keyhole.** The previous chest carried lid
  bands plus a lock plate and turned to mush at 20px. A keyhole is one big
  feature instead of three small ones, which is what survives at that size.

### Added
- **"Share my address" on Receive, so the instruction is backed by an action.**
  "Show this to a grown-up so they can send you NIM" was a sentence with nothing
  behind it. It is now the sheet's subtitle, in the slot the wallet uses for
  "Share your address with the sender.", with a real button under it in the slot
  the wallet uses for "Create request link". Three tiers, because this runs
  inside a wallet webview as often as a browser: the share sheet, then the
  clipboard, and if neither exists the QR and the address grid are still on
  screen. A cancelled share sheet is not reported as a failure.
- `app.kidShareAddress` and `app.kidAddressCopied` in all five locales.

## [0.19.6] - 2026-07-30
### Fixed
- **The hourglass was cut off.** `install-icons.ts` carried `SCALE.timer = 1.12`
  as "optical sizing", but the scale draws the art at `n*SCALE` onto an `n`-wide
  canvas, so anything above 1 CROPS instead of enlarging. It sliced 7.7px off
  every edge, taking the hourglass's end plates with it. All scales are 1 and
  the script now throws on anything above. To make a glyph read bigger, raise
  the dock's font-size.

### Changed
- **The glyphs are bolder.** The sheet was regenerated asking for a stroke about
  a tenth of each icon's height. The chest came back front-on too, matching the
  other three instead of sitting in three-quarter perspective.
- **They fill their buttons now.** 20px of glyph in a 46px button is 43%, so
  each icon sat in a moat of its own background. Now 26/46 and 30/54, a 57%
  share, held at 320/390/430/768. Button sizes and tap targets are unchanged.

## [0.19.5] - 2026-07-30
### Changed
- **All four dock glyphs are new, and they come from ONE generated sheet.** The
  row was a treasure chest, a 2x2 grid, an egg and a duotone coin cluster: three
  hand-drawn outlines plus one filled two-tone icon, four drawing hands, two
  visual languages, and nothing a kid could name. They are now a treasure chest,
  a calendar, an hourglass and a `$` coin, generated together so they share a
  stroke weight and a hand. Andjroo picked the four.
- **The glyphs are raster, drawn as CSS masks.** `maskIcon()` emits a span whose
  shape is the PNG's alpha and whose colour is `background: currentColor`, so
  the art still tints: navy at rest, white on the active button, green on money.
  Painting the PNG directly would freeze the colour and break both. 128px each,
  ~6KB, and the dock never draws above 24px, so a 3x screen asks for 72.
- Precached in `sw.js`. These are the app's only glyphs that are files rather
  than inline SVG, so an offline tablet that never fetched them has no dock.

### Removed
- `chartGridIcon` (the 2x2 grid) and the `duotone-fiat-currencies` vendoring.
  `chestIcon` stays: the Box SCREEN still draws it large with an animated lid,
  and `.bx-lid` is positioned against that artwork. `eggOutlineIcon` stays as
  the studio's "What's inside" glyph, with the locked shape from 0.19.4.

## [0.19.4] - 2026-07-30
### Changed
- **The dock's Timer button is the egg**, which is what this app's timer actually
  is, instead of `duotone-speedmeter` (a real Nimiq icon, but a gauge, and no one
  could tell what it was). It uses the OUTLINE egg, not the filled one, which
  reads as a dark blob at 20px.
- **The egg shape is now the locked art's shape.** Both egg glyphs were drawn by
  hand and were essentially ovals: the belly sat at 50% like a circle's. The real
  shell art puts it at 55.5% with an apex 0.07 of the belly's width, which is the
  whole difference between reading as an egg and reading as a blob. The path is
  traced from the art's own alpha edge by `trace-egg.ts`, which renders the curve
  back over the source to prove it hugs it. One `EGG_SILHOUETTE` now feeds both
  the filled and outline glyphs, so the app has a single egg shape.
- **The dock's Money button uses `duotone-fiat-currencies`** and the hand-drawn
  `coinsIcon` is gone. Nimiq's set covers money, so drawing our own was a rule-15
  violation for no gain. The chest and the sticker chart stay app-own because the
  set has no treasure box and no sticker chart: fabricate only what it cannot say.
- The egg's stroke is 10.5 against the chest's 1.6, which are the SAME on screen.
  `.k-icon` is a 1em square, so a portrait viewBox fits by height and a landscape
  one by width; equal stroke numbers would not have been equal weights.

### Fixed
- **`duotone-fiat-currencies` was vendored with its ids repaired.** 20 of the 48
  branding-cli duotone icons collapse every internal id (clipPath, mask, every
  gradient) onto one string, so `url(#x)` resolves to whichever element comes
  first. This one has two masks and the second region was being masked by the
  first mask; `duotone-credit-card` is worse and paints nothing at all. The
  repair re-binds each reference to the nearest preceding definition of the type
  that reference requires. Tool: `~/data/nimiq-kids-uxdev/fix-duotone-ids.ts`.
  The four already-shipped icons with this defect (`safe-lock`, `paper-plane`,
  `high-five`, `key-puzzle`) render identically repaired, so they were left alone.
  Worth reporting upstream to nimiq-branding-cli.

## [0.19.3] - 2026-07-30
### Changed
- **The Today headers are solid white, matching the cards they open.** Morning,
  Afternoon, Evening, Any time and Practice were `rgba(255,255,255,0.92)` while
  every task card under them was `#fff`, so a header read as a tint of the scene
  and the group it belongs to read as two materials. Only `.ch-group-hd` moved;
  the same 0.92 on the back button, the corner control and the scan disc stays,
  because each of those sits on the scene alone with nothing solid beside it.

## [0.19.2] - 2026-07-30
### Fixed
- **The bottom bar now matches the real wallet's**, from Andjroo's own screenshot
  of it. Three things were wrong: the arrow was stacked ABOVE its label instead
  of beside it, Send was taller than Receive (the wallet distinguishes Send by
  its blue fill, not by size), and both pills were narrow and tall instead of
  wide and short sharing the bar. Same height, row layout, `flex: 1` widths.
- At 320px "Receive" clipped. The gutters give the label its room back rather
  than the type shrinking below the 12px floor.

## [0.19.1] - 2026-07-30
### Changed
- **Send is the wallet's Send Transaction sheet now.** Recipients were a grid of
  big white cards, one per person, which made two family members read as two
  separate decisions. They are a ROW of identicon hexagons with a name under
  each, grouped on one panel, the way the reference shows recents. "Send to a
  friend" moves to the sheet's bottom secondary slot where the wallet puts
  "Create a Cashlink" -- which is literally what it mints -- instead of sitting
  among the people. The scan glyph sits bottom-right, where the wallet has it.
- The scan control on Send takes the white disc the back button already uses.
  Bare at 40% opacity it worked on the money screen's white dock and vanished
  here, where it sits on the kid's scene.

## [0.19.0] - 2026-07-30
### Added
- **Scan a code.** The bottom bar is now Receive | Send | scan, which is the real
  wallet's bar exactly: the scan is a bare glyph outside the two pills, not a
  third pill. The glyph is the wallet's own ScanQrCodeIcon, copied verbatim.
- A scanned code resolves to one of two things, and the difference is the point:
  - **a Cashlink is money IN** and is claimed on the spot, because a link pays
    out to whoever holds it and scanning is what proves you hold it.
  - **an address is money OUT** and goes to the amount pad, then into the SAME
    parent approval queue a Cashlink send already used. A scanned code is never a
    straight-to-send path -- that is why this app has no address input at all.
- `send_requests` carries a `to_address`, so one approval queue covers both
  shapes: with an address it settles as a transfer, without one it mints a link.
- Decoding prefers the platform's `BarcodeDetector` and only pulls the vendored
  jsQR (Apache-2.0, 128KB) down when there isn't one, so most devices download
  nothing extra.

### Security
- A malformed code is refused at the camera AND again at the route, so a parent is
  never asked to approve a send to a destination that is not a real NIM address.

## [0.18.1] - 2026-07-30
### Removed
- **The "N NIM is growing" strip.** The balance card carried both it and the Grow
  pill, and they opened the same screen. The real wallet has a single Stake pill
  in the top row and keeps the staked figure on the staking screen, where this
  app already shows it as the hero (Andjroo, 2026-07-30).

## [0.18.0] - 2026-07-30
### Changed
- **The language selector stays on the home screen.** It is `position: fixed` and
  was mounted once, so it rode along into every sub-screen -- app chrome sitting
  on a kid's money screen. It now shows on home and on login (where a kid picks a
  language before anything else) and nowhere else, which is what the real wallet
  does too: its account screen carries back, search and stake, and no settings.
  Sub-screens keep the kid's own identity; what they lose is the app's chrome.
- **Sam and the language pill are bigger on the home screen.** The kid's identity
  had been rendering smaller than the language control beside it. `--kid-corner-h`
  46px (was 38) drives both, since `.ch-kid` is already height-matched to it, and
  the identicon and name scale with it (30 -> 38, 17px -> 21px).

### Fixed
- The home screen had its own horizontal padding (14px phone, 32px tablet) rather
  than `--kid-chrome-gutter`, so Sam sat 2px inside the corner control at phone
  widths and 8px outside it at tablet. It measures from the shared gutter now.
- At tablet the home screen reserved the whole `--kid-corner-band` at the top,
  which dropped Sam a full corner-height BELOW the language pill instead of
  beside it, contradicting the comment directly above the rule. Verified on one
  line at 320/390/430/768, with no corner/content overlap at any of them.

## [0.17.2] - 2026-07-30
### Fixed
- **The top chrome is on one grid.** The back button, the corner control and the
  cards were each positioned independently and had drifted to three different
  gutters (12 / 8 / 16 at 390px) with the two controls 11px off the same
  centerline. There is now one `--kid-chrome-gutter` that all three measure from,
  and one `--kid-chrome-center` that both controls sit on, derived from the
  corner control's own box so the shell component stays the fixed point. Verified
  at 320/390/430/768/800: gutters match the card on both sides, centers agree.
- The back button sizes off `--back-size` (44 phone, 56 tablet) instead of a
  hardcoded 72/48, so it is proportionate to the 38px corner pill it sits beside.
  Both stay above the 36px tap-target floor.

## [0.17.1] - 2026-07-30
### Changed
- **The coin price sits at the foot of the balance card, behind a hairline.** It
  had been reading as a fourth line of the balance, which it is not: in the real
  wallet the price is never in the account header at all, it is its own sidebar
  block (`price-chart`, whose default price is a NIM price). Above the rule is
  the kid's money, balance then what is growing; below it is a fact about the
  market. The rule is 1px rgba(31,35,72,.08), the same value the corner
  control's divider uses.

## [0.17.0] - 2026-07-30
### Added
- **Amounts follow a chosen currency.** The corner dropdown that holds the
  language picker now holds "Show amounts in" too, offering the same 14 tickers
  `/api/rates` already returned, so nimiq.kids matches the rest of the fleet
  instead of being hardcoded to dollars. The balance, every feed row and the
  "1 NIM is worth" line all re-render on the switch.
- Formatting is the shell's own `fmtFiat`, not a local dollar formatter. Symbol,
  symbol side and decimal separator move with both the currency and the
  language, and the zero-decimal currencies (JPY, KRW, VND) render as whole
  units, which a `toFixed(2)` would have got wrong.

### Changed
- The "1 NIM is worth" figure now follows the wallet's own FiatAmount rule
  (widen the decimals until the rounded figure is within 10% of the true one),
  so it reads `$0.0005` where it used to read `$0.00046`. Same intent as before,
  never a rounded-away `$0.00`, but the fleet's rule rather than a local one.

### Requires
- `nimiq-app-shell` **v0.6.0** (the pin moved). The currency grid used to be
  gated on a connected wallet, which put it out of reach on this app's
  wallet-less corner. Until that tag is pushed, this branch will not install.

## [0.16.0] - 2026-07-30
### Changed
- **The money screen is a wallet again.** Every feed row carries a real identicon.
  Chore payouts had been drawing a gold hexagon because the ledger writes them
  without a counterparty address, so 46 of 46 rows showed the same gold tile; the
  sender is now filled in at the source (`eventView`) from the family wallet, which
  fixes the parent app's feed too.
- **The balance is readable on any scene.** The kid's name, balance and address used
  to sit bare on the chosen background, unreadable on a bright one. They ride the
  same opaque card the feed already uses.
- **Fiat leads.** The dollar value is the headline number and the NIM amount is the
  secondary line, matching the real wallet's home screen. Dollars are the unit a kid
  can act on.
- **The bottom bar is Send and Receive**, like the real wallet. Grow left the dock.

- **Grow is the green pill on the name row**, which is where the real wallet puts
  Stake. The scene background stays: the cards carry legibility, so the money
  screen still belongs to the same app as every other screen (Andjroo, 2026-07-30).
- **The address is off the money screen.** Receive already shows it as the 3x3
  Fira Mono grid with a QR, which is the only place a kid needs it.

### Removed
- **The staking projection line.** "Keep {amount} NIM growing for a year and it
  becomes about {future} NIM" was a forward yield promise made to a child off a
  hardcoded 12% APY. The hero already reports rewards actually earned. Any
  replacement wording is Andjroo's to write.

## [0.15.0] - 2026-07-28
### Changed
- **The job card says two things: the job, and what it pays.** The egg timer is
  gone from it — it repeated what the timer screen says a second later, and
  beside a big title and a coin figure it was a third element competing on one
  line (Andjroo, 2026-07-30). The duration still drives the timer when the task
  starts; it just is not printed on the card. The reward drops its filled green
  capsule for the same green as plain text, one clear step below the title.
- **A kid names their own amount.** The add sheet offered five preset chips; it
  takes any whole number of coins now, with what it is WORTH shown underneath as
  they type, because "1750 NIM" means nothing to a seven-year-old on its own.
  Empty is still a perfectly good answer and still reads "Just to do".

### Fixed
- **Job cards are full width again.** Wrapping each card so the remove X could
  sit on top of it made `.ch-task` — a `<button>` — shrink to fit its own title,
  because it had been relying on `align-items: stretch` from the `.ch-tasks`
  flex column it was previously a direct child of. Cards came out anywhere from
  198px to 322px in a 362px column, so the list read ragged and "Brush your
  teeth" was visibly the longest (Andjroo, 2026-07-30). Verified at
  320/390/430/768 that every card is now exactly the width of its group header.

### Added
- **A fourth pack in the Treasure Box: Animals** (cat, dog, bunny, bear, fox),
  3 000 NIM, in the same generated house style.
- **Drawn icons on every job card.** The bed, the shirt, the toothbrush: 16
  generated icons in the sticker style but as objects on white, since they sit on
  a white card rather than in a coloured disc. The icon is resolved FROM the
  task's existing emoji server-side, so every routine and chore that already
  existed upgraded with no migration, and an emoji nobody has drawn still renders
  as itself.
- **A kid can add jobs to their own board, and take them off** (Andjroo).
  - "Add a job" opens a picker of the 16 icons, a name, and what it is worth.
    Amounts are kid-sized taps rather than a number pad, and "Just to do" (no
    reward) is a first-class choice — the point is agency, not earning. Either
    side can name an amount; **nothing is ever paid without a parent approving**,
    so an ambitious ask is a conversation rather than an exploit.
  - **Removal is SOFT.** A hard delete would erase the fact a job ever existed;
    a parent has to be able to see that a kid took their laundry off the list.
    The row stays, marked with when and by whom, and `GET /chores/removed` is the
    parent's view of it. `POST /chores/:id/restore` puts it back (parent only).
  - `kids_can_remove` on the family is the parent's switch. A job already handed
    in is the parent's to remove either way, so a kid can never quietly erase
    something mid-approval.

### Changed
- **Custom sticker art, generated in one house style.** All 25 come from one
  locked Higgsfield prompt (chunky rounded shapes, bold navy outline, soft cel
  shading, flat pastel ground), so they are visibly siblings, then are
  auto-cropped to each subject's bounding box — the model frames loosely, landing
  subjects anywhere from 51% to 79% of the canvas, and a loose frame becomes a
  tiny drawing once the app cuts it into a 24px circle.
  - This is the third set. The first was hand-authored SVG (the unicorn was a
    triangle horn, two triangle ears and three circles for a mane, and it looked
    it). The second was emoji, which fixed "badly drawn" but landed on "too
    basic, just your average emojis" (Andjroo). `emoji` survives on each sticker
    as an accessible label and a last-resort fallback; the PNG is the art.
  - Re-precached for offline, and a test asserts every catalog sticker's PNG
    actually exists on disk — a missing file would render a broken image on the
    kid's chart while the database row looked perfectly valid.
- **A placed sticker sits in the middle of its slot** (Andjroo: "they aren't
  centered"). It was positioned at the kid's own drop point, which was right when
  a sticker was a small thing on a big chart cell — but those cells are gone, and
  every surface a sticker lands on now is barely bigger than the sticker (46px of
  art in a 56px slot). Placements were being stored at x=22%, which put the
  sticker's centre 12px into a 56px slot and hung it outside its own circle. The
  drop point is still captured; the TILT is what carries the handmade feel at
  these sizes, and the tilt is kept.
- **One sticker catalog** (`src/sticker-catalog.ts`) — packs, their contents and
  their prices in a single file that `db.ts` UPSERTS at boot. It replaces three
  `INSERT OR IGNORE` blocks in schema.sql that, being ignore-on-conflict, would
  have left every existing database on the old art forever.
  - The packs a kid sees are unchanged in shape and now actually organised: a
    free **Starter** pack of 10, auto-granted, then **Space**, **Ocean** and
    **Party** for sale in the Treasure Box.
  - The Treasure Box was showing each pack as a fan of lettered fallback dots
    ("M", "S", "G") because the store's projection dropped the art.
- **The Treasure Box costs something again.** Every price in it was set when a
  chore paid 0.1 NIM, so screen time cost 1 NIM — a twentieth of a cent. A kid
  clearing one morning routine could have bought the entire shop twice over.
  Whole-NIM prices on a deliberate ladder: screen time 800-2 500, packs
  2 000-3 000, coupons 4 000, a timer rig 6 000-8 000 (it is yours for good).
- **Calendar spacing** (Andjroo, on review). The day cell had literally zero
  slack: 4 + 12 + 2 + 22 + 4 came to exactly its 44px height, so every sticker
  sat hard against the number above it, and a 4px column gap let the tinted
  cells very nearly touch, which read as a checkerboard rather than a calendar.
  Cells are 53px on an 8px grid gap now, with the number at 13px.
  - **The sticker was overflowing its own box.** A rotated square's bounding box
    grows by (cos + sin), so the kid's full +/-20 degree tilt made a 22px
    sticker measure 25.5px and lean into the day beside it. The lean is capped
    at 7 degrees on a calendar day: the handmade feel survives, the collision
    does not.
  - **The gold "shined" ring is sized for the sticker now.** At full size a 2px
    ring plus an 8px gold glow reads as a highlight; at 24px the same treatment
    was a fat gold donut with a small drawing lost in the hole. One crisp 1.5px
    ring, no glow, and the white cut line drops from 2px to 1.5px so the art
    inside is not squeezed to nothing.
- **Rewards are whole coins, priced in dollars** (Andjroo, 2026-07-30). A job is
  worth what it is worth to a parent — "this chore is $2" — and a kid should read
  **4 324 NIM**, never "0.1 NIM" and never a fraction of a coin.
  - `rewardUsd` on chore, routine-task and practice creation converts at the live
    rate and stores a **whole** number of NIM, fixed at creation. The coin figure
    is then what was agreed; its dollar value floats afterwards, which is simply
    what owning a coin means. `rewardLuna` still works for exact amounts.
  - **The payout ceiling is denominated in dollars too** (`HATCH_MAX_EARN_USD`,
    default $10). It had been a fixed 10 NIM — worth **less than half a cent** —
    which silently made every real reward unpayable: a $2 chore was 432x over the
    cap and 400d on approval. A fixed NIM ceiling cannot hold its meaning when
    rewards are dollar-denominated. `HATCH_MAX_EARN_LUNA` still overrides for
    anyone who wants the old fixed behaviour, and the guard still guards: at
    today's rate $2 pays and $25 is refused.
  - **The kid can see what their money is worth**, on the money screen: the
    balance's dollar value, and the coin's own price. NIM trades far under a
    cent, so the price carries the precision it actually needs — a kid told
    their money is worth "$0.00" has been told something false.
  - Price fetching, caching and conversion moved to `src/rates.ts` so the wallet
    service can price its own ceiling without importing a route.

### Added
- **The middle of the day works.** `afternoon` has been a group on the kid's
  Today screen since the walkthrough, but `POST /routines` only ever accepted
  `morning | evening | custom` — so the group was unreachable: no parent could
  create a routine that landed in it, and `custom` fell through to Any time. The
  slot list is now one exported constant (`ROUTINE_SLOTS`) that the route
  validates against, so the screen and the API cannot drift apart again.
- **Practices: the things a kid keeps up**, as opposed to the things a kid does
  today. Piano, a workout, reading. Per kid, so the same practice can carry a
  different target for each child.
  - A practice has **no time of day** — morning/afternoon/evening all answer
    "when today", and a practice answers "how often this week". It carries a
    **weekly target in days**, and the card says where the week stands
    ("3 of 4 this week") rather than telling a kid to do something now.
  - **The streak is counted in WEEKS, not days.** A day-streak would punish
    exactly the rest days a weekly target exists to allow. A week in progress
    never breaks the streak — it only extends it once the target is met — so a
    kid looking at a fresh Monday sees the streak they earned, not a zero.
  - **A practice can only ever add to a day, never subtract.** Its calendar row
    is sparse: a cell exists only for a day it actually happened, because a rest
    day owes nothing. The Practice group header stays quiet for the same reason
    — a bare "0/2" would read as two jobs missed on a day the kid did both — and
    shows a tick only when every practice has hit its target.
  - Sessions are **unique per day**: twice on a Sunday is still one day toward
    the week. Each session carries **its own sticker**, so the days of a streak
    are not forced to wear the same one, and they light up the month calendar.
  - `practices` + `practice_sessions` tables, `repo-practices`,
    `GET/POST/PUT /api/practices`, `POST /api/practices/:id/session`,
    `POST /api/practice-sessions/:id/sticker`, and a `practices` block on the
    chart feed.
  - **Payment is deliberately not wired.** Everywhere else in this app money
    moves only after a parent approves, so a kid tapping a button can never
    mint. A practice is self-reported by design, so paying on the tap would be
    the app's one self-serve money path. `reward_luna` exists on the table and
    defaults to 0; whether a self-reported practice should pay, and through
    which approval, is still open.
- Day math (`addDays`/`mondayOf`/`weekDays`/`monthDays`) moved to `src/days.ts`
  so the repos can count days without importing a route.
- **The kid home has a real calendar** (Andjroo's walkthrough spec, section B).
  Month name, then the week as its own row of day letters, then the dates. Each
  date carries the sticker the kid actually placed that day, so a day says it
  got done in the kid's own currency instead of a 11px check.
  - **Tapping the dates opens the whole month**, and it opens the only way that
    is allowed to: DOWNWARD. Splitting the day letters into their own row is
    what makes that possible — they are the column header, so they stay pinned
    while the dates below them grow from one week into a 7xN grid. The month
    name, the day letters and the top of the dates are unmoved to the pixel;
    Today is pushed down and absorbs the change by scrolling inside itself.
    Verified mechanically at 320 / 390 / 430 / 768 across repeated open-close
    cycles and both entry points (the dates and the dock's week button).
  - Fixed the actual cause of the old behaviour: `justify-content: space-between`
    on the screen redistributed its slack, so unfolding the week dragged the
    header and the strip **97px up** the screen. The screen now packs from the
    top on one gap, and `min-height: 0` lets it stay inside the phone instead of
    growing a card under the dock.
  - New `GET /api/kids/:id/month?month=YYYY-MM` feed. The week payload stays
    week-scoped: it is on a 10-second poll and drives the home screen, while the
    month is only on screen once a kid opens it, so the month is fetched lazily
    and cached. Both feeds are built by one `chartRows()`, so a day can never
    read done in the week and open in the month. The live week overlays the
    cached month, so a sticker placed a moment ago shows without a refetch.
  - The kid calendar lives in its own `public/kid/js/calendar.js`; the dead
    `.chg*` week-grid CSS it replaces is gone.
  - **Air around the calendar** (Andjroo, on review): one 20px gap between every
    block on the screen instead of 12, so the card is clear of Sam and the
    language pill above it and of Today below it, plus a taller card interior.
- **The scrolling lists no longer fade out at the bottom** (Andjroo, on review).
  Both Today lists carried a 20px mask so a cut card read as "more below"; he
  does not want the last card fading. They end on a scroll-padding instead, so
  the last card can always be scrolled fully clear of the fold.

### Changed
- **Phone-review round 2** (Andjroo, against the Little Timer reference):
  - **The scene is no longer washed at all.** Even the lightened gradient still
    muted it; the reference paints its background at full strength and simply
    sets opaque controls on top. The veil is gone and the bare labels ("My
    week", "Today", the kid's name, page titles) carry a text shadow instead.
  - **My timer is round glyph buttons, not a stacked list** — What's inside /
    Sounds / Background, side by side, the way the reference presents them.
  - **Timer style is gone from the sheet.** The egg is the only style, so a
    picker with one option was a choice that isn't one. The picker itself stays
    for the Treasure Box's buy-a-timer handoff.
  - **"What hatches" is now "What's inside"**, with an outlined cracked egg
    instead of the solid glyph that read as a dark blob at option size.
  - **The Treasure Box back button no longer sits on the chest glyph** — the
    header now leaves it a lane (it only had one on tablet).
  - **The timer options are symbols only.** No words under the discs — the name
    appears as the TITLE of the sheet each one opens, the way the reference
    does it. The buttons keep an aria-label so the name is still available to
    anyone who can't see the glyph.
  - **Every studio sheet is headed like the reference**: close on the left, the
    sheet's name centred, and a quiet line under it saying what the sheet is
    for ("Pick a surprise, or hatch your own photo.") — replacing the giant
    wordless glyph that used to stand in for a title. Localized x5.
- **The kid app joins the fleet corner control** (shell v0.5.0). Its language
  control was still the old bordered pill while every other surface had moved
  on, and it sat flush on the balance chip — corner bottom and chip top were
  both at y=46 on a 390px phone, touching exactly. The corner now publishes the
  band it occupies (`--kid-corner-band`) and the screens reserve it, so the two
  cannot collide at any width. Wallet-less pages pass no wallet and get the
  corner's language-only face rather than a Connect button they can't honour.
- **The kid dock is four destinations, not seven.** Treasure Box, My Week,
  Timer, Money. The four customization sheets that used to sit in the dock
  (hatch / timer style / sounds / background) are all ways to dress up the
  timer, so they moved behind one **My timer** surface. Nothing became
  unreachable; saved preferences are untouched.
### Fixed
- **The chosen background is visible again.** A flat 60% white wash (80% on
  space) had been erasing the scene a kid picked — the whole point of picking
  one. It's now a gradient weighted to the top, where the un-carded labels sit,
  and thin below where the opaque cards already provide their own contrast.
  Dark scenes are tinted with their own navy instead of greyed out, with light
  labels to match; that treatment keys off the scene id (`bg-dark`), so it
  applies to the real catalog artwork and not just the built-in gradient —
  `bg-space` alone never matched the art, which is why space stayed washed.
## [0.24.0] - 2026-07-31
### Added
- **A "Research phase" status chip** on the learning-integration card, replacing
  the "early thinking, nothing settled" sentence. Geometry is Nimiq's own
  "Coming Soon" chip measured off nimiq.com/nimiq-pay: monochrome, 4px radius,
  hairline ring, 700 weight uppercase at 1.4px tracking. Ink is navy rather than
  their neutral-800, which measures 3.28:1 on that fill and fails at this size.
  It sits in the label row, not floated over the title: absolute positioning
  forced a 132px reserve that pushed the title to three lines with dead space.

### Changed
- **Hero and live card say what the money buys.** "Treats you already pay for"
  becomes things you already give them: screen time, new toys, a trip to the pool.
- **The live card leads with reach.** It now says plainly that it runs as a mini
  app inside the Nimiq Pay app AND in any plain browser, because the wallet is
  built into the page, so a kid can open a link anywhere. "Run their own bank"
  becomes "be their own bank".
- **Sticker packs move out of the August release note** and into the future drops
  card, which is now scheduled Fortnite-style releases drawn by hired Rive
  animators. The open creator marketplace is demoted to an explicit maybe.
- **The learning card states the mechanism plainly**: the goal is to use HTLCs so
  the reward releases once the criteria are met.
- **The always card no longer claims the parent "can pause it all"**; it says the
  parent approves every chore before it pays. See the note below.

### Notes
- Andjroo asked for "approves every transaction". That is not literally true on the
  shipped build: `maybeMintStreakBonus` in `src/routes/cashlinks.ts` fires on claim
  settle with `STREAK_BONUS_LUNA` defaulting to 1 NIM, so every 7th claim mints a
  bonus with no fresh parent tap. The copy says "approves every chore before it
  pays", which is true either way. Setting `STREAK_BONUS_LUNA=0` on the public
  instance would make the stronger wording accurate.

## [0.23.1] - 2026-07-31
### Changed
- Hero subline carries the same clarification the live card got in 0.23.0. "Spend
  it back inside the family" is replaced with what a kid actually buys: the screen
  time and treats the parent already pays for. 150 to 173 characters, checked
  against the fold at 320 through 768; the CTAs stay above it at every width.

## [0.23.0] - 2026-07-31
### Changed
- **The live card explains the circular economy instead of asserting it.** "Spend
  it back inside the family" meant nothing without the demo in front of you, so it
  now names what a kid actually buys with the Treasure Box: screen time, the pool,
  a small toy, things the parent already pays for. Adds the point the app was
  really built on, that a kid is learning to run their own bank.
- **The Rive card is no longer conditional on winning.** Label moves from "If I
  win Cycle I" to "Community funding", and the body states plainly that the next
  part of the phase is a Community Funding proposal. The "without it the app stays
  fun" hedge is dropped with the conditional it hedged against.
- **September is a grassroots push, not a soft launch.** New title, and the body
  now carries the real distribution asset: two kids aged seven and four, their
  activities, a small business, and friends with kids. Adds the two goals that
  were missing, an App Store listing and real marketing once there is something to
  point at.

## [0.22.0] - 2026-07-31
### Changed
- **Lane bands are now a lightness ladder, not three hues.** Navy field, then a
  22% blue, then an 8% blue, so the section lightens as the horizon gets further
  out. Taken from Nimiq's own `--colors-blue-600` / `-500` / `-400` ladder in
  `assets/css/modern/colors.css`, but expressed as alpha tints of the palette
  `#0582CA` (dE 2.2 and 1.4 off the oklch originals) because `nq lint` reads the
  legacy hex palette and errored on the raw oklch-derived values. `blue-500` is
  deliberately skipped: it measures dE 4.1 from `blue-600` and the two bands
  would not read apart. Measured steps: navy to lane 1 is dE 75.4, lane 1 to lane
  2 is dE 10.0. The plum band from 0.21.0 is retired.
- **Integration card rewritten.** "Genuinely teach" and "the things a kid is
  better off for having done" are gone. It now names real candidates (Ello, Khan
  Academy Kids, Yousician), states the mechanism plainly as hash time locked
  contracts releasing the reward once criteria are met, and ends by saying
  nothing is settled, because none of it is.

## [0.21.0] - 2026-07-31
### Added
- **A learning-integration phase**, past September. The goal is connecting to apps
  that genuinely teach (reading, math, music), deliberately selective and nothing
  that is only a game, where finishing a lesson or putting in the hours releases
  the reward through a contract rather than a parent tap. Ello, an AI reading and
  math teacher, is the shape of the partner meant here.
- **A third lane** to carry it, since the roadmap now spans three horizons rather
  than two. September splits out on its own and "Future goals" holds the
  marketplace plus the integrations.

### Notes
- The third band is plum at 20%, the end stop of the brand's own navy gradient, so
  it is brand-derived rather than an invented hue. 20% because a 10% wash of any
  hue lands within dE 14 of the blue lane, the same trap that made teal read as
  "too similar" earlier; at 20% it measures dE 13.9 from lane 1 and dE 17.8 from
  the page stage. The hexagon-field alternative was rejected on measurement: it
  sits dE 1.7 from the stage and does not read as a band at all.
- Automatic payout language appears ONLY in this future card. Everywhere the
  current app is described, the parent still approves.
- Verified at 360, 390, 430, 768 and 1280: 3 lanes, 7 cards, no overflow, no
  clipped cards, hero still fills. `nq lint` 0 errors, zero dashes.

## [0.20.1] - 2026-07-31
### Changed
- Roadmap copy says two kids, not three, in both places it appears: the August
  testing card and the September network card. "two or three animators" in the
  Rive card is unrelated and unchanged.

## [0.20.0] - 2026-07-31
### Fixed
- **Wordmark spacing solved against a measurement instead of by eye.** Setting
  `NIMIQ.kids` in real Mulish 700 at the documented 0.0836em tracking gives
  `Q`-to-period 0.1655 and period-to-`k` 0.2158 as fractions of the wordmark's ink
  height, so the period belongs *closer to the Q than to the k*. Both earlier
  attempts were wrong in opposite directions: 0.18.1 centred it in the gap, and
  0.19.0 pulled everything in and left both gaps too tight, the period-to-`k` by
  17px on a 1600px render. Both gaps now land within 0.4px of Mulish.
- **The lockup drops the high five for the solid hand.** The brand README already
  required the solid glyph below ~48px; in the header the lockup renders 176px
  wide, putting the hexagon at 30.7px, and the high five's eight parallel strokes
  merged into a smudge on a phone. All three lockups now carry the favicon's solid
  `hand` group, transplanted verbatim rather than redrawn. No dangling gradient or
  mask references left behind.

## [0.19.2] - 2026-07-31
### Changed
- Hero headline reads "mini economy" rather than "little economy", so the page
  echoes the Mini App platform and the Mini Apps Competition it is entered in.
  Line break is unchanged: two lines at 320 through 1440.

## [0.19.1] - 2026-07-31
### Fixed
- **Hero headline wraps to two lines, not three.** The cap was `max-width: 17ch`,
  which forced a third line well before the column ran out. Now 24ch. Below
  ~340px the clamp floor of 30px is still wider than the line can take, so a
  scoped media query drops it to 26px there; 360 and up keep full size.
  Verified two lines at 320, 340, 360, 390, 430, 768, 1280 and 1440.

## [0.19.0] - 2026-07-31
### Changed
- **The page is light mode now.** Only the nav bar stays navy; the hero flips to
  a white stage with navy ink, so the page reads as one continuous light surface
  from the hero through the roadmap to the footer. The primary CTA keeps its blue
  gradient as the single lit element. The secondary CTA becomes the legacy
  `.nq-button-s` chip, a navy wash with navy ink, rather than the translucent
  white that only worked on a dark stage. Video well, placeholder and every
  shadow retinted from near-black to navy.
- **The nav bar is bigger**: 68px tall with a 176px logo on phones and 200px from
  640px up, and a larger burger. It was 56px with a 140px logo.
- **Wordmark spacing closed up.** The earlier fix centred the period in the gap,
  but the gap itself was the problem: 4.5 units of whitespace around a 2.1 unit
  period reads as three things, "NIMIQ . kids". The period and the whole `.kids`
  run are now both pulled in, so the wordmark closes into one word. Supersedes
  the period-only balance in 0.18.1.

### Notes
- Verified at 360, 390, 430, 768 and 1280: hero fills the viewport at every one,
  zero horizontal overflow, logo loads, no page errors. `nq lint` 0 errors.

## [0.18.1] - 2026-07-31
### Fixed
- **The period in the NIMIQ.kids lockup was off-centre.** `NIMIQ` is the logotype
  path and carries much wider tracking than the outlined `.kids`, so the period
  inherited the wide gap on its left and Mulish's tight sidebearing on its right.
  Measured off a 1600px render it sat 44px from the `Q` and 21px from the `k`,
  reading as detached from NIMIQ and glued to kids. Each of the three lockups now
  carries a `translate` on the period path alone, centring it in the gap: 35px and
  31px, a 4px residual against the 23px it was. The light lockup takes a different
  shift because its `k` starts at 82.845 rather than 82.614. Documented in
  `public/assets/brand/README.md` so a future emitter run folds it in.

## [0.18.0] - 2026-07-31
### Added
- **The real NIMIQ.kids lockup in the marketing header.** The header was drawing
  a bare Nimiq hexagon next to the wordmark typed as live text, which
  `public/assets/brand/README.md` explicitly forbids ("Never retype the
  wordmark"). It now uses `nimiq-kids-lockup-dark.svg`, the dark variant because
  the header is a navy surface. Referenced as an `<img>` rather than inlined: the
  lockup carries its own gradient and clip ids, and inlining would have collided
  with the page's existing `site-hdr-grad` and `site-ftr-grad`.
- `/favicon.svg` as the tab icon, with `/icon.svg` demoted to apple-touch. The
  512 tile is unreadable at 16px, which is why main split them.

### Changed
- **The hero fills the first screen on mobile.** It was falling short by 158px on
  an iPhone 14, 216px on a Pro Max and 43px on a small Android. Uses `100svh`,
  the SMALL viewport unit, with a `100vh` fallback: `vh` overshoots by the
  toolbar height on iOS Safari and would push the CTAs under the browser chrome.
- **Hero copy leads with the household microeconomy.** "Your house, running its
  own little economy", then chores/routines/activities in, money spent back
  inside the family, nobody loses a dollar. The subline was cut from 245 to 150
  characters because at full length it pushed the video, which is the first thing
  a judge is meant to watch, down the screen.
- Meta and social descriptions moved off the retired "allowance" framing to the
  family-ecosystem one, and now carry the five-languages line.

### Removed
- The "The demo is a family that is already set up. Nothing to install." note
  under the CTAs, and its now-dead `.cta-note` rule.

### Notes
- Verified at 360, 390, 430, 768 and 1280: hero fills the viewport at every one,
  zero horizontal overflow, zero clipped cards, logo loads, no page errors.
  `nq lint` 0 errors, zero dashes outside comments.

<!-- NOTE: there are two [0.15.0] entries below. The brand mark shipped as
     0.15.0 on main (bd03d1a) while the marketing page branch independently
     used 0.15.0 for its own work. Both are real; neither was renumbered here
     because that is the marketing-site branch owner's call. -->

## [0.17.0] - 2026-07-31
### Changed
- **Roadmap copy rewritten to Andjroo's dictation.** The product is a family
  ecosystem where kids do chores, routines and activities and the parent rewards
  them for finishing, not a "family allowance". Heading is now just "What comes
  next". Corrected to three kids, on their own tablets. The August lane runs in
  the order he gave: real use, then the Community Funding proposal, then the
  recurring-allowance work. September leads with why asking people to invest
  first is backwards, and ends at conversations rather than ads, with public
  marketing after. Five languages moved into the live description.
### Fixed
- The recurring allowance previously read "Already in production", which claimed
  a repeating payout exists in the shipped app. It is future, parent-set work and
  now reads that way.
- Fabricated specifics removed (week/month bonus thresholds that were never
  dictated), along with the open-source-virtue lines and the interior-of-homes
  distribution phrasing.
- Verified at 360, 390, 414 and 768px: no overflow, no clipped cards, no page
  errors. `nq lint` passes with 0 errors, zero dashes.

## [0.16.1] - 2026-07-30
### Changed
- **Roadmap lanes swapped.** The near lane ("Mine to do next") now carries the
  solid navy field and the far lane ("Once the step before it lands") carries the
  light blue tint. The section reads dark to light as certainty drops: the work
  Andjroo controls sits on the heavier field, and the work that waits on things
  outside his hands lightens. Colour separation is unchanged at dE 81, since the
  same two treatments are exchanged rather than retuned.

## [0.16.0] - 2026-07-30
### Added
- **Roadmap section on the public marketing page**, final copy and final design.
  Structure is a dependency chain rather than a dated list: a solid blue live
  card as the single lit element, a light blue lane for the steps Andjroo
  controls, and a solid navy field for the steps that wait on something else.
  Cards interlock on a hexagon point borrowed from the era band on
  nimiq.com/roadmap, so the interlock is the connector and there is no rail, no
  dots and no step numbers. Standing rules sit outside the sequence.
### Notes
- Two defects were found by inspecting renders rather than by linting. `clip-path`
  clips `box-shadow`, so card elevation now uses `filter: drop-shadow()` on a
  wrapper; and a hexagon texture at 5.5% opacity was invisible at card size, so
  the shipped/upcoming split is carried by the card treatment instead.
- Colour choices are measured, not eyeballed. A 10% tint of any hue lands within
  dE 14 of the blue lane, so the far lane is a solid navy field at dE 81. The
  live card uses Nimiq's darkened light-blue gradient because the standard
  token's light end only reaches 4.16:1 against white; both darkened stops clear
  AA at 5.06 and 6.63. White cards on tinted bands also lift body text from
  4.31:1 to 4.50:1.
- Verified at 360, 390, 414 and 768px: no horizontal overflow, no clipped cards,
  no page errors. `nq lint` passes with 0 errors.

## [0.15.0] - 2026-07-30
### Added
- **A public marketing page at `/`** (`public/site/index.html`). On the public
  competition instance the bare domain now serves a real landing page instead of
  bouncing to the portal chooser: sticky navy header, hamburger menu, a hero
  whose centrepiece is the "why we built it" video, two pill CTAs, the roadmap,
  and a light footer. Judges land on the pitch, not on a sign-in.
  - The menu is a **white bottom sheet**, built to match a live capture of
    nimiq.com's own mobile menu at 390px rather than to a rule list: navy scrim,
    10px top corners, grey drag handle, one gradient pill anchoring the top, and
    small uppercase 12px/600 grey rows separated by hairlines. The marker sits
    beside each label, not pushed to the far right, and it is the real Nimiq
    arrow-right glyph, since on nimiq.com a down chevron means "this expands"
    while an arrow means "this navigates". The burger and its close icon are the
    verbatim Nimiq `hamburger-menu` and `cross` icons.
  - The video is a one-line swap: set `VIDEO_ID` at the bottom of the file and the
    labelled placeholder becomes a YouTube embed.
  - The roadmap is a one-line removal: flip the `[data-section="roadmap"]` toggle
    at the top of the stylesheet, or delete the clearly delimited section block.
  - Menu is Roadmap / Demo / Live. A 4th item is a commented block, ready to
    uncomment. Bio was deliberately left out: andjroo.com sits behind a PIN wall,
    so a judge who taps it gets a password prompt.
  - Self-contained on purpose. Inline CSS, locally vendored Mulish, no CDN, no
    service-worker registration and no manifest link, so the landing page cannot
    be shadowed by a stale cached shell.
  - Passes `nq lint` at 0 errors and 0 warnings, including the 360/414/768/1024/
    1280 responsive sweep.

### Changed
- `src/root-redirect.ts` serves the marketing page at `/` instead of a 302 to
  `/portal/`, still gated on `HATCH_LEGACY_BOOT=0`. The family install is
  untouched and keeps its root demo. **The app did not move**: `/portal/`,
  `/parent/` and `/kid/` are exactly where they were, so invite links already in
  the wild, `nimiqpay://` deep links and the mini-app entry all keep working. If
  the marketing file is ever missing, the old redirect is the fallback.
- `src/server.ts` registers `cacheBusting()` before `rootRedirectWhenLegacyClosed`.
  The root middleware short-circuits, so in the old order the one page a judge
  actually lands on was the only response on the site that never received
  `Cache-Control: no-cache`.
- `public/manifest.webmanifest` `start_url` is `/portal/`, not `/`. An installed
  PWA must launch the app, not the marketing page. `scope` stays `/` so
  `/parent/` and `/kid/` remain in-app.

### Fixed
- **Service worker no longer treats `/` as the app.** `public/sw.js` precached
  `"/"` and used `caches.match("/")` as the offline fallback for every
  navigation, which after this change would have rendered a marketing page on an
  offline tablet. The shell entry and the fallback are now `/portal/`
  (`APP_ENTRY`), and `/` is fetched network-only so a judge can never be served a
  stale homepage.
- **Hero pill painted over the open menu at 360px.** `.pill` carried
  `will-change: box-shadow`. box-shadow is not a compositable property, so the
  hint bought nothing, but it promoted every pill to its own layer, and a
  promoted layer paints over the menu's translucent scrim even though the scrim
  wins hit-testing. Dropping the hint changes no visual property of the pills.
## [0.15.0] - 2026-07-30
### Added
- **A real brand mark.** `NIMIQ.kids` replaces the placeholder icon (navy tile,
  gold coin, letter "C"). The Nimiq hexagon holds the duotone high-five, with an
  all-caps NIMIQ and a lowercase gold `.kids`. Six assets land in
  `public/assets/brand/` (dark, light and mono lockups, mark, 512 icon, favicon)
  alongside a README recording the construction rules.
- `/favicon.svg`, split from `/icon.svg`. The 512 tile shrunk to 16px left the
  hexagon unreadable, so the tab icon is now its own file and all four HTML entry
  points point at the right one.

### Changed
- Service worker `VERSION` to v13, and `/favicon.svg` added to the precache
  shell. `/icon.svg` is precached cache-first, so without this bump every
  installed PWA would keep serving the old placeholder icon.

### Notes
- The wordmark is real artwork, not type. `NIMIQ` is the verbatim logotype path
  from `logos-nimiq-horizontal`; `.kids` is outlined from Mulish 700 at the
  logotype's own 0.0836em tracking, so no font is needed to render it. Do not
  retype it.
- Two stroked hands in the lockup, the solid `hand` glyph below ~48px. An outline
  thinner than a pixel fills in and smears, so the small sizes use a different
  real Nimiq glyph rather than a thinner high five. The hand is navy (7.79:1 on
  gold), never a white knockout (1.94:1).

## [0.14.0] - 2026-07-24
### Added
- **The corner is a mini wallet now** (shell v0.4.0). Send collects recipient +
  amount right in the menu and hands to the Hub's checkout popup, which signs
  AND broadcasts — sending NIM from inside the app, never navigating away.
  Address validated against the Nimiq alphabet, amount against the live
  balance; green Sent state; a cancelled wallet dialog returns quietly. The
  Send button now shows for ANY connected wallet (the old Top-Up routing is
  retired — Top-Up keeps its own tab). Inside Nimiq Pay, Send uses the host
  wallet's native flow.

## [0.13.5] - 2026-07-23
### Fixed
- **A lapsed Cloudflare Access session can no longer freeze the app.** With the
  gate up, every API fetch dies as a cross-origin redirect while the service
  worker keeps the cached shell alive — an app that looks fine but never
  updates and shows no balance (this pinned a phone to an old build tonight).
  The parent app now probes /health with redirect:"manual" at boot and on API
  failure; an opaqueredirect means the gate is up, and one guarded hard
  navigation surfaces the login (offline still keeps the cached app).

## [0.13.4] - 2026-07-23
### Fixed (phone review, round 5)
- **Reload keeps you connected** (shell v0.3.5) — the connected address + label
  (public data, never keys) persist locally and restore at boot; Disconnect
  clears them.
- **"New to Nimiq? Create a wallet" works.** HubApi.onboard is a privileged
  request the Hub rejects from non-Nimiq origins (verified live and in the Hub
  source). The sanctioned path is chooseAddress, whose Hub view auto-routes a
  zero-wallet visitor into onboarding — the line now uses the connect flow.
- **Identicon air** — 8px left padding on the connected face pill.

## [0.13.3] - 2026-07-23
### Fixed (phone review, round 4)
- **Sub-cent USD no longer floors to $0.00** (shell v0.3.4) — fiat decimals now
  grow until the shown number is within 10% of the true value, the wallet
  FiatAmount's own rule. The rate itself was verified correct against three
  independent markets (~$0.00049/NIM); the flooring made it read as wrong.
- **Send only renders when signed into a family.** For a visitor without a
  parent token it routed to the onboarding view they were already on — a click
  with zero visible effect. No family, no Send button.

## [0.13.2] - 2026-07-23
### Fixed (phone review, round 3)
- **Balance shows for every connected wallet.** `GET /api/wallet/balance` is
  public now (an address balance is public chain data) with a 30s per-address
  cache — the parent-auth gate was hiding the NIM + fiat stack for a visitor
  connected to their wallet but not signed into a family.
- **Send visibly works.** Action rows (Send / Cashlink / Open in Nimiq Pay)
  close the menu before their handoff (shell v0.3.3) — the open menu was
  covering the view change, reading as a dead button.

## [0.13.1] - 2026-07-23
### Fixed (Andjroo's phone review of 0.13.0)
- **Menu stays a corner card on phones** (shell v0.3.2) — the full-width mobile
  sheet is gone; the 272px menu hangs off the corner at every viewport.
- **Tap-name-to-rename works** — built into the shell now: the label persists
  locally per address and shows on the face + menu.
- **Balance + fiat are live** — the wallet block shows the connected wallet's
  real NIM balance (new parent-authed `GET /api/wallet/balance`, server RPC)
  with the fiat line beneath; "Show amounts in" offers 14 currencies backed by
  live CoinGecko rates (`GET /api/rates` now returns a per-currency `nim` map;
  `nimUsd` is live too — the whole app's dollar figures track the real price,
  with the static env rate as fallback).
- **Create a Cashlink row** — opens the wallet's own Cashlink creator
  (HubApi.createCashlink, sender prefilled with the connected address).

## [0.13.0] - 2026-07-23
### Changed
- **The fleet's one-button corner control.** The parent app (and the demo page)
  replace the separate language pill + wallet pill with `mountCornerControl`
  (nimiq-app-shell v0.3.1): wallet state on the face, everything else in one
  menu — connect / "New to Nimiq? Create a wallet" (Hub onboard), real-iqon
  identicon, Receive (address + QR behind the button, tap-to-copy), Send
  (routes to this app's own Top-Up screen), language flag-hex grid, "Open in
  Nimiq Pay" (deeplink carries the magic token, computed at click time), a
  TESTNET badge stamped from `/health` (mainnet says nothing), and a quiet
  Disconnect. Inside Nimiq Pay the face collapses to the current-language flag
  with a language-only menu. Wallet-less pages (kid portal, portal chooser)
  keep the plain language pill — it matches the corner's mini-app face exactly.

## [0.12.0] - 2026-07-22
### Added
- **Portal chooser at `/portal/`** — the bare domain on the public instance now lands
  on a parent/kid chooser instead of forcing everyone into the parent app. This gives
  kids their sign-in path inside Nimiq Pay's WebView (kid card → `/kid/` → the
  existing 6-digit pairing screen). Known devices skip the chooser: a stored parent
  session auto-routes to `/parent/`, a paired kid device to `/kid/` (`?choose`
  forces the chooser). Localized in all 5 languages (`app.portal*`).
### Changed
- **Fleet-standard language pill.** Both shells swap the full flag ROW
  (`mountLanguageSwitcher`) for the compact flag + dropdown (`mountLanguagePill`),
  matching the rest of the nimiq.life fleet. Header CSS drops the row-scroller
  hacks; the kid app's fixed slot stretches on phones so the dropdown clamps to
  the screen.
- **Wallet chrome is now Nimiq-Pay-aware.** Inside Nimiq Pay there is no connect
  button — being in the wallet IS the connection: the account resolves eagerly and
  the header shows no wallet chrome (the identicon lives on the app face,
  wallet-style). On standalone web the custom connect button + profile widget are
  replaced by the fleet-standard `mountWalletPill` (outline connect → compact
  connected pill with the profile in a dropdown).
## [0.11.0] - 2026-07-22
### Added
- **Egg Studio** (`/kid/egg-playground.html`): the egg-timer tuning tool rebuilt as a
  phone-first wizard, one feature per step (Shape, Face, Hands, Crack, Motion, Hatch,
  Save), replacing the single dense playground page. Big square stage, per-step
  controls, whole config auto-saved and exportable as JSON on the Save step.
- **Parametric egg rig v2** (`public/kid/js/egg2.js` + `egg2.css`): same
  `createEggRig` API as the live rig (not yet wired into `flow.js`). Gradient-shaded
  shell with gloss, disc scene, circle reveal, 18-style face library with reactive
  cracking expressions, countdown as clock hands (4 styles, on-egg or behind-egg
  placement, per-hand length, draggable) or the reference-style red pie, stroke-based
  cracks that reveal in draw order (finger-drawn in the studio with undo and
  reordering), procedural never-the-same-twice hatch shell flakes with overlap
  avoidance, and tunable hatch timing (grow, reveal delay, reveal, flake dials).
- **Confetti rig + playground** (`public/kid/js/confetti.js`,
  `/kid/confetti-demo.html`): parametric two-ring radial-tick celebration matching
  the approved config, with a continuous celebrate mode.
- **Egg art direction handoff** (`/kid/art/`): generated variation sheets (Nano
  Banana) with Andjroo's locked picks, plus a Rive animator brief (state-machine
  inputs, timings, palette). Direction: egg body 5, static gesture arms, red pie
  countdown, organic two-crack pool, low hatch scenes with angular chips.
- Reference screenshots and the full interaction spec in
  `docs/design-refs/INTERACTION-NOTES.md`.

### Notes
- The live kid timer still runs the original `egg.js` rig; the egg2 swap is
  deliberately deferred until the Rive/app art rebuild lands.

## [0.10.0] - 2026-07-20
### Changed
- **UI/UX wallet-parity session.** The parent app's wallet surfaces now look and flow
  like the real Nimiq wallet (screenshot-checked against the logged-in reference set,
  `nq lint` 0 errors on home, onboarding, invite landing, and the kid app):
  - Home: flat grey asset groups and rows (colors sampled from the wallet home),
    page background `#F4F4F4`, total balance shows fiat only, fiat always 2 decimals
    with a `< $0.01` floor.
  - Per-kid account page: real account-header layout (label + fading masked address
    left, NIM + fiat right), transaction list directly on the page, current month
    reads localized "This month", chore payouts lead with the gold family hexagon.
  - Top up: the wallet receive flow (identicon first, 3x3 Fira Mono grid in a grey
    panel, copy + QR toggle); the mini-app deeplink panel moved below it.
  - Invite landing + parent onboarding: gold hexagon hero replaces the emoji egg,
    low-contrast gold brand text dropped, card shadow on the Nimiq elevation scale,
    links de-underlined (bold navy) with proper tap targets.
  - Kid money feed: gold hexagon leads for chore payouts, arrow tiles for
    address-less transfers, duplicate message sublines dropped, localized
    "This month" (`app.thisMonth`, `papp.thisMonth`, `papp.showQr` in all 5 locales).
- **The product is nimiq.kids everywhere a user can see (the "Hatch" name is retired).**
  Renamed all user-facing wording: parent locale strings in all 5 languages
  (`papp.cantReach`, `papp.needsKeySub`, `papp.openInPay*`, `papp.inviteSub`,
  `papp.onbTitle`, `papp.onbInvited`), both PWAs' page titles and the parent manifest,
  the public invite landing page copy and titles, the `navigator.share` title, the
  wallet-connect chrome `appName`, the ntfy test-ping title, and product-name code
  comments in touched files. Internal identifiers deploy depends on are unchanged on
  purpose (`HATCH_*` env vars, `com.hatch.*` launchd labels, the live domain,
  `window.hatchParentShell`, the `hatch:` deposit-attribution QR scheme, and the egg
  rig's `hatch()` animation API, which is the verb, not the brand).

## [0.9.0] - 2026-07-20
### Added
- **Mini-app port slice 3: payout economics + competition deploy kit.** The public
  instance can now be funded safely: one shared hot wallet, but every household lives
  inside its own budget.
  - **Per-family payout budget**: a non-exempt family's cumulative hot-wallet payouts
    (chore/routine earns, hot-funded cashlink mints, Treasure Box refunds netted
    against the spends that covered them) can never exceed its budget = demo grant
    (`HATCH_DEMO_GRANT_LUNA`, default 5 NIM, 0 disables) + attributed credits.
    Enforced BEFORE deciding at every payout site — a blocked approval stays pending
    and the parent app shows a warm top-up nudge (`papp.budget*`, all 5 locales).
    Refunds are never blocked. Exemption: `families.budget_exempt` (the migration
    grandfathers every family existing at upgrade time, exactly once) plus the first
    household by default; `HATCH_GRANDFATHER_FIRST=0` closes that on public deploys.
  - **Deposit attribution**: the in-app top-up path is fully attributed — the
    parent-authed `topup-broadcast` parses the signed tx offline, verifies it pays the
    hot wallet, and credits that family's budget (tx-hash deduped); the family code
    rides the tx data field as an on-chain reference. Plain QR/address deposits stay
    manual this slice: the deposit screen shows the family code to include in the
    message, and `src/scripts/credit-budget.ts` (list/show/credit/exempt) is the
    operator fallback. `deposit-info` now returns the budget view + family code.
  - **Kid-tablet boot scoping**: `/devices/register` accepts the parent-minted
    6-digit pair code (family-scoped, single use) beside the legacy env setup code;
    boot surfaces resolve parent bearer → device bearer → legacy first household, and
    `HATCH_LEGACY_BOOT=0` closes the fallback (`401 pairing_required`) — the kid PWA
    stores its device token and shows a pair-code screen (`app.pair*`, 5 locales).
  - **Competition deploy kit** (`deploy/competition/`): env template (mainnet armed,
    0.5 NIM earn cap, 5 NIM grant, brakes on), `com.hatch.competition` launchd plist
    template, named-tunnel notes, hot-wallet funding rules with worst-case exposure
    math, and a 10-point pre-flight checklist. Files only; nothing auto-starts.

## [0.8.0] - 2026-07-20
### Added
- **Nimiq Pay mini-app port, slice 2: multi-family + self-serve onboarding.** A total
  stranger (a competition judge) opening Hatch inside Nimiq Pay can use it on first
  try; an invited family can actually join via their `?ref=CODE` link; the existing
  live household keeps working untouched.
  - **Multi-family plumbing**: parent-facing routes resolve the family from the
    authenticated bearer token (`bearerFamily` / `parentFamilyFrom`); routes addressed
    by a subject id (child, chore, run, approval, device, media) resolve the family
    from the row and 404 any valid bearer from another household (`familyForSubject`).
    `parentAuth`'s bearer path only authorizes tokens belonging to the subject family.
    Instance-level unauth surfaces (kid tablet boot, demo pages, PIN pad, kiosk
    pairing) keep the legacy first-household bootstrap — new families are never
    exposed through it. Cross-family reference checks on proof photos, photo
    stickers, device child bindings, overrides, and allowlists. Isolation proven in
    `src/multifamily.test.ts` (two households across overview, children, chores,
    approvals, invites, kid wallets/transfers, devices, settings) and the live-DB
    shape regression-tested in `src/legacy-compat.test.ts` (one family + PIN +
    existing token + paired tablet behaves identically before/after a stranger
    onboards).
  - **Self-serve onboarding**: the parent app's no-token state is a warm
    create-your-family screen. `POST /api/onboard` creates the family (family mode,
    same as the live household) + first kid + three sample chores and mints the
    parent bearer token, stored exactly how `core.js` expects. Optional wallet
    connect (native inside Pay, Hub on web) never blocks. Rate-limited (3/IP/hour,
    200/day, env-overridable). Parent-custodial + privacy copy on the screen itself.
    A `?ref=CODE` join flips the inviter's referral **accepted -> joined**
    (`joined_at` timestamp; still nothing recorded about the invited household).
  - **Pairing-code token handoff**: if the Pay WebView drops the `#t=` fragment, a
    signed-in session mints a 6-digit code (`POST /api/parent/pair-code`; 5 min TTL,
    single use, one live code per family, hash-only at rest) and the other device
    redeems it (`POST /api/pair`, 6 attempts/IP/min) for a parent token. Sign-in
    screen + a "Pair another device" Settings card.
  - **Invite-accept hardening** (slice-1 review): `POST /api/invites/:code/accept`
    deduped per (code, ip-hash) per rolling day + hard-capped at 500 rows/code; the
    ip hash is a truncated digest, never a raw IP. `GET /api/family/invite` now also
    reports `joined`.
  - **Stricter `isUserCancel`**: requires user/permission context (permission denied,
    user rejected/cancelled/dismissed, popup closed) or the Hub's bare `CANCELED`
    literal — network/consensus failures containing "rejected"/"cancelled" surface
    as real errors instead of calm cancels.
  - 26 new `papp.*` keys across all 5 locales. 38 new tests (218 total).

## [0.7.0] - 2026-07-20
### Added
- **Nimiq Pay mini-app port, slice 1 (competition build).**
  - **Provider integration**: `@nimiq/mini-app-sdk` is now a direct dependency. Inside
    Nimiq Pay the parent shell eagerly resolves the injected provider (`init()` with a
    10s timeout, retry-on-failure; no dialogs on load — `listAccounts`/send only run
    from explicit taps) and hot-wallet top-ups route through the wallet's native
    `sendBasicTransaction` approval dialog via the app-shell dual-mode wallet + the
    existing `/api/family/topup-broadcast` path. Declining the dialog is now a calm
    "nothing was sent" toast, not an error. Host language keeps flowing through the
    shell i18n chain (`window.nimiqPay.language` -> stored choice -> `navigator.language`).
  - **Open in Nimiq Pay**: outside Nimiq Pay the Top up screen shows a deeplink panel
    (`nimiqpay://miniapp?url=...` carrying the magic-link token) plus a copyable link.
    `src/miniapp.ts` owns the pure helpers (deeplink, parent app URL, user-cancel
    detection), unit-tested in `src/miniapp.test.ts`.
  - **Invite a family**: home-screen card -> share sheet (`navigator.share` where the
    WebView offers it, copy-to-clipboard fallback with confirmation). The link lands on
    a public warm explainer page (`GET /invite/:code`) that opens Hatch inside Nimiq
    Pay. Server records attribution only (`family_invites` + `referrals`; the referral
    row carries nothing about the invited household) so the both-sides bonus can be
    granted in a later slice. New `GET /api/family/invite` (parent bearer) and public
    `POST /api/invites/:code/accept`. 14 new `papp.*` keys across all 5 locales.
  - **Juice layer**: `public/parent/juice.js` — tiny synthesized Web Audio chimes +
    `navigator.vibrate` haptics on approve (chore), pay (payday sweep), and invite
    sent. Gesture-gated by construction, silent wherever audio/vibration is missing,
    mutable from a new Settings card (localStorage, per phone).
  - **No-SIM guard**: `HATCH_REQUIRE_REAL=1` makes boot fail loudly if SIM settlement
    would be active (missing `DEV_PARENT_PRIV` or stray `NIMIQ_SIM=1`) — the shipped
    competition build must never reach a simulated settlement path. Covered in
    `src/mainnet-guards.test.ts`; defaults unchanged for demo/dev clones.
- docs/ROADMAP.md: invite-a-family moved into Phase 1 scope (bonus automation stays
  later); Phase 2 notes Rive is optional, not a dependency.

## [0.6.20] - 2026-07-19
### Added
- **Timer styles: Sticker Maker + Polaroid rigs (egg stays the free default).** Two new
  visual timers for timed tasks, both EARNED: kids save up NIM and buy them in the
  Treasure Box (first non-sticker Box category — the expansion path the Box was built for).
  - **Sticker Maker** (`kid/js/sticker-maker.js` + css, 10 NIM): a chunky machine
    MANUFACTURES the kid's sticker during the countdown — outline self-draws (0-35%),
    color sweeps in (35-75%), foil gleam + gold ring stamp (75-95%), roll to the
    out-slot (95-100%), with a progress dial on the machine face. Finish = the sticker
    POPS from the slot with a bounce. **Pre-pick delight**: "What are you making?" mini
    picker before the timer starts (skippable -> mystery "?" sticker + the normal
    post-completion picker); a pre-pick feeds the machine AND skips re-picking at
    placement time.
  - **Polaroid** (`kid/js/polaroid.js` + css, 8 NIM): an instant photo slides out of a
    kawaii camera at start and DEVELOPS with progress (washed-white + blur + chemical
    swirl -> clear). The photo is a random pick from the kid's own media (sticker/hatch/
    proof roles; else task-icon surprise art) — which photo it'll be IS the fun. Finish =
    flash, snap fully sharp, lift-off wiggle.
  - Both rigs expose the egg rig's exact API ({setProgress, hatch, reset, wobble,
    destroy}), share its footprint, honor prefers-reduced-motion (crossfades only), and
    keep all colors/geometry/timing in CSS vars (`--maker-*` / `--pola-*`) for future
    NanoBanana skins. `flow.js` swaps rigs via a one-line style-id -> lazy-module map.
- Server: `kid_prefs.timer_style_id` (default 'egg'), generic `kid_unlocks` ownership
  table, `timer_style` store item kind + seeded 'Timers' category (Sticker Maker 10 NIM,
  Polaroid 8 NIM). Buying rides the existing kidSpend path and grants the unlock; equip
  is ownership-gated server-side (`style_not_owned` 403). `GET/PUT /children/:id/prefs`
  now return `timerStyles` (free egg + purchases).
- Kid app: studio gets a fourth "Timer" sheet (dock button) showing ONLY owned styles;
  the Box shows timer items with mini rig previews and, after buying, a "Use it now?"
  moment that equips + jumps into the Timer sheet.
- i18n: 10 new `app.kidTimer*`/maker/pola keys across all 5 locales.

## [0.6.19] - 2026-07-19
### Changed
- **V3: the kid app IS a sticker chore chart** (Andjroo's pivot: "a chart for the child,
  not a timer and not a bank"). Home = "today big + week behind": the current week's
  sticker grid (rows = routines/chores/lessons, columns Mon..Sun, cells = the stickers
  the kid placed) one glance above today's big task cards, each with its own sticker slot.
  - **The sticker moment**: task done -> picker pops (collection grouped by pack + a
    camera tile) -> the kid PLACES the sticker themselves (drag or tap-to-place; the
    landing position and a tilt from the drag motion persist — `sticker_placements`
    x/y/tilt survive reloads). Parent approve = **golden shine** (metallic sweep +
    gold ring); reject = grey "try again" wobble, tap explains in the parent's voice
    and resubmits. State hooks ride the existing approval -> pay path (NIM still flows).
  - **Treasure Box = its own full-screen world** behind a chest dock button (with a
    quiet "new items" count badge). Chest-opening entry moment (skipped under
    prefers-reduced-motion), shelves rendered from DATA (`store_categories` +
    `store_items`) so future categories (backgrounds, characters, sounds, seasonal)
    land with zero UI code change. Launch shelves: sticker packs, screen time
    (kid-purchased unlock via the existing lock-override path), parent coupons
    (queued to the parent feed as `coupon` approvals; reject refunds). Buying is a
    REAL `spend` tx kid -> family hot wallet (ledger kind reserved since W1).
  - **Money recedes**: balance chip in the chart header -> ONE money screen holding
    the v2 account header + feed + Send/Receive/Grow, moved intact (screens unchanged).
  - **Customization returns to the dock**: hatch / sounds / background sheets get
    first-class dock slots again, Little Timer style. Egg timer is now a tool inside
    timed tasks (the hatch stays; the picker follows it); the free-timer sheet is gone.
  - **Photo stickers**: new media role `sticker` — the kid's photo becomes a die-cut
    round sticker in their collection (circle-masked render, no image processing).
  - Placeholder art: 25 simple SVG stickers (starter 10 + space/ocean/party packs)
    under `public/assets/stickers/` — real NanoBanana art replaces files/URLs only.
### Added
- Server: `sticker_packs`/`stickers`/`kid_stickers`/`sticker_placements`/
  `store_categories`/`store_items`/`kid_purchases` tables (catalog seeded idempotently
  in schema.sql), `src/repo-stickers.ts`, `GET /api/kids/:id/chart` (ONE call for the
  home), `POST /api/task-runs/:id/sticker` + `POST /api/chores/:id/sticker`,
  `GET /api/kids/:id/stickers`, `POST /api/kids/:id/photo-sticker`,
  `GET /api/kids/:id/store`, `POST /api/kids/:id/buy`, `kidSpend`/`refundKidSpend`,
  approvals `subject_kind: 'coupon'` (+ parent card variant + toast).
- 26 new kid i18n keys + 3 parent keys x5 locales (parity tests green).
- 11 new server tests (chart shape, placement + state transitions, buy flows,
  coupon queue/refund, photo stickers) — 151 total.
### Verified
- Real-browser E2E at 390x844: chart home -> egg task -> picker -> drag-place
  (position persists across reload) -> approve -> golden shine -> pack/screen-time/
  coupon buys (balance, override row, parent queue all checked) -> money screen still
  sends + stakes. Zero horizontal overflow at 360/390/414/768/800x1280;
  `nq lint` home: 0 errors.

## [0.6.18] - 2026-07-19
### Fixed
- **Kid app is phone-first (390px), scaling up to the tablet.** v2 shipped verified at
  800x1280 only and broke on phones. New `public/kid/css/phone.css` layer (<=767px;
  >=768px keeps the tablet chrome untouched), CSS-only:
  - **Home header restacks like the real wallet mobile account screen**: 48px identicon,
    name + faded chunked address left, balance + fiat right — rescaled via the vendored
    account-header's OWN vars (`--h1-size`/`--body-size`), keeping the component's mask
    fade on the address (no hard ellipsis). Was: name clipped to "K", address colliding
    with the balance block.
  - **Bottom action bar fits 4 actions at >=360px**: compact icon-over-label pills
    (`flex: 1 1 0`, `min-width: 0`), no horizontal overflow. Was: Receive and Grow
    clipped off-screen.
  - **Every kid screen phone-scaled**: Earn (studio dock 44px, full routine/chore
    titles), egg task screen (egg stays the hero; title/clock/bar chrome shrinks),
    send picker, amount + PIN pads (keys now `clamp()`-sized — the 424px grid used to
    clip both columns), receive card (address grid + QR fit), grow hero, waiting/PIN,
    status screens, studio sheets (mode/tile/stepper rows), games grid, login.
  - **Flag language switcher**: small top-right at phone width, clear of headers, hover
    tooltip suppressed on touch; every flag padded to a >=36px tap target (all widths).
- Feed transaction rows keep >=12px text and >=36px tap targets at every width
  (`nq lint` responsive sweep: 0 errors, no overflow / clipped text / tap-target hits
  at 360-1280).
- Parent page verified clean at 390 + 360 (all four tabs) — no regressions; no changes
  needed beyond the shell rebuild already in the launchd start.

## [0.6.17] - 2026-07-19
### Changed
- **Kid app v2 (W2) — the kid version of the real Nimiq wallet.** `/kid/` is rebuilt
  around the W1 wallet core: HOME is now the wallet account screen (kid identicon from
  their REAL address, name + faded chunked Fira Mono address, big NIM balance + live
  fiat via `/api/rates`, and the transaction feed mapped from `wallet_events` — earns
  as green `+NIM` pills labeled with the chore/routine, sends dimmed outgoing, stake/
  unstake/reward rows with the wallet staking plant; pending unstakes render in-flight
  with their honest `availableAt`). Bottom action bar: Receive | **Earn** (center
  primary, the egg) | Send | Grow. **Earn** keeps the egg rig, timers, waiting/PIN and
  photo-proof mechanics identical but pays in NIM (waiting screen shows `+NIM`,
  approval celebration = the amount pill flying into the balance) and adds a
  **Learning** section (lesson-kind chores with a duotone document icon). **Send**
  mirrors the wallet flow: family recipient picker as identicons (siblings + parent),
  big amount pad with live fiat, instant family transfers, "Send to a friend" =
  cashlink path with an honest pending-grown-up-approval state. **Receive** = big
  identicon + 3x3 Fira Mono address grid + gradient QR of the kid's real address.
  **Grow** = staking with a green hero (staked NIM + rewards), stake/unstake pads,
  honest unstake cooldown countdown, and a simple APY projection line.
- **Real wallet chrome, zero emoji in UI.** Vendored the `nq` registry pieces
  (account-header, transaction-list, address-display, amount, fiat-amount, identicon,
  qr-code, status-screen + deps) into `public/vendor/nq/` behind one shared CSS
  bundle; `@nimiq/iqons` (lib + the real 84-part sprite), qr-creator and Fira Mono are
  vendored locally for the offline tablet. Every UI emoji replaced with Nimiq duotone
  icons / verbatim wallet SVGs (dock, buttons, states, PIN pad, studio, games).
  Emoji survive only as kid-content (parent-set chore/routine emoji, surprise art,
  celebration coins). Kawaii backgrounds stay behind a soft wash. Language switcher
  (`#lang` flag-hex pills) now mounts on the kid app; ~28 new i18n keys across all
  5 locales (parity-tested).
## [0.6.16] - 2026-07-19
### Changed
- **Parent app v2 (W3) — the mirror Nimiq-wallet companion.** `public/parent/` rebuilt
  as the grown-up half of the family wallet on the nimiq-ui surface (registry components
  vendored to `public/vendor/nqp/`: account-header, transaction-list, address-display,
  identicon + the team-shipped iqons sprite, amount, toast-notification, qr-code recipe,
  buttons; pinned `@nimiq/iqons@1.6.0` + `qr-creator@1.0.0` vendored locally). Family
  home = wallet-style total balance (hot wallet + kids, NIM + fiat) + the kid roster as
  identicon rows; tapping a kid opens a per-kid account page (account-header with the
  kid's real address, staking panel, that kid's pending approvals inline, tablet lock
  override card, and their `wallet_events` as a real transaction-list). Approvals feed
  shows `rewardLuna` amounts, photo proof, and the new `send` (kid cashlink) cards —
  approving a send hands over the minted `cashlinkUrl` as QR + copy link. New Top up
  screen: hot-wallet QR + 3x3 address grid + copy, an "I sent it" deposit-check, and a
  wallet-connect top-up (fleet chrome via nimiq-app-shell: flag-hex language switcher +
  dual-mode connect; new `src/parent-shell.ts` bundle) that signs a Hub/Nimiq Pay tx
  from the parent's own wallet. All emoji chrome replaced with Nimiq brand icons
  (verbatim from the icon catalog + duotone set); zero third-party branding. Parent
  i18n: lean `papp.*` set in all 5 shell languages (`src/locales/parent.ts` + parity
  test). Bearer magic-link auth, ntfy `#approval=` deep links, PIN/pings/tz settings
  and the device allowlist all kept (star rate hidden — legacy). Still NO service
  worker on the parent page, deliberately.
### Added
- Tiny additive server touches for the companion (noted for W1 owners):
  `GET /api/parent/overview` now also returns per-kid `address` + `stakedLuna` and
  family `hotWalletLuna` (cheap DB reads, no RPC), and new parent-bearer
  `POST /api/family/topup-broadcast` relays a Hub-signed serialized tx over the
  existing RPC path (the Hub signs but does not broadcast); SIM: validated no-op.
  10 new tests (140 total).

## [0.6.15] - 2026-07-19
### Added
- **V2 wallet core (W1) — kids become REAL Nimiq account holders.** Family mode moves
  OFF stars onto direct NIM: each kid gets a derived on-chain account at
  `m/44'/242'/7'/i'` from one family master seed (`HATCH_MASTER_SEED`; SLIP-0010
  ed25519 ported from nimiq.gift — issue #35 tracks unification; private keys derived
  on demand, never stored). New `wallet_events` ledger is the kid-facing feed (SIM
  truth / real-mode instant-UX record reconciled by tx_hash). Approving a chore or
  routine now PAYS `reward_luna` hot wallet → kid account (`routine_tasks.reward_luna`
  added; `HATCH_MAX_EARN_LUNA` ceiling, default 10 NIM, checked BEFORE the decide).
  Kid sends: sibling/parent transfers execute immediately (double-entry, kid-key
  signed off-SIM); cashlinks to outside require parent approval (new `send` approval
  subject + `send_requests` table) and mint FROM the kid's account. Staking per kid
  delegated to `HATCH_VALIDATOR_ADDRESS` via core 2.5.1 `newCreateStaker`/`newAddStake`;
  unstake models the honest Albatross multi-step (deactivate → pending cooldown →
  retire+remove, settled lazily); SIM accrues visibly at `HATCH_EST_APY` (12%) with a
  lazy daily tick. New endpoints: `GET /kids/:id/wallet` (the kid-app home payload),
  `POST /kids/:id/send`, `GET/POST /kids/:id/staking|stake|unstake`,
  `GET /family/deposit-info`, `POST /family/deposit-check`, `GET /rates`. Scripts:
  `generate-family-seed.ts` (env-only secret, address-only stdout) and
  `migrate-stars-to-nim.ts` (opening-balance conversion, idempotent). Full contract
  for the app rebuilds: `docs/WALLET-CONTRACT.md`. Demo-mode star/streak mechanics
  untouched (regression suites green); 21 new tests (130 total).

## [0.6.14] - 2026-07-18
### Added
- **Kid-app games launcher (K3, kiosk-only).** When the Android wrapper's
  `KioskBridge` reports `UNLOCKED` with a non-empty allowlist, the Today screen
  shows a "🎮 Your games are open!" card opening a full-screen grid of big
  tiles (real app icons + labels via `KioskBridge.getInstalledApps()`, filtered
  to the parent's allowlist); a tap launches the game through
  `KioskBridge.launchApp()`. The grid watches the native state every 5s and
  bounces back to Today with a "🔒 Game time is over!" toast on relock. New
  `getNativeState()` accessor in `bridge.js` (the page can't ask
  `/api/device/state` itself — it's device-token-authed; the wrapper already
  knows). Plain browsers (Phase A): `window.KioskBridge` is undefined → the card
  never renders, nothing else changes. Replaces the wrong-shaped
  `applyKioskState(state-bag)` call in `refreshToday` (it always mapped to
  "locked"; harmless, but now the slot actually reads the native truth).
  Strings in all 5 locales; SW v10 (+ bridge.js/games.js precached). No server
  logic touched — `public/kid/` only.

## [0.6.13] - 2026-07-18
### Added
- **Flat-kawaii art set (Andjroo's pick) wired into the app.** 8 hatch characters
  (dino/unicorn/puppy/kitten/penguin/bunny/dragon/sloth, flood-cut stickers), 4 portrait
  backgrounds (meadow/ocean/space/city) and the app icon under `public/assets/` +
  `manifest.json` catalog. Egg rig re-skinned via the art contract: bold dark outline,
  pure-white shell, blush cheeks + happy eyes (new `.shell-cheek`/`.shell-eye` elements,
  invisible until a skin sets `--egg-cheek`/`--egg-face` — demo look unchanged). Catalog
  backgrounds now supersede the same-id built-in gradient (which stays as the pre-art
  fallback) and the picker no longer shows duplicate tiles. SW v9.

## [0.6.12] - 2026-07-18
### Added
- **Mainnet arm switch (folded from #47).** With SIM off, `NIMIQ_NETWORK=main` now refuses to
  boot unless BOTH an explicit `NIMIQ_RPC_URL` (no default on mainnet) and the human
  `MAINNET_ARMED=1` switch are set — subprocess-tested for all five env combinations. The Mini's
  live mainnet RPC sidecar (127.0.0.1:8649) is the documented instance value.

## [0.6.11] - 2026-07-18
### Added
- **Mainnet payout kit (gated — SIM remains the default).** `generate-hot-wallet.ts` writes a
  dedicated allowance key into the instance env (address-only on stdout); `mainnet-selftest.ts`
  (`--yes`, main-network + non-SIM guards) proves the full round trip — mint a 0.1 NIM Cashlink,
  confirm on-chain, sweep back to the hot wallet — before the family instance may flip off SIM.
  Payout route gains a `MAX_PAYOUT_LUNA` ceiling (default 50 NIM) so a fat-fingered star rate
  can never drain the hot wallet in one mint.

## [0.6.10] - 2026-07-18
### Added
- **Ops: LAN HTTPS + Mini runbook.** `TLS_CERT`/`TLS_KEY` env serve the app over HTTPS
  (Bun tls) so the kiosk tablet gets the secure context that camera + service worker
  require; absent = plain HTTP, dev/tests unchanged. `docs/RUNBOOK-MINI.md` documents the
  self-hosted family instance (port 3950, data under ~/data/hatch, mkcert, tunnel
  ingress, launchd, pairing).

## [0.6.9] - 2026-07-18
### Added
- **Kid tablet app ("Hatch", A2) at `/kid/`** — the screen the kids live in. Emoji-first,
  huge tap targets, tuned for 800x1280 tablet portrait. Vanilla ES modules under
  `public/kid/js/` (`main` / `flow` / `waiting` / `studio` / `payout` / `util` / `api`)
  + its own chunky skin `public/kid/kid.css` on the shared Nimiq brand tokens.
  - **Avatar login**: big kid cards from `/api/children`; choice remembered in
    localStorage; corner avatar switches kids; `?child=` query override for the kiosk wrapper.
  - **Today**: greeting + live ⭐ balance chip, routine cards with progress (2/3 ✓),
    one-off star chores with an "I'm done!" submit flow, and the Little-Timer studio trio
    (🐣 hatch / 🎵 sounds / 🖼️ background) docked at the bottom. Polls every 15s + on
    visibilitychange.
  - **Routine egg-timer flow**: reuses the D0 egg rig + drift-free countdown; Start posts
    `/task-runs/:id/start` and anchors the countdown to server timestamps (+skew), ticks
    drive the cracks, timer-end hatches the surprise (kid photo, catalog animal, or a
    built-in emoji burst) with alarm + confetti; "I'm done!" allows early finish; both
    paths post `/done` and advance. A `running` task resumes mid-egg after a reload.
  - **All-done -> waiting**: "You did it!" celebration + stars earned, then
    "Waiting for {parent}" with 📸 photo proof (camera -> 1280px JPEG downscale ->
    `/api/media` role=proof -> attach) and 🔑 on-tablet PIN pad (shake on wrong PIN,
    friendly 423 lockout state). Polls every 5s; approval triggers a star-burst
    celebration with balance count-up.
  - **Customization studio**: hatch sheet (🎲 surprise / 📷 my-photo modes, camera upload),
    sounds sheet (music / timer / alarm with ▶ preview, Off rows, cheerful
    "more coming soon" while the Phase-D catalog is empty), background sheet
    (4 built-in CSS scenes meadow/ocean/space/city + catalog images). Prefs PUT immediately.
  - **Free "Little Timer"**: min/sec stepper sheet (0:10-60:00), same egg flow, purely
    local, no stars.
  - **Payout ceremony**: 💰 chip appears when an unclaimed allowance Cashlink exists
    (stars ledger payout event + status check); ceremony screen with stars->coins rain,
    QR (vendored qrcode), NIM value, SIM-mode Claim! button; `#payout=<cashlinkId>` hash
    deep link.
  - **Kiosk seam**: feature-detected dynamic import of `/kid/js/bridge.js`
    (`initKioskBridge`/`applyKioskState`) with a no-op fallback until Phase B lands.
- **`GET /api/routine-runs/:id/approval`** — minimal kid-app lookup returning
  `{ approvalId }` for the run's pending approval (404 when none), so the kid can attach
  photo proof / drive the PIN approve. Colocated HTTP test in `src/routines.test.ts`.
- 16 kid locale keys (`app.kid*`) across en/de/es/fr/pt (parity-tested); everything else
  on the kid page is emoji-first by design.
### Changed
- Extracted the confetti burst into shared `public/js/lib/confetti.js`; the parent app
  (`public/js/app.js`) and the kid app both import it. Service worker bumped to v8 and
  precaches the kid app shell.
## [0.6.8] - 2026-07-18
### Added
- **Parent phone page (A3)** at `/parent/` — Andjroo's approve-from-anywhere surface for
  family mode ("Hatch"). Vanilla ES module (`public/parent/`), reuses the app.css brand
  tokens/components, English-only by design (personal-use page; the shared app-shell
  i18n stays on the kid app). **No service worker on purpose** — the family-mode API is
  still moving and stale cached JS would hurt more than a network round-trip.
  - **Magic-link auth**: `#t=<token>` (from `src/scripts/parent-token.ts`) is captured
    into localStorage and stripped from the URL; every call sends the Bearer token; a
    401 clears it and shows a friendly "open the link from the Mini" state.
  - **Approvals feed** (default tab): pending routine runs/chores as cards — kid, per-task
    ✓/skip list with elapsed times, tap-to-fullscreen proof photo, stars at stake (+ NIM
    equivalent), big **Approve** / **Not yet** (optional note) actions with optimistic
    refresh; 20s auto-refresh + refresh on visibilitychange; `#approval=<id>` deep link
    (ntfy Click) scrolls to and highlights the card.
  - **Kids tab**: per-kid star balance + NIM tally, **Payout day 🎉** confirm sheet
    (stars × rate preview) → `POST /children/:id/payout` → Cashlink QR + copyable link;
    tablet lock override buttons (Lock now / Unlock 1 h / Clear).
  - **Settings tab**: star value (edited as NIM per ⭐, stored as luna), ntfy topic URL
    with a **Send test** that pings the topic straight from the phone, change PIN
    (4–8 digits, entered twice), timezone select, device app-allowlist editor.
  - **Graceful 404s**: lock-override + device endpoints (`POST /family/override`,
    `GET /devices`, `PATCH /devices/:id/allowed-apps`) are being built on a parallel
    branch — their UI hides itself when the endpoint 404s, so this page works today and
    lights up when that branch merges.
  - `public/parent/manifest.json` ("Hatch — Parent", standalone, scoped to `/parent/`);
    server now sends `Cache-Control: no-cache` for the parent shell + manifest (same
    force-revalidate rule the kid PWA shell already had).

## [0.6.7] - 2026-07-18
### Added
- **Kiosk server wiring (Phase B of Hatch)** — the contract the native Android wrapper
  (device owner + LockTask, built separately) consumes. Full handoff spec in
  `docs/KIOSK-CONTRACT.md`.
  - **`src/lock-machine.ts`** — PURE lock-state computation (no DB): parent override wins,
    then lock windows evaluated by weekday + hh:mm **in the family TZ** via Intl
    (DST-exact, midnight-crossing windows supported, Monday = mask index 0); a window's
    routine absent/in-progress → `LOCKED_ROUTINE`, done-awaiting-parent →
    `PENDING_APPROVAL`, approved → `UNLOCKED` with `until` = next window start (across all
    windows, may be tomorrow); most-restrictive wins across overlapping windows.
    Table-driven tests cover every state, override precedence/expiry, Sunday mask edge,
    midnight-crossing evaluation, and both 2026 America/Chicago DST transition days.
  - **Device routes** (`src/routes/lock.ts`): `POST /devices/register` (env
    `KIOSK_SETUP_CODE` gate — unset = registration disabled; token minted via `newToken`,
    sha-256 stored, shown ONCE), `GET /device/state` (state + `allowedApps` + `approvalId`
    + `serverTime`), `GET /device/state/stream` (SSE: immediate state, push on every
    relevant mutation, 25s heartbeat), `POST /device/apps` (wrapper reports installed apps
    → new `devices.installed_apps` column + migration), `PATCH /devices/:id/allowed-apps`
    + `GET /devices` (parent), `POST /family/override` + `DELETE /family/override/:id`
    (parent).
  - **`src/lock-events.ts`** — in-process pub/sub; one-line `publishLockChange()` calls at
    every mutation point (approval approve/reject incl. family-mode chore branches, task
    done/skip, run submit, override set/clear, allowlist change) re-push SSE state.
  - **`public/kid/js/bridge.js`** — KioskBridge shim: `applyKioskState()` maps server
    state → native `setLockState(json)` (locked unless `UNLOCKED`); `listInstalledApps()`
    / `launchApp()` no-op cleanly in plain browsers (Phase A unchanged).

## [0.6.6] - 2026-07-18
### Added
- **Egg-hatch animation rig + drift-free countdown engine (placeholder art).** Reusable kid-app
  primitives (D0) for the "Little Timer"-style egg countdown — no app wiring yet.
  - `public/kid/js/egg.js` — `createEggRig(container, opts)` builds a layered inline SVG egg
    (shadow, `#shell-bottom`/`#shell-top` split along a shared zigzag, `#crack-1..4`
    self-drawing crack strokes, egg-clipped `<image>` surprise slot behind the shell).
    API: `setProgress(0..1)` (crack thresholds 0.25/0.50/0.75/0.90, configurable),
    `hatch({ imageUrl, onDone })` (springy shell fly-off + surprise pop with overshoot),
    `reset()`, `wobble()`, `destroy()`. All colors/weights/timings are CSS custom properties
    (`--egg-shell`, `--egg-outline`, ...) so future NanoBanana art re-skins without JS edits;
    `prefers-reduced-motion` swaps wobbles/springs for fades.
  - `public/kid/js/timer.js` — `computeRemaining()` (pure wall-clock math: clamps, skew,
    progress) + `createCountdown()` (rAF-driven, drift-free, `pause/resume/stop`, falls back
    to a 1s interval in hidden tabs so `onDone` still fires).
  - `public/kid/css/egg.css` — rig keyframes/transitions + custom-property defaults.
  - `public/kid/egg-demo.html` — dev preview (slider, Start-2min/Hatch/Wobble/Reset, surprise
    URL input; `?p=` / `?hatch=1` / `?d=` deep links for art review). Not linked from the app.
  - `src/egg-timer.test.ts` — 12 bun tests pinning the countdown math contract.
## [0.6.5] - 2026-07-18
### Added
- **Family mode ("Hatch") server core — A1 of the routine-timer/locked-tablet build.**
  `families.mode = 'demo' | 'family'` gates everything; the competition demo path is untouched.
  - **Routines**: per-kid morning/evening task sequences (`routines`, `routine_tasks`) with
    per-task egg-timer durations and star rewards; one `routine_run` per routine per local day
    (family TZ), server-clock `task_runs` so timers resume across restarts.
  - **Approvals**: unified parent sign-off queue for routine runs AND one-off chores, with
    photo-proof attachment, race-safe decide, and one-pending-per-subject enforced by a partial
    unique index. Three paths: on-tablet PIN (`Bun.password`, 5-fail → 5-min lockout persisted on
    the family row), remote bearer token (parent phone page), kid photo proof.
  - **Stars ledger**: `star_events` is truth, `children.star_balance` is the tally (invariant-
    tested). Approving credits stars; **allowance day** (`POST /children/:id/payout`) converts the
    whole balance into ONE Cashlink (`kind: 'stars'`) through the existing non-custodial mint
    path. Claiming it credits the NIM tally but never touches the demo streak mechanic.
  - **Media**: kid uploads (hatch photos, task icons, proof shots, sounds) under `MEDIA_DIR`
    (self-hosted; 5 MB cap, mime whitelist) + per-kid customization prefs (`kid_prefs`) and the
    `/api/catalog` seam for the Phase-D art manifest.
  - **Parent endpoints**: `/parent/verify-pin`, `/parent/overview`; `parent-token.ts` script
    mints the phone's magic URL. Notifications via ntfy/webhook (`families.notify_url`),
    fire-and-forget.
  - **Kiosk groundwork**: `devices`, `lock_windows`, `lock_overrides`, `parent_tokens` tables +
    repo layer (state machine + `/device/state` land in Phase B).
  - Seed: `SEED_FAMILY=1 bun run seed` seeds family mode (2 kids, morning/bedtime routines,
    lock windows, PIN via `SEED_PIN`).

## [0.6.4] - 2026-06-22
### Added
- **Streak bonus mechanic (#17) — mechanics only (surfacing is Andjroo's call).** When a claimed
  chore/lesson payout pushes a kid's `streak_count` onto a milestone (default **every 7**, env
  `STREAK_MILESTONE_EVERY`), the app mints an extra **bonus Cashlink** (default **1 NIM**, env
  `STREAK_BONUS_LUNA`) through the same non-custodial payout path, recorded with a distinct
  `kind: 'bonus'` and a `"{n}-streak bonus"` message for history attribution.
  - Bonuses count toward the weekly leaderboard (`weeklyEarnings` now includes `'bonus'`), so
    they surface there organically with no new UI.
  - Claiming a bonus credits the tally via `adjustBalance` only — it does **not** advance the
    streak, so milestones never cascade.
  - Bonus minting is best-effort (try/catch): a bonus that fails to mint never breaks the chore
    claim that triggered it.
  - `repo.resetStreak(childId)` + a **rejected chore now breaks the streak** (the missing reset
    rule the issue called for).
- **Defaults flagged for Andjroo:** milestone interval (7) and bonus amount (1 NIM) are
  env-overridable placeholders; the parent-configurable values + prominent surfacing are his call.

## [0.6.3] - 2026-06-22
### Added
- **Multi-kid weekly leaderboard (#19).** A "This week 🏆" card on the parent view ranks the
  kids by NIM earned in the last 7 days (chores + lessons; peer sends excluded). New
  `repo.weeklyEarnings(familyId, sinceMs)` powers it and the dashboard now returns a per-child
  `weekLuna`. Mechanics only — labels + amounts, no PII (COPPA-safe). Shows only with ≥2 kids
  and once someone has actually earned this week, so there's no empty all-zero board.
- i18n: `app.leaderboardTitle` across all 5 locales (en/es/de/fr/pt).

## [0.6.2] - 2026-06-22
### Added
- **Self-hosted Mulish brand font (#13).** Vendored a single Mulish **variable** woff2
  (`public/fonts/mulish-latin-wght-normal.woff2`, ~30KB, weights 200–1000) with a local
  `@font-face`, and added it to the service-worker SHELL precache. The brand font now
  renders reliably under a strict Nimiq Pay mini-app CSP and **fully offline**, instead of
  silently degrading to system-ui when the Google Fonts CDN is blocked.
### Changed
- The Google Fonts `<link>` stays as progressive enhancement; the local `@font-face` wins
  (declared after it) so CSP/offline always gets real Mulish.
- Bumped the SW cache to `v6` and refreshed the stale SHELL cache-bust strings
  (`app.css?v=7`, `app.js?v=6`) so an installed PWA picks up current assets.

## [0.6.1] - 2026-06-22
### Changed
- **Brand polish to clear `nq lint` (nimiq-ui v1.4.1), preserving Direction A.** No redesign —
  just brings the existing UI into full brand compliance ahead of wiring `nq lint` as the PR gate (#32).
  - Replaced the 🪙 emoji header mark with the **verbatim Nimiq hexagon SVG** (rule 4 / real assets).
    This also removes the gold-tinted tile background, the off-brand **gold glow shadow**
    (`rgba(233,178,19,.4)`), and the low-contrast white-on-gold glyph in one go.
  - Fixed the **off-palette `#8a6400` (≈brown)** text on the `.banner` / `.microline` strips —
    now navy ink (`var(--ink)`) on the warm gold tint (on-palette, high contrast).
  - Snapped incidental **14px radii → 12px** (icon-tile scale). Kept `--r-card: 22px` (Direction A's
    kid-warm round — Andjroo's look-and-feel call).
  - Bumped the **language-switcher tap targets to ≥36px** on narrow phones (a11y).
  - Added `title` attributes to truncating **chore titles** so the full text stays accessible.
- Closes #31.

## [0.6.0] - 2026-06-20
### Changed
- **Off the broken `@nimiq/core` light-client; onto the shared `nimiq-settlement` RPC path
  (ADR 0003 swap landed).** `src/nimiq/client.ts` no longer calls `Client.create()` /
  `waitForConsensusEstablished()` (which cannot establish consensus under Bun). Network ops
  now go over HTTP JSON-RPC via `nimiq-settlement@v0.2.0` (`createRpcSender`): head height
  (`getBlockNumber`), broadcast (`sendRawTransaction`), and balance/claim detection
  (`getAccountByAddress`). `@nimiq/core` is now used for **offline crypto only** (keys,
  addresses, cashlink codec, `TransactionBuilder` / signing).
- `claims.ts` polls the cashlink balance via `client.getBalance()` instead of the
  light-client `getAccount()`.
### Added
- `NIMIQ_RPC_URL` (Albatross node endpoint, defaults to `http://127.0.0.1:8648`) and
  `NIMIQ_NETWORK_ID` config. `networkId` is now an **empirical item to verify on the live
  testnet run** (defaults TestAlbatross=5 / MainAlbatross=24) — added to the ADR 0003 list.
### Notes
- SIM remains the default demo and is unaffected; the wallet providers (dev / nimiq-pay) are
  still never hit in SIM. The live broadcast path still needs the funded-key Phase 4 run to
  confirm `networkId` + the other single-constant empirical items.

## [0.5.0] - 2026-06-10
### Added
- **Learn-to-Earn (Brilliant.org offshoot, PRD §Offshoot).** Chores now have a `kind`:
  `'chore'` (household task) or `'lesson'` (finish a Brilliant-style math/coding lesson).
  Lesson chores carry a `subject` (`math` | `coding`) and a `reward_shape`
  (`per-lesson` | `per-streak-day` | `per-milestone`, default per-lesson). Completion is
  **parent-attested** (MVP) and pays through the **identical Cashlink path** as any chore —
  payout parity is test-enforced.
- **Earnings history split** — `earningsByKind` aggregates claimed payouts per chore kind;
  `/api/children/:id` and `/api/dashboard` now return `earnings: { choreLuna, learningLuna }`,
  and the kid screen shows "from chores · from learning" once any learning NIM lands.
- Add-task sheet: Chore/Lesson toggle, subject + payout-shape pickers (plain temporary UI);
  lesson rows are tagged 📚 with their subject on both parent and kid views.
- Additive SQLite migration helper in `initDb` (ALTERs for pre-0.5 databases).
- 7 new tests (`src/learn-to-earn.test.ts`): chore-kind model, route validation
  (invalid kind/subject/reward-shape rejected, back-compat default), payout parity
  chore↔lesson, earnings split (pending + peer-gift exclusion). Suite: 19 tests.

## [0.4.0] - 2026-05-30
### Added
- **On-chain "🔍 Receipt" disclosure** — surfaces the real cashlink address + funding tx hash
  (+ block-explorer link in live mode) on the cashlink sheet and every Paid/Claimed chore. Makes
  the Nimiq edge visible without putting jargon on the main surface.
- Sub-cent micro-reward call-out on small payouts ("the fee is a fraction of a cent").
- Real-mode claim robustness: manual "Check again", live status note, 60s auto-poll cutoff.
### Fixed (from adversarial review)
- **Multi-claim:** the kid screen now renders a card for *every* unclaimed payout (was only the first).
- **Correct-kid handoff:** approve now threads the earning child, so the handoff sheet shows their
  name and the post-claim balance pops on the right kid (was literal "your kid" / wrong screen).
- **Peer-send safety:** atomic `tryDebit` (no negative balance / double-spend race) + refund on mint
  failure; claiming a peer gift no longer double-credits.
- **Secret hygiene:** the bearer cashlink URL is no longer bulk-returned in the children payload —
  fetched per-cashlink via `/cashlinks/:id/link` only when showing a claim QR.
- **Cache-busting:** SW network-first for HTML+CSS+JS, resilient precache, gated controllerchange
  reload (no first-load reload); `Cache-Control: no-cache` on the shell from the server.
- Friendly, jargon-free error/empty/cold-start copy; codec decode now also accepts `.` padding.
### Notes
- Discovered `@nimiq/core@2.5.1`'s **nodejs** light client crashes under Bun (worker bug), so live
  on-chain network ops must run client-side or via RPC — tracked for the real-testnet swap. The SIM
  demo (default) is unaffected and runs the full loop. Crypto primitives + codec work in Bun.

## [0.3.0] - 2026-05-30
### Added
- **Full demo loop, end-to-end and runnable.** Parent approves a chore → a real-format Nimiq
  Cashlink is minted from the parent wallet → kid claims → balance + streak update, with confetti
  (closes #2, #4; advances #3, #5, #6).
- Verified Cashlink codec (`src/nimiq/cashlink-codec.ts`) — byte-format-checked against nimiq/hub
  and round-tripped against real `@nimiq/core@2.5.1` keypairs (the embedded key rebuilds the funded
  address, exactly as the wallet does). See `docs/NIMIQ-CASHLINK-REFERENCE.md`.
- Wallet provider seam (`src/wallet/`): `WalletProvider` interface + `DevProvider` (funded testnet
  key), `SimProvider` (offline, full UX with no faucet), `NimiqPayProvider` (June-3 SDK stub).
- Data layer + routes: `families`/`children` (COPPA: label+emoji only)/`chores`/`cashlinks`;
  `dashboard`, chore submit/approve(→mint)/reject, cashlink status poll + sim-claim, peer "send to a friend".
- PWA: Nimiq-branded vanilla UI (parent + kid views), offline QR (vendored), confetti, add-child/
  add-chore/cashlink/send sheets, cache-busting service worker + `manifest.webmanifest` + SVG icon.
- Tests (9) + `bun run seed`. All source files < 330 lines.
### Changed
- Reorganized into `src/{nimiq,wallet,routes}` + `public/js`; `payouts` table → `cashlinks`.

## [0.1.0] - 2026-05-30
### Added
- Bun + Hono server with `/health` route and static file serving (closes #1)
- `bun:sqlite` schema: `children` (label + emoji only, COPPA-safe), `chores`, `payouts` tables
- Demo data: Jake + Lily with 5 chores across both
- Vanilla PWA shell: child picker, chore list, Mark Done flow
- Cashlink delivery bottom-sheet with QR placeholder and kid hand-off UX
- PWA manifest + offline-first service worker
- Stub Nimiq Pay provider + Cashlink mint (fully wired in #2 + #4)
- TypeScript config for Bun bundler module resolution
