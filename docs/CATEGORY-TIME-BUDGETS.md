# Per-category time budgets — design spec

Status: **DRAFT for Andjroo.** Nothing in this document is built except the slice named in
§7, which is a nullable column and a flagged parent control that no runtime code reads.

The ask, verbatim: *per-category time budgets, where finishing educational work unlocks
games and more watching time.*

---

## 1. What exists today (verified in code, not remembered)

| Piece | Where | Behaviour |
|---|---|---|
| Base daily minutes | `children.daily_screen_min` | `0` means **unmetered**, never "no time left" |
| Earned-minute cap | `children.max_earned_min` | Ceiling on what a kid can add to one day |
| The day's meter | `screen_usage(child_id, local_day, used_sec, earned_sec)` | One row per kid per local day |
| The budget sum | `routes/lock.ts:109` | `budgetSec = daily_screen_min*60 + earned_sec` |
| The ruling | `lock-machine.ts` | override → curfew → routine → budget → UNLOCKED |
| The only grantor of earned time | `routes/store.ts:610` | A Treasure Box `screen_time` **purchase**. Cap checked at `store.ts:607`, refused before the charge |
| The tick | `routes/lock.ts:294` | `POST /device/usage` accepts **`{deltaSec}` only** |
| Burn rule | wrapper | screen on AND unlocked AND kiosk not in front AND no override |
| Shelves | `store_categories` | Title, icon, sort, `family_id`. **No machine-readable kind** |
| App launching | `deviceStateCore` | `devices.allowed_apps` UNION `listUnlocks(childId,'app')` |

Two facts do most of the work in this design:

- **The "earn screen time" plumbing already exists.** `earned_sec` and `addEarnedSec()` are
  live and capped. What is missing is a *second grantor* — today only spending NIM grants it.
- **The tick carries no package.** `POST /device/usage` receives a bare `deltaSec`. The server
  cannot know whether that minute was Minecraft or Khan Academy. This is the single fact that
  decides how expensive the "per-category" half is.

---

## 2. The ask is three features, not one

Splitting it matters, because they differ by ~an order of magnitude in cost.

**(A) Finishing educational work grants minutes.**
A second caller of `addEarnedSec()`, fired when a routine run is approved. Reuses the existing
cap, the existing meter, the existing precedence. **No wrapper change. No schema change to
`screen_usage`.**

**(B) Finishing educational work makes games launchable.**
`kid_unlocks` rows (kind `'app'`) are what make a package launchable, and today they are
**permanent** — a purchase grants one forever. "Unlocked because you did your reading, until
bedtime" needs an *expiring* unlock, which that table has no concept of.

**(C) Time is budgeted separately per category.**
Requires the wrapper to report the foreground package with every tick, the server to map
package → category, and `screen_usage` to become per-category. It also breaks an assumption
in the ruling: today "locked" is a whole-tablet verdict. Per-category budgets mean the tablet
must permit *some* apps and refuse others at the same instant — expressible via the LockTask
allowlist, but `LockState` has no way to say it.

**Cost, honestly:** A is small and self-contained. B is medium. **C is its own project**: a
kidkiosk-android change, a new signed APK on both tablets, a schema migration on live data,
and a rework of the module the codebase is most careful about.

---

## 3. Recommendation

**Ship A first, on its own.** It delivers the sentence Andjroo actually described the value of
— *do your learning, get more time* — without touching the wrapper, the APK, or the ruling.

Then B, which is the "unlocks games" half and needs only an expiry column.

**Do not start C until A and B have been lived with.** There is a real chance they turn out to
be the whole ask: if finishing schoolwork already buys both minutes and game access, separate
per-category meters may be solving a problem the family no longer has. C's cost is mostly
irreversible (an APK on two tablets, a migration on the live DB), so it is the worst candidate
for a guess.

---

## 4. Design — (A) earn by doing

**Trigger.** On routine-run **approval**, not completion. The codebase already treats
`approved` as the settling event for stars and NIM (`repo-routines.ts:244`), and using the
same point means a kid cannot self-grant by tapping "done".

**Amount.** Per-task, not per-routine: `routine_tasks.reward_screen_sec` (nullable, default
NULL = grants nothing). Mirrors the existing `reward_stars` / `reward_luna` columns exactly,
so the parent UI, the approval maths and the ledger all have a shape to copy.

**Cap.** Reuse `children.max_earned_min` unchanged. Earned-by-doing and bought-with-NIM draw
on the **same** ceiling — otherwise the cap stops meaning "the most extra screen this kid gets
today", which is the only thing it is for.

**Refusal, not clamping.** `store.ts:607` refuses a purchase that would breach the cap rather
than granting a partial one. Earning should **clamp** instead — a kid who does their reading
should not have the approval fail because they are 3 minutes from the ceiling. Different
answer from the purchase path, and deliberately so: one is a transaction, the other is a
reward. Worth a line in the ledger when it clamps.

**Idempotency.** Approval can be re-fired (`approvals` rows are re-readable). The grant must be
keyed on the approval id, or a double-tap mints minutes. This is the one place A can go wrong
quietly.

---

## 5. Design — (B) earning unlocks games

Add `kid_unlocks.expires_at INTEGER NULL`. `NULL` = permanent, which is every existing row, so
the migration is a no-op for purchases.

`listUnlocks(childId,'app')` filters expired rows. **The union in `deviceStateCore` is the
design and stays the design** — a granted unlock must never be written into
`devices.allowed_apps`, which is replaced wholesale on every parent save (this is already
mutation-tested; see the guard on that line).

Expiry should be **end of the local day**, not "+N minutes". A wall-clock expiry the kid can
predict beats a countdown they cannot see, and it matches how `earned_sec` already dies at
midnight.

---

## 6. Design — (C) per-category budgets, if it is ever built

Recorded so the shape is known, not to be built now.

1. **Wrapper**: `POST /device/usage` gains `pkg` (the foreground package at tick time). Old
   clients keep sending bare `deltaSec`; those ticks fall to an `uncategorised` bucket, so a
   tablet on an old APK degrades to today's behaviour rather than breaking.
2. **Mapping**: package → category via the shelf the app was bought from
   (`store_items.payload.pkg` → `category_id` → `store_categories.budget_kind`). This is why
   §7's column is the prerequisite.
3. **Meter**: `screen_usage` gains `category` and its primary key becomes
   `(child_id, local_day, category)`. The existing rows migrate to `category='all'`.
4. **Ruling**: `LOCKED_BUDGET` can no longer be a whole-tablet state. Either `LockResult`
   grows a per-category allowlist, or the wrapper asks per-package. **This is the part to
   design carefully** — `lock-machine.ts` is pure and table-tested precisely because a wrong
   answer here is a tablet open past bedtime.

**Known trap for C:** the meter's rule is *screen on AND unlocked AND kiosk NOT in front*.
Time in the Hatch app itself is deliberately not screen time ("doing chores is not screen
time"). Per-category accounting must preserve that, or doing homework starts billing the
learning budget.

---

## 7. The slice built now

**`store_categories.budget_kind TEXT NULL`** — `NULL` | `'utility'` | `'learning'` | `'games'`,
matching the taxonomy already decided (utility free / learning free / games priced).

- Nullable, defaults NULL, **read by no runtime code**. Purely descriptive today.
- Parent UI control to set it, behind flag `FEATURE_CATEGORY_BUDGETS` (default off).
- It is the prerequisite for A's parent UI, B's grant rule and C's mapping, and it commits to
  none of their shapes.

Reversible: dropping the flag hides the control; the column is inert either way.

---

## 8. Open questions for Andjroo

1. **What counts as "educational work"** — a shelf tagged `learning`, or specific routines
   (Mia's piano, reading)? A's trigger is a routine, but the taxonomy is a shelf. These are
   different objects and the spec currently assumes routines.
2. **How many minutes** is a piece of homework worth, and what is `max_earned_min` today for
   each kid? (Both kids are currently `daily_screen_min`-metered; the numbers should be set
   deliberately rather than inherited.)
3. **Should earned minutes survive to tomorrow?** Spec says no — they die at midnight with
   `earned_sec`. Banking changes the incentive from "do it today" to "grind on Sunday".
