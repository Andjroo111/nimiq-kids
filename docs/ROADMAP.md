# nimiq.kids Roadmap

What is live today, what my own family tests next, and what only becomes a promise after it
survives our kitchen table. Written 2026-07-31, updated 2026-09-18. This mirrors the roadmap on
the homepage (`public/site/index.html`); if the two ever disagree, the homepage is the one people
read.

## Live now

### A chore app built on Nimiq

Not an allowance app. Kids do chores, routines and activities, and the parent rewards them for
finishing.

It runs as a mini app inside the **Nimiq Pay app**, and just as well in **any plain browser**,
because the wallet is built into the page itself. A kid opens a link and their money is there: no
app store, no extension, no seed phrase, parent-managed underneath. Five languages ship in
`src/locales/` (de, en, es, fr, pt), with amounts shown in 14 display currencies at live rates.

The loop that makes it work:

1. The parent funds the family budget.
2. A kid finishes a chore, a routine or an activity.
3. The parent approves, and the payout funds a claim link (a Nimiq Cashlink) the kid claims on
   their own device.
4. The kid spends it in the **Treasure Box** on things the parent already gives them anyway:
   screen time, a new toy, a trip to the pool.
5. That spend returns to the family wallet, which funds the next round.

Nobody in the family loses a dollar, and your family runs its own mini economy: checking a
balance, saving toward something, deciding when to spend.

Also shipped: multi-household isolation (test-proven), a per-family payout budget on the shared
hot wallet, a 6-digit pairing code for tablets or any device a magic link cannot reach, a weekly
sticker chart, and self-serve onboarding in a few taps. MIT licensed.

**One automatic behaviour, stated plainly.** `STREAK_BONUS_LUNA` (`src/routes/cashlinks.ts`)
defaults to 1 NIM and `STREAK_MILESTONE_EVERY` to 7, so every seventh claimed payout mints one
extra bonus link without a fresh parent tap. It is capped by the same family budget, it is
best-effort so a failed bonus never breaks a claim, and setting `STREAK_BONUS_LUNA=0` switches it
off. This is why the copy says the parent "says yes before any job pays" rather than
"approves every transaction".

## How to try it

### Six steps for you, three picks for your kid

Both apps open on the same climb the goal ladders already use: hexagon steps, one ask per
screen, a prize at the top. Two separate things ride in it, and they stay apart: chores are the
everyday loop (jobs on the board, done today, approved, paid), and a goal is its own ladder of
steps to manage with the prize at the top.

The parent's path, on the phone, ends by setting the kid's first goal:

1. Welcome. Get started, or I have a code.
2. Your name, what the kids call you.
3. Kid's name. One field; more kids later.
4. Wallet. Server custody lets you skip it; parent custody requires it.
5. First goal. Three everyday jobs go on the board on their own; here the parent picks a prize
   and a goal template (ride the bike, tie your shoes), a skill in steps, never the chores.
6. Notifications. Allow, or later.
7. Family ready. The egg hatches, then the pairing code for the tablet.

Screens 2 to 6 still collect into the one `POST` in `routes/onboard.ts`; the rate brake and the
custody read stay. Under 90 seconds.

The kid's path, on the tablet, lands on that goal:

1. Hi, Sam. One button.
2. A face for their wallet: nine identicons, one tap, one way. It is the wallet address and the
   kid sees it.
3. Their character: 21 heroes on hex tiles, re-pickable later.
4. Their place: the 15 timer backgrounds, skippable.
5. The goal path the parent set, the template's first step saying START, the prize in view;
   the three everyday jobs wait on the board behind it.

Two more things ride with it. The whole app is on its own paint set: blurple is the action,
grass is done, yolk is the prize, coral is the alert, the line is every letter, paper is the
ground. Nimiq navy and gold stay on the Nimiq hex logo only; the characters keep their own
colours. And the characters animate through both climbs as their animations land: the opener on
both apps is the wordmark plus whale, tiger and frog, and the kid's hero reacts on tap, celebrates
on confirm, and waits beside the START node.

## Next

What my own family tests first.

### Our own mini economy, for real

My kids have been running this app on their own tablets while I built on it and fixed what
broke. Next month is the first month our family runs its own mini economy on it, start to
finish. The feedback button is live in both apps, in the corner menu.

The point is to see what breaks and hear what they liked and what they did not. Nothing further
down this document is allowed to jump ahead of what that month turns up.

### Recurring allowance and bonuses

An allowance the parent sets and controls, that repeats, plus bonuses. Under the hood that may
use scheduled transactions or a small escrow design; whichever ships will be documented here.

## Then

### A grassroots push to get families on it

Most crypto asks people to invest first. This solves a problem first.

I have young kids, so I am around parents constantly, through their activities, my small business,
and my own friends with kids. I hand them a cashlink and ask them to try it at home. Real families
first, then an App Store listing, then marketing once there is something to point at.

## Later

### Creator drops, the way Fortnite does it

Sticker packs, backgrounds and characters, released in seasons. Outside creators can submit a
pack. I approve it into the app, then each parent decides whether their own kid can buy it. Two
gates before anything reaches a kid.

### Paying kids for learning too (research phase)

Apps that teach reading, math, music and coding: Ello, Khan Academy Kids, Yousician. Nothing that
is only a game.

The goal is to use **HTLCs** (hash time locked contracts) so the reward releases once the criteria
are met, rather than requiring a parent tap for every lesson.

This is genuinely a research phase and the page says so. Known constraint: Ello has no public
API, and the only integration hook found so far is its weekly parent-report emails. Nothing here
is committed.

## The rules that never change

- No ads, no tracking, nothing predatory.
- The parent funds everything and says yes before any job pays.
- It stays open source under MIT.

## Guardrails

Permanent, and not traded away for a deadline.

1. **Parent-managed allowance.** The parent funds, approves, and can revoke. Kids never hold keys
   beyond a one-shot claim link. Never described as a "crypto wallet for kids". Any automatic
   behaviour, including the streak bonus above, must be disclosed and switchable off.
2. **Plain-language privacy.** No accounts for kids, no tracking, minimal data, on-device where
   possible, stated in words a parent can actually read.
3. **Real, nameable beta families.** No farmed usage, no seeded numbers, no demo families dressed
   up as users.
4. **No simulated settlement path** reachable in a shipped build.

## Ideas under consideration, not commitments

Nothing here is promised. It is written down so the thinking is public.

- Invite-a-family bonus for both households after the invited family's first completed week. The
  share link and attribution already ship; the bonus does not.
- Shareable milestone cards a parent can post.
- Grandparent gifting via claim links, so the giver needs no wallet.
- Family versus family chore-streak challenges, device-based, no kid accounts.
- Seasonal allowance match promotions.
- A dog-care chore pack (feed, walk, train), cross-promoted through my dog-training business.
- School or sports-team task boards. A much bigger custody design; not before the family core is
  proven.
- More assets over time (stablecoins, Bitcoin), only once the integration is real. This was
  previously written here as a headline promise and has been demoted on purpose.
- Sticker album, hatchling evolution, streak shields, payday notes, goal jars, parent match, wish
  list, photo proof, open chore packs, co-parent mode.
