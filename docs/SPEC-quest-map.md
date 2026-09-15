# SPEC: the quest map (the kid's day as a trail, on a tablet)

**Status: spec. Nothing built.** Written 2026-08-08 from Andjroo's dictation, after his kids
reviewed the app with him.

## Where this came from

Andjroo's daughter described the app back to him as a **treasure hunt**, not a list. Her frame,
as relayed:

* the day is a run of activities you move through, and then you get paid, "kind of like Duolingo"
* three of them are **mandatory**: eat breakfast, brush your teeth, get your clothes on
* one of them is a **side quest**: put your dishes away after breakfast. Not required to finish
  the day, pays a bonus if you do it
* at the end there is a **treasure chest** that opens, and you watch the money land in it

And the frame around all of it, in Andjroo's words: the app has been designed on his phone, which
is right for the parent app, but the kid app lives on a tablet and needs to be laid out for a
wide screen instead of scaled up from a 390px column.

## The three decisions already made

1. **The trail runs horizontally, left to right.** The chest sits at the right end and the view
   pans right as steps complete. Chosen 2026-08-08 over a vertical Duolingo column (wastes the
   width of a tablet) and a meandering board-game map.
2. **The list view stays.** Andjroo: "it's fine to have that version available to the kid." The
   trail is a *presentation of the same run*, not a replacement for anything underneath it.
3. **The trail is per routine, not per day.** A routine is already an ordered set of steps with
   one run per day. Chores, practices and goal ladders are the other three shapes on the Today
   screen and none of them is a sequence. See "Out of scope".

## What already exists, and why this is smaller than it looks

Her whole description is the `routines` feature, drawn differently.

| Her words | The thing that already exists |
|---|---|
| the activities you do in order | `routine_tasks`, ordered by `position` (`schema.sql:182`) |
| today's run of them | `routine_runs`, one per routine per local day (`schema.sql:198`) |
| which ones you have done | `task_runs`, `pending` to `running` to `done`/`skipped` (`schema.sql:210`) |
| getting paid at the end | `approvals` with `subject_kind='routine_run'` (`schema.sql:221`) |
| what the chest holds | `repo-routines.runRewardLuna` (`src/repo-routines.ts:216`) |

The kid app already walks this: `public/kid/js/chart.js` draws the step cards
(`todayGroups`, `taskCard`) and `public/kid/js/flow.js` runs a step with its timer
(`enterTimer`, `renderTask`, `finishTask`). **The quest map replaces the drawing, not the flow.**
Tapping a node still lands in the same timer screen.

### The money already works for side quests

`runRewardLuna` sums `reward_luna` over the task runs that read `done` at approval time. An
optional step that gets done adds its own reward. One that does not get done adds nothing.
**No payment code has to change to introduce a bonus step**, and that is worth stating loudly,
because it is the part that would otherwise be risky.

The guards around that sum stay exactly as they are, and they are the reason the feature is
safe to build:

* `runSubmitted` (`src/routes/routines.ts:369`) freezes a run once it leaves the kid's hands.
* `taskFinished` (`src/routes/routines.ts:377`) stops a tablet flipping a finished step back to
  `done` and adding its reward to the payout.

## The one thing that genuinely has to change

`allTasksFinished` (`src/repo-routines.ts:200`) counts rows still in `('pending','running')`, and
`completeRunIfFinished` (`src/routes/routines.ts:33`) submits the run when that count hits zero.

A bonus step nobody chose to do sits at `pending` forever, so **the run would never finish and
the chest would never open.** That is the whole of the new logic.

### Schema

```sql
ALTER TABLE routine_tasks ADD COLUMN optional INTEGER NOT NULL DEFAULT 0;
```

`0` for every step that exists today, so nothing changes for a routine with no side quest.

### The completion rule, and the decision inside it

`allTasksFinished` becomes "every **required** step is finished." But that raises a real question:
what happens to a bonus step the kid has not done yet at the moment the last required one lands?

If the run auto-submits, `runSubmitted` returns `409 run_submitted` on any further task write, so
**finishing your teeth would silently close the door on the dishes.** The bonus would be a trap.

**Recommendation: the kid ends the run deliberately.** Concretely:

* if any optional step is still open when the last required one finishes, the run does **not**
  auto-submit. The chest lights up at the end of the trail and a tap on it submits.
* if there is no optional step open, auto-submit stays exactly as it is today. A routine without
  side quests behaves identically to now.
* at submit, any still-open optional step is written to a terminal, unpaid state.

This also earns its keep as game design: opening the chest becomes a thing the kid *does*, not
something that happens to them.

⚠️ **Open decision: which terminal state.** Reusing `skipped` costs no migration and is already
unpaid, but `skipped` currently means "a parent excused this" (the `/skip` route is parent
authed, and `taskFinished` is deliberately asymmetric about it, `src/routes/routines.ts:371-377`).
Overloading it means the parent board can no longer tell "I excused this" from "they left the
bonus on the table". The alternative is a new `passed` state, which costs a state and touches
every read that switches on task status. **Andjroo's call, or the implementer's if he does not
care.** Either way both states are unpaid, so no money outcome depends on the answer.

## Where a parent authors a side quest

The parent board already edits routines and their steps end to end: `routinesCards` and
`sheetStep` in `public/parent/views-board.js` (wired at lines 184 to 192). The bonus is one
toggle inside `sheetStep`, next to duration and reward.

Copy, not final: **"Extra credit"** with a sub-line like "they still finish the day without it."
Avoid the word "optional", which reads to a kid as "does not matter."

## The chest must not lie

**The money moves when the parent says yes, not when the kid finishes.** A chest that bursts open
with coins the second the last step is done is showing a kid money that has not moved, and the
whole app is built the other way (`completeRunIfFinished` opens an approval and pings the parent,
it does not pay).

So the chest has two beats:

1. **Kid finishes the trail.** The chest is shut, with a "waiting for a grown up" state on it and
   the amount visible but dim. This is the same story the approval notice already tells.
2. **Parent approves.** The lid opens and the NIM hexagons drop in, one per earned step, and the
   balance counts up. Andjroo's own picture: the Nimiq logo dropping into the box, so the kid sees
   it load up.

If the parent rejects, the existing behaviour already does the right thing: the run goes back to
`in_progress` with its task states intact, so the trail reopens with the rejected step live again.

**A bonus step that was done must be visibly distinct in the chest animation.** That is the entire
point of doing it. One extra hexagon with its own sparkle, not a bigger number.

## Layout

### Target

Samsung Galaxy Tab A11+ (SM-X230), 11 inch, in **landscape**. Design against roughly
**1024 to 1280 CSS px wide by 700 to 800 tall**, then measure the real device before locking any
number: WebView reports CSS pixels at the panel's density, not its 1920x1200 physical resolution,
and nobody has held this tablet yet (it is not bought as of 2026-08-08).

### What exists today

Nothing that helps. `public/kid/css/chart.css:526` is a **scale-up of the phone design**, and says
so: "tablet scale-up (>=768px keeps the 390 design, bigger)". `public/kid/css/phone.css:1-10` says
the same thing from the other side. Every kid screen is a single centred column at every width.

**So this is the first landscape layout in the app, and it should be built as one**, not as more
`min-width` overrides on the column. Recommend a new `public/kid/css/quest.css` and a new
`public/kid/js/quest.js` beside `chart.js`, so the CI file-size guard (800 lines) stays clear and
the list view keeps working untouched.

### The trail

```
┌──────────────────────────────────────────────────────────────┐
│  Sam's morning                    ●●○○  2 of 4               │
│                                                              │
│    🥣───────────🪥───────────👕──────────────▣               │
│   done         HERE         next            chest            │
│                 ╰──✨ put away the dishes  +2 NIM            │
│                                                              │
│                     the view pans right ▶                    │
└──────────────────────────────────────────────────────────────┘
```

* **Never scrolls vertically.** Horizontal pan only, and it auto centres the current node when a
  step completes. A kid should never have to find where they are.
* **Node states:** done, here, next, locked, bonus, chest. `here` is the only primary action on
  the screen (house rule: one primary action per screen).
* **A bonus hangs below the line on a short spur**, off the main path, so its shape says "extra"
  before any words do. It attaches to the step it follows (`position` of the required step it
  comes after), which is how she described it: the dishes come off the back of breakfast.
* **The chest is always partly visible** at the right edge, however long the trail is. Seeing
  where you are going is the mechanic.
* Art: the existing kid art system (hero PNGs, sticker discs, the egg rig) already sets the
  house style. The trail nodes should be the job icons that already exist (`jobIcon` in
  `chart.js:256`), not new emoji.

### Open layout questions

* **Orientation lock.** Should the kid app pin to landscape on the tablet? The kiosk wrapper can
  do it (`Andjroo111/kidkiosk-android`). Locking makes every layout decision below simpler.
  Not locking means the trail needs a portrait fallback, which is the vertical column we just
  rejected.
* **What else is on the screen.** In landscape there is room beside the trail for the balance,
  the calendar strip, or the Treasure Box. Andjroo has not said, and filling the space is not
  automatically right: a trail with room around it reads as a journey, a trail crowded by widgets
  reads as a toolbar.
* **More than one routine in a day.** Morning and evening are two runs. Two trails stacked, a
  segmented switch, or the day as one longer trail with a break in it. Recommend two trails and
  ship the morning one first.

## Out of scope, deliberately

Practices, goal ladders, the calendar, the Treasure Box, the money screen, the parent app's own
layout. If the trail works, **practices are the obvious second candidate** (a practice already
has ordered steps in `practice_steps`), and goal ladders are the third (a ladder is literally a
sequence of rungs, and it already draws as one).

## How we would know it works

* **A money test first, before any pixels.** A run with one optional step done pays required plus
  bonus. The same run with the optional step untouched pays required only. A rejected run reopens
  and pays nothing until it is approved again. These are assertions against `runRewardLuna` and
  the approval path, in `src/routines.test.ts` style.
* **The completion test:** a routine with an open optional step does not auto-submit. The same
  routine with no optional steps still auto-submits, exactly as today.
* **A rendered check at 1280x800 landscape**, in the shape of `tools/goal-ladder.mjs` (26 checks,
  0 console errors): the trail does not scroll vertically, the current node is centred, the chest
  is on screen, the bonus spur is below the line, and the chest does not open before approval.
* **On the tablet, in a kid's hands.** Neither kid has used this app on the hardware it is for.
  That is the only test that decides whether the trail is better than the list.
