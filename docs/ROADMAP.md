# nimiq.kids Roadmap

What is live, what a month with my own kids changed, and what comes next. Rewritten 2026-09-15
for Cycle II of the Mini Apps Competition; the 2026-07-31 version is in git history. This mirrors
the roadmap on the homepage; if the two ever disagree, the homepage is the one people read.

## Live now

Kids do chores, routines, practices and goals. The parent prices them, approves them, and pays in
NIM. The kid spends it in the **Treasure Box** on things the parent already gives them anyway:
screen time, a toy, a trip to the pool. That spend returns to the family wallet, which funds the
next round. Nobody in the family loses a dollar, and the kid is learning to be their own bank:
checking a balance, saving toward something, deciding when to spend.

It runs as a mini app inside **Nimiq Pay**, and just as well in any plain browser, because the
wallet is built into the page. A kid opens a link and their money is there: no app store, no
extension, no seed phrase, parent-managed underneath. Five languages ship in `src/locales/` (de,
en, es, fr, pt), with amounts shown in 14 display currencies at live rates. MIT licensed.

### Shipped since the July roadmap

| shipped | version | what it is |
|---|---|---|
| Staking through the approval queue | 0.44 | A kid asks to stake, the parent approves, the Earned chart reads the rewards |
| Direct gifts, explorer links on every row | 0.73 | A parent can send a kid NIM outside a chore; every transaction links to the block explorer |
| Parent-owned kid addresses | 0.77 | A kid's address is one the parent's wallet derives; the server never holds a kid's key |
| Feedback button | 0.98 | Bug reports from the tablet and the parent app, kid data stripped before they leave the device |
| Real balance on the kid home screen | 0.99 | The kid sees their NIM, "My prizes" in the Treasure Box, the parent sees "What they bought" |
| Sound | 0.100 to 0.102 | The hatch, the confetti, the last five seconds of a timer counted out loud |
| Practices | 0.102 to 0.117 | Piano, reading: exercises the kid ticks, a how-to, a video on the kid's own card, paid like a chore |
| One trip to the wallet | 0.103 | Every kid gets an address in a single Nimiq Pay round trip |
| Pack pricing per household | 0.106 | A parent sets what a sticker pack costs their own family |
| More than one grown-up | 0.107 | Each pays from their own wallet |
| Goals | 0.109 to 0.120 | A ladder the kid climbs one priced rung at a time, drawn as a climb path |
| Sticker themes | 0.110, 0.117 | A finished ladder earns a theme (Dragons, Robots); a finished theme opens a background. Earned, never sold |
| The tablet, seen from the parent's phone | 0.113 | What the kid's tablet is doing right now |
| Games on the board | 0.117 | Parent-approved apps in a Play / Learn / Make / Watch / Tools grid |
| Screen time | 0.118 | A daily meter, sittings (play N minutes, rest M), a bedtime lock that still lets the kid do their jobs |
| Battery | 0.118 | The tablet reports its charge; red under 15% |
| Offline tablet | 0.119 | The board, the money screen and a job tap all work with no network, and say when the snapshot was read |

**One automatic behaviour, stated plainly.** `STREAK_BONUS_LUNA` (`src/routes/cashlinks.ts`)
defaults to 1 NIM and `STREAK_MILESTONE_EVERY` to 7, so every seventh claimed payout mints one
extra bonus link without a fresh parent tap. It is capped by the same family budget, it is
best-effort so a failed bonus never breaks a claim, and setting `STREAK_BONUS_LUNA=0` switches it
off. This is why the copy says the parent "approves every chore before it pays" rather than
"approves every transaction".

## August, done: a month with my own kids

My two kids, seven and four, ran their real routines on their own tablets for the month, with the
feedback button live in both apps. What it turned up, and what shipped because of it:

| what the month showed | what shipped |
|---|---|
| The tablet is off Wi-Fi more than I assumed | Offline mode, three layers (0.119) |
| A seven-year-old does not see her day as a list. She described the app back to me as a treasure hunt | The goal climb path (0.120) is the first piece; the quest map spec (`docs/SPEC-quest-map.md`) is the rest |
| Screen time is the currency they care about | The daily meter, sittings and the bedtime lock (0.118) |
| A locked tablet with jobs still due is a fight | "Do my jobs" on every lock screen (0.118.3) |
| A dead battery reads as a broken app | Battery reporting to the parent (0.118.1) |
| Generated art did not hold up next to real toys | Every generated piece is out of the tree (0.120.2). New backgrounds, characters and icons are hand-drawn and landing now |

## September, now

- **New art.** Backgrounds, characters, stickers and icons, drawn by hand, replacing the generated
  set. In progress.
- **Cycle II entry**, 18 September.
- **Recurring allowance and bonuses.** An allowance the parent sets and controls, that repeats,
  plus bonuses. Still the next feature to build, not shipped. Scheduled transactions and a small
  escrow design are both under evaluation; whichever ships will be documented here.

## October and after

### Families

The grassroots push moves to after the new art lands. Same plan: I have two kids, so I am around
parents constantly, through their activities, my small business, and my own friends with kids. I
hand them a cashlink and ask them to try it with their own kids. Real families first, then an
App Store listing, then marketing once there is something to point at.

### A Rive animator to gamify the app

A **Nimiq Community Council proposal** asks **$4,500** to hire a professional Rive animator for the
kid-facing side. That figure is the size of the grant request; it is not a prize amount and not
money from the competition. Research into every proposal the Council has decided since March 2026
(`docs/funding/COUNCIL-RESEARCH.md`) found $4,500 is the largest sum it has ever approved.

Most of that budget goes to the characters rather than to the egg. Each starter character gets its
own performance; a shared rig with swapped artwork makes every character move identically. The
full request is drafted at `docs/funding/RIVE-PROPOSAL.md`.

**It cannot be submitted yet.** The Council ruled on 15 July 2026 that it does not fund mini apps
while they are active participants in the Mini Apps Competition. Cycle III closes 11 October 2026,
so the proposal goes in after that.

### Two specs from the kitchen table, nothing built

- **The quest map** (`docs/SPEC-quest-map.md`, 8 August): the kid's day as a trail, three
  mandatory stops, then the pay-off.
- **The family walkie talkie** (`docs/SPEC-walkie-talkie.md`, 8 August): a research brief.

## Future goals

### Scheduled drops, the way Fortnite does it

New sticker packs, backgrounds and characters arriving on a schedule rather than all at once,
drawn by Rive animators I bring in. Parents decide whether their kid can buy at all. Opening it
up so outside creators can submit and get paid is a maybe, not a promise.

### Paying kids for learning, not just chores (research phase)

Connecting to apps that teach: reading, math, music, coding. Ello, Khan Academy Kids and
Yousician are the kind of thing I mean. I will be selective, nothing that is only a game.

The goal is to use **HTLCs** (hash time locked contracts) so the reward releases once the criteria
are met, rather than requiring a parent tap for every lesson.

This is genuinely a research phase and the page says so. Known constraint: Ello has no public
API, and the only integration hook found so far is its weekly parent-report emails. Nothing here
is committed.

## The rules that never change

- No ads, no tracking, nothing predatory.
- The parent funds everything and approves every chore before it pays.
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
- Sticker album, hatchling evolution, streak shields, payday notes, parent match, wish list, photo
  proof, open chore packs, co-parent mode.
